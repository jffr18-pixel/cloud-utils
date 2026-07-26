'use strict';

// CRM de WhatsApp para gestorías — servidor HTTP sin dependencias externas.
// Ejecutar con: node server.js  (Node.js 18 o superior)

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { load, save, newId, normalizePhone, DB_FILE } = require('./lib/store');
const wa = require('./lib/whatsapp');
const auto = require('./lib/automations');
const backup = require('./lib/backup');
const msgraph = require('./lib/msgraph');
const security = require('./lib/security');

const PORT = Number(process.env.PORT || 3000);
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

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
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
    });
  }
  out.sort((a, b) => b.lastTimestamp - a.lastTimestamp);
  return out;
}

async function sendMessageToClient(db, client, text, opts = {}) {
  let sendResult = { demo: true, id: null };
  let status = 'demo';
  let viaTemplate = false;
  try {
    if (opts.media) {
      sendResult = await wa.sendMedia(client.phone, opts.media);
    } else if (opts.interactiveList) {
      // Menú nativo de WhatsApp; siempre responde a un mensaje reciente del
      // cliente, así que la ventana de 24 h está abierta.
      sendResult = await wa.sendInteractiveList(client.phone, opts.interactiveList);
    } else {
      // Automatizaciones fuera de la ventana de 24 h: WhatsApp rechaza el
      // texto libre, así que se usa la plantilla aprobada si está configurada
      // ({{1}} = nombre, {{2}} = texto del aviso).
      const settings = auto.getSettings(db);
      const useTemplate = opts.auto
        && settings.template24h.enabled
        && !auto.isWindowOpen(db, client.id);
      if (useTemplate) {
        viaTemplate = true;
        sendResult = await wa.sendTemplate(client.phone, settings.template24h.name,
          settings.template24h.lang, [(client.name || '').split(' ')[0], text]);
      } else {
        sendResult = await wa.sendText(client.phone, text);
      }
    }
    status = sendResult.demo ? 'demo' : 'sent';
  } catch (err) {
    status = 'error';
    sendResult.error = err.message;
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
    read: true,
  };
  db.messages.push(msg);
  save();
  return msg;
}

// Envío usado por las automatizaciones (marca el mensaje como automático).
function autoSender(db) {
  return (client, text, opts = {}) => sendMessageToClient(db, client, text, { ...opts, auto: true });
}

async function handleWebhookPayload(db, body) {
  const { incoming, echoes, statuses } = wa.parseWebhook(body);
  const freshIncoming = [];
  for (const inMsg of incoming) {
    if (db.messages.some((m) => m.waMessageId && m.waMessageId === inMsg.waMessageId)) continue;
    const phone = normalizePhone(inMsg.from);
    const client = ensureClientForPhone(db, phone, inMsg.name);
    if (!inMsg.historic) freshIncoming.push({ client, text: inMsg.text });
    db.messages.push({
      id: newId('msg'),
      clientId: client.id,
      direction: 'in',
      text: inMsg.text,
      media: inMsg.media || null,
      timestamp: inMsg.timestamp,
      status: 'received',
      waMessageId: inMsg.waMessageId,
      ycloudId: inMsg.ycloudId || null,
      // El historial importado (Coexistence) no debe contar como "sin leer".
      read: Boolean(inMsg.historic),
    });
  }
  // Coexistence: mensajes que la gestoría envió desde la app del móvil.
  // Se registran como salientes para que la conversación se vea completa.
  for (const echo of echoes) {
    if (db.messages.some((m) => m.waMessageId && m.waMessageId === echo.waMessageId)) continue;
    const phone = normalizePhone(echo.to);
    const client = ensureClientForPhone(db, phone, '');
    db.messages.push({
      id: newId('msg'),
      clientId: client.id,
      direction: 'out',
      text: echo.text,
      media: echo.media || null,
      timestamp: echo.timestamp,
      status: 'sent',
      viaApp: true,
      waMessageId: echo.waMessageId,
      read: true,
    });
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
  if (incoming.length || echoes.length || statuses.length) save();

  // Automatizaciones sobre los mensajes recién llegados. Primero se atienden
  // las selecciones del menú de áreas (precios); si no lo es, el mensaje de
  // servicios (máx. una vez cada N horas por cliente) y la respuesta fuera
  // de horario.
  const alreadyGreeted = new Set();
  for (const item of freshIncoming) {
    const wasMenuReply = await auto.maybeMenuReply(db, item.client, item.text, autoSender(db));
    if (wasMenuReply || alreadyGreeted.has(item.client.id)) continue;
    alreadyGreeted.add(item.client.id);
    await auto.maybeWelcome(db, item.client, autoSender(db));
    await auto.maybeAutoReply(db, item.client, autoSender(db));
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
  if (req.method === 'POST' && resource === 'login') {
    const ip = ipOf(req);
    if (tooManyAttempts(ip)) {
      return json(res, 429, { error: 'Demasiados intentos. Espera 15 minutos.' });
    }
    const b = await readBody(req);
    if (!authRequired()) return json(res, 200, { ok: true });
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

  // --- Descarga de adjuntos ------------------------------------------------
  if (req.method === 'GET' && resource === 'media' && id) {
    const msg = db.messages.find((m) => m.id === id);
    if (!msg || !msg.media) return json(res, 404, { error: 'Adjunto no encontrado' });
    const media = msg.media;
    const filename = media.filename || `adjunto.${(media.mime || '').split('/')[1] || 'bin'}`;
    // Los tipos que pueden ejecutar código (SVG, HTML…) se sirven como
    // descarga y con CSP sandbox, para que un adjunto malicioso enviado por
    // WhatsApp no pueda ejecutar nada en el origen del CRM.
    const { disposition, extraHeaders } = security.mediaDisposition(media.mime, filename);
    if (media.localPath) {
      const full = path.join(UPLOADS_DIR, path.basename(media.localPath));
      if (!fs.existsSync(full)) return json(res, 404, { error: 'Fichero no disponible' });
      res.writeHead(200, {
        'Content-Type': media.mime || 'application/octet-stream',
        'Content-Disposition': disposition,
        ...extraHeaders,
      });
      return fs.createReadStream(full).pipe(res);
    }
    try {
      const upstream = await wa.fetchInboundMedia(media);
      if (!upstream.ok) return json(res, 502, { error: `El proveedor devolvió HTTP ${upstream.status}` });
      res.writeHead(200, {
        'Content-Type': media.mime || upstream.headers.get('content-type') || 'application/octet-stream',
        'Content-Disposition': disposition,
        ...extraHeaders,
      });
      const buf = Buffer.from(await upstream.arrayBuffer());
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

  if (req.method === 'GET' && resource === 'dashboard') {
    const now = Date.now();
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    const openCases = db.cases.filter((c) => c.status !== 'completado');
    return json(res, 200, {
      totalClients: db.clients.length,
      unreadMessages: db.messages.filter((m) => m.direction === 'in' && !m.read).length,
      openCases: openCases.length,
      casesAwaitingDocs: openCases.filter((c) => c.status === 'esperando_documentacion').length,
      overdueCases: openCases.filter((c) => c.dueDate && new Date(c.dueDate).getTime() < now).length,
      remindersToday: db.reminders.filter((r) => !r.done && r.dueDate
        && new Date(r.dueDate).getTime() <= endOfToday.getTime()).length,
      recentConversations: conversationSummaries(db).slice(0, 5),
    });
  }

  // --- Clientes -----------------------------------------------------------
  if (resource === 'clients') {
    if (req.method === 'GET' && !id) {
      const q = (url.searchParams.get('q') || '').toLowerCase();
      let list = db.clients;
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
        createdAt: Date.now(),
      };
      db.clients.push(client);
      save();
      return json(res, 201, client);
    }
    const client = db.clients.find((c) => c.id === id);
    if (!client) return json(res, 404, { error: 'Cliente no encontrado' });
    // Enlace privado de «Estado del trámite» para compartir con el cliente.
    if (req.method === 'POST' && parts[3] === 'estado-link') {
      if (!client.statusToken) { client.statusToken = crypto.randomBytes(20).toString('hex'); save(); }
      const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
        || (req.socket && req.socket.encrypted ? 'https' : 'http');
      const host = req.headers.host || `localhost:${PORT}`;
      return json(res, 200, { token: client.statusToken, url: `${proto}://${host}/estado/${client.statusToken}` });
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
      save();
      return json(res, 200, client);
    }
    if (req.method === 'DELETE') {
      db.clients = db.clients.filter((c) => c.id !== id);
      db.messages = db.messages.filter((m) => m.clientId !== id);
      db.cases = db.cases.filter((c) => c.clientId !== id);
      db.reminders = db.reminders.filter((r) => r.clientId !== id);
      db.appointments = db.appointments.filter((a) => a.clientId !== id);
      save();
      return json(res, 200, { ok: true });
    }
  }

  // --- Conversaciones y mensajes ------------------------------------------
  if (req.method === 'GET' && resource === 'conversations') {
    return json(res, 200, conversationSummaries(db));
  }

  if (resource === 'messages') {
    if (req.method === 'GET') {
      const clientId = url.searchParams.get('clientId');
      if (!clientId) return json(res, 400, { error: 'Falta clientId' });
      const msgs = db.messages
        .filter((m) => m.clientId === clientId)
        .sort((a, b) => a.timestamp - b.timestamp);
      return json(res, 200, msgs);
    }
    if (req.method === 'POST' && id === 'read') {
      const b = await readBody(req);
      const toMark = db.messages.filter((m) => m.clientId === b.clientId && m.direction === 'in' && !m.read);
      for (const m of toMark) {
        m.read = true;
        wa.markAsRead({ waMessageId: m.waMessageId, ycloudId: m.ycloudId });
      }
      if (toMark.length) save();
      return json(res, 200, { marked: toMark.length });
    }
    // Vincular un adjunto a un expediente (y subirlo a SharePoint si procede).
    if (req.method === 'PUT' && id) {
      const b = await readBody(req);
      const msg = db.messages.find((m) => m.id === id);
      if (!msg) return json(res, 404, { error: 'Mensaje no encontrado' });
      if (b.caseId !== undefined) {
        if (b.caseId && !db.cases.some((c) => c.id === b.caseId)) {
          return json(res, 404, { error: 'Expediente no encontrado' });
        }
        msg.caseId = b.caseId || null;
        const msSp = auto.getSettings(db).microsoft.sharepoint;
        if (msg.caseId && msg.media && !msg.sharepointUrl && msgraph.isConfigured() && msSp.enabled) {
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
          } catch (err) {
            msg.sharepointError = err.message;
            console.error('No se pudo subir a SharePoint:', err.message);
          }
        }
      }
      save();
      return json(res, 200, msg);
    }
    if (req.method === 'POST') {
      // Hasta ~25 MB para permitir adjuntos en base64 (límite WhatsApp: 16 MB).
      const b = await readBody(req, 25_000_000);
      const client = db.clients.find((c) => c.id === b.clientId);
      if (!client) return json(res, 404, { error: 'Cliente no encontrado' });

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
      const msg = await sendMessageToClient(db, client, String(b.text).trim());
      return json(res, 201, msg);
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
    const wasMenuReply = await auto.maybeMenuReply(db, client, b.text || '', autoSender(db));
    if (!wasMenuReply) {
      await auto.maybeWelcome(db, client, autoSender(db));
      await auto.maybeAutoReply(db, client, autoSender(db));
    }
    return json(res, 201, { ok: true, clientId: client.id });
  }

  // --- Expedientes / trámites ---------------------------------------------
  if (resource === 'cases') {
    // Documentos vinculados a un expediente.
    if (req.method === 'GET' && id && parts[3] === 'files') {
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
      let list = db.cases;
      if (clientId) list = list.filter((c) => c.clientId === clientId);
      return json(res, 200, list);
    }
    if (req.method === 'POST' && !id) {
      const b = await readBody(req);
      if (!b.clientId || !b.title) return json(res, 400, { error: 'Cliente y título son obligatorios' });
      const item = {
        id: newId('exp'),
        clientId: b.clientId,
        title: String(b.title).trim(),
        type: b.type || 'otro', // fiscal | laboral | contabilidad | extranjeria | vehiculos | otro
        status: b.status || 'pendiente', // pendiente | en_curso | esperando_documentacion | completado
        dueDate: b.dueDate || null,
        docs: b.docs || '', // documentación necesaria (para la automatización)
        fee: Number(b.fee) || 0, // honorario del trámite (€)
        paid: Boolean(b.paid), // cobrado o pendiente
        // Checklist de documentación recibida: [{ item, done }]
        checklist: Array.isArray(b.checklist)
          ? b.checklist.map((c) => ({ item: String(c.item || '').trim(), done: Boolean(c.done) })).filter((c) => c.item)
          : [],
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
    if (req.method === 'PUT') {
      const b = await readBody(req);
      const oldStatus = item.status;
      for (const key of ['title', 'type', 'status', 'dueDate', 'docs', 'notes']) {
        if (b[key] !== undefined) item[key] = b[key];
      }
      if (b.fee !== undefined) item.fee = Number(b.fee) || 0;
      if (b.paid !== undefined) item.paid = Boolean(b.paid);
      if (Array.isArray(b.checklist)) {
        item.checklist = b.checklist
          .map((c) => ({ item: String(c.item || '').trim(), done: Boolean(c.done) }))
          .filter((c) => c.item);
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

  // --- Citas ----------------------------------------------------------------
  if (resource === 'appointments') {
    if (req.method === 'GET' && !id) {
      const clientId = url.searchParams.get('clientId');
      let list = db.appointments;
      if (clientId) list = list.filter((a) => a.clientId === clientId);
      list = list.slice().sort((a, b) =>
        `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
      return json(res, 200, list);
    }
    if (req.method === 'POST' && !id) {
      const b = await readBody(req);
      const client = db.clients.find((c) => c.id === b.clientId);
      if (!client) return json(res, 404, { error: 'Cliente no encontrado' });
      if (!b.date || !b.time) return json(res, 400, { error: 'Fecha y hora son obligatorias' });
      const appt = {
        id: newId('cit'),
        clientId: client.id,
        date: b.date,      // YYYY-MM-DD
        time: b.time,      // HH:MM
        reason: (b.reason || '').trim(),
        notes: b.notes || '',
        status: 'activa',  // activa | cancelada | completada
        confirmationSentAt: null,
        remindedAt: null,
        createdAt: Date.now(),
      };
      db.appointments.push(appt);
      save();
      await auto.onAppointmentCreated(db, appt, client, autoSender(db));
      // Sincronización con el calendario de Outlook (si está activada).
      const msCal = auto.getSettings(db).microsoft.calendar;
      if (msgraph.isConfigured() && msCal.enabled && msCal.user) {
        try {
          appt.msEventId = await msgraph.createCalendarEvent(msCal.user, appt, client);
        } catch (err) {
          console.error('No se pudo crear el evento en Outlook:', err.message);
        }
      }
      save();
      return json(res, 201, appt);
    }
    const appt = db.appointments.find((a) => a.id === id);
    if (!appt) return json(res, 404, { error: 'Cita no encontrada' });
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

    const cases = db.cases.filter((c) => c.createdAt >= fromTs && c.createdAt <= toTs);
    const byArea = {};
    const byStatus = {};
    const bySegment = {};
    const byMonth = {};
    const incomeByArea = {}; // { area: { facturado, cobrado } }
    let facturado = 0;
    let cobrado = 0;
    for (const c of cases) {
      byArea[c.type] = (byArea[c.type] || 0) + 1;
      byStatus[c.status] = (byStatus[c.status] || 0) + 1;
      bySegment[segOf(c.clientId)] = (bySegment[segOf(c.clientId)] || 0) + 1;
      const d = new Date(c.createdAt);
      const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      byMonth[m] = (byMonth[m] || 0) + 1;
      const fee = Number(c.fee) || 0;
      facturado += fee;
      if (c.paid) cobrado += fee;
      incomeByArea[c.type] = incomeByArea[c.type] || { facturado: 0, cobrado: 0 };
      incomeByArea[c.type].facturado += fee;
      if (c.paid) incomeByArea[c.type].cobrado += fee;
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
      pendiente: facturado - cobrado,
      incomeByArea,
      byTitle: Object.values(byTitle).sort((a, b) => b.count - a.count),
    });
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
    const byDay = Object.fromEntries(days.map((d) => [d, { in: 0, out: 0 }]));
    for (const m of db.messages) {
      if (m.direction !== 'in' && m.direction !== 'out') continue;
      const k = dayKey(m.timestamp);
      if (byDay[k]) byDay[k][m.direction] += 1;
    }

    const casesByStatus = {};
    const casesByType = {};
    for (const c of db.cases) {
      casesByStatus[c.status] = (casesByStatus[c.status] || 0) + 1;
      casesByType[c.type] = (casesByType[c.type] || 0) + 1;
    }

    // Tiempo medio de primera respuesta (transición entrante→saliente, 30 días).
    const cutoff = now.getTime() - 30 * DAY;
    const byClient = new Map();
    for (const m of db.messages) {
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
      messagesThisWeek: db.messages.filter((m) =>
        (m.direction === 'in' || m.direction === 'out') && m.timestamp >= weekAgo).length,
    });
  }

  // --- Copias de seguridad --------------------------------------------------
  if (resource === 'backups') {
    if (req.method === 'GET' && !id) return json(res, 200, backup.list());
    if (req.method === 'POST' && !id) {
      const b = backup.create(true);
      security.audit('backup_creada', { user: sessionUser(req), ip: ipOf(req), name: b.name });
      return json(res, 201, b);
    }
    if (req.method === 'GET' && id) {
      const stream = backup.read(id);
      if (!stream) return json(res, 404, { error: 'Copia no encontrada' });
      security.audit('backup_descargada', { user: sessionUser(req), ip: ipOf(req), name: id });
      res.writeHead(200, {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename="${id}"`,
      });
      return stream.pipe(res);
    }
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

  // --- Exportación CSV ------------------------------------------------------
  if (req.method === 'GET' && resource === 'export' && id) {
    const csvCell = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
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
        db.clients.map((c) => [c.name, '+' + c.phone, c.nif, c.email,
          (c.tags || []).join(', '), c.notes, fmtDate(c.createdAt)]),
      );
    }
    if (id === 'cases.csv') {
      name = 'expedientes';
      const clientName = (cid) => db.clients.find((c) => c.id === cid)?.name || '';
      const STATUS = { pendiente: 'Pendiente', en_curso: 'En curso', esperando_documentacion: 'Esperando documentación', completado: 'Completado' };
      csv = toCsv(
        ['Cliente', 'Título', 'Tipo', 'Estado', 'Fecha límite', 'Documentación', 'Notas', 'Creado'],
        db.cases.map((c) => [clientName(c.clientId), c.title, c.type,
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
      const inRange = db.cases.filter((c) => c.createdAt >= fromTs && c.createdAt <= toTs);
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
      const recipients = db.clients.filter((c) => (c.tags || []).includes(tag));
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
      return json(res, 200, db.reminders.slice().sort((a, b) =>
        String(a.dueDate || '').localeCompare(String(b.dueDate || ''))));
    }
    if (req.method === 'POST' && !id) {
      const b = await readBody(req);
      if (!b.text) return json(res, 400, { error: 'El texto es obligatorio' });
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

const PUBLIC_STATUS_LABEL = {
  pendiente: 'Pendiente de iniciar',
  en_curso: 'En curso',
  esperando_documentacion: 'Esperando documentación',
  completado: 'Completado',
};
const PUBLIC_TYPE_LABEL = {
  extranjeria: 'Extranjería', vehiculos: 'Tráfico / Vehículos', fiscal: 'Fiscal / Impuestos',
  laboral: 'Laboral / Nóminas', contabilidad: 'Contabilidad', pensiones: 'Pensiones / Prestaciones',
  social: 'Servicios sociales', otro: 'Otros trámites',
};

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtDateEs(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });
}

function statusPageShell(title, bodyHtml) {
  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700;800&display=swap" rel="stylesheet">
<style>
  :root { --charcoal:#1d1a22; --cream:#f4f2ec; --lilac:#9c86c9; --lilac-dark:#5e35b1; --muted:#6f6a78; --ok:#1d7a34; --danger:#c0392b; --font-brand:"Baloo 2",-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; background:var(--cream); color:var(--charcoal); line-height:1.5; }
  .wrap { max-width:640px; margin:0 auto; padding:24px 18px 60px; }
  header { text-align:center; padding:30px 0 18px; }
  .logo { display:inline-flex; align-items:center; gap:13px; }
  .logo-mark { width:52px; height:52px; flex:none; }
  .logo-word { text-align:left; font-family:var(--font-brand); line-height:.92; }
  .logo-word b { display:block; font-weight:800; font-size:27px; letter-spacing:.2px; color:var(--charcoal); }
  .logo-word span { display:block; font-weight:600; font-size:16px; letter-spacing:5px; color:var(--lilac-dark); text-transform:uppercase; margin-top:1px; }
  .sub { color:var(--muted); font-size:14px; margin-top:14px; }
  h1 { font-size:19px; margin:22px 0 4px; }
  .lead { color:var(--muted); font-size:14px; margin:0 0 18px; }
  .case { background:#fff; border:1px solid #e6e3db; border-radius:14px; padding:16px 16px 14px; margin-bottom:14px; box-shadow:0 1px 2px rgba(0,0,0,.03); }
  .case-top { display:flex; justify-content:space-between; gap:10px; align-items:flex-start; }
  .case-title { font-weight:700; font-size:16px; }
  .area { display:inline-block; background:#efeaf8; color:var(--lilac-dark); border-radius:6px; padding:1px 8px; font-size:12px; font-weight:600; margin-top:4px; }
  .st { border-radius:999px; padding:3px 11px; font-size:12.5px; font-weight:700; white-space:nowrap; }
  .st.pendiente { background:#fdecea; color:var(--danger); }
  .st.en_curso { background:#eef2fb; color:#3f5bd6; }
  .st.esperando_documentacion { background:#fdf2e3; color:#a8690a; }
  .st.completado { background:#e4f5e8; color:var(--ok); }
  .due { color:var(--muted); font-size:13px; margin-top:10px; }
  .due.over { color:var(--danger); font-weight:700; }
  .chk { margin-top:12px; border-top:1px dashed #e6e3db; padding-top:10px; }
  .chk-h { font-size:12.5px; color:var(--muted); font-weight:600; margin-bottom:6px; }
  .chk ul { list-style:none; margin:0; padding:0; }
  .chk li { font-size:14px; padding:2px 0; display:flex; gap:8px; align-items:baseline; }
  .chk li.done { color:var(--muted); }
  .mark { font-weight:700; }
  .mark.y { color:var(--ok); } .mark.n { color:var(--lilac-dark); }
  .empty { background:#fff; border:1px solid #e6e3db; border-radius:14px; padding:26px; text-align:center; color:var(--muted); }
  footer { text-align:center; color:var(--muted); font-size:12.5px; margin-top:26px; }
  .bar { height:6px; background:#efeaf8; border-radius:99px; overflow:hidden; margin-top:10px; }
  .bar > i { display:block; height:100%; background:var(--lilac); }
</style>
</head><body><div class="wrap">
<header>
  <div class="logo">
    <svg class="logo-mark" viewBox="0 0 52 52" role="img" aria-label="Burocracia Zero">
      <defs>
        <linearGradient id="bz" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#9c86c9"/><stop offset="1" stop-color="#5e35b1"/>
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="50" height="50" rx="14" fill="url(#bz)"/>
      <path d="M19 15h11l7 7v15a2 2 0 0 1-2 2H19a2 2 0 0 1-2-2V17a2 2 0 0 1 2-2Z" fill="#fff" opacity="0.96"/>
      <path d="M30 15v7h7" fill="none" stroke="#efeaf8" stroke-width="1.6" stroke-linejoin="round"/>
      <path d="M21.5 30.5l2.4 2.4 4.6-4.9" fill="none" stroke="#5e35b1" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <div class="logo-word"><b>Burocracia</b><span>Zero</span></div>
  </div>
  <div class="sub">Seguimiento de tus trámites</div>
</header>
${bodyHtml}
<footer>Esta página es privada y solo para ti. Para cualquier duda, escríbenos por WhatsApp.</footer>
</div></body></html>`;
}

function renderStatusPage(db, client) {
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
    const chkHtml = chk.length ? `
      <div class="chk">
        <div class="chk-h">Documentación (${done}/${chk.length})</div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <ul>${chk.map((x) => `<li class="${x.done ? 'done' : ''}"><span class="mark ${x.done ? 'y' : 'n'}">${x.done ? '✓' : '•'}</span> ${escHtml(x.item)}</li>`).join('')}</ul>
      </div>` : '';
    return `
    <div class="case">
      <div class="case-top">
        <div>
          <div class="case-title">${escHtml(c.title)}</div>
          <div class="area">${escHtml(PUBLIC_TYPE_LABEL[c.type] || c.type)}</div>
        </div>
        <span class="st ${escHtml(c.status)}">${escHtml(PUBLIC_STATUS_LABEL[c.status] || c.status)}</span>
      </div>
      ${c.dueDate ? `<div class="due ${overdue ? 'over' : ''}">📅 Fecha límite: ${fmtDateEs(c.dueDate)}${overdue ? ' · pendiente' : ''}</div>` : ''}
      ${chkHtml}
    </div>`;
  }).join('') : '<div class="empty">Todavía no hay trámites registrados a tu nombre.</div>';
  const greeting = `<h1>Hola, ${escHtml((client.name || '').split(' ')[0] || client.name)} 👋</h1>
    <p class="lead">Aquí puedes ver el estado de tus trámites en tiempo real.</p>`;
  return statusPageShell(`Estado de tus trámites · ${client.name}`, greeting + body);
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
      const token = url.pathname.slice('/estado/'.length).split('/')[0];
      const db = load();
      const client = token && token.length >= 16 ? db.clients.find((c) => c.statusToken === token) : null;
      if (!client) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(statusPageShell('Enlace no válido',
          '<div class="empty">Este enlace no es válido o ha caducado. Contáctanos por WhatsApp para obtener uno nuevo.</div>'));
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(renderStatusPage(db, client));
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
  try {
    const created = backup.ensureDaily();
    if (created) console.log(`Copia de seguridad diaria creada: ${created.name}`);
  } catch (err) {
    console.error('Error al crear la copia de seguridad:', err.message);
  }
}, 5 * 60 * 1000);

ensureDefaultFichas(load());

server.listen(PORT, () => {
  const mode = wa.isConfigured()
    ? `conectado a la API de WhatsApp Business (proveedor: ${wa.provider()})`
    : 'MODO DEMO (sin credenciales de WhatsApp; los envíos no salen de verdad)';
  console.log(`CRM de WhatsApp para gestoría — http://localhost:${PORT}`);
  console.log(`Estado: ${mode}`);
  for (const warning of security.startupWarnings({ authUsers: authUsers() })) {
    console.warn(warning);
  }
});
