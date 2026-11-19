import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
import { displayName, listStudents, listTeachers, studentsOfTeacher } from './election.js';

const ORDINAL = { 1: '1r', 2: '2n', 3: '3r', 4: '4t' };
const classLabel = (s) => (s.curso ? `${ORDINAL[s.curso]} ${s.grupo}` : '—');
const font = (name) => fileURLToPath(new URL(`./fonts/Geist-${name}.ttf`, import.meta.url));
const LOGO = fileURLToPath(new URL('../public/assets/logo-lescarolines.png', import.meta.url));
const LOGO_RATIO = 292 / 75;
// A 146 pt el PNG de 292 px queda a unos 144 ppp: es lo más grande que aguanta bien impreso.
const LOGO_WIDTH = 160;

// Cartel A3 vertical. Mismos colores que la aplicación: tinta, un azul y un fondo azul-gris.
const PAGE = { size: 'A3', width: 841.89, height: 1190.55, margin: 28 };
const INK = '#141414';
const MUTED = '#5d6168';
const RULE = '#e3e6eb';
const TINT = '#eaf1fc';
const ZEBRA = '#f6f8fc';
const HUE = '#1d5fbf';
const HUE_LIGHT = '#4f86e0';
const ACCENT = ['#1d5fbf', '#6558ad', '#2e9d85'];
const LABEL = '#7a8597';
const RADIUS = 9;

// Rectángulo con solo las esquinas de arriba redondeadas.
function topRounded(doc, x, y, w, h, r) {
  r = Math.min(r, h, w / 2);
  doc.moveTo(x, y + h).lineTo(x, y + r).quadraticCurveTo(x, y, x + r, y)
    .lineTo(x + w - r, y).quadraticCurveTo(x + w, y, x + w, y + r).lineTo(x + w, y + h).closePath();
}
const headFill = (doc, table, x, y, w) => {
  const [a, b] = table.tone === INK ? [HUE, HUE_LIGHT] : ['#6b7280', '#9aa1ad'];
  return doc.linearGradient(x, y, x + w, y).stop(0, a).stop(1, b);
};
const COLUMN_GAP = 14;
const TABLE_GAP = 14;
const FOOTER = 34;
const CELL_X = 10;
const CLASS_WIDTH = 34;
// Se usa el primero en que todo cabe en una hoja: con pocos datos, letra grande; con muchos, más columnas.
// Si ninguno cabe, el cartel ocupa varias hojas con el tamaño más legible de tres columnas.
const LAYOUTS = [
  { columns: 2, scale: 1.35 },
  { columns: 3, scale: 1 },
  { columns: 3, scale: 0.88 },
  { columns: 4, scale: 0.8 },
];
const FALLBACK_LAYOUT = LAYOUTS[1];

/**
 * Reparte tablas en columnas y páginas, conservando el orden alfabético. Una tabla salta entera a
 * la columna siguiente si así cabe; solo se parte cuando no cabe en una columna vacía (no hay cupo
 * por profesor) o cuando le quedan al menos 3 filas donde está.
 * Cada tabla es { head, continuedHead, rows: [altura de cada fila] }.
 */
export function flowTables(tables, { columns, firstTop, top, bottom, gap }) {
  const pages = [[]];
  let page = 0;
  let column = 0;
  let y = firstTop;
  const topOf = (index) => (index === 0 ? firstTop : top);
  const nextColumn = () => {
    column += 1;
    if (column === columns) {
      column = 0;
      page += 1;
      pages.push([]);
    }
    y = topOf(page);
  };

  tables.forEach((table, index) => {
    const total = table.head + table.rows.reduce((sum, row) => sum + row, 0);
    const fitsEmptyColumn = total <= bottom - top;
    let start = 0;
    while (start < table.rows.length) {
      const head = start === 0 ? table.head : table.continuedHead;
      let end = start;
      let height = head;
      while (end < table.rows.length && y + height + table.rows[end] <= bottom) height += table.rows[end++];
      const atTop = y === topOf(page);
      if (end < table.rows.length && !atTop && ((start === 0 && fitsEmptyColumn) || end - start < 3)) {
        nextColumn();
        continue;
      }
      // Una fila más alta que la columna se coloca igualmente: nunca se queda sin avanzar.
      if (end === start) height += table.rows[end++];
      pages[page].push({ index, column, y, height, start, end, continued: start > 0 });
      y += height + gap;
      start = end;
      if (start < table.rows.length) nextColumn();
    }
  });
  return pages;
}

// Altura mínima de columna con la que todo sigue cabiendo en una hoja, para que las columnas acaben
// parejas y no se llene la primera dejando vacías las demás. No parte tablas que cabrían enteras.
export function balancedBottom(tables, area) {
  if (flowTables(tables, area).length > 1) return area.bottom;
  const tallest = Math.max(0, ...tables.map((table) => table.head + table.rows.reduce((sum, row) => sum + row, 0)));
  let low = Math.min(area.firstTop + tallest, area.bottom);
  if (flowTables(tables, { ...area, bottom: low }).length === 1) return low;
  let high = area.bottom;
  for (let step = 0; step < 14; step += 1) {
    const middle = (low + high) / 2;
    if (flowTables(tables, { ...area, bottom: middle }).length === 1) high = middle;
    else low = middle;
  }
  return high;
}

function measure(doc, table, width, scale) {
  const inner = width - CELL_X * 2;
  const heightOf = (text, name, size, w = inner) => doc.font(name).fontSize(size * scale).heightOfString(text, { width: w });
  const countWidth = 32 * scale;
  const metrics = {
    nameH: heightOf(table.title, 'bold', 13, inner - countWidth),
    subH: table.subtitle ? heightOf(table.subtitle, 'regular', 9.5) : 0,
    placeLabelH: table.place === undefined ? 0 : heightOf('Lloc de reunió', 'regular', 8.5),
    placeH: table.place === undefined ? 0 : heightOf(table.place || 'sense definir', 'bold', 11),
    tableHeadH: 20 * scale,
    contNameH: heightOf(`${table.title} (continuació)`, 'bold', 10.5),
  };
  const band = metrics.nameH + (metrics.subH ? metrics.subH + 2 : 0) + 16 * scale;
  const placeBand = table.place === undefined ? 0 : metrics.placeLabelH + metrics.placeH + 3 + 14 * scale;
  metrics.band = band;
  metrics.placeBand = placeBand;
  metrics.contBand = metrics.contNameH + 10 * scale;
  const nameWidth = table.hideClass ? inner : inner - CLASS_WIDTH * scale;
  const rows = table.students.length
    ? table.students.map((s) => heightOf(displayName(s), 'regular', 10.5, nameWidth) + 8 * scale)
    : [6 * scale]; // El aviso «Sense alumnat confirmat» ocupa la fila de cabecera.
  return {
    metrics,
    head: band + placeBand + metrics.tableHeadH,
    continuedHead: metrics.contBand + metrics.tableHeadH,
    rows,
  };
}

function drawTable(doc, table, placed, measured, x, width, scale) {
  const { metrics, rows } = measured;
  const inner = width - CELL_X * 2;
  let y = placed.y;
  const text = (value, name, size, color, tx, ty, options) => doc.font(name).fontSize(size * scale).fillColor(color).text(value, tx, ty, options);

  if (placed.continued) {
    topRounded(doc, x, y, width, metrics.contBand, RADIUS * scale);
    doc.fill(headFill(doc, table, x, y, width));
    text(`${table.title} (continuació)`, 'bold', 10.5, '#ffffff', x + CELL_X, y + 5 * scale, { width: inner });
    y += metrics.contBand;
  } else {
    topRounded(doc, x, y, width, metrics.band, RADIUS * scale);
    doc.fill(headFill(doc, table, x, y, width));
    const countWidth = 32 * scale;
    text(table.title, 'bold', 13, '#ffffff', x + CELL_X, y + 8 * scale, { width: inner - countWidth });
    // El número d'alumnes, en una càpsula blanca.
    const pillH = 17 * scale;
    const pillW = Math.max(pillH, doc.font('bold').fontSize(10.5 * scale).widthOfString(String(table.students.length)) + 12 * scale);
    const pillX = x + width - CELL_X - pillW;
    doc.roundedRect(pillX, y + 7 * scale, pillW, pillH, pillH / 2).fill('#ffffff');
    text(String(table.students.length), 'bold', 10.5, table.tone === INK ? HUE : MUTED, pillX, y + 9.5 * scale, { width: pillW, align: 'center', features: ['tnum'] });
    if (table.subtitle) text(table.subtitle, 'regular', 9.5, '#e6eefc', x + CELL_X, y + 8 * scale + metrics.nameH + 2, { width: inner });
    y += metrics.band;
    if (table.place !== undefined) {
      doc.rect(x, y, width, metrics.placeBand).fill(TINT);
      text('LLOC DE REUNIÓ', 'bold', 7.5, '#4f6b99', x + CELL_X, y + 7 * scale, { width: inner, characterSpacing: 0.6 });
      text(table.place || 'sense definir', 'bold', 11, table.place ? INK : MUTED, x + CELL_X, y + 7 * scale + metrics.placeLabelH + 3, { width: inner });
      y += metrics.placeBand;
    }
  }

  // Cabecera de columnas de la tabla.
  text(table.students.length ? 'ALUMNE' : '', 'bold', 7.5, LABEL, x + CELL_X, y + 7 * scale, { width: inner, characterSpacing: 0.6 });
  if (table.students.length && !table.hideClass) text('CLASSE', 'bold', 7.5, LABEL, x + width - CELL_X - 40 * scale, y + 7 * scale, { width: 40 * scale, align: 'right', characterSpacing: 0.6 });
  y += metrics.tableHeadH;

  if (!table.students.length) {
    text('Sense alumnat confirmat', 'regular', 10.5, MUTED, x + CELL_X, y - metrics.tableHeadH + 6 * scale, { width: inner });
    return;
  }
  for (let i = placed.start; i < placed.end; i += 1) {
    const student = table.students[i];
    if (i % 2) doc.rect(x, y, width, rows[i]).fill(ZEBRA);
    doc.moveTo(x, y).lineTo(x + width, y).lineWidth(0.6).strokeColor(RULE).stroke();
    text(displayName(student), 'regular', 10.5, INK, x + CELL_X, y + 4 * scale, { width: table.hideClass ? inner : inner - CLASS_WIDTH * scale });
    if (!table.hideClass) text(classLabel(student), 'regular', 10.5, MUTED, x + width - CELL_X - CLASS_WIDTH * scale, y + 4 * scale, { width: CLASS_WIDTH * scale, align: 'right', features: ['tnum'] });
    y += rows[i];
  }
  doc.moveTo(x, y).lineTo(x + width, y).lineWidth(1.2).strokeColor(table.tone === INK ? '#c9d8f2' : RULE).stroke();
}

function bannerMetrics(doc, election, open) {
  const width = PAGE.width - PAGE.margin * 2;
  const helpWidth = 270;
  const textWidth = width;
  const titleH = doc.font('bold').fontSize(24).heightOfString(election.title, { width: textWidth });
  const help = open
    ? 'Llista provisional: les eleccions encara estan obertes.'
    : 'Busca el teu nom. El teu tutor i el lloc de reunió estan a la capçalera de la teua taula.';
  const helpH = doc.font('regular').fontSize(12.5).heightOfString(help, { width: helpWidth - 32 });
  const top = Math.max(LOGO_WIDTH / LOGO_RATIO, helpH + 24) + 22;
  return { width, helpWidth, textWidth, titleH, help, helpH, top, height: top + 58 + titleH + 18 + 6 };
}

// Capçalera del cartell: fons blanc, el logo tal qual (transparent), títol en blau i una franja de color.
function drawBanner(doc, election, banner) {
  const { width, helpWidth, textWidth, helpH, top } = banner;
  const x = PAGE.margin;
  const y = PAGE.margin;
  doc.image(LOGO, x, y + 4, { width: LOGO_WIDTH });
  const helpX = x + width - helpWidth;
  doc.roundedRect(helpX, y, helpWidth, helpH + 24, 14).fill(TINT);
  doc.font('regular').fontSize(12.5).fillColor('#2c4a7c').text(banner.help, helpX + 16, y + 12, { width: helpWidth - 32 });
  doc.font('bold').fontSize(48).fillColor(HUE).text('Tutoria personal', x, y + top, { width: textWidth, lineBreak: false });
  doc.font('bold').fontSize(24).fillColor(INK).text(election.title, x, y + top + 58, { width: textWidth });
  const barY = y + top + 58 + banner.titleH + 18;
  const grad = doc.linearGradient(x, barY, x + width, barY);
  ACCENT.forEach((c, k) => grad.stop(k / (ACCENT.length - 1), c));
  doc.roundedRect(x, barY, width, 6, 3).fill(grad);
}

// Logo pequeño arriba a la derecha en las hojas sin banda azul.
function drawCornerLogo(doc) {
  const height = 24;
  const width = height * LOGO_RATIO;
  doc.image(LOGO, PAGE.width - PAGE.margin - width, PAGE.margin - 4, { width });
}

function drawRunningHead(doc, election) {
  doc.font('bold').fontSize(14).fillColor(INK).text(`Tutoria personal · ${election.title}`, PAGE.margin, PAGE.margin, { width: PAGE.width - PAGE.margin * 2 - 120, lineBreak: false });
  drawCornerLogo(doc);
}

function drawFooter(doc, label, page, pages) {
  const y = PAGE.height - PAGE.margin - 10;
  const width = PAGE.width - PAGE.margin * 2;
  doc.font('regular').fontSize(9).fillColor(MUTED);
  doc.text(`Escola Les Carolines · ${label}`, PAGE.margin, y, { width: width - 90, lineBreak: false });
  doc.text(`Pàgina ${page} de ${pages}`, PAGE.margin, y, { width, align: 'right', lineBreak: false, features: ['tnum'] });
}

function pendingByClass(students) {
  const label = (s) => (s.curso ? `${ORDINAL[s.curso]} ${s.grupo}` : 'Sense classe');
  const order = (s) => (s.curso ? `${s.curso}${s.grupo}` : '9');
  const groups = new Map();
  for (const s of [...students].sort((a, b) => order(a).localeCompare(order(b)))) {
    if (!groups.has(label(s))) groups.set(label(s), []);
    groups.get(label(s)).push(s);
  }
  return [...groups].map(([title, members]) => ({ title, subtitle: '', students: members, tone: MUTED, hideClass: true }));
}

// Escribe en `out` el cartel: una tabla por tutor y, en hoja aparte, quien aún no tiene tutor.
// Con `only` ({ curso, grupo }) sale solo esa clase: cada tutor con su alumnado de la clase.
export function writeReport(db, election, out, only = null) {
  const inClass = (s) => !only || (s.curso === only.curso && s.grupo === only.grupo);
  const classTitle = only ? `${ORDINAL[only.curso]} ${only.grupo}` : null;
  const doc = new PDFDocument({
    autoFirstPage: false,
    lang: 'ca-ES',
    displayTitle: true,
    info: { Title: `Tutoria personal: ${election.title}`, Author: 'Escola Les Carolines' },
  });
  doc.registerFont('regular', font('Regular'));
  doc.registerFont('bold', font('SemiBold'));
  doc.pipe(out);

  const open = !election.closed_at;
  const tutors = listTeachers(db).map((teacher) => ({
    title: displayName(teacher),
    subtitle: teacher.department ?? '',
    place: teacher.meeting_place ?? '',
    students: studentsOfTeacher(db, election.id, teacher.id).filter(inClass),
    tone: INK,
    hideClass: Boolean(only),
  })).filter((table) => !only || table.students.length);
  const unassigned = listStudents(db, election).filter((s) => !s.tutorId && inClass(s));
  // En el cartel de una clase, la clase va junto al título.
  if (classTitle) election = { ...election, title: `${election.title} · ${classTitle}` };

  const banner = bannerMetrics(doc, election, open);
  const contentWidth = PAGE.width - PAGE.margin * 2;
  const bottom = PAGE.height - PAGE.margin - FOOTER;
  const area = { firstTop: PAGE.margin + banner.height + TABLE_GAP, top: PAGE.margin + 32, bottom, gap: TABLE_GAP };

  const build = ({ columns, scale }) => {
    const width = (contentWidth - COLUMN_GAP * (columns - 1)) / columns;
    const measured = tutors.map((table) => measure(doc, table, width, scale));
    const options = { ...area, columns };
    return { columns, scale, width, measured, pages: flowTables(measured, { ...options, bottom: balancedBottom(measured, options) }) };
  };
  const layout = LAYOUTS.map(build).find((option) => option.pages.length === 1) ?? build(FALLBACK_LAYOUT);

  // El alumnado sin tutor va en su hoja, por clases, para poder colgar el cartel sin ella.
  const pendingWidth = (contentWidth - COLUMN_GAP * 2) / 3;
  const pendingTables = pendingByClass(unassigned);
  const pendingMeasured = pendingTables.map((table) => measure(doc, table, pendingWidth, 1));
  const pendingTop = PAGE.margin + 64;
  const pendingArea = { columns: 3, firstTop: pendingTop, top: pendingTop, bottom, gap: TABLE_GAP };
  const pendingPages = pendingTables.length
    ? flowTables(pendingMeasured, { ...pendingArea, bottom: balancedBottom(pendingMeasured, pendingArea) })
    : [];
  const total = layout.pages.length + pendingPages.length;
  const generated = `Generat el ${new Date().toLocaleDateString('ca-ES')}`;

  layout.pages.forEach((placedTables, pageIndex) => {
    doc.addPage({ size: PAGE.size, margin: 0 });
    if (pageIndex === 0) drawBanner(doc, election, banner);
    else drawRunningHead(doc, election);
    if (pageIndex === 0 && !tutors.length) {
      doc.font('regular').fontSize(16).fillColor(MUTED)
        .text(classTitle ? `Encara ningú de ${classTitle} té tutor assignat.` : 'Encara no hi ha tutors assignats.', PAGE.margin, area.firstTop + 10, { width: contentWidth });
    }
    for (const placed of placedTables) {
      const x = PAGE.margin + placed.column * (layout.width + COLUMN_GAP);
      drawTable(doc, tutors[placed.index], placed, layout.measured[placed.index], x, layout.width, layout.scale);
    }
    drawFooter(doc, generated, pageIndex + 1, total);
  });

  pendingPages.forEach((placedTables, pageIndex) => {
    doc.addPage({ size: PAGE.size, margin: 0 });
    drawCornerLogo(doc);
    doc.font('bold').fontSize(23).fillColor(INK).text('Alumnat sense tutor', PAGE.margin, PAGE.margin, { lineBreak: false });
    doc.font('regular').fontSize(12).fillColor(MUTED).text("Per a l'administració: esta pàgina no forma part del cartell.", PAGE.margin, PAGE.margin + 30, { lineBreak: false });
    for (const placed of placedTables) {
      const x = PAGE.margin + placed.column * (pendingWidth + COLUMN_GAP);
      drawTable(doc, pendingTables[placed.index], placed, pendingMeasured[placed.index], x, pendingWidth, 1);
    }
    drawFooter(doc, generated, layout.pages.length + pageIndex + 1, total);
  });

  doc.end();
}
