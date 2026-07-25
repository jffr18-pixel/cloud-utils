'use strict';

// Copias de seguridad de la base de datos (data/db.json → data/backups/*.json.gz).
// Se crea una automáticamente cada día y se conservan las últimas 14.
// Los adjuntos (data/uploads/) no entran en el .gz diario: cópialos aparte
// si quieres respaldo completo de ficheros.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { load, DB_FILE } = require('./store');

const BACKUPS_DIR = path.join(path.dirname(DB_FILE), 'backups');
const KEEP = 14;

function stamp(date = new Date(), withTime = false) {
  const p = (n) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}`;
  return withTime ? `${day}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}` : day;
}

function list() {
  if (!fs.existsSync(BACKUPS_DIR)) return [];
  return fs.readdirSync(BACKUPS_DIR)
    .filter((f) => /^backup-[\d-]+\.json\.gz$/.test(f))
    .map((f) => {
      const st = fs.statSync(path.join(BACKUPS_DIR, f));
      return { name: f, size: st.size, createdAt: st.mtimeMs };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

function rotate() {
  for (const b of list().slice(KEEP)) {
    fs.rmSync(path.join(BACKUPS_DIR, b.name), { force: true });
  }
}

function create(withTime = true) {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  const name = `backup-${stamp(new Date(), withTime)}.json.gz`;
  const full = path.join(BACKUPS_DIR, name);
  const data = zlib.gzipSync(JSON.stringify(load(), null, 2));
  fs.writeFileSync(full, data);
  rotate();
  return { name, size: data.length };
}

// Crea la copia del día si aún no existe (la llama el planificador).
function ensureDaily() {
  const today = `backup-${stamp()}.json.gz`;
  if (fs.existsSync(path.join(BACKUPS_DIR, today))) return null;
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  const data = zlib.gzipSync(JSON.stringify(load(), null, 2));
  fs.writeFileSync(path.join(BACKUPS_DIR, today), data);
  rotate();
  return { name: today, size: data.length };
}

function read(name) {
  if (!/^backup-[\d-]+\.json\.gz$/.test(name)) return null;
  const full = path.join(BACKUPS_DIR, name);
  if (!fs.existsSync(full)) return null;
  return fs.createReadStream(full);
}

module.exports = { list, create, ensureDaily, read, BACKUPS_DIR };
