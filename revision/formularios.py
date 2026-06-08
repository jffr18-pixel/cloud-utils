"""Generacion de formularios oficiales pre-rellenados (EX-01 y EX-03).

Usa los datos ya extraidos por el analizador (nombre, NIE, numero de
pasaporte, caducidades) para rellenar los campos principales. El resultado
es un PDF orientativo que el gestor revisa y completa antes de presentar.
"""

from datetime import date

from fpdf import FPDF

_SUST = {
    "á": "a", "é": "e", "í": "i", "ó": "o", "ú": "u", "ü": "u", "ñ": "n",
    "Á": "A", "É": "E", "Í": "I", "Ó": "O", "Ú": "U", "Ü": "U", "Ñ": "N",
}


def _a(texto):
    for k, v in _SUST.items():
        texto = (texto or "").replace(k, v)
    return texto


def _extraer(resultados):
    """Extrae datos del solicitante de los resultados del analizador."""
    d = {"nombre": "", "num_doc": "", "tipo_doc": "", "cad_doc": "",
         "nie": "", "pais": "", "fecha_nac": ""}
    for doc in resultados:
        if doc.get("titular") and not d["nombre"]:
            d["nombre"] = doc.get("titular", "")
        tid = doc.get("tipo_id", "")
        if tid in ("pasaporte", "documento_identidad") and not d["num_doc"]:
            d["num_doc"] = doc.get("numero", "")
            d["tipo_doc"] = "PASAPORTE" if tid == "pasaporte" else "DNI/ID"
            d["cad_doc"] = doc.get("fecha_caducidad", "") or ""
            d["pais"] = doc.get("pais_emision", "") or ""
        if tid in ("nie", "tie") and not d["nie"]:
            d["nie"] = doc.get("numero", "") or ""
    return d


def _cabecera(pdf, titulo, subtitulo):
    pdf.set_fill_color(147, 115, 178)
    pdf.rect(0, 0, 210, 22, "F")
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 11)
    pdf.set_xy(10, 5)
    pdf.cell(0, 7, _a("BUROCRACIA ZERO  |  " + titulo), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 8)
    pdf.set_xy(10, 14)
    pdf.cell(0, 6, _a(subtitulo))
    pdf.set_text_color(0, 0, 0)
    pdf.set_xy(10, 28)


def _seccion(pdf, texto):
    pdf.set_fill_color(237, 230, 250)
    pdf.set_draw_color(180, 155, 210)
    pdf.set_font("Helvetica", "B", 8)
    pdf.set_text_color(80, 50, 120)
    y = pdf.get_y()
    pdf.set_xy(10, y)
    pdf.cell(190, 7, "  " + _a(texto).upper(), border=1, fill=True, new_x="LMARGIN", new_y="NEXT")
    pdf.set_text_color(0, 0, 0)
    pdf.set_draw_color(0, 0, 0)
    pdf.ln(4)


def _campo(pdf, etiqueta, valor, ancho=88, x=None):
    """Dibuja una etiqueta + caja de valor. Avanza el cursor a la derecha."""
    if x is not None:
        pdf.set_x(x)
    pdf.set_font("Helvetica", "B", 7)
    pdf.set_text_color(120, 90, 160)
    pdf.cell(ancho, 4, _a(etiqueta).upper(), new_x="LMARGIN", new_y="NEXT")
    if x is not None:
        pdf.set_x(x)
    pdf.set_text_color(0, 0, 0)
    pdf.set_font("Helvetica", "", 10)
    pdf.set_fill_color(250, 247, 255)
    pdf.set_draw_color(200, 185, 220)
    pdf.cell(ancho, 9, _a(valor or ""), border=1, fill=True, new_x="LMARGIN", new_y="NEXT")
    pdf.set_draw_color(0, 0, 0)
    pdf.ln(3)


def _fila2(pdf, et1, v1, et2, v2, a1=90, a2=90):
    """Dos campos en la misma fila."""
    y = pdf.get_y()
    _campo(pdf, et1, v1, a1, x=10)
    pdf.set_y(y)
    _campo(pdf, et2, v2, a2, x=10 + a1 + 5)
    pdf.set_y(y + 4 + 9 + 3)


def _nota(pdf):
    pdf.set_font("Helvetica", "BI", 8)
    pdf.set_text_color(147, 115, 178)
    pdf.cell(
        0, 5,
        _a("NOTA: Formulario orientativo pre-rellenado con IA. Verifique y complete antes de presentar."),
        new_x="LMARGIN", new_y="NEXT",
    )
    pdf.set_text_color(0, 0, 0)
    pdf.ln(4)


def _pie(pdf):
    pdf.set_y(-18)
    pdf.set_font("Helvetica", "I", 7)
    pdf.set_text_color(170, 170, 170)
    pdf.cell(
        0, 4,
        _a(f"Generado por Burocracia Zero el {date.today().isoformat()} · Solo orientativo · Verifique con la normativa vigente"),
        align="C", new_x="LMARGIN", new_y="NEXT",
    )


def generar_ex01(resultados, solicitante="", tramite_id="", gestoria=None):
    """Genera formulario EX-01 pre-rellenado (solicitud por circunstancias excepcionales)."""
    from . import tramites as _tramites
    d = _extraer(resultados)
    if solicitante and not d["nombre"]:
        d["nombre"] = solicitante
    tramite_nombre = _tramites.TRAMITES.get(tramite_id, {}).get("nombre", "") if tramite_id else ""

    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()
    _cabecera(
        pdf,
        "Formulario EX-01",
        "Solicitud de autorizacion de residencia temporal por circunstancias excepcionales",
    )
    _nota(pdf)

    _seccion(pdf, "1. Datos del solicitante")
    _fila2(pdf, "Apellidos y nombre", d["nombre"], "NIE (si dispone de el)", d["nie"])
    _fila2(pdf, "Tipo de documento de viaje", d["tipo_doc"], "Numero de documento", d["num_doc"])
    _fila2(pdf, "Fecha de caducidad del documento", d["cad_doc"], "Nacionalidad / pais emision", d["pais"])
    _fila2(pdf, "Fecha de nacimiento", d.get("fecha_nac", ""), "Lugar de nacimiento", "")
    pdf.ln(2)

    _seccion(pdf, "2. Domicilio en Espana")
    _fila2(pdf, "Calle, numero, piso, puerta", "", "Codigo postal", "")
    _fila2(pdf, "Municipio", "", "Provincia", "")
    pdf.ln(2)

    _seccion(pdf, "3. Tipo de autorizacion solicitada")
    _campo(pdf, "Circunstancia excepcional / tramite", tramite_nombre, 190, x=10)
    pdf.ln(2)

    _seccion(pdf, "4. Representante o tutor (si procede)")
    _fila2(pdf, "Nombre del representante", "", "DNI / NIE del representante", "")
    pdf.ln(6)

    pdf.set_font("Helvetica", "", 9)
    pdf.cell(0, 5, _a(f"En _______________, a {date.today().strftime('%d de %B de %Y')}."),
             new_x="LMARGIN", new_y="NEXT")
    pdf.ln(14)
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(95, 5, "Firma del solicitante / representante:", new_x="RIGHT", new_y="LAST")
    pdf.cell(90, 5, "Sello y firma del funcionario:")

    _pie(pdf)
    return bytes(pdf.output())


def generar_ex03(resultados, solicitante="", tramite_id="", gestoria=None):
    """Genera formulario EX-03 pre-rellenado (renovacion de residencia temporal)."""
    from . import tramites as _tramites
    d = _extraer(resultados)
    if solicitante and not d["nombre"]:
        d["nombre"] = solicitante
    tramite_nombre = _tramites.TRAMITES.get(tramite_id, {}).get("nombre", "") if tramite_id else ""

    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()
    _cabecera(
        pdf,
        "Formulario EX-03",
        "Solicitud de renovacion de autorizacion de residencia temporal",
    )
    _nota(pdf)

    _seccion(pdf, "1. Datos del solicitante")
    _fila2(pdf, "Apellidos y nombre", d["nombre"], "NIE", d["nie"])
    _fila2(pdf, "Numero de pasaporte / documento", d["num_doc"], "Caducidad del documento", d["cad_doc"])
    _fila2(pdf, "Nacionalidad", d["pais"], "Fecha de nacimiento", "")
    _fila2(pdf, "Domicilio (calle, num, piso)", "", "Codigo postal", "")
    _fila2(pdf, "Municipio", "", "Provincia", "")
    pdf.ln(2)

    _seccion(pdf, "2. Autorizacion en vigor que se renueva")
    _fila2(pdf, "Tipo de autorizacion actual", tramite_nombre, "Caducidad de la autorizacion", "")
    _campo(pdf, "Numero de expediente anterior (si lo conoce)", "", 190, x=10)
    pdf.ln(2)

    _seccion(pdf, "3. Actividad a desarrollar (si procede)")
    _fila2(pdf, "Ocupacion / puesto de trabajo", "", "Empresa / empleador", "")
    _fila2(pdf, "CIF/NIF del empleador", "", "Provincia de trabajo", "")
    pdf.ln(2)

    _seccion(pdf, "4. Representante (si procede)")
    _fila2(pdf, "Nombre del representante", "", "DNI / NIE del representante", "")
    pdf.ln(6)

    pdf.set_font("Helvetica", "", 9)
    pdf.cell(0, 5, _a(f"En _______________, a {date.today().strftime('%d de %B de %Y')}."),
             new_x="LMARGIN", new_y="NEXT")
    pdf.ln(14)
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(95, 5, "Firma del solicitante / representante:", new_x="RIGHT", new_y="LAST")
    pdf.cell(90, 5, "Sello y firma del funcionario:")

    _pie(pdf)
    return bytes(pdf.output())
