// server.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const bodyParser = require("body-parser");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 8080;

// Включаем CORS и JSON
app.use(cors());
app.use(bodyParser.json());

// Пути к JSON
const FLAVORS_FILE = path.join(__dirname, "flavors.json");
const MIXES_FILE = path.join(__dirname, "guest_mixes.json");

// Хелпер: загрузка файла
function loadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return [];
  }
}

// Хелпер: сохранение файла
function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

// ---- API ----

// Healthcheck
app.get("/healthz", (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// Все вкусы
app.get("/api/flavors", (req, res) => {
  res.json(loadJson(FLAVORS_FILE));
});

// Добавление вкуса (только админ с токеном)
app.post("/api/flavors", (req, res) => {
  const token = req.header("X-Admin-Token");
  if (token !== process.env.ADMIN_TOKEN) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const flavors = loadJson(FLAVORS_FILE);
  const newFlavor = req.body;
  flavors.push(newFlavor);
  saveJson(FLAVORS_FILE, flavors);

  res.json({ ok: true, flavor: newFlavor });
});

// Все миксы
app.get("/api/mixes", (req, res) => {
  res.json(loadJson(MIXES_FILE));
});

// Добавить микс
app.post("/api/mixes", (req, res) => {
  const mixes = loadJson(MIXES_FILE);
  const newMix = { ...req.body, id: Date.now().toString() };
  mixes.push(newMix);
  saveJson(MIXES_FILE, mixes);
  res.json({ ok: true, mix: newMix });
});

// Удалить микс (только автор)
app.delete("/api/mixes/:id", (req, res) => {
  const id = req.params.id;
  const mixes = loadJson(MIXES_FILE);
  const filtered = mixes.filter(m => m.id !== id);
  if (filtered.length === mixes.length) {
    return res.status(404).json({ error: "Not found" });
  }
  saveJson(MIXES_FILE, filtered);
  res.json({ ok: true });
});

// Запуск
app.listen(PORT, () => {
  console.log(`✅ Server started: http://localhost:${PORT}`);
});
