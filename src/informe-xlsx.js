// Informe en Excel: resumen, alumnado, profesorado y alumnado agrupado por tutor.
import {
  confirmedCount, displayName, electionStats, latestElection, listStudents, listTeachers, studentsOfTeacher, teacherLimit,
} from './election.js';
import { columnName, writeWorkbook } from './xlsx.js';

const DOMAIN = 'lescarolines.com';
const ORDINAL = { 1: '1r', 2: '2n', 3: '3r', 4: '4t' };
const classLabel = (s) => (s.curso ? `${ORDINAL[s.curso]} ${s.grupo}` : 'Sense classe');

const COLORS = {
  ink: '1F2937', muted: '5B6577', deep: '23386B', brand: '3B5BA9', violet: '6558AD',
  band: 'F4F7FC', line: 'D7DEEA', head: 'E8EEF9',
};
const STATUS = {
  asignado: { label: 'Confirmat', fill: 'DCF3E4', color: '1E6B3A' },
  en_proceso: { label: "A l'espera", fill: 'FFF1D6', color: '8A5A00' },
  agotada: { label: 'Rebutjat per tota la llista', fill: 'FBE1E3', color: 'A3232D' },
  por_contestar: { label: 'Sense contestar', fill: 'EEF1F6', color: '4B5565' },
  sin_respuesta: { label: 'No va contestar', fill: 'FBE1E3', color: 'A3232D' },
  sin_convocatoria: { label: '—', fill: 'EEF1F6', color: '4B5565' },
};

const S = {
  title: { bold: true, size: 18, color: 'FFFFFF', fill: COLORS.deep, valign: 'center' },
  subtitle: { italic: true, size: 10, color: 'E3E9F7', fill: COLORS.deep },
  section: { bold: true, size: 13, color: COLORS.deep },
  header: { bold: true, color: 'FFFFFF', fill: COLORS.brand, border: 'thin', borderColor: COLORS.brand, align: 'left' },
  headerNum: { bold: true, color: 'FFFFFF', fill: COLORS.brand, border: 'thin', borderColor: COLORS.brand, align: 'center' },
  cell: (band) => ({ border: 'thin', borderColor: COLORS.line, ...(band ? { fill: COLORS.band } : {}) }),
  num: (band) => ({ border: 'thin', borderColor: COLORS.line, align: 'center', ...(band ? { fill: COLORS.band } : {}) }),
  pct: (band) => ({ border: 'thin', borderColor: COLORS.line, align: 'center', numFmt: '0%', ...(band ? { fill: COLORS.band } : {}) }),
  bold: (band) => ({ bold: true, border: 'thin', borderColor: COLORS.line, ...(band ? { fill: COLORS.band } : {}) }),
  muted: (band) => ({ color: COLORS.muted, border: 'thin', borderColor: COLORS.line, ...(band ? { fill: COLORS.band } : {}) }),
  status: (status) => ({ bold: true, align: 'center', border: 'thin', borderColor: COLORS.line, fill: STATUS[status].fill, color: STATUS[status].color }),
  kpiLabel: (fill, color) => ({ bold: true, size: 10, color, fill, align: 'center', border: 'thin', borderColor: 'FFFFFF' }),
  kpiValue: (fill, color, pct = false) => ({ bold: true, size: 22, color, fill, align: 'center', border: 'thin', borderColor: 'FFFFFF', ...(pct ? { numFmt: '0%' } : {}) }),
  total: { bold: true, border: 'thin', borderColor: COLORS.line, fill: COLORS.head },
  totalNum: { bold: true, align: 'center', border: 'thin', borderColor: COLORS.line, fill: COLORS.head },
  totalPct: { bold: true, align: 'center', border: 'thin', borderColor: COLORS.line, fill: COLORS.head, numFmt: '0%' },
  free: (n) => ({ bold: true, align: 'center', border: 'thin', borderColor: COLORS.line, ...(n === 0 ? { fill: 'FBE1E3', color: 'A3232D' } : { fill: 'DCF3E4', color: '1E6B3A' }) }),
  group: (fill) => ({ bold: true, size: 12, color: 'FFFFFF', fill }),
  groupMeta: (fill) => ({ size: 10, color: 'F2F4FA', fill }),
};

const madrid = (ms) => new Intl.DateTimeFormat('ca-ES', {
  timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
}).format(new Date(ms));

// Título a lo ancho de la hoja: dos filas con el color de la casa.
function banner(title, subtitle, width) {
  const last = columnName(width - 1);
  return {
    rows: [
      { height: 34, cells: [{ v: title, s: S.title }, ...Array(width - 1).fill({ v: '', s: S.title })] },
      { height: 20, cells: [{ v: subtitle, s: S.subtitle }, ...Array(width - 1).fill({ v: '', s: S.subtitle })] },
      { height: 8, cells: [] },
    ],
    merges: [`A1:${last}1`, `A2:${last}2`],
  };
}

const tutorColors = ['3B5BA9', '6558AD', '2E7D6B', 'B4553A', '7A5BB0', '2F6E9E', '8E4E7A', '4F7A2E'];

export function buildReport(db) {
  const election = latestElection(db);
  const students = listStudents(db, election);
  const teachers = listTeachers(db);
  const teacherById = new Map(teachers.map((t) => [t.id, t]));
  const stats = electionStats(students);
  const subtitle = `${election ? `Eleccions: ${election.title}` : 'Sense eleccions'} · Generat el ${madrid(Date.now())}`;

  // --- Resum ---
  const kpis = [
    ['Alumnat', stats.students, 'E8EEF9', COLORS.deep],
    ['Han votat', stats.confirmed + stats.waiting, 'E9E5F7', COLORS.violet],
    ['Confirmats', stats.confirmed, 'DCF3E4', '1E6B3A'],
    ["A l'espera", stats.waiting, 'FFF1D6', '8A5A00'],
    ['Sense contestar', stats.unanswered, 'EEF1F6', '4B5565'],
    ['Participació', stats.students ? (stats.confirmed + stats.waiting) / stats.students : 0, 'E8EEF9', COLORS.brand, true],
  ];
  const resum = banner('Tutoria personal · Resum', subtitle, 6);
  resum.rows.push(
    { height: 22, cells: kpis.map(([label, , fill, color]) => ({ v: label, s: S.kpiLabel(fill, color) })) },
    { height: 40, cells: kpis.map(([, value, fill, color, pct]) => ({ v: value, s: S.kpiValue(fill, color, pct) })) },
    { height: 12, cells: [] },
    { height: 22, cells: [{ v: 'Participació per classe', s: S.section }] },
    { height: 22, cells: ['Classe', 'Alumnes', 'Confirmats', "A l'espera", 'Sense contestar', 'Participació'].map((v, i) => ({ v, s: i ? S.headerNum : S.header })) },
  );
  const classes = [];
  for (const curso of [1, 2, 3, 4]) for (const grupo of ['A', 'B']) classes.push({ label: `${ORDINAL[curso]} ${grupo}`, list: students.filter((s) => s.curso === curso && s.grupo === grupo) });
  const noClass = students.filter((s) => !s.curso);
  if (noClass.length) classes.push({ label: 'Sense classe', list: noClass });
  classes.forEach(({ label, list }, i) => {
    const c = electionStats(list);
    const band = i % 2 === 1;
    resum.rows.push({ cells: [
      { v: label, s: S.bold(band) }, { v: c.students, s: S.num(band) }, { v: c.confirmed, s: S.num(band) },
      { v: c.waiting, s: S.num(band) }, { v: c.unanswered, s: S.num(band) },
      { v: c.students ? (c.confirmed + c.waiting) / c.students : 0, s: S.pct(band) },
    ] });
  });
  resum.rows.push({ cells: [
    { v: 'Total', s: S.total }, { v: stats.students, s: S.totalNum }, { v: stats.confirmed, s: S.totalNum },
    { v: stats.waiting, s: S.totalNum }, { v: stats.unanswered, s: S.totalNum },
    { v: stats.students ? (stats.confirmed + stats.waiting) / stats.students : 0, s: S.totalPct },
  ] });

  // --- Alumnat ---
  const alumnatHead = ['Cognoms', 'Nom', 'Correu', 'Classe', 'Estat', 'Tutor', 'Departament', 'Lloc de reunió'];
  const alumnat = banner('Alumnat', subtitle, alumnatHead.length);
  alumnat.rows.push({ height: 22, cells: alumnatHead.map((v) => ({ v, s: S.header })) });
  students.forEach((s, i) => {
    const band = i % 2 === 1;
    const tutor = s.tutorId ? teacherById.get(s.tutorId) : null;
    alumnat.rows.push({ cells: [
      { v: s.last_name, s: S.bold(band) }, { v: s.first_name, s: S.cell(band) },
      { v: `${s.username}@${DOMAIN}`, s: S.muted(band) }, { v: classLabel(s), s: S.num(band) },
      { v: STATUS[s.status].label, s: S.status(s.status) },
      { v: tutor ? displayName(tutor) : '', s: S.cell(band) },
      { v: tutor?.department ?? '', s: S.muted(band) }, { v: tutor?.meeting_place ?? '', s: S.muted(band) },
    ] });
  });

  // --- Professorat ---
  const profHead = ['Cognoms', 'Nom', 'Correu', 'Departament', 'Tutor de grup', 'Alumnes', 'Límit', 'Places lliures', 'Pendents', 'Lloc de reunió'];
  const professorat = banner('Professorat', subtitle, profHead.length);
  professorat.rows.push({ height: 22, cells: profHead.map((v, i) => ({ v, s: i >= 5 && i <= 8 ? S.headerNum : S.header })) });
  teachers.forEach((t, i) => {
    const band = i % 2 === 1;
    const count = election ? confirmedCount(db, election.id, t.id) : 0;
    const limit = teacherLimit(db, t);
    const pending = election ? db.prepare(`SELECT COUNT(*) AS n FROM requests WHERE election_id = ? AND teacher_id = ? AND status = 'pendiente'`).get(election.id, t.id).n : 0;
    const free = limit === null ? null : Math.max(limit - count, 0);
    professorat.rows.push({ cells: [
      { v: t.last_name, s: S.bold(band) }, { v: t.first_name, s: S.cell(band) },
      { v: `${t.username}@${DOMAIN}`, s: S.muted(band) }, { v: t.department ?? '', s: S.cell(band) },
      { v: t.tutor_group ? `${ORDINAL[t.tutor_group[0]]} ${t.tutor_group[1]}` : '', s: S.num(band) },
      { v: count, s: S.num(band) }, { v: limit ?? 'Sense límit', s: S.num(band) },
      { v: free ?? '—', s: free === null ? S.num(band) : S.free(free) }, { v: pending, s: S.num(band) },
      { v: t.meeting_place ?? '', s: S.muted(band) },
    ] });
  });

  // --- Per tutor ---
  const perTutor = banner('Alumnat per tutor', subtitle, 4);
  if (election) {
    teachers.forEach((t, i) => {
      const fill = tutorColors[i % tutorColors.length];
      const list = studentsOfTeacher(db, election.id, t.id);
      const meta = [t.department, t.meeting_place ? `Reunió: ${t.meeting_place}` : null, `${list.length} ${list.length === 1 ? 'alumne' : 'alumnes'}`].filter(Boolean).join(' · ');
      const row = perTutor.rows.length + 1;
      perTutor.rows.push({ height: 24, cells: [{ v: displayName(t), s: S.group(fill) }, { v: '', s: S.group(fill) }, { v: meta, s: S.groupMeta(fill) }, { v: '', s: S.groupMeta(fill) }] });
      perTutor.merges.push(`A${row}:B${row}`, `C${row}:D${row}`);
      if (!list.length) perTutor.rows.push({ cells: [{ v: 'Encara no té alumnes.', s: { italic: true, color: COLORS.muted } }] });
      list.forEach((s, j) => {
        const band = j % 2 === 1;
        perTutor.rows.push({ cells: [
          { v: s.last_name, s: S.bold(band) }, { v: s.first_name, s: S.cell(band) },
          { v: classLabel(s), s: S.num(band) }, { v: `${s.username}@${DOMAIN}`, s: S.muted(band) },
        ] });
      });
      perTutor.rows.push({ height: 10, cells: [] });
    });
  }

  const headerRow = 4;
  return writeWorkbook([
    { name: 'Resum', tabColor: COLORS.deep, columns: [{ width: 22 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 18 }, { width: 16 }], ...resum },
    {
      name: 'Alumnat', tabColor: '2E7D6B', ...alumnat, freeze: { row: headerRow },
      autoFilter: `A${headerRow}:H${Math.max(headerRow + students.length, headerRow + 1)}`,
      columns: [{ width: 22 }, { width: 16 }, { width: 32 }, { width: 12 }, { width: 24 }, { width: 26 }, { width: 22 }, { width: 26 }],
    },
    {
      name: 'Professorat', tabColor: COLORS.violet, ...professorat, freeze: { row: headerRow },
      autoFilter: `A${headerRow}:J${Math.max(headerRow + teachers.length, headerRow + 1)}`,
      columns: [{ width: 22 }, { width: 16 }, { width: 32 }, { width: 22 }, { width: 14 }, { width: 11 }, { width: 13 }, { width: 14 }, { width: 11 }, { width: 28 }],
    },
    { name: 'Per tutor', tabColor: 'B4553A', ...perTutor, columns: [{ width: 24 }, { width: 18 }, { width: 14 }, { width: 34 }] },
  ], { title: `Tutoria personal${election ? ` · ${election.title}` : ''}` });
}

