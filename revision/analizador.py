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
import unicodedata
from datetime import date, datetime

import anthropic
from PIL import Image, ImageOps

from . import tramites

# Soporte para fotos HEIC/HEIF de iPhone (si la libreria esta instalada).
try:
    from pillow_heif import register_heif_opener

    register_heif_opener()
    _HEIC_OK = True
except Exception:  # noqa: BLE001
    _HEIC_OK = False

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
# Las HEIC/HEIF se convierten a JPEG antes de enviarse.
_MEDIA_IMAGEN = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
    "gif": "image/gif",
    "heic": "image/jpeg",
    "heif": "image/jpeg",
}


def extensiones_admitidas():
    """Lista de extensiones que acepta el cargador de archivos."""
    base = ["pdf", "jpg", "jpeg", "png", "webp", "gif"]
    if _HEIC_OK:
        base += ["heic", "heif"]
    return base


def miniatura(datos, max_lado=900):
    """Devuelve una version JPEG reducida de una imagen, para vista previa."""
    b64, _ = _preparar_imagen(datos, max_lado=max_lado)
    return base64.b64decode(b64)


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


def _bloques_documento(paginas):
    """Construye los bloques de contenido para un documento de varias paginas.

    paginas: lista de tuplas (nombre_archivo, datos_bytes). Cada foto o PDF se
    convierte en un bloque; todas se envian juntas para analizarlas como un
    unico documento (p.ej. las 4 fotos de un pasaporte).
    """
    return [_bloque_documento(nombre, datos) for nombre, datos in paginas]


def _instruccion(tramite_id, hoy):
    tramite = tramites.TRAMITES[tramite_id]
    return (
        f"Tramite que se esta revisando: {tramite['nombre']}.\n"
        f"Fecha de hoy: {hoy.isoformat()}.\n\n"
        "Documentos esperados en este tramite (usa el identificador entre comillas "
        "como valor de tipo_id si el documento encaja; si no encaja con ninguno, usa "
        '"no_identificado"):\n'
        f"{tramites.resumen_tipos(tramite_id)}\n\n"
        "Las imagenes o paginas adjuntas corresponden a UN UNICO documento (por "
        "ejemplo, varias fotos de las distintas paginas de un mismo pasaporte o "
        "contrato). Analizalas en conjunto y emite un solo resultado.\n\n"
        "Analiza el documento adjunto y devuelve un JSON con EXACTAMENTE estas claves:\n"
        "{\n"
        '  "tipo_id": string,            // identificador de la lista o "no_identificado"\n'
        '  "tipo_nombre": string,        // nombre del documento tal y como lo reconoces\n'
        '  "titular": string|null,       // nombre completo de la persona del documento\n'
        '  "numero": string|null,        // nº de pasaporte, NIE, NIF u otro identificador\n'
        '  "pais_emision": string|null,  // pais o autoridad emisora\n'
        '  "nacionalidad_doc": string|null, // nacionalidad indicada en el documento (p.ej. "MARROQUI", "RUMANA"); null si no aparece\n'
        '  "fecha_nacimiento": string|null, // fecha de nacimiento en AAAA-MM-DD si es legible; null si no aparece\n'
        '  "sexo": string|null,          // "H" o "M" si aparece; null si no\n'
        '  "fecha_emision": string|null, // formato AAAA-MM-DD si es legible\n'
        '  "fecha_caducidad": string|null, // formato AAAA-MM-DD si tiene y es legible\n'
        '  "fecha_acredita_desde": string|null, // si el documento prueba presencia/permanencia en Espana desde una fecha (p.ej. fecha de alta en el padron historico o primer sello de entrada), en AAAA-MM-DD; si no, null\n'
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
        "nacionalidad_doc": None,
        "fecha_nacimiento": None,
        "sexo": None,
        "fecha_emision": None,
        "fecha_caducidad": None,
        "fecha_acredita_desde": None,
        "estado": "desconocido",
        "legibilidad": "regular",
        "incidencias": [],
        "resumen": "",
    }
    base.update({k: v for k, v in datos.items() if k in base})
    if not isinstance(base["incidencias"], list):
        base["incidencias"] = [str(base["incidencias"])]
    return base


# --------------------------------------------------------------------------- #
#  Extraccion automatica de datos personales del cliente
# --------------------------------------------------------------------------- #

# Prioridad de los documentos como fuente de datos personales.
# El pasaporte es el mas fiable para nombre y nacionalidad.
_PRIORIDAD_DATOS = (
    "pasaporte",
    "nie",
    "tie",
    "tarjeta_residencia",
    "tarjeta_comunitaria",
    "dni",
    "permiso_trabajo",
)


def _mejor_doc(resultados, tipos_preferidos):
    """Devuelve el primer documento de la lista cuyo tipo_id este en tipos_preferidos."""
    for tipo in tipos_preferidos:
        for doc in resultados:
            if doc.get("tipo_id") == tipo and doc.get("legibilidad") != "mala":
                return doc
    # fallback: cualquier doc con titular
    for doc in resultados:
        if doc.get("titular") and doc.get("legibilidad") != "mala":
            return doc
    return None


def extraer_datos_cliente(resultados):
    """Consolida los datos personales extraidos de todos los documentos analizados.

    Devuelve un dict con los campos que se pueden rellenar automaticamente en
    la ficha del cliente. Solo incluye campos no vacios para no sobrescribir
    datos ya registrados.

    Mapeo:
      titular        → nombre
      numero         → num_pasaporte (pasaporte) / nie (NIE/TIE)
      pais_emision   → nacionalidad (para pasaportes)
      nacionalidad_doc → nacionalidad (fallback)
      fecha_nacimiento → fecha_nacimiento
      fecha_caducidad → cad_pasaporte (pasaporte)
      fecha_acredita_desde (min) → fecha_entrada_espana
    """
    if not resultados:
        return {}

    datos = {}

    # Documento principal para nombre, nacionalidad y DOB
    doc_id = _mejor_doc(resultados, _PRIORIDAD_DATOS)
    if doc_id:
        if doc_id.get("titular"):
            datos["nombre"] = doc_id["titular"].strip().title()
        nac = doc_id.get("nacionalidad_doc") or doc_id.get("pais_emision")
        if nac and doc_id.get("tipo_id") in ("pasaporte", "nie", "tie", "tarjeta_residencia",
                                              "tarjeta_comunitaria"):
            datos["nacionalidad"] = nac.strip().capitalize()
        if doc_id.get("fecha_nacimiento"):
            datos["fecha_nacimiento"] = doc_id["fecha_nacimiento"]

    # Nacionalidad: si el doc de identidad no la tenia, buscarla en cualquier
    # otro documento que la mencione (p. ej. empadronamiento, contrato).
    if not datos.get("nacionalidad"):
        for doc in resultados:
            nac = doc.get("nacionalidad_doc")
            if nac and len(nac.strip()) >= 4:
                datos["nacionalidad"] = nac.strip().capitalize()
                break

    # Numero de pasaporte
    for doc in resultados:
        if doc.get("tipo_id") == "pasaporte" and doc.get("numero"):
            datos["num_pasaporte"] = doc["numero"].strip().upper()
            if doc.get("fecha_caducidad"):
                datos["cad_pasaporte"] = doc["fecha_caducidad"]
            break

    # NIE / TIE
    for doc in resultados:
        if doc.get("tipo_id") in ("nie", "tie", "tarjeta_residencia") and doc.get("numero"):
            datos["nie"] = doc["numero"].strip().upper()
            break
    # Si no hubo doc NIE/TIE, aceptar un NIE detectado en cualquier otro documento
    if not datos.get("nie"):
        for doc in resultados:
            num = (doc.get("numero") or "").strip().upper()
            if re.fullmatch(r"[XYZ]\d{7}[A-Z]", num):
                datos["nie"] = num
                break

    # Fecha de entrada en España (la mas antigua entre todos los docs)
    fechas_entrada = []
    for doc in resultados:
        f = _parse_fecha(doc.get("fecha_acredita_desde"))
        if f:
            fechas_entrada.append(f)
    if fechas_entrada:
        datos["fecha_entrada_espana"] = min(fechas_entrada).isoformat()

    # Datos laborales (del contrato de trabajo)
    for doc in resultados:
        if doc.get("tipo_id") == "contrato_trabajo":
            if doc.get("empleador") and not datos.get("empleador"):
                datos["empleador"] = doc["empleador"].strip()
            if doc.get("tipo_contrato") and not datos.get("tipo_contrato"):
                datos["tipo_contrato"] = doc["tipo_contrato"].strip()

    # Domicilio, telefono y email: tomar el primer valor no vacio disponible
    for campo_origen, campo_destino in (
        ("direccion", "direccion"),
        ("telefono", "telefono"),
        ("email", "email_cliente"),
    ):
        for doc in resultados:
            valor = (doc.get(campo_origen) or "").strip()
            if valor:
                datos[campo_destino] = valor
                break

    return {k: v for k, v in datos.items() if v}


def _una_pasada(cliente, bloques, instruccion, modelo, hoy, dias_aviso):
    """Una llamada a la IA para un documento; devuelve el dict normalizado."""
    respuesta = cliente.messages.create(
        model=modelo,
        max_tokens=2000,
        system=_SISTEMA,
        messages=[{"role": "user", "content": bloques + [{"type": "text", "text": instruccion}]}],
    )
    texto = next((b.text for b in respuesta.content if b.type == "text"), "")
    datos = _normalizar(_extraer_json(texto))
    _recalcular_estado(datos, hoy, dias_aviso)
    return datos


# Orden de gravedad de los estados (para quedarse con el mas conservador).
_GRAVEDAD = {
    "caducado": 0,
    "ilegible": 1,
    "proximo_a_caducar": 2,
    "desconocido": 3,
    "sin_caducidad": 4,
    "vigente": 5,
}


def _fundir(a, b):
    """Combina dos analisis del mismo documento (doble verificacion).

    Se queda con el estado mas conservador y registra como incidencias las
    discrepancias entre ambos modelos.
    """
    res = dict(a)
    incidencias = list(a.get("incidencias", []))
    if a.get("tipo_id") != b.get("tipo_id"):
        incidencias.append(
            f"Doble verificacion: clasificacion distinta entre modelos "
            f"('{a.get('tipo_id')}' vs '{b.get('tipo_id')}')."
        )
    if a.get("estado") != b.get("estado"):
        incidencias.append(
            f"Doble verificacion: estado distinto entre modelos "
            f"('{a.get('estado')}' vs '{b.get('estado')}')."
        )
        if _GRAVEDAD.get(b.get("estado"), 9) < _GRAVEDAD.get(a.get("estado"), 9):
            res["estado"] = b["estado"]
    if a.get("fecha_caducidad") != b.get("fecha_caducidad"):
        incidencias.append(
            f"Doble verificacion: fecha de caducidad distinta "
            f"('{a.get('fecha_caducidad')}' vs '{b.get('fecha_caducidad')}')."
        )
    res["incidencias"] = incidencias
    res["doble_verificado"] = True
    return res


def analizar_documento(
    cliente,
    paginas,
    tramite_id,
    modelo=MODELO_POR_DEFECTO,
    hoy=None,
    dias_aviso=DIAS_AVISO_CADUCIDAD,
    modelo_secundario=None,
):
    """Analiza un documento (una o varias paginas) y devuelve los resultados.

    cliente:           instancia de anthropic.Anthropic
    paginas:           lista de tuplas (nombre_archivo, datos_bytes).
    tramite_id:        clave en tramites.TRAMITES
    modelo_secundario: si se indica, se hace una segunda pasada con ese modelo
                       y se combinan (doble verificacion).
    """
    if hoy is None:
        hoy = date.today()
    if not paginas:
        raise ValueError("No se han aportado paginas para analizar.")

    bloques = _bloques_documento(paginas)
    instruccion = _instruccion(tramite_id, hoy)

    datos = _una_pasada(cliente, bloques, instruccion, modelo, hoy, dias_aviso)
    if modelo_secundario:
        segundo = _una_pasada(cliente, bloques, instruccion, modelo_secundario, hoy, dias_aviso)
        datos = _fundir(datos, segundo)

    nombres = [nombre for nombre, _ in paginas]
    datos["archivos"] = nombres
    datos["archivo"] = ", ".join(nombres)
    return datos


# Mapeo de tipo_id generico del OCR → IDs de requisito de tramite que satisface.
# Permite que los resultados OCR (que usan categorias amplias) encajen en el checklist.
_ALIAS_TIPO_DOC = {
    "pasaporte":          ["pasaporte"],
    "nie":                ["nie"],
    "tie":                ["tie"],
    "dni":                ["dni"],
    "empadronamiento":    ["empadronamiento", "empadronamiento_conjunto",
                           "prueba_permanencia_2", "prueba_presencia_antes_2026",
                           "prueba_permanencia_5_meses"],
    "vida_laboral":       ["vida_laboral"],
    "contrato_trabajo":   ["contrato_trabajo", "circunstancia_trabajo"],
    "nomina":             ["nomina", "documentacion_empresa"],
    "informe_arraigo":    ["informe_integracion"],
    "certificado_penal":  ["antecedentes_espana", "antecedentes_origen"],
    "acta_nacimiento":    ["vinculo_familiar", "vinculo_familiar_residente",
                           "circunstancia_familia"],
    "titulo_academico":   ["matricula_o_admision", "informe_aprovechamiento"],
    "seguro_medico":      ["seguro_medico"],
    "tarjeta_comunitaria": ["documentacion_menor_ue"],
    "solicitud_ex":       ["solicitud_ex", "solicitud_ex10", "solicitud_ex32",
                           "solicitud_ex_humanitaria"],
    "tasa":               ["tasa_790_052"],
    "resolucion":         ["resolucion_laboral", "autorizacion_previa",
                           "autorizacion_humanitaria_vigente",
                           "resolucion_o_informe_causa"],
    "vinculo_familiar":   ["vinculo_familiar", "vinculo_familiar_residente",
                           "circunstancia_familia"],
    "cuenta_propia":      ["cuenta_propia", "circunstancia_trabajo",
                           "documentacion_empresa"],
    "certificado_discapacidad": ["certificado_discapacidad",
                                 "circunstancia_vulnerabilidad"],
}

# Indice inverso: req_id → lista de tipo_id OCR que lo satisfacen
_REQ_A_TIPOS_OCR: dict[str, list[str]] = {}
for _tipo, _reqs in _ALIAS_TIPO_DOC.items():
    for _req in _reqs:
        _REQ_A_TIPOS_OCR.setdefault(_req, []).append(_tipo)


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
            # Buscar por alias: un tipo OCR generico puede satisfacer este requisito
            for tipo_alias in _REQ_A_TIPOS_OCR.get(requisito["id"], []):
                if tipo_alias in por_tipo:
                    encontrados = por_tipo[tipo_alias]
                    break
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


# --------------------------------------------------------------------------- #
#  Comprobaciones de coherencia entre documentos
# --------------------------------------------------------------------------- #
def _normalizar_nombre(nombre):
    """Normaliza un nombre para comparar (mayusculas, sin acentos, ordenado)."""
    if not nombre:
        return ""
    texto = unicodedata.normalize("NFD", nombre.upper())
    texto = "".join(c for c in texto if unicodedata.category(c) != "Mn")
    tokens = re.findall(r"[A-Z]+", texto)
    return " ".join(sorted(tokens))


def comprobar_coherencia(resultados):
    """Detecta posibles incoherencias entre los documentos del expediente.

    Avisa si hay documentos a nombre de personas distintas o numeros de
    pasaporte que no coinciden (posible mezcla de expedientes).
    """
    avisos = []

    titulares = {}
    for doc in resultados:
        titular = (doc.get("titular") or "").strip()
        if titular:
            titulares.setdefault(_normalizar_nombre(titular), set()).add(titular)
    if len(titulares) > 1:
        nombres = sorted({n for grupo in titulares.values() for n in grupo})
        avisos.append(
            "Hay documentos a nombre de personas distintas: "
            + ", ".join(nombres)
            + ". Verifica que todos pertenecen al mismo expediente."
        )

    numeros = set()
    for doc in resultados:
        if doc.get("tipo_id") == "pasaporte" and doc.get("numero"):
            numeros.add(doc["numero"].strip().upper())
    if len(numeros) > 1:
        avisos.append(
            "Se han detectado numeros de pasaporte distintos: " + ", ".join(sorted(numeros)) + "."
        )

    return avisos


def comprobar_fechas(resultados, hoy=None):
    """Detecta incoherencias de fechas entre documentos.

    Avisa de fechas de emision futuras, caducidades anteriores a la emision y
    contratos firmados antes de la fecha de permanencia/entrada acreditada.
    """
    if hoy is None:
        hoy = date.today()
    avisos = []

    entradas = [_parse_fecha(d.get("fecha_acredita_desde")) for d in resultados]
    entradas = [e for e in entradas if e]
    entrada_min = min(entradas) if entradas else None

    for doc in resultados:
        nombre = doc.get("tipo_nombre") or doc.get("archivo", "documento")
        emision = _parse_fecha(doc.get("fecha_emision"))
        caducidad = _parse_fecha(doc.get("fecha_caducidad"))
        if emision and emision > hoy:
            avisos.append(f"{nombre}: la fecha de emision ({emision.isoformat()}) es futura.")
        if emision and caducidad and caducidad < emision:
            avisos.append(
                f"{nombre}: la caducidad ({caducidad.isoformat()}) es anterior a la emision "
                f"({emision.isoformat()})."
            )
        if (
            doc.get("tipo_id") == "contrato_trabajo"
            and emision
            and entrada_min
            and emision < entrada_min
        ):
            avisos.append(
                f"{nombre}: el contrato ({emision.isoformat()}) es anterior a la permanencia "
                f"acreditada ({entrada_min.isoformat()}); revisar coherencia."
            )
    return avisos


def incidencias_expediente(resultados, hoy=None):
    """Todas las incidencias transversales: coherencia + fechas."""
    return comprobar_coherencia(resultados) + comprobar_fechas(resultados, hoy)


# --------------------------------------------------------------------------- #
#  Calculo de permanencia / plazos
# --------------------------------------------------------------------------- #
def calcular_permanencia(resultados, tramite_id, hoy=None):
    """Estima los anios de permanencia acreditados frente a los exigidos.

    Devuelve None si el tramite no tiene requisito de permanencia o si no se
    puede determinar ninguna fecha de inicio.
    """
    if hoy is None:
        hoy = date.today()
    tramite = tramites.TRAMITES.get(tramite_id, {})
    requeridos = tramite.get("anios_permanencia")
    if not requeridos:
        return None

    fechas = []
    for doc in resultados:
        fecha = _parse_fecha(doc.get("fecha_acredita_desde"))
        if fecha:
            fechas.append(fecha)
    if not fechas:
        return {
            "requeridos": requeridos,
            "fecha_inicio": None,
            "anios": None,
            "cumple": None,
        }

    inicio = min(fechas)
    anios = round((hoy - inicio).days / 365.25, 2)
    return {
        "requeridos": requeridos,
        "fecha_inicio": inicio.isoformat(),
        "anios": anios,
        "cumple": anios >= requeridos,
    }


# --------------------------------------------------------------------------- #
#  Sugerencia automatica de tramite
# --------------------------------------------------------------------------- #
def sugerir_tramite(cliente, items, modelo=MODELO_POR_DEFECTO, max_paginas=10):
    """Pide a la IA que sugiera que tramite encaja mejor con los documentos.

    items: lista de "documentos", cada uno lista de (nombre, datos). Se toma la
    primera pagina de cada documento (hasta max_paginas) para limitar el coste.
    Devuelve dict {tramite_id, justificacion} o None si no puede determinarlo.
    """
    paginas = []
    for documento in items:
        if documento:
            paginas.append(documento[0])  # primera pagina de cada documento
        if len(paginas) >= max_paginas:
            break
    if not paginas:
        return None

    bloques = _bloques_documento(paginas)
    catalogo = "\n".join(
        f'- "{tid}": {t["nombre"]} — {t.get("descripcion", "")}'
        for tid, t in tramites.TRAMITES.items()
    )
    instruccion = (
        "Te muestro documentos de un expediente de extranjeria espanol. Indica "
        "cual de los siguientes tramites encaja mejor con esta documentacion.\n\n"
        f"Tramites disponibles:\n{catalogo}\n\n"
        'Responde solo con un JSON: {"tramite_id": "<id de la lista>", '
        '"justificacion": "<motivo breve>"}.'
    )
    respuesta = cliente.messages.create(
        model=modelo,
        max_tokens=500,
        system=_SISTEMA,
        messages=[{"role": "user", "content": bloques + [{"type": "text", "text": instruccion}]}],
    )
    texto = next((b.text for b in respuesta.content if b.type == "text"), "")
    try:
        datos = _extraer_json(texto)
    except ValueError:
        return None
    tid = datos.get("tramite_id")
    if tid not in tramites.TRAMITES:
        return None
    return {"tramite_id": tid, "justificacion": datos.get("justificacion", "")}
