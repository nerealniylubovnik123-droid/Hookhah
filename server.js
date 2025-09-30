const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ---- Constants & helpers ----
const PORT = process.env.PORT || 8080;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const ROOT = __dirname;

const FILES = {
  flavors: path.join(ROOT, 'flavors.json'),
  mixes: path.join(ROOT, 'guest_mixes.json'),
  banned: path.join(ROOT, 'banned_words.json'),
};

function ensureFiles() {
  if (!fs.existsSync(FILES.flavors)) fs.writeFileSync(FILES.flavors, '[]', 'utf8');
  if (!fs.existsSync(FILES.mixes)) fs.writeFileSync(FILES.mixes, '[]', 'utf8');
  if (!fs.existsSync(FILES.banned)) {
    fs.writeFileSync(FILES.banned, JSON.stringify(["спайс","наркотик","18+","xxx"], null, 2), 'utf8');
  }
}
ensureFiles();

function readJSON(fp) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8') || '[]'); } catch (e) { return []; }
}
function writeJSON(fp, data) {
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf8');
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/ё/g, 'е');
}
function slug(s) {
  return norm(s).replace(/[^a-z0-9\u0400-\u04FF]+/g, '-').replace(/^-+|-+$/g, '');
}
function hasBanned(text, bannedWords) {
  const t = norm(text);
  const hit = [];
  for (const w of bannedWords) {
    const ww = norm(w).trim();
    if (!ww) continue;
    if (t.includes(ww)) hit.push(ww);
  }
  return Array.from(new Set(hit));
}

// ---- Static (if present) ----
const PUBLIC_DIR = path.join(__dirname, 'public');
if (fs.existsSync(PUBLIC_DIR)) app.use(express.static(PUBLIC_DIR));

// ---- API ----
app.get('/api/healthz', (req, res) => {
  res.json({ ok: true, time: Date.now(), uptime: process.uptime() });
});

// Banned words
app.get('/api/banned-words', (req, res) => {
  res.json({ words: readJSON(FILES.banned) });
});
app.post('/api/banned-words', (req, res) => {
  const token = req.header('X-Admin-Token') || '';
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
    res.status(403).json({ error: 'Forbidden (bad admin token)' });
    return;
  }
  const words = Array.isArray(req.body.words) ? req.body.words.map(String) : [];
  writeJSON(FILES.banned, words);
  res.json({ ok: true, words });
});

// Flavors
app.get('/api/flavors', (req, res) => {
  res.json(readJSON(FILES.flavors));
});

app.post('/api/flavors', (req, res) => {
  const data = readJSON(FILES.flavors);
  const body = req.body || {};

  if (body.action === 'delete') {
    const token = req.header('X-Admin-Token') || '';
    if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
      res.status(403).json({ error: 'Forbidden (bad admin token)' });
      return;
    }
    let removed = false;
    if (body.id) {
      const idx = data.findIndex(f => f.id === String(body.id));
      if (idx >= 0) { data.splice(idx, 1); removed = true; }
    } else if (body.brand && body.name) {
      const targetId = slug(`${body.brand}-${body.name}`);
      const idx = data.findIndex(f => f.id === targetId);
      if (idx >= 0) { data.splice(idx, 1); removed = true; }
    } else {
      res.status(400).json({ error: 'Missing id or (brand and name) for delete' });
      return;
    }
    writeJSON(FILES.flavors, data);
    res.json({ ok: true, removed });
    return;
  }

  // Create
  if (!body.brand || !body.name) {
    res.status(400).json({ error: 'brand and name are required' });
    return;
  }
  const id = slug(`${body.brand}-${body.name}`);
  if (data.some(f => f.id === id)) {
    res.status(409).json({ error: 'conflict', id });
    return;
  }
  const flavor = {
    id,
    brand: String(body.brand),
    name: String(body.name),
    tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
    strength10: typeof body.strength10 === 'number' ? body.strength10 : null
  };
  data.push(flavor);
  writeJSON(FILES.flavors, data);
  res.json(flavor);
});

// Mixes
app.get('/api/mixes', (req, res) => {
  const arr = readJSON(FILES.mixes);
  arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  res.json(arr);
});

app.post('/api/mixes', (req, res) => {
  const banned = readJSON(FILES.banned);
  const body = req.body || {};
  const title = String(body.title || '');
  const notes = String(body.notes || '');

  const found = Array.from(new Set([...hasBanned(title, banned), ...hasBanned(notes, banned)]));
  if (found.length) {
    res.status(400).json({ error: 'banned_words', banned: found });
    return;
  }

  if (title.trim().length === 0 || title.length > 120) {
    res.status(400).json({ error: 'Bad title length' });
    return;
  }
  if (!Array.isArray(body.parts)) {
    res.status(400).json({ error: 'parts must be an array' });
    return;
  }

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const likedBy = Array.isArray(body.likedBy) ? body.likedBy.map(String) : [];
  const mix = {
    id,
    title,
    parts: body.parts.map(p => ({ id: String(p.id), percent: Number(p.percent) })),
    notes,
    author: String(body.author || 'Гость'),
    authorId: body.authorId ? String(body.authorId) : null,
    createdAt: Date.now(),
    taste: body.taste ? String(body.taste) : null,
    strength10: typeof body.strength10 === 'number' ? body.strength10 : null,
    likedBy,
    likesCount: likedBy.length
  };
  const mixes = readJSON(FILES.mixes);
  mixes.push(mix);
  writeJSON(FILES.mixes, mixes);
  res.json(mix);
});

app.delete('/api/mixes/:id', (req, res) => {
  const id = req.params.id;
  const mixes = readJSON(FILES.mixes);
  const idx = mixes.findIndex(m => m.id === id);
  if (idx === -1) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const mix = mixes[idx];
  const userId = req.header('X-User-Id') || '';
  const admin = req.header('X-Admin-Token') || '';
  const isOwner = userId && mix.authorId && userId === mix.authorId;
  const isAdmin = ADMIN_TOKEN && admin === ADMIN_TOKEN;

  if (!isOwner && !isAdmin) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  mixes.splice(idx, 1);
  writeJSON(FILES.mixes, mixes);
  res.json({ ok: true, deleted: id });
});

app.post('/api/mixes/:id/like', (req, res) => {
  const id = req.params.id;
  const userId = req.header('X-User-Id') || 'anon';
  const mixes = readJSON(FILES.mixes);
  const m = mixes.find(x => x.id === id);
  if (!m) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  if (!Array.isArray(m.likedBy)) m.likedBy = [];
  const i = m.likedBy.indexOf(userId);
  let liked;
  if (i >= 0) {
    m.likedBy.splice(i, 1);
    liked = false;
  } else {
    m.likedBy.push(userId);
    liked = true;
  }
  m.likesCount = m.likedBy.length;
  writeJSON(FILES.mixes, mixes);
  res.json({ ok: true, likes: m.likesCount, liked });
});

// ---- SPA Fallback (AFTER API routes) ----
if (fs.existsSync(PUBLIC_DIR)) {
  app.get('*', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
}

// ---- Start ----
app.listen(PORT, () => {
  console.log(`Hookah Mixes server running on http://localhost:${PORT}`);
});
