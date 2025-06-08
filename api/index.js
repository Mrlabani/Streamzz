const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const https = require('https');
const path = require('path');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const BUNNY_STORAGE_ZONE = process.env.BUNNY_STORAGE_ZONE;
const BUNNY_API_KEY = process.env.BUNNY_API_KEY;
const BUNNY_PULL_ZONE = process.env.BUNNY_PULL_ZONE;

if (!TELEGRAM_TOKEN || !BUNNY_STORAGE_ZONE || !BUNNY_API_KEY || !BUNNY_PULL_ZONE) {
  throw new Error("Please set TELEGRAM_TOKEN, BUNNY_STORAGE_ZONE, BUNNY_API_KEY, and BUNNY_PULL_ZONE environment variables!");
}

const allowedExts = ['.mp4', '.mkv', '.avi', '.mov', '.webm'];

// Helper function: download file buffer from URL
function downloadFile(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
  });
}

// Upload buffer to BunnyCDN Storage
async function uploadToBunnyCDN(buffer, filename) {
  const url = `https://storage.bunnycdn.com/${BUNNY_STORAGE_ZONE}/${filename}`;
  await axios.put(url, buffer, {
    headers: {
      AccessKey: BUNNY_API_KEY,
      'Content-Type': 'application/octet-stream',
    }
  });
}

// Format bytes to MB string
function formatBytes(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// TelegramBot instance in no-polling mode, manual usage of `processUpdate`
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

// Main exported handler for Vercel
module.exports = async (req, res) => {
  try {
    // Only accept POST from Telegram
    if (req.method !== 'POST') {
      return res.status(200).send('Hello! Telegram Bot is running.');
    }

    const update = req.body;

    // Process the update with node-telegram-bot-api
    await bot.processUpdate(update);

    // Handle messages:
    if (update.message) {
      const msg = update.message;
      const chatId = msg.chat.id;

      if (msg.text && (msg.text === '/start' || msg.text === '/help')) {
        const welcomeMsg = `
👋 Hello *${msg.from.first_name || 'there'}*!

🎥 Send me a video file (.mp4, .mkv, .avi, .mov, .webm).

🔗 I'll upload it to BunnyCDN and send you a streamable link!

⚠️ Max file size depends on Telegram limits (~2GB).

🚀 Let's get started!
        `;
        await bot.sendMessage(chatId, welcomeMsg, { parse_mode: 'Markdown' });
        return res.status(200).send('ok');
      }

      // If message has document or video
      const file = msg.document || msg.video;
      if (!file) {
        await bot.sendMessage(chatId, '⚠️ Please send a supported video file!');
        return res.status(200).send('ok');
      }

      const ext = path.extname(file.file_name || 'video.mp4').toLowerCase();
      if (!allowedExts.includes(ext)) {
        await bot.sendMessage(chatId, `⚠️ Unsupported file type *${ext}*. Allowed: ${allowedExts.join(', ')}`, { parse_mode: 'Markdown' });
        return res.status(200).send('ok');
      }

      const fileName = `${Date.now()}${ext}`;
      await bot.sendMessage(chatId, `⏳ Downloading *${file.file_name || 'video'}* (${formatBytes(file.file_size)})...`, { parse_mode: 'Markdown' });

      try {
        const fileLink = await bot.getFileLink(file.file_id);
        const fileBuffer = await downloadFile(fileLink);

        await bot.sendMessage(chatId, `📤 Uploading *${file.file_name || 'video'}* to BunnyCDN...`, { parse_mode: 'Markdown' });

        await uploadToBunnyCDN(fileBuffer, fileName);

        const streamUrl = `${BUNNY_PULL_ZONE}/${fileName}`;

        // Send stream link with button
        const options = {
          reply_markup: {
            inline_keyboard: [[{ text: '▶️ Play Video', url: streamUrl }]]
          },
          parse_mode: 'Markdown',
          disable_web_page_preview: false
        };

        await bot.sendMessage(
          chatId,
          `✅ Upload complete!\n\n🎬 *Stream Link:* [${fileName}](${streamUrl})\n\nClick below to watch ▶️`,
          options
        );
      } catch (err) {
        console.error('Upload error:', err);
        await bot.sendMessage(chatId, '❌ Something went wrong while uploading your file.');
      }
    }

    res.status(200).send('ok');
  } catch (error) {
    console.error('Error in webhook:', error);
    res.status(500).send('Internal Server Error');
  }
};
