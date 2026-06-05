"""Extraccion de la ficha estructurada del expediente y exportacion a Excel/CSV."""

import csv
import io

from . import tramites


def construir_ficha(resultados, meta=None):
    """Resume los datos clave del expediente a partir de los documentos.

    Toma el titular y el numero del pasaporte (o del primer documento con datos)
    y combina con los metadatos del expediente (solicitante, nº de expediente...).
    """
    meta = meta or {}
    titular = ""
    numero_pasaporte = ""
    pais = ""
    for doc in resultados:
        if doc.get("tipo_id") == "pasaporte":
            titular = titular or (doc.get("titular") or "")
            numero_pasaporte = numero_pasaporte or (doc.get("numero") or "")
            pais = pais or (doc.get("pais_emision") or "")
    if not titular:
        titular = next((d.get("titular") for d in resultados if d.get("titular")), "")

    tramite_id = meta.get("tramite_id", "")
    return {
        "Solicitante": meta.get("solicitante") or titular,
        "Titular (documentos)": titular,
        "Nº de pasaporte": numero_pasaporte,
        "Pais/nacionalidad": pais,
        "NIE": meta.get("nie", ""),
        "Nº de expediente": meta.get("numero_expediente", ""),
        "Tramite": tramites.TRAMITES.get(tramite_id, {}).get("nombre", tramite_id),
        "Fecha de revision": (meta.get("fecha", "") or "")[:10],
        "Documentos aportados": len(resultados),
    }


def _filas_documentos(resultados):
    filas = []
    for doc in resultados:
        filas.append(
            {
                "Documento": doc.get("tipo_nombre", ""),
                "Tipo (id)": doc.get("tipo_id", ""),
                "Archivo": doc.get("archivo", ""),
                "Titular": doc.get("titular", "") or "",
                "Numero": doc.get("numero", "") or "",
                "Pais": doc.get("pais_emision", "") or "",
                "Emision": doc.get("fecha_emision", "") or "",
                "Caducidad": doc.get("fecha_caducidad", "") or "",
                "Estado": doc.get("estado", ""),
                "Incidencias": "; ".join(doc.get("incidencias", [])),
            }
        )
    return filas


def exportar_excel(resultados, meta=None):
    """Devuelve la ficha del expediente como un archivo Excel (.xlsx) en bytes."""
    from openpyxl import Workbook

    libro = Workbook()
    hoja1 = libro.active
    hoja1.title = "Datos"
    for clave, valor in construir_ficha(resultados, meta).items():
        hoja1.append([clave, valor])

    hoja2 = libro.create_sheet("Documentos")
    filas = _filas_documentos(resultados)
    if filas:
        cabeceras = list(filas[0].keys())
        hoja2.append(cabeceras)
        for fila in filas:
            hoja2.append([fila[c] for c in cabeceras])

    buffer = io.BytesIO()
    libro.save(buffer)
    return buffer.getvalue()


def exportar_csv(resultados):
    """Devuelve el listado de documentos del expediente en CSV (texto)."""
    filas = _filas_documentos(resultados)
    buffer = io.StringIO()
    if filas:
        escritor = csv.DictWriter(buffer, fieldnames=list(filas[0].keys()))
        escritor.writeheader()
        escritor.writerows(filas)
    return buffer.getvalue()
