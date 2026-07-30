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

function fmtDateTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('es-ES', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

const STATUS_LABEL = {
  pendiente: 'Pendiente',
  en_curso: 'En curso',
  esperando_documentacion: 'Esperando documentación',
  completado: 'Completado',
};

// Formas de pago del honorario (icono + etiqueta). «banco» se conserva para
// cobros antiguos; las opciones nuevas son efectivo, transferencia y tarjeta.
const PAY_METHOD_META = {
  caja: { icon: '💵', label: 'Efectivo (caja)' },
  transferencia: { icon: '🏦', label: 'Transferencia' },
  tarjeta: { icon: '💳', label: 'Tarjeta' },
  banco: { icon: '🏦', label: 'Banco' },
};
const PAY_METHOD_OPTIONS = [
  ['caja', '💵 Efectivo (caja)'],
  ['transferencia', '🏦 Transferencia'],
  ['tarjeta', '💳 Tarjeta'],
];
const TYPE_LABEL = {
  extranjeria: 'Extranjería',
  vehiculos: 'Tráfico / Vehículos',
  fiscal: 'Fiscal / Impuestos',
  laboral: 'Laboral / Nóminas',
  contabilidad: 'Contabilidad',
  pensiones: 'Pensiones / Prestaciones',
  social: 'Servicios sociales (JCCM)',
  otro: 'Otros trámites',
};
// Segmentos = bloques de expedientes (tipo de cliente).
const SEGMENTS = [
  { key: 'particular', label: 'Particulares', icon: '👤' },
  { key: 'autonomo', label: 'Autónomos', icon: '🧑‍💼' },
  { key: 'empresa', label: 'Empresas', icon: '🏢' },
];
const SEGMENT_LABEL = Object.fromEntries(SEGMENTS.map((s) => [s.key, s.label]));
const MSG_STATUS = {
  sending: '⏳ enviando…',
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
    } else if (f.type === 'custom') {
      // Campo con render propio; el valor se guarda en window['dlg_'+name].
      input = `<div id="${id}"></div>`;
    } else {
      input = `<input id="${id}" type="${f.type || 'text'}" value="${esc(f.value || '')}" ${f.required ? 'required' : ''}>`;
    }
    div.innerHTML = `<label for="${id}">${esc(f.label)}</label>${input}`;
    wrap.appendChild(div);
    if (f.type === 'custom' && f.mount) f.mount($('#' + id));
  }
  const dialog = $('#dialog');
  const form = $('#dialog-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const values = {};
    for (const f of fields) {
      values[f.name] = f.type === 'custom' ? (f.getValue ? f.getValue() : undefined) : $('#df-' + f.name).value;
    }
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
  users: [],
  activeClientId: null,
  activeClient: null,
  activeMessages: [],
  replyTo: null,
  tasks: [],
  taskAssignee: '',
  knowledge: [],
  caseFilter: '',
  segFilter: '',
  apptFilter: 'proximas',
  inboxFilter: '',
  tagFilter: '',
  activeFormId: null,
  noteMode: false,
  lastMessageCount: 0,
  convOrder: [],
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
    if (state.view === 'today') await renderToday();
    if (state.view === 'tasks') await renderTasks();
    if (state.view === 'inbox') await renderInbox();
    if (state.view === 'clients') await renderClients();
    if (state.view === 'cases') await renderCases();
    if (state.view === 'appointments') await renderAppointments();
    if (state.view === 'calendar') await renderCalendar();
    if (state.view === 'agenda') await renderAgenda();
    if (state.view === 'templates') await renderTemplates();
    if (state.view === 'fichas') await renderFichas();
    if (state.view === 'knowledge') await renderKnowledge();
    if (state.view === 'forms') await renderForms();
    if (state.view === 'receivables') await renderReceivables();
    if (state.view === 'reports') await renderReports();
    if (state.view === 'reminders') await renderReminders();
    if (state.view === 'campaigns') await renderCampaigns();
    if (state.view === 'automations') await renderAutomations();
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
  // Insignia de «Hoy»: lo urgente del día (vencidos, citas, chats sin responder).
  try {
    const t = await api('today');
    const urgent = t.vencimientos.filter((x) => x.overdue).length + t.citas.length + t.sinResponder.length;
    const tb = $('#nav-today');
    if (urgent) { tb.textContent = urgent; tb.classList.remove('hidden'); } else tb.classList.add('hidden');
  } catch { /* ignore */ }
  await updateTaskBadge();
  await updateCobrosBadge();
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

async function renderDashboard() {
  const [d, stats] = await Promise.all([api('dashboard'), api('stats')]);
  const respLbl = stats.avgResponseMinutes === null ? '—'
    : stats.avgResponseMinutes >= 60
      ? `${Math.round(stats.avgResponseMinutes / 60)} h`
      : `${stats.avgResponseMinutes} min`;
  $('#dash-cards').innerHTML = `
    <div class="card"><div class="num">${d.totalClients}</div><div class="lbl">Clientes</div></div>
    <div class="card ${d.unreadMessages ? 'warn' : ''}"><div class="num">${d.unreadMessages}</div><div class="lbl">Mensajes sin leer</div></div>
    <div class="card"><div class="num">${d.openCases}</div><div class="lbl">Expedientes abiertos</div></div>
    <div class="card ${d.casesAwaitingDocs ? 'warn' : ''}"><div class="num">${d.casesAwaitingDocs}</div><div class="lbl">Esperando documentación</div></div>
    <div class="card ${d.overdueCases ? 'alert' : ''}"><div class="num">${d.overdueCases}</div><div class="lbl">Expedientes vencidos</div></div>
    <div class="card ${d.expiringSoon ? 'warn' : ''}"><div class="num">${d.expiringSoon || 0}</div><div class="lbl">Caducan pronto (renovación)</div></div>
    <div class="card ${d.remindersToday ? 'warn' : ''}"><div class="num">${d.remindersToday}</div><div class="lbl">Recordatorios para hoy</div></div>
    <div class="card"><div class="num">${stats.messagesThisWeek}</div><div class="lbl">Mensajes esta semana</div></div>
    <div class="card"><div class="num">${respLbl}</div><div class="lbl">Tiempo medio de respuesta (30 d)</div></div>`;
  renderMessagesChart(stats.messagesByDay);
  renderCasesChart(stats.casesByStatus);
  $('#dash-recent').innerHTML = d.recentConversations.map(convRowHtml).join('')
    || '<p class="hint">Todavía no hay conversaciones.</p>';
  bindConvRows($('#dash-recent'), true);
}

// ---------------------------------------------------------------------------
// Hoy: lista de tareas del día
// ---------------------------------------------------------------------------

async function renderToday() {
  const t = await api('today');
  const d = new Date(t.date + 'T12:00');
  let label = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  $('#today-date').textContent = label.charAt(0).toUpperCase() + label.slice(1);

  const total = t.citas.length + t.recordatorios.length + t.vencimientos.length
    + t.docs.length + t.caducidades.length + t.sinResponder.length;
  const badge = $('#nav-today');
  const urgent = t.vencimientos.filter((x) => x.overdue).length + t.citas.length + t.sinResponder.length;
  if (urgent) { badge.textContent = urgent; badge.classList.remove('hidden'); } else badge.classList.add('hidden');

  const who = (w) => (w ? `<span class="ty-who">${esc(w)}</span>` : '');
  const goInbox = (id) => `data-go="inbox" data-client="${esc(id)}"`;
  const goView = (v) => `data-go="${v}"`;

  const block = (title, ico, cls, items, rowFn) => items.length ? `
    <div class="ty-block ${cls}">
      <div class="ty-head">${ico} ${title} <span class="block-count">${items.length}</span></div>
      <div class="list">${items.map(rowFn).join('')}</div>
    </div>` : '';

  const html = [
    block('Sin responder', '💬', 'ty-alert', t.sinResponder, (x) => `
      <div class="row ty-row" ${goInbox(x.clientId)}>
        <div class="grow"><div class="title">${esc(x.who)}</div><div class="sub">${esc(x.lastMessage || '')}</div></div>
        ${x.unread ? `<span class="unread-dot">${x.unread}</span>` : ''}
      </div>`),
    block('Citas de hoy', '📅', '', t.citas, (x) => `
      <div class="row ty-row" ${goInbox(x.clientId)}>
        <span class="ty-time">${esc(x.time)}</span>
        <div class="grow"><div class="title">${esc(x.who)}</div><div class="sub">${esc(x.reason)}</div></div>
      </div>`),
    block('Vencimientos', '📁', 'ty-alert', t.vencimientos, (x) => `
      <div class="row ty-row" ${goView('cases')}>
        <div class="grow"><div class="title">${esc(x.title)}</div><div class="sub">${who(x.who)}</div></div>
        <div class="meta ${x.overdue ? 'ty-over' : ''}">📅 ${fmtDate(x.dueDate)}${x.overdue ? ' ¡vencido!' : ''}</div>
      </div>`),
    block('Recordatorios', '⏰', '', t.recordatorios, (x) => `
      <div class="row ty-row" ${goView('reminders')}>
        <div class="grow"><div class="title">${esc(x.text)}</div><div class="sub">${who(x.who)}</div></div>
        <div class="meta ${x.overdue ? 'ty-over' : ''}">📅 ${fmtDate(x.dueDate)}</div>
      </div>`),
    block('Esperando documentación', '📎', '', t.docs, (x) => `
      <div class="row ty-row" ${goView('cases')}>
        <div class="grow"><div class="title">${esc(x.title)}</div><div class="sub">${who(x.who)}</div></div>
      </div>`),
    block('Caducan pronto', '🔄', '', t.caducidades, (x) => `
      <div class="row ty-row" ${goView('cases')}>
        <div class="grow"><div class="title">${esc(x.title)}</div><div class="sub">${who(x.who)}</div></div>
        <div class="meta ${x.expired ? 'ty-over' : ''}">🔄 ${fmtDate(x.expiryDate)}</div>
      </div>`),
  ].join('');

  $('#today-content').innerHTML = total
    ? html
    : '<div class="today-clear">✨ Nada pendiente para hoy. ¡Buen trabajo!</div>';

  $('#today-content').querySelectorAll('.ty-row').forEach((row) => {
    row.addEventListener('click', () => {
      const go = row.dataset.go;
      if (go === 'inbox') { showView('inbox'); if (row.dataset.client) openConversation(row.dataset.client); }
      else showView(go);
    });
  });
}

// Colores de serie validados (lila de marca + violeta profundo).
const CHART_IN = '#9272b0';   // recibidos (morado de marca)
const CHART_OUT = '#e9cf3c';  // enviados (amarillo de marca)

// Barras agrupadas: mensajes recibidos/enviados por día.
function renderMessagesChart(days) {
  const max = Math.max(1, ...days.map((d) => Math.max(d.in, d.out)));
  const total = days.reduce((a, d) => a + d.in + d.out, 0);
  $('#legend-messages').innerHTML = `
    <span class="key"><span class="swatch" style="background:${CHART_IN}"></span> Recibidos</span>
    <span class="key"><span class="swatch" style="background:${CHART_OUT}"></span> Enviados</span>`;
  if (!total) {
    $('#chart-messages').innerHTML = '<div class="chart-empty">Sin mensajes en los últimos 14 días.</div>';
    return;
  }
  const W = 560; const H = 150; const pad = { l: 4, r: 4, t: 8, b: 18 };
  const plotH = H - pad.t - pad.b;
  const group = (W - pad.l - pad.r) / days.length;
  const barW = Math.max(4, (group - 6) / 2);
  let bars = '';
  let labels = '';
  days.forEach((d, i) => {
    const x0 = pad.l + i * group + 3;
    const day = Number(d.date.slice(8));
    for (const [j, key, color] of [[0, 'in', CHART_IN], [1, 'out', CHART_OUT]]) {
      const v = d[key];
      const h = Math.round((v / max) * plotH);
      const x = x0 + j * (barW + 2);
      const y = pad.t + plotH - h;
      if (v > 0) {
        bars += `<path class="bar" d="M${x},${y + h} v${-Math.max(0, h - 4)} q0,-4 4,-4 h${barW - 8} q4,0 4,4 v${Math.max(0, h - 4)} z" fill="${color}"><title>${d.date}: ${v} ${key === 'in' ? 'recibidos' : 'enviados'}</title></path>`;
      }
      if (v === max) {
        labels += `<text x="${x + barW / 2}" y="${y - 3}" font-size="10" text-anchor="middle" fill="#6f6d75">${v}</text>`;
      }
    }
    if (i % 2 === 0) {
      labels += `<text x="${x0 + barW}" y="${H - 5}" font-size="9" text-anchor="middle" fill="#6f6d75">${day}</text>`;
    }
  });
  $('#chart-messages').innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Mensajes por día">`
    + `<line x1="${pad.l}" y1="${pad.t + plotH}" x2="${W - pad.r}" y2="${pad.t + plotH}" stroke="#e2e0d9"/>`
    + bars + labels + '</svg>';
}

// Barras horizontales: expedientes por estado (una sola serie, lila).
function renderCasesChart(byStatus) {
  const order = ['pendiente', 'en_curso', 'esperando_documentacion', 'completado'];
  const rows = order.map((s) => ({ s, label: STATUS_LABEL[s], v: byStatus[s] || 0 }));
  const max = Math.max(1, ...rows.map((r) => r.v));
  if (!rows.some((r) => r.v)) {
    $('#chart-cases').innerHTML = '<div class="chart-empty">Todavía no hay expedientes.</div>';
    return;
  }
  const W = 560; const rowH = 34; const labelW = 190; const H = rows.length * rowH + 6;
  let out = '';
  rows.forEach((r, i) => {
    const y = i * rowH + 6;
    const w = Math.max(r.v ? 6 : 0, Math.round((r.v / max) * (W - labelW - 46)));
    out += `<text x="${labelW - 8}" y="${y + 15}" font-size="12" text-anchor="end" fill="#1d1d1b">${r.label}</text>`;
    if (r.v) {
      out += `<path class="bar" d="M${labelW},${y} h${Math.max(0, w - 4)} q4,0 4,4 v14 q0,4 -4,4 h${-Math.max(0, w - 4)} z" fill="${CHART_IN}"><title>${r.label}: ${r.v}</title></path>`;
    }
    out += `<text x="${labelW + w + 8}" y="${y + 15}" font-size="12" fill="#6f6d75">${r.v}</text>`;
  });
  $('#chart-cases').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Expedientes por estado">${out}</svg>`;
}

// ---------------------------------------------------------------------------
// Bandeja de WhatsApp
// ---------------------------------------------------------------------------

const CONV_DOT = { abierta: '🟢', pendiente: '🟡', resuelta: '⚪' };

// Avatar: foto del cliente si la tiene; si no, iniciales con color estable.
function avatarHtml(name, clientId, hasAvatar) {
  if (hasAvatar && clientId) {
    return `<span class="avatar avatar-img"><img src="/api/clients/${encodeURIComponent(clientId)}/avatar" alt="" loading="lazy"></span>`;
  }
  const parts = (name || '?').trim().split(/\s+/);
  const initials = (parts[0]?.[0] || '?') + (parts[1]?.[0] || '');
  let hash = 0;
  for (const ch of name || '') hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return `<span class="avatar a${hash % 4}">${esc(initials.toUpperCase())}</span>`;
}

function convRowHtml(c) {
  const arrow = c.lastDirection === 'out' ? '↗ ' : c.lastDirection === 'note' ? '🗒️ ' : '';
  const tags = (c.tags || []).slice(0, 2).map((t) => `<span class="conv-tag">${esc(t)}</span>`).join('');
  return `
    <div class="row conv-row ${c.pinned ? 'pinned' : ''}" data-client-id="${esc(c.clientId)}">
      ${avatarHtml(c.clientName, c.clientId, c.avatar)}
      <div class="grow">
        <div class="title">${c.pinned ? '<span class="conv-pin">📌</span>' : ''}<span class="conv-dot">${CONV_DOT[c.convStatus] || '🟢'}</span>${esc(c.clientName)}
          ${c.assignedTo ? `<span class="conv-assigned">· ${esc(c.assignedTo)}</span>` : ''}</div>
        <div class="sub">${arrow}${esc(c.lastMessage)}</div>
        ${tags ? `<div class="conv-tags">${tags}</div>` : ''}
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

// Filtro de triaje de la bandeja de entrada (estado + etiqueta).
function filterConvs(convs) {
  let list = convs;
  const f = state.inboxFilter;
  if (f === 'unanswered') list = list.filter((c) => c.lastDirection === 'in');
  else if (f === 'pendiente') list = list.filter((c) => c.convStatus === 'pendiente');
  else if (f === 'resuelta') list = list.filter((c) => c.convStatus === 'resuelta');
  if (state.tagFilter) list = list.filter((c) => (c.tags || []).includes(state.tagFilter));
  return list;
}

// Al hacer clic en una etiqueta de una conversación, se filtra por ella.
function bindConvTags(container) {
  container.querySelectorAll('.conv-tag').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      state.tagFilter = el.textContent;
      renderInbox();
    });
  });
}
function tagFilterBar() {
  return state.tagFilter
    ? `<div class="tag-filter-bar">🏷️ ${esc(state.tagFilter)} <button class="tag-clear" id="tag-clear">✕</button></div>` : '';
}

async function renderInbox() {
  if ($('#conv-search').value.trim()) return renderConvSearch();
  const [convs, templates] = await Promise.all([api('conversations'), api('templates')]);
  state.templates = templates;
  const list = filterConvs(convs);
  state.convOrder = list.map((c) => c.clientId);
  $('#conv-list').innerHTML = tagFilterBar() + (list.map(convRowHtml).join('')
    || '<p class="hint">No hay conversaciones con este filtro.</p>');
  bindConvRows($('#conv-list'), false);
  bindConvTags($('#conv-list'));
  const clr = $('#tag-clear');
  if (clr) clr.addEventListener('click', () => { state.tagFilter = ''; renderInbox(); });

  const sel = $('#tpl-select');
  sel.innerHTML = '<option value="">📝 Plantilla…</option>'
    + templates.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');

  if (state.activeClientId) await openConversation(state.activeClientId);
}

// Construye el HTML de una sola burbuja de mensaje. Se usa tanto en el
// pintado completo de la conversación como en el envío optimista (aparece al
// instante al pulsar Enter, antes de que el servidor confirme).
function messageHtml(m) {
  if (m.direction === 'note') {
    return `<div class="msg note" data-mid="${esc(m.id)}">🗒️ ${esc(m.text)}
      <span class="msg-meta">${esc(m.author || 'equipo')} · ${fmtTime(m.timestamp)} · solo interno</span></div>`;
  }
  // Sticker del catálogo: se muestra desde su fichero estático, sin burbuja.
  if (m.media && m.media.kind === 'sticker' && m.media.stickerUrl) {
    return `<div class="msg ${m.direction} sticker" data-mid="${esc(m.id)}">
      <img src="${esc(m.media.stickerUrl)}" alt="sticker">
      <span class="msg-meta">${m.auto ? '🤖 · ' : ''}${fmtTime(m.timestamp)} ${MSG_STATUS[m.status] || ''}</span>
    </div>`;
  }
  let mediaHtml = '';
  if (m.media) {
    const src = `/api/media/${encodeURIComponent(m.id)}`;
    const isPdf = (m.media.mime || '') === 'application/pdf'
      || /\.pdf$/i.test(m.media.filename || '');
    if (m.media.kind === 'image' || m.media.kind === 'sticker') {
      mediaHtml = `<img class="msg-media msg-img" src="${src}" alt="imagen" loading="lazy" data-full="${src}" data-name="${esc(m.media.filename || 'imagen')}">`;
    } else if (isPdf) {
      // PDF: botón para previsualizarlo dentro del CRM, sin descargar.
      mediaHtml = `<button class="msg-file pdf-view" data-src="${src}" data-name="${esc(m.media.filename || 'documento.pdf')}">📄 ${esc(m.media.filename || 'Documento PDF')} <span class="pdf-eye">👁 Ver</span></button>`;
    } else if (m.media.kind === 'audio') {
      // Nota de voz: reproductor en línea dentro del chat.
      mediaHtml = `<audio class="msg-audio" controls preload="none" src="${src}"></audio>`;
    } else {
      const icon = m.media.kind === 'video' ? '🎬' : '📄';
      mediaHtml = `<a class="msg-file" href="${src}" target="_blank" download="${esc(m.media.filename || 'adjunto')}">${icon} ${esc(m.media.filename || 'Adjunto')}</a>`;
    }
    mediaHtml += `<button class="btn small msg-link-case" data-msg-id="${esc(m.id)}" title="Guardar en un expediente">${m.caseId ? '📁 en expediente' : '📁 asignar a expediente'}</button> `;
    if (m.media.kind === 'image' && !String(m.id || '').startsWith('tmp-')) {
      mediaHtml += `<button class="btn small msg-setphoto" data-msg-id="${esc(m.id)}" title="Usar esta imagen como foto del cliente">📷 foto</button> `;
    }
    if (m.sharepointUrl) {
      mediaHtml += `<a class="btn small" href="${esc(m.sharepointUrl)}" target="_blank" title="Abrir en SharePoint">☁️ SharePoint</a> `;
    }
  }
  const transcriptHtml = m.transcript
    ? `<div class="msg-transcript">🎤 <span>${esc(m.transcript)}</span></div>` : '';
  // Cita del mensaje al que se responde (WhatsApp «responder»).
  const quoteHtml = m.replyTo
    ? `<div class="msg-quote ${m.replyTo.direction === 'in' ? 'q-in' : 'q-out'}">${esc(m.replyTo.text || '(mensaje)')}</div>` : '';
  // Botón de responder (no en burbujas temporales aún sin id definitivo).
  const replyBtn = String(m.id || '').startsWith('tmp-')
    ? '' : `<button class="msg-reply" data-mid="${esc(m.id)}" title="Responder citando">↩</button>`;
  return `
  <div class="msg ${m.direction} ${m.status === 'error' ? 'error' : ''}" data-mid="${esc(m.id)}">${replyBtn}${quoteHtml}${mediaHtml}${esc(m.text)}${transcriptHtml}
    <span class="msg-meta">${m.auto ? '🤖 automático · ' : ''}${m.viaScheduled ? '🕒 programado · ' : ''}${m.viaTemplate ? '📋 plantilla · ' : ''}${m.viaApp ? '📱 desde el móvil · ' : ''}${m.viaProvider ? '☁️ vía YCloud · ' : ''}${fmtTime(m.timestamp)} ${MSG_STATUS[m.status] || ''}${m.error ? ' · ' + esc(m.error) : ''}</span>
  </div>`;
}

// Enlaza los botones de acción (asignar a expediente, ver PDF) dentro de un
// contenedor concreto: toda la conversación o una sola burbuja recién añadida.
function bindMsgButtons(scope, clientId) {
  scope.querySelectorAll('.msg-link-case').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const cases = await api('cases?clientId=' + encodeURIComponent(clientId));
      if (!cases.length) return alert('Este cliente no tiene expedientes. Crea uno primero.');
      openDialog('Guardar adjunto en expediente', [{
        name: 'caseId', label: 'Expediente', type: 'select',
        options: cases.map((c) => [c.id, c.title]),
      }], async (v) => {
        await api('messages/' + btn.dataset.msgId, { method: 'PUT', body: { caseId: v.caseId } });
        await openConversation(clientId);
      });
    });
  });
  scope.querySelectorAll('.pdf-view').forEach((btn) => {
    btn.addEventListener('click', () => openPdfPreview(btn.dataset.src, btn.dataset.name));
  });
  scope.querySelectorAll('.msg-reply').forEach((btn) => {
    btn.addEventListener('click', () => startReply(btn.dataset.mid));
  });
  scope.querySelectorAll('.msg-img').forEach((img) => {
    img.addEventListener('click', () => openLightbox(img.dataset.full, img.dataset.name));
  });
  scope.querySelectorAll('.msg-setphoto').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Usar esta imagen como foto del cliente?')) return;
      await setPhotoFromMessage(btn.dataset.msgId);
    });
  });
}

// Actualiza la cabecera con la ventana de servicio de 24 h y la nota fija.
function renderChatHeader(client, msgs) {
  const lastIn = msgs
    .filter((m) => m.direction === 'in')
    .reduce((max, m) => Math.max(max, m.timestamp), 0);
  const win = $('#chat-window');
  const closedTxt = state.template24hEnabled
    ? '🔒 Ventana de 24 h cerrada · se enviará con tu plantilla aprobada'
    : '🔒 Ventana de 24 h cerrada · WhatsApp solo permite plantillas';
  const leftMs = lastIn ? 24 * 3600 * 1000 - (Date.now() - lastIn) : -1;
  if (leftMs > 0) {
    const h = Math.floor(leftMs / 3600000);
    const min = Math.floor((leftMs % 3600000) / 60000);
    win.className = 'chat-window open';
    win.textContent = `🟢 Ventana de 24 h abierta · quedan ${h > 0 ? h + ' h ' : ''}${min} min`;
  } else {
    win.className = 'chat-window closed clickable';
    win.textContent = closedTxt;
  }
  const note = $('#chat-note');
  const txt = (client.pinnedNote || '').trim();
  note.classList.toggle('empty', !txt);
  note.textContent = txt ? '📌 ' + txt : '📌 Añadir nota fija…';
}

async function openConversation(clientId) {
  state.activeClientId = clientId;
  // En móvil, el chat ocupa la pantalla y la lista se oculta.
  if (window.innerWidth <= 760) document.querySelector('.inbox').classList.add('mobile-chat');
  const [client, msgs] = await Promise.all([
    api('clients/' + clientId),
    api('messages?clientId=' + encodeURIComponent(clientId)),
  ]);
  state.activeClient = client;
  $('#chat-empty').classList.add('hidden');
  $('#chat').classList.remove('hidden');
  $('#chat-name').textContent = client.name;
  $('#chat-phone').textContent = '+' + client.phone;
  $('#chat-avatar').innerHTML = avatarHtml(client.name, client.id, Boolean(client.avatarPath))
    + '<span class="chat-avatar-cam">📷</span>';
  $('#conv-status').value = client.convStatus || 'abierta';
  $('#conv-assign').innerHTML = '<option value="">Sin asignar</option>'
    + state.users.map((u) => `<option value="${esc(u)}" ${client.assignedTo === u ? 'selected' : ''}>${esc(u)}</option>`).join('');
  $('#btn-pin').classList.toggle('active', Boolean(client.pinned));
  $('#btn-pin').title = client.pinned ? 'Desfijar conversación' : 'Fijar conversación arriba';
  renderChatHeader(client, msgs);
  state.lastMessageCount = msgs.length;
  state.activeMessages = msgs;

  const box = $('#chat-messages');
  box.innerHTML = msgs.map(messageHtml).join('');
  box.scrollTop = box.scrollHeight;
  bindMsgButtons(box, clientId);
  // Si había una respuesta citada en curso, se mantiene visible.
  if (state.replyTo && state.replyTo.clientId === clientId) showReplyBar();
  else cancelReply();

  await renderScheduled();
  await api('messages/read', { method: 'POST', body: { clientId } });
  await updateUnreadBadge();
}

$('#conv-status').addEventListener('change', async () => {
  if (!state.activeClientId) return;
  await api('clients/' + state.activeClientId, { method: 'PUT', body: { convStatus: $('#conv-status').value } });
});

$('#conv-assign').addEventListener('change', async () => {
  if (!state.activeClientId) return;
  await api('clients/' + state.activeClientId, { method: 'PUT', body: { assignedTo: $('#conv-assign').value } });
});

$('#btn-note-mode').addEventListener('click', () => {
  state.noteMode = !state.noteMode;
  $('#btn-note-mode').classList.toggle('active', state.noteMode);
  $('#chat-input').placeholder = state.noteMode
    ? 'Nota interna (no se envía al cliente)…'
    : 'Escribe un mensaje…';
  $('#chat-input').focus();
});

$('#btn-send').addEventListener('click', sendCurrentMessage);
$('#chat-input').addEventListener('input', () => renderQuickReplies());
$('#chat-input').addEventListener('keydown', (e) => {
  const qr = $('#quick-replies');
  // Si el desplegable de respuestas rápidas está abierto, navega con él.
  if (qr && !qr.classList.contains('hidden')) {
    const items = [...qr.querySelectorAll('.qr-item')];
    if (e.key === 'ArrowDown') { e.preventDefault(); qrSel = Math.min(items.length - 1, qrSel + 1); renderQuickReplies(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); qrSel = Math.max(0, qrSel - 1); renderQuickReplies(); return; }
    if (e.key === 'Enter') { e.preventDefault(); const sel = items[qrSel]; if (sel) pickQuickReply(sel.dataset.id); return; }
    if (e.key === 'Escape') { qr.classList.add('hidden'); return; }
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendCurrentMessage();
  }
});

let tempMsgSeq = 0;
async function sendCurrentMessage() {
  const text = $('#chat-input').value.trim();
  if (!text || !state.activeClientId) return;
  const clientId = state.activeClientId;
  const isNote = state.noteMode;
  // Respuesta citada en curso (solo para mensajes al cliente, no notas).
  const reply = (!isNote && state.replyTo && state.replyTo.clientId === clientId) ? state.replyTo : null;
  // Envío optimista: la burbuja aparece al instante y se libera el cuadro de
  // texto, sin esperar a que el servidor responda ni repintar toda la charla.
  $('#chat-input').value = '';
  $('#quick-replies').classList.add('hidden');
  cancelReply();
  const box = $('#chat-messages');
  const tempId = 'tmp-' + (++tempMsgSeq);
  const temp = {
    id: tempId,
    clientId,
    direction: isNote ? 'note' : 'out',
    text,
    author: 'equipo',
    timestamp: Date.now(),
    status: isNote ? 'note' : 'sending',
    replyTo: reply ? { id: reply.id, direction: reply.direction, text: reply.text } : null,
    read: true,
  };
  box.insertAdjacentHTML('beforeend', messageHtml(temp));
  box.scrollTop = box.scrollHeight;
  const tempNode = box.querySelector(`[data-mid="${tempId}"]`);
  try {
    const saved = await api('messages', {
      method: 'POST',
      body: { clientId, text, note: isNote, replyTo: reply ? reply.id : null },
    });
    // Se sustituye la burbuja temporal por la definitiva del servidor.
    if (tempNode && state.activeClientId === clientId) {
      tempNode.outerHTML = messageHtml(saved);
      const real = box.querySelector(`[data-mid="${(window.CSS && CSS.escape) ? CSS.escape(saved.id) : saved.id}"]`);
      if (real) bindMsgButtons(real, clientId);
      state.lastMessageCount += 1;
    } else if (state.activeClientId === clientId) {
      await openConversation(clientId);
    }
  } catch (err) {
    if (tempNode) tempNode.remove();
    if (state.activeClientId === clientId && !$('#chat-input').value.trim()) {
      $('#chat-input').value = text; // se recupera el texto para reintentar
    }
    alert(err.message);
  }
}

// Sugerir una respuesta con IA: pide un borrador al servidor (basado en el
// hilo reciente y la base de conocimiento) y lo pone en el cuadro de texto
// para que se revise y edite antes de enviar. No envía nada por sí solo.
async function suggestReply() {
  if (!state.activeClientId) return;
  const btn = $('#btn-suggest');
  const input = $('#chat-input');
  btn.disabled = true;
  btn.classList.add('loading');
  try {
    const { suggestion } = await api('suggest-reply', { method: 'POST', body: { clientId: state.activeClientId } });
    if (suggestion) {
      input.value = suggestion;
      input.focus();
      input.dispatchEvent(new Event('input'));
    }
  } catch (err) {
    alert(err.message || 'No se pudo generar la sugerencia.');
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
  }
}

// --- Responder citando un mensaje ---
function startReply(mid) {
  const m = (state.activeMessages || []).find((x) => x.id === mid);
  if (!m) return;
  state.replyTo = {
    clientId: state.activeClientId,
    id: m.id,
    direction: m.direction,
    text: String(m.text || (m.media ? '📎 ' + (m.media.filename || 'Adjunto') : '')).slice(0, 140),
  };
  showReplyBar();
  $('#chat-input').focus();
}
function showReplyBar() {
  const bar = $('#reply-bar');
  if (!bar || !state.replyTo) return;
  const who = state.replyTo.direction === 'in' ? (state.activeClient?.name || 'Cliente') : 'Tú';
  $('#reply-bar-who').textContent = who;
  $('#reply-bar-text').textContent = state.replyTo.text || '(mensaje)';
  bar.classList.remove('hidden');
}
function cancelReply() {
  state.replyTo = null;
  const bar = $('#reply-bar');
  if (bar) bar.classList.add('hidden');
}

// --- Visor de imágenes (lightbox) con zoom y descarga ---
function openLightbox(src, name) {
  $('#lightbox-img').src = src;
  $('#lightbox-img').classList.remove('zoomed');
  $('#lightbox-download').href = src;
  $('#lightbox-download').setAttribute('download', name || 'imagen');
  $('#lightbox').classList.remove('hidden');
}
function closeLightbox() {
  $('#lightbox').classList.add('hidden');
  $('#lightbox-img').src = '';
}

// --- Galería de adjuntos de la conversación ---
function openGallery() {
  const media = (state.activeMessages || []).filter((m) => m.media
    && (m.media.kind === 'image' || m.media.kind === 'document' || m.media.kind === 'video' || m.media.kind === 'audio')
    && m.media.kind !== 'sticker');
  const grid = $('#gallery-grid');
  if (!media.length) {
    grid.innerHTML = '<p class="hint" style="grid-column:1/-1">No hay fotos ni documentos en esta conversación.</p>';
  } else {
    grid.innerHTML = media.map((m) => {
      const src = `/api/media/${encodeURIComponent(m.id)}`;
      if (m.media.kind === 'image') {
        return `<button class="gal-item gal-img" data-full="${src}" data-name="${esc(m.media.filename || 'imagen')}"><img src="${src}" loading="lazy" alt=""></button>`;
      }
      const icon = m.media.kind === 'video' ? '🎬' : m.media.kind === 'audio' ? '🎧' : '📄';
      return `<a class="gal-item gal-file" href="${src}" target="_blank" title="${esc(m.media.filename || 'Adjunto')}"><span class="gal-ico">${icon}</span><span class="gal-name">${esc(m.media.filename || 'Adjunto')}</span></a>`;
    }).join('');
    grid.querySelectorAll('.gal-img').forEach((b) => {
      b.addEventListener('click', () => openLightbox(b.dataset.full, b.dataset.name));
    });
  }
  $('#gallery-modal').classList.remove('hidden');
}

// --- Notas de voz salientes (grabar con el micro y enviar) ---
let mediaRecorder = null;
let recChunks = [];
let recStartMs = 0;
let recTimer = null;
async function toggleVoiceRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') { stopVoiceRecording(true); return; }
  if (!navigator.mediaDevices || !window.MediaRecorder) {
    return alert('Tu navegador no permite grabar audio.');
  }
  if (!state.activeClientId) return;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return alert('No se pudo acceder al micrófono. Da permiso al navegador e inténtalo de nuevo.');
  }
  // Elige el formato más compatible con WhatsApp que soporte el navegador
  // (ogg/opus y mp4/aac los acepta WhatsApp; webm queda como último recurso,
  // reproducible dentro del CRM aunque el proveedor pueda rechazarlo al enviar).
  const mime = ['audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']
    .find((t) => window.MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
  mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  recChunks = [];
  mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
  mediaRecorder.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(recChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
    if (state._recCancelled || blob.size < 400) { updateRecUI(false); return; }
    await sendVoiceNote(blob);
    updateRecUI(false);
  };
  state._recCancelled = false;
  mediaRecorder.start();
  recStartMs = Date.now();
  updateRecUI(true);
  recTimer = setInterval(() => {
    const s = Math.floor((Date.now() - recStartMs) / 1000);
    $('#rec-time').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    if (s >= 180) stopVoiceRecording(false); // límite de 3 min
  }, 250);
}
function stopVoiceRecording(send) {
  state._recCancelled = !send;
  if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
  if (recTimer) { clearInterval(recTimer); recTimer = null; }
}
function updateRecUI(recording) {
  $('#rec-bar').classList.toggle('hidden', !recording);
  $('#btn-voice').classList.toggle('recording', recording);
  if (!recording) $('#rec-time').textContent = '00:00';
}
async function sendVoiceNote(blob) {
  const clientId = state.activeClientId;
  const ext = /ogg/.test(blob.type) ? 'ogg' : /mp4/.test(blob.type) ? 'm4a' : 'webm';
  const dataUrl = await new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(blob);
  });
  const base64 = String(dataUrl).split(',')[1] || '';
  try {
    await api('messages', {
      method: 'POST',
      body: { clientId, file: { data: base64, mime: blob.type || 'audio/webm', name: `nota-voz.${ext}` } },
    });
    if (state.activeClientId === clientId) await openConversation(clientId);
  } catch (err) {
    alert(err.message);
  }
}

// --- Foto del cliente (avatar) ---
// Nota: no es la foto de perfil de WhatsApp (Meta no la comparte); es una foto
// que la gestoría asigna a cada cliente para reconocerlo de un vistazo.
async function afterAvatarChange(clientId) {
  if (state.activeClient && state.activeClient.id === clientId) state.activeClient.avatarPath = undefined;
  if (state.activeClientId === clientId) await openConversation(clientId);
  if (state.view === 'inbox') await renderInbox();
  if (state.view === 'clients') await renderClients();
}
function triggerAvatarUpload(clientId) {
  state._avatarTarget = clientId;
  const inp = $('#avatar-file');
  inp.value = '';
  inp.click();
}
async function setPhotoFromMessage(mid) {
  try {
    await api('clients/' + state.activeClientId + '/avatar', { method: 'POST', body: { fromMessageId: mid } });
    await afterAvatarChange(state.activeClientId);
  } catch (err) { alert(err.message); }
}
async function removeAvatar(clientId) {
  try {
    await api('clients/' + clientId + '/avatar', { method: 'DELETE' });
    await afterAvatarChange(clientId);
  } catch (err) { alert(err.message); }
}
function openPhotoMenu() {
  const clientId = state.activeClientId;
  if (!clientId) return;
  const hasAvatar = Boolean(state.activeClient && state.activeClient.avatarPath);
  const lastImg = [...(state.activeMessages || [])].reverse().find((m) => m.media && m.media.kind === 'image');
  openDialog('Foto del cliente', [{
    name: 'noop', type: 'custom',
    label: 'WhatsApp no comparte la foto de perfil del cliente; aquí puedes ponerle una tú.',
    mount(el) {
      const mk = (txt, fn) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'btn photo-menu-btn'; b.textContent = txt;
        b.addEventListener('click', async () => { $('#dialog').close(); await fn(); });
        return b;
      };
      el.appendChild(mk('📤 Subir una foto', () => triggerAvatarUpload(clientId)));
      if (lastImg) el.appendChild(mk('🖼️ Usar la última foto que envió', () => setPhotoFromMessage(lastImg.id)));
      if (hasAvatar) el.appendChild(mk('🗑️ Quitar la foto', () => removeAvatar(clientId)));
    },
    getValue() { return null; },
  }], async () => {});
}
$('#chat-avatar').addEventListener('click', openPhotoMenu);
$('#avatar-file').addEventListener('change', async () => {
  const file = $('#avatar-file').files[0];
  const clientId = state._avatarTarget;
  $('#avatar-file').value = '';
  if (!file || !clientId) return;
  if (file.size > 8_000_000) return alert('La imagen no puede superar los 8 MB.');
  try {
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    await api('clients/' + clientId + '/avatar', { method: 'POST', body: { file: { name: file.name, mime: file.type, data } } });
    await afterAvatarChange(clientId);
  } catch (err) { alert(err.message); }
});

// Explicación de la ventana de 24 h al pulsar el aviso.
$('#chat-window').addEventListener('click', () => {
  if (!$('#chat-window').classList.contains('closed')) return;
  const extra = state.template24hEnabled
    ? '\n\nComo tienes una plantilla aprobada configurada, tu mensaje se enviará usando esa plantilla.'
    : '\n\nPara escribir ahora mismo tienes dos opciones:\n• Pídele al cliente que te mande cualquier mensaje (con eso se reabre la ventana de 24 h y podrás responder con normalidad).\n• O configura una plantilla aprobada de Meta en Automatizaciones → «Plantilla para la ventana de 24 h».';
  alert('⏰ Ventana de 24 h de WhatsApp\n\nEsto no es un fallo del CRM: es una norma de WhatsApp. Solo permite enviar mensajes de texto libres durante las 24 h siguientes al último mensaje que te envía el cliente. Pasado ese tiempo, únicamente se pueden enviar plantillas aprobadas por Meta.' + extra);
});

// Listeners de las nuevas funciones del chat.
$('#reply-cancel').addEventListener('click', cancelReply);
$('#btn-notify').addEventListener('click', toggleNotify);
$('#btn-voice').addEventListener('click', toggleVoiceRecording);
$('#btn-suggest').addEventListener('click', suggestReply);
$('#rec-cancel').addEventListener('click', () => stopVoiceRecording(false));
$('#rec-send').addEventListener('click', () => stopVoiceRecording(true));
$('#btn-gallery').addEventListener('click', openGallery);
$('#gallery-close').addEventListener('click', () => $('#gallery-modal').classList.add('hidden'));
$('#gallery-modal').addEventListener('mousedown', (e) => { if (e.target.id === 'gallery-modal') $('#gallery-modal').classList.add('hidden'); });
$('#lightbox-close').addEventListener('click', closeLightbox);
$('#lightbox').addEventListener('mousedown', (e) => { if (e.target.id === 'lightbox') closeLightbox(); });
$('#lightbox-img').addEventListener('click', () => $('#lightbox-img').classList.toggle('zoomed'));

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

$('#btn-pin').addEventListener('click', async () => {
  if (!state.activeClientId) return;
  const nowPinned = !$('#btn-pin').classList.contains('active');
  $('#btn-pin').classList.toggle('active', nowPinned);
  $('#btn-pin').title = nowPinned ? 'Desfijar conversación' : 'Fijar conversación arriba';
  await api('clients/' + state.activeClientId, { method: 'PUT', body: { pinned: nowPinned } });
  await renderInbox();
});

$('#btn-back-conv').addEventListener('click', () => {
  document.querySelector('.inbox').classList.remove('mobile-chat');
});

// Nota fija del cliente: se muestra en la cabecera del chat y se edita al pulsar.
$('#chat-note').addEventListener('click', () => {
  if (!state.activeClientId) return;
  const current = (state.activeClient && state.activeClient.pinnedNote) || '';
  openDialog('Nota fija del cliente', [{
    name: 'pinnedNote', label: 'Nota (visible siempre en la cabecera del chat)',
    type: 'textarea', value: current,
    placeholder: 'Ej.: Habla poco español, prefiere que le llamen. NIE en trámite.',
  }], async (v) => {
    const note = (v.pinnedNote || '').trim();
    const updated = await api('clients/' + state.activeClientId, { method: 'PUT', body: { pinnedNote: note } });
    if (state.activeClient) state.activeClient.pinnedNote = updated.pinnedNote || '';
    const el = $('#chat-note');
    el.classList.toggle('empty', !note);
    el.textContent = note ? '📌 ' + note : '📌 Añadir nota fija…';
  });
});

// Programar un mensaje para enviarlo más tarde.
$('#btn-schedule').addEventListener('click', () => {
  if (!state.activeClientId) return;
  const text = $('#chat-input').value.trim();
  const pad = (n) => String(n).padStart(2, '0');
  const d = new Date(Date.now() + 60 * 60 * 1000); // por defecto: dentro de 1 h
  const defaultLocal = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  openDialog('Programar mensaje', [
    { name: 'text', label: 'Mensaje', type: 'textarea', value: text, placeholder: 'Escribe el mensaje que se enviará…' },
    { name: 'sendAt', label: 'Fecha y hora de envío', type: 'datetime-local', value: defaultLocal },
  ], async (v) => {
    const body = (v.text || '').trim();
    if (!body) return alert('El mensaje está vacío.');
    if (!v.sendAt) return alert('Indica cuándo enviarlo.');
    const sendAt = new Date(v.sendAt).getTime();
    if (!Number.isFinite(sendAt) || sendAt <= Date.now()) return alert('La fecha debe ser futura.');
    await api('scheduled-messages', { method: 'POST', body: { clientId: state.activeClientId, text: body, sendAt } });
    $('#chat-input').value = '';
    await renderScheduled();
    alert('Mensaje programado ✅');
  });
});

// Pedir firma de un documento (autorización de representación / RGPD).
$('#btn-sign').addEventListener('click', async () => {
  if (!state.activeClientId) return;
  const [docs, cases] = await Promise.all([
    api('signatures/docs'),
    api('cases?clientId=' + encodeURIComponent(state.activeClientId)),
  ]);
  openDialog('Pedir firma de un documento', [
    {
      name: 'docType', label: 'Documento a firmar', type: 'select',
      value: 'representacion', options: docs.map((d) => [d.key, d.label]),
    },
    {
      name: 'caseId', label: 'Expediente (opcional, para vincular la firma)', type: 'select',
      value: '', options: [['', '— Ninguno —'], ...cases.map((c) => [c.id, c.title])],
    },
    {
      name: 'send', label: 'Enviar el enlace ahora por WhatsApp', type: 'select',
      value: 'si', options: [['si', 'Sí, enviar por WhatsApp'], ['no', 'No, solo copiar el enlace']],
    },
  ], async (v) => {
    const r = await api('signatures', {
      method: 'POST',
      body: { clientId: state.activeClientId, docType: v.docType, caseId: v.caseId || null, send: v.send === 'si' },
    });
    await openConversation(state.activeClientId);
    if (v.send === 'si' && !r.sendError) {
      alert('Enlace de firma enviado por WhatsApp ✅');
    } else {
      try { await navigator.clipboard.writeText(r.signUrl); } catch { /* sin permiso de portapapeles */ }
      alert('Enlace de firma:\n\n' + r.signUrl + '\n\n(Copiado al portapapeles)'
        + (r.sendError ? '\n\n⚠️ No se pudo enviar por WhatsApp: ' + r.sendError : ''));
    }
  });
});

// Lista de mensajes programados pendientes del cliente activo (bajo la charla).
async function renderScheduled() {
  const wrap = $('#chat-scheduled');
  if (!wrap || !state.activeClientId) return;
  let list = [];
  try {
    list = await api('scheduled-messages?clientId=' + encodeURIComponent(state.activeClientId));
  } catch { return; }
  const pending = list.filter((s) => s.status === 'pendiente');
  if (!pending.length) { wrap.classList.add('hidden'); wrap.innerHTML = ''; return; }
  wrap.classList.remove('hidden');
  wrap.innerHTML = '<div class="sched-title">🕒 Programados</div>' + pending.map((s) => `
    <div class="sched-item">
      <span class="sched-when">${fmtDateTime(s.sendAt)}</span>
      <span class="sched-text">${esc(s.text)}</span>
      <button class="btn small sched-cancel" data-id="${esc(s.id)}" title="Cancelar">✕</button>
    </div>`).join('');
  wrap.querySelectorAll('.sched-cancel').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api('scheduled-messages/' + btn.dataset.id, { method: 'DELETE' });
      await renderScheduled();
    });
  });
}

// --- Selector de emojis ---
const EMOJIS = {
  'Caras': ['😀','😊','😉','😍','🥰','😎','🤔','😅','😂','🙂','😌','😇','🤗','😴','😢','😮','🙃','😉','🥳','😐'],
  'Gestos': ['👍','👏','🙏','🙌','👌','✌️','🤝','💪','👋','☝️','✅','❌','⭐','🔥','💯','❤️','💜','✨','🎉','🎊'],
  'Gestoría': ['📋','📄','📁','📎','🗂️','✍️','🖊️','📝','📅','⏰','💶','💰','🧾','🏦','⚖️','🏛️','🚗','🌍','👨‍💼','📲'],
};
let emojiBuilt = false;
function buildEmojiPanel() {
  if (emojiBuilt) return;
  const panel = $('#emoji-panel');
  panel.innerHTML = '';
  for (const [cat, list] of Object.entries(EMOJIS)) {
    const h = document.createElement('div');
    h.className = 'emoji-cat';
    h.textContent = cat;
    panel.appendChild(h);
    for (const e of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'emoji-btn';
      b.textContent = e;
      b.addEventListener('click', () => insertAtCursor($('#chat-input'), e));
      panel.appendChild(b);
    }
  }
  emojiBuilt = true;
}
function insertAtCursor(el, text) {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  el.value = el.value.slice(0, start) + text + el.value.slice(end);
  el.focus();
  const pos = start + text.length;
  el.setSelectionRange(pos, pos);
}
function closePanels(except) {
  if (except !== 'emoji') $('#emoji-panel').classList.add('hidden');
  if (except !== 'sticker') $('#sticker-panel').classList.add('hidden');
  const fp = $('#ficha-panel');
  if (fp && except !== 'ficha') fp.classList.add('hidden');
  if (except !== 'qr') $('#quick-replies').classList.add('hidden');
  const kb = $('#kb-panel');
  if (kb && except !== 'kb') kb.classList.add('hidden');
}

// Vista previa de PDF dentro del CRM (sin descargar).
function openPdfPreview(src, name) {
  $('#pdf-title').textContent = name || 'Documento';
  $('#pdf-download').href = src;
  $('#pdf-download').setAttribute('download', name || 'documento.pdf');
  $('#pdf-frame').src = src;
  $('#pdf-modal').classList.remove('hidden');
}
function closePdfPreview() {
  $('#pdf-modal').classList.add('hidden');
  $('#pdf-frame').src = 'about:blank';
}
$('#pdf-close').addEventListener('click', closePdfPreview);
$('#pdf-modal').addEventListener('mousedown', (e) => { if (e.target.id === 'pdf-modal') closePdfPreview(); });
$('#btn-emoji').addEventListener('click', (e) => {
  e.stopPropagation();
  buildEmojiPanel();
  const p = $('#emoji-panel');
  p.classList.toggle('hidden');
  closePanels('emoji');
});

// --- Panel de stickers de la gestoría ---
let stickersCache = null;
async function buildStickerPanel() {
  if (!stickersCache) stickersCache = await api('stickers');
  const panel = $('#sticker-panel');
  panel.innerHTML = stickersCache.map((s) =>
    `<button type="button" class="sticker-btn" data-sticker="${esc(s.id)}" title="${esc(s.label)}">
      <img src="/stickers/${esc(s.file)}" alt="${esc(s.label)}" loading="lazy"></button>`).join('')
    || '<p class="hint" style="grid-column:1/-1">No hay stickers disponibles.</p>';
  panel.querySelectorAll('.sticker-btn').forEach((btn) => {
    btn.addEventListener('click', () => sendSticker(btn.dataset.sticker));
  });
}
$('#btn-sticker').addEventListener('click', async (e) => {
  e.stopPropagation();
  const p = $('#sticker-panel');
  const willShow = p.classList.contains('hidden');
  closePanels('sticker');
  if (willShow) { await buildStickerPanel(); p.classList.remove('hidden'); }
  else p.classList.add('hidden');
});
async function sendSticker(stickerId) {
  if (!state.activeClientId) return;
  $('#sticker-panel').classList.add('hidden');
  try {
    await api('messages', { method: 'POST', body: { clientId: state.activeClientId, stickerId } });
    await openConversation(state.activeClientId);
  } catch (err) {
    alert(err.message);
  }
}
// Cerrar paneles al hacer clic fuera.
document.addEventListener('click', (e) => {
  if (!e.target.closest('.chat-compose')) closePanels();
});

// Adjuntar documento o imagen.
$('#btn-attach').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', async () => {
  const file = $('#file-input').files[0];
  $('#file-input').value = '';
  if (!file || !state.activeClientId) return;
  if (file.size > 16_000_000) return alert('WhatsApp no admite archivos de más de 16 MB.');
  const btn = $('#btn-attach');
  btn.disabled = true;
  btn.textContent = '⏳';
  try {
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    await api('messages', {
      method: 'POST',
      body: {
        clientId: state.activeClientId,
        text: $('#chat-input').value.trim(),
        file: { name: file.name, mime: file.type, data },
      },
    });
    $('#chat-input').value = '';
    await openConversation(state.activeClientId);
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '📎';
  }
});

// Búsqueda dentro de todas las conversaciones.
async function renderConvSearch() {
  const q = $('#conv-search').value.trim();
  if (!q) return renderInbox();
  const results = await api('search-messages?q=' + encodeURIComponent(q));
  $('#conv-list').innerHTML = results.map((r) => `
    <div class="row conv-row" data-client-id="${esc(r.clientId)}">
      ${avatarHtml(r.clientName)}
      <div class="grow">
        <div class="title">${esc(r.clientName)}</div>
        <div class="sub">${r.direction === 'out' ? '↗ ' : ''}${esc(r.text)}</div>
      </div>
      <div class="meta">${fmtTime(r.timestamp)}</div>
    </div>`).join('') || '<p class="hint">Sin resultados.</p>';
  bindConvRows($('#conv-list'), false);
}

let convSearchTimer = null;
$('#conv-search').addEventListener('input', () => {
  clearTimeout(convSearchTimer);
  convSearchTimer = setTimeout(renderConvSearch, 300);
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
    {
      name: 'segment', label: 'Tipo de cliente (bloque de expedientes)', type: 'select',
      value: c.segment || 'particular',
      options: SEGMENTS.map((s) => [s.key, s.label]),
    },
    { name: 'nif', label: 'NIF / DNI / CIF', value: c.nif },
    { name: 'email', label: 'Email', type: 'email', value: c.email },
    { name: 'tags', label: 'Etiquetas (separadas por comas)', value: (c.tags || []).join(', ') },
    sharepointField(c),
    { name: 'notes', label: 'Notas', type: 'textarea', value: c.notes },
  ];
}

// Campo de carpeta de SharePoint: crear nueva o elegir una existente.
function sharepointField(c = {}) {
  let selected = c.sharepointFolder ? { ...c.sharepointFolder } : null;
  let box = null;
  const render = () => {
    if (!box) return;
    box.innerHTML = selected
      ? `<div class="sp-selected">☁️ <b>${esc(selected.path)}</b>
          ${selected.webUrl ? `<a href="${esc(selected.webUrl)}" target="_blank" class="btn small">Abrir</a>` : ''}
          <button type="button" class="btn small" id="sp-change">Cambiar</button>
          <button type="button" class="btn small danger" id="sp-clear">Quitar</button></div>`
      : `<div class="sp-empty">
          <button type="button" class="btn small primary" id="sp-create">＋ Crear carpeta</button>
          <button type="button" class="btn small" id="sp-pick">📁 Elegir existente</button>
        </div>`;
    if (box.querySelector('#sp-change')) box.querySelector('#sp-change').onclick = () => { selected = null; render(); };
    if (box.querySelector('#sp-clear')) box.querySelector('#sp-clear').onclick = () => { selected = null; render(); };
    if (box.querySelector('#sp-create')) box.querySelector('#sp-create').onclick = createFolderFlow;
    if (box.querySelector('#sp-pick')) box.querySelector('#sp-pick').onclick = pickFolderFlow;
  };
  const createFolderFlow = async () => {
    const name = $('#df-name').value.trim() || c.name || '';
    const segment = $('#df-segment').value || c.segment || 'particular';
    if (!name) return alert('Escribe primero el nombre del cliente.');
    const sug = await api(`sharepoint/suggest?name=${encodeURIComponent(name)}&segment=${segment}`);
    if (!sug.configured) return alert('Microsoft 365 no está configurado. Actívalo en Automatizaciones.');
    const path = prompt('Se creará esta carpeta en SharePoint (puedes editarla):', sug.path);
    if (!path) return;
    box.innerHTML = '<span class="hint">Creando carpeta…</span>';
    try {
      const folder = await api('sharepoint/folder', { method: 'POST', body: { path } });
      selected = { path: folder.path, webUrl: folder.webUrl };
    } catch (err) { alert(err.message); }
    render();
  };
  const pickFolderFlow = () => openFolderPicker((folder) => { selected = folder; render(); });
  return {
    name: 'sharepointFolder', type: 'custom',
    label: 'Carpeta de SharePoint del cliente',
    mount: (el) => { box = el; render(); },
    getValue: () => selected,
  };
}

// Navegador de carpetas de SharePoint en un diálogo aparte.
async function openFolderPicker(onChoose) {
  const dlg = $('#folder-dialog');
  let path = '';
  const load = async () => {
    $('#fp-list').innerHTML = '<p class="hint">Cargando…</p>';
    try {
      const r = await api('sharepoint/folders?path=' + encodeURIComponent(path));
      if (!r.configured) { $('#fp-list').innerHTML = '<p class="hint">Microsoft 365 no está configurado.</p>'; return; }
      $('#fp-path').textContent = '/' + (path || '');
      $('#fp-up').style.visibility = path ? 'visible' : 'hidden';
      $('#fp-list').innerHTML = r.folders.map((f) =>
        `<div class="fp-row" data-path="${esc(f.path)}"><span class="fp-open" data-path="${esc(f.path)}">📁 ${esc(f.name)}</span>
          <button type="button" class="btn small fp-choose" data-path="${esc(f.path)}" data-url="${esc(f.webUrl || '')}">Elegir</button></div>`).join('')
        || '<p class="hint">Esta carpeta no tiene subcarpetas. Puedes elegirla con el botón de abajo.</p>';
      $('#fp-list').querySelectorAll('.fp-open').forEach((e) => e.onclick = () => { path = e.dataset.path; load(); });
      $('#fp-list').querySelectorAll('.fp-choose').forEach((e) => e.onclick = () => {
        onChoose({ path: e.dataset.path, webUrl: e.dataset.url || null }); dlg.close();
      });
    } catch (err) { $('#fp-list').innerHTML = `<p class="hint">${esc(err.message)}</p>`; }
  };
  $('#fp-up').onclick = () => { path = path.split('/').slice(0, -1).join('/'); load(); };
  $('#fp-choose-current').onclick = () => { if (path) { onChoose({ path, webUrl: null }); dlg.close(); } };
  $('#fp-cancel').onclick = () => dlg.close();
  await load();
  dlg.showModal();
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
      ${avatarHtml(c.name, c.id, Boolean(c.avatarPath))}
      <div class="grow">
        <div class="title">${esc(c.name)} <span class="seg-badge seg-${esc(c.segment || 'particular')}">${esc(SEGMENT_LABEL[c.segment] || 'Particulares')}</span></div>
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

$('#btn-export-clients').addEventListener('click', () => { location.href = '/api/export/clients.csv'; });
$('#btn-export-cases').addEventListener('click', () => { location.href = '/api/export/cases.csv'; });

// Importar contactos del móvil (.vcf): pone el nombre guardado a los clientes.
$('#btn-import-contacts').addEventListener('click', () => $('#contacts-file').click());
$('#contacts-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const vcard = await file.text();
    const r = await api('contacts/import', { method: 'POST', body: { vcard } });
    alert(`Contactos leídos: ${r.contacts}\nCoinciden con tus clientes: ${r.matched}\nNombres actualizados: ${r.updated}`
      + (r.updated ? '' : '\n\n(No se cambió ningún nombre: tus clientes ya tienen nombre o no coinciden los teléfonos.)'));
    await renderClients();
  } catch (err) {
    alert('No se pudo importar: ' + err.message);
  }
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
    ...(state.isolation ? [shareField(client)] : []),
    estadoLinkField(client),
    documentosField(client),
    dossierField(client),
  ], async (v) => {
    delete v._cases;
    delete v._estado;
    delete v._dossier;
    delete v._documentos;
    delete v._share;
    await api('clients/' + id, { method: 'PUT', body: parseClientValues(v) });
    await refreshView();
  });
}

// Campo personalizado: reparto y compartición del cliente entre usuarios.
// Solo se muestra con aislamiento activo (varios usuarios). El dueño puede
// compartir su cliente (y sus chats/expedientes) con otros compañeros.
function shareField(client) {
  const owner = client.owner || null;
  const amOwner = !owner || owner === state.me;
  const others = state.users.filter((u) => u !== owner);
  const shared = Array.isArray(client.sharedWith) ? client.sharedWith : [];
  return {
    name: '_share',
    label: 'Reparto y compartir',
    type: 'custom',
    mount(el) {
      if (!owner) {
        el.innerHTML = `<p class="hint" style="margin:0 0 8px">Cliente <strong>común</strong>: visible para todo el equipo.</p>`;
        return;
      }
      if (!amOwner) {
        el.innerHTML = `<p class="hint" style="margin:0">Este cliente es de <strong>${esc(owner)}</strong> y lo ha compartido contigo. Solo ${esc(owner)} puede cambiar con quién se comparte.</p>`;
        return;
      }
      el.innerHTML = `
        <p class="hint" style="margin:0 0 8px">Dueño: <strong>${esc(owner)}</strong> (tú). Marca los compañeros con los que quieras compartir este cliente, sus chats y sus expedientes:</p>
        <div class="share-users">${others.map((u) => `
          <label class="share-user"><input type="checkbox" value="${esc(u)}" ${shared.includes(u) ? 'checked' : ''}> ${esc(u)}</label>`).join('') || '<span class="hint">No hay otros usuarios.</span>'}</div>
        <p class="hint share-status" style="margin:8px 0 0"></p>`;
      const status = el.querySelector('.share-status');
      el.querySelectorAll('.share-user input').forEach((chk) => {
        chk.addEventListener('change', async () => {
          const list = [...el.querySelectorAll('.share-user input:checked')].map((c) => c.value);
          try {
            await api('clients/' + client.id, { method: 'PUT', body: { sharedWith: list } });
            status.textContent = list.length ? `Compartido con: ${list.join(', ')}.` : 'Ya no se comparte con nadie.';
          } catch (e) { status.textContent = e.message; }
        });
      });
    },
    getValue() { return undefined; },
  };
}

// Campo personalizado: documentos pre-rellenados en PDF (autorización de
// representación, hoja de encargo, consentimiento RGPD). Se generan ya
// rellenos con los datos del cliente, listos para imprimir y firmar en papel.
function documentosField(client) {
  const docs = [
    ['autorizacion', '📝 Autorización de representación'],
    ['encargo', '📋 Hoja de encargo'],
    ['rgpd', '🔒 Consentimiento RGPD'],
  ];
  return {
    name: '_documentos', label: 'Documentos pre-rellenados', type: 'custom',
    mount(el) {
      el.innerHTML = `<div class="doc-btns" style="display:flex;flex-wrap:wrap;gap:8px">${docs.map(([tipo, lbl]) =>
        `<a class="btn small" href="/api/clients/${esc(client.id)}/documento/${tipo}" target="_blank" rel="noopener">${lbl}</a>`).join('')}</div>
        <p class="hint" style="margin:6px 0 0">PDF ya relleno con los datos del cliente (nombre, NIF/NIE, teléfono) y sus trámites en curso, con la línea de firma en blanco. Para imprimir y firmar en la oficina.</p>`;
    },
    getValue() { return undefined; },
  };
}

// Campo personalizado: dossier del cliente en PDF (datos, expedientes, firmas).
function dossierField(client) {
  return {
    name: '_dossier', label: 'Dossier del cliente', type: 'custom',
    mount(el) {
      el.innerHTML = `<a class="btn small" href="/api/clients/${esc(client.id)}/dossier" target="_blank" rel="noopener">📄 Abrir dossier (PDF)</a>
        <p class="hint" style="margin:6px 0 0">Un PDF con sus datos, expedientes (estado, importes, nº de registro), documentos firmados y resumen de actividad. Para archivo, traspaso o inspección.</p>`;
    },
    getValue() { return undefined; },
  };
}

// Campo personalizado: enlace privado «Estado del trámite» del cliente.
// Genera el enlace, permite copiarlo y enviarlo al cliente por WhatsApp.
function estadoLinkField(client) {
  let box;
  const render = (data) => {
    if (!data) {
      box.innerHTML = `<button type="button" class="btn small" id="est-gen">🔗 Generar enlace de seguimiento</button>
        <p class="hint" style="margin:6px 0 0">Página privada (solo lectura) donde el cliente ve el estado de sus trámites.</p>`;
      box.querySelector('#est-gen').addEventListener('click', async () => {
        try { render(await api('clients/' + client.id + '/estado-link', { method: 'POST' })); }
        catch (e) { alert(e.message); }
      });
      return;
    }
    box.innerHTML = `
      <div class="est-link">
        <input type="text" id="est-url" value="${esc(data.url)}" readonly>
        <button type="button" class="btn small" id="est-copy">Copiar</button>
      </div>
      <div class="est-actions">
        <a class="btn small" href="${esc(data.url)}" target="_blank" rel="noopener">Abrir</a>
        <button type="button" class="btn small primary" id="est-send">📲 Enviar al cliente por WhatsApp</button>
      </div>`;
    box.querySelector('#est-copy').addEventListener('click', async () => {
      const inp = box.querySelector('#est-url');
      inp.select();
      try { await navigator.clipboard.writeText(data.url); } catch { document.execCommand('copy'); }
      box.querySelector('#est-copy').textContent = '¡Copiado!';
      setTimeout(() => { const b = box.querySelector('#est-copy'); if (b) b.textContent = 'Copiar'; }, 1500);
    });
    box.querySelector('#est-send').addEventListener('click', async () => {
      const name = (client.name || '').split(' ')[0] || '';
      const text = `Hola ${name} 👋 Puedes seguir el estado de tus trámites en tiempo real aquí: ${data.url}`;
      try {
        await api('messages', { method: 'POST', body: { clientId: client.id, text } });
        alert('Enlace enviado al cliente por WhatsApp.');
      } catch (e) { alert(e.message); }
    });
  };
  return {
    name: '_estado',
    label: 'Estado del trámite (enlace para el cliente)',
    type: 'custom',
    mount(el) { box = el; render(client.statusToken ? { token: client.statusToken, url: location.origin + '/estado/' + client.statusToken } : null); },
    getValue() { return undefined; },
  };
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
document.querySelectorAll('#seg-filters .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#seg-filters .chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    state.segFilter = chip.dataset.seg;
    renderCases();
  });
});

function caseFields(item = {}, clients = [], fichas = []) {
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
    { name: 'submittedDate', label: 'Fecha de presentación en la administración (la ve el cliente en su seguimiento)', type: 'date', value: item.submittedDate },
    { name: 'registryNumber', label: 'Nº de registro / expediente de la administración (lo ve el cliente)', value: item.registryNumber || '' },
    { name: 'trackingUrl', label: 'URL de seguimiento en la administración (opcional; el cliente verá un botón para consultarlo)', type: 'url', value: item.trackingUrl || '' },
    { name: 'expiryDate', label: 'Fecha de caducidad (TIE, NIE, ITV… avisa antes de vencer)', type: 'date', value: item.expiryDate },
    { name: 'fee', label: 'Honorario de la gestoría (€)', type: 'number', value: item.fee || '' },
    {
      name: 'paid', label: 'Honorario cobrado', type: 'select', value: item.paid ? 'si' : 'no',
      options: [['no', 'Pendiente de cobro'], ['si', 'Cobrado']],
    },
    {
      name: 'payMethod', label: 'Forma de cobro (si está cobrado)', type: 'select', value: item.payMethod || '',
      options: [['', '— Sin especificar —'], ...PAY_METHOD_OPTIONS,
        ...(item.payMethod === 'banco' ? [['banco', '🏦 Banco']] : [])],
    },
    { name: 'taxModel', label: 'Tasa oficial · modelo (ej. «790 cód. 012», «Tasa 052»)', value: item.taxModel || '' },
    { name: 'taxAmount', label: 'Tasa oficial · importe (€)', type: 'number', value: item.taxAmount || '' },
    {
      name: 'taxPaid', label: 'Tasa oficial abonada', type: 'select', value: item.taxPaid ? 'si' : 'no',
      options: [['no', 'Pendiente de pago'], ['si', 'Abonada']],
    },
    checklistField(item, fichas),
    { name: 'docs', label: 'Documentación necesaria (una línea por documento; se usa en la automatización)', type: 'textarea', value: item.docs },
    { name: 'notes', label: 'Notas', type: 'textarea', value: item.notes },
    ...(state.isolation && item.id ? [caseShareField(item, clients)] : []),
  ];
}

// Campo personalizado: compartir un expediente en concreto con otro usuario,
// sin necesidad de compartir toda la ficha del cliente. Solo con aislamiento.
function caseShareField(item, clients = []) {
  const client = clients.find((c) => c.id === item.clientId) || {};
  const owner = client.owner || null;
  const amOwner = !owner || owner === state.me;
  const others = state.users.filter((u) => u !== owner);
  const shared = Array.isArray(item.sharedWith) ? item.sharedWith : [];
  return {
    name: '_caseshare',
    label: 'Compartir solo este expediente',
    type: 'custom',
    mount(el) {
      if (!amOwner) {
        el.innerHTML = `<p class="hint" style="margin:0">Solo el dueño del cliente (${esc(owner)}) puede cambiar con quién se comparte este expediente.</p>`;
        return;
      }
      el.innerHTML = `
        <p class="hint" style="margin:0 0 8px">Da acceso a este expediente (y sus adjuntos) a un compañero, sin compartir el resto de la ficha del cliente:</p>
        <div class="share-users">${others.map((u) => `
          <label class="share-user"><input type="checkbox" value="${esc(u)}" ${shared.includes(u) ? 'checked' : ''}> ${esc(u)}</label>`).join('') || '<span class="hint">No hay otros usuarios.</span>'}</div>
        <p class="hint share-status" style="margin:8px 0 0"></p>`;
      const status = el.querySelector('.share-status');
      el.querySelectorAll('.share-user input').forEach((chk) => {
        chk.addEventListener('change', async () => {
          const list = [...el.querySelectorAll('.share-user input:checked')].map((c) => c.value);
          try {
            await api('cases/' + item.id, { method: 'PUT', body: { sharedWith: list } });
            status.textContent = list.length ? `Compartido con: ${list.join(', ')}.` : 'Ya no se comparte con nadie.';
          } catch (e) { status.textContent = e.message; }
        });
      });
    },
    getValue() { return undefined; },
  };
}

// Campo personalizado: checklist de documentación recibida.
// Permite añadir ítems a mano o cargarlos de una ficha de trámite, y marcarlos.
function checklistField(item = {}, fichas = []) {
  let items = Array.isArray(item.checklist) ? item.checklist.map((c) => ({ ...c })) : [];
  let box;
  const render = () => {
    const rows = items.map((c, i) => `
      <label class="chk-row">
        <input type="checkbox" data-i="${i}" ${c.done ? 'checked' : ''}>
        <span class="${c.done ? 'chk-done' : ''}">${esc(c.item)}</span>
        <button type="button" class="chk-del" data-i="${i}" title="Quitar">✕</button>
      </label>`).join('');
    const fichaOpts = fichas.map((f) => `<option value="${esc(f.id)}">${esc(f.title)}</option>`).join('');
    box.innerHTML = `
      <div class="chk-list">${rows || '<p class="hint" style="margin:0">Sin documentos en la lista.</p>'}</div>
      <div class="chk-add">
        <input type="text" class="chk-new" placeholder="Añadir documento…">
        <button type="button" class="btn small chk-add-btn">Añadir</button>
      </div>
      ${fichas.length ? `<div class="chk-load">
        <select class="chk-ficha"><option value="">Cargar de una lista guardada…</option>${fichaOpts}</select>
      </div>` : ''}`;
    box.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener('change', () => { items[Number(cb.dataset.i)].done = cb.checked; render(); });
    });
    box.querySelectorAll('.chk-del').forEach((b) => {
      b.addEventListener('click', () => { items.splice(Number(b.dataset.i), 1); render(); });
    });
    const addNew = () => {
      const inp = box.querySelector('.chk-new');
      const v = inp.value.trim();
      if (v) { items.push({ item: v, done: false }); render(); }
    };
    box.querySelector('.chk-add-btn').addEventListener('click', addNew);
    box.querySelector('.chk-new').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addNew(); }
    });
    const sel = box.querySelector('.chk-ficha');
    if (sel) sel.addEventListener('change', () => {
      const f = fichas.find((x) => x.id === sel.value);
      if (!f) return;
      const lines = (f.docs || '').split('\n').map((l) => l.trim()).filter(Boolean);
      const have = new Set(items.map((c) => c.item.toLowerCase()));
      for (const l of lines) if (!have.has(l.toLowerCase())) items.push({ item: l, done: false });
      sel.value = '';
      render();
    });
  };
  return {
    name: 'checklist',
    label: 'Checklist de documentación recibida',
    type: 'custom',
    mount(el) { box = el; render(); },
    getValue() { return items; },
  };
}

// Normaliza los valores del formulario de expediente antes de enviarlos.
function caseBody(v) {
  const paid = v.paid === 'si';
  return {
    ...v,
    fee: Number(v.fee) || 0, paid,
    payMethod: paid ? (v.payMethod || '') : '', // sin cobro no hay forma de cobro
    taxAmount: Number(v.taxAmount) || 0, taxPaid: v.taxPaid === 'si',
  };
}

async function renderCases() {
  const [cases, clients, fichas] = await Promise.all([api('cases'), api('clients'), api('fichas')]);
  state.clients = clients;
  const clientOf = (id) => clients.find((c) => c.id === id);
  const nameOf = (id) => clientOf(id)?.name || '(cliente eliminado)';
  const segOf = (id) => clientOf(id)?.segment || 'particular';

  let list = cases;
  if (state.caseFilter) list = list.filter((c) => c.status === state.caseFilter);
  list = list.slice().sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')));

  const caseRow = (c) => {
    const overdue = c.dueDate && c.status !== 'completado' && new Date(c.dueDate) < new Date();
    const chk = Array.isArray(c.checklist) ? c.checklist : [];
    const done = chk.filter((x) => x.done).length;
    const chkBadge = chk.length
      ? `<span class="chk-badge ${done === chk.length ? 'ok' : ''}" title="Documentación recibida">📎 ${done}/${chk.length}</span>` : '';
    const fee = Number(c.fee) || 0;
    const payMeta = c.paid && PAY_METHOD_META[c.payMethod] ? PAY_METHOD_META[c.payMethod] : null;
    const payIcon = payMeta ? ' ' + payMeta.icon : '';
    const payTitle = payMeta ? ' (' + payMeta.label.toLowerCase() + ')' : '';
    const feeBadge = fee
      ? `<span class="fee-badge ${c.paid ? 'paid' : 'due'}" title="${c.paid ? 'Honorario cobrado' + payTitle : 'Honorario pendiente de cobro'}">${fee.toLocaleString('es-ES')} € ${c.paid ? '✓' : '•'}${payIcon}</span>` : '';
    const taxAmt = Number(c.taxAmount) || 0;
    const taxBadge = (taxAmt || c.taxModel)
      ? `<span class="tax-badge ${c.taxPaid ? 'paid' : 'due'}" title="Tasa oficial${c.taxModel ? ' (' + esc(c.taxModel) + ')' : ''}: ${c.taxPaid ? 'abonada' : 'pendiente de pago'}">🏛️ ${taxAmt ? taxAmt.toLocaleString('es-ES') + ' € ' : ''}${c.taxPaid ? '✓' : '•'}</span>` : '';
    const subBadge = c.submittedDate
      ? `<span class="sub-badge" title="Presentado en la administración el ${fmtDate(c.submittedDate)} (visible para el cliente)">📨 ${fmtDate(c.submittedDate)}</span>` : '';
    const regBadge = c.registryNumber
      ? `<span class="reg-badge" title="Nº de registro de la administración (visible para el cliente)">🔖 ${esc(c.registryNumber)}</span>` : '';
    let expBadge = '';
    if (c.expiryDate) {
      const days = Math.ceil((new Date(c.expiryDate + 'T00:00') - new Date()) / 86400000);
      const cls = days < 0 ? 'exp' : days <= 45 ? 'soon' : '';
      const txt = days < 0 ? 'caducado' : days <= 45 ? `caduca en ${days} d` : `cad. ${fmtDate(c.expiryDate)}`;
      expBadge = `<span class="exp-badge ${cls}" title="Fecha de caducidad: ${fmtDate(c.expiryDate)}">🔄 ${txt}</span>`;
    }
    return `
    <div class="row case-row" data-id="${esc(c.id)}">
      <div class="grow">
        <div class="title">${esc(c.title)}</div>
        <div class="sub">${esc(nameOf(c.clientId))} · <span class="area-badge">${esc(TYPE_LABEL[c.type] || c.type)}</span> ${chkBadge} ${feeBadge} ${taxBadge} ${subBadge} ${regBadge} ${expBadge}</div>
      </div>
      <div class="meta">
        <span class="status ${esc(c.status)}">${esc(STATUS_LABEL[c.status] || c.status)}</span>
        <div style="${overdue ? 'color:var(--danger);font-weight:700' : ''}">📅 ${fmtDate(c.dueDate)}${overdue ? ' ¡vencido!' : ''}</div>
      </div>
    </div>`;
  };

  // Bloques por tipo de cliente (segmento). Se ocultan los vacíos.
  const blocks = SEGMENTS
    .map((seg) => ({ seg, items: list.filter((c) => segOf(c.clientId) === seg.key) }))
    .filter((b) => state.segFilter ? b.seg.key === state.segFilter : true);

  const anyItems = blocks.some((b) => b.items.length);
  $('#case-list').innerHTML = anyItems ? blocks.map((b) => b.items.length ? `
    <div class="case-block">
      <div class="block-head"><span class="block-title">${b.seg.icon} ${esc(b.seg.label)}</span><span class="block-count">${b.items.length}</span></div>
      <div class="list">${b.items.map(caseRow).join('')}</div>
    </div>` : '').join('')
    : '<p class="hint">No hay expedientes con este filtro.</p>';

  $('#case-list').querySelectorAll('.case-row').forEach((row) => {
    row.addEventListener('click', () => {
      const item = cases.find((c) => c.id === row.dataset.id);
      openDialog('Editar expediente', caseFields(item, clients, fichas), async (v) => {
        await api('cases/' + item.id, { method: 'PUT', body: caseBody(v) });
        await renderCases();
      });
    });
  });
}

$('#btn-new-case').addEventListener('click', async () => {
  const [clients, fichas] = await Promise.all([api('clients'), api('fichas')]);
  if (!clients.length) return alert('Primero crea al menos un cliente.');
  openDialog('Nuevo expediente', caseFields({}, clients, fichas), async (v) => {
    await api('cases', { method: 'POST', body: caseBody(v) });
    await renderCases();
  });
});

// ---------------------------------------------------------------------------
// Tareas del equipo (panel kanban)
// ---------------------------------------------------------------------------

const TASK_COLS = [
  { key: 'por_hacer', label: 'Por hacer', icon: '📋' },
  { key: 'en_curso', label: 'En curso', icon: '⏳' },
  { key: 'hecho', label: 'Hecho', icon: '✅' },
];

function taskFields(item = {}, clients = []) {
  return [
    { name: 'title', label: 'Tarea', value: item.title, required: true },
    {
      name: 'assignee', label: 'Responsable', type: 'select', value: item.assignee || '',
      options: [['', 'Sin asignar'], ...state.users.map((u) => [u, u])],
    },
    {
      name: 'status', label: 'Estado', type: 'select', value: item.status || 'por_hacer',
      options: TASK_COLS.map((c) => [c.key, c.label]),
    },
    { name: 'dueDate', label: 'Fecha límite', type: 'date', value: item.dueDate },
    {
      name: 'clientId', label: 'Cliente (opcional)', type: 'select', value: item.clientId || '',
      options: [['', '— Ninguno —'], ...clients.map((c) => [c.id, c.name])],
    },
    { name: 'notes', label: 'Notas', type: 'textarea', value: item.notes },
  ];
}

function taskBody(v) {
  return { ...v, dueDate: v.dueDate || null, clientId: v.clientId || null };
}

async function renderTasks() {
  const [tasks, clients] = await Promise.all([api('tasks'), api('clients')]);
  state.clients = clients;
  const nameOf = (cid) => clients.find((c) => c.id === cid)?.name || '';
  state.tasks = tasks;

  // Filtro por responsable.
  const people = [...new Set(tasks.map((t) => t.assignee).filter(Boolean))];
  $('#task-filters').innerHTML = `<button class="chip ${!state.taskAssignee ? 'active' : ''}" data-assignee="">Todas</button>`
    + people.map((p) => `<button class="chip ${state.taskAssignee === p ? 'active' : ''}" data-assignee="${esc(p)}">${esc(p)}</button>`).join('')
    + `<button class="chip ${state.taskAssignee === '__none__' ? 'active' : ''}" data-assignee="__none__">Sin asignar</button>`;
  $('#task-filters').querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => { state.taskAssignee = chip.dataset.assignee; renderTasks(); });
  });

  const visible = tasks.filter((t) => {
    if (!state.taskAssignee) return true;
    if (state.taskAssignee === '__none__') return !t.assignee;
    return t.assignee === state.taskAssignee;
  });

  const today = new Date().toISOString().slice(0, 10);
  const cardHtml = (t) => {
    const idx = TASK_COLS.findIndex((c) => c.key === t.status);
    const overdue = t.dueDate && t.status !== 'hecho' && t.dueDate < today;
    return `<div class="task-card" data-id="${esc(t.id)}">
      <div class="task-title">${esc(t.title)}</div>
      <div class="task-meta">
        ${t.assignee ? `<span class="task-who">👤 ${esc(t.assignee)}</span>` : '<span class="task-who none">Sin asignar</span>'}
        ${t.clientId ? `<span class="task-client">🙍 ${esc(nameOf(t.clientId))}</span>` : ''}
        ${t.dueDate ? `<span class="task-due ${overdue ? 'over' : ''}">📅 ${fmtDate(t.dueDate)}${overdue ? ' ¡vencida!' : ''}</span>` : ''}
      </div>
      ${t.notes ? `<div class="task-notes">${esc(t.notes)}</div>` : ''}
      <div class="task-actions">
        <button class="task-move" data-id="${esc(t.id)}" data-dir="-1" ${idx === 0 ? 'disabled' : ''} title="Mover a la izquierda">◀</button>
        <button class="task-edit" data-id="${esc(t.id)}" title="Editar">✏️</button>
        <button class="task-del" data-id="${esc(t.id)}" title="Eliminar">🗑️</button>
        <button class="task-move" data-id="${esc(t.id)}" data-dir="1" ${idx === TASK_COLS.length - 1 ? 'disabled' : ''} title="Mover a la derecha">▶</button>
      </div>
    </div>`;
  };

  $('#tasks-board').innerHTML = TASK_COLS.map((col) => {
    const items = visible.filter((t) => t.status === col.key);
    return `<div class="task-col" data-status="${col.key}">
      <div class="task-col-head">${col.icon} ${col.label} <span class="task-col-n">${items.length}</span></div>
      <div class="task-col-body">${items.map(cardHtml).join('') || '<p class="task-empty">—</p>'}</div>
    </div>`;
  }).join('');

  const board = $('#tasks-board');
  board.querySelectorAll('.task-move').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const t = tasks.find((x) => x.id === btn.dataset.id);
      const idx = TASK_COLS.findIndex((c) => c.key === t.status);
      const next = TASK_COLS[idx + Number(btn.dataset.dir)];
      if (!next) return;
      await api('tasks/' + t.id, { method: 'PUT', body: { status: next.key } });
      await renderTasks();
      updateTaskBadge();
    });
  });
  board.querySelectorAll('.task-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const t = tasks.find((x) => x.id === btn.dataset.id);
      openDialog('Editar tarea', taskFields(t, clients), async (v) => {
        await api('tasks/' + t.id, { method: 'PUT', body: taskBody(v) });
        await renderTasks();
        updateTaskBadge();
      });
    });
  });
  board.querySelectorAll('.task-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta tarea?')) return;
      await api('tasks/' + btn.dataset.id, { method: 'DELETE' });
      await renderTasks();
      updateTaskBadge();
    });
  });
}

$('#btn-new-task').addEventListener('click', async () => {
  const clients = await api('clients');
  openDialog('Nueva tarea', taskFields({}, clients), async (v) => {
    await api('tasks', { method: 'POST', body: taskBody(v) });
    await renderTasks();
    updateTaskBadge();
  });
});

// Insignia de la barra: tareas pendientes (por hacer + en curso).
async function updateTaskBadge() {
  try {
    const tasks = await api('tasks');
    const pending = tasks.filter((t) => t.status !== 'hecho').length;
    const b = $('#nav-tasks');
    if (pending) { b.textContent = pending; b.classList.remove('hidden'); } else b.classList.add('hidden');
  } catch { /* sin conexión */ }
}

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
// Informes de trámites
// ---------------------------------------------------------------------------

const state_report = { from: '', to: '' };

document.querySelectorAll('.report-filters [data-range]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const now = new Date();
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (btn.dataset.range === 'mes') {
      state_report.from = iso(new Date(now.getFullYear(), now.getMonth(), 1));
      state_report.to = iso(now);
    } else if (btn.dataset.range === 'anio') {
      state_report.from = iso(new Date(now.getFullYear(), 0, 1));
      state_report.to = iso(now);
    } else {
      state_report.from = '';
      state_report.to = '';
    }
    $('#rep-from').value = state_report.from;
    $('#rep-to').value = state_report.to;
    renderReports();
  });
});
$('#rep-from').addEventListener('change', () => { state_report.from = $('#rep-from').value; renderReports(); });
$('#rep-to').addEventListener('change', () => { state_report.to = $('#rep-to').value; renderReports(); });
$('#btn-export-report').addEventListener('click', () => {
  location.href = `/api/export/informe.csv?${reportQuery()}`;
});
function reportQuery() {
  const p = [];
  if (state_report.from) p.push('from=' + state_report.from);
  if (state_report.to) p.push('to=' + state_report.to);
  return p.join('&');
}

// Barras horizontales sencillas (etiqueta · barra · valor).
// «2026-07» → «jul 2026» para el eje del gráfico de ingresos por mes.
function monthLabel(m) {
  const [y, mo] = String(m).split('-');
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return `${meses[Number(mo) - 1] || mo} ${y}`;
}

function barList(entries, labelMap, fmt) {
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return entries.map(([k, v]) => `
    <div class="rep-bar-row">
      <span class="rep-bar-label">${esc(labelMap ? (labelMap[k] || k) : k)}</span>
      <span class="rep-bar-track"><span class="rep-bar-fill" style="width:${Math.round((v / max) * 100)}%"></span></span>
      <span class="rep-bar-val">${fmt ? fmt(v) : v}</span>
    </div>`).join('') || '<p class="chart-empty">Sin datos en este periodo.</p>';
}

async function renderReports() {
  const r = await api('reports?' + reportQuery());
  $('#rep-cards').innerHTML = `
    <div class="card"><div class="num">${r.total}</div><div class="lbl">Trámites en el periodo</div></div>
    <div class="card"><div class="num">${r.completados}</div><div class="lbl">Completados</div></div>
    <div class="card"><div class="num">${r.total ? Math.round(r.completados / r.total * 100) : 0}%</div><div class="lbl">Tasa de finalización</div></div>
    <div class="card"><div class="num">${Object.keys(r.byArea).length}</div><div class="lbl">Áreas con actividad</div></div>`;

  const areaEntries = Object.entries(r.byArea).sort((a, b) => b[1] - a[1]);
  $('#rep-chart-area').innerHTML = barList(areaEntries, TYPE_LABEL);
  const segEntries = Object.entries(r.bySegment).sort((a, b) => b[1] - a[1]);
  $('#rep-chart-seg').innerHTML = barList(segEntries, SEGMENT_LABEL);

  // Ingresos: facturado / cobrado / pendiente + facturación por área.
  const eur = (n) => (Number(n) || 0).toLocaleString('es-ES') + ' €';
  // Desglose de lo cobrado por forma de pago (solo las que tengan importe).
  const bm = r.cobradoByMethod || { caja: r.cobradoCaja || 0, banco: r.cobradoBanco || 0, sin: r.cobradoSinMetodo || 0 };
  const methodCards = ['caja', 'transferencia', 'tarjeta', 'banco']
    .filter((k) => bm[k])
    .map((k) => `<div class="card"><div class="num">${PAY_METHOD_META[k].icon} ${eur(bm[k])}</div><div class="lbl">Cobrado · ${esc(PAY_METHOD_META[k].label)}</div></div>`)
    .join('')
    + (bm.sin ? `<div class="card"><div class="num">${eur(bm.sin)}</div><div class="lbl">Cobrado sin forma indicada</div></div>` : '');
  $('#rep-income-cards').innerHTML = `
    <div class="card"><div class="num">${eur(r.facturado)}</div><div class="lbl">Facturado</div></div>
    <div class="card ${r.cobrado ? 'ok' : ''}"><div class="num">${eur(r.cobrado)}</div><div class="lbl">Cobrado</div></div>
    <div class="card ${r.pendiente ? 'warn' : ''}"><div class="num">${eur(r.pendiente)}</div><div class="lbl">Pendiente de cobro</div></div>
    ${methodCards}`;
  const incEntries = Object.entries(r.incomeByArea || {})
    .map(([k, v]) => [k, v.facturado])
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  $('#rep-chart-income').innerHTML = barList(incEntries, TYPE_LABEL, eur);

  // Tasas oficiales gestionadas (separadas de los honorarios).
  $('#rep-tax-cards').innerHTML = `
    <div class="card"><div class="num">${eur(r.taxFacturado)}</div><div class="lbl">Tasas gestionadas</div></div>
    <div class="card ${r.taxCobrado ? 'ok' : ''}"><div class="num">${eur(r.taxCobrado)}</div><div class="lbl">Tasas abonadas</div></div>
    <div class="card ${r.taxPendiente ? 'warn' : ''}"><div class="num">${eur(r.taxPendiente)}</div><div class="lbl">Tasas pendientes</div></div>`;

  // Ingresos cobrados por mes (últimos meses del periodo).
  const monthEntries = Object.entries(r.incomeByMonth || {})
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-12)
    .map(([m, v]) => [monthLabel(m), v.cobrado]);
  $('#rep-chart-month').innerHTML = monthEntries.some(([, v]) => v > 0)
    ? barList(monthEntries, null, eur)
    : '<p class="hint">Todavía no hay cobros registrados en este periodo.</p>';

  $('#rep-table').innerHTML = r.byTitle.length ? `
    <table class="rep-table">
      <thead><tr><th>Área</th><th>Trámite</th><th class="num">Total</th><th class="num">Completados</th></tr></thead>
      <tbody>${r.byTitle.map((t) => `
        <tr><td>${esc(TYPE_LABEL[t.type] || t.type)}</td><td>${esc(t.title)}</td>
        <td class="num">${t.count}</td><td class="num">${t.completados}</td></tr>`).join('')}</tbody>
    </table>` : '<p class="hint">No hay expedientes en este periodo.</p>';

  await renderPerformance();
}

// Panel de rendimiento por usuario (José vs Carmen). Reutiliza el rango de
// fechas de los informes. Solo tiene sentido con varios usuarios.
async function renderPerformance() {
  const box = $('#rep-performance');
  if (!box) return;
  let p;
  try { p = await api('performance?' + reportQuery()); }
  catch { box.innerHTML = '<p class="hint">No se pudo cargar el rendimiento.</p>'; return; }
  const eur = (n) => (Number(n) || 0).toLocaleString('es-ES') + ' €';
  const resp = (m) => (m == null ? '—' : m < 60 ? `${m} min` : `${Math.round(m / 60 * 10) / 10} h`);
  if (!p.isolation) {
    box.innerHTML = '<p class="hint">Con un solo usuario no hay reparto que mostrar. Cuando cada compañero (p. ej. José y Carmen) entre con su propio usuario y sus clientes queden a su nombre, aquí verás las métricas de cada uno.</p>';
    return;
  }
  if (!p.users.length) { box.innerHTML = '<p class="hint">Todavía no hay actividad atribuida a ningún usuario en este periodo.</p>'; return; }
  box.innerHTML = `
    <table class="rep-table perf-table">
      <thead><tr>
        <th>Usuario</th>
        <th class="num">Trámites</th>
        <th class="num">Completados</th>
        <th class="num">Cobrado</th>
        <th class="num">Pendiente</th>
        <th class="num">Clientes nuevos</th>
        <th class="num">Conversaciones</th>
        <th class="num">WhatsApp enviados</th>
        <th class="num">Resp. media</th>
      </tr></thead>
      <tbody>${p.users.map((u) => `
        <tr>
          <td><strong>${esc(u.user)}</strong></td>
          <td class="num">${u.tramitesTotal}</td>
          <td class="num">${u.tramitesCompletados}</td>
          <td class="num">${eur(u.cobrado)}</td>
          <td class="num ${u.pendiente ? 'warn-txt' : ''}">${eur(u.pendiente)}</td>
          <td class="num">${u.clientesNuevos}</td>
          <td class="num">${u.conversaciones}</td>
          <td class="num">${u.mensajesEnviados}</td>
          <td class="num">${resp(u.avgResponseMinutes)}</td>
        </tr>`).join('')}</tbody>
    </table>
    <p class="hint">Atribución por el dueño de cada cliente. «Cobrado» y «Pendiente» son honorarios de expedientes creados en el periodo. «Resp. media» es el tiempo medio hasta la primera respuesta a un mensaje entrante.</p>`;
}

// ---------------------------------------------------------------------------
// Por cobrar: honorarios y tasas pendientes por cliente
// ---------------------------------------------------------------------------

async function renderReceivables() {
  const r = await api('receivables');
  const eur = (n) => (Number(n) || 0).toLocaleString('es-ES') + ' €';
  $('#cobros-cards').innerHTML = `
    <div class="card ${r.total ? 'warn' : ''}"><div class="num">${eur(r.total)}</div><div class="lbl">Total por cobrar</div></div>
    <div class="card"><div class="num">${eur(r.totalHonorarios)}</div><div class="lbl">Honorarios pendientes</div></div>
    <div class="card"><div class="num">${eur(r.totalTasas)}</div><div class="lbl">Tasas pendientes</div></div>
    <div class="card"><div class="num">${r.clients.length}</div><div class="lbl">Clientes con saldo</div></div>`;

  $('#cobros-list').innerHTML = r.clients.length ? r.clients.map((e) => {
    const items = e.items.map((it) => {
      const parts = [];
      if (it.fee) parts.push(`honorarios ${eur(it.fee)}`);
      if (it.tax) parts.push(`tasa ${eur(it.tax)}${it.taxModel ? ' · ' + esc(it.taxModel) : ''}`);
      return `<li>${esc(it.title)} — ${parts.join(' + ')}</li>`;
    }).join('');
    const ageCls = e.days >= 30 ? 'over' : '';
    return `<div class="cobro-row" data-id="${esc(e.clientId)}">
      <div class="cobro-main">
        <div class="cobro-top">
          <span class="cobro-name">${esc(e.name)}</span>
          <span class="cobro-total">${eur(e.total)}</span>
        </div>
        <ul class="cobro-items">${items}</ul>
        <div class="cobro-age ${ageCls}">⏳ pendiente desde hace ${e.days} día${e.days === 1 ? '' : 's'}</div>
      </div>
      <div class="cobro-actions">
        <button class="btn small cobro-remind" data-id="${esc(e.clientId)}" title="Enviar recordatorio de pago por WhatsApp">💬 Reclamar</button>
        <button class="btn small primary cobro-collect" data-id="${esc(e.clientId)}" title="Registrar el cobro (caja o banco)">💵 Registrar cobro</button>
      </div>
    </div>`;
  }).join('') : '<div class="today-clear">✨ No hay nada pendiente de cobro. ¡Todo al día!</div>';

  $('#cobros-list').querySelectorAll('.cobro-remind').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const e = r.clients.find((x) => x.clientId === btn.dataset.id);
      if (!confirm(`¿Enviar a ${e.name} un recordatorio de ${eur(e.total)} pendientes por WhatsApp?`)) return;
      btn.disabled = true; btn.textContent = '⏳…';
      try {
        await api('receivables/remind', { method: 'POST', body: { clientId: btn.dataset.id } });
        alert('Recordatorio enviado ✅');
      } catch (err) {
        alert(err.message);
      }
      await renderReceivables();
    });
  });
  $('#cobros-list').querySelectorAll('.cobro-collect').forEach((btn) => {
    btn.addEventListener('click', () => {
      const e = r.clients.find((x) => x.clientId === btn.dataset.id);
      const fields = [{
        name: 'payMethod', label: 'Forma de cobro', type: 'select', value: 'caja',
        options: PAY_METHOD_OPTIONS,
      }];
      if (e.tasas > 0) fields.push({
        name: 'includeTax', label: `¿Incluir también las tasas pendientes (${eur(e.tasas)})?`, type: 'select', value: 'no',
        options: [['no', 'No, solo los honorarios'], ['si', 'Sí, marcar tasas como abonadas']],
      });
      openDialog(`Registrar cobro · ${e.name}`, fields, async (v) => {
        const rr = await api('receivables/collect', {
          method: 'POST',
          body: { clientId: e.clientId, payMethod: v.payMethod, includeTax: v.includeTax === 'si' },
        });
        await renderReceivables();
        if (state.view === 'cases') await renderCases();
        const mName = (PAY_METHOD_META[v.payMethod] || { label: v.payMethod }).label.toLowerCase();
        alert(`Cobro registrado: ${eur(rr.honorarios)} en ${mName}${rr.tasas ? ' + ' + eur(rr.tasas) + ' en tasas' : ''} ✅`);
      });
    });
  });
}

// Insignia de la barra: importe total por cobrar (nº de clientes con saldo).
async function updateCobrosBadge() {
  try {
    const r = await api('receivables');
    const b = $('#nav-cobros');
    if (r.clients.length) { b.textContent = r.clients.length; b.classList.remove('hidden'); } else b.classList.add('hidden');
  } catch { /* sin conexión */ }
}

$('#btn-cobros-refresh').addEventListener('click', renderReceivables);

// ---------------------------------------------------------------------------
// Agenda de vencimientos (expedientes + citas + recordatorios)
// ---------------------------------------------------------------------------

async function renderAgenda() {
  const [cases, appts, reminders, clients] = await Promise.all([
    api('cases'), api('appointments'), api('reminders'), api('clients'),
  ]);
  const nameOf = (id) => clients.find((c) => c.id === id)?.name || '';

  // Unificamos todo lo que tiene fecha en una sola lista de eventos.
  const events = [];
  for (const c of cases) {
    if (c.dueDate && c.status !== 'completado') {
      events.push({ date: c.dueDate, kind: 'case', icon: '📁', label: 'Expediente',
        title: c.title, who: nameOf(c.clientId), view: 'cases' });
    }
    if (c.expiryDate) {
      events.push({ date: c.expiryDate, kind: 'expiry', icon: '🔄', label: 'Caducidad / renovación',
        title: c.title, who: nameOf(c.clientId), view: 'cases' });
    }
  }
  const today = todayIso();
  for (const a of appts) {
    if (a.status === 'cancelada' || a.date < today) continue;
    events.push({ date: a.date, time: a.time, kind: 'appt', icon: '📆', label: 'Cita',
      title: (a.reason || 'Consulta') + (a.time ? ` · ${a.time}` : ''), who: nameOf(a.clientId), view: 'appointments' });
  }
  for (const r of reminders) {
    if (r.done || !r.dueDate) continue;
    events.push({ date: r.dueDate, kind: 'reminder', icon: '⏰', label: 'Recordatorio',
      title: r.text, who: nameOf(r.clientId), view: 'reminders' });
  }

  events.sort((a, b) => String(a.date).localeCompare(String(b.date))
    || String(a.time || '').localeCompare(String(b.time || '')));

  // Buckets: vencidos, hoy, próximos 7 días, más adelante.
  const now = new Date(today + 'T00:00');
  const in7 = new Date(now); in7.setDate(in7.getDate() + 7);
  const bucketOf = (iso) => {
    const d = new Date(iso + 'T00:00');
    if (d < now) return 'vencidos';
    if (iso === today) return 'hoy';
    if (d < in7) return 'semana';
    return 'despues';
  };
  const groups = { vencidos: [], hoy: [], semana: [], despues: [] };
  for (const e of events) groups[bucketOf(e.date)].push(e);

  $('#agenda-cards').innerHTML = `
    <div class="card ${groups.vencidos.length ? 'alert' : ''}"><div class="num">${groups.vencidos.length}</div><div class="lbl">Vencidos</div></div>
    <div class="card ${groups.hoy.length ? 'warn' : ''}"><div class="num">${groups.hoy.length}</div><div class="lbl">Para hoy</div></div>
    <div class="card"><div class="num">${groups.semana.length}</div><div class="lbl">Próximos 7 días</div></div>
    <div class="card"><div class="num">${events.length}</div><div class="lbl">Total pendiente</div></div>`;

  const badge = $('#nav-agenda');
  const urgent = groups.vencidos.length + groups.hoy.length;
  if (urgent) { badge.textContent = urgent; badge.classList.remove('hidden'); }
  else badge.classList.add('hidden');

  const row = (e) => `
    <div class="row agenda-row" data-view="${esc(e.view)}">
      <span class="agenda-ico" title="${esc(e.label)}">${e.icon}</span>
      <div class="grow">
        <div class="title">${esc(e.title)}</div>
        <div class="sub">${esc(e.label)}${e.who ? ' · 👤 ' + esc(e.who) : ''}</div>
      </div>
      <div class="meta"><div>📅 ${fmtDate(e.date)}</div></div>
    </div>`;

  const section = (key, label, cls) => groups[key].length ? `
    <div class="agenda-group ${cls}">
      <div class="agenda-head">${label} <span class="block-count">${groups[key].length}</span></div>
      <div class="list">${groups[key].map(row).join('')}</div>
    </div>` : '';

  $('#agenda-list').innerHTML =
    section('vencidos', '⚠️ Vencidos', 'g-alert')
    + section('hoy', 'Hoy', 'g-warn')
    + section('semana', 'Próximos 7 días', '')
    + section('despues', 'Más adelante', '')
    || '<p class="hint">No hay vencimientos pendientes. 🎉</p>';

  $('#agenda-list').querySelectorAll('.agenda-row').forEach((r) => {
    r.addEventListener('click', () => showView(r.dataset.view));
  });
}

// ---------------------------------------------------------------------------
// Fichas de trámite
// ---------------------------------------------------------------------------

function fichaFields(f = {}) {
  return [
    { name: 'title', label: 'Trámite (ej. «Arraigo social»)', value: f.title, required: true },
    {
      name: 'area', label: 'Área', type: 'select', value: f.area || 'otro',
      options: Object.entries(TYPE_LABEL),
    },
    { name: 'intro', label: 'Mensaje de introducción (usa {nombre} y {tramite})', type: 'textarea',
      value: f.intro !== undefined ? f.intro : 'Hola {nombre} 👋 Para tramitar «{tramite}» necesitamos la siguiente documentación:' },
    { name: 'docs', label: 'Documentación necesaria (una línea por documento)', type: 'textarea', value: f.docs },
    { name: 'notes', label: 'Nota final (opcional)', type: 'textarea', value: f.notes },
  ];
}

async function renderFichas() {
  const fichas = await api('fichas');
  const byArea = {};
  for (const f of fichas) (byArea[f.area] = byArea[f.area] || []).push(f);
  const order = Object.keys(TYPE_LABEL).filter((a) => byArea[a]);
  $('#ficha-list').innerHTML = order.map((area) => `
    <div class="case-block">
      <div class="block-head"><span class="block-title">${esc(TYPE_LABEL[area] || area)}</span><span class="block-count">${byArea[area].length}</span></div>
      <div class="list">${byArea[area].map((f) => `
        <div class="row ficha-row" data-id="${esc(f.id)}">
          <div class="grow">
            <div class="title">${esc(f.title)}</div>
            <div class="sub">${esc((f.docs || '').split('\n').filter(Boolean).length)} documentos</div>
          </div>
          <button class="btn small danger ficha-del" data-id="${esc(f.id)}">Eliminar</button>
        </div>`).join('')}</div>
    </div>`).join('') || '<p class="hint">No hay listas todavía. Crea la primera con «＋ Nueva lista».</p>';

  $('#ficha-list').querySelectorAll('.ficha-row').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.ficha-del')) return;
      const f = fichas.find((x) => x.id === row.dataset.id);
      openDialog('Editar lista de documentos', fichaFields(f), async (v) => {
        await api('fichas/' + f.id, { method: 'PUT', body: v });
        await renderFichas();
      });
    });
  });
  $('#ficha-list').querySelectorAll('.ficha-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta ficha?')) return;
      await api('fichas/' + btn.dataset.id, { method: 'DELETE' });
      await renderFichas();
    });
  });
}

$('#btn-new-ficha').addEventListener('click', () => {
  openDialog('Nueva lista de documentos a pedir', fichaFields(), async (v) => {
    await api('fichas', { method: 'POST', body: v });
    await renderFichas();
  });
});

// ---------------------------------------------------------------------------
// Base de conocimiento: tarifas, tasas y documentos por trámite
// ---------------------------------------------------------------------------

// Búsqueda tolerante a acentos y mayúsculas.
function fold(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function kbMatch(item, q) {
  if (!q) return true;
  const hay = fold(`${item.title} ${item.keywords} ${TYPE_LABEL[item.area] || item.area} ${item.fee} ${item.docs}`);
  return fold(q).split(/\s+/).every((w) => hay.includes(w));
}

function kbFields(item = {}) {
  return [
    { name: 'title', label: 'Trámite', value: item.title, required: true },
    {
      name: 'area', label: 'Área', type: 'select', value: item.area || 'extranjeria',
      options: Object.entries(TYPE_LABEL),
    },
    { name: 'fee', label: 'Honorarios de gestión (ej. «300 €», «desde 150 €»)', value: item.fee || '' },
    { name: 'tax', label: 'Tasas oficiales orientativas', type: 'textarea', value: item.tax || '' },
    { name: 'docs', label: 'Documentos necesarios (una línea por documento)', type: 'textarea', value: item.docs || '' },
    { name: 'keywords', label: 'Palabras clave para el buscador (sinónimos)', value: item.keywords || '' },
    { name: 'notes', label: 'Nota interna / aclaración', type: 'textarea', value: item.notes || '' },
  ];
}

async function renderKnowledge() {
  const items = await api('knowledge');
  state.knowledge = items;
  const q = ($('#kb-search').value || '').trim();
  const filtered = items.filter((k) => kbMatch(k, q));
  const byArea = {};
  for (const k of filtered) (byArea[k.area] = byArea[k.area] || []).push(k);
  const order = Object.keys(TYPE_LABEL).filter((a) => byArea[a]);
  $('#kb-list').innerHTML = order.map((area) => `
    <div class="case-block">
      <div class="block-head"><span class="block-title">${esc(TYPE_LABEL[area] || area)}</span><span class="block-count">${byArea[area].length}</span></div>
      <div class="list">${byArea[area].map(kbCardHtml).join('')}</div>
    </div>`).join('')
    || (q ? '<p class="hint">Ningún trámite coincide con la búsqueda.</p>'
          : '<p class="hint">No hay tarifas todavía. Crea la primera con «＋ Nueva tarifa».</p>');

  $('#kb-list').querySelectorAll('.kb-row').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.kb-del')) return;
      const k = items.find((x) => x.id === row.dataset.id);
      openDialog('Editar tarifa', kbFields(k), async (v) => {
        await api('knowledge/' + k.id, { method: 'PUT', body: v });
        await renderKnowledge();
      });
    });
  });
  $('#kb-list').querySelectorAll('.kb-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este trámite de la base de conocimiento?')) return;
      await api('knowledge/' + btn.dataset.id, { method: 'DELETE' });
      await renderKnowledge();
    });
  });
}

function kbCardHtml(k) {
  const docsN = (k.docs || '').split('\n').filter((l) => l.trim()).length;
  return `<div class="row kb-row" data-id="${esc(k.id)}">
    <div class="grow">
      <div class="title">${esc(k.title)}</div>
      <div class="sub">
        ${k.fee ? `<span class="fee-badge paid">💶 ${esc(k.fee)}</span>` : ''}
        ${k.tax ? '<span class="tax-badge due">🏛️ tasas</span>' : ''}
        ${docsN ? `<span class="chk-badge">📄 ${docsN} doc.</span>` : ''}
      </div>
    </div>
    <button class="btn small danger kb-del" data-id="${esc(k.id)}">Eliminar</button>
  </div>`;
}

$('#kb-search').addEventListener('input', () => { if (state.view === 'knowledge') renderKnowledge(); });
$('#btn-new-kb').addEventListener('click', () => {
  openDialog('Nueva tarifa', kbFields(), async (v) => {
    await api('knowledge', { method: 'POST', body: v });
    await renderKnowledge();
  });
});

// Construye el texto listo para enviar al cliente a partir de un trámite.
function buildKbInsert(k, firstName) {
  const hi = firstName ? `Hola ${firstName} 👋 ` : '';
  const lines = [`${hi}Para «${k.title}»:`, ''];
  if (k.fee) lines.push(`💶 Honorarios de gestión: ${k.fee}`);
  if (k.tax) lines.push(`🏛️ Tasas oficiales (orientativas): ${k.tax}`);
  if (k.docs && k.docs.trim()) {
    lines.push('', '📄 Documentación necesaria:', k.docs.trim());
  }
  lines.push('', 'A los honorarios se añaden las tasas oficiales. José te confirma el total según tu caso. 📲');
  return lines.join('\n');
}

// Panel de búsqueda de trámites en el chat (botón 📖) → inserta la respuesta.
let kbLoaded = false;
async function ensureKbLoaded() {
  if (kbLoaded) return;
  state.knowledge = await api('knowledge');
  kbLoaded = true;
}
function renderKbPanel(q) {
  const panel = $('#kb-panel');
  const items = (state.knowledge || []).filter((k) => kbMatch(k, q)).slice(0, 8);
  panel.innerHTML = `
    <input type="text" class="kb-panel-search" placeholder="🔎 Buscar trámite…" value="${esc(q)}">
    <div class="kb-panel-list">${items.map((k) => `
      <button type="button" class="kb-pick" data-id="${esc(k.id)}">
        <span class="kb-pick-title">${esc(k.title)}</span>
        <span class="kb-pick-meta">${esc(TYPE_LABEL[k.area] || k.area)}${k.fee ? ' · ' + esc(k.fee) : ''}</span>
      </button>`).join('') || '<p class="hint" style="margin:8px">Sin resultados.</p>'}</div>`;
  const search = panel.querySelector('.kb-panel-search');
  search.addEventListener('input', () => renderKbPanel(search.value));
  // Mantiene el foco en el buscador tras redibujar.
  search.focus();
  search.setSelectionRange(search.value.length, search.value.length);
  panel.querySelectorAll('.kb-pick').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const k = (state.knowledge || []).find((x) => x.id === btn.dataset.id);
      if (!k) return;
      let first = '';
      if (state.activeClient) first = (state.activeClient.name || '').split(' ')[0];
      const input = $('#chat-input');
      const text = buildKbInsert(k, first);
      input.value = input.value.trim() ? input.value.trim() + '\n\n' + text : text;
      panel.classList.add('hidden');
      input.focus();
    });
  });
}
$('#btn-kb').addEventListener('click', async (e) => {
  e.stopPropagation();
  const panel = $('#kb-panel');
  const willOpen = panel.classList.contains('hidden');
  closePanels('kb');
  if (!willOpen) { panel.classList.add('hidden'); return; }
  await ensureKbLoaded();
  panel.classList.remove('hidden');
  renderKbPanel('');
});

// ---------------------------------------------------------------------------
// Formularios (JotForm embebidos)
// ---------------------------------------------------------------------------

async function renderForms() {
  const forms = await api('forms');
  const tabs = $('#forms-tabs');
  const frame = $('#forms-frame');
  if (!forms.length) {
    tabs.innerHTML = '';
    frame.innerHTML = `<div class="forms-empty">
      <p>Aún no has añadido ningún formulario.</p>
      <p class="hint">Pulsa «＋ Añadir formulario» y pega el enlace de tu formulario de JotForm o de su tabla de respuestas.</p>
    </div>`;
    return;
  }
  if (!state.activeFormId || !forms.some((f) => f.id === state.activeFormId)) {
    state.activeFormId = forms[0].id;
  }
  tabs.innerHTML = forms.map((f) => `
    <button class="form-tab ${f.id === state.activeFormId ? 'active' : ''}" data-id="${esc(f.id)}">
      <span>${esc(f.name)}</span>
      <span class="form-tab-actions">
        <span class="form-edit" data-id="${esc(f.id)}" title="Editar">✎</span>
        <span class="form-del" data-id="${esc(f.id)}" title="Quitar">✕</span>
      </span>
    </button>`).join('');
  const active = forms.find((f) => f.id === state.activeFormId);
  // Enlace de solo lectura embebido; sandbox permisivo para que JotForm funcione.
  frame.innerHTML = `<iframe src="${esc(active.url)}" title="${esc(active.name)}"
    sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox"
    referrerpolicy="no-referrer"></iframe>
    <a class="btn small form-open" href="${esc(active.url)}" target="_blank" rel="noopener">Abrir en JotForm ↗</a>`;

  tabs.querySelectorAll('.form-tab').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      if (e.target.closest('.form-del') || e.target.closest('.form-edit')) return;
      state.activeFormId = btn.dataset.id;
      renderForms();
    });
  });
  tabs.querySelectorAll('.form-edit').forEach((el) => {
    el.addEventListener('click', (e) => { e.stopPropagation(); editForm(forms.find((f) => f.id === el.dataset.id)); });
  });
  tabs.querySelectorAll('.form-del').forEach((el) => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('¿Quitar este formulario del CRM? (no se borra de JotForm)')) return;
      await api('forms/' + el.dataset.id, { method: 'DELETE' });
      if (state.activeFormId === el.dataset.id) state.activeFormId = null;
      await renderForms();
    });
  });
}

const formFields = (f = {}) => [
  { name: 'name', label: 'Nombre (ej. «Datos para arraigo»)', value: f.name, required: true },
  { name: 'url', label: 'Enlace de JotForm (del formulario o de su tabla de respuestas)', value: f.url, required: true },
];

function editForm(f) {
  openDialog('Editar formulario', formFields(f), async (v) => {
    await api('forms/' + f.id, { method: 'PUT', body: v });
    await renderForms();
  });
}

$('#btn-new-form').addEventListener('click', () => {
  openDialog('Añadir formulario', formFields(), async (v) => {
    const created = await api('forms', { method: 'POST', body: v });
    state.activeFormId = created.id;
    await renderForms();
  });
});

// Enviar una ficha al cliente desde el chat.
let fichasCache = null;
$('#btn-ficha-send').addEventListener('click', async (e) => {
  e.stopPropagation();
  const p = $('#ficha-panel');
  const willShow = p.classList.contains('hidden');
  closePanels();
  p.classList.toggle('hidden');
  if (!willShow) return;
  if (!fichasCache) fichasCache = await api('fichas');
  p.innerHTML = fichasCache.length ? fichasCache.map((f) =>
    `<button type="button" class="ficha-pick" data-id="${esc(f.id)}">
       <b>${esc(f.title)}</b><span>${esc(TYPE_LABEL[f.area] || f.area)} · ${esc((f.docs || '').split('\n').filter(Boolean).length)} docs</span>
     </button>`).join('')
    : '<p class="hint">No hay listas de documentos. Créalas en «Documentos a pedir».</p>';
  p.querySelectorAll('.ficha-pick').forEach((btn) => {
    btn.addEventListener('click', () => sendFicha(btn.dataset.id));
  });
});
async function sendFicha(fichaId) {
  if (!state.activeClientId) return;
  $('#ficha-panel').classList.add('hidden');
  try {
    await api('messages', { method: 'POST', body: { clientId: state.activeClientId, fichaId } });
    await openConversation(state.activeClientId);
  } catch (err) {
    alert(err.message);
  }
}

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
        <div class="sub">${nameOf(r.clientId) ? '👤 ' + esc(nameOf(r.clientId)) + ' · ' : ''}📅 <span style="${overdue ? 'color:var(--danger);font-weight:700' : ''}">${fmtDate(r.dueDate)}</span>${r.sendToClient ? (r.sentToClientAt ? ' · 📨 enviado al cliente' : ' · 📨 se enviará al cliente') : ''}</div>
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
    {
      name: 'sendToClient', label: 'Enviar por WhatsApp al cliente ese día', type: 'select',
      value: 'no', options: [['no', 'No, es solo para mí'], ['si', 'Sí, enviárselo al cliente']],
    },
  ], async (v) => {
    if (!v.clientId) v.clientId = null;
    v.sendToClient = v.sendToClient === 'si';
    await api('reminders', { method: 'POST', body: v });
    await renderReminders();
  });
});

// ---------------------------------------------------------------------------
// Citas
// ---------------------------------------------------------------------------

document.querySelectorAll('#appt-filters .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#appt-filters .chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    state.apptFilter = chip.dataset.appt;
    renderAppointments();
  });
});

function todayIso() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

// --- Calendario de Outlook (lectura del calendario compartido) ---
function calDayLabel(iso) {
  const d = new Date(iso);
  const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const t = new Date(); const tk = t.toDateString() === d.toDateString();
  const tm = new Date(t); tm.setDate(tm.getDate() + 1);
  const isTom = tm.toDateString() === d.toDateString();
  const base = `${dias[d.getDay()]} ${d.getDate()} ${meses[d.getMonth()]}`;
  return tk ? `Hoy · ${base}` : isTom ? `Mañana · ${base}` : base;
}
function calHM(dt) {
  if (!dt) return '';
  // dt viene como "2026-07-28T10:00:00.0000000" (hora de Madrid).
  const m = /T(\d{2}):(\d{2})/.exec(dt);
  return m ? `${m[1]}:${m[2]}` : '';
}

async function renderCalendar() {
  const days = state.calDays || 14;
  const content = $('#cal-content');
  content.innerHTML = '<p class="hint">Cargando el calendario de Outlook…</p>';
  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const from = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const t = new Date(now); t.setDate(t.getDate() + days);
  const to = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  let data;
  try {
    data = await api(`outlook-calendar?from=${from}&to=${to}`);
  } catch (err) {
    content.innerHTML = `<p class="hint">No se pudo cargar el calendario: ${esc(err.message)}</p>`;
    return;
  }
  $('#cal-sub').textContent = data.calendarName
    ? `Calendario «${data.calendarName}»${data.user ? ' · ' + data.user : ''} — incluye lo creado directamente en Outlook, no solo las citas del CRM.`
    : 'Eventos del calendario de Outlook configurado.';
  if (!data.configured) {
    content.innerHTML = '<div class="empty-card">📅 Microsoft 365 no está conectado todavía. Actívalo en <b>Automatizaciones → Microsoft 365</b> para ver aquí tu calendario de Outlook.</div>';
    return;
  }
  if (data.error) {
    content.innerHTML = `<div class="empty-card">⚠️ No se pudo leer el calendario: ${esc(data.error)}<br><span class="hint">Comprueba el permiso Calendars.Read y el nombre del calendario en Automatizaciones.</span></div>`;
    return;
  }
  const events = data.events || [];
  if (!events.length) {
    content.innerHTML = '<div class="today-clear">📅 No hay eventos en el calendario para este periodo.</div>';
    return;
  }
  // Agrupa por día (fecha local del inicio).
  const byDay = new Map();
  for (const e of events) {
    const day = (e.start || '').slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(e);
  }
  content.innerHTML = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, items]) => `
    <div class="cal-day">
      <div class="cal-day-head">${esc(calDayLabel(day))}</div>
      ${items.map((e) => {
        const time = e.isAllDay ? 'Todo el día' : `${calHM(e.start)}${e.end ? '–' + calHM(e.end) : ''}`;
        const isCrm = (e.categories || []).includes('CRM WhatsApp');
        return `<div class="cal-ev">
          <span class="cal-ev-time">${esc(time)}</span>
          <div class="cal-ev-body">
            <div class="cal-ev-subj">${isCrm ? '📲 ' : ''}${esc(e.subject)}</div>
            ${(e.location || e.organizer) ? `<div class="cal-ev-meta">${e.location ? '📍 ' + esc(e.location) : ''}${e.location && e.organizer ? ' · ' : ''}${e.organizer ? '👤 ' + esc(e.organizer) : ''}</div>` : ''}
          </div>
          ${e.webLink ? `<a class="btn small" href="${esc(e.webLink)}" target="_blank" title="Abrir en Outlook">Abrir</a>` : ''}
        </div>`;
      }).join('')}
    </div>`).join('');
}

$('#btn-cal-refresh').addEventListener('click', renderCalendar);
document.querySelectorAll('#cal-range .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#cal-range .chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    state.calDays = Number(chip.dataset.cal);
    renderCalendar();
  });
});

async function renderAppointments() {
  const [appts, clients] = await Promise.all([api('appointments'), api('clients')]);
  state.clients = clients;
  const nameOf = (id) => clients.find((c) => c.id === id)?.name || '(cliente eliminado)';
  const today = todayIso();
  let list = appts;
  if (state.apptFilter === 'proximas') list = list.filter((a) => a.status === 'activa' && a.date >= today);
  if (state.apptFilter === 'pasadas') list = list.filter((a) => a.status !== 'cancelada' && a.date < today);
  if (state.apptFilter === 'canceladas') list = list.filter((a) => a.status === 'cancelada');

  const byDay = new Map();
  for (const a of list) {
    const l = byDay.get(a.date) || [];
    l.push(a);
    byDay.set(a.date, l);
  }
  const dayTitle = (iso) => {
    const d = new Date(iso + 'T12:00');
    let label = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
    label = label.charAt(0).toUpperCase() + label.slice(1);
    return iso === today ? `Hoy · ${label}` : label;
  };
  $('#appt-list').innerHTML = [...byDay.entries()].map(([day, items]) => `
    <div class="appt-day">${esc(dayTitle(day))}</div>
    <div class="list">${items.map((a) => `
      <div class="row appt-row" data-id="${esc(a.id)}">
        <span class="appt-time">${esc(a.time)}</span>
        <div class="grow">
          <div class="title">${esc(nameOf(a.clientId))}</div>
          <div class="sub">${esc(a.reason || 'consulta')}${a.confirmationSentAt ? ' · ✓ confirmación enviada' : ''}${a.remindedAt ? ' · ✓ recordada' : ''}${a.msEventId ? ' · 📆 en Outlook' : ''}</div>
        </div>
        ${a.status === 'cancelada' ? '<span class="status pendiente">Cancelada</span>' : ''}
      </div>`).join('')}
    </div>`).join('') || '<p class="hint">No hay citas en esta vista.</p>';

  $('#appt-list').querySelectorAll('.appt-row').forEach((row) => {
    row.addEventListener('click', () => {
      const a = appts.find((x) => x.id === row.dataset.id);
      openDialog('Editar cita', apptFields(a, clients, true), async (v) => {
        await api('appointments/' + a.id, { method: 'PUT', body: v });
        await renderAppointments();
      });
    });
  });
}

function apptFields(a = {}, clients = [], withStatus = false) {
  const fields = [
    {
      name: 'clientId', label: 'Cliente', type: 'select', value: a.clientId,
      options: clients.map((c) => [c.id, c.name]),
    },
    { name: 'date', label: 'Fecha', type: 'date', value: a.date || todayIso(), required: true },
    { name: 'time', label: 'Hora', type: 'time', value: a.time || '10:00', required: true },
    { name: 'reason', label: 'Motivo (ej. «Firma declaración renta»)', value: a.reason },
    { name: 'notes', label: 'Notas internas', type: 'textarea', value: a.notes },
  ];
  if (withStatus) {
    fields.push({
      name: 'status', label: 'Estado', type: 'select', value: a.status || 'activa',
      options: [['activa', 'Activa'], ['completada', 'Completada'], ['cancelada', 'Cancelada']],
    });
  }
  return fields;
}

$('#btn-new-appt').addEventListener('click', async () => {
  const clients = await api('clients');
  if (!clients.length) return alert('Primero crea al menos un cliente.');
  openDialog('Nueva cita', apptFields({}, clients), async (v) => {
    await api('appointments', { method: 'POST', body: v });
    await renderAppointments();
  });
});

// ---------------------------------------------------------------------------
// Campañas por etiqueta
// ---------------------------------------------------------------------------

async function renderCampaigns() {
  const [clients, campaigns] = await Promise.all([api('clients'), api('campaigns')]);
  const tagCounts = new Map();
  for (const c of clients) {
    for (const t of c.tags || []) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
  }
  const sel = $('#camp-tag');
  const current = sel.value;
  sel.innerHTML = [...tagCounts.keys()].sort()
    .map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('')
    || '<option value="">(no hay etiquetas)</option>';
  if (current && tagCounts.has(current)) sel.value = current;
  updateCampCount(tagCounts);
  sel.onchange = () => updateCampCount(tagCounts);

  $('#camp-list').innerHTML = campaigns.map((c) => `
    <div class="row" style="cursor:default">
      <div class="grow">
        <div class="title"><span class="tag">${esc(c.tag)}</span> ${esc(c.text)}</div>
        <div class="sub">${new Date(c.sentAt).toLocaleString('es-ES')} · ${c.total} destinatarios · ${c.ok} enviados${c.errors ? ` · <span style="color:var(--danger)">${c.errors} errores</span>` : ''}</div>
      </div>
    </div>`).join('') || '<p class="hint">Todavía no has enviado ninguna campaña.</p>';
}

function updateCampCount(tagCounts) {
  const n = tagCounts.get($('#camp-tag').value) || 0;
  $('#camp-count').textContent = n
    ? (n === 1 ? '1 cliente recibirá el mensaje' : `${n} clientes recibirán el mensaje`)
    : '';
}

$('#btn-camp-send').addEventListener('click', async () => {
  const tag = $('#camp-tag').value;
  const text = $('#camp-text').value.trim();
  if (!tag || !text) return alert('Elige una etiqueta y escribe el mensaje.');
  if (!confirm(`Se enviará este mensaje a todos los clientes con la etiqueta «${tag}». ¿Continuar?`)) return;
  const btn = $('#btn-camp-send');
  btn.disabled = true;
  btn.textContent = '⏳ Enviando…';
  try {
    const result = await api('campaigns', { method: 'POST', body: { tag, text } });
    $('#camp-text').value = '';
    alert(`Campaña enviada: ${result.ok} de ${result.total} mensajes correctos${result.errors ? `, ${result.errors} con error` : ''}.`);
    await renderCampaigns();
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '📣 Enviar campaña';
  }
});

// ---------------------------------------------------------------------------
// Automatizaciones
// ---------------------------------------------------------------------------

const DAY_NAMES = ['D', 'L', 'M', 'X', 'J', 'V', 'S']; // getDay(): 0=domingo

async function renderAutomations() {
  const s = await api('automations');
  const daysWrap = $('#auto-days');
  daysWrap.innerHTML = [1, 2, 3, 4, 5, 6, 0].map((d) =>
    `<span class="day-chip ${s.businessHours.days.includes(d) ? 'on' : ''}" data-day="${d}">${DAY_NAMES[d]}</span>`).join('');
  daysWrap.querySelectorAll('.day-chip').forEach((chip) => {
    chip.addEventListener('click', () => chip.classList.toggle('on'));
  });
  $('#auto-open').value = s.businessHours.open;
  $('#auto-close').value = s.businessHours.close;

  $('#auto-wel-enabled').checked = s.welcome.enabled;
  $('#auto-wel-text').value = s.welcome.text;
  $('#auto-wel-areas').value = s.welcome.areasText;
  $('#auto-wel-hours').value = s.welcome.frequencyHours;

  $('#auto-ah-enabled').checked = s.afterHours.enabled;
  $('#auto-ah-message').value = s.afterHours.message;

  $('#auto-sn-enabled').checked = s.statusNotify.enabled;
  $('#auto-sn-encurso').checked = s.statusNotify.onEnCurso;
  $('#auto-sn-encurso-text').value = s.statusNotify.enCursoText;
  $('#auto-sn-completado').checked = s.statusNotify.onCompletado;
  $('#auto-sn-completado-text').value = s.statusNotify.completadoText;

  $('#auto-docs-enabled').checked = s.docs.enabled;
  $('#auto-docs-request').value = s.docs.requestText;
  $('#auto-docs-days').value = s.docs.followUpDays;
  $('#auto-docs-followup').value = s.docs.followUpText;

  $('#auto-rem-enabled').checked = s.clientReminders.enabled;
  $('#auto-rem-text').value = s.clientReminders.text;

  $('#auto-ren-enabled').checked = s.renewals.enabled;
  $('#auto-ren-days').value = s.renewals.daysBefore;
  $('#auto-ren-notify').checked = s.renewals.notifyClient;
  $('#auto-ren-text').value = s.renewals.clientText;
  $('#auto-ren-autocase').checked = s.renewals.autoCreateCase;

  $('#auto-tpl-enabled').checked = s.template24h.enabled;
  $('#auto-tpl-name').value = s.template24h.name;
  $('#auto-tpl-lang').value = s.template24h.lang;

  $('#auto-appt-enabled').checked = s.appointments.enabled;
  $('#auto-appt-confirm').value = s.appointments.confirmText;
  $('#auto-appt-remind').value = s.appointments.remindText;

  $('#auto-book-enabled').checked = s.booking.enabled;
  $('#auto-book-slot').value = s.booking.slotMinutes;
  $('#auto-book-horizon').value = s.booking.horizonDays;
  $('#auto-book-max').value = s.booking.maxPerDay;

  $('#auto-pay-enabled').checked = s.payments.enabled;
  $('#auto-pay-days').value = s.payments.daysAfter;
  $('#auto-pay-completed').checked = s.payments.onlyCompleted;
  $('#auto-pay-text').value = s.payments.text;
  const ac = s.autoCollect || {};
  $('#auto-collect-enabled').checked = Boolean(ac.enabled);
  $('#auto-collect-days').value = ac.daysOverdue ?? 15;
  $('#auto-collect-cooldown').value = ac.cooldownDays ?? 7;
  $('#auto-collect-tax').checked = Boolean(ac.includeTax);

  $('#auto-tr-enabled').checked = s.transcription.enabled;
  $('#auto-legal-text').value = s.legal.text;

  $('#auto-ms-cal').checked = s.microsoft.calendar.enabled;
  $('#auto-ms-cal-user').value = s.microsoft.calendar.user;
  $('#auto-ms-cal-name').value = s.microsoft.calendar.calendarName || '';
  $('#auto-ms-sp').checked = s.microsoft.sharepoint.enabled;
  $('#auto-ms-sp-site').value = s.microsoft.sharepoint.sitePath;
  $('#auto-ms-sp-folder').value = s.microsoft.sharepoint.folderTemplate;
  $('#auto-ms-backup').checked = (s.microsoft.backup || {}).enabled || false;
  $('#auto-ms-backup-folder').value = (s.microsoft.backup || {}).folderPath || 'Copias de seguridad CRM';
  api('test-microsoft').then((r) => {
    $('#ms-status').textContent = r.configured
      ? 'Credenciales de Microsoft configuradas en el servidor.'
      : 'Sin credenciales: define MS_TENANT_ID, MS_CLIENT_ID y MS_CLIENT_SECRET al arrancar el servidor (ver README).';
  }).catch(() => {});

  await renderBackups();
}

$('#btn-test-ms').addEventListener('click', async () => {
  const btn = $('#btn-test-ms');
  btn.disabled = true;
  btn.textContent = '⏳…';
  try {
    const r = await api('test-microsoft');
    alert(`${r.ok ? '✅' : '❌'} ${r.detail}`);
  } catch (err) {
    alert('❌ ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Probar conexión';
  }
});

async function renderBackups() {
  const backups = await api('backups');
  const fmtSize = (b) => (b > 1024 * 1024 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
  $('#backup-list').innerHTML = backups.map((b) => `
    <div class="row" style="cursor:default;padding:8px 14px">
      <div class="grow"><div class="sub">💾 ${esc(b.name)} · ${fmtSize(b.size)} · ${new Date(b.createdAt).toLocaleString('es-ES')}</div></div>
      <a class="btn small" href="/api/backups/${encodeURIComponent(b.name)}">⬇ Descargar</a>
    </div>`).join('') || '<p class="hint">Aún no hay copias. La primera se creará automáticamente, o pulsa «Crear copia ahora».</p>';
}

$('#btn-backup-now').addEventListener('click', async () => {
  await api('backups', { method: 'POST' });
  await renderBackups();
});

$('#btn-auto-save').addEventListener('click', async () => {
  const days = [...document.querySelectorAll('#auto-days .day-chip.on')]
    .map((c) => Number(c.dataset.day));
  try {
    await api('automations', {
      method: 'PUT',
      body: {
        businessHours: { days, open: $('#auto-open').value, close: $('#auto-close').value },
        welcome: {
          enabled: $('#auto-wel-enabled').checked,
          text: $('#auto-wel-text').value,
          areasText: $('#auto-wel-areas').value,
          frequencyHours: Number($('#auto-wel-hours').value) || 24,
        },
        afterHours: { enabled: $('#auto-ah-enabled').checked, message: $('#auto-ah-message').value },
        statusNotify: {
          enabled: $('#auto-sn-enabled').checked,
          onEnCurso: $('#auto-sn-encurso').checked,
          enCursoText: $('#auto-sn-encurso-text').value,
          onCompletado: $('#auto-sn-completado').checked,
          completadoText: $('#auto-sn-completado-text').value,
        },
        docs: {
          enabled: $('#auto-docs-enabled').checked,
          requestText: $('#auto-docs-request').value,
          followUpDays: Number($('#auto-docs-days').value) || 3,
          followUpText: $('#auto-docs-followup').value,
        },
        clientReminders: { enabled: $('#auto-rem-enabled').checked, text: $('#auto-rem-text').value },
        renewals: {
          enabled: $('#auto-ren-enabled').checked,
          daysBefore: Number($('#auto-ren-days').value) || 30,
          notifyClient: $('#auto-ren-notify').checked,
          clientText: $('#auto-ren-text').value,
          autoCreateCase: $('#auto-ren-autocase').checked,
        },
        template24h: {
          enabled: $('#auto-tpl-enabled').checked,
          name: $('#auto-tpl-name').value.trim(),
          lang: $('#auto-tpl-lang').value.trim() || 'es',
        },
        appointments: {
          enabled: $('#auto-appt-enabled').checked,
          confirmText: $('#auto-appt-confirm').value,
          remindText: $('#auto-appt-remind').value,
        },
        booking: {
          enabled: $('#auto-book-enabled').checked,
          slotMinutes: Number($('#auto-book-slot').value) || 30,
          horizonDays: Number($('#auto-book-horizon').value) || 14,
          maxPerDay: Number($('#auto-book-max').value) || 12,
        },
        payments: {
          enabled: $('#auto-pay-enabled').checked,
          daysAfter: Number($('#auto-pay-days').value) || 7,
          onlyCompleted: $('#auto-pay-completed').checked,
          text: $('#auto-pay-text').value,
        },
        autoCollect: {
          enabled: $('#auto-collect-enabled').checked,
          daysOverdue: Number($('#auto-collect-days').value) || 15,
          cooldownDays: Number($('#auto-collect-cooldown').value) || 7,
          includeTax: $('#auto-collect-tax').checked,
        },
        transcription: { enabled: $('#auto-tr-enabled').checked },
        legal: { text: $('#auto-legal-text').value },
        microsoft: {
          calendar: {
            enabled: $('#auto-ms-cal').checked,
            user: $('#auto-ms-cal-user').value.trim(),
            calendarName: $('#auto-ms-cal-name').value.trim(),
          },
          sharepoint: {
            enabled: $('#auto-ms-sp').checked,
            sitePath: $('#auto-ms-sp-site').value.trim(),
            folderTemplate: $('#auto-ms-sp-folder').value.trim(),
          },
          backup: {
            enabled: $('#auto-ms-backup').checked,
            folderPath: $('#auto-ms-backup-folder').value.trim() || 'Copias de seguridad CRM',
          },
        },
      },
    });
    alert('Automatizaciones guardadas ✔');
  } catch (err) {
    alert(err.message);
  }
});

$('#btn-auto-run').addEventListener('click', async () => {
  const result = await api('automations/run', { method: 'POST' });
  const n = result.executed.length;
  alert(n ? `Se han ejecutado ${n} tareas (mira los chats).` : 'No había tareas pendientes dentro del horario configurado.');
});

// ---------------------------------------------------------------------------
// Arranque y refresco automático
// ---------------------------------------------------------------------------

let captchaId = null;

// Carga (o recarga) el CAPTCHA en el formulario de acceso.
async function loadCaptcha() {
  const field = $('#login-captcha-field');
  try {
    const c = await api('captcha');
    if (!c.enabled) { field.style.display = 'none'; captchaId = null; return; }
    captchaId = c.id;
    $('#login-captcha-img').src = c.image;
    $('#login-captcha').value = '';
    field.style.display = '';
  } catch {
    field.style.display = 'none';
    captchaId = null;
  }
}

async function init() {
  const authState = await api('auth');
  if (authState.required && !authState.authenticated) {
    $('#login-overlay').classList.remove('hidden');
    await loadCaptcha();
    $('#login-password').focus();
    return; // el resto se carga tras iniciar sesión
  }
  if (authState.required) {
    $('#btn-logout').classList.remove('hidden');
    if (authState.user) $('#btn-logout').textContent = `🚪 Cerrar sesión (${authState.user})`;
  }

  state.users = await api('users').catch(() => []);
  // Aislamiento por usuario: activo cuando hay varios usuarios con acceso.
  state.me = authState.user || null;
  state.isolation = Boolean(authState.required && state.users.length > 1);
  // Saber si hay plantilla aprobada para la ventana de 24 h (afecta al aviso).
  try { state.template24hEnabled = Boolean((await api('automations')).template24h?.enabled); } catch { state.template24hEnabled = false; }

  const status = await api('status');
  const badge = $('#connection-badge');
  if (status.whatsappConfigured) {
    const names = { ycloud: 'YCloud', '360dialog': '360dialog', meta: 'Meta' };
    badge.textContent = `● Conectado (${names[status.provider] || status.provider})`;
    badge.style.color = '#7CFC98';
    $('#btn-simulate').classList.add('hidden');
  } else {
    badge.textContent = '● Modo demo';
    badge.style.color = '#ffd166';
  }
  await refreshView();
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('login', {
      method: 'POST',
      body: {
        user: $('#login-user').value.trim(),
        password: $('#login-password').value,
        captchaId,
        captcha: $('#login-captcha').value.trim(),
      },
    });
    location.reload();
  } catch (err) {
    const box = $('#login-error');
    box.textContent = err.message;
    box.classList.remove('hidden');
    // El código es de un solo uso: siempre se genera uno nuevo tras un fallo.
    if (captchaId) await loadCaptcha();
  }
});

$('#login-captcha-refresh').addEventListener('click', loadCaptcha);

$('#btn-logout').addEventListener('click', async () => {
  await api('logout', { method: 'POST' });
  location.reload();
});

// Clic en la insignia de conexión → prueba real contra el proveedor.
$('#connection-badge').addEventListener('click', async () => {
  const badge = $('#connection-badge');
  const original = badge.textContent;
  badge.textContent = '⏳ Probando conexión…';
  try {
    const r = await api('test-connection');
    alert(`${r.ok ? '✅' : '❌'} ${r.detail}`);
  } catch (err) {
    alert('❌ ' + err.message);
  } finally {
    badge.textContent = original;
  }
});

// Sondeo cada 5 s: refresca la bandeja y el contador de no leídos
// para que los mensajes entrantes del webhook aparezcan solos.
// ---------------------------------------------------------------------------
// Avisos de mensajes nuevos: notificación de escritorio + sonido + título
// ---------------------------------------------------------------------------
const notifyState = { on: localStorage.getItem('crm_notify') === '1', baseline: null, blink: null, origTitle: document.title };

function updateNotifyButton() {
  const b = $('#btn-notify');
  if (!b) return;
  b.textContent = notifyState.on ? '🔔' : '🔕';
  b.classList.toggle('active', notifyState.on);
  b.title = notifyState.on ? 'Avisos de mensajes nuevos activados' : 'Avisos de mensajes nuevos silenciados';
}
async function toggleNotify() {
  if (!notifyState.on) {
    if ('Notification' in window && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch { /* ignore */ }
    }
    notifyState.on = true;
  } else {
    notifyState.on = false;
  }
  localStorage.setItem('crm_notify', notifyState.on ? '1' : '0');
  updateNotifyButton();
}
// Pitido corto generado con WebAudio (sin ficheros externos, compatible con la CSP).
function playBeep() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = 660;
    g.gain.setValueAtTime(0.001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.32);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.34);
    o.onended = () => ctx.close();
  } catch { /* audio no disponible */ }
}
function blinkTitle(n) {
  if (notifyState.blink) return;
  let on = true;
  notifyState.blink = setInterval(() => {
    document.title = on ? `(${n}) 🔔 Nuevo mensaje` : notifyState.origTitle;
    on = !on;
  }, 1000);
}
function stopBlink() {
  if (notifyState.blink) { clearInterval(notifyState.blink); notifyState.blink = null; }
  document.title = notifyState.origTitle;
}
window.addEventListener('focus', stopBlink);

async function checkNewMessages() {
  let dash;
  try { dash = await api('dashboard'); } catch { return; }
  const unread = dash.unreadMessages || 0;
  if (notifyState.baseline === null) { notifyState.baseline = unread; return; } // primera vuelta: sin avisar
  if (unread > notifyState.baseline && notifyState.on) {
    // Averigua de quién es el mensaje más reciente sin leer.
    let who = 'un cliente';
    try {
      const convs = await api('conversations');
      const pend = convs.filter((c) => c.unread > 0).sort((a, b) => b.lastTimestamp - a.lastTimestamp)[0];
      if (pend) who = pend.clientName || who;
    } catch { /* ignore */ }
    playBeep();
    if (document.hidden || !document.hasFocus()) blinkTitle(unread);
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const n = new Notification('Nuevo mensaje de WhatsApp', {
          body: `${who} te ha escrito`, icon: '/icon-192.png', tag: 'crm-wa',
        });
        n.onclick = () => { window.focus(); stopBlink(); showView('inbox'); n.close(); };
      } catch { /* ignore */ }
    }
  }
  notifyState.baseline = unread;
}
updateNotifyButton();

setInterval(async () => {
  try {
    await updateUnreadBadge();
    await checkNewMessages();
    if (state.view === 'inbox') {
      if ($('#conv-search').value.trim()) return; // no pisar los resultados de búsqueda
      const convs = filterConvs(await api('conversations'));
      state.convOrder = convs.map((c) => c.clientId);
      $('#conv-list').innerHTML = tagFilterBar() + (convs.map(convRowHtml).join('')
        || '<p class="hint">No hay conversaciones con este filtro.</p>');
      bindConvRows($('#conv-list'), false);
      bindConvTags($('#conv-list'));
      const clr2 = $('#tag-clear');
      if (clr2) clr2.addEventListener('click', () => { state.tagFilter = ''; renderInbox(); });
      if (state.activeClientId) {
        const msgs = await api('messages?clientId=' + encodeURIComponent(state.activeClientId));
        if (msgs.length !== state.lastMessageCount) {
          await openConversation(state.activeClientId);
        }
      }
    }
  } catch { /* sin conexión momentánea: reintenta en el siguiente ciclo */ }
}, 5000);

// ---------------------------------------------------------------------------
// Productividad: triaje de bandeja, respuestas rápidas «/», paleta y atajos
// ---------------------------------------------------------------------------

// --- Filtros de triaje de la bandeja ---
document.querySelectorAll('#inbox-filters .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#inbox-filters .chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    state.inboxFilter = chip.dataset.inbox;
    renderInbox();
  });
});

// --- Respuestas rápidas: escribe «/» en el chat para elegir una plantilla ---
const qrPanel = () => $('#quick-replies');
let qrSel = 0;
function qrMatches() {
  const v = $('#chat-input').value;
  const m = /^\/(\S*)$/.exec(v); // "/" seguido de texto sin espacios, al inicio
  if (!m) return null;
  const term = m[1].toLowerCase();
  return (state.templates || []).filter((t) =>
    !term || t.name.toLowerCase().includes(term) || t.text.toLowerCase().includes(term));
}
function renderQuickReplies() {
  const list = qrMatches();
  const panel = qrPanel();
  if (!list || !list.length) { panel.classList.add('hidden'); return; }
  qrSel = Math.min(qrSel, list.length - 1);
  panel.innerHTML = list.map((t, i) => `
    <div class="qr-item ${i === qrSel ? 'sel' : ''}" data-id="${esc(t.id)}">
      <span class="qr-name">${esc(t.name)}</span>
      <span class="qr-text">${esc(t.text)}</span>
    </div>`).join('');
  panel.classList.remove('hidden');
  panel.querySelectorAll('.qr-item').forEach((el) => {
    el.addEventListener('mousedown', (ev) => { ev.preventDefault(); pickQuickReply(el.dataset.id); });
  });
}
async function pickQuickReply(id) {
  const tpl = (state.templates || []).find((t) => t.id === id);
  qrPanel().classList.add('hidden');
  if (!tpl) return;
  let text = tpl.text;
  if (state.activeClientId) {
    const client = state.clients.find((c) => c.id === state.activeClientId)
      || await api('clients/' + state.activeClientId).catch(() => null);
    if (client) text = text.replaceAll('{nombre}', (client.name || '').split(' ')[0]);
  }
  const input = $('#chat-input');
  input.value = text;
  input.focus();
  input.setSelectionRange(text.length, text.length);
}

// --- Paleta de comandos / buscador global ---
const NAV_LABELS = {
  dashboard: 'Panel', inbox: 'WhatsApp', clients: 'Clientes', cases: 'Expedientes',
  appointments: 'Citas', calendar: 'Calendario', agenda: 'Agenda', templates: 'Plantillas',
  fichas: 'Documentos a pedir', knowledge: 'Precios y tasas',
  reports: 'Informes', receivables: 'Por cobrar', reminders: 'Recordatorios',
  campaigns: 'Campañas', automations: 'Automatizaciones',
};
const PALETTE_ACTIONS = [
  { title: '＋ Nuevo expediente', ico: '📁', run: () => { showView('cases'); setTimeout(() => $('#btn-new-case').click(), 60); } },
  { title: '＋ Nueva cita', ico: '📅', run: () => { showView('appointments'); setTimeout(() => $('#btn-new-appt').click(), 60); } },
  { title: '＋ Nuevo recordatorio', ico: '⏰', run: () => { showView('reminders'); setTimeout(() => $('#btn-new-reminder').click(), 60); } },
  { title: '＋ Nueva lista de documentos a pedir', ico: '📋', run: () => { showView('fichas'); setTimeout(() => $('#btn-new-ficha').click(), 60); } },
  { title: '＋ Nueva tarifa (precio/tasas)', ico: '💶', run: () => { showView('knowledge'); setTimeout(() => $('#btn-new-kb').click(), 60); } },
  { title: '＋ Nuevo cliente', ico: '👤', run: () => { showView('clients'); setTimeout(() => $('#btn-new-client').click(), 60); } },
  ...Object.entries(NAV_LABELS).map(([v, l]) => ({ title: 'Ir a: ' + l, ico: '➜', run: () => showView(v) })),
];

let palItems = [];
let palSel = 0;
let palTimer = null;

function openPalette() {
  $('#shortcuts').classList.add('hidden');
  $('#palette').classList.remove('hidden');
  const inp = $('#palette-input');
  inp.value = '';
  inp.focus();
  paletteUpdate();
}
function closePalette() { $('#palette').classList.add('hidden'); }

function setPalItems(items) {
  palItems = items;
  palSel = 0;
  const groups = {};
  for (const it of items) (groups[it.group] = groups[it.group] || []).push(it);
  let html = '';
  let idx = 0;
  for (const [group, list] of Object.entries(groups)) {
    html += `<div class="pal-group">${esc(group)}</div>`;
    for (const it of list) {
      html += `<div class="pal-item ${idx === palSel ? 'sel' : ''}" data-i="${idx}">
        <span class="pal-ico">${it.ico || '•'}</span>
        <div class="pal-main"><div class="pal-title">${esc(it.title)}</div>${it.sub ? `<div class="pal-sub">${esc(it.sub)}</div>` : ''}</div>
      </div>`;
      idx += 1;
    }
  }
  const box = $('#palette-results');
  box.innerHTML = html || '<div class="pal-empty">Sin resultados.</div>';
  box.querySelectorAll('.pal-item').forEach((el) => {
    el.addEventListener('mousedown', (ev) => { ev.preventDefault(); runPalItem(Number(el.dataset.i)); });
  });
}
function paintPalSel() {
  $('#palette-results').querySelectorAll('.pal-item').forEach((el) => {
    el.classList.toggle('sel', Number(el.dataset.i) === palSel);
  });
  const sel = $('#palette-results').querySelector('.pal-item.sel');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}
function runPalItem(i) {
  const it = palItems[i];
  if (!it) return;
  closePalette();
  it.run();
}
function paletteUpdate() {
  const q = $('#palette-input').value.trim();
  const ql = q.toLowerCase();
  const actions = (q ? PALETTE_ACTIONS.filter((a) => a.title.toLowerCase().includes(ql)) : PALETTE_ACTIONS)
    .map((a) => ({ group: 'Acciones', ico: a.ico, title: a.title, run: a.run }));
  if (q.length < 2) { setPalItems(actions); return; }
  clearTimeout(palTimer);
  palTimer = setTimeout(async () => {
    let r = { clients: [], cases: [], messages: [] };
    try { r = await api('search?q=' + encodeURIComponent(q)); } catch { /* ignore */ }
    const items = [];
    for (const c of r.clients) {
      items.push({ group: 'Clientes', ico: '👤', title: c.name, sub: '+' + c.phone,
        run: () => { showView('inbox'); openConversation(c.id); } });
    }
    for (const c of r.cases) {
      items.push({ group: 'Expedientes', ico: '📁', title: c.title, sub: c.clientName,
        run: () => openCaseById(c.id) });
    }
    for (const m of r.messages) {
      items.push({ group: 'Mensajes', ico: '💬', title: m.text || '(adjunto)', sub: m.clientName,
        run: () => { showView('inbox'); openConversation(m.clientId); } });
    }
    setPalItems([...items, ...actions]);
  }, 140);
}
// Abre el diálogo de edición de un expediente concreto desde la paleta.
async function openCaseById(caseId) {
  showView('cases');
  const [cases, clients, fichas] = await Promise.all([api('cases'), api('clients'), api('fichas')]);
  const item = cases.find((c) => c.id === caseId);
  if (!item) return;
  openDialog('Editar expediente', caseFields(item, clients, fichas), async (v) => {
    await api('cases/' + item.id, { method: 'PUT', body: caseBody(v) });
    await renderCases();
  });
}
$('#palette-input').addEventListener('input', paletteUpdate);

// --- Atajos de teclado globales ---
function typingInField(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}
function currentConvIndex() {
  return state.convOrder.indexOf(state.activeClientId);
}
function moveConversation(delta) {
  if (state.view !== 'inbox' || !state.convOrder.length) return;
  let i = currentConvIndex();
  i = i < 0 ? 0 : Math.min(state.convOrder.length - 1, Math.max(0, i + delta));
  openConversation(state.convOrder[i]);
}

document.addEventListener('keydown', (e) => {
  // Ctrl/Cmd+K: paleta (funciona siempre).
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    $('#palette').classList.contains('hidden') ? openPalette() : closePalette();
    return;
  }
  if (e.key === 'Escape') {
    if (!$('#pdf-modal').classList.contains('hidden')) { closePdfPreview(); return; }
    if (!$('#palette').classList.contains('hidden')) { closePalette(); return; }
    if (!$('#shortcuts').classList.contains('hidden')) { $('#shortcuts').classList.add('hidden'); return; }
    if (!qrPanel().classList.contains('hidden')) { qrPanel().classList.add('hidden'); return; }
  }
  // Navegación dentro de la paleta.
  if (!$('#palette').classList.contains('hidden')) {
    if (e.key === 'ArrowDown') { e.preventDefault(); palSel = Math.min(palItems.length - 1, palSel + 1); paintPalSel(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); palSel = Math.max(0, palSel - 1); paintPalSel(); }
    else if (e.key === 'Enter') { e.preventDefault(); runPalItem(palSel); }
    return;
  }
  if (typingInField(document.activeElement)) return; // no molestar mientras se escribe
  if (e.key === '/') { e.preventDefault(); openPalette(); }
  else if (e.key === '?') { e.preventDefault(); $('#shortcuts').classList.toggle('hidden'); }
  else if (e.key === 'j') { e.preventDefault(); moveConversation(1); }
  else if (e.key === 'k') { e.preventDefault(); moveConversation(-1); }
  else if (e.key === 'r' && state.activeClientId) { e.preventDefault(); $('#chat-input').focus(); }
  else if (e.key === 'e' && state.activeClientId && state.view === 'inbox') {
    e.preventDefault();
    $('#conv-status').value = 'resuelta';
    $('#conv-status').dispatchEvent(new Event('change'));
    renderInbox();
  }
});
// Cerrar la paleta/ayuda al hacer clic fuera del recuadro.
$('#palette').addEventListener('mousedown', (e) => { if (e.target.id === 'palette') closePalette(); });
$('#shortcuts').addEventListener('mousedown', (e) => { if (e.target.id === 'shortcuts') $('#shortcuts').classList.add('hidden'); });

// Registro del service worker (hace la app instalable en el móvil).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* sin PWA, el CRM funciona igual */ });
  });
}

// Desbloqueo explícito de la orientación: si algo (o un manifiesto antiguo
// guardado por el móvil) hubiera fijado la orientación, se libera para que la
// app pueda girar a horizontal. Es un «por si acaso»; en navegadores que no lo
// soportan simplemente no hace nada.
try {
  if (screen.orientation && typeof screen.orientation.unlock === 'function') {
    screen.orientation.unlock();
  }
} catch { /* no soportado: sin efecto */ }

init();
