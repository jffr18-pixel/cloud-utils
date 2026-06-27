# 🍪⚖️ Guía clic a clic: páginas legales + banner de cookies en Wix

Objetivo: dejar publicadas tus 3 páginas legales y el banner de cookies, que es **obligatorio** (RGPD/LSSI).
Tiempo: ~30 minutos. No necesitas saber de informática.

> Wix va cambiando los menús de sitio. Si un nombre no es exacto, usa el **buscador del panel** (icono de lupa) y escribe *"cookies"* o *"páginas"*.

---

## PARTE 1 — Publicar las 3 páginas legales

### Paso 1. Crear las páginas
1. Entra en tu sitio y pulsa **Editar sitio** (abre el Editor de Wix).
2. En la barra izquierda, abre **Páginas y menú** (icono de hojas).
3. Pulsa **+ Añadir página** → **Página en blanco**. Ponle nombre: **Aviso Legal**.
4. Repite para **Política de Privacidad** y **Política de Cookies**.

### Paso 2. Pegar el texto
1. Abre la página **Aviso Legal**.
2. Pulsa **+ Añadir** → **Texto** → **Párrafo de texto**, y colócalo en la página.
3. Abre el archivo **`TEXTOS-LEGALES.md`**, copia el bloque de **AVISO LEGAL** y pégalo en ese cuadro de texto.
4. **Rellena lo que falta** (lo marcado en amarillo en las páginas `legal/*.html`): tomo/folio/hoja del Registro Mercantil, nº de inscripción en el Registro de Sociedades Profesionales, capital social, nombre del socio colegiado y titulación.
5. Repite con **Política de Privacidad** y **Política de Cookies** (cada texto en su página).

> 💡 Atajo: si no quieres montar el texto a mano, puedes **incrustar** las páginas ya diseñadas de la carpeta `legal/` con **+ Añadir → Insertar → Insertar HTML** (una por página). Aun así, tendrás que sustituir los datos en amarillo.

### Paso 3. (Recomendado) Ocultarlas del menú principal
1. En **Páginas y menú**, pasa el ratón sobre cada página legal → **⋯** → **Configuración**.
2. En **General**, desactiva **"Mostrar en el menú"** (irán solo en el pie, que es lo normal).

### Paso 4. Enlazarlas en el pie (footer)
1. En el Editor, baja al **pie de página** y haz clic en él.
2. Añade (o edita) un texto con: **Aviso legal · Política de privacidad · Política de cookies**.
3. Selecciona "Aviso legal" → icono de **enlace** 🔗 → **Página** → elige *Aviso Legal*. Repite con las otras dos.
4. Si además usas la landing incrustada (`index.html`), copia la **URL** de cada página (la verás al publicarlas) y pégalas en el bloque `CONFIG`: `urlAvisoLegal`, `urlPrivacidad`, `urlCookies`.

---

## PARTE 2 — Activar el banner de cookies

Wix tiene su propio banner de consentimiento (es la forma correcta, porque **es Wix quien instala las cookies** del sitio).

### Paso 1. Abrir la configuración de cookies
1. Ve al **Panel de control** del sitio (Dashboard), no al editor.
2. Menú **Configuración** (Settings) → busca **"Privacidad y cookies"** / **"Banner de cookies"** (o escribe *cookies* en el buscador del panel).

### Paso 2. Encender el banner
1. **Activa** el banner de consentimiento de cookies.
2. Elige el modo que **pida consentimiento ANTES** de cargar analítica/marketing (en Wix suele llamarse "avanzado" o "pedir consentimiento"). Esto bloquea esas cookies hasta que el usuario acepta.
3. Asegúrate de que aparezcan **categorías** (Esenciales, Funcionales, Analíticas, Marketing) y de que el usuario pueda **aceptar, rechazar y configurar**.

### Paso 3. Texto y enlace del banner
1. En el texto del banner, añade un enlace a tu **Política de Cookies**.
2. **Muy importante (AEPD):** el botón **"Rechazar"** debe verse **igual de fácil** que "Aceptar" (mismo tamaño/nivel), no escondido.

### Paso 4. Botón fijo para cambiar de opinión
- Deja visible (normalmente en el pie) un enlace tipo **"Configuración de cookies"** que reabra el panel, para que cualquiera pueda **retirar el consentimiento** cuando quiera. Wix suele ofrecer este reabridor; actívalo.

### Paso 5. Comprobar
1. **Publica** y abre tu web en una **ventana de incógnito**.
2. Verifica que el banner aparece, que "Rechazar" funciona y que, sin aceptar, **no** se cargan cookies de analítica/marketing.

---

## ✅ Checklist final
- [ ] 3 páginas legales publicadas y con los datos en amarillo rellenados.
- [ ] Enlazadas en el pie del sitio.
- [ ] Banner de cookies activo, con "Rechazar" al mismo nivel que "Aceptar".
- [ ] Enlace a la Política de Cookies dentro del banner.
- [ ] Botón "Configuración de cookies" para revocar el consentimiento.
- [ ] Probado en incógnito.

¿Te atascas en algún paso? Dime cuál y te lo detallo (incluso te digo qué datos exactos poner en cada hueco amarillo).
