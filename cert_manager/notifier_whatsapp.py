"""
Notificaciones por WhatsApp a clientes.

Soporta dos proveedores configurables en config.ini [whatsapp]:
  provider = twilio     → Twilio WhatsApp API (recomendado para producción)
  provider = callmebot  → CallMeBot (gratuito, para pruebas)
"""
import logging
import urllib.parse
import urllib.request
import urllib.error
import json as _json

logger = logging.getLogger(__name__)


def whatsapp_available() -> bool:
    """True si hay configuración de WhatsApp válida."""
    from cert_manager.config import load
    cfg = load()
    provider = cfg.get('whatsapp', 'provider', fallback='').strip().lower()
    if provider == 'twilio':
        return bool(
            cfg.get('whatsapp', 'account_sid', fallback='').strip()
            and cfg.get('whatsapp', 'auth_token', fallback='').strip()
            and cfg.get('whatsapp', 'from_number', fallback='').strip()
        )
    if provider == 'callmebot':
        return bool(
            cfg.get('whatsapp', 'api_key', fallback='').strip()
            and cfg.get('whatsapp', 'phone', fallback='').strip()
        )
    return False


def send_whatsapp(to_number: str, message: str) -> tuple[bool, str]:
    """
    Envía un mensaje WhatsApp al número indicado.

    to_number: formato internacional +34XXXXXXXXX
    Devuelve (ok, error_msg).
    """
    from cert_manager.config import load
    cfg = load()
    provider = cfg.get('whatsapp', 'provider', fallback='').strip().lower()

    if provider == 'twilio':
        return _send_twilio(cfg, to_number, message)
    if provider == 'callmebot':
        return _send_callmebot(cfg, to_number, message)
    return False, 'Proveedor de WhatsApp no configurado. Edita config.ini [whatsapp].'


def send_notification_whatsapp(
    to_number: str,
    client_name: str,
    easy_read_dict: dict,
    gestor_name: str = "",
    gestor_phone: str = "",
) -> tuple[bool, str]:
    """Envía notificación formateada al cliente."""
    from cert_manager.easy_read import format_for_whatsapp
    text = format_for_whatsapp(easy_read_dict, gestor_name)
    if not text:
        text = 'Tiene una nueva notificación de la Administración. Contacte con su gestoría.'

    greeting = f'Hola {client_name.split()[0]},\n\n' if client_name else ''
    footer = f'\n\n📞 {gestor_phone}' if gestor_phone else ''
    message = greeting + text + footer

    return send_whatsapp(to_number, message)


# ── Implementaciones por proveedor ──────────────────────────────────────────

def _send_twilio(cfg, to_number: str, message: str) -> tuple[bool, str]:
    """Llama a la API REST de Twilio sin el SDK (solo urllib)."""
    account_sid = cfg.get('whatsapp', 'account_sid', fallback='').strip()
    auth_token = cfg.get('whatsapp', 'auth_token', fallback='').strip()
    from_number = cfg.get('whatsapp', 'from_number', fallback='').strip()

    if not from_number.startswith('whatsapp:'):
        from_number = f'whatsapp:{from_number}'
    to_wa = to_number if to_number.startswith('whatsapp:') else f'whatsapp:{to_number}'

    url = f'https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json'
    data = urllib.parse.urlencode({
        'From': from_number,
        'To': to_wa,
        'Body': message,
    }).encode()

    import base64
    credentials = base64.b64encode(f'{account_sid}:{auth_token}'.encode()).decode()
    req = urllib.request.Request(url, data=data, method='POST')
    req.add_header('Authorization', f'Basic {credentials}')
    req.add_header('Content-Type', 'application/x-www-form-urlencoded')

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = _json.loads(resp.read())
            sid = body.get('sid', '')
            logger.info('WhatsApp Twilio enviado: %s → %s', sid, to_number)
            return True, ''
    except urllib.error.HTTPError as e:
        err = e.read().decode(errors='replace')
        logger.error('Twilio error %s: %s', e.code, err)
        try:
            detail = _json.loads(err).get('message', err)
        except Exception:
            detail = err
        return False, f'Error Twilio ({e.code}): {detail}'
    except Exception as e:
        return False, str(e)


def _send_callmebot(cfg, to_number: str, message: str) -> tuple[bool, str]:
    """Envía via CallMeBot (gratuito, para pruebas)."""
    api_key = cfg.get('whatsapp', 'api_key', fallback='').strip()
    # CallMeBot usa el número configurado en la cuenta, no el destino dinámico
    phone = cfg.get('whatsapp', 'phone', fallback='').strip()
    if not phone:
        phone = to_number.lstrip('+').replace(' ', '')

    encoded = urllib.parse.quote(message)
    url = f'https://api.callmebot.com/whatsapp.php?phone={phone}&text={encoded}&apikey={api_key}'

    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'BurocraciaZero/1.0'})
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = resp.read().decode(errors='replace')
            if 'Message queued' in body or resp.status == 200:
                logger.info('WhatsApp CallMeBot enviado a %s', phone)
                return True, ''
            return False, f'CallMeBot: {body[:200]}'
    except Exception as e:
        return False, str(e)
