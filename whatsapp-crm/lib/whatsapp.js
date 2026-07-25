'use strict';

// Cliente mínimo de la API oficial de WhatsApp Business (Meta Cloud API).
// Documentación: https://developers.facebook.com/docs/whatsapp/cloud-api
//
// Si no hay credenciales configuradas, la app funciona en "modo demo":
// los mensajes se guardan en el CRM pero no se envían de verdad.

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v20.0';

// Dos formas de conectar:
//  - Meta directo:   WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID
//  - 360dialog (BSP recomendado para Coexistence): WHATSAPP_360DIALOG_API_KEY
//    Su API v2 replica la Cloud API de Meta, solo cambian la URL y la cabecera.
function config() {
  return {
    token: process.env.WHATSAPP_TOKEN || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    d360ApiKey: process.env.WHATSAPP_360DIALOG_API_KEY || '',
    verifyToken: process.env.WEBHOOK_VERIFY_TOKEN || 'gestoria-crm',
  };
}

function provider() {
  const c = config();
  if (c.d360ApiKey) return '360dialog';
  if (c.token && c.phoneNumberId) return 'meta';
  return null;
}

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

async function markAsRead(waMessageId) {
  if (!isConfigured() || !waMessageId) return;
  const { url, headers } = endpoint();
  await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: waMessageId,
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

// Extrae los mensajes entrantes de la carga del webhook de Meta.
// Con el modo Coexistence activado (mismo número en la app WhatsApp Business
// y en la API), Meta también envía "ecos" de los mensajes que la gestoría
// manda desde el móvil (campo smb_message_echoes / message_echoes), para que
// el CRM pueda reflejarlos y la conversación se vea completa.
// Devuelve { incoming, echoes, statuses }.
function parseWebhook(body) {
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
        statuses.push({ waMessageId: st.id, status: st.status });
      }
    }
  }
  return { incoming, echoes, statuses };
}

module.exports = { config, provider, isConfigured, sendText, markAsRead, parseWebhook };
