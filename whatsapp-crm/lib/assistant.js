'use strict';

// Núcleo (puro y testable) del asistente por Telegram: interpreta lo que la
// persona escribe/dice en lenguaje natural y lo traduce a una acción del CRM.
// Funciona con dos proveedores de IA, elegido por la clave que haya:
//   - ANTHROPIC_API_KEY  → Claude (API de Mensajes de Anthropic).
//   - OPENAI_API_KEY      → un modelo compatible con la API de OpenAI.
// Si están las dos, Claude tiene prioridad. Toda la red y el acceso a datos
// viven en server.js; aquí solo hay funciones sin efectos.
//
// NOTA: la transcripción de notas de voz (lib/transcribe.js) usa Whisper de
// OpenAI; Claude no transcribe audio, así que las notas de voz siguen
// necesitando OPENAI_API_KEY aunque el asistente use Claude.
//
// AVISO RGPD: el texto que se manda al modelo puede contener datos personales
// (nombres, teléfonos que teclee el usuario). Se envía lo mínimo: NO se manda
// la base de clientes; el modelo solo extrae la intención y los nombres que la
// persona ya ha escrito. La resolución del cliente se hace en local.

const { normalizePhone } = require('./store');

// Proveedor de IA activo: 'anthropic' (Claude) o 'openai'. Claude tiene
// prioridad si su clave está definida. '' si no hay ninguna configurada.
function provider() {
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY || process.env.TRANSCRIBE_API_KEY) return 'openai';
  return '';
}

function isConfigured() {
  return Boolean(provider());
}

// --- OpenAI (compatible) ---------------------------------------------------
function apiKey() {
  return process.env.OPENAI_API_KEY || process.env.TRANSCRIBE_API_KEY || '';
}

function endpoint() {
  return process.env.AGENT_URL
    || (process.env.OPENAI_BASE_URL ? `${process.env.OPENAI_BASE_URL.replace(/\/+$/, '')}/chat/completions` : '')
    || 'https://api.openai.com/v1/chat/completions';
}

function model() {
  return process.env.TELEGRAM_AGENT_MODEL || 'gpt-4o-mini';
}

// --- Claude (Anthropic) ----------------------------------------------------
function anthropicKey() {
  return process.env.ANTHROPIC_API_KEY || '';
}

function anthropicEndpoint() {
  const base = process.env.ANTHROPIC_BASE_URL ? process.env.ANTHROPIC_BASE_URL.replace(/\/+$/, '') : 'https://api.anthropic.com';
  return `${base}/v1/messages`;
}

function anthropicModel() {
  // Por defecto Haiku (rápido y barato, de sobra para órdenes cortas). Para
  // más capacidad, sube con ANTHROPIC_MODEL (p. ej. claude-opus-5).
  return process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';
}

function anthropicHeaders() {
  return { 'x-api-key': anthropicKey(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
}

// Las mismas herramientas, en el formato que espera la API de Anthropic.
function anthropicTools() {
  return TOOLS.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
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
      description: 'Crear una cita en la agenda con un cliente. Si el cliente es nuevo y la persona da su teléfono, se puede indicar en «telefono» para darlo de alta y crear la cita a la vez.',
      parameters: {
        type: 'object',
        properties: {
          cliente: { type: 'string', description: 'Nombre del cliente o número de teléfono.' },
          telefono: { type: 'string', description: 'Teléfono del cliente si es nuevo y aún no está en el CRM (opcional).' },
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
      name: 'reprogramar_cita',
      description: 'Cambiar (mover) una cita ya existente de un cliente a otra fecha y/u hora. Úsalo para «cambia/mueve/pasa la cita de X al…».',
      parameters: {
        type: 'object',
        properties: {
          cliente: { type: 'string', description: 'Nombre del cliente o número de teléfono.' },
          fecha_actual: { type: 'string', description: 'Fecha actual de la cita a mover, en formato YYYY-MM-DD (opcional, para desambiguar si tiene varias).' },
          nueva_fecha: { type: 'string', description: 'Nueva fecha en formato YYYY-MM-DD. Si no cambia el día, repite el actual.' },
          nueva_hora: { type: 'string', description: 'Nueva hora en formato HH:MM (24 h). Si no cambia la hora, repite la actual.' },
        },
        required: ['cliente'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'proximas_citas',
      description: 'Ver las próximas citas de la agenda (de todos los clientes) en los próximos días. Úsalo para «mis próximas citas», «¿qué citas tengo esta semana?».',
      parameters: {
        type: 'object',
        properties: {
          dias: { type: 'number', description: 'Cuántos días hacia delante mirar (por defecto 7).' },
        },
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
  {
    type: 'function',
    function: {
      name: 'registrar_cobro',
      description: 'Registrar que un cliente ha pagado sus honorarios pendientes, indicando la forma de cobro. Admite pagos parciales/adelantos con «importe».',
      parameters: {
        type: 'object',
        properties: {
          cliente: { type: 'string', description: 'Nombre del cliente o número de teléfono.' },
          forma_pago: { type: 'string', enum: ['efectivo', 'transferencia', 'tarjeta'], description: 'Cómo ha pagado.' },
          importe: { type: 'number', description: 'Importe cobrado en euros. Úsalo solo si es un pago parcial/adelanto (p. ej. «200 a cuenta»). Si no se indica, se cobra todo lo pendiente.' },
          incluir_tasas: { type: 'boolean', description: 'Marcar también como pagadas las tasas oficiales pendientes.' },
        },
        required: ['cliente', 'forma_pago'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cambiar_estado_expediente',
      description: 'Cambiar el estado de un expediente de un cliente.',
      parameters: {
        type: 'object',
        properties: {
          cliente: { type: 'string', description: 'Nombre del cliente o número de teléfono.' },
          estado: { type: 'string', enum: ['pendiente', 'en_curso', 'esperando_documentacion', 'completado'], description: 'Nuevo estado.' },
          expediente: { type: 'string', description: 'Título del expediente si el cliente tiene varios (opcional).' },
        },
        required: ['cliente', 'estado'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'crear_cliente',
      description: 'Dar de alta un cliente nuevo con su nombre y teléfono.',
      parameters: {
        type: 'object',
        properties: {
          nombre: { type: 'string', description: 'Nombre completo del cliente.' },
          telefono: { type: 'string', description: 'Número de teléfono.' },
        },
        required: ['nombre', 'telefono'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'resumen_hoy',
      description: 'Resumen del día: citas de hoy, vencimientos/caducidades próximas, conversaciones sin responder e importes pendientes de cobro. Úsalo para «¿qué tengo hoy?», «¿cómo va el día?», «resúmeme el día».',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ver_conversacion',
      description: 'Ver los últimos mensajes de WhatsApp con un cliente. Úsalo para «¿qué me ha dicho X?», «léeme el chat de X», «¿de qué hablé con X?».',
      parameters: {
        type: 'object',
        properties: {
          cliente: { type: 'string', description: 'Nombre del cliente o número de teléfono.' },
        },
        required: ['cliente'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listar_expedientes',
      description: 'Listar los expedientes/trámites de un cliente con su estado y cobro. Úsalo para «¿qué trámites tiene X?», «¿cómo va el expediente de X?».',
      parameters: {
        type: 'object',
        properties: {
          cliente: { type: 'string', description: 'Nombre del cliente o número de teléfono.' },
        },
        required: ['cliente'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'crear_expediente',
      description: 'Dar de alta un expediente/trámite para un cliente (con honorario opcional).',
      parameters: {
        type: 'object',
        properties: {
          cliente: { type: 'string', description: 'Nombre del cliente o número de teléfono.' },
          titulo: { type: 'string', description: 'Título del trámite (p. ej. «Arraigo social», «Renovación NIE»).' },
          tipo: { type: 'string', enum: ['extranjeria', 'fiscal', 'laboral', 'contabilidad', 'vehiculos', 'otro'], description: 'Área del trámite (opcional).' },
          honorario: { type: 'number', description: 'Honorario de la gestoría en euros (opcional).' },
        },
        required: ['cliente', 'titulo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancelar_cita',
      description: 'Cancelar/anular una cita de un cliente. Si tiene varias, se puede acotar por fecha.',
      parameters: {
        type: 'object',
        properties: {
          cliente: { type: 'string', description: 'Nombre del cliente o número de teléfono.' },
          fecha: { type: 'string', description: 'Fecha de la cita a cancelar en formato YYYY-MM-DD (opcional).' },
        },
        required: ['cliente'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'crear_tarea',
      description: 'Crear una tarea interna para el equipo (no se envía al cliente). Distíntala del recordatorio: la tarea va al tablero de tareas del CRM.',
      parameters: {
        type: 'object',
        properties: {
          titulo: { type: 'string', description: 'Qué hay que hacer.' },
          responsable: { type: 'string', description: 'Persona del equipo a la que se asigna (opcional).' },
          fecha: { type: 'string', description: 'Fecha límite en formato YYYY-MM-DD (opcional).' },
        },
        required: ['titulo'],
      },
    },
  },
];

// Instrucciones del sistema para el asistente (comunes a ambos proveedores).
function agentSystemPrompt(today) {
  return [
    'Eres el asistente de una gestoría española («Burocracia Zero»). Ayudas al gestor a manejar su CRM por Telegram, por texto o por nota de voz.',
    `La fecha de hoy es ${today || ''}. Convierte expresiones como «mañana», «el jueves», «pasado mañana» o «la semana que viene» a fechas concretas en formato YYYY-MM-DD a partir de hoy. Las horas, en formato HH:MM de 24 horas («las 5 de la tarde» → 17:00).`,
    'Elige SIEMPRE la herramienta que mejor encaje con lo que pide la persona; no respondas con texto si hay una herramienta adecuada. Guía rápida de intenciones:',
    '- Mandar/escribir/decir algo a un cliente por WhatsApp → enviar_whatsapp.',
    '- Poner/agendar una cita → crear_cita (si el cliente es nuevo y dan su teléfono, pásalo en «telefono»). Mover/cambiar/pasar una cita a otra hora o día → reprogramar_cita. Anular/quitar una cita → cancelar_cita.',
    '- Ver la agenda: un día concreto → consultar_agenda; «esta semana»/«mis próximas citas» → proximas_citas.',
    '- Recordarme algo (aviso personal) → crear_recordatorio. Tarea del equipo/tablero → crear_tarea.',
    '- Cobrar / registrar un pago → registrar_cobro (usa «importe» solo si es un adelanto o pago parcial, p. ej. «200 a cuenta»).',
    '- Cambiar el estado de un trámite → cambiar_estado_expediente. Dar de alta un trámite → crear_expediente.',
    '- Alta de cliente → crear_cliente.',
    '- Consultas: «¿qué tengo hoy?»/«cómo va el día» → resumen_hoy; ver citas de un día → consultar_agenda; buscar un cliente → buscar_cliente; ver trámites de un cliente → listar_expedientes; leer el chat de un cliente («¿qué me ha dicho X?») → ver_conversacion; quién debe dinero → pendientes_cobro.',
    'Estados de expediente posibles: «pendiente», «en_curso», «esperando_documentacion» y «completado». Mapea lo que diga la persona (p. ej. «en trámite» → en_curso, «presentado» o «terminado» → completado, «le faltan papeles» → esperando_documentacion).',
    'No inventes nombres de clientes, teléfonos ni datos: usa exactamente lo que diga la persona. Si falta algún dato imprescindible (por ejemplo la hora de una cita), pídelo en un mensaje breve en español en lugar de llamar a una herramienta. Si la orden es ambigua entre dos acciones, elige la más probable.',
    'Responde siempre en español, de forma breve y cercana.',
  ].join(' ');
}

// Construye la petición al modelo de OpenAI (chat completions con herramientas).
function buildAgentRequest(text, opts = {}) {
  return {
    url: endpoint(),
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: {
      model: opts.model || model(),
      temperature: 0,
      messages: [
        { role: 'system', content: agentSystemPrompt(opts.today) },
        { role: 'user', content: String(text || '') },
      ],
      tools: TOOLS,
      tool_choice: 'auto',
    },
  };
}

// Construye la petición a la API de Mensajes de Claude (con herramientas).
function buildAnthropicRequest(text, opts = {}) {
  return {
    url: anthropicEndpoint(),
    headers: anthropicHeaders(),
    body: {
      model: opts.model || anthropicModel(),
      max_tokens: 2048,
      system: agentSystemPrompt(opts.today),
      messages: [{ role: 'user', content: String(text || '') }],
      tools: anthropicTools(),
      tool_choice: { type: 'auto' },
    },
  };
}

// Interpreta la respuesta de OpenAI. Devuelve { tool, args } si pide una
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

// Interpreta la respuesta de Claude (array de bloques de contenido). Ignora los
// bloques de razonamiento; devuelve la herramienta invocada o el texto.
function parseAnthropicResponse(json) {
  const j = json || {};
  if (j.stop_reason === 'refusal') return { reply: 'No puedo ayudarte con eso.' };
  const content = Array.isArray(j.content) ? j.content : [];
  const toolUse = content.find((b) => b && b.type === 'tool_use');
  if (toolUse) return { tool: toolUse.name, args: (toolUse.input && typeof toolUse.input === 'object') ? toolUse.input : {} };
  const text = content.filter((b) => b && b.type === 'text').map((b) => String(b.text || '')).join('').trim();
  return { reply: text || 'De acuerdo.' };
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

// POST JSON con timeout; devuelve el JSON de la respuesta o lanza error.
async function postJson(url, headers, body, label) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Number(process.env.AGENT_TIMEOUT_MS || 20000));
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${label} HTTP ${res.status}${detail ? ': ' + detail.slice(0, 200) : ''}`);
  }
  return res.json().catch(() => ({}));
}

// Llama al modelo y devuelve { tool, args } o { reply }. Usa Claude u OpenAI
// según la clave configurada.
async function interpret(text, opts = {}) {
  const p = provider();
  if (!p) {
    return { reply: 'El asistente inteligente no está configurado (falta ANTHROPIC_API_KEY u OPENAI_API_KEY). Aun así puedo ejecutar órdenes directas.' };
  }
  if (p === 'anthropic') {
    const { url, headers, body } = buildAnthropicRequest(text, opts);
    return parseAnthropicResponse(await postJson(url, headers, body, 'asistente'));
  }
  const { url, headers, body } = buildAgentRequest(text, opts);
  return parseAgentResponse(await postJson(url, headers, body, 'asistente'));
}

// Chat genérico (sin herramientas): devuelve el texto de la respuesta. Se usa
// para «sugerir respuesta» a un cliente. `messages` puede incluir un mensaje
// con role 'system'; para Claude se separa como `system` de nivel superior.
async function chat(messages, opts = {}) {
  const p = provider();
  if (!p) throw new Error('IA no configurada (falta ANTHROPIC_API_KEY u OPENAI_API_KEY)');
  if (p === 'anthropic') {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const conv = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content }));
    // Holgura de tokens: los modelos Opus 5 razonan por defecto y el
    // presupuesto se reparte entre el razonamiento y el texto de la respuesta.
    const body = { model: opts.model || anthropicModel(), max_tokens: 2048, messages: conv };
    if (system) body.system = system;
    const json = await postJson(anthropicEndpoint(), anthropicHeaders(), body, 'IA');
    if (json.stop_reason === 'refusal') return '';
    const content = Array.isArray(json.content) ? json.content : [];
    return content.filter((b) => b && b.type === 'text').map((b) => String(b.text || '')).join('').trim();
  }
  const json = await postJson(endpoint(), { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' }, {
    model: opts.model || model(),
    temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.4,
    messages,
  }, 'IA');
  return String((json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || '').trim();
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
  isConfigured, provider, apiKey, endpoint, model,
  anthropicModel, anthropicEndpoint,
  parseAllowed, buildAgentRequest, parseAgentResponse,
  buildAnthropicRequest, parseAnthropicResponse,
  interpret, chat, resolveClient, looksLikePhone, validDate, validTime, TOOLS,
};
