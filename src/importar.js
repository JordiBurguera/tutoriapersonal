// Importación de alumnado desde Excel o CSV. Primero se revisa (vista previa) y después se confirma.
import { namesFromUsername, normalizeUsername } from './app.js';
import { readTable } from './xlsx.js';

const plain = (text) => String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Cabeceras aceptadas, en valenciano y en castellano.
const HEADERS = {
  username: ['correu', 'correo', 'email', 'e-mail', 'mail', 'usuari', 'usuario', 'user', 'correu electronic', 'correo electronico'],
  firstName: ['nom', 'nombre', 'name', 'first name'],
  lastName: ['cognoms', 'cognom', 'apellidos', 'apellido', 'surname', 'last name'],
  fullName: ['alumne', 'alumno', 'nom complet', 'nombre completo', 'alumna'],
  curso: ['curs', 'curso', 'nivell', 'nivel'],
  grupo: ['grup', 'grupo', 'group'],
  classe: ['classe', 'clase', 'class', 'curs i grup', 'curso y grupo'],
};

function findColumns(row) {
  const columns = {};
  row.forEach((cell, index) => {
    const name = plain(cell);
    for (const [key, aliases] of Object.entries(HEADERS)) {
      if (columns[key] === undefined && aliases.includes(name)) columns[key] = index;
    }
  });
  return columns;
}

export function parseCurso(value) {
  const digit = String(value ?? '').match(/[1-4]/)?.[0];
  return digit ? Number(digit) : null;
}

export function parseGrupo(value) {
  const letter = plain(value).replace(/eso|bat|r|n|t|º|ª|\d|\s|[.-]/g, '').toUpperCase().slice(-1);
  return ['A', 'B'].includes(letter) ? letter : null;
}

function splitFullName(value) {
  const text = String(value ?? '').trim();
  if (text.includes(',')) {
    const [last, first] = text.split(',').map((part) => part.trim());
    return { firstName: first, lastName: last };
  }
  const [first, ...rest] = text.split(/\s+/);
  return { firstName: first ?? '', lastName: rest.join(' ') };
}

// Devuelve las filas listas para revisar. Cada una: { line, username, firstName, lastName, curso, grupo, action, error }.
export function previewImport(db, buffer) {
  const table = readTable(buffer);
  const headerIndex = table.findIndex((row) => findColumns(row).username !== undefined);
  if (headerIndex < 0) {
    throw Object.assign(new Error("No s'ha trobat la columna del correu. La primera fila ha de tindre els títols: Correu, Nom, Cognoms, Curs, Grup."), { status: 400 });
  }
  const columns = findColumns(table[headerIndex]);
  const existing = new Map(db.prepare('SELECT username, role FROM users').all().map((u) => [u.username, u.role]));
  const seen = new Set();
  const rows = table.slice(headerIndex + 1).map((row, i) => {
    const get = (key) => (columns[key] === undefined ? '' : row[columns[key]] ?? '');
    const line = headerIndex + i + 2;
    const username = normalizeUsername(get('username'));
    let { firstName, lastName } = columns.fullName !== undefined && !get('firstName')
      ? splitFullName(get('fullName'))
      : { firstName: get('firstName'), lastName: get('lastName') };
    const curso = parseCurso(get('curso') || get('classe'));
    const grupo = parseGrupo(get('grupo') || get('classe'));
    const result = { line, username: username ?? String(get('username')), firstName, lastName, curso, grupo, action: 'nou', error: null };
    if (!username) return { ...result, action: 'error', error: 'Correu no vàlid o d\'un altre domini.' };
    if (seen.has(username)) return { ...result, action: 'error', error: 'Repetit en el mateix arxiu.' };
    seen.add(username);
    if (!firstName && !lastName) ({ firstName, lastName } = namesFromUsername(username));
    Object.assign(result, { firstName: String(firstName).slice(0, 60), lastName: String(lastName).slice(0, 100) });
    if (!curso || !grupo) return { ...result, action: 'error', error: 'Falta el curs (1-4) o el grup (A o B).' };
    const role = existing.get(username);
    if (role && role !== 'alumno') return { ...result, action: 'error', error: 'Eixe compte és de professorat o administració.' };
    if (role) result.action = 'actualitza';
    return result;
  });
  return { rows };
}

// Crea o actualiza las filas válidas. Vuelve a comprobarlo todo: no se fía de la vista previa.
export function applyImport(db, rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw Object.assign(new Error('No hi ha cap fila per importar.'), { status: 400 });
  if (rows.length > 2000) throw Object.assign(new Error('Com a màxim 2000 alumnes per importació.'), { status: 400 });
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const select = db.prepare('SELECT id, role FROM users WHERE username = ?');
  const insert = db.prepare(`INSERT INTO users (username, first_name, last_name, role, curso, grupo) VALUES (?, ?, ?, 'alumno', ?, ?)`);
  const update = db.prepare('UPDATE users SET first_name = ?, last_name = ?, curso = ?, grupo = ? WHERE id = ?');
  for (const row of rows) {
    const username = normalizeUsername(row?.username);
    const curso = [1, 2, 3, 4].includes(row?.curso) ? row.curso : null;
    const grupo = ['A', 'B'].includes(row?.grupo) ? row.grupo : null;
    const fallback = username ? namesFromUsername(username) : {};
    const firstName = String(row?.firstName || fallback.firstName || '').trim().slice(0, 60);
    const lastName = String(row?.lastName ?? fallback.lastName ?? '').trim().slice(0, 100);
    if (!username || !curso || !grupo || !firstName) { skipped += 1; continue; }
    const user = select.get(username);
    if (!user) { insert.run(username, firstName, lastName, curso, grupo); created += 1; } else if (user.role === 'alumno') { update.run(firstName, lastName, curso, grupo, user.id); updated += 1; } else skipped += 1;
  }
  return { created, updated, skipped };
}
