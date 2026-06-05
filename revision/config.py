"""Persistencia de configuracion: datos de la gestoria, logo y tramites.

Todo se guarda en un directorio local (por defecto ./datos, configurable con la
variable de entorno EXTRANJERIA_DATOS). Asi los ajustes y el historial perduran
entre sesiones en la maquina del gestor.
"""

import json
import os
from pathlib import Path

from . import tramites

BASE_DIR = Path(os.environ.get("EXTRANJERIA_DATOS", "datos"))
CONFIG_FILE = BASE_DIR / "config.json"
TRAMITES_FILE = BASE_DIR / "tramites.json"

_CONFIG_DEFECTO = {
    "nombre_gestoria": "",
    "direccion": "",
    "telefono": "",
    "email": "",
    "logo_path": "",
}

_EXT_LOGO = (".png", ".jpg", ".jpeg")


def _asegurar_dir():
    BASE_DIR.mkdir(parents=True, exist_ok=True)


# --------------------------- Datos de la gestoria --------------------------- #
def cargar_config():
    """Devuelve el diccionario de configuracion de la gestoria."""
    if CONFIG_FILE.exists():
        try:
            datos = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
            return {**_CONFIG_DEFECTO, **datos}
        except (json.JSONDecodeError, OSError):
            pass
    return dict(_CONFIG_DEFECTO)


def guardar_config(cfg):
    _asegurar_dir()
    completo = {**_CONFIG_DEFECTO, **cfg}
    CONFIG_FILE.write_text(
        json.dumps(completo, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return completo


def guardar_logo(datos, nombre_archivo):
    """Guarda el logo (png/jpg) y actualiza la configuracion. Devuelve la ruta."""
    ext = "." + nombre_archivo.lower().rsplit(".", 1)[-1] if "." in nombre_archivo else ""
    if ext not in _EXT_LOGO:
        raise ValueError("El logo debe ser PNG o JPG.")
    _asegurar_dir()
    for previo in BASE_DIR.glob("logo.*"):
        previo.unlink()
    destino = BASE_DIR / f"logo{ext}"
    destino.write_bytes(datos)
    cfg = cargar_config()
    cfg["logo_path"] = str(destino)
    guardar_config(cfg)
    return str(destino)


def eliminar_logo():
    for previo in BASE_DIR.glob("logo.*"):
        previo.unlink()
    cfg = cargar_config()
    cfg["logo_path"] = ""
    guardar_config(cfg)


def hay_membrete(cfg=None):
    """True si hay algun dato de membrete (nombre o logo)."""
    cfg = cfg or cargar_config()
    logo = cfg.get("logo_path", "")
    return bool(cfg.get("nombre_gestoria")) or bool(logo and os.path.exists(logo))


# --------------------------- Tramites personalizados ------------------------ #
def cargar_tramites_personalizados():
    """Devuelve los tramites personalizados guardados, o None si no hay."""
    if TRAMITES_FILE.exists():
        try:
            return json.loads(TRAMITES_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return None


def guardar_tramites(data):
    """Persiste el conjunto de tramites y lo aplica al conjunto activo."""
    _asegurar_dir()
    TRAMITES_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    tramites.aplicar(data)


def restablecer_tramites():
    """Borra la personalizacion y vuelve a los valores por defecto."""
    if TRAMITES_FILE.exists():
        TRAMITES_FILE.unlink()
    tramites.restablecer()


def inicializar():
    """Carga al arranque los tramites personalizados si existen."""
    custom = cargar_tramites_personalizados()
    if custom:
        tramites.aplicar(custom)
    else:
        tramites.restablecer()
