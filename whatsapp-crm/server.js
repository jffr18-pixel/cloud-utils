'use strict';

// CRM de WhatsApp para gestorías — servidor HTTP sin dependencias externas.
// Ejecutar con: node server.js  (Node.js 18 o superior)

const http = require('http');
const fs = require('fs');
const path = require('path');
const { load, save, newId, normalizePhone } = require('./lib/store');
const wa = require('./lib/whatsapp');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 2_000_000) { reject(new Error('Cuerpo demasiado grande')); req.destroy(); }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('JSON inválido')); }
    });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Lógica de negocio
// ---------------------------------------------------------------------------

function findClientByPhone(db, phone) {
  return db.clients.find((c) => c.phone === phone) || null;
}

function ensureClientForPhone(db, phone, name) {
  let client = findClientByPhone(db, phone);
  if (!client) {
    client = {
      id: newId('cli'),
      name: name || `+${phone}`,
      phone,
      nif: '',
      email: '',
      tags: ['nuevo'],
      notes: 'Cliente creado automáticamente desde un mensaje de WhatsApp.',
      createdAt: Date.now(),
    };
    db.clients.push(client);
  }
  return client;
}

function conversationSummaries(db) {
  const byClient = new Map();
  for (const m of db.messages) {
    const list = byClient.get(m.clientId) || [];
    list.push(m);
    byClient.set(m.clientId, list);
  }
  const out = [];
  for (const [clientId, msgs] of byClient) {
    const client = db.clients.find((c) => c.id === clientId);
    if (!client) continue;
    const last = msgs[msgs.length - 1];
    const unread = msgs.filter((m) => m.direction === 'in' && !m.read).length;
    out.push({
      clientId,
      clientName: client.name,
      phone: client.phone,
      tags: client.tags,
      lastMessage: last.text,
      lastDirection: last.direction,
      lastTimestamp: last.timestamp,
      unread,
    });
  }
  out.sort((a, b) => b.lastTimestamp - a.lastTimestamp);
  return out;
}

async function sendMessageToClient(db, client, text) {
  let sendResult = { demo: true, id: null };
  let status = 'demo';
  try {
    sendResult = await wa.sendText(client.phone, text);
    status = sendResult.demo ? 'demo' : 'sent';
  } catch (err) {
    status = 'error';
    sendResult.error = err.message;
  }
  const msg = {
    id: newId('msg'),
    clientId: client.id,
    direction: 'out',
    text,
    timestamp: Date.now(),
    status, // demo | sent | delivered | read | error
    error: sendResult.error || null,
    waMessageId: sendResult.id,
    read: true,
  };
  db.messages.push(msg);
  save();
  return msg;
}

function handleWebhookPayload(db, body) {
  const { incoming, echoes, statuses } = wa.parseWebhook(body);
  for (const inMsg of incoming) {
    if (db.messages.some((m) => m.waMessageId && m.waMessageId === inMsg.waMessageId)) continue;
    const phone = normalizePhone(inMsg.from);
    const client = ensureClientForPhone(db, phone, inMsg.name);
    db.messages.push({
      id: newId('msg'),
      clientId: client.id,
      direction: 'in',
      text: inMsg.text,
      timestamp: inMsg.timestamp,
      status: 'received',
      waMessageId: inMsg.waMessageId,
      read: false,
    });
  }
  // Coexistence: mensajes que la gestoría envió desde la app del móvil.
  // Se registran como salientes para que la conversación se vea completa.
  for (const echo of echoes) {
    if (db.messages.some((m) => m.waMessageId && m.waMessageId === echo.waMessageId)) continue;
    const phone = normalizePhone(echo.to);
    const client = ensureClientForPhone(db, phone, '');
    db.messages.push({
      id: newId('msg'),
      clientId: client.id,
      direction: 'out',
      text: echo.text,
      timestamp: echo.timestamp,
      status: 'sent',
      viaApp: true,
      waMessageId: echo.waMessageId,
      read: true,
    });
  }
  for (const st of statuses) {
    const msg = db.messages.find((m) => m.waMessageId === st.waMessageId);
    if (msg && ['sent', 'delivered', 'read'].includes(st.status)) {
      msg.status = st.status;
    }
  }
  if (incoming.length || echoes.length || statuses.length) save();
}

// ---------------------------------------------------------------------------
// Rutas de la API
// ---------------------------------------------------------------------------

async function handleApi(req, res, url) {
  const db = load();
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const resource = parts[1];
  const id = parts[2];

  // --- Estado general -----------------------------------------------------
  if (req.method === 'GET' && resource === 'status') {
    return json(res, 200, {
      whatsappConfigured: wa.isConfigured(),
      provider: wa.provider(),
      verifyToken: wa.config().verifyToken,
    });
  }

  if (req.method === 'GET' && resource === 'dashboard') {
    const now = Date.now();
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    const openCases = db.cases.filter((c) => c.status !== 'completado');
    return json(res, 200, {
      totalClients: db.clients.length,
      unreadMessages: db.messages.filter((m) => m.direction === 'in' && !m.read).length,
      openCases: openCases.length,
      casesAwaitingDocs: openCases.filter((c) => c.status === 'esperando_documentacion').length,
      overdueCases: openCases.filter((c) => c.dueDate && new Date(c.dueDate).getTime() < now).length,
      remindersToday: db.reminders.filter((r) => !r.done && r.dueDate
        && new Date(r.dueDate).getTime() <= endOfToday.getTime()).length,
      recentConversations: conversationSummaries(db).slice(0, 5),
    });
  }

  // --- Clientes -----------------------------------------------------------
  if (resource === 'clients') {
    if (req.method === 'GET' && !id) {
      const q = (url.searchParams.get('q') || '').toLowerCase();
      let list = db.clients;
      if (q) {
        list = list.filter((c) =>
          [c.name, c.phone, c.nif, c.email, (c.tags || []).join(' ')]
            .join(' ').toLowerCase().includes(q));
      }
      return json(res, 200, list);
    }
    if (req.method === 'POST' && !id) {
      const b = await readBody(req);
      if (!b.name || !b.phone) return json(res, 400, { error: 'Nombre y teléfono son obligatorios' });
      const phone = normalizePhone(b.phone);
      if (findClientByPhone(db, phone)) return json(res, 409, { error: 'Ya existe un cliente con ese teléfono' });
      const client = {
        id: newId('cli'),
        name: String(b.name).trim(),
        phone,
        nif: (b.nif || '').trim(),
        email: (b.email || '').trim(),
        tags: Array.isArray(b.tags) ? b.tags : [],
        notes: b.notes || '',
        createdAt: Date.now(),
      };
      db.clients.push(client);
      save();
      return json(res, 201, client);
    }
    const client = db.clients.find((c) => c.id === id);
    if (!client) return json(res, 404, { error: 'Cliente no encontrado' });
    if (req.method === 'GET') return json(res, 200, client);
    if (req.method === 'PUT') {
      const b = await readBody(req);
      if (b.name !== undefined) client.name = String(b.name).trim();
      if (b.phone !== undefined) client.phone = normalizePhone(b.phone);
      if (b.nif !== undefined) client.nif = String(b.nif).trim();
      if (b.email !== undefined) client.email = String(b.email).trim();
      if (b.tags !== undefined) client.tags = Array.isArray(b.tags) ? b.tags : [];
      if (b.notes !== undefined) client.notes = String(b.notes);
      save();
      return json(res, 200, client);
    }
    if (req.method === 'DELETE') {
      db.clients = db.clients.filter((c) => c.id !== id);
      db.messages = db.messages.filter((m) => m.clientId !== id);
      db.cases = db.cases.filter((c) => c.clientId !== id);
      db.reminders = db.reminders.filter((r) => r.clientId !== id);
      save();
      return json(res, 200, { ok: true });
    }
  }

  // --- Conversaciones y mensajes ------------------------------------------
  if (req.method === 'GET' && resource === 'conversations') {
    return json(res, 200, conversationSummaries(db));
  }

  if (resource === 'messages') {
    if (req.method === 'GET') {
      const clientId = url.searchParams.get('clientId');
      if (!clientId) return json(res, 400, { error: 'Falta clientId' });
      const msgs = db.messages
        .filter((m) => m.clientId === clientId)
        .sort((a, b) => a.timestamp - b.timestamp);
      return json(res, 200, msgs);
    }
    if (req.method === 'POST' && id === 'read') {
      const b = await readBody(req);
      const toMark = db.messages.filter((m) => m.clientId === b.clientId && m.direction === 'in' && !m.read);
      for (const m of toMark) {
        m.read = true;
        wa.markAsRead(m.waMessageId);
      }
      if (toMark.length) save();
      return json(res, 200, { marked: toMark.length });
    }
    if (req.method === 'POST') {
      const b = await readBody(req);
      const client = db.clients.find((c) => c.id === b.clientId);
      if (!client) return json(res, 404, { error: 'Cliente no encontrado' });
      if (!b.text || !String(b.text).trim()) return json(res, 400, { error: 'El mensaje está vacío' });
      const msg = await sendMessageToClient(db, client, String(b.text).trim());
      return json(res, 201, msg);
    }
  }

  // Simulador de mensajes entrantes (solo modo demo, para probar sin Meta).
  if (req.method === 'POST' && resource === 'simulate-incoming') {
    const b = await readBody(req);
    const phone = normalizePhone(b.phone || '34600000000');
    const client = ensureClientForPhone(db, phone, b.name || '');
    db.messages.push({
      id: newId('msg'),
      clientId: client.id,
      direction: 'in',
      text: b.text || 'Hola, quería consultar por mi trámite.',
      timestamp: Date.now(),
      status: 'received',
      waMessageId: null,
      read: false,
    });
    save();
    return json(res, 201, { ok: true, clientId: client.id });
  }

  // --- Expedientes / trámites ---------------------------------------------
  if (resource === 'cases') {
    if (req.method === 'GET' && !id) {
      const clientId = url.searchParams.get('clientId');
      let list = db.cases;
      if (clientId) list = list.filter((c) => c.clientId === clientId);
      return json(res, 200, list);
    }
    if (req.method === 'POST' && !id) {
      const b = await readBody(req);
      if (!b.clientId || !b.title) return json(res, 400, { error: 'Cliente y título son obligatorios' });
      const item = {
        id: newId('exp'),
        clientId: b.clientId,
        title: String(b.title).trim(),
        type: b.type || 'otro', // fiscal | laboral | contabilidad | extranjeria | vehiculos | otro
        status: b.status || 'pendiente', // pendiente | en_curso | esperando_documentacion | completado
        dueDate: b.dueDate || null,
        notes: b.notes || '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      db.cases.push(item);
      save();
      return json(res, 201, item);
    }
    const item = db.cases.find((c) => c.id === id);
    if (!item) return json(res, 404, { error: 'Expediente no encontrado' });
    if (req.method === 'PUT') {
      const b = await readBody(req);
      for (const key of ['title', 'type', 'status', 'dueDate', 'notes']) {
        if (b[key] !== undefined) item[key] = b[key];
      }
      item.updatedAt = Date.now();
      save();
      return json(res, 200, item);
    }
    if (req.method === 'DELETE') {
      db.cases = db.cases.filter((c) => c.id !== id);
      save();
      return json(res, 200, { ok: true });
    }
  }

  // --- Plantillas de respuesta rápida --------------------------------------
  if (resource === 'templates') {
    if (req.method === 'GET') return json(res, 200, db.templates);
    if (req.method === 'POST' && !id) {
      const b = await readBody(req);
      if (!b.name || !b.text) return json(res, 400, { error: 'Nombre y texto son obligatorios' });
      const t = { id: newId('tpl'), name: String(b.name).trim(), text: String(b.text) };
      db.templates.push(t);
      save();
      return json(res, 201, t);
    }
    const t = db.templates.find((x) => x.id === id);
    if (!t) return json(res, 404, { error: 'Plantilla no encontrada' });
    if (req.method === 'PUT') {
      const b = await readBody(req);
      if (b.name !== undefined) t.name = String(b.name).trim();
      if (b.text !== undefined) t.text = String(b.text);
      save();
      return json(res, 200, t);
    }
    if (req.method === 'DELETE') {
      db.templates = db.templates.filter((x) => x.id !== id);
      save();
      return json(res, 200, { ok: true });
    }
  }

  // --- Recordatorios --------------------------------------------------------
  if (resource === 'reminders') {
    if (req.method === 'GET') {
      return json(res, 200, db.reminders.slice().sort((a, b) =>
        String(a.dueDate || '').localeCompare(String(b.dueDate || ''))));
    }
    if (req.method === 'POST' && !id) {
      const b = await readBody(req);
      if (!b.text) return json(res, 400, { error: 'El texto es obligatorio' });
      const r = {
        id: newId('rem'),
        clientId: b.clientId || null,
        text: String(b.text).trim(),
        dueDate: b.dueDate || null,
        done: false,
        createdAt: Date.now(),
      };
      db.reminders.push(r);
      save();
      return json(res, 201, r);
    }
    const r = db.reminders.find((x) => x.id === id);
    if (!r) return json(res, 404, { error: 'Recordatorio no encontrado' });
    if (req.method === 'PUT') {
      const b = await readBody(req);
      if (b.text !== undefined) r.text = String(b.text);
      if (b.dueDate !== undefined) r.dueDate = b.dueDate;
      if (b.done !== undefined) r.done = Boolean(b.done);
      if (b.clientId !== undefined) r.clientId = b.clientId;
      save();
      return json(res, 200, r);
    }
    if (req.method === 'DELETE') {
      db.reminders = db.reminders.filter((x) => x.id !== id);
      save();
      return json(res, 200, { ok: true });
    }
  }

  return json(res, 404, { error: 'Ruta no encontrada' });
}

// ---------------------------------------------------------------------------
// Servidor
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    // Webhook de Meta: verificación (GET) y recepción de mensajes (POST).
    if (url.pathname === '/webhook') {
      if (req.method === 'GET') {
        const mode = url.searchParams.get('hub.mode');
        const token = url.searchParams.get('hub.verify_token');
        const challenge = url.searchParams.get('hub.challenge');
        if (mode === 'subscribe' && token === wa.config().verifyToken) {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          return res.end(challenge || '');
        }
        res.writeHead(403);
        return res.end();
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        handleWebhookPayload(load(), body);
        return json(res, 200, { ok: true });
      }
    }

    if (url.pathname.startsWith('/api/')) {
      return await handleApi(req, res, url);
    }

    // Ficheros estáticos de la interfaz.
    let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
    filePath = path.normalize(filePath).replace(/^([.][.][/\\])+/, '');
    const full = path.join(PUBLIC_DIR, filePath);
    if (!full.startsWith(PUBLIC_DIR) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('No encontrado');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    return fs.createReadStream(full).pipe(res);
  } catch (err) {
    return json(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  const mode = wa.isConfigured()
    ? `conectado a la API de WhatsApp Business (proveedor: ${wa.provider()})`
    : 'MODO DEMO (sin credenciales de WhatsApp; los envíos no salen de verdad)';
  console.log(`CRM de WhatsApp para gestoría — http://localhost:${PORT}`);
  console.log(`Estado: ${mode}`);
});
