import sqlite3
import socket
import os
from datetime import datetime, timezone
from pathlib import Path

from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from cryptography.fernet import Fernet
import base64

_DB_DIR = Path.home() / ".cert_manager"
_DB_PATH = _DB_DIR / "clients.db"

# Fixed salt stored in configuration; not secret, just prevents rainbow tables.
_PBKDF2_SALT = b"burocraciazero_salt_v1"
_PBKDF2_ITERATIONS = 390_000


def _derive_key() -> bytes:
    hostname = socket.gethostname().encode()
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=_PBKDF2_SALT,
        iterations=_PBKDF2_ITERATIONS,
    )
    return base64.urlsafe_b64encode(kdf.derive(hostname))


def _fernet() -> Fernet:
    return Fernet(_derive_key())


def init_db() -> None:
    _DB_DIR.mkdir(parents=True, exist_ok=True)
    with get_db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS clients (
                id                    INTEGER PRIMARY KEY AUTOINCREMENT,
                name                  TEXT NOT NULL,
                dni                   TEXT,
                email                 TEXT,
                phone                 TEXT,
                whatsapp              TEXT,
                pfx_path              TEXT,
                pfx_password_encrypted TEXT,
                gdpr_signed           INTEGER DEFAULT 0,
                gdpr_doc_path         TEXT,
                notes                 TEXT,
                created_at            TEXT,
                updated_at            TEXT,
                active                INTEGER DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS notification_log (
                id                    INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id             INTEGER REFERENCES clients(id),
                notification_id       TEXT,
                notification_subject  TEXT,
                notification_date     TEXT,
                sent_email            INTEGER DEFAULT 0,
                sent_whatsapp         INTEGER DEFAULT 0,
                sent_at               TEXT,
                easy_read_text        TEXT
            );

            CREATE TABLE IF NOT EXISTS cert_usage_log (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id    INTEGER REFERENCES clients(id),
                action       TEXT,
                performed_at TEXT,
                performed_by TEXT
            );
            """
        )


def get_db() -> sqlite3.Connection:
    _DB_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _get_user() -> str:
    try:
        return os.getlogin()
    except OSError:
        return os.environ.get("USER", os.environ.get("USERNAME", "unknown"))


def add_client(
    name: str,
    dni: str = None,
    email: str = None,
    phone: str = None,
    whatsapp: str = None,
    pfx_path: str = None,
    pfx_password: str = None,
    notes: str = None,
) -> int:
    encrypted = _fernet().encrypt(pfx_password.encode()).decode() if pfx_password else None
    now = _now()
    with get_db() as conn:
        cur = conn.execute(
            """
            INSERT INTO clients
                (name, dni, email, phone, whatsapp, pfx_path,
                 pfx_password_encrypted, notes, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (name, dni, email, phone, whatsapp, pfx_path, encrypted, notes, now, now),
        )
        return cur.lastrowid


def update_client(client_id: int, **fields) -> None:
    if not fields:
        return
    if "pfx_password" in fields:
        raw = fields.pop("pfx_password")
        fields["pfx_password_encrypted"] = (
            _fernet().encrypt(raw.encode()).decode() if raw else None
        )
    fields["updated_at"] = _now()
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [client_id]
    with get_db() as conn:
        conn.execute(
            f"UPDATE clients SET {set_clause} WHERE id = ?", values
        )


def delete_client(client_id: int) -> None:
    with get_db() as conn:
        conn.execute(
            "UPDATE clients SET active = 0, updated_at = ? WHERE id = ?",
            (_now(), client_id),
        )


def get_client(client_id: int) -> dict | None:
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM clients WHERE id = ?", (client_id,)
        ).fetchone()
    return dict(row) if row else None


def list_clients(active_only: bool = True) -> list[dict]:
    with get_db() as conn:
        if active_only:
            rows = conn.execute(
                "SELECT * FROM clients WHERE active = 1 ORDER BY name"
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM clients ORDER BY name"
            ).fetchall()
    return [dict(r) for r in rows]


def search_clients(query: str) -> list[dict]:
    like = f"%{query}%"
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT * FROM clients
            WHERE active = 1
              AND (name LIKE ? OR dni LIKE ? OR email LIKE ?)
            ORDER BY name
            """,
            (like, like, like),
        ).fetchall()
    return [dict(r) for r in rows]


def mark_gdpr_signed(client_id: int, doc_path: str) -> None:
    with get_db() as conn:
        conn.execute(
            "UPDATE clients SET gdpr_signed = 1, gdpr_doc_path = ?, updated_at = ? WHERE id = ?",
            (doc_path, _now(), client_id),
        )


def log_notification(
    client_id: int,
    notification_id: str,
    subject: str,
    date: str,
    easy_read: str = None,
) -> None:
    with get_db() as conn:
        conn.execute(
            """
            INSERT OR IGNORE INTO notification_log
                (client_id, notification_id, notification_subject,
                 notification_date, easy_read_text)
            VALUES (?, ?, ?, ?, ?)
            """,
            (client_id, notification_id, subject, date, easy_read),
        )


def mark_notification_sent(notification_id: str, channel: str) -> None:
    if channel not in ("email", "whatsapp"):
        raise ValueError("channel must be 'email' or 'whatsapp'")
    column = f"sent_{channel}"
    with get_db() as conn:
        conn.execute(
            f"UPDATE notification_log SET {column} = 1, sent_at = ? WHERE notification_id = ?",
            (_now(), notification_id),
        )


def log_cert_usage(client_id: int, action: str) -> None:
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO cert_usage_log (client_id, action, performed_at, performed_by)
            VALUES (?, ?, ?, ?)
            """,
            (client_id, action, _now(), _get_user()),
        )


def get_client_notifications(client_id: int) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT * FROM notification_log
            WHERE client_id = ?
            ORDER BY notification_date DESC
            """,
            (client_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def decrypt_password(encrypted: str) -> str:
    return _fernet().decrypt(encrypted.encode()).decode()
