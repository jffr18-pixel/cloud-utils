'use strict';

// Transcripción de notas de voz mediante un servicio compatible con la API de
// audio de OpenAI (Whisper). Sin dependencias: se construye el cuerpo
// multipart a mano. Se configura por variables de entorno:
//   OPENAI_API_KEY (o TRANSCRIBE_API_KEY)  — clave del proveedor
//   TRANSCRIBE_URL   — endpoint (por defecto el de OpenAI)
//   TRANSCRIBE_MODEL — modelo (por defecto whisper-1)
//   TRANSCRIBE_LANG  — idioma opcional (p. ej. "es")
//
// AVISO RGPD: las notas de voz pueden contener datos personales sensibles.
// Actívalo solo si el proveedor ofrece garantías adecuadas (DPA/UE).

const crypto = require('crypto');

function apiKey() {
  return process.env.OPENAI_API_KEY || process.env.TRANSCRIBE_API_KEY || '';
}

function isConfigured() {
  return Boolean(apiKey());
}

function endpoint() {
  return process.env.TRANSCRIBE_URL || 'https://api.openai.com/v1/audio/transcriptions';
}

// Construye un cuerpo multipart/form-data con los campos y el fichero de audio.
function buildMultipart(fields, file) {
  const boundary = `----burocraciazero${crypto.randomBytes(12).toString('hex')}`;
  const chunks = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  chunks.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\n`
    + `Content-Type: ${file.mime}\r\n\r\n`));
  chunks.push(file.buffer);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(chunks) };
}

// Transcribe un audio (Buffer) y devuelve el texto, o '' si no hay resultado.
async function run(buffer, filename = 'audio.ogg', mime = 'audio/ogg') {
  if (!isConfigured() || !buffer || !buffer.length) return '';
  const fields = { model: process.env.TRANSCRIBE_MODEL || 'whisper-1', response_format: 'json' };
  if (process.env.TRANSCRIBE_LANG) fields.language = process.env.TRANSCRIBE_LANG;
  const { boundary, body } = buildMultipart(fields, { filename, mime, buffer });
  const res = await fetch(endpoint(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) throw new Error(`transcripción HTTP ${res.status}`);
  const data = await res.json().catch(() => ({}));
  return String(data.text || '').trim();
}

module.exports = { isConfigured, run, buildMultipart };
