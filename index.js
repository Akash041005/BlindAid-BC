/**
 * BlindAid Backend – FINAL CLEAN VERSION
 * ------------------------------------
 * - Emergency (Pi → REST)
 * - Talk Mode (Pi images → App voice → Gemini → App TTS)
 * - Socket.IO based user interaction
 */

import express from "express";
import dotenv from "dotenv";
import multer from "multer";
import fs from "fs";
import path from "path";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";

import { sendTelegramMessage, sendTelegramPhoto } from "./telegram.js";

dotenv.config();

// =====================
// BASIC SETUP
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
let talkImagesReady = false;

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

  // ---------- EMERGENCY ----------
  socket.on("emergency:check", () => {
    socket.emit("emergency:status", { active: emergencyActive });
  });

  socket.on("emergency:location", async ({ lat, lon }) => {
    try {
      if (!lat || !lon) return;

      const link = `https://maps.google.com/?q=${lat},${lon}`;
      await sendTelegramMessage(
        "📍 EMERGENCY LOCATION\n" +
        link +
        "\n⏰ " +
        new Date().toLocaleString()
      );
    } catch (e) {
      console.error("❌ Location socket error:", e.message);
    }
  });

  // ---------- TALK MODE ----------
  socket.on("talk:userinput", async ({ text }) => {
    try {
      if (!talkImagesReady || !text) return;

      const livePath = path.join(tempDir, "live.jpg");
      const lastPath = path.join(tempDir, "last.jpg");

      if (!fs.existsSync(livePath) || !fs.existsSync(lastPath)) return;

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

      talkImagesReady = false;

      // 🔥 SEND RESPONSE BACK TO APP
      socket.emit("talk:reply", { reply });

    } catch (e) {
      console.error("❌ Talk socket error:", e.message);
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

    await sendTelegramMessage(
      "🚨 EMERGENCY ALERT\nButton pressed on Raspberry Pi\n⏰ " +
      new Date().toLocaleString()
    );

    io.emit("emergency:triggered", { active: true });
    res.json({ ok: true });
  } catch (e) {
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
  } catch {
    res.status(500).json({ ok: false });
  }
});

// =====================
// TALK IMAGES (PI)
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

    talkImagesReady = true;

    // 🔥 NOTIFY APP TO START MIC
    io.emit("talk:ready", { ready: true });

    res.json({ ok: true });
  }
);

// =====================
// START SERVER
// =====================
server.listen(PORT, () => {
  console.log(`🚀 BlindAid backend running on port ${PORT}`);
});
