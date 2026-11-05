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
      method, headers: { cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const type = r.headers.get('content-type') || '';
    return { status: r.status, data: type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
}

test('administració: convocar, bloquejos, assignar, rols, esborrar i PDF', async () => {
  const admin = await login('admn1');
  assert.equal((await admin('/api/admin/convocar', 'POST', { title: 'X' })).status, 409); // sin profesores
  const [p1, p2, p3] = [await login('prof1'), await login('prof2'), await login('prof3')];
  for (const [p, n] of [[p1, 'Vila'], [p2, 'Roca'], [p3, 'Mas']]) await p('/api/profesor/perfil', 'PUT', { firstName: 'P', lastName: n, department: 'Música' });
  assert.equal((await admin('/api/admin/convocar', 'POST', { title: '  ' })).status, 400);
  assert.equal((await admin('/api/admin/convocar', 'POST', { title: 'Curs' })).status, 200);
  assert.equal((await admin('/api/admin/convocar', 'POST', { title: 'Altre' })).status, 409);

  const alm1 = await login('alm1');
  const alm2 = await login('alm2');
  const teachers = (await alm1('/api/alumno')).data.teachers;
  const id = Object.fromEntries(teachers.map((t) => [t.last_name, t.id]));
  await alm1('/api/alumno/eleccion', 'POST', { firstName: 'A', lastName: 'Uno', curso: 1, grupo: 'A', ranking: [id.Roca, id.Vila], vetoes: [id.Mas] });
  await alm2('/api/alumno');

  let d = (await admin('/api/admin')).data;
  assert.equal(d.canClose, false);
  assert.equal(d.stats.unanswered, 1);
  assert.equal((await admin('/api/admin/terminar', 'POST')).status, 409);

  const s1 = d.students.find((s) => s.username === 'alm1');
  const s2 = d.students.find((s) => s.username === 'alm2');
  // Vetado: rechazado también si el id llega como texto.
  assert.equal((await admin('/api/admin/asignar', 'POST', { studentId: s1.id, teacherId: String(id.Mas) })).status, 409);
  // Asignación manual con elecciones abiertas desbloquea el cierre.
  assert.equal((await admin('/api/admin/asignar', 'POST', { studentId: s2.id, teacherId: id.Mas })).status, 200);
  assert.equal((await admin('/api/admin/asignar', 'POST', { studentId: s2.id, teacherId: id.Vila })).status, 409);

  // Borrar respuesta con elecciones abiertas.
  assert.equal((await admin(`/api/admin/alumnes/${s1.id}/resposta`, 'DELETE')).status, 200);
  assert.equal((await admin(`/api/admin/alumnes/${s1.id}/resposta`, 'DELETE')).status, 404);
  assert.equal((await admin('/api/admin/terminar', 'POST')).status, 409);
  assert.equal((await admin('/api/admin/alumnes', 'POST', { username: 'nou1', firstName: 'N', lastName: 'N', curso: 1, grupo: 'A', teacherId: id.Vila })).status, 409); // abiertas
  assert.equal((await admin('/api/admin/asignar', 'POST', { studentId: s1.id, teacherId: id.Vila })).status, 200);
  assert.equal((await admin('/api/admin/terminar', 'POST')).status, 200);
  assert.equal((await admin(`/api/admin/alumnes/${s1.id}/resposta`, 'DELETE')).status, 409);

  // Asignación con cerradas; alumno a mitad de curso con tutor directo; sin tutor en PDF.
  assert.equal((await admin('/api/admin/alumnes', 'POST', { username: 'nou1', firstName: 'Nou', lastName: 'Alumne', curso: 2, grupo: 'B', teacherId: String(id.Roca) })).status, 200);
  await login('alm9');
  d = (await admin('/api/admin')).data;
  const nou = d.students.find((s) => s.username === 'nou1');
  assert.equal(nou.tutorId, id.Roca);
  const lone = d.students.find((s) => s.username === 'alm9');
  assert.equal(lone.tutorId, null);
  assert.equal((await admin('/api/admin/asignar', 'POST', { studentId: lone.id, teacherId: id.Mas })).status, 200);
  const pdf = await admin('/api/admin/informe.pdf');
  assert.equal(pdf.status, 200);
  assert.equal(pdf.data.subarray(0, 4).toString(), '%PDF');

  // Roles y borrado.
  const me = d.me;
  assert.equal((await admin(`/api/admin/usuarios/${me}`, 'PATCH', { role: 'profesor' })).status, 409);
  assert.equal((await admin(`/api/admin/usuarios/${me}`, 'DELETE')).status, 409);
  assert.equal((await admin(`/api/admin/usuarios/${id.Mas}`, 'PATCH', { role: 'admin' })).status, 409); // tiene alumnos
  assert.equal((await admin('/api/admin/usuarios', 'POST', { username: 'nova.prof', role: 'profesor' })).status, 200);
  assert.equal((await admin('/api/admin/usuarios', 'POST', { username: 'nova.adm', role: 'admin' })).status, 200);
  assert.equal((await admin('/api/admin/usuarios', 'POST', { username: 'nova.alu', role: 'alumno' })).status, 400);
  d = (await admin('/api/admin')).data;
  assert.ok(d.admins.some((a) => a.username === 'nova.adm'));
  const np = d.teachers.find((t) => t.username === 'nova.prof');
  assert.equal((await admin(`/api/admin/usuarios/${np.id}`, 'PATCH', { role: 'admin' })).status, 200);
  assert.equal((await admin(`/api/admin/usuarios/${np.id}`, 'DELETE')).status, 200);
  // Todo requiere admin.
  assert.equal((await alm2('/api/admin')).status, 403);
});
