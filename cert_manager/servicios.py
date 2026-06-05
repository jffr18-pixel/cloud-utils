"""
Servicios gubernamentales con certificado digital.

Realidad técnica: TGSS Importass y AEAT usan autenticación JavaScript/CL@VE
que requiere navegador real. No existe API pública para descarga directa.

Flujo implementado:
  1. Abrir portal correcto en el navegador (el usuario se autentica con su cert)
  2. El usuario descarga el PDF manualmente
  3. La app organiza el PDF en la carpeta de destino y lleva un registro
"""
import json
import logging
import shutil
import webbrowser
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

# Ruta del registro de descargas manuales
_HISTORY_FILE = Path.home() / '.cert_manager' / 'servicios_history.json'

SERVICES = [
    {
        'id': 'vida_laboral',
        'name': 'Informe de Vida Laboral',
        'organismo': 'Tesorería General SS (TGSS)',
        'icon': '👷',
        'description': (
            'Historial completo de periodos cotizados, empresas, '
            'situaciones de alta/baja y total de días cotizados.'
        ),
        # URL directa al servicio dentro de Importass (requiere login con cert)
        'url_browser': (
            'https://portal.seg-social.gob.es/wps/portal/importass/importass/'
            'Categorias/Vida+laboral+e+informes/Informes+sobre+tu+situacion+laboral/'
            'Informe+de+tu+vida+laboral'
        ),
        'filename_prefix': 'vida_laboral',
    },
    {
        'id': 'corriente_hacienda',
        'name': 'Certificado al corriente — AEAT',
        'organismo': 'Agencia Tributaria (AEAT)',
        'icon': '🏛',
        'description': (
            'Certificado de estar al corriente de las obligaciones tributarias '
            'ante la Agencia Tributaria (necesario para contratos con la Administración).'
        ),
        # Procedimiento G304 — certificado tributario de estar al corriente
        'url_browser': (
            'https://sede.agenciatributaria.gob.es/Sede/procedimientoini/G304.shtml'
        ),
        'filename_prefix': 'certificado_aeat_corriente',
    },
    {
        'id': 'bases_cotizacion',
        'name': 'Informe de Bases de Cotización',
        'organismo': 'Seguridad Social (TGSS)',
        'icon': '📊',
        'description': (
            'Bases de cotización por periodos y contingencias '
            '(jubilación, desempleo, enfermedad, etc.).'
        ),
        'url_browser': (
            'https://portal.seg-social.gob.es/wps/portal/importass/importass/'
            'Categorias/Vida+laboral+e+informes/Informes+de+tus+cotizaciones/'
            'Informe+de+bases+de+cotizacion'
        ),
        'filename_prefix': 'bases_cotizacion',
    },
]


# ── Historial ─────────────────────────────────────────────────────────────────

def load_history() -> dict:
    """Returns {service_id: [{'date': ..., 'path': ...}, ...]}"""
    if _HISTORY_FILE.exists():
        try:
            return json.loads(_HISTORY_FILE.read_text(encoding='utf-8'))
        except Exception:
            pass
    return {}


def _save_history(history: dict) -> None:
    _HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)
    _HISTORY_FILE.write_text(
        json.dumps(history, ensure_ascii=False, indent=2), encoding='utf-8'
    )


# ── Acciones ──────────────────────────────────────────────────────────────────

def open_in_browser(service: dict) -> None:
    """Opens the service portal in the default browser."""
    webbrowser.open(service['url_browser'])


def organize_pdf(service: dict, source_path: Path, dest_folder: Path) -> dict:
    """
    Copies a manually-downloaded PDF into dest_folder with a proper name
    and records the download in the history.

    Returns {'ok': True, 'path': Path} or {'ok': False, 'error': str}.
    """
    try:
        dest_folder.mkdir(parents=True, exist_ok=True)
        date_str = datetime.now().strftime('%Y%m%d')
        dest = dest_folder / f"{service['filename_prefix']}_{date_str}.pdf"

        # Avoid overwriting an existing file
        counter = 1
        while dest.exists():
            dest = dest_folder / f"{service['filename_prefix']}_{date_str}_{counter}.pdf"
            counter += 1

        shutil.copy2(source_path, dest)
        logger.info('PDF organizado: %s → %s', source_path, dest)

        # Update history
        history = load_history()
        history.setdefault(service['id'], []).insert(0, {
            'date': datetime.now().strftime('%d/%m/%Y %H:%M'),
            'path': str(dest),
        })
        # Keep last 10 entries per service
        history[service['id']] = history[service['id']][:10]
        _save_history(history)

        return {'ok': True, 'path': dest}
    except Exception as exc:
        return {'ok': False, 'error': str(exc)}
