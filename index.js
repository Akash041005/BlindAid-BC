import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import multer from "multer";
import { sendLog, sendPhoto } from "./telegram.js";
import { notifyContacts } from "./contacts.js";

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: "uploads/" });
const PORT = process.env.PORT || 3000;

// in-memory emergency sessions
const sessions = {};

/* ---------- HEALTH CHECK ---------- */
app.get("/", (req, res) => {
  res.send("BlindAid backend running ✅");
});

/* ---------- EMERGENCY START ---------- */
app.post("/emergency", async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: "userId required" });
    }

    sessions[userId] = {
      active: true,
      startedAt: new Date()
    };

    await sendLog(
      `🚨 EMERGENCY TRIGGERED\n` +
      `User: ${userId}\n` +
      `⏰ ${new Date().toLocaleString()}`
    );

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ---------- LOCATION (FROM MOBILE) ---------- */
app.post("/location", async (req, res) => {
  try {
    const { userId, lat, lng } = req.body;

    if (!sessions[userId]?.active) {
      return res.status(400).json({ error: "No active emergency" });
    }

    sessions[userId].location = { lat, lng };

    await sendLog(
      `📍 LOCATION RECEIVED\n` +
      `User: ${userId}\n` +
      `https://maps.google.com/?q=${lat},${lng}`
    );

    // notify emergency contacts
    await notifyContacts({
      userId,
      lat,
      lng,
      time: new Date().toLocaleString()
    });

    // tell Raspberry Pi to take photo
    res.json({ takePhoto: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ---------- PHOTO (FROM RASPBERRY PI) ---------- */
app.post("/photo", upload.single("photo"), async (req, res) => {
  try {
    const { userId } = req.body;

    if (!sessions[userId]?.active) {
      return res.status(400).json({ error: "No active emergency" });
    }

    await sendPhoto(
      req.file.path,
      `📸 PHOTO CAPTURED\n` +
      `User: ${userId}\n` +
      `⏰ ${new Date().toLocaleString()}`
    );

    // close emergency
    sessions[userId].active = false;

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ---------- START SERVER ---------- */
app.listen(PORT, () => {
  console.log(`🔥 Backend running on port ${PORT}`);
});
