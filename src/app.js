import express from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { tx } from './db.js';
import { audit, fullName, notify, unreadCount } from './activity.js';
import {
  advance, ballotOf, byLastName, defaultLimit, deleteUser, displayName,
  electionStats, isFull, isOpen, latestElection, listStudents, listTeachers, previousTutor, releaseIfFull, studentStatus,
  studentsOfTeacher, teacherLimit, tutorOf, vetoedTeacherIds,
} from './election.js';
import { applyImport, previewImport } from './importar.js';
import { buildReport, buildTemplate } from './informe-xlsx.js';
import { writeReport } from './pdf.js';

export const DOMAIN = 'lescarolines.com';
export const DEPARTMENTS = [
  'Anglés', 'Biologia i Geologia', 'Castellà', 'Clàssiques', 'Economia', 'Educació Física',
  'Educació Plàstica', 'Filosofia', 'Física i Química', 'Francés', 'Geografia i Història',
  'Informàtica', 'Matemàtiques', 'Música', 'Orientació', 'Religió', 'Tecnologia', 'Valencià',
];
const GROUPS = ['1A', '1B', '2A', '2B', '3A', '3B', '4A', '4B'];
const MAX_VETOES = 2;
const LOGIN_TOKEN_MS = 15 * 60 * 1000;
const LOGIN_THROTTLE_MS = 60 * 1000;
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const COOKIE = 'sesion';
const ROLES = ['alumno', 'profesor', 'admin'];

const hash = (token) => createHash('sha256').update(token).digest('hex');

// Acepta "usuario" o "usuario@lescarolines.com". Cualquier otro dominio se rechaza.
export function normalizeUsername(input) {
  if (typeof input !== 'string') return null;
  const value = input.trim().toLowerCase();
  const username = value.endsWith(`@${DOMAIN}`) ? value.slice(0, -DOMAIN.length - 1) : value;
  return /^[a-z0-9][a-z0-9._-]{0,63}$/.test(username) ? username : null;
}

export function namesFromUsername(username) {
  const [first, ...rest] = username.split(/[._-]+/).filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1));
  return { firstName: first, lastName: rest.join(' ') };
}

const cleanText = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function requireNames(body) {
  const firstName = cleanText(body?.firstName, 60);
  const lastName = cleanText(body?.lastName, 100);
  if (!firstName || !lastName) throw httpError(400, 'Escriu el nom i els cognoms.');
  return { firstName, lastName };
}

function requireClass(body) {
  if (![1, 2, 3, 4].includes(body?.curso)) throw httpError(400, "Tria un curs de l'1 al 4.");
  if (!['A', 'B'].includes(body?.grupo)) throw httpError(400, 'Tria el grup A o B.');
  return { curso: body.curso, grupo: body.grupo };
}

const ROLE_NAME = { alumno: 'Alumnat', profesor: 'Professor', admin: 'Administrador' };
const ORDINAL = { 1: '1r', 2: '2n', 3: '3r', 4: '4t' };
const classLabelOf = (s) => (s.curso ? `${ORDINAL[s.curso]} ${s.grupo}` : '');


// TEMPORAL, solo para pruebas: ver LOGIN_PRUEBA en .env.example.
function testRole(username) {
  if (!/\d/.test(username)) return null;
  if (username.includes('prof')) return 'profesor';
  if (username.includes('alm')) return 'alumno';
  if (username.includes('admn')) return 'admin';
  return null;
}

const sessionToken = (cookieHeader) =>
  (cookieHeader || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`))?.[1];

// Páginas del enlace de acceso: las sirve el servidor, sin la aplicación, pero con su logo.
const authPage = (title, body) => `<!doctype html><html lang="ca-ES-valencia"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
      <title>${title}</title><link rel="stylesheet" href="/style.css"><main class="auth-card">
      <img class="logo" src="/assets/logo-lescarolines.png" alt="Escola Les Carolines" width="292" height="75">
      <h1>${title}</h1>
      ${body}
      </main></html>`;

export function createApp({ db, sendMail, appUrl, testLogin = false, broadcast = () => {} }) {
  const app = express();
  const root = join(import.meta.dirname, '..');
  const secureCookie = appUrl.startsWith('https://');
  app.use(express.json());
  app.use(express.static(join(root, 'public')));
  app.get('/vendor/Sortable.min.js', (req, res) => {
    res.sendFile(join(root, 'node_modules/sortablejs/Sortable.min.js'));
  });

  // Cualquier escritura correcta avisa a los clientes conectados.
  app.use((req, res, next) => {
    if (req.method !== 'GET') {
      res.on('finish', () => {
        if (res.statusCode < 400) broadcast();
      });
    }
    next();
  });

  // Correos de aviso: si fallan no deben deshacer la acción que los ha provocado.
  const mailQuietly = (username, subject, text) => {
    Promise.resolve()
      .then(() => sendMail({ to: `${username}@${DOMAIN}`, subject, text: `${text}\n\n${appUrl}/\n` }))
      .catch((err) => console.error(`Error enviando aviso a ${username}:`, err.message));
  };
  const userById = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);

  const createUser = (username, role = 'alumno', names = namesFromUsername(username)) => {
    db.prepare('INSERT INTO users (username, first_name, last_name, role) VALUES (?, ?, ?, ?)')
      .run(username, names.firstName, names.lastName, role);
    return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  };

  // --- Sesión ---

  const userFromCookie = (cookieHeader) => {
    const token = sessionToken(cookieHeader);
    if (!token) return null;
    return db.prepare(`
      SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?
    `).get(hash(token), Date.now()) ?? null;
  };
  app.locals.userFromCookie = userFromCookie;

  const startSession = (res, userId) => {
    const session = randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(hash(session), userId, Date.now() + SESSION_MS);
    res.cookie(COOKIE, session, { httpOnly: true, sameSite: 'lax', secure: secureCookie, maxAge: SESSION_MS });
  };

  const requireUser = (req, res, next) => {
    req.user = userFromCookie(req.headers.cookie);
    if (!req.user) throw httpError(401, 'Inicia sessió.');
    next();
  };

  const requireRole = (role) => (req, res, next) => {
    req.user = userFromCookie(req.headers.cookie);
    if (!req.user) throw httpError(401, 'Inicia sessió.');
    if (req.user.role !== role) throw httpError(403, 'No tens permís.');
    next();
  };

  app.get('/api/me', (req, res) => {
    const user = userFromCookie(req.headers.cookie);
    res.json({
      domain: DOMAIN,
      user: user && {
        id: user.id, username: user.username, firstName: user.first_name, lastName: user.last_name, role: user.role,
        unread: unreadCount(db, user.id),
      },
    });
  });

  // --- Avisos (campana) ---

  app.get('/api/avisos', requireUser, (req, res) => {
    const items = db.prepare('SELECT id, at, text, read_at FROM notifications WHERE user_id = ? ORDER BY at DESC, id DESC LIMIT 40')
      .all(req.user.id);
    res.json({ items, unread: unreadCount(db, req.user.id) });
  });

  app.post('/api/avisos/llegits', requireUser, (req, res) => {
    db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(Date.now(), req.user.id);
    res.json({ ok: true });
  });

  app.post('/api/login', async (req, res) => {
    const username = normalizeUsername(req.body?.username);
    if (!username) throw httpError(400, `Escriu només el teu usuari de @${DOMAIN}.`);

    const role = testLogin ? testRole(username) : null;
    if (role) {
      const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) ?? createUser(username, role);
      // Un administrador solo entra sin correo si su usuario es de prueba de administrador (admn1).
      if (user.role !== 'admin' || role === 'admin') {
        startSession(res, user.id);
        return res.json({ ok: true, direct: true });
      }
    }

    const now = Date.now();
    db.prepare('DELETE FROM login_tokens WHERE expires_at < ?').run(now);
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);

    const recent = db.prepare('SELECT 1 FROM login_tokens WHERE username = ? AND created_at > ?')
      .get(username, now - LOGIN_THROTTLE_MS);
    if (!recent) {
      const token = randomBytes(32).toString('base64url');
      db.prepare('INSERT INTO login_tokens (token_hash, username, created_at, expires_at) VALUES (?, ?, ?, ?)')
        .run(hash(token), username, now, now + LOGIN_TOKEN_MS);
      try {
        await sendMail({
          to: `${username}@${DOMAIN}`,
          subject: 'Confirma el teu accés a Tutoria personal',
          text: `Obri este enllaç per a entrar (caduca en 15 minuts):\n\n${appUrl}/auth/verify?token=${token}\n\nSi no ho has demanat, ignora este correu.`,
        });
      } catch (err) {
        db.prepare('DELETE FROM login_tokens WHERE token_hash = ?').run(hash(token));
        console.error('Error enviando correo:', err.message);
        throw httpError(502, "No s'ha pogut enviar el correu. Torna-ho a intentar més tard.");
      }
    }
    res.json({ ok: true });
  });

  // El GET solo muestra un botón: algunos filtros de correo abren los enlaces y gastarían el token.
  app.get('/auth/verify', (req, res) => {
    const token = String(req.query.token ?? '');
    res.set('Referrer-Policy', 'no-referrer');
    if (!/^[\w-]+$/.test(token)) return res.status(400).send(authPage('Enllaç no vàlid', "<p>Torna a iniciar sessió per a rebre'n un de nou.</p>"));
    res.send(authPage("Confirmar l'accés", `<form method="post" action="/auth/verify"><input type="hidden" name="token" value="${token}"><button class="btn primary">Entrar en Tutoria personal</button></form>`));
  });

  app.post('/auth/verify', express.urlencoded({ extended: false }), (req, res) => {
    const tokenHash = hash(String(req.body?.token ?? ''));
    const now = Date.now();
    const row = db.prepare('SELECT * FROM login_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?')
      .get(tokenHash, now);
    if (!row) return res.status(400).send(authPage("L'enllaç ha caducat", "<p>L'enllaç ha caducat o ja s'ha usat. Torna a iniciar sessió.</p>"));

    tx(db, () => {
      db.prepare('UPDATE login_tokens SET used_at = ? WHERE token_hash = ?').run(now, tokenHash);
      // Quien no esté dado de alta entra como alumno; profesorado y admin ya existen con su nivel.
      const user = db.prepare('SELECT * FROM users WHERE username = ?').get(row.username) ?? createUser(row.username);
      startSession(res, user.id);
    });
    res.redirect(303, '/');
  });

  app.post('/api/logout', (req, res) => {
    const token = sessionToken(req.headers.cookie);
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(token));
    res.clearCookie(COOKIE);
    res.json({ ok: true });
  });

  // --- Alumnado ---

  const activeEditRequest = (studentId) => db.prepare(
    `SELECT * FROM student_edit_requests WHERE student_id = ? AND status IN ('pendiente','aprobada')`,
  ).get(studentId);

  // Lo que ve el alumno: la solicitud en marxa o, si no hay, la última que le rechazaron.
  const visibleEditRequest = (studentId) => {
    const row = db.prepare(`SELECT r.status, t.first_name, t.last_name FROM student_edit_requests r
      JOIN users t ON t.id = r.teacher_id WHERE r.student_id = ? ORDER BY r.id DESC LIMIT 1`).get(studentId);
    if (!row || !['pendiente', 'aprobada', 'rechazada'].includes(row.status)) return null;
    return { status: row.status, teacher: { first_name: row.first_name, last_name: row.last_name } };
  };

  app.get('/api/alumno', requireRole('alumno'), (req, res) => {
    const election = latestElection(db);
    const status = studentStatus(db, election, req.user.id);
    const answering = status === 'por_contestar';
    res.json({
      status,
      electionTitle: election?.title ?? null,
      tutor: election ? tutorOf(db, election.id, req.user.id) ?? null : null,
      // Deja de enviarse en cuanto hay tutor definitivo.
      answer: status === 'en_proceso' || status === 'agotada' ? ballotOf(db, election.id, req.user.id) : null,
      firstName: req.user.first_name,
      lastName: req.user.last_name,
      curso: req.user.curso,
      grupo: req.user.grupo,
      teachers: answering
        ? listTeachers(db).map(({ id, first_name, last_name, department }) => ({ id, first_name, last_name, department }))
        : [],
      previousTutor: answering ? previousTutor(db, election.id, req.user.id) ?? null : null,
      editRequest: answering ? null : visibleEditRequest(req.user.id),
      // Para pedir permiso de edición fuera de la votación, donde ya edita sus datos directamente.
      supervisors: answering
        ? []
        : listTeachers(db).map(({ id, first_name, last_name }) => ({ id, first_name, last_name })),
    });
  });

  // Sus datos solo se muestran: para cambiarlos, el profesor que lo tiene a su cargo debe confirmarlo.
  app.post('/api/alumno/dades/solicitud', requireRole('alumno'), (req, res) => {
    const teacher = db.prepare(`SELECT id FROM users WHERE id = ? AND role = 'profesor'`)
      .get(Number(req.body?.teacherId) || 0);
    if (!teacher) throw httpError(400, 'Indica quin professor et té a càrrec.');
    if (activeEditRequest(req.user.id)) throw httpError(409, 'Ja tens una sol·licitud en marxa.');
    db.prepare(`INSERT INTO student_edit_requests (student_id, teacher_id, status, created_at) VALUES (?, ?, 'pendiente', ?)`)
      .run(req.user.id, teacher.id, Date.now());
    res.json({ ok: true });
  });

  app.delete('/api/alumno/dades/solicitud', requireRole('alumno'), (req, res) => {
    db.prepare(`UPDATE student_edit_requests SET status = 'cancelada', resolved_at = ?
      WHERE student_id = ? AND status IN ('pendiente','aprobada')`).run(Date.now(), req.user.id);
    res.json({ ok: true });
  });

  app.put('/api/alumno/dades', requireRole('alumno'), (req, res) => {
    const permit = activeEditRequest(req.user.id);
    if (permit?.status !== 'aprobada') throw httpError(403, 'Cal que el professor ho confirme abans.');
    const { firstName, lastName } = requireNames(req.body);
    const { curso, grupo } = requireClass(req.body);
    const before = { firstName: req.user.first_name, lastName: req.user.last_name, curso: req.user.curso, grupo: req.user.grupo };
    const after = { firstName, lastName, curso, grupo };
    tx(db, () => {
      db.prepare(`UPDATE student_edit_requests SET status = 'usada', resolved_at = ? WHERE id = ?`).run(Date.now(), permit.id);
      if (JSON.stringify(before) === JSON.stringify(after)) return;
      db.prepare('UPDATE users SET first_name = ?, last_name = ?, curso = ?, grupo = ? WHERE id = ?')
        .run(firstName, lastName, curso, grupo, req.user.id);
      const teacher = db.prepare('SELECT id, first_name, last_name FROM users WHERE id = ?').get(permit.teacher_id);
      db.prepare(`INSERT INTO student_data_changes (student_id, teacher_id, teacher_name, changed_at, before_data, after_data)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(req.user.id, teacher.id, displayName(teacher), Date.now(), JSON.stringify(before), JSON.stringify(after));
      audit(db, req.user, 'Dades canviades', `Amb permís de ${fullName(teacher)}`);
    });
    res.json({ ok: true });
  });

  app.post('/api/alumno/eleccion', requireRole('alumno'), (req, res) => {
    const election = latestElection(db);
    if (!isOpen(election)) throw httpError(409, 'No hi ha eleccions obertes.');
    const { firstName, lastName } = requireNames(req.body);
    const { curso, grupo } = requireClass(req.body);
    const { vetoes, ranking } = req.body;
    if (!Array.isArray(vetoes) || !Array.isArray(ranking)) throw httpError(400, 'Formulari incomplet.');
    if (vetoes.length > MAX_VETOES || new Set(vetoes).size !== vetoes.length) {
      throw httpError(400, `Pots vetar ${MAX_VETOES} professors com a màxim.`);
    }
    if (ranking.length === 0) throw httpError(400, 'Cal deixar almenys un professor en la llista.');

    // Cada profesor tiene que aparecer una sola vez: en el orden o en los vetos.
    const expected = listTeachers(db).map((t) => t.id).sort((a, b) => a - b);
    const received = [...vetoes, ...ranking].sort((a, b) => a - b);
    if (JSON.stringify(expected) !== JSON.stringify(received)) {
      throw httpError(409, 'La llista de professors ha canviat. Torna a carregar la pàgina.');
    }

    tx(db, () => {
      const already = db.prepare('SELECT 1 FROM ballots WHERE election_id = ? AND student_id = ?').get(election.id, req.user.id);
      if (already) throw httpError(409, 'Ja has contestat.');
      if (tutorOf(db, election.id, req.user.id)) throw httpError(409, 'Ja tens tutor assignat.');
      db.prepare('UPDATE users SET first_name = ?, last_name = ?, curso = ?, grupo = ? WHERE id = ?')
        .run(firstName, lastName, curso, grupo, req.user.id);
      db.prepare('INSERT INTO ballots (election_id, student_id, submitted_at) VALUES (?, ?, ?)').run(election.id, req.user.id, Date.now());
      const choice = db.prepare('INSERT INTO ballot_choices (election_id, student_id, teacher_id, position, vetoed) VALUES (?, ?, ?, ?, ?)');
      ranking.forEach((teacherId, index) => choice.run(election.id, req.user.id, teacherId, index, 0));
      vetoes.forEach((teacherId) => choice.run(election.id, req.user.id, teacherId, null, 1));
      // Quien repite tutor y lo pone primero queda confirmado sin que el profesor tenga que aceptarlo,
      // siempre que aún tenga plaza.
      const previous = previousTutor(db, election.id, req.user.id);
      if (previous?.id === ranking[0] && !isFull(db, election.id, previous.id)) {
        db.prepare(`INSERT INTO requests (election_id, student_id, teacher_id, status) VALUES (?, ?, ?, 'confirmada')`)
          .run(election.id, req.user.id, ranking[0]);
        notify(db, req.user.id, `Confirmat: ${fullName(previous)} continua sent el teu tutor personal.`);
        notify(db, previous.id, `${firstName} ${lastName} t'ha tornat a triar i queda confirmat com a alumne teu.`);
        releaseIfFull(db, election.id, previous.id);
      } else {
        advance(db, election.id, req.user.id);
      }
      audit(db, { ...req.user, first_name: firstName, last_name: lastName }, 'Resposta enviada', classLabelOf({ curso, grupo }));
    });
    res.json({ ok: true });
  });

  // --- Profesorado ---

  app.get('/api/profesor', requireRole('profesor'), (req, res) => {
    const election = latestElection(db);
    const pending = election ? db.prepare(`
      SELECT r.id, u.first_name, u.last_name, u.username, u.curso, u.grupo FROM requests r
      JOIN users u ON u.id = r.student_id AND u.role = 'alumno'
      WHERE r.election_id = ? AND r.teacher_id = ? AND r.status = 'pendiente'
    `).all(election.id, req.user.id).sort(byLastName) : [];
    res.json({
      electionTitle: election?.title ?? null,
      firstName: req.user.first_name,
      lastName: req.user.last_name,
      department: req.user.department,
      departments: DEPARTMENTS,
      meetingPlace: req.user.meeting_place,
      pending,
      editRequests: db.prepare(`SELECT r.id, u.first_name, u.last_name, u.curso, u.grupo FROM student_edit_requests r
        JOIN users u ON u.id = r.student_id WHERE r.teacher_id = ? AND r.status = 'pendiente'`)
        .all(req.user.id).sort(byLastName),
      students: election ? studentsOfTeacher(db, election.id, req.user.id) : [],
      limit: teacherLimit(db, req.user),
      tutorGroup: req.user.tutor_group,
      groups: GROUPS,
      group: req.user.tutor_group ? groupOverview(req.user.tutor_group, election) : null,
    });
  });

  // Vista del tutor de grupo: el estado de su clase, nunca las preferencias ni los vetos.
  function groupOverview(group, election) {
    if (!election) return null;
    const tutors = new Map(listTeachers(db).map((t) => [t.id, t]));
    const students = listStudents(db, election).filter((s) => `${s.curso}${s.grupo}` === group);
    return {
      stats: electionStats(students),
      students: students.map(({ first_name, last_name, status, tutorId }) => {
        const tutor = tutors.get(tutorId);
        return { first_name, last_name, status, tutor: tutor ? { first_name: tutor.first_name, last_name: tutor.last_name } : null };
      }),
    };
  }

  app.post('/api/profesor/permisos/:id', requireRole('profesor'), (req, res) => {
    const { accion } = req.body ?? {};
    if (!['confirmar', 'rechazar'].includes(accion)) throw httpError(400, 'Acció no vàlida.');
    const request = db.prepare('SELECT * FROM student_edit_requests WHERE id = ? AND teacher_id = ?')
      .get(Number(req.params.id), req.user.id);
    if (!request) throw httpError(404, 'Sol·licitud no trobada.');
    if (request.status !== 'pendiente') throw httpError(409, 'Esta sol·licitud ja no està pendent.');
    db.prepare('UPDATE student_edit_requests SET status = ?, resolved_at = ? WHERE id = ?')
      .run(accion === 'confirmar' ? 'aprobada' : 'rechazada', Date.now(), request.id);
    notify(db, request.student_id, accion === 'confirmar'
      ? `${fullName(req.user)} ha confirmat que pots canviar les teues dades.`
      : `${fullName(req.user)} no ha confirmat el canvi de les teues dades.`);
    const student = userById(request.student_id);
    audit(db, req.user, accion === 'confirmar' ? 'Permís de dades concedit' : 'Permís de dades denegat', student ? fullName(student) : '');
    res.json({ ok: true });
  });

  app.put('/api/profesor/grup', requireRole('profesor'), (req, res) => {
    const group = req.body?.group || null;
    if (group !== null && !GROUPS.includes(group)) throw httpError(400, 'Grup no vàlid.');
    db.prepare('UPDATE users SET tutor_group = ? WHERE id = ?').run(group, req.user.id);
    res.json({ ok: true });
  });

  app.put('/api/profesor/perfil', requireRole('profesor'), (req, res) => {
    const { firstName, lastName } = requireNames(req.body);
    if (!DEPARTMENTS.includes(req.body?.department)) throw httpError(400, 'Tria un departament.');
    db.prepare('UPDATE users SET first_name = ?, last_name = ?, department = ? WHERE id = ?')
      .run(firstName, lastName, req.body.department, req.user.id);
    res.json({ ok: true });
  });

  app.post('/api/profesor/solicitudes/:id', requireRole('profesor'), (req, res) => {
    const { accion } = req.body ?? {};
    if (!['confirmar', 'rechazar'].includes(accion)) throw httpError(400, 'Acció no vàlida.');
    const student = tx(db, () => {
      const request = db.prepare(`SELECT * FROM requests WHERE id = ? AND teacher_id = ? AND status = 'pendiente' AND election_id = ?`)
        .get(Number(req.params.id), req.user.id, latestElection(db)?.id ?? -1);
      if (!request) throw httpError(404, 'Esta sol·licitud ja no està pendent.');
      if (accion === 'confirmar' && isFull(db, request.election_id, req.user.id)) {
        throw httpError(409, `Ja tens ${teacherLimit(db, req.user)} alumnes, que és el teu límit.`);
      }
      db.prepare('UPDATE requests SET status = ? WHERE id = ?')
        .run(accion === 'confirmar' ? 'confirmada' : 'rechazada', request.id);
      const studentRow = userById(request.student_id);
      if (accion === 'rechazar') advance(db, request.election_id, request.student_id);
      else {
        notify(db, request.student_id, `${fullName(req.user)} ha acceptat ser el teu tutor personal.`);
        releaseIfFull(db, request.election_id, req.user.id);
      }
      audit(db, req.user, accion === 'confirmar' ? 'Sol·licitud acceptada' : 'Sol·licitud rebutjada', studentRow ? fullName(studentRow) : '');
      return studentRow;
    });
    if (accion === 'confirmar' && student) {
      mailQuietly(student.username, 'Ja tens tutor personal', `${fullName(req.user)} ha acceptat ser el teu tutor personal. Pots vore el lloc de reunió en Tutoria personal.`);
    }
    res.json({ ok: true });
  });

  app.put('/api/profesor/meeting', requireRole('profesor'), (req, res) => {
    db.prepare('UPDATE users SET meeting_place = ? WHERE id = ?').run(cleanText(req.body?.meetingPlace, 200) || null, req.user.id);
    res.json({ ok: true });
  });

  app.get('/api/profesor/buscar', requireRole('profesor'), (req, res) => {
    const query = cleanText(req.query.q, 100);
    if (query.length < 2) return res.json({ results: [] });
    const like = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
    const election = latestElection(db);
    const students = db.prepare(`
      SELECT id, first_name, last_name, username, curso, grupo FROM users
      WHERE role = 'alumno' AND (
        first_name LIKE ? ESCAPE '\\' OR last_name LIKE ? ESCAPE '\\' OR username LIKE ? ESCAPE '\\'
        OR first_name || ' ' || last_name LIKE ? ESCAPE '\\'
      )
      LIMIT 50
    `).all(like, like, like, like).sort(byLastName);
    res.json({
      results: students.map(({ id, ...student }) => {
        const tutor = election ? tutorOf(db, election.id, id) : null;
        return { ...student, tutor: tutor ? { first_name: tutor.first_name, last_name: tutor.last_name } : null };
      }),
    });
  });

  // --- Administración ---

  // Se puede hacer una vez por elección cerrada: así un doble clic no sube dos cursos ni borra a nadie.
  const promotionState = (election) => {
    if (!election) return 'sin_eleccion';
    if (isOpen(election)) return 'abierta';
    const done = db.prepare(`SELECT value FROM meta WHERE key = 'promoted_election_id'`).get()?.value;
    return done === String(election.id) ? 'hecho' : 'disponible';
  };
  const requirePromotionAvailable = () => {
    const election = latestElection(db);
    const state = promotionState(election);
    if (state === 'abierta') throw httpError(409, "Cal tancar les eleccions abans de fer el pas de curs.");
    if (state === 'hecho') throw httpError(409, "El pas de curs ja s'ha fet per a estes eleccions.");
    if (state === 'sin_eleccion') throw httpError(409, 'Encara no hi ha eleccions.');
    return election;
  };

  app.get('/api/admin', requireRole('admin'), (req, res) => {
    const election = latestElection(db);
    const teachers = listTeachers(db);
    const marks = new Map(db.prepare(`SELECT id, promotion_mark FROM users WHERE promotion_mark IS NOT NULL`).all()
      .map((row) => [row.id, row.promotion_mark]));
    const students = listStudents(db, election).map((student) => {
      const vetoed = election ? vetoedTeacherIds(db, election.id, student.id) : [];
      return {
        ...student,
        promotionMark: marks.get(student.id) ?? null,
        allowedTeacherIds: teachers.map((t) => t.id).filter((id) => !vetoed.includes(id)),
        hasBallot: Boolean(election && db.prepare('SELECT 1 FROM ballots WHERE election_id = ? AND student_id = ?').get(election.id, student.id)),
      };
    });
    const stats = electionStats(students);
    const requestCount = (teacherId, status) => (election
      ? db.prepare('SELECT COUNT(*) AS n FROM requests WHERE election_id = ? AND teacher_id = ? AND status = ?').get(election.id, teacherId, status).n
      : 0);
    const firstChoice = (teacherId) => (election
      ? db.prepare('SELECT COUNT(*) AS n FROM ballot_choices WHERE election_id = ? AND teacher_id = ? AND position = 0 AND vetoed = 0').get(election.id, teacherId).n
      : 0);
    res.json({
      me: req.user.id,
      election: election ?? null,
      open: isOpen(election),
      canClose: stats.unanswered === 0,
      stats,
      promotion: promotionState(election),
      defaultLimit: defaultLimit(db),
      teachers: teachers.map((t) => ({
        ...t,
        students: election ? studentsOfTeacher(db, election.id, t.id) : [],
        limit: teacherLimit(db, t),
        pendingCount: requestCount(t.id, 'pendiente'),
        rejectedCount: requestCount(t.id, 'rechazada'),
        firstChoiceCount: firstChoice(t.id),
      })),
      students,
      admins: db.prepare(`SELECT id, username, first_name, last_name FROM users WHERE role = 'admin'`).all().sort(byLastName),
    });
  });

  app.post('/api/admin/convocar', requireRole('admin'), (req, res) => {
    const previous = latestElection(db);
    if (isOpen(previous)) throw httpError(409, 'Ja hi ha eleccions obertes.');
    const title = cleanText(req.body?.title, 100);
    if (!title) throw httpError(400, 'Posa-li un títol a les eleccions.');
    if (listTeachers(db).length < 1) throw httpError(409, 'Cal almenys un professor.');

    tx(db, () => {
      // Una marca sin confirmar no debe aplicarse por sorpresa al año siguiente.
      db.prepare('UPDATE users SET promotion_mark = NULL').run();
      db.prepare('INSERT INTO elections (title, opened_at) VALUES (?, ?)').run(title, Date.now());
      const text = `S'han obert les eleccions de tutoria personal «${title}».`;
      for (const { id } of db.prepare(`SELECT id FROM users WHERE role = 'alumno'`).all()) notify(db, id, text);
      audit(db, req.user, 'Eleccions convocades', title);
    });
    res.json({ ok: true });
  });

  // --- Límite de alumnos por profesor ---

  const parseLimit = (value) => {
    if (value === null || value === '' || value === undefined) return null;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 500) throw httpError(400, 'El límit ha de ser un número entre 1 i 500, o buit per a no tindre límit.');
    return n;
  };

  app.put('/api/admin/limit', requireRole('admin'), (req, res) => {
    const limit = parseLimit(req.body?.value);
    db.prepare(`INSERT INTO meta (key, value) VALUES ('default_max_students', ?)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value`).run(limit === null ? '' : String(limit));
    audit(db, req.user, 'Límit general canviat', limit === null ? 'Sense límit' : `${limit} alumnes`);
    res.json({ ok: true });
  });

  app.put('/api/admin/professors/:id/limit', requireRole('admin'), (req, res) => {
    const teacher = db.prepare(`SELECT * FROM users WHERE id = ? AND role = 'profesor'`).get(Number(req.params.id));
    if (!teacher) throw httpError(404, 'Professor no trobat.');
    const limit = parseLimit(req.body?.value);
    db.prepare('UPDATE users SET max_students = ? WHERE id = ?').run(limit, teacher.id);
    audit(db, req.user, 'Límit de professor canviat', `${fullName(teacher)}: ${limit === null ? 'el general' : `${limit} alumnes`}`);
    res.json({ ok: true });
  });

  app.put('/api/admin/pas-de-curs/:id', requireRole('admin'), (req, res) => {
    requirePromotionAvailable();
    const mark = req.body?.mark || null;
    if (mark !== null && mark !== 'no_promociona' && mark !== 'baixa') throw httpError(400, 'Opció no vàlida.');
    const student = db.prepare(`SELECT * FROM users WHERE id = ? AND role = 'alumno'`).get(Number(req.params.id));
    if (!student) throw httpError(404, 'Alumne no trobat.');
    if (mark === 'no_promociona' && !student.curso) throw httpError(400, 'Este alumne no té classe.');
    db.prepare('UPDATE users SET promotion_mark = ? WHERE id = ?').run(mark, student.id);
    res.json({ ok: true });
  });

  app.post('/api/admin/pas-de-curs', requireRole('admin'), (req, res) => {
    const election = requirePromotionAvailable();
    const result = tx(db, () => {
      const select = (where) => db.prepare(`SELECT * FROM users WHERE role = 'alumno' AND ${where}`).all();
      const withdrawn = select(`promotion_mark = 'baixa'`);
      const graduated = select(`curso = 4 AND promotion_mark IS NULL`);
      const kept = select(`promotion_mark = 'no_promociona'`).length;
      // Primero salen quienes se van y después sube el resto: el orden importa.
      for (const student of [...withdrawn, ...graduated]) deleteUser(db, student);
      const { changes } = db.prepare(`UPDATE users SET curso = curso + 1
        WHERE role = 'alumno' AND curso IS NOT NULL AND promotion_mark IS NULL`).run();
      db.prepare('UPDATE users SET promotion_mark = NULL').run();
      db.prepare(`INSERT INTO meta (key, value) VALUES ('promoted_election_id', ?)
        ON CONFLICT (key) DO UPDATE SET value = excluded.value`).run(String(election.id));
      const summary = { promoted: Number(changes), kept, withdrawn: withdrawn.length, graduated: graduated.length };
      audit(db, req.user, 'Pas de curs fet', `${summary.promoted} pugen, ${kept} no promocionen, ${summary.withdrawn + summary.graduated} comptes eliminats`);
      return summary;
    });
    res.json({ ok: true, ...result });
  });

  app.post('/api/admin/terminar', requireRole('admin'), (req, res) => {
    const election = latestElection(db);
    if (!isOpen(election)) throw httpError(409, 'No hi ha eleccions obertes.');
    if (electionStats(listStudents(db, election)).unanswered > 0) {
      throw httpError(409, 'No es poden confirmar les eleccions: encara falta alumnat per votar.');
    }
    db.prepare('UPDATE elections SET closed_at = ? WHERE id = ?').run(Date.now(), election.id);
    audit(db, req.user, 'Eleccions tancades', election.title);
    res.json({ ok: true });
  });

  app.post('/api/admin/usuarios', requireRole('admin'), (req, res) => {
    const username = normalizeUsername(req.body?.username);
    const { role } = req.body ?? {};
    if (!username) throw httpError(400, `Escriu només l'usuari de @${DOMAIN}.`);
    if (!['profesor', 'admin'].includes(role)) throw httpError(400, "Només es poden donar d'alta comptes de professor o administrador.");
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
      throw httpError(409, 'Eixe compte ja existix: canvia el seu nivell en la llista de comptes.');
    }
    createUser(username, role);
    audit(db, req.user, "Compte donat d'alta", `${username}@${DOMAIN} · ${ROLE_NAME[role]}`);
    res.json({ ok: true });
  });

  // Alumno que llega a mitad de curso: cuenta y tutor de golpe, sin confirmación del profesor.
  app.post('/api/admin/alumnes', requireRole('admin'), (req, res) => {
    const election = latestElection(db);
    if (!election || isOpen(election)) throw httpError(409, 'Només es pot fer amb les eleccions tancades.');
    const username = normalizeUsername(req.body?.username);
    if (!username) throw httpError(400, `Escriu només l'usuari de @${DOMAIN}.`);
    const names = requireNames(req.body);
    const { curso, grupo } = requireClass(req.body);
    const teacher = db.prepare(`SELECT 1 FROM users WHERE id = ? AND role = 'profesor'`).get(Number(req.body.teacherId));
    if (!teacher) throw httpError(400, 'Tria un tutor.');
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
      throw httpError(409, 'Eixe compte ja existix: assigna-li el tutor des de la llista.');
    }
    tx(db, () => {
      const student = createUser(username, 'alumno', names);
      db.prepare('UPDATE users SET curso = ?, grupo = ? WHERE id = ?').run(curso, grupo, student.id);
      db.prepare(`INSERT INTO requests (election_id, student_id, teacher_id, status, manual) VALUES (?, ?, ?, 'confirmada', 1)`)
        .run(election.id, student.id, Number(req.body.teacherId));
      const tutor = userById(Number(req.body.teacherId));
      notify(db, student.id, `L'administració t'ha assignat tutor personal: ${fullName(tutor)}.`);
      notify(db, tutor.id, `Nou alumne assignat per l'administració: ${fullName(student)}.`);
      audit(db, req.user, 'Alumne nou amb tutor', `${fullName(student)} → ${fullName(tutor)}`);
    });
    res.json({ ok: true });
  });

  app.patch('/api/admin/usuarios/:id', requireRole('admin'), (req, res) => {
    const { role } = req.body ?? {};
    if (!ROLES.includes(role)) throw httpError(400, 'Nivell no vàlid.');
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
    if (!target) throw httpError(404, 'Compte no trobat.');
    if (target.id === req.user.id) throw httpError(409, 'No pots canviar el teu propi nivell.');
    if (target.role === role) return res.json({ ok: true });

    const election = latestElection(db);
    tx(db, () => {
      if (election && target.role === 'profesor') {
        if (studentsOfTeacher(db, election.id, target.id).length) {
          throw httpError(409, 'Este professor té alumnes tutoritzats en les eleccions actuals.');
        }
        // Sus solicitudes pendientes pasan a la siguiente preferencia de cada alumno.
        const pending = db.prepare(`SELECT * FROM requests WHERE election_id = ? AND teacher_id = ? AND status = 'pendiente'`)
          .all(election.id, target.id);
        for (const request of pending) {
          db.prepare(`UPDATE requests SET status = 'cancelada' WHERE id = ?`).run(request.id);
          advance(db, election.id, request.student_id);
        }
      }
      if (election && target.role === 'alumno') {
        for (const table of ['requests', 'ballot_choices', 'ballots']) {
          db.prepare(`DELETE FROM ${table} WHERE election_id = ? AND student_id = ?`).run(election.id, target.id);
        }
      }
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, target.id);
      audit(db, req.user, 'Nivell canviat', `${fullName(target)}: ${ROLE_NAME[target.role]} → ${ROLE_NAME[role]}`);
    });
    res.json({ ok: true });
  });

  app.delete('/api/admin/usuarios/:id', requireRole('admin'), (req, res) => {
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
    if (!target) throw httpError(404, 'Compte no trobat.');
    if (target.id === req.user.id) throw httpError(409, 'No pots eliminar el teu propi compte.');
    tx(db, () => {
      deleteUser(db, target);
      audit(db, req.user, 'Compte eliminat', `${fullName(target)} (${ROLE_NAME[target.role]})`);
    });
    res.json({ ok: true });
  });

  // Para quien se ha equivocado: vuelve a poder votar. Solo con la elección abierta.
  app.delete('/api/admin/alumnes/:id/resposta', requireRole('admin'), (req, res) => {
    const election = latestElection(db);
    if (!isOpen(election)) throw httpError(409, 'Només es pot esborrar una resposta amb les eleccions obertes.');
    const studentId = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM ballots WHERE election_id = ? AND student_id = ?').get(election.id, studentId)) {
      throw httpError(404, 'Este alumne no té cap resposta.');
    }
    tx(db, () => {
      for (const table of ['requests', 'ballot_choices', 'ballots']) {
        db.prepare(`DELETE FROM ${table} WHERE election_id = ? AND student_id = ?`).run(election.id, studentId);
      }
      const student = userById(studentId);
      notify(db, studentId, "L'administració ha esborrat la teua resposta. Has de tornar a votar.");
      audit(db, req.user, 'Resposta esborrada', student ? fullName(student) : '');
    });
    res.json({ ok: true });
  });

  // Asignación directa. También con la elección abierta: si no, un alumno que nunca
  // contesta impediría cerrarla.
  app.post('/api/admin/asignar', requireRole('admin'), (req, res) => {
    const election = latestElection(db);
    if (!election) throw httpError(409, 'Encara no hi ha eleccions.');
    const studentId = Number(req.body?.studentId);
    const teacherId = Number(req.body?.teacherId);
    const student = db.prepare(`SELECT 1 FROM users WHERE id = ? AND role = 'alumno'`).get(studentId);
    const teacher = db.prepare(`SELECT 1 FROM users WHERE id = ? AND role = 'profesor'`).get(teacherId);
    if (!student || !teacher) throw httpError(400, 'Alumne o professor no vàlid.');
    if (tutorOf(db, election.id, studentId)) throw httpError(409, 'Este alumne ja té tutor.');
    if (vetoedTeacherIds(db, election.id, studentId).includes(teacherId)) throw httpError(409, "L'alumne ha vetat este professor.");
    tx(db, () => {
      db.prepare(`UPDATE requests SET status = 'cancelada' WHERE election_id = ? AND student_id = ? AND status = 'pendiente'`)
        .run(election.id, studentId);
      db.prepare(`
        INSERT INTO requests (election_id, student_id, teacher_id, status, manual) VALUES (?, ?, ?, 'confirmada', 1)
        ON CONFLICT (election_id, student_id, teacher_id) DO UPDATE SET status = 'confirmada', manual = 1
      `).run(election.id, studentId, teacherId);
      const studentRow = userById(studentId);
      const tutor = userById(teacherId);
      notify(db, studentId, `L'administració t'ha assignat tutor personal: ${fullName(tutor)}.`);
      notify(db, teacherId, `Nou alumne assignat per l'administració: ${fullName(studentRow)}.`);
      audit(db, req.user, 'Tutor assignat a mà', `${fullName(studentRow)} → ${fullName(tutor)}`);
    });
    const studentRow = userById(studentId);
    mailQuietly(studentRow.username, 'Ja tens tutor personal', `L'administració t'ha assignat tutor personal: ${fullName(userById(teacherId))}.`);
    res.json({ ok: true });
  });

  app.get('/api/admin/informe.pdf', requireRole('admin'), (req, res) => {
    const election = latestElection(db);
    if (!election) throw httpError(404, 'Encara no hi ha eleccions.');
    res.type('application/pdf').attachment('tutories-personals.pdf');
    writeReport(db, election, res);
  });

  app.get('/api/admin/informe.xlsx', requireRole('admin'), (req, res) => {
    const stamp = new Date().toISOString().slice(0, 10);
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .attachment(`tutoria-personal-${stamp}.xlsx`)
      .send(buildReport(db));
  });

  app.get('/api/admin/plantilla.xlsx', requireRole('admin'), (req, res) => {
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .attachment('plantilla-alumnat.xlsx')
      .send(buildTemplate());
  });

  // Importar: primero se sube el archivo y se devuelve la vista previa; después se confirman las filas.
  app.post('/api/admin/importar', requireRole('admin'), express.raw({ type: () => true, limit: '5mb' }), (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw httpError(400, 'Tria un arxiu Excel (.xlsx) o CSV.');
    try {
      res.json(previewImport(db, req.body));
    } catch (err) {
      if (err.status) throw err;
      throw httpError(400, "No s'ha pogut llegir l'arxiu. Ha de ser un Excel (.xlsx) o un CSV.");
    }
  });

  app.post('/api/admin/importar/confirmar', requireRole('admin'), express.json({ limit: '2mb' }), (req, res) => {
    const result = tx(db, () => {
      const summary = applyImport(db, req.body?.rows);
      audit(db, req.user, 'Alumnat importat', `${summary.created} nous, ${summary.updated} actualitzats${summary.skipped ? `, ${summary.skipped} descartats` : ''}`);
      return summary;
    });
    res.json({ ok: true, ...result });
  });

  app.get('/api/admin/historial', requireRole('admin'), (req, res) => {
    res.json({ items: db.prepare('SELECT id, at, actor_name, action, detail FROM audit_log ORDER BY at DESC, id DESC LIMIT 1000').all() });
  });

  app.use((err, req, res, next) => {
    if (!err.status) console.error(err);
    // Los errores de body-parser vienen con texto en inglés.
    const message = err.type ? 'Petició no vàlida.' : err.status ? err.message : 'Error intern.';
    res.status(err.status ?? 500).json({ error: message });
  });

  return app;
}
