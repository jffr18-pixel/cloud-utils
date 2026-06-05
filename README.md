# cloud-utils

Utilidades en Python. Incluye una aplicacion para **automatizar la revision de
expedientes de extranjeria**.

## Revision de expedientes de extranjeria

Aplicacion con interfaz grafica que lee la documentacion de un expediente
(PDF o fotos de WhatsApp), la clasifica con IA y comprueba que documentacion
**falta, esta caducada o tiene incidencias** segun el tipo de tramite.

### Que hace

- Lee fotos (JPG/PNG/WebP) y PDF — corrige la orientacion de las fotos de movil.
- Permite **agrupar varias fotos como un solo documento** (p.ej. las 4 fotos de
  un pasaporte) asignandoles el mismo numero de grupo.
- Clasifica cada documento dentro de los exigidos por el tramite.
- Extrae datos clave: titular, nº de pasaporte/NIE, pais, fechas.
- Detecta documentos **caducados** o **proximos a caducar** (margen configurable).
- Marca documentos **que faltan** (obligatorios y opcionales).
- Genera un **informe de revision** descargable en **Markdown, Word (.docx) y
  PDF**, con acciones recomendadas.
- **Membrete propio**: anade el logo y los datos de tu gestoria a los informes.
- **Editor de tramites** desde la propia interfaz: anade, edita o elimina la
  documentacion de cada tramite (o crea tramites nuevos) sin tocar codigo.
- **Historial** de expedientes revisados: consulta revisiones anteriores y
  vuelve a descargar su informe en cualquier formato.

### Organizacion de la app

La interfaz tiene cuatro secciones (menu lateral):

- **Revisar expediente** — el flujo principal de analisis.
- **Historial** — expedientes revisados anteriormente.
- **Tramites** — editar la documentacion exigida por cada tramite.
- **Gestoria** — logo y datos para el membrete de los informes.

Los ajustes y el historial se guardan en la carpeta `datos/` (configurable con
la variable de entorno `EXTRANJERIA_DATOS`).

### Tramites incluidos

Regularizacion extraordinaria · Cambio de razones humanitarias a residencia y
trabajo · Arraigo social · Arraigo sociolaboral · Arraigo laboral · Arraigo
familiar · Arraigo para la formacion · Arraigo de segunda oportunidad.

Las listas de documentos son **editables** en `revision/tramites.py`.

### Instalacion

```bash
pip install -r requirements.txt
```

### Configurar la clave de API

La lectura de documentos usa la API de Claude (Anthropic). Define tu clave:

```bash
export ANTHROPIC_API_KEY="tu-clave"
```

Tambien puedes introducirla directamente en la barra lateral de la aplicacion.

### Ejecutar

```bash
streamlit run app.py
```

Se abre en el navegador. Pasos: elegir tramite → subir documentos →
*Analizar expediente* → revisar el checklist → descargar el informe.

### Estructura

- `app.py` — interfaz grafica (Streamlit).
- `revision/tramites.py` — tramites y documentacion exigida (editable).
- `revision/analizador.py` — lectura de documentos con IA (vision + PDF).
- `revision/informe.py` — generacion del informe de revision.

### Nota

La herramienta es un **apoyo** a la revision; no sustituye el criterio
profesional del gestor. Las fotos en formato HEIC (iPhone) conviene pasarlas a
JPG antes de subirlas; WhatsApp normalmente ya las envia como JPG.

## Calculadora

`calculator.py` — operaciones aritmeticas basicas (add, subtract, multiply, divide).

```python
from calculator import add, subtract, multiply, divide

print(add(3, 5))       # 8
print(divide(9, 3))    # 3.0
```

## Tests

```bash
python -m pytest tests/
```
