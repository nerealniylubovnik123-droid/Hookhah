// server.js — Hookhah backend (Render/Node)
const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors()); // разрешаем CORS
app.use(express.json({ limit: "1mb" }));

// ====== STATIC (если хотите отдавать index.html с Render) ======
const PUBLIC_DIR = path.join(__dirname, "public");
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
}

// ====== FILES =================================================
const FLAVORS_FILE = path.join(__dirname, "flavors.json");
const MIXES_FILE   = path.join(__dirname, "guest_mixes.json");

function readJSON(file, fallback = []) {
  try {
    const txt = fs.readFileSync(file, "utf8");
    return JSON.parse(txt);
  } catch {
    return fallback;
  }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

// Инициализируем файлы, если их нет
if (!fs.existsSync(FLAVORS_FILE)) writeJSON(FLAVORS_FILE, []);
if (!fs.existsSync(MIXES_FILE))   writeJSON(MIXES_FILE, []);

// ====== HEALTH =================================================
app.get("/healthz", (req, res) => {
  res.json({ ok: true, time: Date.now(), uptime: process.uptime() });
});

// ====== FLAVORS ================================================
// Получить все вкусы
app.get("/api/flavors", (req, res) => {
  res.json(readJSON(FLAVORS_FILE, []));
});

// Добавить вкус — нужен X-Admin-Token === process.env.ADMIN_TOKEN
app.post("/api/flavors", (req, res) => {
  const token = req.header("X-Admin-Token");
  if (!token || token !== (process.env.ADMIN_TOKEN || "")) {
    return res.status(403).json({ error: "Forbidden (bad admin token)" });
  }
  const flavor = req.body || {};
  if (!flavor.brand || !flavor.name) {
    return res.status(400).json({ error: "brand and name are required" });
  }
  const flavors = readJSON(FLAVORS_FILE, []);
  if (!flavor.id) {
    flavor.id = (String(flavor.brand) + "-" + String(flavor.name))
      .toLowerCase().replace(/\s+/g, "-");
  }
  if (flavors.some(f => f.id === flavor.id)) {
    return res.status(409).json({ error: "id already exists" });
  }
  flavors.push(flavor);
  writeJSON(FLAVORS_FILE, flavors);
  res.json({ ok: true, flavor });
});

// ====== MIXES ==================================================
// Получить миксы
app.get("/api/mixes", (req, res) => {
  const mixes = readJSON(MIXES_FILE, []);
  mixes.sort((a,b) => (b?.createdAt||0) - (a?.createdAt||0));
  res.json(mixes);
});

// Добавить микс
app.post("/api/mixes", (req, res) => {
  const body = req.body || {};
  const mixes = readJSON(MIXES_FILE, []);
  const id = String(Date.now()) + Math.random().toString(16).slice(2);
  const mix = {
    id,
    title: String(body.title || "Без названия").slice(0, 120),
    parts: Array.isArray(body.parts) ? body.parts : [],
    notes: String(body.notes || ""),
    author: String(body.author || ""),
    authorId: body.authorId == null ? null : String(body.authorId),
    createdAt: Date.now(),
    taste: body.taste ?? null,
    strength10: body.strength10 ?? null
  };
  mixes.push(mix);
  writeJSON(MIXES_FILE, mixes);
  res.json(mix);
});

// Удалить микс — если X-User-Id совпадает с authorId
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
  // Легаси: записи без authorId может удалить админ (если пришёл X-User-Id: admin)
  if (!mix.authorId && userId === "admin") {
    mixes.splice(idx, 1);
    writeJSON(MIXES_FILE, mixes);
    return res.json({ ok: true, note: "deleted legacy mix by admin" });
  }
  return res.status(403).json({ error: "Forbidden" });
});

// ====== SPA fallback (если фронт лежит тоже на Render) =========
if (fs.existsSync(PUBLIC_DIR)) {
  app.get("*", (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`✅ Server started on http://localhost:${PORT}`);
});
