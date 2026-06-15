'use strict';

const path = require('node:path');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');

const { STATUS_LABELS } = require('./src/db');
const authRoutes = require('./src/routes/auth');
const clientRoutes = require('./src/routes/client');
const adminRoutes = require('./src/routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

// Detrás de un proxy inverso (nginx, etc.) para que req.ip y cookies "secure" funcionen.
app.set('trust proxy', 1);

// Cabeceras de seguridad básicas (sin dependencias extra).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// API
app.use('/api/auth', authRoutes);
app.use('/api/client', clientRoutes);
app.use('/api/admin', adminRoutes);

// Metadatos públicos útiles para el frontend (etiquetas de estado).
app.get('/api/meta', (req, res) => res.json({ statusLabels: STATUS_LABELS }));
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Frontend estático del portal.
app.use(express.static(path.join(__dirname, 'public')));

// Gestión de errores (incluye los de multer: tamaño/tipo de archivo).
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE'
      ? 'El archivo supera el tamaño máximo permitido (15 MB).'
      : `Error al subir el archivo: ${err.message}`;
    return res.status(400).json({ error: msg });
  }
  if (err && err.message) return res.status(400).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

app.listen(PORT, () => {
  console.log(`Portal de Burocracia Zero escuchando en http://localhost:${PORT}`);
});
