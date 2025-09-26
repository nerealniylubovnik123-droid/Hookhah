// server.js — Hookah backend
const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

// ===== app/bootstrap =====
const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors()); // разрешаем CORS (в т.ч. для фронта на другом домене)
app.use(express.json({ limit: "1mb" }));

// ===== статика (если фронт деплоится рядом) =====
const PUBLIC_DIR = path.join(__dirname, "public");
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
}

// ===== файлы данных =====
const FLAVORS_FILE = path.join(__dirname, "flavors.json");
const MIXES_FILE   = path.join(__dirname, "guest_mixes.json");

function readJSON(file, fallback = []) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

// создаём пустые файлы, если их нет
if (!fs.existsSync(FLAVORS_FILE)) writeJSON(FLAVORS_FILE, []);
if (!fs.existsSync(MIXES_FILE))   writeJSON(MIXES_FILE, []);

// ===== утилиты =====
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || null;
function requireAdmin(req, res) {
  // Если ADMIN_TOKEN не задан — проверку отключаем
  if (!ADMIN_TOKEN) return true;
  const token = req.header("X-Admin-Token");
  if (token && token === ADMIN_TOKEN) return true;
  res.status(403).json({ error: "Forbidden (bad admin token)" });
  return false;
}
function makeId(brand, name) {
  return (String(brand) + "-" + String(name))
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-._]+/g, ""); // чуть-чуть нормализуем
}

// ===== health =====
app.get("/healthz", (req, res) => {
  res.json({ ok: true, time: Date.now(), uptime: process.uptime() });
});

// ===== flavors =====
app.get("/api/flavors", (req, res) => {
  res.json(readJSON(FLAVORS_FILE, []));
});

app.post("/api/flavors", (req, res) => {
  // поддерживаем два сценария:
  // 1) создание вкуса { brand, name, ... }
  // 2) удаление вкуса { action:'delete', brand, name }
  const body = req.body || {};

  // обе операции — только для админа (если ADMIN_TOKEN задан)
  if (!requireAdmin(req, res)) return;

  // Удаление
  if (String(body.action || "").toLowerCase() === "delete") {
    const brand = String(body.brand || "").trim();
    const name  = String(body.name  || "").trim();
    if (!brand || !name) {
      return res.status(400).json({ error: "brand and name are required for delete" });
    }
    const id = makeId(brand, name);

    const flavors = readJSON(FLAVORS_FILE, []);
    const next = flavors.filter(f => String(f.id || makeId(f.brand, f.name)) !== id);
    if (next.length === flavors.length) {
      return res.status(404).json({ error: "Flavor not found" });
    }
    writeJSON(FLAVORS_FILE, next);
    return res.json({ ok: true, deletedId: id });
  }

  // Создание
  const brand = String(body.brand || "").trim();
  const name  = String(body.name  || "").trim();
  if (!brand || !name) {
    return res.status(400).json({ error: "brand and name are required" });
  }

  const flavors = readJSON(FLAVORS_FILE, []);
  const id = String(body.id || makeId(brand, name));
  if (flavors.some(f => String(f.id || makeId(f.brand, f.name)) === id)) {
    return res.status(409).json({ error: "id already exists" });
  }

  const record = {
    id,
    brand,
    name,
    description: body.description ? String(body.description) : undefined,
    tags: Array.isArray(body.tags)
      ? body.tags.map(s => String(s)).filter(Boolean)
      : (body.tags ? String(body.tags).split(",").map(s => s.trim()).filter(Boolean) : undefined),
    strength10: (Number.isFinite(body.strength10) ? Number(body.strength10)
               : Number.isFinite(body.strength)   ? Number(body.strength) : undefined)
  };

  flavors.push(record);
  writeJSON(FLAVORS_FILE, flavors);
  res.json({ ok: true, flavor: record });
});

// ===== mixes =====
app.get("/api/mixes", (req, res) => {
  const mixes = readJSON(MIXES_FILE, []);
  mixes.sort((a, b) => (b?.createdAt || 0) - (a?.createdAt || 0));
  res.json(mixes);
});

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

// удаление микса — автор может удалять свой
app.delete("/api/mixes/:id", (req, res) => {
  const id = String(req.params.id);
  const userId = req.header("X-User-Id") || null;

  const mixes = readJSON(MIXES_FILE, []);
  const idx = mixes.findIndex(m => String(m.id) === id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });

  const mix = mixes[idx];
  if (mix.authorId && userId && String(mix.authorId) === String(userId)) {
    mixes.splice(idx, 1);
    writeJSON(MIXES_FILE, mixes);
    return res.json({ ok: true });
  }
  // старые записи без authorId — разрешим удалить «админу» по X-User-Id: admin (как в исходном коде)
  if (!mix.authorId && userId === "admin") {
    mixes.splice(idx, 1);
    writeJSON(MIXES_FILE, mixes);
    return res.json({ ok: true, note: "deleted legacy mix by admin" });
  }
  return res.status(403).json({ error: "Forbidden" });
});

// ===== SPA fallback =====
if (fs.existsSync(PUBLIC_DIR)) {
  app.get("*", (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`✅ Server started on http://localhost:${PORT}`);
});
