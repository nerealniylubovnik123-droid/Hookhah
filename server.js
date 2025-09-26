// server.js — Hookhah backend (Node/Express)
const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 8080;

// CORS + JSON
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ==== Paths / data files ====
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = __dirname;
const FLAVORS_FILE = path.join(DATA_DIR, "flavors.json");
const MIXES_FILE = path.join(DATA_DIR, "guest_mixes.json");

// ==== Helpers ====
function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return Array.isArray(fallback) ? [] : (fallback ?? null);
    const raw = fs.readFileSync(file, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    console.error("[readJSON]", file, e.message);
    return Array.isArray(fallback) ? [] : (fallback ?? null);
  }
}
function writeJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    console.error("[writeJSON]", file, e.message);
  }
}

// ==== Healthcheck ====
app.get("/healthz", (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// ==== Static (optional) ====
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
}

// ================= FLAVORS =================

// GET list
app.get("/api/flavors", (req, res) => {
  const list = readJSON(FLAVORS_FILE, []);
  res.json(Array.isArray(list) ? list : []);
});

// POST add or delete (admin only)
app.post("/api/flavors", (req, res) => {
  const adminHeader = req.header("X-Admin-Token");
  const isAdmin = adminHeader && adminHeader === (process.env.ADMIN_TOKEN || "");
  if (!isAdmin) return res.status(403).json({ error: "Forbidden" });

  const body = req.body || {};

  // Delete flow
  if (body && body.action === "delete") {
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

  // Add flow
  const brand = String(body.brand || "").trim();
  const name = String(body.name || "").trim();
  if (!brand || !name) return res.status(400).json({ error: "brand and name are required" });

  const list = readJSON(FLAVORS_FILE, []);
  let id =
    String(body.id || "").trim().toLowerCase() ||
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

// ================= MIXES =================

// GET list (newest first)
app.get("/api/mixes", (req, res) => {
  const list = readJSON(MIXES_FILE, []);
  const arr = Array.isArray(list) ? list : [];
  arr.sort((a, b) => {
    const ta = new Date(a && a.createdAt ? a.createdAt : 0).getTime();
    const tb = new Date(b && b.createdAt ? b.createdAt : 0).getTime();
    return tb - ta;
  });
  res.json(arr);
});

// POST create
app.post("/api/mixes", (req, res) => {
  const body = req.body || {};
  const list = readJSON(MIXES_FILE, []);
  const item = {
    id: "mix_" + Math.random().toString(36).slice(2, 10),
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

// DELETE (author only; admin any)
app.delete("/api/mixes/:id", (req, res) => {
  const id = String(req.params.id);
  const userId = req.header("X-User-Id") || null;
  const mixes = readJSON(MIXES_FILE, []);
  const idx = mixes.findIndex(m => m.id === id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });

  const mix = mixes[idx];

  // Admin can delete any mix with valid token
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
  if (!mix.authorId && userId === "admin") {
    mixes.splice(idx, 1);
    writeJSON(MIXES_FILE, mixes);
    return res.json({ ok: true, note: "deleted legacy mix by admin" });
  }
  return res.status(403).json({ error: "Forbidden" });
});

// ==== SPA fallback (only if PUBLIC_DIR exists) ====
if (fs.existsSync(PUBLIC_DIR)) {
  // Любой GET, кроме /api/* — отдаём index.html (фикс для path-to-regexp)
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`✅ Server started on http://localhost:${PORT}`);
});
