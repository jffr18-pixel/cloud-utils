'use strict';

// Núcleo (puro y testable) del asistente por Telegram: interpreta lo que la
// persona escribe/dice en lenguaje natural y lo traduce a una acción del CRM.
// La interpretación usa un modelo compatible con la API de OpenAI (la misma
// clave que ya se usa para transcribir notas de voz). Toda la parte de red y
// de acceso a datos vive en server.js; aquí solo hay funciones sin efectos.
//
// AVISO RGPD: el texto que se manda al modelo puede contener datos personales
// (nombres, teléfonos que teclee el usuario). Se envía lo mínimo: NO se manda
// la base de clientes; el modelo solo extrae la intención y los nombres que la
// persona ya ha escrito. La resolución del cliente se hace en local.

const { normalizePhone } = require('./store');

function apiKey() {
  return process.env.OPENAI_API_KEY || process.env.TRANSCRIBE_API_KEY || '';
}

function isConfigured() {
  return Boolean(apiKey());
}

function endpoint() {
  return process.env.AGENT_URL
    || (process.env.OPENAI_BASE_URL ? `${process.env.OPENAI_BASE_URL.replace(/\/+$/, '')}/chat/completions` : '')
    || 'https://api.openai.com/v1/chat/completions';
}

function model() {
  return process.env.TELEGRAM_AGENT_MODEL || 'gpt-4o-mini';
}

// Lista blanca «id:usuarioCRM,id2:usuarioCRM2» → Map(idTelegram → usuarioCRM).
// Admite «id» a secas (sin usuario del CRM) para el modo de un solo usuario.
function parseAllowed(str) {
  const map = new Map();
  for (const pair of String(str || '').split(',')) {
    const raw = pair.trim();
    if (!raw) continue;
    const [id, user] = raw.split(':').map((s) => (s || '').trim());
    if (/^\d+$/.test(id)) map.set(id, user || null);
  }
  return map;
}

// Herramientas (acciones) que el modelo puede invocar. Se describen en español
// para que el modelo las use con naturalidad.
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'enviar_whatsapp',
      description: 'Enviar un mensaje de WhatsApp a un cliente. El destinatario puede ser un nombre de cliente o un número de teléfono.',
      parameters: {
        type: 'object',
        properties: {
          destinatario: { type: 'string', description: 'Nombre del cliente o número de teléfono al que enviar.' },
          mensaje: { type: 'string', description: 'Texto exacto del mensaje a enviar.' },
        },
        required: ['destinatario', 'mensaje'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'crear_cita',
      description: 'Crear una cita en la agenda con un cliente.',
      parameters: {
        type: 'object',
        properties: {
          cliente: { type: 'string', description: 'Nombre del cliente o número de teléfono.' },
          fecha: { type: 'string', description: 'Fecha en formato YYYY-MM-DD.' },
          hora: { type: 'string', description: 'Hora en formato HH:MM (24 h).' },
          motivo: { type: 'string', description: 'Motivo o asunto de la cita (opcional).' },
        },
        required: ['cliente', 'fecha', 'hora'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'crear_recordatorio',
      description: 'Crear un recordatorio interno para el equipo (no se envía al cliente).',
      parameters: {
        type: 'object',
        properties: {
          texto: { type: 'string', description: 'Qué hay que recordar.' },
          fecha: { type: 'string', description: 'Fecha del recordatorio en formato YYYY-MM-DD (opcional).' },
        },
        required: ['texto'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_agenda',
      description: 'Consultar las citas de un día concreto.',
      parameters: {
        type: 'object',
        properties: {
          fecha: { type: 'string', description: 'Fecha a consultar en formato YYYY-MM-DD. Si no se indica, hoy.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'buscar_cliente',
      description: 'Buscar un cliente por nombre, teléfono o etiqueta y ver un resumen.',
      parameters: {
        type: 'object',
        properties: {
          consulta: { type: 'string', description: 'Texto a buscar.' },
        },
        required: ['consulta'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pendientes_cobro',
      description: 'Listar los clientes con honorarios o tasas pendientes de cobro.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

// Construye la petición al modelo (chat completions con herramientas).
function buildAgentRequest(text, opts = {}) {
  const today = opts.today || '';
  const system = [
    'Eres el asistente de una gestoría española («Burocracia Zero»). Ayudas al gestor a manejar su CRM por Telegram.',
    `La fecha de hoy es ${today}. Convierte expresiones como «mañana», «el jueves» o «la semana que viene» a fechas concretas en formato YYYY-MM-DD a partir de hoy.`,
    'Cuando la persona pida una acción (mandar un WhatsApp, crear una cita, un recordatorio o hacer una consulta), llama a la herramienta adecuada.',
    'No inventes nombres de clientes, teléfonos ni datos: usa exactamente lo que diga la persona. Si falta algún dato imprescindible (por ejemplo la hora de una cita), pídelo en un mensaje breve en español en lugar de llamar a una herramienta.',
    'Responde siempre en español, de forma breve y cercana.',
  ].join(' ');
  return {
    url: endpoint(),
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: {
      model: opts.model || model(),
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: String(text || '') },
      ],
      tools: TOOLS,
      tool_choice: 'auto',
    },
  };
}

// Interpreta la respuesta del modelo. Devuelve { tool, args } si pide una
// acción, o { reply } con un texto para responder directamente.
function parseAgentResponse(json) {
  const msg = json && json.choices && json.choices[0] && json.choices[0].message;
  if (!msg) return { reply: 'No he entendido la respuesta. Inténtalo de nuevo.' };
  const call = msg.tool_calls && msg.tool_calls[0];
  if (call && call.function) {
    let args = {};
    try { args = JSON.parse(call.function.arguments || '{}'); } catch { args = {}; }
    return { tool: call.function.name, args };
  }
  return { reply: (msg.content || 'De acuerdo.').trim() };
}

// ¿El texto parece un número de teléfono? (dígitos, +, espacios, guiones).
function looksLikePhone(s) {
  const digits = String(s || '').replace(/\D/g, '');
  return digits.length >= 6 && /^[+\d][\d\s.\-()]+$/.test(String(s).trim());
}

// Resuelve un cliente a partir de un nombre o teléfono, respetando qué clientes
// son visibles para el usuario (aislamiento). `isVisible(client)` decide.
// Devuelve:
//   { client }                 — encontrado
//   { phone }                  — es un teléfono sin cliente aún (se puede crear)
//   { ambiguous: [clients] }   — varios nombres coinciden
//   { none: true }             — nada coincide
function resolveClient(db, query, isVisible = () => true) {
  const q = String(query || '').trim();
  if (!q) return { none: true };
  const visibles = db.clients.filter((c) => isVisible(c));
  if (looksLikePhone(q)) {
    const phone = normalizePhone(q);
    const byPhone = visibles.find((c) => c.phone === phone);
    if (byPhone) return { client: byPhone };
    // ¿Existe pero es de otro usuario? No se puede usar por aislamiento.
    if (db.clients.some((c) => c.phone === phone)) return { blocked: true };
    return { phone };
  }
  const lower = q.toLowerCase();
  const exact = visibles.filter((c) => (c.name || '').toLowerCase() === lower);
  const partial = exact.length ? exact : visibles.filter((c) => (c.name || '').toLowerCase().includes(lower));
  if (partial.length === 1) return { client: partial[0] };
  if (partial.length > 1) return { ambiguous: partial.slice(0, 6) };
  return { none: true };
}

// Llama al modelo y devuelve { tool, args } o { reply }. Si no hay clave
// configurada, devuelve un aviso para que se configure OPENAI_API_KEY.
async function interpret(text, opts = {}) {
  if (!isConfigured()) {
    return { reply: 'El asistente inteligente no está configurado (falta OPENAI_API_KEY). Aun así puedo ejecutar órdenes directas.' };
  }
  const { url, headers, body } = buildAgentRequest(text, opts);
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`asistente HTTP ${res.status}${detail ? ': ' + detail.slice(0, 200) : ''}`);
  }
  const json = await res.json().catch(() => ({}));
  return parseAgentResponse(json);
}

// Valida que una fecha venga en formato YYYY-MM-DD.
function validDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
}

// Valida una hora HH:MM (24 h).
function validTime(s) {
  return /^([01]?\d|2[0-3]):[0-5]\d$/.test(String(s || ''));
}

module.exports = {
  isConfigured, apiKey, endpoint, model, parseAllowed, buildAgentRequest,
  parseAgentResponse, interpret, resolveClient, looksLikePhone, validDate, validTime, TOOLS,
};
