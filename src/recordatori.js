// Envía el recordatorio ahora, sin esperar a la hora programada: npm run recordatori
import { openDb } from './db.js';
import { createMailer } from './mail.js';
import { sendReminders } from './reminders.js';

const port = Number(process.env.PORT || 3000);
const appUrl = (process.env.APP_URL || `http://localhost:${port}`).replace(/\/$/, '');
const db = openDb(process.env.DB_PATH || 'data/tutoria.db');
const sent = await sendReminders({ db, sendMail: createMailer(), appUrl });
console.log(`Recordatorios enviados: ${sent}`);
