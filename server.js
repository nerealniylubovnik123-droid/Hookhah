// server.js — Hookah backend (admin delete + flavor delete + likes)
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

// ensure files exist
if (!fs.existsSync(FLAVORS_FILE)) writeJSON(FLAVORS_FILE, []);
if (!fs.existsSync(MIXES_FILE))   writeJSON(MIXES_FILE, []);

// ===== auth / helpers =====
const ADMIN_TOKEN = "MySuperSecretToken_2025"; // ваш токен

function isAdminReq(req) {
  const tok = req.header("X-Admin-Token");
  return !!tok && tok === ADMIN_TOKEN;
}
function getUserId(req) {
  // userId из заголовков или query/body (для совместимости со старым фронтом)
  const fromHeader = req.header("X-User-Id") || req.header("X-Author-Id");
  const fromQuery  = req.query ? (req.query.userId || req.query.authorId) : null;
  const fromBody   = req.body  ? (req.body.userId  || req.body.authorId)  : null;
  const v = (fromHeader || fromQuery || fromBody || "").toString().trim();
  return v || null;
}
function makeFlavorId(brand, name) {
  return (String(brand) + "-" + String(name))
    .toLowerCase().trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-._]+/g, "");
}
function findMixIndexById(mixes, id) {
  return mixes.findIndex(m => String(m.id) === String(id));
}

// ===== health =====
app.get("/healthz", (_req, res) => {
  res.json({ ok: true, time: Date.now(), uptime: process.uptime() });
});

// ============================ FLAVORS =======================================
// GET: список вкусов
app.get("/api/flavors", (_req, res) => {
  res.json(readJSON(FLAVORS_FILE, []));
});

// POST: создать вкус (админ) ИЛИ удалить через action:'delete' (совместимость со старым фронтом)
app.post("/api/flavors", (req, res) => {
  const body = req.body || {};

  // старый способ удаления: POST { action:'delete', brand, name }
  if (String(body.action || "").toLowerCase() === "delete") {
    if (!isAdminReq(req)) return res.status(403).json({ error: "Forbidden (bad admin token)" });
    const brand = String(body.brand || "").trim();
    const name  = String(body.name  || "").trim();
    if (!brand || !name) return res.status(400).json({ error: "brand and name are required for delete" });

    const id = makeFlavorId(brand, name);
    const flavors = readJSON(FLAVORS_FILE, []);
    const next = flavors.filter(f => String(f.id || makeFlavorId(f.brand, f.name)) !== id);
    if (next.length === flavors.length) return res.status(404).json({ error: "Flavor not found" });
    writeJSON(FLAVORS_FILE, next);
    return res.json({ ok: true, deletedId: id });
  }

  // создание вкуса
  if (!isAdminReq(req)) return res.status(403).json({ error: "Forbidden (bad admin token)" });

  const brand = String(body.brand || "").trim();
  const name  = String(body.name  || "").trim();
  if (!brand || !name) return res.status(400).json({ error: "brand and name are required" });

  const flavors = readJSON(FLAVORS_FILE, []);
  const id = String(body.id || makeFlavorId(brand, name));
  if (flavors.some(f => String(f.id || makeFlavorId(f.brand, f.name)) === id)) {
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
               : Number.isFinite(body.strength)   ? Number(body.strength) : undefined)
  };

  flavors.push(record);
  writeJSON(FLAVORS_FILE, flavors);
  res.json({ ok: true, flavor: record });
});

// DELETE: удалить вкус по id (админ)
app.delete("/api/flavors/:id", (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ error: "Forbidden (bad admin token)" });
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "id is required" });

  const flavors = readJSON(FLAVORS_FILE, []);
  const next = flavors.filter(f => String(f.id || makeFlavorId(f.brand, f.name)) !== id);
  if (next.length === flavors.length) return res.status(404).json({ error: "Flavor not found" });
  writeJSON(FLAVORS_FILE, next);
  res.json({ ok: true, deletedId: id });
});

// DELETE: удалить вкус по brand+name (админ)
app.delete("/api/flavors/by-brand-name", (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ error: "Forbidden (bad admin token)" });
  const brand = (req.query.brand || (req.body ? req.body.brand : "") || "").toString().trim();
  const name  = (req.query.name  || (req.body ? req.body.name  : "") || "").toString().trim();
  if (!brand || !name) return res.status(400).json({ error: "brand and name are required" });

  const id = makeFlavorId(brand, name);
  const flavors = readJSON(FLAVORS_FILE, []);
  const next = flavors.filter(f => String(f.id || makeFlavorId(f.brand, f.name)) !== id);
  if (next.length === flavors.length) return res.status(404).json({ error: "Flavor not found" });
  writeJSON(FLAVORS_FILE, next);
  res.json({ ok: true, deletedId: id });
});

// ============================ MIXES =========================================
// GET: список миксов
app.get("/api/mixes", (_req, res) => {
  const mixes = readJSON(MIXES_FILE, []);
  mixes.sort((a,b) => (b && b.createdAt ? b.createdAt : 0) - (a && a.createdAt ? a.createdAt : 0));
  res.json(mixes);
});

// POST: создать микс (гость)
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
    // лайки — мягкая инициализация, чтобы не падало на старых данных
    likes: Number.isFinite(body.likes) ? Number(body.likes) : 0,
    likedBy: Array.isArray(body.likedBy) ? body.likedBy.map(String) : []
  };

  mixes.push(mix);
  writeJSON(MIXES_FILE, mixes);
  res.json(mix);
});

// DELETE: автор — свой; админ — любой; legacy: X-User-Id: admin для записей без authorId
function handleDeleteMix(req, res, id) {
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
  if (!mix.authorId && uid === "admin") {
    mixes.splice(idx, 1);
    writeJSON(MIXES_FILE, mixes);
    return res.json({ ok: true, deletedBy: "admin-legacy" });
  }
  return res.status(403).json({ error: "Forbidden" });
}

app.delete("/api/mixes/:id", (req, res) => {
  return handleDeleteMix(req, res, String(req.params.id));
});

// Fallback-пути для старых вызовов фронта
app.post("/api/mixes/delete", (req, res) => {
  const id = (req.body && req.body.id ? String(req.body.id) : "").trim();
  if (!id) return res.status(400).json({ error: "id is required" });
  return handleDeleteMix(req, res, id);
});
app.post("/api/mixes/:id", (req, res) => {
  const method = (req.query && req.query._method ? String(req.query._method) : "").toUpperCase();
  if (method === "DELETE") {
    return handleDeleteMix(req, res, String(req.params.id));
  }
  return res.status(405).json({ error: "Method Not Allowed" });
});

// ============================ LIKES =========================================
// Форматы:
// 1) POST /api/mixes/:id/like        { action?: "like"|"unlike"|"toggle", userId? }
// 2) POST /api/mixes/:id/likes       — alias
// 3) PATCH /api/mixes/:id/like       — alias
// 4) POST /api/mixes/like            { id, action?, userId? }

function ensureLikeFields(mix) {
  if (!Array.isArray(mix.likedBy)) mix.likedBy = [];
  if (!Number.isFinite(mix.likes)) mix.likes = 0;
}
function applyLike(mix, uid, action) {
  ensureLikeFields(mix);
  const has = mix.likedBy.includes(uid);

  if (action === "like" || (action === "toggle" && !has)) {
    if (!has) { mix.likedBy.push(uid); mix.likes += 1; }
    return { liked: true, likes: mix.likes };
  }
  if (action === "unlike" || (action === "toggle" && has)) {
    if (has) { mix.likedBy = mix.likedBy.filter(x => x !== uid); mix.likes = Math.max(0, mix.likes - 1); }
    return { liked: false, likes: mix.likes };
  }
  // default → like
  if (!has) { mix.likedBy.push(uid); mix.likes += 1; }
  return { liked: true, likes: mix.likes };
}
function likeHandler(req, res, idFromParam) {
  const mixes = readJSON(MIXES_FILE, []);
  const id = String(idFromParam || (req.body && req.body.id) || "").trim();
  if (!id) return res.status(400).json({ error: "id is required" });

  const idx = findMixIndexById(mixes, id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });

  const uid = getUserId(req);
  if (!uid) return res.status(400).json({ error: "userId is required" });

  const action = ((req.query && req.query.action) || (req.body && req.body.action) || "toggle").toString().toLowerCase();
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
  app.get("*", (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`✅ Server started on http://localhost:${PORT}`);
});
