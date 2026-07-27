'use strict';

// Endurecimiento de seguridad del CRM:
//  - Verificación de firmas de webhook (YCloud HMAC-SHA256 y Meta X-Hub-Signature-256)
//  - Cabeceras de seguridad (CSP, HSTS, nosniff, frame-ancestors…)
//  - Límite de peticiones por IP
//  - Registro de auditoría (accesos y acciones sensibles)

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DB_FILE } = require('./store');

// ---------------------------------------------------------------------------
// Firmas de webhook
// ---------------------------------------------------------------------------

function timingSafeEqualStr(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// YCloud: cabecera "YCloud-Signature: t={unix},s={hex}", firma
// HMAC-SHA256("{t}.{cuerpo}", secreto). Tolerancia de 5 minutos contra replay.
function verifyYCloudSignature(rawBody, header, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(
    String(header).split(',').map((p) => {
      const idx = p.indexOf('=');
      return idx > 0 ? [p.slice(0, idx).trim(), p.slice(idx + 1).trim()] : ['', ''];
    }),
  );
  const t = Number(parts.t);
  const s = parts.s;
  if (!Number.isFinite(t) || !s) return false;
  if (Math.abs(nowSeconds - t) > 300) return false; // replay: máx. 5 min de desfase
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return timingSafeEqualStr(expected, s);
}

// Meta: cabecera "X-Hub-Signature-256: sha256={hex}" con el App Secret.
function verifyMetaSignature(rawBody, header, appSecret) {
  if (!header || !appSecret) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  return timingSafeEqualStr(expected, String(header));
}

// Decide si un webhook entrante es auténtico según los secretos configurados.
// Sin secretos configurados → se acepta (compatibilidad), pero el servidor
// avisa en el arranque.
function verifyWebhook(req, rawBody) {
  const ycloudSecret = process.env.YCLOUD_WEBHOOK_SECRET || '';
  const metaSecret = process.env.META_APP_SECRET || '';
  if (!ycloudSecret && !metaSecret) return { ok: true, via: 'sin_verificacion' };
  if (ycloudSecret && verifyYCloudSignature(rawBody, req.headers['ycloud-signature'], ycloudSecret)) {
    return { ok: true, via: 'ycloud' };
  }
  if (metaSecret && verifyMetaSignature(rawBody, req.headers['x-hub-signature-256'], metaSecret)) {
    return { ok: true, via: 'meta' };
  }
  return { ok: false, via: null };
}

// ---------------------------------------------------------------------------
// Cabeceras de seguridad
// ---------------------------------------------------------------------------

const CSP = [
  "default-src 'self'",
  // La interfaz usa estilos en línea y las fuentes de Google.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  "script-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  // Vista previa de PDF del propio origen + formularios de JotForm embebidos.
  "frame-src 'self' https://*.jotform.com https://*.jotform.eu https://*.jotformeu.com https://*.jotform.io",
].join('; ');

function applySecurityHeaders(req, res) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (String(req.headers['x-forwarded-proto'] || '').includes('https')) {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
}

// Tipos de adjunto que pueden mostrarse en línea sin riesgo de ejecutar
// código en el origen del CRM. El resto se sirve como descarga.
const INLINE_SAFE_MIME = /^(image\/(png|jpe?g|gif|webp|avif)|application\/pdf|audio\/|video\/)/i;

function mediaDisposition(mime, filename) {
  const inline = INLINE_SAFE_MIME.test(String(mime || ''));
  const safeName = encodeURIComponent(filename || 'adjunto');
  return {
    disposition: `${inline ? 'inline' : 'attachment'}; filename="${safeName}"`,
    // Un SVG/HTML malicioso no puede ejecutar nada bajo esta CSP.
    extraHeaders: { 'Content-Security-Policy': 'sandbox', 'X-Content-Type-Options': 'nosniff' },
  };
}

// ---------------------------------------------------------------------------
// Límite de peticiones por IP (ventana fija en memoria)
// ---------------------------------------------------------------------------

const buckets = new Map(); // clave -> { count, windowStart }

function rateLimit(key, max, windowMs = 60_000) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now - b.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return true;
  }
  b.count += 1;
  return b.count <= max;
}

// Limpieza periódica para que el mapa no crezca sin límite.
setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) {
    if (now - b.windowStart > 5 * 60_000) buckets.delete(key);
  }
}, 60_000).unref();

// ---------------------------------------------------------------------------
// Registro de auditoría
// ---------------------------------------------------------------------------

const AUDIT_FILE = path.join(path.dirname(DB_FILE), 'audit.log');

function audit(event, details = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...details }) + '\n';
  fs.mkdir(path.dirname(AUDIT_FILE), { recursive: true }, () => {
    fs.appendFile(AUDIT_FILE, line, () => {});
  });
}

// ---------------------------------------------------------------------------
// Avisos de configuración insegura en el arranque
// ---------------------------------------------------------------------------

function startupWarnings({ authUsers }) {
  const warnings = [];
  if (!authUsers.size) {
    warnings.push('⚠️  SIN CONTRASEÑA: define CRM_USERS o CRM_PASSWORD antes de exponer el CRM en Internet.');
  }
  for (const [user, pass] of authUsers) {
    if (String(pass).length < 8) {
      warnings.push(`⚠️  La contraseña del usuario «${user}» tiene menos de 8 caracteres.`);
    }
  }
  if (!process.env.YCLOUD_WEBHOOK_SECRET && !process.env.META_APP_SECRET) {
    warnings.push('⚠️  IMPORTANTE: webhook SIN verificación de firma. Cualquiera que'
      + ' conozca la URL podría inyectar mensajes falsos. Define'
      + ' YCLOUD_WEBHOOK_SECRET (consola de YCloud → Developers → Webhooks →'
      + ' secreto del endpoint) antes de usar el CRM en producción.');
  }
  return warnings;
}

module.exports = {
  verifyYCloudSignature,
  verifyMetaSignature,
  verifyWebhook,
  applySecurityHeaders,
  mediaDisposition,
  rateLimit,
  audit,
  startupWarnings,
  AUDIT_FILE,
};
