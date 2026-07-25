# CRM de WhatsApp para gestorías

CRM sencillo y autocontenido pensado para gestorías que atienden a sus clientes
por WhatsApp. Sin dependencias externas: solo necesitas **Node.js 18 o superior**.

## Qué incluye

- **💬 Bandeja de WhatsApp**: conversaciones con cada cliente, contador de
  mensajes sin leer, envío y recepción de mensajes, y estados de entrega
  (enviado / entregado / leído).
- **👥 Clientes**: ficha con nombre, teléfono, NIF/DNI, email, etiquetas y notas.
  Si un número desconocido te escribe, se crea la ficha automáticamente.
- **📁 Expedientes**: trámites por cliente (fiscal, laboral, contabilidad,
  extranjería, vehículos…), con estado (pendiente, en curso, esperando
  documentación, completado) y fecha límite con aviso de vencidos.
- **📝 Plantillas**: respuestas frecuentes reutilizables desde el chat, con la
  variable `{nombre}` que se sustituye por el nombre del cliente.
- **⏰ Recordatorios**: seguimientos con fecha, opcionalmente ligados a un cliente.
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
> esto rara vez es un problema.

## Variables de entorno

| Variable | Descripción | Por defecto |
| --- | --- | --- |
| `PORT` | Puerto del servidor | `3000` |
| `WHATSAPP_TOKEN` | Token de acceso de la Cloud API | *(vacío → modo demo)* |
| `WHATSAPP_PHONE_NUMBER_ID` | ID del número de WhatsApp Business | *(vacío → modo demo)* |
| `WEBHOOK_VERIFY_TOKEN` | Token que verifica el webhook de Meta | `gestoria-crm` |
| `WHATSAPP_GRAPH_VERSION` | Versión de la Graph API | `v20.0` |

## Datos

Todo se guarda en `data/db.json` (excluido de git). Haz copia de seguridad de
ese fichero y tendrás copia de todo el CRM. Los teléfonos se normalizan a
formato internacional; un móvil español de 9 cifras recibe automáticamente el
prefijo `34`.

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
