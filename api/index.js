const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const https = require('https');
const path = require('path');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const BUNNY_STORAGE_ZONE = process.env.BUNNY_STORAGE_ZONE;
const BUNNY_API_KEY = process.env.BUNNY_API_KEY;
const BUNNY_PULL_ZONE = process.env.BUNNY_PULL_ZONE;

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Allowed video extensions
const allowedExts = ['.mp4', '.mkv', '.avi', '.mov', '.webm'];

// Helper: Download file buffer from URL
async function downloadFile(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const data = [];
      res.on('data', (chunk) => data.push(chunk));
      res.on('end', () => resolve(Buffer.concat(data)));
      res.on('error', reject);
    });
  });
}

// Upload buffer to BunnyCDN Storage Zone
async function uploadToBunnyCDN(buffer, filename) {
  const url = `https://storage.bunnycdn.com/${BUNNY_STORAGE_ZONE}/${filename}`;
  await axios.put(url, buffer, {
    headers: {
      AccessKey: BUNNY_API_KEY,
      'Content-Type': 'application/octet-stream',
    },
  });
}

// Format file size in MB
function formatBytes(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// Bot start / help message
bot.onText(/\/start|\/help/, (msg) => {
  const chatId = msg.chat.id;
  const welcomeMsg = `
👋 Hello *${msg.from.first_name}*!

🎥 Send me a video file like .mp4, .mkv, .avi, .mov or video documents.

🔗 I will upload it to BunnyCDN and send you a streamable link!

📤 Just send your video now to get started.

⚠️ Max file size depends on Telegram limits (up to 2GB).

Happy Streaming! 🚀
  `;
  bot.sendMessage(chatId, welcomeMsg, { parse_mode: 'Markdown' });
});

// Main handler: file uploads
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  // Ignore non-video/documents without file
  if (!msg.document && !msg.video) return;

  const file = msg.document || msg.video;
  let ext = path.extname(file.file_name || 'video.mp4').toLowerCase();

  // Check allowed extension
  if (!allowedExts.includes(ext)) {
    return bot.sendMessage(
      chatId,
      `⚠️ Unsupported file type *${ext}*.\nPlease send video files with extensions: ${allowedExts.join(
        ', '
      )}.`,
      { parse_mode: 'Markdown' }
    );
  }

  const fileName = `${Date.now()}${ext}`;
  bot.sendMessage(chatId, `⏳ Downloading your file *${file.file_name}* (${formatBytes(file.file_size)})...`, { parse_mode: 'Markdown' });

  try {
    const fileLink = await bot.getFileLink(file.file_id);
    const fileBuffer = await downloadFile(fileLink);

    bot.sendMessage(chatId, `📤 Uploading *${file.file_name}* to BunnyCDN...`, { parse_mode: 'Markdown' });

    await uploadToBunnyCDN(fileBuffer, fileName);

    const streamUrl = `${BUNNY_PULL_ZONE}/${fileName}`;

    // Send stream link with inline button
    const options = {
      reply_markup: {
        inline_keyboard: [[
          { text: "▶️ Play Video", url: streamUrl }
        ]]
      },
      parse_mode: 'Markdown',
      disable_web_page_preview: false
    };

    await bot.sendMessage(
      chatId,
      `✅ Upload complete!\n\n🎬 *Stream Link:*\n[${fileName}](${streamUrl})\n\nClick the button below to play ▶️`,
      options
    );

  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, `❌ Oops! Something went wrong while processing your file.`);
  }
});
