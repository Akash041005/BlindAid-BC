import TelegramBot from "node-telegram-bot-api";

let bot;

function getBot() {
  if (!bot) {
    bot = new TelegramBot(process.env.TG_TOKEN, { polling: false });
  }
  return bot;
}

export async function sendLog(text) {
  try {
    await getBot().sendMessage(process.env.TG_CHAT_ID, text);
  } catch (e) {
    console.log("⚠️ Telegram log failed (ignored)");
  }
}

export async function sendPhoto(path, caption) {
  try {
    await getBot().sendPhoto(process.env.TG_CHAT_ID, path, { caption });
  } catch (e) {
    console.log("⚠️ Telegram photo failed (ignored)");
  }
}
