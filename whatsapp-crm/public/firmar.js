'use strict';

// Lienzo de firma para la página pública /firmar/:token.
// Captura el trazo con el dedo o el ratón y lo envía como JPEG al servidor,
// que genera el PDF firmado. Sin dependencias externas.

(function () {
  var form = document.getElementById('sign-form');
  if (!form) return;
  var canvas = document.getElementById('pad');
  var hint = document.getElementById('pad-hint');
  var clearBtn = document.getElementById('clear');
  var submitBtn = document.getElementById('submit');
  var msg = document.getElementById('msg');
  var ctx = canvas.getContext('2d');
  var drawing = false;
  var hasInk = false;
  var last = null;

  // Ajusta el lienzo a su tamaño real en pantalla (nitidez en móviles).
  function fit() {
    var ratio = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    // Conserva lo dibujado al redimensionar.
    var prev = hasInk ? canvas.toDataURL() : null;
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#12245a';
    if (prev) {
      var img = new Image();
      img.onload = function () { ctx.drawImage(img, 0, 0, rect.width, rect.height); };
      img.src = prev;
    }
  }

  function pos(e) {
    var rect = canvas.getBoundingClientRect();
    var t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  }

  function start(e) {
    e.preventDefault();
    drawing = true;
    last = pos(e);
    if (!hasInk) { hasInk = true; hint.style.display = 'none'; }
  }
  function move(e) {
    if (!drawing) return;
    e.preventDefault();
    var p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last = p;
  }
  function end(e) { if (e) e.preventDefault(); drawing = false; }

  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end, { passive: false });

  clearBtn.addEventListener('click', function () {
    var rect = canvas.getBoundingClientRect();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, rect.width, rect.height);
    hasInk = false;
    hint.style.display = '';
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    msg.className = 'msg';
    msg.textContent = '';
    var name = (document.getElementById('signer').value || '').trim();
    if (!name) { msg.className = 'msg err'; msg.textContent = 'Escribe tu nombre completo.'; return; }
    if (!hasInk) { msg.className = 'msg err'; msg.textContent = 'Firma en el recuadro antes de enviar.'; return; }
    submitBtn.disabled = true;
    submitBtn.textContent = 'Enviando…';
    var signature = canvas.toDataURL('image/jpeg', 0.85);
    fetch(location.pathname, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, signature: signature }),
    }).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, d: d }; });
    }).then(function (res) {
      if (!res.ok) { throw new Error((res.d && res.d.error) || 'No se pudo enviar la firma.'); }
      document.querySelector('.wrap').innerHTML =
        '<header><div class="logo-word" role="img" aria-label="Burocracia Zero"><b>Burocracia</b><span>Zero</span></div></header>'
        + '<div class="ok-card"><div class="ok-check">✓</div><h1>¡Documento firmado!</h1>'
        + '<p class="legal" style="font-size:14px">Gracias. Hemos recibido tu firma correctamente. Ya puedes cerrar esta página.</p></div>';
    }).catch(function (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Firmar y enviar';
      msg.className = 'msg err';
      msg.textContent = err.message;
    });
  });

  fit();
  window.addEventListener('resize', fit);
})();
