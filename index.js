/**
 * BlindAid Backend – FINAL FULL index.js
 * ------------------------------------
 * - Emergency trigger (Pi → REST)
 * - Emergency photo upload (Pi → REST)
 * - Location upload (Mobile → REST + Socket)
 * - Real-time emergency detection (Socket.IO)
 * - Talk mode (Pi images → App mic → Gemini → App TTS)
 */

import express from "express";
import dotenv from "dotenv";
import multer from "multer";
import fs from "fs";
import path from "path";
import http from "http";
import cors from "cors";
import fetch from "node-fetch";
import { Server } from "socket.io";

import { sendTelegramMessage, sendTelegramPhoto } from "./telegram.js";

dotenv.config();

// =====================
// APP + SERVER
// =====================
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
// FOLDERS
// =====================
const uploadDir = "./uploads"; // emergency photo
const tempDir = "./temp";      // talk images

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

// =====================
// MULTER
// =====================
const upload = multer({ dest: uploadDir });

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
// SOCKET.IO
// =====================
io.on("connection", (socket) => {
  console.log("📡 App connected:", socket.id);

  socket.on("emergency:check", () => {
    socket.emit("emergency:status", { active: emergencyActive });
  });

  socket.on("emergency:location", async ({ lat, lon }) => {
    try {
      if (!lat || !lon) return;

      const mapLink = `https://maps.google.com/?q=${lat},${lon}`;
      const msg =
        "📍 EMERGENCY LOCATION\n" +
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
// HEALTH
// =====================
app.get("/health", (_, res) => {
  res.json({ ok: true });
});

// =====================
// EMERGENCY (PI)
// =====================
app.post("/emergency", async (_, res) => {
  try {
    emergencyActive = true;

    const msg =
      "🚨 EMERGENCY ALERT 🚨\n" +
      "Button pressed on Raspberry Pi\n" +
      "⏰ Time: " +
      new Date().toLocaleString();

    await sendTelegramMessage(msg);

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
// EMERGENCY STATUS
// =====================
app.get("/emergency/status", (_, res) => {
  res.json({ active: emergencyActive });
});

// =====================
// LOCATION (REST fallback)
// =====================
app.post("/location", async (req, res) => {
  try {
    const { lat, lon } = req.body;
    if (!lat || !lon) return res.status(400).json({ ok: false });

    const mapLink = `https://maps.google.com/?q=${lat},${lon}`;
    const msg =
      "📍 EMERGENCY LOCATION\n" +
      mapLink +
      "\n⏰ Time: " +
      new Date().toLocaleString();

    await sendTelegramMessage(msg);
    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Location error:", err.message);
    res.status(500).json({ ok: false });
  }
});

// =====================
// EMERGENCY PHOTO
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
// TALK MODE – IMAGES (PI)
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
    console.log("🧠 Talk images received");

    io.emit("talk:ready", {
      ready: true,
      time: Date.now()
    });

    res.json({ ok: true });
  }
);

// =====================
// TALK STATUS (OPTIONAL)
// =====================
app.get("/talk/status", (_, res) => {
  res.json({ ready: talkReady });
});

// =====================
// TALK QUERY (APP → GEMINI)
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
            { inline_data: { mime_type: "image/jpeg", data: lastBase64 } },
            { text: "Current view:" },
            { inline_data: { mime_type: "image/jpeg", data: liveBase64 } },
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

    io.emit("talk:reply", { reply });

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
  console.log(`🚀 BlindAid backend running on port ${PORT}`);
});
