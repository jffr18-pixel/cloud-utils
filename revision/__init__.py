"""Revision automatizada de expedientes de extranjeria.

Modulos:
  - tramites:   definicion de tramites y documentacion exigida (editable).
  - analizador: lectura de documentos con la IA de Claude (vision + PDF).
  - informe:    generacion del informe de revision (Markdown, Word, PDF).
  - config:     persistencia de datos de la gestoria, logo y tramites.
  - historial:  registro de expedientes revisados.
"""

from . import analizador, config, historial, informe, tramites

__all__ = ["analizador", "config", "historial", "informe", "tramites"]
