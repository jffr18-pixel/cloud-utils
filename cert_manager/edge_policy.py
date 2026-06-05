"""
Selección automática de certificado en Edge (y Chrome) para portales del Estado.

Escribe la política `AutoSelectCertificateForUrls` en el registro de Windows
(HKEY_CURRENT_USER, no requiere administrador) para que el navegador no muestre
el cuadro de selección de certificado en los portales de la Seguridad Social,
Hacienda y CL@VE. Así Selenium puede completar la descarga sin intervención.

Es totalmente reversible: `disable()` elimina exactamente las entradas creadas
por la app, sin tocar otras políticas que pudiera haber.

Referencia: https://learn.microsoft.com/deployedge/microsoft-edge-browser-policies/autoselectcertificateforurls
"""
import json
import logging
import sys

logger = logging.getLogger(__name__)

# Dominios de los portales donde queremos auto-seleccionar el certificado.
# Incluye CL@VE porque la autenticación redirige a través de él.
GOV_PATTERNS = [
    'https://[*.]seg-social.gob.es',
    'https://[*.]seg-social.es',
    'https://[*.]agenciatributaria.gob.es',
    'https://[*.]agenciatributaria.es',
    'https://[*.]clave.gob.es',
    'https://[*.]redsara.es',
]

# Ruta de la política en el registro (relativa a HKCU)
_EDGE_KEY   = r'SOFTWARE\Policies\Microsoft\Edge\AutoSelectCertificateForUrls'
_CHROME_KEY = r'SOFTWARE\Policies\Google\Chrome\AutoSelectCertificateForUrls'


def build_entry(pattern: str, subject_cn: str = '', issuer_cn: str = '') -> str:
    """Construye el JSON de una entrada de política (string)."""
    flt = {}
    if subject_cn:
        flt.setdefault('SUBJECT', {})['CN'] = subject_cn
    if issuer_cn:
        flt.setdefault('ISSUER', {})['CN'] = issuer_cn
    return json.dumps({'pattern': pattern, 'filter': flt}, ensure_ascii=False)


def is_supported() -> bool:
    return sys.platform == 'win32'


def _iter_keys():
    """Devuelve [(hive_root, subkey)] de los navegadores a configurar."""
    import winreg
    return [
        (winreg.HKEY_CURRENT_USER, _EDGE_KEY),
        (winreg.HKEY_CURRENT_USER, _CHROME_KEY),
    ]


def _read_entries(winreg, root, subkey) -> dict:
    """Lee todas las entradas {nombre: valor_str} de la clave (si existe)."""
    out = {}
    try:
        key = winreg.OpenKey(root, subkey, 0, winreg.KEY_READ)
    except FileNotFoundError:
        return out
    try:
        i = 0
        while True:
            try:
                name, value, _ = winreg.EnumValue(key, i)
                out[name] = value
                i += 1
            except OSError:
                break
    finally:
        winreg.CloseKey(key)
    return out


def is_enabled() -> bool:
    """True si existe al menos una entrada nuestra (patrón de GOV_PATTERNS)."""
    if not is_supported():
        return False
    import winreg
    gov = set(GOV_PATTERNS)
    for root, subkey in _iter_keys():
        entries = _read_entries(winreg, root, subkey)
        for value in entries.values():
            try:
                if json.loads(value).get('pattern') in gov:
                    return True
            except Exception:
                continue
    return False


def enable(subject_cn: str = '', issuer_cn: str = '') -> dict:
    """
    Escribe las entradas de auto-selección para todos los GOV_PATTERNS.

    subject_cn / issuer_cn: si se indican, solo se auto-selecciona el
    certificado cuyo titular/emisor coincida (recomendado para no afectar a
    otros certificados). Si se dejan vacíos, el navegador elige sin restricción
    adicional (válido si solo tienes un certificado personal).

    Devuelve {'ok': bool, 'browsers': [...], 'error': str?}.
    """
    if not is_supported():
        return {'ok': False, 'error': 'Solo disponible en Windows.'}
    import winreg

    # Primero limpia entradas previas nuestras para no duplicar
    disable()

    configured = []
    for root, subkey in _iter_keys():
        try:
            key = winreg.CreateKeyEx(root, subkey, 0, winreg.KEY_ALL_ACCESS)
        except Exception as e:
            logger.warning('No se pudo abrir %s: %s', subkey, e)
            continue
        try:
            existing = _read_entries(winreg, root, subkey)
            used = {int(n) for n in existing if str(n).isdigit()}
            nxt = (max(used) + 1) if used else 1
            for pattern in GOV_PATTERNS:
                entry = build_entry(pattern, subject_cn, issuer_cn)
                winreg.SetValueEx(key, str(nxt), 0, winreg.REG_SZ, entry)
                nxt += 1
            configured.append('Edge' if 'Edge' in subkey else 'Chrome')
        except Exception as e:
            logger.warning('Error escribiendo política en %s: %s', subkey, e)
        finally:
            winreg.CloseKey(key)

    if configured:
        return {'ok': True, 'browsers': configured}
    return {'ok': False, 'error': 'No se pudo escribir la política en el registro.'}


def disable() -> dict:
    """Elimina exactamente las entradas creadas por la app (por patrón)."""
    if not is_supported():
        return {'ok': False, 'error': 'Solo disponible en Windows.'}
    import winreg

    gov = set(GOV_PATTERNS)
    removed = 0
    for root, subkey in _iter_keys():
        try:
            key = winreg.OpenKey(root, subkey, 0, winreg.KEY_ALL_ACCESS)
        except FileNotFoundError:
            continue
        except Exception:
            continue
        try:
            entries = _read_entries(winreg, root, subkey)
            for name, value in entries.items():
                try:
                    if json.loads(value).get('pattern') in gov:
                        winreg.DeleteValue(key, name)
                        removed += 1
                except Exception:
                    continue
        finally:
            winreg.CloseKey(key)
    return {'ok': True, 'removed': removed}
