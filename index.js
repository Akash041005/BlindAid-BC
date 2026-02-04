/**
 * BlindAid Backend – FINAL CLEAN VERSION (FIXED AI BEHAVIOR)
 * ---------------------------------------------------------
 * - Emergency (Pi → REST)
 * - Talk Mode (STRICT user-driven vision)
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
const uploadDir = "./uploads";
const tempDir = "./temp";

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
    if (!lat || !lon) return;

    const link = `https://maps.google.com/?q=${lat},${lon}`;
    await sendTelegramMessage(
      "📍 EMERGENCY LOCATION\n" +
      link +
      "\n⏰ " +
      new Date().toLocaleString()
    );
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

      // 🔒 STRICT SYSTEM PROMPT
      const systemPrompt = `
You are assisting a blind person.

IMPORTANT RULES (DO NOT BREAK):

- You MUST respond ONLY to what the user explicitly asks.
- DO NOT describe images unless the user asks about what is in front of them.
- Images are ONLY for silent context.
- If the user asks a general question, answer from common knowledge.
- NEVER mention images unless asked.
- NEVER give options.
- NEVER ask questions.
- Use 1–3 short sentences only.

If the user asks about their surroundings:
Describe only what is clearly visible.
Warn clearly if there is danger.

End every response with:

Next step:
<one clear action>
`;

      const payload = {
        contents: [
          {
            parts: [
              { text: systemPrompt },

              // silent visual context
              {
                inline_data: {
                  mime_type: "image/jpeg",
                  data: lastBase64
                }
              },
              {
                inline_data: {
                  mime_type: "image/jpeg",
                  data: liveBase64
                }
              },

              // 🔥 USER PROMPT (THIS IS KING)
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
        "I am not able to help with that.";

      talkImagesReady = false;

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
  emergencyActive = true;

  await sendTelegramMessage(
    "🚨 EMERGENCY ALERT\nButton pressed on Raspberry Pi\n⏰ " +
    new Date().toLocaleString()
  );

  io.emit("emergency:triggered", { active: true });
  res.json({ ok: true });
});

// =====================
// EMERGENCY PHOTO
// =====================
app.post("/photo", upload.single("photo"), async (req, res) => {
  await sendTelegramPhoto(req.file.path, "📸 Emergency Photo");
  res.json({ ok: true });
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
