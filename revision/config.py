"""Persistencia de configuracion: datos de la gestoria, logo, tramites y perfiles.

Todo se guarda en un directorio local (por defecto ./datos, configurable con la
variable de entorno EXTRANJERIA_DATOS). Cada PERFIL de usuario tiene su propia
subcarpeta con su configuracion, sus tramites y su historial, lo que permite que
varias personas o despachos trabajen por separado en la misma instalacion.
"""

import json
import os
import re
from pathlib import Path

from . import tramites

ROOT_DIR = Path(os.environ.get("EXTRANJERIA_DATOS", "datos"))

# Directorio activo. Por defecto la raiz; al elegir un perfil pasa a una subcarpeta.
BASE_DIR = ROOT_DIR
PERFIL_ACTUAL = None

_CONFIG_DEFECTO = {
    "nombre_gestoria": "",
    "direccion": "",
    "telefono": "",
    "email": "",
    "logo_path": "",
    # Envio de email (SMTP)
    "smtp_host": "",
    "smtp_port": 587,
    "smtp_user": "",
    "smtp_password": "",
    "smtp_remitente": "",
    "smtp_tls": True,
    # Proteccion de datos (RGPD): dias de conservacion (0 = sin limite)
    "rgpd_retencion_dias": 0,
}

_EXT_LOGO = (".png", ".jpg", ".jpeg")


def _slug(texto):
    texto = (texto or "").strip().lower()
    sustituciones = {"á": "a", "é": "e", "í": "i", "ó": "o", "ú": "u", "ñ": "n", "ü": "u"}
    for a, b in sustituciones.items():
        texto = texto.replace(a, b)
    texto = re.sub(r"[^a-z0-9]+", "_", texto).strip("_")
    return texto or "perfil"


def _config_file():
    return BASE_DIR / "config.json"


def _tramites_file():
    return BASE_DIR / "tramites.json"


def _asegurar_dir():
    BASE_DIR.mkdir(parents=True, exist_ok=True)


# ------------------------------- Perfiles ---------------------------------- #
def listar_perfiles():
    """Nombres de los perfiles existentes (subcarpetas de perfiles/)."""
    d = ROOT_DIR / "perfiles"
    if not d.exists():
        return []
    return sorted(p.name for p in d.iterdir() if p.is_dir())


def establecer_perfil(nombre):
    """Activa un perfil (crea su carpeta si no existe) y carga su configuracion."""
    global BASE_DIR, PERFIL_ACTUAL
    BASE_DIR = ROOT_DIR / "perfiles" / _slug(nombre)
    PERFIL_ACTUAL = nombre
    _asegurar_dir()
    inicializar()


# --------------------------- Datos de la gestoria --------------------------- #
def cargar_config():
    """Devuelve el diccionario de configuracion de la gestoria."""
    ruta = _config_file()
    if ruta.exists():
        try:
            datos = json.loads(ruta.read_text(encoding="utf-8"))
            return {**_CONFIG_DEFECTO, **datos}
        except (json.JSONDecodeError, OSError):
            pass
    return dict(_CONFIG_DEFECTO)


def guardar_config(cfg):
    _asegurar_dir()
    completo = {**_CONFIG_DEFECTO, **cfg}
    _config_file().write_text(
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
    ruta = _tramites_file()
    if ruta.exists():
        try:
            return json.loads(ruta.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return None


def guardar_tramites(data):
    """Persiste el conjunto de tramites y lo aplica al conjunto activo."""
    _asegurar_dir()
    _tramites_file().write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    tramites.aplicar(data)


def restablecer_tramites():
    """Borra la personalizacion y vuelve a los valores por defecto."""
    ruta = _tramites_file()
    if ruta.exists():
        ruta.unlink()
    tramites.restablecer()


def inicializar():
    """Carga al arranque los tramites personalizados del perfil activo si existen."""
    custom = cargar_tramites_personalizados()
    if custom:
        tramites.aplicar(custom)
    else:
        tramites.restablecer()


# --------------------------- Copia de seguridad ----------------------------- #
def exportar_perfil():
    """Devuelve un ZIP (bytes) con toda la configuracion e historial del perfil."""
    import io
    import zipfile

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        if BASE_DIR.exists():
            for ruta in BASE_DIR.rglob("*"):
                if ruta.is_file():
                    zf.write(ruta, ruta.relative_to(BASE_DIR).as_posix())
    return buffer.getvalue()


def importar_perfil(datos_zip):
    """Restaura un perfil desde un ZIP exportado. Devuelve el nº de archivos."""
    import io
    import zipfile

    _asegurar_dir()
    n = 0
    with zipfile.ZipFile(io.BytesIO(datos_zip)) as zf:
        for nombre in zf.namelist():
            if nombre.endswith("/"):
                continue
            # Evitar rutas con traversal (../) por seguridad.
            destino = (BASE_DIR / nombre).resolve()
            if not str(destino).startswith(str(BASE_DIR.resolve())):
                continue
            destino.parent.mkdir(parents=True, exist_ok=True)
            destino.write_bytes(zf.read(nombre))
            n += 1
    inicializar()
    return n
