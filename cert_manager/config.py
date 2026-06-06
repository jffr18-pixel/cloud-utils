import configparser
from pathlib import Path

_CONFIG_FILE = Path(__file__).parent.parent / 'config.ini'

_DEFAULTS = {
    'general': {
        'alert_days': '30',
        'check_time': '09:00',
        'download_folder': str(Path.home() / 'notificaciones_dehu'),
        'safe_mode': 'true',
        'log_folder': str(Path(__file__).parent.parent / 'logs'),
        'report_folder': str(Path(__file__).parent.parent / 'informes'),
    },
    'dehu': {
        'base_url': 'https://dehu.redsara.es',
        'cert_pfx_path': '',
        'cert_password': '',
        'timeout': '30',
        'url_buzon': '/es/ciudadano/buzon',
        'url_notificacion': '/es/ciudadano/notificacion/{id}',
    },
    'certificates': {
        'stores': 'MY,CA,ROOT',
        # Almacenes que muestra la interfaz gráfica. Por defecto solo MY
        # (certificados personales) para que el arranque sea instantáneo;
        # CA/ROOT tienen cientos de CAs del sistema y ralentizan el escaneo.
        'gui_stores': 'MY',
        'known_issuers': 'FNMT-RCM,AC DNIE,ACCV,CAMERFIRMA,IZENPE,ANF AC,CATCERT',
    },
    'gestor': {
        'name': '',
        'phone': '',
        'email': '',
        'address': '',
        'cif': '',
    },
    'email': {
        'host': 'smtp.gmail.com',
        'port': '587',
        'use_tls': 'true',
        'username': '',
        'password': '',
        'from_name': '',
        'from_email': '',
    },
    'whatsapp': {
        'provider': '',      # 'twilio' o 'callmebot'
        'account_sid': '',   # Twilio
        'auth_token': '',    # Twilio
        'from_number': '',   # Twilio: whatsapp:+14155238886
        'api_key': '',       # CallMeBot
        'phone': '',         # CallMeBot
    },
    'ai': {
        'anthropic_api_key': '',
        'model': 'claude-haiku-4-5-20251001',
    },
}


def load() -> configparser.ConfigParser:
    cfg = configparser.ConfigParser()
    for section, values in _DEFAULTS.items():
        cfg[section] = values
    if _CONFIG_FILE.exists():
        cfg.read(_CONFIG_FILE, encoding='utf-8')
    return cfg


def create_default() -> configparser.ConfigParser:
    cfg = configparser.ConfigParser()
    for section, values in _DEFAULTS.items():
        cfg[section] = values
    _CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(_CONFIG_FILE, 'w', encoding='utf-8') as f:
        cfg.write(f)
    return cfg
