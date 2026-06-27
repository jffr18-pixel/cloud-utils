# Plan SEO — Burocracia Zero (trámites de tráfico)

# PLAN SEO LOCAL Y DE SERVICIOS — Burocracia Zero (Tramites de Trafico)

## 0. ADVERTENCIA HONESTA (LEER ANTES DE NADA): el iframe NO posiciona

> **Esto es lo mas importante del documento.** Si solo lees una seccion, lee esta.

Tu landing esta pensada para incrustarse en Wix mediante **"Insertar HTML" (elemento iframe / embed)**. Tienes que saber, sin rodeos, lo siguiente:

- **Google indexa muy mal el contenido que vive dentro de un iframe.** Cuando metes una landing externa en un `<iframe>`, Google ve en la pagina de Wix un simple "hueco" que carga *otra URL*. El texto, los titulos (H1/H2), las imagenes y las palabras clave de esa landing **se atribuyen a la URL del iframe, no a tu pagina de Wix**. Resultado: tu pagina de Wix queda practicamente vacia de contenido a ojos de Google, y la landing incrustada, al no ser una URL que la gente enlace ni que Wix declare en su sitemap, tampoco posiciona por su cuenta.
- **Pierdes lo que mas pesa en SEO:** un solo H1 relevante por pagina, jerarquia de encabezados, texto rastreable en el HTML de *tu* dominio, enlaces internos hacia y desde esa pagina, y los datos estructurados asociados a tu URL real.
- **Conclusion practica:** el iframe sirve para *funcionalidades* (un formulario, un configurador de presupuesto, un widget de pago, un chat), **no para el contenido que quieres posicionar**.

**Que hacer en su lugar (esto es lo que SI posiciona):**

1. **Monta el contenido como SECCIONES NATIVAS de Wix** (pagina propia del editor Wix con sus bloques de texto, encabezados e imagenes nativas), **o como una pagina propia** dentro del sitio. Asi el texto vive en el HTML de `burocraciazero.es/...` y Google lo rastrea e indexa con normalidad.
2. **Reserva el iframe solo para el widget funcional** (p. ej. el formulario de solicitud de transferencia o el calculador de presupuesto), **incrustado dentro** de una pagina nativa que ya tiene su H1, su texto y sus metas reales.
3. **Si te empenas en usar la landing externa,** entonces que tenga su *propia* URL pensada para indexarse (sitemap, metas, canonical, enlaces), y aun asi enlazala desde Wix con un enlace normal, **no la escondas dentro de un iframe**.

Regla de oro: **una pagina = una URL de tu dominio con su H1, su texto rastreable y sus metas. El iframe es para herramientas, no para SEO.**

---

## 1. MAPA DE PALABRAS CLAVE por intencion y por tramite

Leyenda de intencion: **[T]** transaccional (quiere contratar/hacer el tramite) · **[C]** comercial (compara, busca precio/gestoria) · **[I]** informacional (busca informacion, ideal para blog/FAQ).

### 1.1 Transferencia / cambio de titularidad
| Variante | Intencion |
|---|---|
| transferencia de vehiculo online | T |
| cambio de titularidad coche | T |
| gestoria transferencia vehiculo Toledo | C / local |
| cuanto cuesta una transferencia de coche | C / I |
| transferencia de coche entre particulares | I |
| cambio de nombre de un coche | I |
| transferir un coche sin desplazarte / 100% online | T |
| transferencia de moto | T |
| cambio de titularidad ciclomotor | T |
| precio transferencia vehiculo 2026 | C |
| documentos para transferir un coche | I (long-tail) |

### 1.2 Notificacion de venta
| Variante | Intencion |
|---|---|
| notificacion de venta DGT | T |
| como notificar la venta de un coche | I |
| notificar venta vehiculo online | T |
| comprador no ha hecho el cambio de nombre que hago | I (long-tail) |
| me siguen llegando multas de un coche que vendi | I (long-tail) |
| notificacion de venta gestoria Toledo | C / local |

### 1.3 Matriculacion
| Variante | Intencion |
|---|---|
| matriculacion de vehiculo | T |
| matricular coche nuevo / de segunda mano | T |
| gestoria matriculacion Toledo | C / local |
| matricular un coche importado | T |
| cuanto cuesta matricular un coche | C / I |
| matriculacion de remolque / quad / motocicleta | T |

### 1.4 Importacion de coches
| Variante | Intencion |
|---|---|
| importar coche de Alemania a Espana | T (alto valor) |
| matriculacion de coche importado | T |
| tramites para importar un vehiculo | I |
| impuesto de matriculacion coche importado | I |
| gestoria importacion vehiculos online | C |
| homologacion vehiculo importado | I |
| importar coche de Francia/Italia a Espana | T |

### 1.5 Baja de vehiculo
| Variante | Intencion |
|---|---|
| baja de vehiculo DGT | T |
| baja definitiva coche | T |
| baja temporal vehiculo | T |
| dar de baja un coche para desguace | T |
| baja de coche por exportacion | T |
| gestoria baja vehiculo Toledo | C / local |

### 1.6 Distintivo ambiental
| Variante | Intencion |
|---|---|
| distintivo ambiental DGT | T |
| etiqueta medioambiental coche | T |
| que etiqueta ambiental me corresponde | I |
| comprar distintivo ambiental online | T |
| etiqueta ECO / C / B coche | I |
| distintivo ambiental Toledo | local |

### 1.7 Duplicado del permiso de circulacion
| Variante | Intencion |
|---|---|
| duplicado permiso de circulacion | T |
| he perdido el permiso de circulacion | I (long-tail) |
| duplicado ficha tecnica | T |
| duplicado permiso circulacion online | T |
| permiso de circulacion robado que hago | I |

### 1.8 Informe DGT
| Variante | Intencion |
|---|---|
| informe DGT de un vehiculo | T |
| informe de matricula antes de comprar coche | C / I |
| informe de vehiculo cargas y embargos | T |
| comprobar historial de un coche por matricula | I |
| informe reducido DGT | T |

### 1.9 Cabecera (pilar) y marca
| Variante | Intencion |
|---|---|
| gestoria de trafico online | C |
| tramites DGT online | C |
| gestoria de trafico Toledo | C / local |
| gestoria vehiculos Toledo | C / local |
| Burocracia Zero | navegacional (marca) |

---

## 2. ARQUITECTURA WEB (pilar + paginas por tramite)

**Modelo pilar/cluster.** Una pagina pilar enlaza a cada pagina de tramite, y cada pagina de tramite enlaza de vuelta al pilar y a su contenido de blog relacionado.

### 2.1 Pagina PILAR
- **Slug:** `/tramites-de-trafico`
- **Title:** `Tramites de Trafico Online y en Toledo | Burocracia Zero` (≤ 60 car.)
- **Meta description:** `Gestoria de trafico 100% online para toda Espana, con oficina en Toledo. Transferencias, bajas, matriculaciones, informes DGT y mas. Sin colas ni desplazamientos.`
- **H1:** `Tramites de trafico online, rapidos y sin colas`
- **H2 sugeridos:** Que tramites gestionamos · Como trabajamos (100% digital) · Por que elegir Burocracia Zero · Precios y tiempos · Atendemos en toda Espana (oficina en Toledo) · Preguntas frecuentes
- Enlaza con tarjeta/boton a cada una de las 8 paginas de tramite.

### 2.2 Paginas por tramite (una URL nativa por tramite)

| Tramite | Slug recomendado | H1 sugerido |
|---|---|---|
| Transferencia / cambio titularidad | `/transferencia-vehiculo` | Transferencia de vehiculo online (cambio de titularidad) |
| Notificacion de venta | `/notificacion-de-venta` | Notificacion de venta a la DGT |
| Matriculacion | `/matriculacion-vehiculo` | Matriculacion de vehiculos |
| Importacion de coches | `/importacion-vehiculos` | Importacion y matriculacion de vehiculos extranjeros |
| Baja de vehiculo | `/baja-vehiculo` | Baja de vehiculo (definitiva, temporal y por desguace) |
| Distintivo ambiental | `/distintivo-ambiental` | Distintivo ambiental DGT (etiqueta medioambiental) |
| Duplicado permiso circulacion | `/duplicado-permiso-circulacion` | Duplicado del permiso de circulacion |
| Informe DGT | `/informe-dgt` | Informe DGT de un vehiculo por matricula |

**Estructura interna recomendada para CADA pagina de tramite (H2):**
1. Que es / cuando lo necesitas
2. Que necesitas (documentacion) — usa lista
3. Como lo hacemos 100% online (paso a paso)
4. Precio y tiempo de gestion
5. Preguntas frecuentes (con marcado FAQPage)
6. CTA: solicitar por WhatsApp 674 57 34 47 / formulario

### 2.3 Ejemplos concretos de Title + Meta (3)

**Transferencia (`/transferencia-vehiculo`)**
- **Title:** `Transferencia de Vehiculo Online | Cambio de Titularidad | Burocracia Zero`
- **Meta:** `Transferimos tu coche o moto 100% online en toda Espana. Cambio de titularidad sin colas ni desplazamientos. Presupuesto sin compromiso. Oficina en Toledo.`

**Importacion (`/importacion-vehiculos`)**
- **Title:** `Importar y Matricular Coche Extranjero en Espana | Burocracia Zero`
- **Meta:** `Gestionamos la importacion y matriculacion de tu vehiculo de Alemania, Francia o Italia. Homologacion, impuestos y matricula espanola. Online, en toda Espana.`

**Informe DGT (`/informe-dgt`)**
- **Title:** `Informe DGT de un Vehiculo por Matricula | Cargas y Embargos | Burocracia Zero`
- **Meta:** `Solicita el informe DGT antes de comprar un coche de segunda mano: cargas, embargos, historial y ITV. Entrega rapida online en toda Espana.`

> Reglas: Title ≤ ~60 caracteres visibles (marca al final), Meta 140-155 caracteres, 1 keyword principal por pagina en Title + H1 + primer parrafo + slug.

---

## 3. SEO LOCAL — Google Business Profile (lo de mayor ROI)

> **Quick win #1.** Es lo que mas rapido mueve la aguja para "gestoria de trafico Toledo".

- **Ficha:** crea/reclama el **perfil de empresa de Google (Google Business Profile)**.
- **Categoria principal:** `Gestoria` (o "Asesoria"). **Categorias secundarias:** "Servicio de matriculacion de vehiculos", "Oficina de la administracion publica" si encaja, "Asesoria fiscal/administrativa".
- **NAP coherente (igual al pie de pagina del sitio, al caracter):**
  - Nombre: `Burocracia Zero`
  - Direccion: `Calle Rio Alberche, 38 (Tiendas G), Local 32, 45007 Toledo`
  - Telefono: `674 57 34 47`
  - Web: `https://www.burocraciazero.es`
- **Area de servicio:** ademas de la direccion fisica, declara **"toda Espana"** como zona de servicio (encaja con tu modelo online).
- **Atributos y servicios:** lista cada tramite como "servicio" dentro de la ficha (Transferencia, Baja, Matriculacion, Informe DGT, Distintivo ambiental...).
- **Resenas:** pide resena a cada cliente al cerrar el tramite (link directo de resena por WhatsApp). Objetivo realista: **+2-4 resenas/mes**, responde a TODAS (positivas y negativas) mencionando el tramite y "Toledo / online".
- **Fotos:** fachada/local, logo, equipo, capturas del proceso online. Sube 1-2 al mes (la actividad cuenta).
- **Publicaciones (Posts):** 1 post semanal o quincenal: ofertas, "ya puedes transferir tu coche sin moverte", recordatorios (fin de plazo etiqueta ambiental, etc.).
- **Mensajes/WhatsApp:** activa el boton de mensajes apuntando a tu WhatsApp.

**Citations / directorios (NAP IDENTICO en todos):**
- Bing Places, Apple Business Connect (Apple Maps).
- Paginas Amarillas, QDQ, Cylex, Infobel, Yelp Espana.
- Directorios de gestorias/sector y guias locales de Toledo (camara de comercio, asociaciones de comercio del barrio "Tiendas G").
- Perfiles sociales con NAP completo: Facebook, Instagram, LinkedIn de empresa, Google Maps.
- **Consistencia NAP:** un solo formato exacto de nombre, direccion y telefono **en TODAS partes** (web, GBP, directorios, redes, facturas). Las incoherencias diluyen el SEO local.

---

## 4. CONTENIDO — Blog / FAQ para long-tail (captacion informacional)

Cada articulo enlaza a su pagina de tramite (intencion transaccional). Ideas priorizadas:

**Transferencia / titularidad**
- "Que necesito para transferir un coche en 2026" (documentos, pasos)
- "Cuanto cuesta cambiar de titular una moto"
- "Transferir un coche entre familiares: como funciona"
- "Que pasa si compro un coche y no hago el cambio de nombre"

**Notificacion de venta**
- "Vendi mi coche y me siguen llegando multas: que hacer"
- "Como notificar la venta de un coche a la DGT (paso a paso)"

**Importacion**
- "Como importar un coche de Alemania a Espana: guia completa"
- "Cuanto cuesta matricular un coche importado (impuestos incluidos)"

**Baja**
- "Baja temporal vs baja definitiva: cual me conviene"
- "Como dar de baja un coche para el desguace"

**Distintivo ambiental**
- "Que etiqueta medioambiental le corresponde a mi coche"
- "Coches sin etiqueta ambiental: que puedo hacer"

**Informe DGT / duplicado**
- "Como saber si un coche de segunda mano tiene cargas o embargos"
- "He perdido el permiso de circulacion: como pedir un duplicado"

**Formato FAQ:** en cada pagina de tramite, 4-6 preguntas reales ("cuanto tarda", "que necesito", "cuanto cuesta", "puedo hacerlo sin ir a Toledo") marcadas con **FAQPage** (ver seccion 6). Esto capta featured snippets y "People Also Ask".

---

## 5. TECNICO EN WIX

**Title tags y metas (Wix → SEO de cada pagina):**
- Edita en cada pagina: SEO básico → Título y Descripción (los de la seccion 2). Personaliza, no dejes la plantilla automatica de Wix.

**Slugs:**
- En Wix, "URL de la pagina": usa los slugs cortos de la seccion 2.2 (sin acentos, con guiones, sin palabras vacias). Evita `/copia-de-...` y URLs auto-generadas.

**Encabezados:**
- **Un solo H1 por pagina** (titulo del tramite). Subtitulos como H2/H3 reales con el selector de Wix, **no** texto grande "fingiendo" ser encabezado.

**Alt de imagenes:**
- Describe + keyword local cuando aplique: `transferencia de vehiculo online gestoria Toledo`, `etiqueta medioambiental DGT coche`. Sin "sobreoptimizar" (alt natural).

**Sitemap y robots:**
- Wix genera el sitemap automaticamente (`/sitemap.xml`). Envialo en **Google Search Console** y verifica el dominio. Comprueba que las 8 paginas de tramite + pilar + blog estan dentro.
- Asegura que las paginas estan **indexables** (en Wix SEO, casilla "Permitir que los buscadores indexen esta pagina" activada).

**Datos estructurados (Schema):**
- **LocalBusiness** (a nivel de sitio/home): nombre, direccion completa, telefono, geo, horario, URL. Wix permite añadir schema personalizado por pagina (Configuracion SEO → Datos estructurados / Markup personalizado).
- **Service** en cada pagina de tramite (tipo de servicio + areaServed: Espana).
- **FAQPage** en las preguntas frecuentes de cada pagina (esto si suele dar resultado visible en SERP).
- **BreadcrumbList** para la jerarquia pilar → tramite.

Ejemplo minimo de LocalBusiness (ajusta horario/geo):
```json
{
  "@context": "https://schema.org",
  "@type": "LegalService",
  "name": "Burocracia Zero",
  "image": "https://www.burocraciazero.es/logo.png",
  "url": "https://www.burocraciazero.es",
  "telephone": "+34674573447",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "Calle Rio Alberche, 38 (Tiendas G), Local 32",
    "postalCode": "45007",
    "addressLocality": "Toledo",
    "addressRegion": "Toledo",
    "addressCountry": "ES"
  },
  "areaServed": "ES",
  "priceRange": "€€"
}
```

**Velocidad:**
- Comprime imagenes antes de subir (WebP, < 200 KB), no uses imagenes gigantes escaladas. Limita apps/animaciones de Wix que ralenticen. Mide con **PageSpeed Insights**; Wix es pesado por defecto, cada KB cuenta.

**Movil:**
- Revisa CADA pagina en el editor movil de Wix (Wix maqueta movil aparte): que el H1, el texto y el CTA de WhatsApp se vean sin scroll lateral. La mayoria de busquedas "gestoria Toledo" son moviles.

**Otros tecnicos:**
- HTTPS (lo da Wix) y **una sola version canonica** (con o sin `www`, redirige la otra).
- Enlazado interno: pilar ↔ tramites ↔ blog. Cada articulo enlaza a su pagina de tramite con anchor descriptivo.

---

## 6. OFF-PAGE / AUTORIDAD Y RESENAS

- **Resenas (lo primero):** sistematiza pedir resena en Google al cerrar cada tramite (mensaje WhatsApp con tu link de resena). El volumen y la frescura de resenas pesan en local pack.
- **Reseñas tambien fuera de Google:** Facebook, y si aplica, plataformas tipo Trustpilot para reforzar reputacion.
- **Enlaces locales:** asociacion de comercio del barrio "Tiendas G" / Toledo, camara de comercio, prensa local de Toledo (nota de prensa "gestoria 100% digital en Toledo"), blogs locales.
- **Enlaces de sector/utilidad:** colaboraciones con concesionarios, compraventas y talleres de Toledo y alrededores (te derivan clientes y, idealmente, un enlace desde su web).
- **Contenido enlazable:** una guia muy completa ("Guia 2026 para importar un coche a Espana") atrae enlaces naturales mejor que una pagina comercial.
- **Perfiles y menciones de marca:** NAP consistente en cada perfil; las menciones de marca (aunque no enlacen) ayudan al SEO local.
- **Evita** comprar enlaces basura o directorios spam: en SEO local de servicios hacen mas mal que bien.

---

## 7. PRIORIZACION (haz esto en este orden)

**Semana 1-2 (quick wins, maximo ROI):**
1. Crear/optimizar **Google Business Profile** con NAP exacto, categoria, servicios, fotos. (Seccion 3)
2. Verificar dominio en **Google Search Console** y enviar sitemap. (Seccion 5)
3. Crear la **pagina pilar nativa** `/tramites-de-trafico` con su Title/Meta/H1 reales. (Seccion 2.1)
4. **Decidir:** contenido como secciones nativas de Wix; reservar el iframe solo para el widget funcional. (Seccion 0)

**Semana 3-6:**
5. Crear las **8 paginas de tramite** nativas con su Title/Meta/H1/H2 y FAQ. (Seccion 2.2)
6. Anadir **schema** LocalBusiness + FAQPage + Service. (Seccion 6)
7. Sistematizar **peticion de resenas** por WhatsApp. (Seccion 6/3)

**Mes 2-3 (autoridad y long-tail):**
8. Publicar **2-4 articulos de blog/mes** del listado de la seccion 4, enlazando a su tramite.
9. Citations/directorios con NAP identico + enlaces locales de Toledo. (Seccion 3/6)
10. Medir en GSC (impresiones/clics por tramite) y reforzar las paginas que ya rozan el top 10.

---

> **Datos del negocio a confirmar para completar fichas y schema:** [RAZON SOCIAL / NOMBRE DEL TITULAR], [NIF/CIF], [DOMICILIO FISCAL SI DIFIERE], [DATOS REGISTRALES SI ES SOCIEDAD], [NUMERO DE COLEGIADO SI APLICA], [HORARIO DE ATENCION], [COORDENADAS GEO DEL LOCAL].
