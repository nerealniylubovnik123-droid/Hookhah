// server.js вЂ” Hookhah backend (Render/Node)
const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = app.use(express.json());
const PORT = process.env.PORT || 8080;

app.use(cors()); // СЂР°Р·СЂРµС€Р°РµРј CORS СЃРѕ РІСЃРµС… РёСЃС‚РѕС‡РЅРёРєРѕРІ
app.use(express.json({ limit: "1mb" }));

// ==== СЃС‚Р°С‚РёРєР° (РµСЃР»Рё Р·Р°С…РѕС‚РёС‚Рµ РѕС‚РґР°РІР°С‚СЊ С„СЂРѕРЅС‚ СЃ Render) ====
const PUBLIC_DIR = path.join(__dirname, "public");
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
}

// ==== JSON С„Р°Р№Р»С‹ ====
const FLAVORS_FILE = path.join(__dirname, "flavors.json");
const MIXES_FILE   = path.join(__dirname, "guest_mixes.json");

function readJSON(file, fallback = []) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

// СЃРѕР·РґР°РґРёРј РїСѓСЃС‚С‹Рµ С„Р°Р№Р»С‹, РµСЃР»Рё РЅРµС‚
if (!fs.existsSync(FLAVORS_FILE)) writeJSON(FLAVORS_FILE, []);
if (!fs.existsSync(MIXES_FILE))   writeJSON(MIXES_FILE, []);

// ==== Health ====
app.get("/healthz", (req, res) => {
  res.json({ ok: true, time: Date.now(), uptime: process.uptime() });
});

// ==== Flavors ====
app.get("/api/flavors", (req, res) => {
  res.json(readJSON(FLAVORS_FILE, []));
});

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

// ==== Mixes ====
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
    title: String(body.title || "Р‘РµР· РЅР°Р·РІР°РЅРёСЏ").slice(0, 120),
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

// РЈРґР°Р»РµРЅРёРµ вЂ” С‚РѕР»СЊРєРѕ Р°РІС‚РѕСЂ (СЃРѕРІРїР°РґР°РµС‚ X-User-Id Рё authorId)
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
  // Р Р°Р·СЂРµС€РёРј СѓРґР°Р»СЏС‚СЊ СЃС‚Р°СЂС‹Рµ Р·Р°РїРёСЃРё Р±РµР· authorId Р°РґРјРёРЅРѕРј (X-User-Id: admin)
  if (!mix.authorId && userId === "admin") {
    mixes.splice(idx, 1);
    writeJSON(MIXES_FILE, mixes);
    return res.json({ ok: true, note: "deleted legacy mix by admin" });
  }
  return res.status(403).json({ error: "Forbidden" });
});

// SPA fallback (РµСЃР»Рё С„СЂРѕРЅС‚ РІ /public РЅР° Render)
if (fs.existsSync(PUBLIC_DIR)) {
  app.get("*", (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`вњ… Server started on http://localhost:${PORT}`);
});
