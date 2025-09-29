// server.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// --- статика фронта ---
const PUBLIC_DIR = path.join(__dirname, "public");
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
}

// --- файлы хранилища (создадим, если нет) ---
const FLAVORS_FILE = path.join(__dirname, "flavors.json");
const MIXES_FILE   = path.join(__dirname, "guest_mixes.json");
const BANNED_FILE  = path.join(__dirname, "banned_words.json");

function readJSON(f, fb=[]) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fb; } }
function writeJSON(f, data) { fs.writeFileSync(f, JSON.stringify(data, null, 2), "utf8"); }

if (!fs.existsSync(FLAVORS_FILE)) writeJSON(FLAVORS_FILE, []);
if (!fs.existsSync(MIXES_FILE))   writeJSON(MIXES_FILE, []);
if (!fs.existsSync(BANNED_FILE))  writeJSON(BANNED_FILE, ["спайс","наркотик","18+","xxx"]);

const normalize = s => String(s||"").toLowerCase().replace(/ё/g,"е");
const uniq = a => Array.from(new Set(a));
const findBannedInText = (t, list) => {
  const tt = normalize(t);
  const hits = [];
  for (const w of list||[]) { const ww = normalize(w); if (ww && tt.includes(ww)) hits.push(w); }
  return uniq(hits);
};

// --- HEALTH ---
app.get("/api/healthz", (req,res)=> res.json({ ok:true, time:Date.now(), uptime:process.uptime() }));

// --- BANNED WORDS ---
app.get("/api/banned-words", (req,res)=> res.json({ words: readJSON(BANNED_FILE, []) }));
app.post("/api/banned-words", (req,res)=>{
  const token = req.header("X-Admin-Token");
  if (!token || token !== (process.env.ADMIN_TOKEN || "")) {
    return res.status(403).json({ error: "Forbidden (bad admin token)" });
  }
  const words = Array.isArray(req.body?.words) ? req.body.words.map(String) : [];
  writeJSON(BANNED_FILE, words);
  res.json({ ok:true, words });
});

// --- FLAVORS ---
app.get("/api/flavors", (req,res)=> res.json(readJSON(FLAVORS_FILE, [])));
app.post("/api/flavors", (req,res)=>{
  const token = req.header("X-Admin-Token");
  if (!token || token !== (process.env.ADMIN_TOKEN || "")) {
    return res.status(403).json({ error: "Forbidden (bad admin token)" });
  }
  const body = req.body || {};
  if (body.action === "delete") {
    const brand = String(body.brand||"").trim();
    const name  = String(body.name||"").trim();
    if (!brand || !name) return res.status(400).json({ error:"brand and name are required" });
    const idCandidate = (brand+"-"+name).toLowerCase().replace(/\s+/g,"-");
    const flavors = readJSON(FLAVORS_FILE, []);
    const idx = flavors.findIndex(f => f.id===idCandidate || (String(f.brand).trim()===brand && String(f.name).trim()===name));
    if (idx===-1) return res.status(404).json({ error:"not found" });
    flavors.splice(idx,1); writeJSON(FLAVORS_FILE, flavors);
    return res.json({ ok:true, deletedId:idCandidate });
  }
  if (!body.brand || !body.name) return res.status(400).json({ error:"brand and name are required" });
  const flavors = readJSON(FLAVORS_FILE, []);
  const id = (String(body.brand)+"-"+String(body.name)).toLowerCase().replace(/\s+/g,"-");
  if (flavors.some(f=>f.id===id)) return res.status(409).json({ error:"id already exists" });
  flavors.push({ ...body, id }); writeJSON(FLAVORS_FILE, flavors);
  res.json({ ok:true, flavor:{ ...body, id } });
});

// --- MIXES ---
app.get("/api/mixes", (req,res)=>{
  const mixes = readJSON(MIXES_FILE, []);
  mixes.sort((a,b)=>(b?.createdAt||0)-(a?.createdAt||0));
  res.json(mixes);
});
app.post("/api/mixes", (req,res)=>{
  const body = req.body || {};
  const banned = readJSON(BANNED_FILE, []);
  const hits = uniq([ ...findBannedInText(body.title, banned), ...findBannedInText(body.notes, banned) ]);
  if (hits.length) return res.status(400).json({ error:"banned_words", banned:hits });

  const mixes = readJSON(MIXES_FILE, []);
  const id = String(Date.now()) + Math.random().toString(16).slice(2);
  const mix = {
    id,
    title: String(body.title||"Без названия").slice(0,120),
    parts: Array.isArray(body.parts) ? body.parts : [],
    notes: String(body.notes||""),
    author: String(body.author||""),
    authorId: body.authorId==null ? null : String(body.authorId),
    createdAt: Date.now(),
    taste: body.taste ?? null,
    strength10: body.strength10 ?? null
  };
  mixes.push(mix); writeJSON(MIXES_FILE, mixes);
  res.json(mix);
});
app.delete("/api/mixes/:id", (req,res)=>{
  const id = String(req.params.id);
  const userId = req.header("X-User-Id") || null;
  const mixes = readJSON(MIXES_FILE, []);
  const idx = mixes.findIndex(m=>m.id===id);
  if (idx===-1) return res.status(404).json({ error:"Not found" });

  const mix = mixes[idx];
  if (mix.authorId && userId && String(mix.authorId)===String(userId)) {
    mixes.splice(idx,1); writeJSON(MIXES_FILE, mixes); return res.json({ ok:true });
  }
  if (!mix.authorId && userId==="admin") {
    mixes.splice(idx,1); writeJSON(MIXES_FILE, mixes); return res.json({ ok:true, note:"deleted legacy mix by admin" });
  }
  return res.status(403).json({ error:"Forbidden" });
});

// --- SPA fallback (СТРОГО ПОСЛЕ API!) ---
if (fs.existsSync(PUBLIC_DIR)) {
  app.get("*", (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
  });
}

app.listen(PORT, ()=> console.log(`✅ http://localhost:${PORT}`));
