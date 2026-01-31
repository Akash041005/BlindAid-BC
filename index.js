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

/* ---------- EMERGENCY START (FROM PI) ---------- */
app.post("/emergency", async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: "userId required" });
    }

    sessions[userId] = {
      active: true,
      locationReceived: false,
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

/* ---------- EMERGENCY STATUS (FOR FRONTEND POLLING) ---------- */
app.get("/status/:userId", (req, res) => {
  const { userId } = req.params;
  const session = sessions[userId];

  res.json({
    active: session?.active === true,
    locationReceived: session?.locationReceived === true
  });
});

/* ---------- LOCATION (AUTO FROM MOBILE) ---------- */
app.post("/location", async (req, res) => {
  try {
    const { userId, lat, lng } = req.body;

    const session = sessions[userId];
    if (!session?.active) {
      return res.status(400).json({ error: "No active emergency" });
    }

    // ⛔ ignore duplicate location
    if (session.locationReceived) {
      return res.json({ ok: true, ignored: true });
    }

    session.locationReceived = true;
    session.location = { lat, lng };

    await sendLog(
      `📍 LOCATION RECEIVED\n` +
      `User: ${userId}\n` +
      `https://maps.google.com/?q=${lat},${lng}`
    );

    await notifyContacts({
      userId,
      lat,
      lng,
      time: new Date().toLocaleString()
    });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ---------- PHOTO (FROM PI) ---------- */
app.post("/photo", upload.single("photo"), async (req, res) => {
  try {
    const { userId } = req.body;
    const session = sessions[userId];

    if (!session?.active) {
      return res.status(400).json({ error: "No active emergency" });
    }

    await sendPhoto(
      req.file.path,
      `📸 PHOTO CAPTURED\n` +
      `User: ${userId}\n` +
      `⏰ ${new Date().toLocaleString()}`
    );

    // close emergency
    session.active = false;

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
