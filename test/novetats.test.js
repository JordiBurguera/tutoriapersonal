// Límite de alumnos, fecha límite, avisos, historial, Excel e importación.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { readTable, writeWorkbook } from '../src/xlsx.js';
import { parseCurso, parseGrupo } from '../src/importar.js';

const db = openDb(':memory:');
const mails = [];
let server;
let base;

before(async () => {
  db.prepare(`INSERT INTO users (username, first_name, last_name, role) VALUES ('dire', 'Direcció', 'Centre', 'admin')`).run();
  const app = createApp({ db, sendMail: async (mail) => mails.push(mail), appUrl: 'http://test' });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function login(username) {
  db.prepare('DELETE FROM login_tokens WHERE username = ?').run(username);
  await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username }) });
  const token = mails.filter((m) => m.to === `${username}@lescarolines.com`).at(-1).text.match(/token=([\w-]+)/)[1];
  const verify = await fetch(`${base}/auth/verify`, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }),
  });
  const cookie = verify.headers.get('set-cookie').split(';')[0];
  return async (path, method = 'GET', body, raw = false) => {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { cookie, ...(body && !raw ? { 'Content-Type': 'application/json' } : {}), ...(raw ? { 'Content-Type': 'application/octet-stream' } : {}) },
      body: raw ? body : body ? JSON.stringify(body) : undefined,
    });
    const isJson = r.headers.get('content-type')?.includes('json');
    return { status: r.status, data: isJson ? await r.json() : Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') };
  };
}

const id = (username) => db.prepare('SELECT id FROM users WHERE username = ?').get(username)?.id;
const statusOf = (data, username) => data.students.find((s) => s.username === username)?.status;

let admin;
const profs = {};

test('preparación: profesorado y convocatoria', async () => {
  admin = await login('dire');
  for (const u of ['prof.a', 'prof.b']) {
    assert.equal((await admin('/api/admin/usuarios', 'POST', { username: u, role: 'profesor' })).status, 200);
    profs[u] = await login(u);
    await profs[u]('/api/profesor/perfil', 'PUT', { firstName: u === 'prof.a' ? 'Anna' : 'Berta', lastName: 'Prof', department: 'Matemàtiques' });
  }
  assert.equal((await admin('/api/admin/convocar', 'POST', { title: 'Curs X' })).status, 200);
});

test('límite: un profesor lleno no recibe más solicitudes y las pendientes pasan al siguiente', async () => {
  assert.equal((await admin('/api/admin/limit', 'PUT', { value: 0 })).status, 400);
  assert.equal((await admin('/api/admin/professors/' + id('prof.a') + '/limit', 'PUT', { value: 1 })).status, 200);
  const order = [id('prof.a'), id('prof.b')];
  const vote = async (u) => {
    const s = await login(u);
    const r = await s('/api/alumno/eleccion', 'POST', { firstName: u, lastName: 'Alumne', curso: 1, grupo: 'A', vetoes: [], ranking: order });
    assert.equal(r.status, 200);
    return s;
  };
  await vote('alm.uno');
  await vote('alm.dos');
  const pending = (await profs['prof.a']('/api/profesor')).data.pending;
  assert.equal(pending.length, 2);
  // Acepta al primero: se llena y el segundo pasa a prof.b.
  assert.equal((await profs['prof.a'](`/api/profesor/solicitudes/${pending[0].id}`, 'POST', { accion: 'confirmar' })).status, 200);
  assert.equal((await profs['prof.a']('/api/profesor')).data.pending.length, 0);
  assert.equal((await profs['prof.b']('/api/profesor')).data.pending.length, 1);
  // Un tercero ya no le llega a prof.a.
  await vote('alm.tres');
  assert.equal((await profs['prof.a']('/api/profesor')).data.pending.length, 0);
  const data = (await admin('/api/admin')).data;
  const a = data.teachers.find((t) => t.username === 'prof.a');
  assert.equal(a.limit, 1);
  assert.equal(a.students.length, 1);
  assert.equal(a.firstChoiceCount, 3);
  // El alumno confirmado recibe aviso en la campana y por correo.
  const confirmed = db.prepare(`SELECT student_id FROM requests WHERE teacher_id = ? AND status = 'confirmada'`).get(id('prof.a')).student_id;
  const who = db.prepare('SELECT username FROM users WHERE id = ?').get(confirmed).username;
  const student = await login(who);
  const me = (await student('/api/me')).data.user;
  assert.ok(me.unread >= 1); // entró después de convocar: solo el de confirmación
  const avisos = (await student('/api/avisos')).data;
  assert.match(avisos.items[0].text, /ha acceptat ser el teu tutor/);
  assert.equal((await student('/api/avisos/llegits', 'POST')).status, 200);
  assert.equal((await student('/api/me')).data.user.unread, 0);
  assert.ok(mails.some((m) => m.to === `${who}@lescarolines.com` && m.subject === 'Ja tens tutor personal'));
});

test('sin fecha límite: mientras falte alumnado no se puede cerrar', async () => {
  const late = await login('alm.tard');
  assert.equal((await late('/api/alumno')).data.status, 'por_contestar');
  assert.equal((await late('/api/alumno')).data.deadline, undefined);
  const data = (await admin('/api/admin')).data;
  assert.equal(data.canClose, false);
  assert.equal((await admin('/api/admin/termini', 'PUT', { deadline: Date.now() + 3600 * 1000 })).status, 404);
});

test('historial: registra las acciones y solo lo ve administración', async () => {
  const items = (await admin('/api/admin/historial')).data.items;
  const actions = items.map((i) => i.action);
  for (const action of ['Eleccions convocades', 'Límit de professor canviat', 'Sol·licitud acceptada', 'Resposta enviada']) {
    assert.ok(actions.includes(action), action);
  }
  assert.equal((await profs['prof.a']('/api/admin/historial')).status, 403);
});

test('Excel: el informe se descarga y se puede leer', async () => {
  const r = await admin('/api/admin/informe.xlsx');
  assert.equal(r.status, 200);
  assert.match(r.type, /spreadsheetml/);
  const rows = readTable(r.data);
  assert.equal(rows[0][0], 'Tutoria personal · Resum');
  assert.equal((await profs['prof.a']('/api/admin/informe.xlsx')).status, 403);
  const template = await admin('/api/admin/plantilla.xlsx');
  assert.equal(template.status, 200);
});

test('importar: vista previa con errores y confirmación', async () => {
  assert.equal(parseCurso('3r'), 3);
  assert.equal(parseGrupo('2n B'), 'B');
  assert.equal(parseGrupo('1ESO A'), 'A');
  const file = writeWorkbook([{ name: 'A', rows: [
    { cells: ['Títol qualsevol'] },
    { cells: ['Correu', 'Nom', 'Cognoms', 'Classe'] },
    { cells: ['nou.alumne@lescarolines.com', 'Nou', 'Alumne', '3r A'] },
    { cells: ['alm.uno', 'Uno', 'Canviat', '2n B'] },
    { cells: ['prof.a', 'X', 'Y', '1A'] },
    { cells: ['algu@gmail.com', 'X', 'Y', '1A'] },
    { cells: ['sense.curs', 'X', 'Y', ''] },
  ] }]);
  const preview = await admin('/api/admin/importar', 'POST', file, true);
  assert.equal(preview.status, 200);
  const actions = preview.data.rows.map((r) => r.action);
  assert.deepEqual(actions, ['nou', 'actualitza', 'error', 'error', 'error']);
  const ok = preview.data.rows.filter((r) => r.action !== 'error');
  const done = await admin('/api/admin/importar/confirmar', 'POST', { rows: ok });
  assert.equal(done.status, 200);
  assert.equal(done.data.created, 1);
  assert.equal(done.data.updated, 1);
  const nou = db.prepare('SELECT * FROM users WHERE username = ?').get('nou.alumne');
  assert.equal(nou.curso, 3);
  assert.equal(nou.role, 'alumno');
  // CSV con punto y coma.
  const csv = Buffer.from('﻿usuari;nom;cognoms;curs;grup\ncsv.alumne;Csv;Prova;4;B\n');
  const csvPreview = await admin('/api/admin/importar', 'POST', csv, true);
  assert.deepEqual(csvPreview.data.rows.map((r) => [r.username, r.curso, r.grupo, r.action]), [['csv.alumne', 4, 'B', 'nou']]);
  // Sin columna de correo.
  const bad = await admin('/api/admin/importar', 'POST', Buffer.from('a;b\n1;2\n'), true);
  assert.equal(bad.status, 400);
});
