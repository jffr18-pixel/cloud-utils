# Landing «Trámites de Tráfico» — Burocracia Zero

Este paquete tiene **dos formas de usarse**, tal y como pediste:

1. **`index.html`** → landing ya diseñada y lista para **pegar en Wix** (widget *Insertar HTML*).
2. **Este documento** → todos los **textos** + un **mapa de diseño** por si prefieres montarla con **secciones nativas de Wix** (mejor para SEO/Google) + ajustes de SEO.

Colores de marca usados: lila `#C9C8FC`, amarillo `#FFEA63`, negro `#15141c`, blanco `#FFFFFF`.
Estilo: minimalista y sobrio. Acción principal: **WhatsApp**.

## 📁 Archivos de este paquete

| Archivo | Para qué sirve |
|---|---|
| `index.html` | La landing lista para incrustar en Wix (o abrir en el navegador). |
| `CONTENIDOS-WIX.md` | Este documento: textos + cómo montarla en Wix + SEO básico. |
| `TEXTOS-LEGALES.md` | Aviso Legal, Privacidad y Cookies para copiar/pegar + checklist de datos a rellenar. |
| `legal/aviso-legal.html` · `legal/politica-privacidad.html` · `legal/politica-cookies.html` | Las 3 páginas legales ya diseñadas con el estilo de la web. |
| `SEO-AVANZADO.md` | Plan SEO detallado por trámite (local Toledo + nacional) para salir en Google. |
| `PROPUESTAS-MEJORA.md` | Propuestas de mejora priorizadas (conversión, captación, automatización…). |

---

## ✅ Tus datos ya están metidos

| Dato | Valor aplicado |
|---|---|
| Empresa | Burocracia Zero |
| Teléfono | 674 57 34 47 |
| WhatsApp | 674 57 34 47 (`34674573447`) |
| Email | jose@burocraciazero.es |
| Dirección | Calle Río Alberche, 38 (Tiendas G), Local 32, 45007 Toledo |
| Horario | L–V de 10:00 a 14:00 y de 17:00 a 20:00 |
| Eslogan | Transferencias en menos de 48 h |
| Precios | «Presupuesto sin compromiso» (sin importe fijo) |

> **¿Quieres cambiar algo más adelante?** En `index.html`, casi al final, hay un bloque llamado **`CONFIG`**. Es lo **único** que tienes que editar: cambia ahí el teléfono, WhatsApp, email, horario o precios y toda la página se actualiza sola. No hace falta tocar el diseño.

Para mostrar precios concretos en las tarjetas, en `CONFIG.precios` cambia
`"Presupuesto sin compromiso"` por, por ejemplo, `"Desde 60 €"`. Si pones `""` (vacío), esa línea de precio desaparece.

---

## 🧩 OPCIÓN A — Pegar el HTML en Wix (lo más rápido)

Wix ejecuta el HTML dentro de un recuadro (un *iframe*). Pasos:

1. Entra en tu sitio → **Editar sitio**.
2. Crea una página nueva (recomendado) o ve a la página donde quieras la landing.
3. Pulsa **`+` Añadir** → **Insertar** (Embed) → **Insertar HTML** (en Wix se llama *Insertar un código* / *Embed HTML*).
4. En el recuadro elige **«Código»** (no «Sitio web») y **pega TODO el contenido de `index.html`**.
5. Pulsa **Actualizar / Aplicar**.
6. **Estira el widget** a lo ancho de la página y dale **bastante alto** (la landing es larga; arrástralo hasta que se vea entera sin barra de scroll interna).

### ⚠️ El "problema del alto" del iframe (y cómo resolverlo)
El widget *Insertar HTML* tiene un alto fijo. Si lo dejas corto, aparece una barra de scroll dentro del recuadro (queda feo). Dos soluciones:

- **Sencilla (sin programar):** arrastra el alto del widget hasta que quepa toda la landing. Revisa también en **móvil** (icono del teléfono arriba en el editor) y ajusta el alto en esa vista.
- **Automática (recomendada si te manejas un poco):** el `index.html` ya **envía su altura** al contenedor con `postMessage`. Si activas **Velo** (Dev Mode) en Wix, puedes auto-ajustar el alto con este código en la página:

  ```javascript
  // Velo - página: ajusta el alto del HtmlComponent al contenido de la landing
  // Cambia "#html1" por el ID real de tu elemento Insertar HTML.
  $w.onReady(() => {
    $w("#html1").onMessage((event) => {
      if (event.data && event.data.type === "bz-landing-height") {
        $w("#html1").height = event.data.height;
      }
    });
  });
  ```

> **Nota SEO:** lo que va dentro de un iframe Google lo indexa peor. Si esta landing es importante para posicionar en Google («gestoría Toledo transferencias», etc.), usa la **Opción B** (secciones nativas) para el contenido principal, o duplica los textos clave fuera del iframe.

---

## 🏗️ OPCIÓN B — Montar la landing con secciones nativas de Wix (mejor SEO)

Crea una página en blanco y ve añadiendo **tiras/secciones** de arriba abajo con este orden y estos textos. Usa los colores de marca arriba indicados.

### 1. Cabecera (Header de Wix)
- Logo de Burocracia Zero (sube tu imagen real).
- Botón a la derecha: **WhatsApp** → enlace `https://wa.me/34674573447?text=Hola,%20quiero%20informaci%C3%B3n%20sobre%20vuestros%20tr%C3%A1mites%20de%20tr%C3%A1fico.`
- (Opcional) Teléfono clicable: `tel:+34674573447`

### 2. Sección Hero (la primera pantalla)
- **Etiqueta (chip amarillo):** `⚡ Transferencias en menos de 48 h`
- **Antetítulo:** `Gestoría en Toledo · Online en toda España`
- **Título (H1):** `Tus trámites de tráfico, hechos por nosotros. Tú, sin colas.`
- **Texto:** `Transferencias, matriculaciones, bajas y trámites con la DGT gestionados de principio a fin. Trabajamos de forma 100% digital y por eso podemos hacer tus trámites de tráfico en toda España: solo nos envías la documentación por WhatsApp y nosotros nos encargamos del resto.`
- **Botón principal (verde WhatsApp):** `Consulta gratis por WhatsApp` → mismo enlace wa.me de arriba.
- **Botón secundario:** `Ver trámites` → ancla a la sección de trámites.
- **Lista de confianza (con ✓):** `Sin desplazamientos` · `Gestión 100% online` · `Toda España` · `Precio cerrado`

### 3. Barra de confianza (tira fina)
`⚡ Transferencias en menos de 48 h` · `Presupuesto sin compromiso` · `Atención personal por WhatsApp` · `Toledo y toda España`

### 4. Sección «Trámites que gestionamos» (4 tarjetas)
**Título (H2):** `Trámites de tráfico que gestionamos`
**Subtítulo:** `Elige tu trámite y escríbenos. Te decimos el precio cerrado y exactamente qué documentos necesitas.`

**Tarjeta 1 — Transferencias y cambio de titularidad**
> Compraventa de coches, motos, ciclomotores, remolques y caravanas. La transferencia (cambio de titularidad) pone el vehículo a nombre del comprador; la notificación de venta libera al vendedor de multas y responsabilidad. Son trámites distintos: te asesoramos sobre cuál necesitas, sin que tengas que ir a la jefatura.
> Etiquetas: Compraventa · Notificación de venta · Transferencia por herencia · Ciclomotores
> Botón: `Solicitar transferencia →` (WhatsApp con mensaje: *"Hola, quiero hacer una TRANSFERENCIA / cambio de titularidad de un vehículo."*)

**Tarjeta 2 — Matriculaciones e importación**
> Matrícula de vehículos nuevos, de importación (UE y fuera de la UE), rematriculaciones y matrículas históricas para clásicos. Gestionamos el impuesto de matriculación cuando corresponda (muchos vehículos están exentos según emisiones) y te informamos del IVA o aranceles en las importaciones.
> Etiquetas: Vehículos nuevos · Importación · Históricas · Rematriculación
> Botón: `Matricular mi vehículo →` (mensaje: *"Hola, necesito MATRICULAR / importar un vehículo."*)

**Tarjeta 3 — Bajas de vehículos**
> Baja definitiva por desguace (CAT), baja temporal voluntaria, por robo o por exportación. Tramitamos la baja ante la DGT: en la baja definitiva dejarás de pagar el impuesto de circulación (IVTM) a partir del año siguiente; en la baja temporal, consúltanos según tu municipio.
> Etiquetas: Baja definitiva · Baja temporal · Por robo · Por exportación
> Botón: `Dar de baja →` (mensaje: *"Hola, quiero dar de BAJA un vehículo."*)

**Tarjeta 4 — Otros trámites con la DGT**
> Todo lo demás que necesites resolver con Tráfico, sin pedir cita ni hacer cola. Si tu trámite no está en la lista, pregúntanos: seguramente también lo hacemos.
> Etiquetas: Distintivo ambiental · Duplicado de permiso · Informe de vehículo · Cambio de domicilio · Duplicado ficha técnica
> Botón: `Consultar mi trámite →` (mensaje: *"Hola, necesito hacer un trámite con la DGT (distintivo, duplicado, informe, etc.)."*)

### 5. Sección «Tu trámite en 3 pasos»
**Título (H2):** `Tu trámite en 3 pasos`
1. **Cuéntanos qué necesitas** — Escríbenos por WhatsApp el trámite que quieres hacer. Te damos presupuesto cerrado y la lista de documentos.
2. **Nos pasas la documentación** — Nos envías una foto o el escaneo de los papeles. Revisamos que todo esté correcto antes de empezar.
3. **Nosotros lo gestionamos** — Tramitamos todo ante la DGT y te entregamos la documentación lista. Tú no pisas la jefatura.

### 6. Sección «Por qué elegirnos» (4 ventajas)
- **Te ahorramos tiempo** — Olvídate de citas, colas y formularios. Nosotros nos ocupamos de todo el proceso.
- **Precio cerrado y transparente** — Sabes lo que pagas antes de empezar. Te separamos siempre honorarios de tasas e impuestos.
- **Gestores profesionales** — Tu trámite lo revisan profesionales del sector. Lo preparamos con cuidado para minimizar errores y evitar rechazos.
- **Trato cercano por WhatsApp** — Hablas con una persona, no con un robot. Resolvemos tus dudas y te avisamos en cada paso.

### 7. Franja CTA (fondo oscuro)
**Título:** `¿Tienes un trámite de tráfico pendiente?`
**Texto:** `Escríbenos por WhatsApp y te decimos en un momento cuánto cuesta y qué necesitas. La consulta es gratis y sin compromiso.`
**Botón:** `Escríbenos por WhatsApp`

### 8. Preguntas frecuentes (acordeón de Wix)
- **¿Tengo que ir a la DGT o a la jefatura de tráfico?** — No. Nos ocupamos nosotros de todo el trámite ante Tráfico. Tú solo tienes que enviarnos la documentación; no necesitas pedir cita ni hacer colas.
- **¿Trabajáis en toda España?** — Sí. Al trabajar de forma 100% digital, tramitamos para clientes de cualquier punto de España. Estés donde estés, nos envías los papeles por WhatsApp o email.
- **¿El precio incluye las tasas y los impuestos?** — Te damos siempre el precio desglosado: por un lado nuestros honorarios y por otro las tasas de la DGT y los impuestos que correspondan. Sabes exactamente lo que pagas antes de empezar.
- **¿Qué documentos necesito para mi trámite?** — Depende del trámite. Cuando nos escribas te enviamos la lista exacta (DNI, permiso de circulación, ficha técnica / ITV, contrato de compraventa, justificante del ITP, etc.).
- **¿Cuánto tarda en estar listo?** — Empezamos en cuanto recibimos toda la documentación correcta. Te informamos del tiempo estimado antes de comenzar (las transferencias, en menos de 48 h).
- **¿Cómo os envío la documentación?** — Una foto por WhatsApp o un escaneo por email es suficiente para empezar. Sencillo y sin moverte de casa.

### 9. Footer
- Frase: `Tu gestoría para trámites de tráfico. Transferencias, matriculaciones, bajas y trámites DGT sin colas ni desplazamientos.`
- Contacto: Teléfono 674 57 34 47 · WhatsApp · jose@burocraciazero.es · Calle Río Alberche, 38 (Tiendas G), Local 32, 45007 Toledo · L–V de 10:00 a 14:00 y de 17:00 a 20:00
- Nota legal: `Honorarios de gestión. No incluye las tasas de la DGT ni los impuestos (ITP, IVTM, impuesto de matriculación, etc.), salvo que se indique lo contrario. El plazo de «menos de 48 h» en transferencias es orientativo: aplica una vez recibida la documentación correcta y pagado el ITP, y puede variar por incidencias o demoras de la DGT.`

---

## 🔎 SEO (para que te encuentren en Google)

En Wix → **SEO de la página**:

- **Título SEO (title):** `Trámites de tráfico en Toledo y online | Transferencias 48h · Burocracia Zero`
- **Descripción (meta description):** `Gestoría en Toledo para tus trámites de tráfico: transferencias en menos de 48 h, cambios de titularidad, matriculaciones, importación y bajas. Gestión 100% digital en toda España. Escríbenos por WhatsApp.`
- **URL sugerida:** `/tramites-de-trafico`
- **Un solo H1 por página** (el título del hero). Los demás títulos de sección como H2.
- **Palabras clave a trabajar:** *transferencia de vehículo*, *cambio de titularidad coche*, *gestoría tráfico Toledo*, *matriculación de vehículos*, *importación de coches*, *baja de vehículo*, *distintivo ambiental DGT*, *transferencia coche online*, *gestoría trámites DGT toda España*.
- **Google Business Profile:** ten la ficha de Toledo actualizada con el mismo teléfono y dirección (ayuda al SEO local).
- **Texto alternativo (alt)** en las imágenes con palabras clave (ej. «gestoría trámites de tráfico Toledo»).

---

## ⚠️ Avisos importantes (revisar antes de publicar)

- **Datos legales:** añade en tu web el **Aviso legal**, la **Política de privacidad** y la **Política de cookies** (obligatorio por RGPD/LSSI). En el footer hay enlaces de marcador para que los apuntes a tus páginas reales.
- **Precios y plazos:** el «menos de 48 h» y «presupuesto sin compromiso» deben poder cumplirse en la práctica para no inducir a error en publicidad. Ajusta los textos si en algún trámite no aplica.
- **WhatsApp Business:** se recomienda usar una cuenta de **WhatsApp Business** para atender los mensajes que lleguen desde los botones.
- **Logo:** en la Opción A se usa un distintivo de texto «BZ». Para usar tu logo real en el iframe, súbelo a un hosting y dime la URL, o usa la Opción B (subes la imagen directamente en Wix).
