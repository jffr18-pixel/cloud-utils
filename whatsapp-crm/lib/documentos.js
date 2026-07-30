'use strict';

// Documentos pre-rellenados de la gestoría. Genera el contenido (título +
// líneas para buildTextPdf) de documentos legales YA rellenados con los datos
// del cliente, listos para imprimir y firmar en persona.
//
// Se diferencia del flujo de firma digital (SIGN_DOCS + buildSignedPdf en
// server.js), que embebe la firma manuscrita hecha en el móvil. Aquí el
// documento se descarga en PDF con una línea de firma en blanco, para el
// cliente que prefiere firmar en papel en la oficina.
//
// Módulo puro (sin E/S ni dependencias): recibe { client, cases, now } y
// devuelve { title, filename, lines }. Así es trivial de probar.

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function longDate(d) {
  const dd = d instanceof Date ? d : new Date(d);
  return `${dd.getDate()} de ${MESES[dd.getMonth()]} de ${dd.getFullYear()}`;
}

// Datos de la gestoría por defecto (editables en Automatizaciones → «Datos de
// la gestoría»; se pasan al generar el documento vía ctx.empresa).
const FIRM = {
  nombre: 'Burocracia Zero SLP',
  ciudad: 'Toledo',
};

// Fusiona los datos recibidos con los de por defecto.
function firmFrom(empresa) {
  const e = empresa || {};
  return {
    nombre: (e.nombre || '').trim() || FIRM.nombre,
    cif: (e.cif || '').trim(),
    direccion: (e.direccion || '').trim(),
    ciudad: (e.ciudad || '').trim() || FIRM.ciudad,
    telefono: (e.telefono || '').trim(),
    email: (e.email || '').trim(),
    web: (e.web || '').trim(),
    colegiado: (e.colegiado || '').trim(),
  };
}

// Cabecera (membrete) para el PDF a partir de los datos de la gestoría.
function firmHeader(firm) {
  const l1 = [];
  if (firm.cif) l1.push(`CIF ${firm.cif}`);
  if (firm.colegiado) l1.push(`Gestoría colegiada nº ${firm.colegiado}`);
  const l3 = [];
  if (firm.telefono) l3.push(`Tel. ${firm.telefono}`);
  if (firm.email) l3.push(firm.email);
  if (firm.web) l3.push(firm.web);
  const info = [];
  if (l1.length) info.push(l1.join(' · '));
  if (firm.direccion) info.push(firm.direccion);
  if (l3.length) info.push(l3.join(' · '));
  return { name: firm.nombre, tagline: 'Simplificamos tus trámites', info, mark: true };
}

// Áreas de trámite (mismo catálogo que el resto del CRM), para redactar el
// objeto del encargo a partir de los expedientes del cliente.
const AREA = {
  extranjeria: 'extranjería', vehiculos: 'tráfico y vehículos', fiscal: 'fiscal e impuestos',
  laboral: 'laboral y nóminas', contabilidad: 'contabilidad', pensiones: 'pensiones y prestaciones',
  social: 'servicios sociales', otro: 'trámites administrativos',
};

// Catálogo de documentos disponibles (id → etiqueta para la interfaz).
const TIPOS = {
  autorizacion: 'Autorización de representación',
  encargo: 'Hoja de encargo profesional',
  rgpd: 'Consentimiento RGPD',
};

// Placeholder cuando falta un dato del cliente (para rellenar a mano).
function orBlank(v) {
  const s = (v == null ? '' : String(v)).trim();
  return s || '__________________';
}

// Describe el objeto del encargo a partir de los expedientes abiertos del
// cliente. Si no hay ninguno, deja una fórmula genérica.
function objetoTramite(cases) {
  const open = (cases || []).filter((c) => c && c.status !== 'completado');
  const list = open.length ? open : (cases || []);
  if (!list.length) return 'los trámites administrativos que el cliente encomiende';
  const titles = list.slice(0, 4).map((c) => {
    const area = AREA[c.type] || 'trámites administrativos';
    return c.title ? `${c.title} (${area})` : area;
  });
  return titles.join('; ');
}

// Cabecera común: datos identificativos del cliente ya rellenados.
function clientBlock(client) {
  return [
    { t: `Nombre y apellidos: ${orBlank(client.name)}` },
    { t: `NIF / NIE / Pasaporte: ${orBlank(client.nif)}` },
    { t: `Teléfono: ${client.phone ? '+' + client.phone : '__________________'}` },
    { t: `Correo electrónico: ${orBlank(client.email)}` },
  ];
}

// Bloque de firma en blanco (para firmar en papel).
function signatureBlock({ firm, dateStr, dual }) {
  const lines = [
    { t: `En ${firm.ciudad}, a ${dateStr}.`, gap: 22 },
  ];
  if (dual) {
    lines.push({ t: 'Firma del cliente:                              Firma de la gestoría:', gap: 34 });
    lines.push({ t: '_________________________            _________________________' });
    lines.push({ t: `${firm.nombre}`, size: 9, color: [0.45, 0.45, 0.45] });
  } else {
    lines.push({ t: 'Firma del cliente:', gap: 34 });
    lines.push({ t: '_________________________' });
  }
  return lines;
}

// --- Plantillas ------------------------------------------------------------

function docAutorizacion({ client, cases, dateStr, firm }) {
  const objeto = objetoTramite(cases);
  const lines = [];
  lines.push({ t: `Documento generado el ${dateStr}`, size: 9, color: [0.45, 0.45, 0.45] });
  lines.push({ t: 'DATOS DEL REPRESENTADO', bold: true, size: 12, gap: 14 });
  lines.push(...clientBlock(client));
  lines.push({ t: 'AUTORIZACIÓN', bold: true, size: 12, gap: 16 });
  lines.push({ t: `Por medio del presente documento, la persona arriba identificada AUTORIZA a ${firm.nombre} (gestoría con domicilio en ${firm.ciudad}) a actuar en su nombre y representación ante los organismos públicos competentes —Oficina de Extranjería, Dirección General de Tráfico (DGT), Agencia Tributaria (AEAT), Tesorería General de la Seguridad Social y demás Administraciones Públicas— para la tramitación de: ${objeto}.`, gap: 8 });
  lines.push({ t: 'Esta autorización habilita a la gestoría a presentar, subsanar, retirar y recoger en su nombre cuanta documentación sea necesaria, así como a recibir notificaciones relacionadas con dichos trámites.', gap: 8 });
  lines.push({ t: 'En cumplimiento del Reglamento (UE) 2016/679 (RGPD) y de la Ley Orgánica 3/2018 (LOPDGDD), el/la firmante consiente el tratamiento de sus datos personales por parte de la gestoría con la única finalidad de prestar los servicios encomendados.', gap: 8 });
  lines.push(...signatureBlock({ firm, dateStr, dual: false }));
  return { title: 'AUTORIZACIÓN DE REPRESENTACIÓN', lines };
}

function docEncargo({ client, cases, dateStr, firm }) {
  const objeto = objetoTramite(cases);
  const lines = [];
  lines.push({ t: `Documento generado el ${dateStr}`, size: 9, color: [0.45, 0.45, 0.45] });
  lines.push({ t: 'PARTES', bold: true, size: 12, gap: 14 });
  lines.push({ t: `De una parte, ${firm.nombre}, gestoría administrativa con domicilio en ${firm.ciudad} (en adelante, «la gestoría»).` });
  lines.push({ t: 'De otra parte, el cliente:', gap: 4 });
  lines.push(...clientBlock(client));
  lines.push({ t: 'OBJETO DEL ENCARGO', bold: true, size: 12, gap: 16 });
  lines.push({ t: `El cliente encarga a la gestoría, que acepta, la prestación de los siguientes servicios profesionales: ${objeto}.`, gap: 8 });
  lines.push({ t: 'HONORARIOS', bold: true, size: 12, gap: 16 });
  lines.push({ t: 'Honorarios profesionales: __________ euros. Las tasas e impuestos oficiales que procedan se abonarán aparte, por su importe exacto. El pago se realizará según lo acordado entre las partes.', gap: 8 });
  lines.push({ t: 'PROTECCIÓN DE DATOS', bold: true, size: 12, gap: 16 });
  lines.push({ t: 'Los datos personales del cliente se tratarán conforme al Reglamento (UE) 2016/679 (RGPD) y a la Ley Orgánica 3/2018 (LOPDGDD), con la única finalidad de prestar los servicios contratados. Se conservarán durante el tiempo legalmente exigible y no se cederán a terceros salvo obligación legal. El cliente puede ejercer sus derechos de acceso, rectificación, supresión, oposición, limitación y portabilidad dirigiéndose a la gestoría.', gap: 8 });
  lines.push({ t: 'Y en prueba de conformidad, ambas partes firman el presente documento.', gap: 8 });
  lines.push(...signatureBlock({ firm, dateStr, dual: true }));
  return { title: 'HOJA DE ENCARGO PROFESIONAL', lines };
}

function docRgpd({ client, dateStr, firm }) {
  const lines = [];
  lines.push({ t: `Documento generado el ${dateStr}`, size: 9, color: [0.45, 0.45, 0.45] });
  lines.push({ t: 'DATOS DEL INTERESADO', bold: true, size: 12, gap: 14 });
  lines.push(...clientBlock(client));
  lines.push({ t: 'CONSENTIMIENTO', bold: true, size: 12, gap: 16 });
  lines.push({ t: `La persona arriba identificada, en cumplimiento del Reglamento (UE) 2016/679 (RGPD) y de la Ley Orgánica 3/2018 (LOPDGDD), CONSIENTE el tratamiento de sus datos personales por parte de ${firm.nombre} (gestoría con domicilio en ${firm.ciudad}) con la finalidad de prestar los servicios de gestoría contratados y mantener la comunicación necesaria a través de WhatsApp y otros medios.`, gap: 8 });
  lines.push({ t: 'Los datos se conservarán durante el tiempo legalmente exigible y no se cederán a terceros salvo obligación legal. El/la interesado/a puede ejercer sus derechos de acceso, rectificación, supresión, oposición, limitación y portabilidad dirigiéndose a la gestoría.', gap: 8 });
  lines.push(...signatureBlock({ firm, dateStr, dual: false }));
  return { title: 'CONSENTIMIENTO DE PROTECCIÓN DE DATOS (RGPD)', lines };
}

const BUILDERS = { autorizacion: docAutorizacion, encargo: docEncargo, rgpd: docRgpd };

// Genera un documento pre-rellenado. Devuelve { title, filename, lines, header }.
//   tipo  = 'autorizacion' | 'encargo' | 'rgpd'
//   ctx   = { client, cases, empresa, now }
function buildDocumento(tipo, ctx) {
  const builder = BUILDERS[tipo];
  if (!builder) return null;
  const client = (ctx && ctx.client) || {};
  const cases = (ctx && ctx.cases) || [];
  const firm = firmFrom(ctx && ctx.empresa);
  const now = (ctx && ctx.now) ? new Date(ctx.now) : new Date();
  const dateStr = longDate(now);
  const { title, lines } = builder({ client, cases, dateStr, firm });
  const safe = (client.name || 'cliente').replace(/[^\w.\-]+/g, '_').slice(0, 40);
  const filename = `${TIPOS[tipo].replace(/\s+/g, '_')}_${safe}.pdf`;
  return { title, filename, lines, header: firmHeader(firm) };
}

// Importe con dos decimales (formato español) seguido de «euros». Se evita el
// símbolo «€» porque el motor de PDF (WinAnsi) no lo representa.
function eur(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  const dec = Number.isInteger(v) ? 0 : 2;
  return v.toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: 2 }) + ' euros';
}

// Forma de pago (misma nomenclatura que el CRM) → texto para el recibo.
const PAGO = {
  caja: 'en efectivo', transferencia: 'por transferencia', tarjeta: 'con tarjeta',
  banco: 'por transferencia bancaria',
};

// Recibo/justificante de pago de honorarios. Documento puro para buildTextPdf.
//   ctx = { client, concepto, amount, method, number, tasa, tasaPaid, empresa, now }
function buildRecibo(ctx) {
  const client = (ctx && ctx.client) || {};
  const firm = firmFrom(ctx && ctx.empresa);
  const now = (ctx && ctx.now) ? new Date(ctx.now) : new Date();
  const dateStr = longDate(now);
  const amount = Math.round((Number(ctx && ctx.amount) || 0) * 100) / 100;
  const via = PAGO[ctx && ctx.method] || '';
  const concepto = (ctx && ctx.concepto ? String(ctx.concepto) : '').trim() || 'servicios de gestoría';
  const number = (ctx && ctx.number) ? String(ctx.number) : '';

  const lines = [];
  lines.push({ t: `Recibo nº ${number || '—'} · ${dateStr}`, size: 9, color: [0.45, 0.45, 0.45] });
  lines.push({ t: `He recibido de D./Dª ${orBlank(client.name)}, con NIF/NIE ${orBlank(client.nif)}, la cantidad de:`, gap: 16 });
  lines.push({ t: `${eur(amount)}`, bold: true, size: 15, gap: 8 });
  lines.push({ t: `en concepto de honorarios profesionales por: ${concepto}.`, gap: 8 });
  if (via) lines.push({ t: `Forma de pago: ${via}.`, gap: 4 });
  if (ctx && ctx.tasa && ctx.tasaPaid) {
    lines.push({ t: `Nota: además se ha abonado la tasa oficial correspondiente (${eur(ctx.tasa)}), que se ingresa en la Administración y no forma parte de estos honorarios.`, size: 9, color: [0.45, 0.45, 0.45], gap: 10 });
  }
  lines.push({ t: `Y para que conste, se expide el presente recibo en ${firm.ciudad}, a ${dateStr}.`, gap: 18 });
  lines.push({ t: 'Firma y sello de la gestoría:', gap: 24 });
  lines.push({ t: '_________________________' });
  lines.push({ t: `${firm.nombre}`, size: 9, color: [0.45, 0.45, 0.45] });
  const safe = (client.name || 'cliente').replace(/[^\w.\-]+/g, '_').slice(0, 40);
  const filename = `Recibo_${number ? number.replace(/[^\w.\-]+/g, '') + '_' : ''}${safe}.pdf`;
  return { title: 'RECIBO', filename, lines, header: firmHeader(firm) };
}

module.exports = { buildDocumento, buildRecibo, TIPOS, longDate, objetoTramite };
