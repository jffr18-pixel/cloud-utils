'use strict';

// Cliente mínimo de la API oficial de WhatsApp Business (Meta Cloud API).
// Documentación: https://developers.facebook.com/docs/whatsapp/cloud-api
//
// Si no hay credenciales configuradas, la app funciona en "modo demo":
// los mensajes se guardan en el CRM pero no se envían de verdad.

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v20.0';

function config() {
  return {
    token: process.env.WHATSAPP_TOKEN || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    verifyToken: process.env.WEBHOOK_VERIFY_TOKEN || 'gestoria-crm',
  };
}

function isConfigured() {
  const c = config();
  return Boolean(c.token && c.phoneNumberId);
}

async function sendText(toPhone, text) {
  const c = config();
  if (!isConfigured()) {
    return { demo: true, id: null };
  }
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${c.phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${c.token}`,
      'Content-Type': 'application/json',
    },
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
  const c = config();
  if (!isConfigured() || !waMessageId) return;
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${c.phoneNumberId}/messages`;
  await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${c.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: waMessageId,
    }),
  }).catch(() => {});
}

// Extrae los mensajes entrantes de la carga del webhook de Meta.
// Devuelve [{ from, name, text, waMessageId, timestamp }]
function parseWebhook(body) {
  const incoming = [];
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
        let text = '';
        if (msg.type === 'text') text = msg.text?.body || '';
        else if (msg.type === 'button') text = msg.button?.text || '';
        else if (msg.type === 'interactive') {
          text = msg.interactive?.button_reply?.title
            || msg.interactive?.list_reply?.title || '';
        } else {
          text = `[${msg.type}] (contenido no textual)`;
        }
        incoming.push({
          from: msg.from,
          name: contactNames[msg.from] || '',
          text,
          waMessageId: msg.id,
          timestamp: Number(msg.timestamp) * 1000 || Date.now(),
        });
      }
      for (const st of value.statuses || []) {
        statuses.push({ waMessageId: st.id, status: st.status });
      }
    }
  }
  return { incoming, statuses };
}

module.exports = { config, isConfigured, sendText, markAsRead, parseWebhook };
