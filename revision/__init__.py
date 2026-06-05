"""Revision automatizada de expedientes de extranjeria.

Modulos:
  - tramites:   definicion de tramites y documentacion exigida (editable).
  - analizador: lectura de documentos con la IA de Claude (vision + PDF).
  - informe:    generacion del informe de revision.
"""

from . import analizador, informe, tramites

__all__ = ["analizador", "informe", "tramites"]
