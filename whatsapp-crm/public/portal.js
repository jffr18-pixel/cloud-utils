'use strict';

// Portal del cliente: sube los documentos pendientes desde la página de
// seguimiento. El token va en el contenedor .wrap[data-token]; cada input de
// archivo lleva data-case y data-item. Al terminar, recarga para reflejar el
// nuevo estado (checklist actualizado).

(function () {
  const wrap = document.querySelector('.wrap[data-token]');
  if (!wrap) return;
  const token = wrap.getAttribute('data-token');
  if (!token) return;
  const msgUploading = wrap.getAttribute('data-uploading') || 'Subiendo…';
  const msgError = wrap.getAttribute('data-uploaderr') || 'No se pudo subir el archivo.';

  function readAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(new Error('read'));
      reader.readAsDataURL(file);
    });
  }

  wrap.addEventListener('change', async (e) => {
    const input = e.target;
    if (!input.matches('input[type="file"][data-case]')) return;
    const file = input.files && input.files[0];
    if (!file) return;
    const label = input.closest('.up-btn');
    const original = label ? label.textContent : '';
    if (label) { label.classList.add('busy'); label.textContent = msgUploading; }
    try {
      const dataBase64 = await readAsBase64(file);
      const resp = await fetch('/estado/' + encodeURIComponent(token) + '/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseId: input.getAttribute('data-case'),
          itemIndex: Number(input.getAttribute('data-item')),
          filename: file.name,
          mime: file.type || 'application/octet-stream',
          dataBase64,
        }),
      });
      if (!resp.ok) {
        const info = await resp.json().catch(() => ({}));
        throw new Error(info.error || msgError);
      }
      // Éxito: recargar para mostrar el ítem marcado como recibido.
      location.reload();
    } catch (err) {
      alert(err.message || msgError);
      if (label) { label.classList.remove('busy'); label.textContent = original; }
      input.value = '';
    }
  });
})();
