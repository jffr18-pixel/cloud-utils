# 🚀 Guía para publicarlo todo en Wix (paso a paso)

Esta es la hoja de ruta ordenada para dejar tu web lista, legal y posicionando en Google.
Hazlo en este orden. Tiempo total aproximado: **1–2 horas** (sin contar redactar reseñas).

> Todo lo que necesitas ya está en esta carpeta:
> - `index.html` → la landing (para incrustar).
> - `CONTENIDOS-WIX.md` → todos los textos por sección (para montar nativo).
> - `TEXTOS-LEGALES.md` y carpeta `legal/` → Aviso Legal, Privacidad y Cookies.
> - `SEO-AVANZADO.md` → títulos, metas, slugs y palabras clave por trámite.
> - `PROPUESTAS-MEJORA.md` y `CONFIANZA-Y-ANTIFRAUDE.md`.

---

## ✅ FASE 1 — Legal + cookies (HAZLO PRIMERO · es obligatorio · ~30 min)

### 1.1 Crear las 3 páginas legales en Wix
1. En el **Editor de Wix**: menú **Páginas** (arriba a la izquierda) → **+ Añadir página** → **Página en blanco**. Crea tres:
   - `Aviso Legal`
   - `Política de Privacidad`
   - `Política de Cookies`
2. En cada página, añade un bloque de texto y **pega el texto correspondiente de `TEXTOS-LEGALES.md`**.
3. **Rellena los datos que faltan** (los que aparecen resaltados en amarillo en las páginas `legal/*.html`):
   - Registro Mercantil de Toledo: **tomo, folio, hoja**.
   - **Nº de inscripción** en el Registro de Sociedades Profesionales.
   - **Capital social**, **nombre del socio colegiado** y **titulación**.
   - (Si no tienes algún dato a mano, pídelo a tu asesor; el resto ya está puesto.)

### 1.2 Activar el banner de cookies (imprescindible)
- En el **Panel de control de Wix** → **Configuración** → **Privacidad y cookies** (o "Banner de cookies") → **actívalo**.
- Enlázalo a tu **Política de Cookies**.
- Comprueba que el botón **"Rechazar"** esté **al mismo nivel** que "Aceptar" y que **no se carguen** cookies de analítica/marketing antes de aceptar. *(Lo exige la AEPD.)*

### 1.3 Enlazar lo legal en el pie
- Añade en el **pie (footer) del sitio** los enlaces **Aviso legal · Política de privacidad · Política de cookies** apuntando a las páginas que acabas de crear.
- Si usas la landing incrustada (Fase 2, opción A), **copia las URLs** de esas 3 páginas y pégalas en el bloque `CONFIG` de `index.html` (`urlAvisoLegal`, `urlPrivacidad`, `urlCookies`).

---

## ✅ FASE 2 — Montar la web (elige A o B)

> **Importante para Google:** la opción A (incrustar HTML en un iframe) se ve genial pero **Google la posiciona mal**. Si quieres **salir de los primeros**, usa la **opción B (nativa)**. Puedes empezar por A para tenerlo ya online y migrar a B con calma.

### Opción A — Rápida: incrustar la landing (no posiciona, pero está ya)
1. `+ Añadir` → **Insertar** (Embed) → **Insertar HTML** → modo **"Código"** → pega TODO el `index.html`.
2. Estíralo a ancho completo y dale alto suficiente. (Detalles y truco de auto-alto en `CONTENIDOS-WIX.md`.)

### Opción B — Recomendada para SEO: secciones nativas de Wix
1. Crea una **página pilar** "Trámites de tráfico" con slug **`/tramites-de-trafico`**.
2. Móntala **sección a sección** copiando los textos de `CONTENIDOS-WIX.md` (Opción B): hero, barra de confianza, 4 trámites, "3 pasos", ventajas, **sección de seguridad/identidad**, FAQ y pie.
3. Aplica tu **marca**: sube tu **logo** real, usa los colores **#C9C8FC** (lila), **#FFEA63** (amarillo), negro y blanco, y botones de **WhatsApp** con el enlace `https://wa.me/34674573447`.
4. **Crea una página por cada trámite principal**, cada una con su propia URL (¡esto es lo que más posiciona!):
   - `/transferencia-vehiculo`, `/cambio-titularidad`, `/matriculacion-vehiculos`, `/importacion-coches`, `/baja-vehiculo`, `/distintivo-ambiental`…
   - Usa los **títulos, metas, H1 y palabras clave** que te dejé en `SEO-AVANZADO.md`.
5. **No olvides la sección de identidad y seguridad** (datos: Burocracia Zero S.L.P., CIF B56918402, colegiado nº 0146, oficina de Toledo + aviso de canales oficiales). Es clave para la confianza y frente a la suplantación.

---

## ✅ FASE 3 — SEO: que te encuentren en Google

1. **Por cada página** (Wix → ⋯ → **SEO** de la página): rellena **Título SEO**, **Descripción**, **URL/slug** y el **texto alternativo (alt)** de las imágenes. Tienes ejemplos listos en `SEO-AVANZADO.md`.
2. **Datos estructurados (JSON-LD):** copia los bloques `LocalBusiness` y `FAQPage` que están al final de `index.html` y pégalos en Wix → **Configuración → SEO (avanzado) → Código personalizado en el `<head>`** (o usa la herramienta de marcado de Wix).
3. **Google Business Profile (lo de MAYOR retorno):** crea/verifica tu ficha con el **mismo** nombre, dirección y teléfono (NAP), añade fotos de la oficina y **pide reseñas** a tus clientes. (Detalle en `SEO-AVANZADO.md`, sección 3.)
4. **Google Search Console:** verifica el sitio y envía el sitemap (Wix lo genera solo).

---

## ✅ FASE 4 — Confianza y anti-suplantación (en paralelo)

- Asegúrate de que la **sección de seguridad** quede visible (canales oficiales).
- Ejecuta el plan de `CONFIANZA-Y-ANTIFRAUDE.md`, empezando por lo **urgente**: reunir pruebas, denunciar el dominio falso al registrador/hosting, reportarlo a Google, y la denuncia ante Policía/Guardia Civil + INCIBE.

---

## ✅ FASE 5 — Revisar antes de pulsar "Publicar"

- [ ] Se ve bien en **móvil** (más de la mitad de tus visitas).
- [ ] Los botones de **WhatsApp** abren el chat al **674 57 34 47**.
- [ ] **Aviso legal, Privacidad y Cookies** enlazados en el pie y con sus datos rellenos.
- [ ] **Banner de cookies** activo y con "Rechazar" visible.
- [ ] Tus **datos oficiales** (CIF, colegiado, oficina) visibles.
- [ ] Cada página tiene su **Título y Descripción SEO**.
- [ ] **Candado HTTPS** (Wix lo trae) y dominio **.es** correcto.

---

### ¿Necesitas ayuda con algún paso?
Dime en cuál te quedas atascado (por ejemplo, "no encuentro dónde activar el banner de cookies" o "ayúdame con el texto de la página de transferencias") y te guío en detalle o te preparo el contenido exacto para pegar.
