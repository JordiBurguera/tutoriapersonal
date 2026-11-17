import { fullName, notify } from './activity.js';

// Reglas de la elección. Todo lo que el alumnado "tiene" (tutor, estado) se deriva de la
// última convocatoria: al convocar otra, las asignaciones anteriores dejan de estar vigentes
// pero quedan guardadas en la base de datos.

const collator = new Intl.Collator('ca', { sensitivity: 'base' });
const sortKey = (person) => person.last_name || person.first_name;

export const byLastName = (a, b) =>
  collator.compare(sortKey(a), sortKey(b)) || collator.compare(a.first_name, b.first_name);

export const displayName = (person) =>
  (person.last_name ? `${person.last_name}, ${person.first_name}` : person.first_name);

export const latestElection = (db) =>
  db.prepare('SELECT * FROM elections ORDER BY id DESC LIMIT 1').get();

export const listTeachers = (db) =>
  db.prepare(`SELECT id, username, first_name, last_name, department, meeting_place, tutor_group, max_students FROM users WHERE role = 'profesor'`)
    .all().sort(byLastName);

export const isOpen = (election) => Boolean(election) && election.closed_at === null;

// --- Fecha límite ---

export const deadlinePassed = (election, now = Date.now()) => Boolean(election?.deadline) && now > election.deadline;

// Se puede contestar: elección abierta y dentro de plazo.
export const acceptingAnswers = (election, now = Date.now()) => isOpen(election) && !deadlinePassed(election, now);

// --- Límite de alumnos por profesor ---

export function defaultLimit(db) {
  const value = db.prepare(`SELECT value FROM meta WHERE key = 'default_max_students'`).get()?.value;
  return value ? Number(value) : null;
}

// Límite efectivo: el del profesor o, si no tiene, el general. null = sin límite.
export function teacherLimit(db, teacher) {
  const own = typeof teacher === 'object'
    ? teacher.max_students
    : db.prepare('SELECT max_students FROM users WHERE id = ?').get(teacher)?.max_students;
  return own ?? defaultLimit(db);
}

export const confirmedCount = (db, electionId, teacherId) => db.prepare(`
  SELECT COUNT(*) AS n FROM requests r JOIN users u ON u.id = r.student_id AND u.role = 'alumno'
  WHERE r.election_id = ? AND r.teacher_id = ? AND r.status = 'confirmada'
`).get(electionId, teacherId).n;

export function isFull(db, electionId, teacherId) {
  const limit = teacherLimit(db, teacherId);
  return limit !== null && confirmedCount(db, electionId, teacherId) >= limit;
}

// Envía la solicitud a la siguiente preferencia que aún no la haya recibido y que tenga plaza.
// Devuelve false si la lista se ha agotado.
export function advance(db, electionId, studentId) {
  const candidates = db.prepare(`
    SELECT c.teacher_id FROM ballot_choices c
    JOIN users t ON t.id = c.teacher_id AND t.role = 'profesor'
    WHERE c.election_id = ? AND c.student_id = ? AND c.vetoed = 0
      AND NOT EXISTS (
        SELECT 1 FROM requests r
        WHERE r.election_id = c.election_id AND r.student_id = c.student_id AND r.teacher_id = c.teacher_id
      )
    ORDER BY c.position
  `).all(electionId, studentId);
  const next = candidates.find((c) => !isFull(db, electionId, c.teacher_id));
  const student = db.prepare('SELECT id, first_name, last_name FROM users WHERE id = ?').get(studentId);
  if (!next) {
    const hasBallot = db.prepare('SELECT 1 FROM ballots WHERE election_id = ? AND student_id = ?').get(electionId, studentId);
    if (student && hasBallot) {
      notify(db, studentId, "Cap professor de la teua llista ha pogut acceptar-te. L'administració t'assignarà tutor.");
    }
    return false;
  }
  db.prepare(`INSERT INTO requests (election_id, student_id, teacher_id, status) VALUES (?, ?, ?, 'pendiente')`)
    .run(electionId, studentId, next.teacher_id);
  if (student) notify(db, next.teacher_id, `Nova sol·licitud de tutoria: ${fullName(student)}.`);
  return true;
}

// Cuando un profesor se llena, sus solicitudes pendientes pasan a la siguiente preferencia.
export function releaseIfFull(db, electionId, teacherId) {
  if (!isFull(db, electionId, teacherId)) return 0;
  const pending = db.prepare(`SELECT * FROM requests WHERE election_id = ? AND teacher_id = ? AND status = 'pendiente'`)
    .all(electionId, teacherId);
  for (const request of pending) {
    db.prepare(`UPDATE requests SET status = 'cancelada' WHERE id = ?`).run(request.id);
    advance(db, electionId, request.student_id);
  }
  return pending.length;
}

// Tutor que el alumno tenía en la convocatoria inmediatamente anterior, si sigue siendo profesor.
export function previousTutor(db, electionId, studentId) {
  return db.prepare(`
    SELECT t.id, t.first_name, t.last_name FROM requests r
    JOIN users t ON t.id = r.teacher_id AND t.role = 'profesor'
    WHERE r.student_id = ? AND r.status = 'confirmada'
      AND r.election_id = (SELECT MAX(id) FROM elections WHERE id < ?)
  `).get(studentId, electionId);
}

export function tutorOf(db, electionId, studentId) {
  return db.prepare(`
    SELECT t.id, t.first_name, t.last_name, t.username, t.department, t.meeting_place FROM requests r
    JOIN users t ON t.id = r.teacher_id
    WHERE r.election_id = ? AND r.student_id = ? AND r.status = 'confirmada'
  `).get(electionId, studentId);
}

// sin_convocatoria | por_contestar | sin_respuesta | en_proceso | agotada | asignado
export function studentStatus(db, election, studentId) {
  if (!election) return 'sin_convocatoria';
  if (tutorOf(db, election.id, studentId)) return 'asignado';
  const pending = db.prepare(`SELECT 1 FROM requests WHERE election_id = ? AND student_id = ? AND status = 'pendiente'`)
    .get(election.id, studentId);
  if (pending) return 'en_proceso';
  const ballot = db.prepare('SELECT 1 FROM ballots WHERE election_id = ? AND student_id = ?').get(election.id, studentId);
  if (ballot) return 'agotada';
  return acceptingAnswers(election) ? 'por_contestar' : 'sin_respuesta';
}

// Lo que contestó el alumno, en su orden. Solo nombres: ni estado ni quién le ha rechazado.
export function ballotOf(db, electionId, studentId) {
  const rows = db.prepare(`
    SELECT u.first_name, u.last_name, c.vetoed FROM ballot_choices c
    JOIN users u ON u.id = c.teacher_id
    WHERE c.election_id = ? AND c.student_id = ?
    ORDER BY c.position
  `).all(electionId, studentId);
  const pick = (vetoed) => rows
    .filter((row) => Boolean(row.vetoed) === vetoed)
    .map(({ first_name, last_name }) => ({ first_name, last_name }));
  return { ranking: pick(false), vetoes: pick(true).sort(byLastName) };
}

export function listStudents(db, election) {
  return db.prepare(`SELECT id, username, first_name, last_name, curso, grupo FROM users WHERE role = 'alumno'`).all()
    .map((student) => ({
      ...student,
      status: studentStatus(db, election, student.id),
      tutorId: election ? tutorOf(db, election.id, student.id)?.id ?? null : null,
    }))
    .sort(byLastName);
}

export function electionStats(students) {
  const count = (...statuses) => students.filter((s) => statuses.includes(s.status)).length;
  return {
    students: students.length,
    unanswered: count('por_contestar', 'sin_respuesta'),
    waiting: count('en_proceso', 'agotada'),
    confirmed: count('asignado'),
  };
}

export function studentsOfTeacher(db, electionId, teacherId) {
  return db.prepare(`
    SELECT u.id, u.first_name, u.last_name, u.username, u.curso, u.grupo FROM requests r
    JOIN users u ON u.id = r.student_id AND u.role = 'alumno'
    WHERE r.election_id = ? AND r.teacher_id = ? AND r.status = 'confirmada'
  `).all(electionId, teacherId).sort(byLastName);
}

export const vetoedTeacherIds = (db, electionId, studentId) =>
  db.prepare('SELECT teacher_id FROM ballot_choices WHERE election_id = ? AND student_id = ? AND vetoed = 1')
    .all(electionId, studentId).map((row) => row.teacher_id);

// Borra la cuenta y todo su rastro. Quien tenía a este profesor en la convocatoria vigente
// pasa a la siguiente preferencia de su lista.
export function deleteUser(db, user) {
  const election = latestElection(db);
  const affected = election ? db.prepare(`
    SELECT student_id FROM requests
    WHERE election_id = ? AND teacher_id = ? AND status IN ('pendiente', 'confirmada')
  `).all(election.id, user.id).map((row) => row.student_id) : [];

  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  db.prepare('DELETE FROM login_tokens WHERE username = ?').run(user.username);
  db.prepare('DELETE FROM ballot_choices WHERE student_id = ? OR teacher_id = ?').run(user.id, user.id);
  db.prepare('DELETE FROM ballots WHERE student_id = ?').run(user.id);
  db.prepare('DELETE FROM requests WHERE student_id = ? OR teacher_id = ?').run(user.id, user.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);

  for (const studentId of affected) advance(db, election.id, studentId);
}
