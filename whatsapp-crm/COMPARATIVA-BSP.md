# Comparativa de proveedores (BSP) para activar WhatsApp Coexistence

> Actualizada en julio de 2026. Los precios cambian a menudo: confírmalos en la
> web de cada proveedor antes de contratar.

## Qué estás contratando exactamente

Para usar el mismo número en la app WhatsApp Business del móvil **y** en este
CRM (modo *Coexistence*), el alta debe hacerse con el flujo *Embedded Signup*
de un proveedor oficial de Meta (BSP) o directamente con Meta como proveedor
técnico propio. El BSP te da el acceso a la API; este CRM sigue siendo tu
pantalla de trabajo.

Además del BSP, está el coste de Meta: desde 2025-2026 **las conversaciones de
servicio (cuando el cliente te escribe primero y tú respondes en 24 h) son
gratis**; Meta solo cobra por *plantillas* que tú envías para iniciar
conversación (céntimos por mensaje, según categoría y país). Como en una
gestoría casi siempre escribe primero el cliente, el coste de Meta será
prácticamente cero salvo que hagas campañas.

## Opciones comparadas

| Opción | Precio orientativo | Coexistence | Encaja con este CRM | Observaciones |
| --- | --- | --- | --- | --- |
| **YCloud** ⭐ ya contratado | Según plan contratado | ✅ documentado | ✅ soporte integrado en el CRM (`YCLOUD_API_KEY`) | El proveedor que ya usa la gestoría. API y webhooks propios, soportados de serie por este CRM (ver README). |
| **360dialog** | ~49 €/mes por número, sin recargo por mensaje | ✅ documentado | ✅ soporte integrado en el CRM (solo pegar la API key) | API «en crudo», la más parecida a la de Meta. Sin bandeja propia: tu pantalla es este CRM. |
| **Meta directo** (proveedor técnico propio) | 0 €/mes (solo tarifas de Meta) | ✅ | ⚠️ requiere desarrollo extra | Hay que implementar el Embedded Signup, pasar verificación de empresa y gestionar tokens. La opción más barata si se asume ese trabajo técnico. |
| **Twilio** | Sin cuota fija; ~0,005 $ por mensaje (además de Meta) | ✅ | ⚠️ requiere adaptador (API propia) | Interesante con poco volumen (2.000 msg/mes ≈ 10 $). Orientado a desarrolladores, soporte en inglés. |
| **respond.io** | Desde ~79 $/mes | ✅ | ➖ redundante | Sin recargo por mensaje, pero es una plataforma completa con su propia bandeja: duplicaría lo que ya hace este CRM. |
| **Wati** | 49–299 $/mes | ✅ | ➖ redundante | SaaS sin código muy popular, pero su valor es su propia bandeja/chatbots; pagarías por algo que ya tienes. |
| **Gupshup** | Por mensaje (fracciones de céntimo) + planes | ✅ | ⚠️ requiere adaptador | Fuerte en India/LATAM; para España aporta poco frente a 360dialog. |

## Recomendación para la gestoría

1. **360dialog** es la opción con mejor equilibrio: cuota fija (~49 €/mes), sin
   recargo por mensaje, coexistencia documentada paso a paso y una API casi
   idéntica a la de Meta — este CRM ya la soporta de serie (variable
   `WHATSAPP_360DIALOG_API_KEY`). Total estimado: **~49 €/mes** con las
   conversaciones de servicio gratis.
2. Si más adelante quieres eliminar la cuota mensual, la vía **Meta directo**
   es viable pero exige implementar el alta (Embedded Signup) y la
   verificación de empresa; es un proyecto técnico en sí mismo.
3. Descarta en principio Wati/respond.io: son buenos productos, pero pagarías
   sobre todo por una bandeja de mensajes que este CRM ya te da, perdiendo
   además los expedientes y recordatorios a medida.

## Pasos con 360dialog (resumen)

1. Crea la cuenta en 360dialog y elige el plan de API para un número.
2. En su *Embedded Signup*, selecciona la opción de **número existente de la
   app WhatsApp Business** (Coexistence) y escanea el QR con la app del móvil
   (versión 2.24.17 o superior; el número debe tener actividad reciente).
3. Acepta la sincronización de chats (opcionalmente, los últimos 6 meses de
   historial).
4. Copia la **API key** de 360dialog y arranca el CRM:

   ```bash
   WHATSAPP_360DIALOG_API_KEY="tu_api_key" node server.js
   ```

5. Configura el webhook hacia `https://tu-dominio/webhook` desde el panel de
   360dialog, suscrito a mensajes y ecos.

## Fuentes

- Disponibilidad de Coexistence por países (UE desde nov. 2025): chakrahq.com
- Precios 360dialog: 360dialog.com/pricing, ezcontact.ai, setsmart.io
- Precios Twilio: twilio.com/en-us/pricing/messaging, zernio.com
- Coexistence en 360dialog: docs.360dialog.com/partner/onboarding/whatsapp-coexistence
- Opciones API-first para Coexistence: dualhook.com/best-whatsapp-coexistence-providers
- Modelo de precios de Meta 2026 (por plantilla, servicio gratis): respond.io/blog/whatsapp-business-api-pricing
