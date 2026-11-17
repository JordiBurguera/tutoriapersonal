import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  department TEXT,
  role TEXT NOT NULL DEFAULT 'alumno' CHECK (role IN ('alumno','profesor','admin')),
  curso INTEGER,
  grupo TEXT,
  meeting_place TEXT,
  tutor_group TEXT,
  promotion_mark TEXT
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS login_tokens (
  token_hash TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS elections (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  opened_at INTEGER NOT NULL,
  closed_at INTEGER
);
CREATE TABLE IF NOT EXISTS ballots (
  election_id INTEGER NOT NULL REFERENCES elections(id),
  student_id INTEGER NOT NULL REFERENCES users(id),
  submitted_at INTEGER NOT NULL,
  PRIMARY KEY (election_id, student_id)
);
-- Una fila por profesor: position indica la preferencia; vetoed=1 si "no me puede tocar".
CREATE TABLE IF NOT EXISTS ballot_choices (
  election_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  teacher_id INTEGER NOT NULL REFERENCES users(id),
  position INTEGER,
  vetoed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (election_id, student_id, teacher_id)
);
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY,
  election_id INTEGER NOT NULL REFERENCES elections(id),
  student_id INTEGER NOT NULL REFERENCES users(id),
  teacher_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('pendiente','confirmada','rechazada','cancelada')),
  manual INTEGER NOT NULL DEFAULT 0,
  UNIQUE (election_id, student_id, teacher_id)
);
-- Permiso para cambiar datos: lo pide el alumno y lo confirma el profesor que lo tiene a su cargo.
CREATE TABLE IF NOT EXISTS student_edit_requests (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pendiente','aprobada','rechazada','usada','cancelada')),
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_edit_request
  ON student_edit_requests (student_id) WHERE status IN ('pendiente','aprobada');
-- Cambios de datos hechos por el alumnado y profesor que los confirmó. El nombre sobrevive a su cuenta.
CREATE TABLE IF NOT EXISTS student_data_changes (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  teacher_name TEXT NOT NULL,
  changed_at INTEGER NOT NULL,
  before_data TEXT NOT NULL,
  after_data TEXT NOT NULL
);
-- Historial de acciones. Guarda el nombre de quien la hizo para que sobreviva a su cuenta.
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  actor_id INTEGER,
  actor_name TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS audit_log_at ON audit_log (at);
-- Avisos dentro de la aplicación (la campana).
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at INTEGER NOT NULL,
  text TEXT NOT NULL,
  read_at INTEGER
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications (user_id, at);
`;

// Bases de datos anteriores guardaban el nombre completo en una sola columna.
function migrate(db) {
  const columns = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!columns.includes('tutor_group')) db.exec('ALTER TABLE users ADD COLUMN tutor_group TEXT');
  if (!columns.includes('promotion_mark')) db.exec('ALTER TABLE users ADD COLUMN promotion_mark TEXT');
  // Límite de alumnos de cada profesor (vacío: el general).
  if (!columns.includes('max_students')) db.exec('ALTER TABLE users ADD COLUMN max_students INTEGER');
  // Fecha límite para contestar.
  const electionColumns = db.prepare('PRAGMA table_info(elections)').all().map((c) => c.name);
  if (!electionColumns.includes('deadline')) db.exec('ALTER TABLE elections ADD COLUMN deadline INTEGER');
  if (columns.includes('first_name')) return;
  db.exec(`
    ALTER TABLE users ADD COLUMN first_name TEXT NOT NULL DEFAULT '';
    ALTER TABLE users ADD COLUMN last_name TEXT NOT NULL DEFAULT '';
    ALTER TABLE users ADD COLUMN department TEXT;
  `);
  const update = db.prepare('UPDATE users SET first_name = ?, last_name = ? WHERE id = ?');
  for (const { id, name } of db.prepare('SELECT id, name FROM users').all()) {
    const [first, ...rest] = name.trim().split(/\s+/);
    update.run(first, rest.join(' '), id);
  }
  db.exec('ALTER TABLE users DROP COLUMN name');
}

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
