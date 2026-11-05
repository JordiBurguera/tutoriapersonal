import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';

const db = openDb(':memory:');
let server;
let base;

before(async () => {
  const app = createApp({ db, sendMail: async () => {}, appUrl: 'http://test', testLogin: true });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function login(username) {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });
  const cookie = res.headers.get('set-cookie').split(';')[0];
  return async (path, method = 'GET', body) => {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, data: await r.json() };
  };
}

const names = (list) => list.map((t) => t.last_name);

test('el alumnado ve su respuesta hasta tener tutor definitivo', async () => {
  const admin = await login('admn1');
  const [prof1, prof2, prof3] = [await login('prof1'), await login('prof2'), await login('prof3')];
  for (const [prof, lastName] of [[prof1, 'Vila'], [prof2, 'Roca'], [prof3, 'Mas']]) {
    await prof('/api/profesor/perfil', 'PUT', { firstName: 'P', lastName, department: 'Música' });
  }
  await admin('/api/admin/convocar', 'POST', { title: 'Curs' });

  const [alm1, alm2] = [await login('alm1'), await login('alm2')];
  const before = (await alm1('/api/alumno')).data;
  assert.equal(before.answer, null);
  const id = Object.fromEntries(before.teachers.map((t) => [t.last_name, t.id]));
  const vote = (alumno, ranking, vetoes) => alumno('/api/alumno/eleccion', 'POST', {
    firstName: 'A', lastName: 'B', curso: 1, grupo: 'A', ranking, vetoes,
  });

  await vote(alm1, [id.Roca, id.Vila], [id.Mas]);
  await vote(alm2, [id.Mas, id.Roca, id.Vila], []);

  // Conserva el orden elegido y separa los vetos.
  let answer = (await alm1('/api/alumno')).data.answer;
  assert.deepEqual(names(answer.ranking), ['Roca', 'Vila']);
  assert.deepEqual(names(answer.vetoes), ['Mas']);

  // Cada alumno recibe solo la suya.
  assert.deepEqual(names((await alm2('/api/alumno')).data.answer.ranking), ['Mas', 'Roca', 'Vila']);

  // Un rechazo no cambia lo que ve ni le dice quién le ha rechazado.
  const request = (await prof2('/api/profesor')).data.pending.find((r) => r.username === 'alm1');
  await prof2(`/api/profesor/solicitudes/${request.id}`, 'POST', { accion: 'rechazar' });
  answer = (await alm1('/api/alumno')).data.answer;
  assert.deepEqual(names(answer.ranking), ['Roca', 'Vila']);
  assert.deepEqual(Object.keys(answer.ranking[0]).sort(), ['first_name', 'last_name']);

  // Al confirmarse desaparece y queda solo el tutor.
  const next = (await prof1('/api/profesor')).data.pending.find((r) => r.username === 'alm1');
  await prof1(`/api/profesor/solicitudes/${next.id}`, 'POST', { accion: 'confirmar' });
  const confirmed = (await alm1('/api/alumno')).data;
  assert.equal(confirmed.status, 'asignado');
  assert.equal(confirmed.answer, null);
  assert.equal(confirmed.tutor.last_name, 'Vila');

  // Rechazado por toda la lista: sigue viéndola hasta que administración le asigne tutor.
  for (const prof of [prof3, prof2, prof1]) {
    const pending = (await prof('/api/profesor')).data.pending.find((r) => r.username === 'alm2');
    await prof(`/api/profesor/solicitudes/${pending.id}`, 'POST', { accion: 'rechazar' });
  }
  const exhausted = (await alm2('/api/alumno')).data;
  assert.equal(exhausted.status, 'agotada');
  assert.deepEqual(names(exhausted.answer.ranking), ['Mas', 'Roca', 'Vila']);

  const studentId = (await admin('/api/admin')).data.students.find((s) => s.username === 'alm2').id;
  await admin('/api/admin/asignar', 'POST', { studentId, teacherId: id.Roca });
  const assigned = (await alm2('/api/alumno')).data;
  assert.equal(assigned.answer, null);
  assert.equal(assigned.tutor.last_name, 'Roca');
});
