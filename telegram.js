/**
 * telegram.js
 * -----------
 * Telegram group sender
 * Node 18+ compatible
 */

import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GROUP_ID = process.env.TELEGRAM_GROUP_ID;

if (!BOT_TOKEN || !GROUP_ID) {
  console.error("❌ Telegram ENV missing");
  process.exit(1);
}

// =====================
// SEND TEXT MESSAGE
// =====================
export async function sendTelegramMessage(text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: GROUP_ID,
      text
    })
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }
}

// =====================
// SEND PHOTO
// =====================
export async function sendTelegramPhoto(photoPath, caption = "") {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`;

  const buffer = fs.readFileSync(photoPath);

  const form = new FormData();
  form.append("chat_id", GROUP_ID);
  form.append("caption", caption);
  form.append("photo", new Blob([buffer]), "emergency.jpg");

  const res = await fetch(url, {
    method: "POST",
    body: form
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }
}
