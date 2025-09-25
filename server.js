/**
 * Express server for Hookah Mixes
 * - Guest mixes CRUD (with admin delete)
 * - Flavors CRUD (admin)
 * - Serves frontend from ./public
 *
 * Storage: JSON files in ./data/
 */
const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const fssync = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(__dirname, 'public');

const FILES = {
  mixes: process.env.GUEST_MIXES_FILE || path.join(DATA_DIR, 'guest_mixes.json'),
  flavors: process.env.FLAVORS_FILE || path.join(DATA_DIR, 'flavors.json')
};

app.use(express.json({ limit: '2mb' }));

// ---------- utils ----------
async function ensureData() {
  await fs.mkdir(DATA_DIR, { recursive: true }).catch(()=>{});
  if (!fssync.existsSync(FILES.mixes)) await fs.writeFile(FILES.mixes, '[]', 'utf-8');
  if (!fssync.existsSync(FILES.flavors)) await fs.writeFile(FILES.flavors, '[]', 'utf-8');
}
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }
async function readJSON(file, fallback = []){ try { return JSON.parse(await fs.readFile(file, 'utf-8') || '[]'); } catch { return fallback; } }
async function writeJSON(file, data){
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  await fs.rename(tmp, file);
}
function isAdmin(req){
  if (!ADMIN_KEY) return true; // dev-friendly
  const key = req.get('x-admin-key') || req.query.adminKey || '';
  return key === ADMIN_KEY;
}

// ---------- health ----------
app.get('/api/health', (req, res) => res.json({ ok: true }));

// ---------- flavors ----------
// List/search flavors
app.get(['/api/flavors', '/api/all-flavors'], async (req, res) => {
  await ensureData();
  const q = String(req.query.q || '').toLowerCase();
  let list = await readJSON(FILES.flavors, []);
  if (q) list = list.filter(f => (`${f.brand||''} ${f.name||f.title||''} ${(f.tags||[]).join(' ')}`.toLowerCase().includes(q)));
  res.json(list);
});

// Create flavor (admin)
app.post(['/api/flavors', '/api/add-flavor', '/api/flavors/add'], async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'forbidden' });
  await ensureData();
  const body = req.body || {};
  const list = await readJSON(FILES.flavors, []);
  const id = String(body.id || uuid());
  const f = {
    id,
    brand: String(body.brand || body.producer || '').trim(),
    name: String(body.name || body.title || '').trim(),
    strength: Number(body.strength || body.strength10 || 5),
    tags: Array.isArray(body.tags) ? Array.from(new Set(body.tags.map(x=>String(x).toLowerCase()))) : []
  };
  if (!f.brand || !f.name) return res.status(400).json({ ok:false, error:'brand and name required' });
  list.push(f);
  await writeJSON(FILES.flavors, list);
  res.status(201).json({ ok: true, flavor: f });
});

// Update flavor (admin)
app.put('/api/flavors/:id', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'forbidden' });
  await ensureData();
  const id = String(req.params.id || '');
  const list = await readJSON(FILES.flavors, []);
  const i = list.findIndex(f => f && String(f.id) === id);
  if (i < 0) return res.status(404).json({ ok:false, error:'not_found' });
  const body = req.body || {};
  ['brand','name','title','strength','tags'].forEach(k=>{
    if (body[k] !== undefined){
      if (k === 'title') list[i].name = String(body[k]||'').trim();
      else if (k === 'strength') list[i].strength = Number(body[k]);
      else if (k === 'tags') list[i].tags = Array.isArray(body[k]) ? Array.from(new Set(body[k].map(x=>String(x).toLowerCase()))) : [];
      else list[i][k] = (typeof body[k] === 'string') ? body[k].trim() : body[k];
    }
  });
  await writeJSON(FILES.flavors, list);
  res.json({ ok:true, flavor: list[i] });
});

// Delete flavor (admin)
app.delete('/api/flavors/:id', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'forbidden' });
  await ensureData();
  const id = String(req.params.id || '');
  const list = await readJSON(FILES.flavors, []);
  const next = list.filter(f => f && String(f.id) !== id);
  await writeJSON(FILES.flavors, next);
  res.json({ ok:true, deleted: next.length !== list.length });
});

// ---------- guest mixes ----------
app.get('/api/guest-mixes', async (req,res)=>{
  await ensureData();
  const list = await readJSON(FILES.mixes, []);
  list.sort((a,b)=> new Date(b.createdAt||0) - new Date(a.createdAt||0));
  res.json(list);
});

app.post('/api/guest-mixes', async (req,res)=>{
  await ensureData();
  const list = await readJSON(FILES.mixes, []);
  const body = req.body || {};
  const id = String(body.id || uuid());
  const now = new Date().toISOString();
  const mix = {
    id,
    title: body.title || 'Без названия',
    parts: Array.isArray(body.parts) ? body.parts : [],
    author: body.author || body.userName || 'гость',
    createdAt: now,
    likers: Array.isArray(body.likers) ? [...new Set(body.likers.map(String))] : [],
    notes: body.notes || ''
  };
  // normalize percents
  let sum = (mix.parts || []).reduce((s,p)=> s + (Number(p?.percent)||0), 0);
  if (sum !== 100 && sum > 0){
    mix.parts = mix.parts.map(p => ({ flavorId: p.flavorId, percent: Math.round((Number(p.percent)||0) / sum * 100) }));
    const fix = 100 - mix.parts.reduce((s,p)=> s + (Number(p?.percent)||0), 0);
    if (mix.parts.length) mix.parts[mix.parts.length-1].percent += fix;
  }
  list.push(mix);
  await writeJSON(FILES.mixes, list);
  res.status(201).json(mix);
});

// delete mix (three variants)
function adminGuard(req, res, next){ if (!isAdmin(req)) return res.status(403).json({ ok:false, error:'forbidden' }); next(); }
app.delete('/api/guest-mixes/:id', adminGuard, async (req,res)=>{
  await ensureData();
  const id = String(req.params.id || '').trim();
  const list = await readJSON(FILES.mixes, []);
  const next = list.filter(m => m && String(m.id) !== id);
  await writeJSON(FILES.mixes, next);
  res.json({ ok:true, deleted: next.length !== list.length });
});
app.delete('/api/guest-mixes', adminGuard, async (req,res)=>{
  await ensureData();
  const id = String(req.query.id || '').trim();
  const list = await readJSON(FILES.mixes, []);
  const next = list.filter(m => m && String(m.id) !== id);
  await writeJSON(FILES.mixes, next);
  res.json({ ok:true, deleted: next.length !== list.length });
});
app.post('/api/delete-guest-mix', adminGuard, async (req,res)=>{
  await ensureData();
  const id = String((req.body && req.body.id) || '').trim();
  const list = await readJSON(FILES.mixes, []);
  const next = list.filter(m => m && String(m.id) !== id);
  await writeJSON(FILES.mixes, next);
  res.json({ ok:true, deleted: next.length !== list.length });
});

// likes
app.post('/api/guest-mixes/:id/like', async (req,res)=>{
  await ensureData();
  const id = String(req.params.id||'').trim();
  const userId = String((req.body && req.body.userId) || 'anon');
  const list = await readJSON(FILES.mixes, []);
  const mix = list.find(m => m && String(m.id) === id);
  if (!mix) return res.json({ ok:true, liked:false });
  mix.likers = Array.isArray(mix.likers) ? mix.likers : [];
  if (!mix.likers.includes(userId)) mix.likers.push(userId);
  await writeJSON(FILES.mixes, list);
  res.json({ ok:true, liked:true, likes: mix.likers.length });
});
app.delete('/api/guest-mixes/:id/like', async (req,res)=>{
  await ensureData();
  const id = String(req.params.id||'').trim();
  const userId = String((req.body && req.body.userId) || 'anon');
  const list = await readJSON(FILES.mixes, []);
  const mix = list.find(m => m && String(m.id) === id);
  if (!mix) return res.json({ ok:true, liked:false });
  mix.likers = Array.isArray(mix.likers) ? mix.likers : [];
  const i = mix.likers.indexOf(userId);
  if (i >= 0) mix.likers.splice(i,1);
  await writeJSON(FILES.mixes, list);
  res.json({ ok:true, liked:false, likes: mix.likers.length });
});

// ---------- static ----------
if (fssync.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
  app.get('/', (req,res)=> res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
}

app.listen(PORT, ()=>{
  console.log(`Server started on :${PORT}`);
  console.log(`Data dir: ${DATA_DIR}`);
  if (ADMIN_KEY) console.log('ADMIN_KEY set: required for admin actions');
  else console.log('ADMIN_KEY not set: admin actions allowed (dev mode)');
});
