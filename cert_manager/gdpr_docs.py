from __future__ import annotations

from datetime import date


def gdpr_available() -> bool:
    try:
        import fpdf  # noqa: F401
        return True
    except ImportError:
        return False


def generate_consent_pdf(client: dict, gestor: dict) -> bytes:
    """
    Genera el documento RGPD/mandato en PDF listo para firmar.

    client: {'name', 'dni', 'email', 'phone'}
    gestor: {'name', 'cif', 'address', 'email'}
    Devuelve bytes del PDF.
    """
    if gdpr_available():
        return _generate_with_fpdf(client, gestor)
    return _generate_placeholder(client, gestor)


# ---------------------------------------------------------------------------
# fpdf2 implementation
# ---------------------------------------------------------------------------

def _generate_with_fpdf(client: dict, gestor: dict) -> bytes:
    from fpdf import FPDF

    today = date.today().strftime("%d de %B de %Y")

    # fpdf2 built-in fonts use latin-1; replace chars outside that range.
    def safe(text: str) -> str:
        return (
            text
            .replace("—", "-")   # em dash -> hyphen
            .replace("–", "-")   # en dash -> hyphen
            .replace("•", "*")   # bullet -> asterisk
            .replace("’", "'")   # right single quotation mark
            .replace("‘", "'")   # left single quotation mark
            .replace("“", '"')   # left double quotation mark
            .replace("”", '"')   # right double quotation mark
            .encode("latin-1", errors="replace").decode("latin-1")
        )

    class PDF(FPDF):
        def header(self):
            self.set_font("Helvetica", "B", 9)
            self.set_text_color(100, 100, 100)
            self.cell(0, 6, safe("BurocraciaZero - Documento confidencial"), align="R")
            self.ln(8)

        def footer(self):
            self.set_y(-12)
            self.set_font("Helvetica", "", 8)
            self.set_text_color(150, 150, 150)
            self.cell(0, 5, safe(f"Pagina {self.page_no()}"), align="C")

    pdf = PDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.set_margins(20, 20, 20)

    # ------------------------------------------------------------------
    # Página 1 — Contrato de mandato y autorización
    # ------------------------------------------------------------------
    pdf.add_page()

    pdf.set_font("Helvetica", "B", 14)
    pdf.set_text_color(0, 0, 0)
    pdf.multi_cell(
        0, 8,
        "AUTORIZACIÓN DE REPRESENTACIÓN Y TRATAMIENTO DE DATOS",
        align="C",
    )
    pdf.ln(4)

    pdf.set_draw_color(0, 0, 0)
    pdf.line(20, pdf.get_y(), 190, pdf.get_y())
    pdf.ln(6)

    def section_title(text: str) -> None:
        pdf.set_font("Helvetica", "B", 11)
        pdf.set_fill_color(230, 230, 230)
        pdf.cell(0, 7, f"  {text}", fill=True, ln=True)
        pdf.ln(2)

    def body(text: str) -> None:
        pdf.set_font("Helvetica", "", 10)
        pdf.multi_cell(0, 6, text)
        pdf.ln(2)

    section_title("PARTES")
    body(
        f"MANDANTE (el cliente): D./Dña. {client.get('name', '')}, con DNI/NIE "
        f"{client.get('dni', '')}, correo electrónico {client.get('email', '')}, "
        f"teléfono {client.get('phone', '')}."
    )
    body(
        f"MANDATARIA (la gestoría): {gestor.get('name', '')}, con CIF "
        f"{gestor.get('cif', '')}, domicilio en {gestor.get('address', '')}, "
        f"correo electrónico {gestor.get('email', '')}."
    )

    section_title("OBJETO")
    body(
        "El MANDANTE otorga a la MANDATARIA autorización expresa para actuar en su "
        "nombre ante la Administración Pública española, incluyendo de forma no "
        "limitativa: el Servicio de Notificaciones Electrónicas (DEHU/DEHú), la "
        "Agencia Estatal de Administración Tributaria (AEAT) y la Tesorería General "
        "de la Seguridad Social (TGSS), así como cualquier otro organismo público "
        "para el que el MANDANTE solicite expresamente los servicios de la gestoría."
    )

    section_title("CUSTODIA DEL CERTIFICADO DIGITAL")
    body(
        "El MANDANTE declara que entrega voluntariamente a la MANDATARIA su "
        "certificado digital (FNMT-RCM, DNIe u otro certificado electrónico "
        "reconocido) y la contraseña de acceso al mismo, con la única y exclusiva "
        "finalidad de realizar los trámites objeto del presente mandato.\n\n"
        "La MANDATARIA se compromete a:\n"
        "  a) Custodiar el certificado con medidas de seguridad apropiadas.\n"
        "  b) Utilizar el certificado únicamente para los trámites expresamente "
        "autorizados por el MANDANTE.\n"
        "  c) No ceder ni transferir el certificado a terceros.\n"
        "  d) Destruir o devolver el certificado y sus copias cuando finalice la "
        "relación de servicio o a petición del MANDANTE."
    )

    section_title("VIGENCIA")
    body(
        "El presente mandato tendrá vigencia durante el período en que se mantenga "
        "activa la relación de prestación de servicios entre las partes, pudiendo "
        "ser revocado en cualquier momento por el MANDANTE mediante comunicación "
        "escrita a la MANDATARIA."
    )

    section_title("MARCO LEGAL")
    body(
        "Este contrato se formaliza al amparo del artículo 1709 y siguientes del "
        "Código Civil (contrato de mandato), y del artículo 5 de la Ley 39/2015, "
        "de 1 de octubre, del Procedimiento Administrativo Común de las "
        "Administraciones Públicas, que regula la representación ante la "
        "Administración."
    )

    # ------------------------------------------------------------------
    # Página 2 — Información RGPD (Art. 13 RGPD)
    # ------------------------------------------------------------------
    pdf.add_page()

    pdf.set_font("Helvetica", "B", 14)
    pdf.multi_cell(
        0, 8,
        "INFORMACIÓN SOBRE PROTECCIÓN DE DATOS PERSONALES (Art. 13 RGPD)",
        align="C",
    )
    pdf.ln(4)
    pdf.line(20, pdf.get_y(), 190, pdf.get_y())
    pdf.ln(6)

    section_title("RESPONSABLE DEL TRATAMIENTO")
    body(
        f"{gestor.get('name', '')} — CIF: {gestor.get('cif', '')}\n"
        f"Domicilio: {gestor.get('address', '')}\n"
        f"Correo electrónico: {gestor.get('email', '')}"
    )

    section_title("FINALIDAD DEL TRATAMIENTO")
    body(
        "Sus datos personales y certificado digital se tratarán para:\n"
        "  1. Gestión de notificaciones electrónicas en DEHú/DEHU.\n"
        "  2. Realización de trámites administrativos en nombre del cliente.\n"
        "  3. Envío de avisos y comunicaciones al cliente sobre el estado de sus "
        "expedientes y notificaciones recibidas."
    )

    section_title("BASE JURÍDICA")
    body(
        "El tratamiento se basa en:\n"
        "  • El consentimiento explícito del interesado (Art. 6.1.a RGPD), "
        "otorgado mediante la firma del presente documento.\n"
        "  • La ejecución del contrato de mandato suscrito entre las partes "
        "(Art. 6.1.b RGPD)."
    )

    section_title("PLAZO DE CONSERVACIÓN")
    body(
        "Los datos se conservarán durante el tiempo en que se mantenga activa la "
        "prestación de servicios. Una vez finalizada la relación, los datos se "
        "conservarán durante cinco (5) años adicionales para cumplir con las "
        "obligaciones legales de documentación y ante posibles reclamaciones, "
        "conforme al artículo 30 del Código de Comercio y normativa fiscal aplicable."
    )

    section_title("DESTINATARIOS")
    body(
        "Sus datos únicamente se comunicarán a la Administración Pública española "
        "en el ejercicio del mandato otorgado (AEAT, TGSS, DEHú y otros organismos "
        "públicos). No se realizarán transferencias internacionales de datos."
    )

    section_title("DERECHOS ARCO+")
    body(
        "Puede ejercer los siguientes derechos:\n"
        "  • Acceso: conocer qué datos tratamos sobre usted.\n"
        "  • Rectificación: corregir datos inexactos o incompletos.\n"
        "  • Supresión ('derecho al olvido'): solicitar la eliminación de sus datos.\n"
        "  • Portabilidad: recibir sus datos en formato estructurado.\n"
        "  • Limitación: restringir el tratamiento en determinadas circunstancias.\n"
        "  • Oposición: oponerse al tratamiento en determinadas circunstancias.\n\n"
        f"Para ejercer estos derechos, diríjase por correo electrónico a "
        f"{gestor.get('email', '')} o por escrito a {gestor.get('address', '')}, "
        f"indicando el derecho que desea ejercer y adjuntando copia de su DNI."
    )

    section_title("RECLAMACIÓN ANTE LA AEPD")
    body(
        "Si considera que el tratamiento de sus datos no es conforme a la normativa "
        "vigente, tiene derecho a presentar una reclamación ante la Autoridad de "
        "Control competente: la Agencia Española de Protección de Datos (AEPD), "
        "www.aepd.es, C/ Jorge Juan 6, 28001 Madrid."
    )

    # ------------------------------------------------------------------
    # Página 3 — Firma
    # ------------------------------------------------------------------
    pdf.add_page()

    pdf.set_font("Helvetica", "B", 14)
    pdf.multi_cell(0, 8, "FIRMAS", align="C")
    pdf.ln(4)
    pdf.line(20, pdf.get_y(), 190, pdf.get_y())
    pdf.ln(10)

    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 6, f"En __________________, a {today}", ln=True)
    pdf.ln(12)

    # Two-column signature area
    col_w = 80
    gap = 10
    left_x = 20
    right_x = left_x + col_w + gap

    # Left column — client
    pdf.set_xy(left_x, pdf.get_y())
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(col_w, 6, "EL CLIENTE (MANDANTE)", ln=False)
    pdf.set_xy(right_x, pdf.get_y())
    pdf.cell(col_w, 6, "LA GESTORÍA (MANDATARIA)", ln=True)
    pdf.ln(2)

    pdf.set_font("Helvetica", "", 10)
    pdf.set_xy(left_x, pdf.get_y())
    client_label = (
        f"D./Dña. {client.get('name', '')}\n"
        f"DNI/NIE: {client.get('dni', '')}"
    )
    pdf.multi_cell(col_w, 6, client_label)
    client_block_bottom = pdf.get_y()

    gestor_y = client_block_bottom - (client_label.count('\n') + 1) * 6
    pdf.set_xy(right_x, gestor_y)
    pdf.multi_cell(col_w, 6, gestor.get("name", ""))

    pdf.ln(4)
    sig_y = max(pdf.get_y(), client_block_bottom) + 4

    # Signature lines
    pdf.set_draw_color(0, 0, 0)
    pdf.line(left_x, sig_y + 20, left_x + col_w, sig_y + 20)
    pdf.line(right_x, sig_y + 20, right_x + col_w, sig_y + 20)

    pdf.set_xy(left_x, sig_y + 22)
    pdf.set_font("Helvetica", "I", 8)
    pdf.cell(col_w, 5, "Firma del cliente")
    pdf.set_xy(right_x, sig_y + 22)
    pdf.cell(col_w, 5, "Firma y sello de la gestoría")

    # Footer note
    pdf.set_y(-50)
    pdf.set_draw_color(150, 150, 150)
    pdf.line(20, pdf.get_y(), 190, pdf.get_y())
    pdf.ln(3)
    pdf.set_font("Helvetica", "I", 7.5)
    pdf.set_text_color(100, 100, 100)
    pdf.multi_cell(
        0, 4.5,
        "Este documento ha sido firmado digitalmente mediante certificado electrónico "
        "cualificado conforme al Reglamento eIDAS (UE) 910/2014. La firma electrónica "
        "cualificada tiene el mismo efecto jurídico que la firma manuscrita "
        "(Art. 25.2 eIDAS).",
        align="J",
    )

    return bytes(pdf.output())


# ---------------------------------------------------------------------------
# Fallback: minimal valid PDF without external dependencies
# ---------------------------------------------------------------------------

def _generate_placeholder(client: dict, gestor: dict) -> bytes:
    today = date.today().isoformat()
    lines = [
        "AUTORIZACION DE REPRESENTACION Y TRATAMIENTO DE DATOS",
        "",
        f"Cliente: {client.get('name', '')}  DNI: {client.get('dni', '')}",
        f"Gestoria: {gestor.get('name', '')}  CIF: {gestor.get('cif', '')}",
        "",
        f"Fecha de generacion: {today}",
        "",
        "NOTA: Instale fpdf2 (pip install fpdf2) para generar el PDF completo.",
        "",
        "Firma del cliente: ___________________________",
        "",
        "Firma de la gestoria: ___________________________",
    ]
    text_block = "\n".join(lines)

    # Encode the text as a PDF stream
    stream_content = f"BT /F1 10 Tf 50 750 Td 14 TL\n"
    for line in lines:
        safe = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)").replace("\r", "")
        stream_content += f"({safe}) Tj T*\n"
    stream_content += "ET"

    stream_bytes = stream_content.encode("latin-1", errors="replace")
    stream_len = len(stream_bytes)

    pdf = (
        b"%PDF-1.4\n"
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"
        b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"
        b"3 0 obj\n<< /Type /Page /Parent 2 0 R "
        b"/MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << "
        b"/F1 5 0 R >> >> >>\nendobj\n"
        + f"4 0 obj\n<< /Length {stream_len} >>\nstream\n".encode()
        + stream_bytes
        + b"\nendstream\nendobj\n"
        b"5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n"
        b"xref\n0 6\n"
        b"0000000000 65535 f \n"
        b"0000000009 00000 n \n"
        b"0000000058 00000 n \n"
        b"0000000115 00000 n \n"
        b"0000000266 00000 n \n"
        b"0000000400 00000 n \n"
        b"trailer\n<< /Size 6 /Root 1 0 R >>\n"
        b"startxref\n460\n%%EOF\n"
    )
    return pdf
