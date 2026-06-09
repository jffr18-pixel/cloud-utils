"""Revision automatizada de expedientes de extranjeria.

Modulos:
  - tramites:      definicion de tramites y documentacion exigida (editable).
  - analizador:    lectura de documentos con la IA de Claude (vision + PDF).
  - informe:       generacion del informe de revision (Markdown, Word, PDF).
  - comunicacion:  mensaje de WhatsApp, email al cliente y avisos de caducidad.
  - ficha:         ficha estructurada del expediente (Excel/CSV).
  - config:        persistencia de datos de la gestoria, logo, SMTP/IMAP y tramites.
  - historial:     expedientes, seguimiento, tareas, estadisticas y RGPD.
  - portal:        HTML standalone del estado del expediente para el cliente.
  - formularios:   formularios oficiales EX-01 y EX-03 pre-rellenados.
  - imap_import:   importacion de adjuntos desde bandeja de entrada IMAP.
  - citas:         agenda de citas previas en oficinas de extranjeria.
"""

from . import (
    analizador,
    citas,
    comunicacion,
    config,
    ficha,
    formularios,
    historial,
    imap_import,
    informe,
    portal,
    tramites,
)

__all__ = [
    "analizador",
    "citas",
    "comunicacion",
    "config",
    "ficha",
    "formularios",
    "historial",
    "imap_import",
    "informe",
    "portal",
    "tramites",
]
