// server.js — Hookhah backend (Render/Node)
const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors()); // разрешаем CORS со всех источников
app.use(express.json({ limit: "1mb" }));

// ==== статика (если захотите отдавать фронт с Render) ====
const PUBLIC_DIR = path.join(__dirname, "public");
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
}

// ==== файлы данных ====
const DATA_DIR = __dirname;
const FLAVORS_FILE = path.join(DATA_DIR, "flavors.json");
const MIXES_FILE = path.join(DATA_DIR, "guest_mixes.json");

function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (e) {
    console.error("readJSON error", file, e);
    return fallback;
  }
}
function writeJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) {
    console.error("writeJSON error", file, e);
  }
}

// ==== healthcheck ====
app.get("/healthz", (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// ==== FLAVORS ====
// GET /api/flavors — список
app.get("/api/flavors", (req, res) => {
  const list = readJSON(FLAVORS_FILE, []);
  res.json(Array.isArray(list) ? list : []);
});

// POST /api/flavors — добавление (и удаление при action:'delete'), только админ
app.post("/api/flavors", (req, res) => {
  const adminHeader = req.header("X-Admin-Token");
  const isAdmin = adminHeader && adminHeader === (process.env.ADMIN_TOKEN || "");
  if (!isAdmin) return res.status(403).json({ error: "Forbidden" });

  let body = req.body || {};
  if (body && body.action === "delete") {
    // Удаление по id (предпочтительно), либо по brand+name
    const id = String(body.id || "").trim();
    const brand = String(body.brand || "").trim().toLowerCase();
    const name = String(body.name || "").trim().toLowerCase();
    const list = readJSON(FLAVORS_FILE, []);
    let idx = -1;
    if (id) {
      idx = list.findIndex(f => String(f.id || "") === id);
    } else if (brand && name) {
      idx = list.findIndex(
        f =>
          String(f.brand || "").trim().toLowerCase() === brand &&
          String(f.name || "").trim().toLowerCase() === name
      );
    } else {
      return res.status(400).json({ error: "Provide id or (brand+name) to delete" });
    }
    if (idx === -1) return res.status(404).json({ error: "Not found" });
    list.splice(idx, 1);
    writeJSON(FLAVORS_FILE, list);
    return res.json({ ok: true });
  }

  // Добавление
  const brand = String(body.brand || "").trim();
  const name = String(body.name || "").trim();
  if (!brand || !name) return res.status(400).json({ error: "brand and name are required" });

  const list = readJSON(FLAVORS_FILE, []);
  // сгенерируем id, если не пришёл
  let id =
    String(body.id || "")
      .trim()
      .toLowerCase() ||
    (brand + "-" + name)
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9\-]+/g, "");

  if (list.some(f => String(f.id || "") === id)) {
    return res.status(409).json({ error: "id already exists" });
  }

  const item = {
    id,
    brand,
    name,
    description: String(body.description || ""),
    tags: body.tags || [],
    strength10: Number(body.strength10 || 0),
  };
  list.push(item);
  writeJSON(FLAVORS_FILE, list);
  res.json(item);
});

// ==== MIXES ====
// GET /api/mixes — список (новые сверху)
app.get("/api/mixes", (req, res) => {
  const list = readJSON(MIXES_FILE, []);
  list.sort((a, b) => String(b.createdAt || "") > String(a.createdAt || "") ? 1 : -1);
  res.json(Array.isArray(list) ? list : []);
});

// POST /api/mixes — добавить микс
app.post("/api/mixes", (req, res) => {
  const body = req.body || {};
  const list = readJSON(MIXES_FILE, []);
  const item = {
    id: "mix_" + Math.random().toString(36).slice(2, 8),
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

// DELETE /api/mixes/:id — удаление микса
app.delete("/api/mixes/:id", (req, res) => {
  const id = String(req.params.id);
  const userId = req.header("X-User-Id") || null;
  const mixes = readJSON(MIXES_FILE, []);
  const idx = mixes.findIndex(m => m.id === id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });

  const mix = mixes[idx];
  // Админ с валидным X-Admin-Token может удалить любой микс
  const adminHeader = req.header("X-Admin-Token");
  const isAdmin = adminHeader && adminHeader === (process.env.ADMIN_TOKEN || "");
  if (isAdmin) {
    mixes.splice(idx, 1);
    writeJSON(MIXES_FILE, mixes);
    return res.json({ ok: true, by: "admin" });
  }

  if (mix.authorId && userId && String(mix.authorId) === String(userId)) {
    mixes.splice(idx, 1);
    writeJSON(MIXES_FILE, mixes);
    return res.json({ ok: true });
  }
  // Разрешим удалять старые записи без authorId админом (X-User-Id: admin)
  if (!mix.authorId && userId === "admin") {
    mixes.splice(idx, 1);
    writeJSON(MIXES_FILE, mixes);
    return res.json({ ok: true, note: "deleted legacy mix by admin" });
  }
  return res.status(403).json({ error: "Forbidden" });
});

// SPA fallback (если фронт в /public на Render)
if (fs.existsSync(PUBLIC_DIR)) {
  app.get("*", (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`✅ Server started on http://localhost:${PORT}`);
});
