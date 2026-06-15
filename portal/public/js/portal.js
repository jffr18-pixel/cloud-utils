'use strict';

const { escapeHtml, formatBytes, formatDate, statusPill, ext, api, logout, requireUser } = window.BZ;

let currentUser = null;
let tramitesCache = [];

const el = (id) => document.getElementById(id);
const alertBox = el('alert');

function showAlert(msg, kind = 'ok') {
  alertBox.textContent = msg;
  alertBox.className = `alert alert--${kind}`;
}

function docItem(d, downloadBase) {
  const who = d.uploaded_by === 'admin'
    ? '<span class="tag tag--admin">Gestoría</span>'
    : '<span class="tag">Tú</span>';
  const tramite = d.tramite_title ? ` · ${escapeHtml(d.tramite_title)}` : '';
  return `<li class="doc-item">
    <span class="doc-icon">${ext(d.original_name)}</span>
    <span class="doc-meta">
      <span class="doc-name">${escapeHtml(d.original_name)}</span>
      <span class="doc-sub">${formatBytes(d.size)} · ${formatDate(d.created_at)}${tramite}</span>
    </span>
    ${who}
    <a class="btn btn--sm btn--ghost" href="${downloadBase}/${d.id}/download">Descargar</a>
  </li>`;
}

function renderTramites(tramites) {
  const box = el('tramites');
  if (!tramites.length) {
    box.innerHTML = `<div class="card empty">Todavía no tienes trámites registrados. En cuanto iniciemos una gestión aparecerá aquí.</div>`;
    return;
  }
  box.innerHTML = tramites.map((t) => {
    const docs = (t.documents || []).map((d) => docItem(d, '/api/client/documents')).join('');
    const timeline = (t.updates || []).map((u) => `
      <li>
        ${u.status ? statusPill(u.status, '') + ' ' : ''}${escapeHtml(u.note || '')}
        <div class="ts">${formatDate(u.created_at)}</div>
      </li>`).join('');
    return `<div class="tramite">
      <div class="tramite__head">
        <div>
          <div class="tramite__title">${escapeHtml(t.title)}</div>
          <div class="tramite__type">${escapeHtml(t.type || 'Trámite')} · actualizado ${formatDate(t.updated_at)}</div>
        </div>
        ${statusPill(t.status, t.status_label)}
      </div>
      ${t.description ? `<p class="muted" style="margin:10px 0 0">${escapeHtml(t.description)}</p>` : ''}
      ${docs ? `<ul class="doc-list">${docs}</ul>` : ''}
      ${timeline ? `<ul class="timeline">${timeline}</ul>` : ''}
    </div>`;
  }).join('');
}

function renderAllDocs(docs) {
  const box = el('all-docs');
  if (!docs.length) {
    box.innerHTML = `<li class="empty">Aún no hay documentos.</li>`;
    return;
  }
  box.innerHTML = docs.map((d) => docItem(d, '/api/client/documents')).join('');
}

function fillTramiteSelect(tramites) {
  const sel = el('tramite-select');
  sel.length = 1;
  tramites.forEach((t) => {
    const o = document.createElement('option');
    o.value = t.id;
    o.textContent = t.title;
    sel.appendChild(o);
  });
}

async function load() {
  const [tramites, docs] = await Promise.all([
    api('/api/client/tramites'),
    api('/api/client/documents'),
  ]);
  tramitesCache = tramites;
  renderTramites(tramites);
  renderAllDocs(docs);
  fillTramiteSelect(tramites);
}

/* ---------- Modal de subida ---------- */
const modal = el('upload-modal');
const fileInput = el('file-input');
const dropzone = el('dropzone');
const fileList = el('file-list');
const modalAlert = el('modal-alert');

function openModal() { modal.classList.remove('hidden'); }
function closeModal() {
  modal.classList.add('hidden');
  fileInput.value = '';
  fileList.textContent = 'Ningún archivo seleccionado';
  modalAlert.className = 'alert hidden';
}

function updateFileList() {
  const files = fileInput.files;
  fileList.textContent = files.length
    ? Array.from(files).map((f) => f.name).join(', ')
    : 'Ningún archivo seleccionado';
}

el('upload-btn').addEventListener('click', openModal);
modal.addEventListener('click', (e) => { if (e.target === modal || e.target.hasAttribute('data-close')) closeModal(); });
dropzone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', updateFileList);
['dragover', 'dragenter'].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('is-over'); }));
['dragleave', 'drop'].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('is-over'); }));
dropzone.addEventListener('drop', (e) => { fileInput.files = e.dataTransfer.files; updateFileList(); });

el('upload-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!fileInput.files.length) {
    modalAlert.className = 'alert alert--error';
    modalAlert.textContent = 'Selecciona al menos un archivo.';
    return;
  }
  const btn = el('upload-submit');
  btn.disabled = true; btn.textContent = 'Subiendo…';
  const fd = new FormData();
  const tid = el('tramite-select').value;
  if (tid) fd.append('tramite_id', tid);
  Array.from(fileInput.files).forEach((f) => fd.append('files', f));

  try {
    const r = await api('/api/client/documents', { method: 'POST', body: fd });
    closeModal();
    showAlert(`Se han subido ${r.uploaded} documento(s) correctamente.`, 'ok');
    await load();
  } catch (err) {
    modalAlert.className = 'alert alert--error';
    modalAlert.textContent = err.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Subir';
  }
});

el('logout').addEventListener('click', logout);

/* ---------- Init ---------- */
(async function init() {
  try {
    currentUser = await requireUser('client');
    el('user-name').textContent = currentUser.name;
    el('greet').textContent = currentUser.name.split(' ')[0];
    await load();
  } catch (e) {
    if (e.message !== 'redirect') console.error(e);
  }
})();
