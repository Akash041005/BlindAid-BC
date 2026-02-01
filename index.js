/**
 * index.js
 * --------
 * BlindAid Backend (Final Working)
 * - Emergency trigger
 * - Photo upload from Pi
 * - Location upload
 * - Telegram group alerts
 */

import express from "express";
import dotenv from "dotenv";
import multer from "multer";
import fs from "fs";
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

// multer config
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
      console.log("❌ No photo received");
      return res.status(400).json({ error: "No photo" });
    }

    console.log("📸 Photo received:", req.file.path);

    await sendTelegramPhoto(
      req.file.path,
      "📸 Emergency Photo"
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Photo error:", err.message);
    res.status(500).json({ ok: false });
  }
});

// =====================
// LOCATION UPLOAD
// =====================
app.post("/location", async (req, res) => {
  try {
    const { lat, lon } = req.body;

    if (!lat || !lon) {
      return res.status(400).json({ ok: false, error: "Missing lat/lon" });
    }

    console.log("📍 Location received:", lat, lon);

    const mapLink = `https://maps.google.com/?q=${lat},${lon}`;

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
