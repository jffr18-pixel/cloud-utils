'use strict';

// Generador de PDF sin dependencias externas: crea un documento de una o
// varias páginas A4 con texto (fuente Helvetica) y la firma manuscrita del
// cliente embebida como imagen JPEG. Suficiente para autorizaciones de
// representación y consentimientos RGPD firmados en el móvil.
//
// El PDF se construye a mano (objetos + tabla xref) porque el entorno del CRM
// no permite dependencias externas. La firma llega como JPEG (lo exporta el
// lienzo del navegador), que se incrusta directamente con el filtro DCTDecode.

const PAGE_W = 595; // A4 en puntos (72 ppp)
const PAGE_H = 842;
const MARGIN = 56;
const FONT_SIZE = 10.5;
const LEADING = 15.5;
const TITLE_SIZE = 15;

// Ancho aproximado de un carácter en Helvetica (fracción del tamaño de fuente).
// Basta para un ajuste de línea razonable sin métricas exactas.
const CHAR_W = 0.52;

function escapePdfText(s) {
  return String(s).replace(/[\\()]/g, (m) => '\\' + m);
}

// Solo Latin-1 (WinAnsi). Se sustituyen los caracteres no representables para
// no romper la codificación del texto (p. ej. comillas tipográficas).
function toWinAnsi(s) {
  return String(s)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    // Cualquier carácter fuera de Latin-1 se descarta (p. ej. árabe): las
    // autorizaciones legales van en español.
    .replace(/[^\x09\x0a\x0d\x20-\xff]/g, '');
}

// Ajuste de línea codicioso por ancho aproximado en puntos.
function wrapLine(text, maxWidth, fontSize) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = '';
  const width = (t) => t.length * CHAR_W * fontSize;
  for (const w of words) {
    const tentative = cur ? cur + ' ' + w : w;
    if (width(tentative) > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = tentative;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

// Divide un texto (con saltos de línea) en líneas ya ajustadas al ancho útil.
function layoutParagraphs(text, maxWidth, fontSize) {
  const out = [];
  for (const para of String(text).split('\n')) {
    if (!para.trim()) { out.push(''); continue; }
    for (const l of wrapLine(para.trim(), maxWidth, fontSize)) out.push(l);
  }
  return out;
}

// Lee ancho y alto de un JPEG a partir de sus marcadores SOF.
function jpegSize(buf) {
  if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return { width: 0, height: 0 };
  let i = 2; // salta SOI (FFD8)
  while (i + 8 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    // Marcadores SOF (contienen las dimensiones), excepto los de tablas.
    if (marker >= 0xc0 && marker <= 0xcf
        && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = buf.readUInt16BE(i + 5);
      const width = buf.readUInt16BE(i + 7);
      return { width, height };
    }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) break; // longitud inválida → se descarta la imagen
    i += 2 + len;
  }
  return { width: 0, height: 0 };
}

// Convierte una data URL o base64 de JPEG en un Buffer.
function jpegBufferFromDataUrl(dataUrl) {
  const s = String(dataUrl || '');
  const comma = s.indexOf(',');
  const b64 = comma >= 0 ? s.slice(comma + 1) : s;
  return Buffer.from(b64, 'base64');
}

// Construye el flujo de contenido de la página: texto y, si procede, la firma.
function buildContent({ title, lines, footerLines, image }) {
  const parts = [];
  let y = PAGE_H - MARGIN;
  // Título.
  parts.push('BT /F1 ' + TITLE_SIZE + ' Tf ' + MARGIN + ' ' + y.toFixed(1) + ' Td ('
    + escapePdfText(toWinAnsi(title)) + ') Tj ET');
  y -= TITLE_SIZE + 14;
  // Cuerpo.
  parts.push('BT /F1 ' + FONT_SIZE + ' Tf ' + LEADING + ' TL ' + MARGIN + ' ' + y.toFixed(1) + ' Td');
  for (const l of lines) {
    parts.push('(' + escapePdfText(toWinAnsi(l)) + ') Tj T*');
    y -= LEADING;
  }
  parts.push('ET');

  // Imagen de la firma (si la hay), justo encima del pie.
  if (image && image.width && image.height) {
    const maxW = 220;
    const scale = Math.min(1, maxW / image.width);
    const drawW = image.width * scale;
    const drawH = image.height * scale;
    const imgY = MARGIN + 70;
    parts.push('q ' + drawW.toFixed(2) + ' 0 0 ' + drawH.toFixed(2) + ' '
      + MARGIN + ' ' + imgY.toFixed(2) + ' cm /Im0 Do Q');
    // Línea de firma bajo la imagen.
    const lineY = imgY - 6;
    parts.push(MARGIN + ' ' + lineY.toFixed(2) + ' m ' + (MARGIN + Math.max(drawW, 180)).toFixed(2)
      + ' ' + lineY.toFixed(2) + ' l 0.5 w S');
  }

  // Pie: firmante, fecha, etc.
  if (footerLines && footerLines.length) {
    let fy = MARGIN + 52;
    parts.push('BT /F1 ' + FONT_SIZE + ' Tf ' + LEADING + ' TL ' + MARGIN + ' ' + fy.toFixed(1) + ' Td');
    for (const l of footerLines) {
      parts.push('(' + escapePdfText(toWinAnsi(l)) + ') Tj T*');
      fy -= LEADING;
    }
    parts.push('ET');
  }

  return Buffer.from(parts.join('\n'), 'latin1');
}

// Genera el PDF completo. Devuelve un Buffer.
//   opts = { title, body, footerLines, signatureJpeg (data URL o base64) }
function buildSignedPdf(opts) {
  const maxWidth = PAGE_W - 2 * MARGIN;
  const lines = layoutParagraphs(opts.body || '', maxWidth, FONT_SIZE);
  let image = null;
  let jpeg = null;
  if (opts.signatureJpeg) {
    jpeg = jpegBufferFromDataUrl(opts.signatureJpeg);
    const size = jpegSize(jpeg);
    if (size.width && size.height) image = size;
  }
  const content = buildContent({
    title: opts.title || 'Documento',
    lines,
    footerLines: opts.footerLines || [],
    image,
  });

  // Ensamblado de objetos con seguimiento de desplazamientos para la xref.
  const chunks = [];
  let offset = 0;
  const offsets = [];
  const push = (buf) => {
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf, 'latin1');
    chunks.push(b);
    offset += b.length;
  };
  const startObj = () => { offsets.push(offset); };

  push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');

  // 1: Catalog
  startObj();
  push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  // 2: Pages
  startObj();
  push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  // 3: Page
  startObj();
  const xobj = image ? ' /XObject << /Im0 5 0 R >>' : '';
  push('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PAGE_W + ' ' + PAGE_H + ']'
    + ' /Resources << /Font << /F1 4 0 R >>' + xobj + ' >> /Contents 6 0 R >>\nendobj\n');
  // 4: Font
  startObj();
  push('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n');
  // 5: Image XObject (JPEG) — siempre se numera el 5 aunque no haya imagen,
  // para mantener fijas las referencias; si no hay, se emite un objeto nulo.
  startObj();
  if (image) {
    push('5 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + image.width + ' /Height ' + image.height
      + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.length + ' >>\nstream\n');
    push(jpeg);
    push('\nendstream\nendobj\n');
  } else {
    push('5 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 1 1] /Length 0 >>\nstream\n\nendstream\nendobj\n');
  }
  // 6: Contents
  startObj();
  push('6 0 obj\n<< /Length ' + content.length + ' >>\nstream\n');
  push(content);
  push('\nendstream\nendobj\n');

  // Tabla xref.
  const xrefStart = offset;
  const count = offsets.length + 1; // +1 por el objeto libre 0
  let xref = 'xref\n0 ' + count + '\n0000000000 65535 f \n';
  for (const off of offsets) {
    xref += String(off).padStart(10, '0') + ' 00000 n \n';
  }
  push(xref);
  push('trailer\n<< /Size ' + count + ' /Root 1 0 R >>\nstartxref\n' + xrefStart + '\n%%EOF');

  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------------------
// PDF de texto con varias páginas (para el dossier del cliente).
//   opts = { title, lines }
//   lines = array de { t, bold?, size?, gap?, color? } o cadenas simples.
// Pagina automáticamente cuando el texto no cabe en la página.
// ---------------------------------------------------------------------------
function buildTextPdf(opts) {
  const title = opts.title || 'Documento';
  const items = (opts.lines || []).map((l) => (typeof l === 'string' ? { t: l } : l));
  const maxWidth = PAGE_W - 2 * MARGIN;

  // Reparte el contenido en páginas (cada una es un array de operadores PDF).
  const pages = [];
  let ops = [];
  let y = PAGE_H - MARGIN;
  const newPage = () => { pages.push(ops); ops = []; y = PAGE_H - MARGIN; };

  const drawLine = (text, { bold = false, size = FONT_SIZE, color = null } = {}) => {
    const font = bold ? '/F2' : '/F1';
    const rgb = color ? `${color[0]} ${color[1]} ${color[2]} rg ` : '0 0 0 rg ';
    ops.push('BT ' + rgb + font + ' ' + size + ' Tf ' + MARGIN + ' ' + y.toFixed(1)
      + ' Td (' + escapePdfText(toWinAnsi(text)) + ') Tj ET');
  };
  // Igual que drawLine pero con posición X libre (para la cabecera/membrete).
  const drawAt = (text, x, yy, { bold = false, size = FONT_SIZE, color = null } = {}) => {
    const font = bold ? '/F2' : '/F1';
    const rgb = color ? `${color[0]} ${color[1]} ${color[2]} rg ` : '0 0 0 rg ';
    ops.push('BT ' + rgb + font + ' ' + size + ' Tf ' + x.toFixed(1) + ' ' + yy.toFixed(1)
      + ' Td (' + escapePdfText(toWinAnsi(text)) + ') Tj ET');
  };

  // Cabecera (membrete) de la primera página: logotipo «B» + nombre + datos.
  //   header = { name, tagline, info: [líneas], mark?: bool (por defecto true) }
  if (opts.header) {
    const h = opts.header;
    const S = 34;                 // lado del logotipo
    const top = y;                // borde superior del logo
    const bottom = top - S;
    if (h.mark !== false) {
      // Cuadrado redondeado oscuro (#1d1d1b).
      const r = 7;
      const x0 = MARGIN;
      const x1 = MARGIN + S;
      const y0 = bottom;
      const y1 = top;
      const c = (a, b) => `${a.toFixed(1)} ${b.toFixed(1)}`;
      ops.push('q 0.114 0.114 0.106 rg');
      ops.push(`${c(x0, y0 + r)} m`);
      ops.push(`${c(x0, y1 - r)} l`);
      ops.push(`${c(x0, y1)} ${c(x0 + r, y1)} ${c(x0 + r, y1)} c`);
      ops.push(`${c(x1 - r, y1)} l`);
      ops.push(`${c(x1, y1)} ${c(x1, y1 - r)} ${c(x1, y1 - r)} c`);
      ops.push(`${c(x1, y0 + r)} l`);
      ops.push(`${c(x1, y0)} ${c(x1 - r, y0)} ${c(x1 - r, y0)} c`);
      ops.push(`${c(x0 + r, y0)} l`);
      ops.push(`${c(x0, y0)} ${c(x0, y0 + r)} ${c(x0, y0 + r)} c`);
      ops.push('f Q');
      // «B» blanca centrada.
      ops.push('BT 1 1 1 rg /F2 23 Tf ' + (MARGIN + 9.5).toFixed(1) + ' ' + (bottom + 9).toFixed(1)
        + ' Td (B) Tj ET');
    }
    const tx = (h.mark === false) ? MARGIN : MARGIN + S + 12;
    if (h.name) drawAt(h.name, tx, top - 13, { bold: true, size: 15 });
    if (h.tagline) drawAt(h.tagline, tx, top - 26, { size: 8.5, color: [0.45, 0.45, 0.45] });
    // Datos de contacto bajo el logo.
    let iy = bottom - 15;
    for (const line of (h.info || [])) {
      drawAt(line, MARGIN, iy, { size: 8.5, color: [0.35, 0.35, 0.35] });
      iy -= 11.5;
    }
    // Línea separadora.
    const sepY = Math.min(bottom, iy) - 4;
    ops.push(`0.8 0.8 0.8 RG 0.6 w ${MARGIN} ${sepY.toFixed(1)} m ${(PAGE_W - MARGIN)} ${sepY.toFixed(1)} l S`);
    y = sepY - 22;
  }

  // Título en la primera página.
  drawLine(title, { bold: true, size: TITLE_SIZE });
  y -= TITLE_SIZE + 12;

  for (const it of items) {
    const size = it.size || FONT_SIZE;
    const leading = size * 1.45;
    if (it.gap) y -= it.gap;
    const wrapped = it.t === '' ? [''] : wrapLine(String(it.t), maxWidth, size * (it.bold ? 1.05 : 1));
    for (const sub of wrapped) {
      if (y < MARGIN + leading) newPage();
      if (sub !== '') drawLine(sub, { bold: it.bold, size, color: it.color });
      y -= leading;
    }
  }
  pages.push(ops);

  // Ensamblado de objetos.
  const chunks = [];
  let offset = 0;
  const offsets = [];
  const push = (buf) => {
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf, 'latin1');
    chunks.push(b);
    offset += b.length;
  };
  const startObj = () => { offsets.push(offset); };

  push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  // 1: Catalog, 2: Pages, 3: F1, 4: F2, luego pares página/contenido.
  const pageObjNums = pages.map((_, i) => 5 + i * 2);
  startObj();
  push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  startObj();
  push('2 0 obj\n<< /Type /Pages /Kids [' + pageObjNums.map((n) => n + ' 0 R').join(' ')
    + '] /Count ' + pages.length + ' >>\nendobj\n');
  startObj();
  push('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n');
  startObj();
  push('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n');
  pages.forEach((pageOps, i) => {
    const pageNum = 5 + i * 2;
    const contentNum = 6 + i * 2;
    startObj();
    push(pageNum + ' 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PAGE_W + ' ' + PAGE_H + ']'
      + ' /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + contentNum + ' 0 R >>\nendobj\n');
    startObj();
    const content = Buffer.from(pageOps.join('\n'), 'latin1');
    push(contentNum + ' 0 obj\n<< /Length ' + content.length + ' >>\nstream\n');
    push(content);
    push('\nendstream\nendobj\n');
  });

  const xrefStart = offset;
  const count = offsets.length + 1;
  let xref = 'xref\n0 ' + count + '\n0000000000 65535 f \n';
  for (const off of offsets) xref += String(off).padStart(10, '0') + ' 00000 n \n';
  push(xref);
  push('trailer\n<< /Size ' + count + ' /Root 1 0 R >>\nstartxref\n' + xrefStart + '\n%%EOF');

  return Buffer.concat(chunks);
}

module.exports = { buildSignedPdf, buildTextPdf, jpegSize, layoutParagraphs };
