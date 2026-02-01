/**
 * BlindAid Backend (FINAL CANONICAL VERSION – SOCKET ENABLED)
 * - Emergency trigger (Pi → REST)
 * - Emergency photo upload (Pi → REST)
 * - Location upload (Mobile → REST)
 * - Real-time emergency detection (Socket.IO)
 * - Frontend sends location after emergency (Socket.IO)
 * - Talk mode image receiver (live + last)
 * - Talk mode AI query (text + 2 images)
 */

import express from "express";
import dotenv from "dotenv";
import multer from "multer";
import fs from "fs";
import path from "path";
import http from "http";
import { Server } from "socket.io";

import { sendTelegramMessage, sendTelegramPhoto } from "./telegram.js";
import cors from "cors";





dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// =====================
// CONFIG
// =====================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent";

// =====================
// STATE
// =====================
let emergencyActive = false;
let talkReady = false;

// =====================
// MIDDLEWARES
// =====================
app.use(express.json());

// =====================
// FOLDERS
// =====================
const uploadDir = "./uploads"; // emergency photos
const tempDir = "./temp";      // talk images

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
  destination: (_, __, cb) => cb(null, tempDir),
  filename: (_, file, cb) => {
    if (file.fieldname === "live") cb(null, "live.jpg");
    else if (file.fieldname === "last") cb(null, "last.jpg");
    else cb(null, file.originalname);
  }
});

const uploadTalkImages = multer({ storage: talkStorage });

// =====================
// SOCKET.IO – EMERGENCY CHANNEL
// =====================
io.on("connection", (socket) => {
  console.log("📡 App connected:", socket.id);

  // App checks if emergency already active
  socket.on("emergency:check", () => {
    socket.emit("emergency:status", {
      active: emergencyActive
    });
  });

  // App sends location AFTER emergency trigger
  socket.on("emergency:location", async (data) => {
    try {
      const { lat, lon } = data;
      if (!lat || !lon) return;

      const mapLink = `https://maps.google.com/?q=${lat},${lon}`;
      const msg =
        "📍 EMERGENCY LOCATION (SOCKET)\n" +
        mapLink +
        "\n⏰ Time: " +
        new Date().toLocaleString();

      await sendTelegramMessage(msg);
    } catch (err) {
      console.error("❌ Socket location error:", err.message);
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ App disconnected:", socket.id);
  });
});

// =====================
// HEALTH CHECK
// =====================
app.get("/health", (_, res) => {
  res.json({ ok: true, status: "alive" });
});

// =====================
// EMERGENCY TRIGGER (Pi)
// =====================
app.post("/emergency", async (_, res) => {
  try {
    emergencyActive = true;

    const msg =
      "🚨 EMERGENCY ALERT 🚨\n" +
      "Button pressed on Raspberry Pi.\n" +
      "⏰ Time: " + new Date().toLocaleString();

    await sendTelegramMessage(msg);

    // 🔴 REAL-TIME EMIT
    io.emit("emergency:triggered", {
      active: true,
      time: Date.now()
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Emergency error:", err.message);
    res.status(500).json({ ok: false });
  }
});

// =====================
// EMERGENCY STATUS (REST – fallback)
// =====================
app.get("/emergency/status", (_, res) => {
  res.json({ active: emergencyActive });
});

// =====================
// LOCATION UPLOAD (REST – optional)
// =====================
app.post("/location", async (req, res) => {
  try {
    const { lat, lon } = req.body;
    if (!lat || !lon) {
      return res.status(400).json({ ok: false });
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
// EMERGENCY PHOTO UPLOAD (Pi)
// =====================
app.post("/photo", upload.single("photo"), async (req, res) => {
  try {
    await sendTelegramPhoto(req.file.path, "📸 Emergency Photo");
    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Photo error:", err.message);
    res.status(500).json({ ok: false });
  }
});

// =====================
// TALK MODE – IMAGE RECEIVE (Pi)
// =====================
app.post(
  "/talk/images",
  uploadTalkImages.fields([
    { name: "live", maxCount: 1 },
    { name: "last", maxCount: 1 }
  ]),
  (req, res) => {
    if (!req.files?.live || !req.files?.last) {
      return res.status(400).json({ ok: false });
    }

    talkReady = true;
    console.log("🧠 Talk images ready");
    res.json({ ok: true });
  }
);

// =====================
// TALK STATUS (Mobile polling)
// =====================
app.get("/talk/status", (_, res) => {
  res.json({ ready: talkReady });
});

// =====================
// TALK QUERY (Mobile → Gemini)
// =====================
app.post("/talk/query", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ ok: false });

    const livePath = path.join(tempDir, "live.jpg");
    const lastPath = path.join(tempDir, "last.jpg");

    if (!fs.existsSync(livePath) || !fs.existsSync(lastPath)) {
      return res.status(400).json({ ok: false });
    }

    const liveBase64 = fs.readFileSync(livePath, "base64");
    const lastBase64 = fs.readFileSync(lastPath, "base64");

    const systemPrompt = `
You are a calm, practical assistant helping a blind person.

Speak like a human guide.
Do not ask questions.
Do not give options.

Use 1 to 3 short sentences.
Say only what is visible and important.
If there is danger, warn clearly.

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

    const reply =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "I am not able to understand the scene clearly.";

    talkReady = false;
    res.json({ ok: true, reply });
  } catch (err) {
    console.error("❌ Talk query error:", err.message);
    res.status(500).json({ ok: false });
  }
});

// =====================
// START SERVER
// =====================
server.listen(PORT, () => {
  console.log(`🚀 BlindAid backend + Socket.IO running on port ${PORT}`);
});
