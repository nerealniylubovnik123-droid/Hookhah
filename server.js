// server.js — простой backend для гостевых миксов

const express = require('express');
const cors = require('cors');
const fs = require('fs/promises');
const path = require('path');

const PORT = process.env.PORT || 8080;
const DATA_FILE = path.join(__dirname, 'guest_mixes.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use('/', express.static(PUBLIC_DIR));

// читаем JSON
async function readJson() {
  try {
    const buf = await fs.readFile(DATA_FILE, 'utf8');
    return JSON.parse(buf);
  } catch {
    return [];
  }
}

// пишем JSON
async function writeJson(data) {
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// список миксов
app.get('/api/mixes', async (req, res) => {
  const mixes = await readJson();
  res.json(mixes);
});

// добавить микс
app.post('/api/mixes', async (req, res) => {
  const body = req.body;
  if (!body || !body.title || !Array.isArray(body.parts)) {
    return res.status(400).json({ error: 'Invalid mix' });
  }
  const mixes = await readJson();
  const newMix = {
    id: Date.now().toString(),
    ...body,
    createdAt: Date.now(),
  };
  mixes.unshift(newMix);
  await writeJson(mixes);
  res.status(201).json(newMix);
});

// удалить микс по id
app.delete('/api/mixes/:id', async (req, res) => {
  const id = req.params.id;
  let mixes = await readJson();
  mixes = mixes.filter(m => m.id !== id);
  await writeJson(mixes);
  res.status(204).end();
});

app.listen(PORT, async () => {
  try { await fs.access(DATA_FILE); } catch { await writeJson([]); }
  console.log(`✅ Server started: http://localhost:${PORT}`);
});
