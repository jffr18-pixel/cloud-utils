'use strict';

// Integración con Microsoft 365 (Graph API) para Burocracia Zero:
//  - Citas del CRM → eventos en el calendario de Outlook.
//  - Documentos de expedientes → carpeta del cliente en SharePoint.
//
// Requiere una app registrada en Entra ID (Azure AD) con permisos de
// aplicación Calendars.ReadWrite y Sites.ReadWrite.All (ver README) y estas
// variables de entorno:
//   MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET
// Sin ellas, la sincronización se omite en silencio (el CRM funciona igual).

const GRAPH = 'https://graph.microsoft.com/v1.0';

function config() {
  return {
    tenantId: process.env.MS_TENANT_ID || '',
    clientId: process.env.MS_CLIENT_ID || '',
    clientSecret: process.env.MS_CLIENT_SECRET || '',
  };
}

function isConfigured() {
  const c = config();
  return Boolean(c.tenantId && c.clientId && c.clientSecret);
}

// --- Token de aplicación (client credentials), con caché -------------------

let cachedToken = null;
let cachedTokenExpiry = 0;

async function getToken() {
  if (cachedToken && Date.now() < cachedTokenExpiry - 60_000) return cachedToken;
  const c = config();
  const res = await fetch(`https://login.microsoftonline.com/${c.tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Autenticación con Microsoft fallida: ${data.error_description || data.error || `HTTP ${res.status}`}`);
  }
  cachedToken = data.access_token;
  cachedTokenExpiry = Date.now() + (Number(data.expires_in) || 3600) * 1000;
  return cachedToken;
}

async function graph(path, options = {}) {
  const token = await getToken();
  const res = await fetch(GRAPH + path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': options.rawBody ? (options.contentType || 'application/octet-stream') : 'application/json',
      ...options.headers,
    },
    body: options.rawBody || (options.body ? JSON.stringify(options.body) : undefined),
  });
  if (res.status === 204) return {};
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `Graph respondió HTTP ${res.status}`);
  }
  return data;
}

// --- Calendario -------------------------------------------------------------

// Construye la carga del evento de Outlook para una cita del CRM.
// Función pura para poder probarla sin red.
function buildEventPayload(appt, client, durationMinutes = 30) {
  const start = `${appt.date}T${appt.time}:00`;
  const [h, m] = appt.time.split(':').map(Number);
  const endMinutes = h * 60 + m + durationMinutes;
  const end = `${appt.date}T${String(Math.floor(endMinutes / 60) % 24).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}:00`;
  return {
    subject: `Cita: ${client.name}${appt.reason ? ` — ${appt.reason}` : ''}`,
    body: {
      contentType: 'text',
      content: [
        `Cita creada desde el CRM de WhatsApp de Burocracia Zero.`,
        `Cliente: ${client.name} (+${client.phone})`,
        appt.reason ? `Motivo: ${appt.reason}` : null,
        appt.notes ? `Notas: ${appt.notes}` : null,
      ].filter(Boolean).join('\n'),
    },
    start: { dateTime: start, timeZone: 'Europe/Madrid' },
    end: { dateTime: end, timeZone: 'Europe/Madrid' },
    categories: ['CRM WhatsApp'],
  };
}

async function createCalendarEvent(calendarUser, appt, client) {
  const event = await graph(`/users/${encodeURIComponent(calendarUser)}/calendar/events`, {
    method: 'POST',
    body: buildEventPayload(appt, client),
  });
  return event.id || null;
}

async function updateCalendarEvent(calendarUser, eventId, appt, client) {
  await graph(`/users/${encodeURIComponent(calendarUser)}/events/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    body: buildEventPayload(appt, client),
  });
}

async function deleteCalendarEvent(calendarUser, eventId) {
  await graph(`/users/${encodeURIComponent(calendarUser)}/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
  }).catch(() => {});
}

// --- SharePoint -------------------------------------------------------------

// Nombre de carpeta del segmento en SharePoint (como en su estructura real).
const SEGMENT_FOLDER = {
  particular: 'PARTICULARES',
  autonomo: 'AUTONOMOS',
  empresa: 'EMPRESAS',
};

// Ruta de carpeta del cliente según la plantilla configurada.
// Variables: {aa} = año en 2 cifras, {aaaa} = año completo,
// {cliente} = nombre en mayúsculas, {segmento} = PARTICULARES|AUTONOMOS|EMPRESAS.
// Función pura, probada sin red.
function buildFolderPath(template, client, date = new Date()) {
  const yy = String(date.getFullYear()).slice(2);
  return template
    .replaceAll('{aa}', yy)
    .replaceAll('{aaaa}', String(date.getFullYear()))
    .replaceAll('{segmento}', SEGMENT_FOLDER[client.segment] || SEGMENT_FOLDER.particular)
    .replaceAll('{cliente}', (client.name || 'SIN NOMBRE').toUpperCase())
    .split('/')
    .map((seg) => seg.trim().replace(/[\\:*?"<>|#%]/g, ''))
    .filter(Boolean)
    .join('/');
}

const siteIdCache = new Map();

async function getSiteId(hostname, sitePath) {
  const key = `${hostname}:${sitePath}`;
  if (siteIdCache.has(key)) return siteIdCache.get(key);
  const site = await graph(`/sites/${hostname}:${sitePath}`);
  if (!site.id) throw new Error('No se encontró el sitio de SharePoint');
  siteIdCache.set(key, site.id);
  return site.id;
}

// Crea (si hace falta) cada carpeta de la ruta.
async function ensureFolders(siteId, folderPath) {
  const segments = folderPath.split('/');
  let parent = '';
  for (const seg of segments) {
    const parentRef = parent ? `root:/${parent}:` : 'root';
    try {
      await graph(`/sites/${siteId}/drive/${parentRef}/children`, {
        method: 'POST',
        body: { name: seg, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' },
      });
    } catch (err) {
      if (!/exist|conflict|nameAlreadyExists/i.test(err.message)) throw err;
    }
    parent = parent ? `${parent}/${seg}` : seg;
  }
}

// Sube un fichero (Buffer). Para >4 MB usa sesión de subida por bloques.
async function uploadToSharePoint({ hostname, sitePath, folderPath, filename, data }) {
  const siteId = await getSiteId(hostname, sitePath);
  await ensureFolders(siteId, folderPath);
  const clean = filename.replace(/[\\/:*?"<>|#%]/g, '_');
  const itemPath = `root:/${folderPath}/${clean}:`;

  if (data.length <= 4_000_000) {
    const item = await graph(`/sites/${siteId}/drive/${itemPath}/content?@microsoft.graph.conflictBehavior=rename`, {
      method: 'PUT',
      rawBody: data,
    });
    return { id: item.id, webUrl: item.webUrl };
  }

  const session = await graph(`/sites/${siteId}/drive/${itemPath}/createUploadSession`, {
    method: 'POST',
    body: { item: { '@microsoft.graph.conflictBehavior': 'rename', name: clean } },
  });
  const CHUNK = 5 * 1024 * 1024 - (5 * 1024 * 1024) % 327_680; // múltiplo de 320 KiB
  let item = null;
  for (let start = 0; start < data.length; start += CHUNK) {
    const end = Math.min(start + CHUNK, data.length);
    const res = await fetch(session.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Length': String(end - start),
        'Content-Range': `bytes ${start}-${end - 1}/${data.length}`,
      },
      body: data.subarray(start, end),
    });
    if (!res.ok && res.status !== 202) {
      throw new Error(`Fallo al subir el bloque ${start}-${end}: HTTP ${res.status}`);
    }
    if (res.status === 200 || res.status === 201) item = await res.json().catch(() => ({}));
  }
  return { id: item?.id || null, webUrl: item?.webUrl || null };
}

// Prueba de conexión: token + acceso al sitio y al buzón configurados.
async function testConnection(settings) {
  if (!isConfigured()) {
    return { ok: false, detail: 'Faltan MS_TENANT_ID, MS_CLIENT_ID o MS_CLIENT_SECRET (integración desactivada).' };
  }
  try {
    await getToken();
    const parts = [];
    if (settings.sharepoint.enabled) {
      const siteId = await getSiteId(settings.sharepoint.hostname, settings.sharepoint.sitePath);
      parts.push(`SharePoint ✓ (sitio ${settings.sharepoint.sitePath}, id ${siteId.split(',')[0]}…)`);
    }
    if (settings.calendar.enabled) {
      const user = await graph(`/users/${encodeURIComponent(settings.calendar.user)}`);
      parts.push(`Calendario ✓ (${user.displayName || settings.calendar.user})`);
    }
    if (!parts.length) parts.push('Credenciales válidas (activa calendario o SharePoint para usarlas).');
    return { ok: true, detail: parts.join(' · ') };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}

module.exports = {
  isConfigured,
  buildEventPayload,
  buildFolderPath,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  uploadToSharePoint,
  testConnection,
};
