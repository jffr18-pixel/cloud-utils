"""Comunicacion con el cliente: mensaje de WhatsApp y envio por email."""

import smtplib
import ssl
import urllib.parse
from email.message import EmailMessage

from . import tramites
from .informe import _pendientes


def mensaje_whatsapp(checklist, tramite_id, solicitante="", gestoria=None):
    """Genera un texto breve, listo para copiar y pegar en WhatsApp."""
    tramite = tramites.TRAMITES[tramite_id]["nombre"]
    faltan, caducados, proximos = _pendientes(checklist)
    saludo = f"Hola {solicitante}," if solicitante else "Hola,"
    lineas = [saludo, "", f"Sobre tu tramite de {tramite}, necesitamos lo siguiente:"]
    if not (faltan or caducados or proximos):
        lineas.append("Tienes la documentacion completa, ¡gracias!")
    if faltan:
        lineas.append("")
        lineas.append("Pendiente de enviar:")
        lineas += [f"- {n}" for n in faltan]
    if caducados:
        lineas.append("")
        lineas.append("Caducado (hay que renovar):")
        lineas += [f"- {n}" for n in caducados]
    if proximos:
        lineas.append("")
        lineas.append("Caduca pronto:")
        lineas += [f"- {n}" for n in proximos]
    lineas.append("")
    lineas.append("Puedes enviarnos las fotos o PDF por aqui. Gracias.")
    if gestoria and gestoria.get("nombre_gestoria"):
        lineas.append(gestoria["nombre_gestoria"])
    return "\n".join(lineas)


def enlace_whatsapp(texto, telefono=""):
    """Construye un enlace wa.me con el mensaje (y telefono si se indica)."""
    base = "https://wa.me/"
    numero = "".join(c for c in telefono if c.isdigit())
    return f"{base}{numero}?text=" + urllib.parse.quote(texto)


def enviar_avisos_caducidad(smtp, gestoria, dias=30):
    """Envia emails a clientes con documentos que caducan en los proximos 'dias' dias.

    Solo envia a expedientes que tienen 'email_cliente' registrado.
    Devuelve (enviados, fallidos, sin_email).
    """
    from . import historial as _hist

    avisos = _hist.proximas_caducidades(dias)
    if not avisos:
        return 0, 0, 0

    por_exp = {}
    for av in avisos:
        por_exp.setdefault(av["expediente_id"], []).append(av)

    enviados = fallidos = sin_email = 0
    for eid, av_list in por_exp.items():
        reg = _hist.cargar(eid)
        if not reg:
            continue
        email_cliente = (reg.get("email_cliente") or "").strip()
        if not email_cliente:
            sin_email += 1
            continue
        solicitante = reg.get("solicitante") or "cliente"
        lineas = [
            f"Hola {solicitante},", "",
            "Le informamos de que los siguientes documentos de su tramite de extranjeria",
            "requieren atencion:", "",
        ]
        for av in av_list:
            if av["vencido"]:
                estado = "VENCIDO"
            else:
                estado = f"caduca en {av['dias_restantes']} dias ({av['fecha_caducidad']})"
            lineas.append(f"  - {av['documento']}: {estado}")
        lineas += [
            "", "Por favor, contacte con nosotros para renovarlos a la mayor brevedad.", "",
        ]
        if gestoria and gestoria.get("nombre_gestoria"):
            lineas.append(gestoria["nombre_gestoria"])
        if gestoria and gestoria.get("telefono"):
            lineas.append(f"Tel: {gestoria['telefono']}")
        if gestoria and gestoria.get("email"):
            lineas.append(f"Email: {gestoria['email']}")

        asunto = f"Documentos pendientes de renovacion - {solicitante}"
        ok, _ = enviar_email(smtp, email_cliente, asunto, "\n".join(lineas))
        if ok:
            enviados += 1
        else:
            fallidos += 1

    return enviados, fallidos, sin_email


def enviar_email(smtp, destino, asunto, cuerpo, adjuntos=None):
    """Envia un email con adjuntos opcionales.

    smtp: dict con host, port, user, password, remitente, tls.
    adjuntos: lista de tuplas (nombre, datos_bytes, mime) -> ('a/b').
    Devuelve (ok: bool, mensaje: str).
    """
    host = smtp.get("smtp_host", "").strip()
    if not host:
        return False, "Falta configurar el servidor SMTP en Ajustes."
    remitente = smtp.get("smtp_remitente") or smtp.get("smtp_user", "")
    if not destino:
        return False, "Falta el email de destino."

    msg = EmailMessage()
    msg["From"] = remitente
    msg["To"] = destino
    msg["Subject"] = asunto
    msg.set_content(cuerpo)

    for nombre, datos, mime in adjuntos or []:
        tipo, _, subtipo = mime.partition("/")
        msg.add_attachment(datos, maintype=tipo or "application",
                           subtype=subtipo or "octet-stream", filename=nombre)

    puerto = int(smtp.get("smtp_port", 587) or 587)
    usuario = smtp.get("smtp_user", "")
    clave = smtp.get("smtp_password", "")
    usar_tls = smtp.get("smtp_tls", True)
    try:
        if int(puerto) == 465:
            contexto = ssl.create_default_context()
            with smtplib.SMTP_SSL(host, puerto, context=contexto, timeout=30) as servidor:
                if usuario:
                    servidor.login(usuario, clave)
                servidor.send_message(msg)
        else:
            with smtplib.SMTP(host, puerto, timeout=30) as servidor:
                if usar_tls:
                    servidor.starttls(context=ssl.create_default_context())
                if usuario:
                    servidor.login(usuario, clave)
                servidor.send_message(msg)
        return True, "Email enviado correctamente."
    except Exception as exc:  # noqa: BLE001
        return False, f"No se pudo enviar el email: {exc}"
