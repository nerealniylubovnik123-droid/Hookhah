// server.js
const express = require('express');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8080;

// --- CORS (разрешаем с любого домена; при желании сузьте origin)
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// --- файлы-хранилища
const DATA_DIR = __dirname;
const FLAVORS_FILE = path.join(DATA_DIR, 'hookah_flavors.json');
const MIXES_FILE   = path.join(DATA_DIR, 'guest_mixes.json');

// --- утилиты чтения/записи
async function readJson(file, fallback) {
  try {
    const buf = await fsp.readFile(file);
    const txt = new TextDecoder('utf-8').decode(buf);
    return JSON.parse(txt);
  } catch {
    return fallback;
  }
}
async function writeJson(file, data) {
  const txt = JSON.stringify(data, null, 2);
  await fsp.writeFile(file, txt, 'utf8');
}

// --- health
app.get('/healthz', (req, res) => {
  res.json({ ok: true, time: Date.now(), pid: process.pid });
});

// --- FLAVORS
app.get('/api/flavors', async (req, res) => {
  const arr = await readJson(FLAVORS_FILE, []);
  res.json(arr);
});

app.post('/api/flavors', async (req, res) => {
  const body = req.body || {};
  const token = req.header('X-Admin-Token') || '';
  const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
  const ADMIN_ID    = process.env.ADMIN_ID || '';

  const authorId = body.authorId ? String(body.authorId) : null;
  const tokenOk  = ADMIN_TOKEN && token && token === ADMIN_TOKEN;
  const idOk     = ADMIN_ID && authorId && String(authorId) === String(ADMIN_ID);

  if (!tokenOk && !idOk) {
    return res.status(403).json({ error: 'Forbidden. Provide X-Admin-Token or authorId matching ADMIN_ID.' });
  }

  const brand = String(body.brand || '').trim();
  const name  = String(body.name  || '').trim();

  if (!brand || !name) {
    return res.status(400).json({ error: 'brand and name are required' });
  }

  const id = String(body.id || (brand + '-' + name).replace(/\s+/g, '-').toLowerCase()).trim();
  const item = {
    id,
    brand,
    name,
    description: body.description != null ? String(body.description) : undefined,
    tags: Array.isArray(body.tags) ? body.tags.filter(Boolean) : undefined,
    strength10: (typeof body.strength10 === 'number' ? body.strength10 : undefined)
  };

  const arr = await readJson(FLAVORS_FILE, []);
  const exists = arr.findIndex(x => x && x.id === id);
  if (exists >= 0) arr[exists] = item; else arr.push(item);
  await writeJson(FLAVORS_FILE, arr);

  res.json(item);
});

// --- MIXES
app.get('/api/mixes', async (req, res) => {
  const arr = await readJson(MIXES_FILE, []);
  // сортировка по дате
  arr.sort((a, b) => (b?.createdAt || 0) - (a?.createdAt || 0));
  res.json(arr);
});

app.post('/api/mixes', async (req, res) => {
  const m = req.body || {};
  if (!Array.isArray(m.parts) || !m.parts.length || !m.title) {
    return res.status(400).json({ error: 'invalid mix' });
  }
  // нормализация
  m.id = m.id || cryptoRandomId();
  m.title = String(m.title).trim();
  m.notes = m.notes != null ? String(m.notes) : '';
  m.author = m.author != null ? String(m.author) : 'Гость';
  m.authorId = m.authorId != null ? String(m.authorId) : undefined;
  m.createdAt = m.createdAt || Date.now();

  const arr = await readJson(MIXES_FILE, []);
  arr.unshift(m);
  // ограничим
  while (arr.length > 1000) arr.pop();
  await writeJson(MIXES_FILE, arr);
  res.json(m);
});

app.delete('/api/mixes/:id', async (req, res) => {
  const id = req.params.id;
  // Защита: можно удалять только свой микс (по authorId)
  const authorId = String(req.header('X-Author-Id') || '');
  const ADMIN_ID = process.env.ADMIN_ID || '';

  let arr = await readJson(MIXES_FILE, []);
  const idx = arr.findIndex(x => x && x.id === id);
  if (idx < 0) return res.status(404).json({ error: 'not found' });

  const item = arr[idx];
  const owner = String(item.authorId || '') || ''; // может быть пустым у старых записей
  const allowed = (owner && authorId && owner === authorId) || (ADMIN_ID && authorId === ADMIN_ID);

  if (!allowed) return res.status(403).json({ error: 'forbidden' });

  arr.splice(idx, 1);
  await writeJson(MIXES_FILE, arr);
  res.status(204).end();
});

// --- статика (опционально, если кладёте index.html рядом)
app.use(express.static(path.join(__dirname, 'public')));

// --- старт
app.listen(PORT, () => {
  console.log(`✅ Server started: http://localhost:${PORT}`);
});

// --- простенький id
function cryptoRandomId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
