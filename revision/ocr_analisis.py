"""Analisis de documentos de extranjeria mediante OCR (sin IA).

Pipeline:
  1. pdfplumber     — texto nativo en PDFs digitales (mas preciso)
  2. OpenCV         — preprocesado de imagen: escala, contraste, binarizacion,
                      deskew, denoising
  3. Tesseract      — multiples pasadas PSM; se combina el mejor resultado
  4. MRZ parser     — pasada dedicada en el tercio inferior del documento
  5. Regex          — extraccion de campos: NIE, fechas, nombre, etc.
  6. Post-proceso   — correccion de errores OCR tipicos
"""

import glob
import io
import os
import re
import shutil
import sys
from datetime import date

# OpenCV y NumPy son dependencias pesadas y opcionales: si no estan instaladas,
# la app debe arrancar igualmente y solo la pestaña OCR avisara de que faltan.
try:
    import cv2
    import numpy as np
    _CV2_OK = True
except ImportError:
    cv2 = None
    np = None
    _CV2_OK = False

# ─────────────────────────────────────────────────────────────────────────────
#  Preprocesado de imagen con OpenCV
# ─────────────────────────────────────────────────────────────────────────────

_RESOLUCION_MIN = 1800   # pixeles en el lado mayor minimo para OCR fiable
_RESOLUCION_MAX = 3600   # no subir mas para no ralentizar


def _cargar_cv2(datos_bytes):
    """Carga bytes en array BGR de OpenCV."""
    arr = np.frombuffer(datos_bytes, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("No se pudo decodificar la imagen.")
    return img


def _escalar(img):
    """Sube la resolucion si el lado mayor es menor que el minimo."""
    h, w = img.shape[:2]
    lado_max = max(h, w)
    if lado_max < _RESOLUCION_MIN:
        factor = _RESOLUCION_MIN / lado_max
        nuevo_w = int(w * factor)
        nuevo_h = int(h * factor)
        img = cv2.resize(img, (nuevo_w, nuevo_h), interpolation=cv2.INTER_CUBIC)
    elif lado_max > _RESOLUCION_MAX:
        factor = _RESOLUCION_MAX / lado_max
        nuevo_w = int(w * factor)
        nuevo_h = int(h * factor)
        img = cv2.resize(img, (nuevo_w, nuevo_h), interpolation=cv2.INTER_AREA)
    return img


def _deskew(gray):
    """Corrige la inclinacion de la imagen usando la orientacion del texto."""
    try:
        # Binarizar para detectar texto
        _, bw = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        # Kernel horizontal para detectar lineas de texto
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (30, 1))
        dilated = cv2.dilate(bw, kernel)
        contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            return gray
        angles = []
        for cnt in contours:
            if cv2.contourArea(cnt) < 200:
                continue
            rect = cv2.minAreaRect(cnt)
            angle = rect[-1]
            if -45 < angle < 0:
                angles.append(angle)
            elif 45 < angle < 90:
                angles.append(angle - 90)
        if not angles:
            return gray
        mediana = float(np.median(angles))
        if abs(mediana) < 0.5:
            return gray  # ya esta recto
        h, w = gray.shape
        centro = (w // 2, h // 2)
        M = cv2.getRotationMatrix2D(centro, mediana, 1.0)
        rotada = cv2.warpAffine(gray, M, (w, h),
                                flags=cv2.INTER_CUBIC,
                                borderMode=cv2.BORDER_REPLICATE)
        return rotada
    except Exception:
        return gray


def _preprocesar(img_bgr, modo="normal"):
    """Pipeline OpenCV completo. Devuelve imagen en escala de grises procesada."""
    img_bgr = _escalar(img_bgr)

    if modo == "color_doc":
        # Pasaportes y TIE tienen fondos de colores complejos.  El canal L del
        # espacio perceptual LAB representa la luminosidad independientemente del
        # color, lo que separa mejor el texto negro del fondo coloreado.
        lab = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2LAB)
        gray = lab[:, :, 0]
        gray = _deskew(gray)
        clahe = cv2.createCLAHE(clipLimit=4.0, tileGridSize=(4, 4))
        enhanced = clahe.apply(gray)
        _, result = cv2.threshold(enhanced, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        return result

    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    gray = _deskew(gray)

    if modo == "mrz":
        # Para MRZ: binarizacion estricta, sin suavizado
        _, result = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        return result

    # Eliminacion de ruido
    denoised = cv2.fastNlMeansDenoising(gray, h=12, templateWindowSize=7, searchWindowSize=21)

    # CLAHE: mejora el contraste local (util para documentos con sombras o iluminacion irregular)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(denoised)

    # Nitidez (unsharp mask)
    blur = cv2.GaussianBlur(enhanced, (0, 0), 3)
    sharp = cv2.addWeighted(enhanced, 1.5, blur, -0.5, 0)

    if modo == "documento":
        # Binarizacion adaptativa: mejor para documentos con fondo no uniforme
        result = cv2.adaptiveThreshold(
            sharp, 255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY, 31, 10,
        )
    else:
        # Otsu: rapido, bueno para documentos de fondo uniforme
        _, result = cv2.threshold(sharp, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    return result


def _cv2_a_pil(img_gray):
    """Convierte imagen OpenCV (numpy) a PIL para Tesseract."""
    from PIL import Image
    return Image.fromarray(img_gray)


# ─────────────────────────────────────────────────────────────────────────────
#  Correccion de errores OCR tipicos
# ─────────────────────────────────────────────────────────────────────────────

_CORRECCIONES = [
    # CamelCase OCR: solo transicion minuscula→mayuscula (evita romper palabras en MAYUSCULAS)
    (re.compile(r"([a-záéíóúüñ])([A-ZÁÉÍÓÚÜÑ])"), r"\1 \2"),
    # Punto/coma pegado a palabra (OCR lo confunde con parte de la palabra)
    (re.compile(r"([A-Za-z]),([A-Za-z])"), r"\1, \2"),
    # "!" confundido con "I" al final de palabra en mayusculas
    (re.compile(r"\b([A-ZÁÉÍÓÚÜÑ]+)!(\s|$)"), r"\1I\2"),
    # "0" por "O" en nombres propios (contexto: letra antes y despues)
    (re.compile(r"\b([A-Z]{2,})0([A-Z]{1,})\b"), r"\1O\2"),
    # "1" por "I" en nombres propios en mayusculas
    (re.compile(r"\b([A-Z]{2,})1([A-Z]{1,})\b"), r"\1I\2"),
    # "l" por "1" en numeros de documentos (contexto: digitos alrededor)
    (re.compile(r"(\d)l(\d)"), r"\1 1\2"),
    # NIE/DNI: separadores innecesarios
    (re.compile(r"([XYZxyz])\s*[- ]?\s*(\d{7})\s*[- ]?\s*([A-Za-z])"), lambda m: m.group(1).upper() + m.group(2) + m.group(3).upper()),
    # Fecha con espacios: "15/ 03 /2021" → "15/03/2021"
    (re.compile(r"(\d{1,2})\s*/\s*(\d{1,2})\s*/\s*(\d{4})"), r"\1/\2/\3"),
    # "NIEX" (OCR pierde el espacio/dos puntos) → "NIE X"
    (re.compile(r"\bNIE[:\s]*([XYZ]\d)"), r"NIE: \1"),
    # Doble espacio → simple
    (re.compile(r" {2,}"), " "),
    # Separar etiquetas pegadas al valor sin espacio: "NOMBRE:JUAN" → "NOMBRE: JUAN"
    (re.compile(r"([A-ZÁÉÍÓÚÜÑ]{3,}):([A-ZÁÉÍÓÚÜÑA-Za-záéíóúüñ])"), r"\1: \2"),
]

# Lista de terminos clave (SIN espacios) para separar palabras ALL-CAPS fusionadas.
# RapidOCR a veces devuelve "VIDALABORAL" en vez de "VIDA LABORAL".
_TERMINOS_SEPARAR = [
    "INFORME", "VIDA", "LABORAL", "TESORERIA", "GENERAL", "SEGURIDAD", "SOCIAL",
    "CONTRATO", "TRABAJO", "TRABAJADOR", "EMPRESA", "JORNADA", "SEMANAL",
    "EMPADRONAMIENTO", "PADRON", "MUNICIPAL", "AYUNTAMIENTO", "DOMICILIO",
    "CERTIFICADO", "NACIMIENTO", "ANTECEDENTES", "PENALES", "REGISTRO",
    "PASAPORTE", "NOMBRE", "APELLIDOS", "FECHA", "NACIONALIDAD",
    "RESIDENCIA", "AUTORIZACION", "EXTRANJERO", "IDENTIDAD", "DOCUMENTO",
    "NOMINA", "SALARIO", "DEVENGOS", "DEDUCCIONES", "NETO", "BRUTO",
    "ARRAIGO", "INTEGRACION", "SERVICIOS",
]
# Patron para separar palabras clave ALL-CAPS fusionadas
_RE_SEPARAR_CAPS = re.compile(
    r"(?<=[A-Z])(?=" + "|".join(_TERMINOS_SEPARAR) + r")"
)


def _separar_palabras_caps(texto):
    """Inserta espacios en runs ALL-CAPS donde RapidOCR ha fusionado palabras."""
    resultado = []
    for linea in texto.splitlines():
        # Solo actuar en lineas que son mayoritariamente mayusculas y sin espacios
        palabras_linea = linea.split()
        nueva_linea = []
        for palabra in palabras_linea:
            sin_puntuacion = re.sub(r"[^A-Z]", "", palabra.upper())
            if len(sin_puntuacion) >= 8 and sin_puntuacion == palabra.upper():
                # ALL-CAPS larga sin espacios: intentar separar por terminos clave
                sep = _RE_SEPARAR_CAPS.sub(" ", palabra)
                nueva_linea.append(sep)
            else:
                nueva_linea.append(palabra)
        resultado.append(" ".join(nueva_linea))
    return "\n".join(resultado)


def _limpiar_ruido_ocr(texto):
    """Elimina lineas dominadas por simbolos que son ruido OCR.

    Los documentos con fondos de seguridad (pasaportes, TIE) generan multiples
    lineas de artefactos como '=', '@', '[', ']', '|' cuando el OCR procesa el
    fondo del documento en lugar del texto. Este filtro las descarta mientras
    preserva las lineas con contenido real, incluidas las lineas MRZ.
    """
    lineas_limpias = []
    for linea in texto.splitlines():
        stripped = linea.strip()
        if not stripped:
            lineas_limpias.append(linea)
            continue
        # Preservar lineas MRZ (muchos '<' + solo mayusculas/digitos, longitud >= 30)
        if (len(stripped) >= 25
                and stripped.replace("<", "").replace(" ", "").isupper()
                and stripped.count("<") >= 4):
            lineas_limpias.append(linea)
            continue
        alfanum = sum(1 for c in stripped
                      if c.isalnum() or c in "áéíóúüñÁÉÍÓÚÜÑ")
        total = len(stripped)
        ratio = alfanum / total if total > 0 else 0
        # Filtrar lineas cortas sin ninguna palabra real (3+ letras seguidas)
        palabras_reales = re.findall(r"[A-Za-záéíóúüñÁÉÍÓÚÜÑ]{3,}", stripped)
        if total < 20 and not palabras_reales:
            continue
        # Filtrar lineas muy cortas con bajo ratio alfanumerico
        if total < 8 and ratio < 0.75:
            continue
        # Mantener si tiene buen ratio alfanumerico, o si es una linea larga con algo de texto
        if ratio >= 0.45 or (total >= 30 and ratio >= 0.30):
            lineas_limpias.append(linea)
    return "\n".join(lineas_limpias)


def _corregir(texto):
    texto = _separar_palabras_caps(texto)
    texto = _limpiar_ruido_ocr(texto)
    for patron, sustitucion in _CORRECCIONES:
        if callable(sustitucion):
            texto = patron.sub(sustitucion, texto)
        else:
            texto = patron.sub(sustitucion, texto)
    return texto


# ─────────────────────────────────────────────────────────────────────────────
#  Extraccion de texto con multiples pasadas Tesseract
# ─────────────────────────────────────────────────────────────────────────────

_LANG = "spa+eng"   # las mas utiles para docs de extranjeria en España
_lang_cache = None


_tesseract_configurado = False


def _localizar_tesseract():
    """Busca el ejecutable de Tesseract aunque no este en el PATH.

    Muchos usuarios de Windows instalan Tesseract pero no lo añaden al PATH,
    asi que pytesseract no lo encuentra. Probamos la variable de entorno
    TESSERACT_CMD y las rutas de instalacion mas habituales por sistema.
    """
    # 1. Variable de entorno explicita (tiene prioridad)
    env = os.environ.get("TESSERACT_CMD")
    if env and os.path.isfile(env):
        return env

    # 2. Ya esta en el PATH
    en_path = shutil.which("tesseract")
    if en_path:
        return en_path

    # 3. Rutas habituales por sistema operativo
    candidatos = []
    if sys.platform.startswith("win"):
        candidatos += [
            r"C:\Program Files\Tesseract-OCR\tesseract.exe",
            r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
        ]
        local = os.environ.get("LOCALAPPDATA", "")
        if local:
            candidatos.append(os.path.join(local, "Programs", "Tesseract-OCR", "tesseract.exe"))
            candidatos += glob.glob(os.path.join(local, "**", "tesseract.exe"), recursive=True)
    elif sys.platform == "darwin":
        candidatos += [
            "/opt/homebrew/bin/tesseract",   # Apple Silicon
            "/usr/local/bin/tesseract",      # Intel
        ]
    else:
        candidatos += ["/usr/bin/tesseract", "/usr/local/bin/tesseract"]

    for ruta in candidatos:
        if ruta and os.path.isfile(ruta):
            return ruta
    return None


def _configurar_tesseract():
    """Apunta pytesseract al ejecutable de Tesseract si logra localizarlo.

    Idempotente: solo hace el trabajo la primera vez. Devuelve True si
    pytesseract esta listo para usarse.
    """
    global _tesseract_configurado
    try:
        import pytesseract
    except ImportError:
        return False
    if _tesseract_configurado:
        return True
    ruta = _localizar_tesseract()
    if ruta:
        pytesseract.pytesseract.tesseract_cmd = ruta
    _tesseract_configurado = True
    return True


def verificar_disponible():
    """Comprueba que las dependencias de OCR estan instaladas y operativas.

    Devuelve (True, "") si todo esta bien, o (False, mensaje) con
    instrucciones claras si falta algo.
    """
    if not _CV2_OK:
        return False, (
            "Faltan las librerias de procesamiento de imagen (OpenCV y NumPy). "
            "Instalalas con:\n\n"
            "```\npip install opencv-python-headless numpy\n```\n\n"
            "O instala todas las dependencias del proyecto: "
            "`pip install -r requirements.txt`."
        )
    # Basta con que UNO de los dos motores este disponible.
    if _hay_rapidocr() or _hay_tesseract():
        return True, ""

    # Ningun motor disponible: recomendar RapidOCR (no requiere instalar programas)
    extra = ""
    if sys.platform.startswith("win"):
        extra = (
            "\n\n*Alternativa (mejor calidad, requiere instalar un programa aparte):* "
            "Tesseract desde https://github.com/UB-Mannheim/tesseract/wiki "
            "(marca **Spanish** al instalar)."
        )
    return False, (
        "No hay ningun motor de OCR disponible. La forma mas sencilla "
        "(no requiere instalar ningun programa aparte) es:\n\n"
        "```\npip install rapidocr-onnxruntime\n```\n\n"
        "Reinicia la app despues de instalarlo. Tambien puedes instalar todas "
        "las dependencias del proyecto con `pip install -r requirements.txt`."
        + extra
    )


def _idiomas():
    """Idiomas a usar: interseccion entre los deseados y los instalados."""
    global _lang_cache
    if _lang_cache is None:
        try:
            import pytesseract
            _configurar_tesseract()
            instalados = set(pytesseract.get_languages(config=""))
            usar = [l for l in ("spa", "eng") if l in instalados]
            _lang_cache = "+".join(usar) if usar else "eng"
        except Exception:
            _lang_cache = _LANG
    return _lang_cache


def _puntuacion_texto(texto):
    """Heuristica de calidad: palabras completas vs longitud total, penalizando ruido."""
    if not texto:
        return 0
    palabras = re.findall(r"[A-Za-záéíóúüñÁÉÍÓÚÜÑ]{3,}", texto)
    # Penalizar lineas ruidosas (muchos simbolos, caracteres no alfanumericos)
    lineas = [l for l in texto.splitlines() if l.strip()]
    ruido = sum(
        1 for l in lineas
        if l.strip() and sum(1 for c in l if c.isalnum()) / max(len(l.strip()), 1) < 0.35
    )
    return len(palabras) * 4 + len(texto) - ruido * 15


# ─────────────────────────────────────────────────────────────────────────────
#  Motor RapidOCR (pip puro, sin binario del sistema) — ideal para Windows
# ─────────────────────────────────────────────────────────────────────────────

_rapidocr_engine = None
_rapidocr_estado = None   # None=sin probar, True=disponible, False=no disponible


def _motor_rapidocr():
    """Devuelve la instancia (cacheada) de RapidOCR, o None si no esta instalado.

    Los modelos ONNX vienen incluidos en el paquete, asi que no se descarga
    nada de internet: funciona offline tras `pip install rapidocr-onnxruntime`.
    """
    global _rapidocr_engine, _rapidocr_estado
    if _rapidocr_estado is None:
        _rapidocr_engine = None
        # Probar las distintas distribuciones de RapidOCR por orden de preferencia
        for importar in (
            lambda: __import__("rapidocr_onnxruntime", fromlist=["RapidOCR"]).RapidOCR,
            lambda: __import__("rapidocr", fromlist=["RapidOCR"]).RapidOCR,
            lambda: __import__("rapidocr_openvino", fromlist=["RapidOCR"]).RapidOCR,
        ):
            try:
                RapidOCR = importar()
                _rapidocr_engine = RapidOCR()
                break
            except Exception:
                continue
        _rapidocr_estado = _rapidocr_engine is not None
    return _rapidocr_engine


def _hay_rapidocr():
    return _motor_rapidocr() is not None


def _reconstruir_lineas(resultado):
    """Reconstruye el texto en orden de lectura a partir de las cajas de RapidOCR.

    RapidOCR devuelve una lista de [caja, texto, confianza] sin orden de lectura;
    agrupamos las cajas por filas (centro vertical proximo) y, dentro de cada
    fila, las ordenamos de izquierda a derecha.
    """
    items = []
    for box, texto, _score in resultado:
        ys = [p[1] for p in box]
        xs = [p[0] for p in box]
        items.append((sum(ys) / len(ys), min(xs), max(ys) - min(ys), texto))
    if not items:
        return ""
    items.sort(key=lambda t: (t[0], t[1]))
    altos = sorted(t[2] for t in items)
    alto_medio = altos[len(altos) // 2] or 10

    lineas, actual, y_linea = [], [], None
    for y_centro, x_izq, _alto, texto in items:
        if y_linea is not None and abs(y_centro - y_linea) > alto_medio * 0.6:
            actual.sort(key=lambda t: t[0])
            lineas.append(" ".join(t[1] for t in actual))
            actual = []
        actual.append((x_izq, texto))
        y_linea = y_centro
    if actual:
        actual.sort(key=lambda t: t[0])
        lineas.append(" ".join(t[1] for t in actual))
    return "\n".join(lineas)


def _ocr_rapidocr(img_bgr):
    """Ejecuta RapidOCR sobre una imagen BGR y devuelve el texto reconstruido.

    Tolera el formato de las dos familias del paquete:
      - rapidocr-onnxruntime (v1): devuelve una tupla (resultado, tiempos)
      - rapidocr (v2): devuelve un objeto con atributos boxes/txts/scores
    """
    engine = _motor_rapidocr()
    if engine is None:
        return ""
    try:
        salida = engine(img_bgr)
    except Exception:
        return ""
    # Formato v1: tupla (lista de [caja, texto, score], tiempos)
    if isinstance(salida, tuple):
        resultado = salida[0]
        return _reconstruir_lineas(resultado) if resultado else ""
    # Formato v2: objeto con boxes y txts
    boxes = getattr(salida, "boxes", None)
    txts = getattr(salida, "txts", None)
    if boxes is not None and txts is not None and len(boxes):
        resultado = [[box, txt, 1.0] for box, txt in zip(boxes, txts)]
        return _reconstruir_lineas(resultado)
    return ""


# ─────────────────────────────────────────────────────────────────────────────
#  Motor Tesseract
# ─────────────────────────────────────────────────────────────────────────────

_tesseract_estado = None   # cache de disponibilidad


def _hay_tesseract():
    """True si pytesseract y el binario de Tesseract estan disponibles."""
    global _tesseract_estado
    if _tesseract_estado is None:
        try:
            import pytesseract
            _configurar_tesseract()
            pytesseract.get_tesseract_version()
            _tesseract_estado = True
        except Exception:
            _tesseract_estado = False
    return _tesseract_estado


def _ocr_imagen_pil(pil_img, psm, lang=None):
    """Una pasada Tesseract sobre una imagen PIL.

    Los errores de configuracion (Tesseract no instalado) se propagan para
    que la interfaz pueda mostrarlos; solo se silencian fallos de pasada.
    """
    import pytesseract
    cfg = f"--oem 1 --psm {psm} -l {lang or _idiomas()}"
    try:
        return pytesseract.image_to_string(pil_img, config=cfg)
    except pytesseract.TesseractNotFoundError:
        raise
    except Exception:
        return ""


def _ocr_multipasada(img_bgr):
    """Extrae texto usando los motores disponibles; devuelve el mejor resultado.

    Prioriza RapidOCR (motor pip, hace su propia deteccion sobre la imagen
    escalada). Si no esta disponible, o no da buena calidad, recurre a
    Tesseract con varias pasadas de preprocesado. Termina en cuanto un
    resultado es de buena calidad para no malgastar tiempo.
    """
    candidatos = []

    # 1. RapidOCR sobre imagen escalada (sin binarizar: el motor ya segmenta)
    if _hay_rapidocr():
        texto = _corregir(_ocr_rapidocr(_escalar(img_bgr.copy())))
        if _evaluar_legibilidad(texto) == "buena":
            return texto
        candidatos.append(texto)

    # 2. Tesseract: varias combinaciones de preprocesado y PSM
    if _hay_tesseract():
        for modo_pre, psms in [
            ("normal",    [3, 4, 6]),
            ("documento", [3, 6]),
            ("color_doc", [3, 6]),  # Canal LAB/L: pasaportes y TIE con fondo de color
            ("normal",    [11]),    # texto disperso (logos, sellos, marcas de agua)
        ]:
            pre = _preprocesar(img_bgr, modo=modo_pre)
            pil = _cv2_a_pil(pre)
            for psm in psms:
                texto = _corregir(_ocr_imagen_pil(pil, psm))
                if _evaluar_legibilidad(texto) == "buena":
                    return texto
                candidatos.append(texto)

    return max(candidatos, key=_puntuacion_texto, default="")


def _ocr_zona_mrz(img_bgr):
    """Aplica OCR optimizado en el tercio inferior para detectar la MRZ."""
    h = img_bgr.shape[0]
    franja = img_bgr[int(h * 0.65):, :]

    # Tesseract con whitelist de caracteres MRZ es el mas fiable para la OCR-B
    if _hay_tesseract():
        pre = _preprocesar(franja, modo="mrz")
        pil = _cv2_a_pil(pre)
        try:
            import pytesseract
            cfg = (
                "--oem 1 --psm 6 -l eng "
                "-c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<"
            )
            return pytesseract.image_to_string(pil, config=cfg)
        except Exception:
            pass

    # Alternativa: RapidOCR sobre la franja inferior
    if _hay_rapidocr():
        return _ocr_rapidocr(_escalar(franja.copy()))
    return ""


# ─────────────────────────────────────────────────────────────────────────────
#  Extraccion de texto segun tipo de archivo
# ─────────────────────────────────────────────────────────────────────────────

def _pdf_a_imagenes_bgr(datos_bytes, dpi=300):
    """Convierte paginas de un PDF a lista de arrays BGR.

    Intenta primero pymupdf (puro Python, sin poppler) y luego pdf2image
    (requiere poppler instalado). Devuelve lista vacia si ninguno funciona.
    """
    # 1. PyMuPDF — sin dependencias del sistema, funciona en Windows
    try:
        import fitz  # pymupdf
        doc = fitz.open(stream=datos_bytes, filetype="pdf")
        zoom = dpi / 72.0
        mat = fitz.Matrix(zoom, zoom)
        imagenes = []
        for pag in doc:
            pix = pag.get_pixmap(matrix=mat, colorspace=fitz.csRGB)
            arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)
            imagenes.append(cv2.cvtColor(arr, cv2.COLOR_RGB2BGR))
        doc.close()
        return imagenes[:8]
    except Exception:
        pass

    # 2. pdf2image / poppler — alternativa en servidores Linux con poppler
    try:
        from pdf2image import convert_from_bytes
        pil_imagenes = convert_from_bytes(datos_bytes, dpi=dpi, fmt="png")
        resultados = []
        for pil_img in pil_imagenes[:8]:
            buf = io.BytesIO()
            pil_img.save(buf, format="PNG")
            resultados.append(_cargar_cv2(buf.getvalue()))
        return resultados
    except Exception:
        return []


def _texto_pdf_nativo(datos_bytes):
    """Extrae el texto embebido de un PDF digital.

    Intenta PyMuPDF (rapido y fiable) y, si no, pdfplumber. Devuelve "" si el
    PDF no tiene texto seleccionable (PDF escaneado) o no hay librerias.
    """
    # 1. PyMuPDF
    try:
        import fitz
        doc = fitz.open(stream=datos_bytes, filetype="pdf")
        texto = "\n".join(pag.get_text("text") for pag in doc)
        doc.close()
        if len(texto.strip()) >= 30:
            return texto
    except Exception:
        pass
    # 2. pdfplumber
    try:
        import pdfplumber
        textos = []
        with pdfplumber.open(io.BytesIO(datos_bytes)) as pdf:
            for pag in pdf.pages:
                t = pag.extract_text(x_tolerance=2, y_tolerance=3) or ""
                textos.append(t)
        return "\n".join(textos)
    except Exception:
        return ""


def diagnostico():
    """Devuelve el estado de cada dependencia de OCR/PDF, para mostrar en la UI."""
    estado = {
        "opencv": _CV2_OK,
        "rapidocr": _hay_rapidocr(),
        "tesseract": _hay_tesseract(),
    }
    for nombre, modulo in (("pdfplumber", "pdfplumber"), ("pymupdf", "fitz"),
                           ("pdf2image", "pdf2image")):
        try:
            __import__(modulo)
            estado[nombre] = True
        except Exception:
            estado[nombre] = False
    return estado


def _texto_pdf_escaneado(datos_bytes):
    """Convierte un PDF escaneado a imagenes y aplica OCR."""
    imagenes = _pdf_a_imagenes_bgr(datos_bytes)
    return "\n".join(_ocr_multipasada(img) for img in imagenes)


def _imagen_y_mrz(datos_bytes):
    """Devuelve (texto_ocr, texto_mrz) para archivos de imagen."""
    img_bgr = _cargar_cv2(datos_bytes)
    texto = _ocr_multipasada(img_bgr)
    mrz_texto = _ocr_zona_mrz(img_bgr)
    return texto, mrz_texto


def extraer_texto(nombre_archivo, datos_bytes):
    """Extrae texto del documento. Devuelve (texto_principal, texto_mrz)."""
    ext = nombre_archivo.rsplit(".", 1)[-1].lower() if "." in nombre_archivo else ""
    if ext == "pdf":
        nativo = _texto_pdf_nativo(datos_bytes)
        if len(nativo.strip()) >= 80:
            return nativo, ""      # PDF digital: excelente calidad, sin OCR
        # PDF escaneado o sin texto embebido: convertir a imagenes y hacer OCR
        escaneado = _texto_pdf_escaneado(datos_bytes)
        # Si el nativo tenia algo de texto, combinarlo con el OCR
        combinado = "\n".join(t for t in (nativo, escaneado) if t.strip())
        return combinado, ""
    # Imagen: no requiere ningun motor especifico en el import
    try:
        return _imagen_y_mrz(datos_bytes)
    except Exception:
        return "", ""


# ─────────────────────────────────────────────────────────────────────────────
#  MRZ parser
# ─────────────────────────────────────────────────────────────────────────────

_RE_MRZ_L1 = re.compile(r"P[A-Z<][A-Z<]{3}[A-Z<]{39}", re.IGNORECASE)
_RE_MRZ_L2 = re.compile(
    # Fecha de nacimiento y caducidad: acepta O/0 por posibles confusiones OCR
    r"[A-Z0-9<]{9}[0-9A-Z<][A-Z<]{3}[0-9O]{6}[0-9A-Z<][MF<][0-9O]{6}[0-9A-Z<][A-Z0-9<]{15}[0-9A-Z<]",
    re.IGNORECASE,
)

_PAISES_ES = {
    "ESP": "Española", "MAR": "Marroquí", "ROU": "Rumana", "COL": "Colombiana",
    "ECU": "Ecuatoriana", "PER": "Peruana", "BOL": "Boliviana", "VEN": "Venezolana",
    "DOM": "Dominicana", "CHN": "China", "PAK": "Pakistaní", "SEN": "Senegalesa",
    "UKR": "Ucraniana", "NGA": "Nigeriana", "MLI": "Maliense", "GNB": "Guineana",
    "GIN": "Guineana", "CIV": "Marfileña", "CMR": "Camerunesa", "GHA": "Ghanesa",
    "MEX": "Mexicana", "ARG": "Argentina", "BRA": "Brasileña", "CUB": "Cubana",
    "HND": "Hondureña", "GTM": "Guatemalteca", "SLV": "Salvadoreña",
    "NIC": "Nicaragüense", "ALG": "Argelina", "TUN": "Tunecina", "LBY": "Libia",
    "EGY": "Egipcia", "BGD": "Bangladesí", "IND": "India", "PHL": "Filipina",
    "GBR": "Británica", "DEU": "Alemana", "FRA": "Francesa", "ITA": "Italiana",
    "PRT": "Portuguesa", "POL": "Polaca",
}


def _mrz_fecha(yymmdd, es_caducidad=False):
    try:
        yymmdd = yymmdd.replace("O", "0").replace("o", "0")
        yy, mm, dd = int(yymmdd[:2]), int(yymmdd[2:4]), int(yymmdd[4:6])
        anio = (2000 + yy) if (yy <= 30 if not es_caducidad else yy <= 50) else (1900 + yy)
        return date(anio, mm, dd).isoformat()
    except Exception:
        return None


def _mrz_nombre(raw):
    # Formato MRZ: APELLIDOS<<NOMBRE1<NOMBRE2<<<... — dividir antes de limpiar
    trozos = raw.split("<<")
    partes = [" ".join(t.replace("<", " ").split()).title() for t in trozos]
    partes = [p for p in partes if p]
    if not partes:
        return None
    apellidos = partes[0]
    nombre = " ".join(partes[1:]) if len(partes) > 1 else ""
    return f"{nombre} {apellidos}".strip() if nombre else apellidos


def _limpiar_mrz_linea(linea):
    """Normaliza una linea para parseo MRZ: quita espacios, reemplaza chars invalidos."""
    linea = re.sub(r"\s+", "", linea).upper()
    return re.sub(r"[^A-Z0-9<]", "<", linea)


def parsear_mrz(texto):
    """Busca y parsea la MRZ en el texto. Devuelve dict o None.

    Tolera que Tesseract recorte los '<' de relleno al final de la linea 1
    (rellenamos hasta 44) y que cuele algun caracter espurio.
    """
    lineas_raw = [l for l in texto.splitlines() if l.strip()]
    lineas = [_limpiar_mrz_linea(l) for l in lineas_raw]

    for idx, linea in enumerate(lineas):
        # L1: empieza por P, contiene el separador '<<' de apellidos/nombre.
        # Tesseract suele comerse los '<' finales: rellenar hasta 44.
        if len(linea) < 12 or not linea.startswith("P") or "<<" not in linea:
            continue
        l1 = (linea + "<" * 44)[:44]
        if not _RE_MRZ_L1.match(l1):
            continue
        for l2_cand in lineas[idx + 1: idx + 3]:
            if len(l2_cand) >= 44 and _RE_MRZ_L2.match(l2_cand[:44]):
                l2 = l2_cand[:44]
                pais = l1[2:5].replace("<", "")
                nac = l2[10:13].replace("<", "")
                return {
                    "tipo_id": "pasaporte",
                    "tipo_nombre": "Pasaporte",
                    "titular": _mrz_nombre(l1[5:44]),
                    "numero": l2[0:9].replace("<", ""),
                    "pais_emision": _PAISES_ES.get(pais, pais),
                    "nacionalidad_doc": _PAISES_ES.get(nac, nac),
                    "fecha_nacimiento": _mrz_fecha(l2[13:19]),
                    "sexo": l2[20] if l2[20] in ("M", "F") else None,
                    "fecha_emision": None,
                    "fecha_caducidad": _mrz_fecha(l2[21:27], es_caducidad=True),
                    "fecha_acredita_desde": None,
                    "fuente_mrz": True,
                }
    return None


# ─────────────────────────────────────────────────────────────────────────────
#  Clasificacion del tipo de documento
# ─────────────────────────────────────────────────────────────────────────────

_PALABRAS_CLAVE_TIPO = [
    # Documentos de identidad — primero los mas especificos
    ("pasaporte",           ["PASAPORTE", "PASSPORT", "REPUBLIC OF", "REPUBLIQUE",
                             "PASSEPORT", "REISEPASS"]),
    ("tie",                 ["TARJETA DE IDENTIDAD DE EXTRANJERO",
                             "AUTORIZACION DE RESIDENCIA Y TRABAJO", " TIE ",
                             "EXTRANJEROS EN ESPANA", "RESIDENCIA TEMPORAL",
                             "IDENTIFICACION EXTRANJERO"]),
    ("nie",                 ["NUMERO DE IDENTIFICACION DE EXTRANJERO",
                             "NÚMERO DE IDENTIFICACIÓN",
                             "CERTIFICADO NIE", "TARJETA NIE",
                             "RESIDENCIA NO LUCRATIVA", "CERTIFICADO DE REGISTRO"]),
    ("dni",                 ["DOCUMENTO NACIONAL DE IDENTIDAD", "D.N.I", "DNI"]),
    ("tarjeta_comunitaria", ["TARJETA DE RESIDENCIA COMUNITARIA",
                             "CIUDADANO DE LA UNION EUROPEA",
                             "FAMILIAR DE CIUDADANO UE"]),
    # Pruebas de empadronamiento/presencia
    ("empadronamiento",     ["EMPADRONAMIENTO", "PADRON MUNICIPAL",
                             "PADRÓN MUNICIPAL", "EMPADRONADO", "INSCRIPCION PADRON",
                             "VOLANTE DE EMPADRONAMIENTO", "CERTIFICADO DE EMPADRONAMIENTO",
                             "DOMICILIO EN", "ALTA EN EL PADRON",
                             "CERTIFICADO DE CONVIVENCIA", "CONVIVENCIA EN EL PADRON",
                             "INSCRITO EN EL PADRON", "INSCRITA EN EL PADRON"]),
    # Documentacion laboral
    ("vida_laboral",        ["VIDA LABORAL", "INFORME DE VIDA LABORAL",
                             "TESORERIA GENERAL", "TGSS", "PERIODOS COTIZADOS",
                             "REGIMEN GENERAL", "COTIZACIONES",
                             "HISTORIAL DE COTIZACIONES", "INFORME DE COTIZACIONES",
                             "SITUACION DE AFILIACION", "PERIODOS DE ALTA"]),
    ("contrato_trabajo",    ["CONTRATO DE TRABAJO", "CONTRATO LABORAL",
                             "CONTRATO INDEFINIDO", "CONTRATO TEMPORAL",
                             "PRESTACION DE SERVICIOS", "MODALIDAD DEL CONTRATO",
                             "JORNADA LABORAL", "EL TRABAJADOR Y LA EMPRESA",
                             "CONTRATO A TIEMPO", "CONTRATO POR OBRA",
                             "FECHA DE INICIO DEL CONTRATO", "LA EMPRESA Y EL TRABAJADOR"]),
    ("nomina",              ["NOMINA", "NÓMINA", "RECIBO DE SALARIO",
                             "SALARIO BRUTO", "DEVENGOS", "DEDUCCIONES",
                             "SALARIO NETO", "RETENCIONES IRPF",
                             "PERCEPCIONES SALARIALES", "TOTAL DEVENGADO"]),
    ("cuenta_propia",       ["AUTONOMO", "AUTÓNOMO", "ACTIVIDAD ECONOMICA",
                             "ALTA EN EL RETA", "REGIMEN ESPECIAL DE TRABAJADORES AUTONOMOS",
                             "LICENCIA DE ACTIVIDAD", "DECLARACION CENSAL",
                             "DECLARACION DE ALTA", "IMPUESTO DE ACTIVIDADES ECONOMICAS",
                             "IAE", "TRABAJADOR AUTONOMO"]),
    # Informes sociales
    ("informe_arraigo",     ["INFORME DE ARRAIGO", "INFORME SOCIAL",
                             "INFORME DE INTEGRACION", "TRABAJADOR SOCIAL",
                             "INTEGRACION SOCIAL", "SERVICIOS SOCIALES",
                             "GRADO DE INTEGRACION", "ARRAIGO SOCIAL",
                             "VINCULACION CON ESPANA", "INSERCION SOCIAL"]),
    # Antecedentes penales
    ("certificado_penal",   ["ANTECEDENTES PENALES", "REGISTRO CENTRAL DE PENADOS",
                             "CERTIFICADO DE PENALES", "CERTIFICADO DE CONDUCTA",
                             "NO CONSTA ANTECEDENTE", "POLICIA JUDICIAL",
                             "AUSENCIA DE ANTECEDENTES", "SIN ANTECEDENTES PENALES",
                             "MINISTERIO DE JUSTICIA", "ANTECEDENTES EN ESPANA"]),
    # Certificados civiles
    ("acta_nacimiento",     ["ACTA DE NACIMIENTO", "CERTIFICADO DE NACIMIENTO",
                             "PARTIDA DE NACIMIENTO", "REGISTRO CIVIL",
                             "NACIDO EN", "LIBRO DE FAMILIA",
                             "ACTA LITERAL DE NACIMIENTO", "INSCRIPCION DE NACIMIENTO"]),
    ("vinculo_familiar",    ["LIBRO DE FAMILIA", "CERTIFICADO DE MATRIMONIO",
                             "ACTA MATRIMONIO", "REAGRUPACION FAMILIAR",
                             "PARENTESCO", "CONYUGE", "HIJO/A DE",
                             "CERTIFICADO DE FAMILIA NUMEROSA", "ACTA DE MATRIMONIO"]),
    # Educacion
    ("titulo_academico",    ["TITULO UNIVERSITARIO", "DIPLOMA", "CERTIFICADO DE ESTUDIOS",
                             "GRADO EN", "MÁSTER", "BACHILLERATO",
                             "MATRICULA OFICIAL", "ADMISION AL PROGRAMA",
                             "CERTIFICADO DE MATRICULA", "INFORME DE APROVECHAMIENTO",
                             "ACUERDO DE FORMACION", "CONTRATO DE FORMACION",
                             "CERTIFICADO DE FORMACION PROFESIONAL"]),
    # Salud
    ("seguro_medico",       ["SEGURO MEDICO", "POLIZA DE SALUD", "COBERTURA SANITARIA",
                             "SEGURO DE SALUD", "TARJETA SANITARIA", "MUTUA"]),
    ("certificado_discapacidad", ["GRADO DE DISCAPACIDAD", "CERTIFICADO DE DISCAPACIDAD",
                                  "MINUSVALIA", "DEPENDENCIA", "RECONOCIMIENTO DE DISCAPACIDAD"]),
    # Formularios oficiales de extranjeria
    ("solicitud_ex",        ["MODELO EX-01", "MODELO EX-10", "MODELO EX-32",
                             "IMPRESO EX01", "IMPRESO EX10", "IMPRESO EX32",
                             "EX - 01", "EX - 10", "EX - 32",
                             "SOLICITUD DE AUTORIZACION DE RESIDENCIA",
                             "SECRETARIA DE ESTADO DE MIGRACIONES"]),
    # Tasas y pagos
    ("tasa",                ["MODELO 790", "TASA 790", "052",
                             "ABONO DE TASA", "PAGO DE TASA",
                             "AGENCIA TRIBUTARIA", "CARTA DE PAGO"]),
    # Resoluciones y autorizaciones
    ("resolucion",          ["RESOLUCION DE", "RESOLUCION FAVORABLE",
                             "AUTORIZACION DE RESIDENCIA", "AUTORIZACION FAVORABLE",
                             "RESOLUCION DENEGATORIA", "SE RESUELVE",
                             "DELEGACION DEL GOBIERNO"]),
]


def _clasificar_tipo(texto):
    texto_up = texto.upper()
    # Tambien buscar sin espacios: RapidOCR puede fusionar palabras ALL-CAPS
    texto_sin_sp = re.sub(r"\s+", "", texto_up)
    for tipo_id, palabras in _PALABRAS_CLAVE_TIPO:
        for p in palabras:
            if p in texto_up or p.replace(" ", "") in texto_sin_sp:
                return tipo_id
    return "no_identificado"


def _nombre_tipo(tipo_id):
    return {
        "pasaporte":              "Pasaporte",
        "nie":                    "Certificado NIE",
        "tie":                    "Tarjeta de Identidad de Extranjero (TIE)",
        "dni":                    "DNI",
        "empadronamiento":        "Certificado de empadronamiento",
        "vida_laboral":           "Informe de vida laboral",
        "contrato_trabajo":       "Contrato de trabajo",
        "nomina":                 "Nómina / recibo de salario",
        "cuenta_propia":          "Documentación autónomo / cuenta propia",
        "informe_arraigo":        "Informe de arraigo / integración social",
        "certificado_penal":      "Certificado de antecedentes penales",
        "acta_nacimiento":        "Acta / certificado de nacimiento",
        "vinculo_familiar":       "Documentación de vínculo familiar",
        "titulo_academico":       "Título académico / matrícula",
        "seguro_medico":          "Seguro médico",
        "tarjeta_comunitaria":    "Tarjeta de residencia comunitaria",
        "certificado_discapacidad": "Certificado de discapacidad",
        "solicitud_ex":           "Formulario de solicitud (EX-01/10/32)",
        "tasa":                   "Justificante de pago de tasa (Modelo 790)",
        "resolucion":             "Resolución / autorización de residencia",
        "no_identificado":        "Documento no identificado",
    }.get(tipo_id, tipo_id)


# ─────────────────────────────────────────────────────────────────────────────
#  Extraccion de campos mediante regex
# ─────────────────────────────────────────────────────────────────────────────

# NIE: X/Y/Z + 7 digitos + letra; acepta separadores opcionales y OCR noise
_RE_NIE = re.compile(r"\b([XYZxyz])[\s\-]?(\d{7})[\s\-]?([A-Za-z])\b")
_RE_DNI = re.compile(r"\b(\d{8}[A-Z])\b", re.I)
_RE_NUM_PASAPORTE = re.compile(r"\b([A-Z]{2,3}\d{6,7})\b")

# Fechas en varios formatos (robustas a ruido OCR)
_RE_F_ES  = re.compile(r"\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\b")
_RE_F_ISO = re.compile(r"\b(\d{4})[/\- ](\d{2})[/\- ](\d{2})\b")
_RE_F_TXT = re.compile(
    r"\b(\d{1,2})\s+(?:de\s+)?"
    r"(enero|febrero|marzo|abril|mayo|junio|julio|agosto|"
    r"septiembre|octubre|noviembre|diciembre)\s+(?:de\s+)?(\d{4})\b",
    re.I,
)
_MESES = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6,
    "julio": 7, "agosto": 8, "septiembre": 9, "octubre": 10, "noviembre": 11,
    "diciembre": 12,
}

# Patrones de campos con etiqueta (acepta variaciones por OCR)
def _eti_a_regex(etiqueta):
    """Convierte una etiqueta en patron tolerante a espacios ausentes.

    RapidOCR suele pegar las palabras ('FECHA DE NACIMIENTO' -> 'FECHADENACIMIENTO'),
    asi que entre cada palabra de la etiqueta permitimos cero o mas espacios.
    """
    return r"\s*".join(re.escape(parte) for parte in etiqueta.split())


def _patron_campo(etiquetas, fecha=False):
    """Construye regex que busca un valor despues de alguna de las etiquetas dadas."""
    eti_re = "|".join(_eti_a_regex(e) for e in sorted(etiquetas, key=len, reverse=True))
    if fecha:
        valor = (r"(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{4}"
                 r"|\d{4}[/\- ]\d{2}[/\- ]\d{2}"
                 r"|\d{1,2}[ \t]+de[ \t]+\w+[ \t]+(?:de[ \t]+)?\d{4})")
    else:
        # Solo dentro de la misma linea: sin \n para no arrastrar texto contiguo
        valor = r"([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑa-záéíóúüña-z \t,\.\-]{3,60})"
    return re.compile(
        rf"(?:{eti_re})\s*[:\-]?\s*{valor}",
        re.IGNORECASE | re.UNICODE,
    )


_RE_NOMBRE = _patron_campo([
    "NOMBRE Y APELLIDOS", "APELLIDOS Y NOMBRE", "NOMBRE COMPLETO",
    "NOMBRE", "TITULAR", "TRABAJADOR/A", "TRABAJADOR", "EMPLEADO/A",
    "EMPLEADO", "SOLICITANTE", "INTERESADO/A", "INTERESADO",
    "D.", "D./", "Dña.", "DON", "DOÑA",
])
_RE_NACIONALIDAD = _patron_campo([
    "NACIONALIDAD", "NATIONALITY", "PAIS DE NACIMIENTO",
])
_RE_FNAC = _patron_campo([
    "FECHA DE NACIMIENTO", "DATE OF BIRTH", "F. NACIMIENTO",
    "NACIDO EL", "NACIDO/A EL", "BORN", "F.NACIMIENTO",
], fecha=True)
_RE_FCAD = _patron_campo([
    "FECHA DE CADUCIDAD", "EXPIRY DATE", "VALID UNTIL",
    "VALIDO HASTA", "FECHA DE VENCIMIENTO", "CADUCA EL", "CADUCIDAD",
    "FECHA CADUCIDAD",
], fecha=True)
_RE_FEMISION = _patron_campo([
    "FECHA DE EXPEDICION", "DATE OF ISSUE", "EXPEDIDO EL",
    "FECHA DE EMISION", "FECHA EXPEDICION",
], fecha=True)
_RE_FALTA = _patron_campo([
    "FECHA DE ALTA", "ALTA PADRONAL", "INSCRITO DESDE",
    "FECHA DE INSCRIPCION", "ALTA EN EL PADRON",
], fecha=True)
_RE_ENTRADA = _patron_campo([
    "FECHA DE ENTRADA EN ESPANA", "ENTRADA EN ESPAÑA", "LLEGADA A ESPANA",
], fecha=True)
_RE_EMPLEADOR = _patron_campo([
    "EMPRESA", "EMPLEADOR", "RAZON SOCIAL", "NOMBRE DEL EMPRESARIO",
    "EMPRESA:", "EMPLEADOR/A",
])
_RE_TIPO_CONTRATO = re.compile(
    r"(?:TIPO\s*(?:DE)?\s*CONTRATO|MODALIDAD)\s*[:\-]?\s*"
    r"(INDEFINIDO|TEMPORAL|TIEMPO\s*PARCIAL|FIJO\s*DISCONTINUO|"
    r"PRACTICAS|OBRA\s*Y\s*SERVICIO|EVENTUAL[^\n]{0,40})",
    re.I,
)

# Domicilio: el valor incluye numeros (calle, piso), asi que no usa _patron_campo
_RE_DOMICILIO = re.compile(
    r"(?:DOMICILIO\s*(?:EN|ACTUAL)?|DIRECCI[OÓ]N|RESIDENCIA\s*EN|"
    r"CON\s*DOMICILIO\s*EN)\s*[:\.\-]?\s*"
    r"([A-ZÁÉÍÓÚÜÑ0-9][A-ZÁÉÍÓÚÜÑa-záéíóúüñ0-9 ,\.\-/º°ªºnNoO]{5,70})",
    re.IGNORECASE,
)
_RE_EMAIL = re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b")
_RE_TELEFONO = re.compile(
    r"(?:TEL[EÉ]FONO|TLF\.?|TEL\.?|M[OÓ]VIL|MOVIL|CONTACTO)\s*[:\.\-]?\s*"
    r"((?:\+?\d[\s\-]?){9,13})",
    re.IGNORECASE,
)
# Telefono sin etiqueta: numero espanol de 9 cifras (movil o fijo)
_RE_TELEFONO_BARE = re.compile(
    r"(?<!\d)(\+?34[ \-]?)?([67]\d{8}|[89]\d{8})(?!\d)",
)
# Domicilio desde tipo de via: C/, CALLE, AVDA., PLAZA, etc.
# El \s* entre el prefijo y el nombre captura el espacio que OCR suele insertar.
_RE_DOMICILIO_VIA = re.compile(
    r"(?:C[/\.]\s*|CL\.?\s+|CALLE\s+|AVDA?\.?\s+|AVENIDA\s+|PZA\.?\s+|PLAZA\s+|"
    r"PASEO\s+|PSO\.?\s+|RONDA\s+|CARRETERA\s+|POLIGONO\s+|POL\.?\s+|"
    r"BARRIO\s+|URB(?:ANIZACION)?\.?\s+)"
    r"([A-ZÁÉÍÓÚÜÑA-Za-záéíóúüñ0-9][A-ZÁÉÍÓÚÜÑa-záéíóúüñ0-9 ,\.\-/º°ªnN]{3,69})",
    re.IGNORECASE,
)


def _parsear_fecha(raw):
    if not raw:
        return None
    raw = raw.strip()
    for rx, fn in [
        (_RE_F_ISO, lambda m: f"{m[1]}-{m[2]}-{m[3]}"),
        (_RE_F_ES,  lambda m: f"{int(m[3]):04d}-{int(m[2]):02d}-{int(m[1]):02d}"),
        (_RE_F_TXT, lambda m: f"{int(m[3]):04d}-{_MESES.get(m[2].lower(),0):02d}-{int(m[1]):02d}"),
    ]:
        m = rx.search(raw)
        if m:
            try:
                d = date.fromisoformat(fn(m))
                if 1920 <= d.year <= 2099:
                    return d.isoformat()
            except ValueError:
                pass
    return None


def _primero(regex, texto):
    m = regex.search(texto)
    return m.group(1).strip() if m else None


def _nie_limpio(texto):
    m = _RE_NIE.search(texto)
    if m:
        return (m.group(1) + m.group(2) + m.group(3)).upper()
    return None


def _nombre_de_texto(texto):
    """Extrae el nombre con varios metodos en orden de fiabilidad."""
    # 1. Patron con etiqueta explicita
    m = _RE_NOMBRE.search(texto)
    if m:
        candidato = m.group(1).strip()
        # Descartar si es muy corto, tiene solo numeros, o empieza con minuscula
        if (len(candidato) >= 5 and candidato[0].isupper()
                and not re.match(r"^\d", candidato)):
            # Limpiar cruft del final (p.ej. "D./Dna. NOMBRE\ncon NIE" → solo el nombre)
            candidato = re.split(r"\n|con\s+NIE|con\s+DNI", candidato, flags=re.I)[0].strip()
            if len(candidato) >= 5:
                return candidato
    # 2. Lineas en MAYUSCULAS que parezcan nombres (2-5 palabras)
    _EXCLUIR = {
        "NIE", "DNI", "TIE", "PASAPORTE", "POLICIA", "NACIONAL", "MINISTERIO",
        "INTERIOR", "ESPANA", "EXTRANJERO", "RESIDENCIA", "TRABAJO", "SOCIAL",
        "SEGURIDAD", "CERTIFICADO", "EMPADRONAMIENTO", "AYUNTAMIENTO", "MUNICIPAL",
        "MADRID", "BARCELONA", "JEFATURA", "DELEGACION", "GOBIERNO",
    }
    for linea in texto.splitlines():
        linea = linea.strip()
        if not (5 <= len(linea) <= 60):
            continue
        if not re.match(r"^[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ\s]{4,59}$", linea):
            continue
        palabras = linea.split()
        if not (2 <= len(palabras) <= 6):
            continue
        if any(p in _EXCLUIR for p in palabras):
            continue
        return linea.title()
    return None


def _extraer_campos(texto, tipo_id):
    campos = {
        "titular": _nombre_de_texto(texto),
        "numero": None,
        "pais_emision": None,
        "nacionalidad_doc": None,
        "fecha_nacimiento": None,
        "sexo": None,
        "fecha_emision": _parsear_fecha(_primero(_RE_FEMISION, texto)),
        "fecha_caducidad": _parsear_fecha(_primero(_RE_FCAD, texto)),
        "fecha_acredita_desde": None,
        "empleador": None,
        "tipo_contrato": None,
        "direccion": None,
        "telefono": None,
        "email": None,
    }

    # Numero de documento
    nie = _nie_limpio(texto)
    if tipo_id in ("nie", "tie", "empadronamiento", "vida_laboral",
                   "contrato_trabajo", "nomina", "informe_arraigo"):
        campos["numero"] = nie
    elif tipo_id == "pasaporte":
        m = _RE_NUM_PASAPORTE.search(texto)
        campos["numero"] = m.group(1).upper() if m else nie
    elif tipo_id == "dni":
        m = _RE_DNI.search(texto)
        campos["numero"] = m.group(1).upper() if m else None
    else:
        campos["numero"] = nie  # cualquier doc puede mencionar el NIE del titular

    # Nacionalidad
    nac = _primero(_RE_NACIONALIDAD, texto)
    if nac:
        campos["nacionalidad_doc"] = nac.strip().capitalize()

    # Fechas
    campos["fecha_nacimiento"] = _parsear_fecha(_primero(_RE_FNAC, texto))

    # Fecha de acreditacion de presencia
    candidatos_entrada = [
        _parsear_fecha(_primero(_RE_FALTA, texto)),
        _parsear_fecha(_primero(_RE_ENTRADA, texto)),
    ]
    validas = [f for f in candidatos_entrada if f]
    if validas:
        campos["fecha_acredita_desde"] = min(validas)

    # Contrato
    if tipo_id == "contrato_trabajo":
        emp = _primero(_RE_EMPLEADOR, texto)
        if emp:
            campos["empleador"] = emp.strip()
        m_tc = _RE_TIPO_CONTRATO.search(texto)
        if m_tc:
            campos["tipo_contrato"] = m_tc.group(1).strip().capitalize()

    # Domicilio (sobre todo en empadronamiento, pero puede aparecer en otros)
    m_dir = _RE_DOMICILIO.search(texto)
    if m_dir:
        direccion = re.split(r"\s{2,}|\n", m_dir.group(1).strip())[0].strip(" .,-")
        if len(direccion) >= 5:
            campos["direccion"] = direccion
    # Fallback: buscar por tipo de via (C/, CALLE, AVDA, etc.)
    if not campos["direccion"]:
        m_via = _RE_DOMICILIO_VIA.search(texto)
        if m_via:
            direccion = re.split(r"\s{2,}|\n", m_via.group(0).strip())[0].strip(" .,-")
            if len(direccion) >= 5:
                campos["direccion"] = direccion

    # Email y telefono (frecuentes en contratos, solicitudes, etc.)
    m_email = _RE_EMAIL.search(texto)
    if m_email:
        campos["email"] = m_email.group(0).lower()
    m_tel = _RE_TELEFONO.search(texto)
    if m_tel:
        tel = re.sub(r"[\s\-]", "", m_tel.group(1))
        if 9 <= len(tel) <= 13:
            campos["telefono"] = tel
    # Fallback: telefono sin etiqueta (movil/fijo espanol de 9 cifras)
    if not campos["telefono"]:
        m_tel_bare = _RE_TELEFONO_BARE.search(texto)
        if m_tel_bare:
            tel_bare = re.sub(r"[\s\-]", "", m_tel_bare.group(0))
            # Descartar si coincide con un NIE (X/Y/Z + 7 digitos) o parece fecha
            if re.fullmatch(r"(\+34)?[6789]\d{8}", tel_bare):
                campos["telefono"] = tel_bare

    return campos


# ─────────────────────────────────────────────────────────────────────────────
#  Legibilidad y estado
# ─────────────────────────────────────────────────────────────────────────────

_DOCS_SIN_CADUCIDAD = {
    "empadronamiento", "vida_laboral", "acta_nacimiento",
    "informe_arraigo", "certificado_penal", "titulo_academico",
}
_DIAS_AVISO = 90


def _evaluar_legibilidad(texto):
    """Califica la calidad del texto OCR segun la proporcion de letras que
    forman palabras reconocibles frente al total de caracteres visibles."""
    if not texto or len(texto.strip()) < 60:
        return "mala"
    palabras = re.findall(r"[A-Za-záéíóúüñÁÉÍÓÚÜÑ]{3,}", texto)
    letras_en_palabras = sum(len(p) for p in palabras)
    visibles = len(re.findall(r"\S", texto))
    ratio = letras_en_palabras / max(visibles, 1)
    if len(palabras) >= 12 and ratio >= 0.55:
        return "buena"
    if len(palabras) >= 5 and ratio >= 0.35:
        return "regular"
    return "mala"


def _calcular_estado(tipo_id, fecha_cad):
    if tipo_id in _DOCS_SIN_CADUCIDAD:
        return "sin_caducidad"
    if not fecha_cad:
        return "desconocido"
    try:
        cad = date.fromisoformat(fecha_cad)
        hoy = date.today()
        if cad < hoy:
            return "caducado"
        if (cad - hoy).days <= _DIAS_AVISO:
            return "proximo_a_caducar"
        return "vigente"
    except ValueError:
        return "desconocido"


def _incidencias(tipo_id, campos, estado, legibilidad):
    inc = []
    if legibilidad == "mala":
        inc.append("Baja calidad de imagen. Usa un escaner o foto mas nitida.")
    elif legibilidad == "regular":
        inc.append("Calidad media. Verifica los datos extraidos manualmente.")
    if estado == "caducado":
        inc.append(f"Documento caducado el {campos.get('fecha_caducidad')}.")
    elif estado == "proximo_a_caducar":
        inc.append(f"Documento proximo a caducar ({campos.get('fecha_caducidad')}).")
    if tipo_id not in _DOCS_SIN_CADUCIDAD and not campos.get("fecha_caducidad"):
        inc.append("No se detecto la fecha de caducidad.")
    if not campos.get("titular"):
        inc.append("No se detecto el nombre del titular.")
    if tipo_id in ("nie", "tie", "pasaporte") and not campos.get("numero"):
        inc.append("No se detecto el numero del documento.")
    return inc


# ─────────────────────────────────────────────────────────────────────────────
#  Punto de entrada
# ─────────────────────────────────────────────────────────────────────────────

def analizar_con_ocr(nombre_archivo, datos_bytes):
    """Analiza un documento con OCR. Devuelve dict compatible con analizar_documento()."""
    texto, mrz_texto = extraer_texto(nombre_archivo, datos_bytes)
    legibilidad = _evaluar_legibilidad(texto)

    # Intentar MRZ en la zona inferior y en el texto completo
    mrz = parsear_mrz(mrz_texto) or parsear_mrz(texto)

    if mrz:
        tipo_id = mrz["tipo_id"]
        campos = {k: mrz.get(k) for k in (
            "titular", "numero", "pais_emision", "nacionalidad_doc",
            "fecha_nacimiento", "sexo", "fecha_caducidad",
        )}
        campos.update({"fecha_emision": None, "fecha_acredita_desde": None,
                       "empleador": None, "tipo_contrato": None,
                       "direccion": None, "telefono": None, "email": None})
        legibilidad = "buena"
    else:
        tipo_id = _clasificar_tipo(texto) if legibilidad != "mala" else "no_identificado"
        campos = _extraer_campos(texto, tipo_id)

    estado = _calcular_estado(tipo_id, campos.get("fecha_caducidad"))
    inc = _incidencias(tipo_id, campos, estado, legibilidad)

    resumen_partes = [_nombre_tipo(tipo_id)]
    if campos.get("titular"):
        resumen_partes.append(f"titular: {campos['titular']}")
    if campos.get("numero"):
        resumen_partes.append(f"nº {campos['numero']}")
    if estado in ("caducado", "proximo_a_caducar"):
        resumen_partes.append(f"{'CADUCADO' if estado == 'caducado' else 'caduca pronto'} {campos.get('fecha_caducidad','')}")

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
        "empleador": campos.get("empleador"),
        "tipo_contrato": campos.get("tipo_contrato"),
        "direccion": campos.get("direccion"),
        "telefono": campos.get("telefono"),
        "email": campos.get("email"),
        "estado": estado,
        "legibilidad": legibilidad,
        "incidencias": inc,
        "resumen": " · ".join(resumen_partes),
        "archivo": nombre_archivo,
        "archivos": [nombre_archivo],
        "_modo": "ocr",
        "_ocr_texto": texto[:3000],
    }


def analizar_multiples_con_ocr(paginas, tramite_id=None):
    """Analiza varias paginas del mismo documento y fusiona resultados."""
    if not paginas:
        return {}
    resultados = [analizar_con_ocr(n, d) for n, d in paginas]
    _ORDEN = {"buena": 0, "regular": 1, "mala": 2}
    base = min(resultados, key=lambda r: _ORDEN.get(r.get("legibilidad", "mala"), 2))
    for r in resultados:
        for campo in ("titular", "numero", "pais_emision", "nacionalidad_doc",
                      "fecha_nacimiento", "sexo", "fecha_emision",
                      "fecha_caducidad", "fecha_acredita_desde",
                      "empleador", "tipo_contrato", "direccion",
                      "telefono", "email"):
            if not base.get(campo) and r.get(campo):
                base[campo] = r[campo]
    if base["tipo_id"] == "no_identificado":
        for r in resultados:
            if r["tipo_id"] != "no_identificado":
                base["tipo_id"] = r["tipo_id"]
                base["tipo_nombre"] = r["tipo_nombre"]
                break
    base["archivo"] = ", ".join(n for n, _ in paginas)
    base["archivos"] = [n for n, _ in paginas]
    base["estado"] = _calcular_estado(base["tipo_id"], base.get("fecha_caducidad"))
    base["incidencias"] = _incidencias(base["tipo_id"], base, base["estado"], base["legibilidad"])
    return base
