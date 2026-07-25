'use strict';

// Almacenamiento sencillo en un fichero JSON (data/db.json).
// Sin dependencias externas: suficiente para una gestoría pequeña/mediana.
// Si en el futuro hace falta más volumen, se puede migrar a SQLite/Postgres
// manteniendo la misma interfaz.

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const EMPTY_DB = {
  clients: [],
  messages: [],
  cases: [],
  templates: [],
  reminders: [],
  campaigns: [],
  appointments: [],
  fichas: [],
};

// db.settings es un objeto (configuración de automatizaciones, etc.).

let db = null;
let saveTimer = null;

function load() {
  if (db) return db;
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    db = JSON.parse(JSON.stringify(EMPTY_DB));
  }
  for (const key of Object.keys(EMPTY_DB)) {
    if (!Array.isArray(db[key])) db[key] = [];
  }
  if (!db.settings || typeof db.settings !== 'object') db.settings = {};
  return db;
}

function save() {
  // Escritura agrupada para no golpear el disco en cada petición.
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DB_FILE);
  }, 50);
}

let idCounter = Date.now();
function newId(prefix) {
  idCounter += 1;
  return `${prefix}_${idCounter.toString(36)}`;
}

// Normaliza un teléfono al formato E.164 sin el signo "+" (como lo usa
// la API de WhatsApp). Ej.: "612 34 56 78" -> "34612345678" (España por defecto).
function normalizePhone(raw, defaultCountryCode = '34') {
  if (!raw) return '';
  let digits = String(raw).replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('00')) digits = digits.slice(2);
  // Móvil/fijo español de 9 cifras sin prefijo internacional.
  if (digits.length === 9 && /^[6789]/.test(digits)) {
    digits = defaultCountryCode + digits;
  }
  return digits;
}

module.exports = { load, save, newId, normalizePhone, DB_FILE };
