"""
Servicios gubernamentales: descarga automática + apertura en navegador.

Modo «Automático + navegador»: intenta un GET autenticado con el certificado
PKCS12 del usuario; si la respuesta no es un PDF, ofrece abrir el portal
en el navegador para que el usuario descargue manualmente.
"""
import logging
import webbrowser
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

SERVICES = [
    {
        'id': 'vida_laboral',
        'name': 'Informe de Vida Laboral',
        'organismo': 'Tesorería General SS (TGSS)',
        'icon': '👷',
        'description': (
            'Historial completo de periodos cotizados, empresas, '
            'situaciones de alta/baja y días acumulados.'
        ),
        # Portal Importass — autenticación con certificado en el navegador
        'url_browser': 'https://importass.seg-social.es/',
        'url_auto': 'https://importass.seg-social.es/importass-sede/jsp/SS/PortalSS/inicio.html',
        'filename': 'vida_laboral',
    },
    {
        'id': 'corriente_hacienda',
        'name': 'Certificado al corriente (AEAT)',
        'organismo': 'Agencia Tributaria (AEAT)',
        'icon': '🏛',
        'description': (
            'Certificado que acredita el cumplimiento de tus obligaciones '
            'tributarias ante la Agencia Tributaria.'
        ),
        # Sede electrónica AEAT — procedimiento G322
        'url_browser': 'https://sede.agenciatributaria.gob.es/Sede/procedimientoinicio/G322.shtml',
        'url_auto': 'https://www.agenciatributaria.es/wlpl/PRET-R080/R080CONTServlet',
        'filename': 'certificado_aeat',
    },
    {
        'id': 'bases_cotizacion',
        'name': 'Bases de Cotización SS',
        'organismo': 'Seguridad Social (TGSS)',
        'icon': '📊',
        'description': (
            'Informe detallado de las bases de cotización por periodos '
            'y contingencias (jubilación, desempleo, etc.).'
        ),
        # Portal Importass — misma autenticación, servicio distinto
        'url_browser': 'https://importass.seg-social.es/',
        'url_auto': 'https://importass.seg-social.es/importass-sede/jsp/SS/PortalSS/inicio.html',
        'filename': 'bases_cotizacion',
    },
]


def open_in_browser(service: dict) -> None:
    """Opens the service portal in the default system browser."""
    webbrowser.open(service['url_browser'])


def try_download(service: dict, cert_pfx_path: str, cert_password: str,
                 dest_folder: Path) -> dict:
    """
    Attempts an authenticated PDF download using the PKCS12 certificate.

    Returns {'ok': True, 'path': Path} on success, or
            {'ok': False, 'error': str} when the portal requires
            interactive navigation (use open_in_browser as fallback).
    """
    import requests

    dest_folder.mkdir(parents=True, exist_ok=True)
    date_str = datetime.now().strftime('%Y%m%d_%H%M')
    dest = dest_folder / f"{service['filename']}_{date_str}.pdf"

    session = requests.Session()
    session.headers['User-Agent'] = (
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
        'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    )
    try:
        try:
            from requests_pkcs12 import Pkcs12Adapter
            pw = cert_password.encode() if cert_password else None
            session.mount(
                'https://',
                Pkcs12Adapter(pkcs12_filename=cert_pfx_path, pkcs12_password=pw),
            )
        except ImportError:
            logger.warning('requests_pkcs12 no disponible; la autenticación podría fallar.')

        resp = session.get(service['url_auto'], timeout=25, verify=True, allow_redirects=True)
        ct = resp.headers.get('content-type', '').lower()

        if resp.status_code == 200 and 'pdf' in ct:
            dest.write_bytes(resp.content)
            logger.info('Descargado: %s', dest)
            return {'ok': True, 'path': dest}

        return {
            'ok': False,
            'error': (
                f'El portal respondió con HTTP {resp.status_code}. '
                'Este servicio requiere navegación interactiva. '
                'Usa "Abrir en navegador" para acceder con tu certificado.'
            ),
        }
    except Exception as exc:
        return {'ok': False, 'error': str(exc)}
    finally:
        session.close()
