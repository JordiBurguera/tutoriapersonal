import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { reminderHour, reminderTick, sendReminders } from '../src/reminders.js';

function seed() {
  const db = openDb(':memory:');
  const add = db.prepare(`INSERT INTO users (username, role, tutor_group, curso, grupo) VALUES (?, ?, ?, ?, ?)`);
  add.run('profa', 'profesor', '2B', null, null);
  add.run('profb', 'profesor', '2B', null, null);
  add.run('alu', 'alumno', null, 2, 'B');
  db.prepare(`INSERT INTO elections (title, opened_at) VALUES ('x', datetime('now'))`).run();
  return db;
}

test('REMINDER_HOUR inválida cae a 8', () => {
  for (const bad of [undefined, '', ' ', 'abc', '25', '-1', '7.5', NaN]) assert.equal(reminderHour(bad), 8);
  assert.equal(reminderHour('0'), 0);
  assert.equal(reminderHour('23'), 23);
  assert.equal(reminderHour(10), 10);
});

test('hora inválida no envía antes de las 8 (Madrid) y cambios de hora', async () => {
  const db = openDb(':memory:');
  const t = (iso, hour) => reminderTick({ db, sendMail: async () => {}, appUrl: 'http://a', hour, now: new Date(iso) });
  assert.equal(await t('2026-11-05T06:30:00Z', 'abc'), null); // 07:30 Madrid
  // Verano (UTC+2): 06:30Z = 08:30 Madrid
  assert.equal(await t('2026-07-05T06:30:00Z', '8'), 0);
  // Cambio de hora de octubre: 2026-10-25 06:30Z = 07:30 Madrid (UTC+1)
  assert.equal(await t('2026-10-25T06:30:00Z', '8'), null);
  // 22:30Z del 4 nov = 23:30 Madrid del 4; 23:30Z = 00:30 del 5 (día nuevo, antes de la hora)
  assert.equal(await t('2026-11-04T23:30:00Z', '8'), null);
  assert.equal(await t('2026-10-25T07:30:00Z', '8'), 0); // 08:30 Madrid
});

test('un fallo de envío no impide el resto y el día queda marcado', async () => {
  const db = seed();
  const calls = [];
  const sendMail = async (m) => { calls.push(m.to); if (m.to.startsWith('profa@')) throw new Error('smtp'); };
  const origErr = console.error; console.error = () => {};
  try {
    const now = new Date('2026-11-05T09:00:00Z');
    assert.equal(await reminderTick({ db, sendMail, appUrl: 'http://a', hour: '8', now }), 1);
    assert.equal(calls.length, 2);
    assert.equal(await reminderTick({ db, sendMail, appUrl: 'http://a', hour: '8', now }), null);
  } finally { console.error = origErr; }
});
