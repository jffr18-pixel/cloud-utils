'use strict';

const { escapeHtml, formatBytes, formatDate, statusPill, ext, api, logout, requireUser } = window.BZ;

const el = (id) => document.getElementById(id);
const alertBox = el('alert');
let statusLabels = {};
let currentClientId = null;

function showAlert(msg, kind = 'ok') {
  alertBox.textContent = msg;
  alertBox.className = `alert alert--${kind}`;
  alertBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function statusOptions(selectEl, selected) {
  selectEl.innerHTML = Object.entries(statusLabels)
    .map(([k, v]) => `<option value="${k}" ${k === selected ? 'selected' : ''}>${escapeHtml(v)}</option>`)
    .join('');
}

/* ---------------- Lista de clientes ---------------- */
async function loadClients() {
  const clients = await api('/api/admin/clients');
  const body = el('clients-body');
  if (!clients.length) {
    body.innerHTML = `<tr><td colspan="6" class="empty">Aún no hay clientes. Crea el primero con “Nuevo cliente”.</td></tr>`;
    return;
  }
  body.innerHTML = clients.map((c) => `
    <tr>
      <td><strong>${escapeHtml(c.name)}</strong></td>
      <td>${escapeHtml(c.email)}<br><span class="muted" style="font-size:.82rem">${escapeHtml(c.phone || '')}</span></td>
      <td>${c.tramites}</td>
      <td>${c.documentos}</td>
      <td class="muted" style="font-size:.85rem">${formatDate(c.created_at)}</td>
      <td><button class="btn btn--sm" data-client="${c.id}">Abrir</button></td>
    </tr>`).join('');
  body.querySelectorAll('[data-client]').forEach((b) =>
    b.addEventListener('click', () => openClient(Number(b.dataset.client))));
}

/* ---------------- Detalle de cliente ---------------- */
async function openClient(id) {
  currentClientId = id;
  const c = await api(`/api/admin/clients/${id}`);
  el('view-list').classList.add('hidden');
  el('view-detail').classList.remove('hidden');
  el('d-name').textContent = c.name;
  el('d-contact').textContent = `${c.email}${c.phone ? ' · ' + c.phone : ''}`;
  window.scrollTo(0, 0);

  // Trámites
  const tb = el('d-tramites');
  if (!c.tramites.length) {
    tb.innerHTML = `<div class="card empty">Sin trámites. Crea uno con “Nuevo trámite”.</div>`;
  } else {
    tb.innerHTML = c.tramites.map((t) => {
      const docs = (t.documents || []).map(docItemAdmin).join('');
      const timeline = (t.updates || []).map((u) => `
        <li>${u.status ? statusPill(u.status, statusLabels[u.status]) + ' ' : ''}${escapeHtml(u.note || '')}
        <div class="ts">${escapeHtml(u.created_by === 'client' ? 'Cliente' : 'Gestoría')} · ${formatDate(u.created_at)}</div></li>`).join('');
      return `<div class="tramite">
        <div class="tramite__head">
          <div><div class="tramite__title">${escapeHtml(t.title)}</div>
          <div class="tramite__type">${escapeHtml(t.type || 'Trámite')} · actualizado ${formatDate(t.updated_at)}</div></div>
          <div style="display:flex;gap:8px;align-items:center">
            ${statusPill(t.status, t.status_label)}
            <button class="btn btn--sm btn--ghost" data-update="${t.id}" data-status="${t.status}" data-title="${escapeHtml(t.title)}">Actualizar</button>
          </div>
        </div>
        ${t.description ? `<p class="muted" style="margin:10px 0 0">${escapeHtml(t.description)}</p>` : ''}
        ${docs ? `<ul class="doc-list">${docs}</ul>` : ''}
        ${timeline ? `<ul class="timeline">${timeline}</ul>` : ''}
      </div>`;
    }).join('');
    tb.querySelectorAll('[data-update]').forEach((b) =>
      b.addEventListener('click', () => openUpdate(Number(b.dataset.update), b.dataset.status, b.dataset.title)));
  }

  // Documentos
  const dd = el('d-docs');
  dd.innerHTML = c.documents.length
    ? c.documents.map(docItemAdmin).join('')
    : `<li class="empty">Sin documentos.</li>`;

  // Selects de los modales
  const opts = `<option value="">— Sin trámite concreto —</option>` +
    c.tramites.map((t) => `<option value="${t.id}">${escapeHtml(t.title)}</option>`).join('');
  el('dm-tramite').innerHTML = opts;
}

function docItemAdmin(d) {
  const who = d.uploaded_by === 'admin'
    ? '<span class="tag tag--admin">Gestoría</span>'
    : '<span class="tag">Cliente</span>';
  return `<li class="doc-item">
    <span class="doc-icon">${ext(d.original_name)}</span>
    <span class="doc-meta"><span class="doc-name">${escapeHtml(d.original_name)}</span>
    <span class="doc-sub">${formatBytes(d.size)} · ${formatDate(d.created_at)}</span></span>
    ${who}
    <a class="btn btn--sm btn--ghost" href="/api/admin/documents/${d.id}/download">Descargar</a>
  </li>`;
}

el('back-link').addEventListener('click', (e) => {
  e.preventDefault();
  el('view-detail').classList.add('hidden');
  el('view-list').classList.remove('hidden');
  loadClients();
});

/* ---------------- Modales ---------------- */
function bindModal(modalId) {
  const m = el(modalId);
  m.addEventListener('click', (e) => {
    if (e.target === m || e.target.hasAttribute('data-close')) m.classList.add('hidden');
  });
  return m;
}
const clientModal = bindModal('client-modal');
const tramiteModal = bindModal('tramite-modal');
const updateModal = bindModal('update-modal');
const docModal = bindModal('doc-modal');

// Nuevo cliente
el('new-client-btn').addEventListener('click', () => { el('client-form').reset(); el('cm-alert').className = 'alert hidden'; clientModal.classList.remove('hidden'); });
el('client-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await api('/api/admin/clients', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: f.name.value, email: f.email.value, phone: f.phone.value, password: f.password.value }),
    });
    clientModal.classList.add('hidden');
    showAlert('Cliente creado correctamente.');
    loadClients();
  } catch (err) { el('cm-alert').className = 'alert alert--error'; el('cm-alert').textContent = err.message; }
});

// Nuevo trámite
el('new-tramite-btn').addEventListener('click', () => {
  el('tramite-form').reset(); el('tm-alert').className = 'alert hidden';
  statusOptions(el('tm-status'), 'recibido');
  tramiteModal.classList.remove('hidden');
});
el('tramite-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await api('/api/admin/tramites', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: currentClientId, title: f.title.value, type: f.type.value, status: f.status.value, description: f.description.value }),
    });
    tramiteModal.classList.add('hidden');
    showAlert('Trámite creado.');
    openClient(currentClientId);
  } catch (err) { el('tm-alert').className = 'alert alert--error'; el('tm-alert').textContent = err.message; }
});

// Actualizar trámite
let updateTramiteId = null;
function openUpdate(id, status, title) {
  updateTramiteId = id;
  el('um-title').textContent = `Actualizar: ${title}`;
  el('update-form').reset();
  el('um-alert').className = 'alert hidden';
  statusOptions(el('um-status'), status);
  updateModal.classList.remove('hidden');
}
el('update-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await api(`/api/admin/tramites/${updateTramiteId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: f.status.value, note: f.note.value || null }),
    });
    updateModal.classList.add('hidden');
    showAlert('Trámite actualizado. El cliente verá el cambio.');
    openClient(currentClientId);
  } catch (err) { el('um-alert').className = 'alert alert--error'; el('um-alert').textContent = err.message; }
});

// Subir documento (admin)
const dmFileInput = el('dm-fileinput');
const dmDrop = el('dm-dropzone');
el('new-doc-btn').addEventListener('click', () => {
  el('doc-form').reset(); el('dm-alert').className = 'alert hidden';
  dmFileInput.value = ''; el('dm-filelist').textContent = 'Ningún archivo';
  docModal.classList.remove('hidden');
});
dmDrop.addEventListener('click', () => dmFileInput.click());
dmFileInput.addEventListener('change', () => {
  el('dm-filelist').textContent = dmFileInput.files.length ? Array.from(dmFileInput.files).map((f) => f.name).join(', ') : 'Ningún archivo';
});
['dragover', 'dragenter'].forEach((ev) => dmDrop.addEventListener(ev, (e) => { e.preventDefault(); dmDrop.classList.add('is-over'); }));
['dragleave', 'drop'].forEach((ev) => dmDrop.addEventListener(ev, (e) => { e.preventDefault(); dmDrop.classList.remove('is-over'); }));
dmDrop.addEventListener('drop', (e) => { dmFileInput.files = e.dataTransfer.files; dmFileInput.dispatchEvent(new Event('change')); });
el('doc-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!dmFileInput.files.length) { el('dm-alert').className = 'alert alert--error'; el('dm-alert').textContent = 'Selecciona un archivo.'; return; }
  const btn = el('dm-submit'); btn.disabled = true; btn.textContent = 'Subiendo…';
  const fd = new FormData();
  if (el('dm-tramite').value) fd.append('tramite_id', el('dm-tramite').value);
  Array.from(dmFileInput.files).forEach((f) => fd.append('files', f));
  try {
    const r = await api(`/api/admin/clients/${currentClientId}/documents`, { method: 'POST', body: fd });
    docModal.classList.add('hidden');
    showAlert(`Subidos ${r.uploaded} documento(s) para el cliente.`);
    openClient(currentClientId);
  } catch (err) { el('dm-alert').className = 'alert alert--error'; el('dm-alert').textContent = err.message; }
  finally { btn.disabled = false; btn.textContent = 'Subir'; }
});

el('logout').addEventListener('click', logout);

/* ---------------- Init ---------------- */
(async function init() {
  try {
    const user = await requireUser('admin');
    el('user-name').textContent = user.name;
    const meta = await api('/api/meta');
    statusLabels = meta.statusLabels;
    await loadClients();
  } catch (e) {
    if (e.message !== 'redirect') console.error(e);
  }
})();
