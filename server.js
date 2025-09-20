// server.js — API + раздача статики из /public
// ENV: ADMIN_TOKEN=<секрет>
//      DATA_DIR (необязательно; если не задан, пишем в ./data)

const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- базовые миддлвары ----------
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token, X-Author-Id, X-User-Id');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---------- конфиг ----------
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, 'data');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

// ---------- утилиты ----------
function randomId() {
  return crypto?.randomUUID
    ? crypto.randomUUID()
    : ('id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
}
function slugifyId(brand, name) {
  return (String(brand || '').trim() + '-' + String(name || '').trim())
    .toLowerCase()
    .replace(/\s+/g, '-');
}
async function ensureDir(p) {
  if (!fs.existsSync(p)) await fsp.mkdir(p, { recursive: true });
}
async function writeJsonAtomic(filePath, data) {
  const tmp = filePath + '.tmp';
  const json = JSON.stringify(data, null, 2);
  await ensureDir(path.dirname(filePath));
  await fsp.writeFile(tmp, json, 'utf8');
  await fsp.rename(tmp, filePath);
}
async function readJsonSafe(filePath, fallback) {
  try {
    const txt = await fsp.readFile(filePath, 'utf8');
    return JSON.parse(txt);
  } catch (_) {
    return fallback;
  }
}
function requireAdmin(req, res, next) {
  const token = req.get('X-Admin-Token') || '';
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) return res.status(403).json({ error: 'forbidden' });
  next();
}
function getAuthorIdFromReq(req) {
  return (
    String(req.get('X-Author-Id') || '').trim() ||
    String(req.get('X-User-Id') || '').trim() ||
    String((req.body && req.body.authorId) || '').trim() ||
    String((req.query && req.query.authorId) || '').trim()
  );
}
function createStore(fileName) {
  const filePath = path.join(DATA_DIR, fileName);
  return {
    async getAll() {
      await ensureDir(DATA_DIR);
      if (!fs.existsSync(filePath)) await writeJsonAtomic(filePath, []);
      const list = await readJsonSafe(filePath, []);
      return Array.isArray(list) ? list : [];
    },
    async setAll(list) {
      await writeJsonAtomic(filePath, Array.isArray(list) ? list : []);
    },
    filePath,
  };
}

const flavorsStore = createStore('flavors.json');
const mixesStore   = createStore('mixes.json');

// ===================== FLAVORS =====================
app.get('/api/flavors', async (req, res) => {
  try { res.json(await flavorsStore.getAll()); }
  catch (e) { console.error(e); res.status(500).json({ error:'server error' }); }
});
app.post('/api/flavors', requireAdmin, async (req, res) => {
  try {
    const { brand='', name='', description='', tags=[], strength10 } = req.body || {};
    const b = String(brand).trim(), n = String(name).trim();
    if (!b || !n) return res.status(400).json({ error:'brand and name required' });
    const id = slugifyId(b, n);
    const list = await flavorsStore.getAll();
    if (list.some(f => f?.id === id)) return res.status(409).json({ error:'id already exists' });
    const rec = {
      id, brand:b, name:n,
      description:String(description||''),
      tags:Array.isArray(tags)?tags.filter(Boolean):[],
      strength10: Number.isFinite(strength10) ? Number(strength10) : undefined,
    };
    list.push(rec); await flavorsStore.setAll(list);
    res.status(201).json({ ok:true, id:rec.id });
  } catch (e) { console.error(e); res.status(500).json({ error:'server error' }); }
});
app.delete('/api/flavors/:id', requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id||'').trim();
    if (!id) return res.status(400).json({ error:'id required' });
    const list = await flavorsStore.getAll();
    const next = list.filter(f => f?.id !== id);
    if (next.length === list.length) return res.status(404).json({ error:'not found' });
    await flavorsStore.setAll(next);
    res.status(204).end();
  } catch (e) { console.error(e); res.status(500).json({ error:'server error' }); }
});

// ===================== MIXES =====================
app.get('/api/mixes', async (req, res) => {
  try {
    const list = await mixesStore.getAll();
    list.sort((a,b)=>Number(b?.createdAt||0)-Number(a?.createdAt||0));
    res.json(list);
  } catch (e) { console.error(e); res.status(500).json({ error:'server error' }); }
});
app.post('/api/mixes', async (req, res) => {
  try {
    const body = req.body || {};
    const list = await mixesStore.getAll();
    let id = String(body.id||'').trim(); if (!id) id = crypto.randomUUID?.() || ('id-'+Date.now());
    if (list.some(m=>m?.id===id)) return res.status(409).json({ error:'id already exists' });
    const now = Date.now();
    const rec = {
      id,
      title:String(body.title||'').trim(),
      parts:Array.isArray(body.parts)?body.parts:[],
      notes:String(body.notes||''),
      author:String(body.author||'Гость'),
      authorId:String(body.authorId||getAuthorIdFromReq(req)||'anon'),
      createdAt:Number(body.createdAt||now),
      taste: body.taste ?? null,
      strength10: Number.isFinite(body.strength10) ? Number(body.strength10) : null,
    };
    list.push(rec); await mixesStore.setAll(list);
    res.status(201).json({ ok:true, id:rec.id });
  } catch (e) { console.error(e); res.status(500).json({ error:'server error' }); }
});
app.delete('/api/mixes/:id', async (req, res) => {
  try {
    const id = String(req.params.id||'').trim();
    if (!id) return res.status(400).json({ error:'id required' });
    const list = await mixesStore.getAll();
    const target = list.find(m=>m?.id===id);
    if (!target) return res.status(404).json({ error:'not found' });
    const reqAuthor = getAuthorIdFromReq(req);
    const isAdmin = ADMIN_TOKEN && (req.get('X-Admin-Token') === ADMIN_TOKEN);
    const isAuthor = reqAuthor && String(reqAuthor) === String(target.authorId||'');
    if (!isAdmin && !isAuthor) return res.status(403).json({ error:'forbidden' });
    const next = list.filter(m=>m?.id!==id);
    await mixesStore.setAll(next);
    res.status(204).end();
  } catch (e) { console.error(e); res.status(500).json({ error:'server error' }); }
});

// ===================== СТАТИКА (фронт) =====================
// Папка с фронтом: /public (index.html)
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR, { maxAge: '1h' }));

// SPA-фолбэк: все НЕ /api/* маршруты отдать index.html
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ---------- 404 для прочих (на всякий случай) ----------
app.use((req, res) => res.status(404).json({ error: 'not found' }));

// ---------- старт ----------
app.listen(PORT, async () => {
  await ensureDir(DATA_DIR);
  if (!fs.existsSync(path.join(DATA_DIR, 'flavors.json'))) {
    await writeJsonAtomic(path.join(DATA_DIR, 'flavors.json'), []);
  }
  if (!fs.existsSync(path.join(DATA_DIR, 'mixes.json'))) {
    await writeJsonAtomic(path.join(DATA_DIR, 'mixes.json'), []);
  }
  console.log(`Server started on port ${PORT}`);
  console.log(`DATA_DIR: ${DATA_DIR}`);
});
