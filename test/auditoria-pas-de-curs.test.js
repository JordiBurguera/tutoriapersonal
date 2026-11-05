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
    return { status: r.status, data: await r.json().catch(() => null) };
  };
}

const row = (username) => db.prepare('SELECT id, curso, grupo, promotion_mark FROM users WHERE username = ?').get(username);
const mark = (admin, username, value) => admin(`/api/admin/pas-de-curs/${row(username).id}`, 'PUT', { mark: value });

test('auditoria pas de curs: orden, historial, huérfanos y atomicidad', async () => {
  const admin = await login('admn1');
  const prof1 = await login('prof1');
  await prof1('/api/profesor/perfil', 'PUT', { firstName: 'P', lastName: 'Vila', department: 'Música' });
  await admin('/api/admin/convocar', 'POST', { title: 'E1' });
  const alumnos = { alm11: [1, 'A'], alm12: [2, 'B'], alm13: [3, 'A'], alm14: [3, 'B'], alm15: [4, 'A'], alm16: [4, 'B'], alm17: [4, 'B'] };
  let teacherId;
  for (const [username, [curso, grupo]] of Object.entries(alumnos)) {
    const a = await login(username);
    teacherId ??= (await a('/api/alumno')).data.teachers[0].id;
    await a('/api/alumno/eleccion', 'POST', { firstName: 'A', lastName: username, curso, grupo, ranking: [teacherId], vetoes: [] });
  }
  for (const { id } of (await prof1('/api/profesor')).data.pending) {
    await prof1(`/api/profesor/solicitudes/${id}`, 'POST', { accion: 'confirmar' });
  }
  await admin('/api/admin/terminar', 'POST');
  await login('alm20');

  assert.equal((await mark(admin, 'alm16', 'no_promociona')).status, 200); // 4.º repite: no se borra
  assert.equal((await mark(admin, 'alm17', 'baixa')).status, 200); // baja con historial
  assert.equal((await mark(admin, 'alm20', 'baixa')).status, 200); // baja sin clase

  // Fallo a mitad: un trigger aborta el último borrado y todo debe revertirse.
  db.exec(`CREATE TRIGGER fallo BEFORE DELETE ON users WHEN OLD.username = 'alm20' BEGIN SELECT RAISE(ABORT, 'fallo'); END`);
  const failed = await admin('/api/admin/pas-de-curs', 'POST');
  assert.ok(failed.status >= 500);
  assert.equal(row('alm17') !== undefined, true);
  assert.equal(row('alm15') !== undefined, true);
  assert.equal(row('alm11').curso, 1);
  assert.equal(row('alm13').curso, 3);
  assert.equal(row('alm17').promotion_mark, 'baixa');
  assert.equal(db.prepare(`SELECT value FROM meta WHERE key = 'promoted_election_id'`).get(), undefined);
  assert.equal((await admin('/api/admin')).data.promotion, 'disponible');
  db.exec('DROP TRIGGER fallo');

  const ok = await admin('/api/admin/pas-de-curs', 'POST');
  assert.deepEqual(ok.data, { ok: true, promoted: 4, kept: 1, withdrawn: 2, graduated: 1 });
  assert.equal(row('alm11').curso, 2);
  assert.equal(row('alm12').curso, 3);
  assert.equal(row('alm13').curso, 4); // de 3.º a 4.º: NO se borra
  assert.equal(row('alm13').grupo, 'A');
  assert.equal(row('alm14').curso, 4);
  assert.equal(row('alm15'), undefined); // 4.º sin marca sale
  assert.equal(row('alm16').curso, 4); // 4.º que repite se queda
  assert.equal(row('alm17'), undefined);
  assert.equal(row('alm20'), undefined);

  // Sin filas huérfanas ni claves foráneas rotas.
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  for (const table of ['ballots', 'ballot_choices', 'requests']) {
    const col = 'student_id';
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} NOT IN (SELECT id FROM users)`).get().n, 0);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ballot_choices WHERE teacher_id NOT IN (SELECT id FROM users)').get().n, 0);
});
