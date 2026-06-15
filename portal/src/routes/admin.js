'use strict';

const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const { db, UPLOADS_DIR, STATUS_LABELS } = require('../db');
const { requireAuth, requireAdmin, hashPassword } = require('../auth');
const { upload } = require('../upload');

const router = express.Router();
router.use(requireAuth, requireAdmin); // solo personal de la gestoría

const VALID_STATUS = Object.keys(STATUS_LABELS);

/* ----------------------- Clientes ----------------------- */

router.get('/clients', (req, res) => {
  const clients = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.phone, u.created_at,
              (SELECT COUNT(*) FROM tramites t WHERE t.user_id = u.id) AS tramites,
              (SELECT COUNT(*) FROM documents d WHERE d.user_id = u.id) AS documentos
       FROM users u
       WHERE u.role = 'client'
       ORDER BY u.created_at DESC`
    )
    .all();
  res.json(clients);
});

router.post('/clients', (req, res) => {
  const { name, email, phone, password } = req.body || {};
  if (!name || !email || !password || String(password).length < 8) {
    return res.status(400).json({ error: 'Nombre, email y contraseña (mín. 8 caracteres) son obligatorios' });
  }
  const normEmail = String(email).trim().toLowerCase();
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(normEmail);
  if (exists) return res.status(409).json({ error: 'Ya existe un usuario con ese email' });

  const info = db
    .prepare(
      `INSERT INTO users (role, name, email, phone, password_hash)
       VALUES ('client', ?, ?, ?, ?)`
    )
    .run(String(name).trim(), normEmail, phone ? String(phone).trim() : null, hashPassword(password));
  res.status(201).json({ id: Number(info.lastInsertRowid), name, email: normEmail });
});

// Detalle de un cliente con sus trámites y documentos.
router.get('/clients/:id', (req, res) => {
  const client = db
    .prepare("SELECT id, name, email, phone, created_at FROM users WHERE id = ? AND role = 'client'")
    .get(Number(req.params.id));
  if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });

  client.tramites = db
    .prepare('SELECT * FROM tramites WHERE user_id = ? ORDER BY updated_at DESC')
    .all(client.id);
  for (const t of client.tramites) {
    t.status_label = STATUS_LABELS[t.status] || t.status;
    t.updates = db
      .prepare('SELECT status, note, created_by, created_at FROM tramite_updates WHERE tramite_id = ? ORDER BY created_at DESC')
      .all(t.id);
    t.documents = db
      .prepare('SELECT id, original_name, mime, size, uploaded_by, created_at FROM documents WHERE tramite_id = ? ORDER BY created_at DESC')
      .all(t.id);
  }
  client.documents = db
    .prepare('SELECT id, original_name, mime, size, uploaded_by, tramite_id, created_at FROM documents WHERE user_id = ? ORDER BY created_at DESC')
    .all(client.id);
  res.json(client);
});

/* ----------------------- Trámites ----------------------- */

router.post('/tramites', (req, res) => {
  const { user_id, title, type, description, status } = req.body || {};
  if (!user_id || !title) {
    return res.status(400).json({ error: 'Cliente y título del trámite son obligatorios' });
  }
  const client = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'client'").get(Number(user_id));
  if (!client) return res.status(400).json({ error: 'Cliente no válido' });

  const initialStatus = VALID_STATUS.includes(status) ? status : 'recibido';
  const info = db
    .prepare(
      `INSERT INTO tramites (user_id, title, type, description, status)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(client.id, String(title).trim(), type || null, description || null, initialStatus);

  db.prepare(
    `INSERT INTO tramite_updates (tramite_id, status, note, created_by)
     VALUES (?, ?, 'Trámite creado', 'admin')`
  ).run(Number(info.lastInsertRowid), initialStatus);

  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

// Actualizar estado y/o añadir una nota visible para el cliente.
router.patch('/tramites/:id', (req, res) => {
  const tramite = db.prepare('SELECT * FROM tramites WHERE id = ?').get(Number(req.params.id));
  if (!tramite) return res.status(404).json({ error: 'Trámite no encontrado' });

  const { status, note } = req.body || {};
  if (!status && !note) {
    return res.status(400).json({ error: 'Indica un nuevo estado o una nota' });
  }
  if (status && !VALID_STATUS.includes(status)) {
    return res.status(400).json({ error: 'Estado no válido' });
  }

  if (status) {
    db.prepare("UPDATE tramites SET status = ?, updated_at = datetime('now') WHERE id = ?")
      .run(status, tramite.id);
  } else {
    db.prepare("UPDATE tramites SET updated_at = datetime('now') WHERE id = ?").run(tramite.id);
  }
  db.prepare(
    `INSERT INTO tramite_updates (tramite_id, status, note, created_by)
     VALUES (?, ?, ?, 'admin')`
  ).run(tramite.id, status || null, note || null);

  res.json({ ok: true });
});

/* ----------------------- Documentos ----------------------- */

// El gestor sube documentos para un cliente (p. ej. resoluciones).
router.post('/clients/:id/documents', upload.array('files', 10), (req, res) => {
  const client = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'client'").get(Number(req.params.id));
  if (!client) {
    cleanup(req.files);
    return res.status(404).json({ error: 'Cliente no encontrado' });
  }
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No se ha recibido ningún archivo' });
  }

  let tramiteId = null;
  if (req.body.tramite_id) {
    const t = db.prepare('SELECT id FROM tramites WHERE id = ? AND user_id = ?').get(Number(req.body.tramite_id), client.id);
    if (!t) { cleanup(req.files); return res.status(400).json({ error: 'Trámite no válido' }); }
    tramiteId = t.id;
  }

  const insert = db.prepare(
    `INSERT INTO documents (user_id, tramite_id, original_name, stored_name, mime, size, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, 'admin')`
  );
  let count = 0;
  for (const f of req.files) {
    insert.run(client.id, tramiteId, f.originalname, f.filename, f.mimetype, f.size);
    count += 1;
  }
  if (tramiteId) {
    db.prepare("INSERT INTO tramite_updates (tramite_id, note, created_by) VALUES (?, ?, 'admin')")
      .run(tramiteId, `La gestoría ha añadido ${count} documento(s).`);
    db.prepare("UPDATE tramites SET updated_at = datetime('now') WHERE id = ?").run(tramiteId);
  }
  res.status(201).json({ uploaded: count });
});

// Descarga de cualquier documento (el gestor puede ver todos).
router.get('/documents/:id/download', (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(req.params.id));
  if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });
  const filePath = path.join(UPLOADS_DIR, doc.stored_name);
  if (!filePath.startsWith(UPLOADS_DIR) || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Archivo no disponible' });
  }
  res.download(filePath, doc.original_name);
});

function cleanup(files) {
  for (const f of files || []) fs.unlink(path.join(UPLOADS_DIR, f.filename), () => {});
}

module.exports = router;
