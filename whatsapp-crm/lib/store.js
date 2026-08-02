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
  forms: [], // formularios JotForm embebidos: [{ id, name, url }]
  scheduledMessages: [], // mensajes programados: [{ id, clientId, text, sendAt, status }]
  tasks: [], // tareas del equipo: [{ id, title, assignee, status, dueDate, clientId }]
  signatures: [], // solicitudes de firma: [{ id, clientId, caseId, title, status, token }]
  knowledge: [], // base de conocimiento: [{ id, title, area, keywords, fee, tax, docs, notes }]
  // Reservas de cita pendientes de pago (SumUp o transferencia). El hueco se
  // retiene hasta que el pago se confirma (entonces pasa a db.appointments) o
  // hasta que caduca: [{ id, clientId, date, time, method, amount, status, checkoutId, ... }]
  pendingBookings: [],
};

// db.settings es un objeto (configuración de automatizaciones, etc.).

let db = null;
let saveTimer = null;
let dirty = false;
let saveErrorHandler = null;

// server.js registra aquí un aviso (p. ej. por Telegram) para que un error al
// guardar en disco no pase desapercibido.
function setSaveErrorHandler(fn) { saveErrorHandler = typeof fn === 'function' ? fn : null; }

function normalizeDb(obj) {
  const d = obj && typeof obj === 'object' ? obj : {};
  for (const key of Object.keys(EMPTY_DB)) {
    if (!Array.isArray(d[key])) d[key] = [];
  }
  if (!d.settings || typeof d.settings !== 'object') d.settings = {};
  return d;
}

function load() {
  if (db) return db;
  let raw = null;
  try {
    raw = fs.readFileSync(DB_FILE, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      // Primer arranque: el fichero aún no existe, se empieza en blanco. Normal.
      db = normalizeDb(JSON.parse(JSON.stringify(EMPTY_DB)));
      return db;
    }
    // Un fallo de lectura real (permisos, disco) NO debe vaciar la base: mejor
    // fallar ruidosamente que continuar como si no hubiera datos.
    throw err;
  }
  try {
    db = normalizeDb(JSON.parse(raw));
  } catch (err) {
    // El fichero EXISTE pero está corrupto. Continuar con base vacía
    // sobrescribiría datos recuperables → se falla a propósito. La recuperación
    // (preservar el fichero dañado y restaurar la última copia) la hace el
    // arranque en server.js ANTES de llegar aquí.
    const e = new Error('db.json corrupto: ' + err.message);
    e.code = 'DB_CORRUPT';
    throw e;
  }
  return db;
}

function writeNow() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE); // renombrado atómico: nunca deja el fichero a medias
  dirty = false;
}

function save() {
  // Escritura agrupada para no golpear el disco en cada petición.
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      writeNow();
    } catch (err) {
      // Un error de disco (lleno, permisos) no debe tumbar el proceso en
      // silencio: se registra y se avisa, pero se sigue en pie.
      console.error('No se pudo guardar db.json:', err.message);
      if (saveErrorHandler) { try { saveErrorHandler(err); } catch { /* noop */ } }
    }
  }, 50);
}

// Descarta el estado en memoria y cualquier escritura pendiente SIN volcar (se
// usa tras restaurar una copia: el disco ya tiene la base buena y no queremos
// que el volcado de cierre sobrescriba con datos antiguos).
function reset() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  dirty = false;
  db = null;
}

// Fuerza el volcado pendiente a disco de inmediato. Se llama en el cierre
// ordenado (SIGTERM/SIGINT) para no perder la última acción en un redespliegue.
function flush() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (!dirty || !db) return true;
  try { writeNow(); return true; } catch (err) {
    console.error('No se pudo volcar db.json al cerrar:', err.message);
    if (saveErrorHandler) { try { saveErrorHandler(err); } catch { /* noop */ } }
    return false;
  }
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

module.exports = { load, save, flush, reset, setSaveErrorHandler, newId, normalizePhone, DB_FILE, DATA_DIR };
