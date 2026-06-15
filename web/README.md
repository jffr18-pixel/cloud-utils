# Burocracia Zero — Sitio web

Web estática moderna, rápida y optimizada para SEO para **Burocracia Zero S.L.U.**
(gestoría de trámites administrativos en Toledo). Pensada para sustituir/mejorar la
web actual de Wix, con mejor velocidad de carga, SEO técnico completo y un diseño
profesional orientado a conversión.

## Por qué mejora la web de Wix

| Aspecto | Wix | Esta web |
|---|---|---|
| Velocidad de carga | HTML/JS pesado, scripts de terceros | HTML estático ligero, sin frameworks |
| SEO técnico | Limitado y poco editable | Meta tags, canonical, Open Graph y **datos estructurados JSON-LD** por página |
| Páginas de servicio | Genéricas | Landing dedicada por servicio (mejor posicionamiento por palabra clave) |
| Datos estructurados | Difícil de controlar | `LocalBusiness`, `Service`, `BreadcrumbList` y `FAQPage` (rich snippets en Google) |
| Coste | Suscripción mensual | Hosting estático gratuito o muy barato |
| Core Web Vitals | Difíciles de optimizar | Optimizado (fuentes precargadas, JS diferido, CSS único) |

## Estructura

```
web/
├── index.html                      # Home
├── servicios/
│   ├── extranjeria.html            # Landing SEO: NIE, residencia, nacionalidad
│   ├── fiscal-hacienda.html        # Landing SEO: renta, IVA, Hacienda
│   ├── seguridad-social.html       # Landing SEO: pensiones, incapacidades
│   └── autonomos-empresas.html     # Landing SEO: alta autónomos, sociedades
├── sobre-nosotros.html
├── contacto.html                   # Con formulario
├── aviso-legal.html                # LSSI (texto orientativo)
├── politica-privacidad.html        # RGPD/LOPDGDD (texto orientativo)
├── 404.html
├── css/styles.css                  # Sistema de diseño completo
├── js/main.js                      # Menú móvil, contadores, formulario
├── img/                            # favicon, og-image
├── sitemap.xml
├── robots.txt
└── site.webmanifest
```

## ⚠️ Datos que debes personalizar antes de publicar

Busca y reemplaza estos marcadores en todos los archivos:

- **Teléfono:** `+34 600 000 000` / `34600000000` (enlaces `tel:` y WhatsApp) → tu número real.
- **Email:** `info@burocraciazero.es` → tu email real (si es distinto).
- **Dirección y CIF:** marcadores `[Dirección completa]`, `[CIF de la empresa]` en
  `aviso-legal.html`, `politica-privacidad.html` y el JSON-LD de `index.html`
  (`streetAddress`, `postalCode`).
- **Horario:** revisa `09:00–18:00` por si tu horario es otro.
- **Redes sociales:** sustituye las URL de `facebook.com`, `instagram.com` y
  `linkedin.com` por tus perfiles reales (footer y `sameAs` del JSON-LD).
- **Estadísticas:** las cifras del home (`+3.500 trámites`, `10+ años`, `98%`) son
  orientativas; ajústalas a tus datos reales.
- **Reseñas:** los testimonios son de ejemplo. Sustitúyelos por opiniones reales
  (idealmente de tu ficha de Google).

> Consejo SEO local: mantén el **mismo nombre, dirección y teléfono (NAP)** aquí, en
> tu ficha de Google Business Profile y en directorios. La coherencia mejora el
> posicionamiento local.

## Formulario de contacto

El formulario (`contacto.html`) valida en el navegador y muestra un mensaje de
confirmación, pero **no envía datos a ningún sitio todavía**. Para que lleguen a tu
email, conéctalo a un servicio gratuito (no requiere backend):

- [Formspree](https://formspree.io) o [Web3Forms](https://web3forms.com): cambia el
  atributo `action="#"` del `<form>` por la URL que te den.

## Imagen para compartir en redes (Open Graph)

Está generada en `img/og-image.svg`. Para máxima compatibilidad con Facebook,
WhatsApp y X, exporta una versión **1200×630 px en PNG o JPG** (`img/og-image.jpg`)
y actualiza las metaetiquetas `og:image` (puedes abrir el SVG en el navegador y hacer
captura, o usar una herramienta de diseño).

## Cómo verla en local

```bash
cd web
python3 -m http.server 8080
# Abre http://localhost:8080
```

## Despliegue (hosting gratuito recomendado)

Al ser una web estática, puedes alojarla gratis en:

- **Netlify** o **Vercel**: arrastra la carpeta `web/` o conecta el repositorio.
- **GitHub Pages**, **Cloudflare Pages**.

Luego apunta el dominio `burocraciazero.es` al hosting elegido. Si migras desde Wix,
recuerda configurar redirecciones 301 de las URL antiguas a las nuevas para no perder
posicionamiento.

## Checklist SEO tras publicar

- [ ] Dar de alta el sitio en [Google Search Console](https://search.google.com/search-console) y enviar `sitemap.xml`.
- [ ] Crear/optimizar la ficha de **Google Business Profile** (clave para SEO local en Toledo).
- [ ] Verificar los datos estructurados con el [test de resultados enriquecidos](https://search.google.com/test/rich-results).
- [ ] Medir rendimiento con [PageSpeed Insights](https://pagespeed.web.dev).
- [ ] Configurar las redirecciones 301 desde las URL antiguas de Wix.
