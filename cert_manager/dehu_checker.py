import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from bs4 import BeautifulSoup

from .dehu_session import DEHUSession

logger = logging.getLogger(__name__)

# These paths match the DEHU public portal structure.
# Verify against https://dehu.redsara.es if the portal is updated.
_BUZON_PATH = '/es/ciudadano/buzon'
_STATE_FILENAME = 'dehu_state.json'


def check(session: DEHUSession, log_folder: Path = Path('logs')) -> Dict[str, Any]:
    """Return total notifications, list of new ones, and full list."""
    log_folder.mkdir(parents=True, exist_ok=True)
    state_file = log_folder / _STATE_FILENAME

    try:
        resp = session.get(_BUZON_PATH)
        resp.raise_for_status()
    except Exception as e:
        logger.error("Error conectando con DEHU: %s", e)
        return {'error': str(e), 'total': 0, 'new': [], 'all': [], 'checked_at': _now()}

    # Guardar HTML para diagnóstico
    try:
        debug_path = log_folder / 'dehu_last_response.html'
        debug_path.write_text(resp.text, encoding='utf-8', errors='replace')
        logger.debug("HTML de DEHU guardado en %s (%d bytes)", debug_path, len(resp.text))
    except Exception:
        pass

    # Detectar redirección a página de login o error
    final_url = getattr(resp, 'url', '') or ''
    auth_error = _detect_auth_problem(resp.text, final_url)
    if auth_error:
        logger.warning("DEHU: problema de autenticación detectado — %s", auth_error)
        return {'error': auth_error, 'total': 0, 'new': [], 'all': [], 'checked_at': _now()}

    try:
        all_notifications = _parse_inbox(resp.text)
    except Exception as e:
        logger.error("Error parseando buzón DEHU: %s", e)
        return {'error': f'Error leyendo la respuesta de DEHU: {e}', 'total': 0, 'new': [], 'all': [], 'checked_at': _now()}

    previous_ids = _load_seen_ids(state_file)
    new_notifications = [n for n in all_notifications if n['id'] not in previous_ids]
    _save_seen_ids(state_file, {n['id'] for n in all_notifications})

    result = {
        'total': len(all_notifications),
        'new': new_notifications,
        'all': all_notifications,
        'checked_at': _now(),
    }

    _write_daily_log(log_folder, result)
    return result


def _detect_auth_problem(html: str, url: str) -> str:
    """Devuelve mensaje de error si el HTML indica fallo de autenticación, o '' si todo OK."""
    lower = html.lower()
    url_lower = url.lower()

    # Redirigido a CL@VE o portal de login
    if any(k in url_lower for k in ('clave', 'login', 'acceso', 'autent', 'identificacion')):
        return (
            'DEHU redirigió a la página de autenticación (CL@VE).\n'
            'El certificado digital no fue aceptado automáticamente.\n\n'
            'Posibles causas:\n'
            '• El archivo .pfx o su contraseña son incorrectos\n'
            '• El certificado está caducado\n'
            '• DEHU requiere acceder primero desde el navegador\n\n'
            'Prueba a abrir dehu.redsara.es en Edge con tu certificado instalado '
            'y luego vuelve a intentarlo desde la app.'
        )

    # Indicadores de error / sesión no autenticada en el HTML
    login_indicators = [
        'identificate', 'identifícate', 'iniciar sesión', 'inicio de sesión',
        'cl@ve', 'clave pin', 'acceder con certificado',
        'no autorizado', 'acceso denegado', 'unauthorized',
        'session expired', 'sesión expirada',
    ]
    if any(ind in lower for ind in login_indicators):
        return (
            'La respuesta de DEHU contiene una página de login, no el buzón.\n'
            'El certificado no se autenticó correctamente.\n\n'
            'Comprueba que el archivo .pfx y la contraseña son correctos.'
        )

    return ''


def _parse_inbox(html: str) -> List[Dict[str, Any]]:
    soup = BeautifulSoup(html, 'html.parser')

    # Intentar múltiples selectores en orden de especificidad
    rows = (
        soup.select('table.listado tbody tr')
        or soup.select('#tablaBuzon tbody tr')
        or soup.select('table#buzon tbody tr')
        or soup.select('.notificacion-row')
        or soup.select('tr.notificacion')
        or soup.select('table.tabla-listado tbody tr')
        or soup.select('.listado-notificaciones tr')
        or soup.select('tbody tr')          # cualquier tabla
    )

    # Filtrar filas de cabecera (sin celdas <td>)
    rows = [r for r in rows if r.find('td')]

    notifications = []
    for row in rows:
        n = _extract_row(row)
        if n:
            notifications.append(n)

    if not notifications:
        logger.info(
            "DEHU: ninguna notificación encontrada con selectores de tabla. "
            "Título de página: %s",
            (soup.title.string if soup.title else 'sin título'),
        )

    return notifications


def _extract_row(row) -> Optional[Dict[str, Any]]:
    cells = row.find_all('td')
    if not cells:
        return None

    link = row.find('a', href=True)
    nid = ''
    url = ''
    if link:
        url = link['href']
        parts = url.rstrip('/').split('/')
        nid = parts[-1] if parts else ''

    if not nid:
        nid = str(abs(hash(row.get_text())))

    row_classes = ' '.join(row.get('class', []))

    return {
        'id': nid,
        'organismo': cells[0].get_text(strip=True) if len(cells) > 0 else '',
        'asunto': cells[1].get_text(strip=True) if len(cells) > 1 else (link.get_text(strip=True) if link else ''),
        'fecha': cells[2].get_text(strip=True) if len(cells) > 2 else '',
        'estado': cells[3].get_text(strip=True) if len(cells) > 3 else '',
        'url': url,
        'leida': 'leida' in row_classes or 'read' in row_classes,
    }


def _load_seen_ids(path: Path) -> set:
    if path.exists():
        try:
            return set(json.loads(path.read_text(encoding='utf-8')).get('ids', []))
        except Exception:
            pass
    return set()


def _save_seen_ids(path: Path, ids: set):
    path.write_text(
        json.dumps({'ids': list(ids), 'updated': _now()}, ensure_ascii=False, indent=2),
        encoding='utf-8',
    )


def _write_daily_log(log_folder: Path, result: Dict):
    date_str = datetime.now().strftime('%Y-%m-%d')
    log_path = log_folder / f'dehu_{date_str}.json'
    log_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
