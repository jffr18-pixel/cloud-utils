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
        all_notifications = _parse_inbox(resp.text)
    except Exception as e:
        logger.error(f"Error consultando DEHU: {e}")
        return {'error': str(e), 'total': 0, 'new': [], 'all': [], 'checked_at': _now()}

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


def _parse_inbox(html: str) -> List[Dict[str, Any]]:
    soup = BeautifulSoup(html, 'html.parser')

    # Try multiple selectors — DEHU may use different markup versions
    rows = (
        soup.select('table.listado tbody tr')
        or soup.select('.notificacion-row')
        or soup.select('tr.notificacion')
        or soup.select('#tablaBuzon tbody tr')
    )

    notifications = []
    for row in rows:
        n = _extract_row(row)
        if n:
            notifications.append(n)
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
