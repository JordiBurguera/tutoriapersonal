import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { createApp, normalizeUsername } from '../src/app.js';
import { openDb } from '../src/db.js';
import { byLastName } from '../src/election.js';
import { createLive } from '../src/live.js';

const db = openDb(':memory:');
const mails = [];
const live = createLive();
let server;
let base;

before(async () => {
  db.prepare(`INSERT INTO users (username, first_name, last_name, role) VALUES ('dire', 'Direcció', '', 'admin')`).run();
  const app = createApp({ db, sendMail: async (mail) => mails.push(mail), appUrl: 'http://test', broadcast: live.broadcast });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  live.attach(server, app.locals.userFromCookie);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  live.close();
  server.close();
});

let lastCookie;

// Hace todo el login por correo y devuelve un cliente con su cookie.
async function login(username) {
  db.prepare('DELETE FROM login_tokens WHERE username = ?').run(username); // evita el límite de 1 correo por minuto
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });
  assert.equal(res.status, 200);
  const mail = mails.at(-1);
  assert.equal(mail.to, `${username}@lescarolines.com`);
  const token = mail.text.match(/token=([\w-]+)/)[1];
  const verify = await fetch(`${base}/auth/verify`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
  });
  assert.equal(verify.status, 303);
  const cookie = verify.headers.get('set-cookie').split(';')[0];
  lastCookie = cookie;
  return async (path, method = 'GET', body) => {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const isJson = r.headers.get('content-type')?.includes('json');
    return { status: r.status, data: isJson ? await r.json() : await r.arrayBuffer() };
  };
}

const ballot = (extra) => ({ firstName: 'Ana', lastName: 'Pérez', curso: 2, grupo: 'B', ...extra });
const userId = (username) => db.prepare('SELECT id FROM users WHERE username = ?').get(username)?.id;

test('solo acepta usuarios del instituto', async () => {
  assert.equal(normalizeUsername('Ana.Perez'), 'ana.perez');
  assert.equal(normalizeUsername('ana@lescarolines.com'), 'ana');
  assert.equal(normalizeUsername('ana@gmail.com'), null);
  assert.equal(normalizeUsername('ana@lescarolines.com.evil.org'), null);
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'ana@gmail.com' }),
  });
  assert.equal(res.status, 400);
});

test('el enlace de acceso solo sirve una vez', async () => {
  await login('uso.unico');
  const token = mails.at(-1).text.match(/token=([\w-]+)/)[1];
  const again = await fetch(`${base}/auth/verify`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
  });
  assert.equal(again.status, 400);
});

test('no envía más de un correo por minuto al mismo usuario', async () => {
  const send = () => fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'limite' }),
  });
  const before = mails.length;
  assert.equal((await send()).status, 200);
  assert.equal((await send()).status, 200);
  assert.equal(mails.length, before + 1);
});

test('ordena por apellido teniendo en cuenta los acentos', () => {
  const people = [
    { first_name: 'Ana', last_name: 'Zapata' },
    { first_name: 'Pau', last_name: 'Àlvarez' },
    { first_name: 'Joan', last_name: 'Bosch' },
    { first_name: 'Abel', last_name: 'Bosch' },
  ];
  assert.deepEqual(people.sort(byLastName).map((p) => p.first_name), ['Pau', 'Abel', 'Joan', 'Ana']);
});

test('flujo completo de una elección', async () => {
  const admin = await login('dire');

  // Sin profesorado no se puede convocar.
  assert.equal((await admin('/api/admin/convocar', 'POST', { title: 'X' })).status, 409);

  // Alta previa: el profesor ya tiene su nivel antes de iniciar sesión.
  for (const username of ['p.uno', 'p.dos', 'p.tres', 'p.cuatro']) {
    assert.equal((await admin('/api/admin/usuarios', 'POST', { username, role: 'profesor' })).status, 200);
  }
  assert.equal((await admin('/api/admin/usuarios', 'POST', { username: 'x', role: 'alumno' })).status, 400);

  const [uno, dos, tres] = [await login('p.uno'), await login('p.dos'), await login('p.tres')];
  assert.equal((await uno('/api/me')).data.user.role, 'profesor');

  // Al profesorado se le pide nombre, apellidos y departamento.
  assert.equal((await uno('/api/profesor')).data.department, null);
  const profile = { firstName: 'Una', lastName: 'Uno', department: 'Matemàtiques' };
  assert.equal((await uno('/api/profesor/perfil', 'PUT', { ...profile, department: 'Astrologia' })).status, 400);
  assert.equal((await uno('/api/profesor/perfil', 'PUT', { ...profile, lastName: '' })).status, 400);
  assert.equal((await uno('/api/profesor/perfil', 'PUT', profile)).status, 200);
  assert.equal((await uno('/api/profesor')).data.department, 'Matemàtiques');

  // Permisos entre niveles.
  assert.equal((await uno('/api/admin')).status, 403);
  const ana = await login('ana.perez');
  assert.equal((await ana('/api/me')).data.user.role, 'alumno');
  assert.equal((await ana('/api/profesor')).status, 403);
  assert.equal((await ana('/api/admin/informe.pdf')).status, 403);

  // Sin convocatoria no aparece formulario.
  assert.equal((await ana('/api/alumno')).data.status, 'sin_convocatoria');
  assert.equal((await admin('/api/admin/convocar', 'POST', { title: 'Curso 2026-27' })).status, 200);
  assert.equal((await admin('/api/admin/convocar', 'POST', { title: 'Otra' })).status, 409);

  const form = (await ana('/api/alumno')).data;
  assert.equal(form.status, 'por_contestar');
  assert.deepEqual(form.teachers.map((t) => t.last_name), ['Cuatro', 'Dos', 'Tres', 'Uno']);
  const id = Object.fromEntries(form.teachers.map((t) => [t.last_name, t.id]));

  // Validaciones del formulario.
  const vetoes = [id.Tres, id.Cuatro];
  const ranking = [id.Uno, id.Dos];
  const send = (client, body) => client('/api/alumno/eleccion', 'POST', body);
  assert.equal((await send(ana, ballot({ curso: 5, vetoes, ranking }))).status, 400);
  assert.equal((await send(ana, ballot({ lastName: ' ', vetoes, ranking }))).status, 400);
  assert.equal((await send(ana, ballot({ vetoes: [id.Tres, id.Cuatro, id.Dos], ranking: [id.Uno] }))).status, 400);
  assert.equal((await send(ana, ballot({ vetoes: [id.Tres, id.Tres], ranking }))).status, 400);
  assert.equal((await send(ana, ballot({ vetoes, ranking: [id.Uno] }))).status, 409);
  assert.equal((await send(ana, ballot({ vetoes: [], ranking: [] }))).status, 400);

  assert.equal((await send(ana, ballot({ vetoes, ranking }))).status, 200);
  assert.equal((await send(ana, ballot({ vetoes, ranking }))).status, 409);

  let adminData = (await admin('/api/admin')).data;
  assert.equal(adminData.stats.waiting, 1);
  assert.equal(adminData.stats.confirmed, 0);

  // La solicitud va a la primera preferencia y el vetado no la recibe.
  const porUno = (await uno('/api/profesor')).data;
  assert.equal(porUno.pending.length, 1);
  assert.equal(porUno.pending[0].last_name, 'Pérez');
  assert.equal(JSON.stringify(porUno).includes('veto'), false);
  assert.equal((await tres('/api/profesor')).data.pending.length, 0);

  // Otro profesor no puede contestar una solicitud ajena.
  const requestId = porUno.pending[0].id;
  assert.equal((await dos(`/api/profesor/solicitudes/${requestId}`, 'POST', { accion: 'confirmar' })).status, 404);

  // Rechazo: pasa a la siguiente preferencia.
  assert.equal((await uno(`/api/profesor/solicitudes/${requestId}`, 'POST', { accion: 'rechazar' })).status, 200);
  assert.equal((await ana('/api/alumno')).data.status, 'en_proceso');
  const porDos = (await dos('/api/profesor')).data;
  assert.equal(porDos.pending.length, 1);

  await dos('/api/profesor/meeting', 'PUT', { meetingPlace: 'Aula 12' });
  assert.equal((await dos(`/api/profesor/solicitudes/${porDos.pending[0].id}`, 'POST', { accion: 'confirmar' })).status, 200);

  const asignada = (await ana('/api/alumno')).data;
  assert.equal(asignada.status, 'asignado');
  assert.equal(asignada.tutor.last_name, 'Dos');
  assert.equal(asignada.tutor.meeting_place, 'Aula 12');
  assert.equal((await dos('/api/profesor')).data.students[0].curso, 2);

  // Buscador: otro profesor ve quién la tutoriza.
  const found = (await uno('/api/profesor/buscar?q=ana')).data.results;
  assert.equal(found[0].tutor.last_name, 'Dos');
  assert.deepEqual((await uno('/api/profesor/buscar?q=%25%25')).data.results, []);

  // Sin vetos también es válido. Lista agotada: todos rechazan.
  const luis = await login('luis.gil');
  const luisBallot = { firstName: 'Luis', lastName: 'Gil', curso: 1, grupo: 'A', vetoes: [id.Dos, id.Tres], ranking: [id.Uno, id.Cuatro] };
  await send(luis, luisBallot);
  const cuatro = await login('p.cuatro');
  const r1 = (await uno('/api/profesor')).data.pending[0].id;
  await uno(`/api/profesor/solicitudes/${r1}`, 'POST', { accion: 'rechazar' });
  const r2 = (await cuatro('/api/profesor')).data.pending[0].id;
  await cuatro(`/api/profesor/solicitudes/${r2}`, 'POST', { accion: 'rechazar' });
  assert.equal((await luis('/api/alumno')).data.status, 'agotada');

  const sinVetos = await login('sin.vetos');
  assert.equal((await send(sinVetos, { firstName: 'Sin', lastName: 'Vetos', curso: 3, grupo: 'A', vetoes: [], ranking: [id.Uno, id.Dos, id.Tres, id.Cuatro] })).status, 200);

  // No se puede cerrar mientras falte alguien. "uso.unico" entró y no ha votado.
  adminData = (await admin('/api/admin')).data;
  assert.equal(adminData.canClose, false);
  assert.equal(adminData.stats.unanswered, 1);
  assert.equal((await admin('/api/admin/terminar', 'POST')).status, 409);

  // Asignar a mano con la elección abierta evita que quien no vota bloquee el cierre.
  const luisId = userId('luis.gil');
  assert.equal((await admin('/api/admin/asignar', 'POST', { studentId: luisId, teacherId: id.Dos })).status, 409); // vetado
  assert.equal((await admin('/api/admin/asignar', 'POST', { studentId: userId('uso.unico'), teacherId: id.Tres })).status, 200);
  assert.equal((await admin('/api/admin')).data.canClose, true);

  // Eliminar cuentas: nunca la propia.
  assert.equal((await admin(`/api/admin/usuarios/${userId('dire')}`, 'DELETE')).status, 409);
  assert.equal((await uno(`/api/admin/usuarios/${userId('uso.unico')}`, 'DELETE')).status, 403);
  assert.equal((await admin(`/api/admin/usuarios/${userId('uso.unico')}`, 'DELETE')).status, 200);
  assert.equal(userId('uso.unico'), undefined);

  // Alumno nuevo a mitad de curso: solo con la elección cerrada.
  const nuevo = { username: 'nou.alumne', firstName: 'Nou', lastName: 'Alumne', curso: 4, grupo: 'A', teacherId: id.Tres };
  assert.equal((await admin('/api/admin/alumnes', 'POST', nuevo)).status, 409);
  assert.equal((await admin('/api/admin/terminar', 'POST')).status, 200);
  assert.equal((await admin('/api/admin/alumnes', 'POST', { ...nuevo, curso: 7 })).status, 400);
  assert.equal((await admin('/api/admin/alumnes', 'POST', { ...nuevo, teacherId: 99999 })).status, 400);
  assert.equal((await admin('/api/admin/alumnes', 'POST', nuevo)).status, 200);
  assert.equal((await admin('/api/admin/alumnes', 'POST', nuevo)).status, 409);
  const porTres = (await tres('/api/profesor')).data;
  assert.equal(porTres.pending.length, 0);
  assert.equal(porTres.students[0].username, 'nou.alumne');

  // Elección cerrada: quien no contestó ya no puede.
  const eva = await login('eva.sanz');
  assert.equal((await eva('/api/alumno')).data.status, 'sin_respuesta');
  assert.equal((await send(eva, ballot({ vetoes, ranking }))).status, 409);

  adminData = (await admin('/api/admin')).data;
  assert.equal(adminData.students.find((s) => s.id === luisId).allowedTeacherIds.includes(id.Dos), false);
  assert.equal((await admin('/api/admin/asignar', 'POST', { studentId: luisId, teacherId: id.Uno })).status, 200);
  assert.equal((await luis('/api/alumno')).data.tutor.last_name, 'Uno');
  adminData = (await admin('/api/admin')).data;
  assert.deepEqual(adminData.students.map((s) => s.last_name), ['Alumne', 'Gil', 'Pérez', 'Sanz', 'Vetos']);
  assert.equal(adminData.teachers.find((t) => t.id === id.Dos).students[0].last_name, 'Pérez');

  // Niveles: un profesor con alumnos no se puede degradar y nadie se cambia a sí mismo.
  assert.equal((await admin(`/api/admin/usuarios/${userId('dire')}`, 'PATCH', { role: 'alumno' })).status, 409);
  assert.equal((await admin(`/api/admin/usuarios/${id.Dos}`, 'PATCH', { role: 'alumno' })).status, 409);

  const pdf = await admin('/api/admin/informe.pdf');
  assert.equal(pdf.status, 200);
  assert.equal(Buffer.from(pdf.data).subarray(0, 4).toString(), '%PDF');
});

test('el pas de curs borra 4.º, sube al resto y se respeta repetir tutor', async () => {
  const admin = await login('dire');
  const anaId = userId('ana.perez');
  assert.equal((await admin('/api/admin/pas-de-curs', 'POST')).data.graduated, 1);
  assert.equal((await admin('/api/admin/convocar', 'POST', { title: 'Segunda' })).status, 200);
  assert.equal(userId('nou.alumne'), undefined);
  assert.equal(db.prepare('SELECT curso FROM users WHERE id = ?').get(anaId).curso, 3);

  const ana = await login('ana.perez');
  const form = (await ana('/api/alumno')).data;
  assert.equal(form.tutor, null);
  assert.equal(form.curso, 3);
  assert.equal(form.previousTutor.last_name, 'Dos');
  const id = Object.fromEntries(form.teachers.map((t) => [t.last_name, t.id]));

  // Repetir tutor poniéndolo primero: confirmado sin pasar por el profesor.
  const dos = await login('p.dos');
  const pendingBefore = (await dos('/api/profesor')).data.pending.length;
  assert.equal((await ana('/api/alumno/eleccion', 'POST', ballot({ curso: 3, vetoes: [id.Cuatro, id.Tres], ranking: [id.Dos, id.Uno] }))).status, 200);
  const status = (await ana('/api/alumno')).data;
  assert.equal(status.status, 'asignado');
  assert.equal(status.tutor.last_name, 'Dos');
  const porDos = (await dos('/api/profesor')).data;
  assert.equal(porDos.pending.length, pendingBefore);
  assert.ok(porDos.students.some((s) => s.username === 'ana.perez'));

  // Si no lo pone primero, sigue el proceso normal aunque lo tenga en la lista.
  const luis = await login('luis.gil');
  assert.equal((await luis('/api/alumno')).data.previousTutor.last_name, 'Uno');
  await luis('/api/alumno/eleccion', 'POST', { firstName: 'Luis', lastName: 'Gil', curso: 2, grupo: 'A', vetoes: [], ranking: [id.Dos, id.Uno, id.Tres, id.Cuatro] });
  assert.equal((await luis('/api/alumno')).data.status, 'en_proceso');
  assert.ok((await dos('/api/profesor')).data.pending.some((r) => r.username === 'luis.gil'));
});

test('eliminar a un profesor pasa a sus alumnos a la siguiente preferencia', async () => {
  const admin = await login('dire');
  const [ana, luis] = [userId('ana.perez'), userId('luis.gil')];
  const tutorDos = userId('p.dos');
  assert.equal((await admin(`/api/admin/usuarios/${tutorDos}`, 'DELETE')).status, 200);
  assert.equal(userId('p.dos'), undefined);
  const request = (student) => db.prepare(`
    SELECT u.username, r.status FROM requests r JOIN users u ON u.id = r.teacher_id
    WHERE r.student_id = ? AND r.status IN ('pendiente', 'confirmada')
      AND r.election_id = (SELECT MAX(id) FROM elections)
  `).get(student);
  assert.deepEqual({ ...request(ana) }, { username: 'p.uno', status: 'pendiente' });
  assert.deepEqual({ ...request(luis) }, { username: 'p.uno', status: 'pendiente' });
});

test('websocket: exige sesión y avisa de los cambios', async () => {
  const admin = await login('dire');
  const url = base.replace('http', 'ws');

  const rejected = new WebSocket(`${url}/ws`);
  await new Promise((resolve) => { rejected.on('error', resolve); });

  const client = new WebSocket(`${url}/ws`, { headers: { cookie: lastCookie } });
  await new Promise((resolve, reject) => { client.on('open', resolve); client.on('error', reject); });
  const notified = new Promise((resolve) => { client.on('message', (m) => resolve(m.toString())); });
  await admin('/api/admin/usuarios', 'POST', { username: 'p.ws', role: 'profesor' });
  assert.equal(await notified, 'changed');
  client.close();
});

test('migra bases de datos con el nombre en una sola columna', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tutoria-'));
  try {
    const path = join(dir, 'old.db');
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'alumno', curso INTEGER, grupo TEXT, meeting_place TEXT);
      INSERT INTO users (username, name) VALUES ('ana', 'Ana Pérez García');`);
    old.close();
    const migrated = openDb(path);
    const user = migrated.prepare('SELECT * FROM users').get();
    assert.equal(user.first_name, 'Ana');
    assert.equal(user.last_name, 'Pérez García');
    assert.equal(user.name, undefined);
    migrated.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('login de prueba: solo con el modo activo y con prof, alm o admn y número', async () => {
  const send = (url, username) => fetch(`${url}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });

  // Modo apagado (servidor principal): prof1 tiene que confirmar el correo.
  const off = await send(base, 'prof1');
  assert.equal((await off.json()).direct, undefined);
  assert.equal(off.headers.get('set-cookie'), null);

  const testDb = openDb(':memory:');
  testDb.prepare(`INSERT INTO users (username, first_name, role) VALUES ('prof.admin1', 'Admin', 'admin')`).run();
  const sent = [];
  const testServer = await new Promise((resolve) => {
    const s = createApp({ db: testDb, sendMail: async (m) => sent.push(m), appUrl: 'http://test', testLogin: true })
      .listen(0, () => resolve(s));
  });
  const url = `http://127.0.0.1:${testServer.address().port}`;
  const roleAfterLogin = async (username) => {
    const res = await send(url, username);
    assert.equal((await res.json()).direct, true, username);
    const cookie = res.headers.get('set-cookie').split(';')[0];
    return (await (await fetch(`${url}/api/me`, { headers: { cookie } })).json()).user.role;
  };
  try {
    assert.equal(await roleAfterLogin('prof1'), 'profesor');
    assert.equal(await roleAfterLogin('alm1'), 'alumno');
    assert.equal(await roleAfterLogin('admn1'), 'admin');
    assert.equal(sent.length, 0);

    for (const username of ['profe', 'alumna', 'admn', 'marta1', 'prof.admin1']) {
      const res = await send(url, username);
      assert.equal((await res.json()).direct, undefined, username);
      assert.equal(res.headers.get('set-cookie'), null, username);
    }
    assert.equal(sent.length, 5);
  } finally {
    testServer.close();
  }
});
