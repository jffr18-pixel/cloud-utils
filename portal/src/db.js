'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

// La base de datos y los archivos subidos viven fuera del control de versiones.
const DATA_DIR = path.join(__dirname, '..', 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const DB_PATH = path.join(DATA_DIR, 'portal.db');

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);

// Buenas prácticas de SQLite: claves foráneas y modo WAL para concurrencia.
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    role          TEXT NOT NULL DEFAULT 'client' CHECK (role IN ('client','admin')),
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    phone         TEXT,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tramites (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    type        TEXT,
    status      TEXT NOT NULL DEFAULT 'recibido'
                CHECK (status IN ('recibido','en_proceso','pendiente_documentacion','presentado','resuelto')),
    description TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tramite_updates (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    tramite_id INTEGER NOT NULL REFERENCES tramites(id) ON DELETE CASCADE,
    status     TEXT,
    note       TEXT,
    created_by TEXT NOT NULL DEFAULT 'admin',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS documents (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tramite_id    INTEGER REFERENCES tramites(id) ON DELETE SET NULL,
    original_name TEXT NOT NULL,
    stored_name   TEXT NOT NULL,
    mime          TEXT,
    size          INTEGER,
    uploaded_by   TEXT NOT NULL DEFAULT 'client' CHECK (uploaded_by IN ('client','admin')),
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_tramites_user      ON tramites(user_id);
  CREATE INDEX IF NOT EXISTS idx_documents_user     ON documents(user_id);
  CREATE INDEX IF NOT EXISTS idx_documents_tramite  ON documents(tramite_id);
  CREATE INDEX IF NOT EXISTS idx_updates_tramite    ON tramite_updates(tramite_id);
`);

// Etiquetas legibles de los estados (las usa también el frontend vía /api/meta).
const STATUS_LABELS = {
  recibido: 'Recibido',
  en_proceso: 'En proceso',
  pendiente_documentacion: 'Pendiente de documentación',
  presentado: 'Presentado ante la administración',
  resuelto: 'Resuelto',
};

module.exports = { db, DATA_DIR, UPLOADS_DIR, DB_PATH, STATUS_LABELS };
