// server.js
// Мини-бэкенд для Hookah Mixes: JSON-файлы вместо БД.
// Поддерживает:
//  - GET/POST/DELETE /api/mixes
//  - GET/POST/PUT/DELETE /api/flavors (POST/PUT/DELETE — только админ)
//  - статику из ./public (или из текущей папки, если ./public нет)
// Авторизация админа: либо заголовок X-Admin-Token == ADMIN_TOKEN,
// либо authorId == ADMIN_ID (Telegram ID) из переменных окружения.

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');

// ====== НАСТРОЙКИ ======
const PORT = Number(process.env.PORT) || 8080;

// Админские секреты (задайте хотя бы один)
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const ADMIN_ID = process.env.ADMIN_ID || ''; // Telegram user id (число строкой)

// ====== ПУТИ К ФАЙЛАМ ======
const ROOT = __dirname;
const PUBLIC_DIR = fs.existsSync(path.join(ROOT, 'public')) ? path.join(ROOT, 'public') : ROOT;
const MIXES_FILE = path.join(ROOT, 'guest_mixes.json');
const FLAVORS_FILE = path.join(ROOT, 'hookah_flavors.json');

// ====== ВСПОМОГАТЕЛЬНЫЕ ======
function ensureFile(file, initial = '[]') {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, initial, 'utf8');
  }
}
function readJsonSafe(file, def = []) {
  try {
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(raw);
  } catch (_e) {
    return def;
  }
}
function writeJsonPretty(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}
function isAdminByToken(req) {
  if (!ADMIN_TOKEN) return false;
  return (req.get('X-Admin-Token') || '') === ADMIN_TOKEN;
}
function isAdminById(req) {
  if (!ADMIN_ID) return false;
  const authorId = (req.body && (req.body.authorId || req.body.userId)) || req.get('X-User-Id');
  return String(authorId || '') === String(ADMIN_ID);
}
function requireAdmin(req, res, next) {
  if (isAdminByToken(req) || isAdminById(req)) return next();
  if (!ADMIN_TOKEN && !ADMIN_ID) {
    return res.status(500).json({ error: 'ADMIN_TOKEN/ADMIN_ID не настроены на сервере' });
  }
  return res.status(403).json({ error: 'Forbidden' });
}
function now() { return Date.now(); }

// ====== ИНИЦИАЛИЗАЦИЯ ======
ensureFile(MIXES_FILE, '[]');
ensureFile(FLAVORS_FILE, '[]');

const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ====== HEALTH ======
app.get('/healthz', (_req, res) => res.json({ ok: true, ts: now() }));

// ====== FLAVORS ======

// GET /api/flavors — вернуть все вкусы
app.get('/api/flavors', (_req, res) => {
  const list = readJsonSafe(FLAVORS_FILE, []);
  res.json(list);
});

// POST /api/flavors — добавить/обновить вкус (только админ)
app.post('/api/flavors', requireAdmin, (req, res) => {
  const b = req.body || {};
  const brand = String(b.brand || '').trim();
  const name = String(b.name || '').trim();
  if (!brand || !name) {
    return res.status(400).json({ error: 'brand и name обязательны' });
  }
  // id: либо передан, либо склеиваем brand-name
  const id = (b.id ? String(b.id) : `${brand}-${name}`).
    toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-_.]+/gi, '');

  const item = {
    id,
    brand,
    name,
    description: b.description != null ? String(b.description) : undefined,
    tags: Array.isArray(b.tags) ? b.tags.filter(Boolean) : undefined,
    strength10: (typeof b.strength10 === 'number') ? b.strength10 : undefined,
  };

  const list = readJsonSafe(FLAVORS_FILE, []);
  const idx = list.findIndex(x => x && x.id === id);
  if (idx >= 0) list[idx] = { ...list[idx], ...item };
  else list.unshift(item);

  try {
    writeJsonPretty(FLAVORS_FILE, list);
    res.json(item);
  } catch (e) {
    console.error('write flavors error', e);
    res.status(500).json({ error: 'write error' });
  }
});

// PUT /api/flavors/:id — правка вкуса (админ)
app.put('/api/flavors/:id', requireAdmin, (req, res) => {
  const id = String(req.params.id || '');
  const list = readJsonSafe(FLAVORS_FILE, []);
  const idx = list.findIndex(x => x && x.id === id);
  if (idx < 0) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  list[idx] = {
    ...list[idx],
    brand: b.brand != null ? String(b.brand) : list[idx].brand,
    name: b.name != null ? String(b.name) : list[idx].name,
    description: b.description != null ? String(b.description) : list[idx].description,
    tags: Array.isArray(b.tags) ? b.tags.filter(Boolean) : list[idx].tags,
    strength10: (typeof b.strength10 === 'number') ? b.strength10 : list[idx].strength10,
  };
  try {
    writeJsonPretty(FLAVORS_FILE, list);
    res.json(list[idx]);
  } catch (e) {
    console.error('put flavors error', e);
    res.status(500).json({ error: 'write error' });
  }
});

// DELETE /api/flavors/:id — удалить вкус (админ)
app.delete('/api/flavors/:id', requireAdmin, (req, res) => {
  const id = String(req.params.id || '');
  const list = readJsonSafe(FLAVORS_FILE, []);
  const next = list.filter(x => x && x.id !== id);
  if (next.length === list.length) return res.status(404).json({ error: 'not found' });
  try {
    writeJsonPretty(FLAVORS_FILE, next);
    res.status(204).end();
  } catch (e) {
    console.error('delete flavors error', e);
    res.status(500).json({ error: 'write error' });
  }
});

// ====== MIXES ======

// GET /api/mixes — вернуть миксы (сортировка по createdAt desc)
app.get('/api/mixes', (_req, res) => {
  const list = readJsonSafe(MIXES_FILE, []);
  list.sort((a, b) => (b?.createdAt || 0) - (a?.createdAt || 0));
  res.json(list);
});

// POST /api/mixes — добавить микс (для всех пользователей)
app.post('/api/mixes', (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim();
  const parts = Array.isArray(b.parts) ? b.parts : [];
  const total = parts.reduce((s, p) => s + Math.max(0, Math.min(100, Number(p?.percent) || 0)), 0);

  if (!title || title.length < 3) return res.status(400).json({ error: 'title слишком короткий' });
  if (!parts.length) return res.status(400).json({ error: 'parts пуст' });
  if (total !== 100) return res.status(400).json({ error: 'сумма процентов должна быть 100' });

  const mix = {
    id: String(b.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`),
    title,
    parts: parts.map(p => ({ flavorId: String(p.flavorId), percent: Number(p.percent) })),
    notes: b.notes != null ? String(b.notes) : '',
    author: b.author != null ? String(b.author) : 'Гость',
    authorId: b.authorId != null ? String(b.authorId) : null, // важно для удаления
    createdAt: Number(b.createdAt || Date.now()),
    taste: b.taste != null ? String(b.taste) : null,
    strength10: (typeof b.strength10 === 'number') ? b.strength10 : null,
  };

  const list = readJsonSafe(MIXES_FILE, []);
  const exists = list.find(x => x && x.id === mix.id);
  if (!exists) list.unshift(mix);

  try {
    writeJsonPretty(MIXES_FILE, list.slice(0, 1000)); // ограничим историю
    res.json(mix);
  } catch (e) {
    console.error('write mixes error', e);
    res.status(500).json({ error: 'write error' });
  }
});

// DELETE /api/mixes/:id — удалить микс (владелец или админ)
app.delete('/api/mixes/:id', (req, res) => {
  const id = String(req.params.id || '');
  const list = readJsonSafe(MIXES_FILE, []);
  const idx = list.findIndex(x => x && x.id === id);
  if (idx < 0) return res.status(404).json({ error: 'not found' });

  const userId = req.get('X-User-Id') || req.query.userId || (req.body && req.body.userId);
  const isOwner = userId && list[idx]?.authorId && String(userId) === String(list[idx].authorId);
  const isAdmin = isAdminByToken(req) || (ADMIN_ID && String(userId || '') === String(ADMIN_ID));

  if (!isOwner && !isAdmin) {
    return res.status(403).json({ error: 'only owner or admin can delete' });
  }

  list.splice(idx, 1);
  try {
    writeJsonPretty(MIXES_FILE, list);
    res.status(204).end();
  } catch (e) {
    console.error('delete mixes error', e);
    res.status(500).json({ error: 'write error' });
  }
});

// ====== СТАТИКА ======
app.use(express.static(PUBLIC_DIR, { extensions: ['html'], index: 'index.html' }));
app.get('*', (_req, res) => {
  // SPA fallback на index.html
  const indexFile = path.join(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(indexFile)) return res.sendFile(indexFile);
  res.status(404).send('Not Found');
});

// ====== СТАРТ ======
app.listen(PORT, () => {
  console.log(`✅ Server started: http://localhost:${PORT}`);
  if (!ADMIN_TOKEN && !ADMIN_ID) {
    console.log('⚠️  ВНИМАНИЕ: не задан ADMIN_TOKEN или ADMIN_ID — POST/PUT/DELETE /api/flavors вернёт 500.');
  }
});
