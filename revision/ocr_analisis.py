"""Analisis de documentos de extranjeria mediante OCR (sin IA).

Extrae datos estructurados usando:
  - pdfplumber  para texto nativo en PDFs digitales (lo mas preciso)
  - pdf2image + pytesseract para PDFs escaneados e imagenes
  - MRZ parsing para pasaportes y documentos de viaje ICAO
  - Expresiones regulares para NIE, fechas, nombres y tipos de doc

No requiere clave de API ni conexion a internet.
Devuelve el mismo formato de dict que analizar_documento() de analizador.py,
por lo que el resto de la aplicacion lo trata de forma identica.
"""

import io
import re
from datetime import date, datetime

# ─────────────────────────────────────────────────────────────────────────────
#  Extraccion de texto bruto
# ─────────────────────────────────────────────────────────────────────────────

def _texto_pdf_nativo(datos_bytes):
    """Extrae texto de un PDF con texto incrustado (documentos digitales)."""
    try:
        import pdfplumber
        with pdfplumber.open(io.BytesIO(datos_bytes)) as pdf:
            partes = [p.extract_text() or "" for p in pdf.pages]
        return "\n".join(partes)
    except Exception:
        return ""


def _texto_pdf_escaneado(datos_bytes, lang="spa+eng+ara+fra"):
    """Convierte cada pagina del PDF a imagen y aplica Tesseract."""
    try:
        from pdf2image import convert_from_bytes
        import pytesseract
        imagenes = convert_from_bytes(datos_bytes, dpi=250, fmt="jpeg")
        cfg = f"--oem 1 --psm 3 -l {lang}"
        return "\n".join(pytesseract.image_to_string(img, config=cfg) for img in imagenes[:6])
    except Exception:
        return ""


def _texto_imagen(datos_bytes, lang="spa+eng+ara+fra"):
    """Extrae texto de una imagen con Tesseract."""
    try:
        import pytesseract
        from PIL import Image, ImageOps
        img = Image.open(io.BytesIO(datos_bytes))
        img = ImageOps.exif_transpose(img)
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        cfg = f"--oem 1 --psm 3 -l {lang}"
        return pytesseract.image_to_string(img, config=cfg)
    except Exception:
        return ""


def extraer_texto(nombre_archivo, datos_bytes):
    """Elige el metodo de extraccion segun el tipo de archivo."""
    ext = nombre_archivo.rsplit(".", 1)[-1].lower() if "." in nombre_archivo else ""
    if ext == "pdf":
        texto = _texto_pdf_nativo(datos_bytes)
        # Si el PDF nativo da menos de 80 chars, probablemente es escaneado
        if len(texto.strip()) < 80:
            texto = _texto_pdf_escaneado(datos_bytes)
        return texto
    # Imagen
    return _texto_imagen(datos_bytes)


# ─────────────────────────────────────────────────────────────────────────────
#  Parsing MRZ (Machine Readable Zone) — pasaportes ICAO TD3
# ─────────────────────────────────────────────────────────────────────────────

# L1: P + subtype(1) + issuing country(3) + name(39) = 44
_RE_MRZ_L1 = re.compile(r"P[A-Z<][A-Z<]{3}[A-Z<]{39}", re.IGNORECASE)
# L2: doc_num(9) + check(1) + nationality(3) + dob(6) + check(1) + sex(1) + expiry(6) + check(1) + optional(15) + check(1) = 44
_RE_MRZ_L2 = re.compile(
    r"[A-Z0-9<]{9}[0-9A-Z<][A-Z<]{3}[0-9]{6}[0-9A-Z<][MF<][0-9]{6}[0-9A-Z<][A-Z0-9<]{15}[0-9A-Z<]",
    re.IGNORECASE,
)

_PAISES_ES = {
    "ESP": "Española", "MAR": "Marroqui", "ROU": "Rumana", "COL": "Colombiana",
    "ECU": "Ecuatoriana", "PER": "Peruana", "BOL": "Boliviana", "VEN": "Venezolana",
    "DOM": "Dominicana", "CHN": "China", "PAK": "Pakistaní", "SEN": "Senegalesa",
    "UKR": "Ucraniana", "NGA": "Nigeriana", "MLI": "Maliense", "GNB": "Guineana",
    "GIN": "Guineana", "CIV": "Marfileña", "CMR": "Camerunesa", "GHA": "Ghanesa",
    "MEX": "Mexicana", "ARG": "Argentina", "BRA": "Brasileña", "CUB": "Cubana",
    "HND": "Hondureña", "GTM": "Guatemalteca", "SLV": "Salvadoreña", "NIC": "Nicaragüense",
    "ALG": "Argelina", "TUN": "Tunecina", "LBY": "Libia", "EGY": "Egipcia",
    "BGD": "Bangladesí", "IND": "India", "PHL": "Filipina", "GBR": "Britanica",
    "DEU": "Alemana", "FRA": "Francesa", "ITA": "Italiana", "PRT": "Portuguesa",
    "POL": "Polaca", "BUL": "Bulgaria",
}


def _mrz_fecha(yymmdd, es_caducidad=False):
    """Convierte YYMMDD a AAAA-MM-DD. Para caducidades, el pivote es 1960."""
    try:
        yy, mm, dd = int(yymmdd[:2]), int(yymmdd[2:4]), int(yymmdd[4:6])
        anio_base = 1900 if es_caducidad else 1900
        # DOB: si YY > 30, es 19YY; si <= 30, es 20YY
        if not es_caducidad:
            anio = 2000 + yy if yy <= 30 else 1900 + yy
        else:
            anio = 2000 + yy if yy <= 50 else 1900 + yy
        return date(anio, mm, dd).isoformat()
    except Exception:
        return None


def _mrz_nombre(raw):
    """Convierte el campo de nombre MRZ a 'Apellidos, Nombre'."""
    partes = raw.replace("<", " ").split("  ")
    partes = [p.strip() for p in partes if p.strip()]
    if not partes:
        return None
    apellidos = partes[0].title()
    nombre = " ".join(p.title() for p in partes[1:]) if len(partes) > 1 else ""
    return f"{nombre} {apellidos}".strip() if nombre else apellidos


def parsear_mrz(texto):
    """Busca y parsea la MRZ en el texto OCR. Devuelve dict o None."""
    # Limpiar y normalizar lineas: eliminar espacios internos, convertir a mayusculas
    lineas_raw = texto.splitlines()
    lineas = []
    for l in lineas_raw:
        # OCR a veces inserta espacios dentro de la MRZ — quitarlos
        limpia = re.sub(r"\s+", "", l).upper()
        # Reemplazar caracteres no MRZ por <
        limpia = re.sub(r"[^A-Z0-9<]", "<", limpia)
        if limpia:
            lineas.append(limpia)

    l1 = l2 = None
    for idx, linea in enumerate(lineas):
        if len(linea) >= 44 and linea[0] == "P":
            if _RE_MRZ_L1.match(linea[:44]):
                l1 = linea[:44]
                # Buscar L2 en las siguientes 1-2 lineas
                for linea2 in lineas[idx + 1: idx + 3]:
                    if len(linea2) >= 44:
                        cand = linea2[:44]
                        if _RE_MRZ_L2.match(cand):
                            l2 = cand
                            break
                if l2:
                    break

    if not (l1 and l2):
        return None

    pais = l1[2:5].replace("<", "")
    nac = l2[10:13].replace("<", "")
    return {
        "tipo_id": "pasaporte",
        "tipo_nombre": "Pasaporte",
        "titular": _mrz_nombre(l1[5:44]),
        "numero": l2[0:9].replace("<", ""),
        "pais_emision": _PAISES_ES.get(pais, pais),
        "nacionalidad_doc": _PAISES_ES.get(nac, nac),
        "fecha_nacimiento": _mrz_fecha(l2[13:19], es_caducidad=False),
        "sexo": l2[20] if l2[20] in ("M", "F") else None,
        "fecha_emision": None,
        "fecha_caducidad": _mrz_fecha(l2[21:27], es_caducidad=True),
        "fecha_acredita_desde": None,
        "fuente_mrz": True,
    }


# ─────────────────────────────────────────────────────────────────────────────
#  Patrones de expresiones regulares
# ─────────────────────────────────────────────────────────────────────────────

_RE_NIE = re.compile(r"\b([XYZ][- ]?\d{7}[- ]?[A-Z])\b", re.I)
_RE_DNI = re.compile(r"\b(\d{8}[A-Z])\b", re.I)
_RE_PASAPORTE_NUM = re.compile(r"\b([A-Z]{2,3}\d{6,7})\b")

_RE_FECHA_ES = re.compile(
    r"\b(\d{1,2})[/ \-.](\d{1,2})[/ \-.](\d{4})\b"
)
_RE_FECHA_ISO = re.compile(r"\b(\d{4})[- /](\d{2})[- /](\d{2})\b")
_RE_FECHA_TXT = re.compile(
    r"\b(\d{1,2})\s+(?:de\s+)?"
    r"(enero|febrero|marzo|abril|mayo|junio|julio|agosto|"
    r"septiembre|octubre|noviembre|diciembre)"
    r"\s+(?:de\s+)?(\d{4})\b",
    re.I,
)

_MESES = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5,
    "junio": 6, "julio": 7, "agosto": 8, "septiembre": 9,
    "octubre": 10, "noviembre": 11, "diciembre": 12,
}

_RE_NOMBRE_DESPUES = re.compile(
    r"(?:NOMBRE[S]?|TITULAR|APELLIDOS? Y NOMBRE|D\.|D\/|Dña\.?|DON|DOÑA)"
    r"[:\s]+([A-ZÁÉÍÓÚÜÑ][a-záéíóúüñA-ZÁÉÍÓÚÜÑ\s,\-]{4,60})",
    re.I,
)
_RE_NOMBRE_CAPS = re.compile(
    r"^([A-ZÁÉÍÓÚÜÑ]{2,}(?:\s[A-ZÁÉÍÓÚÜÑ]{2,}){1,4})$",
    re.MULTILINE,
)

_RE_NACIONALIDAD = re.compile(
    r"(?:NACIONALIDAD|NATIONALITY)[:\s]+([A-ZÁÉÍÓÚÜÑA-Z]{4,30})", re.I
)
_RE_FNAC = re.compile(
    r"(?:FECHA\s+DE\s+NACIMIENTO|DATE\s+OF\s+BIRTH|F\.?\s*NACIMIENTO|NACIDO\s+EL|BORN)[:\s]+"
    r"(\d{1,2}[/ \-\.]\d{1,2}[/ \-\.]\d{4}|\d{4}[- /]\d{2}[- /]\d{2}|\d{1,2}\s+de\s+\w+\s+(?:de\s+)?\d{4})",
    re.I,
)
_RE_FCAD = re.compile(
    r"(?:FECHA\s+DE\s+CADUCIDAD|EXPIRY\s+DATE|VALID\s+UNTIL|VALIDO\s+HASTA"
    r"|FECHA\s+DE\s+VENCIMIENTO|CADUCA|CADUCIDAD)[:\s]+"
    r"(\d{1,2}[/ \-\.]\d{1,2}[/ \-\.]\d{4}|\d{4}[- /]\d{2}[- /]\d{2}|\d{1,2}\s+de\s+\w+\s+(?:de\s+)?\d{4})",
    re.I,
)
_RE_FEMISION = re.compile(
    r"(?:FECHA\s+DE\s+EXPEDICION|DATE\s+OF\s+ISSUE|FECHA\s+DE\s+EMISION|EXPEDIDO\s+EL)"
    r"[:\s]+(\d{1,2}[/ \-\.]\d{1,2}[/ \-\.]\d{4}|\d{4}[- /]\d{2}[- /]\d{2})",
    re.I,
)
_RE_FECHA_ALTA = re.compile(
    r"(?:FECHA\s+DE\s+ALTA|INSCRITO\s+(?:DESDE|EL)|ALTA\s+PADRONAL|ALTA\s+EN\s+EL\s+PADRON)"
    r"[:\s]+(\d{1,2}[/ \-\.]\d{1,2}[/ \-\.]\d{4}|\d{4}[- /]\d{2}[- /]\d{2}|\d{1,2}\s+de\s+\w+\s+(?:de\s+)?\d{4})",
    re.I,
)
_RE_ENTRADA_ESPANA = re.compile(
    r"(?:ENTRADA\s+EN\s+(?:ESPANA|ESPAÑA)|LLEGADA\s+A\s+ESPANA|FECHA\s+DE\s+ENTRADA)"
    r"[:\s]+(\d{1,2}[/ \-\.]\d{1,2}[/ \-\.]\d{4}|\d{4}[- /]\d{2}[- /]\d{2})",
    re.I,
)
_RE_EMPLEADOR = re.compile(
    r"(?:EMPRESA|EMPLEADOR|RAZON\s+SOCIAL|NOMBRE\s+(?:DEL\s+)?EMPRESARIO)"
    r"[:\s]+([A-ZÁÉÍÓÚÜÑa-záéíóúüñ][A-ZÁÉÍÓÚÜÑa-záéíóúüñ\s,\.\-]{3,60})",
    re.I,
)
_RE_TIPO_CONTRATO = re.compile(
    r"(?:TIPO\s+(?:DE\s+)?CONTRATO|MODALIDAD)[:\s]+"
    r"(INDEFINIDO|TEMPORAL|TIEMPO\s+PARCIAL|FIJO\s+DISCONTINUO|PRACTICAS|"
    r"OBRA\s+Y\s+SERVICIO|EVENTUAL[^\n]{0,40})",
    re.I,
)


def _parsear_fecha(texto_fecha):
    """Convierte una fecha en varios formatos a AAAA-MM-DD."""
    if not texto_fecha:
        return None
    texto_fecha = texto_fecha.strip()
    m = _RE_FECHA_ISO.match(texto_fecha)
    if m:
        try:
            return date(int(m[1]), int(m[2]), int(m[3])).isoformat()
        except ValueError:
            pass
    m = _RE_FECHA_ES.match(texto_fecha)
    if m:
        try:
            return date(int(m[3]), int(m[2]), int(m[1])).isoformat()
        except ValueError:
            pass
    m = _RE_FECHA_TXT.match(texto_fecha)
    if m:
        try:
            mes = _MESES.get(m[2].lower())
            if mes:
                return date(int(m[3]), mes, int(m[1])).isoformat()
        except ValueError:
            pass
    return None


# ─────────────────────────────────────────────────────────────────────────────
#  Clasificacion del tipo de documento
# ─────────────────────────────────────────────────────────────────────────────

_PALABRAS_CLAVE_TIPO = [
    ("pasaporte",            ["PASAPORTE", "PASSPORT"]),
    ("nie",                  ["NUMERO DE IDENTIFICACION DE EXTRANJERO", "TARJETA NIE",
                              "CERTIFICADO NIE"]),
    ("tie",                  ["TARJETA DE IDENTIDAD DE EXTRANJERO", "RESIDENCIA Y TRABAJO",
                              "AUTORIZACION DE RESIDENCIA", "TIE"]),
    ("dni",                  ["DOCUMENTO NACIONAL DE IDENTIDAD", "D.N.I"]),
    ("empadronamiento",      ["CERTIFICADO DE EMPADRONAMIENTO", "PADRON MUNICIPAL",
                              "PADRÓN MUNICIPAL", "EMPADRONADO", "EMPADRONAMIENTO"]),
    ("vida_laboral",         ["INFORME DE VIDA LABORAL", "VIDA LABORAL", "TGSS",
                              "TESORERIA GENERAL DE LA SEGURIDAD SOCIAL"]),
    ("contrato_trabajo",     ["CONTRATO DE TRABAJO", "CONTRATO LABORAL",
                              "CONTRATO DE PRESTACION DE SERVICIOS"]),
    ("nomina",               ["NOMINA", "RECIBO DE SALARIO", "NÓMINA"]),
    ("informe_arraigo",      ["INFORME DE ARRAIGO", "INFORME SOCIAL", "TRABAJO SOCIAL",
                              "INTEGRACION SOCIAL"]),
    ("certificado_penal",    ["ANTECEDENTES PENALES", "CERTIFICADO DE PENALES",
                              "REGISTRO CENTRAL DE PENADOS"]),
    ("acta_nacimiento",      ["ACTA DE NACIMIENTO", "CERTIFICADO DE NACIMIENTO"]),
    ("titulo_academico",     ["TITULO ACADEMICO", "DIPLOMA", "CERTIFICADO DE ESTUDIOS",
                              "GRADO", "MÁSTER", "BACHILLERATO"]),
    ("seguro_medico",        ["SEGURO MEDICO", "POLIZA DE SALUD", "MUTUA", "COBERTURA SANITARIA"]),
    ("tarjeta_comunitaria",  ["TARJETA DE RESIDENCIA COMUNITARIA", "CIUDADANO DE LA UNION"]),
]


def _clasificar_tipo(texto):
    texto_upper = texto.upper()
    for tipo_id, palabras in _PALABRAS_CLAVE_TIPO:
        if any(p in texto_upper for p in palabras):
            return tipo_id
    return "no_identificado"


def _nombre_tipo(tipo_id):
    _nombres = {
        "pasaporte": "Pasaporte",
        "nie": "Certificado NIE",
        "tie": "Tarjeta de Identidad de Extranjero (TIE)",
        "dni": "DNI",
        "empadronamiento": "Certificado de empadronamiento",
        "vida_laboral": "Informe de vida laboral",
        "contrato_trabajo": "Contrato de trabajo",
        "nomina": "Nómina / recibo de salario",
        "informe_arraigo": "Informe de arraigo social",
        "certificado_penal": "Certificado de antecedentes penales",
        "acta_nacimiento": "Acta de nacimiento",
        "titulo_academico": "Título académico",
        "seguro_medico": "Seguro médico",
        "tarjeta_comunitaria": "Tarjeta de residencia comunitaria",
        "no_identificado": "Documento no identificado",
    }
    return _nombres.get(tipo_id, tipo_id)


# ─────────────────────────────────────────────────────────────────────────────
#  Calculo de vigencia
# ─────────────────────────────────────────────────────────────────────────────

_DOCS_SIN_CADUCIDAD = {
    "empadronamiento", "vida_laboral", "acta_nacimiento",
    "informe_arraigo", "certificado_penal", "titulo_academico",
}
_DIAS_AVISO = 90


def _calcular_estado(tipo_id, fecha_caducidad_iso):
    if tipo_id in _DOCS_SIN_CADUCIDAD:
        return "sin_caducidad"
    if not fecha_caducidad_iso:
        return "desconocido"
    try:
        cad = date.fromisoformat(fecha_caducidad_iso)
        hoy = date.today()
        if cad < hoy:
            return "caducado"
        if (cad - hoy).days <= _DIAS_AVISO:
            return "proximo_a_caducar"
        return "vigente"
    except ValueError:
        return "desconocido"


# ─────────────────────────────────────────────────────────────────────────────
#  Extraccion de campos
# ─────────────────────────────────────────────────────────────────────────────

def _primero(regex, texto):
    m = regex.search(texto)
    return m.group(1).strip() if m else None


def _nombre_de_texto(texto):
    """Intenta extraer el nombre de la persona del texto."""
    # 1. Patron con etiqueta
    m = _RE_NOMBRE_DESPUES.search(texto)
    if m:
        nombre = m.group(1).strip()
        if 5 <= len(nombre) <= 60 and nombre[0].isupper():
            return nombre
    # 2. Lineas en mayusculas que parezcan nombres propios
    for m in _RE_NOMBRE_CAPS.finditer(texto):
        candidato = m.group(1)
        palabras = candidato.split()
        # filtrar palabras reservadas
        _EXCLUIR = {
            "NIE", "DNI", "TIE", "PASAPORTE", "POLICIA", "NACIONAL",
            "MINISTERIO", "INTERIOR", "ESPANA", "EXTRANJERO", "RESIDENCIA",
        }
        if len(palabras) >= 2 and not any(p in _EXCLUIR for p in palabras):
            return candidato.title()
    return None


def _extraer_campos(texto, tipo_id):
    """Extrae todos los campos posibles del texto segun el tipo de documento."""
    campos = {
        "titular": None,
        "numero": None,
        "pais_emision": None,
        "nacionalidad_doc": None,
        "fecha_nacimiento": None,
        "sexo": None,
        "fecha_emision": None,
        "fecha_caducidad": None,
        "fecha_acredita_desde": None,
        "empleador": None,
        "tipo_contrato": None,
    }

    # Numero de documento
    if tipo_id in ("nie", "tie"):
        m = _RE_NIE.search(texto)
        if m:
            campos["numero"] = re.sub(r"[- ]", "", m.group(1)).upper()
    elif tipo_id == "pasaporte":
        m = _RE_PASAPORTE_NUM.search(texto)
        if m:
            campos["numero"] = m.group(1).upper()
    elif tipo_id == "dni":
        m = _RE_DNI.search(texto)
        if m:
            campos["numero"] = m.group(1).upper()
    else:
        # Para otros docs puede aparecer un NIE o pasaporte del titular
        m = _RE_NIE.search(texto)
        if m:
            campos["numero"] = re.sub(r"[- ]", "", m.group(1)).upper()

    # Nombre
    campos["titular"] = _nombre_de_texto(texto)

    # Nacionalidad
    nac = _primero(_RE_NACIONALIDAD, texto)
    if nac:
        campos["nacionalidad_doc"] = nac.strip().capitalize()

    # Fechas
    fn_raw = _primero(_RE_FNAC, texto)
    campos["fecha_nacimiento"] = _parsear_fecha(fn_raw)

    fc_raw = _primero(_RE_FCAD, texto)
    campos["fecha_caducidad"] = _parsear_fecha(fc_raw)

    fe_raw = _primero(_RE_FEMISION, texto)
    campos["fecha_emision"] = _parsear_fecha(fe_raw)

    # Fecha de acreditacion de presencia en España
    alta_raw = _primero(_RE_FECHA_ALTA, texto)
    entrada_raw = _primero(_RE_ENTRADA_ESPANA, texto)
    f_alta = _parsear_fecha(alta_raw)
    f_entrada = _parsear_fecha(entrada_raw)
    # La mas antigua de las dos
    opciones = [f for f in (f_alta, f_entrada) if f]
    if opciones:
        campos["fecha_acredita_desde"] = min(opciones)

    # Contrato de trabajo
    if tipo_id == "contrato_trabajo":
        emp = _primero(_RE_EMPLEADOR, texto)
        if emp:
            campos["empleador"] = emp.strip()
        tc = _primero(_RE_TIPO_CONTRATO, texto)
        if tc:
            campos["tipo_contrato"] = tc.strip().capitalize()

    return campos


# ─────────────────────────────────────────────────────────────────────────────
#  Evaluacion de legibilidad del texto OCR
# ─────────────────────────────────────────────────────────────────────────────

def _evaluar_legibilidad(texto):
    if not texto or len(texto) < 50:
        return "mala"
    # Ratio de caracteres imprimibles utiles
    utiles = sum(1 for c in texto if c.isalnum() or c in " \n.,:-/")
    ratio = utiles / max(len(texto), 1)
    if ratio > 0.75 and len(texto) > 200:
        return "buena"
    if ratio > 0.55:
        return "regular"
    return "mala"


# ─────────────────────────────────────────────────────────────────────────────
#  Incidencias automaticas
# ─────────────────────────────────────────────────────────────────────────────

def _incidencias(tipo_id, campos, estado, legibilidad):
    inc = []
    if legibilidad == "mala":
        inc.append("El texto extraido tiene baja calidad. Verifica manualmente el documento.")
    if estado == "caducado":
        inc.append(f"Documento caducado el {campos['fecha_caducidad']}.")
    elif estado == "proximo_a_caducar":
        inc.append(f"Documento proximo a caducar ({campos['fecha_caducidad']}).")
    if tipo_id not in _DOCS_SIN_CADUCIDAD and not campos.get("fecha_caducidad"):
        inc.append("No se ha podido detectar la fecha de caducidad.")
    if not campos.get("titular"):
        inc.append("No se ha podido detectar el nombre del titular.")
    if tipo_id in ("nie", "tie", "pasaporte") and not campos.get("numero"):
        inc.append("No se ha podido detectar el numero del documento.")
    return inc


# ─────────────────────────────────────────────────────────────────────────────
#  Punto de entrada principal
# ─────────────────────────────────────────────────────────────────────────────

def analizar_con_ocr(nombre_archivo, datos_bytes):
    """Analiza un documento con OCR y devuelve un dict compatible con analizar_documento().

    Parametros
    ----------
    nombre_archivo : str
    datos_bytes    : bytes

    Retorna
    -------
    dict con las mismas claves que analizar_documento():
      tipo_id, tipo_nombre, titular, numero, pais_emision, nacionalidad_doc,
      fecha_nacimiento, sexo, fecha_emision, fecha_caducidad,
      fecha_acredita_desde, estado, legibilidad, incidencias, resumen,
      archivo, archivos, _ocr_texto (texto completo para depuracion)
    """
    texto = extraer_texto(nombre_archivo, datos_bytes)
    legibilidad = _evaluar_legibilidad(texto)

    # Intentar MRZ primero (mas fiable para pasaportes)
    mrz = parsear_mrz(texto)

    if mrz:
        tipo_id = mrz["tipo_id"]
        campos = {k: mrz.get(k) for k in (
            "titular", "numero", "pais_emision", "nacionalidad_doc",
            "fecha_nacimiento", "sexo", "fecha_caducidad",
        )}
        campos["fecha_emision"] = None
        campos["fecha_acredita_desde"] = None
        campos["empleador"] = None
        campos["tipo_contrato"] = None
        legibilidad = "buena"  # MRZ leida = documento legible
    else:
        tipo_id = _clasificar_tipo(texto) if legibilidad != "mala" else "no_identificado"
        campos = _extraer_campos(texto, tipo_id)

    estado = _calcular_estado(tipo_id, campos.get("fecha_caducidad"))
    incidencias = _incidencias(tipo_id, campos, estado, legibilidad)

    campos_caducidad = []
    if estado == "caducado":
        campos_caducidad.append(f"Caducado el {campos['fecha_caducidad']}")
    elif estado == "proximo_a_caducar":
        campos_caducidad.append(f"Caduca pronto ({campos['fecha_caducidad']})")

    resumen_partes = [_nombre_tipo(tipo_id)]
    if campos.get("titular"):
        resumen_partes.append(f"titular: {campos['titular']}")
    if campos.get("numero"):
        resumen_partes.append(f"nº {campos['numero']}")
    if campos_caducidad:
        resumen_partes += campos_caducidad
    resumen = " · ".join(resumen_partes)

    return {
        "tipo_id": tipo_id,
        "tipo_nombre": _nombre_tipo(tipo_id),
        "titular": campos.get("titular"),
        "numero": campos.get("numero"),
        "pais_emision": campos.get("pais_emision"),
        "nacionalidad_doc": campos.get("nacionalidad_doc"),
        "fecha_nacimiento": campos.get("fecha_nacimiento"),
        "sexo": campos.get("sexo"),
        "fecha_emision": campos.get("fecha_emision"),
        "fecha_caducidad": campos.get("fecha_caducidad"),
        "fecha_acredita_desde": campos.get("fecha_acredita_desde"),
        "estado": estado,
        "legibilidad": legibilidad,
        "incidencias": incidencias,
        "resumen": resumen,
        "archivo": nombre_archivo,
        "archivos": [nombre_archivo],
        "_modo": "ocr",
        "_ocr_texto": texto[:2000] if texto else "",  # para depuracion
    }


def analizar_multiples_con_ocr(paginas, tramite_id=None):
    """Analiza varias paginas/archivos del mismo documento y fusiona el resultado.

    paginas: lista de (nombre_archivo, datos_bytes)
    Devuelve un unico dict (el resultado mas completo entre todas las paginas).
    """
    if not paginas:
        return {}

    resultados = [analizar_con_ocr(n, d) for n, d in paginas]

    # Tomar el resultado con mejor legibilidad como base
    _ORDEN = {"buena": 0, "regular": 1, "mala": 2}
    base = min(resultados, key=lambda r: _ORDEN.get(r.get("legibilidad", "mala"), 2))

    # Completar campos vacios con datos de las otras paginas
    for r in resultados:
        for campo in ("titular", "numero", "pais_emision", "nacionalidad_doc",
                      "fecha_nacimiento", "sexo", "fecha_emision",
                      "fecha_caducidad", "fecha_acredita_desde"):
            if not base.get(campo) and r.get(campo):
                base[campo] = r[campo]

    # Si el tipo es no_identificado pero otra pagina lo identifica, usar ese
    if base["tipo_id"] == "no_identificado":
        for r in resultados:
            if r["tipo_id"] != "no_identificado":
                base["tipo_id"] = r["tipo_id"]
                base["tipo_nombre"] = r["tipo_nombre"]
                break

    # Actualizar nombre de archivo para que incluya todas las paginas
    base["archivo"] = ", ".join(n for n, _ in paginas)
    base["archivos"] = [n for n, _ in paginas]

    # Recalcular estado con todos los campos finales
    base["estado"] = _calcular_estado(base["tipo_id"], base.get("fecha_caducidad"))
    base["incidencias"] = _incidencias(
        base["tipo_id"], base, base["estado"], base["legibilidad"]
    )

    return base
