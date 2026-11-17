import { DOMAIN } from './app.js';
import { isOpen, latestElection, listStudents } from './election.js';

const CHECK_EVERY_MS = 60_000;

// Profesorado con algo que revisar: solicitudes pendientes o, con la elección abierta,
// alumnado de su grupo sin votar. Cada persona aparece una sola vez.
export function reminderRecipients(db) {
  const election = latestElection(db);
  if (!election) return [];
  const usernames = new Set(db.prepare(`
    SELECT DISTINCT t.username FROM requests r
    JOIN users t ON t.id = r.teacher_id AND t.role = 'profesor'
    JOIN users s ON s.id = r.student_id AND s.role = 'alumno'
    WHERE r.election_id = ? AND r.status = 'pendiente'
  `).all(election.id).map((row) => row.username));

  if (isOpen(election)) {
    const missing = new Set(listStudents(db, election)
      .filter((s) => s.status === 'por_contestar' && s.curso)
      .map((s) => `${s.curso}${s.grupo}`));
    const tutors = db.prepare(`SELECT username, tutor_group FROM users WHERE role = 'profesor' AND tutor_group IS NOT NULL`).all();
    for (const tutor of tutors) if (missing.has(tutor.tutor_group)) usernames.add(tutor.username);
  }
  return [...usernames];
}

// Mismo texto para todos: el correo nunca dice quién falta.
export async function sendReminders({ db, sendMail, appUrl }) {
  let sent = 0;
  for (const username of reminderRecipients(db)) {
    try {
      await sendMail({
        to: `${username}@${DOMAIN}`,
        subject: 'Tutoria personal: comprova el teu panell',
        text: `Comprova el teu panell de professor de Tutoria personal:\n\n${appUrl}/\n`,
      });
      sent += 1;
    } catch (err) {
      console.error(`Error enviando recordatorio a ${username}:`, err.message);
    }
  }
  return sent;
}

function madridClock(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

// Hora válida (entero 0-23); si REMINDER_HOUR falta o es inválida, las 8.
export function reminderHour(value) {
  const hour = typeof value === 'string' && value.trim() === '' ? NaN : Number(value);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 8;
}

// Anota que hoy (Madrid) ya se envió el recordatorio.
export function markReminderDay(db, now = new Date()) {
  db.prepare(`INSERT INTO meta (key, value) VALUES ('last_reminder_day', ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value`).run(madridClock(now).day);
}

// Una vez al día a partir de la hora indicada. Queda registrado en la base de datos para que
// reiniciar el servidor no repita el envío; si estaba apagado a esa hora, envía al arrancar.
export async function reminderTick({ db, sendMail, appUrl, hour, now = new Date() }) {
  const { day, hour: currentHour } = madridClock(now);
  if (currentHour < reminderHour(hour)) return null;
  const last = db.prepare(`SELECT value FROM meta WHERE key = 'last_reminder_day'`).get()?.value;
  if (last === day) return null;
  markReminderDay(db, now);
  return sendReminders({ db, sendMail, appUrl });
}

export function startReminders(options) {
  const tick = () => reminderTick(options)
    .catch((err) => console.error('Error en el recordatorio:', err));
  tick();
  setInterval(tick, CHECK_EVERY_MS).unref();
}
