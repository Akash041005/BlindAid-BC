/**
 * BlindAid Backend – FINAL INTELLIGENT AI VERSION
 * ---------------------------------------------
 * - Emergency (Pi → REST)
 * - Talk Mode (Images + User Speech → Gemini → App TTS)
 * - Smart prompt: image only when needed, danger first
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
  cors: { origin: "*", methods: ["GET", "POST"] }
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
    await sendTelegramMessage(
      `📍 EMERGENCY LOCATION\nhttps://maps.google.com/?q=${lat},${lon}`
    );
  });

  // ---------- TALK START ----------
  socket.on("talk:start", () => {
    io.emit("talk:capture", { start: true });
  });

  // ---------- USER SPEECH ----------
  socket.on("talk:userinput", async ({ text }) => {
    try {
      if (!talkImagesReady || !text) return;

      const livePath = path.join(tempDir, "live.jpg");
      const lastPath = path.join(tempDir, "last.jpg");
      if (!fs.existsSync(livePath) || !fs.existsSync(lastPath)) return;

      const liveBase64 = fs.readFileSync(livePath, "base64");
      const lastBase64 = fs.readFileSync(lastPath, "base64");

      // 🔥 MASTER SYSTEM PROMPT
      const systemPrompt = `
You are an AI assistant guiding a blind person in real time.

IMPORTANT RULES:
- Speak calmly like a human guide.
- Use very simple language.
- Do NOT ask questions.
- Do NOT give multiple options.

IMAGE RULES:
- Describe the images ONLY IF:
  1) The user explicitly asks about surroundings, OR
  2) You detect any danger in the images.

DANGER RULE:
- If you detect danger (vehicle, stairs, edge, obstacle, fire, pit),
  warn immediately even if the user asked something else.

RESPONSE FORMAT (MANDATORY):
- 1 to 3 short sentences.
- Then end with:

Next step:
<one clear action>
`;

      const payload = {
        contents: [
          {
            parts: [
              { text: systemPrompt },
              {
                text: `
User spoken command:
"${text}"

Decide whether to use the images based on the rules above.
`
              },
              { text: "Previous image:" },
              { inline_data: { mime_type: "image/jpeg", data: lastBase64 } },
              { text: "Current image:" },
              { inline_data: { mime_type: "image/jpeg", data: liveBase64 } }
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
        "I am not able to understand clearly right now.";

      talkImagesReady = false;

      socket.emit("talk:reply", { reply });

    } catch (e) {
      console.error("❌ Talk AI error:", e.message);
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
  await sendTelegramMessage("🚨 EMERGENCY ALERT FROM RASPBERRY PI");
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
