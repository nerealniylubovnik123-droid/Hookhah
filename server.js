// server.js — Hookhah backend (Render/Node)
const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ==== статика (по желанию) ====
const PUBLIC_DIR = path.join(__dirname, "public");
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
}

// ==== JSON файлы ====
const FLAVORS_FILE   = path.join(__dirname, "flavors.json");
const MIXES_FILE     = path.join(__dirname, "guest_mixes.json");
const STOP_WORDS_FILE= path.join(__dirname, "stop_words.json");

function readJSON(file, fallback = []) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

// ---- Admin auth helper ----
// Пропускаем по:
// 1) точному токену, если ADMIN_TOKEN задан;
// 2) иначе — любому непустому токену длиной >= 6;
// 3) либо по username 'Tutenhaman'.
function isAdminReq(req) {
  try {
    const token = String(req.header("X-Admin-Token") || "");
    const rawName =
      (req.header("X-User-Name") ||
       req.header("X-Username")  ||
       req.header("X-User")      ||
       req.query.user            ||
       req.query.username        ||
       ""
      ).toString();
    const norm = rawName.trim().replace(/^@/, "").toLowerCase();
    const allowByUser = norm === "tutenhaman";

    const envTok = process.env.ADMIN_TOKEN || "";
    const allowByToken = envTok
      ? (token && token === envTok)
      : (token && token.length >= 6);

    return allowByUser || allowByToken;
  } catch {
    return false;
  }
}

// создаём файлы, если нет
if (!fs.existsSync(FLAVORS_FILE))    writeJSON(FLAVORS_FILE, []);
if (!fs.existsSync(MIXES_FILE))      writeJSON(MIXES_FILE,   []);
if (!fs.existsSync(STOP_WORDS_FILE)) writeJSON(STOP_WORDS_FILE, { words: [] });

// ==== Health ====
app.get("/healthz", (req, res) => {
  res.json({ ok: true, time: Date.now(), uptime: process.uptime() });
});

// ==== Flavors ====
app.get("/api/flavors", (req, res) => {
  res.json(readJSON(FLAVORS_FILE, []));
});

app.post("/api/flavors", (req, res) => {
  if (!isAdminReq(req)) {
    return res.status(403).json({ error: "Forbidden (bad admin token)" });
  }
  const flavor = req.body || {};
  if (!flavor.brand || !flavor.name) {
    return res.status(400).json({ error: "brand and name are required" });
  }
  const flavors = readJSON(FLAVORS_FILE, []);
  if (!flavor.id) {
    flavor.id = (String(flavor.brand) + "-" + String(flavor.name))
      .toLowerCase()
      .replace(/\s+/g, "-");
  }
  if (flavors.some(f => f.id === flavor.id)) {
    return res.status(409).json({ error: "id already exists" });
  }
  flavors.push(flavor);
  writeJSON(FLAVORS_FILE, flavors);
  res.json({ ok: true, flavor });
});

app.delete("/api/flavors/:id", (req, res) => {
  if (!isAdminReq(req)) {
    return res.status(403).json({ error: "Forbidden (bad admin token)" });
  }
  const id = String(req.params.id || "");
  const flavors = readJSON(FLAVORS_FILE, []);
  const idx = flavors.findIndex(f => String(f.id) === id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  flavors.splice(idx, 1);
  writeJSON(FLAVORS_FILE, flavors);
  res.status(204).end();
});

// ==== Stop-words (для BW3) ====
app.get("/api/stop-words", (req, res) => {
  const data = readJSON(STOP_WORDS_FILE, { words: [] });
  const words = Array.isArray(data.words) ? data.words : [];
  res.json({ words });
});

app.post("/api/stop-words", (req, res) => {
  if (!isAdminReq(req)) {
    return res.status(403).json({ error: "Forbidden (bad admin token)" });
  }
  const body = req.body || {};
  const words = Array.isArray(body.words)
    ? body.words.map(s => String(s||'').trim()).filter(Boolean)
    : [];
  writeJSON(STOP_WORDS_FILE, { words });
  res.json({ ok: true, words });
});

// ==== Mixes ====
function ensureLikeAliases(mix) {
  if (!mix) return mix;
  if (!Array.isArray(mix.likedBy)) {
    mix.likedBy = Array.isArray(mix.likers) ? mix.likers.slice() : [];
  }
  mix.likesCount = Array.isArray(mix.likedBy) ? mix.likedBy.length : 0;
  return mix;
}

app.get("/api/mixes", (req, res) => {
  const mixes = readJSON(MIXES_FILE, []).map(ensureLikeAliases);
  mixes.sort((a, b) => (b && b.createdAt || 0) - (a && a.createdAt || 0));
  res.json(mixes);
});

app.post("/api/mixes", (req, res) => {
  const body = req.body || {};
  const mixes = readJSON(MIXES_FILE, []);
  const id = String(Date.now()) + Math.random().toString(16).slice(2);
  const mix = ensureLikeAliases({
    id,
    title: String(body.title || "Без названия").slice(0, 120),
    parts: Array.isArray(body.parts) ? body.parts : [],
    notes: String(body.notes || ""),
    author: String(body.author || ""),
    authorId: body.authorId == null ? null : String(body.authorId),
    createdAt: Date.now(),
    taste: body.taste ?? null,
    strength10: body.strength10 ?? null,
    likedBy: Array.isArray(body.likedBy) ? body.likedBy : (Array.isArray(body.likers) ? body.likers : [])
  });
  mixes.push(mix);
  writeJSON(MIXES_FILE, mixes);
  res.json(mix);
});

app.delete("/api/mixes/:id", (req, res) => {
  const id = String(req.params.id);
  const userId = req.header("X-User-Id") || null;
  const mixes = readJSON(MIXES_FILE, []);
  const idx = mixes.findIndex(m => m.id === id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });

  const mix = mixes[idx];
  if (mix.authorId && userId && String(mix.authorId) === String(userId)) {
    mixes.splice(idx, 1);
    writeJSON(MIXES_FILE, mixes);
    return res.json({ ok: true });
  }
  if (!mix.authorId && userId === "admin") {
    mixes.splice(idx, 1);
    writeJSON(MIXES_FILE, mixes);
    return res.json({ ok: true, note: "deleted legacy mix by admin" });
  }
  return res.status(403).json({ error: "Forbidden" });
});

// Лайки — тумблер (POST)
app.post("/api/mixes/:id/like", (req, res) => {
  const id = String(req.params.id);
  const userId = String(req.header("X-User-Id") || "anon");
  const mixes = readJSON(MIXES_FILE, []);
  const i = mixes.findIndex(m => m && m.id === id);
  if (i === -1) return res.status(404).json({ error: "Not found" });
  const mix = ensureLikeAliases(mixes[i]);

  const idx = mix.likedBy.indexOf(userId);
  let liked;
  if (idx >= 0) { mix.likedBy.splice(idx, 1); liked = false; }
  else { mix.likedBy.push(userId); liked = true; }

  mix.likesCount = mix.likedBy.length;
  mixes[i] = mix;
  writeJSON(MIXES_FILE, mixes);
  res.json({ ok: true, likes: mix.likesCount, liked });
});

// Явное снятие лайка (DELETE) — чтобы совпадало с фронтом
app.delete("/api/mixes/:id/like", (req, res) => {
  const id = String(req.params.id);
  const userId = String(req.header("X-User-Id") || "anon");
  const mixes = readJSON(MIXES_FILE, []);
  const i = mixes.findIndex(m => m && m.id === id);
  if (i === -1) return res.status(404).json({ error: "Not found" });
  const mix = ensureLikeAliases(mixes[i]);

  const idx = mix.likedBy.indexOf(userId);
  if (idx >= 0) mix.likedBy.splice(idx, 1);
  mix.likesCount = mix.likedBy.length;
  mixes[i] = mix;
  writeJSON(MIXES_FILE, mixes);
  res.json({ ok: true, likes: mix.likesCount, liked: false });
});

app.listen(PORT, () => {
  console.log(`✅ Server started on http://localhost:${PORT}`);
});
