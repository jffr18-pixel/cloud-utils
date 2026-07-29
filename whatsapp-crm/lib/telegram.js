'use strict';

// Cliente mínimo de la API de bots de Telegram, sin dependencias. Se usa para
// el «asistente por Telegram»: José (o Carmen) escribe o envía una nota de voz
// al bot y este ejecuta acciones en el CRM (mandar WhatsApp, crear citas…).
//
// Configuración por variables de entorno:
//   TELEGRAM_BOT_TOKEN   — token del bot (de @BotFather). Sin él, no arranca.
//   TELEGRAM_ALLOWED     — lista blanca «idTelegram:usuarioCRM» separada por
//                          comas. Solo esos IDs pueden usar el bot. El usuario
//                          del CRM liga cada persona con su reparto (aislamiento).
//                          Ej.: "111:jose,222:carmen"
//   TELEGRAM_API_BASE    — base de la API (por defecto la de Telegram).

const BASE = () => process.env.TELEGRAM_API_BASE || 'https://api.telegram.org';

function token() {
  return process.env.TELEGRAM_BOT_TOKEN || '';
}

function isConfigured() {
  return Boolean(token());
}

// Quita el token del bot de cualquier texto (la URL de la API lo contiene): así
// nunca acaba en un log ni en un mensaje de error visible.
function redact(str) {
  const tk = token();
  let s = String(str == null ? '' : str);
  if (tk) s = s.split(tk).join('***');
  return s;
}

// Tamaño máximo de fichero que se descarga (notas de voz, etc.).
const MAX_FILE_BYTES = Number(process.env.TELEGRAM_MAX_FILE_MB || 20) * 1024 * 1024;

// Llama a un método de la API del bot. Devuelve el campo `result` o lanza error.
// Con timeout: una petición colgada no puede bloquear el bot (es de un hilo).
async function call(method, params = {}, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs || 15000);
  let res;
  try {
    res = await fetch(`${BASE()}/bot${token()}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: ctrl.signal,
    });
  } catch (err) {
    throw new Error(`Telegram ${method}: ${redact(err && err.message) || 'error de red'}`);
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(`Telegram ${method}: ${redact(data.description) || res.status}`);
  }
  return data.result;
}

// Espera pasiva (long polling) de mensajes nuevos. `timeout` en segundos: la
// petición se queda abierta hasta que llega algo o se agota. El timeout de red
// se da un margen por encima del long-poll para no cortarlo antes de tiempo.
async function getUpdates(offset, timeout = 50) {
  return call('getUpdates', { offset, timeout, allowed_updates: ['message', 'callback_query'] },
    { timeoutMs: (timeout + 15) * 1000 });
}

function sendMessage(chatId, text, opts = {}) {
  return call('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: opts.parseMode || undefined,
    disable_web_page_preview: true,
    reply_markup: opts.replyMarkup || undefined,
  });
}

function editMessageText(chatId, messageId, text, opts = {}) {
  return call('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: opts.parseMode || undefined,
    disable_web_page_preview: true,
    reply_markup: opts.replyMarkup || undefined,
  });
}

function answerCallbackQuery(id, text) {
  return call('answerCallbackQuery', { callback_query_id: id, text: text || undefined });
}

function sendChatAction(chatId, action = 'typing') {
  return call('sendChatAction', { chat_id: chatId, action }).catch(() => null);
}

// Descarga un fichero (p. ej. una nota de voz) y devuelve su Buffer. Rechaza
// ficheros demasiado grandes (protección de memoria) y aplica timeout.
async function downloadFile(fileId) {
  const file = await call('getFile', { file_id: fileId });
  if (file.file_size && file.file_size > MAX_FILE_BYTES) {
    throw new Error('el fichero es demasiado grande');
  }
  const url = `${BASE()}/file/bot${token()}/${file.file_path}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`descarga de fichero: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_FILE_BYTES) throw new Error('el fichero es demasiado grande');
    return buf;
  } catch (err) {
    throw new Error(redact(err && err.message) || 'error de red');
  } finally {
    clearTimeout(timer);
  }
}

// Un teclado en línea con dos botones (confirmar / cancelar) para una acción.
function confirmKeyboard(token) {
  return {
    inline_keyboard: [[
      { text: '✅ Confirmar', callback_data: `ok:${token}` },
      { text: '❌ Cancelar', callback_data: `no:${token}` },
    ]],
  };
}

module.exports = {
  isConfigured, redact, call, getUpdates, sendMessage, editMessageText,
  answerCallbackQuery, sendChatAction, downloadFile, confirmKeyboard,
};
