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
- **📁 Expedientes**: trámites por cliente (fiscal, laboral, contabilidad,
  extranjería, vehículos…), con estado (pendiente, en curso, esperando
  documentación, completado) y fecha límite con aviso de vencidos.
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
- **📅 Citas**: agenda con vista por días, confirmación por WhatsApp al
  reservar y recordatorio automático el día anterior (activable en
  Automatizaciones).
- **🟢 Estados de conversación**: cada chat puede estar Abierta / Pendiente /
  Resuelta y asignarse a una persona del equipo; se ve en la bandeja.
- **🗒️ Notas internas**: botón 🗒️ en el chat para guardar notas que el
  cliente nunca recibe (aparecen en amarillo, con autor).
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

## Variables de entorno

| Variable | Descripción | Por defecto |
| --- | --- | --- |
| `PORT` | Puerto del servidor | `3000` |
| `CRM_PASSWORD` | Contraseña de acceso a la interfaz (vacía → sin login, solo para pruebas locales) | *(vacío)* |
| `CRM_USER` | Usuario de acceso | `admin` |
| `CRM_USERS` | Varios usuarios: `nombre:clave,nombre2:clave2` (tiene prioridad sobre `CRM_USER`/`CRM_PASSWORD`) | *(vacío)* |
| `YCLOUD_API_KEY` | API key de YCloud (Developers → API Keys en su consola; máxima prioridad si está definida) | *(vacío)* |
| `YCLOUD_WHATSAPP_FROM` | Número del negocio en YCloud, formato internacional (ej. `+34612345678`) | *(vacío)* |
| `WHATSAPP_360DIALOG_API_KEY` | API key de 360dialog | *(vacío)* |
| `WHATSAPP_TOKEN` | Token de acceso de la Cloud API (Meta directo) | *(vacío → modo demo)* |
| `WHATSAPP_PHONE_NUMBER_ID` | ID del número de WhatsApp Business (Meta directo) | *(vacío → modo demo)* |
| `WEBHOOK_VERIFY_TOKEN` | Token que verifica el webhook de Meta | `gestoria-crm` |
| `WHATSAPP_GRAPH_VERSION` | Versión de la Graph API | `v20.0` |
| `MS_TENANT_ID` / `MS_CLIENT_ID` / `MS_CLIENT_SECRET` | Credenciales de la app de Entra ID para Outlook y SharePoint (vacías → sin sincronización) | *(vacío)* |

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
  `X-Hub-Signature-256`. **Configúralo en producción**: sin él, cualquiera
  que conozca la URL podría inyectar mensajes falsos.
- **Cabeceras de seguridad**: Content-Security-Policy estricta, HSTS (tras
  HTTPS), `nosniff`, `X-Frame-Options: DENY`, Referrer-Policy y
  Permissions-Policy.
- **Adjuntos seguros**: los tipos capaces de ejecutar código (SVG, HTML…) se
  sirven como descarga y con CSP `sandbox`; solo imágenes seguras, PDF,
  audio y vídeo se muestran en línea.
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
