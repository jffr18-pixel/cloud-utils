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

async function sendText(toPhone, text) {
  if (!isConfigured()) {
    return { demo: true, id: null };
  }
  if (provider() === 'ycloud') {
    const c = config();
    if (!c.ycloudFrom) {
      throw new Error('Falta YCLOUD_WHATSAPP_FROM (número del negocio en formato +34...)');
    }
    const res = await fetch(`${YCLOUD_BASE}/whatsapp/messages/sendDirectly`, {
      method: 'POST',
      headers: { 'X-API-Key': c.ycloudApiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: c.ycloudFrom,
        to: '+' + toPhone,
        type: 'text',
        text: { body: text },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message || `HTTP ${res.status}`;
      throw new Error(`Error de la API de YCloud: ${msg}`);
    }
    return { demo: false, id: data?.wamid || data?.id || null };
  }
  const { url, headers } = endpoint();
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toPhone,
      type: 'text',
      text: { preview_url: false, body: text },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    throw new Error(`Error de la API de WhatsApp: ${msg}`);
  }
  return { demo: false, id: data?.messages?.[0]?.id || null };
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

// Extrae el texto de un mensaje del webhook sea cual sea su tipo.
function extractText(msg) {
  if (msg.type === 'text') return msg.text?.body || '';
  if (msg.type === 'button') return msg.button?.text || '';
  if (msg.type === 'interactive') {
    return msg.interactive?.button_reply?.title
      || msg.interactive?.list_reply?.title || '';
  }
  return `[${msg.type}] (contenido no textual)`;
}

// Eventos de webhook de YCloud (docs.ycloud.com). Un POST por evento, con
// `type` y un objeto de carga según el tipo:
//  - whatsapp.inbound_message.received → whatsappInboundMessage
//  - whatsapp.message.updated          → whatsappMessage (estado de envíos)
//  - whatsapp.smb.message.created      → whatsappMessage (eco de la app, Coexistence)
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
      waMessageId: im.wamid || im.id,
      ycloudId: im.id || null,
      timestamp: Date.parse(im.sendTime) || Date.now(),
      historic: ev.type === 'whatsapp.smb.history',
    });
  }
  if ((ev.type === 'whatsapp.smb.message.created' || ev.type === 'whatsapp.smb.history') && om) {
    echoes.push({
      to: om.to || '',
      text: extractText(om),
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
          waMessageId: msg.id,
          timestamp: Number(msg.timestamp) * 1000 || Date.now(),
        });
      }
      // Ecos de mensajes enviados desde la app del móvil (Coexistence).
      for (const msg of value.message_echoes || value.smb_message_echoes || []) {
        echoes.push({
          to: msg.to,
          text: extractText(msg),
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

module.exports = { config, provider, isConfigured, sendText, markAsRead, parseWebhook };
