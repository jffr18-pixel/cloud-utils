'use strict';

const form = document.getElementById('login-form');
const alertBox = document.getElementById('alert');
const submitBtn = document.getElementById('submit-btn');

function showError(msg) {
  alertBox.textContent = msg;
  alertBox.classList.remove('hidden');
}

// Si ya hay sesión, redirige según el rol.
fetch('/api/auth/me', { credentials: 'same-origin' })
  .then((r) => (r.ok ? r.json() : null))
  .then((user) => {
    if (user) window.location.href = user.role === 'admin' ? '/admin.html' : '/portal.html';
  })
  .catch(() => {});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  alertBox.classList.add('hidden');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Entrando…';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        email: form.email.value.trim(),
        password: form.password.value,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo iniciar sesión');
    window.location.href = data.role === 'admin' ? '/admin.html' : '/portal.html';
  } catch (err) {
    showError(err.message);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Entrar';
  }
});
