import logging
import subprocess
import sys
from pathlib import Path

logger = logging.getLogger(__name__)

_TASK_NAME = 'GestorCertificadosDehu'


def install(script_path: Path, python_path: str = None, run_time: str = '09:00') -> bool:
    """Create a daily Windows Task Scheduler task. Shows crontab hint on non-Windows."""
    if sys.platform != 'win32':
        _print_crontab_hint(script_path, run_time)
        return False

    python_path = python_path or sys.executable
    hour, minute = run_time.split(':')
    cmd = [
        'schtasks', '/create', '/f',
        '/tn', _TASK_NAME,
        '/tr', f'"{python_path}" "{script_path.resolve()}" check-dehu',
        '/sc', 'DAILY',
        '/st', f'{hour}:{minute}',
        '/rl', 'HIGHEST',
        '/ru', 'SYSTEM',
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True)
        print(f"✓ Tarea '{_TASK_NAME}' creada. Se ejecutará cada día a las {run_time}.")
        return True
    except subprocess.CalledProcessError as e:
        logger.error(f"Error creando tarea programada: {e.stderr}")
        return False


def remove() -> bool:
    if sys.platform != 'win32':
        return False
    try:
        subprocess.run(
            ['schtasks', '/delete', '/f', '/tn', _TASK_NAME],
            check=True, capture_output=True,
        )
        print(f"✓ Tarea '{_TASK_NAME}' eliminada.")
        return True
    except subprocess.CalledProcessError as e:
        logger.error(f"Error eliminando tarea: {e}")
        return False


def status():
    if sys.platform != 'win32':
        print("Task Scheduler solo disponible en Windows.")
        return
    result = subprocess.run(
        ['schtasks', '/query', '/tn', _TASK_NAME, '/fo', 'LIST'],
        capture_output=True, text=True,
    )
    print(result.stdout if result.stdout else f"Tarea '{_TASK_NAME}' no encontrada.")


def _print_crontab_hint(script_path: Path, run_time: str):
    hour, minute = run_time.split(':')
    print("Sistema no Windows. Para programar la ejecución diaria añade esto al crontab:")
    print(f"  {minute} {hour} * * * {sys.executable} {script_path.resolve()} check-dehu")
