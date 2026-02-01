/**
 * index.js
 * --------
 * BlindAid Backend (Simplified)
 * - Emergency trigger
 * - Photo upload from Pi
 * - Location upload from Mobile
 * - Telegram group alerts
 * Node.js v18+ / v24 compatible
 */

import express from "express";
import dotenv from "dotenv";
import multer from "multer";
import fs from "fs";
import path from "path";
import { sendTelegramMessage, sendTelegramPhoto } from "./telegram.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// =====================
// MIDDLEWARES
// =====================
app.use(express.json());

// ensure uploads folder exists
const uploadDir = "./uploads";
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// multer config (for Pi photo)
const upload = multer({ dest: uploadDir });

// =====================
// HEALTH CHECK
// =====================
app.get("/health", (req, res) => {
  res.json({ ok: true, status: "alive" });
});

// =====================
// EMERGENCY TRIGGER
// =====================
app.post("/emergency", async (req, res) => {
  try {
    console.log("🚨 Emergency triggered");

    const msg =
      "🚨 EMERGENCY ALERT 🚨\n" +
      "Button pressed on Raspberry Pi.\n" +
      "⏰ Time: " + new Date().toLocaleString();

    await sendTelegramMessage(msg);

    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Emergency error:", err.message);
    res.status(500).json({ ok: false });
  }
});

// =====================
// PHOTO UPLOAD (Pi)
// =====================
app.post("/photo", upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "No photo uploaded" });
    }

    console.log("📸 Photo received from Pi");

    const photoPath = path.resolve(req.file.path);

    await sendTelegramPhoto(
      photoPath,
      "📸 Emergency Photo\n⏰ " + new Date().toLocaleString()
    );

    // delete local file after sending
    fs.unlinkSync(photoPath);

    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Photo error:", err.message);
    res.status(500).json({ ok: false });
  }
});

// =====================
// LOCATION UPLOAD (Mobile)
// =====================
app.post("/location", async (req, res) => {
  try {
    const { lat, lng } = req.body;

    if (!lat || !lng) {
      return res.status(400).json({ ok: false, error: "Missing lat/lng" });
    }

    console.log("📍 Location received:", lat, lng);

    const mapLink = `https://maps.google.com/?q=${lat},${lng}`;

    const msg =
      "📍 EMERGENCY LOCATION\n" +
      mapLink + "\n" +
      "⏰ Time: " + new Date().toLocaleString();

    await sendTelegramMessage(msg);

    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Location error:", err.message);
    res.status(500).json({ ok: false });
  }
});

// =====================
// START SERVER
// =====================
app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
