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

    console.log('Panel');
    const dash = await req('GET', '/api/dashboard');
    assert(dash.data.totalClients === 3, 'panel: 3 clientes');
    assert(dash.data.openCases === 1, 'panel: 1 expediente abierto');

    console.log('Borrado en cascada');
    await req('DELETE', `/api/clients/${clientId}`);
    const casesAfter = await req('GET', '/api/cases');
    assert(casesAfter.data.length === 0, 'expedientes del cliente eliminados');
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
