/**
 * BlindAid Backend – TEMP DEBUG VERSION
 * ------------------------------------
 * GOAL:
 * - Confirm frontend → backend user text is received or not
 * - No AI logic for now
 */

import express from "express";
import dotenv from "dotenv";
import multer from "multer";
import fs from "fs";
import path from "path";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";

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
// STATE
// =====================
let talkImagesReady = false;

// =====================
// FOLDERS
// =====================
const tempDir = "./temp";
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

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
// SOCKET.IO
// =====================
io.on("connection", (socket) => {
  console.log("📡 App connected:", socket.id);

  // -------- TALK START (optional) --------
  socket.on("talk:start", () => {
    console.log("🎬 talk:start received from frontend");
    socket.emit("talk:ack", {
      ok: true,
      msg: "talk:start received by backend"
    });
  });

  // -------- USER INPUT (MAIN DEBUG POINT) --------
  socket.on("talk:userinput", (data) => {
    console.log("🧪 RAW talk:userinput payload:", data);

    if (!data || typeof data.text !== "string" || data.text.trim() === "") {
      console.log("❌ USER TEXT NOT RECEIVED");

      socket.emit("talk:text-status", {
        received: false,
        reason: "No text / empty text received at backend"
      });
      return;
    }

    console.log("✅ USER TEXT RECEIVED:");
    console.log("🗣️ >", data.text);

    socket.emit("talk:text-status", {
      received: true,
      text: data.text,
      time: new Date().toISOString()
    });
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
    console.log("🧠 Talk images received");

    io.emit("talk:ready", { ready: true });

    res.json({ ok: true });
  }
);

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
  console.log(`🚀 BlindAid TEMP DEBUG backend running on port ${PORT}`);
});
