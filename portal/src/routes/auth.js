'use strict';

const express = require('express');
const { db } = require('../db');
const {
  hashPassword,
  verifyPassword,
  issueToken,
  clearToken,
  requireAuth,
} = require('../auth');

const router = express.Router();

// --- Limitador de intentos de login muy básico (en memoria) ---
const attempts = new Map(); // ip -> { count, ts }
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function rateLimit(req, res, next) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const rec = attempts.get(ip);
  if (rec && now - rec.ts < WINDOW_MS && rec.count >= MAX_ATTEMPTS) {
    return res.status(429).json({ error: 'Demasiados intentos. Inténtalo de nuevo en unos minutos.' });
  }
  next();
}

function bumpAttempts(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.ts >= WINDOW_MS) attempts.set(ip, { count: 1, ts: now });
  else rec.count += 1;
}

router.post('/login', rateLimit, (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Introduce email y contraseña' });
  }
  const user = db
    .prepare('SELECT * FROM users WHERE email = ?')
    .get(String(email).trim().toLowerCase());

  if (!user || !verifyPassword(password, user.password_hash)) {
    bumpAttempts(req.ip);
    return res.status(401).json({ error: 'Email o contraseña incorrectos' });
  }

  attempts.delete(req.ip);
  issueToken(res, user);
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
});

router.post('/logout', (req, res) => {
  clearToken(res);
  res.json({ ok: true });
});

// Devuelve el usuario de la sesión actual (para que el frontend sepa quién es).
router.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
});

// Cambio de contraseña del propio usuario autenticado.
router.post('/change-password', requireAuth, (req, res) => {
  const { current, next: nextPass } = req.body || {};
  if (!current || !nextPass || String(nextPass).length < 8) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' });
  }
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(current, row.password_hash)) {
    return res.status(401).json({ error: 'La contraseña actual no es correcta' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
    hashPassword(nextPass),
    req.user.id
  );
  res.json({ ok: true });
});

module.exports = router;
