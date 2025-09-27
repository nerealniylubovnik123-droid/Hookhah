// server.js — Hookah backend (Node/Express)
const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ---------- файлы данных ----------
const DATA_DIR = __dirname;
const FLAVORS_FILE = path.join(DATA_DIR, "flavors.json");
const MIXES_FILE   = path.join(DATA_DIR, "guest_mixes.json");

// создаём пустые json при первом запуске
if (!fs.existsSync(FLAVORS_FILE)) fs.writeFileSync(FLAVORS_FILE, "[]", "utf8");
if (!fs.existsSync(MIXES_FILE))   fs.writeFileSync(MIXES_FILE,   "[]", "utf8");

// ---------- helpers ----------
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

// ---------- health ----------
app.get("/healthz", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// ================= FLAVORS =================
app.get("/api/flavors", (_req, res) => {
  res.json(readJSON(FLAVORS_FILE, []));
});

app.post("/api/flavors", (req, res) => {
  const adminHeader = req.header("X-Admin-Token");
  const isAdmin = adminHeader && adminHeader === (process.env.ADMIN_TOKEN || "");
  if (!isAdmin) return res.status(403).json({ error: "Forbidden (admin token)" });

  const body = req.body || {};
  const brand = String(body.brand || "").trim();
  const name  = String(body.name  || "").trim();
  if (!brand || !name) return res.status(400).json({ error: "brand and name are required" });

  const list = readJSON(FLAVORS_FILE, []);
  let id =
    String(body.id || "").trim().toLowerCase() ||
    (brand + "-" + name).toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\-]+/g, "");

  if (list.some(f => String(f.id || "") === id)) {
    return res.status(409).json({ error: "id already exists" });
  }

  const item = {
    id, brand, name,
    description: String(body.description || ""),
    tags: body.tags || [],
    strength10: Number(body.strength10 || 0),
  };
  list.push(item);
  writeJSON(FLAVORS_FILE, list);
  res.json(item);
});

// ================= MIXES =================
app.get("/api/mixes", (_req, res) => {
  const list = readJSON(MIXES_FILE, []);
  const arr = Array.isArray(list) ? list.slice() : [];
  arr.sort((a, b) => String(b.createdAt || "") > String(a.createdAt || "") ? 1 : -1);
  res.json(arr);
});

app.post("/api/mixes", (req, res) => {
  const b = req.body || {};
  const list = readJSON(MIXES_FILE, []);
  const item = {
    id: "mix_" + Math.random().toString(36).slice(2, 10), // серверный id
    title: String(b.title || "Микс"),
    parts: Array.isArray(b.parts) ? b.parts : [],
    notes: String(b.notes || ""),
    author: String(b.author || "Гость"),
    authorId: String(b.authorId || ""),
    createdAt: new Date().toISOString(),
    taste: String(b.taste || ""),
    strength10: Number(b.strength10 || 0),
  };
  list.push(item);
  writeJSON(MIXES_FILE, list);
  res.json(item);
});

// удаление микса: автор — свой; АДМИН — любой (через X-Admin-Token)
app.delete("/api/mixes/:id", (req, res) => {
  const id = String(req.params.id);
  const userId = req.header("X-User-Id") || null;

  const mixes = readJSON(MIXES_FILE, []);
  const idx = mixes.findIndex(m => String(m.id) === id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });

  const mix = mixes[idx];

  // ✅ админ с валидным токеном может удалить ЛЮБОЙ микс
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

  // legacy: без authorId — можно удалить, если X-User-Id === "admin"
  if (!mix.authorId && userId === "admin") {
    mixes.splice(idx, 1);
    writeJSON(MIXES_FILE, mixes);
    return res.json({ ok: true, note: "deleted legacy mix by admin (X-User-Id)" });
  }

  return res.status(403).json({ error: "Forbidden" });
});

// ================= FRONT (SPA) =================
// Функция, которая КАЖДЫЙ РАЗ ищет index.html (в корне или в /public).
function resolveIndex() {
  const root = path.join(__dirname, "index.html");
  const pub  = path.join(__dirname, "public", "index.html");
  if (fs.existsSync(root)) return root;
  if (fs.existsSync(pub))  return pub;
  return null;
}

// раздаём статику, если есть папка рядом с найденным index.html
(function mountStatic() {
  const idx = resolveIndex();
  if (idx) {
    const dir = path.dirname(idx);
    app.use(express.static(dir));
    console.log("🔎 Serving index.html from:", idx);
  } else {
    console.log("⚠️  index.html not found. Put it next to server.js or in /public/index.html");
  }
})();

// корень
app.get("/", (_req, res) => {
  const idx = resolveIndex();
  if (idx) return res.sendFile(idx);
  res.status(200).type("text/plain").send(
    "index.html not found.\nPlace it next to server.js or in /public/index.html."
  );
});

// все GET, кроме /api/* — на SPA (без звёздочки)
app.get(/^\/(?!api\/).*/, (_req, res) => {
  const idx = resolveIndex();
  if (idx) return res.sendFile(idx);
  res.status(200).type("text/plain").send(
    "index.html not found.\nPlace it next to server.js or in /public/index.html."
  );
});

app.listen(PORT, () => {
  console.log(`✅ Server started on http://localhost:${PORT}`);
});
