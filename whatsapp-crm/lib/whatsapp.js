'use strict';

// Cliente mínimo de la API oficial de WhatsApp Business (Meta Cloud API).
// Documentación: https://developers.facebook.com/docs/whatsapp/cloud-api
//
// Si no hay credenciales configuradas, la app funciona en "modo demo":
// los mensajes se guardan en el CRM pero no se envían de verdad.

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v20.0';

// Tres formas de conectar (por orden de prioridad si hay varias configuradas):
//  - YCloud (BSP):   YCLOUD_API_KEY + YCLOUD_WHATSAPP_FROM (número del negocio)
//  - 360dialog (BSP): WHATSAPP_360DIALOG_API_KEY
//  - Meta directo:   WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID
// YCloud tiene API y webhooks propios (docs.ycloud.com); 360dialog replica la
// Cloud API de Meta, solo cambian la URL y la cabecera.
function config() {
  return {
    token: process.env.WHATSAPP_TOKEN || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    d360ApiKey: process.env.WHATSAPP_360DIALOG_API_KEY || '',
    ycloudApiKey: process.env.YCLOUD_API_KEY || '',
    ycloudFrom: process.env.YCLOUD_WHATSAPP_FROM || '',
    verifyToken: process.env.WEBHOOK_VERIFY_TOKEN || 'gestoria-crm',
  };
}

function provider() {
  const c = config();
  if (c.ycloudApiKey) return 'ycloud';
  if (c.d360ApiKey) return '360dialog';
  if (c.token && c.phoneNumberId) return 'meta';
  return null;
}

const YCLOUD_BASE = 'https://api.ycloud.com/v2';

function isConfigured() {
  return provider() !== null;
}

function endpoint() {
  const c = config();
  if (provider() === '360dialog') {
    return {
      url: 'https://waba-v2.360dialog.io/messages',
      headers: { 'D360-API-KEY': c.d360ApiKey, 'Content-Type': 'application/json' },
    };
  }
  return {
    url: `https://graph.facebook.com/${GRAPH_VERSION}/${c.phoneNumberId}/messages`,
    headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
  };
}

async function sendText(toPhone, text, opts = {}) {
  if (!isConfigured()) {
    return { demo: true, id: null };
  }
  const payload = { type: 'text', text: { preview_url: false, body: text } };
  if (opts.replyToWamid) payload.context = { message_id: opts.replyToWamid };
  return sendPayload(toPhone, payload);
}

// Sube un fichero al proveedor y devuelve el id de medio para usarlo en un
// mensaje. `data` es un Buffer.
async function uploadMedia(data, filename, mime) {
  const c = config();
  const form = new FormData();
  form.append('file', new Blob([data], { type: mime || 'application/octet-stream' }), filename || 'archivo');
  let url;
  let headers;
  if (provider() === 'ycloud') {
    if (!c.ycloudFrom) throw new Error('Falta YCLOUD_WHATSAPP_FROM');
    url = `${YCLOUD_BASE}/whatsapp/media/${encodeURIComponent(c.ycloudFrom)}/upload`;
    headers = { 'X-API-Key': c.ycloudApiKey };
  } else if (provider() === '360dialog') {
    url = 'https://waba-v2.360dialog.io/media';
    headers = { 'D360-API-KEY': c.d360ApiKey };
    form.append('messaging_product', 'whatsapp');
  } else {
    url = `https://graph.facebook.com/${GRAPH_VERSION}/${c.phoneNumberId}/media`;
    headers = { Authorization: `Bearer ${c.token}` };
    form.append('messaging_product', 'whatsapp');
  }
  const res = await fetch(url, { method: 'POST', headers, body: form });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Error al subir el archivo: ${out?.error?.message || `HTTP ${res.status}`}`);
  if (!out.id) throw new Error('El proveedor no devolvió un id de medio');
  return out.id;
}

// Envía un mensaje con adjunto. `media`: { kind, mediaId, filename, caption }.
async function sendMedia(toPhone, media, opts = {}) {
  if (!isConfigured()) return { demo: true, id: null };
  const mediaObj = { id: media.mediaId };
  if (media.caption && media.kind !== 'audio' && media.kind !== 'sticker') mediaObj.caption = media.caption;
  if (media.filename && media.kind === 'document') mediaObj.filename = media.filename;
  const payload = { to: toPhone, type: media.kind, [media.kind]: mediaObj };
  if (opts.replyToWamid) payload.context = { message_id: opts.replyToWamid };
  return sendPayload(toPhone, payload);
}

// Envía un mensaje interactivo de lista (menú nativo de WhatsApp con un botón
// que despliega opciones). Máximo 10 filas; títulos de fila ≤ 24 caracteres.
async function sendInteractiveList(toPhone, { body, button, rows }) {
  if (!isConfigured()) return { demo: true, id: null };
  return sendPayload(toPhone, {
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: body },
      action: {
        button: String(button || 'Ver opciones').slice(0, 20),
        sections: [{
          title: 'Áreas',
          rows: rows.slice(0, 10).map((r) => ({ id: r.id, title: String(r.title).slice(0, 24) })),
        }],
      },
    },
  });
}

// Envía una plantilla aprobada de Meta (necesaria fuera de la ventana de 24 h).
// `params` son los valores de las variables {{1}}, {{2}}… del cuerpo.
async function sendTemplate(toPhone, name, langCode, params) {
  if (!isConfigured()) return { demo: true, id: null };
  const payload = {
    to: toPhone,
    type: 'template',
    template: {
      name,
      language: { code: langCode || 'es' },
      components: params?.length ? [{
        type: 'body',
        parameters: params.map((t) => ({ type: 'text', text: String(t) })),
      }] : [],
    },
  };
  return sendPayload(toPhone, payload);
}

// Envío genérico de una carga tipo Cloud API con el proveedor activo.
async function sendPayload(toPhone, payload) {
  if (provider() === 'ycloud') {
    const c = config();
    if (!c.ycloudFrom) throw new Error('Falta YCLOUD_WHATSAPP_FROM (número del negocio en formato +34...)');
    const res = await fetch(`${YCLOUD_BASE}/whatsapp/messages/sendDirectly`, {
      method: 'POST',
      headers: { 'X-API-Key': c.ycloudApiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, from: c.ycloudFrom, to: '+' + toPhone }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Error de la API de YCloud: ${data?.error?.message || `HTTP ${res.status}`}`);
    return { demo: false, id: data?.wamid || data?.id || null };
  }
  const { url, headers } = endpoint();
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      ...payload,
      to: toPhone,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Error de la API de WhatsApp: ${data?.error?.message || `HTTP ${res.status}`}`);
  return { demo: false, id: data?.messages?.[0]?.id || null };
}

// Hosts de confianza a los que SÍ se puede enviar la API key al descargar un
// adjunto. El `link` de un adjunto entrante llega en el webhook, y aunque el
// webhook vaya firmado, nunca se manda la credencial a un host arbitrario:
// así una URL maliciosa no puede exfiltrar la API key de YCloud.
const TRUSTED_MEDIA_HOSTS = [
  /(^|\.)ycloud\.com$/i,
  /(^|\.)whatsapp\.net$/i,
  /(^|\.)fbcdn\.net$/i,
  /(^|\.)facebook\.com$/i,
  /(^|\.)360dialog\.io$/i,
];

function isTrustedMediaUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'https:') return false;
    return TRUSTED_MEDIA_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

// Descarga un adjunto entrante y lo devuelve como respuesta de fetch.
// YCloud: el `link` del webhook, con la API key. Meta/360dialog: se canjea el
// id por una URL temporal y se descarga con el token.
async function fetchInboundMedia(media) {
  const c = config();
  if (media.link) {
    if (!isTrustedMediaUrl(media.link)) {
      throw new Error('El enlace del adjunto no apunta a un host de confianza del proveedor');
    }
    return fetch(media.link, { headers: { 'X-API-Key': c.ycloudApiKey } });
  }
  if (media.metaMediaId && provider() !== 'ycloud' && isConfigured()) {
    const { headers } = endpoint();
    const metaRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${media.metaMediaId}`, { headers });
    const meta = await metaRes.json().catch(() => ({}));
    if (!metaRes.ok || !meta.url) throw new Error('No se pudo obtener la URL del adjunto');
    if (!isTrustedMediaUrl(meta.url)) {
      throw new Error('La URL del adjunto de Meta no es de un host de confianza');
    }
    return fetch(meta.url, { headers });
  }
  throw new Error('Adjunto no disponible');
}

// Comprueba que las credenciales del proveedor funcionan de verdad.
// Devuelve { ok, provider, detail } (ok=false con el motivo si falla).
async function testConnection() {
  const c = config();
  const prov = provider();
  if (!prov) {
    return { ok: false, provider: null, detail: 'Sin credenciales: el CRM está en modo demo.' };
  }
  const timeout = AbortSignal.timeout(10_000);
  try {
    if (prov === 'ycloud') {
      const res = await fetch(`${YCLOUD_BASE}/whatsapp/phoneNumbers?limit=10`, {
        headers: { 'X-API-Key': c.ycloudApiKey },
        signal: timeout,
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status === 403) {
        return { ok: false, provider: prov, detail: 'La API key de YCloud no es válida o está revocada.' };
      }
      if (!res.ok) {
        return { ok: false, provider: prov, detail: `YCloud respondió HTTP ${res.status}: ${data?.error?.message || 'error desconocido'}` };
      }
      const numbers = (data.items || []).map((n) => ({
        phoneNumber: n.phoneNumber,
        displayName: n.verifiedName || n.displayPhoneNumber || '',
        status: n.status || '',
      }));
      if (!numbers.length) {
        return { ok: false, provider: prov, detail: 'La API key es válida pero no hay ningún número de WhatsApp dado de alta en YCloud.' };
      }
      const fromOk = !c.ycloudFrom || numbers.some((n) => n.phoneNumber === c.ycloudFrom);
      let detail = `Conexión correcta. Números en la cuenta: ${numbers.map((n) => `${n.phoneNumber}${n.displayName ? ` (${n.displayName})` : ''}`).join(', ')}.`;
      if (!c.ycloudFrom) {
        detail += ' ⚠️ Falta YCLOUD_WHATSAPP_FROM: configúralo con uno de esos números.';
      } else if (!fromOk) {
        detail += ` ⚠️ YCLOUD_WHATSAPP_FROM (${c.ycloudFrom}) no coincide con ninguno de ellos.`;
      }
      return { ok: fromOk && Boolean(c.ycloudFrom), provider: prov, detail, numbers };
    }
    if (prov === 'meta') {
      const { headers } = endpoint();
      const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${c.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`, {
        headers, signal: timeout,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, provider: prov, detail: `Meta respondió: ${data?.error?.message || `HTTP ${res.status}`}` };
      }
      return { ok: true, provider: prov, detail: `Conexión correcta con ${data.display_phone_number || 'el número'} (${data.verified_name || 'sin nombre verificado'}).` };
    }
    // 360dialog no expone una consulta ligera equivalente en su API v2.
    return { ok: true, provider: prov, detail: 'Credenciales de 360dialog configuradas. Envía un mensaje de prueba para confirmar el funcionamiento.' };
  } catch (err) {
    const reason = err.name === 'TimeoutError'
      ? 'la petición superó los 10 segundos'
      : err.message;
    return { ok: false, provider: prov, detail: `No se pudo contactar con el proveedor (${reason}). Revisa la conexión a Internet o el cortafuegos del servidor.` };
  }
}

// ref: { waMessageId, ycloudId } — YCloud usa su propio id interno del
// mensaje entrante; Meta/360dialog usan el wamid.
async function markAsRead(ref) {
  if (!isConfigured() || !ref) return;
  if (provider() === 'ycloud') {
    if (!ref.ycloudId) return;
    const c = config();
    await fetch(`${YCLOUD_BASE}/whatsapp/inboundMessages/${encodeURIComponent(ref.ycloudId)}/markAsRead`, {
      method: 'POST',
      headers: { 'X-API-Key': c.ycloudApiKey },
    }).catch(() => {});
    return;
  }
  if (!ref.waMessageId) return;
  const { url, headers } = endpoint();
  await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: ref.waMessageId,
    }),
  }).catch(() => {});
}

const MEDIA_KINDS = ['image', 'document', 'video', 'audio', 'sticker'];

// Extrae el texto de un mensaje del webhook sea cual sea su tipo.
function extractText(msg) {
  if (msg.type === 'text') return msg.text?.body || '';
  if (msg.type === 'button') return msg.button?.text || '';
  if (msg.type === 'interactive') {
    return msg.interactive?.button_reply?.title
      || msg.interactive?.list_reply?.title || '';
  }
  if (MEDIA_KINDS.includes(msg.type)) {
    const m = msg[msg.type] || {};
    return m.caption || m.filename || '';
  }
  return `[${msg.type}] (contenido no textual)`;
}

// Extrae la información del adjunto (imagen, documento, vídeo, audio…).
// YCloud incluye `link` (descargable con la cabecera X-API-Key durante un
// mes); Meta/360dialog incluyen un `id` que hay que canjear por una URL.
function extractMedia(msg) {
  if (!MEDIA_KINDS.includes(msg.type)) return null;
  const m = msg[msg.type] || {};
  return {
    kind: msg.type,
    mime: m.mime_type || '',
    filename: m.filename || '',
    caption: m.caption || '',
    link: m.link || null,
    metaMediaId: m.link ? null : (m.id || null),
  };
}

// Eventos de webhook de YCloud (docs.ycloud.com). Un POST por evento, con
// `type` y un objeto de carga según el tipo:
//  - whatsapp.inbound_message.received → whatsappInboundMessage
//  - whatsapp.message.updated          → whatsappMessage (estado de envíos)
//  - whatsapp.smb.message.echoes / .created → whatsappMessage (eco de la app,
//    Coexistence; el nombre varía según la versión de la consola de YCloud)
//  - whatsapp.smb.history              → historial sincronizado de la app
function parseYCloudEvent(ev) {
  const incoming = [];
  const echoes = [];
  const statuses = [];
  const im = ev.whatsappInboundMessage;
  const om = ev.whatsappMessage;

  if ((ev.type === 'whatsapp.inbound_message.received' || ev.type === 'whatsapp.smb.history') && im) {
    incoming.push({
      from: im.from || '',
      name: im.customerProfile?.name || '',
      text: extractText(im),
      media: extractMedia(im),
      waMessageId: im.wamid || im.id,
      ycloudId: im.id || null,
      replyToWamid: im.context?.id || im.context?.messageId || null,
      timestamp: Date.parse(im.sendTime) || Date.now(),
      historic: ev.type === 'whatsapp.smb.history',
    });
  }
  const isEcho = ev.type === 'whatsapp.smb.message.created' || ev.type === 'whatsapp.smb.message.echoes';
  if ((isEcho || ev.type === 'whatsapp.smb.history') && om) {
    echoes.push({
      to: om.to || '',
      text: extractText(om),
      media: extractMedia(om),
      waMessageId: om.wamid || om.id,
      timestamp: Date.parse(om.createTime || om.sendTime) || Date.now(),
    });
  }
  if (ev.type === 'whatsapp.message.updated' && om && om.status) {
    const status = om.status === 'failed' ? 'error' : om.status;
    statuses.push({
      ids: [om.wamid, om.id].filter(Boolean),
      status,
      error: om.errorMessage || null,
      // Con estos datos, el servidor puede registrar mensajes enviados desde
      // la propia plataforma de YCloud (automatizaciones, su bandeja…) que
      // no salieron del CRM, para que la conversación se vea completa.
      to: om.to || null,
      text: extractText(om) || (om.template ? `[plantilla ${om.template.name || ''}]`.trim() : ''),
      timestamp: Date.parse(om.createTime || om.sendTime) || Date.now(),
    });
  }
  return { incoming, echoes, statuses };
}

// Extrae los mensajes entrantes de la carga del webhook.
// Acepta dos formatos: el nativo de Meta/360dialog (entry[].changes[]) y los
// eventos de YCloud (type: "whatsapp.*").
// Con el modo Coexistence activado (mismo número en la app WhatsApp Business
// y en la API), también llegan "ecos" de los mensajes que la gestoría manda
// desde el móvil, para que el CRM pueda reflejarlos y la conversación se vea
// completa.
// Devuelve { incoming, echoes, statuses }.
function parseWebhook(body) {
  if (body && typeof body.type === 'string' && body.type.startsWith('whatsapp.')) {
    return parseYCloudEvent(body);
  }
  const incoming = [];
  const echoes = [];
  const statuses = [];
  for (const entry of body?.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value;
      if (!value) continue;
      const contactNames = {};
      for (const contact of value.contacts || []) {
        contactNames[contact.wa_id] = contact?.profile?.name || '';
      }
      for (const msg of value.messages || []) {
        incoming.push({
          from: msg.from,
          name: contactNames[msg.from] || '',
          text: extractText(msg),
          media: extractMedia(msg),
          waMessageId: msg.id,
          replyToWamid: msg.context?.id || null,
          timestamp: Number(msg.timestamp) * 1000 || Date.now(),
        });
      }
      // Ecos de mensajes enviados desde la app del móvil (Coexistence).
      for (const msg of value.message_echoes || value.smb_message_echoes || []) {
        echoes.push({
          to: msg.to,
          text: extractText(msg),
          media: extractMedia(msg),
          waMessageId: msg.id,
          timestamp: Number(msg.timestamp) * 1000 || Date.now(),
        });
      }
      for (const st of value.statuses || []) {
        statuses.push({ ids: [st.id], status: st.status, error: null });
      }
    }
  }
  return { incoming, echoes, statuses };
}

module.exports = {
  config,
  provider,
  isConfigured,
  testConnection,
  isTrustedMediaUrl,
  sendText,
  sendMedia,
  sendInteractiveList,
  sendTemplate,
  uploadMedia,
  fetchInboundMedia,
  markAsRead,
  parseWebhook,
};
