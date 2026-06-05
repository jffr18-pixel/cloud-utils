"""Definicion de tramites de extranjeria y su documentacion exigida.

Cada tramite tiene una lista de documentos. Por cada documento se indica:
  - id:          identificador interno (lo usa la IA para clasificar)
  - nombre:      nombre legible que ve el usuario
  - obligatorio: True si la ausencia bloquea la presentacion
  - caduca:      True si el documento tiene fecha de caducidad/validez relevante
  - notas:       aclaracion practica para el gestor

IMPORTANTE: estas listas son orientativas y EDITABLES. El gestor es el experto;
puede ajustar, anadir o quitar documentos segun la subdelegacion, la comunidad
autonoma o el criterio del expediente concreto. La edicion se hace desde la
propia interfaz (pestana "Tramites"), que persiste los cambios sin tocar codigo.
"""

import copy

# Documentos comunes a casi todos los tramites, para no repetirlos.
_PASAPORTE = {
    "id": "pasaporte",
    "nombre": "Pasaporte completo y en vigor",
    "obligatorio": True,
    "caduca": True,
    "notas": "Todas las paginas. Debe estar en vigor; vigilar caducidad proxima.",
}
_ANTECEDENTES_ORIGEN = {
    "id": "antecedentes_origen",
    "nombre": "Certificado de antecedentes penales del pais de origen",
    "obligatorio": True,
    "caduca": True,
    "notas": "Legalizado/apostillado y traducido. Validez habitual de 3-6 meses desde su expedicion.",
}
_EMPADRONAMIENTO = {
    "id": "empadronamiento",
    "nombre": "Certificado de empadronamiento",
    "obligatorio": True,
    "caduca": True,
    "notas": "Para acreditar permanencia suele pedirse el historico/colectivo. Validez corta (3 meses).",
}
_TASA = {
    "id": "tasa_790_052",
    "nombre": "Justificante de tasa (modelo 790 codigo 052)",
    "obligatorio": True,
    "caduca": False,
    "notas": "Tasa de autorizacion de residencia.",
}
_SOLICITUD = {
    "id": "solicitud_ex",
    "nombre": "Impreso de solicitud (modelo EX) firmado",
    "obligatorio": True,
    "caduca": False,
    "notas": "Modelo EX correspondiente, cumplimentado y firmado.",
}


TRAMITES_DEFECTO = {
    "regularizacion_extraordinaria": {
        "nombre": "Regularizacion extraordinaria",
        "descripcion": (
            "Proceso extraordinario de regularizacion. Verificar identidad, "
            "permanencia continuada y ausencia de antecedentes."
        ),
        "documentos": [
            _SOLICITUD,
            _PASAPORTE,
            _EMPADRONAMIENTO,
            {
                "id": "prueba_permanencia",
                "nombre": "Prueba de permanencia continuada en Espana",
                "obligatorio": True,
                "caduca": False,
                "notas": "Empadronamientos historicos, informes medicos, justificantes, etc. que prueben la estancia.",
            },
            _ANTECEDENTES_ORIGEN,
            {
                "id": "antecedentes_espana",
                "nombre": "Certificado de antecedentes penales en Espana",
                "obligatorio": False,
                "caduca": True,
                "notas": "Cuando proceda segun el tiempo de residencia en Espana.",
            },
            {
                "id": "fotografia",
                "nombre": "Fotografia reciente tamano carne",
                "obligatorio": True,
                "caduca": False,
                "notas": "Fondo blanco, reciente.",
            },
        ],
    },
    "cambio_humanitario_residencia_trabajo": {
        "nombre": "Cambio de razones humanitarias a residencia y trabajo",
        "descripcion": (
            "Modificacion de una autorizacion por razones humanitarias/proteccion "
            "a una autorizacion de residencia y trabajo."
        ),
        "documentos": [
            _SOLICITUD,
            _PASAPORTE,
            {
                "id": "tie_humanitaria",
                "nombre": "TIE / resolucion vigente por razones humanitarias",
                "obligatorio": True,
                "caduca": True,
                "notas": "Tarjeta o resolucion de la autorizacion actual que se desea modificar.",
            },
            {
                "id": "contrato_trabajo",
                "nombre": "Contrato de trabajo u oferta firme de empleo",
                "obligatorio": True,
                "caduca": False,
                "notas": "Firmado por empresa y trabajador. Jornada y duracion suficientes.",
            },
            {
                "id": "documentacion_empresa",
                "nombre": "Documentacion de la empresa empleadora",
                "obligatorio": True,
                "caduca": False,
                "notas": "Alta en Seguridad Social, IAE, escritura/CIF, ultimos TC, declaracion de medios.",
            },
            {
                "id": "vida_laboral",
                "nombre": "Informe de vida laboral",
                "obligatorio": False,
                "caduca": True,
                "notas": "Cuando exista cotizacion previa. Documento reciente.",
            },
            _EMPADRONAMIENTO,
            _TASA,
        ],
    },
    "arraigo_social": {
        "nombre": "Arraigo social",
        "anios_permanencia": 3,
        "descripcion": (
            "Permanencia continuada de 3 anos, medios economicos (contrato o exencion) "
            "e integracion o vinculos familiares."
        ),
        "documentos": [
            _SOLICITUD,
            _PASAPORTE,
            {
                "id": "permanencia_3_anios",
                "nombre": "Prueba de permanencia continuada de 3 anos",
                "obligatorio": True,
                "caduca": False,
                "notas": "Empadronamiento historico y cualquier documento que acredite la estancia.",
            },
            {
                "id": "contrato_trabajo",
                "nombre": "Contrato de trabajo (o acreditacion de medios)",
                "obligatorio": True,
                "caduca": False,
                "notas": "Contrato firmado de duracion/jornada suficiente, o exencion con medios propios.",
            },
            {
                "id": "informe_integracion",
                "nombre": "Informe de arraigo / integracion social (CCAA)",
                "obligatorio": True,
                "caduca": True,
                "notas": "Emitido por la comunidad autonoma. Si falta, valorar vinculos familiares.",
            },
            _ANTECEDENTES_ORIGEN,
            _EMPADRONAMIENTO,
        ],
    },
    "arraigo_sociolaboral": {
        "nombre": "Arraigo sociolaboral",
        "anios_permanencia": 2,
        "descripcion": (
            "Permanencia de 2 anos y contrato(s) de trabajo que garanticen medios "
            "economicos suficientes."
        ),
        "documentos": [
            _SOLICITUD,
            _PASAPORTE,
            {
                "id": "permanencia_2_anios",
                "nombre": "Prueba de permanencia continuada de 2 anos",
                "obligatorio": True,
                "caduca": False,
                "notas": "Empadronamiento historico y documentos de estancia.",
            },
            {
                "id": "contrato_trabajo",
                "nombre": "Contrato(s) de trabajo",
                "obligatorio": True,
                "caduca": False,
                "notas": "Uno o varios contratos que cubran la jornada y retribucion exigidas.",
            },
            {
                "id": "documentacion_empresa",
                "nombre": "Documentacion de la empresa empleadora",
                "obligatorio": True,
                "caduca": False,
                "notas": "Acreditacion de solvencia y alta de la empresa.",
            },
            _ANTECEDENTES_ORIGEN,
            _EMPADRONAMIENTO,
        ],
    },
    "arraigo_laboral": {
        "nombre": "Arraigo laboral",
        "anios_permanencia": 2,
        "descripcion": (
            "Permanencia de 2 anos y acreditacion de una relacion laboral previa."
        ),
        "documentos": [
            _SOLICITUD,
            _PASAPORTE,
            {
                "id": "permanencia_2_anios",
                "nombre": "Prueba de permanencia continuada de 2 anos",
                "obligatorio": True,
                "caduca": False,
                "notas": "Empadronamiento historico y documentos de estancia.",
            },
            {
                "id": "acreditacion_relacion_laboral",
                "nombre": "Acreditacion de la relacion laboral",
                "obligatorio": True,
                "caduca": False,
                "notas": "Resolucion judicial, acta de la Inspeccion de Trabajo o vida laboral que pruebe el trabajo.",
            },
            _ANTECEDENTES_ORIGEN,
            _EMPADRONAMIENTO,
        ],
    },
    "arraigo_familiar": {
        "nombre": "Arraigo familiar",
        "descripcion": (
            "Vinculo con menor espanol o con progenitor/conyuge espanol o residente, "
            "segun el supuesto."
        ),
        "documentos": [
            _SOLICITUD,
            _PASAPORTE,
            {
                "id": "vinculo_familiar",
                "nombre": "Acreditacion del vinculo familiar",
                "obligatorio": True,
                "caduca": False,
                "notas": "Libro de familia, certificado de nacimiento, DNI del familiar espanol, etc.",
            },
            {
                "id": "empadronamiento_conjunto",
                "nombre": "Empadronamiento (acredita convivencia cuando proceda)",
                "obligatorio": True,
                "caduca": True,
                "notas": "Empadronamiento conjunto con el familiar si el supuesto lo exige.",
            },
            _ANTECEDENTES_ORIGEN,
        ],
    },
    "arraigo_formacion": {
        "nombre": "Arraigo para la formacion",
        "anios_permanencia": 2,
        "descripcion": (
            "Permanencia de 2 anos y compromiso de matricula en formacion reglada "
            "o conducente a certificado de profesionalidad."
        ),
        "documentos": [
            _SOLICITUD,
            _PASAPORTE,
            {
                "id": "permanencia_2_anios",
                "nombre": "Prueba de permanencia continuada de 2 anos",
                "obligatorio": True,
                "caduca": False,
                "notas": "Empadronamiento historico y documentos de estancia.",
            },
            {
                "id": "compromiso_formacion",
                "nombre": "Matricula o compromiso de matricula en la formacion",
                "obligatorio": True,
                "caduca": False,
                "notas": "Formacion reglada o conducente a certificado de profesionalidad.",
            },
            _ANTECEDENTES_ORIGEN,
            _EMPADRONAMIENTO,
        ],
    },
    "arraigo_segunda_oportunidad": {
        "nombre": "Arraigo de segunda oportunidad",
        "descripcion": (
            "Para quienes fueron titulares de una autorizacion en los ultimos 2 anos "
            "y no pudieron renovarla."
        ),
        "documentos": [
            _SOLICITUD,
            _PASAPORTE,
            {
                "id": "autorizacion_previa",
                "nombre": "Acreditacion de autorizacion previa (ultimos 2 anos)",
                "obligatorio": True,
                "caduca": False,
                "notas": "TIE/resolucion anterior de la que fue titular.",
            },
            _ANTECEDENTES_ORIGEN,
            _EMPADRONAMIENTO,
        ],
    },
}


# Conjunto ACTIVO de tramites. Arranca con los valores por defecto y puede
# sustituirse por una version personalizada cargada desde disco (config.py).
TRAMITES = copy.deepcopy(TRAMITES_DEFECTO)


def restablecer():
    """Restaura los tramites a los valores por defecto del codigo."""
    TRAMITES.clear()
    TRAMITES.update(copy.deepcopy(TRAMITES_DEFECTO))


def aplicar(personalizados):
    """Sustituye el conjunto activo de tramites por uno personalizado."""
    TRAMITES.clear()
    TRAMITES.update(copy.deepcopy(personalizados))


def lista_tramites():
    """Devuelve [(id, nombre), ...] para poblar el desplegable de la interfaz."""
    return [(tid, datos["nombre"]) for tid, datos in TRAMITES.items()]


def documentos_de(tramite_id):
    """Lista de documentos exigidos para un tramite."""
    return TRAMITES[tramite_id]["documentos"]


def resumen_tipos(tramite_id):
    """Texto compacto id -> nombre, para guiar a la IA en la clasificacion."""
    lineas = []
    for doc in documentos_de(tramite_id):
        lineas.append(f'- "{doc["id"]}": {doc["nombre"]}')
    return "\n".join(lineas)
