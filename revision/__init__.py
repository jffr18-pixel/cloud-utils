"""Revision automatizada de expedientes de extranjeria.

Modulos:
  - tramites:     definicion de tramites y documentacion exigida (editable).
  - analizador:   lectura de documentos con la IA de Claude (vision + PDF).
  - informe:      generacion del informe de revision (Markdown, Word, PDF).
  - comunicacion: mensaje de WhatsApp y envio por email al cliente.
  - ficha:        ficha estructurada del expediente (Excel/CSV).
  - config:       persistencia de datos de la gestoria, logo, SMTP y tramites.
  - historial:    expedientes, seguimiento, tareas, estadisticas y RGPD.
"""

from . import (
    analizador,
    comunicacion,
    config,
    ficha,
    historial,
    informe,
    tramites,
)

__all__ = [
    "analizador",
    "comunicacion",
    "config",
    "ficha",
    "historial",
    "informe",
    "tramites",
]
