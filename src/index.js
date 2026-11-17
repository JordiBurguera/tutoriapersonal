import { createApp, namesFromUsername, normalizeUsername } from './app.js';
import { openDb } from './db.js';
import { createLive } from './live.js';
import { createMailer } from './mail.js';
import { startReminders } from './reminders.js';

const port = Number(process.env.PORT || 3000);
const appUrl = (process.env.APP_URL || `http://localhost:${port}`).replace(/\/$/, '');
const db = openDb(process.env.DB_PATH || 'data/tutoria.db');

// Administradores fijos: tienen acceso a todo y no dependen del .env.
// Se escribe solo la parte antes de @lescarolines.com.
const ADMINS_FIJOS = ['admin.tutoria'];

const ensureAdmin = (username) => {
  const { firstName, lastName } = namesFromUsername(username);
  db.prepare(`INSERT OR IGNORE INTO users (username, first_name, last_name, role) VALUES (?, ?, ?, 'admin')`)
    .run(username, firstName, lastName);
  db.prepare(`UPDATE users SET role = 'admin' WHERE username = ?`).run(username);
};

for (const username of ADMINS_FIJOS.map(normalizeUsername).filter(Boolean)) ensureAdmin(username);

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
// Express 5 no lanza el error si el puerto está ocupado: se lo pasa a esta función, y sin esto se cerraba sin avisar.
const server = app.listen(port, (err) => {
  if (err) {
    const why = err.code === 'EADDRINUSE' ? 'ya está en uso (seguramente hay otro servidor encendido)'
      : err.code === 'EACCES' ? 'Windows lo tiene bloqueado' : err.message;
    console.error(`No se ha podido abrir el puerto ${port}: ${why}. Cambia PORT y APP_URL en .env (por ejemplo, a 3001) o cierra el otro programa.`);
    process.exit(1);
  }
  console.log(`Tutoría personal en ${appUrl}`);
});
live.attach(server, app.locals.userFromCookie);
startReminders({ db, sendMail, appUrl, hour: process.env.REMINDER_HOUR });
