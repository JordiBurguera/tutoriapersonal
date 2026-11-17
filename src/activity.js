// Historial de acciones y avisos de la campana.

const actorName = (actor) => {
  if (!actor) return 'Sistema';
  const name = actor.last_name ? `${actor.first_name} ${actor.last_name}` : actor.first_name;
  return name || actor.username || 'Sistema';
};

export function audit(db, actor, action, detail = '') {
  db.prepare('INSERT INTO audit_log (at, actor_id, actor_name, action, detail) VALUES (?, ?, ?, ?, ?)')
    .run(Date.now(), actor?.id ?? null, actorName(actor), action, detail);
}

export function notify(db, userId, text) {
  db.prepare('INSERT INTO notifications (user_id, at, text) VALUES (?, ?, ?)').run(userId, Date.now(), text);
}

export const unreadCount = (db, userId) =>
  db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId).n;

export const fullName = (person) => (person.last_name ? `${person.first_name} ${person.last_name}` : person.first_name);

// Fecha en Madrid, para los textos de los avisos: «dilluns 24 de novembre a les 23:59».
export function madridDate(ms) {
  return new Intl.DateTimeFormat('ca-ES', {
    timeZone: 'Europe/Madrid', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  }).format(new Date(ms));
}
