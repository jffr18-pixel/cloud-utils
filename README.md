# Burocracia Zero · CRM de WhatsApp

CRM de WhatsApp para la gestoría **Burocracia Zero**: atención por WhatsApp,
expedientes, citas, agenda, fichas de trámite, informes, portal del cliente
(seguimiento, reserva de cita, subida de documentos, consentimiento RGPD y
multi-idioma), automatizaciones, seguridad con CAPTCHA y utilidades de
productividad interna.

## Estructura

- **`whatsapp-crm/`** — la aplicación (servidor Node.js sin dependencias,
  interfaz web y pruebas). Ver [`whatsapp-crm/README.md`](whatsapp-crm/README.md)
  para arrancarlo y configurarlo.
- **`render.yaml`** — blueprint de despliegue en [Render](https://render.com).

## Arranque rápido

```bash
cd whatsapp-crm
node server.js        # http://localhost:3000
node test.js          # pruebas
```

Las variables de entorno (WhatsApp/YCloud, acceso, Microsoft 365, etc.) se
documentan en `whatsapp-crm/README.md` y en `render.yaml`.
