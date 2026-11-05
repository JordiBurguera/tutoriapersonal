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
    return { status: r.status, text: null, data: await r.json() };
  };
}

test('validación del envío, vetos, cascada y privacidad', async () => {
  const admin = await login('admn1');
  const profs = {};
  for (const [user, lastName] of [['prof1', 'Aaa'], ['prof2', 'Bbb'], ['prof3', 'Ccc'], ['prof4', 'Ddd']]) {
    profs[lastName] = await login(user);
    await profs[lastName]('/api/profesor/perfil', 'PUT', { firstName: 'P', lastName, department: 'Música' });
  }
  await admin('/api/admin/convocar', 'POST', { title: 'T' });

  const alm = await login('alm1');
  const form = (await alm('/api/alumno')).data;
  assert.ok(form.teachers.every((t) => t.department === 'Música'));
  const id = Object.fromEntries(form.teachers.map((t) => [t.last_name, t.id]));
  const all = form.teachers.map((t) => t.id);
  const send = (over) => alm('/api/alumno/eleccion', 'POST', {
    firstName: 'Ana', lastName: 'Pons', curso: 2, grupo: 'B', ranking: all, vetoes: [], ...over,
  });

  // Datos obligatorios y rangos.
  assert.equal((await send({ firstName: '  ' })).status, 400);
  assert.equal((await send({ lastName: '' })).status, 400);
  assert.equal((await send({ curso: 5 })).status, 400);
  assert.equal((await send({ curso: 0 })).status, 400);
  assert.equal((await send({ curso: '2' })).status, 400);
  assert.equal((await send({ grupo: 'C' })).status, 400);
  // Vetos: máximo 2, sin repetir, sin dejar la lista vacía, cada profesor una sola vez.
  assert.equal((await send({ vetoes: [id.Aaa, id.Bbb, id.Ccc], ranking: [id.Ddd] })).status, 400);
  assert.equal((await send({ vetoes: [id.Aaa, id.Aaa], ranking: [id.Bbb, id.Ccc, id.Ddd] })).status, 400);
  assert.equal((await send({ vetoes: all, ranking: [] })).status, 400);
  assert.equal((await send({ ranking: [id.Aaa, id.Bbb, id.Bbb, id.Ccc] })).status, 409);
  assert.equal((await send({ ranking: [id.Aaa, id.Bbb] })).status, 409);
  assert.equal((await alm('/api/alumno')).data.status, 'por_contestar');

  // Cascada: el primero es vetado-excluido; se salta a quien el alumno vetó.
  assert.equal((await send({ ranking: [id.Ccc, id.Aaa], vetoes: [id.Bbb, id.Ddd] })).status, 200);
  // Envío único.
  assert.equal((await send({})).status, 409);

  // Privacidad hacia el profesorado: ni vetos ni posición ni preferencias.
  const bbb = await profs.Bbb('/api/profesor');
  const ddd = await profs.Ddd('/api/profesor');
  assert.equal(bbb.data.pending.length, 0);
  assert.equal(ddd.data.pending.length, 0);
  const ccc = await profs.Ccc('/api/profesor');
  assert.equal(ccc.data.pending.length, 1);
  const raw = JSON.stringify(ccc.data);
  assert.ok(!/veto|position|ranking|ballot|rechaz/i.test(raw), raw);
  assert.deepEqual(Object.keys(ccc.data.pending[0]).sort(), ['curso', 'first_name', 'grupo', 'id', 'last_name', 'username']);

  // Rechazo oculto al alumno; pasa a Aaa (nunca a los vetados) y luego se agota.
  await profs.Ccc(`/api/profesor/solicitudes/${ccc.data.pending[0].id}`, 'POST', { accion: 'rechazar' });
  let mine = (await alm('/api/alumno')).data;
  assert.equal(mine.status, 'en_proceso');
  assert.ok(!/rechaz|cancel/i.test(JSON.stringify(mine)));
  assert.equal(mine.tutor, null);
  const aaa = (await profs.Aaa('/api/profesor')).data;
  assert.equal(aaa.pending.length, 1);
  await profs.Aaa(`/api/profesor/solicitudes/${aaa.pending[0].id}`, 'POST', { accion: 'rechazar' });
  mine = (await alm('/api/alumno')).data;
  assert.equal(mine.status, 'agotada');
  assert.ok(!/rechaz|cancel|pendiente/i.test(JSON.stringify(mine)));
  assert.equal((await profs.Bbb('/api/profesor')).data.pending.length, 0);
  assert.equal((await profs.Ddd('/api/profesor')).data.pending.length, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM requests`).get().n, 2);
});
