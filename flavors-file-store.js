// flavors-file-store.js
// Хранилище вкусов в JSON-файле с безопасной записью (atomic rename)

const fs = require('fs/promises');
const fssync = require('fs');
const path = require('path');

const DATA_DIR  = process.env.DATA_DIR || path.resolve(__dirname, 'data');
const FILE_PATH = path.join(DATA_DIR, 'flavors.json');
const TMP_PATH  = path.join(DATA_DIR, 'flavors.json.tmp');

function makeId(brand, name) {
  return (String(brand).trim() + '-' + String(name).trim())
    .toLowerCase()
    .replace(/\s+/g, '-');
}

async function ensureDirAndFile() {
  if (!fssync.existsSync(DATA_DIR)) {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }
  if (!fssync.existsSync(FILE_PATH)) {
    await fs.writeFile(FILE_PATH, '[]', 'utf8');
  }
}

async function readAll() {
  await ensureDirAndFile();
  const txt = await fs.readFile(FILE_PATH, 'utf8').catch(() => '[]');
  try {
    const arr = JSON.parse(txt);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function writeAll(list) {
  await ensureDirAndFile();
  const json = JSON.stringify(list, null, 2);
  await fs.writeFile(TMP_PATH, json, 'utf8'); // пишем во временный
  await fs.rename(TMP_PATH, FILE_PATH);       // атомарно заменяем основной
}

async function getAll() {
  return readAll();
}

async function create({ brand, name, description = '', tags = [], strength10 }) {
  const b = String(brand || '').trim();
  const n = String(name || '').trim();
  if (!b || !n) throw new Error('brand and name required');

  const id = makeId(b, n);
  const list = await readAll();
  if (list.some(f => f.id === id)) {
    const e = new Error('id already exists');
    e.code = 'E_EXISTS';
    throw e;
  }
  const rec = {
    id,
    brand: b,
    name: n,
    description: String(description || ''),
    tags: Array.isArray(tags) ? tags.filter(Boolean) : [],
    strength10: Number.isFinite(strength10) ? Number(strength10) : undefined
  };
  list.push(rec);
  await writeAll(list);
  return rec;
}

async function remove(id) {
  const key = String(id || '').trim();
  if (!key) throw new Error('id required');

  const list = await readAll();
  const before = list.length;
  const next = list.filter(f => f.id !== key);
  if (next.length === before) {
    const e = new Error('not found');
    e.code = 'E_NOTFOUND';
    throw e;
  }
  await writeAll(next);
  return true;
}

module.exports = { getAll, create, remove, makeId, FILE_PATH, DATA_DIR };
