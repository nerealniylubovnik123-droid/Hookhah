/**
 * Minimal Express server with admin delete of guest mixes.
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
const GUEST_MIXES_FILE = process.env.GUEST_MIXES_FILE || path.join(DATA_DIR, 'guest_mixes.json');
const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(__dirname, 'public');

app.use(express.json({limit: '1mb'}));

// utils
async function ensureData() {
  try { await fs.mkdir(DATA_DIR, { recursive: true }); } catch(e){}
  if (!fssync.existsSync(GUEST_MIXES_FILE)) await fs.writeFile(GUEST_MIXES_FILE, '[]', 'utf-8');
}
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }
async function readJSON(file, fallback = []){ try{ return JSON.parse(await fs.readFile(file,'utf-8')||'[]'); }catch(e){ return fallback; } }
async function writeJSON(file, data){
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data,null,2), 'utf-8');
  await fs.rename(tmp, file);
}
function isAdmin(req){
  if (!ADMIN_KEY) return true;
  const key = req.get('x-admin-key') || req.query.adminKey || '';
  return key === ADMIN_KEY;
}

// endpoints
app.get('/api/health', (req,res)=> res.json({ ok:true }));

app.get('/api/guest-mixes', async (req,res)=>{
  await ensureData();
  const list = await readJSON(GUEST_MIXES_FILE, []);
  list.sort((a,b)=> new Date(b.createdAt||0) - new Date(a.createdAt||0));
  res.json(list);
});

app.post('/api/guest-mixes', async (req,res)=>{
  await ensureData();
  const list = await readJSON(GUEST_MIXES_FILE, []);
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
    notes: body.notes || '',
  };
  let sum = (mix.parts||[]).reduce((s,p)=> s + (Number(p?.percent)||0), 0);
  if (sum !== 100 && sum > 0){
    mix.parts = mix.parts.map(p=>({ flavorId:p.flavorId, percent: Math.round((Number(p.percent)||0)/sum*100) }));
    const fix = 100 - mix.parts.reduce((s,p)=> s + (Number(p?.percent)||0), 0);
    if (mix.parts.length) mix.parts[mix.parts.length-1].percent += fix;
  }
  list.push(mix);
  await writeJSON(GUEST_MIXES_FILE, list);
  res.status(201).json(mix);
});

// delete (любой из трёх маршрутов)
app.delete('/api/guest-mixes/:id', async (req,res)=>{
  if (!isAdmin(req)) return res.status(403).json({ ok:false, error:'forbidden' });
  await ensureData();
  const id = String(req.params.id||'').trim();
  const list = await readJSON(GUEST_MIXES_FILE, []);
  const next = list.filter(m=>m && String(m.id)!==id);
  await writeJSON(GUEST_MIXES_FILE, next);
  res.json({ ok:true, deleted: next.length !== list.length });
});
app.delete('/api/guest-mixes', async (req,res)=>{
  if (!isAdmin(req)) return res.status(403).json({ ok:false, error:'forbidden' });
  await ensureData();
  const id = String(req.query.id||'').trim();
  const list = await readJSON(GUEST_MIXES_FILE, []);
  const next = list.filter(m=>m && String(m.id)!==id);
  await writeJSON(GUEST_MIXES_FILE, next);
  res.json({ ok:true, deleted: next.length !== list.length });
});
app.post('/api/delete-guest-mix', async (req,res)=>{
  if (!isAdmin(req)) return res.status(403).json({ ok:false, error:'forbidden' });
  await ensureData();
  const id = String((req.body&&req.body.id)||'').trim();
  const list = await readJSON(GUEST_MIXES_FILE, []);
  const next = list.filter(m=>m && String(m.id)!==id);
  await writeJSON(GUEST_MIXES_FILE, next);
  res.json({ ok:true, deleted: next.length !== list.length });
});

// likes
app.post('/api/guest-mixes/:id/like', async (req,res)=>{
  await ensureData();
  const id = String(req.params.id||'').trim();
  const userId = String((req.body && req.body.userId) || 'anon');
  const list = await readJSON(GUEST_MIXES_FILE, []);
  const mix = list.find(m=>m && String(m.id)===id);
  if (!mix) return res.json({ ok:true, liked:false });
  mix.likers = Array.isArray(mix.likers)? mix.likers : [];
  if (!mix.likers.includes(userId)) mix.likers.push(userId);
  await writeJSON(GUEST_MIXES_FILE, list);
  res.json({ ok:true, liked:true, likes: mix.likers.length });
});
app.delete('/api/guest-mixes/:id/like', async (req,res)=>{
  await ensureData();
  const id = String(req.params.id||'').trim();
  const userId = String((req.body && req.body.userId) || 'anon');
  const list = await readJSON(GUEST_MIXES_FILE, []);
  const mix = list.find(m=>m && String(m.id)===id);
  if (!mix) return res.json({ ok:true, liked:false });
  mix.likers = Array.isArray(mix.likers)? mix.likers : [];
  const i = mix.likers.indexOf(userId);
  if (i>=0) mix.likers.splice(i,1);
  await writeJSON(GUEST_MIXES_FILE, list);
  res.json({ ok:true, liked:false, likes: mix.likers.length });
});

// static
if (fssync.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
  app.get('/', (req,res)=> res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
} else {
  const fallbackIndex = path.join(__dirname, 'index.html');
  if (fssync.existsSync(fallbackIndex)) {
    app.get('/', (req,res)=> res.sendFile(fallbackIndex));
  }
}

app.listen(PORT, ()=> console.log('Server on :' + PORT));
