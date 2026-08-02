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

// Mata un proceso hijo y espera a que termine del todo antes de limpiar su
// directorio: el servidor vuelca a disco en SIGTERM (cierre ordenado), así que
// borrar el temporal antes de que salga provoca carreras (ENOTEMPTY).
function killAndWait(child, ms = 4000) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) { try { child.kill(); } catch { /* noop */ } return resolve(); }
    let done = false;
    const fin = () => { if (!done) { done = true; resolve(); } };
    child.once('exit', fin);
    try { child.kill(); } catch { /* noop */ }
    setTimeout(fin, ms);
  });
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
    await killAndWait(server);
    fs.rmSync(sigDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
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
    await killAndWait(server);
    fs.rmSync(authDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
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
    await killAndWait(multiServer);
    fs.rmSync(multiDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
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
    await killAndWait(server);
    fs.rmSync(capDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

// Aislamiento por usuario: con CRM_USERS (varios usuarios) cada uno solo ve
// sus clientes, chats y expedientes; hay opción de compartir cliente o
// expediente en concreto. Sin aislamiento (un solo usuario) todo es común.
async function testIsolationServer() {
  const ISO_PORT = 3782;
  const ISO_BASE = `http://127.0.0.1:${ISO_PORT}`;
  const isoDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-iso-'));
  const server = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: {
      ...process.env, PORT: String(ISO_PORT), DATA_DIR: isoDataDir,
      CRM_USERS: 'carmen:clave1,juan:clave2', CRM_PASSWORD: '', CRM_CAPTCHA: 'off',
      WHATSAPP_TOKEN: '', WHATSAPP_PHONE_NUMBER_ID: '',
    },
    stdio: 'ignore',
  });
  const login = async (user, password) => {
    const r = await fetch(ISO_BASE + '/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user, password }),
    });
    return (r.headers.get('set-cookie') || '').split(';')[0];
  };
  const as = async (cookie, method, pathName, body) => {
    const r = await fetch(ISO_BASE + pathName, {
      method, headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
  try {
    for (let i = 0; i < 50; i += 1) {
      try { await fetch(ISO_BASE + '/api/auth'); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    const carmen = await login('carmen', 'clave1');
    const juan = await login('juan', 'clave2');

    // Cada uno crea un cliente: queda como dueño.
    const cCarmen = (await as(carmen, 'POST', '/api/clients', { name: 'Cliente de Carmen', phone: '600000001' })).data;
    const cJuan = (await as(juan, 'POST', '/api/clients', { name: 'Cliente de Juan', phone: '600000002' })).data;
    assert(cCarmen.owner === 'carmen', 'el cliente creado por Carmen queda a su nombre');
    assert(cJuan.owner === 'juan', 'el cliente creado por Juan queda a su nombre');

    // La lista de cada uno solo incluye lo suyo.
    const listCarmen = (await as(carmen, 'GET', '/api/clients')).data;
    const listJuan = (await as(juan, 'GET', '/api/clients')).data;
    assert(listCarmen.some((c) => c.id === cCarmen.id) && !listCarmen.some((c) => c.id === cJuan.id),
      'Carmen ve su cliente pero no el de Juan');
    assert(listJuan.some((c) => c.id === cJuan.id) && !listJuan.some((c) => c.id === cCarmen.id),
      'Juan ve su cliente pero no el de Carmen');

    // No se puede abrir el cliente del otro por id.
    assert((await as(juan, 'GET', '/api/clients/' + cCarmen.id)).status === 403,
      'Juan no puede abrir el cliente de Carmen (403)');

    // No se puede crear un expediente sobre el cliente del otro.
    assert((await as(juan, 'POST', '/api/cases', { clientId: cCarmen.id, title: 'Intruso' })).status === 403,
      'Juan no puede crear un expediente en el cliente de Carmen (403)');

    // Expediente propio de Carmen: Juan no lo ve en la lista global.
    const expCarmen = (await as(carmen, 'POST', '/api/cases', { clientId: cCarmen.id, title: 'Expediente privado' })).data;
    assert(!(await as(juan, 'GET', '/api/cases')).data.some((c) => c.id === expCarmen.id),
      'Juan no ve el expediente privado de Carmen en la lista');
    assert((await as(juan, 'GET', '/api/cases/' + expCarmen.id)).status === 403,
      'Juan no puede abrir el expediente privado de Carmen (403)');

    // Un no-dueño no puede cambiar el reparto ni compartir.
    assert((await as(juan, 'PUT', '/api/clients/' + cCarmen.id, { sharedWith: ['juan'] })).status === 403,
      'Juan no puede compartirse a sí mismo el cliente de Carmen (403)');

    // Carmen comparte su cliente con Juan: ahora Juan sí lo ve (y sus expedientes).
    await as(carmen, 'PUT', '/api/clients/' + cCarmen.id, { sharedWith: ['juan'] });
    assert((await as(juan, 'GET', '/api/clients/' + cCarmen.id)).status === 200,
      'tras compartir, Juan puede abrir el cliente de Carmen');
    assert((await as(juan, 'GET', '/api/cases')).data.some((c) => c.id === expCarmen.id),
      'tras compartir el cliente, Juan ve sus expedientes');

    // Compartir un expediente en concreto sin compartir el cliente.
    const cPriv = (await as(carmen, 'POST', '/api/clients', { name: 'Cliente reservado', phone: '600000003' })).data;
    const expShared = (await as(carmen, 'POST', '/api/cases', { clientId: cPriv.id, title: 'Solo este expediente' })).data;
    assert((await as(juan, 'GET', '/api/clients/' + cPriv.id)).status === 403,
      'Juan sigue sin ver el cliente reservado de Carmen');
    await as(carmen, 'PUT', '/api/cases/' + expShared.id, { sharedWith: ['juan'] });
    assert((await as(juan, 'GET', '/api/cases/' + expShared.id)).status === 200,
      'Juan puede abrir el expediente compartido en concreto');
    assert((await as(juan, 'GET', '/api/clients/' + cPriv.id)).status === 403,
      'compartir solo el expediente no da acceso a la ficha del cliente');

    // Los chats también están aislados: Juan no ve los mensajes del cliente de Carmen.
    assert((await as(juan, 'GET', '/api/messages?clientId=' + cPriv.id)).status === 403,
      'Juan no puede leer el chat del cliente reservado de Carmen (403)');

    // La búsqueda global respeta el aislamiento.
    const searchJuan = (await as(juan, 'GET', '/api/search?q=reservado')).data;
    assert(Array.isArray(searchJuan.clients) && !searchJuan.clients.some((c) => c.id === cPriv.id),
      'la búsqueda de Juan no filtra clientes de Carmen');

    // Firmas: no se puede enumerar la firma (ni el token) de un cliente ajeno.
    const sigC = await as(carmen, 'POST', '/api/signatures', { clientId: cPriv.id, docType: 'rgpd' });
    assert(sigC.status === 201, 'Carmen crea una firma para su cliente reservado');
    assert((await as(juan, 'GET', '/api/signatures/' + sigC.data.id)).status === 403,
      'Juan no puede ver la firma (ni su enlace/token) de un cliente de Carmen');
    assert(!(await as(juan, 'GET', '/api/signatures')).data.some((s) => s.id === sigC.data.id),
      'la lista de firmas de Juan no incluye las de Carmen');
    assert((await as(juan, 'POST', '/api/signatures', { clientId: cPriv.id, docType: 'rgpd' })).status === 403,
      'Juan no puede pedir una firma sobre un cliente de Carmen');
    assert((await as(juan, 'POST', '/api/signatures/' + sigC.data.id + '/resend')).status === 403,
      'Juan no puede reenviar la firma de un cliente de Carmen');
    assert((await as(juan, 'DELETE', '/api/signatures/' + sigC.data.id)).status === 403,
      'Juan no puede anular la firma de un cliente de Carmen');

    // Mensajes programados: aislamiento en creación, listado y borrado.
    const schC = await as(carmen, 'POST', '/api/scheduled-messages', { clientId: cPriv.id, text: 'hola', sendAt: Date.now() + 3600000 });
    assert(schC.status === 201, 'Carmen programa un mensaje a su cliente');
    assert((await as(juan, 'POST', '/api/scheduled-messages', { clientId: cPriv.id, text: 'x', sendAt: Date.now() + 3600000 })).status === 403,
      'Juan no puede programar un mensaje a un cliente de Carmen');
    assert(!(await as(juan, 'GET', '/api/scheduled-messages')).data.some((s) => s.id === schC.data.id),
      'la lista de programados de Juan no incluye los de Carmen');
    assert((await as(juan, 'DELETE', '/api/scheduled-messages/' + schC.data.id)).status === 403,
      'Juan no puede borrar un mensaje programado de Carmen');

    // Copias de seguridad: solo el administrador (primer usuario de CRM_USERS).
    assert((await as(juan, 'POST', '/api/backups')).status === 403, 'un no-admin no puede crear copias');
    assert((await as(juan, 'GET', '/api/backups')).status === 403, 'un no-admin no puede listar copias');
    assert([200, 201].includes((await as(carmen, 'POST', '/api/backups')).status), 'el administrador sí puede crear copias');

    // Configuración global (incluye texto legal y datos de la gestoría): solo admin.
    assert((await as(juan, 'PUT', '/api/automations', { empresa: { nombre: 'Intruso' } })).status === 403,
      'un no-admin no puede cambiar la configuración global');
    assert((await as(carmen, 'PUT', '/api/automations', { empresa: { nombre: 'Burocracia Zero SLP' } })).status === 200,
      'el administrador sí puede cambiar la configuración');
    // Conservación de datos y restauración de copias: solo administrador.
    assert((await as(juan, 'GET', '/api/retention')).status === 403, 'un no-admin no puede ver la conservación de datos');
    assert((await as(juan, 'POST', '/api/backups/backup-20260101.json.gz/restore')).status === 403,
      'un no-admin no puede restaurar copias');

    // Panel de rendimiento por usuario: atribuye trámites al dueño del cliente.
    // Carmen creó 2 clientes y varios expedientes; Juan, 1 cliente y 0 expedientes.
    await as(carmen, 'PUT', '/api/cases/' + expCarmen.id, { fee: 300, paid: true, payMethod: 'caja', status: 'completado' });
    const perf = await as(carmen, 'GET', '/api/performance');
    assert(perf.status === 200 && perf.data.isolation === true, 'el panel de rendimiento requiere aislamiento activo');
    const rowC = perf.data.users.find((u) => u.user === 'carmen');
    const rowJ = perf.data.users.find((u) => u.user === 'juan');
    assert(rowC && rowJ, 'el panel lista a Carmen y a Juan');
    assert(rowC.clientesNuevos >= 2 && rowJ.clientesNuevos >= 1,
      'los clientes nuevos se atribuyen a quien los dio de alta');
    assert(rowC.tramitesCompletados === 1 && rowC.cobrado === 300,
      'el trámite completado y su cobro se atribuyen a Carmen');
    assert(rowJ.tramitesCompletados === 0 && rowJ.cobrado === 0,
      'Juan no tiene trámites completados ni cobros');
    // El rango de fechas filtra: un rango pasado deja a todos a cero.
    const perfPast = (await as(carmen, 'GET', '/api/performance?from=2000-01-01&to=2000-12-31')).data;
    assert(perfPast.users.every((u) => u.tramitesTotal === 0 && u.clientesNuevos === 0),
      'un rango de fechas sin actividad devuelve todo a cero');
  } finally {
    await killAndWait(server);
    fs.rmSync(isoDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

// Asistente por Telegram de extremo a extremo: se levanta un servidor «mock»
// que hace de API de Telegram y de modelo de IA a la vez, y se comprueba el
// ciclo completo (autorización → interpretar → confirmar → ejecutar).
async function testTelegramAssistant() {
  const http = require('http');
  const MOCK_PORT = 3785;
  const TG_PORT = 3786;
  const TG_BASE = `http://127.0.0.1:${TG_PORT}`;
  const tgDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-tg-'));

  // Estado del mock.
  const updates = [];          // cola de updates que el bot irá recogiendo
  const sent = [];             // mensajes que el bot envía (sendMessage)
  const edited = [];           // ediciones (editMessageText)
  const answered = [];         // answerCallbackQuery (id + texto)
  let msgSeq = 100;
  let toolReply = null;        // qué debe responder el «modelo» en la próxima llamada

  const readJson = (req) => new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); } });
  });

  const mock = http.createServer(async (req, res) => {
    // Descarga de un fichero (nota de voz / documento): devuelve bytes.
    if (req.url.startsWith('/file/bot')) { res.writeHead(200); return res.end(Buffer.from('BINARIO-DE-PRUEBA')); }
    const send = (obj) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const body = await readJson(req);
    const m = req.url.match(/\/bot[^/]+\/(\w+)$/);
    const method = m ? m[1] : (req.url.includes('/chat/completions') ? 'chat' : '');
    if (method === 'getFile') { return send({ ok: true, result: { file_id: body.file_id, file_path: 'files/x', file_size: 1234 } }); }
    if (method === 'getUpdates') {
      if (updates.length) { const drained = updates.splice(0); return send({ ok: true, result: drained }); }
      // Emula el long-polling: espera un poco antes de responder vacío.
      return setTimeout(() => send({ ok: true, result: [] }), 120);
    }
    if (method === 'sendMessage') { sent.push(body); return send({ ok: true, result: { message_id: (msgSeq += 1), chat: { id: body.chat_id } } }); }
    if (method === 'editMessageText') { edited.push(body); return send({ ok: true, result: { message_id: body.message_id } }); }
    if (method === 'answerCallbackQuery') { answered.push(body); return send({ ok: true, result: true }); }
    if (method === 'sendChatAction') { return send({ ok: true, result: true }); }
    if (method === 'chat') { return send(toolReply || { choices: [{ message: { content: 'De acuerdo.' } }] }); }
    return send({ ok: false });
  });
  await new Promise((r) => mock.listen(MOCK_PORT, r));

  const server = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: {
      ...process.env, PORT: String(TG_PORT), DATA_DIR: tgDataDir,
      CRM_PASSWORD: '', WHATSAPP_TOKEN: '', WHATSAPP_PHONE_NUMBER_ID: '',
      TELEGRAM_BOT_TOKEN: '123:ABC', TELEGRAM_ALLOWED: '555:,556:',
      TELEGRAM_API_BASE: `http://127.0.0.1:${MOCK_PORT}`,
      OPENAI_API_KEY: 'sk-test', AGENT_URL: `http://127.0.0.1:${MOCK_PORT}/v1/chat/completions`,
    },
    stdio: 'ignore',
  });

  const post = (p, b) => fetch(TG_BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
  const waitFor = async (fn, ms = 5000) => {
    const until = Date.now() + ms;
    while (Date.now() < until) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 80)); }
    return null;
  };

  try {
    for (let i = 0; i < 50; i += 1) {
      try { await fetch(TG_BASE + '/api/status'); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }

    const priv = (id) => ({ id, type: 'private' });

    // Un ID que no está en la lista blanca no puede usar el asistente.
    updates.push({ update_id: 1, message: { message_id: 1, chat: priv(777), from: { id: 777 }, text: 'hola' } });
    const denied = await waitFor(() => sent.find((s) => String(s.chat_id) === '777' && /No estás autorizado/.test(s.text)));
    assert(denied && /777/.test(denied.text), 'un ID no autorizado es rechazado y ve su propio ID');

    // Un mensaje en un grupo (no privado) se ignora: no filtra datos a terceros.
    const sentBeforeGroup = sent.length;
    updates.push({ update_id: 2, message: { message_id: 2, chat: { id: -100, type: 'group' }, from: { id: 555 }, text: '¿qué tengo hoy?' } });
    await new Promise((r) => setTimeout(r, 500));
    assert(sent.length === sentBeforeGroup, 'los mensajes de grupo se ignoran (solo chats privados)');

    // Seed de un cliente para poder enviarle un WhatsApp.
    const pedro = await post('/api/clients', { name: 'Pedro Ramírez', phone: '600777888' });

    // El modelo devolverá una orden de enviar WhatsApp a Pedro.
    toolReply = { choices: [{ message: { tool_calls: [{ id: 't1', type: 'function', function: {
      name: 'enviar_whatsapp', arguments: JSON.stringify({ destinatario: 'Pedro', mensaje: 'Hola Pedro, llega 10 minutos antes.' }),
    } }] } }] };
    updates.push({ update_id: 3, message: { message_id: 3, chat: priv(555), from: { id: 555 }, text: 'dile a Pedro que llegue antes' } });

    const confirm = await waitFor(() => sent.find((s) => String(s.chat_id) === '555' && s.reply_markup && /Pedro Ramírez/.test(s.text)));
    assert(confirm && /Hola Pedro, llega 10 minutos antes/.test(confirm.text), 'propone el envío a Pedro y pide confirmación');
    const btn = confirm.reply_markup.inline_keyboard[0][0].callback_data;
    assert(/^ok:[0-9a-f]{32}$/.test(btn), 'el botón de confirmar lleva un token aleatorio no adivinable');

    // Antes de confirmar, no debe existir ningún mensaje saliente.
    const before = await (await fetch(TG_BASE + '/api/messages?clientId=' + pedro.id)).json();
    assert(!before.some((mm) => mm.direction === 'out'), 'sin confirmar no se envía nada');

    // Un usuario NO autorizado que pulse el botón (con el token válido) es
    // rechazado y no ejecuta la acción.
    updates.push({ update_id: 4, callback_query: { id: 'cq0', from: { id: 777 }, data: btn, message: { message_id: 20, chat: priv(555) } } });
    const rejAuth = await waitFor(() => answered.find((a) => a.callback_query_id === 'cq0' && /No autorizado/.test(a.text || '')));
    assert(rejAuth, 'un botón pulsado por un ID no autorizado se rechaza');

    // Un usuario AUTORIZADO pero que no creó la acción tampoco puede confirmarla.
    updates.push({ update_id: 5, callback_query: { id: 'cq1', from: { id: 556 }, data: btn, message: { message_id: 20, chat: priv(556) } } });
    const rejOwner = await waitFor(() => edited.find((e) => /no es tuya/.test(e.text || '')));
    assert(rejOwner, 'otro usuario no puede confirmar la acción pendiente de un compañero');
    const midway = await (await fetch(TG_BASE + '/api/messages?clientId=' + pedro.id)).json();
    assert(!midway.some((mm) => mm.direction === 'out'), 'los intentos ajenos no ejecutan el envío');

    // El creador confirma → se ejecuta el envío.
    updates.push({ update_id: 6, callback_query: { id: 'cq2', from: { id: 555 }, data: btn, message: { message_id: 20, chat: priv(555) } } });
    const done = await waitFor(() => edited.find((e) => /✅/.test(e.text)));
    assert(done, 'al confirmar el creador, el bot marca la acción como hecha');
    const after = await waitFor(async () => {
      const list = await (await fetch(TG_BASE + '/api/messages?clientId=' + pedro.id)).json();
      return list.find((mm) => mm.direction === 'out' && /Hola Pedro, llega 10 minutos antes/.test(mm.text || '')) ? list : null;
    });
    assert(after, 'tras confirmar, el WhatsApp queda registrado en la conversación del cliente');

    // Cancelar una acción no ejecuta nada.
    toolReply = { choices: [{ message: { tool_calls: [{ id: 't3', type: 'function', function: {
      name: 'crear_recordatorio', arguments: JSON.stringify({ texto: 'probar cancelación' }),
    } }] } }] };
    updates.push({ update_id: 7, message: { message_id: 7, chat: priv(555), from: { id: 555 }, text: 'recuérdame probar' } });
    const remConfirm = await waitFor(() => sent.find((s) => /Recordatorio/.test(s.text) && s.reply_markup));
    const remBtn = remConfirm.reply_markup.inline_keyboard[0][0].callback_data.replace(/^ok:/, 'no:');
    updates.push({ update_id: 8, callback_query: { id: 'cq3', from: { id: 555 }, data: remBtn, message: { message_id: 21, chat: priv(555) } } });
    const cancelled = await waitFor(() => edited.find((e) => /Cancelado/.test(e.text)));
    assert(cancelled, 'cancelar deja la acción sin ejecutar');

    let uid = 100; // ids de update crecientes para el resto de casos
    const runTool = async (text, reply, confirmRe) => {
      const before2 = edited.length;
      toolReply = reply;
      const mid = uid;
      updates.push({ update_id: uid, message: { message_id: uid, chat: priv(555), from: { id: 555 }, text } });
      uid += 1;
      const conf = await waitFor(() => sent.find((s) => s.reply_markup && confirmRe.test(s.text || '')));
      if (!conf) return null;
      const tk = conf.reply_markup.inline_keyboard[0][0].callback_data;
      updates.push({ update_id: uid, callback_query: { id: 'c' + uid, from: { id: 555 }, data: tk, message: { message_id: mid, chat: priv(555) } } });
      uid += 1;
      await waitFor(() => edited.length > before2 && edited[edited.length - 1] && /✅/.test(edited[edited.length - 1].text || ''));
      return conf;
    };

    // Registrar un cobro: marca los honorarios pendientes como cobrados.
    const cobExp = await post('/api/cases', { clientId: pedro.id, title: 'Renovación NIE', type: 'extranjeria', fee: 150, paid: false });
    const cobConf = await runTool('cóbrale a Pedro en efectivo',
      { choices: [{ message: { tool_calls: [{ id: 'c1', type: 'function', function: { name: 'registrar_cobro', arguments: JSON.stringify({ cliente: 'Pedro', forma_pago: 'efectivo' }) } }] } }] },
      /registrar el cobro/i);
    assert(cobConf && /150/.test(cobConf.text), 'propone el cobro con el importe pendiente');
    const cobCase = (await (await fetch(TG_BASE + '/api/cases?clientId=' + pedro.id)).json()).find((c) => c.id === cobExp.id);
    assert(cobCase && cobCase.paid === true && cobCase.payMethod === 'efectivo', 'tras confirmar, el honorario queda cobrado en efectivo');

    // Cambiar el estado de un expediente.
    await runTool('marca el expediente de Pedro como completado',
      { choices: [{ message: { tool_calls: [{ id: 'c2', type: 'function', function: { name: 'cambiar_estado_expediente', arguments: JSON.stringify({ cliente: 'Pedro', estado: 'completado' }) } }] } }] },
      /marcar/i);
    const stCase = (await (await fetch(TG_BASE + '/api/cases?clientId=' + pedro.id)).json()).find((c) => c.id === cobExp.id);
    assert(stCase && stCase.status === 'completado', 'el expediente queda marcado como completado');

    // Dar de alta un cliente.
    await runTool('da de alta a Ana López, 600112233',
      { choices: [{ message: { tool_calls: [{ id: 'c3', type: 'function', function: { name: 'crear_cliente', arguments: JSON.stringify({ nombre: 'Ana López', telefono: '600112233' }) } }] } }] },
      /dar de alta/i);
    const ana = (await (await fetch(TG_BASE + '/api/clients')).json()).find((c) => c.phone === '34600112233');
    assert(ana && ana.name === 'Ana López', 'el cliente nuevo queda dado de alta');

    // Enviar un documento por WhatsApp poniendo el nombre del cliente en el pie.
    updates.push({ update_id: uid, message: { message_id: uid, chat: priv(555), from: { id: 555 },
      caption: 'Pedro Ramírez', document: { file_id: 'FID1', file_name: 'justificante.pdf', mime_type: 'application/pdf' } } });
    uid += 1;
    const docConf = await waitFor(() => sent.find((s) => s.reply_markup && /justificante\.pdf/.test(s.text || '')));
    assert(docConf, 'propone enviar el documento al cliente indicado en el pie');
    const docBtn = docConf.reply_markup.inline_keyboard[0][0].callback_data;
    updates.push({ update_id: uid, callback_query: { id: 'cdoc', from: { id: 555 }, data: docBtn, message: { message_id: uid, chat: priv(555) } } });
    uid += 1;
    const docMsg = await waitFor(async () => {
      const list = await (await fetch(TG_BASE + '/api/messages?clientId=' + pedro.id)).json();
      return list.find((mm) => mm.direction === 'out' && mm.media && mm.media.filename === 'justificante.pdf') || null;
    });
    assert(docMsg && docMsg.media.kind === 'document', 'el documento se envía al cliente por WhatsApp');

    // Aviso proactivo: un WhatsApp entrante nuevo avisa por Telegram.
    await fetch(TG_BASE + '/webhook', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'evt_tg', type: 'whatsapp.inbound_message.received', apiVersion: 'v2',
        whatsappInboundMessage: {
          id: 'yc_tg_1', wamid: 'wamid.TG1', from: '+34600999000', to: '+34911222333',
          sendTime: new Date().toISOString(), type: 'text', text: { body: 'Hola, ¿alguna novedad de mi expediente?' },
        },
      }),
    });
    const alert = await waitFor(() => sent.find((s) => String(s.chat_id) === '555' && /Nuevo WhatsApp/.test(s.text || '')));
    assert(alert && /alguna novedad/.test(alert.text), 'un WhatsApp entrante avisa por Telegram al usuario');

    // Sugerir respuesta con IA: usa el modelo (simulado) y devuelve un borrador.
    toolReply = { choices: [{ message: { content: 'Hola Pedro, tu expediente sigue en trámite; en cuanto tengamos novedades te avisamos.' } }] };
    const sug = await (await fetch(TG_BASE + '/api/suggest-reply', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: pedro.id }),
    })).json();
    assert(sug.suggestion && /en trámite/.test(sug.suggestion), 'el CRM sugiere una respuesta con IA a partir del hilo');
  } finally {
    await killAndWait(server);
    mock.close();
    fs.rmSync(tgDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

// Resiliencia del almacén (lib/store.js): un fichero corrupto NO vacía la base,
// falta de fichero = primer arranque en blanco, y flush() vuelca a disco.
function testStoreResilience() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-store-'));
  const dbFile = path.join(tmp, 'db.json');
  const prev = process.env.DATA_DIR;
  const fresh = () => { delete require.cache[require.resolve('./lib/store')]; process.env.DATA_DIR = tmp; return require('./lib/store'); };
  try {
    let st = fresh();
    const d = st.load();
    assert(Array.isArray(d.clients) && d.clients.length === 0, 'store: sin fichero, base vacía (primer arranque)');
    d.clients.push({ id: 'x1', name: 'Prueba' });
    st.save();
    assert(st.flush() === true && fs.existsSync(dbFile), 'store: flush() vuelca lo pendiente a disco');
    assert(JSON.parse(fs.readFileSync(dbFile, 'utf8')).clients.length === 1, 'store: lo volcado contiene los datos');
    // Fichero corrupto → load() falla ruidosamente (no continúa con base vacía).
    fs.writeFileSync(dbFile, '{ esto no es json ');
    st = fresh();
    let threw = null;
    try { st.load(); } catch (e) { threw = e; }
    assert(threw && threw.code === 'DB_CORRUPT', 'store: un fichero corrupto hace fallar load() (no vacía la base)');
  } finally {
    if (prev === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = prev;
    for (const m of ['./lib/store', './lib/backup']) { try { delete require.cache[require.resolve(m)]; } catch { /* noop */ } }
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

// Copias: creación/restauración y cifrado AES-GCM (lib/backup.js).
function testBackupCrypto() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-bk-'));
  const prevDir = process.env.DATA_DIR;
  const prevKey = process.env.BACKUP_ENCRYPTION_KEY;
  const fresh = () => { for (const m of ['./lib/store', './lib/backup']) delete require.cache[require.resolve(m)]; return require('./lib/backup'); };
  try {
    process.env.DATA_DIR = tmp;
    delete process.env.BACKUP_ENCRYPTION_KEY;
    let bk = fresh();
    require('./lib/store').load().clients.push({ id: 'c1', name: 'Ana' });
    require('./lib/store').flush();
    const plain = bk.create(true);
    assert(plain.name.endsWith('.json.gz') && !plain.encrypted, 'copia: sin clave, en claro');
    assert(bk.restoreData(plain.name)?.clients?.some((c) => c.id === 'c1'), 'copia: restoreData recupera los datos');
    // Con clave: la copia se cifra y sigue siendo restaurable con la clave.
    process.env.BACKUP_ENCRYPTION_KEY = 'clave-de-prueba-123';
    bk = fresh();
    require('./lib/store').load().clients.push({ id: 'c1', name: 'Ana' });
    require('./lib/store').flush();
    const enc = bk.create(true);
    assert(enc.name.endsWith('.json.gz.enc') && enc.encrypted, 'copia: con clave, cifrada (.enc)');
    assert(bk.restoreData(enc.name)?.clients?.length >= 1, 'copia: con la clave, la cifrada se restaura');
    // Sin la clave, una copia cifrada NO se puede leer.
    delete process.env.BACKUP_ENCRYPTION_KEY;
    bk = fresh();
    assert(bk.restoreData(enc.name) === null, 'copia: sin la clave, la cifrada no se puede leer');
  } finally {
    if (prevDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = prevDir;
    if (prevKey === undefined) delete process.env.BACKUP_ENCRYPTION_KEY; else process.env.BACKUP_ENCRYPTION_KEY = prevKey;
    for (const m of ['./lib/store', './lib/backup']) { try { delete require.cache[require.resolve(m)]; } catch { /* noop */ } }
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

// Resumen periódico: con TELEGRAM_DIGEST_EVERY_HOURS activo, los avisos por
// cada WhatsApp entrante quedan silenciados (los sustituye el resumen). Se
// comprueba que un WhatsApp entrante NO dispara un aviso «Nuevo WhatsApp».
async function testTelegramDigestInterval() {
  const http = require('http');
  const MOCK_PORT = 3795;
  const TG_PORT = 3796;
  const TG_BASE = `http://127.0.0.1:${TG_PORT}`;
  const tgDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-tgd-'));
  const sent = [];
  const readJson = (req) => new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); } });
  });
  const mock = http.createServer(async (req, res) => {
    const send = (obj) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const body = await readJson(req);
    const m = req.url.match(/\/bot[^/]+\/(\w+)$/);
    const method = m ? m[1] : '';
    if (method === 'getUpdates') return setTimeout(() => send({ ok: true, result: [] }), 120);
    if (method === 'sendMessage') { sent.push(body); return send({ ok: true, result: { message_id: 1, chat: { id: body.chat_id } } }); }
    return send({ ok: true, result: true });
  });
  await new Promise((r) => mock.listen(MOCK_PORT, r));
  const server = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: {
      ...process.env, PORT: String(TG_PORT), DATA_DIR: tgDataDir,
      CRM_PASSWORD: '', WHATSAPP_TOKEN: '', WHATSAPP_PHONE_NUMBER_ID: '',
      TELEGRAM_BOT_TOKEN: '123:ABC', TELEGRAM_ALLOWED: '555:',
      TELEGRAM_API_BASE: `http://127.0.0.1:${MOCK_PORT}`,
      TELEGRAM_DIGEST_EVERY_HOURS: '4', // ← activa el resumen periódico
      TELEGRAM_ALERTS: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '',
    },
    stdio: 'ignore',
  });
  try {
    for (let i = 0; i < 50; i += 1) {
      try { await fetch(TG_BASE + '/api/auth'); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    // Llega un WhatsApp entrante nuevo.
    await fetch(TG_BASE + '/webhook', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'evt_d', type: 'whatsapp.inbound_message.received', apiVersion: 'v2',
        whatsappInboundMessage: {
          id: 'yc_d_1', wamid: 'wamid.D1', from: '+34600888777', to: '+34911222333',
          sendTime: new Date().toISOString(), type: 'text', text: { body: 'Hola, una consulta' },
        },
      }),
    });
    // Se da margen a que (no) llegue el aviso.
    await new Promise((r) => setTimeout(r, 900));
    assert(!sent.some((s) => /Nuevo WhatsApp/.test(s.text || '')),
      'con resumen periódico activo, un WhatsApp entrante NO dispara aviso por mensaje');
  } finally {
    await killAndWait(server);
    mock.close();
    fs.rmSync(tgDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

// Proveedor Claude de extremo a extremo: un servidor «mock» emula la API de
// Mensajes de Anthropic y se comprueba que interpret()/chat() construyen bien
// la petición y leen bien la respuesta por HTTP real.
async function testClaudeProvider() {
  const http = require('http');
  const asst = require('./lib/assistant');
  const PORT = 3788;
  const seen = [];
  const mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let parsed = {};
      try { parsed = JSON.parse(body || '{}'); } catch { parsed = {}; }
      seen.push({ url: req.url, headers: req.headers, body: parsed });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (parsed.tools) {
        // Petición del asistente (con herramientas) → devolver una acción.
        res.end(JSON.stringify({ stop_reason: 'tool_use', content: [
          { type: 'thinking', thinking: 'razonando' },
          { type: 'tool_use', name: 'enviar_whatsapp', input: { destinatario: 'Juan', mensaje: 'Hola Juan' } },
        ] }));
      } else {
        // Petición de «sugerir respuesta» (sin herramientas) → texto.
        res.end(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hola, te confirmo enseguida.' }] }));
      }
    });
  });
  await new Promise((r) => mock.listen(PORT, r));
  const prevKey = process.env.ANTHROPIC_API_KEY;
  const prevBase = process.env.ANTHROPIC_BASE_URL;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${PORT}`;
  try {
    const intent = await asst.interpret('dile a Juan que hola', { today: '2026-07-30' });
    assert(intent.tool === 'enviar_whatsapp' && intent.args.destinatario === 'Juan', 'interpret() usa Claude por HTTP y lee la herramienta');
    const toolCall = seen.find((s) => s.body.tools);
    assert(toolCall && toolCall.url === '/v1/messages' && toolCall.headers['x-api-key'] === 'sk-ant-test' && toolCall.headers['anthropic-version'],
      'la llamada a Claude va a /v1/messages con las cabeceras correctas');
    const suggestion = await asst.chat([
      { role: 'system', content: 'Eres un asistente.' },
      { role: 'user', content: 'Redacta una respuesta.' },
    ]);
    assert(/te confirmo/.test(suggestion), 'chat() usa Claude y devuelve el texto');
    const chatCall = seen.find((s) => !s.body.tools);
    assert(chatCall && chatCall.body.system === 'Eres un asistente.' && chatCall.body.messages[0].role === 'user',
      'en chat() el system va arriba y el usuario aparte (formato Anthropic)');
  } finally {
    if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevKey;
    if (prevBase === undefined) delete process.env.ANTHROPIC_BASE_URL; else process.env.ANTHROPIC_BASE_URL = prevBase;
    mock.close();
  }
}

async function main() {
  const server = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, WHATSAPP_TOKEN: '', WHATSAPP_PHONE_NUMBER_ID: '' },
    stdio: 'ignore',
  });

  try {
    console.log('Resiliencia de datos y copias');
    testStoreResilience();
    testBackupCrypto();

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
    // Nota de voz grabada en el navegador: el cliente la convierte a MP3
    // (audio/mpeg) antes de enviarla, formato aceptado por WhatsApp, y se guarda
    // como adjunto de audio.
    const voiceMp3 = await req('POST', '/api/messages', {
      clientId,
      file: { data: Buffer.from('ID3fake-mp3-bytes').toString('base64'), mime: 'audio/mpeg', name: 'nota-voz.mp3' },
    });
    assert(voiceMp3.status === 201 && voiceMp3.data.media && voiceMp3.data.media.kind === 'audio',
      'una nota de voz del navegador (MP3) se envía como adjunto de audio');

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

    // Marcar TODO como leído: deja el CRM sin pendientes de un solo golpe (útil
    // cuando ya se han leído los WhatsApp en el móvil).
    await req('POST', '/api/simulate-incoming', { phone: '699 88 77 66', name: 'Pedro García', text: 'Otra pregunta' });
    await req('POST', '/api/simulate-incoming', { phone: '699 88 77 66', name: 'Pedro García', text: 'Y una más' });
    const before = await req('GET', '/api/conversations');
    assert(before.data.some((c) => c.unread > 0), 'hay conversaciones sin leer antes de marcar todo');
    const readAll = await req('POST', '/api/messages/read', { all: true });
    assert(readAll.data.marked >= 2, 'marcar todo como leído marca todos los pendientes');
    const after = await req('GET', '/api/conversations');
    assert(after.data.every((c) => !c.unread), 'tras marcar todo, ninguna conversación queda sin leer');

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
    // Sincronización de lectura: responder desde el móvil marca como leído lo
    // anterior del cliente (así el CRM no lo muestra «sin leer»).
    const anaAfterEcho = (await req('GET', '/api/conversations')).data.find((c) => c.clientId === ana.clientId);
    assert(anaAfterEcho && anaAfterEcho.unread === 0,
      'responder desde el móvil marca como leídos los mensajes previos del cliente');
    // Leer en el móvil sin responder (evento de lectura del proveedor).
    await req('POST', '/webhook', {
      id: 'evt_newin', type: 'whatsapp.inbound_message.received', apiVersion: 'v2',
      whatsappInboundMessage: {
        id: 'yc_msg_3', wamid: 'wamid.YC3', from: '+34677111222', to: '+34911222333',
        sendTime: '2026-07-25T11:00:00.000Z', type: 'text', text: { body: 'Otra consulta rápida' },
      },
    });
    let anaU = (await req('GET', '/api/conversations')).data.find((c) => c.clientId === ana.clientId);
    assert(anaU.unread === 1, 'un mensaje nuevo posterior vuelve a contar como no leído');
    await req('POST', '/webhook', {
      id: 'evt_read', type: 'whatsapp.inbound_message.updated', apiVersion: 'v2',
      whatsappInboundMessage: { id: 'yc_msg_3', wamid: 'wamid.YC3', from: '+34677111222', status: 'read', readTime: '2026-07-25T11:01:00.000Z' },
    });
    anaU = (await req('GET', '/api/conversations')).data.find((c) => c.clientId === ana.clientId);
    assert(anaU.unread === 0, 'leer en el móvil (sin responder) marca el mensaje como leído en el CRM');

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
    // Honorarios con céntimos (dos decimales): se conservan; más de dos se
    // redondean al céntimo.
    const feeDec = await req('POST', '/api/cases', { clientId, title: 'Con céntimos', type: 'fiscal', fee: 150.5, taxAmount: 34.99 });
    assert(feeDec.data.fee === 150.5 && feeDec.data.taxAmount === 34.99,
      'el honorario y la tasa guardan dos decimales (céntimos)');
    const feeRnd = await req('PUT', `/api/cases/${feeDec.data.id}`, { fee: 150.555, status: 'completado' });
    assert(feeRnd.data.fee === 150.56, 'un importe con más de dos decimales se redondea al céntimo');
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
    // Datos de la gestoría: vienen con valores por defecto y son editables.
    assert(autoDefaults.data.empresa && autoDefaults.data.empresa.cif === 'B56918402',
      'los datos de la gestoría traen el CIF por defecto');
    const empSet = await req('PUT', '/api/automations', { empresa: { telefono: '925000000', web: '' } });
    assert(empSet.data.empresa.telefono === '925000000' && empSet.data.empresa.web === ''
      && empSet.data.empresa.cif === 'B56918402',
      'los datos de la gestoría se editan (y se pueden dejar en blanco)');
    await req('PUT', '/api/automations', { empresa: { telefono: '674573447', web: 'www.burocraciazero.es' } });
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

    // Pedir reseña en Google al completar (una sola vez por cliente).
    await req('PUT', '/api/automations', {
      reviews: { enabled: true, reviewUrl: 'https://g.page/r/BUROZERO/review' },
    });
    const revCase1 = await req('POST', '/api/cases', { clientId, title: 'Cita previa DGT', type: 'vehiculos' });
    await req('PUT', `/api/cases/${revCase1.data.id}`, { status: 'completado' });
    msgs = (await req('GET', `/api/messages?clientId=${clientId}`)).data;
    assert(msgs.some((mm) => (mm.text || '').includes('g.page/r/BUROZERO/review')),
      'al completar el trámite se pide reseña con el enlace de Google');
    // Segundo trámite completado del mismo cliente → no se repite la petición.
    const beforeCount = msgs.filter((mm) => (mm.text || '').includes('g.page/r/BUROZERO/review')).length;
    const revCase2 = await req('POST', '/api/cases', { clientId, title: 'Otra gestión', type: 'otro' });
    await req('PUT', `/api/cases/${revCase2.data.id}`, { status: 'completado' });
    const afterMsgs = (await req('GET', `/api/messages?clientId=${clientId}`)).data;
    const afterCount = afterMsgs.filter((mm) => (mm.text || '').includes('g.page/r/BUROZERO/review')).length;
    assert(afterCount === beforeCount, 'la petición de reseña no se repite al mismo cliente');
    await req('PUT', '/api/automations', { reviews: { enabled: false } });

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
    // Envío MANUAL fuera de la ventana con plantilla activada → también usa plantilla.
    const luciaManual = await req('POST', '/api/messages', { clientId: lucia.clientId, text: 'Buenas, ¿todo bien?' });
    assert(luciaManual.status === 201 && luciaManual.data.viaTemplate === true && !luciaManual.data.auto,
      'un envío manual fuera de la ventana usa la plantilla aprobada');
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

    // Registrar cobro con forma de cobro (efectivo/transferencia/tarjeta).
    const collectBad = await req('POST', '/api/receivables/collect', { clientId: cobrClient.data.id, payMethod: 'bizum' });
    assert(collectBad.status === 400, 'forma de cobro inválida rechazada');
    const collect = await req('POST', '/api/receivables/collect', { clientId: cobrClient.data.id, payMethod: 'tarjeta', includeTax: true });
    assert(collect.status === 200 && collect.data.honorarios === 100 && collect.data.tasas === 30,
      'registrar cobro marca honorarios y tasas pagados');
    const deudorCase = (await req('GET', '/api/cases?clientId=' + cobrClient.data.id)).data[0];
    assert(deudorCase.paid === true && deudorCase.payMethod === 'tarjeta' && deudorCase.taxPaid === true,
      'el expediente guarda la forma de cobro (tarjeta)');
    // El informe desglosa lo cobrado por forma de pago.
    const finReport = await req('GET', '/api/reports');
    assert(finReport.data.cobradoByMethod.tarjeta >= 100 && typeof finReport.data.cobradoByMethod.transferencia === 'number',
      'el informe desglosa lo cobrado por forma de pago');
    // Al cobrarlo todo, el cliente desaparece de «por cobrar».
    const receivables2 = await req('GET', '/api/receivables');
    assert(!receivables2.data.clients.some((e) => e.clientId === cobrClient.data.id),
      'tras registrar el cobro, el cliente sale de «por cobrar»');
    await req('DELETE', '/api/clients/' + cobrClient.data.id); // limpieza (no altera el panel)

    // Adelantos / pagos a plazos: cobrar 200 de un trámite de 400 y luego el resto.
    const advClient = await req('POST', '/api/clients', { name: 'Adelanto Test', phone: '600909090' });
    const advCase = await req('POST', '/api/cases', { clientId: advClient.data.id, title: 'Arraigo', type: 'extranjeria', fee: 400 });
    const adv1 = await req('POST', '/api/receivables/collect', { clientId: advClient.data.id, payMethod: 'caja', amount: 200 });
    assert(adv1.status === 200 && adv1.data.honorarios === 200 && adv1.data.pendiente === 200,
      'un adelanto cobra el importe indicado y deja el resto pendiente');
    const advRec = await req('GET', '/api/receivables');
    const advEntry = advRec.data.clients.find((e) => e.clientId === advClient.data.id);
    assert(advEntry && advEntry.honorarios === 200, 'tras el adelanto quedan 200 pendientes en «por cobrar»');
    assert(advEntry.items[0].feePaid === 200 && advEntry.items[0].feeTotal === 400,
      'el pendiente muestra el adelanto ya cobrado (200 de 400)');
    const advCaseAfter = (await req('GET', '/api/cases?clientId=' + advClient.data.id)).data[0];
    assert(advCaseAfter.paid === false && advCaseAfter.paidAmount === 200,
      'el expediente guarda el importe cobrado a cuenta sin marcarse como cobrado del todo');
    // El recibo del adelanto justifica lo realmente cobrado (200).
    const advRecibo = await fetch(`${BASE}/api/cases/${advCase.data.id}/recibo`);
    assert(advRecibo.status === 200, 'se puede emitir un recibo del adelanto');
    // Segundo pago: salda el resto y sale de «por cobrar».
    const adv2 = await req('POST', '/api/receivables/collect', { clientId: advClient.data.id, payMethod: 'caja' });
    assert(adv2.status === 200 && adv2.data.honorarios === 200 && adv2.data.pendiente === 0,
      'el segundo pago salda los 200 restantes');
    const advCaseDone = (await req('GET', '/api/cases?clientId=' + advClient.data.id)).data[0];
    assert(advCaseDone.paid === true && advCaseDone.paidAmount === 400, 'tras el segundo pago el trámite queda cobrado del todo');
    await req('DELETE', '/api/clients/' + advClient.data.id);

    // Guardar la ficha del expediente NO borra un adelanto (paid llega como false
    // desde el formulario, pero el importe a cuenta se conserva).
    const keepClient = await req('POST', '/api/clients', { name: 'Conserva Adelanto', phone: '600818181' });
    const keepCase = await req('POST', '/api/cases', { clientId: keepClient.data.id, title: 'Nacionalidad', type: 'extranjeria', fee: 300 });
    await req('POST', '/api/receivables/collect', { clientId: keepClient.data.id, payMethod: 'caja', amount: 100 });
    const keepSaved = await req('PUT', `/api/cases/${keepCase.data.id}`, { paid: false, notes: 'Cambio cualquiera' });
    assert(keepSaved.data.paidAmount === 100 && keepSaved.data.paid === false,
      'guardar la ficha con «pendiente» conserva el adelanto ya cobrado');
    await req('DELETE', '/api/clients/' + keepClient.data.id);

    // Exportación CSV del informe.
    const repCsv = await fetch(`${BASE}/api/export/informe.csv`);
    assert(repCsv.status === 200 && repCsv.headers.get('content-type').includes('text/csv'),
      'exportación del informe responde CSV');
    assert((await repCsv.text()).includes('Trámite'), 'el CSV del informe incluye la cabecera');

    console.log('Libro de ingresos (export)');
    // Un cobro sella la fecha (paidAt) y aparece en el libro de ingresos.
    const ingClient = await req('POST', '/api/clients', { name: 'Ingreso Test', phone: '600321321', nif: 'Y1111111X' });
    const ingCase = await req('POST', '/api/cases', {
      clientId: ingClient.data.id, title: 'Consulta fiscal', type: 'fiscal', fee: 120.5, paid: false,
    });
    assert(!ingCase.data.paidAt, 'un expediente sin cobrar no tiene fecha de cobro');
    const ingPaid = await req('PUT', `/api/cases/${ingCase.data.id}`, { paid: true, payMethod: 'transferencia' });
    assert(typeof ingPaid.data.paidAt === 'number', 'al cobrar se sella la fecha de cobro (paidAt)');
    const incCsv = await fetch(`${BASE}/api/export/ingresos.csv`);
    assert(incCsv.status === 200 && incCsv.headers.get('content-type').includes('text/csv'),
      'el libro de ingresos responde CSV');
    const incTxt = await incCsv.text();
    assert(incTxt.includes('Fecha de cobro') && incTxt.includes('Honorario'), 'el libro lleva cabecera de ingresos');
    assert(incTxt.includes('Ingreso Test') && incTxt.includes('120,50') && /TOTAL/.test(incTxt),
      'el libro incluye el honorario cobrado y una fila de total');
    // Revertir el cobro borra la fecha y lo saca del libro.
    const ingRev = await req('PUT', `/api/cases/${ingCase.data.id}`, { paid: false });
    assert(ingRev.data.paidAt === null, 'revertir el cobro borra la fecha de cobro');
    await req('DELETE', '/api/clients/' + ingClient.data.id); // limpieza

    console.log('Estado del trámite (página pública)');
    console.log('Foto del cliente (avatar)');
    const noPhoto = await fetch(`${BASE}/api/clients/${clientId}/avatar`);
    assert(noPhoto.status === 404, 'sin foto asignada → 404');
    // PNG mínimo (1x1) en base64.
    const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const upPhoto = await req('POST', `/api/clients/${clientId}/avatar`, { file: { data: tinyPng, mime: 'image/png', name: 'foto.png' } });
    assert(upPhoto.status === 200 && upPhoto.data.avatar === true, 'subir una foto del cliente');
    const getPhoto = await fetch(`${BASE}/api/clients/${clientId}/avatar`);
    assert(getPhoto.status === 200 && (getPhoto.headers.get('content-type') || '').startsWith('image/'),
      'la foto del cliente se sirve como imagen');
    const convWithAvatar = (await req('GET', '/api/conversations')).data.find((c) => c.clientId === clientId);
    assert(convWithAvatar && convWithAvatar.avatar === true, 'la conversación indica que el cliente tiene foto');
    const badPhoto = await req('POST', `/api/clients/${clientId}/avatar`, { file: { data: 'x', mime: 'application/pdf', name: 'x.pdf' } });
    assert(badPhoto.status === 400, 'un archivo que no es imagen se rechaza');
    const delPhoto = await req('DELETE', `/api/clients/${clientId}/avatar`);
    assert(delPhoto.status === 200, 'quitar la foto del cliente');
    assert((await fetch(`${BASE}/api/clients/${clientId}/avatar`)).status === 404, 'tras quitarla, ya no hay foto');

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
    // Fecha de presentación en la administración: se guarda y se ve en la web.
    const subCase = await req('POST', '/api/cases', {
      clientId, title: 'Solicitud arraigo presentada', type: 'extranjeria', status: 'en_curso',
      submittedDate: '2026-07-20', registryNumber: 'REG-2026/12345',
    });
    assert(subCase.status === 201 && subCase.data.submittedDate === '2026-07-20', 'el expediente guarda la fecha de presentación');
    assert(subCase.data.registryNumber === 'REG-2026/12345', 'el expediente guarda el nº de registro');
    const subEdit = await req('PUT', `/api/cases/${subCase.data.id}`, { submittedDate: '' });
    assert(subEdit.data.submittedDate === null, 'la fecha de presentación se puede vaciar');
    await req('PUT', `/api/cases/${subCase.data.id}`, { submittedDate: '2026-07-20', status: 'completado' });
    const subPage = await (await fetch(`${BASE}/estado/${token}`)).text();
    assert(/Presentado en la administración el/.test(subPage) && /20 de julio de 2026/i.test(subPage),
      'la web de seguimiento muestra la fecha de presentación');
    assert(/Nº de registro/.test(subPage) && /REG-2026\/12345/.test(subPage),
      'la web de seguimiento muestra el nº de registro de la administración');
    // URL de seguimiento en la administración: solo http(s), y se ve un botón.
    const urlBad = await req('PUT', `/api/cases/${subCase.data.id}`, { trackingUrl: 'javascript:alert(1)' });
    assert(urlBad.data.trackingUrl === '', 'una URL no http(s) se rechaza');
    const urlOk = await req('PUT', `/api/cases/${subCase.data.id}`, { trackingUrl: 'https://sede.administracion.gob.es/exp/123' });
    assert(urlOk.data.trackingUrl === 'https://sede.administracion.gob.es/exp/123', 'se guarda la URL de seguimiento');
    const subPage2 = await (await fetch(`${BASE}/estado/${token}`)).text();
    assert(/track-cta/.test(subPage2) && /sede\.administracion\.gob\.es/.test(subPage2),
      'la web de seguimiento muestra el botón de seguimiento en la administración');

    console.log('Dossier del cliente (PDF)');
    const dossier = await fetch(`${BASE}/api/clients/${clientId}/dossier`);
    const dossierBuf = Buffer.from(await dossier.arrayBuffer());
    assert(dossier.status === 200 && (dossier.headers.get('content-type') || '').includes('application/pdf'),
      'el dossier se sirve como application/pdf');
    assert(dossierBuf.slice(0, 5).toString() === '%PDF-' && dossierBuf.includes(Buffer.from('%%EOF')),
      'el dossier es un PDF válido');
    console.log('Documentos pre-rellenados (PDF)');
    // Módulo puro: el contenido se rellena con los datos del cliente.
    const docsLib = require('./lib/documentos');
    const docCli = { id: 'x', name: 'Amina El Fassi', nif: 'X1234567Z', phone: '34600111222', email: 'amina@example.com' };
    const docCases = [{ id: 'c1', title: 'Renovación NIE', type: 'extranjeria', status: 'en_curso' }];
    const autz = docsLib.buildDocumento('autorizacion', { client: docCli, cases: docCases, now: Date.UTC(2026, 6, 30), empresa: { nombre: 'Burocracia Zero SLP', ciudad: 'Toledo', cif: 'B56918402' } });
    const autzTxt = autz.lines.map((l) => (typeof l === 'string' ? l : l.t)).join('\n');
    assert(autz.title.includes('AUTORIZACIÓN'), 'la autorización tiene título correcto');
    assert(autz.header && autz.header.name === 'Burocracia Zero SLP' && autzTxt.includes('Burocracia Zero SLP'),
      'el documento lleva cabecera con los datos de la gestoría');
    assert(autzTxt.includes('Amina El Fassi') && autzTxt.includes('X1234567Z') && autzTxt.includes('34600111222'),
      'la autorización se rellena con nombre, NIF y teléfono del cliente');
    assert(autzTxt.includes('Renovación NIE'), 'la autorización cita el trámite en curso del cliente');
    assert(autzTxt.includes('30 de julio de 2026'), 'la autorización lleva la fecha en formato largo');
    assert(docsLib.buildDocumento('encargo', { client: docCli, cases: docCases }).title.includes('ENCARGO'),
      'la hoja de encargo tiene título correcto');
    assert(docsLib.buildDocumento('rgpd', { client: docCli, cases: [] }).title.includes('RGPD'),
      'el consentimiento RGPD tiene título correcto');
    // Dato ausente → hueco para rellenar a mano (no "undefined").
    const sinNif = docsLib.buildDocumento('autorizacion', { client: { name: 'Sin Datos' }, cases: [] });
    const sinNifTxt = sinNif.lines.map((l) => (typeof l === 'string' ? l : l.t)).join('\n');
    assert(!sinNifTxt.includes('undefined') && sinNifTxt.includes('__________'),
      'un dato ausente deja un hueco para rellenar, sin "undefined"');
    assert(docsLib.buildDocumento('inexistente', { client: docCli }) === null,
      'un tipo de documento desconocido devuelve null');
    // Endpoint: sirve un PDF válido para cada tipo, y 404 para tipo inválido.
    for (const tipo of ['autorizacion', 'encargo', 'rgpd']) {
      const dr = await fetch(`${BASE}/api/clients/${clientId}/documento/${tipo}`);
      const drBuf = Buffer.from(await dr.arrayBuffer());
      assert(dr.status === 200 && (dr.headers.get('content-type') || '').includes('application/pdf'),
        `el documento «${tipo}» se sirve como application/pdf`);
      assert(drBuf.slice(0, 5).toString() === '%PDF-' && drBuf.includes(Buffer.from('%%EOF')),
        `el documento «${tipo}» es un PDF válido`);
    }
    const docBad = await fetch(`${BASE}/api/clients/${clientId}/documento/loquesea`);
    assert(docBad.status === 404, 'un tipo de documento no válido → 404');

    console.log('Recibo de pago (PDF)');
    // Módulo puro: el recibo se rellena con cliente, importe y concepto.
    const rec = docsLib.buildRecibo({ client: docCli, concepto: 'Renovación NIE', amount: 150.5, method: 'caja', number: 'R-2026-0001', now: Date.UTC(2026, 6, 30),
      empresa: { nombre: 'Burocracia Zero SLP', cif: 'B56918402', colegiado: '0146', direccion: 'Calle Río Alberche 38', telefono: '674573447', email: 'jose@burocraciazero.es', web: 'www.burocraciazero.es' } });
    const recTxt = rec.lines.map((l) => (typeof l === 'string' ? l : l.t)).join('\n');
    assert(rec.title === 'RECIBO', 'el recibo tiene título correcto');
    assert(recTxt.includes('Amina El Fassi') && recTxt.includes('150,50 euros') && recTxt.includes('Renovación NIE'),
      'el recibo lleva cliente, importe con céntimos y concepto');
    assert(recTxt.includes('R-2026-0001') && /efectivo/.test(recTxt), 'el recibo lleva nº y forma de pago');
    // Cabecera (membrete) con logo + datos de la gestoría.
    assert(rec.header && rec.header.mark === true && rec.header.name === 'Burocracia Zero SLP',
      'el recibo lleva cabecera con logo y nombre de la gestoría');
    assert(rec.header.info.some((l) => l.includes('B56918402') && l.includes('colegiada')),
      'la cabecera incluye CIF y nº de colegiado');
    assert(rec.header.info.some((l) => l.includes('674573447') && l.includes('burocraciazero')),
      'la cabecera incluye teléfono, email y web');
    // Endpoint: expediente con honorario cobrado → recibo PDF con nº persistente.
    const recCase = await req('POST', '/api/cases', { clientId, title: 'Recibo test', type: 'fiscal', fee: 90, paid: true, payMethod: 'transferencia' });
    const r1 = await fetch(`${BASE}/api/cases/${recCase.data.id}/recibo`);
    const r1buf = Buffer.from(await r1.arrayBuffer());
    assert(r1.status === 200 && (r1.headers.get('content-type') || '').includes('application/pdf')
      && r1buf.slice(0, 5).toString() === '%PDF-', 'el recibo se sirve como PDF válido');
    const recCaseAfter = await req('GET', `/api/cases/${recCase.data.id}`);
    assert(/^R-\d{4}-\d{4}$/.test(recCaseAfter.data.reciboNumber || ''), 'se asigna un nº de recibo persistente');
    // Reimprimir usa el mismo número.
    await fetch(`${BASE}/api/cases/${recCase.data.id}/recibo`);
    const recCaseAgain = await req('GET', `/api/cases/${recCase.data.id}`);
    assert(recCaseAgain.data.reciboNumber === recCaseAfter.data.reciboNumber, 'reimprimir el recibo conserva el mismo número');
    // Sin honorario → 400.
    const recNoFee = await req('POST', '/api/cases', { clientId, title: 'Sin honorario', type: 'otro', fee: 0 });
    assert((await fetch(`${BASE}/api/cases/${recNoFee.data.id}/recibo`)).status === 400,
      'un expediente sin honorario no genera recibo');
    await req('PUT', `/api/cases/${recCase.data.id}`, { status: 'completado' });
    await req('PUT', `/api/cases/${recNoFee.data.id}`, { status: 'completado' });

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
    // Opción «solo nube»: el ajuste se guarda.
    const coSet = await req('PUT', '/api/automations', { microsoft: { backup: { cloudOnly: true } } });
    assert(coSet.data.microsoft.backup.cloudOnly === true, 'la opción «copias solo en la nube» se guarda');
    await req('PUT', '/api/automations', { microsoft: { backup: { cloudOnly: false } } });
    // Módulo de copias: remove() crea y borra una copia local, y valida el nombre.
    const backupLib = require('./lib/backup');
    const madeName = backupLib.create(true).name; // en el dir del proceso de test
    assert(backupLib.remove(madeName) === true, 'remove() borra una copia local existente');
    assert(backupLib.remove(madeName) === false, 'remove() sobre una copia inexistente devuelve false');
    assert(backupLib.remove('../../db.json') === false, 'remove() rechaza nombres maliciosos');

    console.log('Documentos por expediente');
    const link = await req('PUT', `/api/messages/${fileMsg.data.id}`, { caseId: kase.data.id });
    assert(link.status === 200 && link.data.caseId === kase.data.id, 'adjunto vinculado al expediente');
    const files = await req('GET', `/api/cases/${kase.data.id}/files`);
    assert(files.data.length === 1 && files.data[0].filename === 'justificante.pdf',
      'el expediente lista sus documentos');
    const badLink = await req('PUT', `/api/messages/${fileMsg.data.id}`, { caseId: 'exp_inexistente' });
    assert(badLink.status === 404, 'vínculo a expediente inexistente rechazado');

    // Asignación MÚLTIPLE: varios adjuntos a un expediente de una sola vez.
    const doc1 = await req('POST', '/api/messages', {
      clientId, text: 'Doc 1', file: { name: 'dni.pdf', mime: 'application/pdf', data: Buffer.from('DNI').toString('base64') },
    });
    const doc2 = await req('POST', '/api/messages', {
      clientId, text: 'Doc 2', file: { name: 'contrato.pdf', mime: 'application/pdf', data: Buffer.from('CONTRATO').toString('base64') },
    });
    const noAssign = await req('POST', '/api/messages/assign-case', { ids: [], caseId: kase.data.id });
    assert(noAssign.status === 400, 'asignar sin documentos seleccionados se rechaza');
    const badCase = await req('POST', '/api/messages/assign-case', { ids: [doc1.data.id], caseId: 'exp_inexistente' });
    assert(badCase.status === 404, 'asignación múltiple a expediente inexistente rechazada');
    const bulkLink = await req('POST', '/api/messages/assign-case', { ids: [doc1.data.id, doc2.data.id], caseId: kase.data.id });
    assert(bulkLink.status === 200 && bulkLink.data.assigned === 2, 'asignación múltiple vincula los dos adjuntos');
    const filesAfter = await req('GET', `/api/cases/${kase.data.id}/files`);
    assert(filesAfter.data.some((f) => f.filename === 'dni.pdf') && filesAfter.data.some((f) => f.filename === 'contrato.pdf'),
      'el expediente lista los documentos asignados en bloque');

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
    // Calendario de Outlook: sin credenciales responde configured:false y sin eventos.
    const cal = await req('GET', '/api/outlook-calendar');
    assert(cal.status === 200 && cal.data.configured === false && Array.isArray(cal.data.events) && cal.data.events.length === 0,
      'el calendario de Outlook indica cuando Microsoft no está configurado');
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
    // «Sin responder» depende de la lectura: un entrante sin leer cuenta como
    // pendiente; al marcarlo leído deja de contar (se maneja en el móvil).
    await req('POST', '/api/simulate-incoming', { phone: '699 88 77 66', name: 'Pedro García', text: '¿Alguna novedad?' });
    const pedroConv = (await req('GET', '/api/conversations')).data.find((c) => c.clientName === 'Pedro García');
    const todayPending = await req('GET', '/api/today');
    assert(todayPending.data.sinResponder.some((c) => c.clientId === pedroConv.clientId),
      'un entrante sin leer aparece en «sin responder»');
    await req('POST', '/api/messages/read', { all: true });
    const todayCleared = await req('GET', '/api/today');
    assert(!todayCleared.data.sinResponder.some((c) => c.clientId === pedroConv.clientId),
      'tras marcar leído, la conversación sale de «sin responder»');

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
    // Inyección de fórmulas: un nombre que empieza por «=» se neutraliza con «'».
    const evilCli = await req('POST', '/api/clients', { name: '=HYPERLINK("http://evil","x")', phone: '600999888' });
    const csvEvil = await (await fetch(`${BASE}/api/export/clients.csv`)).text();
    assert(csvEvil.includes('"\'=HYPERLINK') && !/(^|;)"=HYPERLINK/m.test(csvEvil),
      'una celda que empieza por = se neutraliza (prefijo \') contra inyección de fórmulas');
    await req('DELETE', '/api/clients/' + evilCli.data.id);

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

    console.log('Aislamiento por usuario');
    await testIsolationServer();

    console.log('Vacaciones / cierre temporal');
    const autoLib = require('./lib/automations');
    const holDb = { settings: { automations: { holiday: { enabled: true, from: '2026-08-01', to: '2026-08-17', message: 'Cerrado del {desde} al {hasta}. Hola {nombre}.' } } } };
    assert(autoLib.isHolidayActive(holDb, new Date('2026-08-05T10:00:00')) === true, 'vacaciones activas dentro del rango');
    assert(autoLib.isHolidayActive(holDb, new Date('2026-07-31T10:00:00')) === false, 'fuera del rango, no activas');
    assert(autoLib.isHolidayActive(holDb, new Date('2026-08-18T10:00:00')) === false, 'pasado el rango, no activas');
    let holSent = null;
    const holSend = async (c, t) => { holSent = t; };
    const holClient = { id: 'h1', name: 'Amina El Fassi' };
    await autoLib.maybeHoliday(holDb, holClient, holSend, new Date('2026-08-05T10:00:00'));
    assert(holSent && holSent.includes('17 de agosto de 2026') && holSent.includes('Amina'),
      'el aviso de vacaciones se rellena con la fecha de vuelta y el nombre');
    holSent = null;
    await autoLib.maybeHoliday(holDb, holClient, holSend, new Date('2026-08-05T14:00:00'));
    assert(holSent === null, 'no se repite el aviso al mismo cliente el mismo día');
    // Al día siguiente sí se le vuelve a avisar (una vez por día).
    holSent = null;
    await autoLib.maybeHoliday(holDb, holClient, holSend, new Date('2026-08-06T09:00:00'));
    assert(holSent !== null, 'al día siguiente se le avisa de nuevo (una vez al día)');
    // Desactivado → no responde aunque la fecha esté en rango.
    const holOff = { settings: { automations: { holiday: { enabled: false, from: '2026-08-01', to: '2026-08-17', message: 'x' } } } };
    assert(autoLib.isHolidayActive(holOff, new Date('2026-08-05T10:00:00')) === false, 'desactivado → no activo');
    // En vacaciones NO salen los envíos automáticos por temporizador.
    const schedDb = {
      settings: { automations: {
        holiday: { enabled: true, from: '2026-08-01', to: '2026-08-17', message: 'x' },
        businessHours: { days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '23:59' },
        docs: { enabled: true, followUpDays: 0, requestText: 'r', followUpText: 'Reclamo {nombre}' },
      } },
      clients: [{ id: 'c1', name: 'Ana' }],
      cases: [{ id: 'k1', clientId: 'c1', status: 'esperando_documentacion', docsRequestedAt: 1, docsFollowUpAt: null, title: 'T' }],
      messages: [], reminders: [], appointments: [],
    };
    const noop = async () => {};
    const inHol = await autoLib.runScheduled(schedDb, noop, new Date('2026-08-05T10:00:00'));
    assert(Array.isArray(inHol) && inHol.length === 0, 'en vacaciones no se ejecuta ningún envío automático');
    const outHol = await autoLib.runScheduled(schedDb, noop, new Date('2026-07-30T10:00:00'));
    assert(outHol.some((a) => a.type === 'docs_follow_up'), 'fuera de vacaciones sí se reclama la documentación');

    console.log('Asistente (núcleo)');
    const asst = require('./lib/assistant');
    // Lista blanca de Telegram.
    const allowed = asst.parseAllowed(' 111:jose , 222:carmen ,333, malo:x ');
    assert(allowed.get('111') === 'jose' && allowed.get('222') === 'carmen', 'parseAllowed liga id→usuario del CRM');
    assert(allowed.get('333') === null && !allowed.has('malo'), 'parseAllowed admite id suelto y descarta ids no numéricos');
    // Detección de teléfonos y validaciones.
    assert(asst.looksLikePhone('600 111 222') && asst.looksLikePhone('+34600111222'), 'reconoce teléfonos');
    assert(!asst.looksLikePhone('Juan Pérez'), 'un nombre no es un teléfono');
    assert(asst.validDate('2026-07-30') && !asst.validDate('30/07/2026'), 'valida fechas YYYY-MM-DD');
    assert(asst.validTime('09:30') && asst.validTime('9:5') === false && asst.validTime('24:00') === false, 'valida horas HH:MM');
    // Resolución de clientes respetando visibilidad.
    const fakeDb = { clients: [
      { id: 'a', name: 'Juan Pérez', phone: '34600111222', owner: 'jose' },
      { id: 'b', name: 'Juana López', phone: '34600333444', owner: 'jose' },
      { id: 'c', name: 'Ahmed Ben', phone: '34600555666', owner: 'carmen' },
    ] };
    const seeJose = (c) => !c.owner || c.owner === 'jose';
    assert(asst.resolveClient(fakeDb, 'Juan Pérez', seeJose).client?.id === 'a', 'resuelve por nombre exacto');
    assert(Array.isArray(asst.resolveClient(fakeDb, 'Jua', seeJose).ambiguous), 'nombre ambiguo devuelve varios');
    assert(asst.resolveClient(fakeDb, '600111222', seeJose).client?.id === 'a', 'resuelve por teléfono');
    assert(asst.resolveClient(fakeDb, 'Ahmed', seeJose).none === true, 'no resuelve un cliente de otro usuario por nombre');
    assert(asst.resolveClient(fakeDb, '600555666', seeJose).blocked === true, 'teléfono de otro usuario queda bloqueado');
    assert(asst.resolveClient(fakeDb, '699000000', seeJose).phone === '34699000000', 'teléfono nuevo se marca para crear');
    // Construcción de la petición al modelo y lectura de su respuesta.
    const rq = asst.buildAgentRequest('manda a Juan hola', { today: '2026-07-29' });
    assert(rq.body.tools.some((t) => t.function.name === 'enviar_whatsapp'), 'la petición incluye las herramientas');
    assert(/2026-07-29/.test(rq.body.messages[0].content), 'el modelo recibe la fecha de hoy');
    const toolResp = asst.parseAgentResponse({ choices: [{ message: { tool_calls: [{ function: { name: 'crear_cita', arguments: '{"cliente":"Juan","fecha":"2026-07-30","hora":"10:00"}' } }] } }] });
    assert(toolResp.tool === 'crear_cita' && toolResp.args.hora === '10:00', 'lee la herramienta y sus argumentos');
    const textResp = asst.parseAgentResponse({ choices: [{ message: { content: '¿A qué hora?' } }] });
    assert(textResp.reply === '¿A qué hora?', 'una respuesta sin herramienta se devuelve como texto');

    // --- Soporte de Claude (Anthropic) ---
    const prevAnthropic = process.env.ANTHROPIC_API_KEY;
    const prevOpenai = process.env.OPENAI_API_KEY;
    const prevTranscribe = process.env.TRANSCRIBE_API_KEY;
    delete process.env.ANTHROPIC_API_KEY; delete process.env.OPENAI_API_KEY; delete process.env.TRANSCRIBE_API_KEY;
    assert(asst.provider() === '' && asst.isConfigured() === false, 'sin claves no hay proveedor de IA');
    process.env.OPENAI_API_KEY = 'sk-openai';
    assert(asst.provider() === 'openai', 'con OPENAI_API_KEY el proveedor es OpenAI');
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    assert(asst.provider() === 'anthropic', 'con ANTHROPIC_API_KEY manda Claude');
    // La petición a Claude usa el formato de Anthropic (system arriba, input_schema en las herramientas).
    const arq = asst.buildAnthropicRequest('manda a Juan hola', { today: '2026-07-29' });
    assert(/\/v1\/messages$/.test(arq.url) && arq.headers['x-api-key'] === 'sk-ant' && arq.headers['anthropic-version'], 'petición a la API de Mensajes de Anthropic');
    assert(/2026-07-29/.test(arq.body.system) && arq.body.messages[0].role === 'user', 'system arriba y el usuario aparte');
    assert(arq.body.tools.some((t) => t.name === 'enviar_whatsapp' && t.input_schema), 'herramientas en formato Anthropic (input_schema)');
    assert(arq.body.tool_choice && arq.body.tool_choice.type === 'auto', 'tool_choice de Anthropic');
    // Lectura de la respuesta de Claude: ignora el razonamiento, lee tool_use y texto.
    const aTool = asst.parseAnthropicResponse({ content: [
      { type: 'thinking', thinking: '...' },
      { type: 'tool_use', name: 'crear_cita', input: { cliente: 'Juan', fecha: '2026-07-30', hora: '10:00' } },
    ] });
    assert(aTool.tool === 'crear_cita' && aTool.args.hora === '10:00', 'lee la herramienta de Claude ignorando el razonamiento');
    const aText = asst.parseAnthropicResponse({ content: [{ type: 'text', text: '¿A qué hora?' }] });
    assert(aText.reply === '¿A qué hora?', 'lee el texto de Claude');
    assert(asst.parseAnthropicResponse({ stop_reason: 'refusal', content: [] }).reply, 'un rechazo de Claude devuelve un aviso, no revienta');
    if (prevAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevAnthropic;
    if (prevOpenai === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prevOpenai;
    if (prevTranscribe === undefined) delete process.env.TRANSCRIBE_API_KEY; else process.env.TRANSCRIBE_API_KEY = prevTranscribe;

    await testClaudeProvider();

    // El token del bot nunca debe aparecer en textos que se registren o muestren.
    const tgLib = require('./lib/telegram');
    const prevTok = process.env.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = '999:SECRETO';
    assert(!tgLib.redact('fallo en https://api.telegram.org/bot999:SECRETO/getUpdates').includes('999:SECRETO'),
      'redact() oculta el token del bot en los mensajes');
    if (prevTok === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = prevTok;

    await testTelegramAssistant();
    await testTelegramDigestInterval();

    // Sugerir respuesta sin IA configurada → error claro (este servidor no tiene OPENAI_API_KEY).
    const sugNoAI = await req('POST', '/api/suggest-reply', { clientId });
    assert(sugNoAI.status === 400 && /IA/.test(sugNoAI.data.error || ''), 'sugerir respuesta avisa si la IA no está configurada');

    console.log('Cobros automáticos');
    // Se ejecuta al final para no interferir con otros recuentos de mensajes.
    const acClient = await req('POST', '/api/clients', { name: 'Moroso Auto', phone: '600998877' });
    await req('POST', '/api/cases', { clientId: acClient.data.id, title: 'Trámite con saldo antiguo', type: 'otro', fee: 200, paid: false, status: 'completado' });
    // Horario siempre abierto + cobros automáticos desde el día 0 para probar ya.
    await req('PUT', '/api/automations', {
      businessHours: { days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '23:59' },
      autoCollect: { enabled: true, daysOverdue: 0, cooldownDays: 7, includeTax: false },
    });
    await req('POST', '/api/automations/run');
    const acMsgs = (await req('GET', '/api/messages?clientId=' + acClient.data.id)).data;
    assert(acMsgs.some((m) => m.direction === 'out' && m.auto === true && /Total pendiente: 200/.test(m.text || '')),
      'los cobros automáticos reclaman el saldo pendiente por WhatsApp');
    await req('POST', '/api/automations/run');
    const acMsgs2 = (await req('GET', '/api/messages?clientId=' + acClient.data.id)).data;
    assert(acMsgs2.filter((m) => /Total pendiente: 200/.test(m.text || '')).length === 1,
      'no se repite el aviso dentro del periodo de espera (cooldown)');
    await req('PUT', '/api/automations', { autoCollect: { enabled: false } });
    await req('DELETE', '/api/clients/' + acClient.data.id);

    console.log('Conservación de datos (RGPD)');
    const retResp = await req('GET', '/api/retention');
    assert(retResp.status === 200 && Array.isArray(retResp.data.candidates), 'el endpoint de conservación responde con la lista de candidatos');
    const retOn = await req('PUT', '/api/automations', { retention: { enabled: true, inactiveMonths: 1 } });
    assert(retOn.data.retention.enabled === true, 'la conservación de datos se activa');
    await req('PUT', '/api/automations', { retention: { enabled: false } });

    console.log('Borrado completo del cliente (RGPD)');
    const delCli = await req('POST', '/api/clients', { name: 'Borrar Test', phone: '600444555', nif: 'Z9999999R' });
    await req('POST', '/api/cases', { clientId: delCli.data.id, title: 'Exp a borrar', type: 'otro' });
    const delSig = await req('POST', '/api/signatures', { clientId: delCli.data.id, docType: 'rgpd' });
    const delTask = await req('POST', '/api/tasks', { title: 'Tarea del cliente', clientId: delCli.data.id });
    assert(delSig.status === 201 && delTask.status === 201, 'creados firma y tarea del cliente');
    const delRes = await req('DELETE', '/api/clients/' + delCli.data.id);
    assert(delRes.status === 200 && delRes.data.records >= 3, 'el borrado informa de los registros eliminados');
    assert((await req('GET', '/api/signatures')).data.every((s) => s.clientId !== delCli.data.id),
      'al borrar el cliente se eliminan también sus firmas (no quedan huérfanas)');
    assert((await req('GET', '/api/tasks')).data.every((t) => t.clientId !== delCli.data.id),
      'al borrar el cliente se eliminan también sus tareas');

    console.log('Borrado en cascada');
    await req('DELETE', `/api/clients/${clientId}`);
    const casesAfter = await req('GET', '/api/cases');
    assert(casesAfter.data.every((c) => c.clientId !== clientId), 'expedientes del cliente eliminados');
  } finally {
    await killAndWait(server);
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }

  console.log(`\n${passed} pruebas correctas, ${failed} fallidas.`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
