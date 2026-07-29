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

// Llama a un método de la API del bot. Devuelve el campo `result` o lanza error.
async function call(method, params = {}) {
  const res = await fetch(`${BASE()}/bot${token()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(`Telegram ${method}: ${data.description || res.status}`);
  }
  return data.result;
}

// Espera pasiva (long polling) de mensajes nuevos. `timeout` en segundos: la
// petición se queda abierta hasta que llega algo o se agota.
async function getUpdates(offset, timeout = 50) {
  return call('getUpdates', { offset, timeout, allowed_updates: ['message', 'callback_query'] });
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

// Descarga un fichero (p. ej. una nota de voz) y devuelve su Buffer.
async function downloadFile(fileId) {
  const file = await call('getFile', { file_id: fileId });
  const url = `${BASE()}/file/bot${token()}/${file.file_path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Telegram descarga de fichero: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
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
  isConfigured, call, getUpdates, sendMessage, editMessageText,
  answerCallbackQuery, sendChatAction, downloadFile, confirmKeyboard,
};
