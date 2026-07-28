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
      CRM_PASSWORD: 'secreto123', CRM_CAPTCHA: 'off',
      WHATSAPP_TOKEN: '', WHATSAPP_PHONE_NUMBER_ID: '',
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
      CRM_USERS: 'carmen:clave1,juan:clave2', CRM_PASSWORD: '', CRM_CAPTCHA: 'off',
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

// CAPTCHA del acceso: obligatorio, de un solo uso y con caducidad.
async function testCaptchaServer() {
  const CAP_PORT = 3781;
  const CAP_BASE = `http://127.0.0.1:${CAP_PORT}`;
  const capDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-cap-'));
  const server = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: {
      ...process.env, PORT: String(CAP_PORT), DATA_DIR: capDataDir,
      CRM_PASSWORD: 'secreto123', CRM_CAPTCHA: 'on', CRM_CAPTCHA_TEST: '1',
      WHATSAPP_TOKEN: '', WHATSAPP_PHONE_NUMBER_ID: '',
    },
    stdio: 'ignore',
  });
  const post = (body) => fetch(CAP_BASE + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    for (let i = 0; i < 50; i += 1) {
      try { await fetch(CAP_BASE + '/api/auth'); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    const cap = await (await fetch(CAP_BASE + '/api/captcha')).json();
    assert(cap.enabled === true && typeof cap.id === 'string', 'el CAPTCHA está activado y genera un id');
    assert(String(cap.image).startsWith('data:image/svg+xml;base64,'), 'el CAPTCHA se sirve como imagen SVG en línea');
    assert(typeof cap.answer === 'string' && cap.answer.length === 5, 'CRM_CAPTCHA_TEST expone la respuesta para las pruebas');

    const noCaptcha = await post({ user: 'admin', password: 'secreto123' });
    assert(noCaptcha.status === 400, 'sin CAPTCHA no se puede iniciar sesión');

    const cap2 = await (await fetch(CAP_BASE + '/api/captcha')).json();
    const wrong = await post({ user: 'admin', password: 'secreto123', captchaId: cap2.id, captcha: 'ZZZZZ' });
    assert(wrong.status === 400, 'CAPTCHA incorrecto → rechazado');

    const cap3 = await (await fetch(CAP_BASE + '/api/captcha')).json();
    const good = await post({ user: 'admin', password: 'secreto123', captchaId: cap3.id, captcha: cap3.answer.toLowerCase() });
    assert(good.status === 200, 'CAPTCHA correcto (sin distinguir mayúsculas) + contraseña → acceso');
    assert((good.headers.get('set-cookie') || '').startsWith('crm_session='), 'se emite la cookie de sesión');

    const reuse = await post({ user: 'admin', password: 'secreto123', captchaId: cap3.id, captcha: cap3.answer });
    assert(reuse.status === 400, 'un CAPTCHA no se puede reutilizar (un solo uso)');

    const cap4 = await (await fetch(CAP_BASE + '/api/captcha')).json();
    const rightCapWrongPass = await post({ user: 'admin', password: 'mala', captchaId: cap4.id, captcha: cap4.answer });
    assert(rightCapWrongPass.status === 401, 'CAPTCHA correcto pero contraseña mala → 401');
  } finally {
    server.kill();
    fs.rmSync(capDataDir, { recursive: true, force: true });
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

    console.log('Importar contactos (vCard)');
    const numClient = await req('POST', '/api/clients', { name: '612000111', phone: '612000111' });
    const vcard = [
      'BEGIN:VCARD', 'VERSION:3.0', 'FN:Pedro Gómez', 'TEL;TYPE=CELL:+34 612 000 111', 'END:VCARD',
      'BEGIN:VCARD', 'VERSION:3.0', 'FN:Nombre Distinto', 'TEL:612345678', 'END:VCARD',
    ].join('\n');
    const imp = await req('POST', '/api/contacts/import', { vcard });
    assert(imp.data.contacts === 2, 'lee los contactos del vCard');
    assert(imp.data.matched === 2, 'empareja los contactos por teléfono con los clientes');
    assert(imp.data.updated === 1, 'solo rellena el nombre del cliente sin nombre (no pisa los ya nombrados)');
    const pedroImp = (await req('GET', '/api/clients?q=Pedro')).data;
    assert(pedroImp.some((c) => c.name === 'Pedro Gómez'), 'el cliente sin nombre recibe el nombre del contacto');
    const stillMaria = (await req('GET', '/api/clients?q=María')).data;
    assert(stillMaria.some((c) => c.name === 'María López'), 'no se sobrescribe un nombre ya editado');
    await req('DELETE', '/api/clients/' + numClient.data.id); // limpieza: no altera el conteo del panel

    console.log('Mensajes');
    const sent = await req('POST', '/api/messages', { clientId, text: 'Hola María' });
    assert(sent.status === 201 && sent.data.status === 'demo', 'envío en modo demo');
    const empty = await req('POST', '/api/messages', { clientId, text: '  ' });
    assert(empty.status === 400, 'mensaje vacío rechazado');

    // Responder citando un mensaje: la respuesta guarda la cita del original.
    const reply = await req('POST', '/api/messages', { clientId, text: 'Te respondo a esto', replyTo: sent.data.id });
    assert(reply.status === 201 && reply.data.replyTo && reply.data.replyTo.id === sent.data.id
      && /Hola María/.test(reply.data.replyTo.text), 'la respuesta cita el mensaje original');
    const replyBad = await req('POST', '/api/messages', { clientId, text: 'Cita inexistente', replyTo: 'no-existe' });
    assert(replyBad.status === 201 && !replyBad.data.replyTo, 'una cita a un id inexistente se ignora sin fallar');

    // Nota de voz saliente: se envía como adjunto de audio.
    const voice = await req('POST', '/api/messages', {
      clientId, file: { data: Buffer.from('fake-ogg-audio').toString('base64'), mime: 'audio/ogg', name: 'nota-voz.ogg' },
    });
    assert(voice.status === 201 && voice.data.media && voice.data.media.kind === 'audio',
      'la nota de voz se guarda como adjunto de audio');

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

    console.log('Nota fija del cliente');
    const withNote = await req('PUT', '/api/clients/' + clientId, { pinnedNote: 'Habla poco español, llamar por las tardes' });
    assert(withNote.data.pinnedNote === 'Habla poco español, llamar por las tardes', 'se guarda la nota fija');
    const noteLong = await req('PUT', '/api/clients/' + clientId, { pinnedNote: 'x'.repeat(600) });
    assert(noteLong.data.pinnedNote.length === 500, 'la nota fija se limita a 500 caracteres');
    await req('PUT', '/api/clients/' + clientId, { pinnedNote: '' }); // limpieza

    console.log('Mensajes programados');
    const schBad = await req('POST', '/api/scheduled-messages', { clientId, text: 'tarde', sendAt: Date.now() - 1000 });
    assert(schBad.status === 400, 'fecha pasada rechazada');
    const schEmpty = await req('POST', '/api/scheduled-messages', { clientId, text: '  ', sendAt: Date.now() + 3600_000 });
    assert(schEmpty.status === 400, 'mensaje programado vacío rechazado');
    const schNoClient = await req('POST', '/api/scheduled-messages', { clientId: 'no-existe', text: 'hola', sendAt: Date.now() + 3600_000 });
    assert(schNoClient.status === 404, 'cliente inexistente → 404');
    const sch = await req('POST', '/api/scheduled-messages', { clientId, text: 'Recordatorio de cita', sendAt: Date.now() + 3600_000 });
    assert(sch.status === 201 && sch.data.status === 'pendiente', 'mensaje programado creado');
    const schList = await req('GET', '/api/scheduled-messages?clientId=' + clientId);
    assert(schList.data.some((s) => s.id === sch.data.id), 'aparece en la lista de programados del cliente');
    const schDel = await req('DELETE', '/api/scheduled-messages/' + sch.data.id);
    assert(schDel.status === 200, 'cancelar mensaje programado');
    const schList2 = await req('GET', '/api/scheduled-messages?clientId=' + clientId);
    assert(!schList2.data.some((s) => s.id === sch.data.id), 'ya no aparece tras cancelar');

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

    // Honorarios + checklist de documentación.
    const feed = await req('POST', '/api/cases', {
      clientId, title: 'Arraigo social', type: 'extranjeria', fee: 250, paid: true,
      checklist: [{ item: 'Pasaporte', done: true }, { item: 'Empadronamiento', done: false }, { item: '', done: true }],
    });
    assert(feed.data.fee === 250 && feed.data.paid === true, 'expediente guarda honorario y estado de cobro');
    assert(feed.data.checklist.length === 2 && feed.data.checklist[0].done === true,
      'checklist filtra ítems vacíos y conserva marcas');
    const feed2 = await req('PUT', `/api/cases/${feed.data.id}`, {
      paid: false, checklist: [{ item: 'Pasaporte', done: true }], status: 'completado',
    });
    assert(feed2.data.paid === false && feed2.data.checklist.length === 1, 'editar honorario/checklist del expediente');

    // Tasas oficiales (separadas de los honorarios de la gestoría).
    const taxCase = await req('POST', '/api/cases', {
      clientId, title: 'Nacionalidad', type: 'extranjeria', fee: 400, paid: false,
      taxModel: '790 cód. 026', taxAmount: 104.05, taxPaid: false,
    });
    assert(taxCase.data.taxModel === '790 cód. 026' && taxCase.data.taxAmount === 104.05 && taxCase.data.taxPaid === false,
      'expediente guarda la tasa oficial (modelo, importe y estado)');
    const taxUpd = await req('PUT', `/api/cases/${taxCase.data.id}`, { taxPaid: true });
    assert(taxUpd.data.taxPaid === true, 'marcar la tasa oficial como abonada');
    await req('PUT', `/api/cases/${taxCase.data.id}`, { status: 'completado' }); // no altera el conteo del panel

    console.log('Tareas del equipo');
    const taskBad = await req('POST', '/api/tasks', { title: '   ' });
    assert(taskBad.status === 400, 'tarea sin título rechazada');
    const task = await req('POST', '/api/tasks', { title: 'Preparar cita extranjería', assignee: 'Carmen', dueDate: '2026-08-01', clientId });
    assert(task.status === 201 && task.data.status === 'por_hacer', 'crear tarea (por hacer)');
    const taskList = await req('GET', '/api/tasks');
    assert(taskList.data.some((t) => t.id === task.data.id), 'la tarea aparece en la lista');
    const taskMove = await req('PUT', `/api/tasks/${task.data.id}`, { status: 'en_curso' });
    assert(taskMove.data.status === 'en_curso', 'mover la tarea a «en curso»');
    const taskBadStatus = await req('PUT', `/api/tasks/${task.data.id}`, { status: 'inventado' });
    assert(taskBadStatus.data.status === 'en_curso', 'un estado inválido no cambia la tarea');
    const taskDel = await req('DELETE', `/api/tasks/${task.data.id}`);
    assert(taskDel.status === 200, 'eliminar la tarea');
    assert(!(await req('GET', '/api/tasks')).data.some((t) => t.id === task.data.id), 'la tarea ya no está');

    console.log('Firma digital de documentos');
    const signDocs = await req('GET', '/api/signatures/docs');
    assert(signDocs.data.some((d) => d.key === 'representacion'), 'catálogo de documentos para firmar');
    const signReq = await req('POST', '/api/signatures', { clientId, docType: 'representacion', caseId: taxCase.data.id, send: false });
    assert(signReq.status === 201 && signReq.data.status === 'pendiente' && /\/firmar\//.test(signReq.data.signUrl),
      'crear solicitud de firma con enlace');
    const signBadClient = await req('POST', '/api/signatures', { clientId: 'no-existe', docType: 'rgpd' });
    assert(signBadClient.status === 404, 'firma con cliente inexistente → 404');
    const signToken = signReq.data.signUrl.split('/firmar/')[1];
    // La página pública de firma se sirve como HTML.
    const signPage = await fetch(BASE + '/firmar/' + signToken);
    const signHtml = await signPage.text();
    assert(signPage.status === 200 && /AUTORIZACIÓN DE REPRESENTACIÓN/.test(signHtml) && /id="pad"/.test(signHtml),
      'la página de firma muestra el documento y el lienzo');
    // Firma inválida (sin imagen) → 400.
    const signNoImg = await fetch(BASE + '/firmar/' + signToken, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Prueba', signature: '' }),
    });
    assert(signNoImg.status === 400, 'firma sin imagen rechazada');
    // Firma correcta (JPEG mínimo) → genera el PDF y adjunta el mensaje.
    const tinyJpeg = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
    const signDone = await fetch(BASE + '/firmar/' + signToken, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'María López', signature: tinyJpeg }),
    });
    assert(signDone.status === 200, 'firmar el documento devuelve 200');
    const signList = await req('GET', '/api/signatures?clientId=' + clientId);
    const signed = signList.data.find((s) => s.id === signReq.data.id);
    assert(signed && signed.status === 'firmado' && signed.signerName === 'María López', 'la firma queda registrada');
    assert(signed.messageId, 'el PDF firmado se adjunta a la conversación');
    // El PDF firmado se puede descargar desde /api/media/:id.
    const signPdf = await fetch(BASE + '/api/media/' + signed.messageId);
    assert(signPdf.status === 200 && (signPdf.headers.get('content-type') || '').includes('application/pdf'),
      'el PDF firmado se sirve como application/pdf');
    // Reabrir el enlace ya firmado muestra la confirmación.
    const signAgain = await (await fetch(BASE + '/firmar/' + signToken)).text();
    assert(/Documento firmado/.test(signAgain), 'el enlace ya firmado muestra la confirmación');

    console.log('Base de conocimiento (tarifas y trámites)');
    const kbSeed = await req('GET', '/api/knowledge');
    assert(kbSeed.data.length > 0 && kbSeed.data.some((k) => /Nacionalidad/i.test(k.title)),
      'la base de conocimiento se siembra con trámites por defecto');
    assert(kbSeed.data.some((k) => k.fee && k.docs), 'los trámites llevan honorarios y documentos');
    const kbBad = await req('POST', '/api/knowledge', { title: '   ' });
    assert(kbBad.status === 400, 'trámite sin título rechazado');
    const kbNew = await req('POST', '/api/knowledge', {
      title: 'Prueba tasa', area: 'fiscal', fee: '99 €', tax: 'Tasa X', docs: '• Uno\n• Dos', keywords: 'prueba test',
    });
    assert(kbNew.status === 201 && kbNew.data.fee === '99 €', 'crear un trámite en la base de conocimiento');
    const kbUpd = await req('PUT', '/api/knowledge/' + kbNew.data.id, { fee: '120 €' });
    assert(kbUpd.data.fee === '120 €' && kbUpd.data.title === 'Prueba tasa', 'editar un trámite');
    const kbDel = await req('DELETE', '/api/knowledge/' + kbNew.data.id);
    assert(kbDel.status === 200, 'eliminar un trámite');
    assert(!(await req('GET', '/api/knowledge')).data.some((k) => k.id === kbNew.data.id), 'el trámite ya no está');

    console.log('Plantillas y recordatorios');
    const tpl = await req('POST', '/api/templates', { name: 'Saludo', text: 'Hola {nombre}' });
    assert(tpl.status === 201, 'crear plantilla');
    const rem = await req('POST', '/api/reminders', { text: 'Llamar a María', dueDate: '2026-07-25', clientId });
    assert(rem.status === 201, 'crear recordatorio');

    console.log('Formularios (JotForm)');
    const formOk = await req('POST', '/api/forms', { name: 'Datos arraigo', url: 'https://www.jotform.com/tables/240000000000000' });
    assert(formOk.status === 201 && formOk.data.id, 'añadir un formulario de JotForm');
    const formEu = await req('POST', '/api/forms', { name: 'Renta', url: 'https://eu.jotform.com/240000000000001' });
    assert(formEu.status === 201, 'acepta enlaces de JotForm (europeo)');
    const formBad = await req('POST', '/api/forms', { name: 'Malo', url: 'https://evil.example.com/phish' });
    assert(formBad.status === 400, 'rechaza URLs que no son de JotForm');
    const formHttp = await req('POST', '/api/forms', { name: 'Sin https', url: 'http://www.jotform.com/x' });
    assert(formHttp.status === 400, 'rechaza enlaces sin https');
    const formsList = await req('GET', '/api/forms');
    assert(formsList.data.length === 2, 'lista de formularios guardada');
    const delForm = await req('DELETE', '/api/forms/' + formOk.data.id);
    assert(delForm.status === 200 && (await req('GET', '/api/forms')).data.length === 1, 'quitar un formulario');

    console.log('Automatizaciones');
    const autoDefaults = await req('GET', '/api/automations');
    assert(autoDefaults.status === 200 && autoDefaults.data.afterHours.enabled === false,
      'configuración por defecto: todo desactivado');
    // Copia de seguridad en la nube: la opción se guarda.
    const cloudSet = await req('PUT', '/api/automations', {
      microsoft: { backup: { enabled: true, folderPath: 'Copias CRM' } },
    });
    assert(cloudSet.data.microsoft.backup.enabled === true && cloudSet.data.microsoft.backup.folderPath === 'Copias CRM',
      'la subida de copias a la nube se configura');
    await req('PUT', '/api/automations', { microsoft: { backup: { enabled: false } } });

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

    console.log('Avisos de caducidad y renovación');
    await req('PUT', '/api/automations', {
      renewals: { enabled: true, daysBefore: 30, autoCreateCase: true, notifyClient: false },
    });
    await req('POST', '/api/cases', { clientId, title: 'TIE por arraigo', type: 'extranjeria', expiryDate: today });
    const runRen = await req('POST', '/api/automations/run');
    assert(runRen.data.executed.some((a) => a.type === 'renewal_notice'), 'aviso de caducidad ejecutado');
    const casesRen = (await req('GET', '/api/cases')).data;
    assert(casesRen.some((c) => c.title === 'Renovación: TIE por arraigo'), 'se crea el expediente de renovación');
    const remsRen = (await req('GET', '/api/reminders')).data;
    assert(remsRen.some((r) => /Renovar «TIE por arraigo»/.test(r.text)), 'se crea el recordatorio interno de renovación');
    const runRen2 = await req('POST', '/api/automations/run');
    assert(!runRen2.data.executed.some((a) => a.type === 'renewal_notice'), 'el aviso de caducidad no se duplica');
    const dashRen = await req('GET', '/api/dashboard');
    assert(dashRen.data.expiringSoon >= 1, 'el panel cuenta los expedientes que caducan pronto');

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

    console.log('Informes de trámites');
    const report = await req('GET', '/api/reports');
    assert(report.status === 200 && typeof report.data.total === 'number', 'informe de trámites responde');
    assert(report.data.byArea && typeof report.data.byArea === 'object', 'informe agrupa por área');
    assert(Array.isArray(report.data.byTitle), 'informe incluye el detalle por trámite');
    // Ingresos: el expediente de 250 € (extranjería) ya no está cobrado (paid:false).
    assert(report.data.facturado >= 250, 'informe suma lo facturado');
    assert(report.data.pendiente === report.data.facturado - report.data.cobrado, 'pendiente = facturado − cobrado');
    assert(report.data.incomeByArea.extranjeria && report.data.incomeByArea.extranjeria.facturado >= 250,
      'informe desglosa la facturación por área');
    // Informes financieros: tasas oficiales e ingresos por mes.
    assert(typeof report.data.taxFacturado === 'number' && report.data.taxPendiente === report.data.taxFacturado - report.data.taxCobrado,
      'informe incluye tasas: pendiente = gestionadas − abonadas');
    assert(report.data.incomeByMonth && typeof report.data.incomeByMonth === 'object', 'informe incluye ingresos por mes');
    // Con un rango de fechas imposible, no hay trámites.
    const emptyReport = await req('GET', '/api/reports?from=1999-01-01&to=1999-12-31');
    assert(emptyReport.data.total === 0, 'el filtro de fechas del informe acota los resultados');

    console.log('Por cobrar (honorarios y tasas pendientes)');
    // Cliente con honorarios pendientes (100 €) y tasa pendiente (30 €).
    const cobrClient = await req('POST', '/api/clients', { name: 'Deudor Prueba', phone: '600112233' });
    await req('POST', '/api/cases', {
      clientId: cobrClient.data.id, title: 'Trámite con saldo', type: 'otro',
      fee: 100, paid: false, taxModel: '790', taxAmount: 30, taxPaid: false, status: 'completado',
    });
    const receivables = await req('GET', '/api/receivables');
    const deudor = receivables.data.clients.find((e) => e.clientId === cobrClient.data.id);
    assert(deudor && deudor.honorarios === 100 && deudor.tasas === 30 && deudor.total === 130,
      'por cobrar agrupa honorarios y tasas pendientes por cliente');
    assert(receivables.data.total >= 130, 'por cobrar suma el total pendiente');
    const remind = await req('POST', '/api/receivables/remind', { clientId: cobrClient.data.id });
    assert(remind.status === 200 && remind.data.sent, 'reclamar por WhatsApp envía el recordatorio');
    const remindMsgs = (await req('GET', '/api/messages?clientId=' + cobrClient.data.id)).data;
    assert(remindMsgs.some((m) => /Total pendiente: 130/.test(m.text || '')), 'el recordatorio detalla el total pendiente');

    // Registrar cobro con forma de cobro (caja/banco).
    const collectBad = await req('POST', '/api/receivables/collect', { clientId: cobrClient.data.id, payMethod: 'tarjeta' });
    assert(collectBad.status === 400, 'forma de cobro inválida rechazada');
    const collect = await req('POST', '/api/receivables/collect', { clientId: cobrClient.data.id, payMethod: 'caja', includeTax: true });
    assert(collect.status === 200 && collect.data.honorarios === 100 && collect.data.tasas === 30,
      'registrar cobro marca honorarios y tasas pagados');
    const deudorCase = (await req('GET', '/api/cases?clientId=' + cobrClient.data.id)).data[0];
    assert(deudorCase.paid === true && deudorCase.payMethod === 'caja' && deudorCase.taxPaid === true,
      'el expediente guarda la forma de cobro (caja)');
    // El informe desglosa lo cobrado por caja y banco.
    const finReport = await req('GET', '/api/reports');
    assert(finReport.data.cobradoCaja >= 100 && typeof finReport.data.cobradoBanco === 'number',
      'el informe desglosa lo cobrado por caja y banco');
    // Al cobrarlo todo, el cliente desaparece de «por cobrar».
    const receivables2 = await req('GET', '/api/receivables');
    assert(!receivables2.data.clients.some((e) => e.clientId === cobrClient.data.id),
      'tras registrar el cobro, el cliente sale de «por cobrar»');
    await req('DELETE', '/api/clients/' + cobrClient.data.id); // limpieza (no altera el panel)
    // Exportación CSV del informe.
    const repCsv = await fetch(`${BASE}/api/export/informe.csv`);
    assert(repCsv.status === 200 && repCsv.headers.get('content-type').includes('text/csv'),
      'exportación del informe responde CSV');
    assert((await repCsv.text()).includes('Trámite'), 'el CSV del informe incluye la cabecera');

    console.log('Estado del trámite (página pública)');
    const linkRes = await req('POST', `/api/clients/${clientId}/estado-link`);
    assert(linkRes.status === 200 && typeof linkRes.data.token === 'string' && linkRes.data.token.length >= 16,
      'genera un token de estado para el cliente');
    const token = linkRes.data.token;
    const again = await req('POST', `/api/clients/${clientId}/estado-link`);
    assert(again.data.token === token, 'el token del enlace es estable entre llamadas');
    const page = await fetch(`${BASE}/estado/${token}`);
    const pageHtml = await page.text();
    assert(page.status === 200 && page.headers.get('content-type').includes('text/html'),
      'la página de estado responde HTML');
    assert(pageHtml.includes('Burocracia') && pageHtml.includes('Declaración renta 2025'),
      'la página muestra los trámites del cliente');
    assert(!pageHtml.includes('250') && !/honorario/i.test(pageHtml),
      'la página pública no filtra honorarios ni datos internos');
    const badPage = await fetch(`${BASE}/estado/token-inexistente-1234567890`);
    assert(badPage.status === 404, 'token inválido → 404 en la página de estado');

    // Multi-idioma: por parámetro, por RTL y por cabecera Accept-Language.
    const pageEn = await (await fetch(`${BASE}/estado/${token}?lang=en`)).text();
    assert(/lang="en"/.test(pageEn) && pageEn.includes('Deadline'), 'la página se traduce al inglés (?lang=en)');
    const pageAr = await (await fetch(`${BASE}/estado/${token}?lang=ar`)).text();
    assert(/dir="rtl"/.test(pageAr), 'el árabe se sirve en RTL');
    const pageFr = await (await fetch(`${BASE}/estado/${token}`, { headers: { 'Accept-Language': 'fr-FR,fr;q=0.9' } })).text();
    assert(pageFr.includes('Date limite'), 'detecta el idioma por la cabecera Accept-Language');

    console.log('Portal de documentos del cliente');
    const upCase = await req('POST', '/api/cases', {
      clientId, title: 'Reagrupación familiar', type: 'extranjeria',
      checklist: [{ item: 'Certificado de matrimonio', done: false }],
    });
    const okUp = await req('POST', `/estado/${token}/upload`, {
      caseId: upCase.data.id, itemIndex: 0, filename: 'acta.pdf', mime: 'application/pdf',
      dataBase64: Buffer.from('DEMO-DOC').toString('base64'),
    });
    assert(okUp.status === 200 && okUp.data.done === 1, 'el cliente sube un documento y avanza el checklist');
    const upAfter = (await req('GET', '/api/cases')).data.find((c) => c.id === upCase.data.id);
    assert(upAfter.checklist[0].done === true, 'el ítem del checklist queda como recibido');
    const portalMsgs = (await req('GET', `/api/messages?clientId=${clientId}`)).data;
    assert(portalMsgs.some((m) => m.viaPortal && m.direction === 'in'), 'la subida entra como mensaje en el chat');
    const badMime = await req('POST', `/estado/${token}/upload`, {
      caseId: upCase.data.id, itemIndex: 0, filename: 'x.svg', mime: 'image/svg+xml',
      dataBase64: Buffer.from('<svg/>').toString('base64'),
    });
    assert(badMime.status === 415, 'rechaza formatos no permitidos (SVG)');
    const badTokUp = await req('POST', '/estado/token-falso-1234567890/upload', {
      caseId: upCase.data.id, itemIndex: 0, filename: 'a.pdf', mime: 'application/pdf', dataBase64: 'AA==',
    });
    assert(badTokUp.status === 404, 'no se puede subir con un token inválido');

    console.log('Reserva de cita online');
    await req('PUT', '/api/automations', { booking: { enabled: true, slotMinutes: 30, horizonDays: 7, maxPerDay: 12 } });
    const bookHtml = await (await fetch(`${BASE}/reservar/${token}`)).text();
    assert(/class="bk-slot"/.test(bookHtml), 'la página de reserva muestra huecos libres');
    const slot = (bookHtml.match(/name="slot" value="([^"]+)"/) || [])[1];
    assert(Boolean(slot), 'hay al menos un hueco reservable');
    const apptsBefore = (await req('GET', '/api/appointments')).data.length;
    const booked = await fetch(`${BASE}/reservar/${token}`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'slot=' + encodeURIComponent(slot),
    });
    const bookedHtml = await booked.text();
    assert(booked.status === 200 && bookedHtml.includes('¡Cita reservada!'), 'reservar un hueco muestra la confirmación');
    const apptsAfter = (await req('GET', '/api/appointments')).data;
    assert(apptsAfter.length === apptsBefore + 1, 'la reserva crea la cita');
    const [slotDate, slotTime] = slot.split('T');
    assert(apptsAfter.some((a) => a.date === slotDate && a.time === slotTime && a.status === 'activa'),
      'la cita reservada queda registrada como activa');
    const dbl = await (await fetch(`${BASE}/reservar/${token}`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'slot=' + encodeURIComponent(slot),
    })).text();
    assert(/class="book-note"/.test(dbl) && !dbl.includes('¡Cita reservada!'),
      'un hueco ya ocupado no se puede volver a reservar');
    await req('PUT', '/api/automations', { booking: { enabled: false } });
    const bookingOff = await fetch(`${BASE}/reservar/${token}`);
    assert(bookingOff.status === 404, 'con la reserva desactivada el enlace no funciona');

    console.log('Consentimiento RGPD');
    const consentPage = await (await fetch(`${BASE}/estado/${token}`)).text();
    assert(/class="consent"/.test(consentPage), 'la página muestra el formulario de consentimiento');
    const consent = await fetch(`${BASE}/estado/${token}/consent`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: '', redirect: 'manual',
    });
    assert(consent.status === 303, 'aceptar el consentimiento redirige de vuelta a la página');
    const consentedClient = (await req('GET', `/api/clients/${clientId}`)).data;
    assert(consentedClient.consent && consentedClient.consent.acceptedAt, 'el consentimiento queda registrado con fecha');
    const afterConsent = await (await fetch(`${BASE}/estado/${token}`)).text();
    assert(/consent-done/.test(afterConsent) && !/class="consent"/.test(afterConsent),
      'tras aceptar se muestra la confirmación, no el formulario');

    console.log('Recordatorio de honorarios pendientes');
    await req('POST', '/api/cases', { clientId, title: 'Cita previa extranjería', type: 'extranjeria', status: 'completado', fee: 50, paid: false });
    await req('PUT', '/api/automations', { payments: { enabled: true, daysAfter: 0, onlyCompleted: true } });
    const runPay = await req('POST', '/api/automations/run');
    assert(runPay.data.executed.some((a) => a.type === 'payment_reminder'), 'recordatorio de honorarios ejecutado');
    const payMsgs = (await req('GET', `/api/messages?clientId=${clientId}`)).data;
    assert(payMsgs.some((m) => /50/.test(m.text) && /pendiente|pago/i.test(m.text)), 'el aviso incluye el importe pendiente');
    const runPay2 = await req('POST', '/api/automations/run');
    assert(!runPay2.data.executed.some((a) => a.type === 'payment_reminder'), 'el aviso de honorarios no se duplica');
    await req('PUT', '/api/automations', { payments: { enabled: false } });

    console.log('Transcripción de notas de voz');
    const trCfg = await req('PUT', '/api/automations', { transcription: { enabled: true } });
    assert(trCfg.data.transcription.enabled === true, 'la transcripción se puede activar');
    const tr = require('./lib/transcribe');
    assert(tr.isConfigured() === false, 'sin clave la transcripción está desconfigurada (no se envía audio)');
    const mp = tr.buildMultipart({ model: 'whisper-1' }, { filename: 'a.ogg', mime: 'audio/ogg', buffer: Buffer.from('AUDIO') });
    assert(mp.boundary && Buffer.isBuffer(mp.body) && mp.body.includes(Buffer.from('whisper-1')),
      'el cuerpo multipart de transcripción se construye correctamente');
    await req('PUT', '/api/automations', { transcription: { enabled: false } });

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
    assert(fichas.status === 200 && fichas.data.length >= 32, 'fichas predefinidas precargadas (todos los packs)');
    assert(fichas.data.some((f) => f.title === 'Arraigo social' && f.area === 'extranjeria'),
      'incluye la ficha de Arraigo social en extranjería');
    // Pack de tráfico (DGT).
    const trafico = fichas.data.filter((f) => f.area === 'vehiculos');
    assert(trafico.length >= 8, 'el pack de tráfico añade sus fichas al área vehículos');
    assert(trafico.some((f) => f.title === 'Notificación de venta' && f.notes.includes('10 días')),
      'ficha de notificación de venta con el plazo de 10 días');
    assert(trafico.some((f) => f.title.startsWith('Canje') && f.docs.includes('psicofísica')),
      'ficha de canje de permiso extranjero con el informe psicofísico');
    // Pack de extranjería (RD 1155/2024 / Instrucción SEM 1/2025).
    const extranjeria = fichas.data.filter((f) => f.area === 'extranjeria');
    assert(extranjeria.length >= 9, 'el pack de extranjería añade sus fichas');
    assert(extranjeria.some((f) => f.title === 'Arraigo sociolaboral' && f.docs.includes('20 horas')),
      'arraigo sociolaboral con el contrato de 20 horas');
    assert(extranjeria.some((f) => f.title === 'Arraigo socioformativo' && f.docs.includes('50% presencial')),
      'arraigo socioformativo con el mínimo de presencialidad');
    assert(extranjeria.some((f) => f.title === 'Reagrupación familiar' && f.docs.includes('EX-02')),
      'reagrupación familiar con el modelo EX-02');
    assert(extranjeria.some((f) => f.notes.includes('SEM 1/2025')),
      'las fichas citan la Instrucción SEM 1/2025');
    assert(extranjeria.some((f) => f.title.startsWith('Modificación por razones humanitarias')
      && f.docs.includes('EX-03') && f.notes.includes('316/2026')),
      'ficha de modificación por razones humanitarias con formularios y RD 316/2026');

    // Pack de prestaciones de la Seguridad Social.
    const pensiones = fichas.data.filter((f) => f.area === 'pensiones');
    assert(pensiones.length >= 6, 'el pack de prestaciones añade sus fichas');
    assert(pensiones.some((f) => f.title === 'Pensión de jubilación' && f.docs.includes('vida laboral')),
      'pensión de jubilación con el informe de vida laboral');
    assert(pensiones.some((f) => f.title === 'Ingreso Mínimo Vital (IMV)' && f.docs.includes('unidad de convivencia')),
      'IMV con la documentación de la unidad de convivencia');

    // Packs de SEPE y de la Junta de CLM.
    assert(pensiones.some((f) => f.title.includes('paro contributivo') && f.docs.includes('Certificado de empresa')),
      'SEPE: prestación por desempleo con certificado de empresa');
    const social = fichas.data.filter((f) => f.area === 'social');
    assert(social.length >= 5, 'el pack de la Junta de CLM añade sus fichas de servicios sociales');
    assert(social.some((f) => f.title.includes('dependencia') && f.notes.includes('Decreto 1/2019')),
      'dependencia CLM con el Decreto 1/2019');
    assert(social.some((f) => f.title.includes('discapacidad') && f.notes.includes('Orden 81/2023')),
      'discapacidad CLM con la Orden 81/2023');
    assert(social.some((f) => f.title.includes('familia monoparental')),
      'incluye el título de familia monoparental de CLM');

    // Idempotencia: volver a pedir las fichas no las duplica.
    const fichas2 = await req('GET', '/api/fichas');
    assert(fichas2.data.length === fichas.data.length, 'los packs no se reaplican (sin duplicados)');
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
      microsoft: { calendar: { enabled: true, user: 'jose@burocraciazero.es', calendarName: 'CITAS BZ COMPARTIDO' } },
    });
    assert(msSettings.data.microsoft.calendar.enabled === true
      && msSettings.data.microsoft.sharepoint.hostname === 'ejerciendolaciudadania.sharepoint.com',
      'configuración de Microsoft 365 guardada con los valores del sitio');
    assert(msSettings.data.microsoft.calendar.calendarName === 'CITAS BZ COMPARTIDO',
      'se guarda el calendario destino (CITAS BZ COMPARTIDO)');
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

    console.log('Búsqueda global (paleta Ctrl+K)');
    const gAna = await req('GET', '/api/search?q=Ana');
    assert(gAna.data.clients.some((c) => c.name === 'Ana Torres'), 'la búsqueda global encuentra clientes por nombre');
    const gCase = await req('GET', '/api/search?q=renta');
    assert(Array.isArray(gCase.data.cases) && gCase.data.cases.some((c) => /renta/i.test(c.title)),
      'la búsqueda global encuentra expedientes por título');
    const gShort = await req('GET', '/api/search?q=a');
    assert(gShort.data.clients.length === 0 && gShort.data.cases.length === 0,
      'la búsqueda global ignora consultas de menos de 2 letras');

    console.log('Panel «Hoy»');
    const nowT = new Date();
    const todayIsoT = `${nowT.getFullYear()}-${String(nowT.getMonth() + 1).padStart(2, '0')}-${String(nowT.getDate()).padStart(2, '0')}`;
    await req('POST', '/api/appointments', { clientId, date: todayIsoT, time: '10:00', reason: 'Revisión' });
    const todayResp = await req('GET', '/api/today');
    assert(todayResp.data.date === todayIsoT, 'el panel Hoy responde con la fecha de hoy');
    assert(todayResp.data.citas.some((c) => c.time === '10:00'), 'el panel Hoy incluye las citas de hoy');
    assert(Array.isArray(todayResp.data.sinResponder) && Array.isArray(todayResp.data.vencimientos),
      'el panel Hoy agrupa vencimientos y chats sin responder');

    console.log('Fijar conversaciones');
    const pinned = await req('PUT', `/api/clients/${clientId}`, { pinned: true });
    assert(pinned.data.pinned === true, 'una conversación se puede fijar');
    const convsPinned = await req('GET', '/api/conversations');
    assert(convsPinned.data[0].clientId === clientId && convsPinned.data[0].pinned === true,
      'las conversaciones fijadas aparecen primero');
    await req('PUT', `/api/clients/${clientId}`, { pinned: false });

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

    console.log('CAPTCHA del acceso');
    await testCaptchaServer();

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
