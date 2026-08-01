'use strict';

// Automatizaciones del CRM:
//  1. Respuesta automática fuera de horario
//  2. Aviso al cliente al cambiar el estado de un expediente
//  3. Petición y reclamo de documentación
//  4. Envío de recordatorios al cliente por WhatsApp
//
// La configuración vive en db.settings.automations y se edita desde la
// pestaña «Automatizaciones» de la interfaz.

const DEFAULTS = {
  // Datos de la gestoría, para la cabecera (membrete) de recibos y documentos.
  // Editables desde Automatizaciones → «Datos de la gestoría».
  empresa: {
    nombre: 'Burocracia Zero SLP',
    cif: 'B56918402',
    direccion: 'Calle Río Alberche nº 38, local 32 · 45007 Toledo',
    ciudad: 'Toledo',
    telefono: '674573447',
    email: 'jose@burocraciazero.es',
    web: 'www.burocraciazero.es',
    colegiado: '0146',
  },
  businessHours: {
    // 0 = domingo … 6 = sábado (hora local del servidor)
    days: [1, 2, 3, 4, 5],
    open: '09:00',
    close: '18:00',
  },
  afterHours: {
    enabled: false,
    message: 'Hola {nombre} 👋 Gracias por tu mensaje. Nuestro horario de atención es de lunes a viernes de 9:00 a 18:00. Te responderemos en cuanto abramos. Si es urgente, indícanoslo y lo priorizaremos.',
    // No repetir la respuesta automática al mismo cliente durante estas horas.
    cooldownHours: 12,
  },
  // Vacaciones / cierre temporal: entre las fechas «from» y «to» (incluidas),
  // a quien escriba se le responde con este aviso (y solo con este: no se le
  // envía el menú, la bienvenida ni la respuesta fuera de horario). {desde} y
  // {hasta} se sustituyen por las fechas en formato largo.
  holiday: {
    enabled: false,
    from: '2026-08-01',
    to: '2026-08-17',
    message: 'Hola {nombre} 👋 Gracias por tu mensaje. La gestoría permanece cerrada por vacaciones del {desde} al {hasta}. Te atenderemos a la vuelta lo antes posible. Si es urgente, déjanoslo dicho por aquí y lo priorizamos a nuestro regreso. ¡Gracias por tu paciencia! — Burocracia Zero',
  },
  // Mensaje de servicios: se envía a CUALQUIER cliente que escriba (nuevo o
  // ya existente), como máximo una vez cada N horas por cliente. Si se
  // definen áreas, se envía como menú interactivo de WhatsApp y, al elegir
  // un área, el cliente recibe sus precios.
  welcome: {
    enabled: false,
    // Textos transcritos del flujo «Bienvenida» de YCloud de Burocracia Zero.
    text: '¡Hola! 👋 Soy el asistente de Burocracia Zero, tu gestoría online. Dime qué necesitas y te doy precio y documentos al momento.',
    frequencyHours: 24,
    areasText: [
      '=== Extranjería',
      'Extranjería 📋 Honorarios de gestión (las tasas oficiales son orientativas y se confirman al hablar con José):',
      '',
      '- Arraigo social o sociolaboral: 300 €',
      '- Arraigo familiar: 300 €',
      '- Pasar de razones humanitarias a residencia y trabajo: 350 €',
      '- Residencia de 4 años o larga duración: 350 €',
      '- Nacionalidad española: 400 €',
      '- Reagrupación familiar: 375 €',
      '',
      'A los honorarios se añaden las tasas oficiales correspondientes a cada trámite, que José te confirma según tu caso.',
      '',
      'Para tu presupuesto y la lista de documentos, dime tu nombre, nacionalidad y el trámite que necesitas. 📲',
      '',
      '=== Vehículos y tráfico',
      'Vehículos y tráfico 🚗 Honorarios de gestión (tasas DGT e impuestos orientativos, se confirman al hablar con José):',
      '',
      '- Cambio de titular (transferencia): 70 €',
      '- Matriculación / importación: desde 150 €',
      '- Canje de permiso de conducir extranjero: 150 € todo incluido',
      '- Baja de vehículo: 40 €',
      '- Multas y recursos: 55 €',
      '',
      'Calculamos el ITP exacto de tu comunidad sin compromiso.',
      '',
      'Para darte el total con tasas incluidas, dime marca, modelo y año del vehículo, y tu comunidad autónoma. José te responde en menos de 1 hora (L-V 8:00-18:00). 📲',
      '',
      '=== Autónomos e impuestos',
      'Autónomos e impuestos 📊 Nuestros honorarios (trabajamos solo con autónomos, no con sociedades):',
      '',
      '- Alta de autónomo (036 + RETA): 60 €',
      '- Gestoría mensual (fiscal + contable): desde 100 €/mes',
      '- Declaración de la Renta: desde 70 €',
      '- Modelo suelto (IVA, IRPF...): desde 25 €',
      '',
      'Cuéntame tu caso: qué actividad ejerces (o vas a ejercer) y si ya facturas o empiezas de cero. José te responde en menos de 1 hora (L-V 8:00-18:00). 📲',
      '',
      '=== Pensiones y prestaciones',
      'Pensiones y prestaciones 🧓 Honorarios de gestión (IVA incluido):',
      '',
      '- Pensión de jubilación: 250 €',
      '- Incapacidad permanente: 300 €',
      '- Pensión de viudedad: 150 € / orfandad: 130 €',
      '- Paro o subsidio (SEPE): desde 50 €',
      '- Ingreso Mínimo Vital: 90 €',
      '- Dependencia o discapacidad: 150 €',
      '- Pensiones de convenios bilaterales: desde 600 € (con estudio previo de viabilidad)',
      '',
      '💡 ¿No sabes a qué tienes derecho? Hacemos un estudio completo de todas tus ayudas por 121 €.',
      '',
      '=== Otro trámite',
      'Otro trámite 📋 ¡Sin problema! Gestionamos más de 160 trámites: herencias, vivienda e ITP, ayudas de la Junta, homologación de títulos, empresas, certificado digital y mucho más.',
      '',
      'Cuéntame en un mensaje qué necesitas y José te responde con precio cerrado en menos de 1 hora (L-V 8:00-18:00). Toda España, 100% online. 📲',
      '',
      '=== Ya soy cliente',
      '¡Gracias por avisar! 🙌 Soy el asistente automático, pero José ya tiene tu mensaje. Te responde personalmente en cuanto se desocupe (normalmente en 1-2 horas, en horario L-V de 8:00 a 18:00).',
      '',
      'Si es urgente, escríbelo aquí y lo verá al abrir el chat. 📲',
    ].join('\n'),
  },
  statusNotify: {
    enabled: false,
    onEnCurso: false,
    enCursoText: 'Hola {nombre}, te confirmamos que ya estamos trabajando en tu trámite «{tramite}». Te avisaremos en cuanto haya novedades.',
    onCompletado: true,
    completadoText: 'Hola {nombre}, buenas noticias 🎉 Tu trámite «{tramite}» ya está completado. Si necesitas el justificante o tienes cualquier duda, escríbenos por aquí.',
  },
  docs: {
    enabled: false,
    requestText: 'Hola {nombre}, para continuar con tu trámite «{tramite}» necesitamos la siguiente documentación:\n{documentos}\nPuedes enviárnosla por aquí mismo. ¡Gracias!',
    followUpDays: 3,
    followUpText: 'Hola {nombre}, seguimos pendientes de la documentación de tu trámite «{tramite}»:\n{documentos}\nEn cuanto la recibamos continuamos con todo. ¡Gracias!',
  },
  clientReminders: {
    enabled: false,
    text: '⏰ Recordatorio de tu gestoría: {texto}',
  },
  // Avisos de caducidad y renovación: para expedientes con fecha de caducidad
  // (TIE, NIE, permisos, ITV, certificado digital…). Cuando faltan «daysBefore»
  // días se crea un recordatorio interno, opcionalmente se avisa al cliente y
  // se genera el expediente de renovación.
  renewals: {
    enabled: false,
    daysBefore: 30,
    notifyClient: false,
    clientText: 'Hola {nombre} 👋 Te recordamos que tu trámite «{tramite}» caduca el {fecha}. Si quieres, nos encargamos de la renovación. Escríbenos y lo preparamos. — Burocracia Zero',
    autoCreateCase: true,
  },
  // Citas: confirmación al reservar y recordatorio el día anterior.
  appointments: {
    enabled: false,
    confirmText: 'Hola {nombre}, te confirmamos tu cita en Burocracia Zero el {fecha} a las {hora}. Motivo: {motivo}. Si no puedes venir, avísanos por aquí. ¡Gracias!',
    remindText: 'Hola {nombre}, te recordamos tu cita de mañana ({fecha}) a las {hora} en Burocracia Zero. ¡Te esperamos!',
  },
  // Reserva de cita online: el cliente elige un hueco libre desde su enlace.
  // Los huecos se calculan sobre businessHours (días y horario).
  booking: {
    enabled: false,
    slotMinutes: 30,       // duración de cada hueco
    horizonDays: 14,       // cuántos días hacia delante se ofrecen
    maxPerDay: 12,         // tope de citas por día
    reason: 'Consulta',    // motivo por defecto de la cita reservada
  },
  // Pedir reseña en Google al completar un trámite. Cuando un expediente pasa a
  // «completado», se envía al cliente (una vez) un WhatsApp con el enlace de
  // reseñas de la gestoría. {enlace} se sustituye por reviewUrl.
  reviews: {
    enabled: false,
    reviewUrl: '',         // enlace de reseñas de Google del negocio
    text: 'Hola {nombre} 🙏 Ha sido un placer ayudarte con tu trámite. Si has quedado contento/a, ¿nos dejarías una reseña? Nos ayuda muchísimo: {enlace} — ¡Gracias! Burocracia Zero',
  },
  // Recordatorio de honorarios pendientes de cobro.
  payments: {
    enabled: false,
    daysAfter: 7,          // días desde que se completa el trámite
    onlyCompleted: true,   // solo trámites completados
    text: 'Hola {nombre} 👋 Te recordamos que queda pendiente el pago de {importe} € por «{tramite}». Si ya lo has abonado, ignora este mensaje. ¡Gracias! — Burocracia Zero',
  },
  // Cobros automáticos: reclama por WhatsApp, sin intervención, a los clientes
  // con saldo pendiente (honorarios y/o tasas) desde hace más de X días. Es la
  // versión automática del botón «Reclamar» del panel «Por cobrar».
  autoCollect: {
    enabled: false,
    daysOverdue: 15,       // reclamar a quien deba desde hace más de X días
    cooldownDays: 7,       // no repetir el aviso al mismo cliente antes de X días
    includeTax: false,     // incluir también las tasas pendientes en el importe
  },
  // Transcripción de notas de voz entrantes (requiere OPENAI_API_KEY, o un
  // endpoint compatible en TRANSCRIBE_URL). Datos sensibles: actívalo solo si
  // el proveedor cumple el RGPD.
  transcription: {
    enabled: false,
  },
  // Textos legales para el consentimiento del cliente (RGPD + autorización de
  // representación). Se muestran en su página de seguimiento para que los acepte.
  legal: {
    version: 1,
    text: 'Autorizo a Burocracia Zero (José) a tratar mis datos personales con la única finalidad de gestionar mis trámites, conforme al RGPD (UE) 2016/679 y a la LOPDGDD 3/2018, y le autorizo a representarme ante los organismos públicos que correspondan para dichos trámites. Mis datos se conservarán mientras dure la relación y las obligaciones legales aplicables. Puedo ejercer mis derechos de acceso, rectificación, supresión, oposición y portabilidad escribiendo por este mismo canal.',
  },
  // Integración con Microsoft 365 (las credenciales van por variables de
  // entorno MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET; aquí solo se
  // configura qué sincronizar y dónde).
  microsoft: {
    calendar: {
      enabled: false,
      user: 'jose@burocraciazero.es',
      // Calendario destino por nombre (vacío = calendario principal del usuario).
      calendarName: 'CITAS BZ COMPARTIDO',
    },
    sharepoint: {
      enabled: false,
      hostname: 'ejerciendolaciudadania.sharepoint.com',
      sitePath: '/sites/GestinBurocraciaZero',
      // {aa}=año en 2 cifras, {aaaa}=año completo, {cliente}=nombre en mayúsculas
      folderTemplate: '{aa} CLIENTES/{aa} {segmento}/{aa} {cliente}/CRM WHATSAPP',
    },
    // Copia de seguridad diaria subida a SharePoint (además de la copia local).
    backup: {
      enabled: false,
      folderPath: 'Copias de seguridad CRM',
      // Si está activo, tras subir cada copia a SharePoint se borra la copia
      // local (ahorra disco en el CRM). Si la subida falla, la local se
      // conserva para no perder la copia.
      cloudOnly: false,
    },
  },
  // Plantilla aprobada de Meta para cuando la ventana de 24 h está cerrada
  // (el cliente lleva más de 24 h sin escribir). Debe crearse y aprobarse en
  // YCloud/Meta con dos variables: {{1}} = nombre del cliente, {{2}} = texto.
  template24h: {
    enabled: false,
    name: 'aviso_gestoria',
    lang: 'es',
  },
};

// "2026-07-25" → "25/07/2026"
function prettyDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-');
  return `${d}/${m}/${y}`;
}

function appointmentVars(client, appt) {
  return {
    nombre: firstName(client),
    fecha: prettyDate(appt.date),
    hora: appt.time || '',
    motivo: appt.reason || 'consulta',
  };
}

// Confirmación al crear una cita (la llama el servidor).
async function onAppointmentCreated(db, appt, client, send) {
  const s = getSettings(db);
  if (!s.appointments.enabled || !client) return;
  await send(client, fillTemplate(s.appointments.confirmText, appointmentVars(client, appt)));
  appt.confirmationSentAt = Date.now();
}

// La ventana de servicio de WhatsApp: 24 h desde el último mensaje del cliente.
function isWindowOpen(db, clientId, now = Date.now()) {
  const lastIn = db.messages
    .filter((m) => m.clientId === clientId && m.direction === 'in')
    .reduce((max, m) => Math.max(max, m.timestamp), 0);
  return lastIn > 0 && now - lastIn < 24 * 3600 * 1000;
}

function merge(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = merge(base[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

function getSettings(db) {
  if (!db.settings || typeof db.settings !== 'object') db.settings = {};
  return merge(DEFAULTS, db.settings.automations);
}

function setSettings(db, incoming) {
  if (!db.settings || typeof db.settings !== 'object') db.settings = {};
  db.settings.automations = merge(getSettings(db), incoming);
  return db.settings.automations;
}

function isBusinessOpen(settings, date = new Date()) {
  const bh = settings.businessHours;
  if (!Array.isArray(bh.days) || !bh.days.includes(date.getDay())) return false;
  const hhmm = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return hhmm >= bh.open && hhmm < bh.close;
}

function fillTemplate(text, vars) {
  let out = String(text || '');
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{${key}}`, value ?? '');
  }
  return out;
}

function firstName(client) {
  return (client.name || '').split(' ')[0];
}

// Parsea las áreas del menú: bloques que empiezan por «=== Título» seguidos
// del texto (precios) de esa área. Los títulos se recortan a 24 caracteres,
// el límite de las listas interactivas de WhatsApp.
function parseAreas(areasText) {
  const areas = [];
  let current = null;
  for (const line of String(areasText || '').split('\n')) {
    const m = line.match(/^=+\s*(.+)$/);
    if (m) {
      if (current && current.body.trim()) areas.push(current);
      current = { title: m[1].trim().slice(0, 24), body: '' };
    } else if (current) {
      current.body += (current.body ? '\n' : '') + line;
    }
  }
  if (current && current.body.trim()) areas.push(current);
  return areas
    .filter((a) => a.title)
    .slice(0, 10)
    .map((a, i) => ({ id: `area_${i + 1}`, title: a.title, body: a.body.trim() }));
}

// 0) Mensaje de servicios a cualquier cliente que escriba (nuevo o existente),
// como máximo una vez cada N horas por cliente. A diferencia de la respuesta
// fuera de horario, se envía siempre, sea la hora que sea. Con áreas
// definidas, sale como menú interactivo de WhatsApp.
async function maybeWelcome(db, client, send, now = new Date()) {
  const s = getSettings(db);
  if (!s.welcome.enabled) return false;
  const hours = Number(s.welcome.frequencyHours);
  const gapMs = (Number.isFinite(hours) && hours >= 1 ? hours : 24) * 3600 * 1000;
  if (client.lastWelcomeAt && now.getTime() - client.lastWelcomeAt < gapMs) return false;
  client.lastWelcomeAt = now.getTime();
  const intro = fillTemplate(s.welcome.text, { nombre: firstName(client) });
  const areas = parseAreas(s.welcome.areasText);
  if (areas.length) {
    // En el CRM el mensaje se guarda con el listado numerado para que la
    // conversación sea legible; en WhatsApp llega como menú con botón.
    const summary = `${intro}\n\n${areas.map((a, i) => `${i + 1}. ${a.title}`).join('\n')}`;
    await send(client, summary, {
      interactiveList: {
        body: intro,
        button: 'Servicios',
        rows: areas.map((a) => ({ id: a.id, title: a.title })),
      },
    });
  } else {
    await send(client, intro);
  }
  return true;
}

// Respuesta al menú: si el texto entrante coincide con un área (selección de
// la lista interactiva, el título escrito o su número), se envían sus precios.
async function maybeMenuReply(db, client, text, send) {
  const s = getSettings(db);
  if (!s.welcome.enabled) return false;
  const areas = parseAreas(s.welcome.areasText);
  if (!areas.length) return false;
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  let area = areas.find((a) => a.title.toLowerCase() === t);
  if (!area && /^\d{1,2}$/.test(t)) area = areas[Number(t) - 1] || null;
  if (!area) return false;
  await send(client, area.body);
  return true;
}

// 1) Respuesta automática fuera de horario. `send(client, text)` envía y
// registra el mensaje (se marca como automático desde el servidor).
async function maybeAutoReply(db, client, send, now = new Date()) {
  const s = getSettings(db);
  if (!s.afterHours.enabled) return false;
  if (isBusinessOpen(s, now)) return false;
  const cooldownMs = (Number(s.afterHours.cooldownHours) || 12) * 3600 * 1000;
  if (client.lastAutoReplyAt && now.getTime() - client.lastAutoReplyAt < cooldownMs) return false;
  client.lastAutoReplyAt = now.getTime();
  await send(client, fillTemplate(s.afterHours.message, { nombre: firstName(client) }));
  return true;
}

const MESES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
// «2026-08-17» → «17 de agosto de 2026». Sin usar Date (evita zonas horarias).
function fmtLongDate(ymdStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymdStr || ''));
  if (!m) return String(ymdStr || '');
  return `${Number(m[3])} de ${MESES_LARGO[Number(m[2]) - 1]} de ${m[1]}`;
}
function ymd(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}
// ¿Estamos dentro del periodo de vacaciones/cierre? (activo y hoy en el rango).
function isHolidayActive(db, now = new Date()) {
  const h = getSettings(db).holiday || {};
  if (!h.enabled || !h.from || !h.to) return false;
  const today = ymd(now);
  return today >= h.from && today <= h.to;
}
// Responde con el aviso de vacaciones como máximo UNA VEZ AL DÍA por cliente
// (aunque escriba varias veces): se guarda el día del último aviso y no se
// vuelve a enviar hasta el día siguiente.
async function maybeHoliday(db, client, send, now = new Date()) {
  if (!isHolidayActive(db, now)) return false;
  const h = getSettings(db).holiday;
  const today = ymd(now);
  if (client.holidayNotifiedDay === today) return false; // ya se le avisó hoy
  client.holidayNotifiedDay = today;
  await send(client, fillTemplate(h.message, {
    nombre: firstName(client), desde: fmtLongDate(h.from), hasta: fmtLongDate(h.to),
  }));
  return true;
}

// 2) y 3) Reacción a un cambio de estado de expediente.
async function onCaseStatusChanged(db, item, client, send, now = new Date()) {
  const s = getSettings(db);
  if (!client) return;
  const vars = {
    nombre: firstName(client),
    tramite: item.title,
    documentos: item.docs?.trim() || '(pendiente de detallar)',
  };
  if (item.status === 'esperando_documentacion') {
    if (!s.docs.enabled) return;
    await send(client, fillTemplate(s.docs.requestText, vars));
    item.docsRequestedAt = now.getTime();
    item.docsFollowUpAt = null;
    return;
  }
  // Al completar un trámite: pedir reseña en Google (una sola vez por cliente).
  // Independiente de statusNotify: se controla con su propio interruptor.
  if (item.status === 'completado' && s.reviews && s.reviews.enabled
      && String(s.reviews.reviewUrl || '').trim() && !client.reviewAskedAt) {
    await send(client, fillTemplate(s.reviews.text, { ...vars, enlace: String(s.reviews.reviewUrl).trim() }));
    client.reviewAskedAt = now.getTime();
  }
  if (!s.statusNotify.enabled) return;
  if (item.status === 'en_curso' && s.statusNotify.onEnCurso) {
    await send(client, fillTemplate(s.statusNotify.enCursoText, vars));
  }
  if (item.status === 'completado' && s.statusNotify.onCompletado) {
    await send(client, fillTemplate(s.statusNotify.completadoText, vars));
  }
}

// 3) reclamo de documentación + 4) recordatorios al cliente.
// Se ejecuta periódicamente; solo envía dentro del horario de la gestoría
// para no molestar al cliente de madrugada.
async function runScheduled(db, send, now = new Date()) {
  const s = getSettings(db);
  const actions = [];
  // Durante las vacaciones/cierre no sale NINGÚN mensaje automático al cliente
  // (cobros automáticos, avisos de renovación, reclamos de documentación,
  // recordatorios…): no hay nadie para dar seguimiento. Se reanuda al terminar.
  if (isHolidayActive(db, now)) return actions;
  if (!isBusinessOpen(s, now)) return actions;

  // Reclamo de documentación pendiente.
  if (s.docs.enabled) {
    const days = Number(s.docs.followUpDays);
    const waitMs = (Number.isFinite(days) && days >= 0 ? days : 3) * 24 * 3600 * 1000;
    for (const item of db.cases) {
      if (item.status !== 'esperando_documentacion') continue;
      if (!item.docsRequestedAt || item.docsFollowUpAt) continue;
      if (now.getTime() - item.docsRequestedAt < waitMs) continue;
      const client = db.clients.find((c) => c.id === item.clientId);
      if (!client) continue;
      // Si el cliente ya respondió después de la petición, no se reclama.
      const replied = db.messages.some((m) => m.clientId === client.id
        && m.direction === 'in' && m.timestamp > item.docsRequestedAt);
      if (replied) continue;
      await send(client, fillTemplate(s.docs.followUpText, {
        nombre: firstName(client),
        tramite: item.title,
        documentos: item.docs?.trim() || '(pendiente de detallar)',
      }));
      item.docsFollowUpAt = now.getTime();
      actions.push({ type: 'docs_follow_up', caseId: item.id });
    }
  }

  // Recordatorio de cita: se envía el día anterior.
  if (s.appointments.enabled) {
    const t = new Date(now);
    t.setDate(t.getDate() + 1);
    const tomorrow = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    for (const appt of db.appointments) {
      if (appt.status !== 'activa' || appt.remindedAt || appt.date !== tomorrow) continue;
      const client = db.clients.find((c) => c.id === appt.clientId);
      if (!client) continue;
      await send(client, fillTemplate(s.appointments.remindText, appointmentVars(client, appt)));
      appt.remindedAt = now.getTime();
      actions.push({ type: 'appointment_reminder', appointmentId: appt.id });
    }
  }

  // Avisos de caducidad / renovación.
  if (s.renewals.enabled) {
    const { newId } = require('./store');
    const daysBefore = Number.isFinite(Number(s.renewals.daysBefore)) ? Number(s.renewals.daysBefore) : 30;
    const horizon = now.getTime() + daysBefore * 24 * 3600 * 1000;
    for (const item of db.cases) {
      if (!item.expiryDate || item.expiryNotifiedAt) continue;
      const expiryMs = new Date(item.expiryDate + 'T00:00').getTime();
      if (Number.isNaN(expiryMs) || expiryMs > horizon) continue;
      const client = db.clients.find((c) => c.id === item.clientId);
      // Recordatorio interno para la gestoría (siempre).
      db.reminders.push({
        id: newId('rem'),
        text: `Renovar «${item.title}» — caduca el ${prettyDate(item.expiryDate)}`,
        dueDate: item.expiryDate,
        clientId: item.clientId || null,
        done: false,
        sendToClient: false,
        createdAt: now.getTime(),
      });
      // Aviso al cliente (opcional).
      if (s.renewals.notifyClient && client) {
        await send(client, fillTemplate(s.renewals.clientText, {
          nombre: firstName(client),
          tramite: item.title,
          fecha: prettyDate(item.expiryDate),
        }));
      }
      // Expediente de renovación (opcional, una sola vez).
      if (s.renewals.autoCreateCase && !item.renewalCaseId) {
        const renewal = {
          id: newId('exp'),
          clientId: item.clientId,
          title: `Renovación: ${item.title}`,
          type: item.type,
          status: 'pendiente',
          dueDate: item.expiryDate,
          expiryDate: null,
          docs: item.docs || '',
          fee: 0,
          paid: false,
          checklist: [],
          notes: `Generado automáticamente por caducidad del expediente «${item.title}».`,
          createdAt: now.getTime(),
          updatedAt: now.getTime(),
        };
        db.cases.push(renewal);
        item.renewalCaseId = renewal.id;
      }
      item.expiryNotifiedAt = now.getTime();
      actions.push({ type: 'renewal_notice', caseId: item.id });
    }
  }

  // Recordatorio de honorarios pendientes de cobro.
  if (s.payments.enabled) {
    const daysAfter = Number.isFinite(Number(s.payments.daysAfter)) ? Number(s.payments.daysAfter) : 7;
    const waitMs = daysAfter * 24 * 3600 * 1000;
    for (const item of db.cases) {
      const fee = Number(item.fee) || 0;
      if (fee <= 0 || item.paid || item.feeReminderAt) continue;
      if (s.payments.onlyCompleted && item.status !== 'completado') continue;
      const since = item.updatedAt || item.createdAt || 0;
      if (now.getTime() - since < waitMs) continue;
      const client = db.clients.find((c) => c.id === item.clientId);
      if (!client) continue;
      await send(client, fillTemplate(s.payments.text, {
        nombre: firstName(client),
        tramite: item.title,
        importe: fee.toLocaleString('es-ES'),
      }));
      item.feeReminderAt = now.getTime();
      actions.push({ type: 'payment_reminder', caseId: item.id });
    }
  }

  // Cobros automáticos: reclama el saldo pendiente (agrupado por cliente) a
  // quien lo tenga desde hace más de X días, como el botón «Reclamar».
  if (s.autoCollect && s.autoCollect.enabled) {
    const days = Number.isFinite(Number(s.autoCollect.daysOverdue)) ? Number(s.autoCollect.daysOverdue) : 15;
    const cooldownDays = Number.isFinite(Number(s.autoCollect.cooldownDays)) ? Number(s.autoCollect.cooldownDays) : 7;
    const thresholdMs = days * 24 * 3600 * 1000;
    const cooldownMs = cooldownDays * 24 * 3600 * 1000;
    const includeTax = Boolean(s.autoCollect.includeTax);
    // Agrupa los importes pendientes por cliente.
    const byClient = new Map();
    for (const item of db.cases) {
      const feeDue = (Number(item.fee) || 0) > 0 && !item.paid ? Number(item.fee) : 0;
      const taxDue = includeTax && (Number(item.taxAmount) || 0) > 0 && !item.taxPaid ? Number(item.taxAmount) : 0;
      if (!feeDue && !taxDue) continue;
      const e = byClient.get(item.clientId) || { total: 0, oldest: now.getTime(), items: [] };
      e.total += feeDue + taxDue;
      const since = item.updatedAt || item.createdAt || now.getTime();
      if (since < e.oldest) e.oldest = since;
      e.items.push({ title: item.title, fee: feeDue, tax: taxDue });
      byClient.set(item.clientId, e);
    }
    for (const [clientId, e] of byClient) {
      if (now.getTime() - e.oldest < thresholdMs) continue; // aún no lleva X días
      const client = db.clients.find((c) => c.id === clientId);
      if (!client) continue;
      if (client.autoCollectAt && now.getTime() - client.autoCollectAt < cooldownMs) continue; // cooldown
      const lines = [`Hola ${firstName(client)} 👋 Un recordatorio de los importes pendientes de tus trámites:`, ''];
      for (const it of e.items) {
        const parts = [];
        if (it.fee) parts.push(`honorarios ${it.fee.toLocaleString('es-ES')} €`);
        if (it.tax) parts.push(`tasa oficial ${it.tax.toLocaleString('es-ES')} €`);
        lines.push(`• ${it.title}: ${parts.join(' + ')}`);
      }
      lines.push('', `Total pendiente: ${e.total.toLocaleString('es-ES')} €.`,
        'Cuando puedas, nos dices y lo dejamos al día. ¡Gracias! 🙌');
      await send(client, lines.join('\n'));
      client.autoCollectAt = now.getTime();
      actions.push({ type: 'auto_collect', clientId, total: e.total });
    }
  }

  // Recordatorios con fecha de hoy (o vencidos) marcados para enviar al cliente.
  if (s.clientReminders.enabled) {
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    for (const r of db.reminders) {
      if (!r.sendToClient || r.done || r.sentToClientAt) continue;
      if (!r.clientId || !r.dueDate || r.dueDate > today) continue;
      const client = db.clients.find((c) => c.id === r.clientId);
      if (!client) continue;
      await send(client, fillTemplate(s.clientReminders.text, {
        nombre: firstName(client),
        texto: r.text,
      }));
      r.sentToClientAt = now.getTime();
      actions.push({ type: 'client_reminder', reminderId: r.id });
    }
  }
  return actions;
}

module.exports = {
  DEFAULTS,
  getSettings,
  setSettings,
  isBusinessOpen,
  isWindowOpen,
  fillTemplate,
  prettyDate,
  parseAreas,
  maybeWelcome,
  maybeMenuReply,
  maybeAutoReply,
  isHolidayActive,
  maybeHoliday,
  onCaseStatusChanged,
  onAppointmentCreated,
  runScheduled,
};
