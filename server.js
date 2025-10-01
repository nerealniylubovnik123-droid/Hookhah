// server.js — Hookah backend
// Node >= 16
const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ====== Static (optional) ======
const PUBLIC_DIR = path.join(__dirname, "public");
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
}

// ====== Data files ======
const FLAVORS_FILE     = path.join(__dirname, "flavors.json");
const MIXES_FILE       = path.join(__dirname, "guest_mixes.json");
const STOP_WORDS_FILE  = path.join(__dirname, "stop_words.json");

// create if missing
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}
function readJSON(file, fallback = []) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}
if (!fs.existsSync(FLAVORS_FILE))    writeJSON(FLAVORS_FILE, []);
if (!fs.existsSync(MIXES_FILE))      writeJSON(MIXES_FILE,   []);
if (!fs.existsSync(STOP_WORDS_FILE)) writeJSON(STOP_WORDS_FILE, { words: [] });

// ====== Admin auth helper ======
// Разрешаем:
// 1) точный токен, если ADMIN_TOKEN задан;
// 2) иначе — любой непустой токен длиной >= 6 (удобно в dev);
// 3) имя пользователя 'Tutenhaman' (через заголовки X-User-Name/X-Username).
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
    const normUser = rawName.trim().replace(/^@/, "").toLowerCase();
    const allowByUser = normUser === "tutenhaman";

    const envTok = String(process.env.ADMIN_TOKEN || "").trim();
    const allowByToken = envTok ? (token === envTok) : (token && token.length >= 6);

    return allowByUser || allowByToken;
  } catch {
    return false;
  }
}

// ====== Health ======
app.get("/healthz", (req, res) => {
  res.json({ ok: true, time: Date.now(), uptime: process.uptime() });
});

// ====== Stop-words helpers ======
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
function readStopWords() {
  try {
    const data = readJSON(STOP_WORDS_FILE, { words: [] });
    return sanitizeWords(data.words);
  } catch {
    return [];
  }
}
function hasBannedInMix(mix) {
  try {
    const { title = "", notes = "", parts = [] } = mix || {};
    const words = readStopWords();
    if (!words.length) return null;

    const flavors = readJSON(FLAVORS_FILE, []);
    // Проверяем: название, описание, и строки по бренду/названию вкусов из состава.
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

// ====== Flavors ======
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

// ====== Stop-words API (для Админ вкладки) ======
app.get("/api/stop-words", (req, res) => {
  res.json({ words: readStopWords() });
});

app.post("/api/stop-words", (req, res) => {
  if (!isAdminReq(req)) {
    return res.status(403).json({ error: "Forbidden (bad admin token)" });
  }
  const body = req.body || {};
  const words = sanitizeWords(Array.isArray(body.words) ? body.words : []);
  writeJSON(STOP_WORDS_FILE, { words });

  // Авто-удаление уже сохранённых миксов, которые теперь нарушают правило
  const mixes = readJSON(MIXES_FILE, []);
  const keep = [];
  let removed = 0;
  for (const m of mixes) {
    if (hasBannedInMix(m)) removed++;
    else keep.push(m);
  }
  if (removed > 0) writeJSON(MIXES_FILE, keep);

  res.json({ ok: true, words, removed });
});

// ====== Mixes ======
function ensureLikeAliases(mix) {
  if (!mix) return mix;
  if (!Array.isArray(mix.likedBy)) {
    mix.likedBy = Array.isArray(mix.likers) ? mix.likers.slice() : [];
  }
  if (!Array.isArray(mix.likers)) {
    mix.likers = Array.isArray(mix.likedBy) ? mix.likedBy.slice() : [];
  }
  mix.likesCount = Array.isArray(mix.likedBy) ? mix.likedBy.length : 0;
  return mix;
}

app.get("/api/mixes", (req, res) => {
  const mixes = readJSON(MIXES_FILE, []);
  // На всякий случай — фильтр запрещённых, если кто-то сохранился до обновления слов
  const safe = mixes.filter(m => !hasBannedInMix(m)).map(ensureLikeAliases);
  safe.sort((a, b) => (b && b.createdAt || 0) - (a && a.createdAt || 0));
  res.json(safe);
});

app.post("/api/mixes", (req, res) => {
  const body = req.body || {};

  // Серверная проверка запрещённых слов по: title + notes + (brand/name вкусов в parts)
  const bad = hasBannedInMix(body);
  if (bad) return res.status(400).json({ error: "banned_word", word: bad });

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
    likedBy: Array.isArray(body.likedBy) ? body.likedBy
           : (Array.isArray(body.likers) ? body.likers : [])
  });

  const all = readJSON(MIXES_FILE, []);
  all.push(mix);
  writeJSON(MIXES_FILE, all);
  res.json(mix);
});

// Удаление микса — только автор (X-User-Id === authorId),
// для старых записей без authorId — можно удалить, если X-User-Id: admin.
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
  if (idx >= 0) {
    mix.likedBy.splice(idx, 1);
    liked = false;
  } else {
    mix.likedBy.push(userId);
    liked = true;
  }

  mix.likesCount = mix.likedBy.length;
  mixes[i] = mix;
  writeJSON(MIXES_FILE, mixes);
  res.json({ ok: true, likes: mix.likesCount, liked });
});

// Явное снятие лайка (DELETE) — на случай если фронт использует DELETE
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
