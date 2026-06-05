"""
Gestión de varios certificados digitales para DEHU.

Permite guardar una lista de certificados (nombre, ruta .pfx/.p12, contraseña)
y elegir cuál está activo para consultar DEHU. Se almacena en un JSON en
~/.cert_manager/dehu_certs.json.

Compatibilidad: si todavía no hay ningún certificado guardado pero config.ini
tiene un cert_pfx_path, se migra automáticamente como primer certificado.
"""
import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

_CERTS_FILE = Path.home() / '.cert_manager' / 'dehu_certs.json'


def _empty() -> dict:
    return {'active': 0, 'certs': []}


def load() -> dict:
    """Returns {'active': int, 'certs': [{'name','path','password'}]}"""
    if _CERTS_FILE.exists():
        try:
            data = json.loads(_CERTS_FILE.read_text(encoding='utf-8'))
            data.setdefault('active', 0)
            data.setdefault('certs', [])
            return data
        except Exception as e:
            logger.warning('No se pudo leer dehu_certs.json: %s', e)
    return _empty()


def save(data: dict) -> None:
    _CERTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    _CERTS_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8'
    )


def migrate_from_config(cfg) -> dict:
    """If no certs stored yet but config.ini has one, import it. Returns data."""
    data = load()
    if data['certs']:
        return data
    try:
        path = cfg['dehu'].get('cert_pfx_path', '').strip().strip('"\'')
        pwd  = cfg['dehu'].get('cert_password', '').strip()
    except Exception:
        path, pwd = '', ''
    if path:
        data['certs'].append({
            'name': Path(path).stem or 'Certificado principal',
            'path': path,
            'password': pwd,
        })
        data['active'] = 0
        save(data)
        logger.info('Certificado migrado desde config.ini: %s', path)
    return data


def add(name: str, path: str, password: str = '') -> dict:
    data = load()
    path = path.strip().strip('"\'')
    name = name.strip() or Path(path).stem or 'Certificado'
    # Avoid exact duplicates by path
    for c in data['certs']:
        if c['path'] == path:
            c['name'] = name
            c['password'] = password
            save(data)
            return data
    data['certs'].append({'name': name, 'path': path, 'password': password})
    data['active'] = len(data['certs']) - 1  # newly added becomes active
    save(data)
    return data


def remove(index: int) -> dict:
    data = load()
    if 0 <= index < len(data['certs']):
        data['certs'].pop(index)
        if data['active'] >= len(data['certs']):
            data['active'] = max(0, len(data['certs']) - 1)
        save(data)
    return data


def set_active(index: int) -> dict:
    data = load()
    if 0 <= index < len(data['certs']):
        data['active'] = index
        save(data)
    return data


def get_active() -> dict | None:
    """Returns the active cert dict {'name','path','password'} or None."""
    data = load()
    if not data['certs']:
        return None
    idx = data['active']
    if not (0 <= idx < len(data['certs'])):
        idx = 0
    return data['certs'][idx]
