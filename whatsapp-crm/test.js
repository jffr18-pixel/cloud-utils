'use strict';

// Pruebas de la API de extremo a extremo. Arranca el servidor en un puerto
// libre con un directorio de datos temporal y ejercita las rutas principales.
// Ejecutar con: node test.js

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 3777;
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-test-'));

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) { passed += 1; console.log(`  ✔ ${label}`); }
  else { failed += 1; console.error(`  ✘ ${label}`); }
}

async function req(method, pathName, body) {
  const res = await fetch(BASE + pathName, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function waitForServer() {
  for (let i = 0; i < 50; i += 1) {
    try {
      await fetch(BASE + '/api/status');
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('El servidor no arrancó');
}

// Servidor con secreto de webhook: solo acepta webhooks firmados.
async function testSignedWebhookServer() {
  const SIG_PORT = 3780;
  const SIG_BASE = `http://127.0.0.1:${SIG_PORT}`;
  const sigDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-sig-'));
  const cryptoMod = require('crypto');
  const secret = 'whsec_prueba_123';
  const server = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: {
      ...process.env, PORT: String(SIG_PORT), DATA_DIR: sigDataDir,
      YCLOUD_WEBHOOK_SECRET: secret, CRM_PASSWORD: '',
      WHATSAPP_TOKEN: '', WHATSAPP_PHONE_NUMBER_ID: '',
    },
    stdio: 'ignore',
  });
  try {
    for (let i = 0; i < 50; i += 1) {
      try { await fetch(SIG_BASE + '/api/auth'); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    const payload = JSON.stringify({
      id: 'evt_sig', type: 'whatsapp.inbound_message.received', apiVersion: 'v2',
      whatsappInboundMessage: {
        id: 'yc_sig_1', wamid: 'wamid.SIG1', from: '+34600111222',
        to: '+34911222333', sendTime: new Date().toISOString(),
        type: 'text', text: { body: 'Mensaje firmado' },
      },
    });
    const unsigned = await fetch(SIG_BASE + '/webhook', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload,
    });
    assert(unsigned.status === 401, 'webhook SIN firma rechazado cuando hay secreto');
    const badSig = await fetch(SIG_BASE + '/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'YCloud-Signature': `t=${Math.floor(Date.now() / 1000)},s=falsa` },
      body: payload,
    });
    assert(badSig.status === 401, 'webhook con firma falsa rechazado');
    const ts = Math.floor(Date.now() / 1000);
    const sig = cryptoMod.createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');
    const signed = await fetch(SIG_BASE + '/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'YCloud-Signature': `t=${ts},s=${sig}` },
      body: payload,
    });
    assert(signed.status === 200, 'webhook correctamente firmado aceptado');
    const convs = await (await fetch(SIG_BASE + '/api/conversations')).json();
    assert(convs.length === 1 && convs[0].lastMessage === 'Mensaje firmado',
      'el mensaje firmado se procesó');
  } finally {
    server.kill();
    fs.rmSync(sigDataDir, { recursive: true, force: true });
  }
}

// Servidor aparte con contraseña para probar la autenticación.
async function testAuthServer() {
  const AUTH_PORT = 3778;
  const AUTH_BASE = `http://127.0.0.1:${AUTH_PORT}`;
  const authDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-auth-'));
  const server = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: {
      ...process.env, PORT: String(AUTH_PORT), DATA_DIR: authDataDir,
      CRM_PASSWORD: 'secreto123', WHATSAPP_TOKEN: '', WHATSAPP_PHONE_NUMBER_ID: '',
    },
    stdio: 'ignore',
  });
  try {
    for (let i = 0; i < 50; i += 1) {
      try { await fetch(AUTH_BASE + '/api/auth'); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    const noAuth = await fetch(AUTH_BASE + '/api/clients');
    assert(noAuth.status === 401, 'sin sesión → 401');
    const badLogin = await fetch(AUTH_BASE + '/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: 'admin', password: 'mala' }),
    });
    assert(badLogin.status === 401, 'contraseña incorrecta → 401');
    const goodLogin = await fetch(AUTH_BASE + '/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: 'admin', password: 'secreto123' }),
    });
    assert(goodLogin.status === 200, 'inicio de sesión correcto');
    const cookie = (goodLogin.headers.get('set-cookie') || '').split(';')[0];
    assert(cookie.startsWith('crm_session='), 'cookie de sesión emitida');
    const withAuth = await fetch(AUTH_BASE + '/api/clients', { headers: { Cookie: cookie } });
    assert(withAuth.status === 200, 'con sesión → acceso permitido');
    const verify = await fetch(AUTH_BASE + '/webhook?hub.mode=subscribe&hub.verify_token=gestoria-crm&hub.challenge=abc');
    assert(await verify.text() === 'abc', 'el webhook sigue siendo público (lo necesita el proveedor)');
    const logout = await fetch(AUTH_BASE + '/api/logout', { method: 'POST', headers: { Cookie: cookie } });
    assert(logout.status === 200, 'cierre de sesión');
    const afterLogout = await fetch(AUTH_BASE + '/api/clients', { headers: { Cookie: cookie } });
    assert(afterLogout.status === 401, 'tras cerrar sesión → 401');
  } finally {
    server.kill();
    fs.rmSync(authDataDir, { recursive: true, force: true });
  }

  // Varios usuarios con CRM_USERS.
  const MULTI_PORT = 3779;
  const MULTI_BASE = `http://127.0.0.1:${MULTI_PORT}`;
  const multiDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-multi-'));
  const multiServer = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: {
      ...process.env, PORT: String(MULTI_PORT), DATA_DIR: multiDataDir,
      CRM_USERS: 'carmen:clave1,juan:clave2', CRM_PASSWORD: '',
      WHATSAPP_TOKEN: '', WHATSAPP_PHONE_NUMBER_ID: '',
    },
    stdio: 'ignore',
  });
  try {
    for (let i = 0; i < 50; i += 1) {
      try { await fetch(MULTI_BASE + '/api/auth'); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    const juanLogin = await fetch(MULTI_BASE + '/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: 'juan', password: 'clave2' }),
    });
    assert(juanLogin.status === 200, 'CRM_USERS: segundo usuario puede entrar');
    const juanCookie = (juanLogin.headers.get('set-cookie') || '').split(';')[0];
    const whoami = await fetch(MULTI_BASE + '/api/auth', { headers: { Cookie: juanCookie } });
    assert((await whoami.json()).user === 'juan', 'la sesión recuerda qué usuario es');
    const cross = await fetch(MULTI_BASE + '/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: 'carmen', password: 'clave2' }),
    });
    assert(cross.status === 401, 'la contraseña de un usuario no vale para otro');
  } finally {
    multiServer.kill();
    fs.rmSync(multiDataDir, { recursive: true, force: true });
  }
}

async function main() {
  const server = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, WHATSAPP_TOKEN: '', WHATSAPP_PHONE_NUMBER_ID: '' },
    stdio: 'ignore',
  });

  try {
    await waitForServer();

    console.log('Estado');
    const status = await req('GET', '/api/status');
    assert(status.status === 200, 'GET /api/status responde 200');
    assert(status.data.whatsappConfigured === false, 'sin credenciales → modo demo');
    assert(status.data.provider === null, 'sin credenciales → sin proveedor');

    console.log('Detección de proveedor');
    const wa = require('./lib/whatsapp');
    process.env.WHATSAPP_360DIALOG_API_KEY = 'clave-de-prueba';
    assert(wa.provider() === '360dialog', 'API key de 360dialog → proveedor 360dialog');
    process.env.YCLOUD_API_KEY = 'otra-clave';
    assert(wa.provider() === 'ycloud', 'API key de YCloud → tiene prioridad');
    assert(wa.isConfigured() === true, 'API key de YCloud → configurado');
    delete process.env.WHATSAPP_360DIALOG_API_KEY;
    delete process.env.YCLOUD_API_KEY;
    assert(wa.provider() === null, 'sin credenciales de nuevo → sin proveedor');

    console.log('Clientes');
    const created = await req('POST', '/api/clients', {
      name: 'María López', phone: '612 34 56 78', nif: '12345678Z', tags: ['renta'],
    });
    assert(created.status === 201, 'crear cliente');
    assert(created.data.phone === '34612345678', 'teléfono normalizado a 34612345678');
    const dup = await req('POST', '/api/clients', { name: 'Otra', phone: '612345678' });
    assert(dup.status === 409, 'teléfono duplicado rechazado');
    const missing = await req('POST', '/api/clients', { name: 'Sin teléfono' });
    assert(missing.status === 400, 'cliente sin teléfono rechazado');
    const clientId = created.data.id;

    const search = await req('GET', '/api/clients?q=renta');
    assert(search.data.length === 1, 'búsqueda por etiqueta');

    console.log('Mensajes');
    const sent = await req('POST', '/api/messages', { clientId, text: 'Hola María' });
    assert(sent.status === 201 && sent.data.status === 'demo', 'envío en modo demo');
    const empty = await req('POST', '/api/messages', { clientId, text: '  ' });
    assert(empty.status === 400, 'mensaje vacío rechazado');

    const sim = await req('POST', '/api/simulate-incoming', {
      phone: '699 88 77 66', name: 'Pedro García', text: '¿Cómo va mi trámite?',
    });
    assert(sim.status === 201, 'simular mensaje entrante');
    const convs = await req('GET', '/api/conversations');
    assert(convs.data.length === 2, 'dos conversaciones');
    const pedro = convs.data.find((c) => c.clientName === 'Pedro García');
    assert(pedro && pedro.unread === 1, 'entrante cuenta como no leído');
    const markRead = await req('POST', '/api/messages/read', { clientId: pedro.clientId });
    assert(markRead.data.marked === 1, 'marcar conversación como leída');

    console.log('Webhook');
    const verifyOk = await fetch(BASE + '/webhook?hub.mode=subscribe&hub.verify_token=gestoria-crm&hub.challenge=reto123');
    assert(await verifyOk.text() === 'reto123', 'verificación del webhook devuelve el challenge');
    const verifyBad = await fetch(BASE + '/webhook?hub.mode=subscribe&hub.verify_token=malo&hub.challenge=x');
    assert(verifyBad.status === 403, 'token de verificación incorrecto → 403');

    const hook = await req('POST', '/webhook', {
      entry: [{ changes: [{ value: {
        contacts: [{ wa_id: '34655443322', profile: { name: 'Lucía Ruiz' } }],
        messages: [{ from: '34655443322', id: 'wamid.TEST1', timestamp: '1753500000', type: 'text', text: { body: 'Buenos días' } }],
      } }] }],
    });
    assert(hook.status === 200, 'webhook de mensaje entrante aceptado');
    const convs2 = await req('GET', '/api/conversations');
    const lucia = convs2.data.find((c) => c.clientName === 'Lucía Ruiz');
    assert(Boolean(lucia), 'cliente creado automáticamente desde el webhook');
    await req('POST', '/webhook', {
      entry: [{ changes: [{ value: {
        messages: [{ from: '34655443322', id: 'wamid.TEST1', timestamp: '1753500000', type: 'text', text: { body: 'Buenos días' } }],
      } }] }],
    });
    const msgsLucia = await req('GET', `/api/messages?clientId=${lucia.clientId}`);
    assert(msgsLucia.data.length === 1, 'mensajes duplicados del webhook ignorados');

    console.log('Coexistence (ecos de la app del móvil)');
    const echoHook = await req('POST', '/webhook', {
      entry: [{ changes: [{ value: {
        message_echoes: [{ from: '34911222333', to: '34655443322', id: 'wamid.ECHO1', timestamp: '1753500100', type: 'text', text: { body: 'Respondido desde el móvil' } }],
      } }] }],
    });
    assert(echoHook.status === 200, 'webhook de eco aceptado');
    const msgsLucia2 = await req('GET', `/api/messages?clientId=${lucia.clientId}`);
    const echoMsg = msgsLucia2.data.find((m) => m.waMessageId === 'wamid.ECHO1');
    assert(echoMsg && echoMsg.direction === 'out' && echoMsg.viaApp === true,
      'eco registrado como mensaje saliente enviado desde la app');
    await req('POST', '/webhook', {
      entry: [{ changes: [{ value: {
        message_echoes: [{ from: '34911222333', to: '34655443322', id: 'wamid.ECHO1', timestamp: '1753500100', type: 'text', text: { body: 'Respondido desde el móvil' } }],
      } }] }],
    });
    const msgsLucia3 = await req('GET', `/api/messages?clientId=${lucia.clientId}`);
    assert(msgsLucia3.data.length === msgsLucia2.data.length, 'ecos duplicados ignorados');

    console.log('Webhooks de YCloud');
    const ycIn = await req('POST', '/webhook', {
      id: 'evt_1', type: 'whatsapp.inbound_message.received', apiVersion: 'v2',
      createTime: '2026-07-25T10:00:00.000Z',
      whatsappInboundMessage: {
        id: 'yc_msg_1', wamid: 'wamid.YC1', wabaId: 'waba1',
        from: '+34677111222', customerProfile: { name: 'Ana Torres' },
        to: '+34911222333', sendTime: '2026-07-25T10:00:00.000Z',
        type: 'text', text: { body: 'Hola, necesito cita para la renta' },
      },
    });
    assert(ycIn.status === 200, 'evento entrante de YCloud aceptado');
    const convsYc = await req('GET', '/api/conversations');
    const ana = convsYc.data.find((c) => c.clientName === 'Ana Torres');
    assert(Boolean(ana) && ana.phone === '34677111222', 'cliente creado desde webhook de YCloud');
    assert(ana.unread === 1, 'mensaje de YCloud cuenta como no leído');
    const anaMsgs = await req('GET', `/api/messages?clientId=${ana.clientId}`);
    assert(anaMsgs.data[0].ycloudId === 'yc_msg_1', 'id interno de YCloud guardado (para markAsRead)');

    const ycEcho = await req('POST', '/webhook', {
      id: 'evt_2', type: 'whatsapp.smb.message.echoes', apiVersion: 'v2',
      createTime: '2026-07-25T10:05:00.000Z',
      whatsappMessage: {
        id: 'yc_msg_2', wamid: 'wamid.YC2', from: '+34911222333', to: '+34677111222',
        type: 'text', text: { body: 'Claro, ¿te viene bien el martes?' },
        createTime: '2026-07-25T10:05:00.000Z',
      },
    });
    assert(ycEcho.status === 200, 'eco de la app (YCloud Coexistence) aceptado');
    const anaMsgs2 = await req('GET', `/api/messages?clientId=${ana.clientId}`);
    const ycEchoMsg = anaMsgs2.data.find((m) => m.waMessageId === 'wamid.YC2');
    assert(ycEchoMsg && ycEchoMsg.direction === 'out' && ycEchoMsg.viaApp === true,
      'eco de YCloud registrado como saliente desde la app');

    const ycStatus = await req('POST', '/webhook', {
      id: 'evt_3', type: 'whatsapp.message.updated', apiVersion: 'v2',
      createTime: '2026-07-25T10:06:00.000Z',
      whatsappMessage: { id: 'yc_msg_2', wamid: 'wamid.YC2', status: 'read' },
    });
    assert(ycStatus.status === 200, 'evento de estado de YCloud aceptado');
    const anaMsgs3 = await req('GET', `/api/messages?clientId=${ana.clientId}`);
    assert(anaMsgs3.data.find((m) => m.waMessageId === 'wamid.YC2').status === 'read',
      'estado actualizado a leído vía webhook de YCloud');

    // Mensaje enviado desde la plataforma de YCloud (automatización propia).
    const ycExternal = await req('POST', '/webhook', {
      id: 'evt_ext1', type: 'whatsapp.message.updated', apiVersion: 'v2',
      createTime: '2026-07-25T10:10:00.000Z',
      whatsappMessage: {
        id: 'yc_msg_ext', wamid: 'wamid.EXT1', from: '+34911222333', to: '+34655443322',
        type: 'text', text: { body: 'Respuesta del bot de YCloud' },
        status: 'sent', createTime: '2026-07-25T10:10:00.000Z',
      },
    });
    assert(ycExternal.status === 200, 'envío externo de YCloud aceptado');
    let luciaExt = (await req('GET', `/api/messages?clientId=${lucia.clientId}`)).data;
    const extMsg = luciaExt.find((m) => m.waMessageId === 'wamid.EXT1');
    assert(extMsg && extMsg.direction === 'out' && extMsg.viaProvider === true,
      'mensaje de automatización de YCloud registrado en la conversación');
    await req('POST', '/webhook', {
      id: 'evt_ext2', type: 'whatsapp.message.updated', apiVersion: 'v2',
      createTime: '2026-07-25T10:11:00.000Z',
      whatsappMessage: { id: 'yc_msg_ext', wamid: 'wamid.EXT1', to: '+34655443322', type: 'text', text: { body: 'Respuesta del bot de YCloud' }, status: 'read' },
    });
    luciaExt = (await req('GET', `/api/messages?clientId=${lucia.clientId}`)).data;
    assert(luciaExt.filter((m) => m.waMessageId === 'wamid.EXT1').length === 1,
      'los cambios de estado posteriores no duplican el mensaje externo');
    assert(luciaExt.find((m) => m.waMessageId === 'wamid.EXT1').status === 'read',
      'el estado del mensaje externo se actualiza');

    const ycHist = await req('POST', '/webhook', {
      id: 'evt_4', type: 'whatsapp.smb.history', apiVersion: 'v2',
      createTime: '2026-07-25T10:07:00.000Z',
      whatsappInboundMessage: {
        id: 'yc_msg_3', wamid: 'wamid.YC3', from: '+34677111222',
        to: '+34911222333', sendTime: '2026-01-10T09:00:00.000Z',
        type: 'text', text: { body: 'Mensaje antiguo del historial' },
      },
    });
    assert(ycHist.status === 200, 'evento de historial de YCloud aceptado');
    const anaMsgs4 = await req('GET', `/api/messages?clientId=${ana.clientId}`);
    const histMsg = anaMsgs4.data.find((m) => m.waMessageId === 'wamid.YC3');
    assert(histMsg && histMsg.read === true, 'historial importado no cuenta como no leído');

    console.log('Expedientes');
    const kase = await req('POST', '/api/cases', {
      clientId, title: 'Declaración renta 2025', type: 'fiscal', dueDate: '2026-06-30',
    });
    assert(kase.status === 201 && kase.data.status === 'pendiente', 'crear expediente');
    const upd = await req('PUT', `/api/cases/${kase.data.id}`, { status: 'en_curso' });
    assert(upd.data.status === 'en_curso', 'actualizar estado del expediente');

    console.log('Plantillas y recordatorios');
    const tpl = await req('POST', '/api/templates', { name: 'Saludo', text: 'Hola {nombre}' });
    assert(tpl.status === 201, 'crear plantilla');
    const rem = await req('POST', '/api/reminders', { text: 'Llamar a María', dueDate: '2026-07-25', clientId });
    assert(rem.status === 201, 'crear recordatorio');

    console.log('Automatizaciones');
    const autoDefaults = await req('GET', '/api/automations');
    assert(autoDefaults.status === 200 && autoDefaults.data.afterHours.enabled === false,
      'configuración por defecto: todo desactivado');

    // Fuera de horario: sin días laborables → siempre cerrado.
    await req('PUT', '/api/automations', {
      businessHours: { days: [], open: '09:00', close: '18:00' },
      afterHours: { enabled: true, message: 'Estamos cerrados, {nombre}. Te respondemos mañana.' },
    });
    await req('POST', '/api/simulate-incoming', { phone: '612345678', text: '¿Estáis abiertos?' });
    let msgs = (await req('GET', `/api/messages?clientId=${clientId}`)).data;
    let last = msgs[msgs.length - 1];
    assert(last.direction === 'out' && last.auto === true, 'respuesta automática fuera de horario enviada');
    assert(last.text.includes('María'), 'variable {nombre} sustituida');
    await req('POST', '/api/simulate-incoming', { phone: '612345678', text: '¿Hola?' });
    msgs = (await req('GET', `/api/messages?clientId=${clientId}`)).data;
    assert(msgs.filter((m) => m.auto).length === 1, 'no se repite dentro del periodo de cooldown');

    // Mensaje de servicios: a cualquier cliente que escriba, máx. 1 vez/día.
    await req('PUT', '/api/automations', {
      afterHours: { enabled: false },
      welcome: { enabled: true, text: 'Servicios de Burocracia Zero, {nombre}: renta, laboral, extranjería.', frequencyHours: 24 },
    });
    await req('POST', '/api/simulate-incoming', { phone: '612345678', text: 'Hola, ¿qué hacéis?' });
    let welMsgs = (await req('GET', `/api/messages?clientId=${clientId}`)).data;
    let welLast = welMsgs[welMsgs.length - 1];
    assert(welLast.auto === true && welLast.text.includes('Servicios de Burocracia Zero'),
      'cliente EXISTENTE recibe el mensaje de servicios al escribir');
    assert(welLast.text.includes('María'), 'mensaje de servicios personalizado con {nombre}');
    const welCount = welMsgs.filter((m) => m.text.includes('Servicios de Burocracia Zero')).length;
    await req('POST', '/api/simulate-incoming', { phone: '612345678', text: 'Otra consulta más' });
    welMsgs = (await req('GET', `/api/messages?clientId=${clientId}`)).data;
    assert(welMsgs.filter((m) => m.text.includes('Servicios de Burocracia Zero')).length === welCount,
      'no se repite dentro de las 24 horas');
    const welNew = await req('POST', '/api/simulate-incoming', { phone: '644556677', name: 'Cliente Nuevo', text: 'Buenas' });
    const newMsgs = (await req('GET', `/api/messages?clientId=${welNew.data.clientId}`)).data;
    assert(newMsgs.some((m) => m.auto && m.text.includes('Servicios de Burocracia Zero')),
      'cliente NUEVO también recibe el mensaje de servicios');

    // Menú de áreas → precios (réplica del flujo de YCloud).
    await req('PUT', '/api/automations', {
      welcome: {
        enabled: true,
        text: 'Elige un área, {nombre}:',
        areasText: '=== Renta e impuestos\nPrecios de renta: desde 40 €\n\n=== Extranjería\nPrecios de extranjería: arraigo 150 €',
        frequencyHours: 24,
      },
    });
    const menuNew = await req('POST', '/api/simulate-incoming', { phone: '655111333', name: 'Cliente Menú', text: 'Hola' });
    let menuMsgs = (await req('GET', `/api/messages?clientId=${menuNew.data.clientId}`)).data;
    let menuLast = menuMsgs[menuMsgs.length - 1];
    assert(menuLast.auto && menuLast.text.includes('1. Renta e impuestos') && menuLast.text.includes('2. Extranjería'),
      'el menú de áreas se envía al escribir');
    await req('POST', '/api/simulate-incoming', { phone: '655111333', text: '1' });
    menuMsgs = (await req('GET', `/api/messages?clientId=${menuNew.data.clientId}`)).data;
    menuLast = menuMsgs[menuMsgs.length - 1];
    assert(menuLast.auto && menuLast.text.includes('desde 40 €'),
      'elegir el área por número envía sus precios');
    await req('POST', '/api/simulate-incoming', { phone: '655111333', text: 'Extranjería' });
    menuMsgs = (await req('GET', `/api/messages?clientId=${menuNew.data.clientId}`)).data;
    menuLast = menuMsgs[menuMsgs.length - 1];
    assert(menuLast.auto && menuLast.text.includes('arraigo 150 €'),
      'elegir el área por nombre (respuesta de la lista interactiva) envía sus precios');
    const menuCount = menuMsgs.filter((m) => m.text.includes('1. Renta e impuestos')).length;
    assert(menuCount === 1, 'las selecciones no reenvían el menú');

    // La selección también llega como respuesta interactiva vía webhook.
    await req('POST', '/webhook', {
      id: 'evt_menu', type: 'whatsapp.inbound_message.received', apiVersion: 'v2',
      createTime: '2026-07-25T12:00:00.000Z',
      whatsappInboundMessage: {
        id: 'yc_menu_1', wamid: 'wamid.MENU1', from: '+34655111333',
        to: '+34911222333', sendTime: '2026-07-25T12:00:00.000Z',
        type: 'interactive',
        interactive: { type: 'list_reply', list_reply: { id: 'area_1', title: 'Renta e impuestos' } },
      },
    });
    menuMsgs = (await req('GET', `/api/messages?clientId=${menuNew.data.clientId}`)).data;
    menuLast = menuMsgs[menuMsgs.length - 1];
    assert(menuLast.auto && menuLast.text.includes('desde 40 €'),
      'la respuesta del menú interactivo de WhatsApp también envía los precios');

    await req('PUT', '/api/automations', { welcome: { enabled: false } });

    // Resto de automatizaciones: horario siempre abierto.
    await req('PUT', '/api/automations', {
      businessHours: { days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '23:59' },
      afterHours: { enabled: false },
      statusNotify: { enabled: true, onCompletado: true },
      docs: { enabled: true, followUpDays: 0 },
      clientReminders: { enabled: true },
    });

    // Petición de documentación al cambiar el estado.
    await req('PUT', `/api/cases/${kase.data.id}`, {
      status: 'esperando_documentacion', docs: 'DNI\nCertificado de retenciones',
    });
    msgs = (await req('GET', `/api/messages?clientId=${clientId}`)).data;
    last = msgs[msgs.length - 1];
    assert(last.auto === true && last.text.includes('DNI'), 'petición de documentación enviada con {documentos}');

    // Reclamo automático (0 días de espera, el cliente no ha respondido).
    const run1 = await req('POST', '/api/automations/run');
    assert(run1.data.executed.some((a) => a.type === 'docs_follow_up'), 'reclamo de documentación ejecutado');
    const run2 = await req('POST', '/api/automations/run');
    assert(!run2.data.executed.some((a) => a.type === 'docs_follow_up'), 'el reclamo no se duplica');

    // Aviso al completar el expediente.
    await req('PUT', `/api/cases/${kase.data.id}`, { status: 'completado' });
    msgs = (await req('GET', `/api/messages?clientId=${clientId}`)).data;
    last = msgs[msgs.length - 1];
    assert(last.auto === true && last.text.includes('Declaración renta 2025'),
      'aviso de expediente completado con {tramite}');

    // Recordatorio enviado al cliente en su fecha.
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const remCli = await req('POST', '/api/reminders', {
      text: 'Mañana vence el plazo del IVA', dueDate: today, clientId, sendToClient: true,
    });
    const run3 = await req('POST', '/api/automations/run');
    assert(run3.data.executed.some((a) => a.type === 'client_reminder'), 'recordatorio enviado al cliente');
    msgs = (await req('GET', `/api/messages?clientId=${clientId}`)).data;
    assert(msgs[msgs.length - 1].text.includes('IVA'), 'el recordatorio incluye {texto}');
    const run4 = await req('POST', '/api/automations/run');
    assert(!run4.data.executed.some((a) => a.type === 'client_reminder'), 'el recordatorio no se reenvía');
    const remAfter = (await req('GET', '/api/reminders')).data.find((r) => r.id === remCli.data.id);
    assert(Boolean(remAfter.sentToClientAt), 'recordatorio marcado como enviado');

    console.log('Panel');
    const dash = await req('GET', '/api/dashboard');
    assert(dash.data.totalClients === 6, 'panel: 6 clientes');
    assert(dash.data.openCases === 0, 'panel: sin expedientes abiertos (el de prueba quedó completado)');

    console.log('Adjuntos (modo demo)');
    const fileMsg = await req('POST', '/api/messages', {
      clientId,
      text: 'Te adjunto el justificante',
      file: { name: 'justificante.pdf', mime: 'application/pdf', data: Buffer.from('PDF-DEMO').toString('base64') },
    });
    assert(fileMsg.status === 201 && fileMsg.data.media?.kind === 'document', 'envío de documento registrado');
    assert(fileMsg.data.media.filename === 'justificante.pdf', 'nombre del archivo conservado');
    const download = await fetch(`${BASE}/api/media/${fileMsg.data.id}`);
    assert(download.status === 200 && (await download.text()) === 'PDF-DEMO', 'descarga del adjunto local');

    const ycMedia = await req('POST', '/webhook', {
      id: 'evt_5', type: 'whatsapp.inbound_message.received', apiVersion: 'v2',
      createTime: '2026-07-25T11:00:00.000Z',
      whatsappInboundMessage: {
        id: 'yc_msg_9', wamid: 'wamid.YC9', from: '+34677111222',
        to: '+34911222333', sendTime: '2026-07-25T11:00:00.000Z',
        type: 'document',
        document: { id: 'media1', link: 'https://example.com/f.pdf', mime_type: 'application/pdf', filename: 'nominas.pdf', caption: 'Mis nóminas' },
      },
    });
    assert(ycMedia.status === 200, 'webhook con documento aceptado');
    const anaMsgs5 = (await req('GET', `/api/messages?clientId=${ana.clientId}`)).data;
    const docMsg = anaMsgs5.find((m) => m.waMessageId === 'wamid.YC9');
    assert(docMsg?.media?.filename === 'nominas.pdf' && docMsg.media.link,
      'adjunto entrante guardado con su enlace de descarga');
    assert(docMsg.text === 'Mis nóminas', 'la descripción del adjunto se usa como texto');

    console.log('Plantilla para la ventana de 24 h');
    await req('PUT', '/api/automations', {
      template24h: { enabled: true, name: 'aviso_gestoria', lang: 'es' },
    });
    // Lucía: su único mensaje entrante es de hace más de 24 h → plantilla.
    const luciaCase = await req('POST', '/api/cases', {
      clientId: lucia.clientId, title: 'Alta autónomo', type: 'fiscal', status: 'completado',
    });
    assert(luciaCase.status === 201, 'expediente de Lucía creado');
    const luciaMsgs = (await req('GET', `/api/messages?clientId=${lucia.clientId}`)).data;
    const luciaLast = luciaMsgs[luciaMsgs.length - 1];
    assert(luciaLast.auto === true && luciaLast.viaTemplate === true,
      'aviso fuera de la ventana de 24 h enviado como plantilla');
    // María escribió hace un momento → ventana abierta → texto libre.
    const remMaria = await req('POST', '/api/reminders', {
      text: 'Firma pendiente', dueDate: today, clientId, sendToClient: true,
    });
    await req('POST', '/api/automations/run');
    const mariaMsgs = (await req('GET', `/api/messages?clientId=${clientId}`)).data;
    const mariaLast = mariaMsgs[mariaMsgs.length - 1];
    assert(mariaLast.text.includes('Firma pendiente') && !mariaLast.viaTemplate,
      'con la ventana abierta se sigue usando texto libre');

    console.log('Citas');
    await req('PUT', '/api/automations', { appointments: { enabled: true } });
    const tomorrow = (() => {
      const t = new Date();
      t.setDate(t.getDate() + 1);
      return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    })();
    const appt = await req('POST', '/api/appointments', {
      clientId, date: tomorrow, time: '10:30', reason: 'Firma declaración renta',
    });
    assert(appt.status === 201 && appt.data.status === 'activa', 'cita creada');
    assert(Boolean(appt.data.confirmationSentAt), 'confirmación de cita enviada al crearla');
    let mariaAppt = (await req('GET', `/api/messages?clientId=${clientId}`)).data;
    assert(mariaAppt[mariaAppt.length - 1].text.includes('10:30'), 'la confirmación incluye la hora');
    const runAppt = await req('POST', '/api/automations/run');
    assert(runAppt.data.executed.some((a) => a.type === 'appointment_reminder'),
      'recordatorio del día anterior enviado');
    const runAppt2 = await req('POST', '/api/automations/run');
    assert(!runAppt2.data.executed.some((a) => a.type === 'appointment_reminder'),
      'el recordatorio de cita no se duplica');
    const cancel = await req('PUT', `/api/appointments/${appt.data.id}`, { status: 'cancelada' });
    assert(cancel.data.status === 'cancelada', 'cita cancelable');
    const badAppt = await req('POST', '/api/appointments', { clientId, date: tomorrow });
    assert(badAppt.status === 400, 'cita sin hora rechazada');

    console.log('Notas internas y estados de conversación');
    const note = await req('POST', '/api/messages', { clientId, text: 'Prefiere que la llamemos por las tardes', note: true });
    assert(note.status === 201 && note.data.direction === 'note', 'nota interna creada sin enviarse');
    const meta = await req('PUT', `/api/clients/${clientId}`, { convStatus: 'pendiente', assignedTo: 'carmen' });
    assert(meta.data.convStatus === 'pendiente' && meta.data.assignedTo === 'carmen', 'estado y asignación guardados');
    const convsMeta = (await req('GET', '/api/conversations')).data.find((c) => c.clientId === clientId);
    assert(convsMeta.convStatus === 'pendiente' && convsMeta.assignedTo === 'carmen',
      'la bandeja refleja estado y persona asignada');
    const badStatus = await req('PUT', `/api/clients/${clientId}`, { convStatus: 'inventado' });
    assert(badStatus.data.convStatus === 'pendiente', 'estados de conversación no válidos se ignoran');

    console.log('Estadísticas');
    const stats = await req('GET', '/api/stats');
    assert(stats.data.messagesByDay.length === 14, 'serie de 14 días');
    assert(stats.data.messagesThisWeek > 0, 'mensajes de la semana contados');
    assert((stats.data.casesByStatus.completado || 0) >= 1, 'expedientes por estado');
    assert(stats.data.avgResponseMinutes === null || typeof stats.data.avgResponseMinutes === 'number',
      'tiempo medio de respuesta calculado');

    console.log('Copias de seguridad');
    const bk = await req('POST', '/api/backups');
    assert(bk.status === 201 && bk.data.name.startsWith('backup-'), 'copia creada bajo demanda');
    const bkList = await req('GET', '/api/backups');
    assert(bkList.data.length >= 1, 'listado de copias');
    const bkDown = await fetch(`${BASE}/api/backups/${bk.data.name}`);
    assert(bkDown.status === 200 && bkDown.headers.get('content-type') === 'application/gzip',
      'descarga de la copia en gzip');
    const bkBad = await fetch(`${BASE}/api/backups/..%2F..%2Fdb.json`);
    assert(bkBad.status === 404, 'nombres de copia maliciosos rechazados');

    console.log('Documentos por expediente');
    const link = await req('PUT', `/api/messages/${fileMsg.data.id}`, { caseId: kase.data.id });
    assert(link.status === 200 && link.data.caseId === kase.data.id, 'adjunto vinculado al expediente');
    const files = await req('GET', `/api/cases/${kase.data.id}/files`);
    assert(files.data.length === 1 && files.data[0].filename === 'justificante.pdf',
      'el expediente lista sus documentos');
    const badLink = await req('PUT', `/api/messages/${fileMsg.data.id}`, { caseId: 'exp_inexistente' });
    assert(badLink.status === 404, 'vínculo a expediente inexistente rechazado');

    console.log('Fichas de trámite');
    const fichas = await req('GET', '/api/fichas');
    assert(fichas.status === 200 && fichas.data.length >= 4, 'fichas de ejemplo precargadas');
    assert(fichas.data.some((f) => f.title === 'Arraigo social' && f.area === 'extranjeria'),
      'incluye la ficha de Arraigo social en extranjería');
    const newFicha = await req('POST', '/api/fichas', {
      title: 'Nacionalidad española', area: 'extranjeria',
      intro: 'Hola {nombre}, para tu {tramite} necesitamos:', docs: '• Certificado de nacimiento\n• Certificado de antecedentes', notes: 'Gracias.',
    });
    assert(newFicha.status === 201 && newFicha.data.id, 'ficha nueva creada');
    // Enviar la ficha al cliente compone el mensaje con {nombre} y {tramite}.
    const fichaMsg = await req('POST', '/api/messages', { clientId, fichaId: newFicha.data.id });
    assert(fichaMsg.status === 201 && fichaMsg.data.text.includes('María')
      && fichaMsg.data.text.includes('Nacionalidad española')
      && fichaMsg.data.text.includes('Certificado de nacimiento'),
      'ficha enviada al cliente con la documentación y variables sustituidas');
    const fichaBad = await req('POST', '/api/messages', { clientId, fichaId: 'no-existe' });
    assert(fichaBad.status === 404, 'ficha inexistente rechazada');
    const delFicha = await req('DELETE', '/api/fichas/' + newFicha.data.id);
    assert(delFicha.status === 200, 'ficha eliminable');

    console.log('Stickers');
    const stickers = await req('GET', '/api/stickers');
    assert(stickers.status === 200 && stickers.data.length >= 8, 'catálogo de stickers disponible');
    assert(stickers.data.some((s) => s.id === 'completado' && s.file.endsWith('.webp')),
      'incluye el sticker «completado» en webp');
    const stFile = await fetch(`${BASE}/stickers/${stickers.data[0].file}`);
    assert(stFile.status === 200 && stFile.headers.get('content-type') === 'image/webp',
      'el fichero del sticker se sirve como image/webp');
    const stSend = await req('POST', '/api/messages', { clientId, stickerId: 'gracias' });
    assert(stSend.status === 201 && stSend.data.media?.kind === 'sticker'
      && stSend.data.media.stickerUrl === '/stickers/gracias.webp', 'sticker enviado como mensaje');
    const stBad = await req('POST', '/api/messages', { clientId, stickerId: 'no-existe' });
    assert(stBad.status === 404, 'sticker inexistente rechazado');

    console.log('Microsoft 365');
    const msgraph = require('./lib/msgraph');
    const evt = msgraph.buildEventPayload(
      { date: '2026-09-15', time: '10:45', reason: 'Firma renta', notes: 'Traer DNI' },
      { name: 'María López', phone: '34612345678' },
    );
    assert(evt.subject === 'Cita: María López — Firma renta', 'evento Outlook: asunto correcto');
    assert(evt.start.dateTime === '2026-09-15T10:45:00' && evt.end.dateTime === '2026-09-15T11:15:00',
      'evento Outlook: 30 minutos de duración');
    assert(evt.start.timeZone === 'Europe/Madrid', 'evento Outlook: zona horaria de España');
    const evtCross = msgraph.buildEventPayload({ date: '2026-09-15', time: '13:45' }, { name: 'X', phone: '1' });
    assert(evtCross.end.dateTime === '2026-09-15T14:15:00', 'evento Outlook: cruce de hora correcto');

    const folder = msgraph.buildFolderPath(
      '{aa} CLIENTES/{aa} PARTICULARES/{aa} {cliente}/CRM WHATSAPP',
      { name: 'María López' }, new Date('2026-07-25T12:00:00'),
    );
    assert(folder === '26 CLIENTES/26 PARTICULARES/26 MARÍA LÓPEZ/CRM WHATSAPP',
      'carpeta SharePoint según la estructura de Burocracia Zero');
    const folderClean = msgraph.buildFolderPath('{aaaa}/{cliente}', { name: 'A:B*C?' }, new Date('2026-01-01T12:00:00'));
    assert(folderClean === '2026/ABC', 'caracteres no válidos eliminados de la ruta');

    const msTest = await req('GET', '/api/test-microsoft');
    assert(msTest.status === 200 && msTest.data.configured === false && msTest.data.ok === false,
      'sin credenciales de Microsoft, la prueba lo indica');
    const msSettings = await req('PUT', '/api/automations', {
      microsoft: { calendar: { enabled: true, user: 'jose@burocraciazero.es' } },
    });
    assert(msSettings.data.microsoft.calendar.enabled === true
      && msSettings.data.microsoft.sharepoint.hostname === 'ejerciendolaciudadania.sharepoint.com',
      'configuración de Microsoft 365 guardada con los valores del sitio');
    // Cita con calendario activado pero sin credenciales → se crea sin evento.
    const apptNoMs = await req('POST', '/api/appointments', {
      clientId, date: tomorrow, time: '17:00', reason: 'Consulta laboral',
    });
    assert(apptNoMs.status === 201 && !apptNoMs.data.msEventId,
      'sin credenciales la cita se crea igualmente sin evento de Outlook');

    console.log('Prueba de conexión');
    const testConn = await req('GET', '/api/test-connection');
    assert(testConn.status === 200 && testConn.data.ok === false
      && testConn.data.detail.includes('demo'), 'sin credenciales, la prueba de conexión informa del modo demo');

    console.log('Segmento de cliente y bloques de expedientes');
    const segClient = await req('POST', '/api/clients', {
      name: 'Talleres GEISA SL', phone: '911223344', segment: 'empresa', tags: ['empresa'],
    });
    assert(segClient.status === 201 && segClient.data.segment === 'empresa', 'cliente creado con segmento empresa');
    const badSeg = await req('POST', '/api/clients', { name: 'Sin seg', phone: '911223355', segment: 'inventado' });
    assert(badSeg.data.segment === 'particular', 'segmento no válido cae a particular por defecto');
    const segUpd = await req('PUT', `/api/clients/${segClient.data.id}`, { segment: 'autonomo' });
    assert(segUpd.data.segment === 'autonomo', 'segmento del cliente actualizable');
    // Expediente del cliente empresa/autónomo: se agrupa por su segmento.
    await req('POST', '/api/cases', {
      clientId: segClient.data.id, title: 'Cuentas anuales 2025', type: 'contabilidad', status: 'en_curso',
    });
    const casesSeg = await req('GET', `/api/cases?clientId=${segClient.data.id}`);
    assert(casesSeg.data.length === 1 && casesSeg.data[0].type === 'contabilidad', 'expediente vinculado al cliente con segmento');

    // La ruta de SharePoint usa el segmento (estructura real de la gestoría).
    const msgraphSeg = require('./lib/msgraph');
    const fParticular = msgraphSeg.buildFolderPath('{aa} CLIENTES/{aa} {segmento}/{aa} {cliente}', { name: 'Ana', segment: 'particular' }, new Date('2026-07-25T12:00:00'));
    assert(fParticular === '26 CLIENTES/26 PARTICULARES/26 ANA', 'carpeta SharePoint para particular');
    const fEmpresa = msgraphSeg.buildFolderPath('{aa} CLIENTES/{aa} {segmento}/{aa} {cliente}', { name: 'GEISA', segment: 'empresa' }, new Date('2026-07-25T12:00:00'));
    assert(fEmpresa === '26 CLIENTES/26 EMPRESAS/26 GEISA', 'carpeta SharePoint para empresa');

    console.log('Carpeta de SharePoint del cliente');
    const spClient = await req('POST', '/api/clients', {
      name: 'Cliente Con Carpeta', phone: '911999888', segment: 'empresa',
      sharepointFolder: { path: '26 CLIENTES/26 EMPRESAS/26 CLIENTE CON CARPETA', webUrl: 'https://sp/x' },
    });
    assert(spClient.status === 201 && spClient.data.sharepointFolder?.path.includes('EMPRESAS'),
      'cliente creado con carpeta de SharePoint vinculada');
    const spUnlink = await req('PUT', `/api/clients/${spClient.data.id}`, { sharepointFolder: null });
    assert(spUnlink.data.sharepointFolder === null, 'carpeta desvinculable');
    // Sin credenciales de Microsoft, los endpoints degradan sin romper.
    const spSuggest = await req('GET', '/api/sharepoint/suggest?name=Ana&segment=particular');
    assert(spSuggest.status === 200 && spSuggest.data.configured === false,
      'sugerencia de carpeta indica que Microsoft no está configurado');
    const spFolders = await req('GET', '/api/sharepoint/folders?path=');
    assert(spFolders.data.configured === false, 'listado de carpetas indica no configurado');

    console.log('Búsqueda en conversaciones');
    const found = await req('GET', '/api/search-messages?q=nóminas');
    assert(found.data.length >= 1 && found.data[0].clientName === 'Ana Torres',
      'búsqueda encuentra mensajes por nombre de adjunto');
    const shortQ = await req('GET', '/api/search-messages?q=a');
    assert(shortQ.data.length === 0, 'consultas de menos de 2 letras no buscan');

    console.log('Exportación CSV');
    const csvClients = await fetch(`${BASE}/api/export/clients.csv`);
    const csvClientsText = await csvClients.text();
    assert(csvClients.status === 200 && csvClients.headers.get('content-type').includes('text/csv'),
      'exportación de clientes responde CSV');
    assert(csvClientsText.includes('María López') && csvClientsText.includes('"Nombre"'),
      'el CSV de clientes incluye cabecera y datos');
    const csvCases = await fetch(`${BASE}/api/export/cases.csv`);
    assert((await csvCases.text()).includes('Declaración renta 2025'), 'el CSV de expedientes incluye datos');

    console.log('Campañas por etiqueta');
    const campBad = await req('POST', '/api/campaigns', { tag: 'inexistente', text: 'Hola' });
    assert(campBad.status === 400, 'campaña con etiqueta sin clientes rechazada');
    const camp = await req('POST', '/api/campaigns', { tag: 'renta', text: 'Hola {nombre}, ya está abierta la campaña de la renta.' });
    assert(camp.status === 201 && camp.data.total === 1 && camp.data.ok === 1,
      'campaña enviada a los clientes de la etiqueta');
    const mariaCamp = (await req('GET', `/api/messages?clientId=${clientId}`)).data;
    const campMsg = mariaCamp[mariaCamp.length - 1];
    assert(campMsg.text.includes('María') && campMsg.auto === true,
      'mensaje de campaña personalizado con {nombre}');
    const campList = await req('GET', '/api/campaigns');
    assert(campList.data.length === 1 && campList.data[0].tag === 'renta', 'histórico de campañas guardado');

    console.log('Seguridad');
    const secHome = await fetch(`${BASE}/`);
    assert((secHome.headers.get('content-security-policy') || '').includes("default-src 'self'"),
      'CSP aplicada en la interfaz');
    assert(secHome.headers.get('x-content-type-options') === 'nosniff', 'nosniff aplicado');
    assert(secHome.headers.get('x-frame-options') === 'DENY', 'protección contra clickjacking');
    const secApi = await fetch(`${BASE}/api/status`);
    assert((secApi.headers.get('content-security-policy') || '').length > 0, 'CSP también en la API');

    // Firmas de webhook (funciones puras).
    const sec = require('./lib/security');
    const cryptoMod = require('crypto');
    const secret = 'secreto-de-prueba';
    const rawBody = '{"type":"whatsapp.inbound_message.received"}';
    const ts = Math.floor(Date.now() / 1000);
    const goodSig = cryptoMod.createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
    assert(sec.verifyYCloudSignature(rawBody, `t=${ts},s=${goodSig}`, secret) === true,
      'firma de YCloud válida aceptada');
    assert(sec.verifyYCloudSignature(rawBody, `t=${ts},s=deadbeef`, secret) === false,
      'firma de YCloud incorrecta rechazada');
    assert(sec.verifyYCloudSignature(rawBody, `t=${ts - 900},s=${goodSig}`, secret) === false,
      'firma con timestamp antiguo rechazada (anti-replay)');
    const metaSig = 'sha256=' + cryptoMod.createHmac('sha256', 'app-secret').update(rawBody).digest('hex');
    assert(sec.verifyMetaSignature(rawBody, metaSig, 'app-secret') === true, 'firma de Meta válida aceptada');
    assert(sec.verifyMetaSignature(rawBody, 'sha256=malo', 'app-secret') === false, 'firma de Meta incorrecta rechazada');

    // Adjuntos peligrosos se sirven como descarga con sandbox.
    const dispSvg = sec.mediaDisposition('image/svg+xml', 'malicioso.svg');
    assert(dispSvg.disposition.startsWith('attachment') && dispSvg.extraHeaders['Content-Security-Policy'] === 'sandbox',
      'SVG servido como descarga con CSP sandbox');
    const dispPdf = sec.mediaDisposition('application/pdf', 'factura.pdf');
    assert(dispPdf.disposition.startsWith('inline'), 'PDF puede verse en línea');

    // El enlace de un adjunto entrante solo puede apuntar a hosts del
    // proveedor (evita filtrar la API key a un servidor atacante).
    const waLib = require('./lib/whatsapp');
    assert(waLib.isTrustedMediaUrl('https://waba-v2.360dialog.io/media/x') === true, 'host 360dialog de confianza');
    assert(waLib.isTrustedMediaUrl('https://storage.ycloud.com/abc') === true, 'host ycloud de confianza');
    assert(waLib.isTrustedMediaUrl('https://mmg.whatsapp.net/x') === true, 'host whatsapp.net de confianza');
    assert(waLib.isTrustedMediaUrl('https://attacker.example/x.jpg') === false, 'host arbitrario rechazado');
    assert(waLib.isTrustedMediaUrl('http://storage.ycloud.com/x') === false, 'http (no https) rechazado');
    assert(waLib.isTrustedMediaUrl('https://ycloud.com.attacker.example/x') === false, 'host que imita al proveedor rechazado');

    await testSignedWebhookServer();

    console.log('Autenticación');
    const authOff = await req('GET', '/api/auth');
    assert(authOff.data.required === false, 'sin CRM_PASSWORD la autenticación está desactivada');
    await testAuthServer();

    console.log('Borrado en cascada');
    await req('DELETE', `/api/clients/${clientId}`);
    const casesAfter = await req('GET', '/api/cases');
    assert(casesAfter.data.every((c) => c.clientId !== clientId), 'expedientes del cliente eliminados');
  } finally {
    server.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  console.log(`\n${passed} pruebas correctas, ${failed} fallidas.`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
