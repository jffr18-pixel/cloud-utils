'use strict';

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const $ = (sel) => document.querySelector(sel);

async function api(path, options = {}) {
  const res = await fetch('/api/' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error del servidor');
  return data;
}

function esc(s) {
  const div = document.createElement('div');
  div.textContent = s ?? '';
  return div.innerHTML;
}

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

const STATUS_LABEL = {
  pendiente: 'Pendiente',
  en_curso: 'En curso',
  esperando_documentacion: 'Esperando documentación',
  completado: 'Completado',
};
const TYPE_LABEL = {
  fiscal: 'Fiscal / Impuestos',
  laboral: 'Laboral / Nóminas',
  contabilidad: 'Contabilidad',
  extranjeria: 'Extranjería',
  vehiculos: 'Vehículos / Tráfico',
  otro: 'Otro',
};
const MSG_STATUS = {
  demo: '⏳ demo (no enviado)',
  sent: '✓ enviado',
  delivered: '✓✓ entregado',
  read: '✓✓ leído',
  error: '⚠️ error',
  received: '',
};

// ---------------------------------------------------------------------------
// Diálogo genérico de formularios
// ---------------------------------------------------------------------------

function openDialog(title, fields, onSubmit) {
  $('#dialog-title').textContent = title;
  const wrap = $('#dialog-fields');
  wrap.innerHTML = '';
  for (const f of fields) {
    const div = document.createElement('div');
    div.className = 'field';
    const id = 'df-' + f.name;
    let input = '';
    if (f.type === 'textarea') {
      input = `<textarea id="${id}" rows="3">${esc(f.value || '')}</textarea>`;
    } else if (f.type === 'select') {
      const opts = f.options.map(([v, l]) =>
        `<option value="${esc(v)}" ${v === f.value ? 'selected' : ''}>${esc(l)}</option>`).join('');
      input = `<select id="${id}">${opts}</select>`;
    } else {
      input = `<input id="${id}" type="${f.type || 'text'}" value="${esc(f.value || '')}" ${f.required ? 'required' : ''}>`;
    }
    div.innerHTML = `<label for="${id}">${esc(f.label)}</label>${input}`;
    wrap.appendChild(div);
  }
  const dialog = $('#dialog');
  const form = $('#dialog-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const values = {};
    for (const f of fields) values[f.name] = $('#df-' + f.name).value;
    try {
      await onSubmit(values);
      dialog.close();
    } catch (err) {
      alert(err.message);
    }
  };
  $('#dialog-cancel').onclick = () => dialog.close();
  dialog.showModal();
}

// ---------------------------------------------------------------------------
// Estado global y navegación
// ---------------------------------------------------------------------------

const state = {
  view: 'dashboard',
  clients: [],
  templates: [],
  activeClientId: null,
  caseFilter: '',
  lastMessageCount: 0,
};

function showView(name) {
  state.view = name;
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  $('#view-' + name).classList.remove('hidden');
  document.querySelectorAll('.nav-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === name));
  refreshView();
}

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});

async function refreshView() {
  try {
    if (state.view === 'dashboard') await renderDashboard();
    if (state.view === 'inbox') await renderInbox();
    if (state.view === 'clients') await renderClients();
    if (state.view === 'cases') await renderCases();
    if (state.view === 'templates') await renderTemplates();
    if (state.view === 'reminders') await renderReminders();
    await updateUnreadBadge();
  } catch (err) {
    console.error(err);
  }
}

async function updateUnreadBadge() {
  const dash = await api('dashboard');
  const badge = $('#nav-unread');
  if (dash.unreadMessages > 0) {
    badge.textContent = dash.unreadMessages;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

async function renderDashboard() {
  const d = await api('dashboard');
  $('#dash-cards').innerHTML = `
    <div class="card"><div class="num">${d.totalClients}</div><div class="lbl">Clientes</div></div>
    <div class="card ${d.unreadMessages ? 'warn' : ''}"><div class="num">${d.unreadMessages}</div><div class="lbl">Mensajes sin leer</div></div>
    <div class="card"><div class="num">${d.openCases}</div><div class="lbl">Expedientes abiertos</div></div>
    <div class="card ${d.casesAwaitingDocs ? 'warn' : ''}"><div class="num">${d.casesAwaitingDocs}</div><div class="lbl">Esperando documentación</div></div>
    <div class="card ${d.overdueCases ? 'alert' : ''}"><div class="num">${d.overdueCases}</div><div class="lbl">Expedientes vencidos</div></div>
    <div class="card ${d.remindersToday ? 'warn' : ''}"><div class="num">${d.remindersToday}</div><div class="lbl">Recordatorios para hoy</div></div>`;
  $('#dash-recent').innerHTML = d.recentConversations.map(convRowHtml).join('')
    || '<p class="hint">Todavía no hay conversaciones.</p>';
  bindConvRows($('#dash-recent'), true);
}

// ---------------------------------------------------------------------------
// Bandeja de WhatsApp
// ---------------------------------------------------------------------------

function convRowHtml(c) {
  const arrow = c.lastDirection === 'out' ? '↗ ' : '';
  return `
    <div class="row conv-row" data-client-id="${esc(c.clientId)}">
      <div class="grow">
        <div class="title">${esc(c.clientName)}</div>
        <div class="sub">${arrow}${esc(c.lastMessage)}</div>
      </div>
      <div class="meta">
        <div>${fmtTime(c.lastTimestamp)}</div>
        ${c.unread ? `<span class="unread-dot">${c.unread}</span>` : ''}
      </div>
    </div>`;
}

function bindConvRows(container, jumpToInbox) {
  container.querySelectorAll('.conv-row').forEach((row) => {
    row.addEventListener('click', () => {
      state.activeClientId = row.dataset.clientId;
      if (jumpToInbox) showView('inbox');
      else openConversation(state.activeClientId);
    });
  });
}

async function renderInbox() {
  const [convs, templates] = await Promise.all([api('conversations'), api('templates')]);
  state.templates = templates;
  $('#conv-list').innerHTML = convs.map(convRowHtml).join('')
    || '<p class="hint">No hay conversaciones. Cuando un cliente te escriba (o uses «Simular entrada»), aparecerá aquí.</p>';
  bindConvRows($('#conv-list'), false);

  const sel = $('#tpl-select');
  sel.innerHTML = '<option value="">📝 Plantilla…</option>'
    + templates.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');

  if (state.activeClientId) await openConversation(state.activeClientId);
}

async function openConversation(clientId) {
  state.activeClientId = clientId;
  const [client, msgs] = await Promise.all([
    api('clients/' + clientId),
    api('messages?clientId=' + encodeURIComponent(clientId)),
  ]);
  $('#chat-empty').classList.add('hidden');
  $('#chat').classList.remove('hidden');
  $('#chat-name').textContent = client.name;
  $('#chat-phone').textContent = '+' + client.phone;
  state.lastMessageCount = msgs.length;

  $('#chat-messages').innerHTML = msgs.map((m) => `
    <div class="msg ${m.direction} ${m.status === 'error' ? 'error' : ''}">${esc(m.text)}
      <span class="msg-meta">${fmtTime(m.timestamp)} ${MSG_STATUS[m.status] || ''}${m.error ? ' · ' + esc(m.error) : ''}</span>
    </div>`).join('');
  const box = $('#chat-messages');
  box.scrollTop = box.scrollHeight;

  await api('messages/read', { method: 'POST', body: { clientId } });
  await updateUnreadBadge();
}

$('#btn-send').addEventListener('click', sendCurrentMessage);
$('#chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendCurrentMessage();
  }
});

async function sendCurrentMessage() {
  const text = $('#chat-input').value.trim();
  if (!text || !state.activeClientId) return;
  $('#chat-input').value = '';
  try {
    await api('messages', { method: 'POST', body: { clientId: state.activeClientId, text } });
  } catch (err) {
    alert(err.message);
  }
  await openConversation(state.activeClientId);
}

$('#tpl-select').addEventListener('change', async () => {
  const id = $('#tpl-select').value;
  $('#tpl-select').value = '';
  if (!id) return;
  const tpl = state.templates.find((t) => t.id === id);
  if (!tpl) return;
  let text = tpl.text;
  if (state.activeClientId) {
    const client = await api('clients/' + state.activeClientId);
    text = text.replaceAll('{nombre}', client.name.split(' ')[0]);
  }
  const input = $('#chat-input');
  input.value = (input.value ? input.value + ' ' : '') + text;
  input.focus();
});

$('#btn-open-client').addEventListener('click', () => {
  if (state.activeClientId) openClientDetail(state.activeClientId);
});

$('#btn-simulate').addEventListener('click', () => {
  openDialog('Simular mensaje entrante (pruebas)', [
    { name: 'name', label: 'Nombre del remitente', value: 'Cliente de prueba' },
    { name: 'phone', label: 'Teléfono', value: '600123456', required: true },
    { name: 'text', label: 'Mensaje', type: 'textarea', value: 'Hola, ¿me podéis decir cómo va mi declaración de la renta?' },
  ], async (v) => {
    await api('simulate-incoming', { method: 'POST', body: v });
    await renderInbox();
  });
});

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

function clientFields(c = {}) {
  return [
    { name: 'name', label: 'Nombre completo', value: c.name, required: true },
    { name: 'phone', label: 'Teléfono (con o sin prefijo, ej. 612345678)', value: c.phone, required: true },
    { name: 'nif', label: 'NIF / DNI / CIF', value: c.nif },
    { name: 'email', label: 'Email', type: 'email', value: c.email },
    { name: 'tags', label: 'Etiquetas (separadas por comas)', value: (c.tags || []).join(', ') },
    { name: 'notes', label: 'Notas', type: 'textarea', value: c.notes },
  ];
}

function parseClientValues(v) {
  return {
    ...v,
    tags: v.tags.split(',').map((t) => t.trim()).filter(Boolean),
  };
}

async function renderClients() {
  const q = $('#client-search').value.trim();
  const clients = await api('clients' + (q ? '?q=' + encodeURIComponent(q) : ''));
  state.clients = clients;
  $('#client-list').innerHTML = clients.map((c) => `
    <div class="row client-row" data-id="${esc(c.id)}">
      <div class="grow">
        <div class="title">${esc(c.name)}</div>
        <div class="sub">+${esc(c.phone)}${c.nif ? ' · ' + esc(c.nif) : ''}${c.email ? ' · ' + esc(c.email) : ''}</div>
        <div>${(c.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      </div>
      <button class="btn small btn-chat" data-id="${esc(c.id)}">💬 Chat</button>
    </div>`).join('') || '<p class="hint">No hay clientes todavía.</p>';

  $('#client-list').querySelectorAll('.client-row').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.btn-chat')) return;
      openClientDetail(row.dataset.id);
    });
  });
  $('#client-list').querySelectorAll('.btn-chat').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activeClientId = btn.dataset.id;
      showView('inbox');
    });
  });
}

let searchTimer = null;
$('#client-search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderClients, 250);
});

$('#btn-new-client').addEventListener('click', () => {
  openDialog('Nuevo cliente', clientFields(), async (v) => {
    await api('clients', { method: 'POST', body: parseClientValues(v) });
    await renderClients();
  });
});

async function openClientDetail(id) {
  const [client, cases] = await Promise.all([
    api('clients/' + id),
    api('cases?clientId=' + encodeURIComponent(id)),
  ]);
  const casesTxt = cases.length
    ? cases.map((c) => `• ${c.title} — ${STATUS_LABEL[c.status] || c.status}`).join('\n')
    : 'Sin expedientes.';
  openDialog(`Ficha de ${client.name}`, [
    ...clientFields(client),
    { name: '_cases', label: 'Expedientes (solo lectura, gestión en la pestaña Expedientes)', type: 'textarea', value: casesTxt },
  ], async (v) => {
    delete v._cases;
    await api('clients/' + id, { method: 'PUT', body: parseClientValues(v) });
    await refreshView();
  });
}

// ---------------------------------------------------------------------------
// Expedientes
// ---------------------------------------------------------------------------

document.querySelectorAll('#case-filters .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#case-filters .chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    state.caseFilter = chip.dataset.status;
    renderCases();
  });
});

function caseFields(item = {}, clients = []) {
  return [
    {
      name: 'clientId', label: 'Cliente', type: 'select',
      value: item.clientId,
      options: clients.map((c) => [c.id, c.name]),
    },
    { name: 'title', label: 'Título (ej. «Declaración renta 2025»)', value: item.title, required: true },
    {
      name: 'type', label: 'Tipo', type: 'select', value: item.type || 'fiscal',
      options: Object.entries(TYPE_LABEL),
    },
    {
      name: 'status', label: 'Estado', type: 'select', value: item.status || 'pendiente',
      options: Object.entries(STATUS_LABEL),
    },
    { name: 'dueDate', label: 'Fecha límite', type: 'date', value: item.dueDate },
    { name: 'notes', label: 'Notas', type: 'textarea', value: item.notes },
  ];
}

async function renderCases() {
  const [cases, clients] = await Promise.all([api('cases'), api('clients')]);
  state.clients = clients;
  const nameOf = (id) => clients.find((c) => c.id === id)?.name || '(cliente eliminado)';
  let list = cases;
  if (state.caseFilter) list = list.filter((c) => c.status === state.caseFilter);
  list = list.slice().sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')));

  $('#case-list').innerHTML = list.map((c) => {
    const overdue = c.dueDate && c.status !== 'completado' && new Date(c.dueDate) < new Date();
    return `
    <div class="row case-row" data-id="${esc(c.id)}">
      <div class="grow">
        <div class="title">${esc(c.title)}</div>
        <div class="sub">${esc(nameOf(c.clientId))} · ${esc(TYPE_LABEL[c.type] || c.type)}</div>
      </div>
      <div class="meta">
        <span class="status ${esc(c.status)}">${esc(STATUS_LABEL[c.status] || c.status)}</span>
        <div style="${overdue ? 'color:var(--danger);font-weight:700' : ''}">📅 ${fmtDate(c.dueDate)}${overdue ? ' ¡vencido!' : ''}</div>
      </div>
    </div>`;
  }).join('') || '<p class="hint">No hay expedientes con este filtro.</p>';

  $('#case-list').querySelectorAll('.case-row').forEach((row) => {
    row.addEventListener('click', () => {
      const item = cases.find((c) => c.id === row.dataset.id);
      openDialog('Editar expediente', caseFields(item, clients), async (v) => {
        await api('cases/' + item.id, { method: 'PUT', body: v });
        await renderCases();
      });
    });
  });
}

$('#btn-new-case').addEventListener('click', async () => {
  const clients = await api('clients');
  if (!clients.length) return alert('Primero crea al menos un cliente.');
  openDialog('Nuevo expediente', caseFields({}, clients), async (v) => {
    await api('cases', { method: 'POST', body: v });
    await renderCases();
  });
});

// ---------------------------------------------------------------------------
// Plantillas
// ---------------------------------------------------------------------------

async function renderTemplates() {
  const templates = await api('templates');
  state.templates = templates;
  $('#template-list').innerHTML = templates.map((t) => `
    <div class="row tpl-row" data-id="${esc(t.id)}">
      <div class="grow">
        <div class="title">${esc(t.name)}</div>
        <div class="sub">${esc(t.text)}</div>
      </div>
      <button class="btn small danger tpl-del" data-id="${esc(t.id)}">Eliminar</button>
    </div>`).join('') || '<p class="hint">No hay plantillas. Crea respuestas frecuentes para reutilizarlas en el chat.</p>';

  $('#template-list').querySelectorAll('.tpl-row').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.tpl-del')) return;
      const t = templates.find((x) => x.id === row.dataset.id);
      openDialog('Editar plantilla', [
        { name: 'name', label: 'Nombre', value: t.name, required: true },
        { name: 'text', label: 'Texto', type: 'textarea', value: t.text },
      ], async (v) => {
        await api('templates/' + t.id, { method: 'PUT', body: v });
        await renderTemplates();
      });
    });
  });
  $('#template-list').querySelectorAll('.tpl-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta plantilla?')) return;
      await api('templates/' + btn.dataset.id, { method: 'DELETE' });
      await renderTemplates();
    });
  });
}

$('#btn-new-template').addEventListener('click', () => {
  openDialog('Nueva plantilla', [
    { name: 'name', label: 'Nombre (ej. «Pedir documentación»)', required: true },
    { name: 'text', label: 'Texto', type: 'textarea', value: 'Hola {nombre}, para continuar con tu trámite necesitamos que nos envíes: ' },
  ], async (v) => {
    await api('templates', { method: 'POST', body: v });
    await renderTemplates();
  });
});

// ---------------------------------------------------------------------------
// Recordatorios
// ---------------------------------------------------------------------------

async function renderReminders() {
  const [reminders, clients] = await Promise.all([api('reminders'), api('clients')]);
  const nameOf = (id) => clients.find((c) => c.id === id)?.name || '';
  $('#reminder-list').innerHTML = reminders.map((r) => {
    const overdue = !r.done && r.dueDate && new Date(r.dueDate) < new Date();
    return `
    <div class="row" style="${r.done ? 'opacity:.55' : ''}">
      <input type="checkbox" class="rem-check" data-id="${esc(r.id)}" ${r.done ? 'checked' : ''}>
      <div class="grow">
        <div class="title" style="${r.done ? 'text-decoration:line-through' : ''}">${esc(r.text)}</div>
        <div class="sub">${nameOf(r.clientId) ? '👤 ' + esc(nameOf(r.clientId)) + ' · ' : ''}📅 <span style="${overdue ? 'color:var(--danger);font-weight:700' : ''}">${fmtDate(r.dueDate)}</span></div>
      </div>
      <button class="btn small danger rem-del" data-id="${esc(r.id)}">Eliminar</button>
    </div>`;
  }).join('') || '<p class="hint">No hay recordatorios.</p>';

  $('#reminder-list').querySelectorAll('.rem-check').forEach((cb) => {
    cb.addEventListener('change', async () => {
      await api('reminders/' + cb.dataset.id, { method: 'PUT', body: { done: cb.checked } });
      await renderReminders();
    });
  });
  $('#reminder-list').querySelectorAll('.rem-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api('reminders/' + btn.dataset.id, { method: 'DELETE' });
      await renderReminders();
    });
  });
}

$('#btn-new-reminder').addEventListener('click', async () => {
  const clients = await api('clients');
  openDialog('Nuevo recordatorio', [
    { name: 'text', label: 'Texto (ej. «Llamar a Juan por el IVA trimestral»)', required: true },
    { name: 'dueDate', label: 'Fecha', type: 'date' },
    {
      name: 'clientId', label: 'Cliente (opcional)', type: 'select',
      options: [['', '— Ninguno —'], ...clients.map((c) => [c.id, c.name])],
    },
  ], async (v) => {
    if (!v.clientId) v.clientId = null;
    await api('reminders', { method: 'POST', body: v });
    await renderReminders();
  });
});

// ---------------------------------------------------------------------------
// Arranque y refresco automático
// ---------------------------------------------------------------------------

async function init() {
  const status = await api('status');
  const badge = $('#connection-badge');
  if (status.whatsappConfigured) {
    badge.textContent = '● Conectado a WhatsApp';
    badge.style.color = '#7CFC98';
    $('#btn-simulate').classList.add('hidden');
  } else {
    badge.textContent = '● Modo demo';
    badge.style.color = '#ffd166';
  }
  await refreshView();
}

// Sondeo cada 5 s: refresca la bandeja y el contador de no leídos
// para que los mensajes entrantes del webhook aparezcan solos.
setInterval(async () => {
  try {
    await updateUnreadBadge();
    if (state.view === 'inbox') {
      const convs = await api('conversations');
      $('#conv-list').innerHTML = convs.map(convRowHtml).join('')
        || '<p class="hint">No hay conversaciones.</p>';
      bindConvRows($('#conv-list'), false);
      if (state.activeClientId) {
        const msgs = await api('messages?clientId=' + encodeURIComponent(state.activeClientId));
        if (msgs.length !== state.lastMessageCount) {
          await openConversation(state.activeClientId);
        }
      }
    }
  } catch { /* sin conexión momentánea: reintenta en el siguiente ciclo */ }
}, 5000);

init();
