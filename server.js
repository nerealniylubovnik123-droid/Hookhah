// server.js — Hookah backend (Express)
// Fixed initialization + endpoints aligned with frontend expectations.
// Node >= 18 recommended.

"use strict";

const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 8080;

// ---- Middleware
app.use(cors()); // широкие CORS для простоты разработки
app.use(express.json({ limit: "1mb" }));

// ---- Files & helpers
const DATA_DIR = path.join(__dirname, "data");
const FLAVORS_FILE = path.join(DATA_DIR, "flavors.json");
const MIXES_FILE = path.join(DATA_DIR, "guest_mixes.json");
const BANNED_FILE = path.join(DATA_DIR, "banned_words.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

const readJSON = (file, def) => {
  try {
    if (!fs.existsSync(file)) return def;
    const raw = fs.readFileSync(file, "utf8");
    return raw ? JSON.parse(raw) : def;
  } catch (e) {
    console.error("readJSON error:", file, e);
    return def;
  }
};
const writeJSON = (file, data) => {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    console.error("writeJSON error:", file, e);
  }
};

const normalize = (s) => String(s || "").trim();
const keyify = (s) =>
  normalize(s)
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-zа-я0-9\-]/gi, "");

const ensureArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);

// ---- Health
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ---- Flavors
app.get("/api/flavors", (_req, res) => {
  const list = readJSON(FLAVORS_FILE, []);
  res.json(list);
});

// Add/Upsert flavor (admin token optional, keep simple policy)
app.post("/api/flavors", (req, res) => {
  const admin = req.headers["x-admin-token"];
  // Если нужен прям строгий режим — раскомментировать:
    if (admin !== process.env.ADMIN_TOKEN) return res.status(403).json({ error: "Forbidden" });
  const body = req.body || {};
  const brand = normalize(body.brand);
  const name = normalize(body.name);
  if (!brand || !name) return res.status(400).json({ error: "brand and name are required" });

  const id = body.id ? String(body.id) : `${keyify(brand)}-${keyify(name)}`;
  const flavors = readJSON(FLAVORS_FILE, []);
  const idx = flavors.findIndex((f) => String(f.id) === id);

  const flavor = {
    id,
    brand,
    name,
    type: body.type || body.category || "",
    strength10: Number(body.strength10 || body.strength || 0) || 0,
    tags: ensureArray(body.tags),
    ...body, // сохранить совместимость с фронтом (доп.поля)
  };

  if (idx >= 0) {
    flavors[idx] = { ...flavors[idx], ...flavor };
  } else {
    flavors.push(flavor);
  }
  writeJSON(FLAVORS_FILE, flavors);
  res.json({ ok: true, id, flavor });
});

// Delete flavor
app.delete("/api/flavors/:id", (req, res) => {
  const id = String(req.params.id || "");
  if (!id) return res.status(400).json({ error: "id required" });
  const flavors = readJSON(FLAVORS_FILE, []);
  const idx = flavors.findIndex((f) => String(f.id) === id);
  if (idx < 0) return res.status(404).json({ error: "not found" });
  flavors.splice(idx, 1);
  writeJSON(FLAVORS_FILE, flavors);
  res.json({ ok: true });
});

// ---- Mixes (guest recipes)
app.get("/api/mixes", (_req, res) => {
  const mixes = readJSON(MIXES_FILE, []);
  res.json(mixes);
});

app.post("/api/mixes", (req, res) => {
  const body = req.body || {};
  // Минимальная валидация
  const title = normalize(body.title || body.name || "");
  const components = Array.isArray(body.components) ? body.components : [];
  if (!title) return res.status(400).json({ error: "title required" });
  if (!components.length) return res.status(400).json({ error: "components required" });

  const now = Date.now();
  const id = body.id ? String(body.id) : `mix-${now}`;

  const mixes = readJSON(MIXES_FILE, []);
  const idx = mixes.findIndex((m) => String(m.id) === id);

  const userId = String(req.headers["x-user-id"] || body.userId || "anon");
  const author = normalize(body.author || body.user || "");

  const mix = {
    id,
    title,
    components,
    note: normalize(body.note || ""),
    createdAt: Number(body.createdAt || now),
    updatedAt: Number(body.updatedAt || now),
    authorId: userId,
    author,
    likedBy: ensureArray(body.likedBy).map(String),
  };
  mix.likesCount = Array.isArray(mix.likedBy) ? mix.likedBy.length : 0;

  if (idx >= 0) {
    mixes[idx] = { ...mixes[idx], ...mix, updatedAt: now };
  } else {
    mixes.push(mix);
  }
  writeJSON(MIXES_FILE, mixes);
  res.json({ ok: true, id, mix });
});

// Delete mix (author or admin)
app.delete("/api/mixes/:id", (req, res) => {
  const id = String(req.params.id || "");
  if (!id) return res.status(400).json({ error: "id required" });

  const userId = String(req.headers["x-user-id"] || "anon");
  const mixes = readJSON(MIXES_FILE, []);
  const idx = mixes.findIndex((m) => String(m.id) === id);
  if (idx < 0) return res.status(404).json({ error: "not found" });

  const mix = mixes[idx];
  const isAuthor = mix.authorId && String(mix.authorId) === userId;
  const isAdmin = userId === "admin" || userId === process.env.ADMIN_USER;

  if (isAuthor || isAdmin) {
    mixes.splice(idx, 1);
    writeJSON(MIXES_FILE, mixes);
    return res.json({ ok: true });
  }
  // Совместимость: удалить «старые» записи без authorId может админ
  if (!mix.authorId && isAdmin) {
    mixes.splice(idx, 1);
    writeJSON(MIXES_FILE, mixes);
    return res.json({ ok: true, note: "deleted legacy mix by admin" });
  }
  return res.status(403).json({ error: "Forbidden" });
});

// Like toggle (POST) — совместимый режим
app.post("/api/mixes/:id/like", (req, res) => {
  const id = String(req.params.id || "");
  const userId = String(req.headers["x-user-id"] || "anon");
  if (!id) return res.status(400).json({ error: "id required" });

  const mixes = readJSON(MIXES_FILE, []);
  const i = mixes.findIndex((m) => String(m.id) === id);
  if (i < 0) return res.status(404).json({ error: "not found" });

  const mix = mixes[i];
  mix.likedBy = Array.isArray(mix.likedBy) ? mix.likedBy.map(String) : [];
  const idx = mix.likedBy.indexOf(userId);
  let liked = false;
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

// Unlike (DELETE) — для фронтов, ожидающих отдельный метод
app.delete("/api/mixes/:id/like", (req, res) => {
  const id = String(req.params.id || "");
  const userId = String(req.headers["x-user-id"] || "anon");
  if (!id) return res.status(400).json({ error: "id required" });

  const mixes = readJSON(MIXES_FILE, []);
  const i = mixes.findIndex((m) => String(m.id) === id);
  if (i < 0) return res.status(404).json({ error: "not found" });

  const mix = mixes[i];
  mix.likedBy = Array.isArray(mix.likedBy) ? mix.likedBy.map(String) : [];
  const before = mix.likedBy.length;
  mix.likedBy = mix.likedBy.filter((u) => u !== userId);
  mix.likesCount = mix.likedBy.length;
  mixes[i] = mix;
  writeJSON(MIXES_FILE, mixes);
  res.json({ ok: true, likes: mix.likesCount, liked: mix.likesCount > before });
});

// ---- Recommendations (simple heuristic: top by likes, tie -> newest)
app.get("/api/mixes/recommend", (req, res) => {
  const limit = Math.max(1, Math.min(50, Number(req.query.limit || 10)));
  const mixes = readJSON(MIXES_FILE, []);
  const banned = readJSON(BANNED_FILE, []).map((w) => String(w).toLowerCase().trim()).filter(Boolean);

  const containsBanned = (mix) => {
    const text = [
      mix.title,
      ...(Array.isArray(mix.components) ? mix.components.map((c) => c.name || c.id || "") : []),
      mix.note || "",
    ].join(" ").toLowerCase();
    return banned.some((w) => w && text.includes(w));
  };

  const filtered = mixes.filter((m) => !containsBanned(m));
  filtered.sort((a, b) => {
    const la = Number(a.likesCount || 0);
    const lb = Number(b.likesCount || 0);
    if (lb !== la) return lb - la;
    const ta = Number(a.updatedAt || a.createdAt || 0);
    const tb = Number(b.updatedAt || b.createdAt || 0);
    return tb - ta;
  });

  res.json(filtered.slice(0, limit));
});

// ---- Banned words (BW3) — minimal API expected by UI
app.get("/api/banned-words", (_req, res) => {
  const words = readJSON(BANNED_FILE, []);
  res.json(words);
});

app.post("/api/banned-words", (req, res) => {
  const admin = req.headers["x-admin-token"];
    if (admin !== process.env.ADMIN_TOKEN) return res.status(403).json({ error: "Forbidden" });
  const body = req.body || {};
  const words = readJSON(BANNED_FILE, []);
  const toAdd = ensureArray(body.word || body.words).map((w) => String(w).trim()).filter(Boolean);
  if (!toAdd.length) return res.status(400).json({ error: "word(s) required" });
  const set = new Set(words.map((w) => String(w).toLowerCase()));
  for (const w of toAdd) set.add(w.toLowerCase());
  const out = Array.from(set);
  writeJSON(BANNED_FILE, out);
  res.json({ ok: true, count: out.length, words: out });
});

// ---- Legacy compatibility (optional endpoints some addons may call)
app.get("/api/guest-mixes", (_req, res) => {
  const mixes = readJSON(MIXES_FILE, []);
  res.json(mixes);
});
app.post("/api/delete-guest-mix", (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: "id required" });
  const userId = String(req.headers["x-user-id"] || "anon");
  const mixes = readJSON(MIXES_FILE, []);
  const idx = mixes.findIndex((m) => String(m.id) === String(id));
  if (idx < 0) return res.status(404).json({ error: "not found" });
  const mix = mixes[idx];
  const isAuthor = mix.authorId && String(mix.authorId) === userId;
  const isAdmin = userId === "admin" || userId === process.env.ADMIN_USER;
  if (!(isAuthor || isAdmin)) return res.status(403).json({ error: "Forbidden" });
  mixes.splice(idx, 1);
  writeJSON(MIXES_FILE, mixes);
  res.json({ ok: true });
});

// ---- Static (optional): serve built frontend from /public if exists
const PUBLIC_DIR = path.join(__dirname, "public");
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
  // SPA fallback
  app.get("*", (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
  });
}

// ---- Start
app.listen(PORT, () => {
  console.log(`✅ Server started on http://localhost:${PORT}`);
});
