"""Agenda de citas previas en oficinas de extranjeria.

Cada cita se guarda en datos/perfiles/<perfil>/citas/citas.json.
"""

import json
from datetime import date, datetime, timedelta

from . import config

TIPOS_OFICINA = [
    "OEX (Oficina de Extranjeria)",
    "Comisaria de Policia",
    "SEPE",
    "Seguridad Social",
    "Registro Civil",
    "Notaria",
    "Otro",
]


def _archivo():
    d = config.BASE_DIR / "citas"
    d.mkdir(parents=True, exist_ok=True)
    return d / "citas.json"


def listar():
    """Devuelve todas las citas ordenadas por fecha/hora."""
    try:
        datos = json.loads(_archivo().read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        datos = []
    return sorted(datos, key=lambda c: (c.get("fecha", ""), c.get("hora", "")))


def _guardar_todas(citas):
    _archivo().write_text(
        json.dumps(citas, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def guardar_cita(expediente_id, fecha, hora, tipo, oficina, reserva="", notas=""):
    """Crea una nueva cita y devuelve su id."""
    citas = listar()
    cid = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    citas.append({
        "id": cid,
        "expediente_id": expediente_id or "",
        "fecha": fecha,
        "hora": hora or "",
        "tipo": tipo or "",
        "oficina": oficina or "",
        "reserva": reserva or "",
        "notas": notas or "",
        "hecha": False,
    })
    _guardar_todas(citas)
    return cid


def actualizar_cita(cid, **campos):
    citas = listar()
    for c in citas:
        if c["id"] == cid:
            c.update(campos)
            break
    _guardar_todas(citas)


def eliminar_cita(cid):
    _guardar_todas([c for c in listar() if c["id"] != cid])


def proximas_citas(dias=14):
    """Citas pendientes en los proximos N dias (incluye hoy)."""
    hoy = date.today().isoformat()
    limite = (date.today() + timedelta(days=dias)).isoformat()
    return [
        c for c in listar()
        if not c.get("hecha") and hoy <= c.get("fecha", "") <= limite
    ]
