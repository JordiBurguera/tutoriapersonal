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

test('perfil, solicitudes, lloc de reunió, cerca i vista de grup del professorat', async () => {
  const admin = await login('admn1');
  const [p1, p2] = [await login('prof1'), await login('prof2')];

  // Perfil: sin departamento al principio; valida nombre y departamento.
  assert.equal((await p1('/api/profesor')).data.department, null);
  const bad = { firstName: 'Anna', lastName: 'Soler', department: 'Inventat' };
  assert.equal((await p1('/api/profesor/perfil', 'PUT', bad)).status, 400);
  assert.equal((await p1('/api/profesor/perfil', 'PUT', { ...bad, lastName: ' ', department: 'Música' })).status, 400);
  assert.equal((await p1('/api/profesor/perfil', 'PUT', { ...bad, department: 'Música' })).status, 200);
  const me = (await p1('/api/profesor')).data;
  assert.deepEqual([me.firstName, me.lastName, me.department], ['Anna', 'Soler', 'Música']);
  assert.ok(me.departments.includes('Música'));

  // Lloc de reunió.
  assert.equal((await p1('/api/profesor/meeting', 'PUT', { meetingPlace: ' Aula 12 ' })).status, 200);
  assert.equal((await p1('/api/profesor')).data.meetingPlace, 'Aula 12');

  await admin('/api/admin/convocar', 'POST', { title: 'Curs' });
  const alm = await login('alm1');
  const alm2 = await login('alm2');
  const ids = Object.fromEntries(db.prepare(`SELECT username, id FROM users WHERE role = 'profesor'`).all().map((t) => [t.username, t.id]));
  db.prepare(`UPDATE users SET curso = 1, grupo = 'A' WHERE username IN ('alm1','alm2')`).run();
  await alm('/api/alumno/eleccion', 'POST', { firstName: 'Ana', lastName: 'Pérez', curso: 1, grupo: 'A', vetoes: [ids.prof2], ranking: [ids.prof1] });
  await alm2('/api/alumno/eleccion', 'POST', { firstName: 'Bea', lastName: 'Zola', curso: 1, grupo: 'A', vetoes: [], ranking: [ids.prof2, ids.prof1] });

  // Solo ve y actúa sobre las solicitudes propias y pendientes.
  const mine = (await p1('/api/profesor')).data.pending;
  assert.equal(mine.length, 1);
  const other = (await p2('/api/profesor')).data.pending[0];
  assert.equal((await p1(`/api/profesor/solicitudes/${other.id}`, 'POST', { accion: 'confirmar' })).status, 404);
  assert.equal((await p1(`/api/profesor/solicitudes/${mine[0].id}`, 'POST', { accion: 'borrar' })).status, 400);
  assert.equal((await p1(`/api/profesor/solicitudes/${mine[0].id}`, 'POST', { accion: 'confirmar' })).status, 200);
  assert.equal((await p1(`/api/profesor/solicitudes/${mine[0].id}`, 'POST', { accion: 'rechazar' })).status, 404);
  assert.equal((await alm('/api/profesor')).status, 403);

  // Rechazar pasa a la siguiente preferencia.
  assert.equal((await p2(`/api/profesor/solicitudes/${other.id}`, 'POST', { accion: 'rechazar' })).status, 200);
  assert.equal((await p1('/api/profesor')).data.pending.length, 1);

  // Una solicitud pendiente de una convocatoria anterior no se puede resolver.
  const stale = (await p1('/api/profesor')).data.pending[0];
  db.prepare('UPDATE elections SET closed_at = ?').run(Date.now());
  await admin('/api/admin/convocar', 'POST', { title: 'Curs 2' });
  assert.equal((await p1(`/api/profesor/solicitudes/${stale.id}`, 'POST', { accion: 'confirmar' })).status, 404);

  // Alumnos tutorizados: ya no hay en la nueva convocatoria.
  assert.equal((await p1('/api/profesor')).data.students.length, 0);

  // Búsqueda por nombre, apellidos y usuario; mínimo 2 caracteres; % no es comodín.
  for (const q of ['Ana', 'Pérez', 'alm1']) assert.equal((await p2(`/api/profesor/buscar?q=${encodeURIComponent(q)}`)).data.results.length >= 1, true);
  assert.equal((await p2('/api/profesor/buscar?q=a')).data.results.length, 0);
  assert.equal((await p2('/api/profesor/buscar?q=%25%25')).data.results.length, 0);
});

test('vista de grupo: solo la propia clase, varios tutores y cambio libre', async () => {
  const p3 = await login('prof3');
  const p4 = await login('prof4');
  assert.equal((await p3('/api/profesor/grup', 'PUT', { group: '4B' })).status, 200);
  assert.equal((await p4('/api/profesor/grup', 'PUT', { group: '4B' })).status, 200);
  assert.equal((await p3('/api/profesor/grup', 'PUT', { group: '5A' })).status, 400);
  db.prepare(`UPDATE users SET curso = 4, grupo = 'B', last_name = 'Vidal' WHERE username = 'alm1'`).run();
  const g = (await p3('/api/profesor')).data;
  assert.equal(g.group.students.length, 1);
  assert.equal(g.group.students[0].last_name, 'Vidal');
  assert.equal((await p4('/api/profesor')).data.group.students.length, 1);
  assert.equal((await p3('/api/profesor/grup', 'PUT', { group: '1A' })).status, 200);
  assert.equal((await p3('/api/profesor')).data.group.students.length, 1); // alm2 (1A)
  assert.notEqual((await p3('/api/profesor')).data.group.students[0].last_name, 'Vidal');
  assert.equal((await p3('/api/profesor/grup', 'PUT', { group: null })).status, 200);
  assert.equal((await p3('/api/profesor')).data.group, null);
});
