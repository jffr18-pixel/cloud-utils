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
- **Carta de requerimiento** automatica al cliente (TXT y Word) con la lista de
  lo que falta o hay que renovar.
- **Sugerencia de tramite** por IA a partir de los documentos aportados.
- **Vista previa** de cada documento (foto o PDF) junto a su analisis.
- **Comprobaciones automaticas**: coherencia de nombre y nº de pasaporte entre
  documentos, y calculo de los anios de permanencia acreditados.
- **Editor de tramites** desde la propia interfaz: anade, edita o elimina la
  documentacion de cada tramite (o crea tramites nuevos) sin tocar codigo.
- **Historial** con busqueda y filtros, y agrupacion por cliente.
- **Avisos de caducidad**: seguimiento proactivo de documentos que caducan en
  expedientes ya revisados.
- **Perfiles de usuario**: varias personas o despachos pueden trabajar por
  separado, cada uno con sus tramites, su membrete y su historial.
- Soporte de **fotos HEIC** de iPhone (requiere `pillow-heif`).
- **Envio al cliente**: mensaje de WhatsApp listo para copiar (con enlace
  wa.me) y envio por **email** con los documentos adjuntos (SMTP).
- **Ficha estructurada** del expediente exportable a **Excel y CSV**.
- **Comprobacion de fechas**: detecta emisiones futuras, caducidades
  incoherentes y contratos anteriores a la permanencia acreditada.
- **Doble verificacion**: dos modelos de IA revisan y se marcan las
  discrepancias (mas fiable).
- **Seguimiento del expediente** presentado: nº de expediente, NIE, linea de
  tiempo de estados, tareas y resultado final.
- **Calendario** de tareas y recordatorios de todos los expedientes.
- **Estadisticas**: expedientes por tramite, % completos, documentos que mas fallan.
- **Control de versiones**: al reenviar un documento renovado, sustituye al
  anterior, que queda archivado.
- **Copia de seguridad**: exportar/importar todo el perfil en un ZIP.
- **RGPD**: anonimizacion de expedientes y borrado automatico por antiguedad.

### Seguimiento con el numero de expediente

El sistema oficial de la Administracion no ofrece una consulta automatica
fiable (sin API publica), por lo que el seguimiento del estado se registra de
forma **manual**: cada vez que consultas el estado, lo anotas y la app guarda
la linea de tiempo del expediente. Programa recordatorios en el Calendario.

### Organizacion de la app

La interfaz tiene nueve secciones (menu lateral):

- **Revisar expediente** — el flujo principal de analisis.
- **Historial** — expedientes revisados, con busqueda, filtros y agrupacion.
- **Seguimiento** — nº de expediente, estados, tareas y documentos nuevos.
- **Caducidades** — documentos que caducan pronto en expedientes ya revisados.
- **Calendario** — tareas y recordatorios de todos los expedientes.
- **Estadisticas** — metricas del perfil.
- **Tramites** — editar la documentacion exigida por cada tramite.
- **Gestoria** — logo y datos para el membrete de informes y cartas.
- **Ajustes** — email (SMTP), RGPD y copia de seguridad.

En la barra lateral se elige el **perfil de trabajo**. Los ajustes y el
historial se guardan en `datos/perfiles/<perfil>/` (la raiz es configurable con
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
