/**
 * index.js
 * --------
 * BlindAid Backend (FINAL CANONICAL VERSION)
 * - Emergency trigger
 * - Emergency photo upload
 * - Location upload
 * - Talk mode image receiver (live + last)
 * - Talk mode AI query (text + 2 images)
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
// CONFIG
// =====================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent";

// =====================
// MIDDLEWARES
// =====================
app.use(express.json());

// =====================
// FOLDERS
// =====================
const uploadDir = "./uploads"; // emergency photos
const tempDir = "./temp";       // talk images

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
      return res.status(400).json({ ok: false, error: "No photo received" });
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

    console.log("🧠 Talk images received (live + last)");
    res.json({ ok: true });
  }
);

// =====================
// TALK MODE: QUERY (TEXT + 2 IMAGES → AI)
// =====================
app.post("/talk/query", async (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ ok: false, error: "No text provided" });
    }

    const livePath = path.join(tempDir, "live.jpg");
    const lastPath = path.join(tempDir, "last.jpg");

    if (!fs.existsSync(livePath) || !fs.existsSync(lastPath)) {
      return res.status(400).json({
        ok: false,
        error: "Images not available"
      });
    }

    const liveBase64 = fs.readFileSync(livePath, "base64");
    const lastBase64 = fs.readFileSync(lastPath, "base64");

    const systemPrompt = `
You are a calm assistant helping a visually impaired person.

Use the images as context.
Speak clearly in short sentences.
Do not ask questions.
Do not give options.

End with:
Next step:
<one clear action>
`;

    const payload = {
      contents: [
        {
          parts: [
            { text: systemPrompt },
            { text: "Previous view:" },
            {
              inline_data: {
                mime_type: "image/jpeg",
                data: lastBase64
              }
            },
            { text: "Current view:" },
            {
              inline_data: {
                mime_type: "image/jpeg",
                data: liveBase64
              }
            },
            { text: `User said: ${text}` }
          ]
        }
      ]
    };

    const response = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("❌ Gemini error:", data);
      return res.status(500).json({ ok: false, error: "AI failed" });
    }

    const reply =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "I am not able to understand the scene clearly.";

    res.json({ ok: true, reply });

  } catch (err) {
    console.error("❌ Talk query error:", err.message);
    res.status(500).json({ ok: false });
  }
});

// =====================
// START SERVER
// =====================
app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
