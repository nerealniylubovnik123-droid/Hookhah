// server.js — минимальные правки, аккуратно
// - Admin delete mix: POST /api/mixes { action:'delete', id } + X-Admin-Token
// - Остальная логика сохранена

const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 8080;

// ==== middleware
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ==== static (если у вас лежит фронт рядом)
const PUBLIC_DIR = path.join(__dirname, "public");
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
}

// ==== файлы данных
const FLAVORS_FILE = path.join(__dirname, "flavors.json");
const MIXES_FILE   = path.join(__dirname, "guest_mixes.json");

// вспомогательные функции
function readJSON(file, fallback = []) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}
if (!fs.existsSync(FLAVORS_FILE)) writeJSON(FLAVORS_FILE, []);
if (!fs.existsSync(MIXES_FILE))   writeJSON(MIXES_FILE, []);

const ADMIN_TOKEN = "MySuperSecretToken_2025"; // ваш токен
function isAdminReq(req) {
  return (req.header("X-Admin-Token") || "") === ADMIN_TOKEN;
}
function getUserId(req) {
  const h = req.header("X-User-Id") || req.header("X-Author-Id");
  const q = req.query ? (req.query.userId || req.query.authorId) : null;
  const b = req.body  ? (req.body.userId  || req.body.authorId)  : null;
  const v = (h || q || b || "").toString().trim();
  return v || null;
}
function makeFlavorId(brand, name) {
  return (String(brand) + "-" + String(name))
    .toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9\-._]+/g, "");
}

// health
app.get("/healthz", (_req, res) => {
  res.json({ ok: true, time: Date.now(), uptime: process.uptime() });
});

// ===================== FLAVORS =====================

// список вкусов
app.get("/api/flavors", (_req, res) => {
  res.json(readJSON(FLAVORS_FILE, []));
});

// создание вкуса ИЛИ удаление через action:'delete' (как у вас работало)
app.post("/api/flavors", (req, res) => {
  const body = req.body || {};
  const action = String(body.action || "").toLowerCase();

  // удалить вкус: POST { action:'delete', brand, name } + X-Admin-Token
  if (action === "delete") {
    if (!isAdminReq(req)) return res.status(403).json({ error: "Forbidden (bad admin token)" });
    const brand = String(body.brand || "").trim();
    const name  = String(body.name  || "").trim();
    if (!brand || !name) return res.status(400).json({ error: "brand and name are required" });

    const id = makeFlavorId(brand, name);
    const all = readJSON(FLAVORS_FILE, []);
    const next = all.filter(f => String(f.id || makeFlavorId(f.brand, f.name)) !== id);
    if (next.length === all.length) return res.status(404).json({ error: "Flavor not found" });
    writeJSON(FLAVORS_FILE, next);
    return res.json({ ok: true, deletedId: id });
  }

  // создать вкус
  if (!isAdminReq(req)) return res.status(403).json({ error: "Forbidden (bad admin token)" });

  const brand = String(body.brand || "").trim();
  const name  = String(body.name  || "").trim();
  if (!brand || !name) return res.status(400).json({ error: "brand and name are required" });

  const all = readJSON(FLAVORS_FILE, []);
  const id = String(body.id || makeFlavorId(brand, name));
  if (all.some(f => String(f.id || makeFlavorId(f.brand, f.name)) === id)) {
    return res.status(409).json({ error: "id already exists" });
  }

  const record = {
    id,
    brand,
    name,
    description: body.description ? String(body.description) : undefined,
    tags: Array.isArray(body.tags)
      ? body.tags.map(String).filter(Boolean)
      : (body.tags ? String(body.tags).split(",").map(s => s.trim()).filter(Boolean) : undefined),
    strength10: (Number.isFinite(body.strength10) ? Number(body.strength10)
               : Number.isFinite(body.strength)   ? Number(body.strength)   : undefined)
  };

  all.push(record);
  writeJSON(FLAVORS_FILE, all);
  res.json({ ok: true, flavor: record });
});

// ===================== MIXES =====================

// НОВОЕ: админ-удаление микса тем же способом, что и вкусы.
// POST /api/mixes  { action:'delete', id }  + X-Admin-Token
app.post("/api/mixes", (req, res, next) => {
  const body = req.body || {};
  const action = String(body.action || "").toLowerCase();

  if (action !== "delete") return next(); // не удаление — пусть обработает следующий хендлер (создание)

  if (!isAdminReq(req)) return res.status(403).json({ error: "Forbidden (bad admin token)" });
  const id = String(body.id || "").trim();
  if (!id) return res.status(400).json({ error: "id is required" });

  const mixes = readJSON(MIXES_FILE, []);
  const idx = mixes.findIndex(m => String(m.id) === id);
  if (idx === -1) return res.status(404).json({ error: "Mix not found" });

  mixes.splice(idx, 1);
  writeJSON(MIXES_FILE, mixes);
  return res.json({ ok: true, deletedId: id, deletedBy: "admin" });
});

// список миксов
app.get("/api/mixes", (_req, res) => {
  const mixes = readJSON(MIXES_FILE, []);
  mixes.sort((a, b) => (b?.createdAt || 0) - (a?.createdAt || 0));
  res.json(mixes);
});

// создать микс (гость)
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

// удалить микс автором (и допускаем удаление админом и тут — это безопасно)
app.delete("/api/mixes/:id", (req, res) => {
  const id = String(req.params.id || "");
  const mixes = readJSON(MIXES_FILE, []);
  const idx = mixes.findIndex(m => String(m.id) === id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });

  // если пришёл админ-токен — разрешаем без проверки автора
  if (isAdminReq(req)) {
    mixes.splice(idx, 1);
    writeJSON(MIXES_FILE, mixes);
    return res.json({ ok: true, deletedBy: "admin" });
  }

  const mix = mixes[idx];
  const uid = getUserId(req);

  // автор может удалить свой
  if (mix.authorId && uid && String(mix.authorId) === String(uid)) {
    mixes.splice(idx, 1);
    writeJSON(MIXES_FILE, mixes);
    return res.json({ ok: true, deletedBy: "author" });
  }

  // обратная совместимость: старые записи без authorId — допускаем userId=admin
  if (!mix.authorId && uid === "admin") {
    mixes.splice(idx, 1);
    writeJSON(MIXES_FILE, mixes);
    return res.json({ ok: true, deletedBy: "admin-legacy" });
  }

  return res.status(403).json({ error: "Forbidden" });
});

// ==== SPA fallback (опционально)
if (fs.existsSync(PUBLIC_DIR)) {
  app.get("*", (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`✅ Server started on http://localhost:${PORT}`);
});
