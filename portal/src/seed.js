'use strict';

// Crea un usuario administrador y (opcionalmente) datos de ejemplo.
// Uso:
//   ADMIN_EMAIL=tu@email.es ADMIN_PASSWORD=tuClave npm run seed
//   npm run seed -- --demo      (añade un cliente y trámites de ejemplo)

const { db } = require('./db');
const { hashPassword } = require('./auth');

const adminEmail = (process.env.ADMIN_EMAIL || 'admin@burocraciazero.es').toLowerCase();
const adminPass = process.env.ADMIN_PASSWORD || 'CambiaEsta123';
const withDemo = process.argv.includes('--demo');

function ensureUser({ role, name, email, phone, password }) {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    console.log(`· Usuario ya existente: ${email} (id ${existing.id})`);
    return existing.id;
  }
  const info = db
    .prepare('INSERT INTO users (role, name, email, phone, password_hash) VALUES (?, ?, ?, ?, ?)')
    .run(role, name, email, phone || null, hashPassword(password));
  console.log(`✓ Creado ${role}: ${email}`);
  return Number(info.lastInsertRowid);
}

const adminId = ensureUser({
  role: 'admin',
  name: 'Gestor Burocracia Zero',
  email: adminEmail,
  password: adminPass,
});

if (!process.env.ADMIN_PASSWORD) {
  console.log(`\n⚠  Contraseña de admin por defecto: "${adminPass}". Cámbiala cuanto antes.\n`);
}

if (withDemo) {
  const clientId = ensureUser({
    role: 'client',
    name: 'Cliente de Ejemplo',
    email: 'cliente@ejemplo.es',
    phone: '+34 600 111 222',
    password: 'Cliente123',
  });

  const count = db.prepare('SELECT COUNT(*) c FROM tramites WHERE user_id = ?').get(clientId).c;
  if (count === 0) {
    const t1 = db.prepare(
      "INSERT INTO tramites (user_id, title, type, status, description) VALUES (?, 'Renovación de residencia', 'Extranjería', 'en_proceso', 'Renovación de la tarjeta de residencia temporal.')"
    ).run(clientId);
    db.prepare("INSERT INTO tramite_updates (tramite_id, status, note, created_by) VALUES (?, 'recibido', 'Trámite creado', 'admin')").run(Number(t1.lastInsertRowid));
    db.prepare("INSERT INTO tramite_updates (tramite_id, status, note, created_by) VALUES (?, 'en_proceso', 'Documentación revisada, preparando la solicitud.', 'admin')").run(Number(t1.lastInsertRowid));

    db.prepare(
      "INSERT INTO tramites (user_id, title, type, status, description) VALUES (?, 'Declaración de la renta 2024', 'Fiscal', 'pendiente_documentacion', 'Necesitamos los certificados bancarios.')"
    ).run(clientId);
    console.log('✓ Datos de ejemplo creados (cliente@ejemplo.es / Cliente123)');
  }
}

console.log('\nListo.');
