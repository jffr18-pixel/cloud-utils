"""Importacion de documentos desde bandeja de entrada IMAP.

Permite al gestor conectarse a su correo y descargar directamente los
adjuntos (PDF, JPG, PNG) que los clientes le han enviado, para analizarlos
sin tener que guardarlos manualmente en disco.
"""

import email as _email_lib
import imaplib
from email.header import decode_header as _decode_header

_EXTS_OK = {".pdf", ".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"}


def _dec(valor):
    """Decodifica una cabecera de email (puede estar codificada en base64/QP)."""
    if valor is None:
        return ""
    partes = _decode_header(valor)
    resultado = []
    for parte, enc in partes:
        if isinstance(parte, bytes):
            resultado.append(parte.decode(enc or "utf-8", errors="replace"))
        else:
            resultado.append(str(parte))
    return "".join(resultado)


def conectar(host, port, user, password, ssl=True):
    """Abre una conexion IMAP y devuelve el objeto imap autenticado."""
    if ssl:
        imap = imaplib.IMAP4_SSL(host, int(port))
    else:
        imap = imaplib.IMAP4(host, int(port))
    imap.login(user, password)
    return imap


def listar_emails(imap, carpeta="INBOX", max_emails=40):
    """Devuelve los ultimos N emails (con o sin adjuntos) como lista de dicts.

    Cada dict tiene: uid, asunto, remitente, fecha, tiene_adjuntos.
    """
    try:
        imap.select(carpeta, readonly=True)
    except imaplib.IMAP4.error:
        return []

    _, datos = imap.search(None, "ALL")
    uids = datos[0].split() if datos and datos[0] else []
    uids = uids[-max_emails:]

    emails = []
    for uid in reversed(uids):
        try:
            _, cabeceras = imap.fetch(
                uid,
                "(BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE CONTENT-TYPE)])",
            )
            if not cabeceras or not cabeceras[0]:
                continue
            msg = _email_lib.message_from_bytes(cabeceras[0][1])
            asunto = _dec(msg.get("Subject", "(sin asunto)"))
            remitente = _dec(msg.get("From", ""))
            fecha = msg.get("Date", "")

            # Comprueba si hay adjuntos con extension admitida
            _, struct = imap.fetch(uid, "(BODYSTRUCTURE)")
            struct_str = str(struct).lower() if struct and struct[0] else ""
            tiene = any(
                ext.lstrip(".") in struct_str
                for ext in _EXTS_OK
            ) or "attachment" in struct_str

            emails.append({
                "uid": uid.decode() if isinstance(uid, bytes) else uid,
                "asunto": asunto[:80],
                "remitente": remitente[:60],
                "fecha": fecha[:30],
                "tiene_adjuntos": tiene,
            })
        except Exception:  # noqa: BLE001
            continue
    return emails


def descargar_adjuntos(imap, uid):
    """Descarga y devuelve los adjuntos admitidos de un email.

    Devuelve una lista de tuplas (nombre_archivo, bytes).
    """
    uid_bytes = uid.encode() if isinstance(uid, str) else uid
    try:
        _, datos = imap.fetch(uid_bytes, "(RFC822)")
    except imaplib.IMAP4.error:
        return []

    if not datos or not datos[0]:
        return []

    msg = _email_lib.message_from_bytes(datos[0][1])
    adjuntos = []

    for parte in msg.walk():
        cd = parte.get("Content-Disposition", "").lower()
        ct = parte.get_content_type().lower()

        # Solo adjuntos o partes inline con extension admitida
        nombre = parte.get_filename()
        if not nombre and "attachment" not in cd:
            # Intentar inferir si es imagen inline
            if ct.startswith("image/"):
                ext = "." + ct.split("/")[1]
                nombre = f"imagen{ext}"
            else:
                continue

        nombre = _dec(nombre or "adjunto")
        ext = ("." + nombre.rsplit(".", 1)[-1].lower()) if "." in nombre else ""
        if ext not in _EXTS_OK:
            continue

        payload = parte.get_payload(decode=True)
        if payload:
            adjuntos.append((nombre, payload))

    return adjuntos
