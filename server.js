// server.js — Hookah backend (Node/Express)
const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();                           // ✅ правильная инициализация
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ====== файлы данных ======
const DATA_DIR = __dirname;
const FLAVORS_FILE = path.join(DATA_DIR, "flavors.json");
const MIXES_FILE   = path.join(DATA_DIR, "guest_mixes.json");

// ====== статика (опционально, если есть public/) ======
const PUBLIC_DIR = path.join(__dirname, "public");
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
}

// ====== helpers ======
function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.error("[readJSON]", file, e.message);
    return fallback;
  }
}
function writeJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    console.error("[writeJSON]", file, e.message);
  }
}

// создаём пустые файлы при первом запуске
if (!fs.existsSync(FLAVORS_FILE)) writeJSON(FLAVORS_FILE, []);
if (!fs.existsSync(MIXES_FILE))   writeJSON(MIXES_FILE,   []);

// ====== health ======
app.get("/healthz", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// ================= FLAVORS =================

// список вкусов
app.get("/api/flavors", (_req, res) => {
  res.json(readJSON(FLAVORS_FILE, []));
});

// добавление вкуса (как было; удаление вкусов админом НЕ меняли)
app.post("/api/flavors", (req, res) => {
  const adminHeader = req.header("X-Admin-Token");
  const isAdmin = adminHeader && adminHeader === (process.env.ADMIN_TOKEN || "");
  if (!isAdmin) return res.status(403).json({ error: "Forbidden (admin token)" });

  const body = req.body || {};
  if (!body.brand || !body.name) {
    return res.status(400).json({ error: "brand and name are required" });
  }

  const list = readJSON(FLAVORS_FILE, []);
  let id =
    String(body.id || "").trim().toLowerCase() ||
    (body.brand + "-" + body.name)
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9\-]+/g, "");

  if (list.some(f => String(f.id || "") === id)) {
    return res.status(409).json({ error: "id already exists" });
  }

  const item = {
    id,
    brand: String(body.brand || "").trim(),
    name: String(body.name || "").trim(),
    description: String(body.description || ""),
    tags: body.tags || [],
    strength10: Number(body.strength10 || 0),
  };

  list.push(item);
  writeJSON(FLAVORS_FILE, list);
  res.json(item);
});

// ================= MIXES =================

// список миксов (новые сверху)
app.get("/api/mixes", (_req, res) => {
  const list = readJSON(MIXES_FILE, []);
  const arr = Array.isArray(list) ? list.slice() : [];
  arr.sort((a, b) => String(b.createdAt || "") > String(a.createdAt || "") ? 1 : -1);
  res.json(arr);
});

// создание микса
app.post("/api/mixes", (req, res) => {
  const body = req.body || {};
  const list = readJSON(MIXES_FILE, []);

  const item = {
    id: "mix_" + Math.random().toString(36).slice(2, 10), // серверный id
    title: String(body.title || "Микс"),
    parts: Array.isArray(body.parts) ? body.parts : [],
    notes: String(body.notes || ""),
    author: String(body.author || "Гость"),
    authorId: String(body.authorId || ""),
    createdAt: new Date().toISOString(),
    taste: String(body.taste || ""),
    strength10: Number(body.strength10 || 0),
  };

  list.push(item);
  writeJSON(MIXES_FILE, list);
  res.json(item);
});

// удаление микса
app.delete("/api/mixes/:id", (req, res) => {
  const id = String(req.params.id);
  const userId = req.header("X-User-Id") || null;

  const mixes = readJSON(MIXES_FILE, []);
  const idx = mixes.findIndex(m => String(m.id) === id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });

  const mix = mixes[idx];

  // ✅ НОВОЕ: админ с валидным X-Admin-Token может удалить ЛЮБОЙ микс
  const adminHeader = req.header("X-Admin-Token");
  const isAdmin = adminHeader && adminHeader === (process.env.ADMIN_TOKEN || "");
  if (isAdmin) {
    mixes.splice(idx, 1);
    writeJSON(MIXES_FILE, mixes);
    return res.json({ ok: true, by: "admin" });
  }

  // как и раньше: автор может удалить свой
  if (mix.authorId && userId && String(mix.authorId) === String(userId)) {
    mixes.splice(idx, 1);
    writeJSON(MIXES_FILE, mixes);
    return res.json({ ok: true });
  }

  // legacy: если authorId отсутствует — разрешим удалить, если X-User-Id === "admin"
  if (!mix.authorId && userId === "admin") {
    mixes.splice(idx, 1);
    writeJSON(MIXES_FILE, mixes);
    return res.json({ ok: true, note: "deleted legacy mix by admin" });
  }

  return res.status(403).json({ error: "Forbidden" });
});

// ====== SPA fallback (фикс звёздочки для path-to-regexp) ======
if (fs.existsSync(PUBLIC_DIR)) {
  // Любой GET, кроме /api/* — отдаём index.html
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`✅ Server started on http://localhost:${PORT}`);
});
