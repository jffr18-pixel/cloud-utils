'use strict';

const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const { db, UPLOADS_DIR, STATUS_LABELS } = require('../db');
const { requireAuth } = require('../auth');
const { upload } = require('../upload');

const router = express.Router();
router.use(requireAuth); // todas las rutas de cliente exigen sesión

// Lista de trámites del cliente con su historial de actualizaciones.
router.get('/tramites', (req, res) => {
  const tramites = db
    .prepare('SELECT * FROM tramites WHERE user_id = ? ORDER BY updated_at DESC')
    .all(req.user.id);

  const updatesStmt = db.prepare(
    'SELECT status, note, created_at FROM tramite_updates WHERE tramite_id = ? ORDER BY created_at DESC'
  );
  const docsStmt = db.prepare(
    'SELECT id, original_name, mime, size, uploaded_by, created_at FROM documents WHERE tramite_id = ? ORDER BY created_at DESC'
  );

  for (const t of tramites) {
    t.status_label = STATUS_LABELS[t.status] || t.status;
    t.updates = updatesStmt.all(t.id);
    t.documents = docsStmt.all(t.id);
  }
  res.json(tramites);
});

// Todos los documentos del cliente (incluye los no asociados a un trámite).
router.get('/documents', (req, res) => {
  const docs = db
    .prepare(
      `SELECT d.id, d.original_name, d.mime, d.size, d.uploaded_by, d.created_at,
              d.tramite_id, t.title AS tramite_title
       FROM documents d
       LEFT JOIN tramites t ON t.id = d.tramite_id
       WHERE d.user_id = ?
       ORDER BY d.created_at DESC`
    )
    .all(req.user.id);
  res.json(docs);
});

// Subida de uno o varios documentos por parte del cliente.
router.post('/documents', upload.array('files', 10), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No se ha recibido ningún archivo' });
  }

  // Si se indica un trámite, debe pertenecer al cliente.
  let tramiteId = null;
  if (req.body.tramite_id) {
    const t = db
      .prepare('SELECT id FROM tramites WHERE id = ? AND user_id = ?')
      .get(Number(req.body.tramite_id), req.user.id);
    if (!t) {
      cleanup(req.files);
      return res.status(400).json({ error: 'Trámite no válido' });
    }
    tramiteId = t.id;
  }

  const insert = db.prepare(
    `INSERT INTO documents (user_id, tramite_id, original_name, stored_name, mime, size, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, 'client')`
  );
  const saved = [];
  for (const f of req.files) {
    const info = insert.run(
      req.user.id,
      tramiteId,
      f.originalname,
      f.filename,
      f.mimetype,
      f.size
    );
    saved.push({ id: Number(info.lastInsertRowid), original_name: f.originalname });
  }

  if (tramiteId) {
    db.prepare(
      `INSERT INTO tramite_updates (tramite_id, note, created_by)
       VALUES (?, ?, 'client')`
    ).run(tramiteId, `El cliente ha subido ${saved.length} documento(s).`);
    db.prepare("UPDATE tramites SET updated_at = datetime('now') WHERE id = ?").run(tramiteId);
  }

  res.status(201).json({ uploaded: saved.length, documents: saved });
});

// Descarga segura de un documento propio (resuelto por ID, nunca por ruta).
router.get('/documents/:id/download', (req, res) => {
  const doc = db
    .prepare('SELECT * FROM documents WHERE id = ? AND user_id = ?')
    .get(Number(req.params.id), req.user.id);
  if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });

  const filePath = path.join(UPLOADS_DIR, doc.stored_name);
  // Defensa frente a path traversal: el archivo debe estar dentro de UPLOADS_DIR.
  if (!filePath.startsWith(UPLOADS_DIR) || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Archivo no disponible' });
  }
  res.download(filePath, doc.original_name);
});

function cleanup(files) {
  for (const f of files || []) {
    fs.unlink(path.join(UPLOADS_DIR, f.filename), () => {});
  }
}

module.exports = router;
