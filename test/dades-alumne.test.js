import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';

const db = openDb(':memory:');
let server;
let base;
let broadcasts = 0;

before(async () => {
  const app = createApp({ db, sendMail: async () => {}, appUrl: 'http://test', testLogin: true, broadcast: () => { broadcasts += 1; } });
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

const changes = () => db.prepare('SELECT * FROM student_data_changes ORDER BY id').all();
const idOf = (username) => db.prepare('SELECT id FROM users WHERE username = ?').get(username).id;
const fields = { firstName: 'Aina', lastName: 'Vidal Mas', curso: 2, grupo: 'B' };

test('cambiar datos exige que el profesor indicado lo confirme en su panel', async () => {
  const admin = await login('admn1');
  const [marta, pau] = [await login('prof1'), await login('prof2')];
  await marta('/api/profesor/perfil', 'PUT', { firstName: 'Marta', lastName: 'Ferrer', department: 'Música' });
  await pau('/api/profesor/perfil', 'PUT', { firstName: 'Pau', lastName: 'Roca', department: 'Música' });
  await admin('/api/admin/convocar', 'POST', { title: 'Curs' });
  const student = await login('alm1');
  const ballot = (await student('/api/alumno')).data;
  const [martaId, pauId] = [idOf('prof1'), idOf('prof2')];
  await student('/api/alumno/eleccion', 'POST', { firstName: 'Aina', lastName: 'Vidal', curso: 1, grupo: 'A', vetoes: [], ranking: ballot.teachers.map((t) => t.id) });

  // Sin permiso no se cambia nada, y al entrar no hay solicitud.
  let me = (await student('/api/alumno')).data;
  assert.equal(me.editRequest, null);
  assert.deepEqual(me.supervisors.map((t) => t.last_name), ['Ferrer', 'Roca']);
  assert.equal((await student('/api/alumno/dades', 'PUT', fields)).status, 403);
  assert.equal((await student('/api/alumno')).data.lastName, 'Vidal');

  // La solicitud pide un profesor de verdad.
  for (const teacherId of [undefined, '', 99999, idOf('alm1')]) {
    assert.equal((await student('/api/alumno/dades/solicitud', 'POST', { teacherId })).status, 400, `teacherId: ${teacherId}`);
  }

  // Pedirla avisa en tiempo real y solo la ve el profesor indicado.
  const sent = broadcasts;
  assert.equal((await student('/api/alumno/dades/solicitud', 'POST', { teacherId: pauId })).status, 200);
  assert.ok(broadcasts > sent, 'avisa por WebSocket');
  assert.equal((await student('/api/alumno/dades/solicitud', 'POST', { teacherId: martaId })).status, 409, 'una activa a la vez');
  me = (await student('/api/alumno')).data;
  assert.equal(me.editRequest.status, 'pendiente');
  assert.equal(me.editRequest.teacher.last_name, 'Roca');
  assert.equal((await marta('/api/profesor')).data.editRequests.length, 0);
  const [incoming] = (await pau('/api/profesor')).data.editRequests;
  assert.equal(incoming.last_name, 'Vidal');
  assert.equal(incoming.curso, 1);

  // Pendiente aún no permite cambiar; otro profesor u otro nivel no pueden confirmar.
  assert.equal((await student('/api/alumno/dades', 'PUT', fields)).status, 403);
  const path = `/api/profesor/permisos/${incoming.id}`;
  assert.equal((await marta(path, 'POST', { accion: 'confirmar' })).status, 404);
  assert.equal((await student(path, 'POST', { accion: 'confirmar' })).status, 403);
  assert.equal((await pau(path, 'POST', { accion: 'otra' })).status, 400);

  // Rechazada: lo sabe, sigue sin poder y puede volver a pedirlo.
  assert.equal((await pau(path, 'POST', { accion: 'rechazar' })).status, 200);
  me = (await student('/api/alumno')).data;
  assert.equal(me.editRequest.status, 'rechazada');
  assert.equal((await student('/api/alumno/dades', 'PUT', fields)).status, 403);
  assert.equal((await pau(path, 'POST', { accion: 'confirmar' })).status, 409, 'ya contestada');

  // Puede cancelar la que tiene pendiente.
  await student('/api/alumno/dades/solicitud', 'POST', { teacherId: pauId });
  assert.equal((await student('/api/alumno/dades/solicitud', 'DELETE')).status, 200);
  assert.equal((await student('/api/alumno')).data.editRequest, null);
  assert.equal((await pau('/api/profesor')).data.editRequests.length, 0);

  // Confirmada: datos no válidos se rechazan y el permiso sigue; los buenos se guardan una vez.
  await student('/api/alumno/dades/solicitud', 'POST', { teacherId: pauId });
  const [second] = (await pau('/api/profesor')).data.editRequests;
  assert.equal((await pau(`/api/profesor/permisos/${second.id}`, 'POST', { accion: 'confirmar' })).status, 200);
  assert.equal((await student('/api/alumno')).data.editRequest.status, 'aprobada');
  assert.equal((await student('/api/alumno/dades', 'PUT', { ...fields, curso: 9 })).status, 400);
  assert.equal(changes().length, 0);
  assert.equal((await student('/api/alumno/dades', 'PUT', fields)).status, 200);
  me = (await student('/api/alumno')).data;
  assert.deepEqual([me.firstName, me.lastName, me.curso, me.grupo], ['Aina', 'Vidal Mas', 2, 'B']);
  assert.equal(me.editRequest, null, 'el permiso se gasta');
  assert.equal((await student('/api/alumno/dades', 'PUT', { ...fields, firstName: 'Otra' })).status, 403);

  // Queda constancia de quién confirmó y de qué había antes.
  const [change] = changes();
  assert.equal(change.student_id, idOf('alm1'));
  assert.equal(change.teacher_id, pauId);
  assert.equal(change.teacher_name, 'Roca, Pau');
  assert.deepEqual(JSON.parse(change.before_data), { firstName: 'Aina', lastName: 'Vidal', curso: 1, grupo: 'A' });
  assert.deepEqual(JSON.parse(change.after_data), fields);

  // Eliminar al profesor conserva su nombre y deja sin efecto lo que tuviera pendiente.
  await student('/api/alumno/dades/solicitud', 'POST', { teacherId: pauId });
  assert.equal((await admin(`/api/admin/usuarios/${pauId}`, 'DELETE')).status, 200);
  assert.equal((await student('/api/alumno')).data.editRequest, null);
  assert.equal(changes()[0].teacher_id, null);
  assert.equal(changes()[0].teacher_name, 'Roca, Pau');

  // Eliminar al alumno borra sus filas.
  await student('/api/alumno/dades/solicitud', 'POST', { teacherId: martaId });
  assert.equal((await admin(`/api/admin/usuarios/${idOf('alm1')}`, 'DELETE')).status, 200);
  assert.equal(changes().length, 0);
  assert.equal((await marta('/api/profesor')).data.editRequests.length, 0);
});

test('el logo se sirve y aparece en las páginas del enlace de acceso', async () => {
  const logo = await fetch(`${base}/assets/logo-lescarolines.png`);
  assert.equal(logo.status, 200);
  assert.equal(logo.headers.get('content-type'), 'image/png');
  const valid = await fetch(`${base}/auth/verify?token=abc`);
  const invalid = await fetch(`${base}/auth/verify?token=%3Cscript%3E`);
  const expired = await fetch(`${base}/auth/verify`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'token=abc', redirect: 'manual' });
  assert.deepEqual([valid.status, invalid.status, expired.status], [200, 400, 400]);
  for (const res of [valid, invalid, expired]) assert.match(await res.text(), /logo-lescarolines\.png/);
});

test('el alumnado con tutor recibe el usuario para poder escribirle', async () => {
  const admin = await login('admn1');
  const student = await login('alm2');
  const { teachers } = (await student('/api/alumno')).data;
  await student('/api/alumno/eleccion', 'POST', { firstName: 'Biel', lastName: 'Mas', curso: 3, grupo: 'A', vetoes: [], ranking: teachers.map((t) => t.id) });
  await admin('/api/admin/asignar', 'POST', { studentId: idOf('alm2'), teacherId: teachers[0].id });
  const { tutor } = (await student('/api/alumno')).data;
  assert.equal(tutor.username, 'prof1');
});
