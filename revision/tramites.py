"""Definicion de tramites de extranjeria y su documentacion exigida.

Normativa de referencia:
  - Ley Organica 4/2000 (LOEX), modificada por LO 2/2009, LO 10/2011 y LO 9/2022.
  - Real Decreto 1155/2024, de 19 de noviembre (nuevo Reglamento de Extranjeria,
    en vigor desde el 20 de mayo de 2025). Sustituye al RD 557/2011.
  - Real Decreto 316/2026, de 14 de abril (regularizacion extraordinaria).
  - Instrucciones SEM 1/2025 y SEM 4/2025 (Secretaria de Estado de Migraciones).

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

# ---------------------------------------------------------------------------
# Bloques de documentos comunes a varios tramites
# ---------------------------------------------------------------------------
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
    "notas": (
        "Legalizado/apostillado y traducido por traductor jurado. "
        "Validez habitual 3-6 meses. Si ha residido en otros paises los ultimos "
        "5 anos, tambien se exigen antecedentes de esos paises."
    ),
}
_ANTECEDENTES_ESPANA = {
    "id": "antecedentes_espana",
    "nombre": "Certificado de antecedentes penales en Espana",
    "obligatorio": True,
    "caduca": True,
    "notas": "Del Registro Central de Penados. Expedido por el Ministerio de Justicia.",
}
_EMPADRONAMIENTO = {
    "id": "empadronamiento",
    "nombre": "Certificado de empadronamiento",
    "obligatorio": True,
    "caduca": True,
    "notas": (
        "Para acreditar permanencia se pide el historico/colectivo. "
        "Validez corta (3 meses). Muchas oficinas exigen que sea de la "
        "misma provincia de la OE donde se presenta."
    ),
}
_TASA = {
    "id": "tasa_790_052",
    "nombre": "Justificante de tasa (modelo 790 codigo 052)",
    "obligatorio": True,
    "caduca": False,
    "notas": "Tasa de autorizacion de residencia. Abonar antes de la presentacion.",
}
_SOLICITUD = {
    "id": "solicitud_ex",
    "nombre": "Impreso de solicitud (modelo EX) firmado",
    "obligatorio": True,
    "caduca": False,
    "notas": "Modelo EX-10 (circunstancias excepcionales por arraigo) o el especifico del tramite.",
}
_PRUEBA_PERMANENCIA_2 = {
    "id": "prueba_permanencia_2",
    "nombre": "Prueba de permanencia continuada en Espana (minimo 2 anos)",
    "obligatorio": True,
    "caduca": False,
    "notas": (
        "Empadronamiento historico + otros documentos con fecha y nombre: "
        "facturas, nóminas, citas medicas, justificantes bancarios, recargas "
        "de transporte, etc. Ausencias maximas: 90 dias en los 2 anos."
    ),
}
_VIDA_LABORAL = {
    "id": "vida_laboral",
    "nombre": "Informe de vida laboral (TGSS)",
    "obligatorio": False,
    "caduca": True,
    "notas": "Expedido por la Seguridad Social. Recomendable si hay cotizaciones previas.",
}
_FOTOGRAFIA = {
    "id": "fotografia",
    "nombre": "Fotografia reciente tamano carne",
    "obligatorio": True,
    "caduca": False,
    "notas": "Fondo blanco, reciente.",
}


# ---------------------------------------------------------------------------
# TRAMITES (actualizados a RD 1155/2024 y RD 316/2026)
# ---------------------------------------------------------------------------
TRAMITES_DEFECTO = {

    # ── 1. REGULARIZACION EXTRAORDINARIA ──────────────────────────────────────
    # RD 316/2026, de 14 de abril. Plazo: 16/04/2026 – 30/06/2026.
    # Formularios EX-31 (solicitantes proteccion internacional) y EX-32 (resto).
    "regularizacion_extraordinaria": {
        "nombre": "Regularizacion extraordinaria (RD 316/2026)",
        "descripcion": (
            "Proceso extraordinario de regularizacion aprobado por RD 316/2026. "
            "Plazo de solicitud: 16/04/2026 a 30/06/2026. "
            "Requisitos: haber estado en Espana antes del 01/01/2026, permanencia "
            "ininterrumpida de al menos 5 meses, ausencia de antecedentes penales "
            "y cumplir una de las tres circunstancias: trabajo/oferta de empleo, "
            "convivencia con menores/dependientes a cargo, o vulnerabilidad social. "
            "Formulario EX-32 (general) o EX-31 (solicitantes de proteccion internacional)."
        ),
        "documentos": [
            {
                "id": "solicitud_ex32",
                "nombre": "Formulario EX-32 (o EX-31 si solicito proteccion internacional)",
                "obligatorio": True,
                "caduca": False,
                "notas": "EX-32 para el proceso general; EX-31 para solicitantes de asilo (DA20 RD 316/2026).",
            },
            _PASAPORTE,
            _EMPADRONAMIENTO,
            {
                "id": "prueba_presencia_antes_2026",
                "nombre": "Prueba de presencia en Espana antes del 01/01/2026",
                "obligatorio": True,
                "caduca": False,
                "notas": "Cualquier documento con fecha anterior al 01/01/2026: empadronamiento, cita medica, billete, etc.",
            },
            {
                "id": "prueba_permanencia_5_meses",
                "nombre": "Prueba de permanencia ininterrumpida de al menos 5 meses",
                "obligatorio": True,
                "caduca": False,
                "notas": "Documentos con fecha desde la llegada hasta la solicitud sin salidas del territorio.",
            },
            _ANTECEDENTES_ORIGEN,
            _ANTECEDENTES_ESPANA,
            {
                "id": "circunstancia_trabajo",
                "nombre": "Contrato de trabajo u oferta firme / declaracion responsable de actividad autonoma",
                "obligatorio": False,
                "caduca": False,
                "notas": "Uno de los tres supuestos del art. DA21 RD 316/2026. Contrato firmado o declaracion autonomo.",
            },
            {
                "id": "circunstancia_familia",
                "nombre": "Documentacion de menores o dependientes a cargo",
                "obligatorio": False,
                "caduca": False,
                "notas": "Libro de familia, certificado nacimiento, empadronamiento conjunto con menores o dependientes.",
            },
            {
                "id": "circunstancia_vulnerabilidad",
                "nombre": "Certificado de vulnerabilidad social",
                "obligatorio": False,
                "caduca": False,
                "notas": "Emitido por Servicios Sociales municipales o autonomicos. Solo si no aplica supuesto trabajo o familia.",
            },
            _TASA,
        ],
    },

    # ── 2. CAMBIO DE RAZONES HUMANITARIAS A RESIDENCIA Y TRABAJO ───────────────
    # Art. 128 RD 1155/2024. Sustituye al art. 127 del RD 557/2011.
    # Aplica a: victimas de delitos laborales (arts. 311-318 CP), discriminacion
    # (arts. 510-512 CP), trata de seres humanos, enfermedad sobrevenida grave,
    # o peligro grave para la integridad si se regresa.
    "cambio_humanitario_residencia_trabajo": {
        "nombre": "Autorizacion por razones humanitarias (art. 128 RD 1155/2024)",
        "descripcion": (
            "Autorizacion de residencia temporal por circunstancias excepcionales "
            "por razones humanitarias (art. 128 RD 1155/2024). "
            "Supuestos: (a) victimas de delitos contra derechos de trabajadores "
            "(arts. 311-318 CP) o discriminacion (arts. 510-512 CP); "
            "(b) enfermedad sobrevenida grave que impide el traslado; "
            "(c) peligro para la integridad o la libertad si regresa; "
            "(d) otras circunstancias humanitarias apreciadas discrecionalmente. "
            "Habilita para trabajar por cuenta ajena y propia."
        ),
        "documentos": [
            {
                "id": "solicitud_ex_humanitaria",
                "nombre": "Impreso de solicitud EX (razones humanitarias)",
                "obligatorio": True,
                "caduca": False,
                "notas": "Formulario EX correspondiente a circunstancias excepcionales.",
            },
            _PASAPORTE,
            {
                "id": "resolucion_o_informe_causa",
                "nombre": "Documento acreditativo de la causa humanitaria",
                "obligatorio": True,
                "caduca": False,
                "notas": (
                    "Segun supuesto: resolucion judicial/policial si victima de delito; "
                    "informe medico oficial si enfermedad; informe de ACNUR/ONG o del "
                    "Ministerio del Interior si peligro en origen."
                ),
            },
            {
                "id": "autorizacion_humanitaria_vigente",
                "nombre": "TIE o resolucion vigente por razon humanitaria (si ya la tenia)",
                "obligatorio": False,
                "caduca": True,
                "notas": "Si ya dispone de autorizacion por razones humanitarias y pide modificacion o renovacion.",
            },
            {
                "id": "contrato_trabajo",
                "nombre": "Contrato de trabajo u oferta firme de empleo",
                "obligatorio": False,
                "caduca": False,
                "notas": (
                    "Necesario si quiere que la autorizacion habilite para trabajar. "
                    "Firmado por empresa y trabajador; jornada minima 20 h/sem; SMI o convenio."
                ),
            },
            {
                "id": "documentacion_empresa",
                "nombre": "Documentacion de la empresa empleadora",
                "obligatorio": False,
                "caduca": False,
                "notas": "Alta en SS, CIF/NIF, IAE, escrituras o poder notarial, ultimas TC.",
            },
            _EMPADRONAMIENTO,
            _ANTECEDENTES_ORIGEN,
            _ANTECEDENTES_ESPANA,
            _VIDA_LABORAL,
            _TASA,
        ],
    },

    # ── 3. ARRAIGO SOCIAL ──────────────────────────────────────────────────────
    # Art. 124.1.a RD 1155/2024. En vigor desde 20/05/2025.
    # CAMBIO CLAVE: permanencia baja de 3 a 2 anos.
    # Integracion: informe CCAA/Ayto OR vinculos familiares con residente legal.
    # Contrato: minimo 20 h/sem, SMI, 1 ano si temporal.
    "arraigo_social": {
        "nombre": "Arraigo social",
        "anios_permanencia": 2,
        "descripcion": (
            "Autorizacion de residencia y trabajo por arraigo social (art. 124.1.a "
            "RD 1155/2024). Requiere 2 anos de permanencia continuada en Espana "
            "(ausencias maximas: 90 dias en los 2 anos). "
            "Acreditacion de integracion: informe social favorable de CCAA o "
            "Ayuntamiento (plazo maximo 30 dias para emitirlo) O documentacion "
            "de vinculos familiares con residente legal en Espana (conyuge/pareja "
            "de hecho, ascendiente o descendiente en 1er grado directo). "
            "Necesario contrato de trabajo de minimo 20 h/sem y retribucion no "
            "inferior al SMI o al convenio colectivo aplicable."
        ),
        "documentos": [
            {
                "id": "solicitud_ex10",
                "nombre": "Formulario EX-10 (arraigo) firmado",
                "obligatorio": True,
                "caduca": False,
                "notas": "Modelo EX-10 del Ministerio del Interior, cumplimentado.",
            },
            _PASAPORTE,
            _PRUEBA_PERMANENCIA_2,
            _EMPADRONAMIENTO,
            _ANTECEDENTES_ORIGEN,
            _ANTECEDENTES_ESPANA,
            {
                "id": "informe_integracion",
                "nombre": "Informe de integracion social (CCAA o Ayuntamiento)",
                "obligatorio": False,
                "caduca": True,
                "notas": (
                    "Alternativa A: informe favorable emitido por la CCAA o el Ayuntamiento "
                    "de residencia. Plazo de emision: 30 dias. Instruccion SEM 4/2025 "
                    "regula su contenido (tiempo residencia, medios, integracion sociolaboral)."
                ),
            },
            {
                "id": "vinculo_familiar_residente",
                "nombre": "Acreditacion de vinculo familiar con residente legal (alternativa al informe)",
                "obligatorio": False,
                "caduca": False,
                "notas": (
                    "Alternativa B al informe de integracion: documentacion del vínculo "
                    "(certificado matrimonio/pareja, nacimiento) + TIE o autorizacion "
                    "vigente del familiar + documentacion de medios economicos del familiar "
                    "residente (200% del IPREM entre ambos)."
                ),
            },
            {
                "id": "contrato_trabajo",
                "nombre": "Contrato de trabajo (minimo 20 h/sem, SMI, 1 ano si temporal)",
                "obligatorio": True,
                "caduca": False,
                "notas": (
                    "Firmado por empleador y trabajador. Jornada minima 20 h/semana "
                    "(pueden sumarse varios contratos). Retribucion minima: SMI o "
                    "convenio colectivo. Si es temporal: duracion minima 1 ano."
                ),
            },
            _VIDA_LABORAL,
            _TASA,
        ],
    },

    # ── 4. ARRAIGO SOCIOLABORAL ────────────────────────────────────────────────
    # Art. 124.1.b RD 1155/2024. Nuevo nombre para el anterior 'arraigo laboral'
    # con cambios sustanciales: permanencia baja a 2 anos (era 3), relacion
    # laboral exigida baja a 6 meses, se acepta cuenta propia, sin informe
    # de integracion.
    "arraigo_sociolaboral": {
        "nombre": "Arraigo sociolaboral",
        "anios_permanencia": 2,
        "descripcion": (
            "Autorizacion de residencia y trabajo por arraigo sociolaboral "
            "(art. 124.1.b RD 1155/2024, antes llamado arraigo laboral). "
            "Requiere 2 anos de permanencia continuada en Espana "
            "Y acreditar una relacion laboral de al menos 6 meses mediante: "
            "(a) resolucion judicial o acta de Inspeccion de Trabajo que reconozca "
            "la relacion, O (b) contrato de trabajo nuevo (minimo 20 h/sem, SMI). "
            "NOVEDAD: se acepta cuenta propia (alta como autonomo con actividad "
            "de al menos 6 meses o declaracion responsable de inicio de actividad). "
            "NO se exige informe de integracion social."
        ),
        "documentos": [
            {
                "id": "solicitud_ex10",
                "nombre": "Formulario EX-10 (arraigo) firmado",
                "obligatorio": True,
                "caduca": False,
                "notas": "Modelo EX-10 del Ministerio del Interior.",
            },
            _PASAPORTE,
            _PRUEBA_PERMANENCIA_2,
            _EMPADRONAMIENTO,
            _ANTECEDENTES_ORIGEN,
            _ANTECEDENTES_ESPANA,
            {
                "id": "resolucion_laboral",
                "nombre": "Resolucion judicial o acta de Inspeccion de Trabajo (6+ meses relacion laboral)",
                "obligatorio": False,
                "caduca": False,
                "notas": (
                    "Via A: resolucion judicial firme o acta de la ITSS que reconozca "
                    "relacion laboral de al menos 6 meses con empleador/es en Espana."
                ),
            },
            {
                "id": "contrato_trabajo",
                "nombre": "Contrato de trabajo (alternativa a resolucion, minimo 20 h/sem y 1 ano)",
                "obligatorio": False,
                "caduca": False,
                "notas": (
                    "Via B: contrato firmado por empleador y trabajador. Jornada minima "
                    "20 h/sem (pueden sumarse contratos). Si temporal, duracion minima 1 ano. "
                    "Retribucion: SMI o convenio colectivo."
                ),
            },
            {
                "id": "cuenta_propia",
                "nombre": "Alta en autónomos o declaracion responsable de actividad (cuenta propia)",
                "obligatorio": False,
                "caduca": False,
                "notas": (
                    "Via C (novedad RD 1155/2024): alta como autonomo con 6+ meses de "
                    "actividad acreditada O declaracion responsable de inicio de actividad "
                    "economica viable."
                ),
            },
            _VIDA_LABORAL,
            {
                "id": "documentacion_empresa",
                "nombre": "Documentacion de la empresa empleadora",
                "obligatorio": False,
                "caduca": False,
                "notas": "Alta en Seg. Social, CIF, IAE y TC si el empleador no es autonomo.",
            },
            _TASA,
        ],
    },

    # ── 5. ARRAIGO LABORAL (nomenclatura anterior, subsumido en sociolaboral) ───
    # Con el RD 1155/2024 esta figura se renombra 'arraigo sociolaboral'.
    # Se mantiene en la app para compatibilidad con expedientes historicos.
    # Permanencia 2 anos + acreditacion de relacion laboral previa por
    # resolucion judicial o acta de inspeccion (sin necesidad de contrato nuevo).
    "arraigo_laboral": {
        "nombre": "Arraigo laboral (via resolucion judicial / ITSS)",
        "anios_permanencia": 2,
        "descripcion": (
            "Modalidad del arraigo sociolaboral (art. 124.1.b RD 1155/2024) en la "
            "que se acredita la relacion laboral mediante resolucion judicial firme "
            "o acta de la Inspeccion de Trabajo (en lugar de presentar contrato nuevo). "
            "Util cuando hubo trabajo irregular o impagado documentado. "
            "Permanencia: 2 anos. Relacion laboral acreditada: minimo 6 meses."
        ),
        "documentos": [
            {
                "id": "solicitud_ex10",
                "nombre": "Formulario EX-10 (arraigo) firmado",
                "obligatorio": True,
                "caduca": False,
                "notas": "Modelo EX-10.",
            },
            _PASAPORTE,
            _PRUEBA_PERMANENCIA_2,
            _EMPADRONAMIENTO,
            _ANTECEDENTES_ORIGEN,
            _ANTECEDENTES_ESPANA,
            {
                "id": "resolucion_laboral",
                "nombre": "Resolucion judicial firme o acta de Inspeccion de Trabajo",
                "obligatorio": True,
                "caduca": False,
                "notas": (
                    "Documento que reconozca la existencia de relacion laboral de al "
                    "menos 6 meses: sentencia judicial, decreto, auto o acta de la ITSS."
                ),
            },
            _VIDA_LABORAL,
            {
                "id": "contrato_trabajo",
                "nombre": "Contrato de trabajo actual (opcional si ya se presenta resolucion)",
                "obligatorio": False,
                "caduca": False,
                "notas": "Puede aportarse adicionalmente para acreditar situacion laboral actual.",
            },
            _TASA,
        ],
    },

    # ── 6. ARRAIGO FAMILIAR ────────────────────────────────────────────────────
    # Art. 124.1.c RD 1155/2024. CAMBIO RADICAL respecto al RD 557/2011:
    # Ya NO aplica a familiares de espanoles (ellos usan 'Residencia temporal
    # familiar de espanol', art. 139+ RD 1155/2024).
    # Ahora solo dos supuestos:
    # A) Padre/madre/tutor de menor ciudadano UE/EEE/Suiza residente en Espana.
    # B) Cuidador de familiar con discapacidad ciudadano de UE/EEE/Suiza.
    # Duracion: 5 anos (no renovable como permiso de 1 ano; se obtiene directamente).
    "arraigo_familiar": {
        "nombre": "Arraigo familiar",
        "descripcion": (
            "Autorizacion de residencia y trabajo por arraigo familiar "
            "(art. 124.1.c RD 1155/2024). ATENCION: desde el 20/05/2025 este "
            "tramite ya NO aplica a familiares de ciudadanos espanoles "
            "(conyuge, hijos, ascendientes de espanol usan ahora la 'Autorizacion "
            "de residencia temporal de familiares de espanol', art. 139). "
            "Supuesto A: padre/madre o tutor de menor ciudadano de la UE/EEE/Suiza "
            "residente en Espana, que convive con el o ejerce obligaciones parentales. "
            "Supuesto B: cuidador de familiar con discapacidad (ciudadano UE/EEE/Suiza) "
            "con el que convive y cuyo apoyo es necesario para su capacidad juridica. "
            "Duracion: 5 anos."
        ),
        "documentos": [
            {
                "id": "solicitud_ex10",
                "nombre": "Formulario EX-10 (arraigo) firmado",
                "obligatorio": True,
                "caduca": False,
                "notas": "Modelo EX-10.",
            },
            _PASAPORTE,
            _EMPADRONAMIENTO,
            _ANTECEDENTES_ORIGEN,
            _ANTECEDENTES_ESPANA,
            {
                "id": "vinculo_familiar",
                "nombre": "Acreditacion del vinculo familiar",
                "obligatorio": True,
                "caduca": False,
                "notas": (
                    "Libro de familia, certificado de nacimiento del menor o "
                    "documentacion de relacion familiar con la persona con discapacidad."
                ),
            },
            {
                "id": "documentacion_menor_ue",
                "nombre": "Documentacion del menor o familiar UE/EEE/Suiza (pasaporte/NIE UE)",
                "obligatorio": True,
                "caduca": True,
                "notas": (
                    "Pasaporte, DNI europeo o NIE del familiar que es ciudadano de "
                    "la UE/EEE/Suiza. Debe acreditarse su residencia en Espana."
                ),
            },
            {
                "id": "empadronamiento_conjunto",
                "nombre": "Empadronamiento conjunto con el familiar",
                "obligatorio": True,
                "caduca": True,
                "notas": "Acredita convivencia efectiva en el mismo domicilio.",
            },
            {
                "id": "certificado_discapacidad",
                "nombre": "Certificado de discapacidad (solo supuesto B: cuidador)",
                "obligatorio": False,
                "caduca": False,
                "notas": "Solo si el supuesto es cuidado de familiar con discapacidad. Emitido por organismo competente.",
            },
            _TASA,
        ],
    },

    # ── 7. ARRAIGO PARA LA FORMACION (ARRAIGO SOCIOFORMATIVO) ─────────────────
    # Art. 124.1.d RD 1155/2024 + Instrucciones SEM 1/2025.
    # Nuevo nombre oficial: arraigo socioformativo.
    # Formaciones validas segun SEM 1/2025: FP Basico, FP Medio y certificados
    # de profesionalidad nivel 1 y 2. FP Superior excluido (SEM 1/2025).
    # Novedad: permite trabajar hasta 30 h/sem durante la formacion.
    "arraigo_formacion": {
        "nombre": "Arraigo socioformativo (para la formacion)",
        "anios_permanencia": 2,
        "descripcion": (
            "Autorizacion de residencia por arraigo socioformativo "
            "(art. 124.1.d RD 1155/2024; antes: arraigo para la formacion). "
            "Requiere 2 anos de permanencia continuada en Espana y compromiso "
            "de matricula en formacion reglada valida. "
            "Formaciones admitidas (SEM 1/2025): FP Basico, FP Medio, "
            "certificados de profesionalidad nivel 1 y 2 impartidos en "
            "centros publicos o privados autorizados. FP Superior excluido. "
            "Duracion: 12 meses renovables. NOVEDAD: habilita para trabajar "
            "hasta 30 horas semanales durante la formacion. "
            "La renovacion requiere informe de aprovechamiento del centro."
        ),
        "documentos": [
            {
                "id": "solicitud_ex10",
                "nombre": "Formulario EX-10 (arraigo) firmado",
                "obligatorio": True,
                "caduca": False,
                "notas": "Modelo EX-10.",
            },
            _PASAPORTE,
            _PRUEBA_PERMANENCIA_2,
            _EMPADRONAMIENTO,
            _ANTECEDENTES_ORIGEN,
            _ANTECEDENTES_ESPANA,
            {
                "id": "matricula_o_admision",
                "nombre": "Carta de admision o matricula en la formacion (FP Basico/Medio o Cert. Profesionalidad)",
                "obligatorio": True,
                "caduca": False,
                "notas": (
                    "Documento oficial del centro de formacion (publico o privado autorizado). "
                    "Debe indicar el ciclo o certificado, la duracion y que el solicitante "
                    "esta matriculado o ha sido admitido. FP Superior no es valido."
                ),
            },
            {
                "id": "informe_aprovechamiento",
                "nombre": "Informe de aprovechamiento del centro (solo para renovacion)",
                "obligatorio": False,
                "caduca": False,
                "notas": "Solo exigible en la renovacion. Certifica que el alumno promociona al siguiente curso.",
            },
            _TASA,
        ],
    },

    # ── 8. ARRAIGO DE SEGUNDA OPORTUNIDAD ─────────────────────────────────────
    # Art. 124.1.e RD 1155/2024. Nueva figura creada por el nuevo Reglamento.
    # Para quienes tuvieron autorizacion de residencia (NO por circunstancias
    # excepcionales) en los 2 anos anteriores y no pudieron renovarla
    # (caducidad por simple transcurso del tiempo, no por expulsion/renuncia).
    "arraigo_segunda_oportunidad": {
        "nombre": "Arraigo de segunda oportunidad",
        "anios_permanencia": 2,
        "descripcion": (
            "Autorizacion de residencia y trabajo por arraigo de segunda oportunidad "
            "(art. 124.1.e RD 1155/2024). "
            "Requisitos: (a) haber sido titular de una autorizacion de residencia "
            "(NO por circunstancias excepcionales) en los 2 anos anteriores a la "
            "solicitud, que haya caducado por mero transcurso del tiempo "
            "(no por expulsion, renuncia u otra causa de extincion); "
            "(b) permanencia continuada en Espana durante al menos 2 anos. "
            "Duracion: 1 ano, renovable por 1 ano adicional."
        ),
        "documentos": [
            {
                "id": "solicitud_ex10",
                "nombre": "Formulario EX-10 (arraigo) firmado",
                "obligatorio": True,
                "caduca": False,
                "notas": "Modelo EX-10.",
            },
            _PASAPORTE,
            _PRUEBA_PERMANENCIA_2,
            _EMPADRONAMIENTO,
            _ANTECEDENTES_ORIGEN,
            _ANTECEDENTES_ESPANA,
            {
                "id": "autorizacion_previa",
                "nombre": "Acreditacion de autorizacion de residencia previa (caducada en los ultimos 2 anos)",
                "obligatorio": True,
                "caduca": False,
                "notas": (
                    "TIE, tarjeta de residencia, resolucion de concesion o cualquier "
                    "documento que acredite haber sido titular de autorizacion de residencia "
                    "ordinaria (no por circunstancias excepcionales) caducada por "
                    "transcurso del tiempo. La autorizacion no puede haber sido revocada "
                    "ni extinguida por expulsion o renuncia."
                ),
            },
            _VIDA_LABORAL,
            _TASA,
        ],
    },
}


# ---------------------------------------------------------------------------
# Conjunto ACTIVO de tramites
# ---------------------------------------------------------------------------
# Arranca con los valores por defecto y puede sustituirse por una version
# personalizada cargada desde disco (config.py).
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
