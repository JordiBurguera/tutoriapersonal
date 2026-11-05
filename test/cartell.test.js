import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { openDb } from '../src/db.js';
import { balancedBottom, flowTables, writeReport } from '../src/pdf.js';

const area = { columns: 3, firstTop: 200, top: 60, bottom: 1000, gap: 14 };
const table = (rows, head = 80) => ({ head, continuedHead: 40, rows: Array(rows).fill(20) });

function assertSound(tables, pages, options) {
  const seen = tables.map(() => []);
  pages.forEach((placed, pageIndex) => {
    const top = pageIndex === 0 ? options.firstTop : options.top;
    for (const p of placed) {
      assert.ok(p.y >= top, 'empieza dentro de la columna');
      assert.ok(p.y + p.height <= options.bottom || p.end - p.start === 1, 'acaba dentro de la columna');
      for (let i = p.start; i < p.end; i += 1) seen[p.index].push(i);
    }
    for (const [i, a] of placed.entries()) {
      for (const b of placed.slice(i + 1)) {
        if (a.column === b.column) assert.ok(a.y + a.height <= b.y || b.y + b.height <= a.y, 'sin solapes');
      }
    }
  });
  seen.forEach((rows, i) => assert.deepEqual(rows, tables[i].rows.map((_, r) => r), 'cada fila una vez y en orden'));
}

test('cartell: una tabla que cabe en una columna vacía no se parte', () => {
  const tables = [table(30), table(30), table(30)];
  const pages = flowTables(tables, area);
  assertSound(tables, pages, area);
  assert.equal(pages.flat().length, 3);
  assert.ok(pages.flat().every((p) => !p.continued));
});

test('cartell: sin cupo, una tabla enorme sigue en la columna y la página siguientes', () => {
  const tables = [table(5), table(400), table(5)];
  const pages = flowTables(tables, area);
  assertSound(tables, pages, area);
  assert.ok(pages.length > 1);
  assert.ok(pages.flat().some((p) => p.continued));
});

test('cartell: una fila más alta que la columna no deja el reparto colgado', () => {
  const tables = [{ head: 80, continuedHead: 40, rows: [20, 5000, 20] }];
  assertSound(tables, flowTables(tables, area), area);
});

test('cartell: con pocos datos las columnas se reparten sin partir tablas', () => {
  const tables = [table(10), table(10), table(10)];
  const pages = flowTables(tables, { ...area, bottom: balancedBottom(tables, area) });
  assertSound(tables, pages, { ...area, bottom: 1000 });
  assert.equal(pages.length, 1);
  assert.deepEqual(pages[0].map((p) => p.column), [0, 1, 2]);
  assert.ok(pages[0].every((p) => !p.continued));
});

test('cartell: si no cabe en una hoja no se reduce la columna', () => {
  const tables = [table(400)];
  assert.equal(balancedBottom(tables, area), area.bottom);
});

test('cartell: se genera con nombres largos, sin alumnado y con alumnado sin tutor', async () => {
  const db = openDb(':memory:');
  const insert = db.prepare(`INSERT INTO users (username, first_name, last_name, role, department, curso, grupo, meeting_place) VALUES (?,?,?,?,?,?,?,?)`);
  insert.run('t1', 'Marta', 'Ferrer', 'profesor', 'Matemàtiques', null, null, 'Aula 12, '.repeat(22));
  insert.run('t2', 'Pau', 'Llopis', 'profesor', null, null, null, null);
  const teacher = 1;
  db.prepare(`INSERT INTO elections (title, opened_at) VALUES (?, ?)`).run('Curs 2026-27', Date.now());
  for (let i = 0; i < 300; i += 1) {
    const student = Number(insert.run(`a${i}`, `Nom${i}`, 'Cognom molt llarg de família composta '.repeat(i % 2 + 1), 'alumno', null, (i % 4) + 1, 'A', null).lastInsertRowid);
    if (i % 3) db.prepare(`INSERT INTO requests (election_id, student_id, teacher_id, status) VALUES (1, ?, ?, 'confirmada')`).run(student, teacher);
  }
  const chunks = [];
  const out = new Writable({ write(chunk, _, done) { chunks.push(chunk); done(); } });
  const finished = new Promise((resolve) => out.on('finish', resolve));
  writeReport(db, db.prepare('SELECT * FROM elections').get(), out);
  await finished;
  const pdf = Buffer.concat(chunks);
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  const pages = Number(pdf.toString('latin1').match(/\/Type \/Pages\s*\/Count (\d+)/)?.[1]);
  assert.ok(pages >= 3, `páginas: ${pages}`);
  assert.match(pdf.toString('latin1'), /\/Subtype \/Image/, 'lleva el logo');
});
