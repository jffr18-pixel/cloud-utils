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
        'known_issuers': 'FNMT-RCM,AC DNIE,ACCV,CAMERFIRMA,IZENPE,ANF AC,CATCERT',
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
