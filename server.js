// server.js — Hookah backend (fixed: admin delete + likes)
const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

// ===== app/bootstrap =====
const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ===== static (optional) =====
const PUBLIC_DIR = path.join(__dirname, "public");
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
}

// ===== data files =====
const FLAVORS_FILE = path.join(__dirname, "flavors.json");
const MIXES_FILE   = path.join(__dirname, "guest_mixes.json");

function readJSON(file, fallback = []) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

// ensure files
if (!fs.existsSync(FLAVORS_FILE)) writeJSON(FLAVORS_FILE, []);
if (!fs.existsSync(MIXES_FILE))   writeJSON(MIXES_FILE, []);

// ===== auth helpers =====
const ADMIN_TOKEN = "MySuperSecretToken_2025"; // ваш токен

function isAdminReq(req) {
  const tok = req.header("X-Admin-Token");
  return !!tok && tok === ADMIN_TOKEN;
}
function getUserId(req) {
  const h1 = req.header("X-User-Id");
  const h2 = req.header("X-Author-Id");
  if (h1) return String(h1);
  if (h2) return String(h2);
  if (req.query && (req.query.userId || req.query.authorId)) {
    return String(req.query.userId || req.query.authorId);
  }
  if (req.body && (req.body.userId || req.body.authorId)) {
    return String(req.body.userId || req.body.authorId);
  }
  return null;
}

function normalizeId(brand, name) {
  return (String(brand) + "-" + String(name))
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-._]+/g, "");
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
  if (!isAdminReq(req)) {
    return res.status(403).json({ error: "Forbidden (bad admin token)" });
  }
  const flavor = req.body || {};
  const brand = String(flavor.brand || "").trim();
  const name  = String(flavor.name  || "").trim();
  if (!brand || !name) {
    return res.status(400).json({ error: "brand and name are required" });
  }
  const flavors = readJSON(FLAVORS_FILE, []);
  if (!flavor.id) flavor.id = normalizeId(brand, name);
  if (flavors.some(f => String(f.id || normalizeId(f.brand, f.name)) === String(flavor.id))) {
    return res.status(409).json({ error: "id already exists" });
  }
  flavors.push({
    id: String(flavor.id),
    brand,
    name,
    description: flavor.description ? String(flavor.description) : undefined,
    tags: Array.isArray(flavor.tags)
      ? flavor.tags.map(s => String(s)).filter(Boolean)
      : (flavor.tags ? String(flavor.tags).split(",").map(s => s.trim()).filter(Boolean) : undefined),
    strength10: (Number.isFinite(flavor.strength10) ? Number(flavor.strength10)
               : Number.isFinite(flavor.strength)   ? Number(flavor.strength) : undefined)
  });
  writeJSON(FLAVORS_FILE, flavors);
  res.json({ ok: true, flavor: flavors[flavors.length - 1] });
});

// ===== mixes =====
app.get("/api/mixes", (req, res) => {
  const mixes = readJSON(MIXES_FILE, []);
  mixes.sort((a,b) => (b?.createdAt||0) - (a?.createdAt||0));
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
    strength10: body.strength10 ?? null,
    likes: Number.isFinite(body.likes) ? Number(body.likes) : 0,
    likedBy: Array.isArray(body.likedBy) ? body.likedBy.map(String) : []
  };
  mixes.push(mix);
  writeJSON(MIXES_FILE, mixes);
  res.json(mix);
});

function findMixIndexById(mixes, id) {
  return mixes.findIndex(m => String(m.id) === String(id));
}

// --- delete (author → свой; admin → любой; legacy: X-User-Id: admin)
function handleDeleteById(req, res, id) {
  const mixes = readJSON(MIXES_FILE, []);
  const idx = findMixIndexById(mixes, id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });

  const mix = mixes[idx];
  const admin = isAdminReq(req);
  const uid = getUserId(req);

  if (admin) {
    mixes.splice(idx, 1);
    writeJSON(MIXES_FILE, mixes);
    return res.json({ ok: true, deletedBy: "admin" });
  }

  if (mix.authorId && uid && String(mix.authorId) === String(uid)) {
    mixes.splice(idx, 1);
    writeJSON(MIXES_FILE, mixes);
    return res.json({ ok: true, deletedBy: "author" });
  }

  if (!mix.authorId && (uid === "admin")) {
    mixes.splice(idx, 1);
    writeJSON(MIXES_FILE, mixes);
    return res.json({ ok: true, deletedBy: "admin-legacy", note: "deleted legacy mix by admin (X-User-Id)" });
  }

  return res.status(403).json({ error: "Forbidden" });
}

// Primary DELETE
app.delete("/api/mixes/:id", (req, res) => {
  const id = String(req.params.id);
  return handleDeleteById(req, res, id);
});

// Fallbacks for фронта, который пробует разные пути
app.post("/api/mixes/delete", (req, res) => {
  const id = String((req.body && req.body.id) || "");
  if (!id) return res.status(400).json({ error: "id is required" });
  return handleDeleteById(req, res, id);
});
app.post("/api/mixes/:id", (req, res) => {
  if (String(req.query._method || "").toUpperCase() === "DELETE") {
    const id = String(req.params.id);
    return handleDeleteById(req, res, id);
  }
  return res.status(405).json({ error: "Method Not Allowed" });
});

// ===== likes =====
// Поддерживаем несколько форматов вызова:
// 1) POST /api/mixes/:id/like        { action?: "like"|"unlike"|"toggle", userId? }
// 2) POST /api/mixes/:id/likes       — alias
// 3) PATCH /api/mixes/:id/like       — alias
// 4) POST /api/mixes/like            { id, action?, userId? }
// userId берём также из X-User-Id / X-Author-Id / ?userId / body.userId

function applyLike(mix, uid, action) {
  if (!Array.isArray(mix.likedBy)) mix.likedBy = [];
  if (!Number.isFinite(mix.likes)) mix.likes = 0;

  const has = mix.likedBy.includes(uid);

  if (action === "like" || (action === "toggle" && !has)) {
    if (!has) {
      mix.likedBy.push(uid);
      mix.likes = (mix.likes || 0) + 1;
    }
    return { liked: true, likes: mix.likes };
  }
  if (action === "unlike" || (action === "toggle" && has)) {
    if (has) {
      mix.likedBy = mix.likedBy.filter(x => x !== uid);
      mix.likes = Math.max(0, (mix.likes || 0) - 1);
    }
    return { liked: false, likes: mix.likes };
  }
  // default → like
  if (!has) {
    mix.likedBy.push(uid);
    mix.likes = (mix.likes || 0) + 1;
  }
  return { liked: true, likes: mix.likes };
}

function likeHandler(req, res, idFromParam) {
  const mixes = readJSON(MIXES_FILE, []);
  const id = String(idFromParam || (req.body && req.body.id) || "");
  if (!id) return res.status(400).json({ error: "id is required" });

  const idx = findMixIndexById(mixes, id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });

  const uid = getUserId(req);
  if (!uid) return res.status(400).json({ error: "userId is required" });

  const action = String((req.query && req.query.action) || (req.body && req.body.action) || "toggle").toLowerCase();

  const result = applyLike(mixes[idx], String(uid), action);
  writeJSON(MIXES_FILE, mixes);
  return res.json({ ok: true, id, ...result });
}

app.post("/api/mixes/:id/like",  (req, res) => likeHandler(req, res, req.params.id));
app.post("/api/mixes/:id/likes", (req, res) => likeHandler(req, res, req.params.id));
app.patch("/api/mixes/:id/like", (req, res) => likeHandler(req, res, req.params.id));
app.post("/api/mixes/like",      (req, res) => likeHandler(req, res, null));

// ===== SPA fallback =====
if (fs.existsSync(PUBLIC_DIR)) {
  app.get("*", (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`✅ Server started on http://localhost:${PORT}`);
});
