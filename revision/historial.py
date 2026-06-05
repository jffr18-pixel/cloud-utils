"""Historial de expedientes revisados.

Cada revision se guarda como un JSON en ./datos/historial. Se almacenan los
resultados del analisis (no los archivos originales, por privacidad y tamano),
lo que permite regenerar el checklist y el informe en cualquier formato despues.
"""

import json
from datetime import datetime

from . import config
from .analizador import evaluar_expediente, expediente_listo


def _dir():
    d = config.BASE_DIR / "historial"
    d.mkdir(parents=True, exist_ok=True)
    return d


def guardar(tramite_id, solicitante, resultados):
    """Guarda una revision en el historial y devuelve su identificador."""
    checklist, _ = evaluar_expediente(resultados, tramite_id)
    ahora = datetime.now()
    # Microsegundos en el id para evitar colisiones si se guardan dos en el mismo segundo.
    eid = ahora.strftime("%Y%m%d_%H%M%S_") + f"{ahora.microsecond:06d}"
    registro = {
        "id": eid,
        "fecha": ahora.isoformat(timespec="seconds"),
        "tramite_id": tramite_id,
        "solicitante": solicitante or "",
        "listo": expediente_listo(checklist),
        "faltan": sum(1 for c in checklist if c["estado"] == "falta"),
        "caducados": sum(1 for c in checklist if c["estado"] == "caducado"),
        "avisos": sum(
            1 for c in checklist if c["estado"] in ("con_incidencias", "proximo_a_caducar")
        ),
        "resultados": resultados,
    }
    (_dir() / f"{eid}.json").write_text(
        json.dumps(registro, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return eid


def listar():
    """Devuelve los metadatos de las revisiones, de la mas reciente a la mas antigua."""
    salida = []
    for ruta in sorted(_dir().glob("*.json"), reverse=True):
        try:
            r = json.loads(ruta.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        salida.append(
            {
                k: r.get(k)
                for k in (
                    "id",
                    "fecha",
                    "tramite_id",
                    "solicitante",
                    "listo",
                    "faltan",
                    "caducados",
                    "avisos",
                )
            }
        )
    return salida


def cargar(eid):
    """Devuelve el registro completo de una revision, o None si no existe."""
    ruta = config.BASE_DIR / "historial" / f"{eid}.json"
    if ruta.exists():
        try:
            return json.loads(ruta.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return None
    return None


def eliminar(eid):
    ruta = config.BASE_DIR / "historial" / f"{eid}.json"
    if ruta.exists():
        ruta.unlink()
