'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('Falta la variable de entorno JWT_SECRET en producción.');
}
// En desarrollo usamos un secreto temporal (con aviso) para no bloquear el arranque.
const SECRET = JWT_SECRET || 'dev-secret-cambia-esto-en-produccion';
if (!JWT_SECRET) {
  console.warn('[auth] ⚠  JWT_SECRET no definido: usando secreto de desarrollo. Defínelo en .env antes de producir.');
}

const COOKIE_NAME = 'bz_session';
const TOKEN_TTL = '8h';
const isProd = process.env.NODE_ENV === 'production';

function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

function issueToken(res, user) {
  const token = jwt.sign(
    { sub: user.id, role: user.role, name: user.name },
    SECRET,
    { expiresIn: TOKEN_TTL }
  );
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: 8 * 60 * 60 * 1000,
  });
}

function clearToken(res) {
  res.clearCookie(COOKIE_NAME);
}

// Middleware: exige sesión válida y carga el usuario actual.
function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    const payload = jwt.verify(token, SECRET);
    const user = db
      .prepare('SELECT id, role, name, email, phone FROM users WHERE id = ?')
      .get(payload.sub);
    if (!user) return res.status(401).json({ error: 'Sesión no válida' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Sesión expirada o no válida' });
  }
}

// Middleware: exige rol de administrador (gestor).
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acceso restringido al personal de la gestoría' });
  }
  next();
}

module.exports = {
  COOKIE_NAME,
  hashPassword,
  verifyPassword,
  issueToken,
  clearToken,
  requireAuth,
  requireAdmin,
};
