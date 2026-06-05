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

    algo = cert.signature_hash_algorithm
    thumbprint = cert.fingerprint(algo).hex() if algo else ''

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
