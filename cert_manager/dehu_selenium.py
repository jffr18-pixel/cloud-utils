"""
Lectura del buzón DEHú mediante Selenium + Edge.

DEHú carga las notificaciones con JavaScript (AJAX), por lo que la librería
`requests` solo recibe el HTML vacío inicial. Selenium controla un navegador
real (Edge) que SÍ ejecuta JavaScript, espera a que la tabla se rellene y
extrae las notificaciones del DOM ya renderizado.

Edge usa el almacén de certificados de Windows. Si está activada la política
AutoSelectCertificateForUrls (ver edge_policy.py), el certificado se selecciona
automáticamente sin diálogo.
"""
import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

logger = logging.getLogger(__name__)

_BUZON_URL = 'https://dehu.redsara.es/es/ciudadano/buzon'
_STATE_FILENAME = 'dehu_state.json'

# Tiempo máximo esperando a que el JavaScript cargue la tabla de notificaciones
_LOAD_TIMEOUT = 40
# Tiempo para que el usuario seleccione el certificado si no hay autoselección
_CERT_DIALOG_WAIT = 10


def selenium_available() -> bool:
    """True si selenium está instalado."""
    import importlib.util
    return importlib.util.find_spec('selenium') is not None


def check_with_selenium(
    log_folder: Path = Path('logs'),
    headless: bool = True,
    progress_cb=None,
    subject_cn: str = '',
) -> Dict[str, Any]:
    """
    Abre Edge (oculto por defecto), navega al buzón DEHú, espera a que cargue
    el JavaScript y extrae las notificaciones para mostrarlas en la app.

    headless=True ejecuta Edge invisible: requiere que el certificado esté en
    el almacén de Windows y que la autoselección esté activa (si no, no podrá
    autenticarse porque no hay diálogo posible en modo oculto).

    subject_cn: nombre del titular del certificado, para verificar autenticación.

    Devuelve el mismo formato que dehu_checker.check():
        {'total', 'new', 'all', 'checked_at'} o {'error', 'reason', ...}
    """
    log_folder.mkdir(parents=True, exist_ok=True)
    state_file = log_folder / _STATE_FILENAME

    def _cb(msg):
        logger.info(msg)
        if progress_cb:
            progress_cb(msg)

    if not selenium_available():
        return {
            'error': (
                'Falta el módulo "selenium" para leer DEHú.\n'
                'Instálalo con: pip install -r requirements.txt'
            ),
            'reason': 'no_selenium',
            'total': 0, 'new': [], 'all': [], 'checked_at': _now(),
        }

    driver = None
    try:
        _cb('Conectando con DEHú en segundo plano...' if headless
            else 'Abriendo navegador Edge...')
        driver = _build_driver(headless)
        driver.set_page_load_timeout(60)

        _cb('Autenticando con tu certificado...')
        driver.get(_BUZON_URL)

        if not headless:
            # Modo visible: dar tiempo a seleccionar el certificado a mano
            time.sleep(_CERT_DIALOG_WAIT)

        _cb('Leyendo notificaciones...')
        notifications, diag = _wait_and_parse(driver, log_folder)

        try:
            (log_folder / 'dehu_rendered.html').write_text(
                driver.page_source, encoding='utf-8', errors='replace')
        except Exception:
            pass

        # Detectar si seguimos en login (autenticación fallida)
        if not notifications and _looks_like_login(driver):
            return {
                'error': (
                    'El certificado no se autenticó automáticamente en DEHú.'
                ),
                'reason': 'auth_failed',
                'total': 0, 'new': [], 'all': [], 'checked_at': _now(),
                'diag': diag,
            }

        previous_ids = _load_seen_ids(state_file)
        new_notifications = [n for n in notifications if n['id'] not in previous_ids]
        _save_seen_ids(state_file, {n['id'] for n in notifications})

        result = {
            'total': len(notifications),
            'new': new_notifications,
            'all': notifications,
            'checked_at': _now(),
            'diag': diag,
        }
        _write_daily_log(log_folder, result)
        _cb(f'✓ {len(notifications)} notificaciones encontradas')
        return result

    except Exception as e:
        logger.error('Error leyendo DEHú con Selenium: %s', e)
        return {'error': str(e), 'reason': 'exception',
                'total': 0, 'new': [], 'all': [], 'checked_at': _now()}
    finally:
        if driver:
            try:
                driver.quit()
            except Exception:
                pass


def _build_driver(headless: bool):
    """Crea un WebDriver de Edge que usa el almacén de certificados de Windows."""
    from selenium import webdriver
    from selenium.webdriver.edge.options import Options as EdgeOptions

    opts = EdgeOptions()
    if headless:
        # Headless NO funciona con el diálogo de certificado de Windows;
        # solo usar headless si la autoselección por política está activa.
        opts.add_argument('--headless=new')
    opts.add_argument('--no-sandbox')
    opts.add_argument('--disable-dev-shm-usage')
    opts.add_experimental_option('excludeSwitches', ['enable-logging'])

    try:
        from selenium.webdriver.edge.service import Service as EdgeService
        from webdriver_manager.microsoft import EdgeChromiumDriverManager
        driver = webdriver.Edge(
            service=EdgeService(EdgeChromiumDriverManager().install()),
            options=opts,
        )
    except Exception:
        # Intentar sin webdriver-manager (Edge en PATH del sistema)
        driver = webdriver.Edge(options=opts)

    logger.info('WebDriver Edge iniciado para DEHú')
    return driver


def _wait_and_parse(driver, log_folder: Path):
    """Espera a que aparezca la tabla de notificaciones y la extrae del DOM."""
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC

    # Selectores donde puede aparecer la tabla de notificaciones
    candidate_selectors = [
        'table.listado tbody tr',
        '#tablaBuzon tbody tr',
        '#tablaNotificaciones tbody tr',
        'table.dataTable tbody tr',
        '.notificacion-row',
        'tr.notificacion',
        'table tbody tr',
    ]

    # Esperar hasta que cualquier selector tenga filas o se agote el tiempo
    deadline = time.time() + _LOAD_TIMEOUT
    found_selector = ''
    while time.time() < deadline:
        for sel in candidate_selectors:
            try:
                els = driver.find_elements(By.CSS_SELECTOR, sel)
                # Filtrar filas con celdas reales
                real = [e for e in els if e.find_elements(By.TAG_NAME, 'td')]
                if real:
                    found_selector = sel
                    break
            except Exception:
                continue
        if found_selector:
            break
        time.sleep(1.5)

    notifications = _parse_dom(driver, found_selector)

    diag = {
        'selector_used': found_selector,
        'page_title': driver.title,
        'current_url': driver.current_url,
        'found': len(notifications),
    }
    return notifications, diag


def _parse_dom(driver, selector: str) -> List[Dict[str, Any]]:
    from selenium.webdriver.common.by import By
    if not selector:
        return []

    notifications = []
    rows = driver.find_elements(By.CSS_SELECTOR, selector)
    for row in rows:
        try:
            cells = row.find_elements(By.TAG_NAME, 'td')
            if not cells:
                continue
            texts = [c.text.strip() for c in cells]

            # ID y URL desde el enlace si existe
            nid = ''
            url = ''
            links = row.find_elements(By.TAG_NAME, 'a')
            if links:
                url = links[0].get_attribute('href') or ''
                parts = url.rstrip('/').split('/')
                nid = parts[-1] if parts else ''
            if not nid:
                nid = str(abs(hash(' '.join(texts))))

            notifications.append({
                'id': nid,
                'organismo': texts[0] if len(texts) > 0 else '',
                'asunto': texts[1] if len(texts) > 1 else '',
                'fecha': texts[2] if len(texts) > 2 else '',
                'estado': texts[3] if len(texts) > 3 else '',
                'url': url,
                'leida': False,
            })
        except Exception as e:
            logger.debug('Error extrayendo fila DEHú: %s', e)
            continue

    return notifications


def _looks_like_login(driver) -> bool:
    """True si la página actual parece ser de login/CL@VE en lugar del buzón."""
    url = (driver.current_url or '').lower()
    title = (driver.title or '').lower()
    if any(k in url for k in ('clave', 'login', 'acceso', 'autenticacion', 'identifica')):
        return True
    if any(k in title for k in ('cl@ve', 'clave', 'acceso', 'identifica')):
        return True
    try:
        body = driver.page_source.lower()
        return any(k in body for k in ('cl@ve', 'identifícate', 'acceder con certificado'))
    except Exception:
        return False


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
    safe = {k: v for k, v in result.items() if k != 'diag'}
    (log_folder / f'dehu_{date_str}.json').write_text(
        json.dumps(safe, ensure_ascii=False, indent=2), encoding='utf-8')


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
