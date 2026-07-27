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

module.exports = { buildSignedPdf, jpegSize, layoutParagraphs };
