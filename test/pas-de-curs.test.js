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

const row = (username) => db.prepare('SELECT id, curso, grupo, promotion_mark FROM users WHERE username = ?').get(username);
const state = async (admin) => (await admin('/api/admin')).data.promotion;
const mark = (admin, username, value) => admin(`/api/admin/pas-de-curs/${row(username).id}`, 'PUT', { mark: value });

test('pas de curs: solo las anomalías no suben', async () => {
  const admin = await login('admn1');
  const prof1 = await login('prof1');
  await prof1('/api/profesor/perfil', 'PUT', { firstName: 'P', lastName: 'Vila', department: 'Música' });
  assert.equal(await state(admin), 'sin_eleccion');
  assert.equal((await admin('/api/admin/pas-de-curs', 'POST')).status, 409);

  await admin('/api/admin/convocar', 'POST', { title: 'Primera' });
  const alumnos = { alm1: [1, 'A'], alm2: [2, 'B'], alm3: [3, 'A'], alm4: [4, 'A'], alm5: [4, 'B'] };
  let teacherId;
  for (const [username, [curso, grupo]] of Object.entries(alumnos)) {
    const alumno = await login(username);
    teacherId ??= (await alumno('/api/alumno')).data.teachers[0].id;
    await alumno('/api/alumno/eleccion', 'POST', { firstName: 'A', lastName: username, curso, grupo, ranking: [teacherId], vetoes: [] });
  }
  for (const { id } of (await prof1('/api/profesor')).data.pending) {
    await prof1(`/api/profesor/solicitudes/${id}`, 'POST', { accion: 'confirmar' });
  }

  // Con la elección abierta no se puede tocar nada.
  assert.equal(await state(admin), 'abierta');
  assert.equal((await mark(admin, 'alm2', 'no_promociona')).status, 409);
  assert.equal((await admin('/api/admin/pas-de-curs', 'POST')).status, 409);
  await admin('/api/admin/terminar', 'POST');
  assert.equal(await state(admin), 'disponible');

  // Alumno sin clase: entra después de cerrar y no puede «no promocionar».
  await login('alm6');
  assert.equal((await mark(admin, 'alm6', 'no_promociona')).status, 400);

  // Validación y permisos.
  assert.equal((await mark(admin, 'alm2', 'otra')).status, 400);
  assert.equal((await mark(admin, 'prof1', 'baixa')).status, 404);
  assert.equal((await prof1(`/api/admin/pas-de-curs/${row('alm2').id}`, 'PUT', { mark: 'baixa' })).status, 403);
  assert.equal((await prof1('/api/admin/pas-de-curs', 'POST')).status, 403);

  // Las marcas se guardan, se pueden quitar y no salen del panel de administración.
  assert.equal((await mark(admin, 'alm1', 'baixa')).status, 200);
  assert.equal((await admin('/api/admin')).data.students.find((s) => s.username === 'alm1').promotionMark, 'baixa');
  assert.equal((await mark(admin, 'alm1', '')).status, 200);
  assert.equal((await admin('/api/admin')).data.students.find((s) => s.username === 'alm1').promotionMark, null);

  assert.equal((await mark(admin, 'alm2', 'no_promociona')).status, 200);
  assert.equal((await mark(admin, 'alm3', 'baixa')).status, 200);
  assert.equal((await mark(admin, 'alm5', 'no_promociona')).status, 200);
  assert.ok(!JSON.stringify((await prof1('/api/profesor')).data).includes('no_promociona'));

  const result = await admin('/api/admin/pas-de-curs', 'POST');
  assert.equal(result.status, 200);
  assert.deepEqual(result.data, { ok: true, promoted: 1, kept: 2, withdrawn: 1, graduated: 1 });

  assert.equal(row('alm1').curso, 2); // sube y conserva grupo
  assert.equal(row('alm1').grupo, 'A');
  assert.equal(row('alm2').curso, 2); // no promociona
  assert.equal(row('alm3'), undefined); // baja
  assert.equal(row('alm4'), undefined); // acaba 4.º
  assert.equal(row('alm5').curso, 4); // repite 4.º
  assert.equal(row('alm6').curso, null); // sin clase, igual
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users WHERE promotion_mark IS NOT NULL').get().n, 0);

  // No se puede repetir hasta la siguiente elección cerrada.
  assert.equal(await state(admin), 'hecho');
  assert.equal((await admin('/api/admin/pas-de-curs', 'POST')).status, 409);
  assert.equal((await mark(admin, 'alm1', 'baixa')).status, 409);
  assert.equal(row('alm1').curso, 2);

  // Convocar ya no cambia cursos ni borra a nadie.
  assert.equal((await admin('/api/admin/convocar', 'POST', { title: 'Segunda' })).status, 200);
  assert.equal(row('alm1').curso, 2);
  assert.equal(row('alm5').curso, 4);

  // Quien no promociona conserva su historial y puede repetir tutor directamente.
  const repetidor = await login('alm5');
  assert.equal((await repetidor('/api/alumno')).data.curso, 4);
  assert.equal((await repetidor('/api/alumno')).data.previousTutor.id, teacherId);

  // Quien se dio de baja vuelve como cuenta nueva, sin clase ni historial.
  const vuelve = (await (await login('alm3'))('/api/alumno')).data;
  assert.equal(vuelve.curso, null);
  assert.equal(vuelve.previousTutor, null);

  // Tras cerrar la siguiente elección vuelve a estar disponible.
  for (const username of ['alm1', 'alm2', 'alm3', 'alm5', 'alm6']) {
    const alumno = await login(username);
    await alumno('/api/alumno/eleccion', 'POST', { firstName: 'A', lastName: username, curso: 1, grupo: 'A', ranking: [teacherId], vetoes: [] });
  }
  assert.equal((await admin('/api/admin/terminar', 'POST')).status, 200);
  assert.equal(await state(admin), 'disponible');

  // Convocar sin confirmar el pas de curs: nadie sube y las marcas no pasan al año siguiente.
  await mark(admin, 'alm1', 'baixa');
  const cursoAntes = row('alm2').curso;
  await admin('/api/admin/convocar', 'POST', { title: 'Tercera' });
  assert.equal(row('alm1').promotion_mark, null);
  assert.equal(row('alm2').curso, cursoAntes);
});
