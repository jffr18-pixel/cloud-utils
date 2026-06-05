import logging
import sys

logger = logging.getLogger(__name__)


def notify(title: str, message: str):
    if sys.platform == 'win32':
        _toast_windows(title, message)
    else:
        # Non-Windows: log only (useful in CI / cloud)
        logger.info(f"[NOTIFICACIÓN] {title}: {message}")


def _toast_windows(title: str, message: str):
    try:
        from win10toast import ToastNotifier
        ToastNotifier().show_toast(title, message, duration=10, threaded=True)
        return
    except ImportError:
        pass

    # Fallback via PowerShell BurntToast / Windows Forms
    try:
        import subprocess
        ps_script = (
            'Add-Type -AssemblyName System.Windows.Forms; '
            f'[System.Windows.Forms.MessageBox]::Show("{message}", "{title}")'
        )
        subprocess.run(
            ['powershell', '-NonInteractive', '-Command', ps_script],
            capture_output=True,
            check=False,
        )
    except Exception as e:
        logger.warning(f"No se pudo mostrar notificación de Windows: {e}")
