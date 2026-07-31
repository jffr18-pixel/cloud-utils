# CRM de WhatsApp · Burocracia Zero

CRM sencillo y autocontenido para la gestoría **Burocracia Zero**
(*Simplificamos tus trámites*), pensado para atender a los clientes por
WhatsApp. Con la identidad visual de la marca (negro carbón, crema y lila).
Sin dependencias externas: solo necesitas **Node.js 18 o superior**.

## Qué incluye

- **💬 Bandeja de WhatsApp**: conversaciones con cada cliente, contador de
  mensajes sin leer, envío y recepción de mensajes y **de documentos, fotos,
  vídeos y audios** (botón 📎), y estados de entrega (enviado / entregado /
  leído).
- **📱 Sincronización de lectura con el móvil (Coexistence)**: si respondes a un
  cliente desde la app de WhatsApp del móvil, el CRM da por leídos sus mensajes
  anteriores; y si el proveedor lo notifica, también se marcan al leerlos en el
  móvil sin responder. Así el contador de «sin leer» del CRM no se descuadra
  con lo que ya has visto en el teléfono.
- **🔐 Acceso con contraseña**: definiendo `CRM_PASSWORD` la interfaz exige
  iniciar sesión (usuario `admin` por defecto, configurable con `CRM_USER`).
  Sesiones de 30 días y bloqueo tras 10 intentos fallidos. **Imprescindible
  antes de exponer el CRM en Internet.** El webhook queda público porque lo
  necesita el proveedor.
- **📋 Plantillas de Meta para la ventana de 24 h**: si un aviso automático
  debe salir cuando el cliente lleva más de 24 h sin escribir, se envía con
  una plantilla aprobada (configurable en Automatizaciones) en vez de texto
  libre, para que WhatsApp no lo rechace.
- **👥 Clientes**: ficha con nombre, teléfono, NIF/DNI, email, etiquetas y notas.
  Si un número desconocido te escribe, se crea la ficha automáticamente.
- **🖼️ Foto del cliente**: cada cliente puede tener una foto que se muestra en la
  lista de conversaciones y en la cabecera del chat (en lugar de las iniciales).
  Se asigna subiendo una imagen o usando una foto que el cliente haya enviado
  por el chat (botón «📷 foto»). Nota: no es la foto de perfil de WhatsApp —Meta
  no la comparte con las cuentas de empresa por privacidad—, sino una que asigna
  la gestoría.
- **📁 Expedientes**: trámites por cliente (fiscal, laboral, contabilidad,
  extranjería, vehículos…), con estado (pendiente, en curso, esperando
  documentación, completado), fecha límite con aviso de vencidos, **fecha de
  presentación ante la administración**, **nº de registro/expediente** oficial y
  **enlace de seguimiento** en la sede de la administración (todo esto lo ve el
  cliente en su página de seguimiento, en su idioma; el enlace solo si es
  http/https).
- **📄 Dossier del cliente en PDF**: desde la ficha del cliente, genera un PDF
  con sus datos, todos sus expedientes (estado, fechas, nº de registro,
  honorarios y tasas), los documentos que ha firmado y un resumen de actividad.
  Para archivo, traspaso o inspección. Sin dependencias (motor de PDF propio).
- **📝 Documentos pre-rellenados en PDF**: desde la ficha del cliente, genera
  al instante la **autorización de representación**, la **hoja de encargo
  profesional** o el **consentimiento RGPD**, ya rellenos con los datos del
  cliente (nombre, NIF/NIE, teléfono, correo) y sus trámites en curso, con la
  línea de firma en blanco para imprimir y firmar en la oficina. Se diferencia
  de la firma digital (abajo): aquí se firma en papel. Sin dependencias.
- **🧾 Recibos de pago en PDF**: en cada expediente con el honorario cobrado,
  genera un recibo/justificante con el nombre y NIF del cliente, el importe (con
  céntimos), el concepto (el trámite) y la forma de pago. Lleva un **número de
  recibo** que se asigna una sola vez (las reimpresiones mantienen el mismo
  número) y una **cabecera con el logo y los datos de la gestoría** (nombre,
  CIF, dirección, teléfono, email, web, nº de colegiado). Para dárselo al
  cliente o enviárselo. Sin dependencias.
- **🏢 Datos de la gestoría**: editables en Automatizaciones → «Datos de la
  gestoría». Se usan como membrete (con el logotipo) en los recibos y en los
  documentos pre-rellenados. Lo que dejes en blanco no aparece.
- **📝 Plantillas**: respuestas frecuentes reutilizables desde el chat, con la
  variable `{nombre}` que se sustituye por el nombre del cliente.
- **⏰ Recordatorios**: seguimientos con fecha, opcionalmente ligados a un
  cliente, con opción de enviárselos por WhatsApp automáticamente ese día.
- **📣 Campañas por etiqueta**: envío masivo a todos los clientes de una
  etiqueta (ej. aviso de campaña de la renta a la etiqueta «renta»), con
  personalización `{nombre}`, histórico de envíos y uso automático de la
  plantilla de Meta si la ventana de 24 h está cerrada.
- **🔍 Búsqueda en conversaciones**: busca cualquier texto (o nombre de
  archivo adjunto) en todos los chats desde la bandeja.
- **📤 Exportación CSV**: clientes y expedientes descargables en CSV listos
  para Excel (separador `;` y codificación con BOM).
- **👥 Varios usuarios**: `CRM_USERS="carmen:clave1,juan:clave2"` permite un
  acceso por persona; la sesión muestra quién está conectado.
- **🔒 Expedientes independientes por usuario**: con dos o más usuarios, cada
  uno solo ve sus propios clientes, chats y expedientes; los de un compañero
  quedan ocultos (no aparecen en listas, buscador, informes ni por enlace
  directo, que devuelve *403*). Cada cliente que creas queda «a tu nombre».
  Hay dos formas de compartir cuando hace falta: **compartir un cliente**
  completo (su ficha, sus chats y todos sus expedientes) desde la ficha del
  cliente → *Reparto y compartir*, o **compartir un expediente en concreto**
  sin abrir el resto de la ficha, desde el propio expediente → *Compartir solo
  este expediente*. Solo el dueño puede cambiar con quién se comparte. Con un
  solo usuario (sin `CRM_USERS`) todo es común, como hasta ahora. Los clientes
  que llegan por WhatsApp entrantes quedan comunes hasta que se les asigna
  dueño.
- **🤖 Asistente por Telegram**: un bot de Telegram que maneja el CRM por ti
  sin tenerlo abierto. Le hablas por texto o **nota de voz** en lenguaje
  natural («Manda por WhatsApp a Juan que su cita es mañana a las 10»,
  «Ponme una cita con María el jueves a las 12», «¿Qué tengo hoy?», «¿Quién me
  debe dinero?») y él ejecuta la acción. Solo responde a los IDs de Telegram de
  la lista blanca, cada uno ligado a su usuario del CRM (respeta el
  aislamiento), y **pide confirmación con botones ✅/❌ antes de enviar cualquier
  WhatsApp o crear nada**. Ver [«Asistente por Telegram»](#asistente-por-telegram).
- **📅 Citas**: agenda con vista por días, confirmación por WhatsApp al
  reservar y recordatorio automático el día anterior (activable en
  Automatizaciones).
- **🗓️ Reserva de cita online**: el cliente elige un hueco libre desde su
  enlace de seguimiento y la cita se crea sola (con confirmación por WhatsApp y
  en Outlook). Los huecos salen de tu horario, descontando las citas que ya
  tengas y —si Outlook está activado— lo que tengas ocupado en tu calendario de
  Outlook, para que nunca se ofrezca una hora en la que estás pillado. Se activa
  en Automatizaciones → «Reserva de cita online».
- **🗓️ Calendario de Outlook**: pestaña que muestra, dentro del CRM, los
  eventos del calendario compartido de Outlook (el mismo donde se crean las
  citas), incluidos los que se crean directamente en Outlook. Solo lectura,
  agrupados por día, con rango de 7/14/30 días y enlace para abrir cada evento.
  Usa el permiso `Calendars.ReadWrite` que ya se concede para crear citas.
- **🟢 Estados de conversación**: cada chat puede estar Abierta / Pendiente /
  Resuelta y asignarse a una persona del equipo; se ve en la bandeja.
- **🗒️ Notas internas**: botón 🗒️ en el chat para guardar notas que el
  cliente nunca recibe (aparecen en amarillo, con autor).
- **📌 Nota fija del cliente**: una nota siempre visible en la cabecera del
  chat (idioma que habla, preferencias, aviso importante…). Se edita con un
  clic y no se envía nunca al cliente.
- **🟢 Aviso de la ventana de 24 h**: la cabecera del chat indica si la
  ventana de servicio de WhatsApp está abierta (y cuánto queda) o cerrada
  (solo se puede escribir con plantillas aprobadas).
- **🕒 Mensajes programados**: escribe un mensaje y prográmalo para una fecha
  y hora concretas (botón 🕒 del chat); se envía solo a la hora elegida y los
  pendientes se ven bajo la conversación, con opción de cancelarlos.
- **🎧 Notas de voz en el chat**: los audios recibidos se reproducen en línea
  con un reproductor dentro de la propia conversación.
- **⚡ Envío instantáneo**: al pulsar Enter el mensaje aparece al momento en la
  conversación (envío optimista), sin esperar a recargar toda la charla.
- **🎤 Notas de voz salientes**: graba una nota de voz con el micrófono desde el
  propio chat y envíala al cliente (botón 🎤). Se graba en el formato más
  compatible con WhatsApp que ofrezca el navegador.
- **🔔 Avisos de mensajes nuevos**: notificación de escritorio, un pitido y el
  título de la pestaña parpadeando cuando entra un WhatsApp, aunque estés en
  otra sección. Se activa/silencia con la campana de la cabecera del chat.
- **🖼️ Visor de fotos y galería**: las imágenes se abren en un visor a pantalla
  completa con zoom y descarga, y el botón 🖼️ muestra todas las fotos y
  documentos de la conversación.
- **↩️ Responder citando**: responde a un mensaje concreto citándolo (como en
  WhatsApp); la cita se muestra sobre tu respuesta y en la burbuja enviada.
- **✍️ Firma digital de documentos**: pide una autorización de representación o
  un consentimiento RGPD desde el chat (botón ✍️); el cliente abre un enlace
  privado en el móvil, firma con el dedo y el PDF firmado —con fecha, hora e IP
  como prueba— queda adjunto a la conversación, vinculado al expediente y subido
  a SharePoint. Sin papel ni desplazamientos.
- **🗂️ Panel de tareas del equipo**: tablero tipo kanban (Por hacer · En curso ·
  Hecho) para repartir el trabajo entre el equipo, con responsable, fecha límite,
  cliente vinculado y aviso de tareas vencidas. La barra lateral muestra cuántas
  quedan pendientes.
- **🏛️ Tasas oficiales por expediente**: además de tus honorarios, cada
  expediente puede llevar la tasa oficial (modelo 790, tasa 052…), su importe y
  si está abonada o pendiente, con distintivo propio separado del cobro de la
  gestoría. Tanto los honorarios como las tasas admiten **dos decimales**
  (céntimos, p. ej. `104,05 €`); los importes enteros se muestran sin decimales.
- **📖 Base de conocimiento de trámites**: catálogo de honorarios, tasas
  orientativas y documentos por trámite (extranjería, tráfico…). Desde el chat,
  el botón 📖 busca un trámite (tolerante a acentos) e inserta la respuesta
  lista para enviar, con el nombre del cliente ya puesto. Editable en la pestaña
  «Precios y tasas»; viene sembrada con los precios de la gestoría.
- **✨ Respuesta sugerida con IA**: en el chat, el botón ✨ propone un borrador
  de respuesta al último mensaje del cliente, usando el hilo reciente y la base
  de conocimiento. El texto aparece en el cuadro para que lo revises y edites
  antes de enviar (no se envía solo). Requiere una clave de IA (`ANTHROPIC_API_KEY`
  para Claude, o `OPENAI_API_KEY`).
- **💶 Por cobrar**: honorarios y tasas oficiales pendientes de cobro, agrupados
  por cliente y ordenados por importe, con el total y un botón para reclamar por
  WhatsApp en un clic (con el desglose de lo pendiente). La barra lateral avisa
  de cuántos clientes tienen saldo. Con «Registrar cobro» marcas lo pagado
  eligiendo la **forma de cobro (efectivo, transferencia o tarjeta)**, y los
  informes desglosan cuánto has cobrado por cada forma (para cuadrar la caja).
- **🤖 Cobros automáticos**: reclama solo, por WhatsApp, el saldo pendiente
  (agrupado por cliente) a quien lo tenga desde hace más de X días (por defecto
  15), sin repetir el aviso antes de N días (por defecto 7). Solo en horario
  laboral y respetando la ventana de 24 h. Se activa en Automatizaciones.
- **⭐ Pedir reseña en Google**: cuando marcas un expediente como completado, el
  cliente recibe (una sola vez) un WhatsApp pidiéndole una reseña con tu enlace
  de Google. Se activa en Automatizaciones → «Pedir reseña en Google», donde
  pones el enlace y el mensaje (variables `{nombre}` y `{enlace}`). No se repite
  al mismo cliente aunque complete más trámites.
- **📊 Informes financieros**: además del cuadro de trámites, ingresos por mes
  (cobrado), facturado / cobrado / pendiente y tasas oficiales gestionadas,
  abonadas y pendientes, con desglose por área y exportación a CSV.
- **📒 Libro de ingresos (export)**: desde Informes, exporta en CSV los
  honorarios **cobrados** por **fecha de cobro** en el periodo elegido (una
  línea por cobro: fecha, nº de recibo, cliente, NIF, concepto, área, importe y
  forma de pago), con fila de total. Pensado para tu asesoría o tus impuestos.
  Las tasas oficiales se muestran aparte, ya que no son ingreso de la gestoría
  (se ingresan en la Administración). Cada cobro sella su fecha automáticamente.
- **🏆 Rendimiento por usuario**: al final de los Informes, una tabla que
  compara a cada compañero (p. ej. José y Carmen) en el periodo elegido:
  trámites y completados, cobrado y pendiente, clientes nuevos, conversaciones
  atendidas, WhatsApp enviados y tiempo medio de respuesta. La atribución se
  hace por el dueño de cada cliente; solo agrega recuentos e importes, sin
  exponer datos de clientes ajenos. Requiere varios usuarios (`CRM_USERS`).
- **☁️ Copias de seguridad en la nube (Microsoft)**: además de la copia local
  diaria, la copia se sube automáticamente a SharePoint/OneDrive (activable en
  Automatizaciones → Microsoft 365), para no perder nada si falla el servidor.
  Con la opción **«copias solo en SharePoint»** se borra la copia local tras
  subirla, para no ocupar disco en el CRM (si la subida falla, la copia local se
  conserva para no perderla).
- **📊 Panel con gráficas**: mensajes por día (recibidos/enviados),
  expedientes por estado, mensajes de la semana y tiempo medio de primera
  respuesta de los últimos 30 días.
- **💾 Copias de seguridad**: automática diaria (se conservan 14) y bajo
  demanda, descargables desde Automatizaciones. Los adjuntos viven en
  `data/uploads`; cópialos aparte para un respaldo completo.
- **📁 Documentos por expediente**: cualquier adjunto del chat puede
  guardarse en un expediente («📁 asignar a expediente») y consultarse junto
  al resto de documentos del trámite.
- **⚡ Automatizaciones** (pestaña propia, todas configurables y desactivadas
  por defecto):
  - *Respuesta fuera de horario*: contesta automáticamente cuando un cliente
    escribe fuera del horario configurado (una vez por cliente cada 12 h).
  - *Vacaciones / cierre temporal*: entre dos fechas (incluidas), a quien
    escriba se le responde **solo** con un aviso de que la gestoría está
    cerrada (no se le manda el menú, la bienvenida ni la respuesta fuera de
    horario), como máximo una vez al día por cliente. Variables `{nombre}`,
    `{desde}` y `{hasta}` (fechas en formato largo).
  - *Avisos de expediente*: al pasar un trámite a «en curso» o «completado»,
    el cliente recibe el aviso solo.
  - *Petición y reclamo de documentación*: al poner un expediente en
    «esperando documentación» se envía la lista de documentos del expediente,
    y si el cliente no responde en N días se le reclama una vez.
  - *Recordatorios al cliente*: los recordatorios marcados para enviar se
    mandan por WhatsApp en su fecha, dentro del horario laboral.
  Los mensajes automáticos quedan marcados con 🤖 en el chat y las variables
  `{nombre}`, `{tramite}`, `{documentos}` y `{texto}` se rellenan solas.
- **📊 Panel**: resumen de clientes, mensajes sin leer, expedientes abiertos y
  vencidos, y recordatorios del día.

## Puesta en marcha (modo demo)

```bash
cd whatsapp-crm
node server.js
```

Abre <http://localhost:3000>. Sin credenciales de WhatsApp la app arranca en
**modo demo**: todo funciona igual, pero los envíos no salen de verdad y puedes
usar el botón «Simular entrada» para probar mensajes entrantes.

## Conectar con YCloud

Si tu número de WhatsApp ya está dado de alta en [YCloud](https://www.ycloud.com)
(como BSP oficial de Meta, soporta también el modo Coexistence con la app del
móvil), la conexión es directa:

1. En la consola de YCloud, ve a **Developers → API Keys** y copia tu API key.
2. Arranca el CRM con la clave y el número del negocio:

   ```bash
   YCLOUD_API_KEY="tu_api_key" \
   YCLOUD_WHATSAPP_FROM="+34XXXXXXXXX" \
   node server.js
   ```

3. Para las automatizaciones fuera de la ventana de 24 h, crea en YCloud una
   plantilla de Meta (por defecto el CRM usa el nombre `aviso_gestoria`,
   idioma `es`) con este cuerpo de dos variables y espera su aprobación:

   > Hola {{1}}, tienes un aviso de tu gestoría: {{2}}

   Después actívala en la pestaña **Automatizaciones → Plantilla para la
   ventana de 24 h**.

4. En **Developers → Webhooks** de YCloud, crea un endpoint apuntando a
   `https://tu-dominio/webhook` (el servidor debe ser accesible por HTTPS
   desde Internet) y suscríbelo a estos eventos:
   - `whatsapp.inbound_message.received` (mensajes de clientes)
   - `whatsapp.message.updated` (estados: enviado/entregado/leído/fallido)
   - `whatsapp.smb.message.echoes` (Coexistence: ecos de la app del móvil)
   - `whatsapp.smb.history` (Coexistence: historial sincronizado)

Con eso, los mensajes de tus clientes entran en el CRM, los envíos salen por
YCloud, y si tienes Coexistence activado, lo que respondas desde la app del
móvil aparece marcado con 📱.

**Para verificar la conexión**: haz clic en la insignia de estado («● Conectado
(YCloud)») en la barra lateral. El CRM consulta tu cuenta de YCloud y te dice
si la API key funciona, qué números tienes dados de alta y si
`YCLOUD_WHATSAPP_FROM` coincide con uno de ellos.

## Integración con Microsoft 365 (Outlook + SharePoint)

El CRM puede sincronizarse con el Microsoft 365 de Burocracia Zero:

- **Citas → Outlook**: cada cita creada en el CRM aparece también en el
  calendario configurado (por defecto `jose@burocraciazero.es`), con el
  cliente, teléfono y motivo. Si la cancelas en el CRM, se borra de Outlook.
- **Documentos → SharePoint**: al guardar un adjunto en un expediente, el
  fichero se sube también a la carpeta del cliente en el sitio
  `GestinBurocraciaZero`, siguiendo vuestra estructura
  `26 CLIENTES/26 PARTICULARES/26 NOMBRE/CRM WHATSAPP` (plantilla editable
  en Automatizaciones; `{aa}` = año en 2 cifras, `{cliente}` = nombre en
  mayúsculas). El mensaje muestra después un enlace «☁️ SharePoint».

### Alta de la aplicación en Microsoft (una sola vez)

1. Entra en <https://entra.microsoft.com> con la cuenta de administrador →
   **Registros de aplicaciones → Nuevo registro**. Nombre: «CRM WhatsApp».
2. En **Certificados y secretos**, crea un secreto de cliente y apúntalo.
3. En **Permisos de API → Agregar permiso → Microsoft Graph → Permisos de
   aplicación**, añade `Calendars.ReadWrite` y `Sites.ReadWrite.All`, y pulsa
   **Conceder consentimiento de administrador**.
4. Copia del apartado **Información general**: el **Id. de directorio
   (inquilino)** y el **Id. de aplicación (cliente)**.
5. Arranca el CRM con las tres variables:

   ```bash
   MS_TENANT_ID="..." MS_CLIENT_ID="..." MS_CLIENT_SECRET="..." node server.js
   ```

6. En **Automatizaciones → Microsoft 365**, activa el calendario y/o
   SharePoint y pulsa «Probar conexión» para verificarlo todo.

> Si prefieres limitar el acceso a un único sitio de SharePoint en lugar de
> `Sites.ReadWrite.All`, un administrador puede usar el permiso
> `Sites.Selected` y conceder acceso solo a `GestinBurocraciaZero`.

## Conectar con WhatsApp de verdad (API oficial de Meta)

El CRM usa la **WhatsApp Business Cloud API**, la vía oficial de Meta (gratuita
para conversaciones de servicio iniciadas por el cliente, dentro de los límites
de Meta). Pasos:

1. Crea una cuenta en <https://developers.facebook.com> y una app de tipo
   **Business**.
2. Añade el producto **WhatsApp** a la app. Meta te da un número de pruebas;
   para producción tendrás que dar de alta el número de la gestoría.
3. Apunta el **token de acceso** (genera uno permanente con un usuario de
   sistema en Meta Business Suite) y el **Phone Number ID**.
4. Arranca el servidor con las credenciales:

   ```bash
   WHATSAPP_TOKEN="tu_token" \
   WHATSAPP_PHONE_NUMBER_ID="123456789012345" \
   WEBHOOK_VERIFY_TOKEN="una_frase_secreta" \
   node server.js
   ```

5. Para **recibir** mensajes, el servidor debe ser accesible desde Internet por
   HTTPS (p. ej. desplegado en un VPS con un proxy inverso, o en pruebas con un
   túnel tipo `cloudflared` o `ngrok`). En la configuración de webhooks de la
   app de Meta:
   - URL de devolución de llamada: `https://tu-dominio/webhook`
   - Token de verificación: el mismo valor de `WEBHOOK_VERIFY_TOKEN`
   - Suscríbete al campo **messages**.

### Modo Coexistence: seguir usando la app del móvil con el mismo número

Desde finales de 2025, Meta permite en Europa el modo **Coexistence**
(«API Solutions for Business App Users»): el mismo número funciona a la vez en
la **app WhatsApp Business del móvil** y en la **Cloud API** que usa este CRM.
Los chats se sincronizan en ambos sentidos y, al activarlo, puedes importar
los últimos 6 meses de historial.

Puntos clave:

- **Alta a través de un BSP**: la coexistencia solo puede activarse con el
  flujo *Embedded Signup* de un proveedor oficial de WhatsApp (BSP), como
  360dialog, Twilio, Wati, Gupshup, etc. No basta con crear la app en
  developers.facebook.com a mano. El BSP te dará igualmente un token y un
  Phone Number ID compatibles con este CRM.
- **Requisitos**: app WhatsApp Business actualizada (2.24.17 o superior) y un
  número con actividad reciente (no recién dado de alta).
- **Ecos de la app**: cuando respondes desde el móvil, Meta envía un «eco» al
  webhook (campo `message_echoes`). Este CRM ya lo procesa: esos mensajes
  aparecen en la conversación marcados con 📱 «desde el móvil». En la
  configuración de webhooks del BSP/Meta, suscríbete también a ese campo
  además de `messages`.
- **Llamadas**: las llamadas y videollamadas siguen siendo solo de la app;
  la API no las gestiona.

> **Regla de las 24 horas de WhatsApp**: puedes responder con texto libre
> durante las 24 h siguientes al último mensaje del cliente. Pasado ese plazo,
> Meta solo permite iniciar conversación con *plantillas aprobadas* (HSM).
> Como en una gestoría casi siempre es el cliente quien escribe, en la práctica
> esto rara vez es un problema. Ten en cuenta que afecta a las automatizaciones
> que inician conversación (avisos de expediente, reclamos y recordatorios): si
> el cliente lleva más de 24 h sin escribir, ese envío puede ser rechazado por
> WhatsApp salvo que uses una plantilla aprobada. El mensaje quedará marcado
> con ⚠️ error en el chat y podrás reenviarlo a mano o con plantilla.

> **Consejo con Coexistence**: si usas la respuesta automática fuera de horario
> del CRM, desactiva los mensajes de bienvenida/ausencia de la propia app
> WhatsApp Business para no enviar respuestas duplicadas.

## Asistente por Telegram

Un bot de Telegram que maneja el CRM por ti, sin tenerlo abierto. Le escribes o
le mandas una **nota de voz** en lenguaje natural y ejecuta la acción:

- «Manda por WhatsApp a Juan que su cita es mañana a las 10» → localiza a Juan
  y envía (tras tu confirmación).
- «Ponme una cita con María el jueves a las 12 por la renovación del NIE» →
  crea la cita y avisa al cliente por WhatsApp.
- «Recuérdame el lunes llamar a la asesoría» → recordatorio interno.
- «Cóbrale a Pedro en efectivo» → marca sus honorarios pendientes como cobrados.
- «Marca el expediente de María como completado» → cambia el estado (y avisa al
  cliente si procede).
- «Da de alta a Ana López, 600112233» → crea el cliente.
- Envía una **foto o un PDF** con el nombre del cliente en el pie y el bot se lo
  manda a ese cliente por WhatsApp.
- «¿Qué tengo hoy?», «¿Quién me debe dinero?», «Busca a Ahmed» → consultas.

**Antes de enviar cualquier WhatsApp o crear algo, el bot te pide confirmar con
botones ✅/❌.** Nada sale sin tu visto bueno.

### Puesta en marcha

1. En Telegram, habla con **@BotFather**, crea un bot con `/newbot` y copia el
   token que te da. Ponlo en `TELEGRAM_BOT_TOKEN`.
2. Necesitas tu **ID de Telegram** (un número). La forma más fácil: arranca el
   bot con el token puesto, escríbele cualquier cosa y te responderá «No estás
   autorizado… tu ID es: 123456789». Copia ese número.
3. Rellena `TELEGRAM_ALLOWED` con `tuID:tuUsuarioCRM`. Ejemplos:
   - Un solo usuario del CRM (sin `CRM_USERS`): `TELEGRAM_ALLOWED="123456789:"`
     (deja el usuario vacío).
   - Con varios usuarios: `TELEGRAM_ALLOWED="123456789:jose,987654321:carmen"`.
     Así cada persona actúa como su usuario del CRM y solo ve/toca lo suyo
     (respeta el aislamiento). Para dar de alta a Carmen, que le escriba al bot,
     te pase su ID y lo añades a la lista.
4. Para que entienda lenguaje natural, elige un proveedor de IA (con una de las
   dos claves basta; si están las dos, manda Claude):
   - **Claude (Anthropic)**: define `ANTHROPIC_API_KEY`. Modelo por defecto
     `claude-haiku-4-5` (rápido y barato, de sobra para las órdenes del bot);
     para más capacidad puedes poner `ANTHROPIC_MODEL=claude-opus-5`.
   - **OpenAI**: define `OPENAI_API_KEY` (modelo por defecto `gpt-4o-mini`).
   - **Notas de voz**: la transcripción usa Whisper de OpenAI (Claude no
     transcribe audio), así que para entender **notas de voz** necesitas
     `OPENAI_API_KEY` aunque el asistente use Claude. Por texto funciona con
     cualquiera de las dos.

El bot funciona por *long polling*: no hace falta abrir puertos ni configurar
webhooks. En cuanto el servidor arranca con el token puesto, queda a la escucha.

### Avisos proactivos

El bot no solo responde: también te avisa él, sin preguntar.

- **WhatsApp nuevo de un cliente**: en cuanto un cliente escribe, te llega un
  aviso por Telegram con su nombre y el mensaje. Con antirrebote por cliente
  (`TELEGRAM_ALERT_DEBOUNCE_MIN`, 10 min por defecto) para no saturarte en una
  ráfaga. Solo avisa a los usuarios que pueden ver a ese cliente. Se desactiva
  con `TELEGRAM_ALERTS=off`.
- **Resumen periódico (cada N horas)**: si prefieres no recibir un aviso por
  cada WhatsApp, pon `TELEGRAM_DIGEST_EVERY_HOURS=4` (o las horas que quieras) y
  el bot te manda, cada 4 h, un **resumen** con los WhatsApp recibidos en ese
  rato (agrupados por cliente), las citas que quedan hoy y lo pendiente de
  cobro. Al activarlo, **los avisos por cada mensaje se silencian solos** (el
  resumen los sustituye; si aun así los quieres, añade `TELEGRAM_ALERTS=on`).
  Si en un tramo no hay nada nuevo, no envía nada (no molesta de madrugada).
- **Resumen cada mañana**: si no usas el resumen periódico, a la hora que fijes
  (`TELEGRAM_DIGEST_HOUR`, 8 por defecto; `off` para desactivar) recibes un
  resumen del día: citas, conversaciones sin responder e importes pendientes de
  cobro (cada uno el suyo, respetando el aislamiento).

### Seguridad del asistente

Pensado para datos sensibles (extranjería). Medidas aplicadas:

- **Lista blanca en todos los caminos**: tanto los mensajes como los botones de
  confirmación comprueban que el ID de Telegram esté autorizado. Cierre por
  defecto: sin `TELEGRAM_ALLOWED`, nadie puede usarlo.
- **Solo en chats privados**: en grupos el bot no responde, para no exponer
  nombres, teléfonos ni expedientes a terceros.
- **Confirmación ligada a quien la pide**: cada acción pendiente lleva un token
  aleatorio e impredecible y solo la puede confirmar el mismo usuario que la
  creó (nadie puede ejecutar la acción de otro).
- **Aislamiento respetado**: el asistente solo ve y actúa sobre los clientes,
  chats y expedientes visibles para el usuario del CRM ligado a ese ID.
- **Límites**: control de frecuencia por usuario, tamaño máximo de las notas de
  voz (`TELEGRAM_MAX_FILE_MB`, 20 MB por defecto) y *timeouts* en todas las
  llamadas de red para que nada deje el bot colgado.
- **Sin filtraciones**: el token del bot nunca aparece en los logs y los errores
  internos no se muestran al usuario (solo un aviso genérico).

> **Privacidad (RGPD)**: el texto de tus órdenes se envía al proveedor de IA que
> configures (Claude/Anthropic u OpenAI) para interpretarlo; las notas de voz se
> transcriben con Whisper de OpenAI. No se manda la base de clientes: el modelo
> solo extrae la intención y los nombres que tú escribes; la búsqueda del cliente
> se hace en local. Actívalo solo si el proveedor te ofrece garantías adecuadas
> (DPA/UE).

## Variables de entorno

| Variable | Descripción | Por defecto |
| --- | --- | --- |
| `PORT` | Puerto del servidor | `3000` |
| `CRM_PASSWORD` | Contraseña de acceso a la interfaz (vacía → sin login, solo para pruebas locales) | *(vacío)* |
| `CRM_USER` | Usuario de acceso | `admin` |
| `CRM_USERS` | Varios usuarios: `nombre:clave,nombre2:clave2` (tiene prioridad sobre `CRM_USER`/`CRM_PASSWORD`) | *(vacío)* |
| `CRM_ADMIN` | Usuario(s) administrador(es) — `usuario1,usuario2` — que pueden descargar copias de toda la base de datos y cambiar la configuración global. Con aislamiento, por defecto es el **primer** usuario de `CRM_USERS` | *(1º de `CRM_USERS`)* |
| `CRM_ALLOW_UNSIGNED_WEBHOOK` | `1` acepta webhooks **sin firma** aunque WhatsApp esté configurado (solo para pruebas; en producción define `YCLOUD_WEBHOOK_SECRET` en su lugar) | *(vacío)* |
| `YCLOUD_API_KEY` | API key de YCloud (Developers → API Keys en su consola; máxima prioridad si está definida) | *(vacío)* |
| `YCLOUD_WHATSAPP_FROM` | Número del negocio en YCloud, formato internacional (ej. `+34612345678`) | *(vacío)* |
| `WHATSAPP_360DIALOG_API_KEY` | API key de 360dialog | *(vacío)* |
| `WHATSAPP_TOKEN` | Token de acceso de la Cloud API (Meta directo) | *(vacío → modo demo)* |
| `WHATSAPP_PHONE_NUMBER_ID` | ID del número de WhatsApp Business (Meta directo) | *(vacío → modo demo)* |
| `WEBHOOK_VERIFY_TOKEN` | Token que verifica el webhook de Meta | `gestoria-crm` |
| `WHATSAPP_GRAPH_VERSION` | Versión de la Graph API | `v20.0` |
| `MS_TENANT_ID` / `MS_CLIENT_ID` / `MS_CLIENT_SECRET` | Credenciales de la app de Entra ID para Outlook y SharePoint (vacías → sin sincronización) | *(vacío)* |
| `ANTHROPIC_API_KEY` | Clave de Claude (Anthropic). Si está, el asistente y las respuestas sugeridas usan Claude (tiene prioridad sobre OpenAI) | *(vacío)* |
| `ANTHROPIC_MODEL` | Modelo de Claude para el asistente (sube a `claude-opus-5` si quieres más capacidad) | `claude-haiku-4-5` |
| `OPENAI_API_KEY` | Clave de OpenAI (o compatible). Transcribe notas de voz (Whisper) **y**, si no hay clave de Claude, mueve el asistente y las respuestas sugeridas | *(vacío)* |
| `TELEGRAM_BOT_TOKEN` | Token del bot de Telegram (de @BotFather). Vacío → asistente desactivado | *(vacío)* |
| `TELEGRAM_ALLOWED` | Lista blanca `idTelegram:usuarioCRM,idTelegram2:usuarioCRM2`. Solo esos IDs pueden usar el asistente | *(vacío)* |
| `TELEGRAM_AGENT_MODEL` | Modelo que interpreta las órdenes del asistente | `gpt-4o-mini` |
| `TELEGRAM_MAX_FILE_MB` | Tamaño máximo de las notas de voz que descarga el bot | `20` |
| `AGENT_TIMEOUT_MS` | Timeout de la llamada al modelo del asistente | `20000` |
| `TELEGRAM_ALERTS` | Avisos de WhatsApp entrante por Telegram (`off` para desactivar) | `on` |
| `TELEGRAM_ALERT_DEBOUNCE_MIN` | Minutos mínimos entre avisos del mismo cliente | `10` |
| `TELEGRAM_DIGEST_HOUR` | Hora (0-23) del resumen diario por Telegram (`off` para desactivar) | `8` |
| `TELEGRAM_DIGEST_EVERY_HOURS` | Resumen periódico cada N horas en vez de avisar por cada WhatsApp (silencia los avisos por mensaje). Vacío/`off` = desactivado | *(vacío)* |

La elección de proveedor y los precios están comparados en
[`COMPARATIVA-BSP.md`](COMPARATIVA-BSP.md).

## Datos

Todo se guarda en `data/db.json` (excluido de git). Haz copia de seguridad de
ese fichero y tendrás copia de todo el CRM. Los teléfonos se normalizan a
formato internacional; un móvil español de 9 cifras recibe automáticamente el
prefijo `34`.

## Despliegue en producción (Render)

El repositorio incluye `render.yaml` (en la raíz) y `Dockerfile`, así que el
despliegue en [Render](https://render.com) es guiado:

1. Crea la cuenta en Render e **instala su app de GitHub** dándole acceso al
   repositorio privado `cloud-utils`.
2. En Render: **New → Blueprint** → elige el repositorio → Render lee
   `render.yaml` y propone el servicio `burocracia-zero-crm` (Docker, región
   Frankfurt/UE, disco persistente de 5 GB montado en `/data`).
3. Rellena las variables que pide: `CRM_USERS` (ej.
   `carmen:UnaClaveLarga,jose:OtraClave`), `YCLOUD_API_KEY`,
   `YCLOUD_WHATSAPP_FROM` y, si usas la integración con Microsoft 365,
   `MS_TENANT_ID`, `MS_CLIENT_ID` y `MS_CLIENT_SECRET`.
   `WEBHOOK_VERIFY_TOKEN` se genera solo.
4. Al terminar el primer despliegue tendrás una URL del tipo
   `https://burocracia-zero-crm.onrender.com`. Entra con tu usuario y pulsa
   la insignia de conexión para verificar YCloud, y «Probar conexión» en la
   tarjeta de Microsoft 365.
5. En la consola de YCloud (**Developers → Webhooks**) apunta el endpoint a
   `https://TU-URL.onrender.com/webhook` con los 4 eventos del apartado
   anterior.
6. (Opcional) Dominio propio: en Render **Settings → Custom Domains** añade
   `crm.burocraciazero.es` y crea el CNAME que te indique en tu DNS.

Notas de producción:

- Cada `git push` a la rama conectada redespliega automáticamente. Los datos
  no se pierden: viven en el disco `/data` (base de datos, adjuntos, copias
  de seguridad y sesiones).
- El plan gratuito de Render **no vale** para este CRM: apaga el servicio
  tras unos minutos de inactividad y se perderían webhooks de YCloud. El plan
  Starter (~7 $/mes) lo mantiene siempre encendido.
- La cookie de sesión se marca `Secure` automáticamente detrás del HTTPS del
  hosting, y el límite de intentos de acceso usa la IP real
  (`X-Forwarded-For`).
- Alternativas: **Railway** (detecta el `Dockerfile`; añade un volumen en
  `/data` y las mismas variables) o cualquier **VPS** con Docker:
  `docker build -t crm whatsapp-crm && docker run -d -p 80:3000 -v /srv/crm-data:/data --env-file .env crm`
  (con un proxy inverso tipo Caddy para HTTPS).

## Seguridad

Medidas activas en el CRM:

- **Autenticación**: sesiones con cookie `HttpOnly`/`SameSite`/`Secure` (30
  días), comparación de credenciales en tiempo constante (sin filtrar qué
  usuarios existen), bloqueo de 15 min tras 10 intentos fallidos por IP.
- **Verificación de firma de webhooks**: con `YCLOUD_WEBHOOK_SECRET` definido
  (secreto del endpoint en la consola de YCloud → Developers → Webhooks),
  solo se aceptan webhooks firmados HMAC-SHA256 por YCloud, con tolerancia
  anti-replay de 5 minutos. Para Meta directo, `META_APP_SECRET` verifica
  `X-Hub-Signature-256`. **Obligatorio en producción**: si WhatsApp está
  configurado y no hay secreto, los webhooks **se rechazan** (para que nadie
  pueda inyectar mensajes falsos). Para saltarlo en pruebas: `CRM_ALLOW_UNSIGNED_WEBHOOK=1`.
- **Aislamiento reforzado**: cada endpoint que devuelve o modifica datos de un
  cliente (incluidas firmas y mensajes programados) comprueba que el usuario
  pueda ver a ese cliente. Las copias de seguridad y la configuración global
  (que afectan a toda la base de datos y a todo el equipo) quedan restringidas
  a un usuario **administrador** (`CRM_ADMIN`, por defecto el primero de
  `CRM_USERS`).
- **Exportaciones CSV**: las celdas que empiezan por `= + - @` se neutralizan
  para evitar inyección de fórmulas al abrir el CSV en Excel/LibreOffice.
- **Cabeceras de seguridad**: Content-Security-Policy estricta, HSTS (tras
  HTTPS), `nosniff`, `X-Frame-Options: DENY`, Referrer-Policy y
  Permissions-Policy.
- **Adjuntos seguros**: los tipos capaces de ejecutar código (SVG, HTML…) se
  sirven como descarga y con CSP `sandbox`; solo imágenes seguras, PDF,
  audio y vídeo se muestran en línea. Además, al descargar un adjunto entrante
  la API key solo se envía a hosts del proveedor (`*.ycloud.com`,
  `*.whatsapp.net`, `*.fbcdn.net`, `*.360dialog.io`) y solo por HTTPS, de modo
  que un enlace manipulado nunca puede filtrar la credencial.
- **Límite de peticiones** por IP (API y webhook, configurable con
  `RATE_LIMIT_API` / `RATE_LIMIT_WEBHOOK`).
- **Registro de auditoría** en `data/audit.log`: accesos correctos y
  fallidos (con IP), cierres de sesión, descargas de copias, exportaciones
  CSV, campañas y webhooks rechazados.
- **Superficie mínima**: cero dependencias de terceros (nada de `npm install`
  → sin riesgo de cadena de suministro), validación de rutas en estáticos,
  adjuntos y copias, límites de tamaño de cuerpo, y fichero de sesiones con
  permisos `0600`.
- El servidor avisa al arrancar si detecta configuración insegura (sin
  contraseña, contraseñas cortas o webhook sin secreto).

## Protección de datos (RGPD)

El CRM guarda datos personales de tus clientes en tu propio servidor, no en
servicios de terceros (aparte del propio WhatsApp). Aun así, recuerda que como
gestoría eres responsable del tratamiento: limita el acceso a la máquina donde
corre el CRM, haz copias de seguridad cifradas y atiende las solicitudes de
supresión borrando la ficha del cliente (elimina también sus mensajes,
expedientes y recordatorios).

## Pruebas

```bash
cd whatsapp-crm
node test.js
```
