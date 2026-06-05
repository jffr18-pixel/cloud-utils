"""Analisis de documentos de extranjeria con la IA de Claude (vision + PDF).

Por cada documento (foto JPG/PNG o PDF) se pide a Claude que:
  - lo clasifique dentro de los documentos esperados del tramite,
  - extraiga datos clave (titular, numero, pais, fechas),
  - valore su vigencia y legibilidad,
  - liste incidencias detectadas.

El resultado se devuelve como diccionario normalizado. La caducidad se
recalcula en Python a partir de la fecha de caducidad cuando es legible,
para no depender solo del criterio del modelo.
"""

import base64
import io
import json
import re
from datetime import date, datetime

import anthropic
from PIL import Image, ImageOps

from . import tramites

MODELO_POR_DEFECTO = "claude-opus-4-8"

# Margen (en dias) para avisar de documentos proximos a caducar.
DIAS_AVISO_CADUCIDAD = 90

_SISTEMA = (
    "Eres un asistente experto en derecho de extranjeria espanol que ayuda a un "
    "gestor administrativo a revisar la documentacion de expedientes. Analizas "
    "documentos (fotografias o PDF) con rigor: identificas el tipo de documento, "
    "extraes los datos relevantes y senalas cualquier incidencia (ilegibilidad, "
    "documento incompleto, caducidad, datos que no coinciden, falta de firma o "
    "sello, falta de traduccion/apostilla cuando proceda). No inventas datos: si "
    "algo no es legible o no aparece, lo dejas como null y lo indicas en las "
    "incidencias. Respondes EXCLUSIVAMENTE con un objeto JSON valido."
)

# Extensiones de imagen admitidas y su media type para la API.
_MEDIA_IMAGEN = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
    "gif": "image/gif",
}


def extensiones_admitidas():
    """Lista de extensiones que acepta el cargador de archivos."""
    return ["pdf", "jpg", "jpeg", "png", "webp", "gif"]


def _preparar_imagen(datos, max_lado=2000, calidad=85):
    """Corrige orientacion EXIF, redimensiona y reencoda como JPEG.

    Las fotos de WhatsApp suelen venir rotadas y a alta resolucion; esto mejora
    la lectura y mantiene el tamano dentro de los limites de la API.
    """
    img = Image.open(io.BytesIO(datos))
    img = ImageOps.exif_transpose(img)  # respeta la orientacion de la camara
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    lado = max(img.size)
    if lado > max_lado:
        factor = max_lado / lado
        nuevo = (round(img.size[0] * factor), round(img.size[1] * factor))
        img = img.resize(nuevo, Image.LANCZOS)
    buffer = io.BytesIO()
    img.save(buffer, format="JPEG", quality=calidad)
    b64 = base64.standard_b64encode(buffer.getvalue()).decode("utf-8")
    return b64, "image/jpeg"


def _bloque_documento(nombre_archivo, datos):
    """Construye el bloque de contenido (imagen o documento PDF) para la API."""
    sufijo = nombre_archivo.lower().rsplit(".", 1)[-1] if "." in nombre_archivo else ""
    if sufijo == "pdf":
        b64 = base64.standard_b64encode(datos).decode("utf-8")
        return {
            "type": "document",
            "source": {"type": "base64", "media_type": "application/pdf", "data": b64},
        }
    if sufijo in _MEDIA_IMAGEN:
        b64, media_type = _preparar_imagen(datos)
        return {
            "type": "image",
            "source": {"type": "base64", "media_type": media_type, "data": b64},
        }
    raise ValueError(f"Formato no admitido: {nombre_archivo}")


def _instruccion(tramite_id, hoy):
    tramite = tramites.TRAMITES[tramite_id]
    return (
        f"Tramite que se esta revisando: {tramite['nombre']}.\n"
        f"Fecha de hoy: {hoy.isoformat()}.\n\n"
        "Documentos esperados en este tramite (usa el identificador entre comillas "
        "como valor de tipo_id si el documento encaja; si no encaja con ninguno, usa "
        '"no_identificado"):\n'
        f"{tramites.resumen_tipos(tramite_id)}\n\n"
        "Analiza el documento adjunto y devuelve un JSON con EXACTAMENTE estas claves:\n"
        "{\n"
        '  "tipo_id": string,            // identificador de la lista o "no_identificado"\n'
        '  "tipo_nombre": string,        // nombre del documento tal y como lo reconoces\n'
        '  "titular": string|null,       // nombre completo de la persona del documento\n'
        '  "numero": string|null,        // nº de pasaporte, NIE, NIF u otro identificador\n'
        '  "pais_emision": string|null,  // pais o autoridad emisora\n'
        '  "fecha_emision": string|null, // formato AAAA-MM-DD si es legible\n'
        '  "fecha_caducidad": string|null, // formato AAAA-MM-DD si tiene y es legible\n'
        '  "estado": string,             // vigente | caducado | proximo_a_caducar | sin_caducidad | ilegible | desconocido\n'
        '  "legibilidad": string,        // buena | regular | mala\n'
        '  "incidencias": [string],      // lista de problemas detectados (vacia si no hay)\n'
        '  "resumen": string             // una frase resumen para el gestor\n'
        "}\n"
        "Responde solo con el JSON, sin texto adicional ni bloques de codigo."
    )


def _extraer_json(texto):
    """Extrae el primer objeto JSON del texto de respuesta del modelo."""
    texto = texto.strip()
    # Quitar vallas de codigo tipo ```json ... ```
    if texto.startswith("```"):
        texto = re.sub(r"^```[a-zA-Z]*\n?", "", texto)
        texto = re.sub(r"\n?```$", "", texto).strip()
    try:
        return json.loads(texto)
    except json.JSONDecodeError:
        pass
    inicio = texto.find("{")
    fin = texto.rfind("}")
    if inicio != -1 and fin != -1 and fin > inicio:
        return json.loads(texto[inicio : fin + 1])
    raise ValueError("La respuesta de la IA no contenia un JSON valido.")


def _parse_fecha(valor):
    if not valor or not isinstance(valor, str):
        return None
    for formato in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(valor.strip(), formato).date()
        except ValueError:
            continue
    return None


def _recalcular_estado(datos, hoy, dias_aviso):
    """Recalcula la vigencia en Python a partir de la fecha de caducidad."""
    caducidad = _parse_fecha(datos.get("fecha_caducidad"))
    if caducidad is None:
        return  # se respeta el criterio del modelo (sin_caducidad / ilegible / etc.)
    if caducidad < hoy:
        datos["estado"] = "caducado"
        aviso = f"Documento caducado el {caducidad.isoformat()}."
        if aviso not in datos.get("incidencias", []):
            datos.setdefault("incidencias", []).append(aviso)
    elif (caducidad - hoy).days <= dias_aviso:
        datos["estado"] = "proximo_a_caducar"
        aviso = f"Caduca pronto ({caducidad.isoformat()})."
        if aviso not in datos.get("incidencias", []):
            datos.setdefault("incidencias", []).append(aviso)
    else:
        datos["estado"] = "vigente"


def _normalizar(datos):
    """Garantiza que existan todas las claves esperadas con tipos correctos."""
    base = {
        "tipo_id": "no_identificado",
        "tipo_nombre": "",
        "titular": None,
        "numero": None,
        "pais_emision": None,
        "fecha_emision": None,
        "fecha_caducidad": None,
        "estado": "desconocido",
        "legibilidad": "regular",
        "incidencias": [],
        "resumen": "",
    }
    base.update({k: v for k, v in datos.items() if k in base})
    if not isinstance(base["incidencias"], list):
        base["incidencias"] = [str(base["incidencias"])]
    return base


def analizar_documento(
    cliente,
    datos_archivo,
    nombre_archivo,
    tramite_id,
    modelo=MODELO_POR_DEFECTO,
    hoy=None,
    dias_aviso=DIAS_AVISO_CADUCIDAD,
):
    """Analiza un unico documento y devuelve el diccionario de resultados.

    cliente:        instancia de anthropic.Anthropic
    datos_archivo:  bytes del archivo
    nombre_archivo: nombre original (se usa para detectar el formato)
    tramite_id:     clave en tramites.TRAMITES
    """
    if hoy is None:
        hoy = date.today()

    bloque = _bloque_documento(nombre_archivo, datos_archivo)
    instruccion = _instruccion(tramite_id, hoy)

    respuesta = cliente.messages.create(
        model=modelo,
        max_tokens=2000,
        system=_SISTEMA,
        messages=[
            {
                "role": "user",
                "content": [bloque, {"type": "text", "text": instruccion}],
            }
        ],
    )

    texto = next((b.text for b in respuesta.content if b.type == "text"), "")
    datos = _normalizar(_extraer_json(texto))
    _recalcular_estado(datos, hoy, dias_aviso)
    datos["archivo"] = nombre_archivo
    return datos


def evaluar_expediente(documentos_analizados, tramite_id):
    """Cruza los documentos analizados con la lista exigida por el tramite.

    Devuelve una lista de filas, una por documento esperado, con su estado, y
    ademas detecta los documentos aportados que no encajan en ningun requisito.
    """
    por_tipo = {}
    for doc in documentos_analizados:
        por_tipo.setdefault(doc.get("tipo_id", "no_identificado"), []).append(doc)

    checklist = []
    for requisito in tramites.documentos_de(tramite_id):
        encontrados = por_tipo.get(requisito["id"], [])
        if not encontrados:
            estado = "falta" if requisito["obligatorio"] else "falta_opcional"
        else:
            estados = {d["estado"] for d in encontrados}
            if "caducado" in estados:
                estado = "caducado"
            elif "proximo_a_caducar" in estados:
                estado = "proximo_a_caducar"
            elif any(d["incidencias"] for d in encontrados):
                estado = "con_incidencias"
            else:
                estado = "correcto"
        checklist.append(
            {
                "id": requisito["id"],
                "nombre": requisito["nombre"],
                "obligatorio": requisito["obligatorio"],
                "estado": estado,
                "documentos": encontrados,
                "notas": requisito.get("notas", ""),
            }
        )

    no_identificados = por_tipo.get("no_identificado", [])
    return checklist, no_identificados


def expediente_listo(checklist):
    """True si no falta ningun documento obligatorio ni hay caducados."""
    for fila in checklist:
        if fila["estado"] in ("falta", "caducado"):
            return False
    return True
