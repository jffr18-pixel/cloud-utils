"""
notifier_email.py — Envío de notificaciones por email a clientes de la gestoría.

Diseñado para ciudadanos con escasas habilidades digitales:
- Mensajes claros, sin jerga técnica
- HTML accesible: fuente grande, colores de alto contraste, mobile-friendly
- Versión texto plano alternativa incluida siempre

Solo depende de la stdlib: smtplib, email.mime, ssl.
"""

from __future__ import annotations

import logging
import smtplib
import ssl
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

from .config import load as _load_cfg

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Color corporativo de BurocraciaZero
# ---------------------------------------------------------------------------
_HEADER_COLOR = "#9373B2"


# ---------------------------------------------------------------------------
# Helpers de configuración
# ---------------------------------------------------------------------------

def _cfg():
    """Carga la configuración fresca en cada llamada (no cachear)."""
    return _load_cfg()


def _smtp_params() -> dict:
    """Devuelve los parámetros SMTP leídos de config.ini."""
    cfg = _cfg()
    gestor_name = cfg.get("gestor", "name", fallback="")
    return {
        "host": cfg.get("email", "host", fallback="smtp.gmail.com"),
        "port": cfg.getint("email", "port", fallback=587),
        "use_tls": cfg.getboolean("email", "use_tls", fallback=True),
        "username": cfg.get("email", "username", fallback=""),
        "password": cfg.get("email", "password", fallback=""),
        "from_name": cfg.get("email", "from_name", fallback="") or gestor_name or "Su gestoría",
        "from_email": cfg.get("email", "from_email", fallback=""),
    }


def _gestor_info() -> dict:
    """Devuelve los datos de la gestoría desde [gestor] y [email]."""
    cfg = _cfg()
    params = _smtp_params()
    return {
        "name": cfg.get("gestor", "name", fallback="Su gestoría") or "Su gestoría",
        "phone": cfg.get("gestor", "phone", fallback=""),
        "email": cfg.get("gestor", "email", fallback="") or params["from_email"],
        "address": cfg.get("gestor", "address", fallback=""),
        "cif": cfg.get("gestor", "cif", fallback=""),
    }


# ---------------------------------------------------------------------------
# API pública
# ---------------------------------------------------------------------------

def email_available() -> bool:
    """True si la configuración SMTP tiene usuario y contraseña."""
    p = _smtp_params()
    return bool(p["username"] and p["password"])


def send_notification(
    to_email: str,
    client_name: str,
    subject_line: str,
    easy_read_text: str,
    pdf_path: Path | None = None,
    gestor_name: str = "Su gestoría",
) -> tuple[bool, str]:
    """
    Envía email de aviso de notificación DEHU al cliente.

    Parámetros
    ----------
    to_email       : dirección del destinatario
    client_name    : nombre del cliente (para el saludo)
    subject_line   : resumen del asunto de la notificación
    easy_read_text : cuerpo principal en lenguaje claro (puede incluir \\n)
    pdf_path       : ruta opcional a un PDF que se adjunta al email
    gestor_name    : nombre mostrado en el pie de página

    Devuelve
    --------
    (True, "")  si el envío tuvo éxito
    (False, mensaje_de_error)  si falló
    """
    params = _smtp_params()
    gestor = _gestor_info()
    display_gestor = gestor_name if gestor_name != "Su gestoría" else gestor["name"] or "Su gestoría"

    subject = "Tiene una notificación de la Administración"

    html_body = _build_notification_html(
        client_name=client_name,
        subject_line=subject_line,
        easy_read_text=easy_read_text,
        gestor=gestor,
        display_gestor=display_gestor,
    )
    plain_body = _build_notification_plain(
        client_name=client_name,
        subject_line=subject_line,
        easy_read_text=easy_read_text,
        gestor=gestor,
        display_gestor=display_gestor,
    )

    msg = _build_message(
        from_name=params["from_name"],
        from_email=params["from_email"],
        to_email=to_email,
        subject=subject,
        html_body=html_body,
        plain_body=plain_body,
    )

    if pdf_path is not None:
        _attach_pdf(msg, pdf_path)

    return _send(msg, params)


def send_certificate_expiry_warning(
    to_email: str,
    client_name: str,
    cert_subject: str,
    days_left: int,
    gestor_name: str = "Su gestoría",
    gestor_phone: str = "",
) -> tuple[bool, str]:
    """
    Avisa al cliente de que su certificado digital caduca pronto.

    Parámetros
    ----------
    to_email     : dirección del destinatario
    client_name  : nombre del cliente
    cert_subject : descripción del certificado (p. ej. "Certificado FNMT de Ciudadano")
    days_left    : días que quedan para la caducidad
    gestor_name  : nombre de la gestoría
    gestor_phone : teléfono de contacto (opcional)
    """
    params = _smtp_params()
    gestor = _gestor_info()
    display_gestor = gestor_name if gestor_name != "Su gestoría" else gestor["name"] or "Su gestoría"
    phone = gestor_phone or gestor["phone"]

    if days_left <= 0:
        urgency = "ya ha caducado"
        urgency_plain = "Su certificado YA HA CADUCADO."
        days_msg = "No puede usarlo para trámites."
    elif days_left == 1:
        urgency = "caduca <strong>mañana</strong>"
        urgency_plain = "Su certificado caduca MAÑANA."
        days_msg = "Queda solo 1 día."
    else:
        urgency = f"caduca en <strong>{days_left} días</strong>"
        urgency_plain = f"Su certificado caduca en {days_left} días."
        days_msg = f"Quedan {days_left} días."

    subject = f"Su certificado digital caduca pronto — {display_gestor}"

    html_body = _build_expiry_html(
        client_name=client_name,
        cert_subject=cert_subject,
        urgency=urgency,
        days_msg=days_msg,
        gestor=gestor,
        display_gestor=display_gestor,
        phone=phone,
    )
    plain_body = _build_expiry_plain(
        client_name=client_name,
        cert_subject=cert_subject,
        urgency_plain=urgency_plain,
        days_msg=days_msg,
        gestor=gestor,
        display_gestor=display_gestor,
        phone=phone,
    )

    msg = _build_message(
        from_name=params["from_name"],
        from_email=params["from_email"],
        to_email=to_email,
        subject=subject,
        html_body=html_body,
        plain_body=plain_body,
    )

    return _send(msg, params)


def send_test_email(to_email: str) -> tuple[bool, str]:
    """
    Envía un email de prueba para comprobar que la configuración SMTP funciona.

    Devuelve (True, "") si llegó bien, o (False, mensaje_de_error).
    """
    params = _smtp_params()
    gestor = _gestor_info()

    subject = f"Prueba de configuración de email — {gestor['name'] or 'BurocraciaZero'}"

    html_body = f"""\
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:20px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0"
             style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1);">
        <tr>
          <td style="background:{_HEADER_COLOR};padding:28px 32px;">
            <p style="margin:0;color:#ffffff;font-size:22px;font-weight:bold;">
              {gestor['name'] or 'BurocraciaZero'}
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <p style="font-size:18px;color:#1a1a1a;line-height:1.6;">
              ✅ La configuración de email funciona correctamente.
            </p>
            <p style="font-size:16px;color:#333333;line-height:1.6;">
              Este es un mensaje de prueba enviado desde <strong>BurocraciaZero</strong>
              para confirmar que el sistema puede enviar notificaciones a sus clientes.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f8f8f8;padding:20px 32px;border-top:1px solid #e0e0e0;">
            <p style="margin:0;font-size:13px;color:#777777;">
              {gestor['name'] or 'Su gestoría'}
              {(' · ' + gestor['phone']) if gestor['phone'] else ''}
              {(' · ' + gestor['email']) if gestor['email'] else ''}
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""

    plain_body = (
        f"Prueba de configuración de email — {gestor['name'] or 'BurocraciaZero'}\n\n"
        "La configuración de email funciona correctamente.\n\n"
        "Este es un mensaje de prueba enviado desde BurocraciaZero para confirmar\n"
        "que el sistema puede enviar notificaciones a sus clientes.\n\n"
        f"-- {gestor['name'] or 'Su gestoría'}"
    )

    msg = _build_message(
        from_name=params["from_name"],
        from_email=params["from_email"],
        to_email=to_email,
        subject=subject,
        html_body=html_body,
        plain_body=plain_body,
    )

    return _send(msg, params)


# ---------------------------------------------------------------------------
# Construcción de mensajes MIME
# ---------------------------------------------------------------------------

def _build_message(
    from_name: str,
    from_email: str,
    to_email: str,
    subject: str,
    html_body: str,
    plain_body: str,
) -> MIMEMultipart:
    """Construye el mensaje MIME multipart/mixed listo para enviar."""
    msg = MIMEMultipart("mixed")
    msg["Subject"] = subject
    msg["From"] = f"{from_name} <{from_email}>" if from_name else from_email
    msg["To"] = to_email

    # Alternativa texto/html anidada en multipart/alternative
    alternative = MIMEMultipart("alternative")
    alternative.attach(MIMEText(plain_body, "plain", "utf-8"))
    alternative.attach(MIMEText(html_body, "html", "utf-8"))
    msg.attach(alternative)

    return msg


def _attach_pdf(msg: MIMEMultipart, pdf_path: Path) -> None:
    """Adjunta un PDF al mensaje. Ignora silenciosamente si no existe."""
    try:
        data = pdf_path.read_bytes()
        part = MIMEApplication(data, _subtype="pdf")
        part.add_header(
            "Content-Disposition",
            "attachment",
            filename=pdf_path.name,
        )
        msg.attach(part)
    except OSError as exc:
        logger.warning("No se pudo adjuntar el PDF %s: %s", pdf_path, exc)


# ---------------------------------------------------------------------------
# Envío SMTP
# ---------------------------------------------------------------------------

def _send(msg: MIMEMultipart, params: dict) -> tuple[bool, str]:
    """
    Envía el mensaje usando los parámetros SMTP indicados.

    Devuelve (True, "") o (False, descripción_del_error).
    """
    if not params["username"] or not params["password"]:
        return False, (
            "La configuración de email está incompleta. "
            "Revise el usuario y la contraseña en Ajustes."
        )
    if not params["from_email"]:
        return False, (
            "Falta la dirección de email remitente (from_email) en la configuración."
        )

    try:
        if params["use_tls"]:
            context = ssl.create_default_context()
            with smtplib.SMTP(params["host"], params["port"], timeout=15) as server:
                server.ehlo()
                server.starttls(context=context)
                server.ehlo()
                server.login(params["username"], params["password"])
                server.send_message(msg)
        else:
            with smtplib.SMTP(params["host"], params["port"], timeout=15) as server:
                server.login(params["username"], params["password"])
                server.send_message(msg)

        logger.info("Email enviado a %s — asunto: %s", msg["To"], msg["Subject"])
        return True, ""

    except smtplib.SMTPAuthenticationError:
        err = (
            "El usuario o la contraseña de email son incorrectos. "
            "Si usa Gmail, compruebe que tiene activada la autenticación de aplicaciones."
        )
        logger.error("SMTP auth error: %s", err)
        return False, err

    except smtplib.SMTPRecipientsRefused as exc:
        err = f"La dirección de destino fue rechazada por el servidor: {exc.recipients}"
        logger.error(err)
        return False, err

    except smtplib.SMTPException as exc:
        err = f"Error al enviar el email: {exc}"
        logger.error(err)
        return False, err

    except OSError as exc:
        err = (
            f"No se pudo conectar al servidor de email ({params['host']}:{params['port']}). "
            f"Compruebe la conexión a Internet y los datos del servidor. Detalle: {exc}"
        )
        logger.error(err)
        return False, err

    except Exception as exc:  # pragma: no cover — red de seguridad
        err = f"Error inesperado al enviar el email: {exc}"
        logger.exception(err)
        return False, err


# ---------------------------------------------------------------------------
# Plantillas HTML — notificación DEHU
# ---------------------------------------------------------------------------

def _build_notification_html(
    client_name: str,
    subject_line: str,
    easy_read_text: str,
    gestor: dict,
    display_gestor: str,
) -> str:
    """Genera el HTML del email de aviso de notificación DEHU."""

    # Convertir saltos de línea del easy_read_text en párrafos HTML
    paragraphs = "".join(
        f'<p style="margin:0 0 14px 0;font-size:16px;color:#1a1a1a;line-height:1.6;">{line}</p>'
        for line in easy_read_text.splitlines()
        if line.strip()
    )

    phone_button = ""
    if gestor["phone"]:
        phone_button = f"""\
        <p style="margin:24px 0 0 0;text-align:center;">
          <a href="tel:{gestor['phone']}"
             style="display:inline-block;background:{_HEADER_COLOR};color:#ffffff;
                    font-size:17px;font-weight:bold;padding:14px 28px;
                    border-radius:6px;text-decoration:none;">
            📞 Llame a su gestoría: {gestor['phone']}
          </a>
        </p>"""

    footer_parts = [display_gestor]
    if gestor["phone"]:
        footer_parts.append(f"Tel.: {gestor['phone']}")
    if gestor["email"]:
        footer_parts.append(gestor["email"])
    if gestor["address"]:
        footer_parts.append(gestor["address"])
    if gestor["cif"]:
        footer_parts.append(f"CIF: {gestor['cif']}")
    footer_contact = " &nbsp;·&nbsp; ".join(footer_parts)

    return f"""\
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Notificación de la Administración</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0"
         style="background:#f4f4f4;padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0"
             style="max-width:600px;width:100%;background:#ffffff;
                    border-radius:8px;overflow:hidden;
                    box-shadow:0 2px 8px rgba(0,0,0,.12);">

        <!-- CABECERA -->
        <tr>
          <td style="background:{_HEADER_COLOR};padding:28px 32px;">
            <p style="margin:0 0 4px 0;color:#ffffff;font-size:13px;
                      letter-spacing:1px;text-transform:uppercase;">
              Notificación oficial
            </p>
            <p style="margin:0;color:#ffffff;font-size:22px;font-weight:bold;">
              {display_gestor}
            </p>
          </td>
        </tr>

        <!-- CUERPO -->
        <tr>
          <td style="padding:32px 32px 24px 32px;">

            <!-- Saludo -->
            <p style="margin:0 0 20px 0;font-size:18px;color:#1a1a1a;
                      font-weight:bold;line-height:1.4;">
              Estimado/a {client_name}:
            </p>

            <!-- Recuadro de aviso -->
            <table width="100%" cellpadding="0" cellspacing="0"
                   style="background:#f0ebf8;border-left:5px solid {_HEADER_COLOR};
                          border-radius:4px;margin-bottom:24px;">
              <tr>
                <td style="padding:16px 18px;">
                  <p style="margin:0 0 4px 0;font-size:13px;color:#6a4a9c;
                            text-transform:uppercase;letter-spacing:.5px;font-weight:bold;">
                    Asunto
                  </p>
                  <p style="margin:0;font-size:17px;color:#1a1a1a;font-weight:bold;">
                    {subject_line}
                  </p>
                </td>
              </tr>
            </table>

            <!-- Texto de lectura fácil -->
            {paragraphs}

            <!-- Botón de llamada -->
            {phone_button}

          </td>
        </tr>

        <!-- PIE DE PÁGINA -->
        <tr>
          <td style="background:#f8f8f8;padding:20px 32px;
                     border-top:1px solid #e0e0e0;">
            <p style="margin:0 0 6px 0;font-size:13px;color:#555555;line-height:1.5;">
              {footer_contact}
            </p>
            <p style="margin:0;font-size:12px;color:#999999;line-height:1.4;">
              Sus datos son tratados conforme al RGPD. Si no desea recibir estos
              avisos, comuníqueselo a su gestoría.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>"""


def _build_notification_plain(
    client_name: str,
    subject_line: str,
    easy_read_text: str,
    gestor: dict,
    display_gestor: str,
) -> str:
    """Versión texto plano del email de notificación."""
    lines = [
        f"Estimado/a {client_name}:",
        "",
        "Ha recibido una notificación de la Administración:",
        f"  {subject_line}",
        "",
        easy_read_text,
        "",
    ]
    if gestor["phone"]:
        lines += [
            f"Llame a su gestoría: {gestor['phone']}",
            "",
        ]
    lines += [
        "-- ",
        display_gestor,
    ]
    if gestor["phone"]:
        lines.append(f"Tel.: {gestor['phone']}")
    if gestor["email"]:
        lines.append(gestor["email"])
    if gestor["address"]:
        lines.append(gestor["address"])
    lines += [
        "",
        "Sus datos son tratados conforme al RGPD.",
    ]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Plantillas HTML — caducidad de certificado
# ---------------------------------------------------------------------------

def _build_expiry_html(
    client_name: str,
    cert_subject: str,
    urgency: str,
    days_msg: str,
    gestor: dict,
    display_gestor: str,
    phone: str,
) -> str:
    """Genera el HTML del email de aviso de caducidad de certificado."""

    phone_button = ""
    if phone:
        phone_button = f"""\
        <p style="margin:24px 0 0 0;text-align:center;">
          <a href="tel:{phone}"
             style="display:inline-block;background:{_HEADER_COLOR};color:#ffffff;
                    font-size:17px;font-weight:bold;padding:14px 28px;
                    border-radius:6px;text-decoration:none;">
            📞 Llame ahora: {phone}
          </a>
        </p>"""

    footer_parts = [display_gestor]
    if phone:
        footer_parts.append(f"Tel.: {phone}")
    if gestor["email"]:
        footer_parts.append(gestor["email"])
    if gestor["address"]:
        footer_parts.append(gestor["address"])
    if gestor["cif"]:
        footer_parts.append(f"CIF: {gestor['cif']}")
    footer_contact = " &nbsp;·&nbsp; ".join(footer_parts)

    return f"""\
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Su certificado digital caduca pronto</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0"
         style="background:#f4f4f4;padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0"
             style="max-width:600px;width:100%;background:#ffffff;
                    border-radius:8px;overflow:hidden;
                    box-shadow:0 2px 8px rgba(0,0,0,.12);">

        <!-- CABECERA -->
        <tr>
          <td style="background:{_HEADER_COLOR};padding:28px 32px;">
            <p style="margin:0 0 4px 0;color:#ffffff;font-size:13px;
                      letter-spacing:1px;text-transform:uppercase;">
              Aviso importante
            </p>
            <p style="margin:0;color:#ffffff;font-size:22px;font-weight:bold;">
              {display_gestor}
            </p>
          </td>
        </tr>

        <!-- CUERPO -->
        <tr>
          <td style="padding:32px 32px 24px 32px;">

            <!-- Saludo -->
            <p style="margin:0 0 20px 0;font-size:18px;color:#1a1a1a;
                      font-weight:bold;line-height:1.4;">
              Estimado/a {client_name}:
            </p>

            <!-- Icono de alerta -->
            <p style="font-size:48px;text-align:center;margin:0 0 16px 0;">⏰</p>

            <!-- Mensaje principal -->
            <p style="margin:0 0 16px 0;font-size:18px;color:#1a1a1a;
                      line-height:1.6;text-align:center;">
              Su certificado digital <strong>{cert_subject}</strong><br>
              {urgency}.
            </p>

            <!-- Recuadro explicativo -->
            <table width="100%" cellpadding="0" cellspacing="0"
                   style="background:#fff8e1;border-left:5px solid #f5a623;
                          border-radius:4px;margin-bottom:20px;">
              <tr>
                <td style="padding:16px 18px;">
                  <p style="margin:0 0 8px 0;font-size:16px;color:#1a1a1a;
                            line-height:1.6;">
                    📋 <strong>¿Qué es esto?</strong><br>
                    Su certificado digital le permite hacer trámites con la
                    Administración desde casa (Hacienda, Seguridad Social, etc.).
                    Cuando caduca, deja de funcionar.
                  </p>
                  <p style="margin:0;font-size:16px;color:#1a1a1a;line-height:1.6;">
                    ✅ <strong>¿Qué tiene que hacer?</strong><br>
                    Llame a su gestoría para que le ayudemos a renovarlo antes
                    de que caduque. Es un trámite sencillo.
                  </p>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 0 0;font-size:16px;color:#666666;
                      text-align:center;line-height:1.4;">
              {days_msg} No espere al último momento.
            </p>

            <!-- Botón de llamada -->
            {phone_button}

          </td>
        </tr>

        <!-- PIE DE PÁGINA -->
        <tr>
          <td style="background:#f8f8f8;padding:20px 32px;
                     border-top:1px solid #e0e0e0;">
            <p style="margin:0 0 6px 0;font-size:13px;color:#555555;line-height:1.5;">
              {footer_contact}
            </p>
            <p style="margin:0;font-size:12px;color:#999999;line-height:1.4;">
              Sus datos son tratados conforme al RGPD. Si no desea recibir estos
              avisos, comuníqueselo a su gestoría.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>"""


def _build_expiry_plain(
    client_name: str,
    cert_subject: str,
    urgency_plain: str,
    days_msg: str,
    gestor: dict,
    display_gestor: str,
    phone: str,
) -> str:
    """Versión texto plano del email de caducidad de certificado."""
    lines = [
        f"Estimado/a {client_name}:",
        "",
        "AVISO IMPORTANTE — Su certificado digital caduca pronto",
        "=" * 52,
        "",
        f"Certificado: {cert_subject}",
        urgency_plain,
        days_msg,
        "",
        "¿Qué es esto?",
        "Su certificado digital le permite hacer trámites con la Administración",
        "desde casa (Hacienda, Seguridad Social, etc.). Cuando caduca, deja de",
        "funcionar.",
        "",
        "¿Qué tiene que hacer?",
        "Llame a su gestoría para que le ayudemos a renovarlo antes de que",
        "caduque. Es un trámite sencillo. No espere al último momento.",
        "",
    ]
    if phone:
        lines += [
            f"Llame ahora: {phone}",
            "",
        ]
    lines += [
        "-- ",
        display_gestor,
    ]
    if phone:
        lines.append(f"Tel.: {phone}")
    if gestor["email"]:
        lines.append(gestor["email"])
    if gestor["address"]:
        lines.append(gestor["address"])
    lines += [
        "",
        "Sus datos son tratados conforme al RGPD.",
    ]
    return "\n".join(lines)
