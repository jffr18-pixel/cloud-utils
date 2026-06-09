"""Historial de expedientes revisados.

Cada revision se guarda como un JSON en ./datos/historial. Se almacenan los
resultados del analisis (no los archivos originales, por privacidad y tamano),
lo que permite regenerar el checklist y el informe en cualquier formato despues.
"""

import hashlib
import json
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

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


def alta_rapida(tramite_id, datos):
    """Crea un expediente nuevo sin documentos a partir de los datos del cliente.

    ``datos`` acepta cualquier subconjunto de:
    nombre, fecha_nacimiento, nacionalidad, nie, num_pasaporte,
    cad_pasaporte, fecha_entrada_espana, telefono, email,
    direccion, ciudad, empleador, fecha_contrato, tipo_contrato,
    num_expediente_admin, notas.

    Devuelve el eid del expediente creado.
    """
    nombre = datos.get("nombre", "").strip()
    eid = guardar(tramite_id, nombre, [])
    extras = {k: v for k, v in datos.items() if k != "nombre" and v not in (None, "")}
    if extras:
        actualizar(eid, **extras)
    generar_tareas_automaticas(eid)
    anadir_seguimiento(eid, "Alta", "Expediente creado sin documentos (alta rapida)")
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
_TAREAS_AUTOMATICAS = [
    (15, "Revisar si falta enviar documentacion pendiente"),
    (30, "Confirmar cita / fecha de presentacion del expediente"),
    (90, "Consultar el estado del expediente ('Como va lo mio')"),
]


def generar_tareas_automaticas(eid, hoy=None):
    """Anade al expediente las tareas de seguimiento habituales tras revisarlo.

    Solo se anaden si el expediente no tiene ninguna tarea todavia, para no
    duplicarlas en revisiones posteriores del mismo expediente.
    """
    registro = cargar(eid)
    if not registro or registro.get("tareas"):
        return registro
    hoy = hoy or date.today()
    for dias, descripcion in _TAREAS_AUTOMATICAS:
        fecha = (hoy + timedelta(days=dias)).isoformat()
        registro.setdefault("tareas", []).append(
            {"descripcion": descripcion, "fecha": fecha, "hecha": False}
        )
    _guardar_registro(registro)
    return registro


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


# -------------------------------- Honorarios -------------------------------- #
def guardar_honorarios(eid, importe, cobrado, concepto=""):
    """Guarda o actualiza los honorarios de un expediente."""
    return actualizar(eid, honorarios={
        "importe": round(float(importe or 0), 2),
        "cobrado": round(float(cobrado or 0), 2),
        "concepto": (concepto or "").strip(),
    })


def resumen_honorarios():
    """Totales de honorarios de todos los expedientes (para el dashboard)."""
    total = cobrado = 0.0
    for meta in listar():
        reg = cargar(meta["id"])
        if not reg:
            continue
        h = reg.get("honorarios")
        if not h:
            continue
        total += h.get("importe", 0)
        cobrado += h.get("cobrado", 0)
    return {
        "total": total,
        "cobrado": cobrado,
        "pendiente": round(total - cobrado, 2),
    }


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


# ----------------------- Exportacion a calendario (.ics) -------------------- #
def _escapar_ics(texto):
    return (
        (texto or "")
        .replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\n", "\\n")
    )


def _evento_ics(uid, dtstamp, fecha_yyyymmdd, resumen, descripcion=""):
    lineas = [
        "BEGIN:VEVENT",
        f"UID:{uid}",
        f"DTSTAMP:{dtstamp}",
        f"DTSTART;VALUE=DATE:{fecha_yyyymmdd}",
        f"SUMMARY:{_escapar_ics(resumen)}",
    ]
    if descripcion:
        lineas.append(f"DESCRIPTION:{_escapar_ics(descripcion)}")
    lineas.append("END:VEVENT")
    return "\r\n".join(lineas)


def exportar_ics(incluir_caducidades=True, dias_caducidad=60):
    """Genera un calendario .ics con las tareas pendientes y, opcionalmente,
    las proximas caducidades de documentos.

    El archivo resultante se puede importar (o suscribir, si se publica en una
    URL) en Outlook, Google Calendar o Apple Calendar: cada tarea y cada
    caducidad aparece como un evento de dia completo en su fecha.
    """
    dtstamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    eventos = []

    for t in todas_las_tareas(incluir_hechas=False):
        fecha = t["fecha"].replace("-", "")
        uid = f"tarea-{t['expediente_id']}-{t['indice']}@burocraciazero"
        resumen = f"📋 {t['descripcion']} — {t['solicitante']}"
        eventos.append(_evento_ics(
            uid, dtstamp, fecha, resumen,
            "Tarea de seguimiento de un expediente de extranjeria.",
        ))

    if incluir_caducidades:
        for av in proximas_caducidades(dias_caducidad):
            fecha = av["fecha_caducidad"].replace("-", "")
            clave = hashlib.md5(
                f"{av['expediente_id']}-{av['documento']}-{av['fecha_caducidad']}".encode("utf-8")
            ).hexdigest()[:12]
            uid = f"caducidad-{clave}@burocraciazero"
            estado = "VENCIDO" if av["vencido"] else f"caduca en {av['dias_restantes']} dias"
            resumen = f"⏰ Caducidad: {av['documento']} ({estado}) — {av['solicitante']}"
            descripcion = (
                f"Tramite: {av['tramite']}. "
                f"Documento: {av['documento']}. Estado: {estado}."
            )
            eventos.append(_evento_ics(uid, dtstamp, fecha, resumen, descripcion))

    cuerpo = "\r\n".join([
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Burocracia Zero//Revision de Extranjeria//ES",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:Burocracia Zero - Plazos de extranjeria",
        *eventos,
        "END:VCALENDAR",
    ])
    return cuerpo + "\r\n"


# --------------------------- Tablero (vista Kanban) -------------------------- #
COLUMNAS_TABLERO = [
    ("pendiente_doc", "📥 Pendiente de documentacion"),
    ("listo", "✅ Listo para presentar"),
    ("presentado", "📨 Presentado / en tramite"),
    ("resuelto", "🏁 Resuelto"),
]


def _columna_de(registro):
    """Determina en que columna del tablero situar un expediente."""
    if registro.get("resultado_final") in ("aprobado", "denegado"):
        return "resuelto"
    if registro.get("presentado"):
        return "presentado"
    if registro.get("listo"):
        return "listo"
    return "pendiente_doc"


def tablero():
    """Agrupa los expedientes por su fase de tramitacion para el tablero visual."""
    grupos = {clave: [] for clave, _ in COLUMNAS_TABLERO}
    for meta in listar():
        grupos[_columna_de(meta)].append(meta)
    return grupos


# ------------------------------ Firma del cliente ---------------------------- #
def _dir_firmas():
    d = config.BASE_DIR / "historial" / "firmas"
    d.mkdir(parents=True, exist_ok=True)
    return d


def guardar_firma(eid, datos, ext="png"):
    """Guarda la imagen de la firma del cliente para este expediente.

    Se usa para incorporarla a las cartas y autorizaciones generadas.
    Sustituye cualquier firma anterior del mismo expediente.
    """
    ext = (ext or "png").lstrip(".").lower() or "png"
    d = _dir_firmas()
    for previo in d.glob(f"{eid}.*"):
        previo.unlink()
    ruta = d / f"{eid}.{ext}"
    ruta.write_bytes(datos)
    actualizar(eid, firma_path=str(ruta))
    return str(ruta)


def obtener_firma(eid):
    """Devuelve los bytes de la firma guardada del expediente, o None si no hay."""
    registro = cargar(eid)
    if not registro:
        return None
    ruta = registro.get("firma_path", "")
    if ruta and os.path.exists(ruta):
        return Path(ruta).read_bytes()
    return None


def eliminar_firma(eid):
    registro = cargar(eid)
    if not registro:
        return
    ruta = registro.get("firma_path", "")
    if ruta and os.path.exists(ruta):
        os.remove(ruta)
    actualizar(eid, firma_path="")
