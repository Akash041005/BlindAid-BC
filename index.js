/**
 * index.js
 * --------
 * BlindAid Backend (Final + Talk Images Added)
 * - Emergency trigger
 * - Photo upload from Pi
 * - Location upload
 * - Talk mode image receiver (live + last)
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

// =====================
// FOLDERS
// =====================
const uploadDir = "./uploads";
const tempDir = "./temp";

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

// =====================
// MULTER (EMERGENCY PHOTO)
// =====================
const upload = multer({ dest: uploadDir });

// =====================
// MULTER (TALK IMAGES)
// =====================
const talkStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, tempDir),
  filename: (req, file, cb) => {
    if (file.fieldname === "live") cb(null, "live.jpg");
    else if (file.fieldname === "last") cb(null, "last.jpg");
    else cb(null, file.originalname);
  }
});

const uploadTalkImages = multer({ storage: talkStorage });

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
// PHOTO UPLOAD (EMERGENCY)
// =====================
app.post("/photo", upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) {
      console.log("❌ No photo received");
      return res.status(400).json({ error: "No photo" });
    }

    console.log("📸 Emergency photo received:", req.file.path);

    await sendTelegramPhoto(req.file.path, "📸 Emergency Photo");
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
// TALK MODE: IMAGE RECEIVE
// =====================
app.post(
  "/talk/images",
  uploadTalkImages.fields([
    { name: "live", maxCount: 1 },
    { name: "last", maxCount: 1 }
  ]),
  (req, res) => {
    if (!req.files?.live || !req.files?.last) {
      return res.status(400).json({
        ok: false,
        error: "Both live and last images required"
      });
    }

    console.log("🧠 Talk images received:");
    console.log(" - live.jpg");
    console.log(" - last.jpg");

    res.json({ ok: true });
  }
);

// =====================
// START SERVER
// =====================
app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
