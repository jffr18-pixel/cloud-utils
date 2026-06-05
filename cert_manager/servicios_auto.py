"""
Automatización de descarga de documentos gubernamentales con Selenium + Edge.

Cómo funciona:
  1. Abre Edge (usa el almacén de certificados de Windows automáticamente).
  2. Navega al servicio solicitado.
  3. Windows muestra el diálogo de selección de certificado — el usuario elige el suyo.
  4. Selenium espera a que el PDF aparezca en la carpeta de descarga.
  5. Devuelve la ruta del PDF descargado.

Edge es el navegador preferido en Windows 11 porque accede al almacén de
certificados del sistema sin configuración adicional. Chrome también funciona
si el certificado está importado en Chrome.
"""
import logging
import time
from pathlib import Path

logger = logging.getLogger(__name__)

# Pasos de automatización por servicio:
# url      → página de inicio del servicio (la que lanza la autenticación)
# clicks   → lista de selectores CSS a intentar hacer clic para llegar al PDF
# wait_pdf → segundos máximos esperando que aparezca el PDF
_SERVICES_CFG = {
    'vida_laboral': {
        'url': (
            'https://portal.seg-social.gob.es/wps/portal/importass/importass/'
            'Categorias/Vida+laboral+e+informes/Informes+sobre+tu+'
            'situacion+laboral/Informe+de+tu+vida+laboral'
        ),
        # Botones de descarga/obtención conocidos en el portal Importass
        'clicks': [
            'a[title*="Obtener"]',
            'button[title*="Obtener"]',
            'a[class*="download"]',
            'a[href*=".pdf"]',
            'input[type="submit"][value*="Obtener"]',
            'input[type="submit"][value*="PDF"]',
            'a[class*="btn"][href*="pdf"]',
            '.descarga a',
            '#btnObtener',
        ],
        'wait_pdf': 60,
    },
    'corriente_hacienda': {
        'url': (
            'https://sede.agenciatributaria.gob.es/Sede/'
            'procedimientoini/G304.shtml'
        ),
        # AEAT: primero hay un enlace "Solicitar", luego se genera el PDF
        'clicks': [
            'a[href*="solicitar"]',
            'a[title*="Solicitar"]',
            'a[class*="btn-primary"]',
            'a[href*="G304"]',
            'input[type="submit"]',
            'button[type="submit"]',
        ],
        'wait_pdf': 90,
    },
    'bases_cotizacion': {
        'url': (
            'https://portal.seg-social.gob.es/wps/portal/importass/importass/'
            'Categorias/Vida+laboral+e+informes/Informes+de+tus+cotizaciones/'
            'Informe+de+bases+de+cotizacion'
        ),
        'clicks': [
            'a[title*="Obtener"]',
            'button[title*="Obtener"]',
            'a[href*=".pdf"]',
            'input[type="submit"][value*="Obtener"]',
            '.descarga a',
        ],
        'wait_pdf': 60,
    },
}

# Tiempo de espera tras cargar la página antes de buscar botones
# (el usuario selecciona su certificado en el diálogo de Windows)
_CERT_DIALOG_WAIT = 8


def _build_driver(download_dir: Path):
    """
    Creates a visible Edge WebDriver with the download folder configured.
    Falls back to Chrome if Edge is not available.
    """
    from selenium.webdriver.edge.options import Options as EdgeOptions
    from selenium.webdriver.chrome.options import Options as ChromeOptions

    prefs = {
        'download.default_directory': str(download_dir.resolve()),
        'download.prompt_for_download': False,
        'download.directory_upgrade': True,
        # Force PDF to download instead of opening in browser
        'plugins.always_open_pdf_externally': True,
        'safebrowsing.enabled': True,
    }

    # ── Edge (preferido en Windows 11) ────────────────────────────────────────
    try:
        from selenium import webdriver
        from selenium.webdriver.edge.service import Service as EdgeService
        from webdriver_manager.microsoft import EdgeChromiumDriverManager

        opts = EdgeOptions()
        opts.add_experimental_option('prefs', prefs)
        opts.add_experimental_option('excludeSwitches', ['enable-logging'])
        opts.add_argument('--no-sandbox')
        opts.add_argument('--disable-dev-shm-usage')

        driver = webdriver.Edge(
            service=EdgeService(EdgeChromiumDriverManager().install()),
            options=opts,
        )
        logger.info('WebDriver: Edge iniciado')
        return driver
    except Exception as e:
        logger.warning('Edge no disponible (%s), probando Chrome...', e)

    # ── Chrome (alternativa) ──────────────────────────────────────────────────
    try:
        from selenium import webdriver
        from selenium.webdriver.chrome.service import Service as ChromeService
        from webdriver_manager.chrome import ChromeDriverManager

        opts = ChromeOptions()
        opts.add_experimental_option('prefs', prefs)
        opts.add_experimental_option('excludeSwitches', ['enable-logging'])

        driver = webdriver.Chrome(
            service=ChromeService(ChromeDriverManager().install()),
            options=opts,
        )
        logger.info('WebDriver: Chrome iniciado')
        return driver
    except Exception as e:
        logger.warning('Chrome no disponible (%s)', e)

    raise RuntimeError(
        'No se encontró Edge ni Chrome instalado.\n'
        'Instala Microsoft Edge o Google Chrome para usar la descarga automática.'
    )


def _wait_for_new_pdf(download_dir: Path, before: set, timeout: int) -> Path | None:
    """Polls download_dir until a new complete PDF appears or timeout."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        after = set(download_dir.glob('*.pdf'))
        new = after - before
        # Ignore .crdownload / .tmp (still downloading)
        complete = [
            f for f in new
            if not f.name.endswith(('.crdownload', '.tmp', '.part'))
            and f.stat().st_size > 1024  # at least 1 KB
        ]
        if complete:
            return max(complete, key=lambda f: f.stat().st_mtime)
        time.sleep(1)
    return None


def _try_click_selectors(driver, selectors: list, wait_each: float = 3.0) -> bool:
    """Tries each CSS selector in order; returns True if one was clicked."""
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC

    for sel in selectors:
        try:
            el = WebDriverWait(driver, wait_each).until(
                EC.element_to_be_clickable((By.CSS_SELECTOR, sel))
            )
            driver.execute_script('arguments[0].scrollIntoView(true);', el)
            time.sleep(0.3)
            el.click()
            logger.info('Clic en selector: %s', sel)
            return True
        except Exception:
            continue
    return False


def download_service(
    service_id: str,
    download_dir: Path,
    progress_cb=None,
) -> dict:
    """
    Automates the download of a government document using Edge/Chrome.

    progress_cb(msg: str) is called with status updates (optional).

    Returns {'ok': True, 'path': Path} or {'ok': False, 'error': str}.
    """
    cfg = _SERVICES_CFG.get(service_id)
    if not cfg:
        return {'ok': False, 'error': f'Servicio no configurado: {service_id}'}

    def _cb(msg: str):
        logger.info(msg)
        if progress_cb:
            progress_cb(msg)

    download_dir.mkdir(parents=True, exist_ok=True)
    before = set(download_dir.glob('*.pdf'))

    driver = None
    try:
        _cb('Iniciando navegador...')
        driver = _build_driver(download_dir)
        driver.set_page_load_timeout(30)

        _cb('Abriendo portal del servicio...')
        driver.get(cfg['url'])

        _cb(
            f'⏳ El navegador se ha abierto. Si aparece el diálogo de selección '
            f'de certificado, elige el tuyo. Esperando {_CERT_DIALOG_WAIT}s...'
        )
        time.sleep(_CERT_DIALOG_WAIT)

        # Some portals redirect to login then back; re-read URL
        current = driver.current_url
        _cb(f'Página cargada: {current[:60]}...')

        # Try to click the download/obtain button
        _cb('Buscando botón de descarga...')
        clicked = _try_click_selectors(driver, cfg['clicks'])

        if clicked:
            _cb('Botón encontrado y pulsado. Esperando descarga del PDF...')
        else:
            _cb(
                'No se encontró botón automáticamente. '
                'Si el portal lo requiere, pulsa el botón de descarga en el navegador. '
                'La app detectará el PDF cuando se complete.'
            )

        # Wait for PDF
        pdf = _wait_for_new_pdf(download_dir, before, cfg['wait_pdf'])

        if pdf:
            _cb(f'✓ PDF descargado: {pdf.name}')
            return {'ok': True, 'path': pdf}

        return {
            'ok': False,
            'error': (
                'Tiempo de espera agotado. El PDF no se descargó automáticamente.\n'
                'Si completaste la autenticación en el navegador, usa el botón '
                '"📂 Guardar PDF" para registrar el archivo descargado manualmente.'
            ),
        }

    except Exception as exc:
        return {'ok': False, 'error': str(exc)}

    finally:
        if driver:
            try:
                driver.quit()
            except Exception:
                pass
