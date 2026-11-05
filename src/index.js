import { createApp, namesFromUsername, normalizeUsername } from './app.js';
import { openDb } from './db.js';
import { createLive } from './live.js';
import { createMailer } from './mail.js';
import { startReminders } from './reminders.js';

const port = Number(process.env.PORT || 3000);
const appUrl = (process.env.APP_URL || `http://localhost:${port}`).replace(/\/$/, '');
const db = openDb(process.env.DB_PATH || 'data/tutoria.db');

const adminUser = normalizeUsername(process.env.ADMIN_USER ?? '');
if (adminUser) {
  const { firstName, lastName } = namesFromUsername(adminUser);
  db.prepare(`INSERT OR IGNORE INTO users (username, first_name, last_name, role) VALUES (?, ?, ?, 'admin')`)
    .run(adminUser, firstName, lastName);
  // Si ya existía como otro nivel (p. ej. entró antes como alumnado) y no hay ningún administrador, se promociona.
  if (!db.prepare(`SELECT 1 FROM users WHERE role = 'admin'`).get()) {
    db.prepare(`UPDATE users SET role = 'admin' WHERE username = ?`).run(adminUser);
  }
} else if (!db.prepare(`SELECT 1 FROM users WHERE role = 'admin'`).get()) {
  console.warn('No hay ningún administrador: define ADMIN_USER en .env y reinicia.');
}

const testLogin = process.env.LOGIN_PRUEBA === '1';
if (testLogin) console.warn('LOGIN_PRUEBA activo: los usuarios con "prof", "alm" o "admn" y un número entran sin confirmar el correo, incluso como administrador. No usar en producción.');

const live = createLive();
const sendMail = createMailer();
const app = createApp({ db, sendMail, appUrl, testLogin, broadcast: live.broadcast });
const server = app.listen(port, () => {
  console.log(`Tutoría personal en ${appUrl}`);
});
live.attach(server, app.locals.userFromCookie);
startReminders({ db, sendMail, appUrl, hour: process.env.REMINDER_HOUR });
