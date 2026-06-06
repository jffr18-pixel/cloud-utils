"""
Seguridad de la aplicación: contraseña maestra y backup cifrado.
"""
import hashlib
import hmac
import json
import logging
import os
import secrets
import socket
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
import base64

logger = logging.getLogger(__name__)

_AUTH_DIR = Path.home() / '.cert_manager'
_AUTH_FILE = _AUTH_DIR / 'auth.json'
_BACKUP_DIR = _AUTH_DIR / 'backups'
_PBKDF2_SALT = b'burocraciazero_auth_v1'


# ── Contraseña maestra ───────────────────────────────────────────────────────

def is_password_set() -> bool:
    return _AUTH_FILE.exists() and bool(_load_auth().get('hash'))


def set_password(password: str) -> bool:
    """Establece la contraseña maestra por primera vez."""
    if not password:
        return False
    _AUTH_DIR.mkdir(parents=True, exist_ok=True)
    salt = secrets.token_hex(32)
    hash_ = _hash_password(password, salt)
    data = {
        'hash': hash_,
        'salt': salt,
        'algorithm': 'sha256',
        'created_at': _now(),
        'last_login': _now(),
    }
    try:
        _AUTH_FILE.write_text(json.dumps(data, indent=2), encoding='utf-8')
        return True
    except Exception as e:
        logger.error('Error guardando auth: %s', e)
        return False


def verify_password(password: str) -> bool:
    auth = _load_auth()
    if not auth.get('hash'):
        return True  # Sin contraseña configurada: acceso libre
    expected = _hash_password(password, auth.get('salt', ''))
    ok = hmac.compare_digest(expected, auth['hash'])
    if ok:
        auth['last_login'] = _now()
        try:
            _AUTH_FILE.write_text(json.dumps(auth, indent=2), encoding='utf-8')
        except Exception:
            pass
    return ok


def change_password(old_password: str, new_password: str) -> tuple[bool, str]:
    if not verify_password(old_password):
        return False, 'Contraseña actual incorrecta.'
    if not new_password or len(new_password) < 6:
        return False, 'La nueva contraseña debe tener al menos 6 caracteres.'
    ok = set_password(new_password)
    return (True, '') if ok else (False, 'Error guardando la nueva contraseña.')


def _hash_password(password: str, salt: str) -> str:
    return hashlib.sha256((salt + password).encode('utf-8')).hexdigest()


def _load_auth() -> dict:
    if not _AUTH_FILE.exists():
        return {}
    try:
        return json.loads(_AUTH_FILE.read_text(encoding='utf-8'))
    except Exception:
        return {}


# ── Backup cifrado ───────────────────────────────────────────────────────────

def create_backup(backup_dir: Path | None = None) -> tuple[bool, Path | str]:
    """
    Crea backup cifrado (ZIP + Fernet) de los datos clave.
    Devuelve (True, Path) o (False, mensaje_error).
    """
    dest = Path(backup_dir) if backup_dir else _BACKUP_DIR
    dest.mkdir(parents=True, exist_ok=True)

    stamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    zip_path = dest / f'backup_{stamp}.zip'
    enc_path = dest / f'backup_{stamp}.zip.enc'

    # Archivos a incluir
    from pathlib import Path as _P
    project_root = _P(__file__).parent.parent
    candidates = [
        _AUTH_DIR / 'clients.db',
        _AUTH_DIR / 'dehu_certs.json',
        _AUTH_DIR / 'auth.json',
        project_root / 'config.ini',
    ]
    sources = [f for f in candidates if f.exists()]
    if not sources:
        return False, 'No hay archivos de datos que respaldar.'

    try:
        # 1. Comprimir
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            for src in sources:
                zf.write(src, src.name)

        # 2. Cifrar
        key = _derive_backup_key()
        f = Fernet(key)
        encrypted = f.encrypt(zip_path.read_bytes())
        enc_path.write_bytes(encrypted)

        # 3. Borrar ZIP sin cifrar
        zip_path.unlink()

        logger.info('Backup creado: %s (%.1f KB)', enc_path.name, enc_path.stat().st_size / 1024)
        _save_last_backup_info(enc_path)
        return True, enc_path

    except Exception as e:
        for p in [zip_path, enc_path]:
            if p.exists():
                p.unlink(missing_ok=True)
        return False, str(e)


def restore_backup(backup_path: Path, password: str | None = None) -> tuple[bool, str]:
    """Restaura un backup cifrado."""
    backup_path = Path(backup_path)
    if not backup_path.exists():
        return False, 'El archivo de backup no existe.'
    try:
        key = _derive_backup_key()
        f = Fernet(key)
        decrypted = f.decrypt(backup_path.read_bytes())

        import io
        with zipfile.ZipFile(io.BytesIO(decrypted)) as zf:
            _AUTH_DIR.mkdir(parents=True, exist_ok=True)
            for name in zf.namelist():
                target = _AUTH_DIR / name
                target.write_bytes(zf.read(name))
                logger.info('Restaurado: %s', name)
        return True, 'Backup restaurado correctamente.'
    except Exception as e:
        return False, f'Error restaurando backup: {e}'


def get_last_backup_info() -> dict | None:
    info_file = _BACKUP_DIR / 'last_backup.json'
    if not info_file.exists():
        return None
    try:
        return json.loads(info_file.read_text(encoding='utf-8'))
    except Exception:
        return None


def auto_backup_if_needed(max_age_days: int = 1) -> bool:
    """Crea backup automático si el último tiene más de max_age_days."""
    info = get_last_backup_info()
    if info:
        try:
            last = datetime.fromisoformat(info['date'])
            if last.tzinfo is None:
                last = last.replace(tzinfo=timezone.utc)
            now = datetime.now(timezone.utc)
            if (now - last).days < max_age_days:
                return False
        except Exception:
            pass
    ok, _ = create_backup()
    return ok


def _derive_backup_key() -> bytes:
    hostname = socket.gethostname().encode()
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=_PBKDF2_SALT,
        iterations=390_000,
    )
    return base64.urlsafe_b64encode(kdf.derive(hostname))


def _save_last_backup_info(path: Path):
    _BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    info = {
        'path': str(path),
        'date': _now(),
        'size_mb': round(path.stat().st_size / 1024 / 1024, 2),
    }
    (_BACKUP_DIR / 'last_backup.json').write_text(
        json.dumps(info, indent=2), encoding='utf-8'
    )


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
