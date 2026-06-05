import sys
import subprocess
import logging
import warnings
from datetime import timezone
from typing import List, Dict, Any

from cryptography import x509
from cryptography.hazmat.backends import default_backend
from cryptography.x509.oid import NameOID
from cryptography.utils import CryptographyDeprecationWarning

logger = logging.getLogger(__name__)


def scan(stores: List[str] = None) -> List[Dict[str, Any]]:
    if stores is None:
        stores = ['MY', 'CA', 'ROOT']

    if sys.platform != 'win32':
        logger.warning("El escaneo del almacén de certificados solo está disponible en Windows.")
        return []

    try:
        import wincertstore
        return _from_wincertstore(stores)
    except ImportError:
        logger.info("wincertstore no disponible, usando certutil.")
        return _from_certutil(stores)


def _from_wincertstore(stores: List[str]) -> List[Dict[str, Any]]:
    import wincertstore
    from cryptography.x509 import load_der_x509_certificate

    results = []
    for store_name in stores:
        try:
            with wincertstore.CertSystemStore(store_name) as store:
                for cert_ctx in store.itercerts(usage=None):
                    try:
                        der = cert_ctx.get_encoded()
                        with warnings.catch_warnings():
                            warnings.filterwarnings('ignore', category=CryptographyDeprecationWarning)
                            cert = load_der_x509_certificate(der, default_backend())
                        results.append(_to_dict(cert, store_name))
                    except Exception as e:
                        logger.debug(f"Error leyendo certificado en {store_name}: {e}")
        except Exception as e:
            logger.warning(f"No se pudo abrir almacén {store_name}: {e}")
    return results


def _from_certutil(stores: List[str]) -> List[Dict[str, Any]]:
    results = []
    for store_name in stores:
        try:
            output = subprocess.check_output(
                ['certutil', '-store', store_name],
                stderr=subprocess.DEVNULL,
                text=True,
                encoding='cp1252',
                errors='replace',
            )
            results.extend(_parse_certutil_output(output, store_name))
        except (subprocess.CalledProcessError, FileNotFoundError) as e:
            logger.warning(f"certutil falló en almacén {store_name}: {e}")
    return results


def _parse_certutil_output(output: str, store_name: str) -> List[Dict[str, Any]]:
    certs = []
    current: Dict[str, Any] = {}
    for line in output.splitlines():
        line = line.strip()
        if '===============' in line:
            if current.get('subject'):
                current.setdefault('store', store_name)
                current.setdefault('source', 'certutil')
                certs.append(current)
            current = {}
        elif 'Sujeto:' in line or 'Subject:' in line:
            current['subject'] = line.split(':', 1)[-1].strip()
        elif 'Emisor:' in line or 'Issuer:' in line:
            current['issuer'] = line.split(':', 1)[-1].strip()
        elif 'NotAfter:' in line or 'No después de:' in line:
            current['not_after'] = line.split(':', 1)[-1].strip()
        elif 'NotBefore:' in line or 'No antes de:' in line:
            current['not_before'] = line.split(':', 1)[-1].strip()
        elif 'Número de serie' in line or 'Serial Number' in line:
            current['serial'] = line.split(':', 1)[-1].strip()
    if current.get('subject'):
        current.setdefault('store', store_name)
        certs.append(current)
    return certs


def is_admin() -> bool:
    """True si el proceso tiene privilegios de administrador (Windows)."""
    if sys.platform != 'win32':
        return False
    try:
        import ctypes
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def delete_by_thumbprint(store_name: str, thumbprint: str) -> bool:
    """Borra un certificado del almacén por huella. Requiere administrador para MY.

    Usa el almacén de usuario (-user) que no requiere elevación; si falla,
    reintenta en el almacén de máquina (que sí requiere administrador).
    """
    ok, _ = delete_by_thumbprint_ex(store_name, thumbprint)
    return ok


def delete_by_thumbprint_ex(store_name: str, thumbprint: str) -> tuple:
    """Como delete_by_thumbprint pero devuelve (ok: bool, mensaje_error: str)."""
    if sys.platform != 'win32':
        return False, "La eliminación solo está disponible en Windows."

    # certutil espera la huella en mayúsculas y sin espacios
    clean = thumbprint.replace(' ', '').replace(':', '').upper()
    if not clean:
        return False, "El certificado no tiene huella digital."

    # Primero el almacén del usuario (-user): no necesita administrador.
    # Si no está ahí, el almacén de máquina (necesita administrador).
    attempts = [
        ['certutil', '-user', '-delstore', store_name, clean],
        ['certutil', '-delstore', store_name, clean],
    ]
    last_err = ''
    for cmd in attempts:
        try:
            result = subprocess.run(cmd, capture_output=True, text=True,
                                    encoding='cp1252', errors='replace')
            if result.returncode == 0:
                logger.info("Certificado %s eliminado de %s.", clean, store_name)
                return True, ''
            last_err = (result.stderr or result.stdout or '').strip()
        except FileNotFoundError:
            return False, "certutil no encontrado en el sistema."
        except Exception as e:
            last_err = str(e)

    # Mensaje claro según la causa más probable
    low = last_err.lower()
    if 'denied' in low or 'denegado' in low or 'access' in low or '0x80070005' in low:
        if not is_admin():
            return False, ("Permiso denegado. Abre la app como administrador "
                           "(acepta el aviso de Windows al iniciarla).")
        return False, "Permiso denegado por Windows: " + last_err
    if 'not found' in low or 'no se encontr' in low or '0x80092004' in low:
        return False, ("No se encontró el certificado en el almacén. "
                       "Quizá ya se eliminó o está en otro almacén.")
    return False, (last_err or "certutil no pudo eliminar el certificado.")


def _to_dict(cert: x509.Certificate, store_name: str) -> Dict[str, Any]:
    def get_attr(name_obj, oid):
        try:
            return name_obj.get_attributes_for_oid(oid)[0].value
        except (IndexError, Exception):
            return ''

    try:
        not_after = cert.not_valid_after_utc
    except AttributeError:
        not_after = cert.not_valid_after.replace(tzinfo=timezone.utc)

    try:
        not_before = cert.not_valid_before_utc
    except AttributeError:
        not_before = cert.not_valid_before.replace(tzinfo=timezone.utc)

    # La "huella digital" de Windows es SIEMPRE SHA-1: es la que usa
    # certutil -delstore para identificar el certificado. Usar el algoritmo
    # de firma (SHA-256) daría una huella que certutil no reconoce.
    from cryptography.hazmat.primitives import hashes
    try:
        thumbprint = cert.fingerprint(hashes.SHA1()).hex()
    except Exception:
        thumbprint = ''

    with warnings.catch_warnings():
        warnings.filterwarnings('ignore', category=CryptographyDeprecationWarning)
        try:
            serial = hex(cert.serial_number)
        except Exception:
            serial = 'N/A'

    return {
        'store': store_name,
        'source': 'wincertstore',
        'subject': get_attr(cert.subject, NameOID.COMMON_NAME) or cert.subject.rfc4514_string(),
        'subject_org': get_attr(cert.subject, NameOID.ORGANIZATION_NAME),
        'issuer': get_attr(cert.issuer, NameOID.ORGANIZATION_NAME) or cert.issuer.rfc4514_string(),
        'issuer_cn': get_attr(cert.issuer, NameOID.COMMON_NAME),
        'serial': serial,
        'not_before': not_before.isoformat(),
        'not_after': not_after.isoformat(),
        'not_after_dt': not_after,
        'thumbprint': thumbprint,
    }
