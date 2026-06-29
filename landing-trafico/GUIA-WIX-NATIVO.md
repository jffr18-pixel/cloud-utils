# 🏗️ Guía: montar la versión NATIVA en Wix (la que posiciona en Google)

La diferencia clave: en vez de incrustar el `index.html` dentro de un recuadro (iframe), **reconstruyes el contenido con secciones nativas de Wix**. Es lo que Google indexa bien y lo que te hace salir en las búsquedas.

## 🧩 El truco híbrido (importante)
Casi todo se monta nativo, **menos la calculadora** (es código interactivo). Por eso:
- **Contenido** (hero, trámites, FAQ, comparativa, textos…) → **secciones nativas** de Wix.
- **Calculadora** → un **mini-widget incrustado**: usa el archivo **`calculadora-embed.html`** (ya preparado) en un único elemento "Insertar HTML". Así mantienes la interactividad sin perder el SEO del resto.

---

## 1) Preparar la marca (una vez)
1. **Logo:** sube `assets/logo-burocracia-zero-negro.png` (cabecera) y `...-blanco.png` (pie).
2. **Colores** (Editor → tema/diseño del sitio): negro `#15141c`, lila `#C9C8FC`, amarillo `#FFEA63`, blanco. Pon el **verde de WhatsApp** `#128C7E` para los botones de acción.
3. **Tipografía:** para los títulos, una redondeada tipo **Fredoka / Baloo 2 / Quicksand** (se parece a tu logo); para el texto, una limpia (Inter, Roboto…).

## 2) Estructura de páginas
- **Página PILAR:** "Trámites de tráfico" (puede ser tu **Home** o `/tramites-de-trafico`). Aquí va toda la landing.
- **Una página por trámite** (las 8 de la carpeta `paginas-trafico/`), cada una con su slug. **Esto es lo que más posiciona.**

## 3) Conceptos de Wix que vas a usar
- **Secciones / franjas (strips):** los bloques horizontales de la página.
- **Columnas y cajas:** para repartir contenido.
- **Repetidor (repeater):** ideal para grupos de tarjetas iguales (trámites, ventajas…).
- **Acordeón (accordion):** para la FAQ.
- **Wix Forms:** para el formulario de presupuesto.
- **Botón → enlace WhatsApp:** `https://wa.me/34674573447?text=Hola...`

---

## 4) Montaje sección a sección (landing → Wix)
> Copia los **textos** de `CONTENIDOS-WIX.md` (Opción B) y de `index.html`.

| # | Sección | Cómo montarla en Wix |
|---|---|---|
| 1 | **Cabecera** | Header de Wix: logo a la izquierda + botón **WhatsApp** y teléfono a la derecha. |
| 2 | **Hero** | Franja con fondo lila claro: título (H1), texto, **badge amarillo** "Transferencias en menos de 48 h", 2 botones (**WhatsApp** + **"Calcula tu precio"** que baje a la calculadora) y una lista con ✓. |
| 3 | **Barra de confianza** | Franja fina con 4 puntos (48 h · presupuesto · WhatsApp · Toledo y toda España). |
| 4 | **🧮 Calculadora** | **Insertar HTML** → pega **`calculadora-embed.html`**. Alto ~960 px en escritorio (más en móvil, porque los campos se apilan). Si ves barra de scroll dentro del recuadro, dale más alto. |
| 5 | **Trámites (4)** | Repetidor o 4 cajas: icono + título + texto + botón WhatsApp. **Enlaza cada uno a su página de trámite.** |
| 6 | **Todo digital + vídeo** | 2 columnas: texto + lista a la izquierda; **vídeo** (Wix Video o YouTube) a la derecha. |
| 7 | **Cómo funciona (3 pasos)** | 3 columnas numeradas (1·2·3). |
| 8 | **Ventajas** | 4 puntos con icono. |
| 9 | **Comparativa** | Tabla nativa o repetidor de filas con ✓ (vosotros) y ✗ (otras webs). Si quieres algo más vistoso, hay apps de "comparison table" en el App Market. |
| 10 | **Empresas y flotas** | 4 tarjetas + botón WhatsApp (mensaje para profesionales). |
| 11 | **Quiénes somos** | Foto de **Carmen** + texto + badge "Gestora colegiada nº 0146" + botón. |
| 12 | **Franja CTA** | Franja oscura: título + botón WhatsApp. |
| 13 | **Formulario** | **Wix Forms**: campos Nombre, Teléfono, Email, Trámite (desplegable), Mensaje + **subida de archivos**. Conéctalo a tu email (jose@…). |
| 14 | **Identidad / Seguridad** | Tarjeta con datos verificables (razón social, CIF, colegiada nº 0146, oficina) + recuadro amarillo de **canales oficiales** (anti-suplantación). |
| 15 | **FAQ** | **Acordeón** con las 11 preguntas. |
| 16 | **Footer** | Logo blanco, contacto, enlaces **legales**, identidad SLP. |
| 17 | **Chat flotante** | "Wix Chat" o una app de **botón flotante de WhatsApp** (sustituye a la burbuja). |

## 5) Páginas por trámite (clave SEO)
Por cada archivo de `paginas-trafico/`:
1. Crea una **página nueva** con su **slug** (ej. `/transferencia-vehiculo`).
2. Pega el contenido (intro, documentos, precio/CTA, cómo funciona, FAQ).
3. En **SEO de la página**: copia el **Título** y la **Meta descripción** de la tabla "Ajustes SEO" del archivo.
4. **Enlázalas** desde la página pilar y entre trámites relacionados.

## 6) SEO técnico
- **Por página:** Título, Descripción, **slug** y **texto alternativo (alt)** de imágenes (tienes ejemplos en `SEO-AVANZADO.md`).
- **Datos estructurados:** copia los bloques `LocalBusiness` y `FAQPage` del final de `index.html` y pégalos en **Configuración → SEO (avanzado) → código en el `<head>`**.
- **Google Search Console** + sitemap (Wix lo genera) + **Google Business Profile**.

## 7) Legal y cookies
- Crea las **3 páginas legales** (`TEXTOS-LEGALES.md`) y **activa el banner de cookies** (ver `GUIA-COOKIES-Y-LEGAL-WIX.md`).

---

## ✅ Orden recomendado
1. Marca (logo + colores + tipografía).
2. Página **pilar** con sus secciones (textos de `CONTENIDOS-WIX.md`).
3. **Widget de la calculadora** (`calculadora-embed.html`).
4. **Wix Forms** (presupuesto).
5. **Páginas por trámite** + SEO de cada una.
6. **Legal + cookies**.
7. **Google Business + reseñas**.

## 🐢 ¿Te agobia montarlo todo nativo de golpe?
Atajo válido: **publica ya** incrustando el `index.html` completo (rápido), y ve pasando a **nativo** primero las páginas que más posicionan (la **pilar** y **`/transferencia-vehiculo`**). Tendrás la web online desde el día 1 y mejoras el SEO poco a poco.

> ¿Quieres que te detalle **una sección concreta** clic a clic (por ejemplo, montar el hero o el formulario con Wix Forms)? Dímelo y te hago el paso a paso.
