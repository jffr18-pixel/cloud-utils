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
  // Citas: confirmación al reservar y recordatorio el día anterior.
  appointments: {
    enabled: false,
    confirmText: 'Hola {nombre}, te confirmamos tu cita en Burocracia Zero el {fecha} a las {hora}. Motivo: {motivo}. Si no puedes venir, avísanos por aquí. ¡Gracias!',
    remindText: 'Hola {nombre}, te recordamos tu cita de mañana ({fecha}) a las {hora} en Burocracia Zero. ¡Te esperamos!',
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
  maybeAutoReply,
  onCaseStatusChanged,
  onAppointmentCreated,
  runScheduled,
};
