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
  caseFilter: '',
  segFilter: '',
  apptFilter: 'proximas',
  noteMode: false,
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
    if (state.view === 'appointments') await renderAppointments();
    if (state.view === 'templates') await renderTemplates();
    if (state.view === 'fichas') await renderFichas();
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
    <div class="card ${d.remindersToday ? 'warn' : ''}"><div class="num">${d.remindersToday}</div><div class="lbl">Recordatorios para hoy</div></div>
    <div class="card"><div class="num">${stats.messagesThisWeek}</div><div class="lbl">Mensajes esta semana</div></div>
    <div class="card"><div class="num">${respLbl}</div><div class="lbl">Tiempo medio de respuesta (30 d)</div></div>`;
  renderMessagesChart(stats.messagesByDay);
  renderCasesChart(stats.casesByStatus);
  $('#dash-recent').innerHTML = d.recentConversations.map(convRowHtml).join('')
    || '<p class="hint">Todavía no hay conversaciones.</p>';
  bindConvRows($('#dash-recent'), true);
}

// Colores de serie validados (lila de marca + violeta profundo).
const CHART_IN = '#9c86c9';   // recibidos
const CHART_OUT = '#5e35b1';  // enviados

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
        labels += `<text x="${x + barW / 2}" y="${y - 3}" font-size="10" text-anchor="middle" fill="#6f6a78">${v}</text>`;
      }
    }
    if (i % 2 === 0) {
      labels += `<text x="${x0 + barW}" y="${H - 5}" font-size="9" text-anchor="middle" fill="#6f6a78">${day}</text>`;
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
    out += `<text x="${labelW - 8}" y="${y + 15}" font-size="12" text-anchor="end" fill="#211e26">${r.label}</text>`;
    if (r.v) {
      out += `<path class="bar" d="M${labelW},${y} h${Math.max(0, w - 4)} q4,0 4,4 v14 q0,4 -4,4 h${-Math.max(0, w - 4)} z" fill="${CHART_IN}"><title>${r.label}: ${r.v}</title></path>`;
    }
    out += `<text x="${labelW + w + 8}" y="${y + 15}" font-size="12" fill="#6f6a78">${r.v}</text>`;
  });
  $('#chart-cases').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Expedientes por estado">${out}</svg>`;
}

// ---------------------------------------------------------------------------
// Bandeja de WhatsApp
// ---------------------------------------------------------------------------

const CONV_DOT = { abierta: '🟢', pendiente: '🟡', resuelta: '⚪' };

// Avatar con iniciales y color estable derivado del nombre.
function avatarHtml(name) {
  const parts = (name || '?').trim().split(/\s+/);
  const initials = (parts[0]?.[0] || '?') + (parts[1]?.[0] || '');
  let hash = 0;
  for (const ch of name || '') hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return `<span class="avatar a${hash % 4}">${esc(initials.toUpperCase())}</span>`;
}

function convRowHtml(c) {
  const arrow = c.lastDirection === 'out' ? '↗ ' : c.lastDirection === 'note' ? '🗒️ ' : '';
  return `
    <div class="row conv-row" data-client-id="${esc(c.clientId)}">
      ${avatarHtml(c.clientName)}
      <div class="grow">
        <div class="title"><span class="conv-dot">${CONV_DOT[c.convStatus] || '🟢'}</span>${esc(c.clientName)}
          ${c.assignedTo ? `<span class="conv-assigned">· ${esc(c.assignedTo)}</span>` : ''}</div>
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
  if ($('#conv-search').value.trim()) return renderConvSearch();
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
  // En móvil, el chat ocupa la pantalla y la lista se oculta.
  if (window.innerWidth <= 760) document.querySelector('.inbox').classList.add('mobile-chat');
  const [client, msgs] = await Promise.all([
    api('clients/' + clientId),
    api('messages?clientId=' + encodeURIComponent(clientId)),
  ]);
  $('#chat-empty').classList.add('hidden');
  $('#chat').classList.remove('hidden');
  $('#chat-name').textContent = client.name;
  $('#chat-phone').textContent = '+' + client.phone;
  $('#conv-status').value = client.convStatus || 'abierta';
  $('#conv-assign').innerHTML = '<option value="">Sin asignar</option>'
    + state.users.map((u) => `<option value="${esc(u)}" ${client.assignedTo === u ? 'selected' : ''}>${esc(u)}</option>`).join('');
  state.lastMessageCount = msgs.length;

  $('#chat-messages').innerHTML = msgs.map((m) => {
    if (m.direction === 'note') {
      return `<div class="msg note">🗒️ ${esc(m.text)}
        <span class="msg-meta">${esc(m.author || 'equipo')} · ${fmtTime(m.timestamp)} · solo interno</span></div>`;
    }
    // Sticker del catálogo: se muestra desde su fichero estático, sin burbuja.
    if (m.media && m.media.kind === 'sticker' && m.media.stickerUrl) {
      return `<div class="msg ${m.direction} sticker">
        <img src="${esc(m.media.stickerUrl)}" alt="sticker">
        <span class="msg-meta">${m.auto ? '🤖 · ' : ''}${fmtTime(m.timestamp)} ${MSG_STATUS[m.status] || ''}</span>
      </div>`;
    }
    let mediaHtml = '';
    if (m.media) {
      const src = `/api/media/${encodeURIComponent(m.id)}`;
      if (m.media.kind === 'image' || m.media.kind === 'sticker') {
        mediaHtml = `<a href="${src}" target="_blank"><img class="msg-media" src="${src}" alt="imagen"></a>`;
      } else {
        const icon = m.media.kind === 'video' ? '🎬' : m.media.kind === 'audio' ? '🎧' : '📄';
        mediaHtml = `<a class="msg-file" href="${src}" target="_blank" download="${esc(m.media.filename || 'adjunto')}">${icon} ${esc(m.media.filename || 'Adjunto')}</a>`;
      }
      mediaHtml += `<button class="btn small msg-link-case" data-msg-id="${esc(m.id)}" title="Guardar en un expediente">${m.caseId ? '📁 en expediente' : '📁 asignar a expediente'}</button> `;
      if (m.sharepointUrl) {
        mediaHtml += `<a class="btn small" href="${esc(m.sharepointUrl)}" target="_blank" title="Abrir en SharePoint">☁️ SharePoint</a> `;
      }
    }
    return `
    <div class="msg ${m.direction} ${m.status === 'error' ? 'error' : ''}">${mediaHtml}${esc(m.text)}
      <span class="msg-meta">${m.auto ? '🤖 automático · ' : ''}${m.viaTemplate ? '📋 plantilla · ' : ''}${m.viaApp ? '📱 desde el móvil · ' : ''}${m.viaProvider ? '☁️ vía YCloud · ' : ''}${fmtTime(m.timestamp)} ${MSG_STATUS[m.status] || ''}${m.error ? ' · ' + esc(m.error) : ''}</span>
    </div>`;
  }).join('');
  const box = $('#chat-messages');
  box.scrollTop = box.scrollHeight;

  box.querySelectorAll('.msg-link-case').forEach((btn) => {
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
    await api('messages', {
      method: 'POST',
      body: { clientId: state.activeClientId, text, note: state.noteMode },
    });
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

$('#btn-back-conv').addEventListener('click', () => {
  document.querySelector('.inbox').classList.remove('mobile-chat');
});

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
}
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
      ${avatarHtml(c.name)}
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
document.querySelectorAll('#seg-filters .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#seg-filters .chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    state.segFilter = chip.dataset.seg;
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
    { name: 'docs', label: 'Documentación necesaria (una línea por documento; se usa en la automatización)', type: 'textarea', value: item.docs },
    { name: 'notes', label: 'Notas', type: 'textarea', value: item.notes },
  ];
}

async function renderCases() {
  const [cases, clients] = await Promise.all([api('cases'), api('clients')]);
  state.clients = clients;
  const clientOf = (id) => clients.find((c) => c.id === id);
  const nameOf = (id) => clientOf(id)?.name || '(cliente eliminado)';
  const segOf = (id) => clientOf(id)?.segment || 'particular';

  let list = cases;
  if (state.caseFilter) list = list.filter((c) => c.status === state.caseFilter);
  list = list.slice().sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')));

  const caseRow = (c) => {
    const overdue = c.dueDate && c.status !== 'completado' && new Date(c.dueDate) < new Date();
    return `
    <div class="row case-row" data-id="${esc(c.id)}">
      <div class="grow">
        <div class="title">${esc(c.title)}</div>
        <div class="sub">${esc(nameOf(c.clientId))} · <span class="area-badge">${esc(TYPE_LABEL[c.type] || c.type)}</span></div>
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
function barList(entries, labelMap) {
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return entries.map(([k, v]) => `
    <div class="rep-bar-row">
      <span class="rep-bar-label">${esc(labelMap ? (labelMap[k] || k) : k)}</span>
      <span class="rep-bar-track"><span class="rep-bar-fill" style="width:${Math.round((v / max) * 100)}%"></span></span>
      <span class="rep-bar-val">${v}</span>
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

  $('#rep-table').innerHTML = r.byTitle.length ? `
    <table class="rep-table">
      <thead><tr><th>Área</th><th>Trámite</th><th class="num">Total</th><th class="num">Completados</th></tr></thead>
      <tbody>${r.byTitle.map((t) => `
        <tr><td>${esc(TYPE_LABEL[t.type] || t.type)}</td><td>${esc(t.title)}</td>
        <td class="num">${t.count}</td><td class="num">${t.completados}</td></tr>`).join('')}</tbody>
    </table>` : '<p class="hint">No hay expedientes en este periodo.</p>';
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
    </div>`).join('') || '<p class="hint">No hay fichas todavía. Crea la primera con «＋ Nueva ficha».</p>';

  $('#ficha-list').querySelectorAll('.ficha-row').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.ficha-del')) return;
      const f = fichas.find((x) => x.id === row.dataset.id);
      openDialog('Editar ficha de trámite', fichaFields(f), async (v) => {
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
  openDialog('Nueva ficha de trámite', fichaFields(), async (v) => {
    await api('fichas', { method: 'POST', body: v });
    await renderFichas();
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
    : '<p class="hint">No hay fichas. Créalas en «Fichas de trámite».</p>';
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

  $('#auto-tpl-enabled').checked = s.template24h.enabled;
  $('#auto-tpl-name').value = s.template24h.name;
  $('#auto-tpl-lang').value = s.template24h.lang;

  $('#auto-appt-enabled').checked = s.appointments.enabled;
  $('#auto-appt-confirm').value = s.appointments.confirmText;
  $('#auto-appt-remind').value = s.appointments.remindText;

  $('#auto-ms-cal').checked = s.microsoft.calendar.enabled;
  $('#auto-ms-cal-user').value = s.microsoft.calendar.user;
  $('#auto-ms-sp').checked = s.microsoft.sharepoint.enabled;
  $('#auto-ms-sp-site').value = s.microsoft.sharepoint.sitePath;
  $('#auto-ms-sp-folder').value = s.microsoft.sharepoint.folderTemplate;
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
        microsoft: {
          calendar: {
            enabled: $('#auto-ms-cal').checked,
            user: $('#auto-ms-cal-user').value.trim(),
          },
          sharepoint: {
            enabled: $('#auto-ms-sp').checked,
            sitePath: $('#auto-ms-sp-site').value.trim(),
            folderTemplate: $('#auto-ms-sp-folder').value.trim(),
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

async function init() {
  const authState = await api('auth');
  if (authState.required && !authState.authenticated) {
    $('#login-overlay').classList.remove('hidden');
    $('#login-password').focus();
    return; // el resto se carga tras iniciar sesión
  }
  if (authState.required) {
    $('#btn-logout').classList.remove('hidden');
    if (authState.user) $('#btn-logout').textContent = `🚪 Cerrar sesión (${authState.user})`;
  }

  state.users = await api('users').catch(() => []);

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
      body: { user: $('#login-user').value.trim(), password: $('#login-password').value },
    });
    location.reload();
  } catch (err) {
    const box = $('#login-error');
    box.textContent = err.message;
    box.classList.remove('hidden');
  }
});

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
setInterval(async () => {
  try {
    await updateUnreadBadge();
    if (state.view === 'inbox') {
      if ($('#conv-search').value.trim()) return; // no pisar los resultados de búsqueda
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
