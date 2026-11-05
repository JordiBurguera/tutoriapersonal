import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { byLastName, displayName } from '../src/election.js';
import { createLive } from '../src/live.js';

const dir = mkdtempSync(join(tmpdir(), 'tutoria-transversal-'));
const db = openDb(join(dir, 'a.db'));
const live = createLive();
let server;
let base;

const sha = (t) => createHash('sha256').update(t).digest('hex');

before(async () => {
  db.prepare(`INSERT INTO users (username, first_name, last_name, role) VALUES ('dire', 'Dir', 'Zeta', 'admin')`).run();
  const app = createApp({ db, sendMail: async () => {}, appUrl: 'http://test', broadcast: live.broadcast });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  live.attach(server, app.locals.userFromCookie);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  live.close();
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

function connect(cookie) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://${base.slice(7)}/ws`, { headers: cookie ? { cookie } : {} });
    ws.on('open', () => resolve({ ok: true, ws }));
    ws.on('unexpected-response', (req, res) => resolve({ ok: false, status: res.statusCode }));
    ws.on('error', () => {});
  });
}

test('WebSocket exige sesión válida y no caducada', async () => {
  const adminId = db.prepare(`SELECT id FROM users WHERE username = 'dire'`).get().id;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha('buena'), adminId, Date.now() + 60_000);
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha('vieja'), adminId, Date.now() - 1000);

  assert.deepEqual(await connect(), { ok: false, status: 401 });
  assert.deepEqual(await connect('sesion=inventada'), { ok: false, status: 401 });
  assert.deepEqual(await connect('sesion=vieja'), { ok: false, status: 401 });
  const good = await connect('sesion=buena');
  assert.equal(good.ok, true);

  const message = new Promise((resolve) => good.ws.once('message', (m) => resolve(String(m))));
  const res = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'x1' }) });
  assert.equal(res.status, 200);
  assert.equal(await message, 'changed');
  good.ws.close();
});

test('un JSON mal formado devuelve un error en valencià', async () => {
  const res = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{mal' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'Petició no vàlida.');
});

test('orden por apellido con collation catalana y formato "Cognoms, Nom"', () => {
  const people = ['Zamora', 'Álvarez', 'Çabrera', 'Bosch', 'Cabrera'].map((last_name) => ({ first_name: 'N', last_name }));
  assert.deepEqual(people.sort(byLastName).map((p) => p.last_name), ['Álvarez', 'Bosch', 'Çabrera', 'Cabrera', 'Zamora']);
  assert.equal(displayName({ first_name: 'Anna', last_name: 'Pons' }), 'Pons, Anna');
});

test('migra una base con el esquema antiguo (columna name)', () => {
  const path = join(dir, 'vieja.db');
  const old = new DatabaseSync(path);
  old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'alumno' CHECK (role IN ('alumno','profesor','admin')), curso INTEGER, grupo TEXT);
    INSERT INTO users (username, name, role) VALUES ('anna', 'Anna Pons Ferrer', 'alumno');`);
  old.close();
  const migrated = openDb(path);
  const row = migrated.prepare(`SELECT * FROM users WHERE username = 'anna'`).get();
  assert.equal(row.first_name, 'Anna');
  assert.equal(row.last_name, 'Pons Ferrer');
  assert.ok('tutor_group' in row && 'promotion_mark' in row && !('name' in row));
  openDb(path).close(); // idempotente
  migrated.close();
});

test('.env.example documenta todas las variables que lee el código', () => {
  const env = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  const used = new Set();
  for (const f of ['index.js', 'recordatori.js', 'mail.js']) {
    for (const m of readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8').matchAll(/(?:process\.env|\benv)\.([A-Z_]+)/g)) used.add(m[1]);
  }
  assert.ok(used.size >= 8);
  for (const name of used) assert.match(env, new RegExp(`^${name}=`, 'm'), name);
});
