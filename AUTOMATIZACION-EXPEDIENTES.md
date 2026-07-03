# 📥 Automatizar la recepción de documentación de expedientes (Tráfico y Extranjería)

**Objetivo:** que el cliente suba su documentación desde la web, que llegue **ordenada a SharePoint** (una carpeta por expediente), que se te avise y que el cliente reciba confirmación — todo con la **protección de datos (RGPD)** incluida.

**Herramientas:** Jotform (formulario público con subida de archivos) + Microsoft 365 (OneDrive for Business / SharePoint + Outlook). **Sin Power Automate de pago** (ver Paso 3).

```
Cliente en la web
      │  (sube DNI, contrato, etc. + acepta RGPD)
      ▼
  FORMULARIO JOTFORM  ──►  aviso a ti (email) + confirmación al cliente (email)
      │
      ▼  (integración nativa de Jotform, o Make — ambas GRATIS)
  ONEDRIVE/SHAREPOINT: /Expedientes/<Área>/<Nombre_Trámite>/  (archivos)
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

## PASO 3 · Guardar los archivos en tu Microsoft 365 (SIN pagar)

> **Importante sobre costes:** en Power Automate, el **conector de Jotform es "premium"** (requiere plan de pago ~14 €/usuario/mes). Los conectores de SharePoint/Outlook sí van incluidos en Microsoft 365, pero el de Jotform no. **Por eso NO usamos Power Automate.** Aquí tienes las vías gratis, de mejor a más simple.

> **Nota clave:** Jotform tiene integración **nativa con OneDrive**, pero **no** con una biblioteca de un sitio de **SharePoint**. Como quieres SharePoint, usa la **Vía A (Make)** o la **Vía B (OneDrive + Power Automate estándar)** — las dos gratis.

### ✅ Vía A (recomendada para SharePoint, gratis) · Make (Integromat)
Make (plan gratuito, 1.000 operaciones/mes) coge cada envío de Jotform y lo sube a tu **biblioteca de SharePoint**:
1. Escenario: **Jotform → "Watch submissions"** (conecta tu cuenta de Jotform y elige el formulario).
2. **Microsoft SharePoint → Create a folder** (`Expedientes/{Área}/{Nombre}_{fecha}`).
3. **Iterador de archivos → Microsoft SharePoint → Upload a file** en esa carpeta.
4. (Opcional) **SharePoint → Create item** en una lista `Registro de expedientes`.
5. **Microsoft 365 Email → Send an email** avisándote.
- **Coste:** 0 € (los conectores de Make no son "premium" como en Power Automate).

### ✅ Vía B (todo Microsoft, gratis) · Jotform → OneDrive → Power Automate → SharePoint
La clave para que **no cueste**: Power Automate cobra por el conector de **Jotform** (premium), pero **NO** por los de **OneDrive** y **SharePoint** (estándar, incluidos en tu Microsoft 365).
1. En Jotform → **Settings → Integrations → Microsoft OneDrive** (OneDrive for Business): guarda los archivos en una carpeta `Bandeja-expedientes`, con **subcarpeta por expediente** usando los campos del formulario.
2. En **Power Automate**, crea un flujo con **solo conectores estándar** (gratis):
   - Desencadenador: **OneDrive for Business → "Cuando se crea un archivo"** (carpeta `Bandeja-expedientes`).
   - Acción: **SharePoint → "Crear archivo"** en tu biblioteca `Expedientes` (misma ruta/subcarpeta).
   - (Opcional) **Outlook → Enviar correo** avisándote.
- **Coste:** 0 € (no se usa ningún conector premium).

### 🗂️ Vía C (la más simple, gratis) · Solo OneDrive
Si te vale con OneDrive for Business (es tecnología SharePoint y se comparte con el equipo), usa **solo la integración nativa Jotform → OneDrive** y no montes nada más. Cero pasos técnicos.

### 🐢 Vía D (la más simple, gratis) · Manual
Jotform ya **almacena y organiza** todos los envíos y archivos y te avisa por email. Descargas y los subes tú a SharePoint. Cero automatización, cero coste.

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
