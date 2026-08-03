'use strict';

// CRM de WhatsApp para gestorías — servidor HTTP sin dependencias externas.
// Ejecutar con: node server.js  (Node.js 18 o superior)

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./lib/store');
const { load, save, newId, normalizePhone, DB_FILE } = store;
const wa = require('./lib/whatsapp');
const auto = require('./lib/automations');
const backup = require('./lib/backup');
const msgraph = require('./lib/msgraph');
const security = require('./lib/security');
const transcribe = require('./lib/transcribe');
const pdfsign = require('./lib/pdfsign');
const documentos = require('./lib/documentos');
const telegram = require('./lib/telegram');
const sumup = require('./lib/sumup');
const assistant = require('./lib/assistant');

const PORT = Number(process.env.PORT || 3000);
// Formas de cobro del honorario. «banco» se mantiene por compatibilidad con
// cobros antiguos; las opciones nuevas son efectivo/transferencia/tarjeta.
const PAY_METHODS = ['caja', 'transferencia', 'tarjeta', 'banco'];
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(path.dirname(DB_FILE), 'uploads');
const STICKERS_DIR = path.join(PUBLIC_DIR, 'stickers');

// Fichas de trámite predefinidas, organizadas en «packs». Cada pack se aplica
// una sola vez: así se pueden añadir fichas nuevas por código y aparecen tras
// desplegar, sin duplicar las que la gestoría ya tenga o haya editado.
const FICHA_PACKS = {
  // Ejemplos iniciales (editables).
  'ejemplos-v1': [
    {
      title: 'Arraigo social', area: 'extranjeria',
      intro: 'Hola {nombre} 👋 Para tramitar tu {tramite} necesitamos que nos envíes la siguiente documentación:',
      docs: '• Pasaporte completo (todas las páginas)\n• Certificado de empadronamiento histórico\n• Contrato de trabajo o medios económicos\n• Certificado de antecedentes penales del país de origen (apostillado)\n• Antecedentes penales en España\n• Certificado de empadronamiento actual',
      notes: 'Cuando lo tengas, envíanoslo por aquí mismo (foto o PDF). Cualquier duda, te ayudamos. 📲',
    },
    {
      title: 'Alta de autónomo', area: 'fiscal',
      intro: 'Hola {nombre} 👋 Para darte de alta como autónomo necesitamos:',
      docs: '• DNI o NIE por ambas caras\n• Número de cuenta bancaria (IBAN)\n• Descripción de la actividad que vas a ejercer\n• Dirección de la actividad',
      notes: 'Con esto tramitamos el alta en Hacienda (036) y en la Seguridad Social (RETA).',
    },
    {
      title: 'Declaración de la renta', area: 'fiscal',
      intro: 'Hola {nombre} 👋 Para tu declaración de la renta necesitamos:',
      docs: '• DNI\n• Certificados de ingresos (nóminas, pensiones…)\n• Certificado de prestaciones (SEPE) si las hubo\n• Datos de vivienda (recibo IBI o referencia catastral)\n• Certificados bancarios y de inversiones\n• Justificantes de donativos o deducciones',
      notes: '',
    },
  ],
  // Trámites de tráfico (DGT). Documentación según la sede electrónica de la
  // DGT; la gestoría confirma tasas oficiales y particularidades de cada caso.
  'trafico-v1': [
    {
      title: 'Transferencia (cambio de titularidad)', area: 'vehiculos',
      intro: 'Hola {nombre} 👋 Para el cambio de titularidad del vehículo necesitamos:',
      docs: '• DNI, NIE o pasaporte del comprador y del vendedor (en vigor)\n• Permiso de circulación del vehículo\n• Ficha técnica (tarjeta ITV) con la ITV en vigor\n• Contrato de compraventa firmado por ambas partes (o factura si vende una empresa)\n• Justificante del último Impuesto de Circulación (IVTM) pagado',
      notes: 'El vehículo debe estar libre de cargas y al día de multas e impuestos. Calculamos el ITP de tu comunidad y presentamos el trámite en la DGT. 📲',
    },
    {
      title: 'Notificación de venta', area: 'vehiculos',
      intro: 'Hola {nombre} 👋 Para comunicar a la DGT que has vendido tu vehículo necesitamos:',
      docs: '• DNI o NIE del vendedor\n• Contrato de compraventa firmado por ambas partes\n• Datos del comprador (nombre y DNI/NIE)\n• Matrícula del vehículo',
      notes: 'Debe comunicarse en un máximo de 10 días desde la venta. Con esto dejas de ser responsable del vehículo.',
    },
    {
      title: 'Duplicado del permiso de circulación', area: 'vehiculos',
      intro: 'Hola {nombre} 👋 Para el duplicado del permiso de circulación (pérdida, robo o deterioro) necesitamos:',
      docs: '• DNI o NIE del titular\n• Matrícula del vehículo\n• En caso de robo, copia de la denuncia (si la hubiera)',
      notes: 'Lo tramitamos online. Te avisamos cuando esté listo.',
    },
    {
      title: 'Baja definitiva de vehículo', area: 'vehiculos',
      intro: 'Hola {nombre} 👋 Para dar de baja definitiva el vehículo necesitamos:',
      docs: '• DNI o NIE del titular\n• Permiso de circulación\n• Ficha técnica (tarjeta ITV)\n• Certificado de destrucción del CAT (centro autorizado), si va a desguace',
      notes: 'La baja definitiva implica que el vehículo ya no puede circular ni venderse.',
    },
    {
      title: 'Matriculación de vehículo', area: 'vehiculos',
      intro: 'Hola {nombre} 👋 Para matricular el vehículo necesitamos:',
      docs: '• DNI, NIE o CIF del titular\n• Ficha técnica (tarjeta ITV) con la ITV pasada\n• Justificante del Impuesto de Matriculación y del IVTM (impuesto municipal)\n• Factura de compra o documentación de importación (si viene del extranjero)',
      notes: 'Al terminar te entregamos el número de matrícula y el permiso de circulación. Confirmamos las tasas según el vehículo.',
    },
    {
      title: 'Duplicado del permiso de conducir', area: 'vehiculos',
      intro: 'Hola {nombre} 👋 Para el duplicado del carné de conducir (deterioro, pérdida o robo) necesitamos:',
      docs: '• DNI, NIE o pasaporte en vigor\n• Permiso de conducir original (salvo robo o extravío)\n• Una foto reciente (si la solicita la Jefatura)',
      notes: 'Lo gestionamos online con firma digital o con cita previa.',
    },
    {
      title: 'Renovación del permiso de conducir', area: 'vehiculos',
      intro: 'Hola {nombre} 👋 Para renovar el carné de conducir necesitamos:',
      docs: '• DNI, NIE o pasaporte en vigor\n• Permiso de conducir a renovar (aunque esté caducado)\n• Informe de aptitud psicofísica de un Centro de Reconocimiento de Conductores\n• Una foto reciente',
      notes: 'El reconocimiento médico se hace en un centro autorizado; nosotros tramitamos la renovación en la DGT.',
    },
    {
      title: 'Canje de permiso de conducir extranjero', area: 'vehiculos',
      intro: 'Hola {nombre} 👋 Para canjear tu permiso de conducir extranjero necesitamos:',
      docs: '• Permiso de conducir extranjero original, en vigor\n• DNI, NIE o pasaporte y tarjeta de residencia\n• Certificado de empadronamiento (acredita tu residencia)\n• Informe de aptitud psicofísica de un Centro de Reconocimiento de Conductores\n• Una foto reciente',
      notes: 'Solo para países con acuerdo de canje. Comprobamos si tu país tiene convenio y te lo confirmamos.',
    },
  ],
  // Extranjería, según el nuevo Reglamento (RD 1155/2024, en vigor desde el
  // 20/05/2025) y la Instrucción SEM 1/2025 sobre arraigos. La documentación
  // exacta varía en cada caso: la gestoría la confirma según la situación.
  'extranjeria-v1': [
    {
      title: 'Arraigo social (2025)', area: 'extranjeria',
      intro: 'Hola {nombre} 👋 Para tu arraigo social (residencia por circunstancias excepcionales) necesitamos:',
      docs: '• Solicitud oficial EX-10 firmada\n• Pasaporte completo en vigor (todas las páginas)\n• Empadronamiento histórico que acredite al menos 2 años en España\n• Antecedentes penales del país de origen (apostillados/legalizados y traducidos)\n• Antecedentes penales en España\n• Medios económicos: contrato/nóminas, cuenta bancaria o medios propios\n• Informe de integración social o acreditación de vínculos familiares con residente legal',
      notes: '⚠️ Las ausencias no pueden superar 90 días en los 2 años. Cada caso es distinto: confirmamos tu documentación exacta según tu situación y la Instrucción SEM 1/2025.',
    },
    {
      title: 'Arraigo sociolaboral', area: 'extranjeria',
      intro: 'Hola {nombre} 👋 Para tu arraigo sociolaboral necesitamos:',
      docs: '• Solicitud oficial EX-10 firmada\n• Pasaporte completo en vigor\n• Empadronamiento histórico (al menos 2 años en España)\n• Antecedentes penales del país de origen (apostillados y traducidos)\n• Antecedentes penales en España\n• Uno o varios contratos de trabajo de al menos 20 horas semanales (con el SMI o el convenio aplicable)',
      notes: '⚠️ Cada caso es distinto; confirmamos tu documentación exacta según tu situación y la Instrucción SEM 1/2025.',
    },
    {
      title: 'Arraigo socioformativo', area: 'extranjeria',
      intro: 'Hola {nombre} 👋 Para tu arraigo socioformativo necesitamos:',
      docs: '• Solicitud oficial EX-10 firmada\n• Pasaporte completo en vigor\n• Empadronamiento histórico (al menos 2 años en España)\n• Antecedentes penales del país de origen (apostillados y traducidos) y de España\n• Matrícula o compromiso de matrícula en una formación válida (mínimo 50% presencial)\n• Informe de integración social del Ayuntamiento o Comunidad Autónoma',
      notes: '⚠️ La formación 100% a distancia no sirve. Si la matrícula tiene un plazo oficial, hay que presentar la solicitud en los 2 meses anteriores. Confirmamos tu caso según la Instrucción SEM 1/2025.',
    },
    {
      title: 'Arraigo familiar', area: 'extranjeria',
      intro: 'Hola {nombre} 👋 Para tu arraigo familiar (no exige tiempo mínimo de residencia) necesitamos:',
      docs: '• Solicitud oficial EX-10 firmada\n• Pasaporte completo en vigor\n• Documento del vínculo: libro de familia o certificado de nacimiento del menor español o de la UE\n• DNI del menor español (o documento del familiar de la UE)\n• Antecedentes penales del país de origen (apostillados y traducidos) y de España\n• Empadronamiento',
      notes: 'Para padres/tutores de un menor español o de la UE, o apoyo a persona con discapacidad de la UE. Autorización de 5 años. ⚠️ Confirmamos tu supuesto según la Instrucción SEM 1/2025.',
    },
    {
      title: 'Arraigo de segunda oportunidad', area: 'extranjeria',
      intro: 'Hola {nombre} 👋 Para tu arraigo de segunda oportunidad necesitamos:',
      docs: '• Solicitud oficial EX-10 firmada\n• Pasaporte completo en vigor\n• Empadronamiento histórico (al menos 2 años en España)\n• Antecedentes penales del país de origen (apostillados y traducidos) y de España\n• Documentación de la residencia legal que tuviste antes en España (TIE o tarjeta caducada)',
      notes: 'Para quien ya tuvo residencia legal y no pudo renovarla. Concede 1 año con permiso de trabajo. ⚠️ Confirmamos tu caso según la Instrucción SEM 1/2025.',
    },
    {
      title: 'Reagrupación familiar', area: 'extranjeria',
      intro: 'Hola {nombre} 👋 Para reagrupar a tu familia en España necesitamos:',
      docs: '• Solicitud oficial EX-02 firmada\n• Pasaporte y TIE/NIE del reagrupante\n• Empadronamiento de la unidad familiar\n• Documentos del vínculo (matrimonio, nacimiento…) legalizados y traducidos\n• Medios económicos suficientes (nóminas, contrato, renta): mínimo 150% del IPREM\n• Informe de vivienda adecuada\n• Justificante de la tasa (modelo 790, código 052)',
      notes: '⚠️ Necesitas al menos 1 año de residencia legal renovada. Confirmamos los requisitos según tu régimen (general, familiar de español o comunitario).',
    },
    {
      title: 'Nacionalidad española por residencia', area: 'extranjeria',
      intro: 'Hola {nombre} 👋 Para tu solicitud de nacionalidad por residencia necesitamos:',
      docs: '• Certificado de nacimiento del país de origen (apostillado/legalizado y traducido)\n• Pasaporte completo en vigor y TIE\n• Antecedentes penales del país de origen (apostillados y traducidos)\n• Antecedentes penales en España\n• Certificado de empadronamiento\n• Certificado de residencia legal (lo emite Extranjería)\n• Diplomas CCSE y DELE A2 (salvo exenciones)\n• Justificante del pago de la tasa',
      notes: 'El tiempo de residencia exigido depende de tu caso (10 años general, 2 para iberoamericanos, 1 casado/a con español/a…). ⚠️ Te confirmamos tu plazo y documentación.',
    },
    {
      title: 'Renovación de residencia (TIE)', area: 'extranjeria',
      intro: 'Hola {nombre} 👋 Para renovar tu tarjeta de residencia necesitamos:',
      docs: '• Solicitud en el modelo oficial que corresponda a tu tarjeta\n• Pasaporte completo en vigor\n• TIE actual\n• Documentación de que mantienes los requisitos (contrato/nóminas, medios económicos, matrícula escolar de los hijos…)\n• Empadronamiento\n• Justificante de la tasa',
      notes: 'Puedes renovar hasta 90 días antes de la caducidad (y hasta 90 días después). ⚠️ Confirmamos la documentación según tu tipo de tarjeta.',
    },
  ],
  // Modificación de la residencia por razones humanitarias a residencia y
  // trabajo, reactivada por el RD 316/2026 (art. 191.7, en vigor 16/04/2026).
  'extranjeria-humanitarias-v1': [
    {
      title: 'Modificación por razones humanitarias (a residencia y trabajo)', area: 'extranjeria',
      intro: 'Hola {nombre} 👋 Para modificar tu residencia por razones humanitarias a residencia y trabajo necesitamos:',
      docs: '• Solicitud en el modelo oficial (EX-03 si es por cuenta ajena, EX-07 si es por cuenta propia)\n• Pasaporte completo en vigor\n• TIE de tu residencia por razones humanitarias en vigor\n• Por cuenta ajena: contrato de trabajo firmado (jornada y salario según convenio o SMI) y datos de la empresa\n• Por cuenta propia: plan de negocio, inversiones previstas y licencias/permisos de la actividad\n• Antecedentes penales si te los requieren\n• Justificante de la tasa',
      notes: 'Posible desde el 16/04/2026 (RD 316/2026, art. 191.7) para titulares de residencia humanitaria anual por protección internacional. ⚠️ Confirmamos tu documentación exacta según tu caso (cuenta ajena o propia).',
    },
  ],
  // Prestaciones de la Seguridad Social (INSS). Documentación según la sede
  // electrónica de la Seguridad Social; se confirma según cada caso.
  'pensiones-v1': [
    {
      title: 'Pensión de jubilación', area: 'pensiones',
      intro: 'Hola {nombre} 👋 Para tramitar tu pensión de jubilación necesitamos:',
      docs: '• DNI o NIE del solicitante (y del cónyuge si lo hubiera)\n• Número de cuenta bancaria (IBAN) a tu nombre\n• Informe de vida laboral\n• Certificado de empresa o documento de cese en la actividad\n• Libro de familia o certificado de matrimonio (si hay cónyuge a cargo)',
      notes: 'Puede solicitarse hasta 3 meses antes de la fecha de jubilación. Revisamos tu vida laboral y calculamos la mejor fecha para tu pensión.',
    },
    {
      title: 'Pensión de incapacidad permanente', area: 'pensiones',
      intro: 'Hola {nombre} 👋 Para tu pensión de incapacidad permanente necesitamos:',
      docs: '• DNI o NIE\n• Número de cuenta bancaria (IBAN) a tu nombre\n• Informes médicos y pruebas que acrediten tu estado de salud\n• Informe de vida laboral\n• Partes de baja de la incapacidad temporal, si procede',
      notes: 'El Equipo de Valoración de Incapacidades (EVI) valora el grado. Preparamos y presentamos todo el expediente médico y laboral.',
    },
    {
      title: 'Pensión de viudedad', area: 'pensiones',
      intro: 'Hola {nombre} 👋 Para tu pensión de viudedad necesitamos:',
      docs: '• DNI o NIE del solicitante\n• Número de cuenta bancaria (IBAN) a tu nombre\n• Certificado de defunción del cónyuge o pareja\n• Libro de familia o certificado de matrimonio (o de pareja de hecho registrada)\n• Datos o vida laboral de la persona fallecida (si se dispone)',
      notes: 'Conviene solicitarla cuanto antes. Puede compatibilizarse con otros ingresos. ⚠️ Confirmamos tu caso.',
    },
    {
      title: 'Pensión de orfandad', area: 'pensiones',
      intro: 'Hola {nombre} 👋 Para la pensión de orfandad necesitamos:',
      docs: '• DNI o NIE del huérfano (o del representante si es menor)\n• Número de cuenta bancaria (IBAN)\n• Certificado de defunción del progenitor\n• Libro de familia o certificado de nacimiento\n• Si es mayor de edad: justificante de estudios o de la situación que da derecho',
      notes: 'Se suele solicitar junto con la viudedad cuando procede.',
    },
    {
      title: 'Ingreso Mínimo Vital (IMV)', area: 'pensiones',
      intro: 'Hola {nombre} 👋 Para solicitar el Ingreso Mínimo Vital necesitamos:',
      docs: '• DNI o NIE de todos los miembros de la unidad de convivencia\n• Certificado de empadronamiento colectivo histórico\n• Número de cuenta bancaria (IBAN)\n• Justificantes de ingresos y patrimonio de la unidad de convivencia\n• Libro de familia (si hay menores)',
      notes: '⚠️ La documentación exacta depende de tu unidad de convivencia. Revisamos si cumples los requisitos económicos antes de presentar.',
    },
    {
      title: 'Prestación por nacimiento y cuidado de menor', area: 'pensiones',
      intro: 'Hola {nombre} 👋 Para la prestación por nacimiento y cuidado de menor (maternidad/paternidad) necesitamos:',
      docs: '• DNI, NIE o pasaporte de los progenitores\n• Número de cuenta bancaria (IBAN)\n• Libro de familia o certificado de inscripción del hijo en el Registro Civil\n• Informe de maternidad del Servicio Público de Salud\n• Certificado de empresa con la fecha de inicio del descanso (trabajadores por cuenta ajena)',
      notes: 'Se solicita tras el nacimiento (o la resolución de adopción/acogimiento).',
    },
  ],
  // Prestaciones por desempleo (SEPE).
  'sepe-v1': [
    {
      title: 'Prestación por desempleo (paro contributivo)', area: 'pensiones',
      intro: 'Hola {nombre} 👋 Para solicitar el paro (prestación contributiva) necesitamos:',
      docs: '• DNI o NIE (y de los hijos a cargo, si los hay)\n• Certificado de empresa del último trabajo\n• Carta de despido o documento de fin de contrato\n• Número de cuenta bancaria (IBAN) a tu nombre\n• Libro de familia (si hay hijos a cargo)',
      notes: 'Debes solicitarlo en los 15 días hábiles siguientes al cese y estar inscrito como demandante de empleo. Lo tramitamos en el SEPE por ti.',
    },
    {
      title: 'Subsidio por desempleo', area: 'pensiones',
      intro: 'Hola {nombre} 👋 Para el subsidio por desempleo necesitamos:',
      docs: '• DNI o NIE de todos los miembros de la unidad familiar\n• Justificantes de ingresos de la unidad familiar\n• Libro de familia o certificado del Registro Civil\n• Número de cuenta bancaria (IBAN)\n• Documentación específica de tu caso (agotamiento de la prestación, retorno de emigrante, excarcelación…)',
      notes: '⚠️ Requiere no superar el límite de rentas. Revisamos si tienes derecho y a qué modalidad de subsidio.',
    },
  ],
  // Servicios sociales y trámites de la Junta de Comunidades de Castilla-La
  // Mancha (JCCM). Documentación según la sede electrónica de la JCCM.
  'jccm-social-v1': [
    {
      title: 'Reconocimiento de la situación de dependencia', area: 'social',
      intro: 'Hola {nombre} 👋 Para solicitar el reconocimiento de dependencia en Castilla-La Mancha necesitamos:',
      docs: '• DNI o NIE de la persona dependiente (y del representante, si lo hay)\n• Informe de salud (SESCAM, MUFACE, ISFAS o MUGEJU)\n• Certificado de empadronamiento\n• Documento que acredite la representación, si actúa otra persona',
      notes: 'Regulado por el Decreto 1/2019 de CLM. La solicitud incluye declaraciones responsables; la mayoría de datos se consultan de oficio salvo que te opongas. Se presenta en Servicios Sociales o en la sede electrónica.',
    },
    {
      title: 'Reconocimiento del grado de discapacidad', area: 'social',
      intro: 'Hola {nombre} 👋 Para el reconocimiento del grado de discapacidad en Castilla-La Mancha necesitamos:',
      docs: '• DNI o NIE de la persona interesada (y del representante, si lo hay)\n• Informes médicos y/o psicológicos que acrediten las deficiencias alegadas\n• Certificado de empadronamiento',
      notes: 'Regulado por la Orden 81/2023 de CLM. Te valoran los equipos multiprofesionales de la delegación provincial. Preparamos y presentamos el expediente.',
    },
    {
      title: 'Ingreso Mínimo de Solidaridad (IMS) — CLM', area: 'social',
      intro: 'Hola {nombre} 👋 Para el Ingreso Mínimo de Solidaridad de Castilla-La Mancha necesitamos:',
      docs: '• DNI o NIE de todos los miembros de la unidad familiar\n• Certificado de empadronamiento\n• Justificantes de ingresos y de la situación de la unidad familiar\n• Número de cuenta bancaria (IBAN)',
      notes: 'Se tramita a través de los Servicios Sociales de tu localidad, que valoran el caso (Ley 5/1995 de CLM). ⚠️ La documentación exacta la determina el trabajador social.',
    },
    {
      title: 'Título de familia numerosa (CLM)', area: 'social',
      intro: 'Hola {nombre} 👋 Para el título de familia numerosa necesitamos:',
      docs: '• DNI o NIE de los progenitores e hijos (DNI los mayores de 14 años)\n• Libro de familia completo\n• Certificado de empadronamiento de la unidad familiar\n• Fotografías tamaño carné (si las solicitan)\n• Justificantes en su caso (discapacidad, estudios de hijos mayores de 21…)',
      notes: 'Da acceso a descuentos y beneficios. Lo tramitamos en la Junta de Comunidades de CLM.',
    },
    {
      title: 'Título de familia monoparental (CLM)', area: 'social',
      intro: 'Hola {nombre} 👋 Para el título de familia monoparental necesitamos:',
      docs: '• DNI o NIE del progenitor e hijos\n• Libro de familia\n• Documentación que acredite la monoparentalidad (sentencia, certificado de defunción, etc.)\n• Certificado de empadronamiento',
      notes: 'Título propio de Castilla-La Mancha con beneficios para familias monoparentales.',
    },
  ],
};

// Aplica los packs de fichas que aún no se hayan cargado en esta base de datos.
function ensureDefaultFichas(db) {
  if (!db.settings) db.settings = {};
  if (!Array.isArray(db.settings.fichaPacks)) db.settings.fichaPacks = [];
  // Compatibilidad: si los ejemplos ya se sembraron con el sistema anterior,
  // marcamos ese pack como aplicado para no duplicarlos.
  if (db.settings.fichasSeeded && !db.settings.fichaPacks.includes('ejemplos-v1')) {
    db.settings.fichaPacks.push('ejemplos-v1');
  }
  let changed = false;
  for (const [packId, fichas] of Object.entries(FICHA_PACKS)) {
    if (db.settings.fichaPacks.includes(packId)) continue;
    for (const f of fichas) db.fichas.push({ id: newId('fic'), ...f, createdAt: Date.now() });
    db.settings.fichaPacks.push(packId);
    db.settings.fichasSeeded = true;
    changed = true;
  }
  if (changed) save();
}

// ---------------------------------------------------------------------------
// Base de conocimiento de trámites (tarifas, tasas y documentos).
// Referencia interna de consulta rápida: se busca un trámite y se inserta la
// respuesta (honorarios + tasas orientativas + documentos) en el chat.
// Los importes de honorarios provienen del flujo de bienvenida de la gestoría;
// las tasas oficiales son orientativas y José las confirma según cada caso.
// ---------------------------------------------------------------------------
const KNOWLEDGE_PACK = {
  'tarifas-v1': [
    {
      title: 'Arraigo social', area: 'extranjeria', keywords: 'arraigo residencia extranjeria papeles ex10',
      fee: '300 €', tax: 'Tasa 790 cód. 052 (residencia temporal) + Tasa 790 cód. 012 al expedir la TIE. Orientativas; se confirman según el caso.',
      docs: '• Pasaporte completo en vigor\n• Empadronamiento histórico (2 años en España)\n• Antecedentes penales del país de origen (apostillados y traducidos)\n• Antecedentes penales en España\n• Medios económicos (contrato/nóminas o medios propios)\n• Informe de integración social o vínculos familiares',
      notes: 'A los honorarios se añaden las tasas oficiales. Confirmamos tu caso según la Instrucción SEM 1/2025.',
    },
    {
      title: 'Arraigo familiar', area: 'extranjeria', keywords: 'arraigo familiar hijo espanol progenitor',
      fee: '300 €', tax: 'Tasa 790 cód. 012 al expedir la TIE (orientativa).',
      docs: '• Pasaporte completo en vigor\n• Partida de nacimiento / libro de familia\n• DNI del familiar español o documentación del menor\n• Empadronamiento\n• Antecedentes penales (según el caso)',
      notes: 'Para progenitores de menor español o familiares de ciudadano español.',
    },
    {
      title: 'Nacionalidad española', area: 'extranjeria', keywords: 'nacionalidad ccse dele juramento espanol',
      fee: '400 €', tax: 'Tasa 790 cód. 026: 104,05 € (orientativa). Exámenes CCSE y DELE aparte (Instituto Cervantes).',
      docs: '• Certificado de nacimiento del país de origen (apostillado y traducido)\n• Certificado de antecedentes penales del país de origen\n• Pasaporte y tarjeta de residencia en vigor\n• Empadronamiento\n• Diplomas CCSE y DELE A2 (salvo exenciones)\n• Certificado de antecedentes penales en España',
      notes: 'Por residencia (10, 5, 2 años o 1 año según el caso). Confirmamos el plazo que te aplica.',
    },
    {
      title: 'Reagrupación familiar', area: 'extranjeria', keywords: 'reagrupacion familia conyuge hijos',
      fee: '375 €', tax: 'Tasa 790 cód. 052 + tasa de visado (en el consulado). Orientativas.',
      docs: '• Pasaporte del reagrupante y de los reagrupados\n• Tarjeta de residencia del reagrupante\n• Libro de familia / certificados de matrimonio y nacimiento (apostillados y traducidos)\n• Contrato de trabajo y nóminas (medios económicos)\n• Informe de vivienda adecuada\n• Seguro médico',
      notes: 'Se tramita en dos fases: autorización en España y visado en el consulado.',
    },
    {
      title: 'Residencia de larga duración', area: 'extranjeria', keywords: 'larga duracion permanente 5 anos renovacion residencia',
      fee: '350 €', tax: 'Tasa 790 cód. 052 + Tasa 790 cód. 012 (TIE). Orientativas.',
      docs: '• Pasaporte en vigor\n• Tarjeta de residencia actual\n• Empadronamiento\n• Acreditación de 5 años de residencia legal y continuada',
      notes: 'Para quien lleva 5 años de residencia legal continuada en España.',
    },
    {
      title: 'Paso de razones humanitarias a residencia y trabajo', area: 'extranjeria', keywords: 'humanitarias modificacion residencia trabajo',
      fee: '350 €', tax: 'Tasa 790 cód. 052 + Tasa 790 cód. 012 (TIE). Orientativas.',
      docs: '• Pasaporte en vigor\n• Tarjeta de residencia por razones humanitarias\n• Contrato de trabajo o acreditación de medios\n• Empadronamiento\n• Antecedentes penales en España',
      notes: 'Modificación de la situación de residencia. Confirmamos requisitos según tu tarjeta actual.',
    },
    {
      title: 'Transferencia (cambio de titular)', area: 'vehiculos', keywords: 'transferencia coche vehiculo cambio titular compraventa itp',
      fee: '70 €', tax: 'Tasa DGT 55,70 € (orientativa) + ITP según tu comunidad autónoma (lo calculamos sin compromiso).',
      docs: '• DNI/NIE del comprador y del vendedor\n• Permiso de circulación\n• Ficha técnica (ITV en vigor)\n• Contrato de compraventa firmado\n• Último IVTM (impuesto de circulación) pagado',
      notes: 'El vehículo debe estar libre de cargas y al día de multas e impuestos.',
    },
    {
      title: 'Matriculación / importación', area: 'vehiculos', keywords: 'matriculacion importacion matricular vehiculo extranjero',
      fee: 'desde 150 €', tax: 'Tasa DGT + Impuesto de Matriculación + IVTM municipal (según el vehículo). Orientativas.',
      docs: '• DNI/NIE o CIF del titular\n• Ficha técnica con ITV pasada\n• Factura de compra o documentación de importación\n• Justificante de impuestos (matriculación e IVTM)',
      notes: 'Confirmamos las tasas e impuestos según el vehículo y su procedencia.',
    },
    {
      title: 'Canje de permiso de conducir extranjero', area: 'vehiculos', keywords: 'canje carnet conducir extranjero permiso',
      fee: '150 € (todo incluido)', tax: 'Incluida en el precio (todo incluido).',
      docs: '• Permiso de conducir extranjero original en vigor\n• DNI/NIE y tarjeta de residencia\n• Empadronamiento\n• Informe de aptitud psicofísica (centro de reconocimiento)\n• Una foto reciente',
      notes: 'Solo para países con acuerdo de canje: comprobamos si el tuyo tiene convenio.',
    },
    {
      title: 'Baja de vehículo', area: 'vehiculos', keywords: 'baja vehiculo desguace coche',
      fee: '40 €', tax: 'Sin tasa DGT en la baja definitiva por desguace (CAT).',
      docs: '• DNI/NIE del titular\n• Permiso de circulación\n• Ficha técnica (ITV)\n• Certificado de destrucción del CAT (si va a desguace)',
      notes: 'La baja definitiva implica que el vehículo ya no puede circular ni venderse.',
    },
    {
      title: 'Multas y recursos', area: 'vehiculos', keywords: 'multa recurso sancion alegaciones trafico dgt',
      fee: '55 €', tax: 'Sin tasa (alegaciones/recurso).',
      docs: '• Copia de la notificación de la multa\n• DNI/NIE del titular o conductor\n• Datos del vehículo y de los hechos',
      notes: 'Estudiamos si la sanción es recurrible antes de presentar alegaciones o recurso.',
    },
  ],
};

// Siembra la base de conocimiento (una sola vez por pack).
function ensureDefaultKnowledge(db) {
  if (!db.settings) db.settings = {};
  if (!Array.isArray(db.settings.knowledgePacks)) db.settings.knowledgePacks = [];
  let changed = false;
  for (const [packId, items] of Object.entries(KNOWLEDGE_PACK)) {
    if (db.settings.knowledgePacks.includes(packId)) continue;
    for (const k of items) {
      db.knowledge.push({ id: newId('kb'), keywords: '', tax: '', notes: '', ...k, updatedAt: Date.now(), createdAt: Date.now() });
    }
    db.settings.knowledgePacks.push(packId);
    changed = true;
  }
  if (changed) save();
}

// Catálogo de stickers de Burocracia Zero (se lee del manifiesto generado).
function loadStickers() {
  try {
    return JSON.parse(fs.readFileSync(path.join(STICKERS_DIR, 'manifest.json'), 'utf8'));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Autenticación
// Se activa definiendo CRM_PASSWORD (y opcionalmente CRM_USER, por defecto
// "admin"). Sin contraseña configurada, el CRM queda abierto (solo para
// pruebas locales; NO desplegar así en Internet).
// ---------------------------------------------------------------------------

// Un solo usuario: CRM_USER + CRM_PASSWORD.
// Varios usuarios: CRM_USERS="carmen:clave1,juan:clave2" (tiene prioridad).
function authUsers() {
  const users = new Map();
  for (const pair of (process.env.CRM_USERS || '').split(',')) {
    const idx = pair.indexOf(':');
    if (idx > 0) users.set(pair.slice(0, idx).trim(), pair.slice(idx + 1));
  }
  if (!users.size && process.env.CRM_PASSWORD) {
    users.set(process.env.CRM_USER || 'admin', process.env.CRM_PASSWORD);
  }
  return users;
}
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // 30 días
const sessions = new Map(); // token -> { user, createdAt }
const loginAttempts = new Map(); // ip -> { count, firstAt }

// Las sesiones sobreviven a los reinicios/redespliegues del servidor.
const SESSIONS_FILE = path.join(path.dirname(DB_FILE), 'sessions.json');
try {
  for (const [t, s] of Object.entries(JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')))) {
    if (Date.now() - s.createdAt < SESSION_TTL_MS) sessions.set(t, s);
  }
} catch { /* sin fichero de sesiones todavía */ }

function persistSessions() {
  try {
    for (const [t, s] of sessions) {
      if (Date.now() - s.createdAt > SESSION_TTL_MS) sessions.delete(t);
    }
    fs.mkdirSync(path.dirname(SESSIONS_FILE), { recursive: true });
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(sessions)), { mode: 0o600 });
  } catch (err) {
    console.error('No se pudieron guardar las sesiones:', err.message);
  }
}

function authRequired() {
  return authUsers().size > 0;
}

// IP real del cliente (detrás del proxy HTTPS del hosting llega en cabecera).
function ipOf(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket.remoteAddress || '?';
}

// En producción (HTTPS detrás de proxy) la cookie de sesión debe ser Secure.
function cookieFlags(req) {
  const https = String(req.headers['x-forwarded-proto'] || '').includes('https');
  return `HttpOnly; SameSite=Lax; Path=/${https ? '; Secure' : ''}`;
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

function sessionUser(req) {
  return sessions.get(parseCookies(req).crm_session)?.user || null;
}

function isAuthenticated(req) {
  if (!authRequired()) return true;
  const token = parseCookies(req).crm_session;
  const session = token && sessions.get(token);
  if (!session) return false;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(token);
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Aislamiento por usuario: cada usuario ve solo sus clientes (y sus chats y
// expedientes), salvo los que se compartan. Solo se aplica si hay varios
// usuarios configurados (CRM_USERS); sin login, todo es común (compatibilidad).
// Un cliente/expediente «sin dueño» (owner null) es común (visible para todos):
// así los datos antiguos y los entrantes por WhatsApp no desaparecen.
// ---------------------------------------------------------------------------
function isolationOn() {
  return authRequired() && authUsers().size > 1;
}
// Usuarios administradores: pueden descargar copias de toda la base de datos y
// cambiar la configuración global (automatizaciones, datos de la gestoría…).
// Por defecto es el primer usuario de CRM_USERS; se puede fijar con
// CRM_ADMIN="usuario1,usuario2". Con un solo usuario (sin aislamiento) todos lo
// son, para no cambiar el comportamiento de una instalación individual.
function crmAdmins() {
  const raw = (process.env.CRM_ADMIN || '').trim();
  if (raw) return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
  const first = authUsers().keys().next().value;
  return new Set(first ? [first] : []);
}
function isAdmin(user) {
  if (!isolationOn()) return true;
  return crmAdmins().has(user);
}
function canSeeClient(client, user) {
  if (!isolationOn()) return true;
  if (!client) return false;
  if (!client.owner) return true;
  if (client.owner === user) return true;
  return Array.isArray(client.sharedWith) && client.sharedWith.includes(user);
}
function canSeeCase(kase, user, db) {
  if (!isolationOn()) return true;
  if (!kase) return false;
  if (Array.isArray(kase.sharedWith) && kase.sharedWith.includes(user)) return true;
  return canSeeClient(db.clients.find((c) => c.id === kase.clientId), user);
}
// Conjunto de ids de clientes visibles para el usuario (para filtrar agregados).
function visibleClientIdSet(db, user) {
  if (!isolationOn()) return null; // null = sin filtro (todo visible)
  return new Set(db.clients.filter((c) => canSeeClient(c, user)).map((c) => c.id));
}

// Analiza un fichero vCard (.vcf exportado del móvil) → [{ name, phones[] }].
function parseVCards(text) {
  const out = [];
  const blocks = String(text || '').split(/BEGIN:VCARD/i).slice(1);
  for (const block of blocks) {
    const body = block.split(/END:VCARD/i)[0];
    // Deshace el "folding" (líneas continuadas que empiezan por espacio/tab).
    const lines = body.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
    let name = '';
    let nField = '';
    const phones = [];
    for (const line of lines) {
      const m = /^([^:;]+)(;[^:]*)?:(.*)$/.exec(line.trim());
      if (!m) continue;
      const prop = m[1].toUpperCase();
      const val = m[3].trim();
      if (!val) continue;
      if (prop === 'FN') name = val;
      else if (prop === 'N') nField = val.split(';').filter(Boolean).reverse().join(' ').trim();
      else if (prop === 'TEL') phones.push(val);
    }
    const finalName = name || nField;
    if (finalName && phones.length) out.push({ name: finalName, phones });
  }
  return out;
}

// El nombre parece un teléfono (o está vacío) → conviene rellenarlo del contacto.
function looksLikePhone(name) {
  const s = String(name || '').trim();
  return !s || /^[+\d][\d\s().-]{4,}$/.test(s);
}

// Solo se admiten URLs https de JotForm para embeber (coherente con la CSP).
function isJotformUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === 'https:'
      && /(^|\.)jotform\.(com|eu|io)$|(^|\.)jotformeu\.com$/.test(url.hostname);
  } catch {
    return false;
  }
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function tooManyAttempts(ip) {
  const rec = loginAttempts.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.firstAt > 15 * 60 * 1000) {
    loginAttempts.delete(ip);
    return false;
  }
  return rec.count >= 10;
}

function recordAttempt(ip) {
  const rec = loginAttempts.get(ip) || { count: 0, firstAt: Date.now() };
  rec.count += 1;
  loginAttempts.set(ip, rec);
}

// --- CAPTCHA propio (imagen SVG, sin dependencias ni terceros) -------------
// Protege el formulario de acceso frente a bots de fuerza bruta. Complementa
// el límite de intentos por IP. Se puede desactivar con CRM_CAPTCHA=off.
const captchas = new Map(); // id -> { answer, createdAt }
const CAPTCHA_TTL_MS = 5 * 60 * 1000;
// Sin caracteres ambiguos (0/O, 1/I/L) para que sea legible.
const CAPTCHA_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function captchaEnabled() {
  return authRequired() && String(process.env.CRM_CAPTCHA || 'on').toLowerCase() !== 'off';
}

function purgeCaptchas() {
  const now = Date.now();
  for (const [id, c] of captchas) if (now - c.createdAt > CAPTCHA_TTL_MS) captchas.delete(id);
}

function renderCaptchaSvg(text) {
  const W = 200; const H = 64;
  const colors = ['#1d1d1b', '#77599c', '#5f4585'];
  let noise = '';
  for (let i = 0; i < 5; i += 1) {
    noise += `<path d="M${crypto.randomInt(W)} ${crypto.randomInt(H)} Q ${crypto.randomInt(W)} ${crypto.randomInt(H)} ${crypto.randomInt(W)} ${crypto.randomInt(H)}" stroke="${colors[crypto.randomInt(colors.length)]}" stroke-width="1" fill="none" opacity="0.35"/>`;
  }
  for (let i = 0; i < 45; i += 1) {
    noise += `<circle cx="${crypto.randomInt(W)}" cy="${crypto.randomInt(H)}" r="1" fill="#9272b0" opacity="0.4"/>`;
  }
  let glyphs = '';
  const step = (W - 34) / text.length;
  for (let i = 0; i < text.length; i += 1) {
    const x = 22 + i * step + crypto.randomInt(6) - 3;
    const y = 42 + crypto.randomInt(12) - 6;
    const rot = crypto.randomInt(46) - 23;
    const size = 30 + crypto.randomInt(8);
    glyphs += `<text x="${x}" y="${y}" font-family="Lexend,Arial,sans-serif" font-size="${size}" font-weight="800" fill="${colors[crypto.randomInt(colors.length)]}" transform="rotate(${rot} ${x} ${y})">${text[i]}</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="captcha"><rect width="${W}" height="${H}" rx="10" fill="#f5f4f7"/>${noise}${glyphs}</svg>`;
}

function makeCaptcha() {
  purgeCaptchas();
  let text = '';
  for (let i = 0; i < 5; i += 1) text += CAPTCHA_CHARS[crypto.randomInt(CAPTCHA_CHARS.length)];
  const id = crypto.randomBytes(18).toString('hex');
  captchas.set(id, { answer: text, createdAt: Date.now() });
  return { id, text, svg: renderCaptchaSvg(text) };
}

// Verificación de un solo uso: el código se consume aunque falle.
function verifyCaptcha(id, answer) {
  const c = id && captchas.get(id);
  if (!c) return false;
  captchas.delete(id);
  if (Date.now() - c.createdAt > CAPTCHA_TTL_MS) return false;
  return String(answer || '').trim().toUpperCase() === c.answer;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readRawBody(req, maxBytes = 2_000_000) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > maxBytes) { reject(new Error('Cuerpo demasiado grande')); req.destroy(); }
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

async function readBody(req, maxBytes = 2_000_000) {
  const raw = await readRawBody(req, maxBytes);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new Error('JSON inválido'); }
}

// ---------------------------------------------------------------------------
// Lógica de negocio
// ---------------------------------------------------------------------------

function findClientByPhone(db, phone) {
  return db.clients.find((c) => c.phone === phone) || null;
}

// Relevancia de una ficha de la base de conocimiento respecto a un texto
// (para elegir qué información pasar a la IA al sugerir una respuesta).
function kbRelevance(k, hay) {
  if (!hay || !k) return 0;
  let score = 0;
  const kws = String(k.keywords || '').split(/[,\n]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  for (const kw of kws) if (hay.includes(kw)) score += 2;
  if (k.title && hay.includes(String(k.title).toLowerCase())) score += 3;
  return score;
}

function ensureClientForPhone(db, phone, name) {
  let client = findClientByPhone(db, phone);
  if (!client) {
    client = {
      id: newId('cli'),
      name: name || `+${phone}`,
      phone,
      nif: '',
      email: '',
      tags: ['nuevo'],
      notes: 'Cliente creado automáticamente desde un mensaje de WhatsApp.',
      createdAt: Date.now(),
    };
    db.clients.push(client);
  }
  return client;
}

function conversationSummaries(db) {
  const byClient = new Map();
  for (const m of db.messages) {
    const list = byClient.get(m.clientId) || [];
    list.push(m);
    byClient.set(m.clientId, list);
  }
  const out = [];
  for (const [clientId, msgs] of byClient) {
    const client = db.clients.find((c) => c.id === clientId);
    if (!client) continue;
    const last = msgs[msgs.length - 1];
    const unread = msgs.filter((m) => m.direction === 'in' && !m.read).length;
    out.push({
      clientId,
      clientName: client.name,
      phone: client.phone,
      tags: client.tags,
      lastMessage: last.text,
      lastDirection: last.direction,
      lastTimestamp: last.timestamp,
      unread,
      convStatus: client.convStatus || 'abierta',
      assignedTo: client.assignedTo || null,
      pinned: Boolean(client.pinned),
      avatar: Boolean(client.avatarPath),
    });
  }
  // Las conversaciones fijadas van primero; el resto, por actividad reciente.
  out.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.lastTimestamp - a.lastTimestamp);
  return out;
}

async function sendMessageToClient(db, client, text, opts = {}) {
  let sendResult = { demo: true, id: null };
  let status = 'demo';
  let viaTemplate = false;
  const sendOpts = opts.replyToWamid ? { replyToWamid: opts.replyToWamid } : {};
  const settings = auto.getSettings(db);
  const windowOpen = auto.isWindowOpen(db, client.id);
  try {
    if (opts.media) {
      sendResult = await wa.sendMedia(client.phone, opts.media, sendOpts);
    } else if (opts.interactiveList) {
      // Menú nativo de WhatsApp; siempre responde a un mensaje reciente del
      // cliente, así que la ventana de 24 h está abierta.
      sendResult = await wa.sendInteractiveList(client.phone, opts.interactiveList);
    } else {
      // Fuera de la ventana de 24 h WhatsApp rechaza el texto libre: si hay una
      // plantilla aprobada configurada, se usa (tanto en automatizaciones como
      // en envíos manuales). ({{1}} = nombre, {{2}} = texto del mensaje).
      const useTemplate = settings.template24h.enabled && !windowOpen;
      if (useTemplate) {
        viaTemplate = true;
        sendResult = await wa.sendTemplate(client.phone, settings.template24h.name,
          settings.template24h.lang, [(client.name || '').split(' ')[0], text]);
      } else {
        sendResult = await wa.sendText(client.phone, text, sendOpts);
      }
    }
    status = sendResult.demo ? 'demo' : 'sent';
  } catch (err) {
    status = 'error';
    // Fuera de la ventana de 24 h y sin plantilla: mensaje claro en español.
    if (!windowOpen && !opts.media && !settings.template24h.enabled && wa.isConfigured()) {
      sendResult.error = 'WhatsApp no permite escribir texto libre pasadas 24 h desde el último mensaje del cliente. '
        + 'Espera a que te escriba, o configura una plantilla aprobada en Automatizaciones → «Plantilla para la ventana de 24 h».';
    } else {
      sendResult.error = err.message;
    }
  }
  const msg = {
    id: newId('msg'),
    clientId: client.id,
    direction: 'out',
    text,
    media: opts.media ? {
      kind: opts.media.kind,
      mime: opts.media.mime,
      filename: opts.media.filename,
      caption: opts.media.caption || '',
      localPath: opts.media.localPath || null,
      // Los stickers del catálogo se muestran desde su fichero estático.
      stickerUrl: opts.media.stickerUrl || null,
      link: null,
      metaMediaId: null,
    } : null,
    timestamp: Date.now(),
    status, // demo | sent | delivered | read | error
    error: sendResult.error || null,
    waMessageId: sendResult.id,
    auto: Boolean(opts.auto), // enviado por una automatización
    viaTemplate, // enviado como plantilla aprobada (ventana de 24 h cerrada)
    viaScheduled: Boolean(opts.scheduled), // enviado desde un mensaje programado
    // Cita del mensaje al que se responde (para mostrarla en el chat).
    replyTo: opts.replySnapshot || null,
    read: true,
  };
  db.messages.push(msg);
  save();
  return msg;
}

// Envía un adjunto (Buffer) a un cliente por WhatsApp: lo guarda en local, lo
// sube al proveedor si está configurado y lo registra en el chat. La usan la
// API y el asistente por Telegram. Límite de 16 MB (tope de WhatsApp).
async function sendMediaToClient(db, client, data, { filename, mime, caption } = {}) {
  if (!data || !data.length) throw new Error('el archivo está vacío');
  if (data.length > 16_000_000) throw new Error('el archivo supera los 16 MB de WhatsApp');
  const safe = path.basename(filename || 'archivo').replace(/[^\w.\-]+/g, '_').slice(0, 80) || 'archivo';
  const m = mime || 'application/octet-stream';
  const kind = m.startsWith('image/') && m !== 'image/svg+xml' ? 'image'
    : m.startsWith('video/') ? 'video'
      : m.startsWith('audio/') ? 'audio' : 'document';
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const localName = `${newId('up')}_${safe}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, localName), data);
  let mediaId = null;
  if (wa.isConfigured()) mediaId = await wa.uploadMedia(data, safe, m);
  return sendMessageToClient(db, client, (caption || '').trim() || `📎 ${safe}`, {
    media: { kind, mime: m, filename: safe, caption: (caption || '').trim(), mediaId, localPath: localName },
  });
}

// Envío usado por las automatizaciones (marca el mensaje como automático).
function autoSender(db) {
  return (client, text, opts = {}) => sendMessageToClient(db, client, text, { ...opts, auto: true });
}

// URL pública absoluta (para enlaces que se envían al cliente por WhatsApp).
function publicBase(req) {
  if (process.env.PUBLIC_BASE_URL) return String(process.env.PUBLIC_BASE_URL).replace(/\/+$/, '');
  const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
    || (req.socket && req.socket.encrypted ? 'https' : 'http');
  const host = req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

// Redondea un importe a dos decimales (céntimos), evitando el ruido de coma
// flotante. Se usa para honorarios y tasas.
function money2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Honorarios ya cobrados de un expediente (admite adelantos/pagos a plazos).
// Compatibilidad con datos antiguos: si no hay `paidAmount`, se deduce del
// booleano `paid` (todo cobrado o nada).
function feePaidOf(c) {
  const fee = Number(c.fee) || 0;
  const paid = typeof c.paidAmount === 'number' ? c.paidAmount : (c.paid ? fee : 0);
  return money2(Math.max(0, Math.min(paid, fee)));
}

// Honorarios que quedan por cobrar de un expediente.
function feeDueOf(c) {
  return money2((Number(c.fee) || 0) - feePaidOf(c));
}

function longDate(d = new Date()) {
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return `${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`;
}

// Plantillas de documentos para firmar. Se rellenan con los datos del cliente.
// El texto legal va en español (es el idioma de las autorizaciones).
const SIGN_DOCS = {
  representacion: {
    label: 'Autorización de representación + RGPD',
    title: 'AUTORIZACIÓN DE REPRESENTACIÓN Y CONSENTIMIENTO DE PROTECCIÓN DE DATOS',
    build(client, tramite) {
      const nif = client.nif ? client.nif : '__________';
      const t = tramite ? `«${tramite}»` : 'los trámites encomendados';
      return `D./Dª. ${client.name}, con NIF/NIE ${nif}, por medio del presente documento AUTORIZA a BUROCRACIA ZERO (gestoría con domicilio en Toledo) a actuar en su nombre y representación ante los organismos públicos competentes —Oficina de Extranjería, Dirección General de Tráfico (DGT), Agencia Tributaria (AEAT), Tesorería General de la Seguridad Social y demás Administraciones Públicas— para la tramitación de ${t}, así como a presentar, subsanar y recoger en su nombre cuanta documentación sea necesaria.

En cumplimiento del Reglamento (UE) 2016/679 (RGPD) y de la Ley Orgánica 3/2018 (LOPDGDD), el/la firmante CONSIENTE el tratamiento de sus datos personales por parte de Burocracia Zero con la única finalidad de prestar los servicios de gestoría contratados. Los datos se conservarán durante el tiempo legalmente exigible y no se cederán a terceros salvo obligación legal. El/la interesado/a puede ejercer sus derechos de acceso, rectificación, supresión, oposición, limitación y portabilidad dirigiéndose a Burocracia Zero.

Y para que así conste, firma el presente documento de conformidad.

Firmado en Toledo, a ${longDate()}.`;
    },
  },
  rgpd: {
    label: 'Consentimiento de protección de datos (RGPD)',
    title: 'CONSENTIMIENTO DE PROTECCIÓN DE DATOS',
    build(client) {
      const nif = client.nif ? client.nif : '__________';
      return `D./Dª. ${client.name}, con NIF/NIE ${nif}, en cumplimiento del Reglamento (UE) 2016/679 (RGPD) y de la Ley Orgánica 3/2018 (LOPDGDD), CONSIENTE el tratamiento de sus datos personales por parte de BUROCRACIA ZERO (gestoría con domicilio en Toledo) con la finalidad de prestar los servicios de gestoría contratados y mantener la comunicación necesaria a través de WhatsApp y otros medios.

Los datos se conservarán durante el tiempo legalmente exigible y no se cederán a terceros salvo obligación legal. El/la interesado/a puede ejercer sus derechos de acceso, rectificación, supresión, oposición, limitación y portabilidad dirigiéndose a Burocracia Zero.

Firmado en Toledo, a ${longDate()}.`;
    },
  },
};

function buildSignatureDoc(docType, client, tramite) {
  const def = SIGN_DOCS[docType] || SIGN_DOCS.representacion;
  return { title: def.title, body: def.build(client, tramite) };
}

// Procesa una firma recibida: genera el PDF firmado, lo adjunta a la
// conversación (y al expediente si lo hay) y lo sube a SharePoint si procede.
async function finalizeSignature(db, sig, client, name, signatureDataUrl, req) {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const safeName = (client.name || 'cliente').replace(/[^\w.\-]+/g, '_').slice(0, 40);
  const filename = `Firmado_${safeName}_${stamp}.pdf`;
  const ip = ipOf(req);
  const footerLines = [
    `Firmado por: ${name}`,
    `NIF/NIE: ${client.nif || '—'}`,
    `Fecha y hora de firma: ${now.toLocaleString('es-ES')}`,
    `IP del firmante: ${ip}`,
    `Referencia del documento: ${sig.id}`,
  ];
  const pdf = pdfsign.buildSignedPdf({
    title: sig.title,
    body: sig.body,
    footerLines,
    signatureJpeg: signatureDataUrl,
  });
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const localName = `${newId('sig')}_${filename}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, localName), pdf);

  // Mensaje en la conversación con el PDF firmado (visible y previsualizable).
  const msg = {
    id: newId('msg'),
    clientId: client.id,
    direction: 'in',
    text: `✍️ Documento firmado: ${sig.title}`,
    media: { kind: 'document', mime: 'application/pdf', filename, localPath: localName, caption: '' },
    timestamp: Date.now(),
    status: 'received',
    caseId: sig.caseId || null,
    read: false,
  };
  db.messages.push(msg);

  sig.status = 'firmado';
  sig.signedAt = Date.now();
  sig.signerName = name;
  sig.signerIp = ip;
  sig.pdfPath = localName;
  sig.messageId = msg.id;
  save();
  security.audit('documento_firmado', { signatureId: sig.id, clientId: client.id, ip });

  // Subida a SharePoint (si está configurado y activado).
  try {
    const msSp = auto.getSettings(db).microsoft.sharepoint;
    if (msgraph.isConfigured() && msSp.enabled) {
      const folderPath = client?.sharepointFolder?.path
        || msgraph.buildFolderPath(msSp.folderTemplate, client || { name: 'SIN NOMBRE' });
      const uploaded = await msgraph.uploadToSharePoint({
        hostname: msSp.hostname, sitePath: msSp.sitePath, folderPath, filename, data: pdf,
      });
      sig.sharepointUrl = uploaded.webUrl;
      msg.sharepointUrl = uploaded.webUrl;
      save();
    }
  } catch (err) {
    sig.sharepointError = err.message;
    save();
    console.error('No se pudo subir la firma a SharePoint:', err.message);
  }
  return sig;
}

// Sube una copia de seguridad a SharePoint (además de la copia local), si está
// activado en Automatizaciones y Microsoft 365 está configurado.
async function uploadBackupToCloud(db, backupName) {
  const ms = auto.getSettings(db).microsoft;
  if (!ms.backup || !ms.backup.enabled || !msgraph.isConfigured()) return null;
  const full = path.join(backup.BACKUPS_DIR, backupName);
  if (!fs.existsSync(full)) return null;
  const data = fs.readFileSync(full);
  return msgraph.uploadToSharePoint({
    hostname: ms.sharepoint.hostname,
    sitePath: ms.sharepoint.sitePath,
    folderPath: ms.backup.folderPath || 'Copias de seguridad CRM',
    filename: backupName,
    data,
  });
}

// Sincroniza los adjuntos (data/uploads: fotos de pasaporte/NIE, PDFs firmados…)
// a SharePoint, ya que NO entran en el .gz diario y viven en un único disco.
// Sube solo lo que falta (por nombre) para no repetir trabajo. Best-effort.
async function uploadsBackupToCloud(db) {
  const ms = auto.getSettings(db).microsoft;
  if (!ms.backup || !ms.backup.enabled || !msgraph.isConfigured()) return null;
  if (!fs.existsSync(UPLOADS_DIR)) return null;
  const folderPath = (ms.backup.folderPath || 'Copias de seguridad CRM') + '/adjuntos';
  const files = fs.readdirSync(UPLOADS_DIR).filter((f) => {
    try { return fs.statSync(path.join(UPLOADS_DIR, f)).isFile(); } catch { return false; }
  });
  if (!db.settings.uploadsSynced || typeof db.settings.uploadsSynced !== 'object') db.settings.uploadsSynced = {};
  const synced = db.settings.uploadsSynced;
  let done = 0;
  for (const f of files) {
    if (synced[f]) continue; // ya subido antes
    try {
      await msgraph.uploadToSharePoint({
        hostname: ms.sharepoint.hostname,
        sitePath: ms.sharepoint.sitePath,
        folderPath,
        filename: f,
        data: fs.readFileSync(path.join(UPLOADS_DIR, f)),
      });
      synced[f] = Date.now();
      done += 1;
    } catch (err) {
      console.error('No se pudo subir el adjunto', f, 'a SharePoint:', err.message);
    }
  }
  if (done) save();
  return { synced: done, total: files.length };
}

// Borrado COMPLETO de un cliente (derecho de supresión del RGPD): elimina
// también los ficheros físicos (avatar, adjuntos de sus mensajes, PDFs de sus
// firmas) y TODOS los registros que lo referencian (incluidas firmas y tareas),
// no solo la ficha. Devuelve cuántos ficheros y registros se borraron.
function purgeClientData(db, id) {
  let filesRemoved = 0;
  const rm = (p) => {
    if (!p) return;
    try { fs.rmSync(path.join(UPLOADS_DIR, path.basename(String(p))), { force: true }); filesRemoved += 1; } catch { /* noop */ }
  };
  const client = db.clients.find((c) => c.id === id);
  if (client && client.avatarPath) rm(client.avatarPath);
  for (const m of db.messages) {
    if (m.clientId === id && m.media && m.media.localPath) rm(m.media.localPath);
  }
  for (const s of db.signatures) {
    if (s.clientId === id && s.pdfPath) rm(s.pdfPath);
  }
  const n0 = db.messages.length + db.cases.length + db.reminders.length
    + db.appointments.length + db.scheduledMessages.length + db.signatures.length + db.tasks.length;
  db.clients = db.clients.filter((c) => c.id !== id);
  db.messages = db.messages.filter((m) => m.clientId !== id);
  db.cases = db.cases.filter((c) => c.clientId !== id);
  db.reminders = db.reminders.filter((r) => r.clientId !== id);
  db.appointments = db.appointments.filter((a) => a.clientId !== id);
  db.scheduledMessages = db.scheduledMessages.filter((s) => s.clientId !== id);
  db.signatures = db.signatures.filter((s) => s.clientId !== id);
  db.tasks = db.tasks.filter((t) => t.clientId !== id);
  const n1 = db.messages.length + db.cases.length + db.reminders.length
    + db.appointments.length + db.scheduledMessages.length + db.signatures.length + db.tasks.length;
  return { files: filesRemoved, records: n0 - n1 };
}

// Clientes candidatos a revisión por conservación (RGPD): sin trámites abiertos
// y sin actividad desde hace más de N meses. Solo informa; nunca borra.
function retentionCandidates(db, now = Date.now()) {
  const s = auto.getSettings(db).retention || {};
  const inactiveMs = (Number(s.inactiveMonths) || 24) * 30 * 24 * 3600 * 1000;
  const monthMs = 30 * 24 * 3600 * 1000;
  const out = [];
  for (const c of db.clients) {
    if (db.cases.some((k) => k.clientId === c.id && k.status !== 'completado')) continue; // trámite abierto
    let last = c.createdAt || 0;
    for (const m of db.messages) if (m.clientId === c.id && (m.timestamp || 0) > last) last = m.timestamp;
    if (now - last < inactiveMs) continue;
    out.push({ clientId: c.id, name: c.name, lastActivity: last, monthsInactive: Math.floor((now - last) / monthMs) });
  }
  return out.sort((a, b) => a.lastActivity - b.lastActivity);
}

// Vista de una solicitud de firma para la interfaz (sin el token secreto).
function publicSignature(sig) {
  return {
    id: sig.id,
    clientId: sig.clientId,
    caseId: sig.caseId || null,
    docType: sig.docType,
    title: sig.title,
    status: sig.status,
    createdAt: sig.createdAt,
    sentAt: sig.sentAt || null,
    signedAt: sig.signedAt || null,
    signerName: sig.signerName || null,
    sharepointUrl: sig.sharepointUrl || null,
    messageId: sig.messageId || null,
  };
}

// Construye las líneas del dossier del cliente para el PDF.
function buildDossierLines(db, client) {
  const eur = (n) => (Number(n) || 0).toLocaleString('es-ES') + ' €';
  const d = (iso) => (iso ? fmtDateLoc(iso, 'es') : '—');
  const dt = (ts) => (ts ? new Date(ts).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' }) : '—');
  const AREA = { extranjeria: 'Extranjería', vehiculos: 'Tráfico / Vehículos', fiscal: 'Fiscal / Impuestos', laboral: 'Laboral / Nóminas', contabilidad: 'Contabilidad', pensiones: 'Pensiones / Prestaciones', social: 'Servicios sociales', otro: 'Otros trámites' };
  const EST = { pendiente: 'Pendiente', en_curso: 'En curso', esperando_documentacion: 'Esperando documentación', completado: 'Completado' };
  const PAY = { caja: 'efectivo', transferencia: 'transferencia', tarjeta: 'tarjeta', banco: 'banco' };
  const lines = [];
  lines.push({ t: `Generado el ${dt(Date.now())} · Burocracia Zero`, size: 9, color: [0.45, 0.45, 0.45] });

  // Datos del cliente.
  lines.push({ t: 'DATOS DEL CLIENTE', bold: true, size: 12.5, gap: 10 });
  lines.push({ t: `Nombre: ${client.name || '—'}` });
  lines.push({ t: `NIF/NIE: ${client.nif || '—'}` });
  lines.push({ t: `Teléfono: +${client.phone || '—'}` });
  lines.push({ t: `Email: ${client.email || '—'}` });
  lines.push({ t: `Tipo: ${({ particular: 'Particular', autonomo: 'Autónomo', empresa: 'Empresa' })[client.segment] || 'Particular'}` });
  if ((client.tags || []).length) lines.push({ t: `Etiquetas: ${client.tags.join(', ')}` });
  lines.push({ t: `Alta en el CRM: ${dt(client.createdAt)}` });

  // Expedientes.
  const cases = db.cases.filter((c) => c.clientId === client.id)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  lines.push({ t: `EXPEDIENTES (${cases.length})`, bold: true, size: 12.5, gap: 16 });
  if (!cases.length) lines.push({ t: 'Sin expedientes registrados.' });
  for (const c of cases) {
    lines.push({ t: `• ${c.title}`, bold: true, size: 11, gap: 8 });
    lines.push({ t: `Área: ${AREA[c.type] || c.type} · Estado: ${EST[c.status] || c.status}` });
    if (c.submittedDate) lines.push({ t: `Presentado en la administración: ${d(c.submittedDate)}` });
    if (c.registryNumber) lines.push({ t: `Nº de registro: ${c.registryNumber}` });
    if (c.dueDate) lines.push({ t: `Fecha límite: ${d(c.dueDate)}` });
    if (c.expiryDate) lines.push({ t: `Caducidad / renovación: ${d(c.expiryDate)}` });
    const fee = Number(c.fee) || 0;
    if (fee) {
      const via = PAY[c.payMethod] ? ` (${PAY[c.payMethod]})` : '';
      const paid = feePaidOf(c);
      const due = feeDueOf(c);
      let estado;
      if (due <= 0) estado = 'cobrado' + via;
      else if (paid > 0) estado = `cobrado ${eur(paid)}${via} · quedan ${eur(due)}`; // adelanto/pago parcial
      else estado = 'PENDIENTE de cobro';
      lines.push({ t: `Honorarios: ${eur(fee)} — ${estado}` });
    }
    const tax = Number(c.taxAmount) || 0;
    if (tax || c.taxModel) {
      lines.push({ t: `Tasa oficial${c.taxModel ? ' (' + c.taxModel + ')' : ''}: ${tax ? eur(tax) : ''} — ${c.taxPaid ? 'abonada' : 'pendiente'}` });
    }
    const chk = Array.isArray(c.checklist) ? c.checklist : [];
    if (chk.length) lines.push({ t: `Documentación recibida: ${chk.filter((x) => x.done).length}/${chk.length}` });
  }

  // Documentos firmados.
  const signed = db.signatures.filter((s) => s.clientId === client.id && s.status === 'firmado')
    .sort((a, b) => (b.signedAt || 0) - (a.signedAt || 0));
  lines.push({ t: `DOCUMENTOS FIRMADOS (${signed.length})`, bold: true, size: 12.5, gap: 16 });
  if (!signed.length) lines.push({ t: 'Ningún documento firmado.' });
  for (const s of signed) {
    lines.push({ t: `• ${s.title}`, gap: 6 });
    lines.push({ t: `Firmado por ${s.signerName || '—'} el ${dt(s.signedAt)}` });
  }

  // Resumen de actividad.
  const msgs = db.messages.filter((m) => m.clientId === client.id);
  const last = msgs.reduce((mx, m) => Math.max(mx, m.timestamp || 0), 0);
  const appts = db.appointments.filter((a) => a.clientId === client.id).length;
  lines.push({ t: 'RESUMEN DE ACTIVIDAD', bold: true, size: 12.5, gap: 16 });
  lines.push({ t: `Mensajes intercambiados: ${msgs.length}` });
  lines.push({ t: `Última interacción: ${last ? dt(last) : '—'}` });
  lines.push({ t: `Citas registradas: ${appts}` });

  lines.push({ t: 'Documento interno de Burocracia Zero. Contiene datos personales: trátese conforme al RGPD.', size: 9, color: [0.45, 0.45, 0.45], gap: 20 });
  return lines;
}

// Envía los mensajes programados cuya hora ya ha llegado. A diferencia de las
// automatizaciones, se envían a cualquier hora (la gestoría eligió el momento).
async function dispatchScheduledMessages(db, now = Date.now()) {
  const due = db.scheduledMessages.filter((s) => s.status === 'pendiente' && s.sendAt <= now);
  let changed = false;
  for (const sched of due) {
    const client = db.clients.find((c) => c.id === sched.clientId);
    if (!client) { sched.status = 'error'; sched.error = 'Cliente no encontrado'; changed = true; continue; }
    try {
      const msg = await sendMessageToClient(db, client, sched.text, { scheduled: true });
      sched.status = 'enviado';
      sched.sentAt = Date.now();
      sched.messageId = msg.id;
    } catch (err) {
      sched.status = 'error';
      sched.error = err.message;
    }
    changed = true;
  }
  return changed;
}

// Descarga el audio de una nota de voz y lo transcribe en segundo plano;
// al terminar guarda la transcripción en el mensaje (para verla en el chat).
async function transcribeInbound(msgId, media) {
  try {
    const resp = await wa.fetchInboundMedia(media);
    if (!resp || !resp.ok) return;
    const buf = Buffer.from(await resp.arrayBuffer());
    const text = await transcribe.run(buf, media.filename || 'audio.ogg', media.mime || 'audio/ogg');
    if (!text) return;
    const db = load();
    const m = db.messages.find((x) => x.id === msgId);
    if (m) { m.transcript = text; save(); }
  } catch (err) {
    console.error('No se pudo transcribir la nota de voz:', err.message);
  }
}

async function handleWebhookPayload(db, body) {
  const { incoming, echoes, statuses, reads } = wa.parseWebhook(body);
  // Diagnóstico (sin datos personales): permite comprobar en los logs de Render
  // si el proveedor manda avisos de "leído desde el móvil" (Coexistence). Si al
  // leer un WhatsApp en el teléfono no aparece aquí `reads=1+`, es que YCloud no
  // reenvía esos avisos y hay que sincronizar la lectura de otra forma.
  try {
    const evType = (body && typeof body.type === 'string') ? body.type : 'meta';
    console.log(`[webhook] type=${evType} incoming=${incoming.length} echoes=${echoes.length} statuses=${statuses.length} reads=${reads.length}`);
  } catch { /* noop */ }
  const freshIncoming = [];
  for (const inMsg of incoming) {
    if (db.messages.some((m) => m.waMessageId && m.waMessageId === inMsg.waMessageId)) continue;
    const phone = normalizePhone(inMsg.from);
    const client = ensureClientForPhone(db, phone, inMsg.name);
    if (!inMsg.historic) freshIncoming.push({ client, text: inMsg.text });
    // Si el cliente responde citando un mensaje, se enlaza con el original.
    let replyTo = null;
    if (inMsg.replyToWamid) {
      const quoted = db.messages.find((m) => m.waMessageId === inMsg.replyToWamid && m.clientId === client.id);
      if (quoted) {
        replyTo = {
          id: quoted.id,
          direction: quoted.direction,
          text: String(quoted.text || (quoted.media ? '📎 ' + (quoted.media.filename || 'Adjunto') : '')).slice(0, 140),
        };
      }
    }
    const msg = {
      id: newId('msg'),
      clientId: client.id,
      direction: 'in',
      text: inMsg.text,
      media: inMsg.media || null,
      timestamp: inMsg.timestamp,
      status: 'received',
      waMessageId: inMsg.waMessageId,
      ycloudId: inMsg.ycloudId || null,
      replyTo,
      // El historial importado (Coexistence) no debe contar como "sin leer".
      read: Boolean(inMsg.historic),
    };
    db.messages.push(msg);
    // Transcripción de notas de voz (en segundo plano, si está activada).
    if (!inMsg.historic && msg.media && msg.media.kind === 'audio'
        && transcribe.isConfigured() && auto.getSettings(db).transcription.enabled) {
      transcribeInbound(msg.id, msg.media);
    }
  }
  // Coexistence: mensajes que la gestoría envió desde la app del móvil.
  // Se registran como salientes para que la conversación se vea completa.
  const echoByClient = new Map(); // clientId -> timestamp de la última respuesta desde el móvil
  for (const echo of echoes) {
    const phone = normalizePhone(echo.to);
    const client = ensureClientForPhone(db, phone, '');
    const ts = echo.timestamp || Date.now();
    echoByClient.set(client.id, Math.max(echoByClient.get(client.id) || 0, ts));
    if (db.messages.some((m) => m.waMessageId && m.waMessageId === echo.waMessageId)) continue;
    db.messages.push({
      id: newId('msg'),
      clientId: client.id,
      direction: 'out',
      text: echo.text,
      media: echo.media || null,
      timestamp: ts,
      status: 'sent',
      viaApp: true,
      waMessageId: echo.waMessageId,
      read: true,
    });
  }
  // Sincronización de lectura con el móvil (para que el CRM no muestre como «sin
  // leer» lo que ya has visto en el teléfono):
  //  1) Si respondes a un cliente desde el móvil, se dan por leídos sus mensajes
  //     anteriores a esa respuesta.
  //  2) Lecturas explícitas que notifique el proveedor (leer sin responder).
  let readSynced = 0;
  for (const [clientId, ts] of echoByClient) {
    for (const m of db.messages) {
      if (m.clientId === clientId && m.direction === 'in' && !m.read && m.timestamp <= ts) {
        m.read = true; readSynced += 1;
      }
    }
  }
  for (const r of reads || []) {
    const m = db.messages.find((x) => (x.waMessageId && r.waMessageId && x.waMessageId === r.waMessageId)
      || (x.ycloudId && r.ycloudId && x.ycloudId === r.ycloudId));
    if (m && m.direction === 'in' && !m.read) { m.read = true; readSynced += 1; }
  }
  for (const st of statuses) {
    const msg = db.messages.find((m) => m.waMessageId && st.ids.includes(m.waMessageId));
    if (msg && ['sent', 'delivered', 'read', 'error'].includes(st.status)) {
      msg.status = st.status;
      if (st.error) msg.error = st.error;
      continue;
    }
    // Mensaje saliente que no envió el CRM (automatización o bandeja de
    // YCloud): se registra para que la conversación esté completa.
    if (!msg && st.to && st.ids.length && ['sent', 'delivered', 'read'].includes(st.status)) {
      const phone = normalizePhone(st.to);
      const client = ensureClientForPhone(db, phone, '');
      db.messages.push({
        id: newId('msg'),
        clientId: client.id,
        direction: 'out',
        text: st.text || '[mensaje de YCloud]',
        timestamp: st.timestamp || Date.now(),
        status: st.status,
        viaProvider: true, // enviado desde la plataforma de YCloud
        waMessageId: st.ids[0],
        read: true,
      });
    }
  }
  if (incoming.length || echoes.length || statuses.length || readSynced) save();

  // Automatizaciones sobre los mensajes recién llegados. Primero se atienden
  // las selecciones del menú de áreas (precios); si no lo es, el mensaje de
  // servicios (máx. una vez cada N horas por cliente) y la respuesta fuera
  // de horario.
  const alreadyGreeted = new Set();
  const onHoliday = auto.isHolidayActive(db);
  for (const item of freshIncoming) {
    // En vacaciones/cierre: solo el aviso de vacaciones, nada más.
    if (onHoliday) {
      await auto.maybeHoliday(db, item.client, autoSender(db));
      alreadyGreeted.add(item.client.id);
      continue;
    }
    const wasMenuReply = await auto.maybeMenuReply(db, item.client, item.text, autoSender(db));
    if (wasMenuReply || alreadyGreeted.has(item.client.id)) continue;
    alreadyGreeted.add(item.client.id);
    await auto.maybeWelcome(db, item.client, autoSender(db));
    await auto.maybeAutoReply(db, item.client, autoSender(db));
  }
  // Persistir los indicadores de las automatizaciones (aviso de vacaciones una
  // vez al día, cooldowns de bienvenida/auto-respuesta…). Sin este guardado se
  // perderían en cada reinicio y los avisos se repetirían.
  if (freshIncoming.length) save();
  // Aviso por Telegram de los WhatsApp nuevos (sin bloquear la respuesta).
  notifyTelegramInbound(db, freshIncoming)
    .catch((err) => console.error('Aviso Telegram:', telegram.redact(err && err.message)));
}

// Sube a SharePoint el adjunto de un mensaje ya asignado a un expediente (si
// SharePoint está configurado y aún no se había subido). Guarda la URL o el
// error en el propio mensaje. No lanza: registra el fallo en msg.sharepointError.
async function uploadMsgToSharePoint(db, msg) {
  const msSp = auto.getSettings(db).microsoft.sharepoint;
  if (!(msg.caseId && msg.media && !msg.sharepointUrl && msgraph.isConfigured() && msSp.enabled)) return;
  try {
    let data = null;
    if (msg.media.localPath) {
      data = fs.readFileSync(path.join(UPLOADS_DIR, path.basename(msg.media.localPath)));
    } else {
      const upstream = await wa.fetchInboundMedia(msg.media);
      if (!upstream.ok) throw new Error(`descarga del adjunto: HTTP ${upstream.status}`);
      data = Buffer.from(await upstream.arrayBuffer());
    }
    const client = db.clients.find((c) => c.id === msg.clientId);
    // Carpeta vinculada al cliente si la tiene; si no, la de la plantilla.
    const folderPath = client?.sharepointFolder?.path
      || msgraph.buildFolderPath(msSp.folderTemplate, client || { name: 'SIN NOMBRE' });
    const uploaded = await msgraph.uploadToSharePoint({
      hostname: msSp.hostname,
      sitePath: msSp.sitePath,
      folderPath,
      filename: msg.media.filename || `adjunto-${msg.id}`,
      data,
    });
    msg.sharepointUrl = uploaded.webUrl;
    delete msg.sharepointError;
  } catch (err) {
    msg.sharepointError = err.message;
    console.error('No se pudo subir a SharePoint:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Rutas de la API
// ---------------------------------------------------------------------------

async function handleApi(req, res, url) {
  const db = load();
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const resource = parts[1];
  const id = parts[2];

  // --- Autenticación (rutas públicas) -------------------------------------
  if (req.method === 'GET' && resource === 'auth') {
    const session = sessions.get(parseCookies(req).crm_session);
    return json(res, 200, {
      required: authRequired(),
      authenticated: isAuthenticated(req),
      user: session?.user || null,
    });
  }
  // Genera un nuevo CAPTCHA para el formulario de acceso (ruta pública).
  if (req.method === 'GET' && resource === 'captcha') {
    if (!captchaEnabled()) return json(res, 200, { enabled: false });
    const c = makeCaptcha();
    const payload = {
      enabled: true,
      id: c.id,
      image: `data:image/svg+xml;base64,${Buffer.from(c.svg).toString('base64')}`,
    };
    // Solo para pruebas automatizadas (CRM_CAPTCHA_TEST=1); nunca en producción.
    if (process.env.CRM_CAPTCHA_TEST === '1') payload.answer = c.text;
    return json(res, 200, payload);
  }
  if (req.method === 'POST' && resource === 'login') {
    const ip = ipOf(req);
    if (tooManyAttempts(ip)) {
      return json(res, 429, { error: 'Demasiados intentos. Espera 15 minutos.' });
    }
    const b = await readBody(req);
    if (!authRequired()) return json(res, 200, { ok: true });
    // Verificación anti-bot: el código de la imagen debe ser correcto.
    if (captchaEnabled() && !verifyCaptcha(b.captchaId, b.captcha)) {
      recordAttempt(ip);
      security.audit('captcha_fallido', { ip });
      return json(res, 400, { error: 'El código de verificación no es correcto. Inténtalo de nuevo.', captcha: true });
    }
    const userName = String(b.user || '').trim();
    const users = authUsers();
    // Comparación en tiempo constante también con usuarios inexistentes,
    // para no revelar qué nombres de usuario existen.
    const expected = users.get(userName) ?? `dummy-${crypto.randomBytes(8).toString('hex')}`;
    const passwordOk = safeEqual(b.password || '', expected);
    if (!users.has(userName) || !passwordOk) {
      recordAttempt(ip);
      security.audit('login_fallido', { user: userName, ip });
      return json(res, 401, { error: 'Usuario o contraseña incorrectos' });
    }
    loginAttempts.delete(ip);
    security.audit('login_correcto', { user: userName, ip });
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { user: userName, createdAt: Date.now() });
    persistSessions();
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': `crm_session=${token}; ${cookieFlags(req)}; Max-Age=${SESSION_TTL_MS / 1000}`,
    });
    return res.end(JSON.stringify({ ok: true }));
  }
  if (req.method === 'POST' && resource === 'logout') {
    const token = parseCookies(req).crm_session;
    if (token) {
      security.audit('logout', { user: sessions.get(token)?.user || null, ip: ipOf(req) });
      sessions.delete(token);
      persistSessions();
    }
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': `crm_session=; ${cookieFlags(req)}; Max-Age=0`,
    });
    return res.end(JSON.stringify({ ok: true }));
  }

  // Todo lo demás requiere sesión si hay contraseña configurada.
  if (!isAuthenticated(req)) {
    return json(res, 401, { error: 'No autenticado' });
  }

  // Usuario de la sesión (para el aislamiento por usuario). Con isolationOn()
  // desactivado, `me` es null y no se filtra nada.
  const me = sessionUser(req);
  const visIds = visibleClientIdSet(db, me); // Set de clientIds visibles, o null
  // Colecciones ya filtradas por visibilidad (para los agregados del servidor).
  // Un expediente compartido individualmente (sharedWith) también es visible.
  const caseVisible = (c) => !visIds || visIds.has(c.clientId)
    || (Array.isArray(c.sharedWith) && c.sharedWith.includes(me));
  const clientsV = visIds ? db.clients.filter((c) => visIds.has(c.id)) : db.clients;
  const casesV = db.cases.filter(caseVisible);
  const apptsV = visIds ? db.appointments.filter((a) => visIds.has(a.clientId)) : db.appointments;
  const remindersV = visIds
    ? db.reminders.filter((r) => (!r.owner || r.owner === me) && (!r.clientId || visIds.has(r.clientId)))
    : db.reminders;
  const convSummV = () => conversationSummaries(db).filter((c) => !visIds || visIds.has(c.clientId));

  // --- Descarga de adjuntos ------------------------------------------------
  if (req.method === 'GET' && resource === 'media' && id) {
    const msg = db.messages.find((m) => m.id === id);
    if (!msg || !msg.media) return json(res, 404, { error: 'Adjunto no encontrado' });
    if (visIds && !visIds.has(msg.clientId)) return json(res, 403, { error: 'Sin acceso' });
    const media = msg.media;
    const filename = media.filename || `adjunto.${(media.mime || '').split('/')[1] || 'bin'}`;
    // Los tipos que pueden ejecutar código (SVG, HTML…) se sirven como
    // descarga y con CSP sandbox, para que un adjunto malicioso enviado por
    // WhatsApp no pueda ejecutar nada en el origen del CRM.
    const { disposition, extraHeaders } = security.mediaDisposition(media.mime, filename);
    // El id del adjunto es inmutable, así que el navegador puede cachearlo.
    const cacheHeader = { 'Cache-Control': 'private, max-age=604800' };
    if (media.localPath) {
      const full = path.join(UPLOADS_DIR, path.basename(media.localPath));
      if (!fs.existsSync(full)) return json(res, 404, { error: 'Fichero no disponible' });
      res.writeHead(200, {
        'Content-Type': media.mime || 'application/octet-stream',
        'Content-Disposition': disposition,
        ...cacheHeader,
        ...extraHeaders,
      });
      return fs.createReadStream(full).pipe(res);
    }
    try {
      const upstream = await wa.fetchInboundMedia(media);
      if (!upstream.ok) return json(res, 502, { error: `El proveedor devolvió HTTP ${upstream.status}` });
      const buf = Buffer.from(await upstream.arrayBuffer());
      // Cachea el adjunto entrante en disco: la próxima vez se sirve al instante
      // (sin volver a descargarlo del proveedor de WhatsApp).
      try {
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        const safe = path.basename(filename).replace(/[^\w.\-]+/g, '_').slice(0, 80) || 'adjunto';
        const localName = `${newId('in')}_${safe}`;
        fs.writeFileSync(path.join(UPLOADS_DIR, localName), buf);
        media.localPath = localName;
        save();
      } catch (e) { /* si no se puede cachear, se sirve igualmente */ }
      res.writeHead(200, {
        'Content-Type': media.mime || upstream.headers.get('content-type') || 'application/octet-stream',
        'Content-Disposition': disposition,
        ...cacheHeader,
        ...extraHeaders,
      });
      return res.end(buf);
    } catch (err) {
      return json(res, 502, { error: err.message });
    }
  }

  // --- Estado general -----------------------------------------------------
  if (req.method === 'GET' && resource === 'status') {
    return json(res, 200, {
      whatsappConfigured: wa.isConfigured(),
      provider: wa.provider(),
      verifyToken: wa.config().verifyToken,
      sumupConfigured: sumup.isConfigured(),
    });
  }

  // Prueba real de conexión con el proveedor de WhatsApp.
  if (req.method === 'GET' && resource === 'test-connection') {
    return json(res, 200, await wa.testConnection());
  }

  // Prueba de conexión con Microsoft 365.
  if (req.method === 'GET' && resource === 'test-microsoft') {
    const result = await msgraph.testConnection(auto.getSettings(db).microsoft);
    return json(res, 200, { ...result, configured: msgraph.isConfigured() });
  }

  // Calendario de Outlook (lectura del calendario compartido configurado).
  if (req.method === 'GET' && resource === 'outlook-calendar') {
    const cal = auto.getSettings(db).microsoft.calendar;
    if (!msgraph.isConfigured()) {
      return json(res, 200, { configured: false, calendarName: cal.calendarName || '', events: [] });
    }
    // Rango: por defecto desde hoy (00:00) hasta +14 días; admite from/to (ISO date).
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const dayIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const fromDay = url.searchParams.get('from') || dayIso(now);
    let toDay = url.searchParams.get('to');
    if (!toDay) { const t = new Date(now); t.setDate(t.getDate() + 14); toDay = dayIso(t); }
    // calendarView usa instantes; se envían como hora local de Madrid.
    const from = `${fromDay}T00:00:00`;
    const to = `${toDay}T23:59:59`;
    try {
      const events = await msgraph.listCalendarEvents({
        calendarUser: cal.user, calendarName: cal.calendarName || '', from, to,
      });
      return json(res, 200, { configured: true, calendarName: cal.calendarName || '', user: cal.user, from: fromDay, to: toDay, events });
    } catch (err) {
      return json(res, 200, { configured: true, calendarName: cal.calendarName || '', error: err.message, events: [] });
    }
  }

  // Panel «Hoy»: lista accionable del día (citas, recordatorios, vencimientos,
  // documentación pendiente, caducidades próximas y chats sin responder).
  if (req.method === 'GET' && resource === 'today') {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const soon = new Date(now); soon.setDate(soon.getDate() + 30);
    const soonIso = `${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(soon.getDate())}`;
    const nameOf = (cid) => (db.clients.find((c) => c.id === cid) || {}).name || '';
    const citas = apptsV
      .filter((a) => a.status === 'activa' && a.date === today)
      .sort((a, b) => String(a.time).localeCompare(String(b.time)))
      .map((a) => ({ clientId: a.clientId, who: nameOf(a.clientId), time: a.time, reason: a.reason || 'Consulta' }));
    const recordatorios = remindersV
      .filter((r) => !r.done && r.dueDate && r.dueDate <= today)
      .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))
      .map((r) => ({ id: r.id, text: r.text, who: nameOf(r.clientId), dueDate: r.dueDate, overdue: r.dueDate < today }));
    const vencimientos = casesV
      .filter((c) => c.status !== 'completado' && c.dueDate && c.dueDate <= today)
      .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))
      .map((c) => ({ id: c.id, title: c.title, who: nameOf(c.clientId), dueDate: c.dueDate, overdue: c.dueDate < today }));
    const docs = casesV
      .filter((c) => c.status === 'esperando_documentacion')
      .map((c) => ({ id: c.id, title: c.title, who: nameOf(c.clientId) }));
    const caducidades = casesV
      .filter((c) => c.expiryDate && c.expiryDate <= soonIso)
      .sort((a, b) => String(a.expiryDate).localeCompare(String(b.expiryDate)))
      .map((c) => ({ id: c.id, title: c.title, who: nameOf(c.clientId), expiryDate: c.expiryDate, expired: c.expiryDate < today }));
    // «Sin responder» = el cliente escribió lo último Y aún no lo has leído. Al
    // marcar como leídos (aquí o en el móvil) dejan de contar como pendientes,
    // igual que en el resumen diario de Telegram.
    const sinResponder = convSummV()
      .filter((c) => c.lastDirection === 'in' && c.unread > 0)
      .map((c) => ({ clientId: c.clientId, who: c.clientName, lastMessage: c.lastMessage, unread: c.unread }));
    return json(res, 200, { date: today, citas, recordatorios, vencimientos, docs, caducidades, sinResponder });
  }
  if (req.method === 'GET' && resource === 'dashboard') {
    const now = Date.now();
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    const openCases = casesV.filter((c) => c.status !== 'completado');
    // Expedientes que caducan en los próximos 45 días (avisos de renovación).
    const soon = now + 45 * 24 * 3600 * 1000;
    const expiringSoon = casesV.filter((c) => {
      if (!c.expiryDate) return false;
      const t = new Date(c.expiryDate + 'T00:00').getTime();
      return !Number.isNaN(t) && t <= soon;
    }).length;
    return json(res, 200, {
      totalClients: clientsV.length,
      unreadMessages: db.messages.filter((m) => m.direction === 'in' && !m.read
        && (!visIds || visIds.has(m.clientId))).length,
      openCases: openCases.length,
      casesAwaitingDocs: openCases.filter((c) => c.status === 'esperando_documentacion').length,
      overdueCases: openCases.filter((c) => c.dueDate && new Date(c.dueDate).getTime() < now).length,
      expiringSoon,
      remindersToday: remindersV.filter((r) => !r.done && r.dueDate
        && new Date(r.dueDate).getTime() <= endOfToday.getTime()).length,
      recentConversations: convSummV().slice(0, 5),
    });
  }

  // --- Clientes -----------------------------------------------------------
  if (resource === 'clients') {
    if (req.method === 'GET' && !id) {
      const q = (url.searchParams.get('q') || '').toLowerCase();
      let list = clientsV; // solo los clientes visibles para el usuario
      if (q) {
        list = list.filter((c) =>
          [c.name, c.phone, c.nif, c.email, (c.tags || []).join(' ')]
            .join(' ').toLowerCase().includes(q));
      }
      return json(res, 200, list);
    }
    if (req.method === 'POST' && !id) {
      const b = await readBody(req);
      if (!b.name || !b.phone) return json(res, 400, { error: 'Nombre y teléfono son obligatorios' });
      const phone = normalizePhone(b.phone);
      if (findClientByPhone(db, phone)) return json(res, 409, { error: 'Ya existe un cliente con ese teléfono' });
      const client = {
        id: newId('cli'),
        name: String(b.name).trim(),
        phone,
        nif: (b.nif || '').trim(),
        email: (b.email || '').trim(),
        tags: Array.isArray(b.tags) ? b.tags : [],
        // Segmento (bloque de expedientes): particular | autonomo | empresa
        segment: ['particular', 'autonomo', 'empresa'].includes(b.segment) ? b.segment : 'particular',
        // Carpeta de SharePoint vinculada { path, webUrl } o null.
        sharepointFolder: b.sharepointFolder && b.sharepointFolder.path
          ? { path: String(b.sharepointFolder.path), webUrl: b.sharepointFolder.webUrl || null } : null,
        notes: b.notes || '',
        // Aislamiento: el cliente lo crea (y por tanto es dueño) quien lo da de alta.
        owner: isolationOn() ? (me || null) : null,
        sharedWith: [],
        createdAt: Date.now(),
      };
      db.clients.push(client);
      save();
      return json(res, 201, client);
    }
    const client = db.clients.find((c) => c.id === id);
    if (!client) return json(res, 404, { error: 'Cliente no encontrado' });
    // Aislamiento: no se puede acceder a un cliente que no es tuyo ni compartido.
    if (!canSeeClient(client, me)) return json(res, 403, { error: 'No tienes acceso a este cliente' });
    // Enlace privado de «Estado del trámite» para compartir con el cliente.
    if (req.method === 'POST' && parts[3] === 'estado-link') {
      if (!client.statusToken) { client.statusToken = crypto.randomBytes(20).toString('hex'); save(); }
      const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
        || (req.socket && req.socket.encrypted ? 'https' : 'http');
      const host = req.headers.host || `localhost:${PORT}`;
      return json(res, 200, { token: client.statusToken, url: `${proto}://${host}/estado/${client.statusToken}` });
    }
    // Foto del cliente (avatar). No es la foto de WhatsApp —Meta no la
    // comparte— sino una imagen que la gestoría asigna a cada cliente.
    if (parts[3] === 'avatar') {
      if (req.method === 'GET') {
        if (!client.avatarPath) return json(res, 404, { error: 'Sin foto' });
        const full = path.join(UPLOADS_DIR, path.basename(client.avatarPath));
        if (!fs.existsSync(full)) return json(res, 404, { error: 'Foto no disponible' });
        const ext = path.extname(full).slice(1).toLowerCase();
        const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp'
          : ext === 'gif' ? 'image/gif' : 'image/jpeg';
        res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'private, max-age=60' });
        return fs.createReadStream(full).pipe(res);
      }
      if (req.method === 'POST') {
        const b = await readBody(req, 12_000_000);
        let data = null;
        let mime = 'image/jpeg';
        if (b.fromMessageId) {
          // Usar una imagen que el cliente envió por el chat.
          const src = db.messages.find((m) => m.id === b.fromMessageId && m.clientId === client.id);
          if (!src || !src.media || src.media.kind !== 'image') {
            return json(res, 400, { error: 'Ese mensaje no es una imagen' });
          }
          mime = src.media.mime || 'image/jpeg';
          if (src.media.localPath) {
            const full = path.join(UPLOADS_DIR, path.basename(src.media.localPath));
            if (fs.existsSync(full)) data = fs.readFileSync(full);
          }
          if (!data) {
            const up = await wa.fetchInboundMedia(src.media);
            if (!up || !up.ok) return json(res, 502, { error: 'No se pudo obtener la imagen' });
            data = Buffer.from(await up.arrayBuffer());
          }
        } else if (b.file && b.file.data) {
          mime = b.file.mime || 'image/jpeg';
          if (!/^image\//.test(mime)) return json(res, 400, { error: 'El archivo debe ser una imagen' });
          data = Buffer.from(b.file.data, 'base64');
          if (data.length > 8_000_000) return json(res, 400, { error: 'La imagen supera los 8 MB' });
        } else {
          return json(res, 400, { error: 'Falta la imagen' });
        }
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : mime === 'image/gif' ? 'gif' : 'jpg';
        // Se borra la foto anterior si existía.
        if (client.avatarPath) {
          try { fs.rmSync(path.join(UPLOADS_DIR, path.basename(client.avatarPath)), { force: true }); } catch { /* noop */ }
        }
        const name = `avatar_${client.id}_${Date.now()}.${ext}`;
        fs.writeFileSync(path.join(UPLOADS_DIR, name), data);
        client.avatarPath = name;
        save();
        return json(res, 200, { ok: true, avatar: true });
      }
      if (req.method === 'DELETE') {
        if (client.avatarPath) {
          try { fs.rmSync(path.join(UPLOADS_DIR, path.basename(client.avatarPath)), { force: true }); } catch { /* noop */ }
          client.avatarPath = null;
          save();
        }
        return json(res, 200, { ok: true });
      }
    }
    // Documento pre-rellenado en PDF (autorización, hoja de encargo o RGPD),
    // ya relleno con los datos del cliente y listo para imprimir y firmar.
    if (parts[3] === 'documento' && req.method === 'GET') {
      const tipo = parts[4];
      if (!documentos.TIPOS[tipo]) return json(res, 404, { error: 'Tipo de documento no válido' });
      const cases = db.cases.filter((c) => c.clientId === client.id)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      const doc = documentos.buildDocumento(tipo, { client, cases, empresa: auto.getSettings(db).empresa });
      const pdf = pdfsign.buildTextPdf({ title: doc.title, lines: doc.lines, header: doc.header });
      security.audit('documento_generado', { clientId: client.id, tipo, user: sessionUser(req) });
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${doc.filename}"`,
      });
      return res.end(pdf);
    }
    // Dossier del cliente en PDF (datos + expedientes + firmas + actividad).
    if (parts[3] === 'dossier' && req.method === 'GET') {
      const pdf = pdfsign.buildTextPdf({
        title: `Dossier del cliente — ${client.name}`,
        lines: buildDossierLines(db, client),
      });
      const safe = (client.name || 'cliente').replace(/[^\w.\-]+/g, '_').slice(0, 40);
      security.audit('dossier_generado', { clientId: client.id, user: sessionUser(req) });
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="Dossier_${safe}.pdf"`,
      });
      return res.end(pdf);
    }
    if (req.method === 'GET') return json(res, 200, client);
    if (req.method === 'PUT') {
      const b = await readBody(req);
      if (b.name !== undefined) client.name = String(b.name).trim();
      if (b.phone !== undefined) client.phone = normalizePhone(b.phone);
      if (b.nif !== undefined) client.nif = String(b.nif).trim();
      if (b.email !== undefined) client.email = String(b.email).trim();
      if (b.tags !== undefined) client.tags = Array.isArray(b.tags) ? b.tags : [];
      if (b.segment !== undefined && ['particular', 'autonomo', 'empresa'].includes(b.segment)) {
        client.segment = b.segment;
      }
      if (b.sharepointFolder !== undefined) {
        client.sharepointFolder = b.sharepointFolder && b.sharepointFolder.path
          ? { path: String(b.sharepointFolder.path), webUrl: b.sharepointFolder.webUrl || null } : null;
      }
      if (b.notes !== undefined) client.notes = String(b.notes);
      if (b.convStatus !== undefined && ['abierta', 'pendiente', 'resuelta'].includes(b.convStatus)) {
        client.convStatus = b.convStatus;
      }
      if (b.assignedTo !== undefined) client.assignedTo = b.assignedTo || null;
      if (b.pinned !== undefined) client.pinned = Boolean(b.pinned);
      if (b.pinnedNote !== undefined) client.pinnedNote = String(b.pinnedNote).slice(0, 500);
      // Aislamiento: dueño y con quién se comparte el cliente (chat + expedientes).
      // Solo el dueño (o un cliente aún sin dueño) puede reasignar/compartir.
      if (isolationOn() && (b.owner !== undefined || b.sharedWith !== undefined)) {
        if (client.owner && client.owner !== me) {
          return json(res, 403, { error: 'Solo el dueño puede cambiar el reparto o compartir' });
        }
        const valid = new Set(authUsers().keys());
        if (b.owner !== undefined) client.owner = valid.has(b.owner) ? b.owner : (me || null);
        if (b.sharedWith !== undefined) {
          client.sharedWith = (Array.isArray(b.sharedWith) ? b.sharedWith : [])
            .filter((u) => valid.has(u) && u !== client.owner);
        }
      }
      save();
      return json(res, 200, client);
    }
    if (req.method === 'DELETE') {
      const removed = purgeClientData(db, id);
      save();
      security.audit('cliente_borrado', { clientId: id, user: sessionUser(req), ip: ipOf(req), ficheros: removed.files });
      return json(res, 200, { ok: true, ...removed });
    }
  }

  // --- Conversaciones y mensajes ------------------------------------------
  // --- Importar contactos del móvil (vCard .vcf) ---------------------------
  if (req.method === 'POST' && resource === 'contacts' && id === 'import') {
    const b = await readBody(req, 15_000_000);
    const contacts = parseVCards(b.vcard || '');
    let matched = 0;
    let updated = 0;
    for (const ct of contacts) {
      let client = null;
      for (const raw of ct.phones) {
        client = findClientByPhone(db, normalizePhone(raw));
        if (client) break;
      }
      if (!client) continue;
      matched += 1;
      // Solo rellena el nombre si el cliente no tiene uno "de verdad"
      // (estaba vacío o era el propio número): no pisa nombres que ya editaste.
      if (looksLikePhone(client.name) && ct.name.trim() && client.name !== ct.name.trim()) {
        client.name = ct.name.trim();
        updated += 1;
      }
    }
    if (updated) save();
    return json(res, 200, { contacts: contacts.length, matched, updated });
  }

  if (req.method === 'GET' && resource === 'conversations') {
    return json(res, 200, convSummV());
  }

  // Sugerir una respuesta para el cliente con IA (a partir del hilo reciente y
  // de la base de conocimiento). Devuelve un borrador; no envía nada.
  if (req.method === 'POST' && resource === 'suggest-reply') {
    const b = await readBody(req);
    const client = db.clients.find((c) => c.id === b.clientId);
    if (!client) return json(res, 404, { error: 'Cliente no encontrado' });
    if (!canSeeClient(client, me)) return json(res, 403, { error: 'No tienes acceso a este cliente' });
    if (!assistant.isConfigured()) return json(res, 400, { error: 'La IA no está configurada (falta ANTHROPIC_API_KEY u OPENAI_API_KEY).' });
    const msgs = db.messages.filter((m) => m.clientId === client.id)
      .sort((a, b2) => a.timestamp - b2.timestamp).slice(-12);
    if (!msgs.length) return json(res, 400, { error: 'Todavía no hay conversación con este cliente.' });
    const transcript = msgs.map((m) => `${m.direction === 'in' ? 'Cliente' : 'Gestoría'}: ${m.text || (m.media ? '[adjunto]' : '')}`).join('\n');
    const lastIn = [...msgs].reverse().find((m) => m.direction === 'in');
    const hay = String((lastIn && lastIn.text) || '').toLowerCase();
    const kb = (db.knowledge || []).map((k) => ({ k, score: kbRelevance(k, hay) }))
      .filter((x) => x.score > 0).sort((a, b2) => b2.score - a.score).slice(0, 4).map((x) => x.k);
    const kbText = kb.map((k) => `- ${k.title}: ${String(k.notes || k.docs || '').slice(0, 300)}`).join('\n');
    const first = (client.name || '').split(' ')[0];
    const messages = [
      { role: 'system', content: 'Eres el asistente de una gestoría española de extranjería («Burocracia Zero»). Redacta en español una respuesta BREVE, cordial y profesional al último mensaje del cliente. Usa la información de la gestoría si viene al caso. No inventes datos concretos (fechas, importes, números de expediente) que no aparezcan; si falta un dato, di que lo confirmarás. No firmes con un nombre inventado.' },
      { role: 'user', content: `Cliente: ${client.name}.\n\nConversación reciente:\n${transcript}\n\n${kbText ? `Información de la gestoría que puede ayudar:\n${kbText}\n\n` : ''}Escribe SOLO el texto de la respuesta para enviar por WhatsApp a ${first}.` },
    ];
    try {
      const suggestion = await assistant.chat(messages, { temperature: 0.4 });
      if (!suggestion) return json(res, 502, { error: 'No se pudo generar la sugerencia.' });
      return json(res, 200, { suggestion });
    } catch (err) {
      console.error('Sugerir respuesta:', err.message);
      return json(res, 502, { error: 'No se pudo generar la sugerencia ahora mismo.' });
    }
  }

  if (resource === 'messages') {
    if (req.method === 'GET') {
      const clientId = url.searchParams.get('clientId');
      if (!clientId) return json(res, 400, { error: 'Falta clientId' });
      if (visIds && !visIds.has(clientId)) return json(res, 403, { error: 'Sin acceso a esta conversación' });
      const msgs = db.messages
        .filter((m) => m.clientId === clientId)
        .sort((a, b) => a.timestamp - b.timestamp);
      return json(res, 200, msgs);
    }
    if (req.method === 'POST' && id === 'read') {
      const b = await readBody(req);
      // Marcar TODO como leído: útil cuando ya has leído los WhatsApp en el
      // teléfono y el CRM sigue mostrándolos como pendientes (WhatsApp no
      // siempre avisa de las lecturas hechas desde el móvil).
      let toMark;
      if (b.all) {
        toMark = db.messages.filter((m) => m.direction === 'in' && !m.read
          && (!visIds || visIds.has(m.clientId)));
      } else {
        if (visIds && !visIds.has(b.clientId)) return json(res, 403, { error: 'Sin acceso a esta conversación' });
        toMark = db.messages.filter((m) => m.clientId === b.clientId && m.direction === 'in' && !m.read);
      }
      // WhatsApp rechaza los acuses de lectura de mensajes antiguos, así que solo
      // se reenvían los de las últimas 48 h (el resto se marca solo en el CRM).
      const recentCutoff = Date.now() - 48 * 3600 * 1000;
      for (const m of toMark) {
        m.read = true;
        if (m.timestamp >= recentCutoff) wa.markAsRead({ waMessageId: m.waMessageId, ycloudId: m.ycloudId });
      }
      if (toMark.length) save();
      return json(res, 200, { marked: toMark.length });
    }
    // Asignar VARIOS adjuntos a un expediente de una vez (y subirlos a
    // SharePoint si procede). Body: { ids: [...msgId], caseId }.
    if (req.method === 'POST' && id === 'assign-case') {
      const b = await readBody(req);
      const ids = Array.isArray(b.ids) ? b.ids.filter((x) => typeof x === 'string') : [];
      if (!ids.length) return json(res, 400, { error: 'No has seleccionado ningún documento.' });
      const kase = db.cases.find((c) => c.id === b.caseId);
      if (!kase) return json(res, 404, { error: 'Expediente no encontrado' });
      if (!canSeeCase(kase, me, db)) return json(res, 403, { error: 'Sin acceso a este expediente' });
      let assigned = 0;
      let uploaded = 0;
      const errors = [];
      for (const mid of ids) {
        const msg = db.messages.find((m) => m.id === mid);
        if (!msg || !msg.media) continue; // solo mensajes con adjunto
        if (visIds && !visIds.has(msg.clientId)) continue; // respeta el aislamiento
        const hadUrl = Boolean(msg.sharepointUrl);
        msg.caseId = kase.id;
        assigned += 1;
        await uploadMsgToSharePoint(db, msg);
        if (msg.sharepointUrl && !hadUrl) uploaded += 1;
        else if (msg.sharepointError) errors.push(msg.media.filename || mid);
      }
      if (assigned) save();
      return json(res, 200, { assigned, uploaded, errors });
    }
    // Vincular un adjunto a un expediente (y subirlo a SharePoint si procede).
    if (req.method === 'PUT' && id) {
      const b = await readBody(req);
      const msg = db.messages.find((m) => m.id === id);
      if (!msg) return json(res, 404, { error: 'Mensaje no encontrado' });
      if (visIds && !visIds.has(msg.clientId)) return json(res, 403, { error: 'Sin acceso a este mensaje' });
      if (b.caseId !== undefined) {
        if (b.caseId && !db.cases.some((c) => c.id === b.caseId)) {
          return json(res, 404, { error: 'Expediente no encontrado' });
        }
        if (b.caseId && !canSeeCase(db.cases.find((c) => c.id === b.caseId), me, db)) {
          return json(res, 403, { error: 'Sin acceso a este expediente' });
        }
        msg.caseId = b.caseId || null;
        await uploadMsgToSharePoint(db, msg);
      }
      save();
      return json(res, 200, msg);
    }
    if (req.method === 'POST') {
      // Hasta ~25 MB para permitir adjuntos en base64 (límite WhatsApp: 16 MB).
      const b = await readBody(req, 25_000_000);
      const client = db.clients.find((c) => c.id === b.clientId);
      if (!client) return json(res, 404, { error: 'Cliente no encontrado' });
      if (!canSeeClient(client, me)) return json(res, 403, { error: 'No tienes acceso a este cliente' });

      // Responder citando un mensaje: se localiza el mensaje citado (del mismo
      // cliente) para enlazar la respuesta y mostrar la cita en el chat.
      const replyOpts = {};
      if (b.replyTo) {
        const quoted = db.messages.find((m) => m.id === b.replyTo && m.clientId === client.id);
        if (quoted) {
          replyOpts.replyToWamid = quoted.waMessageId || null;
          replyOpts.replySnapshot = {
            id: quoted.id,
            direction: quoted.direction,
            text: String(quoted.text || (quoted.media ? '📎 ' + (quoted.media.filename || 'Adjunto') : '')).slice(0, 140),
          };
        }
      }

      // Nota interna: se guarda en la conversación pero NO se envía al cliente.
      if (b.note) {
        if (!b.text || !String(b.text).trim()) return json(res, 400, { error: 'La nota está vacía' });
        const noteMsg = {
          id: newId('msg'),
          clientId: client.id,
          direction: 'note',
          text: String(b.text).trim(),
          author: sessionUser(req) || 'equipo',
          timestamp: Date.now(),
          status: 'note',
          read: true,
        };
        db.messages.push(noteMsg);
        save();
        return json(res, 201, noteMsg);
      }

      // Envío de una ficha de trámite (documentación) al cliente.
      if (b.fichaId) {
        ensureDefaultFichas(db);
        const ficha = db.fichas.find((f) => f.id === b.fichaId);
        if (!ficha) return json(res, 404, { error: 'Ficha no encontrada' });
        const first = (client.name || '').split(' ')[0];
        const fill = (t) => String(t || '').replaceAll('{nombre}', first).replaceAll('{tramite}', ficha.title);
        const parts = [
          fill(ficha.intro) || `Hola ${first} 👋 Para tramitar «${ficha.title}» necesitamos:`,
          ficha.docs,
          fill(ficha.notes),
        ].filter((p) => p && p.trim());
        const msg = await sendMessageToClient(db, client, parts.join('\n\n'));
        return json(res, 201, msg);
      }

      // Envío de un sticker de Burocracia Zero (por id del catálogo).
      if (b.stickerId) {
        const sticker = loadStickers().find((s) => s.id === b.stickerId);
        if (!sticker) return json(res, 404, { error: 'Sticker no encontrado' });
        const file = path.join(STICKERS_DIR, sticker.file);
        if (!fs.existsSync(file)) return json(res, 404, { error: 'Fichero del sticker no disponible' });
        const data = fs.readFileSync(file);
        let mediaId = null;
        if (wa.isConfigured()) {
          try {
            mediaId = await wa.uploadMedia(data, sticker.file, 'image/webp');
          } catch (err) {
            return json(res, 502, { error: err.message });
          }
        }
        const msg = await sendMessageToClient(db, client, sticker.emoji || '🎟️', {
          media: {
            kind: 'sticker',
            mime: 'image/webp',
            filename: sticker.file,
            caption: '',
            mediaId,
            // Se reutiliza el fichero estático del catálogo para mostrarlo.
            stickerUrl: `/stickers/${sticker.file}`,
          },
        });
        return json(res, 201, msg);
      }

      if (b.file && b.file.data) {
        const data = Buffer.from(b.file.data, 'base64');
        if (data.length > 16_000_000) return json(res, 400, { error: 'El archivo supera los 16 MB de WhatsApp' });
        const mime = b.file.mime || 'application/octet-stream';
        const filename = path.basename(b.file.name || 'archivo');
        // Las notas de voz grabadas en el navegador llegan ya convertidas a MP3
        // (audio/mpeg), un formato que WhatsApp acepta, por lo que se envían como
        // audio normal con su mimetype real.
        const kind = mime.startsWith('image/') && mime !== 'image/svg+xml' ? 'image'
          : mime.startsWith('video/') ? 'video'
            : mime.startsWith('audio/') ? 'audio' : 'document';
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        const localName = `${newId('up')}_${filename.replace(/[^\w.\-]+/g, '_')}`;
        fs.writeFileSync(path.join(UPLOADS_DIR, localName), data);
        let mediaId = null;
        if (wa.isConfigured()) {
          try {
            mediaId = await wa.uploadMedia(data, filename, mime);
          } catch (err) {
            return json(res, 502, { error: err.message });
          }
        }
        const msg = await sendMessageToClient(db, client, String(b.text || '').trim() || `📎 ${filename}`, {
          ...replyOpts,
          media: {
            kind,
            mime,
            filename,
            caption: String(b.text || '').trim(),
            mediaId,
            localPath: localName,
          },
        });
        return json(res, 201, msg);
      }

      if (!b.text || !String(b.text).trim()) return json(res, 400, { error: 'El mensaje está vacío' });
      const msg = await sendMessageToClient(db, client, String(b.text).trim(), replyOpts);
      return json(res, 201, msg);
    }
  }

  // --- Mensajes programados -----------------------------------------------
  if (resource === 'scheduled-messages') {
    if (req.method === 'GET') {
      const clientId = url.searchParams.get('clientId');
      // Aislamiento: solo los mensajes programados de clientes visibles.
      let list = db.scheduledMessages.filter((s) => !visIds || visIds.has(s.clientId));
      if (clientId) list = list.filter((s) => s.clientId === clientId);
      list = list.slice().sort((a, b) => a.sendAt - b.sendAt);
      return json(res, 200, list);
    }
    if (req.method === 'POST') {
      const b = await readBody(req);
      const client = db.clients.find((c) => c.id === b.clientId);
      if (!client) return json(res, 404, { error: 'Cliente no encontrado' });
      if (!canSeeClient(client, me)) return json(res, 403, { error: 'No tienes acceso a este cliente' });
      const text = String(b.text || '').trim();
      if (!text) return json(res, 400, { error: 'El mensaje está vacío' });
      const sendAt = Number(b.sendAt);
      if (!Number.isFinite(sendAt) || sendAt <= Date.now()) {
        return json(res, 400, { error: 'La fecha de envío debe ser futura' });
      }
      const sched = {
        id: newId('sch'),
        clientId: client.id,
        text,
        sendAt,
        status: 'pendiente', // pendiente | enviado | error
        createdAt: Date.now(),
        createdBy: sessionUser(req) || 'equipo',
      };
      db.scheduledMessages.push(sched);
      save();
      return json(res, 201, sched);
    }
    if (req.method === 'DELETE' && id) {
      const item = db.scheduledMessages.find((s) => s.id === id);
      if (!item) return json(res, 404, { error: 'No encontrado' });
      if (visIds && !visIds.has(item.clientId)) return json(res, 403, { error: 'Sin acceso' });
      db.scheduledMessages = db.scheduledMessages.filter((s) => s.id !== id);
      save();
      return json(res, 200, { ok: true });
    }
  }

  // --- Tareas del equipo (panel tipo kanban) ------------------------------
  if (resource === 'tasks') {
    const STATES = ['por_hacer', 'en_curso', 'hecho'];
    if (req.method === 'GET') {
      const list = db.tasks.slice().sort((a, b) =>
        String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999'))
        || (b.createdAt || 0) - (a.createdAt || 0));
      return json(res, 200, list);
    }
    if (req.method === 'POST' && !id) {
      const b = await readBody(req);
      const title = String(b.title || '').trim();
      if (!title) return json(res, 400, { error: 'El título es obligatorio' });
      const task = {
        id: newId('task'),
        title,
        assignee: b.assignee ? String(b.assignee).trim() : '',
        status: STATES.includes(b.status) ? b.status : 'por_hacer',
        dueDate: b.dueDate || null,
        clientId: b.clientId || null,
        caseId: b.caseId || null,
        notes: b.notes ? String(b.notes) : '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: sessionUser(req) || 'equipo',
      };
      db.tasks.push(task);
      save();
      return json(res, 201, task);
    }
    const task = db.tasks.find((t) => t.id === id);
    if (id && !task) return json(res, 404, { error: 'Tarea no encontrada' });
    if (req.method === 'PUT' && task) {
      const b = await readBody(req);
      if (b.title !== undefined) task.title = String(b.title).trim() || task.title;
      if (b.assignee !== undefined) task.assignee = String(b.assignee).trim();
      if (b.status !== undefined && STATES.includes(b.status)) task.status = b.status;
      if (b.dueDate !== undefined) task.dueDate = b.dueDate || null;
      if (b.clientId !== undefined) task.clientId = b.clientId || null;
      if (b.caseId !== undefined) task.caseId = b.caseId || null;
      if (b.notes !== undefined) task.notes = String(b.notes);
      task.updatedAt = Date.now();
      save();
      return json(res, 200, task);
    }
    if (req.method === 'DELETE' && task) {
      db.tasks = db.tasks.filter((t) => t.id !== id);
      save();
      return json(res, 200, { ok: true });
    }
  }

  // --- Firma digital de autorizaciones / consentimientos ------------------
  if (resource === 'signatures') {
    if (req.method === 'GET' && id === 'docs') {
      // Catálogo de documentos disponibles para firmar.
      return json(res, 200, Object.entries(SIGN_DOCS).map(([key, d]) => ({ key, label: d.label })));
    }
    if (req.method === 'GET' && !id) {
      const clientId = url.searchParams.get('clientId');
      // Aislamiento: solo las firmas de clientes visibles para el usuario.
      let list = db.signatures.filter((s) => !visIds || visIds.has(s.clientId)).map(publicSignature);
      if (clientId) list = list.filter((s) => s.clientId === clientId);
      list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      return json(res, 200, list);
    }
    if (req.method === 'POST' && !id) {
      const b = await readBody(req);
      const client = db.clients.find((c) => c.id === b.clientId);
      if (!client) return json(res, 404, { error: 'Cliente no encontrado' });
      if (!canSeeClient(client, me)) return json(res, 403, { error: 'No tienes acceso a este cliente' });
      const docType = SIGN_DOCS[b.docType] ? b.docType : 'representacion';
      let caseTitle = '';
      if (b.caseId) {
        const cse = db.cases.find((c) => c.id === b.caseId);
        if (cse) caseTitle = cse.title;
      }
      const doc = buildSignatureDoc(docType, client, caseTitle);
      const sig = {
        id: newId('sig'),
        clientId: client.id,
        caseId: b.caseId || null,
        docType,
        title: doc.title,
        body: doc.body,
        status: 'pendiente', // pendiente | firmado | anulado
        token: crypto.randomBytes(20).toString('hex'),
        createdAt: Date.now(),
        createdBy: sessionUser(req) || 'equipo',
        sentAt: null,
        signedAt: null,
        signerName: null,
        signerIp: null,
        pdfPath: null,
        sharepointUrl: null,
      };
      db.signatures.push(sig);
      const signUrl = `${publicBase(req)}/firmar/${sig.token}`;
      // Nota interna en la conversación para que quede constancia.
      db.messages.push({
        id: newId('msg'), clientId: client.id, direction: 'note',
        text: `✍️ Firma solicitada: ${doc.title}\n${signUrl}`,
        author: sessionUser(req) || 'equipo', timestamp: Date.now(), status: 'note', read: true,
      });
      save();
      // Envío del enlace al cliente por WhatsApp (opcional).
      if (b.send) {
        const first = (client.name || '').split(' ')[0];
        const msg = `Hola ${first} 👋 Para continuar con tu trámite necesitamos tu firma. `
          + `Abre este enlace en el móvil, revisa el documento y fírmalo con el dedo:\n${signUrl}`;
        try {
          await sendMessageToClient(db, client, msg);
          sig.sentAt = Date.now();
          save();
        } catch (err) {
          return json(res, 201, { ...publicSignature(sig), signUrl, sendError: err.message });
        }
      }
      return json(res, 201, { ...publicSignature(sig), signUrl });
    }
    const sig = db.signatures.find((s) => s.id === id);
    if (id && !sig) return json(res, 404, { error: 'Solicitud de firma no encontrada' });
    // Aislamiento: no se puede ver ni tocar una firma de un cliente ajeno (si no
    // el token secreto de firma quedaría expuesto por enumeración de ids).
    if (sig && !canSeeClient(db.clients.find((c) => c.id === sig.clientId), me)) {
      return json(res, 403, { error: 'No tienes acceso a esta firma' });
    }
    if (req.method === 'GET' && sig) {
      return json(res, 200, { ...publicSignature(sig), signUrl: `${publicBase(req)}/firmar/${sig.token}` });
    }
    if (req.method === 'POST' && sig && parts[3] === 'resend') {
      // Reenvía el enlace al cliente.
      const client = db.clients.find((c) => c.id === sig.clientId);
      if (!client) return json(res, 404, { error: 'Cliente no encontrado' });
      if (sig.status !== 'pendiente') return json(res, 400, { error: 'La firma ya no está pendiente' });
      const first = (client.name || '').split(' ')[0];
      const signUrl = `${publicBase(req)}/firmar/${sig.token}`;
      const msg = `Hola ${first} 👋 Te reenviamos el enlace para firmar tu documento:\n${signUrl}`;
      await sendMessageToClient(db, client, msg);
      sig.sentAt = Date.now();
      save();
      return json(res, 200, { ...publicSignature(sig), signUrl });
    }
    if (req.method === 'DELETE' && sig) {
      sig.status = 'anulado';
      save();
      return json(res, 200, { ok: true });
    }
  }

  // --- Base de conocimiento de trámites (tarifas + tasas + documentos) -----
  if (resource === 'knowledge') {
    if (req.method === 'GET') {
      const list = db.knowledge.slice().sort((a, b) =>
        String(a.area).localeCompare(String(b.area)) || String(a.title).localeCompare(String(b.title)));
      return json(res, 200, list);
    }
    if (req.method === 'POST' && !id) {
      const b = await readBody(req);
      const title = String(b.title || '').trim();
      if (!title) return json(res, 400, { error: 'El título es obligatorio' });
      const item = {
        id: newId('kb'),
        title,
        area: b.area || 'otro',
        keywords: String(b.keywords || '').trim(),
        fee: String(b.fee || '').trim(),
        tax: String(b.tax || '').trim(),
        docs: String(b.docs || ''),
        notes: String(b.notes || ''),
        updatedAt: Date.now(),
        createdAt: Date.now(),
      };
      db.knowledge.push(item);
      save();
      return json(res, 201, item);
    }
    const item = db.knowledge.find((k) => k.id === id);
    if (id && !item) return json(res, 404, { error: 'Trámite no encontrado' });
    if (req.method === 'PUT' && item) {
      const b = await readBody(req);
      for (const key of ['title', 'area', 'keywords', 'fee', 'tax', 'docs', 'notes']) {
        if (b[key] !== undefined) item[key] = key === 'title' ? String(b[key]).trim() : String(b[key]);
      }
      if (!item.title) return json(res, 400, { error: 'El título es obligatorio' });
      item.updatedAt = Date.now();
      save();
      return json(res, 200, item);
    }
    if (req.method === 'DELETE' && item) {
      db.knowledge = db.knowledge.filter((k) => k.id !== id);
      save();
      return json(res, 200, { ok: true });
    }
  }

  // Simulador de mensajes entrantes (solo modo demo, para probar sin Meta).
  if (req.method === 'POST' && resource === 'simulate-incoming') {
    const b = await readBody(req);
    const phone = normalizePhone(b.phone || '34600000000');
    const client = ensureClientForPhone(db, phone, b.name || '');
    db.messages.push({
      id: newId('msg'),
      clientId: client.id,
      direction: 'in',
      text: b.text || 'Hola, quería consultar por mi trámite.',
      timestamp: Date.now(),
      status: 'received',
      waMessageId: null,
      read: false,
    });
    save();
    if (auto.isHolidayActive(db)) {
      await auto.maybeHoliday(db, client, autoSender(db));
    } else {
      const wasMenuReply = await auto.maybeMenuReply(db, client, b.text || '', autoSender(db));
      if (!wasMenuReply) {
        await auto.maybeWelcome(db, client, autoSender(db));
        await auto.maybeAutoReply(db, client, autoSender(db));
      }
    }
    // Persistir los indicadores de las automatizaciones (p. ej. el aviso de
    // vacaciones, una vez al día) para que no se repitan tras un reinicio.
    save();
    return json(res, 201, { ok: true, clientId: client.id });
  }

  // --- Expedientes / trámites ---------------------------------------------
  if (resource === 'cases') {
    // Documentos vinculados a un expediente.
    if (req.method === 'GET' && id && parts[3] === 'files') {
      const kase = db.cases.find((c) => c.id === id);
      if (kase && !canSeeCase(kase, me, db)) return json(res, 403, { error: 'Sin acceso a este expediente' });
      const files = db.messages
        .filter((m) => m.caseId === id && m.media)
        .map((m) => ({
          msgId: m.id,
          filename: m.media.filename || 'adjunto',
          kind: m.media.kind,
          direction: m.direction,
          timestamp: m.timestamp,
        }));
      return json(res, 200, files);
    }
    if (req.method === 'GET' && !id) {
      const clientId = url.searchParams.get('clientId');
      let list = casesV;
      if (clientId) list = list.filter((c) => c.clientId === clientId);
      return json(res, 200, list);
    }
    if (req.method === 'POST' && !id) {
      const b = await readBody(req);
      if (!b.clientId || !b.title) return json(res, 400, { error: 'Cliente y título son obligatorios' });
      // No se puede crear un expediente sobre un cliente que no es visible.
      if (visIds && !visIds.has(b.clientId)) return json(res, 403, { error: 'No tienes acceso a este cliente' });
      const item = {
        id: newId('exp'),
        clientId: b.clientId,
        title: String(b.title).trim(),
        type: b.type || 'otro', // fiscal | laboral | contabilidad | extranjeria | vehiculos | otro
        status: b.status || 'pendiente', // pendiente | en_curso | esperando_documentacion | completado
        dueDate: b.dueDate || null,
        // Fecha en que se presentó el trámite ante la administración (visible
        // para el cliente en su página de seguimiento).
        submittedDate: b.submittedDate || null,
        // Nº de registro / expediente que asigna la administración (lo ve el
        // cliente en su página de seguimiento).
        registryNumber: b.registryNumber ? String(b.registryNumber).trim().slice(0, 80) : '',
        // Enlace de seguimiento en la sede de la administración (si lo permite).
        trackingUrl: safeHttpUrl(b.trackingUrl),
        // Fecha de caducidad del documento resultante (TIE, NIE, ITV…): dispara
        // el aviso de renovación antes de que venza.
        expiryDate: b.expiryDate || null,
        docs: b.docs || '', // documentación necesaria (para la automatización)
        fee: money2(b.fee), // honorario del trámite (€, con céntimos)
        paid: Boolean(b.paid), // cobrado del todo o pendiente
        // Honorarios cobrados hasta ahora (admite adelantos/pagos a plazos).
        paidAmount: Boolean(b.paid) ? money2(b.fee)
          : Math.max(0, Math.min(money2(b.paidAmount), money2(b.fee))),
        paidAt: (b.paid || Number(b.paidAmount) > 0) ? Date.now() : null, // fecha de cobro (para el libro de ingresos)
        payMethod: PAY_METHODS.includes(b.payMethod) ? b.payMethod : '', // forma de cobro: caja | banco
        // Tasa oficial del trámite, separada de los honorarios de la gestoría.
        taxModel: b.taxModel ? String(b.taxModel).trim().slice(0, 60) : '', // ej. «790 cód. 012»
        taxAmount: money2(b.taxAmount), // importe de la tasa oficial (€, con céntimos)
        taxPaid: Boolean(b.taxPaid), // tasa abonada o pendiente
        taxPaidAt: b.taxPaid ? Date.now() : null, // fecha de abono de la tasa
        // Checklist de documentación recibida: [{ item, done }]
        checklist: Array.isArray(b.checklist)
          ? b.checklist.map((c) => ({ item: String(c.item || '').trim(), done: Boolean(c.done) })).filter((c) => c.item)
          : [],
        // Usuarios con los que se comparte este expediente en concreto (además
        // del reparto que herede del cliente). Solo aplica con aislamiento.
        sharedWith: [],
        notes: b.notes || '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      db.cases.push(item);
      save();
      if (item.status !== 'pendiente') {
        const client = db.clients.find((c) => c.id === item.clientId);
        await auto.onCaseStatusChanged(db, item, client, autoSender(db));
        save();
      }
      return json(res, 201, item);
    }
    const item = db.cases.find((c) => c.id === id);
    if (!item) return json(res, 404, { error: 'Expediente no encontrado' });
    if (!canSeeCase(item, me, db)) return json(res, 403, { error: 'Sin acceso a este expediente' });
    // Recibo/justificante de pago del honorario en PDF. Asigna un número de
    // recibo persistente la primera vez (para que las reimpresiones coincidan).
    if (parts[3] === 'recibo' && req.method === 'GET') {
      // El recibo justifica lo realmente cobrado (incluidos los adelantos).
      const amount = feePaidOf(item);
      if (amount <= 0) return json(res, 400, { error: 'Este expediente aún no tiene ningún honorario cobrado que justificar' });
      if (!item.reciboNumber) {
        if (!db.settings || typeof db.settings !== 'object') db.settings = {};
        const seq = (Number(db.settings.reciboSeq) || 0) + 1;
        db.settings.reciboSeq = seq;
        const year = new Date().getFullYear();
        item.reciboNumber = `R-${year}-${String(seq).padStart(4, '0')}`;
        item.reciboAt = Date.now();
        save();
      }
      const client = db.clients.find((c) => c.id === item.clientId) || {};
      const doc = documentos.buildRecibo({
        client, concepto: item.title, amount, method: item.payMethod,
        number: item.reciboNumber, tasa: Number(item.taxAmount) || 0, tasaPaid: !!item.taxPaid,
        empresa: auto.getSettings(db).empresa, now: item.reciboAt || Date.now(),
      });
      const pdf = pdfsign.buildTextPdf({ title: doc.title, lines: doc.lines, header: doc.header });
      security.audit('recibo_generado', { caseId: item.id, clientId: item.clientId, number: item.reciboNumber, user: sessionUser(req) });
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${doc.filename}"`,
      });
      return res.end(pdf);
    }
    if (req.method === 'GET') return json(res, 200, item);
    if (req.method === 'PUT') {
      const b = await readBody(req);
      const oldStatus = item.status;
      const oldExpiry = item.expiryDate || null;
      for (const key of ['title', 'type', 'status', 'dueDate', 'expiryDate', 'docs', 'notes']) {
        if (b[key] !== undefined) item[key] = b[key];
      }
      if (b.submittedDate !== undefined) item.submittedDate = b.submittedDate || null;
      if (b.registryNumber !== undefined) item.registryNumber = String(b.registryNumber || '').trim().slice(0, 80);
      if (b.trackingUrl !== undefined) item.trackingUrl = safeHttpUrl(b.trackingUrl);
      // Si se cambia la fecha de caducidad, se rearma el aviso de renovación.
      if (b.expiryDate !== undefined && b.expiryDate !== oldExpiry) {
        item.expiryNotifiedAt = null;
        item.renewalCaseId = null;
      }
      if (b.fee !== undefined) item.fee = money2(b.fee);
      if (b.paid !== undefined) {
        const nowPaid = Boolean(b.paid);
        if (nowPaid) {
          // Cobrado del todo: sella fecha (si no la tenía) y fija el total.
          if (!item.paid) item.paidAt = Date.now();
          item.paid = true;
          item.paidAmount = money2(item.fee) || 0;
        } else {
          // Marcar como pendiente: solo pone a cero si estaba cobrado del TODO.
          // Si había un adelanto parcial, se conserva (no se borra al guardar la
          // ficha del expediente).
          if (item.paid) { item.paidAmount = 0; item.paidAt = null; }
          item.paid = false;
        }
      }
      // Importe cobrado a cuenta (adelanto/pago parcial), fijado directamente.
      if (b.paidAmount !== undefined) {
        item.paidAmount = Math.max(0, Math.min(money2(b.paidAmount), money2(item.fee) || 0));
        const fullyPaid = (money2(item.fee) || 0) > 0 && item.paidAmount >= (money2(item.fee) || 0);
        if (fullyPaid && !item.paid) item.paidAt = Date.now();
        item.paid = fullyPaid;
        if (item.paidAmount > 0 && !item.paidAt) item.paidAt = Date.now();
      }
      if (b.payMethod !== undefined) item.payMethod = PAY_METHODS.includes(b.payMethod) ? b.payMethod : '';
      if (b.taxModel !== undefined) item.taxModel = String(b.taxModel).trim().slice(0, 60);
      if (b.taxAmount !== undefined) item.taxAmount = money2(b.taxAmount);
      if (b.taxPaid !== undefined) {
        const nowTaxPaid = Boolean(b.taxPaid);
        if (nowTaxPaid && !item.taxPaid) item.taxPaidAt = Date.now();
        else if (!nowTaxPaid) item.taxPaidAt = null;
        item.taxPaid = nowTaxPaid;
      }
      if (Array.isArray(b.checklist)) {
        item.checklist = b.checklist
          .map((c) => ({ item: String(c.item || '').trim(), done: Boolean(c.done) }))
          .filter((c) => c.item);
      }
      // Compartir el expediente en concreto. Solo el dueño del cliente (o si el
      // cliente no tiene dueño) puede cambiar el reparto del expediente.
      if (isolationOn() && b.sharedWith !== undefined) {
        const owner = (db.clients.find((c) => c.id === item.clientId) || {}).owner || null;
        if (owner && owner !== me) {
          return json(res, 403, { error: 'Solo el dueño puede compartir este expediente' });
        }
        const valid = new Set(authUsers().keys());
        item.sharedWith = (Array.isArray(b.sharedWith) ? b.sharedWith : [])
          .filter((u) => valid.has(u) && u !== owner);
      }
      item.updatedAt = Date.now();
      save();
      if (item.status !== oldStatus) {
        const client = db.clients.find((c) => c.id === item.clientId);
        await auto.onCaseStatusChanged(db, item, client, autoSender(db));
        save();
      }
      return json(res, 200, item);
    }
    if (req.method === 'DELETE') {
      db.cases = db.cases.filter((c) => c.id !== id);
      save();
      return json(res, 200, { ok: true });
    }
  }

  // --- Plantillas de respuesta rápida --------------------------------------
  if (resource === 'templates') {
    if (req.method === 'GET') return json(res, 200, db.templates);
    if (req.method === 'POST' && !id) {
      const b = await readBody(req);
      if (!b.name || !b.text) return json(res, 400, { error: 'Nombre y texto son obligatorios' });
      const t = { id: newId('tpl'), name: String(b.name).trim(), text: String(b.text) };
      db.templates.push(t);
      save();
      return json(res, 201, t);
    }
    const t = db.templates.find((x) => x.id === id);
    if (!t) return json(res, 404, { error: 'Plantilla no encontrada' });
    if (req.method === 'PUT') {
      const b = await readBody(req);
      if (b.name !== undefined) t.name = String(b.name).trim();
      if (b.text !== undefined) t.text = String(b.text);
      save();
      return json(res, 200, t);
    }
    if (req.method === 'DELETE') {
      db.templates = db.templates.filter((x) => x.id !== id);
      save();
      return json(res, 200, { ok: true });
    }
  }

  // --- Formularios JotForm embebidos ---------------------------------------
  if (resource === 'forms') {
    if (req.method === 'GET' && !id) return json(res, 200, db.forms);
    if (req.method === 'POST' && !id) {
      const b = await readBody(req);
      const name = String(b.name || '').trim();
      const formUrl = String(b.url || '').trim();
      if (!name) return json(res, 400, { error: 'El nombre es obligatorio' });
      if (!isJotformUrl(formUrl)) return json(res, 400, { error: 'La URL debe ser un enlace https de JotForm' });
      const f = { id: newId('form'), name, url: formUrl };
      db.forms.push(f);
      save();
      return json(res, 201, f);
    }
    const f = db.forms.find((x) => x.id === id);
    if (!f) return json(res, 404, { error: 'Formulario no encontrado' });
    if (req.method === 'PUT') {
      const b = await readBody(req);
      if (b.name !== undefined) f.name = String(b.name).trim();
      if (b.url !== undefined) {
        if (!isJotformUrl(String(b.url).trim())) return json(res, 400, { error: 'La URL debe ser un enlace https de JotForm' });
        f.url = String(b.url).trim();
      }
      save();
      return json(res, 200, f);
    }
    if (req.method === 'DELETE') {
      db.forms = db.forms.filter((x) => x.id !== id);
      save();
      return json(res, 200, { ok: true });
    }
  }

  // --- Citas ----------------------------------------------------------------
  if (resource === 'appointments') {
    if (req.method === 'GET' && !id) {
      const clientId = url.searchParams.get('clientId');
      let list = apptsV;
      if (clientId) list = list.filter((a) => a.clientId === clientId);
      list = list.slice().sort((a, b) =>
        `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
      return json(res, 200, list);
    }
    if (req.method === 'POST' && !id) {
      const b = await readBody(req);
      const client = db.clients.find((c) => c.id === b.clientId);
      if (!client) return json(res, 404, { error: 'Cliente no encontrado' });
      if (!canSeeClient(client, me)) return json(res, 403, { error: 'No tienes acceso a este cliente' });
      if (!b.date || !b.time) return json(res, 400, { error: 'Fecha y hora son obligatorias' });
      const appt = await createAppointment(db, client, { date: b.date, time: b.time, reason: b.reason, notes: b.notes });
      return json(res, 201, appt);
    }
    const appt = db.appointments.find((a) => a.id === id);
    if (!appt) return json(res, 404, { error: 'Cita no encontrada' });
    if (visIds && !visIds.has(appt.clientId)) return json(res, 403, { error: 'Sin acceso a esta cita' });
    if (req.method === 'PUT') {
      const b = await readBody(req);
      for (const key of ['date', 'time', 'reason', 'notes']) {
        if (b[key] !== undefined) appt[key] = b[key];
      }
      if (b.status !== undefined && ['activa', 'cancelada', 'completada'].includes(b.status)) {
        appt.status = b.status;
      }
      const msCal = auto.getSettings(db).microsoft.calendar;
      if (msgraph.isConfigured() && msCal.enabled && msCal.user && appt.msEventId) {
        try {
          if (appt.status === 'cancelada') {
            await msgraph.deleteCalendarEvent(msCal.user, appt.msEventId);
            appt.msEventId = null;
          } else {
            const client = db.clients.find((c) => c.id === appt.clientId);
            if (client) await msgraph.updateCalendarEvent(msCal.user, appt.msEventId, appt, client);
          }
        } catch (err) {
          console.error('No se pudo actualizar el evento en Outlook:', err.message);
        }
      }
      save();
      return json(res, 200, appt);
    }
    if (req.method === 'DELETE') {
      db.appointments = db.appointments.filter((a) => a.id !== id);
      save();
      return json(res, 200, { ok: true });
    }
  }

  // --- Reservas pendientes de pago (transferencias por confirmar) -----------
  if (resource === 'pending-bookings') {
    expirePendingBookings(db);
    if (req.method === 'GET' && !id) {
      // Solo las que esperan acción de la gestoría: transferencias pendientes.
      const list = db.pendingBookings
        .filter((p) => p.status === 'pending' && p.method === 'transferencia'
          && (!visIds || visIds.has(p.clientId)))
        .map((p) => ({ ...p, clientName: (db.clients.find((c) => c.id === p.clientId) || {}).name || '' }))
        .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
      return json(res, 200, list);
    }
    const booking = db.pendingBookings.find((p) => p.id === id);
    if (!booking) return json(res, 404, { error: 'Reserva no encontrada' });
    if (visIds && !visIds.has(booking.clientId)) return json(res, 403, { error: 'Sin acceso a esta reserva' });
    // Confirmar el pago (transferencia recibida) → crea la cita en firme.
    if (req.method === 'POST' && parts[3] === 'confirm') {
      if (booking.status !== 'pending') return json(res, 400, { error: 'Esta reserva ya no está pendiente' });
      const appt = await finalizeBooking(db, booking, { method: 'transferencia' });
      if (!appt) return json(res, 500, { error: 'No se pudo confirmar la cita' });
      security.audit('cita_transferencia_confirmada', { bookingId: booking.id, clientId: booking.clientId, amount: booking.amount, user: sessionUser(req) });
      return json(res, 200, { ok: true, appointmentId: appt.id });
    }
    // Rechazar/cancelar la reserva pendiente → libera el hueco.
    if (req.method === 'POST' && parts[3] === 'cancel') {
      db.pendingBookings = db.pendingBookings.filter((p) => p.id !== booking.id);
      save();
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'Acción no válida' });
  }

  // --- Usuarios del equipo (para asignar conversaciones) --------------------
  if (req.method === 'GET' && resource === 'users') {
    return json(res, 200, [...authUsers().keys()]);
  }

  // --- Catálogo de stickers de la gestoría ----------------------------------
  if (req.method === 'GET' && resource === 'stickers') {
    return json(res, 200, loadStickers());
  }

  // --- Fichas de trámite (documentación por trámite) ------------------------
  if (resource === 'fichas') {
    ensureDefaultFichas(db);
    if (req.method === 'GET' && !id) return json(res, 200, db.fichas);
    if (req.method === 'POST' && !id) {
      const b = await readBody(req);
      if (!b.title) return json(res, 400, { error: 'El título es obligatorio' });
      const ficha = {
        id: newId('fic'),
        title: String(b.title).trim(),
        area: b.area || 'otro',
        intro: b.intro || '',
        docs: b.docs || '',
        notes: b.notes || '',
        createdAt: Date.now(),
      };
      db.fichas.push(ficha);
      save();
      return json(res, 201, ficha);
    }
    const ficha = db.fichas.find((f) => f.id === id);
    if (!ficha) return json(res, 404, { error: 'Ficha no encontrada' });
    if (req.method === 'PUT') {
      const b = await readBody(req);
      for (const k of ['title', 'area', 'intro', 'docs', 'notes']) {
        if (b[k] !== undefined) ficha[k] = String(b[k]);
      }
      save();
      return json(res, 200, ficha);
    }
    if (req.method === 'DELETE') {
      db.fichas = db.fichas.filter((f) => f.id !== id);
      save();
      return json(res, 200, { ok: true });
    }
  }

  // --- Carpetas de SharePoint (para vincular al cliente) --------------------
  if (resource === 'sharepoint') {
    const msSp = auto.getSettings(db).microsoft.sharepoint;
    if (!msgraph.isConfigured()) {
      return json(res, 200, { configured: false, error: 'Microsoft 365 no está configurado en el servidor.' });
    }
    // Ruta sugerida para un cliente nuevo, según segmento y plantilla.
    if (req.method === 'GET' && id === 'suggest') {
      const name = url.searchParams.get('name') || 'SIN NOMBRE';
      const segment = url.searchParams.get('segment') || 'particular';
      const path = msgraph.buildFolderPath(msSp.folderTemplate, { name, segment });
      return json(res, 200, { configured: true, path });
    }
    // Listado de subcarpetas de una ruta (navegador de carpetas).
    if (req.method === 'GET' && id === 'folders') {
      try {
        const folderPath = url.searchParams.get('path') || '';
        const folders = await msgraph.listFolders({ hostname: msSp.hostname, sitePath: msSp.sitePath, folderPath });
        return json(res, 200, { configured: true, path: folderPath, folders });
      } catch (err) {
        return json(res, 502, { error: err.message });
      }
    }
    // Crear una carpeta.
    if (req.method === 'POST' && id === 'folder') {
      const b = await readBody(req);
      if (!b.path) return json(res, 400, { error: 'Falta la ruta de la carpeta' });
      try {
        const folder = await msgraph.createFolder({ hostname: msSp.hostname, sitePath: msSp.sitePath, folderPath: b.path });
        security.audit('sharepoint_carpeta_creada', { user: sessionUser(req), path: folder.path });
        return json(res, 201, folder);
      } catch (err) {
        return json(res, 502, { error: err.message });
      }
    }
  }

  // --- Estadísticas del panel ----------------------------------------------
  // Informe de trámites: recuento de expedientes por área, estado y segmento
  // en un rango de fechas (?from=YYYY-MM-DD&to=YYYY-MM-DD, ambos opcionales).
  if (req.method === 'GET' && resource === 'reports') {
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const fromTs = from ? new Date(from + 'T00:00:00').getTime() : -Infinity;
    const toTs = to ? new Date(to + 'T23:59:59').getTime() : Infinity;
    const segOf = (cid) => db.clients.find((c) => c.id === cid)?.segment || 'particular';

    const cases = casesV.filter((c) => c.createdAt >= fromTs && c.createdAt <= toTs);
    const byArea = {};
    const byStatus = {};
    const bySegment = {};
    const byMonth = {};
    const incomeByArea = {}; // { area: { facturado, cobrado } }
    const incomeByMonth = {}; // { 'YYYY-MM': { facturado, cobrado } }
    let facturado = 0;
    let cobrado = 0;
    // Cobrado por forma de pago (efectivo/transferencia/tarjeta/banco + sin especificar).
    const cobradoByMethod = { caja: 0, transferencia: 0, tarjeta: 0, banco: 0, sin: 0 };
    let taxFacturado = 0; // tasas oficiales gestionadas
    let taxCobrado = 0; // tasas oficiales ya abonadas
    for (const c of cases) {
      byArea[c.type] = (byArea[c.type] || 0) + 1;
      byStatus[c.status] = (byStatus[c.status] || 0) + 1;
      bySegment[segOf(c.clientId)] = (bySegment[segOf(c.clientId)] || 0) + 1;
      const d = new Date(c.createdAt);
      const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      byMonth[m] = (byMonth[m] || 0) + 1;
      const fee = Number(c.fee) || 0;
      const feePaid = feePaidOf(c); // incluye adelantos/pagos parciales
      facturado += fee;
      if (feePaid > 0) {
        cobrado += feePaid;
        const key = Object.prototype.hasOwnProperty.call(cobradoByMethod, c.payMethod) ? c.payMethod : 'sin';
        cobradoByMethod[key] += feePaid;
      }
      incomeByArea[c.type] = incomeByArea[c.type] || { facturado: 0, cobrado: 0 };
      incomeByArea[c.type].facturado += fee;
      incomeByArea[c.type].cobrado += feePaid;
      incomeByMonth[m] = incomeByMonth[m] || { facturado: 0, cobrado: 0 };
      incomeByMonth[m].facturado += fee;
      incomeByMonth[m].cobrado += feePaid;
      const tax = Number(c.taxAmount) || 0;
      taxFacturado += tax;
      if (c.taxPaid) taxCobrado += tax;
    }
    // Detalle por título de trámite (los expedientes concretos más frecuentes).
    const byTitle = {};
    for (const c of cases) {
      const key = `${c.type}||${c.title.trim()}`;
      byTitle[key] = byTitle[key] || { type: c.type, title: c.title.trim(), count: 0, completados: 0 };
      byTitle[key].count += 1;
      if (c.status === 'completado') byTitle[key].completados += 1;
    }
    return json(res, 200, {
      total: cases.length,
      completados: cases.filter((c) => c.status === 'completado').length,
      byArea,
      byStatus,
      bySegment,
      byMonth,
      facturado,
      cobrado,
      cobradoByMethod,
      // Compatibilidad: se mantienen los campos antiguos.
      cobradoCaja: cobradoByMethod.caja,
      cobradoBanco: cobradoByMethod.banco,
      cobradoSinMetodo: cobradoByMethod.sin,
      pendiente: facturado - cobrado,
      taxFacturado,
      taxCobrado,
      taxPendiente: taxFacturado - taxCobrado,
      incomeByArea,
      incomeByMonth,
      byTitle: Object.values(byTitle).sort((a, b) => b.count - a.count),
    });
  }

  // --- Por cobrar: honorarios y tasas pendientes por cliente --------------
  if (resource === 'receivables') {
    const buildPending = () => {
      const now = Date.now();
      const byClient = new Map();
      for (const c of casesV) {
        const feeDue = feeDueOf(c);
        const taxDue = (Number(c.taxAmount) || 0) > 0 && !c.taxPaid ? Number(c.taxAmount) : 0;
        if (!feeDue && !taxDue) continue;
        const client = db.clients.find((x) => x.id === c.clientId);
        if (!client) continue;
        let e = byClient.get(client.id);
        if (!e) {
          e = { clientId: client.id, name: client.name, phone: client.phone,
            honorarios: 0, tasas: 0, total: 0, oldest: now, items: [] };
          byClient.set(client.id, e);
        }
        e.honorarios += feeDue;
        e.tasas += taxDue;
        e.total += feeDue + taxDue;
        const since = c.updatedAt || c.createdAt || now;
        if (since < e.oldest) e.oldest = since;
        // feeTotal/feePaid permiten mostrar los adelantos ya cobrados.
        e.items.push({ caseId: c.id, title: c.title, fee: feeDue, tax: taxDue, taxModel: c.taxModel || '',
          feeTotal: money2(Number(c.fee) || 0), feePaid: feePaidOf(c) });
      }
      return [...byClient.values()].map((e) => ({
        ...e,
        days: Math.floor((now - e.oldest) / (24 * 3600 * 1000)),
      })).sort((a, b) => b.total - a.total);
    };

    if (req.method === 'GET') {
      const list = buildPending();
      return json(res, 200, {
        clients: list,
        totalHonorarios: list.reduce((s, e) => s + e.honorarios, 0),
        totalTasas: list.reduce((s, e) => s + e.tasas, 0),
        total: list.reduce((s, e) => s + e.total, 0),
      });
    }
    // Reclamar por WhatsApp los importes pendientes de un cliente.
    if (req.method === 'POST' && id === 'remind') {
      const b = await readBody(req);
      const entry = buildPending().find((e) => e.clientId === b.clientId);
      if (!entry) return json(res, 404, { error: 'Este cliente no tiene importes pendientes' });
      const client = db.clients.find((c) => c.id === entry.clientId);
      const first = (client.name || '').split(' ')[0];
      const lines = [`Hola ${first} 👋 Un recordatorio de los importes pendientes de tus trámites:`, ''];
      for (const it of entry.items) {
        const parts = [];
        if (it.fee) parts.push(`honorarios ${it.fee.toLocaleString('es-ES')} €`);
        if (it.tax) parts.push(`tasa oficial ${it.tax.toLocaleString('es-ES')} €`);
        lines.push(`• ${it.title}: ${parts.join(' + ')}`);
      }
      lines.push('', `Total pendiente: ${entry.total.toLocaleString('es-ES')} €.`,
        'Cuando puedas, nos dices y lo dejamos al día. ¡Gracias! 🙌');
      const msg = await sendMessageToClient(db, client, lines.join('\n'));
      return json(res, 200, { sent: true, messageStatus: msg.status });
    }
    // Registrar el cobro de un cliente: aplica un importe a los honorarios
    // pendientes (admite ADELANTOS/pagos a plazos con `amount`; si no se indica,
    // se cobra todo lo pendiente) y, opcionalmente, marca las tasas como
    // abonadas. Forma de cobro: caja/banco/tarjeta/transferencia.
    if (req.method === 'POST' && id === 'collect') {
      const b = await readBody(req);
      const method = PAY_METHODS.includes(b.payMethod) ? b.payMethod : '';
      if (!method) return json(res, 400, { error: 'Indica la forma de cobro (caja o banco)' });
      const client = db.clients.find((c) => c.id === b.clientId);
      if (!client) return json(res, 404, { error: 'Cliente no encontrado' });
      if (!canSeeClient(client, me)) return json(res, 403, { error: 'No tienes acceso a este cliente' });
      // Expedientes con honorarios pendientes, del más antiguo al más nuevo:
      // un adelanto se imputa primero a los trámites más viejos.
      const feeCases = db.cases
        .filter((c) => c.clientId === client.id && feeDueOf(c) > 0)
        .sort((a, c) => (a.createdAt || 0) - (c.createdAt || 0));
      const totalFeeDue = money2(feeCases.reduce((s, c) => s + feeDueOf(c), 0));
      // Importe a cobrar: el indicado (adelanto) o, si no se indica, todo lo
      // pendiente. Nunca más de lo que se debe.
      const hasAmount = b.amount !== undefined && b.amount !== null && b.amount !== '';
      let toCollect = hasAmount ? money2(b.amount) : totalFeeDue;
      if (hasAmount && toCollect <= 0) return json(res, 400, { error: 'Indica un importe de cobro válido' });
      toCollect = Math.min(toCollect, totalFeeDue);
      let honorarios = 0;
      let remaining = toCollect;
      for (const c of feeCases) {
        if (remaining <= 0) break;
        const due = feeDueOf(c);
        const applied = money2(Math.min(due, remaining));
        c.paidAmount = money2(feePaidOf(c) + applied);
        c.payMethod = method;
        c.paidAt = Date.now();
        c.paid = feeDueOf(c) <= 0; // queda saldado del todo?
        c.updatedAt = Date.now();
        honorarios = money2(honorarios + applied);
        remaining = money2(remaining - applied);
      }
      let tasas = 0;
      if (b.includeTax) {
        for (const c of db.cases) {
          if (c.clientId !== client.id) continue;
          if ((Number(c.taxAmount) || 0) > 0 && !c.taxPaid) {
            c.taxPaid = true;
            c.taxPaidAt = Date.now();
            tasas = money2(tasas + (Number(c.taxAmount) || 0));
            c.updatedAt = Date.now();
          }
        }
      }
      if (!honorarios && !tasas) return json(res, 404, { error: 'Este cliente no tiene importes pendientes' });
      save();
      security.audit('cobro_registrado', { clientId: client.id, method, honorarios, tasas, partial: honorarios < totalFeeDue, user: sessionUser(req) });
      return json(res, 200, { honorarios, tasas, method, pendiente: money2(totalFeeDue - honorarios) });
    }
  }

  if (req.method === 'GET' && resource === 'stats') {
    const DAY = 24 * 3600 * 1000;
    const now = new Date();
    const dayKey = (ts) => {
      const d = new Date(ts);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const days = [];
    for (let i = 13; i >= 0; i -= 1) {
      days.push(dayKey(now.getTime() - i * DAY));
    }
    const statMsgs = visIds ? db.messages.filter((m) => visIds.has(m.clientId)) : db.messages;
    const byDay = Object.fromEntries(days.map((d) => [d, { in: 0, out: 0 }]));
    for (const m of statMsgs) {
      if (m.direction !== 'in' && m.direction !== 'out') continue;
      const k = dayKey(m.timestamp);
      if (byDay[k]) byDay[k][m.direction] += 1;
    }

    const casesByStatus = {};
    const casesByType = {};
    for (const c of casesV) {
      casesByStatus[c.status] = (casesByStatus[c.status] || 0) + 1;
      casesByType[c.type] = (casesByType[c.type] || 0) + 1;
    }

    // Tiempo medio de primera respuesta (transición entrante→saliente, 30 días).
    const cutoff = now.getTime() - 30 * DAY;
    const byClient = new Map();
    for (const m of statMsgs) {
      if (m.direction !== 'in' && m.direction !== 'out') continue;
      const list = byClient.get(m.clientId) || [];
      list.push(m);
      byClient.set(m.clientId, list);
    }
    const gaps = [];
    for (const msgs of byClient.values()) {
      msgs.sort((a, b) => a.timestamp - b.timestamp);
      let pendingIn = null;
      for (const m of msgs) {
        if (m.direction === 'in') {
          if (pendingIn === null) pendingIn = m.timestamp;
        } else if (pendingIn !== null) {
          if (m.timestamp >= cutoff) gaps.push(m.timestamp - pendingIn);
          pendingIn = null;
        }
      }
    }
    const avgResponseMinutes = gaps.length
      ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length / 60000)
      : null;

    const weekAgo = now.getTime() - 7 * DAY;
    return json(res, 200, {
      messagesByDay: days.map((d) => ({ date: d, in: byDay[d].in, out: byDay[d].out })),
      casesByStatus,
      casesByType,
      avgResponseMinutes,
      messagesThisWeek: statMsgs.filter((m) =>
        (m.direction === 'in' || m.direction === 'out') && m.timestamp >= weekAgo).length,
    });
  }

  // --- Panel de rendimiento por usuario ------------------------------------
  // Métricas de cada usuario del equipo (p. ej. José vs Carmen) en un rango de
  // fechas: trámites y completados, importes facturados/cobrados, clientes
  // nuevos, conversaciones atendidas y tiempo medio de respuesta. La atribución
  // se hace por el dueño del cliente (client.owner). Solo agrega recuentos e
  // importes: no expone datos identificativos de clientes ajenos.
  if (req.method === 'GET' && resource === 'performance') {
    const DAY = 24 * 3600 * 1000;
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const fromTs = from ? new Date(from + 'T00:00:00').getTime() : -Infinity;
    const toTs = to ? new Date(to + 'T23:59:59').getTime() : Infinity;
    const inRange = (ts) => ts >= fromTs && ts <= toTs;

    // Dueño de cada cliente (client.owner), o '' para los comunes/sin asignar.
    const ownerOf = new Map();
    for (const c of db.clients) ownerOf.set(c.id, c.owner || '');
    const rowFor = (rows, user) => {
      let r = rows.get(user);
      if (!r) {
        r = { user, tramitesTotal: 0, tramitesCompletados: 0, facturado: 0, cobrado: 0,
          clientesNuevos: 0, conversaciones: new Set(), mensajesEnviados: 0, _gaps: [] };
        rows.set(user, r);
      }
      return r;
    };
    const rows = new Map();
    // Se listan primero todos los usuarios configurados (para que salgan a 0).
    for (const u of authUsers().keys()) rowFor(rows, u);

    // Clientes nuevos en el periodo, por dueño.
    for (const c of db.clients) {
      if (inRange(c.createdAt || 0)) rowFor(rows, c.owner || '').clientesNuevos += 1;
    }
    // Expedientes en el periodo, por dueño del cliente.
    for (const c of db.cases) {
      if (!inRange(c.createdAt || 0)) continue;
      const r = rowFor(rows, ownerOf.get(c.clientId) || '');
      r.tramitesTotal += 1;
      if (c.status === 'completado') r.tramitesCompletados += 1;
      const fee = Number(c.fee) || 0;
      r.facturado += fee;
      if (c.paid) r.cobrado += fee;
    }
    // Mensajes salientes en el periodo, por dueño del cliente.
    for (const m of db.messages) {
      if (m.direction !== 'out' || !inRange(m.timestamp || 0)) continue;
      const r = rowFor(rows, ownerOf.get(m.clientId) || '');
      r.mensajesEnviados += 1;
      r.conversaciones.add(m.clientId);
    }
    // Tiempo medio de respuesta (entrante→saliente) por dueño del cliente.
    const byClient = new Map();
    for (const m of db.messages) {
      if (m.direction !== 'in' && m.direction !== 'out') continue;
      const list = byClient.get(m.clientId) || [];
      list.push(m);
      byClient.set(m.clientId, list);
    }
    for (const [cid, msgs] of byClient) {
      msgs.sort((a, b) => a.timestamp - b.timestamp);
      const r = rowFor(rows, ownerOf.get(cid) || '');
      let pendingIn = null;
      for (const m of msgs) {
        if (m.direction === 'in') {
          if (pendingIn === null) pendingIn = m.timestamp;
        } else if (pendingIn !== null) {
          if (inRange(m.timestamp)) r._gaps.push(m.timestamp - pendingIn);
          pendingIn = null;
        }
      }
    }

    const users = [...rows.values()].map((r) => ({
      user: r.user || '(común)',
      assigned: !!r.user,
      tramitesTotal: r.tramitesTotal,
      tramitesCompletados: r.tramitesCompletados,
      facturado: r.facturado,
      cobrado: r.cobrado,
      pendiente: r.facturado - r.cobrado,
      clientesNuevos: r.clientesNuevos,
      conversaciones: r.conversaciones.size,
      mensajesEnviados: r.mensajesEnviados,
      avgResponseMinutes: r._gaps.length
        ? Math.round(r._gaps.reduce((a, b) => a + b, 0) / r._gaps.length / 60000) : null,
    }))
      // Se ocultan filas totalmente vacías salvo que sean usuarios configurados.
      .filter((r) => r.assigned || r.tramitesTotal || r.mensajesEnviados || r.clientesNuevos)
      .sort((a, b) => b.cobrado - a.cobrado || b.tramitesCompletados - a.tramitesCompletados);

    return json(res, 200, { isolation: isolationOn(), users });
  }

  // --- Copias de seguridad --------------------------------------------------
  if (resource === 'backups') {
    // Una copia contiene TODA la base de datos (todos los usuarios). Con
    // aislamiento activo, solo un administrador puede crear/listar/descargar.
    if (!isAdmin(me)) return json(res, 403, { error: 'Solo un administrador puede gestionar las copias de seguridad' });
    if (req.method === 'GET' && !id) return json(res, 200, backup.list());
    if (req.method === 'POST' && !id) {
      const b = backup.create(true);
      security.audit('backup_creada', { user: sessionUser(req), ip: ipOf(req), name: b.name });
      // Subida a la nube de Microsoft (si está activada).
      try {
        const cloud = await uploadBackupToCloud(db, b.name);
        if (cloud) {
          b.cloudUrl = cloud.webUrl;
          security.audit('backup_nube', { name: b.name });
          // «Solo nube»: se borra la copia local tras subirla correctamente.
          if (auto.getSettings(db).microsoft.backup.cloudOnly) {
            backup.remove(b.name);
            b.localRemoved = true;
          }
        }
      } catch (err) {
        b.cloudError = err.message;
        console.error('No se pudo subir la copia a la nube:', err.message);
      }
      return json(res, 201, b);
    }
    // Restaurar una copia (solo admin): antes se guarda una copia de seguridad
    // del estado actual, luego se reemplaza la base y se recarga.
    if (req.method === 'POST' && id && parts[3] === 'restore') {
      const data = backup.restoreData(id);
      if (!data) return json(res, 400, { error: 'No se pudo leer la copia (¿cifrada sin BACKUP_ENCRYPTION_KEY, o dañada?)' });
      let safety = null;
      try { safety = backup.create(true); } catch { /* si falla, seguimos: la copia a restaurar es válida */ }
      try {
        // Copia de seguridad física del db.json actual y escritura de la nueva.
        fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
        if (fs.existsSync(DB_FILE)) fs.copyFileSync(DB_FILE, DB_FILE + '.pre-restore');
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
      } catch (err) {
        return json(res, 500, { error: 'No se pudo escribir la base restaurada: ' + err.message });
      }
      // Se descarta el estado en memoria para que el cierre NO sobrescriba el
      // db.json recién restaurado con los datos antiguos.
      store.reset();
      security.audit('backup_restaurada', { user: sessionUser(req), ip: ipOf(req), name: id, safety: safety && safety.name });
      notifyOwner(`♻️ Copia de seguridad restaurada (${id}) por ${sessionUser(req) || 'admin'}. Reiniciando…`);
      // El estado en memoria ya no coincide con el disco: se reinicia el proceso
      // para cargar limpio la base restaurada (Render lo levanta de nuevo).
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, restored: id, safetyBackup: safety && safety.name }));
      setTimeout(() => process.exit(0), 200);
      return undefined;
    }
    if (req.method === 'GET' && id) {
      const dl = backup.readDownload(id);
      if (!dl) return json(res, 404, { error: 'Copia no encontrada' });
      security.audit('backup_descargada', { user: sessionUser(req), ip: ipOf(req), name: id });
      res.writeHead(200, {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename="${dl.filename}"`,
      });
      return res.end(dl.buffer);
    }
  }

  // --- Conservación de datos (RGPD): clientes revisables para borrado -------
  if (resource === 'retention' && req.method === 'GET') {
    if (!isAdmin(me)) return json(res, 403, { error: 'Solo un administrador puede ver esto' });
    const s = auto.getSettings(db).retention || {};
    return json(res, 200, {
      enabled: !!s.enabled,
      inactiveMonths: Number(s.inactiveMonths) || 24,
      candidates: retentionCandidates(db),
    });
  }

  // --- Búsqueda en conversaciones ------------------------------------------
  if (req.method === 'GET' && resource === 'search-messages') {
    const q = (url.searchParams.get('q') || '').toLowerCase().trim();
    if (q.length < 2) return json(res, 200, []);
    const results = [];
    for (let i = db.messages.length - 1; i >= 0 && results.length < 50; i -= 1) {
      const m = db.messages[i];
      const hay = `${m.text || ''} ${m.media?.filename || ''}`.toLowerCase();
      if (!hay.includes(q)) continue;
      if (visIds && !visIds.has(m.clientId)) continue;
      const client = db.clients.find((c) => c.id === m.clientId);
      if (!client) continue;
      results.push({
        clientId: client.id,
        clientName: client.name,
        text: m.text,
        direction: m.direction,
        timestamp: m.timestamp,
      });
    }
    return json(res, 200, results);
  }

  // Búsqueda global: clientes + expedientes + mensajes (para la paleta Ctrl+K).
  if (req.method === 'GET' && resource === 'search') {
    const q = (url.searchParams.get('q') || '').toLowerCase().trim();
    if (q.length < 2) return json(res, 200, { clients: [], cases: [], messages: [] });
    const nameOf = (cid) => (db.clients.find((c) => c.id === cid) || {}).name || '';
    const clients = clientsV
      .filter((c) => [c.name, c.phone, c.nif, c.email, (c.tags || []).join(' ')].join(' ').toLowerCase().includes(q))
      .slice(0, 8)
      .map((c) => ({ id: c.id, name: c.name, phone: c.phone, segment: c.segment || 'particular' }));
    const cases = casesV
      .filter((c) => (c.title || '').toLowerCase().includes(q))
      .slice(0, 8)
      .map((c) => ({ id: c.id, title: c.title, type: c.type, status: c.status, clientId: c.clientId, clientName: nameOf(c.clientId) }));
    const messages = [];
    for (let i = db.messages.length - 1; i >= 0 && messages.length < 6; i -= 1) {
      const m = db.messages[i];
      if (!`${m.text || ''} ${m.media?.filename || ''}`.toLowerCase().includes(q)) continue;
      if (visIds && !visIds.has(m.clientId)) continue;
      if (!db.clients.some((c) => c.id === m.clientId)) continue;
      messages.push({ clientId: m.clientId, clientName: nameOf(m.clientId), text: m.text, timestamp: m.timestamp });
    }
    return json(res, 200, { clients, cases, messages });
  }

  // --- Exportación CSV ------------------------------------------------------
  if (req.method === 'GET' && resource === 'export' && id) {
    const csvCell = (v) => {
      let s = String(v ?? '');
      // Neutraliza la inyección de fórmulas: una celda que empiece por = + - @
      // (o tabulador/retorno) la interpreta Excel/LibreOffice como fórmula.
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replaceAll('"', '""')}"`;
    };
    // BOM para que Excel abra el CSV con acentos correctos.
    const toCsv = (headers, rows) => '\uFEFF' + [headers, ...rows]
      .map((r) => r.map(csvCell).join(';')).join('\r\n');
    const fmtDate = (ts) => (ts ? new Date(ts).toISOString().slice(0, 10) : '');
    let csv = null;
    let name = '';
    if (id === 'clients.csv') {
      name = 'clientes';
      csv = toCsv(
        ['Nombre', 'Teléfono', 'NIF', 'Email', 'Etiquetas', 'Notas', 'Alta'],
        clientsV.map((c) => [c.name, '+' + c.phone, c.nif, c.email,
          (c.tags || []).join(', '), c.notes, fmtDate(c.createdAt)]),
      );
    }
    if (id === 'cases.csv') {
      name = 'expedientes';
      const clientName = (cid) => db.clients.find((c) => c.id === cid)?.name || '';
      const STATUS = { pendiente: 'Pendiente', en_curso: 'En curso', esperando_documentacion: 'Esperando documentación', completado: 'Completado' };
      csv = toCsv(
        ['Cliente', 'Título', 'Tipo', 'Estado', 'Fecha límite', 'Documentación', 'Notas', 'Creado'],
        casesV.map((c) => [clientName(c.clientId), c.title, c.type,
          STATUS[c.status] || c.status, c.dueDate || '', c.docs || '', c.notes, fmtDate(c.createdAt)]),
      );
    }
    if (id === 'informe.csv') {
      name = 'informe-tramites';
      const AREA = { extranjeria: 'Extranjería', vehiculos: 'Tráfico / Vehículos', fiscal: 'Fiscal / Impuestos', laboral: 'Laboral / Nóminas', contabilidad: 'Contabilidad', pensiones: 'Pensiones / Prestaciones', social: 'Servicios sociales (JCCM)', otro: 'Otros trámites' };
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      const fromTs = from ? new Date(from + 'T00:00:00').getTime() : -Infinity;
      const toTs = to ? new Date(to + 'T23:59:59').getTime() : Infinity;
      const inRange = casesV.filter((c) => c.createdAt >= fromTs && c.createdAt <= toTs);
      const agg = {};
      for (const c of inRange) {
        const key = `${c.type}||${c.title.trim()}`;
        agg[key] = agg[key] || { area: AREA[c.type] || c.type, title: c.title.trim(), count: 0, completados: 0 };
        agg[key].count += 1;
        if (c.status === 'completado') agg[key].completados += 1;
      }
      csv = toCsv(
        ['Área', 'Trámite', 'Total', 'Completados'],
        Object.values(agg).sort((a, b) => b.count - a.count).map((r) => [r.area, r.title, r.count, r.completados]),
      );
    }
    if (id === 'ingresos.csv') {
      // Libro de ingresos: honorarios cobrados por fecha de cobro, para la
      // asesoría/impuestos. Las tasas oficiales se muestran aparte (no son
      // ingreso de la gestoría: se ingresan en la Administración).
      name = 'libro-ingresos';
      const AREA = { extranjeria: 'Extranjería', vehiculos: 'Tráfico / Vehículos', fiscal: 'Fiscal / Impuestos', laboral: 'Laboral / Nóminas', contabilidad: 'Contabilidad', pensiones: 'Pensiones / Prestaciones', social: 'Servicios sociales (JCCM)', otro: 'Otros trámites' };
      const PAY = { caja: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta', banco: 'Banco' };
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      const fromTs = from ? new Date(from + 'T00:00:00').getTime() : -Infinity;
      const toTs = to ? new Date(to + 'T23:59:59').getTime() : Infinity;
      const eur = (n) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const nameOf = (cid) => db.clients.find((c) => c.id === cid)?.name || '';
      const nifOf = (cid) => db.clients.find((c) => c.id === cid)?.nif || '';
      // Fecha de cobro: paidAt; si es un cobro antiguo sin sello, updatedAt/createdAt.
      const paidWhen = (c) => c.paidAt || c.updatedAt || c.createdAt || 0;
      const rows = [];
      let totalHon = 0;
      let totalTasa = 0;
      const cobrados = casesV
        .filter((c) => c.paid && (Number(c.fee) || 0) > 0 && paidWhen(c) >= fromTs && paidWhen(c) <= toTs)
        .sort((a, b) => paidWhen(a) - paidWhen(b));
      for (const c of cobrados) {
        const hon = Number(c.fee) || 0;
        const tasa = c.taxPaid ? (Number(c.taxAmount) || 0) : 0;
        totalHon += hon;
        totalTasa += tasa;
        rows.push([
          fmtDate(paidWhen(c)), c.reciboNumber || '', nameOf(c.clientId), nifOf(c.clientId),
          c.title, AREA[c.type] || c.type, eur(hon), PAY[c.payMethod] || '',
          tasa ? eur(tasa) : '', c.taxModel || '',
        ]);
      }
      // Fila de totales.
      rows.push(['', '', '', '', '', 'TOTAL', eur(totalHon), '', totalTasa ? eur(totalTasa) : '', '']);
      csv = toCsv(
        ['Fecha de cobro', 'Nº recibo', 'Cliente', 'NIF/NIE', 'Concepto (trámite)', 'Área',
          'Honorario (€)', 'Forma de pago', 'Tasa oficial (€)', 'Modelo tasa'],
        rows,
      );
    }
    if (csv === null) return json(res, 404, { error: 'Exportación no disponible' });
    security.audit('exportacion_csv', { user: sessionUser(req), ip: ipOf(req), tipo: name });
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}-burocracia-zero.csv"`,
    });
    return res.end(csv);
  }

  // --- Campañas por etiqueta ------------------------------------------------
  if (resource === 'campaigns') {
    if (req.method === 'GET') {
      return json(res, 200, db.campaigns.slice().reverse());
    }
    if (req.method === 'POST' && !id) {
      const b = await readBody(req);
      const tag = String(b.tag || '').trim();
      const text = String(b.text || '').trim();
      if (!tag || !text) return json(res, 400, { error: 'Etiqueta y mensaje son obligatorios' });
      const recipients = clientsV.filter((c) => (c.tags || []).includes(tag));
      if (!recipients.length) return json(res, 400, { error: 'Ningún cliente tiene esa etiqueta' });
      let ok = 0;
      let errors = 0;
      for (const client of recipients) {
        const filled = auto.fillTemplate(text, { nombre: (client.name || '').split(' ')[0] });
        // auto:true → usa la plantilla de Meta si la ventana de 24 h está cerrada.
        const msg = await sendMessageToClient(db, client, filled, { auto: true });
        if (msg.status === 'error') errors += 1;
        else ok += 1;
      }
      const campaign = {
        id: newId('cam'),
        tag,
        text,
        sentAt: Date.now(),
        total: recipients.length,
        ok,
        errors,
      };
      db.campaigns.push(campaign);
      save();
      security.audit('campana_enviada', { user: sessionUser(req), ip: ipOf(req), tag, total: recipients.length });
      return json(res, 201, campaign);
    }
  }

  // --- Automatizaciones -----------------------------------------------------
  if (resource === 'automations') {
    if (req.method === 'GET' && !id) {
      return json(res, 200, auto.getSettings(db));
    }
    if (req.method === 'PUT' && !id) {
      // La configuración es global (afecta a todo el equipo, incluye el texto
      // legal/RGPD y los datos de la gestoría): solo un administrador la cambia.
      if (!isAdmin(me)) return json(res, 403, { error: 'Solo un administrador puede cambiar la configuración' });
      const b = await readBody(req);
      const settings = auto.setSettings(db, b);
      save();
      return json(res, 200, settings);
    }
    // Ejecuta ya las tareas programadas (reclamos y recordatorios); útil
    // para probar sin esperar al planificador.
    if (req.method === 'POST' && id === 'run') {
      const actions = await auto.runScheduled(db, autoSender(db));
      if (actions.length) save();
      return json(res, 200, { executed: actions });
    }
  }

  // --- Recordatorios --------------------------------------------------------
  if (resource === 'reminders') {
    if (req.method === 'GET') {
      return json(res, 200, remindersV.slice().sort((a, b) =>
        String(a.dueDate || '').localeCompare(String(b.dueDate || ''))));
    }
    if (req.method === 'POST' && !id) {
      const b = await readBody(req);
      if (!b.text) return json(res, 400, { error: 'El texto es obligatorio' });
      if (b.clientId && visIds && !visIds.has(b.clientId)) return json(res, 403, { error: 'No tienes acceso a este cliente' });
      const r = {
        id: newId('rem'),
        clientId: b.clientId || null,
        text: String(b.text).trim(),
        dueDate: b.dueDate || null,
        sendToClient: Boolean(b.sendToClient),
        sentToClientAt: null,
        done: false,
        createdAt: Date.now(),
      };
      db.reminders.push(r);
      save();
      return json(res, 201, r);
    }
    const r = db.reminders.find((x) => x.id === id);
    if (!r) return json(res, 404, { error: 'Recordatorio no encontrado' });
    if (isolationOn() && r.owner && r.owner !== me) return json(res, 403, { error: 'Sin acceso a este recordatorio' });
    if (r.clientId && visIds && !visIds.has(r.clientId)) return json(res, 403, { error: 'Sin acceso a este recordatorio' });
    if (req.method === 'PUT') {
      const b = await readBody(req);
      if (b.text !== undefined) r.text = String(b.text);
      if (b.dueDate !== undefined) r.dueDate = b.dueDate;
      if (b.done !== undefined) r.done = Boolean(b.done);
      if (b.clientId !== undefined) r.clientId = b.clientId;
      if (b.sendToClient !== undefined) r.sendToClient = Boolean(b.sendToClient);
      save();
      return json(res, 200, r);
    }
    if (req.method === 'DELETE') {
      db.reminders = db.reminders.filter((x) => x.id !== id);
      save();
      return json(res, 200, { ok: true });
    }
  }

  return json(res, 404, { error: 'Ruta no encontrada' });
}

// ---------------------------------------------------------------------------
// Página pública «Estado del trámite» (solo lectura, sin datos internos)
// ---------------------------------------------------------------------------

// Traducciones de la página del cliente. Pensada para la clientela de
// extranjería: español, árabe, francés, inglés y rumano.
const STATUS_PAGE_LANGS = ['es', 'ar', 'fr', 'en', 'ro'];
const LANG_NAME = { es: 'Español', ar: 'العربية', fr: 'Français', en: 'English', ro: 'Română' };
const I18N = {
  es: {
    dir: 'ltr', tagline: 'Seguimiento de tus trámites',
    greet: 'Hola, {name} 👋', lead: 'Aquí puedes ver el estado de tus trámites en tiempo real.',
    due: 'Fecha límite', overdue: 'pendiente', docs: 'Documentación', submitted: 'Presentado en la administración el', registry: 'Nº de registro', trackingCta: 'Ver seguimiento en la administración',
    upload: 'Subir', uploading: 'Subiendo…', uploadHint: 'Foto o PDF', uploadErr: 'No se pudo subir el archivo. Inténtalo de nuevo.',
    footer: 'Esta página es privada y solo para ti. Para cualquier duda, escríbenos por WhatsApp.',
    empty: 'Todavía no hay trámites registrados a tu nombre.',
    notFoundTitle: 'Enlace no válido',
    notFound: 'Este enlace no es válido o ha caducado. Contáctanos por WhatsApp para obtener uno nuevo.',
    status: { pendiente: 'Pendiente de iniciar', en_curso: 'En curso', esperando_documentacion: 'Esperando documentación', completado: 'Completado' },
    area: { extranjeria: 'Extranjería', vehiculos: 'Tráfico / Vehículos', fiscal: 'Fiscal / Impuestos', laboral: 'Laboral / Nóminas', contabilidad: 'Contabilidad', pensiones: 'Pensiones / Prestaciones', social: 'Servicios sociales', otro: 'Otros trámites' },
  },
  en: {
    dir: 'ltr', tagline: 'Track your paperwork',
    greet: 'Hi, {name} 👋', lead: 'Here you can follow the status of your cases in real time.',
    due: 'Deadline', overdue: 'pending', docs: 'Documents', submitted: 'Submitted to the authorities on', registry: 'Reference number', trackingCta: 'Track it on the authority’s website',
    upload: 'Upload', uploading: 'Uploading…', uploadHint: 'Photo or PDF', uploadErr: 'The file could not be uploaded. Please try again.',
    footer: 'This page is private and just for you. For any questions, message us on WhatsApp.',
    empty: 'There are no cases registered under your name yet.',
    notFoundTitle: 'Invalid link',
    notFound: 'This link is not valid or has expired. Contact us on WhatsApp to get a new one.',
    status: { pendiente: 'Not started', en_curso: 'In progress', esperando_documentacion: 'Awaiting documents', completado: 'Completed' },
    area: { extranjeria: 'Immigration', vehiculos: 'Traffic / Vehicles', fiscal: 'Tax', laboral: 'Employment / Payroll', contabilidad: 'Accounting', pensiones: 'Pensions / Benefits', social: 'Social services', otro: 'Other' },
  },
  fr: {
    dir: 'ltr', tagline: 'Suivi de vos démarches',
    greet: 'Bonjour, {name} 👋', lead: 'Ici, vous pouvez suivre l’état de vos démarches en temps réel.',
    due: 'Date limite', overdue: 'en attente', docs: 'Documents', submitted: 'Déposé auprès de l’administration le', registry: 'Nº de dossier', trackingCta: 'Suivre sur le site de l’administration',
    upload: 'Envoyer', uploading: 'Envoi…', uploadHint: 'Photo ou PDF', uploadErr: 'Le fichier n’a pas pu être envoyé. Réessayez.',
    footer: 'Cette page est privée et réservée à vous. Pour toute question, écrivez-nous sur WhatsApp.',
    empty: 'Aucune démarche enregistrée à votre nom pour le moment.',
    notFoundTitle: 'Lien non valide',
    notFound: 'Ce lien n’est pas valide ou a expiré. Contactez-nous sur WhatsApp pour en obtenir un nouveau.',
    status: { pendiente: 'À commencer', en_curso: 'En cours', esperando_documentacion: 'En attente de documents', completado: 'Terminé' },
    area: { extranjeria: 'Étrangers / Immigration', vehiculos: 'Trafic / Véhicules', fiscal: 'Fiscalité', laboral: 'Emploi / Paie', contabilidad: 'Comptabilité', pensiones: 'Retraites / Prestations', social: 'Services sociaux', otro: 'Autres démarches' },
  },
  ar: {
    dir: 'rtl', tagline: 'متابعة معاملاتك',
    greet: 'مرحباً {name} 👋', lead: 'هنا يمكنك متابعة حالة معاملاتك في الوقت الفعلي.',
    due: 'آخر موعد', overdue: 'قيد الانتظار', docs: 'المستندات', submitted: 'قُدّم إلى الإدارة بتاريخ', registry: 'رقم التسجيل', trackingCta: 'تابع الطلب على موقع الإدارة',
    upload: 'إرسال', uploading: 'جارٍ الإرسال…', uploadHint: 'صورة أو PDF', uploadErr: 'تعذّر رفع الملف. حاول مرة أخرى.',
    footer: 'هذه الصفحة خاصة بك وحدك. لأي استفسار، راسلنا على واتساب.',
    empty: 'لا توجد معاملات مسجلة باسمك حتى الآن.',
    notFoundTitle: 'رابط غير صالح',
    notFound: 'هذا الرابط غير صالح أو منتهي الصلاحية. تواصل معنا على واتساب للحصول على رابط جديد.',
    status: { pendiente: 'لم يبدأ', en_curso: 'قيد التنفيذ', esperando_documentacion: 'بانتظار المستندات', completado: 'مكتمل' },
    area: { extranjeria: 'الهجرة والأجانب', vehiculos: 'المرور / المركبات', fiscal: 'الضرائب', laboral: 'العمل / الرواتب', contabilidad: 'المحاسبة', pensiones: 'المعاشات / الإعانات', social: 'الخدمات الاجتماعية', otro: 'معاملات أخرى' },
  },
  ro: {
    dir: 'ltr', tagline: 'Urmărește-ți dosarele',
    greet: 'Bună, {name} 👋', lead: 'Aici poți urmări starea dosarelor tale în timp real.',
    due: 'Termen limită', overdue: 'în așteptare', docs: 'Documente', submitted: 'Depus la administrație pe', registry: 'Nr. de înregistrare', trackingCta: 'Urmărește pe site-ul administrației',
    upload: 'Încarcă', uploading: 'Se încarcă…', uploadHint: 'Foto sau PDF', uploadErr: 'Fișierul nu a putut fi încărcat. Încearcă din nou.',
    footer: 'Această pagină este privată și doar pentru tine. Pentru orice întrebare, scrie-ne pe WhatsApp.',
    empty: 'Momentan nu există dosare înregistrate pe numele tău.',
    notFoundTitle: 'Link invalid',
    notFound: 'Acest link nu este valid sau a expirat. Contactează-ne pe WhatsApp pentru unul nou.',
    status: { pendiente: 'De început', en_curso: 'În curs', esperando_documentacion: 'În așteptarea documentelor', completado: 'Finalizat' },
    area: { extranjeria: 'Imigrație / Străini', vehiculos: 'Trafic / Vehicule', fiscal: 'Fiscalitate', laboral: 'Muncă / Salarizare', contabilidad: 'Contabilitate', pensiones: 'Pensii / Prestații', social: 'Servicii sociale', otro: 'Alte demersuri' },
  },
};

// Idioma elegido: ?lang=xx válido, si no la cabecera Accept-Language, si no español.
function pickLang(url, req) {
  const q = (url.searchParams.get('lang') || '').toLowerCase();
  if (STATUS_PAGE_LANGS.includes(q)) return q;
  const header = String(req.headers['accept-language'] || '').toLowerCase();
  for (const part of header.split(',')) {
    const code = part.trim().split(';')[0].split('-')[0];
    if (STATUS_PAGE_LANGS.includes(code)) return code;
  }
  return 'es';
}

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Devuelve la URL solo si es http(s) válida; si no, cadena vacía (evita
// enlaces peligrosos tipo javascript: en la página pública del cliente).
function safeHttpUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href.slice(0, 500) : '';
  } catch {
    return '';
  }
}

const DATE_LOCALE = { es: 'es-ES', ar: 'ar', fr: 'fr-FR', en: 'en-GB', ro: 'ro-RO' };
function fmtDateLoc(iso, lang = 'es') {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString(DATE_LOCALE[lang] || 'es-ES', { day: '2-digit', month: 'long', year: 'numeric' });
}

function langSwitcher(lang, token, prefix = '/estado/') {
  const base = token ? `${prefix}${token}` : '';
  return `<nav class="langs" aria-label="Idioma">${STATUS_PAGE_LANGS.map((l) =>
    `<a class="${l === lang ? 'on' : ''}" href="${base}?lang=${l}" hreflang="${l}">${escHtml(LANG_NAME[l])}</a>`).join('')}</nav>`;
}

function statusPageShell(title, bodyHtml, lang = 'es', token = '', prefix = '/estado/') {
  const t = I18N[lang] || I18N.es;
  return `<!doctype html>
<html lang="${lang}" dir="${t.dir}"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escHtml(title)}</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Lexend:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root { --charcoal:#1d1d1b; --cream:#f5f4f7; --lilac:#9272b0; --lilac-dark:#77599c; --yellow:#ffea63; --muted:#6f6d75; --ok:#1d7a34; --danger:#c0392b; --font-brand:"Lexend",-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:"Lexend",-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; background:var(--cream); color:var(--charcoal); line-height:1.5; }
  .wrap { max-width:640px; margin:0 auto; padding:24px 18px 60px; }
  header { text-align:center; padding:22px 0 18px; }
  /* Wordmark oficial: «Burocracia» en Lexend grueso, «Zero» debajo en fino. */
  .logo-word { font-family:var(--font-brand); line-height:.86; display:inline-block; }
  .logo-word b { display:block; font-weight:800; font-size:34px; letter-spacing:-1px; color:var(--charcoal); }
  .logo-word span { display:block; font-weight:300; font-size:26px; letter-spacing:0; color:var(--charcoal); margin-top:1px; }
  .sub { color:var(--muted); font-size:14px; margin-top:14px; }
  .langs { display:flex; flex-wrap:wrap; justify-content:center; gap:6px; margin-top:16px; }
  .langs a { font-size:12.5px; font-weight:600; color:var(--muted); text-decoration:none; padding:4px 11px; border-radius:999px; border:1px solid #e7e5ea; background:#fff; }
  .langs a.on { background:var(--charcoal); color:#fff; border-color:var(--charcoal); }
  h1 { font-size:19px; margin:22px 0 4px; font-weight:700; }
  .lead { color:var(--muted); font-size:14px; margin:0 0 18px; }
  .case { background:#fff; border:1px solid #e7e5ea; border-radius:14px; padding:16px 16px 14px; margin-bottom:14px; box-shadow:0 1px 2px rgba(0,0,0,.03); }
  .case-top { display:flex; justify-content:space-between; gap:10px; align-items:flex-start; }
  .case-lead { display:flex; gap:12px; align-items:flex-start; min-width:0; }
  .case-ico { width:42px; height:42px; border-radius:12px; background:var(--lilac); color:#fff; display:flex; align-items:center; justify-content:center; flex:none; }
  .case-ico svg { width:23px; height:23px; }
  .case-title { font-weight:700; font-size:16px; }
  .area { display:inline-block; background:#f2edf8; color:var(--lilac-dark); border-radius:6px; padding:1px 8px; font-size:12px; font-weight:600; margin-top:4px; }
  .st { border-radius:999px; padding:3px 11px; font-size:12.5px; font-weight:700; white-space:nowrap; }
  .st.pendiente { background:#fdecea; color:var(--danger); }
  .st.en_curso { background:#eef2fb; color:#3f5bd6; }
  .st.esperando_documentacion { background:#fdf2e3; color:#a8690a; }
  .st.completado { background:#e4f5e8; color:var(--ok); }
  .ic { flex:none; }
  .due { display:flex; align-items:center; gap:7px; color:var(--muted); font-size:13px; margin-top:12px; }
  .due .ic { width:17px; height:17px; color:var(--lilac-dark); }
  .due.over, .due.over .ic { color:var(--danger); font-weight:700; }
  .submitted { display:flex; align-items:center; gap:7px; color:var(--ok); font-size:13px; font-weight:700; margin-top:12px; }
  .submitted .ic { width:17px; height:17px; color:var(--ok); }
  .registry { display:flex; align-items:center; gap:7px; color:var(--muted); font-size:13px; margin-top:8px; }
  .registry .ic { width:16px; height:16px; color:var(--lilac-dark); }
  .registry b { color:var(--charcoal); }
  .track-cta { display:inline-flex; align-items:center; gap:6px; margin-top:12px; padding:9px 14px; border-radius:10px; background:var(--lilac); color:#fff; text-decoration:none; font-weight:700; font-size:13px; }
  .track-cta:hover { background:var(--lilac-dark); }
  .chk { margin-top:12px; border-top:1px dashed #e6e3db; padding-top:10px; }
  .chk-h { font-size:12.5px; color:var(--muted); font-weight:600; margin-bottom:6px; }
  .chk ul { list-style:none; margin:0; padding:0; }
  .chk li { font-size:14px; padding:4px 0; display:flex; gap:9px; align-items:center; }
  .chk li.done { color:var(--muted); }
  .chk li .ic { width:18px; height:18px; color:var(--lilac); }
  .chk li.done .ic { color:var(--ok); }
  .chk li .item { flex:1; }
  .up-btn { display:inline-flex; align-items:center; gap:6px; font-size:12.5px; font-weight:700; color:#fff; background:var(--lilac-dark); border:0; border-radius:8px; padding:5px 12px; cursor:pointer; white-space:nowrap; }
  .up-btn:hover { background:#5f4585; }
  .up-btn input { display:none; }
  .up-btn.busy { opacity:.6; pointer-events:none; }
  .up-hint { font-size:11px; color:var(--muted); font-weight:400; }
  .empty { background:#fff; border:1px solid #e6e3db; border-radius:14px; padding:26px; text-align:center; color:var(--muted); }
  .book-cta { display:inline-flex; align-items:center; gap:7px; margin:0 0 16px; padding:11px 18px; border-radius:12px; background:var(--charcoal); color:#fff; text-decoration:none; font-weight:700; font-size:14px; }
  .book-note { background:#fdf2e3; color:#a8690a; border-radius:10px; padding:10px 12px; font-size:13px; margin-bottom:14px; font-weight:600; }
  .book { display:flex; flex-direction:column; gap:14px; }
  .bk-day { background:#fff; border:1px solid #e7e5ea; border-radius:14px; padding:14px 16px; }
  .bk-date { font-weight:700; font-size:15px; margin-bottom:10px; }
  .bk-slots { display:flex; flex-wrap:wrap; gap:8px; }
  .bk-slot { font-family:inherit; font-size:14px; font-weight:700; color:var(--lilac-dark); background:#f2edf8; border:1px solid #e3d9f0; border-radius:10px; padding:8px 14px; cursor:pointer; }
  .bk-slot:hover { background:var(--lilac); color:#fff; border-color:var(--lilac); }
  .ok-card { background:#fff; border:1px solid #e7e5ea; border-radius:16px; padding:34px 26px; text-align:center; }
  .ok-check { width:56px; height:56px; margin:0 auto 12px; border-radius:50%; background:#e4f5e8; color:var(--ok); font-size:30px; font-weight:800; display:flex; align-items:center; justify-content:center; }
  .consent { background:#fff; border:1px solid #e7e5ea; border-radius:14px; padding:16px; margin-top:18px; }
  .consent-title { font-weight:700; font-size:15px; margin-bottom:8px; }
  .consent-text { font-size:12.5px; color:var(--muted); line-height:1.6; margin:0 0 14px; }
  .consent-done { text-align:center; color:var(--ok); font-size:12.5px; font-weight:600; margin-top:18px; }
  footer { text-align:center; color:var(--muted); font-size:12.5px; margin-top:26px; }
  .bar { height:6px; background:#f2edf8; border-radius:99px; overflow:hidden; margin-top:10px; }
  .bar > i { display:block; height:100%; background:var(--lilac); }
</style>
</head><body>
<div class="wrap" data-token="${escHtml(token)}" data-uploading="${escHtml(t.uploading)}" data-uploaderr="${escHtml(t.uploadErr)}">
<header>
  <div class="logo-word" role="img" aria-label="Burocracia Zero"><b>Burocracia</b><span>Zero</span></div>
  <div class="sub">${escHtml(t.tagline)}</div>
  ${langSwitcher(lang, token, prefix)}
</header>
${bodyHtml}
<footer>${escHtml(t.footer)}</footer>
</div>
<script src="/portal.js"></script>
</body></html>`;
}

// Iconos de línea a medida (mismo estilo que el resto del CRM), coloreados
// con currentColor para heredar el lila de la marca desde el CSS.
const SVG_ICON = {
  cal: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M8 3.5v3M16 3.5v3"/></svg>',
  check: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M8.3 12.3l2.5 2.5 4.9-5.3"/></svg>',
  dot: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8.5"/></svg>',
};
// Un icono por área de trámite (dentro del tile lila de cada expediente).
const AREA_ICON_PATH = {
  extranjeria: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.6 2.6 14.4 0 17M12 3.5c-2.6 2.6-2.6 14.4 0 17"/>',
  vehiculos: '<path d="M5 16v-3l1.7-4.1A2 2 0 0 1 8.6 7.6h6.8a2 2 0 0 1 1.9 1.3L19 13v3"/><path d="M4 16h16"/><circle cx="8" cy="16.5" r="1.5"/><circle cx="16" cy="16.5" r="1.5"/>',
  fiscal: '<path d="M7 3.5h10v17l-2.5-1.6L12 20.5l-2.5-1.6L7 20.5z"/><path d="M9.8 8.5h4.4M9.8 12h4.4"/>',
  laboral: '<rect x="3.5" y="7.5" width="17" height="12" rx="2"/><path d="M8.5 7.5V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.5"/>',
  contabilidad: '<path d="M4 20V4M4 20h16"/><path d="M8 17v-4M12 17V9M16 17v-2"/>',
  pensiones: '<path d="M12 3.5l7 2.5v5c0 4.8-3 7.8-7 9.5-4-1.7-7-4.7-7-9.5V6z"/><path d="M9 12l2 2 4-4.5"/>',
  social: '<circle cx="9" cy="9.5" r="3"/><path d="M3.8 18.5c0-2.9 2.3-4.8 5.2-4.8s5.2 1.9 5.2 4.8"/><path d="M16 7a3 3 0 0 1 0 6M17.2 14c2 .5 3 2.2 3 4.5"/>',
  otro: '<path d="M7.5 3.5h6L17.5 8v12.5h-10z"/><path d="M13.5 3.5V8h4"/>',
};
function areaIconSvg(type) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${AREA_ICON_PATH[type] || AREA_ICON_PATH.otro}</svg>`;
}

function renderStatusPage(db, client, lang = 'es') {
  const t = I18N[lang] || I18N.es;
  const cases = db.cases
    .filter((c) => c.clientId === client.id)
    .sort((a, b) => (a.status === 'completado' ? 1 : 0) - (b.status === 'completado' ? 1 : 0)
      || String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')));
  const now = new Date();
  const body = cases.length ? cases.map((c) => {
    const overdue = c.dueDate && c.status !== 'completado' && new Date(c.dueDate) < now;
    const chk = Array.isArray(c.checklist) ? c.checklist : [];
    const done = chk.filter((x) => x.done).length;
    const pct = chk.length ? Math.round(done / chk.length * 100) : 0;
    // Ítems pendientes: botón para que el cliente suba el documento desde aquí.
    const chkHtml = chk.length ? `
      <div class="chk">
        <div class="chk-h">${escHtml(t.docs)} (${done}/${chk.length})</div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <ul>${chk.map((x, i) => `<li class="${x.done ? 'done' : ''}">${x.done ? SVG_ICON.check : SVG_ICON.dot}<span class="item">${escHtml(x.item)}</span>${x.done ? '' : `<label class="up-btn">${escHtml(t.upload)}<input type="file" accept="image/*,application/pdf" data-case="${escHtml(c.id)}" data-item="${i}"></label>`}</li>`).join('')}</ul>
      </div>` : '';
    return `
    <div class="case">
      <div class="case-top">
        <div class="case-lead">
          <span class="case-ico">${areaIconSvg(c.type)}</span>
          <div>
            <div class="case-title">${escHtml(c.title)}</div>
            <div class="area">${escHtml(t.area[c.type] || c.type)}</div>
          </div>
        </div>
        <span class="st ${escHtml(c.status)}">${escHtml(t.status[c.status] || c.status)}</span>
      </div>
      ${c.submittedDate ? `<div class="submitted">${SVG_ICON.check} ${escHtml(t.submitted)} ${fmtDateLoc(c.submittedDate, lang)}</div>` : ''}
      ${c.registryNumber ? `<div class="registry">${SVG_ICON.dot} ${escHtml(t.registry)}: <b>${escHtml(c.registryNumber)}</b></div>` : ''}
      ${c.trackingUrl ? `<a class="track-cta" href="${escHtml(c.trackingUrl)}" target="_blank" rel="noopener noreferrer">🔗 ${escHtml(t.trackingCta)}</a>` : ''}
      ${c.dueDate ? `<div class="due ${overdue ? 'over' : ''}">${SVG_ICON.cal} ${escHtml(t.due)}: ${fmtDateLoc(c.dueDate, lang)}${overdue ? ` · ${escHtml(t.overdue)}` : ''}</div>` : ''}
      ${chkHtml}
    </div>`;
  }).join('') : `<div class="empty">${escHtml(t.empty)}</div>`;
  const first = escHtml((client.name || '').split(' ')[0] || client.name);
  const greeting = `<h1>${t.greet.replace('{name}', first)}</h1>
    <p class="lead">${escHtml(t.lead)}</p>`;
  const s = auto.getSettings(db);
  const p = pT(lang);
  // Botón de reserva de cita (si está activada).
  const bookCta = s.booking.enabled
    ? `<a class="book-cta" href="/reservar/${escHtml(client.statusToken)}?lang=${lang}">${escHtml(p.bookCta)}</a>` : '';
  // Consentimiento RGPD: tarjeta para aceptar, o nota si ya está aceptado.
  const accepted = client.consent && client.consent.version >= s.legal.version;
  const consent = accepted
    ? `<div class="consent-done">${p.consentDone.replace('{date}', escHtml(fmtDateLoc(new Date(client.consent.acceptedAt).toISOString().slice(0, 10), lang)))}</div>`
    : `<form class="consent" method="post" action="/estado/${escHtml(client.statusToken)}/consent?lang=${lang}">
        <div class="consent-title">${escHtml(p.consentTitle)}</div>
        <p class="consent-text">${escHtml(s.legal.text)}</p>
        <button class="up-btn" type="submit">${escHtml(p.consentAccept)}</button>
      </form>`;
  return statusPageShell(`Burocracia Zero · ${client.name}`, greeting + bookCta + body + consent, lang, client.statusToken || '');
}

// Recibe un documento subido por el cliente desde el portal: lo guarda, lo
// registra como mensaje entrante (para que la gestoría lo vea en el chat) y
// marca el ítem del checklist como recibido.
const PORTAL_ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'application/pdf'];
function handlePortalUpload(res, db, client, b) {
  const kase = db.cases.find((c) => c.id === b.caseId && c.clientId === client.id);
  if (!kase) return json(res, 404, { error: 'Expediente no encontrado' });
  const mime = String(b.mime || '').toLowerCase();
  if (!PORTAL_ALLOWED_MIME.includes(mime)) return json(res, 415, { error: 'Formato no permitido (usa foto o PDF)' });
  const data = Buffer.from(String(b.dataBase64 || ''), 'base64');
  if (!data.length) return json(res, 400, { error: 'Archivo vacío' });
  if (data.length > 12_000_000) return json(res, 413, { error: 'El archivo supera los 12 MB' });
  const ext = mime === 'application/pdf' ? 'pdf' : (mime.split('/')[1] || 'bin');
  const safe = path.basename(String(b.filename || `documento.${ext}`)).replace(/[^\w.\-]+/g, '_').slice(0, 80) || `documento.${ext}`;
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const localName = `${newId('up')}_${safe}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, localName), data);
  const chk = Array.isArray(kase.checklist) ? kase.checklist : [];
  const idx = Number.isInteger(b.itemIndex) ? b.itemIndex : -1;
  const itemName = (chk[idx] && chk[idx].item) || 'documento';
  db.messages.push({
    id: newId('msg'),
    clientId: client.id,
    direction: 'in',
    text: `📎 ${itemName} — subido por el cliente desde el portal de seguimiento`,
    media: { kind: mime === 'application/pdf' ? 'document' : 'image', mime, filename: safe, caption: itemName, localPath: localName },
    timestamp: Date.now(),
    status: 'received',
    read: false,
    viaPortal: true,
  });
  if (chk[idx]) { chk[idx].done = true; kase.updatedAt = Date.now(); }
  save();
  const done = chk.filter((x) => x.done).length;
  return json(res, 200, { ok: true, done, total: chk.length });
}

// ---------------------------------------------------------------------------
// Reserva de cita online + consentimiento RGPD (páginas públicas del cliente)
// ---------------------------------------------------------------------------

// Traducciones específicas de reserva y consentimiento.
const PAGE_I18N = {
  es: { bookCta: '📅 Reservar cita', bookTitle: 'Reserva tu cita, {name}', bookLead: 'Elige el día y la hora que mejor te venga.', bookNone: 'Ahora mismo no hay huecos libres. Escríbenos por WhatsApp y te buscamos hueco.', bookOkTitle: '¡Cita reservada!', bookOkBody: 'Te esperamos el {date} a las {time}. Te hemos enviado la confirmación por WhatsApp.', bookBack: 'Ver mis trámites', bookTaken: 'Ese hueco acaba de ocuparse. Elige otro, por favor.', consentTitle: 'Protección de datos y autorización', consentAccept: 'He leído y acepto', consentDone: '✓ Consentimiento aceptado el {date}' },
  en: { bookCta: '📅 Book an appointment', bookTitle: 'Book your appointment, {name}', bookLead: 'Pick the day and time that suits you best.', bookNone: 'There are no free slots right now. Message us on WhatsApp and we will find one.', bookOkTitle: 'Appointment booked!', bookOkBody: 'We will see you on {date} at {time}. We have sent you the confirmation on WhatsApp.', bookBack: 'See my cases', bookTaken: 'That slot was just taken. Please pick another one.', consentTitle: 'Data protection and authorisation', consentAccept: 'I have read and accept', consentDone: '✓ Consent accepted on {date}' },
  fr: { bookCta: '📅 Prendre rendez-vous', bookTitle: 'Réservez votre rendez-vous, {name}', bookLead: 'Choisissez le jour et l’heure qui vous conviennent.', bookNone: 'Aucun créneau libre pour le moment. Écrivez-nous sur WhatsApp et nous en trouverons un.', bookOkTitle: 'Rendez-vous réservé !', bookOkBody: 'Nous vous attendons le {date} à {time}. Nous vous avons envoyé la confirmation sur WhatsApp.', bookBack: 'Voir mes démarches', bookTaken: 'Ce créneau vient d’être pris. Merci d’en choisir un autre.', consentTitle: 'Protection des données et autorisation', consentAccept: 'J’ai lu et j’accepte', consentDone: '✓ Consentement accepté le {date}' },
  ar: { bookCta: '📅 احجز موعداً', bookTitle: 'احجز موعدك يا {name}', bookLead: 'اختر اليوم والوقت المناسب لك.', bookNone: 'لا توجد مواعيد متاحة حالياً. راسلنا على واتساب وسنجد لك موعداً.', bookOkTitle: 'تم حجز الموعد!', bookOkBody: 'ننتظرك يوم {date} الساعة {time}. أرسلنا لك التأكيد على واتساب.', bookBack: 'عرض معاملاتي', bookTaken: 'لقد حُجز هذا الموعد للتو. من فضلك اختر موعداً آخر.', consentTitle: 'حماية البيانات والتفويض', consentAccept: 'قرأت وأوافق', consentDone: '✓ تمت الموافقة بتاريخ {date}' },
  ro: { bookCta: '📅 Programează o întâlnire', bookTitle: 'Rezervă-ți programarea, {name}', bookLead: 'Alege ziua și ora care ți se potrivesc.', bookNone: 'Momentan nu există intervale libere. Scrie-ne pe WhatsApp și găsim unul.', bookOkTitle: 'Programare rezervată!', bookOkBody: 'Te așteptăm pe {date} la ora {time}. Ți-am trimis confirmarea pe WhatsApp.', bookBack: 'Vezi dosarele mele', bookTaken: 'Acel interval tocmai a fost ocupat. Te rugăm alege altul.', consentTitle: 'Protecția datelor și autorizare', consentAccept: 'Am citit și accept', consentDone: '✓ Consimțământ acceptat la {date}' },
};
// Cadenas de pago de la cita (por ahora en español; se muestran igual en
// cualquier idioma hasta que se traduzcan).
const PAY_I18N = {
  payTitle: 'Reserva y pago de tu asesoría',
  payLead: 'Has elegido el {date} a las {time}. Para confirmar la cita hay que abonar {amount}.',
  payChoose: 'Elige cómo quieres pagar:',
  payCard: '💳 Pagar con tarjeta',
  payTransfer: '🏦 Pagar por transferencia',
  payNoMethods: 'El pago online no está disponible ahora mismo. Escríbenos por WhatsApp y te damos cita.',
  payFailedTitle: 'El pago no se completó',
  payFailedBody: 'No hemos podido confirmar el pago, así que el hueco sigue libre. Puedes intentarlo de nuevo.',
  payRetry: 'Volver a elegir hueco',
  payThanksPaid: 'Te esperamos el {date} a las {time}. El pago se ha registrado correctamente y te hemos enviado la confirmación por WhatsApp.',
  transferTitle: 'Hueco apartado · pendiente de pago',
  transferBody: 'Hemos apartado tu cita del {date} a las {time}. Para confirmarla, haz una transferencia de {amount} a estos datos:',
  transferConcept: 'Concepto (ponlo en la transferencia)',
  transferBeneficiary: 'Titular',
  transferHold: 'Guardamos tu hueco durante {hours} h. En cuanto veamos el pago te confirmamos la cita por WhatsApp.',
};
function pT(lang) { return { ...PAGE_I18N.es, ...PAY_I18N, ...(PAGE_I18N[lang] || {}) }; }

const pad2 = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const toMin = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
function fmtDayLoc(iso, lang = 'es') {
  const d = new Date(iso + 'T12:00');
  if (isNaN(d)) return iso;
  const s = d.toLocaleDateString(DATE_LOCALE[lang] || 'es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Huecos libres para reservar, según businessHours + citas ya ocupadas.
// Intervalos ocupados en el calendario de Outlook, por día (para no ofrecer
// huecos cuando la gestoría ya tiene algo en Outlook). { 'YYYY-MM-DD': [[ini,fin]] }
// en minutos. Best-effort: si Outlook no está configurado o falla, {} .
async function outlookBusyByDate(s, fromDate, toDate) {
  const cal = (s.microsoft && s.microsoft.calendar) || {};
  if (!msgraph.isConfigured() || !cal.enabled || !cal.user) return {};
  let events;
  try {
    events = await msgraph.listCalendarEvents({
      calendarUser: cal.user, calendarName: cal.calendarName,
      from: `${fromDate}T00:00:00`, to: `${toDate}T23:59:59`,
    });
  } catch (err) {
    console.error('Outlook (huecos libres):', err.message);
    return {};
  }
  const byDate = {};
  for (const e of events) {
    if (String(e.showAs || '').toLowerCase() === 'free') continue; // «libre» no bloquea
    if (e.isAllDay && e.start) { const d = e.start.slice(0, 10); (byDate[d] = byDate[d] || []).push([0, 24 * 60]); continue; }
    if (!e.start || !e.end) continue;
    const sd = e.start.slice(0, 10);
    const sm = toMin(e.start.slice(11, 16));
    const em = e.end.slice(0, 10) === sd ? toMin(e.end.slice(11, 16)) : 24 * 60;
    (byDate[sd] = byDate[sd] || []).push([sm, em]);
  }
  return byDate;
}

// Elimina las reservas pendientes de pago que ya han caducado (el pago con
// tarjeta no se completó a tiempo, o la transferencia no llegó), liberando el
// hueco. Devuelve cuántas ha caducado.
function expirePendingBookings(db, now = Date.now()) {
  const before = db.pendingBookings.length;
  db.pendingBookings = db.pendingBookings.filter((p) => {
    if (p.status !== 'pending') return false; // ya finalizada o cancelada: se retira
    return (p.expiresAt || 0) > now;
  });
  return before - db.pendingBookings.length;
}

async function availableSlots(db, s, now = new Date()) {
  const bh = s.businessHours || { days: [1, 2, 3, 4, 5], open: '09:00', close: '18:00' };
  const bk = s.booking || {};
  const slotMin = Math.max(10, Number(bk.slotMinutes) || 30);
  const horizon = Math.max(1, Number(bk.horizonDays) || 14);
  const maxPerDay = Math.max(1, Number(bk.maxPerDay) || 12);
  const openM = toMin(bh.open); const closeM = toMin(bh.close);
  const taken = {}; const countByDay = {};
  for (const a of db.appointments) {
    if (a.status === 'cancelada') continue;
    (taken[a.date] = taken[a.date] || new Set()).add(a.time);
    countByDay[a.date] = (countByDay[a.date] || 0) + 1;
  }
  // Huecos retenidos por reservas pendientes de pago (aún sin caducar): no se
  // ofrecen a otro cliente mientras uno está pagando o pendiente de transferencia.
  expirePendingBookings(db, now.getTime());
  for (const p of db.pendingBookings) {
    if (p.status !== 'pending') continue;
    (taken[p.date] = taken[p.date] || new Set()).add(p.time);
    countByDay[p.date] = (countByDay[p.date] || 0) + 1;
  }
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const today = isoDay(now);
  const horizonEnd = new Date(now); horizonEnd.setDate(horizonEnd.getDate() + horizon);
  // Ocupación en Outlook (si está activado) para no ofrecer huecos en conflicto.
  const busy = await outlookBusyByDate(s, today, isoDay(horizonEnd));
  const overlapsBusy = (date, m) => (busy[date] || []).some(([bi, bf]) => m < bf && m + slotMin > bi);
  const days = [];
  for (let i = 0; i < horizon; i += 1) {
    const d = new Date(now); d.setDate(d.getDate() + i);
    if (!bh.days.includes(d.getDay())) continue;
    const date = isoDay(d);
    let dayCount = countByDay[date] || 0;
    if (dayCount >= maxPerDay) continue;
    const slots = [];
    for (let m = openM; m + slotMin <= closeM && dayCount < maxPerDay; m += slotMin) {
      const time = `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
      if (taken[date] && taken[date].has(time)) continue;
      if (date === today && m <= nowMin + 30) continue; // 30 min de margen
      if (overlapsBusy(date, m)) continue; // ocupado en Outlook
      slots.push(time);
      dayCount += 1;
    }
    if (slots.length) days.push({ date, slots });
  }
  return days;
}

// Crea una cita (reutilizada por la API, la reserva online y el asistente):
// avisa al cliente por WhatsApp y la sincroniza con Outlook si está activado.
async function createAppointment(db, client, { date, time, reason, notes, payment } = {}) {
  const appt = {
    id: newId('cit'), clientId: client.id, date, time,
    reason: String(reason || '').trim(), notes: notes || '', status: 'activa',
    confirmationSentAt: null, remindedAt: null, createdAt: Date.now(),
    // Pago de la cita (si se cobró al reservar): { amount, method, status, ref }.
    payment: payment || null,
  };
  db.appointments.push(appt);
  save();
  await auto.onAppointmentCreated(db, appt, client, autoSender(db));
  const msCal = auto.getSettings(db).microsoft.calendar;
  if (msgraph.isConfigured() && msCal.enabled && msCal.user) {
    try { appt.msEventId = await msgraph.createCalendarEvent(msCal.user, appt, client, msCal.calendarName); }
    catch (err) { console.error('No se pudo crear el evento en Outlook:', err.message); }
  }
  save();
  return appt;
}

// Convierte una reserva pendiente ya pagada en una cita en firme (Outlook +
// aviso al cliente). Idempotente: si ya se finalizó, devuelve la cita creada.
async function finalizeBooking(db, booking, { method } = {}) {
  if (booking.status === 'confirmed' && booking.appointmentId) {
    return db.appointments.find((a) => a.id === booking.appointmentId) || null;
  }
  const client = db.clients.find((c) => c.id === booking.clientId);
  if (!client) return null;
  const payMethod = method || booking.method || 'tarjeta';
  const appt = await createAppointment(db, client, {
    date: booking.date, time: booking.time, reason: booking.reason,
    payment: {
      amount: money2(booking.amount), method: payMethod, status: 'paid',
      ref: booking.checkoutId || booking.id, at: Date.now(), concept: booking.concept || '',
    },
  });
  booking.status = 'confirmed';
  booking.appointmentId = appt.id;
  booking.confirmedAt = Date.now();
  save();
  security.audit('cita_pagada', { bookingId: booking.id, clientId: client.id, amount: booking.amount, method: payMethod });
  return appt;
}

async function renderBookingPage(db, client, lang, s, note) {
  const p = pT(lang);
  const days = await availableSlots(db, auto.getSettings(db));
  const first = escHtml((client.name || '').split(' ')[0] || client.name);
  const head = `<h1>${p.bookTitle.replace('{name}', first)}</h1><p class="lead">${escHtml(p.bookLead)}</p>`
    + (note ? `<div class="book-note">${escHtml(note)}</div>` : '');
  const body = days.length ? `<form method="post" class="book">${days.map((d) => `
      <div class="bk-day"><div class="bk-date">${escHtml(fmtDayLoc(d.date, lang))}</div>
      <div class="bk-slots">${d.slots.map((tm) => `<button class="bk-slot" type="submit" name="slot" value="${d.date}T${tm}">${tm}</button>`).join('')}</div></div>`).join('')}</form>`
    : `<div class="empty">${escHtml(p.bookNone)}</div>`;
  return statusPageShell(`Burocracia Zero · ${client.name}`, head + body, lang, client.statusToken || '', '/reservar/');
}

function renderBookingConfirmed(client, lang, date, time, paid) {
  const p = pT(lang);
  const body = `<div class="ok-card"><div class="ok-check">✓</div>
    <h1>${escHtml(p.bookOkTitle)}</h1>
    <p class="lead">${(paid ? p.payThanksPaid : p.bookOkBody).replace('{date}', escHtml(fmtDateLoc(date, lang))).replace('{time}', escHtml(time))}</p>
    <a class="up-btn" href="/estado/${escHtml(client.statusToken)}?lang=${lang}">${escHtml(p.bookBack)}</a></div>`;
  return statusPageShell(`Burocracia Zero · ${client.name}`, body, lang, client.statusToken || '', '/reservar/');
}

const eurLoc = (n) => (Math.round((Number(n) || 0) * 100) / 100)
  .toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

// Pantalla de elección de forma de pago para el hueco elegido.
function renderPaymentChoice(client, lang, s, date, time) {
  const p = pT(lang);
  const pay = (s.booking && s.booking.pay) || {};
  const amount = eurLoc(pay.price);
  const lead = p.payLead.replace('{date}', escHtml(fmtDateLoc(date, lang)))
    .replace('{time}', escHtml(time)).replace('{amount}', escHtml(amount));
  const slot = `${date}T${time}`;
  const cardBtn = (pay.allowCard && sumup.isConfigured())
    ? `<button class="book-cta" type="submit" name="method" value="tarjeta">${escHtml(p.payCard)}</button>` : '';
  const transferBtn = (pay.allowTransfer && pay.iban)
    ? `<button class="bk-slot" type="submit" name="method" value="transferencia">${escHtml(p.payTransfer)}</button>` : '';
  const buttons = (cardBtn || transferBtn)
    ? `<form method="post"><input type="hidden" name="slot" value="${escHtml(slot)}">
        <p class="lead">${escHtml(p.payChoose)}</p>
        <div class="bk-slots" style="align-items:center">${cardBtn} ${transferBtn}</div></form>`
    : `<div class="empty">${escHtml(p.payNoMethods)}</div>`;
  const head = `<h1>${escHtml(p.payTitle)}</h1><p class="lead">${lead}</p>`;
  return statusPageShell(`Burocracia Zero · ${client.name}`, head + buttons, lang, client.statusToken || '', '/reservar/');
}

// Instrucciones de transferencia (el hueco queda apartado hasta que se confirme).
function renderTransferInstructions(client, lang, s, booking) {
  const p = pT(lang);
  const pay = (s.booking && s.booking.pay) || {};
  const hours = Math.max(1, Number(pay.transferHoldHours) || 48);
  const body = `<div class="book">
    <h1>${escHtml(p.transferTitle)}</h1>
    <p class="lead">${p.transferBody.replace('{date}', escHtml(fmtDateLoc(booking.date, lang))).replace('{time}', escHtml(booking.time)).replace('{amount}', escHtml(eurLoc(booking.amount)))}</p>
    <div class="book-note" style="text-align:left">
      <div><strong>IBAN:</strong> ${escHtml(pay.iban)}</div>
      ${pay.beneficiary ? `<div><strong>${escHtml(p.transferBeneficiary)}:</strong> ${escHtml(pay.beneficiary)}</div>` : ''}
      <div><strong>${escHtml(p.transferConcept)}:</strong> ${escHtml((booking.concept || 'Cita') + ' ' + booking.id.slice(-6))}</div>
      <div><strong>Importe:</strong> ${escHtml(eurLoc(booking.amount))}</div>
    </div>
    <p class="lead">${escHtml(p.transferHold.replace('{hours}', hours))}</p>
    <a class="up-btn" href="/estado/${escHtml(client.statusToken)}?lang=${lang}">${escHtml(p.bookBack)}</a></div>`;
  return statusPageShell(`Burocracia Zero · ${client.name}`, body, lang, client.statusToken || '', '/reservar/');
}

function renderPaymentFailed(client, lang) {
  const p = pT(lang);
  const body = `<div class="ok-card"><div class="ok-check" style="background:#c0392b">✕</div>
    <h1>${escHtml(p.payFailedTitle)}</h1>
    <p class="lead">${escHtml(p.payFailedBody)}</p>
    <a class="up-btn" href="/reservar/${escHtml(client.statusToken)}?lang=${lang}">${escHtml(p.payRetry)}</a></div>`;
  return statusPageShell(`Burocracia Zero · ${client.name}`, body, lang, client.statusToken || '', '/reservar/');
}

// --- Páginas públicas de firma digital -------------------------------------

function signPageShell(title, bodyHtml, withScript = false) {
  return `<!doctype html>
<html lang="es" dir="ltr"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escHtml(title)}</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Lexend:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root { --charcoal:#1d1d1b; --cream:#f5f4f7; --lilac:#9272b0; --lilac-dark:#77599c; --yellow:#ffea63; --muted:#6f6d75; --ok:#1d7a34; --danger:#c0392b; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:"Lexend",-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; background:var(--cream); color:var(--charcoal); line-height:1.5; }
  .wrap { max-width:640px; margin:0 auto; padding:24px 18px 60px; }
  header { text-align:center; padding:18px 0 10px; }
  .logo-word { line-height:.86; display:inline-block; }
  .logo-word b { display:block; font-weight:800; font-size:30px; letter-spacing:-1px; }
  .logo-word span { display:block; font-weight:300; font-size:23px; }
  h1 { font-size:18px; margin:18px 0 6px; font-weight:700; }
  .doc { background:#fff; border:1px solid #e7e5ea; border-radius:14px; padding:18px 18px 16px; margin-bottom:16px; box-shadow:0 1px 2px rgba(0,0,0,.03); }
  .doc-title { font-weight:700; font-size:14px; margin-bottom:10px; }
  .doc-body { font-size:13px; color:#2b2a30; white-space:pre-wrap; line-height:1.6; }
  .field { margin:14px 0; }
  .field label { display:block; font-size:13px; font-weight:600; margin-bottom:6px; }
  .field input[type=text] { width:100%; font-family:inherit; font-size:15px; padding:11px 13px; border:1px solid #d8d5df; border-radius:10px; }
  .sign-label { font-size:13px; font-weight:600; margin-bottom:6px; }
  .sign-box { position:relative; }
  #pad { width:100%; height:200px; background:#fff; border:2px dashed #c9c3d6; border-radius:12px; touch-action:none; display:block; }
  .sign-hint { position:absolute; top:50%; left:0; right:0; text-align:center; transform:translateY(-50%); color:#b7b2c2; font-size:14px; pointer-events:none; }
  .sign-tools { display:flex; justify-content:flex-end; margin-top:8px; }
  .link-btn { background:none; border:0; color:var(--lilac-dark); font-weight:600; font-size:13px; cursor:pointer; text-decoration:underline; }
  .submit { width:100%; margin-top:18px; padding:14px; border:0; border-radius:12px; background:var(--charcoal); color:#fff; font-family:inherit; font-weight:700; font-size:15px; cursor:pointer; }
  .submit:disabled { opacity:.5; }
  .msg { text-align:center; font-size:13.5px; margin-top:12px; font-weight:600; }
  .msg.err { color:var(--danger); }
  .empty { background:#fff; border:1px solid #e6e3db; border-radius:14px; padding:26px; text-align:center; color:var(--muted); }
  .ok-card { background:#fff; border:1px solid #e7e5ea; border-radius:16px; padding:34px 26px; text-align:center; }
  .ok-check { width:56px; height:56px; margin:0 auto 12px; border-radius:50%; background:#e4f5e8; color:var(--ok); font-size:30px; font-weight:800; display:flex; align-items:center; justify-content:center; }
  .legal { font-size:11.5px; color:var(--muted); margin-top:12px; }
  footer { text-align:center; color:var(--muted); font-size:12.5px; margin-top:26px; }
</style>
</head><body>
<div class="wrap">
<header><div class="logo-word" role="img" aria-label="Burocracia Zero"><b>Burocracia</b><span>Zero</span></div></header>
${bodyHtml}
<footer>Burocracia Zero · Simplificamos tus trámites</footer>
</div>
${withScript ? '<script src="/firmar.js"></script>' : ''}
</body></html>`;
}

function renderSignPage(sig, client) {
  const first = escHtml((client.name || '').split(' ')[0]);
  const body = `
    <h1>Hola ${first}, firma tu documento</h1>
    <p class="legal">Revisa el documento y fírmalo con el dedo. Es un enlace privado y seguro.</p>
    <div class="doc">
      <div class="doc-title">${escHtml(sig.title)}</div>
      <div class="doc-body">${escHtml(sig.body)}</div>
    </div>
    <form id="sign-form" data-token="${escHtml(sig.token)}" data-name="${escHtml(client.name || '')}">
      <div class="field">
        <label for="signer">Nombre y apellidos</label>
        <input type="text" id="signer" name="signer" value="${escHtml(client.name || '')}" autocomplete="name">
      </div>
      <div class="sign-label">Tu firma</div>
      <div class="sign-box">
        <canvas id="pad"></canvas>
        <div class="sign-hint" id="pad-hint">✍️ Firma aquí con el dedo</div>
      </div>
      <div class="sign-tools"><button type="button" class="link-btn" id="clear">Borrar y repetir</button></div>
      <button type="submit" class="submit" id="submit">Firmar y enviar</button>
      <div class="msg" id="msg"></div>
      <p class="legal">Al firmar aceptas el contenido del documento. Se registrará la fecha, la hora y tu dirección IP como prueba de la firma.</p>
    </form>`;
  return signPageShell(`Firmar · ${client.name}`, body, true);
}

function renderSignDone(sig) {
  const body = `<div class="ok-card"><div class="ok-check">✓</div>
    <h1>¡Documento firmado!</h1>
    <p class="legal" style="font-size:14px">Gracias. Hemos recibido tu firma correctamente${sig.signedAt ? ` el ${new Date(sig.signedAt).toLocaleString('es-ES')}` : ''}. Ya puedes cerrar esta página.</p></div>`;
  return signPageShell('Documento firmado', body);
}

// ---------------------------------------------------------------------------
// Servidor
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  security.applySecurityHeaders(req, res);

  try {
    // Webhook de Meta/YCloud: verificación (GET) y recepción (POST).
    if (url.pathname === '/webhook') {
      if (!security.rateLimit(`wh:${ipOf(req)}`, Number(process.env.RATE_LIMIT_WEBHOOK || 300))) {
        return json(res, 429, { error: 'Demasiadas peticiones' });
      }
      if (req.method === 'GET') {
        const mode = url.searchParams.get('hub.mode');
        const token = url.searchParams.get('hub.verify_token');
        const challenge = url.searchParams.get('hub.challenge');
        if (mode === 'subscribe' && token === wa.config().verifyToken) {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          return res.end(challenge || '');
        }
        res.writeHead(403);
        return res.end();
      }
      if (req.method === 'POST') {
        const raw = await readRawBody(req);
        // Con YCLOUD_WEBHOOK_SECRET (o META_APP_SECRET) definido, solo se
        // aceptan webhooks firmados: nadie puede inyectar mensajes falsos.
        const verdict = security.verifyWebhook(req, raw);
        if (!verdict.ok) {
          security.audit('webhook_rechazado', { ip: ipOf(req) });
          return json(res, 401, { error: 'Firma del webhook no válida' });
        }
        // Sin secreto configurado, cualquiera podría inyectar mensajes falsos.
        // En un despliegue real (con WhatsApp conectado) se rechaza salvo que se
        // permita explícitamente con CRM_ALLOW_UNSIGNED_WEBHOOK=1.
        if (verdict.via === 'sin_verificacion' && wa.isConfigured()
            && process.env.CRM_ALLOW_UNSIGNED_WEBHOOK !== '1') {
          security.audit('webhook_sin_secreto_rechazado', { ip: ipOf(req) });
          return json(res, 401, { error: 'Webhook sin firma: configura YCLOUD_WEBHOOK_SECRET' });
        }
        let body = {};
        try { body = raw ? JSON.parse(raw) : {}; } catch { return json(res, 400, { error: 'JSON inválido' }); }
        await handleWebhookPayload(load(), body);
        return json(res, 200, { ok: true });
      }
    }

    if (url.pathname.startsWith('/api/')) {
      if (!security.rateLimit(`api:${ipOf(req)}`, Number(process.env.RATE_LIMIT_API || 600))) {
        return json(res, 429, { error: 'Demasiadas peticiones, espera un momento' });
      }
      return await handleApi(req, res, url);
    }

    // Página pública de estado del trámite (enlace privado por cliente).
    if (url.pathname.startsWith('/estado/')) {
      if (!security.rateLimit(`estado:${ipOf(req)}`, Number(process.env.RATE_LIMIT_API || 600))) {
        res.writeHead(429, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Demasiadas peticiones');
      }
      const rest = url.pathname.slice('/estado/'.length);
      const token = rest.split('/')[0];
      const db = load();
      const client = token && token.length >= 16 ? db.clients.find((c) => c.statusToken === token) : null;

      // Subida de un documento desde el portal del cliente.
      if (req.method === 'POST' && rest.endsWith('/upload')) {
        if (!client) return json(res, 404, { error: 'Enlace no válido' });
        const raw = await readRawBody(req, 15_000_000);
        let b = {};
        try { b = raw ? JSON.parse(raw) : {}; } catch { return json(res, 400, { error: 'JSON inválido' }); }
        return handlePortalUpload(res, db, client, b);
      }

      const lang = pickLang(url, req);

      // Consentimiento RGPD + autorización (formulario de la página de estado).
      if (req.method === 'POST' && rest.endsWith('/consent')) {
        if (!client) return json(res, 404, { error: 'Enlace no válido' });
        const legal = auto.getSettings(db).legal;
        client.consent = { acceptedAt: Date.now(), version: legal.version, ip: ipOf(req) };
        save();
        security.audit('consentimiento_aceptado', { clientId: client.id });
        res.writeHead(303, { Location: `/estado/${client.statusToken}?lang=${lang}` });
        return res.end();
      }

      if (!client) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(statusPageShell((I18N[lang] || I18N.es).notFoundTitle,
          `<div class="empty">${escHtml((I18N[lang] || I18N.es).notFound)}</div>`, lang, ''));
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(renderStatusPage(db, client, lang));
    }

    // Webhook de SumUp: aviso de cambio de estado de un cobro. Se verifica el
    // estado real contra la API (no se confía en el cuerpo recibido) y, si está
    // pagado, se confirma la cita. Idempotente.
    if (url.pathname === '/pago-sumup') {
      if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
      let body = {};
      try { const raw = await readRawBody(req, 100_000); body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
      // SumUp puede enviar el id del checkout y/o la referencia (nuestra reserva).
      const checkoutId = body.id || body.checkout_id || (body.payload && body.payload.id) || '';
      const reference = body.checkout_reference || body.reference || (body.payload && body.payload.checkout_reference) || '';
      const db = load();
      const booking = db.pendingBookings.find((x) => x.status === 'pending'
        && ((checkoutId && x.checkoutId === checkoutId) || (reference && x.id === reference)));
      if (booking && booking.checkoutId && sumup.isConfigured()) {
        try {
          const chk = await sumup.getCheckout(booking.checkoutId);
          if (sumup.isPaid(chk.status)) await finalizeBooking(db, booking, { method: 'tarjeta' });
        } catch (err) { console.error('Webhook SumUp:', sumup.redact(err.message)); }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{"ok":true}');
    }

    // Reserva de cita online (enlace privado por cliente).
    if (url.pathname.startsWith('/reservar/')) {
      if (!security.rateLimit(`reservar:${ipOf(req)}`, Number(process.env.RATE_LIMIT_API || 600))) {
        res.writeHead(429, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Demasiadas peticiones');
      }
      const token = url.pathname.slice('/reservar/'.length).split('/')[0];
      const rest = url.pathname.slice(('/reservar/' + token).length); // '' | '/pagado'
      const db = load();
      const lang = pickLang(url, req);
      const client = token && token.length >= 16 ? db.clients.find((c) => c.statusToken === token) : null;
      const s = auto.getSettings(db);
      if (!client || !s.booking.enabled) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(statusPageShell((I18N[lang] || I18N.es).notFoundTitle,
          `<div class="empty">${escHtml((I18N[lang] || I18N.es).notFound)}</div>`, lang, ''));
      }
      const pay = (s.booking.pay) || {};
      const payOn = Boolean(pay.enabled) && (Number(pay.price) || 0) > 0;

      // Vuelta desde la página de pago de SumUp: se verifica el estado real.
      if (rest === '/pagado') {
        const bookingId = url.searchParams.get('b') || '';
        const booking = db.pendingBookings.find((x) => x.id === bookingId && x.clientId === client.id);
        if (booking && booking.status === 'confirmed') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(renderBookingConfirmed(client, lang, booking.date, booking.time, true));
        }
        if (booking && booking.status === 'pending' && booking.checkoutId) {
          try {
            const chk = await sumup.getCheckout(booking.checkoutId);
            if (sumup.isPaid(chk.status)) {
              await finalizeBooking(db, booking, { method: 'tarjeta' });
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              return res.end(renderBookingConfirmed(client, lang, booking.date, booking.time, true));
            }
          } catch (err) { console.error('Verificar pago SumUp:', sumup.redact(err.message)); }
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(renderPaymentFailed(client, lang));
      }

      if (req.method === 'POST') {
        const raw = await readRawBody(req, 100_000);
        const form = new URLSearchParams(raw);
        const slot = form.get('slot') || '';
        const method = form.get('method') || '';
        const [date, time] = slot.split('T');
        const slots = await availableSlots(db, s);
        const free = slots.some((d) => d.date === date && d.slots.includes(time));
        if (!date || !time || !free) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(await renderBookingPage(db, client, lang, s, pT(lang).bookTaken));
        }
        // Sin cobro: se reserva directamente (comportamiento clásico).
        if (!payOn) {
          await createAppointment(db, client, { date, time, reason: s.booking.reason });
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(renderBookingConfirmed(client, lang, date, time));
        }
        // Con cobro: primero se elige la forma de pago.
        if (method !== 'tarjeta' && method !== 'transferencia') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(renderPaymentChoice(client, lang, s, date, time));
        }
        // Se crea la reserva pendiente (retiene el hueco).
        const now = Date.now();
        const isCard = method === 'tarjeta';
        const holdMs = isCard
          ? Math.max(10, Number(pay.holdMinutes) || 30) * 60_000
          : Math.max(1, Number(pay.transferHoldHours) || 48) * 3_600_000;
        const booking = {
          id: newId('pb'), clientId: client.id, date, time, reason: s.booking.reason,
          amount: money2(pay.price), currency: pay.currency || 'EUR', concept: pay.concept || 'Cita',
          method, status: 'pending', checkoutId: null,
          createdAt: now, expiresAt: now + holdMs, appointmentId: null,
        };
        if (isCard) {
          if (!(pay.allowCard && sumup.isConfigured())) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(renderPaymentChoice(client, lang, s, date, time));
          }
          try {
            const base = publicBase(req);
            const checkout = await sumup.createHostedCheckout({
              amount: booking.amount, currency: booking.currency, reference: booking.id,
              description: `${booking.concept} · ${client.name}`,
              returnUrl: `${base}/pago-sumup`,
              redirectUrl: `${base}/reservar/${client.statusToken}/pagado?b=${booking.id}&lang=${lang}`,
            });
            booking.checkoutId = checkout.id;
            db.pendingBookings.push(booking);
            save();
            res.writeHead(303, { Location: checkout.url });
            return res.end();
          } catch (err) {
            console.error('Crear checkout SumUp:', sumup.redact(err.message));
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(renderPaymentChoice(client, lang, s, date, time));
          }
        }
        // Transferencia: se aparta el hueco y se muestran los datos bancarios.
        if (!(pay.allowTransfer && pay.iban)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(renderPaymentChoice(client, lang, s, date, time));
        }
        db.pendingBookings.push(booking);
        save();
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(renderTransferInstructions(client, lang, s, booking));
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(await renderBookingPage(db, client, lang, s));
    }

    // Firma digital de un documento (enlace privado por solicitud).
    if (url.pathname.startsWith('/firmar/')) {
      if (!security.rateLimit(`firmar:${ipOf(req)}`, Number(process.env.RATE_LIMIT_API || 600))) {
        res.writeHead(429, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Demasiadas peticiones');
      }
      const token = url.pathname.slice('/firmar/'.length).split('/')[0];
      const db = load();
      const sig = token && token.length >= 16 ? db.signatures.find((s) => s.token === token) : null;
      const client = sig ? db.clients.find((c) => c.id === sig.clientId) : null;
      if (!sig || !client || sig.status === 'anulado') {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(signPageShell('Enlace no válido',
          '<div class="empty">Este enlace de firma no es válido o ha caducado. Escríbenos por WhatsApp.</div>'));
      }
      if (sig.status === 'firmado') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(renderSignDone(sig));
      }
      if (req.method === 'POST') {
        const raw = await readRawBody(req, 6_000_000);
        let b = {};
        try { b = raw ? JSON.parse(raw) : {}; } catch { return json(res, 400, { error: 'JSON inválido' }); }
        const name = String(b.name || '').trim();
        if (!name) return json(res, 400, { error: 'Escribe tu nombre completo.' });
        if (!b.signature || !/^data:image\/jpe?g/.test(String(b.signature))) {
          return json(res, 400, { error: 'Falta la firma.' });
        }
        await finalizeSignature(db, sig, client, name, b.signature, req);
        return json(res, 200, { ok: true });
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(renderSignPage(sig, client));
    }

    // Ficheros estáticos de la interfaz.
    let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
    filePath = path.normalize(filePath).replace(/^([.][.][/\\])+/, '');
    const full = path.join(PUBLIC_DIR, filePath);
    if (!full.startsWith(PUBLIC_DIR) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('No encontrado');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    return fs.createReadStream(full).pipe(res);
  } catch (err) {
    return json(res, 500, { error: err.message });
  }
});

// Planificador: cada 5 minutos revisa reclamos de documentación pendientes y
// recordatorios que haya que enviar al cliente (solo envía en horario laboral).
setInterval(() => {
  const db = load();
  auto.runScheduled(db, autoSender(db))
    .then((actions) => { if (actions.length) save(); })
    .catch((err) => console.error('Error en automatizaciones:', err.message));
  // Resumen diario por Telegram (una vez al día, a partir de la hora fijada).
  maybeTelegramDigest(db).catch((err) => console.error('Resumen Telegram:', telegram.redact(err && err.message)));
  try {
    // Copia diaria: una al día. Se usa una marca de fecha en los ajustes (en vez
    // de fiarse de si existe el fichero local), para que en modo «solo nube»
    // —donde la copia local se borra tras subirla— no se vuelva a crear en cada
    // ciclo del planificador.
    const nb = new Date();
    const dayKey = `${nb.getFullYear()}${String(nb.getMonth() + 1).padStart(2, '0')}${String(nb.getDate()).padStart(2, '0')}`;
    if (!db.settings || typeof db.settings !== 'object') db.settings = {};
    if (db.settings.lastDailyBackup !== dayKey) {
      const created = backup.create(false); // backup-AAAAMMDD.json.gz(.enc)
      db.settings.lastDailyBackup = dayKey;
      save();
      console.log(`Copia de seguridad diaria creada: ${created.name}`);
      const cloudOnly = auto.getSettings(db).microsoft.backup.cloudOnly;
      uploadBackupToCloud(db, created.name)
        .then((cloud) => {
          if (!cloud) return;
          console.log(`Copia subida a la nube: ${created.name}`);
          if (cloudOnly) {
            backup.remove(created.name);
            console.log(`Copia local eliminada (solo nube): ${created.name}`);
          }
        })
        .catch((err) => {
          console.error('No se pudo subir la copia a la nube:', err.message);
          notifyOwner(`La copia de seguridad de hoy NO se pudo subir a SharePoint: ${err.message}. La copia local sí se hizo.`, 'backup_cloud_fail', 720);
        });
      // Sincroniza también los adjuntos (documentos) a la nube: no van en el .gz.
      uploadsBackupToCloud(db).catch((err) => console.error('No se pudieron subir los adjuntos a la nube:', err.message));
    }
  } catch (err) {
    console.error('Error al crear la copia de seguridad:', err.message);
    notifyOwner(`No se pudo crear la copia de seguridad diaria: ${err.message}.`, 'backup_fail', 720);
  }
  checkDiskSpace();
  // Conservación de datos (RGPD): recordatorio ~mensual si hay clientes que
  // llevan mucho inactivos y sin trámites abiertos (para revisar su borrado).
  try {
    if (auto.getSettings(db).retention.enabled) {
      const cand = retentionCandidates(db);
      if (cand.length) {
        notifyOwner(`🗓️ Conservación de datos: ${cand.length} cliente(s) llevan mucho tiempo inactivos y sin trámites abiertos. Revisa en el CRM si procede borrarlos (RGPD).`, 'retention', 30 * 24 * 60);
      }
    }
  } catch (err) { console.error('Aviso de conservación:', err.message); }
}, 5 * 60 * 1000);

// Mensajes programados: se revisa cada minuto para enviarlos a la hora elegida.
setInterval(() => {
  const db = load();
  dispatchScheduledMessages(db)
    .then((changed) => { if (changed) save(); })
    .catch((err) => console.error('Error al enviar mensajes programados:', err.message));
}, 60 * 1000);

// ---------------------------------------------------------------------------
// Asistente por Telegram
// ---------------------------------------------------------------------------
// José (o Carmen) le escribe o le manda una nota de voz al bot y este ejecuta
// acciones en el CRM: mandar un WhatsApp, crear una cita, un recordatorio o
// hacer consultas. Solo responde a los IDs de la lista blanca, cada uno ligado
// a su usuario del CRM (respeta el aislamiento), y pide confirmación antes de
// mandar nada o crear nada.

const TG_ALLOWED = assistant.parseAllowed(process.env.TELEGRAM_ALLOWED);
const tgPending = new Map(); // token -> { chatId, crmUser, action, expires }
let tgOffset = 0;

const TG_HELP = [
  '👋 Soy tu asistente de Burocracia Zero. Dime qué necesitas por texto o por nota de voz. Ejemplos:',
  '',
  '📅 Citas:',
  '• «Ponme una cita con María el jueves a las 12 por la renovación del NIE».',
  '• «Cita con Fatima el lunes a las 10, su teléfono es 611222333» (la da de alta y le pone la cita).',
  '• «Cambia la cita de Pedro al viernes a las 5» · «Cancela la cita de Pedro del viernes».',
  '• «¿Qué tengo hoy?» · «¿Qué citas tengo esta semana?» · «¿Qué citas hay el jueves?».',
  '',
  '📲 WhatsApp:',
  '• «Manda por WhatsApp a Juan que su cita es mañana a las 10».',
  '',
  '📁 Clientes y expedientes:',
  '• «Da de alta a Ana López, 600112233».',
  '• «Crea un expediente de Arraigo social para Ahmed, 300 €».',
  '• «Marca el expediente de María como completado».',
  '• «¿Qué trámites tiene Pedro?» · «¿Qué me ha dicho Ahmed?».',
  '',
  '💶 Cobros:',
  '• «Cóbrale a Pedro en efectivo» · «Cóbrale 200 € a cuenta a María por transferencia».',
  '• «¿Quién me debe dinero?».',
  '',
  '🗒️ Organización:',
  '• «Recuérdame el lunes llamar a la asesoría» (aviso personal).',
  '• «Crea una tarea: preparar documentación de Ana para el viernes».',
  '• «¿Qué tengo hoy?» · «Búscame a Ahmed».',
  '',
  '• Envíame una foto o un PDF con el nombre del cliente en el pie y se lo mando por WhatsApp.',
  '',
  'Antes de enviar cualquier WhatsApp o de crear/cambiar/cancelar algo te pediré que lo confirmes.',
].join('\n');

function tgToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Guarda una acción pendiente de confirmación. El token es aleatorio (no
// adivinable) y la acción queda ligada al usuario de Telegram que la creó:
// solo esa persona puede confirmarla.
function tgStash(fromId, chatId, crmUser, action) {
  const token = crypto.randomBytes(16).toString('hex');
  tgPending.set(token, { fromId, chatId, crmUser, action, expires: Date.now() + 10 * 60 * 1000 });
  return token;
}

// ¿Está este ID de Telegram autorizado? (lista blanca, cierre por defecto).
function tgAuthorized(fromId) {
  return TG_ALLOWED.has(fromId);
}

// Limpia acciones pendientes caducadas (para no acumular memoria).
function tgSweep() {
  const now = Date.now();
  for (const [k, v] of tgPending) if (v.expires < now) tgPending.delete(k);
}

async function handleTelegramUpdate(update) {
  if (update.callback_query) return handleTgCallback(update.callback_query);
  const msg = update.message;
  if (!msg || !msg.chat || !msg.from) return;
  // Solo en chats privados: en grupos los datos del cliente (nombres, teléfonos,
  // NIE…) quedarían a la vista de terceros. Los updates de grupo se ignoran.
  if (msg.chat.type !== 'private') return;
  const chatId = msg.chat.id;
  const fromId = String(msg.from.id);

  // Autorización: solo los IDs de la lista blanca. A los no autorizados se les
  // responde con moderación (rate-limit) para no usar el bot como amplificador.
  if (!tgAuthorized(fromId)) {
    if (security.rateLimit(`tgx:${fromId}`, 2, 60_000)) {
      await telegram.sendMessage(chatId,
        `⛔ No estás autorizado para usar este asistente.\nTu ID de Telegram es: ${fromId}\nPídele al administrador que te dé de alta.`).catch(() => null);
    }
    return;
  }
  // Límite de uso por usuario autorizado (evita spam accidental y coste de IA).
  if (!security.rateLimit(`tg:${fromId}`, 20, 60_000)) {
    await telegram.sendMessage(chatId, '⏳ Vas muy rápido; espera un momento y vuelve a intentarlo.').catch(() => null);
    return;
  }
  const crmUser = TG_ALLOWED.get(fromId);

  const text0 = (msg.text || '').trim();
  if (text0 === '/start' || text0 === '/help' || text0 === '/ayuda') { await telegram.sendMessage(chatId, TG_HELP); return; }
  if (text0 === '/id') { await telegram.sendMessage(chatId, `Tu ID de Telegram es ${fromId}.`); return; }

  // Documento o foto → enviarlo por WhatsApp al cliente indicado en el pie.
  if (msg.document || (msg.photo && msg.photo.length)) {
    const caption = (msg.caption || '').trim();
    if (!caption) {
      await telegram.sendMessage(chatId, '📎 Recibido. Para enviarlo, reenvíamelo poniendo en el pie el nombre o el teléfono del cliente (por ejemplo, «Pedro Ramírez»).');
      return;
    }
    const db = load();
    const r = assistant.resolveClient(db, caption, (c) => canSeeClient(c || {}, crmUser));
    if (r.ambiguous) { await telegram.sendMessage(chatId, `Hay varios clientes que coinciden con «${caption}». Pon el nombre completo o el teléfono en el pie.`); return; }
    if (r.blocked) { await telegram.sendMessage(chatId, 'Ese contacto pertenece a otro usuario.'); return; }
    if (r.none) { await telegram.sendMessage(chatId, `No encuentro ningún cliente «${caption}». Pon en el pie el nombre o el teléfono del cliente.`); return; }
    let fileId;
    let filename;
    let mime;
    if (msg.document) {
      fileId = msg.document.file_id;
      filename = msg.document.file_name || 'documento';
      mime = msg.document.mime_type || 'application/octet-stream';
    } else {
      fileId = msg.photo[msg.photo.length - 1].file_id; // la mayor resolución
      filename = 'foto.jpg';
      mime = 'image/jpeg';
    }
    const dest = r.client ? `${r.client.name} (+${r.client.phone})` : `+${r.phone}`;
    const base = { type: 'wa_media', fileId, filename, mime, caption: '' };
    const action = r.client ? { ...base, clientId: r.client.id } : { ...base, phone: r.phone, name: `+${r.phone}` };
    const token = tgStash(fromId, chatId, crmUser, action);
    await telegram.sendMessage(chatId, `📎 Voy a enviar «${filename}» por WhatsApp a ${dest}.\n\n¿Lo confirmas?`,
      { replyMarkup: telegram.confirmKeyboard(token) });
    return;
  }

  // Nota de voz → transcribir con el mismo servicio que el CRM.
  let text = text0;
  if (msg.voice || msg.audio) {
    if (!transcribe.isConfigured()) {
      await telegram.sendMessage(chatId, 'Para entender notas de voz hay que configurar OPENAI_API_KEY (la transcripción usa Whisper; Claude no transcribe audio). Escríbeme el mensaje por texto.');
      return;
    }
    try {
      await telegram.sendChatAction(chatId);
      const media = msg.voice || msg.audio;
      const buf = await telegram.downloadFile(media.file_id);
      text = await transcribe.run(buf, 'nota.ogg', media.mime_type || 'audio/ogg');
      if (text) await telegram.sendMessage(chatId, `🎙️ Te he entendido: «${text}»`);
    } catch (err) {
      console.error('Asistente Telegram (voz):', telegram.redact(err && err.message));
      await telegram.sendMessage(chatId, 'No pude transcribir la nota de voz. Inténtalo de nuevo.').catch(() => null);
      return;
    }
  }
  if (!text) { await telegram.sendMessage(chatId, 'Dime qué necesitas por texto o nota de voz. Escribe /ayuda para ver ejemplos.'); return; }

  // Interpretar la orden.
  let intent;
  try {
    await telegram.sendChatAction(chatId);
    intent = await assistant.interpret(text, { today: tgToday() });
  } catch (err) {
    console.error('Asistente Telegram (IA):', telegram.redact(err && err.message));
    await telegram.sendMessage(chatId, 'El asistente no está disponible ahora mismo. Inténtalo en un momento.').catch(() => null);
    return;
  }
  if (intent.reply) { await telegram.sendMessage(chatId, intent.reply); return; }
  await routeTgTool(fromId, chatId, crmUser, intent.tool, intent.args || {});
}

// Traduce una herramienta del modelo en una respuesta directa (consultas) o en
// una acción que se propone y queda pendiente de confirmación (envíos/altas).
async function routeTgTool(fromId, chatId, crmUser, tool, args) {
  const db = load();
  const visible = (c) => canSeeClient(c || {}, crmUser);

  if (tool === 'consultar_agenda') {
    const fecha = assistant.validDate(args.fecha) ? args.fecha : tgToday();
    const citas = db.appointments
      .filter((a) => a.date === fecha && a.status !== 'cancelada' && visible(db.clients.find((c) => c.id === a.clientId)))
      .sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
    if (!citas.length) { await telegram.sendMessage(chatId, `📅 No tienes citas para el ${fmtDayLoc(fecha, 'es')}.`); return; }
    const nameOf = (id) => (db.clients.find((c) => c.id === id) || {}).name || '(cliente)';
    const lines = citas.map((a) => `• ${a.time} — ${nameOf(a.clientId)}${a.reason ? ` (${a.reason})` : ''}`);
    await telegram.sendMessage(chatId, `📅 Citas del ${fmtDayLoc(fecha, 'es')}:\n${lines.join('\n')}`);
    return;
  }

  if (tool === 'buscar_cliente') {
    const q = String(args.consulta || '').toLowerCase().trim();
    const hits = db.clients.filter((c) => visible(c)
      && [c.name, c.phone, c.nif, c.email, (c.tags || []).join(' ')].join(' ').toLowerCase().includes(q)).slice(0, 8);
    if (!hits.length) { await telegram.sendMessage(chatId, `No encuentro clientes que coincidan con «${args.consulta}».`); return; }
    const lines = hits.map((c) => {
      const abiertos = db.cases.filter((k) => k.clientId === c.id && k.status !== 'completado').length;
      return `• ${c.name} · +${c.phone}${abiertos ? ` · ${abiertos} expediente(s) abierto(s)` : ''}`;
    });
    await telegram.sendMessage(chatId, `👥 Resultados:\n${lines.join('\n')}`);
    return;
  }

  if (tool === 'pendientes_cobro') {
    const byClient = new Map();
    for (const c of db.cases) {
      const client = db.clients.find((x) => x.id === c.clientId);
      if (!client || !visible(client)) continue;
      const feeDue = (Number(c.fee) || 0) > 0 && !c.paid ? Number(c.fee) : 0;
      const taxDue = (Number(c.taxAmount) || 0) > 0 && !c.taxPaid ? Number(c.taxAmount) : 0;
      if (!feeDue && !taxDue) continue;
      const e = byClient.get(client.id) || { name: client.name, total: 0 };
      e.total += feeDue + taxDue;
      byClient.set(client.id, e);
    }
    const list = [...byClient.values()].sort((a, b) => b.total - a.total);
    if (!list.length) { await telegram.sendMessage(chatId, '✅ No hay importes pendientes de cobro.'); return; }
    const total = list.reduce((s, e) => s + e.total, 0);
    const lines = list.slice(0, 15).map((e) => `• ${e.name}: ${e.total.toLocaleString('es-ES')} €`);
    await telegram.sendMessage(chatId, `💶 Pendiente de cobro (${total.toLocaleString('es-ES')} € en total):\n${lines.join('\n')}`);
    return;
  }

  if (tool === 'enviar_whatsapp') {
    const mensaje = String(args.mensaje || '').trim();
    if (!mensaje) { await telegram.sendMessage(chatId, '¿Qué mensaje quieres que le envíe?'); return; }
    const r = assistant.resolveClient(db, args.destinatario, visible);
    if (r.ambiguous) {
      await telegram.sendMessage(chatId, `Hay varios clientes que coinciden con «${args.destinatario}»:\n`
        + r.ambiguous.map((c) => `• ${c.name} · +${c.phone}`).join('\n') + '\nDime cuál (nombre completo o teléfono).');
      return;
    }
    if (r.blocked) { await telegram.sendMessage(chatId, 'Ese contacto pertenece a otro usuario, no puedo escribirle desde tu cuenta.'); return; }
    if (r.none) { await telegram.sendMessage(chatId, `No encuentro ningún cliente llamado «${args.destinatario}». Si es nuevo, dime su número de teléfono.`); return; }
    const dest = r.client ? `${r.client.name} (+${r.client.phone})` : `el nuevo número +${r.phone}`;
    const action = r.client
      ? { type: 'wa', clientId: r.client.id, message: mensaje }
      : { type: 'wa', phone: r.phone, name: `+${r.phone}`, message: mensaje };
    const token = tgStash(fromId, chatId, crmUser, action);
    await telegram.sendMessage(chatId, `📲 Voy a enviar por WhatsApp a ${dest}:\n\n«${mensaje}»\n\n¿Lo confirmas?`,
      { replyMarkup: telegram.confirmKeyboard(token) });
    return;
  }

  if (tool === 'crear_cita') {
    if (!assistant.validDate(args.fecha)) { await telegram.sendMessage(chatId, '¿Para qué día es la cita? (dime la fecha)'); return; }
    if (!assistant.validTime(args.hora)) { await telegram.sendMessage(chatId, '¿A qué hora es la cita?'); return; }
    const r = assistant.resolveClient(db, args.cliente, visible);
    if (r.ambiguous) {
      await telegram.sendMessage(chatId, `Hay varios clientes que coinciden con «${args.cliente}»:\n`
        + r.ambiguous.map((c) => `• ${c.name} · +${c.phone}`).join('\n') + '\nDime cuál.');
      return;
    }
    if (r.blocked) { await telegram.sendMessage(chatId, 'Ese contacto pertenece a otro usuario.'); return; }
    const reason = String(args.motivo || '').trim();
    let action;
    let quien;
    if (r.client) {
      action = { type: 'cita', clientId: r.client.id, date: args.fecha, time: args.hora, reason };
      quien = r.client.name;
    } else {
      // Cliente nuevo: se necesita un teléfono (dado en «telefono» o como cliente).
      const rawPhone = assistant.looksLikePhone(args.telefono) ? args.telefono : (r.phone ? args.cliente : '');
      if (!assistant.looksLikePhone(rawPhone) && !r.phone) {
        await telegram.sendMessage(chatId, `No encuentro al cliente «${args.cliente}». Si es nuevo, dime su teléfono y le creo la ficha y la cita.`);
        return;
      }
      const phone = normalizePhone(assistant.looksLikePhone(args.telefono) ? args.telefono : r.phone);
      if (db.clients.some((c) => c.phone === phone) && !visible(db.clients.find((c) => c.phone === phone))) {
        await telegram.sendMessage(chatId, 'Ese teléfono pertenece a otro usuario.'); return;
      }
      const nombre = assistant.looksLikePhone(args.cliente) ? `+${phone}` : String(args.cliente).trim();
      action = { type: 'cita', newClient: { name: nombre, phone }, date: args.fecha, time: args.hora, reason };
      quien = `${nombre} (nuevo · +${phone})`;
    }
    const token = tgStash(fromId, chatId, crmUser, action);
    await telegram.sendMessage(chatId,
      `📅 Voy a crear una cita con ${quien} el ${fmtDayLoc(args.fecha, 'es')} a las ${args.hora}${reason ? ` · ${reason}` : ''}.\nSe le enviará la confirmación por WhatsApp.\n\n¿Lo confirmas?`,
      { replyMarkup: telegram.confirmKeyboard(token) });
    return;
  }

  if (tool === 'reprogramar_cita') {
    const r = assistant.resolveClient(db, args.cliente, visible);
    if (r.ambiguous) { await telegram.sendMessage(chatId, `Hay varios clientes que coinciden con «${args.cliente}». Dime cuál.`); return; }
    if (r.blocked) { await telegram.sendMessage(chatId, 'Ese contacto pertenece a otro usuario.'); return; }
    if (r.none || r.phone) { await telegram.sendMessage(chatId, `No encuentro al cliente «${args.cliente}».`); return; }
    let citas = db.appointments.filter((a) => a.clientId === r.client.id && a.status !== 'cancelada');
    if (assistant.validDate(args.fecha_actual)) citas = citas.filter((a) => a.date === args.fecha_actual);
    citas = citas.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    if (!citas.length) { await telegram.sendMessage(chatId, `${r.client.name} no tiene citas activas${args.fecha_actual ? ` el ${args.fecha_actual}` : ''}.`); return; }
    if (citas.length > 1) {
      await telegram.sendMessage(chatId, `${r.client.name} tiene varias citas:\n`
        + citas.slice(0, 8).map((a) => `• ${fmtDayLoc(a.date, 'es')} a las ${a.time}`).join('\n')
        + '\nDime la fecha de la que quieres mover.');
      return;
    }
    const cita = citas[0];
    const newDate = assistant.validDate(args.nueva_fecha) ? args.nueva_fecha : cita.date;
    const newTime = assistant.validTime(args.nueva_hora) ? args.nueva_hora : cita.time;
    if (newDate === cita.date && newTime === cita.time) { await telegram.sendMessage(chatId, '¿A qué fecha u hora quieres mover la cita?'); return; }
    const token = tgStash(fromId, chatId, crmUser, { type: 'reprogramar_cita', apptId: cita.id, date: newDate, time: newTime });
    await telegram.sendMessage(chatId,
      `🔄 Voy a mover la cita de ${r.client.name} del ${fmtDayLoc(cita.date, 'es')} (${cita.time}) al ${fmtDayLoc(newDate, 'es')} a las ${newTime}.\nSe le avisará por WhatsApp${cita.msEventId ? ' y se actualizará en Outlook' : ''}.\n\n¿Lo confirmas?`,
      { replyMarkup: telegram.confirmKeyboard(token) });
    return;
  }

  if (tool === 'proximas_citas') {
    const dias = Math.max(1, Math.min(60, Number(args.dias) || 7));
    const today = tgToday();
    const end = new Date(); end.setDate(end.getDate() + dias);
    const endIso = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
    const nameOf = (id) => (db.clients.find((c) => c.id === id) || {}).name || '(cliente)';
    const citas = db.appointments
      .filter((a) => a.status !== 'cancelada' && a.date >= today && a.date <= endIso
        && visible(db.clients.find((c) => c.id === a.clientId)))
      .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    if (!citas.length) { await telegram.sendMessage(chatId, `📅 No tienes citas en los próximos ${dias} días.`); return; }
    const byDay = new Map();
    for (const a of citas) { const l = byDay.get(a.date) || []; l.push(a); byDay.set(a.date, l); }
    const blocks = [...byDay.entries()].map(([d, items]) => `📆 ${fmtDayLoc(d, 'es')}:\n`
      + items.map((a) => `  • ${a.time} — ${nameOf(a.clientId)}${a.reason ? ` (${a.reason})` : ''}`).join('\n'));
    await telegram.sendMessage(chatId, `Próximas citas (${dias} días):\n\n${blocks.join('\n\n')}`);
    return;
  }

  if (tool === 'crear_recordatorio') {
    const texto = String(args.texto || '').trim();
    if (!texto) { await telegram.sendMessage(chatId, '¿Qué quieres que te recuerde?'); return; }
    const fecha = assistant.validDate(args.fecha) ? args.fecha : null;
    const action = { type: 'recordatorio', text: texto, date: fecha };
    const token = tgStash(fromId, chatId, crmUser, action);
    await telegram.sendMessage(chatId, `⏰ Recordatorio: «${texto}»${fecha ? ` para el ${fecha}` : ''}.\n\n¿Lo guardo?`,
      { replyMarkup: telegram.confirmKeyboard(token) });
    return;
  }

  if (tool === 'registrar_cobro') {
    const method = ['efectivo', 'transferencia', 'tarjeta'].includes(args.forma_pago) ? args.forma_pago : '';
    if (!method) { await telegram.sendMessage(chatId, '¿Cómo ha pagado? Efectivo, transferencia o tarjeta.'); return; }
    const r = assistant.resolveClient(db, args.cliente, visible);
    if (r.ambiguous) { await telegram.sendMessage(chatId, `Hay varios clientes que coinciden con «${args.cliente}». Dime cuál.`); return; }
    if (r.blocked) { await telegram.sendMessage(chatId, 'Ese contacto pertenece a otro usuario.'); return; }
    if (r.none || r.phone) { await telegram.sendMessage(chatId, `No encuentro al cliente «${args.cliente}».`); return; }
    const includeTax = Boolean(args.incluir_tasas);
    let feeDueTotal = 0;
    let tasas = 0;
    for (const c of db.cases) {
      if (c.clientId !== r.client.id || !canSeeCase(c, crmUser, db)) continue;
      feeDueTotal += feeDueOf(c);
      if (includeTax && (Number(c.taxAmount) || 0) > 0 && !c.taxPaid) tasas += Number(c.taxAmount) || 0;
    }
    feeDueTotal = money2(feeDueTotal);
    if (!feeDueTotal && !tasas) { await telegram.sendMessage(chatId, `${r.client.name} no tiene importes pendientes.`); return; }
    // Adelanto / pago parcial: solo si el importe indicado es menor que lo debido.
    const askAmount = Number(args.importe) > 0 ? money2(args.importe) : 0;
    const honor = askAmount > 0 ? Math.min(askAmount, feeDueTotal) : feeDueTotal;
    const partial = honor > 0 && honor < feeDueTotal;
    const parts = [];
    if (honor) parts.push(`honorarios ${honor.toLocaleString('es-ES')} €${partial ? ` (adelanto; quedan ${money2(feeDueTotal - honor).toLocaleString('es-ES')} €)` : ''}`);
    if (tasas) parts.push(`tasas ${tasas.toLocaleString('es-ES')} €`);
    const token = tgStash(fromId, chatId, crmUser, { type: 'cobro', clientId: r.client.id, method, includeTax, amount: askAmount || null });
    await telegram.sendMessage(chatId, `💶 Voy a registrar el cobro de ${r.client.name}: ${parts.join(' + ')} (${method}).\n\n¿Lo confirmas?`,
      { replyMarkup: telegram.confirmKeyboard(token) });
    return;
  }

  if (tool === 'cambiar_estado_expediente') {
    const STATES = { pendiente: 'Pendiente', en_curso: 'En curso', esperando_documentacion: 'Esperando documentación', completado: 'Completado' };
    const estado = STATES[args.estado] ? args.estado : '';
    if (!estado) { await telegram.sendMessage(chatId, '¿A qué estado lo cambio? (pendiente, en curso, esperando documentación o completado)'); return; }
    const r = assistant.resolveClient(db, args.cliente, visible);
    if (r.ambiguous) { await telegram.sendMessage(chatId, `Hay varios clientes que coinciden con «${args.cliente}». Dime cuál.`); return; }
    if (r.blocked) { await telegram.sendMessage(chatId, 'Ese contacto pertenece a otro usuario.'); return; }
    if (r.none || r.phone) { await telegram.sendMessage(chatId, `No encuentro al cliente «${args.cliente}».`); return; }
    let cases = db.cases.filter((c) => c.clientId === r.client.id && canSeeCase(c, crmUser, db));
    if (args.expediente) {
      const q = String(args.expediente).toLowerCase();
      const filt = cases.filter((c) => (c.title || '').toLowerCase().includes(q));
      if (filt.length) cases = filt;
    }
    if (!cases.length) { await telegram.sendMessage(chatId, `${r.client.name} no tiene expedientes${args.expediente ? ` que coincidan con «${args.expediente}»` : ''}.`); return; }
    if (cases.length > 1) {
      await telegram.sendMessage(chatId, `${r.client.name} tiene varios expedientes:\n`
        + cases.slice(0, 8).map((c) => `• ${c.title}`).join('\n') + '\nDime cuál (por su título).');
      return;
    }
    const kase = cases[0];
    const token = tgStash(fromId, chatId, crmUser, { type: 'estado', caseId: kase.id, estado });
    await telegram.sendMessage(chatId,
      `📁 Voy a marcar «${kase.title}» de ${r.client.name} como «${STATES[estado]}».${estado !== 'pendiente' ? ' Se avisará al cliente por WhatsApp si procede.' : ''}\n\n¿Lo confirmas?`,
      { replyMarkup: telegram.confirmKeyboard(token) });
    return;
  }

  if (tool === 'crear_cliente') {
    const nombre = String(args.nombre || '').trim();
    if (!nombre) { await telegram.sendMessage(chatId, '¿Cómo se llama el cliente?'); return; }
    if (!assistant.looksLikePhone(args.telefono)) { await telegram.sendMessage(chatId, '¿Cuál es el teléfono del cliente?'); return; }
    const phone = normalizePhone(args.telefono);
    const existing = db.clients.find((c) => c.phone === phone);
    if (existing) {
      await telegram.sendMessage(chatId, visible(existing)
        ? `Ya tienes un cliente con ese teléfono: ${existing.name}.`
        : 'Ya existe un cliente con ese teléfono (pertenece a otro usuario).');
      return;
    }
    const token = tgStash(fromId, chatId, crmUser, { type: 'cliente', name: nombre, phone });
    await telegram.sendMessage(chatId, `👤 Voy a dar de alta a ${nombre} (+${phone}).\n\n¿Lo confirmas?`,
      { replyMarkup: telegram.confirmKeyboard(token) });
    return;
  }

  if (tool === 'resumen_hoy') {
    const today = tgToday();
    const soon = new Date(); soon.setDate(soon.getDate() + 7);
    const soonIso = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`;
    const nameOf = (id) => (db.clients.find((c) => c.id === id) || {}).name || '(cliente)';
    const citas = db.appointments
      .filter((a) => a.date === today && a.status !== 'cancelada' && visible(db.clients.find((c) => c.id === a.clientId)))
      .sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
    const venc = db.cases.filter((c) => c.status !== 'completado' && c.dueDate && c.dueDate <= soonIso
      && visible(db.clients.find((x) => x.id === c.clientId)))
      .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
    const cad = db.cases.filter((c) => c.expiryDate && c.expiryDate <= soonIso
      && visible(db.clients.find((x) => x.id === c.clientId)));
    const sinResp = conversationSummaries(db)
      .filter((c) => c.unread > 0 && visible(db.clients.find((x) => x.id === c.clientId))).length;
    let pend = 0;
    for (const c of db.cases) {
      const cl = db.clients.find((x) => x.id === c.clientId);
      if (!cl || !visible(cl)) continue;
      pend += feeDueOf(c) + ((Number(c.taxAmount) || 0) > 0 && !c.taxPaid ? Number(c.taxAmount) : 0);
    }
    const lines = [`📋 Resumen de hoy (${today}):`, ''];
    if (citas.length) {
      lines.push(`📅 Citas (${citas.length}):`);
      for (const a of citas.slice(0, 12)) lines.push(`  • ${a.time} — ${nameOf(a.clientId)}${a.reason ? ` (${a.reason})` : ''}`);
    } else lines.push('📅 Sin citas hoy.');
    if (venc.length) lines.push('', `⏳ Vencimientos próximos (7 días): ${venc.length}` + venc.slice(0, 6).map((c) => `\n  • ${c.dueDate} — ${c.title} (${nameOf(c.clientId)})`).join(''));
    if (cad.length) lines.push('', `📆 Caducidades próximas: ${cad.length}`);
    lines.push('', sinResp ? `💬 ${sinResp} conversación(es) sin responder.` : '💬 Todo respondido.');
    lines.push(pend > 0 ? `💶 Pendiente de cobro: ${money2(pend).toLocaleString('es-ES')} €.` : '💶 Nada pendiente de cobro.');
    await telegram.sendMessage(chatId, lines.join('\n'));
    return;
  }

  if (tool === 'ver_conversacion') {
    const r = assistant.resolveClient(db, args.cliente, visible);
    if (r.ambiguous) { await telegram.sendMessage(chatId, `Hay varios clientes que coinciden con «${args.cliente}». Dime cuál.`); return; }
    if (r.blocked) { await telegram.sendMessage(chatId, 'Ese contacto pertenece a otro usuario.'); return; }
    if (r.none || r.phone) { await telegram.sendMessage(chatId, `No encuentro al cliente «${args.cliente}».`); return; }
    const msgs = db.messages.filter((m) => m.clientId === r.client.id && (m.direction === 'in' || m.direction === 'out'))
      .sort((a, b) => a.timestamp - b.timestamp).slice(-8);
    if (!msgs.length) { await telegram.sendMessage(chatId, `No hay mensajes de WhatsApp con ${r.client.name} todavía.`); return; }
    const line = (m) => {
      const who = m.direction === 'in' ? r.client.name.split(' ')[0] : 'Tú';
      const body = m.text || (m.media ? `[${m.media.kind || 'adjunto'}]` : '');
      return `• ${who}: ${String(body).slice(0, 200)}`;
    };
    await telegram.sendMessage(chatId, `💬 Últimos mensajes con ${r.client.name}:\n${msgs.map(line).join('\n')}`);
    return;
  }

  if (tool === 'listar_expedientes') {
    const r = assistant.resolveClient(db, args.cliente, visible);
    if (r.ambiguous) { await telegram.sendMessage(chatId, `Hay varios clientes que coinciden con «${args.cliente}». Dime cuál.`); return; }
    if (r.blocked) { await telegram.sendMessage(chatId, 'Ese contacto pertenece a otro usuario.'); return; }
    if (r.none || r.phone) { await telegram.sendMessage(chatId, `No encuentro al cliente «${args.cliente}».`); return; }
    const cases = db.cases.filter((c) => c.clientId === r.client.id && canSeeCase(c, crmUser, db))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (!cases.length) { await telegram.sendMessage(chatId, `${r.client.name} no tiene expedientes.`); return; }
    const STATES = { pendiente: 'Pendiente', en_curso: 'En curso', esperando_documentacion: 'Esperando docs', completado: 'Completado' };
    const lines = cases.slice(0, 12).map((c) => {
      const fee = Number(c.fee) || 0;
      const due = feeDueOf(c);
      const cobro = fee ? (due <= 0 ? ' · cobrado' : (feePaidOf(c) > 0 ? ` · adelanto (quedan ${due.toLocaleString('es-ES')} €)` : ` · pendiente ${fee.toLocaleString('es-ES')} €`)) : '';
      return `• ${c.title} — ${STATES[c.status] || c.status}${cobro}`;
    });
    await telegram.sendMessage(chatId, `📁 Expedientes de ${r.client.name}:\n${lines.join('\n')}`);
    return;
  }

  if (tool === 'crear_expediente') {
    const titulo = String(args.titulo || '').trim();
    if (!titulo) { await telegram.sendMessage(chatId, '¿Qué trámite quieres dar de alta? Dime el título.'); return; }
    const r = assistant.resolveClient(db, args.cliente, visible);
    if (r.ambiguous) { await telegram.sendMessage(chatId, `Hay varios clientes que coinciden con «${args.cliente}». Dime cuál.`); return; }
    if (r.blocked) { await telegram.sendMessage(chatId, 'Ese contacto pertenece a otro usuario.'); return; }
    if (r.none || r.phone) { await telegram.sendMessage(chatId, `No encuentro al cliente «${args.cliente}». Créalo primero.`); return; }
    const TIPOS = ['extranjeria', 'fiscal', 'laboral', 'contabilidad', 'vehiculos', 'otro'];
    const tipo = TIPOS.includes(args.tipo) ? args.tipo : 'otro';
    const fee = Number(args.honorario) > 0 ? money2(args.honorario) : 0;
    const token = tgStash(fromId, chatId, crmUser, { type: 'expediente', clientId: r.client.id, title: titulo, tipo, fee });
    await telegram.sendMessage(chatId,
      `📁 Voy a crear el expediente «${titulo}» para ${r.client.name}${fee ? ` (honorario ${fee.toLocaleString('es-ES')} €)` : ''}.\n\n¿Lo confirmas?`,
      { replyMarkup: telegram.confirmKeyboard(token) });
    return;
  }

  if (tool === 'cancelar_cita') {
    const r = assistant.resolveClient(db, args.cliente, visible);
    if (r.ambiguous) { await telegram.sendMessage(chatId, `Hay varios clientes que coinciden con «${args.cliente}». Dime cuál.`); return; }
    if (r.blocked) { await telegram.sendMessage(chatId, 'Ese contacto pertenece a otro usuario.'); return; }
    if (r.none || r.phone) { await telegram.sendMessage(chatId, `No encuentro al cliente «${args.cliente}».`); return; }
    let citas = db.appointments.filter((a) => a.clientId === r.client.id && a.status !== 'cancelada');
    if (assistant.validDate(args.fecha)) citas = citas.filter((a) => a.date === args.fecha);
    citas = citas.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    if (!citas.length) { await telegram.sendMessage(chatId, `${r.client.name} no tiene citas activas${args.fecha ? ` el ${args.fecha}` : ''}.`); return; }
    if (citas.length > 1) {
      await telegram.sendMessage(chatId, `${r.client.name} tiene varias citas:\n`
        + citas.slice(0, 8).map((a) => `• ${a.date} a las ${a.time}${a.reason ? ` (${a.reason})` : ''}`).join('\n')
        + '\nDime la fecha de la que quieres cancelar.');
      return;
    }
    const cita = citas[0];
    const token = tgStash(fromId, chatId, crmUser, { type: 'cancelar_cita', apptId: cita.id });
    await telegram.sendMessage(chatId, `🗑️ Voy a cancelar la cita de ${r.client.name} del ${cita.date} a las ${cita.time}${cita.msEventId ? ' (también en Outlook)' : ''}.\n\n¿Lo confirmas?`,
      { replyMarkup: telegram.confirmKeyboard(token) });
    return;
  }

  if (tool === 'crear_tarea') {
    const titulo = String(args.titulo || '').trim();
    if (!titulo) { await telegram.sendMessage(chatId, '¿Qué tarea quieres crear?'); return; }
    const fecha = assistant.validDate(args.fecha) ? args.fecha : null;
    const responsable = String(args.responsable || '').trim();
    const token = tgStash(fromId, chatId, crmUser, { type: 'tarea', title: titulo, assignee: responsable, dueDate: fecha });
    await telegram.sendMessage(chatId, `✅ Voy a crear la tarea «${titulo}»${responsable ? ` para ${responsable}` : ''}${fecha ? ` (para el ${fecha})` : ''}.\n\n¿La guardo?`,
      { replyMarkup: telegram.confirmKeyboard(token) });
    return;
  }

  await telegram.sendMessage(chatId, 'No he sabido cómo ayudarte con eso. Escribe /ayuda para ver qué puedo hacer.');
}

async function handleTgCallback(cq) {
  const chatId = cq.message && cq.message.chat && cq.message.chat.id;
  const messageId = cq.message && cq.message.message_id;
  const fromId = String((cq.from && cq.from.id) || '');
  // Solo chats privados (defensa en profundidad, igual que en los mensajes).
  const chatType = cq.message && cq.message.chat && cq.message.chat.type;
  if (chatType && chatType !== 'private') { await telegram.answerCallbackQuery(cq.id).catch(() => null); return; }
  // Autorización también en los botones: sin esto, cualquiera podría pulsar un
  // botón (p. ej. en un grupo) y ejecutar una acción.
  if (!tgAuthorized(fromId)) { await telegram.answerCallbackQuery(cq.id, 'No autorizado').catch(() => null); return; }
  // Límite de ritmo también en la confirmación (simetría con los mensajes).
  if (!security.rateLimit(`tgcb:${fromId}`, Number(process.env.RATE_LIMIT_TG || 60))) {
    await telegram.answerCallbackQuery(cq.id, 'Demasiadas acciones seguidas, espera un momento').catch(() => null); return;
  }
  await telegram.answerCallbackQuery(cq.id).catch(() => null);
  if (!chatId) return;
  const [kind, token] = String(cq.data || '').split(':');
  const pending = token ? tgPending.get(token) : null;
  // La acción solo la puede confirmar quien la creó (no se borra si no coincide,
  // para que su dueño legítimo aún pueda hacerlo).
  if (!pending || pending.fromId !== fromId) {
    await telegram.editMessageText(chatId, messageId, '⏱️ Esta acción ha caducado o no es tuya. Vuelve a pedírmelo.').catch(() => null);
    return;
  }
  tgPending.delete(token);
  if (kind !== 'ok') { await telegram.editMessageText(chatId, messageId, '❌ Cancelado.').catch(() => null); return; }
  try {
    const result = await executeTgAction(pending.crmUser, pending.action);
    await telegram.editMessageText(chatId, messageId, '✅ ' + result).catch(() => null);
  } catch (err) {
    console.error('Asistente Telegram (ejecución):', telegram.redact(err && err.message));
    await telegram.editMessageText(chatId, messageId, '⚠️ No se pudo completar la acción.').catch(() => null);
  }
}

async function executeTgAction(crmUser, action) {
  const db = load();
  if (action.type === 'wa') {
    let client = action.clientId ? db.clients.find((c) => c.id === action.clientId) : null;
    if (!client && action.phone) {
      client = ensureClientForPhone(db, action.phone, action.name);
      if (isolationOn() && !client.owner) { client.owner = crmUser; client.sharedWith = []; }
      save();
    }
    if (!client) throw new Error('no encuentro al cliente');
    if (!canSeeClient(client, crmUser)) throw new Error('no tienes acceso a ese cliente');
    const msg = await sendMessageToClient(db, client, action.message);
    if (msg.status === 'error') throw new Error(msg.error || 'WhatsApp rechazó el envío');
    return `Mensaje enviado a ${client.name}.${msg.status === 'demo' ? ' (Modo demo: no ha salido de verdad.)' : ''}`;
  }
  if (action.type === 'cita') {
    let client = action.clientId ? db.clients.find((c) => c.id === action.clientId) : null;
    // Cliente nuevo: se da de alta al confirmar (con su teléfono).
    if (!client && action.newClient) {
      if (db.clients.some((c) => c.phone === action.newClient.phone)) {
        client = db.clients.find((c) => c.phone === action.newClient.phone);
      } else {
        client = ensureClientForPhone(db, action.newClient.phone, action.newClient.name);
        client.name = action.newClient.name;
        if (isolationOn() && !client.owner) { client.owner = crmUser; client.sharedWith = []; }
        save();
      }
    }
    if (!client) throw new Error('no encuentro al cliente');
    if (!canSeeClient(client, crmUser)) throw new Error('no tienes acceso a ese cliente');
    await createAppointment(db, client, { date: action.date, time: action.time, reason: action.reason });
    return `Cita creada con ${client.name} el ${fmtDayLoc(action.date, 'es')} a las ${action.time}.`;
  }
  if (action.type === 'reprogramar_cita') {
    const appt = db.appointments.find((a) => a.id === action.apptId);
    if (!appt) throw new Error('no encuentro la cita');
    const client = db.clients.find((c) => c.id === appt.clientId);
    if (!canSeeClient(client || {}, crmUser)) throw new Error('no tienes acceso a esa cita');
    appt.date = action.date;
    appt.time = action.time;
    // Se rearma el aviso: se volverá a confirmar y a recordar con la nueva fecha.
    appt.confirmationSentAt = null;
    appt.remindedAt = null;
    save();
    const msCal = auto.getSettings(db).microsoft.calendar;
    if (msgraph.isConfigured() && msCal.enabled && msCal.user && appt.msEventId && client) {
      try { await msgraph.updateCalendarEvent(msCal.user, appt.msEventId, appt, client); }
      catch (err) { console.error('No se pudo mover el evento en Outlook:', err.message); }
    }
    // Avisa al cliente de la nueva fecha (misma lógica que una cita nueva).
    if (client) { await auto.onAppointmentCreated(db, appt, client, autoSender(db)); save(); }
    return `Cita de ${client ? client.name : 'cliente'} movida al ${fmtDayLoc(action.date, 'es')} a las ${action.time}.`;
  }
  if (action.type === 'recordatorio') {
    db.reminders.push({
      id: newId('rem'), clientId: null, text: action.text, dueDate: action.date || null,
      // Con aislamiento, el recordatorio es privado de quien lo crea.
      owner: isolationOn() ? crmUser : null,
      sendToClient: false, sentToClientAt: null, done: false, createdAt: Date.now(),
    });
    save();
    return `Recordatorio guardado${action.date ? ` para el ${action.date}` : ''}.`;
  }
  if (action.type === 'cobro') {
    // Expedientes con honorarios pendientes, del más antiguo al más nuevo (un
    // adelanto se imputa primero a los más viejos), respetando el aislamiento.
    const feeCases = db.cases
      .filter((c) => c.clientId === action.clientId && canSeeCase(c, crmUser, db) && feeDueOf(c) > 0)
      .sort((a, c) => (a.createdAt || 0) - (c.createdAt || 0));
    const totalDue = money2(feeCases.reduce((s, c) => s + feeDueOf(c), 0));
    let remaining = action.amount > 0 ? Math.min(money2(action.amount), totalDue) : totalDue;
    let honor = 0;
    for (const c of feeCases) {
      if (remaining <= 0) break;
      const applied = money2(Math.min(feeDueOf(c), remaining));
      c.paidAmount = money2(feePaidOf(c) + applied);
      c.payMethod = action.method;
      c.paidAt = Date.now();
      c.paid = feeDueOf(c) <= 0;
      c.updatedAt = Date.now();
      honor = money2(honor + applied);
      remaining = money2(remaining - applied);
    }
    let tasas = 0;
    if (action.includeTax) {
      for (const c of db.cases) {
        if (c.clientId !== action.clientId || !canSeeCase(c, crmUser, db)) continue;
        if ((Number(c.taxAmount) || 0) > 0 && !c.taxPaid) { c.taxPaid = true; tasas = money2(tasas + (Number(c.taxAmount) || 0)); c.updatedAt = Date.now(); }
      }
    }
    if (!honor && !tasas) throw new Error('ya no había importes pendientes');
    save();
    const client = db.clients.find((c) => c.id === action.clientId) || {};
    security.audit('cobro_registrado', { clientId: action.clientId, method: action.method, honorarios: honor, tasas, user: crmUser, via: 'telegram' });
    const parts = [];
    if (honor) parts.push(`${honor.toLocaleString('es-ES')} € de honorarios`);
    if (tasas) parts.push(`${tasas.toLocaleString('es-ES')} € de tasas`);
    const left = money2(totalDue - honor);
    return `Cobro registrado a ${client.name || 'cliente'}: ${parts.join(' + ')} (${action.method}).${left > 0 ? ` Quedan ${left.toLocaleString('es-ES')} € pendientes.` : ''}`;
  }
  if (action.type === 'estado') {
    const kase = db.cases.find((c) => c.id === action.caseId);
    if (!kase) throw new Error('no encuentro el expediente');
    if (!canSeeCase(kase, crmUser, db)) throw new Error('no tienes acceso a ese expediente');
    const client = db.clients.find((c) => c.id === kase.clientId);
    const oldStatus = kase.status;
    kase.status = action.estado;
    kase.updatedAt = Date.now();
    save();
    if (kase.status !== oldStatus) { await auto.onCaseStatusChanged(db, kase, client, autoSender(db)); save(); }
    const STATES = { pendiente: 'Pendiente', en_curso: 'En curso', esperando_documentacion: 'Esperando documentación', completado: 'Completado' };
    return `Expediente «${kase.title}» marcado como «${STATES[action.estado]}».`;
  }
  if (action.type === 'cliente') {
    if (db.clients.some((c) => c.phone === action.phone)) throw new Error('ya existe un cliente con ese teléfono');
    const client = ensureClientForPhone(db, action.phone, action.name);
    client.name = action.name;
    if (isolationOn() && !client.owner) { client.owner = crmUser; client.sharedWith = []; }
    save();
    return `Cliente ${client.name} dado de alta.`;
  }
  if (action.type === 'wa_media') {
    let client = action.clientId ? db.clients.find((c) => c.id === action.clientId) : null;
    if (!client && action.phone) {
      client = ensureClientForPhone(db, action.phone, action.name);
      if (isolationOn() && !client.owner) { client.owner = crmUser; client.sharedWith = []; }
      save();
    }
    if (!client) throw new Error('no encuentro al cliente');
    if (!canSeeClient(client, crmUser)) throw new Error('no tienes acceso a ese cliente');
    const buf = await telegram.downloadFile(action.fileId);
    const msg = await sendMediaToClient(db, client, buf, { filename: action.filename, mime: action.mime, caption: action.caption || '' });
    if (msg.status === 'error') throw new Error(msg.error || 'WhatsApp rechazó el envío');
    return `Documento enviado a ${client.name}.${msg.status === 'demo' ? ' (Modo demo: no ha salido de verdad.)' : ''}`;
  }
  if (action.type === 'expediente') {
    const client = db.clients.find((c) => c.id === action.clientId);
    if (!client) throw new Error('no encuentro al cliente');
    if (!canSeeClient(client, crmUser)) throw new Error('no tienes acceso a ese cliente');
    const item = {
      id: newId('exp'), clientId: client.id, title: action.title, type: action.tipo || 'otro',
      status: 'pendiente', dueDate: null, submittedDate: null, registryNumber: '', trackingUrl: '',
      expiryDate: null, docs: '', fee: money2(action.fee), paid: false, paidAmount: 0, paidAt: null,
      payMethod: '', taxModel: '', taxAmount: 0, taxPaid: false, taxPaidAt: null, checklist: [],
      sharedWith: [], notes: '', createdAt: Date.now(), updatedAt: Date.now(),
    };
    db.cases.push(item);
    save();
    return `Expediente «${item.title}» creado para ${client.name}${item.fee ? ` (honorario ${item.fee.toLocaleString('es-ES')} €)` : ''}.`;
  }
  if (action.type === 'cancelar_cita') {
    const appt = db.appointments.find((a) => a.id === action.apptId);
    if (!appt) throw new Error('no encuentro la cita');
    if (!canSeeClient(db.clients.find((c) => c.id === appt.clientId) || {}, crmUser)) throw new Error('no tienes acceso a esa cita');
    appt.status = 'cancelada';
    const msCal = auto.getSettings(db).microsoft.calendar;
    if (msgraph.isConfigured() && msCal.enabled && msCal.user && appt.msEventId) {
      try { await msgraph.deleteCalendarEvent(msCal.user, appt.msEventId); appt.msEventId = null; }
      catch (err) { console.error('No se pudo borrar el evento en Outlook:', err.message); }
    }
    save();
    return `Cita del ${appt.date} a las ${appt.time} cancelada.`;
  }
  if (action.type === 'tarea') {
    db.tasks.push({
      id: newId('task'), title: action.title, assignee: action.assignee || '',
      status: 'por_hacer', dueDate: action.dueDate || null, clientId: null, caseId: null,
      notes: '', createdAt: Date.now(), updatedAt: Date.now(), createdBy: crmUser || 'equipo',
    });
    save();
    return `Tarea «${action.title}» creada${action.assignee ? ` para ${action.assignee}` : ''}${action.dueDate ? ` (para el ${action.dueDate})` : ''}.`;
  }
  throw new Error('acción desconocida');
}

async function telegramLoop() {
  if (!telegram.isConfigured()) return;
  try {
    const updates = await telegram.getUpdates(tgOffset, 50);
    for (const u of updates) {
      tgOffset = u.update_id + 1;
      try { await handleTelegramUpdate(u); } catch (err) { console.error('Asistente Telegram:', telegram.redact(err && err.message)); }
    }
    tgSweep();
  } catch (err) {
    // Error de red o de la API: esperar un poco antes de reintentar.
    await new Promise((r) => setTimeout(r, 3000));
  }
  setImmediate(telegramLoop);
}

// --- Avisos proactivos por Telegram ---------------------------------------
// El bot te avisa sin que tengas que preguntar: WhatsApp nuevo de un cliente
// y un resumen cada mañana. Solo a los usuarios que puedan ver ese cliente.

// Resumen periódico cada N horas (p. ej. 4). '' / 0 / off lo desactiva y se usa
// el resumen diario a hora fija. Sustituye a los avisos por cada WhatsApp.
function tgDigestEveryHours() {
  const v = String(process.env.TELEGRAM_DIGEST_EVERY_HOURS || '').trim().toLowerCase();
  if (v === '' || v === 'off' || v === '0') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ¿Se avisa por cada WhatsApp entrante? Por defecto sí; pero si está activo el
// resumen periódico (cada N horas), los avisos por mensaje se silencian solos
// (el resumen los sustituye), salvo que se ponga TELEGRAM_ALERTS=on a la fuerza.
const TG_ALERTS_ON = () => {
  const v = String(process.env.TELEGRAM_ALERTS || '').toLowerCase().trim();
  if (v === 'off') return false;
  if (v === 'on') return true;
  return !tgDigestEveryHours();
};
const TG_ALERT_DEBOUNCE_MS = Number(process.env.TELEGRAM_ALERT_DEBOUNCE_MIN || 10) * 60 * 1000;

// Hora del resumen diario (0-23). '' u 'off' lo desactiva.
function tgDigestHour() {
  const v = String(process.env.TELEGRAM_DIGEST_HOUR == null ? '8' : process.env.TELEGRAM_DIGEST_HOUR).trim().toLowerCase();
  if (v === '' || v === 'off') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : 8;
}

// Envía un aviso a cada usuario de Telegram cuyo usuario del CRM cumpla el
// filtro (respeta el aislamiento). No lanza: registra los errores.
async function notifyTelegramUsers(canSeeForUser, text) {
  if (!telegram.isConfigured() || !TG_ALLOWED.size) return;
  for (const [tgId, crmUser] of TG_ALLOWED) {
    if (!canSeeForUser(crmUser)) continue;
    try { await telegram.sendMessage(Number(tgId), text); }
    catch (err) { console.error('Aviso Telegram:', telegram.redact(err && err.message)); }
  }
}

// Aviso de SALUD DEL SISTEMA al administrador por Telegram (copia fallida,
// error de disco, arranque tras caída, recuperación de datos…). Antirrebote por
// tipo de aviso para no repetir el mismo problema en bucle. No lanza nunca.
const ownerAlertAt = new Map();
function notifyOwner(text, key = null, cooldownMin = 60) {
  try {
    if (key) {
      const now = Date.now();
      if (now - (ownerAlertAt.get(key) || 0) < cooldownMin * 60 * 1000) return;
      ownerAlertAt.set(key, now);
    }
    if (!telegram.isConfigured() || !TG_ALLOWED.size) { console.error('[SALUD]', text); return; }
    for (const [tgId, crmUser] of TG_ALLOWED) {
      if (!isAdmin(crmUser)) continue;
      telegram.sendMessage(Number(tgId), '🛠️ ' + text).catch(() => null);
    }
  } catch { /* un aviso no debe romper nada */ }
}

// Avisa de los WhatsApp entrantes nuevos, con antirrebote por cliente para no
// mandar un aviso por cada mensaje de una ráfaga.
async function notifyTelegramInbound(db, items) {
  if (!telegram.isConfigured() || !TG_ALLOWED.size || !TG_ALERTS_ON()) return;
  const now = Date.now();
  const seen = new Set();
  let changed = false;
  for (const { client, text } of items) {
    if (!client || seen.has(client.id)) continue;
    seen.add(client.id);
    if (now - (client.tgAlertAt || 0) < TG_ALERT_DEBOUNCE_MS) continue;
    client.tgAlertAt = now;
    changed = true;
    const preview = String(text || '').slice(0, 200) || '📎 (adjunto)';
    await notifyTelegramUsers((u) => canSeeClient(client, u),
      `💬 Nuevo WhatsApp de ${client.name} (+${client.phone}):\n«${preview}»`);
  }
  if (changed) save();
}

// Resumen por Telegram. Dos modos:
//   - Diario (opts.periodic = false): «buenos días» con las citas del día,
//     conversaciones sin responder e importes pendientes.
//   - Periódico (opts.periodic = true): resumen de las últimas N horas con los
//     WhatsApp recibidos en la ventana (agrupados por cliente), las citas que
//     quedan hoy y lo pendiente de cobro. Devuelve null si no hay nada que
//     contar (para no molestar de madrugada).
function buildTelegramDigest(db, crmUser, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const canSee = (c) => canSeeClient(c || {}, crmUser);
  const clientById = (id) => db.clients.find((c) => c.id === id);
  const nameOf = (id) => (clientById(id) || {}).name || '(cliente)';
  const eur = (n) => (Number(n) || 0).toLocaleString('es-ES') + ' €';

  let pendiente = 0;
  for (const c of db.cases) {
    if (!canSee(clientById(c.clientId))) continue;
    if ((Number(c.fee) || 0) > 0 && !c.paid) pendiente += Number(c.fee) || 0;
  }

  if (opts.periodic) {
    const sinceTs = Number(opts.sinceTs || 0);
    const nowHM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    // WhatsApp entrantes en la ventana, agrupados por cliente.
    const counts = new Map();
    for (const m of db.messages) {
      if (m.direction !== 'in' || (m.timestamp || 0) < sinceTs) continue;
      const cl = clientById(m.clientId);
      if (!cl || !canSee(cl)) continue;
      const e = counts.get(cl.id) || { name: cl.name, phone: cl.phone, n: 0, last: '' };
      e.n += 1;
      e.last = String(m.text || '').slice(0, 80) || '📎 (adjunto)';
      counts.set(cl.id, e);
    }
    const convs = [...counts.values()].sort((a, b) => b.n - a.n);
    const totalMsgs = convs.reduce((s, e) => s + e.n, 0);
    // Citas que quedan hoy (de ahora en adelante).
    const citas = db.appointments
      .filter((a) => a.date === today && a.status !== 'cancelada' && String(a.time || '') >= nowHM
        && canSee(clientById(a.clientId)))
      .sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
    if (!convs.length && !citas.length) return null; // nada que contar
    const h = opts.hours ? Math.round(opts.hours) : 4;
    const lines = [`🕐 Resumen (últimas ${h} h):`, ''];
    if (convs.length) {
      lines.push(`💬 ${totalMsgs} WhatsApp de ${convs.length} cliente(s):`);
      for (const e of convs.slice(0, 12)) lines.push(`  • ${e.name}: «${e.last}»${e.n > 1 ? ` (${e.n} mensajes)` : ''}`);
      if (convs.length > 12) lines.push(`  … y ${convs.length - 12} cliente(s) más.`);
    } else {
      lines.push('💬 Sin WhatsApp nuevos en este periodo.');
    }
    if (citas.length) {
      lines.push('', `📅 Citas que quedan hoy: ${citas.length}`);
      for (const a of citas.slice(0, 10)) lines.push(`  • ${a.time} — ${nameOf(a.clientId)}${a.reason ? ` (${a.reason})` : ''}`);
    }
    if (pendiente) lines.push('', `💶 Pendiente de cobro: ${eur(pendiente)}.`);
    return lines.join('\n');
  }

  // Modo diario: «buenos días».
  const citas = db.appointments
    .filter((a) => a.date === today && a.status !== 'cancelada' && canSee(clientById(a.clientId)))
    .sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
  const sinResponder = conversationSummaries(db)
    .filter((c) => c.unread > 0 && canSee(clientById(c.clientId))).length;
  const lines = ['🌅 Buenos días. Resumen de hoy:', ''];
  if (citas.length) {
    lines.push(`📅 ${citas.length} cita(s):`);
    for (const a of citas.slice(0, 10)) lines.push(`  • ${a.time} — ${nameOf(a.clientId)}${a.reason ? ` (${a.reason})` : ''}`);
  } else {
    lines.push('📅 Sin citas para hoy.');
  }
  lines.push(sinResponder ? `💬 ${sinResponder} conversación(es) sin responder.` : '💬 Sin conversaciones pendientes.');
  if (pendiente) lines.push(`💶 Pendiente de cobro: ${eur(pendiente)}.`);
  // Línea de salud del sistema, solo para el administrador.
  if (isAdmin(crmUser)) lines.push('', systemHealthLine());
  return lines.join('\n');
}

// Resumen de salud del sistema para el administrador: última copia y disco.
function systemHealthLine() {
  const parts = [];
  const latest = backup.latestName();
  parts.push(latest ? `última copia ${latest.replace(/^backup-/, '').replace(/\.json\.gz(\.enc)?$/, '')}` : '⚠️ SIN copias');
  try {
    if (typeof fs.statfsSync === 'function') {
      const st = fs.statfsSync(store.DATA_DIR);
      parts.push(`disco libre ${Math.round((st.bavail * st.bsize) / (1024 * 1024))} MB`);
    }
  } catch { /* noop */ }
  return '🩺 ' + parts.join(' · ');
}

async function maybeTelegramDigest(db) {
  if (!telegram.isConfigured() || !TG_ALLOWED.size) return;
  if (!db.settings || typeof db.settings !== 'object') db.settings = {};

  // Modo periódico (cada N horas): sustituye al aviso por cada WhatsApp.
  const everyH = tgDigestEveryHours();
  if (everyH) {
    const nowMs = Date.now();
    const intervalMs = everyH * 3600 * 1000;
    const last = Number(db.settings.tgDigestAt || 0);
    if (last && nowMs - last < intervalMs) return; // aún no toca
    const sinceTs = last || (nowMs - intervalMs); // primera vez: última ventana
    db.settings.tgDigestAt = nowMs; // se marca antes de enviar (no duplicar)
    save();
    for (const [tgId, crmUser] of TG_ALLOWED) {
      const text = buildTelegramDigest(db, crmUser, { periodic: true, sinceTs, hours: everyH, now: nowMs });
      if (!text) continue; // nada que contar para este usuario → no molestar
      try { await telegram.sendMessage(Number(tgId), text); }
      catch (err) { console.error('Resumen Telegram:', telegram.redact(err && err.message)); }
    }
    return;
  }

  // Modo diario (hora fija).
  const hour = tgDigestHour();
  if (hour === null) return;
  const now = new Date();
  if (now.getHours() < hour) return;
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (db.settings.tgDigestDate === today) return; // ya enviado hoy
  db.settings.tgDigestDate = today;
  save();
  for (const [tgId, crmUser] of TG_ALLOWED) {
    try { await telegram.sendMessage(Number(tgId), buildTelegramDigest(db, crmUser, { now: now.getTime() })); }
    catch (err) { console.error('Resumen Telegram:', telegram.redact(err && err.message)); }
  }
}

// --- Resiliencia de datos (arranque y cierre) ----------------------------
// Si el fichero de datos existe pero está corrupto, NO se arranca con base
// vacía (eso lo sobrescribiría todo): se preserva el fichero dañado y se
// restaura la última copia válida antes de continuar.
function recoverDbIfCorrupt() {
  if (!fs.existsSync(DB_FILE)) return; // primer arranque: normal, sin datos
  try { JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); return; } // se lee bien
  catch (err) {
    console.error('⚠️  db.json ilegible/corrupto:', err.message);
    const bad = `${DB_FILE}.corrupt-${Date.now()}`;
    try { fs.renameSync(DB_FILE, bad); } catch { /* noop */ }
    const latest = backup.latestName();
    let msg;
    if (latest) {
      const data = backup.restoreData(latest);
      if (data) {
        try {
          fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
          msg = `Base de datos corrupta: restaurada la última copia (${latest}). El fichero dañado se guardó como ${path.basename(bad)}.`;
        } catch (e) { msg = `Base de datos corrupta y NO se pudo restaurar la copia (${e.message}). Fichero dañado: ${path.basename(bad)}.`; }
      } else {
        msg = `Base de datos corrupta y la última copia (${latest}) no se pudo leer (¿cifrada sin BACKUP_ENCRYPTION_KEY?). Fichero dañado: ${path.basename(bad)}.`;
      }
    } else {
      msg = `Base de datos corrupta y NO hay copias para restaurar. Se arranca en blanco; el fichero dañado se guardó como ${path.basename(bad)}.`;
    }
    console.error('⚠️  ' + msg);
    // El aviso se envía en cuanto arranque (Telegram aún puede no estar listo).
    setTimeout(() => notifyOwner('⚠️ ' + msg, null), 4000);
  }
}
recoverDbIfCorrupt();

// Detección de parada no limpia (caída): se deja un fichero mientras el proceso
// vive y se borra en el cierre ordenado. Si al arrancar sigue ahí, el proceso
// anterior no salió bien.
const RUNNING_MARKER = path.join(store.DATA_DIR, '.running');
try {
  if (fs.existsSync(RUNNING_MARKER)) {
    setTimeout(() => notifyOwner('El servidor arrancó tras una parada no limpia (posible caída). Si se repite, avísame.', 'unclean_boot', 180), 5000);
  }
  fs.mkdirSync(store.DATA_DIR, { recursive: true });
  fs.writeFileSync(RUNNING_MARKER, String(Date.now()));
} catch { /* noop */ }

// Aviso si el disco de datos se queda casi sin espacio (antes de que falle todo).
function checkDiskSpace() {
  try {
    if (typeof fs.statfsSync !== 'function') return;
    const st = fs.statfsSync(store.DATA_DIR);
    const freeRatio = st.bavail / st.blocks;
    const freeMB = Math.round((st.bavail * st.bsize) / (1024 * 1024));
    if (freeRatio < 0.1 || freeMB < 200) {
      notifyOwner(`El disco de datos está casi lleno (quedan ~${freeMB} MB). Libera espacio o amplía el disco en Render.`, 'disk_full', 240);
    }
  } catch { /* noop */ }
}

// Un error al guardar en disco avisa al administrador (no pasa desapercibido).
store.setSaveErrorHandler((err) => notifyOwner(`No se pudo GUARDAR en disco: ${err.message}. Revisa el espacio del disco en Render.`, 'save_error', 30));

// Cierre ordenado: volcar lo pendiente a disco antes de apagarse (Render manda
// SIGTERM en cada redespliegue) para no perder la última acción confirmada.
let shuttingDown = false;
function gracefulExit(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  try { store.flush(); } catch { /* noop */ }
  try { fs.rmSync(RUNNING_MARKER, { force: true }); } catch { /* noop */ }
  process.exit(code);
}
process.on('SIGTERM', () => gracefulExit(0));
process.on('SIGINT', () => gracefulExit(0));
process.on('exit', () => { try { store.flush(); } catch { /* noop */ } });
process.on('uncaughtException', (err) => {
  console.error('Excepción no capturada:', err && err.stack ? err.stack : err);
  notifyOwner(`Error inesperado en el servidor: ${err && err.message}. Se reinicia solo.`, 'uncaught', 15);
  try { store.flush(); } catch { /* noop */ }
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('Promesa rechazada sin capturar:', reason);
});

ensureDefaultFichas(load());
ensureDefaultKnowledge(load());

server.listen(PORT, () => {
  const mode = wa.isConfigured()
    ? `conectado a la API de WhatsApp Business (proveedor: ${wa.provider()})`
    : 'MODO DEMO (sin credenciales de WhatsApp; los envíos no salen de verdad)';
  console.log(`CRM de WhatsApp para gestoría — http://localhost:${PORT}`);
  console.log(`Estado: ${mode}`);
  for (const warning of security.startupWarnings({ authUsers: authUsers() })) {
    console.warn(warning);
  }
  if (authRequired()) {
    console.log(`Seguridad del acceso: CAPTCHA ${captchaEnabled() ? 'activado' : 'desactivado (CRM_CAPTCHA=off)'}`);
  }
  if (process.env.CRM_CAPTCHA_TEST === '1') {
    console.warn('⚠️  CRM_CAPTCHA_TEST=1: el CAPTCHA revela su respuesta. Úsalo SOLO en pruebas, nunca en producción.');
  }
  if (telegram.isConfigured()) {
    if (!TG_ALLOWED.size) {
      console.warn('⚠️  Asistente de Telegram activo pero sin TELEGRAM_ALLOWED: nadie está autorizado. Añade tu ID.');
    } else {
      const iaLabel = assistant.isConfigured()
        ? `, IA: ${assistant.provider() === 'anthropic' ? 'Claude (' + assistant.anthropicModel() + ')' : 'OpenAI (' + assistant.model() + ')'}`
        : ', SIN IA: falta ANTHROPIC_API_KEY u OPENAI_API_KEY';
      console.log(`Asistente de Telegram activo (${TG_ALLOWED.size} usuario(s) autorizado(s)${iaLabel}).`);
      // Avisa si un ID apunta a un usuario del CRM que no existe (con
      // aislamiento, ese usuario no vería ningún cliente).
      if (isolationOn()) {
        const validUsers = new Set(authUsers().keys());
        for (const [tgId, crmUser] of TG_ALLOWED) {
          if (!crmUser) console.warn(`⚠️  TELEGRAM_ALLOWED: el id ${tgId} no tiene usuario del CRM; con aislamiento no verá ningún cliente. Usa «${tgId}:usuario».`);
          else if (!validUsers.has(crmUser)) console.warn(`⚠️  TELEGRAM_ALLOWED: el usuario «${crmUser}» (id ${tgId}) no existe en CRM_USERS.`);
        }
      }
    }
    telegramLoop();
  }
});
