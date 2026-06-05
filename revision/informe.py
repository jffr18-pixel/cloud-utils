"""Generacion del informe de revision del expediente en formato Markdown/texto."""

from datetime import date

from . import tramites
from .analizador import expediente_listo

_ICONO = {
    "correcto": "OK",
    "con_incidencias": "REVISAR",
    "proximo_a_caducar": "CADUCA PRONTO",
    "caducado": "CADUCADO",
    "falta": "FALTA",
    "falta_opcional": "FALTA (opcional)",
}

_ESTADO_DOC = {
    "vigente": "vigente",
    "caducado": "CADUCADO",
    "proximo_a_caducar": "proximo a caducar",
    "sin_caducidad": "sin caducidad",
    "ilegible": "ilegible",
    "desconocido": "sin determinar",
}


def generar_informe(checklist, no_identificados, tramite_id, solicitante="", hoy=None):
    """Devuelve el informe de revision como cadena Markdown."""
    if hoy is None:
        hoy = date.today()
    tramite = tramites.TRAMITES[tramite_id]
    listo = expediente_listo(checklist)

    lineas = []
    lineas.append(f"# Informe de revision de expediente")
    lineas.append("")
    lineas.append(f"- **Tramite:** {tramite['nombre']}")
    if solicitante:
        lineas.append(f"- **Solicitante:** {solicitante}")
    lineas.append(f"- **Fecha de revision:** {hoy.isoformat()}")
    veredicto = (
        "LISTO PARA PRESENTAR (revisar avisos)"
        if listo
        else "NO LISTO: faltan documentos obligatorios o hay caducados"
    )
    lineas.append(f"- **Resultado:** {veredicto}")
    lineas.append("")

    # Contadores
    faltan = [c for c in checklist if c["estado"] == "falta"]
    caducados = [c for c in checklist if c["estado"] == "caducado"]
    avisos = [c for c in checklist if c["estado"] in ("con_incidencias", "proximo_a_caducar")]

    lineas.append("## Resumen")
    lineas.append("")
    lineas.append(f"- Documentos obligatorios que faltan: **{len(faltan)}**")
    lineas.append(f"- Documentos caducados: **{len(caducados)}**")
    lineas.append(f"- Documentos a revisar / proximos a caducar: **{len(avisos)}**")
    lineas.append("")

    # Checklist
    lineas.append("## Checklist de documentacion")
    lineas.append("")
    lineas.append("| Estado | Documento | Obligatorio | Detalle |")
    lineas.append("|---|---|---|---|")
    for fila in checklist:
        icono = _ICONO.get(fila["estado"], fila["estado"])
        oblig = "Si" if fila["obligatorio"] else "No"
        detalle = _detalle_fila(fila)
        lineas.append(f"| {icono} | {fila['nombre']} | {oblig} | {detalle} |")
    lineas.append("")

    # Detalle por documento aportado
    lineas.append("## Detalle de los documentos aportados")
    lineas.append("")
    aportados = [d for fila in checklist for d in fila["documentos"]] + no_identificados
    if not aportados:
        lineas.append("_No se ha aportado ningun documento._")
        lineas.append("")
    for doc in aportados:
        lineas.extend(_bloque_documento(doc))

    # Documentos no identificados
    if no_identificados:
        lineas.append("## Documentos no identificados")
        lineas.append("")
        lineas.append(
            "Estos archivos no encajan con ningun documento exigido por el tramite. "
            "Revisar manualmente:"
        )
        for doc in no_identificados:
            lineas.append(f"- {doc['archivo']}: {doc.get('resumen', '')}")
        lineas.append("")

    # Acciones recomendadas
    lineas.append("## Acciones recomendadas")
    lineas.append("")
    acciones = _acciones(faltan, caducados, avisos)
    if not acciones:
        lineas.append("- Sin acciones pendientes. Expediente completo.")
    else:
        lineas.extend(f"- {a}" for a in acciones)
    lineas.append("")

    lineas.append("---")
    lineas.append(
        "_Informe generado automaticamente como apoyo a la revision. "
        "No sustituye el criterio profesional del gestor._"
    )
    return "\n".join(lineas)


def _detalle_fila(fila):
    if fila["estado"] in ("falta", "falta_opcional"):
        return fila.get("notas", "") or "No aportado."
    partes = []
    for doc in fila["documentos"]:
        info = doc.get("archivo", "documento")
        if doc.get("fecha_caducidad"):
            info += f" (cad. {doc['fecha_caducidad']})"
        partes.append(info)
    incidencias = [i for doc in fila["documentos"] for i in doc.get("incidencias", [])]
    detalle = "; ".join(partes)
    if incidencias:
        detalle += " — " + "; ".join(incidencias)
    return detalle or "Aportado."


def _bloque_documento(doc):
    lineas = []
    titulo = doc.get("tipo_nombre") or doc.get("archivo", "Documento")
    lineas.append(f"### {titulo}")
    lineas.append(f"- Archivo: {doc.get('archivo', '-')}")
    if doc.get("titular"):
        lineas.append(f"- Titular: {doc['titular']}")
    if doc.get("numero"):
        lineas.append(f"- Numero: {doc['numero']}")
    if doc.get("pais_emision"):
        lineas.append(f"- Pais/autoridad: {doc['pais_emision']}")
    if doc.get("fecha_emision"):
        lineas.append(f"- Fecha de emision: {doc['fecha_emision']}")
    if doc.get("fecha_caducidad"):
        lineas.append(f"- Fecha de caducidad: {doc['fecha_caducidad']}")
    lineas.append(f"- Estado: {_ESTADO_DOC.get(doc.get('estado'), doc.get('estado', '-'))}")
    lineas.append(f"- Legibilidad: {doc.get('legibilidad', '-')}")
    if doc.get("incidencias"):
        lineas.append("- Incidencias:")
        lineas.extend(f"    - {i}" for i in doc["incidencias"])
    if doc.get("resumen"):
        lineas.append(f"- Resumen: {doc['resumen']}")
    lineas.append("")
    return lineas


def _acciones(faltan, caducados, avisos):
    acciones = []
    for fila in faltan:
        acciones.append(f"Solicitar al cliente: {fila['nombre']}.")
    for fila in caducados:
        acciones.append(f"Renovar (documento caducado): {fila['nombre']}.")
    for fila in avisos:
        for doc in fila["documentos"]:
            for inc in doc.get("incidencias", []):
                acciones.append(f"{fila['nombre']}: {inc}")
    # Eliminar duplicados conservando orden
    vistas = set()
    unicas = []
    for a in acciones:
        if a not in vistas:
            vistas.add(a)
            unicas.append(a)
    return unicas
