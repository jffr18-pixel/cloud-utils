# 📥 Automatizar la recepción de documentación de expedientes (Tráfico y Extranjería)

**Objetivo:** que el cliente suba su documentación desde la web, que llegue **ordenada a SharePoint** (una carpeta por expediente), que se te avise y que el cliente reciba confirmación — todo con la **protección de datos (RGPD)** incluida.

**Herramientas:** Jotform (formulario público con subida de archivos) + Microsoft 365 (SharePoint + Power Automate + Outlook).

```
Cliente en la web
      │  (sube DNI, contrato, etc. + acepta RGPD)
      ▼
  FORMULARIO JOTFORM  ──►  aviso a ti (email) + confirmación al cliente (email)
      │
      ▼  (Power Automate)
  SHAREPOINT: /Expedientes/<Área>/<Apellido_Nombre_Fecha>/  (archivos)
                     + fila en la lista "Registro de expedientes"
```

> ¿Por qué Jotform y no Microsoft Forms? Porque el cliente es **externo** (no tiene cuenta de tu Microsoft 365). La subida de archivos de Microsoft Forms obliga a iniciar sesión con cuenta de la organización, así que no sirve para clientes. Jotform es **público** y luego mandamos los archivos a tu SharePoint.

---

## PASO 1 · Crear el formulario en Jotform

1. Crea una cuenta en **jotform.com** (hay plan gratuito; para más envíos/archivos y **residencia de datos en la UE** usa un plan de pago — ver nota RGPD).
2. En **Ajustes del formulario → Data → Data Residency**, elige **Europa (GDPR)**.
3. Añade estos campos:

| Campo | Tipo | Notas |
|---|---|---|
| Área | Desplegable | Opciones: **Tráfico** · **Extranjería** |
| Trámite | Desplegable | Se muestra según el Área (condición). Tráfico: transferencia, notificación de venta, matriculación, baja, duplicado, otros. Extranjería: NIE, TIE, arraigo, residencia no lucrativa, residencia y trabajo, reagrupación, renovación, larga duración, nacionalidad, otros. |
| Nombre y apellidos | Texto | Obligatorio |
| DNI / NIE / Pasaporte | Texto | Obligatorio |
| Teléfono | Teléfono | Obligatorio |
| Email | Email | Obligatorio |
| **Documentos** | **Subida de archivos** | Permite varios archivos (PDF/JPG/PNG). Sube el límite de tamaño en los ajustes del campo. |
| Checklist del trámite | Texto/HTML (condicional) | Muestra la lista de documentos según el trámite elegido (usa las listas que ya tenemos en la web: sección "¿Qué documentación necesitas?"). |
| Observaciones | Área de texto | Opcional |
| Casilla RGPD | Casilla de verificación | Obligatoria (texto abajo) |
| Casilla autorización | Casilla de verificación | Obligatoria (texto abajo) |
| Aviso de protección de datos | Texto | Visible siempre (texto abajo) |

**Truco (documentos por trámite):** en vez de crear muchos campos de subida, usa **un solo campo de subida** + un **bloque de texto condicional** que muestre la lista de documentos del trámite seleccionado (los tienes ya redactados en la web). Así el cliente ve exactamente qué subir.

---

## PASO 2 · Textos de PROTECCIÓN DE DATOS (copia y pega en el formulario)

**Aviso de protección de datos (texto visible, encima de las casillas):**

> **Información básica de protección de datos**
> **Responsable:** Burocracia Zero S.L.P. (CIF B56918402) · Calle Río Alberche, 38 (Tiendas G), Local 32, 45007 Toledo · jose@burocraciazero.es
> **Finalidad:** gestionar y tramitar tu expediente (trámites de tráfico/DGT o de extranjería) y comunicarnos contigo.
> **Legitimación:** la ejecución del encargo de servicios que nos solicitas y tu consentimiento.
> **Destinatarios:** los organismos públicos competentes para el trámite (DGT, Administración de Extranjería/Policía, Hacienda) cuando sea necesario para gestionarlo; los proveedores tecnológicos que alojan los datos por nuestra cuenta (con garantías adecuadas). No se cederán a otros terceros salvo obligación legal.
> **Conservación:** mientras dure la relación y, después, durante los plazos legales aplicables.
> **Derechos:** acceso, rectificación, supresión, oposición, limitación y portabilidad, escribiendo a jose@burocraciazero.es. Puedes consultar la información ampliada en nuestra **Política de Privacidad**.

**Casilla 1 (obligatoria) — consentimiento:**

> He leído y acepto la **Política de Privacidad** y consiento el tratamiento de mis datos y documentos para la gestión de mi expediente.

**Casilla 2 (obligatoria) — autorización de representación:**

> Autorizo a **Burocracia Zero S.L.P.** a actuar como mi representante y a presentar los trámites en mi nombre ante la Administración competente.

---

## PASO 3 · Guardar los archivos en SharePoint (con Power Automate)

**Preparación en SharePoint (una vez):**
1. En tu sitio de SharePoint, crea una **biblioteca de documentos** llamada `Expedientes`.
2. (Opcional pero recomendable) crea una **lista** llamada `Registro de expedientes` con columnas: Fecha, Área, Trámite, Nombre, DNI/NIE, Teléfono, Email, Carpeta.

**Flujo en Power Automate (make.powerautomate.com):**
1. **Desencadenador:** Jotform → *"When a new submission is received"* (conector de Jotform; conéctalo con tu cuenta de Jotform y elige el formulario).
2. **Redactar (Compose)** el nombre de carpeta: `@{Área}/@{Apellido_Nombre}_@{utcNow('yyyy-MM-dd')}`.
3. **SharePoint → Crear nueva carpeta** en la biblioteca `Expedientes` con ese nombre.
4. Por cada archivo subido: **HTTP GET** a la URL del archivo de Jotform → **SharePoint → Crear archivo** dentro de la carpeta (nombre y contenido del archivo).
5. **SharePoint → Crear elemento** en la lista `Registro de expedientes` con los datos del formulario.
6. **Outlook → Enviar un correo** a jose@burocraciazero.es avisándote (con el enlace a la carpeta).

> Alternativa más rápida (sin carpeta por expediente): usa la integración nativa **Jotform → OneDrive for Business**; los archivos caen en una carpeta de OneDrive (que también es SharePoint). Menos ordenado, pero se monta en 2 clics.

---

## PASO 4 · Avisos automáticos

En Jotform → **Settings → Emails**:
- **Notification email** → a `jose@burocraciazero.es`: te llega cada envío con los datos y los archivos.
- **Autoresponder email** → al cliente (a su email): *"Hemos recibido tu documentación para tu expediente de [Trámite]. La revisamos y te contamos los siguientes pasos. — Burocracia Zero"*.

---

## PASO 5 · Poner el formulario en la web (Wix)

Opción sencilla: un **botón** "📎 Subir mi documentación" que **abra el formulario de Jotform** (enlace directo). Así evitas problemas de tamaño dentro del recuadro.
Opción incrustada: Jotform te da un código **"Embed"**; pégalo en un elemento *Insertar HTML* de Wix en una página propia (p. ej. `/enviar-documentacion`).

Puedo añadir ese botón "Subir mi documentación" en las dos landings (tráfico y extranjería) apuntando a tu formulario cuando lo tengas creado — solo necesito el enlace del Jotform.

---

## ⚠️ RGPD y seguridad (importante)

- Vas a manejar datos sensibles (DNI, pasaporte, **antecedentes penales**). Trátalos con cuidado y no pidas más de lo necesario.
- **Contrato de encargado de tratamiento (DPA):** fírmalo con **Jotform** (ofrecen DPA y opción de **datos en la UE**) y ya lo tienes con **Microsoft 365**.
- Mantén el acceso a la carpeta de SharePoint **restringido** al personal de la gestoría.
- Evita recibir documentación sensible por **WhatsApp**; deriva siempre al formulario seguro.
- Añade este formulario a tu **Registro de Actividades de Tratamiento**.

> Si me pasas el **enlace del formulario Jotform** cuando lo tengas, te añado el botón "Subir documentación" en las dos webs y te ayudo a redactar el email de confirmación al cliente.
