// server.js — Hookah backend (fixes: admin token fallback, banned-words API, like DELETE)
const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ==== Static (optional) ====
const PUBLIC_DIR = path.join(__dirname, "public");
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
}

// ==== JSON files ====
const FLAVORS_FILE = path.join(__dirname, "flavors.json");
const MIXES_FILE   = path.join(__dirname, "guest_mixes.json");
const BANNED_FILE  = path.join(__dirname, "banned_words.json");

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

// create files if missing
if (!fs.existsSync(FLAVORS_FILE)) writeJSON(FLAVORS_FILE, []);
if (!fs.existsSync(MIXES_FILE))   writeJSON(MIXES_FILE,   []);
if (!fs.existsSync(BANNED_FILE))  writeJSON(BANNED_FILE,  { words: [] });

// ---- Admin auth helper ----
// Если ADMIN_TOKEN задан — требуется точное совпадение.
// Если НЕ задан — подходит любой непустой токен длиной ≥ 6.
// Плюс пропускаем пользователя 'Tutenhaman' по заголовку/параметру имени.
function isAdminReq(req) {
  try {
    const token = String(req.header("X-Admin-Token") || "").trim();
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

    const envToken = String(process.env.ADMIN_TOKEN || "").trim();
    const allowByToken = envToken
      ? token === envToken
      : (token && token.length >= 6);

    return allowByUser || allowByToken;
  } catch {
    return false;
  }
}

// ---- helpers for banned words ----
function sanitizeWords(list) {
  const out = [];
  const seen = new Set();
  (Array.isArray(list) ? list : []).forEach(w => {
    const s = String(w || "").trim();
    if (!s) return;
    const key = s.toLowerCase().replace(/ё/g, "е");
    if (!seen.has(key)) { seen.add(key); out.push(s); }
  });
  return out;
}
function hasBanned(mix) {
  try {
    const { title = "", notes = "", parts = [] } = mix || {};
    const words = sanitizeWords(readJSON(BANNED_FILE, { words: [] }).words);
    if (!words.length) return null;

    const flavors = readJSON(FLAVORS_FILE, []);
    const haystack = [
      String(title),
      String(notes),
      ...(Array.isArray(parts) ? parts.map(p => {
        const fl = flavors.find(f => String(f.id) === String(p && p.flavorId));
        return [fl && fl.brand, fl && fl.name].filter(Boolean).join(" ");
      }) : [])
    ].join("\n").toLowerCase().replace(/ё/g, "е");

    const hit = words.find(w => haystack.includes(String(w || "").toLowerCase().replace(/ё/g, "е")));
    return hit || null;
  } catch {
    return null;
  }
}

// ==== Health ====
app.get("/healthz", (_, res) => {
  res.json({ ok: true, time: Date.now(), uptime: process.uptime() });
});

// ==== Flavors ====
app.get("/api/flavors", (_, res) => {
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
  if (flavors.some(f => String(f.id) === String(flavor.id))) {
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

// ==== Banned words ====
app.get("/api/banned-words", (_, res) => {
  const data = readJSON(BANNED_FILE, { words: [] });
  const words = sanitizeWords(data.words);
  if (JSON.stringify(data.words) !== JSON.stringify(words)) {
    writeJSON(BANNED_FILE, { words });
  }
  res.json({ words });
});

app.put("/api/banned-words", (req, res) => {
  if (!isAdminReq(req)) {
    return res.status(403).json({ error: "Forbidden (bad admin token)" });
  }
  const words = sanitizeWords((req.body && req.body.words) || []);
  writeJSON(BANNED_FILE, { words });
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

app.get("/api/mixes", (_, res) => {
  const mixes = readJSON(MIXES_FILE, []).map(ensureLikeAliases);
  mixes.sort((a, b) => (b?.createdAt || 0) - (a?.createdAt || 0));
  res.json(mixes);
});

app.post("/api/mixes", (req, res) => {
  const body = req.body || {};

  // server-side banned words check
  const bannedHit = hasBanned(body);
  if (bannedHit) return res.status(400).json({ error: "banned_word", word: bannedHit });

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

// delete mix — only author (X-User-Id = authorId). Legacy: no authorId -> allow admin (X-User-Id: admin)
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

// likes — toggle via POST; explicit unlike via DELETE for frontend compatibility
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
