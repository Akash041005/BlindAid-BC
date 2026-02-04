/**
 * BlindAid Backend – FINAL ALL-IN-ONE FIXED VERSION
 * ------------------------------------------------
 * ✔ Emergency location → Telegram
 * ✔ GK vs Image logic correct
 * ✔ Images deleted after AI call
 * ✔ No stale image / no missing location
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
// HELPERS
// =====================
function isGeneralKnowledge(text) {
  const keywords = [
    "who is",
    "what is",
    "president",
    "prime minister",
    "capital",
    "country",
    "usa",
    "india",
    "time",
    "date",
    "weather",
    "how many",
    "calculate",
    "history",
    "population"
  ];
  const t = text.toLowerCase();
  return keywords.some(k => t.includes(k));
}

function deleteTalkImages() {
  try {
    const live = path.join(tempDir, "live.jpg");
    const last = path.join(tempDir, "last.jpg");
    if (fs.existsSync(live)) fs.unlinkSync(live);
    if (fs.existsSync(last)) fs.unlinkSync(last);
    console.log("🧹 Talk images deleted");
  } catch (e) {
    console.error("❌ Image delete error:", e.message);
  }
}

// =====================
// SOCKET.IO
// =====================
io.on("connection", (socket) => {
  console.log("📡 App connected:", socket.id);

  // ---------- EMERGENCY LOCATION (FIXED) ----------
  socket.on("emergency:location", async ({ lat, lon }) => {
    try {
      if (!lat || !lon) {
        console.log("❌ Location missing");
        return;
      }

      const link = `https://maps.google.com/?q=${lat},${lon}`;
      const msg =
        "📍 EMERGENCY LOCATION\n" +
        link +
        "\n⏰ " +
        new Date().toLocaleString();

      await sendTelegramMessage(msg);
      console.log("📤 Location sent to Telegram");

    } catch (e) {
      console.error("❌ Location error:", e.message);
    }
  });

  // ---------- TALK START ----------
  socket.on("talk:start", () => {
    talkImagesReady = false;
    io.emit("talk:capture", { start: true });
  });

  // ---------- USER INPUT ----------
  socket.on("talk:userinput", async ({ text }) => {
    try {
      if (!text) return;

      const isGK = isGeneralKnowledge(text);
      let payload;

      // ===== GENERAL KNOWLEDGE =====
      if (isGK) {
        payload = {
          contents: [
            {
              parts: [
                {
                  text: `
You are answering a general knowledge question.
Rules:
- Give a short, clear answer.
- Do NOT mention images.
- Do NOT say "Next step".
`
                },
                { text: `Question: ${text}` }
              ]
            }
          ]
        };
      }

      // ===== IMAGE MODE =====
      else {
        if (!talkImagesReady) {
          socket.emit("talk:reply", {
            reply: "Camera image is not ready yet. Please wait."
          });
          return;
        }

        const livePath = path.join(tempDir, "live.jpg");
        const lastPath = path.join(tempDir, "last.jpg");

        if (!fs.existsSync(livePath) || !fs.existsSync(lastPath)) {
          socket.emit("talk:reply", {
            reply: "Camera image is not available. Please try again."
          });
          return;
        }

        const liveBase64 = fs.readFileSync(livePath, "base64");
        const lastBase64 = fs.readFileSync(lastPath, "base64");

        payload = {
          contents: [
            {
              parts: [
                {
                  text: `
You are guiding a blind person in real time.

Rules:
- Speak calmly.
- Use simple words.
- If danger is visible (vehicle, stairs, edge, obstacle),
  warn immediately.

Response format:
1–3 short sentences.
Then:

Next step:
<one clear action>
`
                },
                { text: `User said: "${text}"` },
                { text: "Previous image:" },
                { inline_data: { mime_type: "image/jpeg", data: lastBase64 } },
                { text: "Current image:" },
                { inline_data: { mime_type: "image/jpeg", data: liveBase64 } }
              ]
            }
          ]
        };
      }

      // ===== GEMINI CALL =====
      const response = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      const reply =
        data?.candidates?.[0]?.content?.parts?.[0]?.text ||
        "I am not able to answer right now.";

      socket.emit("talk:reply", { reply });

      // 🧹 CLEAN UP
      deleteTalkImages();
      talkImagesReady = false;

    } catch (e) {
      console.error("❌ Talk error:", e.message);
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ App disconnected:", socket.id);
  });
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
// EMERGENCY PHOTO (OPTIONAL)
// =====================
app.post("/photo", upload.single("photo"), async (req, res) => {
  await sendTelegramPhoto(req.file.path, "📸 Emergency Photo");
  res.json({ ok: true });
});

// =====================
// HEALTH
// =====================
app.get("/health", (_, res) => {
  res.json({ ok: true });
});

// =====================
// START SERVER
// =====================
server.listen(PORT, () => {
  console.log(`🚀 BlindAid backend running on port ${PORT}`);
});
