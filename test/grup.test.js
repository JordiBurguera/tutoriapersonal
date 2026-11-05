import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { reminderRecipients, reminderTick, sendReminders } from '../src/reminders.js';

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

const setClass = (username, curso, grupo, lastName) =>
  db.prepare('UPDATE users SET curso = ?, grupo = ?, last_name = ? WHERE username = ?').run(curso, grupo, lastName, username);

test('tutoría de grupo, recordatorio y borrar respuesta', async () => {
  const admin = await login('admn1');
  const [prof1, prof2, prof3] = [await login('prof1'), await login('prof2'), await login('prof3')];

  // Autoalta: se puede cambiar, quitar y compartir grupo.
  assert.equal((await prof1('/api/profesor/grup', 'PUT', { group: '9Z' })).status, 400);
  assert.equal((await prof1('/api/profesor/grup', 'PUT', { group: '1A' })).status, 200);
  assert.equal((await prof1('/api/profesor')).data.tutorGroup, '1A');
  assert.equal((await prof1('/api/profesor')).data.group, null); // aún sin elecciones
  assert.equal((await prof1('/api/profesor/grup', 'PUT', { group: '2B' })).status, 200);
  assert.equal((await prof2('/api/profesor/grup', 'PUT', { group: '2B' })).status, 200);
  assert.equal((await prof3('/api/profesor/grup', 'PUT', { group: '' })).status, 200);
  assert.equal((await prof3('/api/profesor')).data.tutorGroup, null);

  assert.deepEqual(reminderRecipients(db), []);
  await admin('/api/admin/convocar', 'POST', { title: 'Curs' });

  const [alm1, alm2, alm3] = [await login('alm1'), await login('alm2'), await login('alm3')];
  setClass('alm2', 2, 'B', 'Aznar');
  setClass('alm3', 3, 'A', 'Costa');
  const ids = Object.fromEntries((await alm1('/api/alumno')).data.teachers.map((t) => [t.first_name, t.id]));

  // Antes de votar nadie: los dos tutores de 2.º B tienen alumnos que faltan (alm2).
  assert.deepEqual(reminderRecipients(db).sort(), ['prof1', 'prof2']);

  await alm1('/api/alumno/eleccion', 'POST', {
    firstName: 'Ana', lastName: 'Pérez', curso: 2, grupo: 'B', vetoes: [ids.Prof1], ranking: [ids.Prof3, ids.Prof2],
  });
  assert.deepEqual(reminderRecipients(db).sort(), ['prof1', 'prof2', 'prof3']);

  // Estado de la clase: solo su grupo, ordenado por apellido y sin vetos ni preferencias.
  const panel = (await prof1('/api/profesor')).data;
  assert.deepEqual({ ...panel.group.stats }, { students: 2, unanswered: 1, waiting: 1, confirmed: 0 });
  assert.deepEqual(panel.group.students.map((s) => s.last_name), ['Aznar', 'Pérez']);
  assert.equal(/veto|ranking|allowed|position/i.test(JSON.stringify(panel.group)), false);

  // El correo no menciona alumnado y llega una sola vez por persona.
  const mails = [];
  const sent = await sendReminders({ db, sendMail: async (m) => mails.push(m), appUrl: 'http://app' });
  assert.equal(sent, 3);
  assert.equal(new Set(mails.map((m) => m.to)).size, 3);
  for (const mail of mails) {
    assert.ok(mail.text.includes('http://app/'));
    assert.equal(/Ana|Pérez|Aznar|Costa|alm\d/.test(mail.subject + mail.text), false);
  }

  // Una vez al día, a partir de la hora indicada en horario de Madrid.
  const tickMails = [];
  const tick = (iso) => reminderTick({ db, sendMail: async (m) => tickMails.push(m), appUrl: 'http://app', hour: 8, now: new Date(iso) });
  assert.equal(await tick('2026-11-05T06:30:00Z'), null); // 07:30 en Madrid
  assert.equal(await tick('2026-11-05T07:30:00Z'), 3);    // 08:30 en Madrid
  assert.equal(await tick('2026-11-05T15:00:00Z'), null);
  assert.equal(await tick('2026-11-06T07:30:00Z'), 3);
  assert.equal(tickMails.length, 6);

  // Borrar respuesta: vuelve a poder votar y el profesor pierde la solicitud.
  const alm1Id = db.prepare(`SELECT id FROM users WHERE username = 'alm1'`).get().id;
  assert.equal((await prof1(`/api/admin/alumnes/${alm1Id}/resposta`, 'DELETE')).status, 403);
  assert.equal((await admin(`/api/admin/alumnes/${alm1Id}/resposta`, 'DELETE')).status, 200);
  assert.equal((await admin(`/api/admin/alumnes/${alm1Id}/resposta`, 'DELETE')).status, 404);
  assert.equal((await alm1('/api/alumno')).data.status, 'por_contestar');
  assert.equal((await prof3('/api/profesor')).data.pending.length, 0);
  assert.equal((await alm1('/api/alumno/eleccion', 'POST', {
    firstName: 'Ana', lastName: 'Pérez', curso: 2, grupo: 'B', vetoes: [], ranking: [ids.Prof3, ids.Prof2, ids.Prof1],
  })).status, 200);

  // Con la elección cerrada: solo cuentan las solicitudes pendientes, y no se borran respuestas.
  await alm2('/api/alumno/eleccion', 'POST', {
    firstName: 'Bea', lastName: 'Aznar', curso: 2, grupo: 'B', vetoes: [], ranking: [ids.Prof3, ids.Prof2, ids.Prof1],
  });
  await alm3('/api/alumno/eleccion', 'POST', {
    firstName: 'Pep', lastName: 'Costa', curso: 3, grupo: 'A', vetoes: [], ranking: [ids.Prof3, ids.Prof2, ids.Prof1],
  });
  assert.equal((await admin('/api/admin/terminar', 'POST')).status, 200);
  assert.deepEqual(reminderRecipients(db), ['prof3']);
  assert.equal((await admin(`/api/admin/alumnes/${alm1Id}/resposta`, 'DELETE')).status, 409);
});
