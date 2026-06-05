"""Historial de expedientes revisados.

Cada revision se guarda como un JSON en ./datos/historial. Se almacenan los
resultados del analisis (no los archivos originales, por privacidad y tamano),
lo que permite regenerar el checklist y el informe en cualquier formato despues.
"""

import json
from datetime import date, datetime

from . import config, tramites
from .analizador import _parse_fecha, evaluar_expediente, expediente_listo


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


def _guardar_registro(registro):
    """Sobrescribe un registro completo en disco."""
    (_dir() / f"{registro['id']}.json").write_text(
        json.dumps(registro, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def actualizar(eid, **campos):
    """Actualiza campos sueltos de un expediente (nº de expediente, NIE, etc.)."""
    registro = cargar(eid)
    if not registro:
        return None
    registro.update(campos)
    _guardar_registro(registro)
    return registro


# ------------------------- Seguimiento del expediente ----------------------- #
def anadir_seguimiento(eid, estado, nota="", fecha=None):
    """Anota un estado en la linea de tiempo del expediente (seguimiento manual)."""
    registro = cargar(eid)
    if not registro:
        return None
    fecha = fecha or date.today().isoformat()
    registro.setdefault("seguimiento", []).append(
        {"fecha": fecha, "estado": estado, "nota": nota}
    )
    _guardar_registro(registro)
    return registro


def marcar_presentado(eid, numero_expediente, nie="", fecha=None):
    """Marca el expediente como presentado y guarda su nº de seguimiento y NIE."""
    fecha = fecha or date.today().isoformat()
    registro = actualizar(
        eid,
        presentado=True,
        numero_expediente=numero_expediente,
        nie=nie,
        fecha_presentacion=fecha,
    )
    if registro is not None:
        anadir_seguimiento(eid, "Presentado", f"Nº {numero_expediente}", fecha)
    return registro


# ------------------------------ Tareas / agenda ----------------------------- #
def anadir_tarea(eid, descripcion, fecha, hecha=False):
    registro = cargar(eid)
    if not registro:
        return None
    registro.setdefault("tareas", []).append(
        {"descripcion": descripcion, "fecha": fecha, "hecha": hecha}
    )
    _guardar_registro(registro)
    return registro


def marcar_tarea(eid, indice, hecha=True):
    registro = cargar(eid)
    if not registro:
        return None
    tareas = registro.get("tareas", [])
    if 0 <= indice < len(tareas):
        tareas[indice]["hecha"] = hecha
        _guardar_registro(registro)
    return registro


def todas_las_tareas(incluir_hechas=False):
    """Tareas de todos los expedientes, ordenadas por fecha (para el calendario)."""
    salida = []
    for meta in listar():
        registro = cargar(meta["id"])
        if not registro:
            continue
        for i, tarea in enumerate(registro.get("tareas", [])):
            if tarea.get("hecha") and not incluir_hechas:
                continue
            salida.append(
                {
                    "expediente_id": registro["id"],
                    "solicitante": registro.get("solicitante") or "-",
                    "indice": i,
                    "descripcion": tarea["descripcion"],
                    "fecha": tarea["fecha"],
                    "hecha": tarea.get("hecha", False),
                }
            )
    salida.sort(key=lambda t: t["fecha"])
    return salida


# --------------------- Control de versiones de documentos ------------------- #
def anadir_documentos(eid, nuevos):
    """Anade documentos a un expediente existente.

    Si un documento nuevo es del mismo tipo que uno ya presente (p.ej. un
    pasaporte renovado), el anterior se archiva en 'versiones' y el nuevo lo
    sustituye. Asi el checklist refleja siempre la version mas reciente.
    """
    registro = cargar(eid)
    if not registro:
        return None
    actuales = registro.get("resultados", [])
    versiones = registro.get("versiones", [])
    tipos_nuevos = {
        d.get("tipo_id")
        for d in nuevos
        if d.get("tipo_id") and d.get("tipo_id") != "no_identificado"
    }
    conservados = []
    ahora = date.today().isoformat()
    for doc in actuales:
        if doc.get("tipo_id") in tipos_nuevos:
            versiones.append({"fecha": ahora, "documento": doc})
        else:
            conservados.append(doc)
    registro["resultados"] = conservados + nuevos
    registro["versiones"] = versiones
    _guardar_registro(registro)
    return registro


# ----------------------------- Resultado final ------------------------------ #
def marcar_resultado(eid, resultado):
    """Marca el resultado final del tramite: aprobado / denegado / pendiente."""
    return actualizar(eid, resultado_final=resultado)


# ------------------------------ Estadisticas -------------------------------- #
def estadisticas():
    """Metricas agregadas del historial para el panel de estadisticas."""
    registros = [cargar(m["id"]) for m in listar()]
    registros = [r for r in registros if r]
    total = len(registros)
    por_tramite = {}
    completos = 0
    por_resultado = {"aprobado": 0, "denegado": 0, "pendiente": 0, "sin_marcar": 0}
    fallos_doc = {}
    nombres_tramite = {tid: t["nombre"] for tid, t in tramites.TRAMITES.items()}

    for r in registros:
        nombre_t = nombres_tramite.get(r.get("tramite_id"), r.get("tramite_id"))
        por_tramite[nombre_t] = por_tramite.get(nombre_t, 0) + 1
        if r.get("listo"):
            completos += 1
        res = r.get("resultado_final")
        por_resultado[res if res in por_resultado else "sin_marcar"] += 1
        # Documentos que mas incidencias/caducidades dan
        for doc in r.get("resultados", []):
            if doc.get("estado") in ("caducado", "ilegible") or doc.get("incidencias"):
                nombre_d = doc.get("tipo_nombre") or doc.get("tipo_id", "documento")
                fallos_doc[nombre_d] = fallos_doc.get(nombre_d, 0) + 1

    return {
        "total": total,
        "completos": completos,
        "porcentaje_completos": round(100 * completos / total, 1) if total else 0,
        "por_tramite": por_tramite,
        "por_resultado": por_resultado,
        "fallos_doc": dict(sorted(fallos_doc.items(), key=lambda x: -x[1])),
    }


# ------------------------------ RGPD / privacidad --------------------------- #
def anonimizar(eid):
    """Borra los datos personales de un expediente, conservando estadisticas."""
    registro = cargar(eid)
    if not registro:
        return None
    registro["solicitante"] = "(anonimizado)"
    registro["nie"] = ""
    registro["numero_expediente"] = registro.get("numero_expediente", "")
    for doc in registro.get("resultados", []):
        doc["titular"] = None
        doc["numero"] = None
    registro["anonimizado"] = True
    _guardar_registro(registro)
    return registro


def borrar_antiguos(dias):
    """Elimina expedientes con mas de 'dias' desde su fecha de revision."""
    if not dias or dias <= 0:
        return 0
    limite = datetime.now().timestamp() - dias * 86400
    borrados = 0
    for meta in listar():
        registro = cargar(meta["id"])
        if not registro:
            continue
        try:
            ts = datetime.fromisoformat(registro["fecha"]).timestamp()
        except (ValueError, KeyError):
            continue
        if ts < limite:
            eliminar(meta["id"])
            borrados += 1
    return borrados


def eliminar(eid):
    ruta = config.BASE_DIR / "historial" / f"{eid}.json"
    if ruta.exists():
        ruta.unlink()


def proximas_caducidades(dias=90, hoy=None):
    """Recorre el historial y devuelve documentos caducados o que caducan pronto.

    Util para el seguimiento proactivo: avisa de documentos de expedientes ya
    revisados cuya caducidad esta vencida o se acerca, calculada a dia de hoy.
    """
    if hoy is None:
        hoy = date.today()
    avisos = []
    nombres_tramite = {tid: t["nombre"] for tid, t in tramites.TRAMITES.items()}
    for meta in listar():
        registro = cargar(meta["id"])
        if not registro:
            continue
        for doc in registro.get("resultados", []):
            caducidad = _parse_fecha(doc.get("fecha_caducidad"))
            if not caducidad:
                continue
            restantes = (caducidad - hoy).days
            if restantes <= dias:
                avisos.append(
                    {
                        "solicitante": registro.get("solicitante") or "-",
                        "tramite": nombres_tramite.get(
                            registro.get("tramite_id"), registro.get("tramite_id")
                        ),
                        "documento": doc.get("tipo_nombre") or doc.get("archivo", "documento"),
                        "fecha_caducidad": caducidad.isoformat(),
                        "dias_restantes": restantes,
                        "vencido": restantes < 0,
                        "expediente_id": registro["id"],
                        "fecha_revision": registro.get("fecha", "")[:10],
                    }
                )
    avisos.sort(key=lambda a: a["dias_restantes"])
    return avisos
