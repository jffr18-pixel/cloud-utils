'use strict';

// Utilidades compartidas por el portal del cliente y el panel del gestor.
window.BZ = (function () {
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(i ? 1 : 0)} ${sizes[i]}`;
  }

  function formatDate(s) {
    if (!s) return '';
    // Las fechas vienen en UTC (datetime('now')); las mostramos en local.
    const d = new Date(s.replace(' ', 'T') + 'Z');
    if (isNaN(d)) return s;
    return d.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function statusPill(status, label) {
    return `<span class="status status--${escapeHtml(status)}">${escapeHtml(label || status)}</span>`;
  }

  function ext(name) {
    const m = /\.([a-z0-9]+)$/i.exec(name || '');
    return m ? m[1].toUpperCase().slice(0, 4) : 'DOC';
  }

  async function api(url, opts = {}) {
    const res = await fetch(url, { credentials: 'same-origin', ...opts });
    if (res.status === 401) { window.location.href = '/'; throw new Error('No autenticado'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error en la operación');
    return data;
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    window.location.href = '/';
  }

  // Garantiza que hay sesión con el rol esperado; devuelve el usuario.
  async function requireUser(expectedRole) {
    let user;
    try { user = await api('/api/auth/me'); }
    catch { window.location.href = '/'; throw new Error('redirect'); }
    if (expectedRole && user.role !== expectedRole) {
      window.location.href = user.role === 'admin' ? '/admin.html' : '/portal.html';
      throw new Error('redirect');
    }
    return user;
  }

  return { escapeHtml, formatBytes, formatDate, statusPill, ext, api, logout, requireUser };
})();
