import json
import logging
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from bs4 import BeautifulSoup

from .dehu_session import DEHUSession

logger = logging.getLogger(__name__)

_INDEX_JSON = 'indice.json'
_INDEX_HTML = 'indice.html'
_REQUEST_DELAY = 0.8  # seconds between downloads — be polite


def download_notifications(
    session: DEHUSession,
    notifications: List[Dict[str, Any]],
    dest_folder: Path,
    safe_mode: bool = True,
    confirm_fn: Optional[Callable[[Dict], bool]] = None,
    only_pending: bool = False,
) -> Dict[str, Any]:
    """
    Download notifications as PDFs into dest_folder organized by year/month/organismo.

    safe_mode=True prompts before downloading each unread notification, since
    opening a notification on DEHU officially starts legal deadlines.
    """
    dest_folder.mkdir(parents=True, exist_ok=True)
    index = _load_index(dest_folder)
    downloaded, skipped, errors = [], [], []

    for notif in notifications:
        nid = notif['id']

        if only_pending and notif.get('leida'):
            skipped.append(nid)
            continue

        if nid in index.get('descargadas', {}):
            skipped.append(nid)
            continue

        if safe_mode and not notif.get('leida') and confirm_fn and not confirm_fn(notif):
            skipped.append(nid)
            continue

        try:
            path = _download_one(session, notif, dest_folder)
            if path:
                entry = {
                    **notif,
                    'archivo': str(path.relative_to(dest_folder)),
                    'descargado_en': _now(),
                }
                index.setdefault('descargadas', {})[nid] = entry
                downloaded.append(entry)
                time.sleep(_REQUEST_DELAY)
        except Exception as e:
            logger.error(f"Error descargando notificación {nid}: {e}")
            errors.append({'id': nid, 'error': str(e)})

    _save_index(dest_folder, index)
    _render_html_index(dest_folder, index)

    return {'downloaded': downloaded, 'skipped': skipped, 'errors': errors}


def _download_one(session: DEHUSession, notif: Dict, base: Path) -> Optional[Path]:
    url = notif.get('url') or f'/es/ciudadano/notificacion/{notif["id"]}'
    resp = session.get(url)
    resp.raise_for_status()

    content_type = resp.headers.get('content-type', '')
    if 'application/pdf' in content_type:
        pdf_bytes = resp.content
    else:
        pdf_url = _find_pdf_link(resp.text, url)
        if not pdf_url:
            logger.warning(f"No se encontró PDF para notificación {notif['id']}")
            return None
        pdf_resp = session.get(pdf_url)
        pdf_resp.raise_for_status()
        pdf_bytes = pdf_resp.content

    dest = _build_dest_path(base, notif)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(pdf_bytes)
    logger.info(f"Guardado: {dest}")
    return dest


def _find_pdf_link(html: str, page_url: str) -> Optional[str]:
    soup = BeautifulSoup(html, 'html.parser')
    base = page_url.rsplit('/', 1)[0]

    for a in soup.find_all('a', href=True):
        href = a['href']
        if re.search(r'(\.pdf|descargar|download|documento)', href, re.I):
            return href if href.startswith('http') else f"{base}/{href.lstrip('/')}"

    form = soup.find('form', action=re.compile(r'(descargar|download|pdf)', re.I))
    if form and form.get('action'):
        action = form['action']
        return action if action.startswith('http') else f"{base}/{action.lstrip('/')}"

    return None


def _build_dest_path(base: Path, notif: Dict) -> Path:
    fecha = notif.get('fecha', '')
    try:
        dt = datetime.strptime(fecha, '%d/%m/%Y')
        year, month = str(dt.year), f'{dt.month:02d}'
    except (ValueError, TypeError):
        now = datetime.now()
        year, month = str(now.year), f'{now.month:02d}'

    organismo = _safe_filename(notif.get('organismo', 'desconocido'))
    asunto = _safe_filename(notif.get('asunto', 'notificacion'))[:60]
    fecha_str = fecha.replace('/', '-') if fecha else 'sin-fecha'
    filename = f'{fecha_str}_{asunto}_{notif["id"]}.pdf'

    return base / year / month / organismo / filename


def _safe_filename(name: str) -> str:
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '', name)
    name = re.sub(r'\s+', '_', name.strip())
    return name[:50] or 'sin_nombre'


def _load_index(folder: Path) -> Dict:
    path = folder / _INDEX_JSON
    if path.exists():
        try:
            return json.loads(path.read_text(encoding='utf-8'))
        except Exception:
            pass
    return {'descargadas': {}, 'creado': _now()}


def _save_index(folder: Path, index: Dict):
    index['actualizado'] = _now()
    (folder / _INDEX_JSON).write_text(
        json.dumps(index, ensure_ascii=False, indent=2), encoding='utf-8'
    )


def _render_html_index(folder: Path, index: Dict):
    entries = sorted(
        index.get('descargadas', {}).values(),
        key=lambda e: e.get('fecha', ''),
        reverse=True,
    )

    rows = ''
    for e in entries:
        estado = '⚠ Pendiente' if not e.get('leida') else '✓ Leída'
        color = '#cc6600' if not e.get('leida') else '#28a745'
        rows += (
            f'<tr>'
            f'<td>{e.get("fecha","")}</td>'
            f'<td>{e.get("organismo","")}</td>'
            f'<td>{e.get("asunto","")}</td>'
            f'<td><a href="{e.get("archivo","")}" target="_blank">Abrir PDF</a></td>'
            f'<td style="color:{color};font-weight:bold">{estado}</td>'
            f'</tr>\n'
        )

    total = len(entries)
    pendientes = sum(1 for e in entries if not e.get('leida'))
    updated = index.get('actualizado', '')

    html = f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Notificaciones DEHU</title>
<style>
  body{{font-family:Arial,sans-serif;margin:2em;background:#f8f9fa}}
  .container{{max-width:1100px;margin:auto;background:#fff;padding:2em;border-radius:8px;box-shadow:0 2px 6px rgba(0,0,0,.12)}}
  h1{{color:#0057a8}}
  .stats{{display:flex;gap:1em;margin:1em 0}}
  .stat{{background:#0057a8;color:#fff;padding:.8em 1.5em;border-radius:6px;text-align:center}}
  .stat.warn{{background:#e67e22}}
  .stat h3{{margin:0;font-size:1.8em}}
  .stat p{{margin:.2em 0 0;font-size:.85em}}
  table{{border-collapse:collapse;width:100%;margin-top:1.5em}}
  th,td{{border:1px solid #dee2e6;padding:9px 12px;text-align:left}}
  th{{background:#0057a8;color:#fff}}
  tr:nth-child(even){{background:#f5f8ff}}
  tr:hover{{background:#eaf0ff}}
  a{{color:#0057a8}}
</style>
</head>
<body>
<div class="container">
  <h1>📂 Notificaciones DEHU</h1>
  <p>Actualizado: {updated}</p>
  <div class="stats">
    <div class="stat"><h3>{total}</h3><p>Total</p></div>
    <div class="stat warn"><h3>{pendientes}</h3><p>Pendientes</p></div>
    <div class="stat"><h3>{total - pendientes}</h3><p>Leídas</p></div>
  </div>
  <table>
    <thead><tr><th>Fecha</th><th>Organismo</th><th>Asunto</th><th>Archivo</th><th>Estado</th></tr></thead>
    <tbody>{rows}</tbody>
  </table>
</div>
</body>
</html>"""

    (folder / _INDEX_HTML).write_text(html, encoding='utf-8')


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
