import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createApp, normalizeUsername } from '../src/app.js';
import { openDb } from '../src/db.js';
import { createMailer } from '../src/mail.js';

const db = openDb(':memory:');
const mails = [];
let server;
let base;
const hash = (t) => createHash('sha256').update(t).digest('hex');

before(async () => {
  db.prepare(`INSERT INTO users (username, first_name, last_name, role) VALUES ('dire', 'D', '', 'admin')`).run();
  const app = createApp({ db, sendMail: async (m) => mails.push(m), appUrl: 'https://test', testLogin: true });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const post = (path, body, headers = {}) => fetch(`${base}${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});

test('normalización de usuario y dominio', () => {
  assert.equal(normalizeUsername('  Ana.Gil@LesCarolines.com '), 'ana.gil');
  assert.equal(normalizeUsername('ana@gmail.com'), null);
  assert.equal(normalizeUsername('ana@lescarolines.com.evil.com'), null);
  assert.equal(normalizeUsername('a b'), null);
  assert.equal(normalizeUsername(''), null);
  assert.equal(normalizeUsername(['x']), null);
});

test('magic link: hash en DB, expiración, un solo uso, sesión con cookie segura y hasheada', async () => {
  await post('/api/login', { username: 'Nou.Alumne@lescarolines.com' });
  const token = mails.at(-1).text.match(/token=([\w-]+)/)[1];
  assert.equal(mails.at(-1).to, 'nou.alumne@lescarolines.com');
  assert.equal(db.prepare('SELECT 1 FROM login_tokens WHERE token_hash = ?').get(token), undefined);
  const row = db.prepare('SELECT * FROM login_tokens WHERE token_hash = ?').get(hash(token));
  assert.ok(Math.abs(row.expires_at - row.created_at - 15 * 60 * 1000) < 1000);

  // El GET no gasta el token
  assert.equal((await fetch(`${base}/auth/verify?token=${token}`)).status, 200);
  assert.equal(db.prepare('SELECT used_at FROM login_tokens WHERE token_hash = ?').get(hash(token)).used_at, null);

  // Caducado
  db.prepare('UPDATE login_tokens SET expires_at = ? WHERE token_hash = ?').run(Date.now() - 1, hash(token));
  const form = { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }) };
  assert.equal((await fetch(`${base}/auth/verify`, form)).status, 400);
  db.prepare('UPDATE login_tokens SET expires_at = ? WHERE token_hash = ?').run(Date.now() + 1000, hash(token));

  const ok = await fetch(`${base}/auth/verify`, form);
  assert.equal(ok.status, 303);
  const cookie = ok.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.match(cookie, /Secure/i); // appUrl https
  assert.match(cookie, /Max-Age=2592000/);
  const session = cookie.split(';')[0].split('=')[1];
  assert.equal(db.prepare('SELECT 1 FROM sessions WHERE token_hash = ?').get(session), undefined);
  const s = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(hash(session));
  assert.ok(Math.abs(s.expires_at - Date.now() - 30 * 24 * 3600 * 1000) < 5000);
  assert.equal(db.prepare('SELECT role FROM users WHERE username = ?').get('nou.alumne').role, 'alumno');

  assert.equal((await fetch(`${base}/auth/verify`, form)).status, 400); // un solo uso

  const cookieHeader = { Cookie: `sesion=${session}` };
  assert.equal((await fetch(`${base}/api/alumno`, { headers: cookieHeader })).status, 200);
  assert.equal((await fetch(`${base}/api/profesor`, { headers: cookieHeader })).status, 403);
  assert.equal((await fetch(`${base}/api/admin`, { headers: cookieHeader })).status, 403);

  // Sesión caducada
  db.prepare('UPDATE sessions SET expires_at = ?').run(Date.now() - 1);
  assert.equal((await fetch(`${base}/api/alumno`, { headers: cookieHeader })).status, 401);
  db.prepare('UPDATE sessions SET expires_at = ?').run(Date.now() + 100000);
  // Logout
  await post('/api/logout', {}, cookieHeader);
  assert.equal((await fetch(`${base}/api/alumno`, { headers: cookieHeader })).status, 401);
});

test('todas las rutas /api protegidas exigen sesión', async () => {
  const routes = [
    ['GET', '/api/alumno'], ['POST', '/api/alumno/eleccion'], ['GET', '/api/profesor'], ['PUT', '/api/profesor/grup'],
    ['PUT', '/api/profesor/perfil'], ['POST', '/api/profesor/solicitudes/1'], ['PUT', '/api/profesor/meeting'],
    ['GET', '/api/profesor/buscar'], ['GET', '/api/admin'], ['POST', '/api/admin/convocar'],
    ['PUT', '/api/admin/pas-de-curs/1'], ['POST', '/api/admin/pas-de-curs'], ['POST', '/api/admin/terminar'],
    ['POST', '/api/admin/usuarios'], ['POST', '/api/admin/alumnes'], ['PATCH', '/api/admin/usuarios/1'],
    ['DELETE', '/api/admin/usuarios/1'], ['DELETE', '/api/admin/alumnes/1/resposta'], ['POST', '/api/admin/asignar'],
    ['GET', '/api/admin/informe.pdf'],
  ];
  for (const [method, path] of routes) {
    const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
    assert.equal(res.status, 401, `${method} ${path}`);
  }
});

test('login de prueba: rol por nombre, administrador existente exige correo', async () => {
  for (const [u, role] of [['prof7', 'profesor'], ['alm7', 'alumno'], ['admn7', 'admin']]) {
    const res = await post('/api/login', { username: u });
    assert.equal((await res.json()).direct, true);
    assert.equal(db.prepare('SELECT role FROM users WHERE username = ?').get(u).role, role);
  }
  for (const u of ['prof', 'alm', 'pepe1']) {
    assert.equal((await (await post('/api/login', { username: u })).json()).direct, undefined, u);
  }
});

test('mailer sin SMTP imprime en consola y no abre conexión', async () => {
  const orig = console.log; const origWarn = console.warn;
  let out = ''; console.log = (s) => { out += s; }; console.warn = () => {};
  try { await createMailer({})({ to: 'a@b', subject: 's', text: 'hola' }); } finally { console.log = orig; console.warn = origWarn; }
  assert.match(out, /hola/);
});
