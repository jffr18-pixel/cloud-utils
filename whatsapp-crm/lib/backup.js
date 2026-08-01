'use strict';

// Copias de seguridad de la base de datos (data/db.json → data/backups/*).
// Se crea una automáticamente cada día y se conservan las últimas 14.
//
// Cifrado: si se define BACKUP_ENCRYPTION_KEY, cada copia se cifra con
// AES-256-GCM (formato del fichero: [IV 12B][tag 16B][cifrado]) y el nombre
// acaba en «.json.gz.enc». Sin la clave, se guarda en claro («.json.gz»).
//
// Los adjuntos (data/uploads/) no van en este .gz: server.js los sincroniza
// aparte a SharePoint cuando Microsoft 365 está configurado.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { load, DB_FILE } = require('./store');

const BACKUPS_DIR = path.join(path.dirname(DB_FILE), 'backups');
const KEEP = 14;
const NAME_RE = /^backup-[\d-]+\.json\.gz(\.enc)?$/;

function stamp(date = new Date(), withTime = false) {
  const p = (n) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}`;
  return withTime ? `${day}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}` : day;
}

// Clave de cifrado (32 bytes) derivada de BACKUP_ENCRYPTION_KEY, o null.
function encKey() {
  const k = process.env.BACKUP_ENCRYPTION_KEY;
  if (!k || !String(k).trim()) return null;
  return crypto.createHash('sha256').update(String(k)).digest();
}
function encrypt(buf, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(buf), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]);
}
function decrypt(buf, key) {
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
}

function isEncrypted() { return !!encKey(); }

function list() {
  if (!fs.existsSync(BACKUPS_DIR)) return [];
  return fs.readdirSync(BACKUPS_DIR)
    .filter((f) => NAME_RE.test(f))
    .map((f) => {
      const st = fs.statSync(path.join(BACKUPS_DIR, f));
      return { name: f, size: st.size, createdAt: st.mtimeMs, encrypted: f.endsWith('.enc') };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

function rotate() {
  for (const b of list().slice(KEEP)) {
    fs.rmSync(path.join(BACKUPS_DIR, b.name), { force: true });
  }
}

// Escribe una copia con el gzip dado, cifrándolo si hay clave.
function writeBackup(baseName, gz) {
  const key = encKey();
  const name = key ? baseName + '.enc' : baseName;
  const data = key ? encrypt(gz, key) : gz;
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  fs.writeFileSync(path.join(BACKUPS_DIR, name), data);
  rotate();
  return { name, size: data.length, encrypted: !!key };
}

function create(withTime = true) {
  const gz = zlib.gzipSync(JSON.stringify(load(), null, 2));
  return writeBackup(`backup-${stamp(new Date(), withTime)}.json.gz`, gz);
}

// Crea la copia del día si aún no existe (por si se usa fuera del planificador).
function ensureDaily() {
  const base = `backup-${stamp()}.json.gz`;
  if (fs.existsSync(path.join(BACKUPS_DIR, base)) || fs.existsSync(path.join(BACKUPS_DIR, base + '.enc'))) return null;
  const gz = zlib.gzipSync(JSON.stringify(load(), null, 2));
  return writeBackup(base, gz);
}

// Devuelve el gzip (descifrado si hacía falta) de una copia, o null.
function readGz(name) {
  if (!NAME_RE.test(name)) return null;
  const full = path.join(BACKUPS_DIR, name);
  if (!fs.existsSync(full)) return null;
  let buf = fs.readFileSync(full);
  if (name.endsWith('.enc')) {
    const key = encKey();
    if (!key) return null; // cifrada pero sin clave: no se puede leer
    try { buf = decrypt(buf, key); } catch { return null; }
  }
  return buf;
}

// Para la descarga: devuelve el .json.gz listo para abrir (descifrado).
function readDownload(name) {
  const gz = readGz(name);
  if (!gz) return null;
  return { buffer: gz, filename: name.replace(/\.enc$/, '') };
}

// Restaura el objeto de datos de una copia (para recuperación o restauración).
function restoreData(name) {
  const gz = readGz(name);
  if (!gz) return null;
  try { return JSON.parse(zlib.gunzipSync(gz).toString('utf8')); } catch { return null; }
}

function latestName() {
  const l = list();
  return l.length ? l[0].name : null;
}

// Borra una copia local (p. ej. tras subirla a la nube en modo «solo nube»).
function remove(name) {
  if (!NAME_RE.test(name)) return false;
  const full = path.join(BACKUPS_DIR, name);
  if (!fs.existsSync(full)) return false;
  fs.rmSync(full, { force: true });
  return true;
}

module.exports = {
  list, create, ensureDaily, readDownload, restoreData, latestName, remove,
  isEncrypted, BACKUPS_DIR,
};
