const app = document.getElementById('app');
const header = document.getElementById('header');
let domain = '';
let me = null;
let view = null;
let dragging = false;
let refreshAfterDrag = false;

// Las secciones plegadas se recuerdan en este navegador. Sin almacenamiento, salen todas abiertas.
const CLOSED_PANELS_KEY = 'tutoria.admin.closed';
function loadClosedPanels() {
  try {
    return new Set(JSON.parse(localStorage.getItem(CLOSED_PANELS_KEY)) ?? []);
  } catch {
    return new Set();
  }
}

// Lo que debe sobrevivir a un repintado por aviso en tiempo real.
const ui = { filters: {}, importPreview: null, importResult: null, limitSaved: false, history: null, previewId: null, classKey: null, searchQuery: '', meetingSaved: false, groupSaved: false, groupOpen: false, closedPanels: loadClosedPanels(), promotionClasses: new Set(), promotionReview: false, promotionResult: null, navOpen: false, counts: {}, dataSaved: false, studentVoting: true };

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const ORDINAL = { 1: '1r', 2: '2n', 3: '3r', 4: '4t' };
const classLabel = (s) => (s.curso ? `${ORDINAL[s.curso]} ${s.grupo}` : '—');
const listName = (p) => (p.last_name ? `${p.last_name}, ${p.first_name}` : p.first_name);
const emailOf = (p) => `${p.username}@${domain}`;
const ROLE_LABEL = { alumno: 'Alumnat', profesor: 'Professor', admin: 'Administrador' };
const LLOC = 'Lloc de reunió';
const DASH = '<span class="dash">—</span>';

const ICONS = {
  ballot: '<path d="M3 3.5h10M3 8h7M3 12.5h4"/>',
  userx: '<circle cx="6.5" cy="5" r="2.5"/><path d="M2 13.5c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4M11 4.5l3 3M14 4.5l-3 3"/>',
  up: '<path d="M8 13.5v-11M4 6.5l4-4 4 4"/>',
  people: '<circle cx="6" cy="5" r="2.5"/><path d="M1.5 13.5c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4M11 2.8a2.5 2.5 0 0 1 0 4.4M12.5 9.8c1.2.6 2 1.9 2 3.7"/>',
  book: '<path d="M3 3.5c0-.8.7-1.5 1.5-1.5H13v10H4.5c-.8 0-1.5.7-1.5 1.5zM3 13.5c0 .3 0 .5.5.5H13"/>',
  shield: '<path d="M8 1.8 13 3.5v4c0 3.2-2.1 5.5-5 6.7-2.9-1.2-5-3.5-5-6.7v-4z"/>',
  search: '<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3.5 3.5"/>',
  user: '<circle cx="8" cy="5" r="3"/><path d="M2.5 14c0-3 2.5-4.5 5.5-4.5s5.5 1.5 5.5 4.5"/>',
  home: '<path d="M2.5 7 8 2.5 13.5 7v6.5h-11z"/><path d="M6.5 13.5V9.5h3v4"/>',
  chart: '<path d="M2.5 13.5h11M4.5 11V7.5M8 11V4M11.5 11V6"/>',
  clock: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2 1.3"/>',
  bell: '<path d="M4 11.5V7.5a4 4 0 0 1 8 0v4l1 1.2H3z"/><path d="M6.6 14a1.5 1.5 0 0 0 2.8 0"/>',
  moon: '<path d="M13 9.6A5.5 5.5 0 0 1 6.4 3a5.5 5.5 0 1 0 6.6 6.6z"/>',
  sun: '<circle cx="8" cy="8" r="2.8"/><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"/>',
  upload: '<path d="M8 10.5V2.5M5 5.5l3-3 3 3M2.5 10.5v3h11v-3"/>',
  download: '<path d="M8 2.5v8M5 7.5l3 3 3-3M2.5 10.5v3h11v-3"/>',
  grip: '<g fill="currentColor" stroke="none"><circle cx="5.5" cy="3.5" r="1.2"/><circle cx="10.5" cy="3.5" r="1.2"/><circle cx="5.5" cy="8" r="1.2"/><circle cx="10.5" cy="8" r="1.2"/><circle cx="5.5" cy="12.5" r="1.2"/><circle cx="10.5" cy="12.5" r="1.2"/></g>',
};
const icon = (name) => `<svg class="ico" viewBox="0 0 16 16" aria-hidden="true">${ICONS[name]}</svg>`;

const LOGO = '<img class="logo" src="/assets/logo-lescarolines.png" alt="Escola Les Carolines" width="292" height="75">';

async function api(path, method = 'GET', body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error inesperat.');
  return data;
}

// Avisos y confirmaciones. Viven fuera de #app, así que un repintado no los cierra.
function ask(message, { confirmLabel = 'Confirmar', danger = false, alertOnly = false } = {}) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'ask';
    dialog.innerHTML = `<p>${esc(message)}</p>
      <div class="dialog-actions">
        ${alertOnly ? '' : '<button type="button" class="btn outline" value="no">Tornar</button>'}
        <button type="button" class="btn ${danger ? 'danger' : 'primary'}" value="yes">${esc(alertOnly ? "D'acord" : confirmLabel)}</button>
      </div>`;
    dialog.querySelectorAll('button').forEach((btn) => {
      btn.onclick = () => dialog.close(btn.value);
    });
    dialog.onclose = () => {
      dialog.remove();
      resolve(dialog.returnValue === 'yes');
    };
    document.body.append(dialog);
    dialog.showModal();
  });
}

// Repinta la vista sin perder lo que se estaba escribiendo, el foco ni el scroll.
async function rerender() {
  const values = new Map([...app.querySelectorAll('input[id]:not(:disabled):not([type="file"]), select[id]:not(:disabled)')].map((el) => [el.id, el.value]));
  const focused = document.activeElement?.id;
  const caret = [document.activeElement?.selectionStart, document.activeElement?.selectionEnd];
  const scroll = window.scrollY;
  await view();
  for (const [id, value] of values) {
    const el = document.getElementById(id);
    if (el) el.value = value;
  }
  if (focused) {
    const el = document.getElementById(focused);
    el?.focus();
    try { if (caret[0] != null) el?.setSelectionRange(caret[0], caret[1]); } catch { /* select y similares */ }
  }
  window.scrollTo(0, scroll);
}

async function act(fn) {
  try {
    await fn();
    await rerender();
  } catch (err) {
    await ask(err.message, { alertOnly: true });
  }
}

const emailField = (id, text) => `
  <label class="field">${esc(text)}
    <span class="email-field">
      <input id="${id}" required autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="usuari">
      <span class="domain">@${esc(domain)}</span>
    </span>
  </label>`;

const composeButton = (students, label, kind = 'outline') => (students.length
  ? `<a class="btn ${kind}" href="mailto:${students.map((s) => esc(emailOf(s))).join(',')}">${esc(label)}</a>`
  : '');
const composeAll = (students) => composeButton(students, "Correu a tot l'alumnat");

// Cada profesor tiene un tono estable derivado de su id; sus alumnos lo heredan en la columna de tutor.
const hue = (id) => Math.round((id * 137.508) % 360);
const initials = (p) => [p.first_name, p.last_name].map((part) => (part ?? '').trim()[0] ?? '').join('').toUpperCase();
const chip = (person, big = false) => `<span class="chip${big ? ' big' : ''}" ${person.id ? `style="background:hsl(${hue(person.id)} 70% 92%);color:hsl(${hue(person.id)} 55% 22%)"` : ''} aria-hidden="true">${esc(initials(person))}</span>`;

const titleRow = (title, sub = '', actions = '') => `<div class="title-row">
  <div><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div>
  ${actions ? `<div class="title-actions">${actions}</div>` : ''}
</div>`;

const card = (title, body, { meta = '', action = '', extraClass = '' } = {}) => `<section class="panel ${extraClass}">
  <div class="panel-head"><h2>${title}${meta ? ` <span class="panel-meta">${meta}</span>` : ''}</h2>${action}</div>
  <div class="panel-body">${body}</div>
</section>`;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Filas de "mis alumnos": comunes al panel del profesor y a la vista previa del administrador.
const tutoredRows = (students) => `
  <thead><tr><th><span class="col">Alumne</span></th><th><span class="col">Classe</span></th><th></th></tr></thead>
  <tbody>${students.map((s) => `<tr>
    <td class="person">${esc(listName(s))}<span class="sub">${esc(emailOf(s))}</span></td>
    <td>${esc(classLabel(s))}</td>
    <td class="end">${composeButton([s], 'Redactar correu', 'quiet')}</td></tr>`).join('')}</tbody>`;

// --- Fechas ---

const fmtDate = (ms, opts = {}) => new Intl.DateTimeFormat('ca-ES', {
  day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', ...opts,
}).format(new Date(ms));
const fmtShort = (ms) => new Intl.DateTimeFormat('ca-ES', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
}).format(new Date(ms));


// «fa 5 min», «ahir a les 10:30»
function ago(ms) {
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 1) return 'ara mateix';
  if (minutes < 60) return `fa ${minutes} min`;
  if (minutes < 60 * 24) return `fa ${Math.round(minutes / 60)} h`;
  return fmtDate(ms);
}

// Valor de <input type="datetime-local"> a partir de milisegundos, en hora local.

// --- Modo oscuro ---

const THEME_KEY = 'tutoria.tema';
const isDark = () => document.documentElement.dataset.theme === 'dark';
function toggleTheme() {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(THEME_KEY, next); } catch { /* sin almacenamiento: solo esta visita */ }
  renderHeader();
}
const themeButton = () => `<button type="button" class="btn quiet icon-btn" data-theme-toggle title="${isDark() ? 'Mode clar' : 'Mode fosc'}" aria-label="${isDark() ? 'Canviar a mode clar' : 'Canviar a mode fosc'}">${icon(isDark() ? 'sun' : 'moon')}</button>`;

// --- Avisos (campana) ---

const bellButton = () => (me ? `<button type="button" class="btn quiet icon-btn bell" id="bell" aria-label="Avisos${me.unread ? `: ${me.unread} sense llegir` : ''}" title="Avisos">
  ${icon('bell')}${me.unread ? `<span class="badge">${me.unread > 9 ? '9+' : me.unread}</span>` : ''}</button>` : '');

async function openNotifications() {
  const { items } = await api('/api/avisos');
  const dialog = document.createElement('dialog');
  dialog.className = 'notices';
  dialog.innerHTML = `<div class="dialog-head"><h2>Avisos</h2><button type="button" class="btn quiet" value="close">Tancar</button></div>
    ${items.length ? `<ul class="notice-list">${items.map((n) => `<li class="${n.read_at ? '' : 'unread'}">
      <span class="dot" aria-hidden="true"></span><div><p>${esc(n.text)}</p><time datetime="${new Date(n.at).toISOString()}">${esc(ago(n.at))}</time></div></li>`).join('')}</ul>`
      : '<p class="empty">No tens cap avís.</p>'}`;
  dialog.querySelector('button').onclick = () => dialog.close();
  dialog.onclose = () => dialog.remove();
  document.body.append(dialog);
  dialog.showModal();
  if (items.some((n) => !n.read_at)) {
    await api('/api/avisos/llegits', 'POST');
    me.unread = 0;
    renderHeader();
  }
}

// --- Buscador y filtros (sin repintar: se ocultan filas) ---

const plainText = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const filterState = (key) => (ui.filters[key] ??= { q: '' });

// controls: [{ name, label, options: [[value, label], ...] }]
function filterBar(key, controls = [], placeholder = 'Buscar per nom o correu') {
  const state = filterState(key);
  return `<div class="filter-bar" data-filter="${key}">
    <label class="search-box">${icon('search')}<input type="search" id="fq-${key}" data-filter-q placeholder="${esc(placeholder)}" value="${esc(state.q)}" aria-label="Buscar"></label>
    ${controls.map((c) => `<select class="compact filter-select" id="f-${key}-${c.name}" data-filter-field="${c.name}" aria-label="${esc(c.label)}">
      <option value="">${esc(c.label)}: tots</option>
      ${c.options.map(([value, label]) => `<option value="${esc(value)}" ${state[c.name] === String(value) ? 'selected' : ''}>${esc(label)}</option>`).join('')}
    </select>`).join('')}
    <span class="filter-count" id="fc-${key}" aria-live="polite"></span>
    <button type="button" class="btn quiet" data-filter-clear="${key}">Netejar</button>
  </div>`;
}

// Atributos de una fila filtrable: texto de búsqueda y valores de cada filtro.
const rowAttrs = (key, text, fields = {}) => `data-row="${key}" data-q="${esc(plainText(text))}" ${Object.entries(fields)
  .map(([name, value]) => `data-f-${name}="${esc(value ?? '')}"`).join(' ')}`;

function applyFilters() {
  document.querySelectorAll('[data-filter]').forEach((bar) => {
    const key = bar.dataset.filter;
    const state = filterState(key);
    const words = plainText(state.q).split(/\s+/).filter(Boolean);
    const rows = [...document.querySelectorAll(`[data-row="${key}"]`)];
    let shown = 0;
    for (const row of rows) {
      const match = words.every((w) => row.dataset.q.includes(w))
        && Object.entries(state).every(([name, value]) => name === 'q' || !value || (row.getAttribute(`data-f-${name}`) ?? '').split(' ').includes(value));
      row.hidden = !match;
      if (match) shown += 1;
    }
    const active = words.length || Object.entries(state).some(([name, value]) => name !== 'q' && value);
    const count = document.getElementById(`fc-${key}`);
    if (count) count.textContent = active ? `${shown} de ${rows.length}` : `${rows.length}`;
    bar.querySelector('[data-filter-clear]').hidden = !active;
    const empty = document.querySelector(`[data-filter-empty="${key}"]`);
    if (empty) empty.hidden = !(active && shown === 0);
  });
}

function bindFilters() {
  document.querySelectorAll('[data-filter]').forEach((bar) => {
    const key = bar.dataset.filter;
    const state = filterState(key);
    bar.querySelector('[data-filter-q]').oninput = (event) => { state.q = event.target.value; applyFilters(); };
    bar.querySelectorAll('[data-filter-field]').forEach((select) => {
      select.onchange = () => { state[select.dataset.filterField] = select.value; applyFilters(); };
    });
    bar.querySelector('[data-filter-clear]').onclick = () => {
      ui.filters[key] = { q: '' };
      bar.querySelectorAll('input, select').forEach((el) => { el.value = ''; });
      applyFilters();
    };
  });
  applyFilters();
}

const noMatches = (key) => `<p class="empty" data-filter-empty="${key}" hidden>Cap resultat amb estos filtres.</p>`;

// --- Marco y navegación ---

const NAV = {
  alumno: [
    { items: [
      { key: 'tutor', label: 'El meu tutor', icon: 'home' },
      { key: 'dades', label: 'Les meues dades', icon: 'user' },
    ] },
  ],
  admin: [
    { items: [
      { key: 'eleccions', label: 'Eleccions', icon: 'ballot' },
      { key: 'estadistiques', label: 'Estadístiques', icon: 'chart' },
      { key: 'sense-tutor', label: 'Sense tutor', icon: 'userx', count: 'unassigned' },
      { key: 'pas-de-curs', label: 'Pas de curs', icon: 'up' },
    ] },
    { title: 'Comptes', items: [
      { key: 'alumnat', label: 'Alumnat', icon: 'people' },
      { key: 'professorat', label: 'Professorat', icon: 'book' },
      { key: 'administradors', label: 'Administradors', icon: 'shield' },
    ] },
    { title: 'Registre', items: [
      { key: 'historial', label: 'Historial', icon: 'clock' },
    ] },
  ],
  profesor: [
    { items: [
      { key: 'tauler', label: 'Tauler', icon: 'home', count: 'pending' },
      { key: 'buscar', label: 'Buscar alumne', icon: 'search' },
      { key: 'dades', label: 'Les meues dades', icon: 'user' },
    ] },
  ],
};

// Mientras vota no hay destinos: cambiar de pantalla perdería el orden que lleva, y sus datos ya están en la papereta.
const navGroups = () => (me?.role === 'alumno' && ui.studentVoting ? [] : NAV[me?.role] ?? []);

const route = () => {
  const items = navGroups().flatMap((group) => group.items);
  const hash = location.hash.slice(1);
  return items.some((item) => item.key === hash) ? hash : items[0]?.key;
};

function renderHeader() {
  const groups = navGroups();
  const current = route();
  header.className = groups.length ? '' : 'plain';
  const nav = groups.length ? `<nav aria-label="Principal">${groups.map((group) => `
    ${group.title ? `<p class="nav-group">${esc(group.title)}</p>` : ''}
    ${group.items.map((item) => {
      const count = item.count ? ui.counts[item.count] : 0;
      return `<a class="nav-item" href="#${item.key}" ${item.key === current ? 'aria-current="page"' : ''}>
        ${icon(item.icon)}<span>${esc(item.label)}</span>${count ? `<span class="count">${count}</span>` : ''}
      </a>`;
    }).join('')}`).join('')}</nav>` : '';
  const sideTools = groups.length ? `<div class="side-tools">
      <button type="button" class="side-tool" id="bellSide">${icon('bell')}<span>Avisos</span>${me.unread ? `<span class="badge">${me.unread > 9 ? '9+' : me.unread}</span>` : ''}</button>
      <button type="button" class="side-tool" data-theme-toggle>${icon(isDark() ? 'sun' : 'moon')}<span>${isDark() ? 'Mode clar' : 'Mode fosc'}</span></button>
    </div>` : '';
  header.innerHTML = `
    <div class="brand">${LOGO}<strong>Tutoria personal</strong></div>
    ${!me ? `<div class="header-tools">${themeButton()}</div>` : ''}
    ${groups.length ? `<div class="mobile-tools">${bellButton()}<button type="button" id="menu" class="btn quiet menu-toggle" aria-expanded="${ui.navOpen}" aria-controls="navSheet">${ui.navOpen ? 'Tancar' : 'Menú'}</button></div>` : ''}
    ${me ? `<div id="navSheet" class="nav-sheet${ui.navOpen ? ' open' : ''}">
      ${nav}
      ${sideTools}
      ${groups.length ? `<p class="legal-links"><a href="/avis-legal.html">Avís legal</a><a href="/privacitat.html">Privacitat</a><a href="/cookies.html">Cookies</a></p>` : ''}
      <div class="user-row">
        ${chip({ id: me.id, first_name: me.firstName, last_name: me.lastName })}
        <div class="who"><strong>${esc(me.firstName)} ${esc(me.lastName)}</strong><span>${esc(ROLE_LABEL[me.role])}</span></div>
        ${groups.length ? '' : `${bellButton()}${themeButton()}`}
        <button type="button" id="logout" class="btn quiet">Eixir</button>
      </div>
    </div>` : ''}`;
  header.querySelectorAll('[data-theme-toggle]').forEach((btn) => { btn.onclick = toggleTheme; });
  header.querySelectorAll('#bell, #bellSide').forEach((btn) => {
    btn.onclick = () => openNotifications().catch((err) => ask(err.message, { alertOnly: true }));
  });
  if (me) {
    document.getElementById('logout').onclick = async () => {
      await api('/api/logout', 'POST');
      location.reload();
    };
    const menu = document.getElementById('menu');
    if (menu) {
      menu.onclick = () => {
        ui.navOpen = !ui.navOpen;
        renderHeader();
        document.getElementById('menu').focus();
      };
    }
  }
}

// --- Inicio de sesión ---

function renderLogin() {
  app.innerHTML = `
    <div class="login">
      <form id="login" class="panel">
        <h1>Tutoria personal</h1>
        <p class="lead">Tria qui vols que et tutoritze este curs.</p>
        ${emailField('username', "Correu de l'institut")}
        <button class="btn primary">Envia'm l'enllaç d'accés</button>
        <p class="fine">En entrar, el centre tractarà les teues dades per a assignar-te tutor. Ho tens explicat a la <a href="/privacitat.html">política de privacitat</a>.</p>
        <p id="msg"></p>
      </form>
      <section class="panel how">
        <h2>Com funciona</h2>
        <ol>
          <li>Entra amb el correu de l'institut, sense contrasenya.</li>
          <li>Ordena el professorat: el primer és el que més preferixes.</li>
          <li>La sol·licitud va al primer de la llista. Si no pot acceptar-te, passa sola al següent.</li>
        </ol>
      </section>
    </div>`;
  document.getElementById('login').onsubmit = async (event) => {
    event.preventDefault();
    const msg = document.getElementById('msg');
    const username = document.getElementById('username').value;
    try {
      const { direct } = await api('/api/login', 'POST', { username });
      if (direct) return location.reload();
      msg.className = 'msg-ok';
      msg.textContent = `T'hem enviat un correu de confirmació a ${username.split('@')[0]}@${domain}. Obri l'enllaç per a entrar.`;
    } catch (err) {
      msg.className = 'msg-error';
      msg.textContent = err.message;
    }
  };
}

// --- Alumnado ---

const STUDENT_MESSAGE = {
  sin_convocatoria: 'Encara no tens tutor personal assignat.',
  sin_respuesta: "No vas contestar les eleccions. L'administració t'assignarà tutor.",
  en_proceso: 'Resposta rebuda. La teua sol·licitud està pendent que un professor la confirme.',
  agotada: "Cap professor de la teua llista ha pogut acceptar-te. L'administració t'assignarà tutor.",
};

const selectOptions = (values, label, selected) => `<option value="">—</option>` + values
  .map((v) => `<option value="${v}" ${selected === v ? 'selected' : ''}>${esc(label(v))}</option>`).join('');

const answerSection = (data) => card('La teua resposta', `
  <p class="lead">Quan et confirmen, ací voràs el teu tutor personal definitiu.</p>
  <h3 class="subhead">El teu ordre de preferència</h3>
  <ol class="read-rank">${data.answer.ranking.map((t, i) => `<li><span class="place">${i + 1}</span><span>${esc(listName(t))}</span></li>`).join('')}</ol>
  <h3 class="subhead">Professors que no et poden tocar</h3>
  ${data.answer.vetoes.length
    ? `<ul class="read-rank">${data.answer.vetoes.map((t) => `<li><span>${esc(listName(t))}</span></li>`).join('')}</ul>`
    : '<p class="lead">Cap.</p>'}
`);

// Tutor del año anterior durante la votación: se señala en su fila y decide el aviso de la primera preferencia.
let previousTutorId = null;

const teacherItem = (t) => `<li class="teacher" data-id="${t.id}" tabindex="0" aria-describedby="kbdHint"><span class="name"><span class="t-name">${esc(listName(t))}</span>${
  t.department ? `<span class="t-dept">${esc(t.department)}</span>` : ''
}${t.id === previousTutorId ? '<span class="pill prev">El teu tutor l\'any passat</span>' : ''}</span><span class="grip">${icon('grip')}</span></li>`;

async function renderStudent() {
  const data = await api('/api/alumno');
  ui.studentVoting = data.status === 'por_contestar';
  renderHeader();
  if (ui.studentVoting) {
    if (document.getElementById('ballot')) syncBallot(data.teachers);
    else renderBallot(data);
    return;
  }
  if (route() === 'dades') return renderStudentData(data);
  const status = data.tutor ? `<section class="panel">
      <div class="tutor-card">
        ${chip(data.tutor, true)}
        <p class="tutor-name">${esc(data.tutor.first_name)} ${esc(data.tutor.last_name)}</p>
      </div>
      <dl class="facts"><div><dt>${LLOC}</dt><dd>${data.tutor.meeting_place ? esc(data.tutor.meeting_place) : '<span class="dash">sense definir</span>'}</dd></div></dl>
      <a class="btn primary tutor-mail" href="mailto:${esc(emailOf(data.tutor))}">Enviar un correu al teu tutor</a>
    </section>` : `<section class="panel"><p class="status-line">${esc(STUDENT_MESSAGE[data.status])}</p></section>`;
  app.innerHTML = `<div class="column narrow">
    ${titleRow('El teu tutor personal', `El teu grup: <strong>${esc(classLabel(data))}</strong>`)}
    <div class="stack">${status}${data.answer ? answerSection(data) : ''}</div>
  </div>`;
}

// Popup de «Editar»: confirma la intención y pregunta quién lo tiene a su cargo. Devuelve su id o null.
function askSupervisor(supervisors) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'ask';
    dialog.innerHTML = `<form method="dialog">
      <h2>Segur que vols editar les teues dades?</h2>
      <div class="field" style="margin:16px 0 0">
        <label for="supervisor">Quin professor et té a càrrec ara?</label>
        <select id="supervisor" required aria-describedby="supervisorHint">
          <option value="">— Tria —</option>
          ${supervisors.map((t) => `<option value="${t.id}">${esc(listName(t))}</option>`).join('')}
        </select>
        <p class="panel-note" id="supervisorHint">Haurà de confirmar-ho en el seu panell. Quedarà registrat.</p>
      </div>
      <div class="dialog-actions">
        <button type="button" class="btn outline" id="supervisorBack">Tornar</button>
        <button class="btn primary">Demanar confirmació</button>
      </div>
    </form>`;
    const select = dialog.querySelector('select');
    let chosen = null;
    dialog.querySelector('form').onsubmit = () => { chosen = Number(select.value); };
    dialog.querySelector('#supervisorBack').onclick = () => dialog.close();
    dialog.onclose = () => {
      dialog.remove();
      resolve(chosen);
    };
    document.body.append(dialog);
    dialog.showModal();
  });
}

function renderStudentData(data) {
  const request = data.editRequest;
  const teacherName = request ? `<strong>${esc(listName(request.teacher))}</strong>` : '';
  if (request?.status === 'aprobada') {
    app.innerHTML = `<div class="column narrow">
      ${titleRow('Les meues dades', `${teacherName} ho ha confirmat. Ja pots canviar-les.`)}
      <section class="panel"><form id="studentData">
        <div class="fields-row student-fields">
          <div class="field"><label for="sdFirstName">Nom</label><input id="sdFirstName" required maxlength="60" value="${esc(data.firstName)}"></div>
          <div class="field"><label for="sdLastName">Cognoms</label><input id="sdLastName" required maxlength="100" value="${esc(data.lastName)}"></div>
          <div class="field"><label for="sdCurso">Curs</label><select id="sdCurso" required>${selectOptions([1, 2, 3, 4], (n) => ORDINAL[n], data.curso)}</select></div>
          <div class="field"><label for="sdGrupo">Grup</label><select id="sdGrupo" required>${selectOptions(['A', 'B'], (g) => g, data.grupo)}</select></div>
        </div>
        <div class="form-actions">
          <button class="btn primary">Guardar</button>
          <button type="button" class="btn quiet" id="cancelEdit">Cancel·lar</button>
        </div>
      </form></section>
    </div>`;
    document.getElementById('studentData').onsubmit = (event) => {
      event.preventDefault();
      act(async () => {
        await api('/api/alumno/dades', 'PUT', {
          firstName: document.getElementById('sdFirstName').value,
          lastName: document.getElementById('sdLastName').value,
          curso: Number(document.getElementById('sdCurso').value),
          grupo: document.getElementById('sdGrupo').value,
        });
        ui.dataSaved = true;
        await refreshHeader();
      });
    };
  } else {
    const waiting = request?.status === 'pendiente';
    const note = waiting ? `Esperant que ${teacherName} ho confirme en el seu panell.`
      : request?.status === 'rechazada' ? `${teacherName} no ho ha confirmat.`
        : ui.dataSaved ? 'Dades guardades.' : '';
    app.innerHTML = `<div class="column narrow">
      ${titleRow('Les meues dades', note, waiting
        ? '<button type="button" class="btn outline" id="cancelEdit">Cancel·lar la sol·licitud</button>'
        : '<button type="button" class="btn primary" id="editData">Editar</button>')}
      <section class="panel profile-card">
        <div class="profile-head">
          ${chip({ id: me.id, first_name: data.firstName, last_name: data.lastName }, true)}
          <div>
            <strong>${esc([data.firstName, data.lastName].filter(Boolean).join(' ')) || 'Sense nom'}</strong>
            <span>Alumnat${data.curso ? ` · ${ORDINAL[data.curso]}${data.grupo ? ` ${esc(data.grupo)}` : ''}` : ''}</span>
          </div>
        </div>
        <dl class="profile-grid">
          <div><dt>Nom</dt><dd>${esc(data.firstName) || DASH}</dd></div>
          <div><dt>Cognoms</dt><dd>${esc(data.lastName) || DASH}</dd></div>
          <div><dt>Curs</dt><dd>${data.curso ? ORDINAL[data.curso] : DASH}</dd></div>
          <div><dt>Grup</dt><dd>${esc(data.grupo) || DASH}</dd></div>
        </dl>
      </section>
    </div>`;
  }
  const edit = document.getElementById('editData');
  if (edit) {
    edit.onclick = async () => {
      ui.dataSaved = false;
      const teacherId = await askSupervisor(data.supervisors);
      if (teacherId) act(() => api('/api/alumno/dades/solicitud', 'POST', { teacherId }));
    };
  }
  const cancel = document.getElementById('cancelEdit');
  if (cancel) cancel.onclick = () => act(() => api('/api/alumno/dades/solicitud', 'DELETE'));
}

// Mantiene al día el aviso de quién recibe la solicitud primero.
function updateFirstChoice() {
  const line = document.getElementById('firstChoice');
  if (!line) return;
  const first = document.querySelector('#ranking li[data-id]');
  if (!first) {
    line.textContent = 'Cal deixar almenys un professor en la llista.';
    return;
  }
  const name = first.querySelector('.t-name').textContent;
  line.innerHTML = Number(first.dataset.id) === previousTutorId
    ? `<strong>${esc(name)}</strong> va ser el teu tutor l'any passat: quedarà confirmat directament.`
    : `La teua sol·licitud anirà primer a <strong>${esc(name)}</strong>.`;
  const count = document.getElementById('vetoCount');
  if (count) count.textContent = `${document.getElementById('vetoes').children.length} de 2`;
}

// La lista de profesores puede cambiar mientras alguien vota: se ajusta sin perder su orden.
function syncBallot(teachers) {
  const ranking = document.getElementById('ranking');
  const vetoes = document.getElementById('vetoes');
  const ids = new Set(teachers.map((t) => String(t.id)));
  const present = new Set();
  for (const li of [...ranking.children, ...vetoes.children]) {
    if (ids.has(li.dataset.id)) present.add(li.dataset.id);
    else li.remove();
  }
  for (const teacher of teachers) {
    if (!present.has(String(teacher.id))) {
      ranking.insertAdjacentHTML('beforeend', teacherItem(teacher));
    } else {
      // Nombre o departamento pueden haber cambiado: se actualiza la etiqueta sin mover el elemento.
      const li = app.querySelector(`#ballot li[data-id="${teacher.id}"] .name`);
      const fresh = document.createElement('li');
      fresh.innerHTML = teacherItem(teacher);
      const html = fresh.querySelector('.name')?.innerHTML;
      if (li && html !== undefined && li.innerHTML !== html) li.innerHTML = html;
    }
  }
  updateFirstChoice();
}

// Alternativa con teclado al arrastre: flechas para ordenar y para vetar o devolver.
function moveWithKeyboard(event, ranking, vetoes) {
  const li = event.target;
  if (!li.matches?.('li[data-id]')) return;
  const list = li.parentElement;
  const name = li.querySelector('.t-name').textContent;
  let said = '';
  if (event.key === 'ArrowUp' && li.previousElementSibling) {
    list.insertBefore(li, li.previousElementSibling);
  } else if (event.key === 'ArrowDown' && li.nextElementSibling) {
    list.insertBefore(li.nextElementSibling, li);
  } else if (event.key === 'ArrowRight' && list === ranking && vetoes.children.length < 2) {
    vetoes.append(li);
    said = `${name}: no et pot tocar.`;
  } else if (event.key === 'ArrowLeft' && list === vetoes) {
    ranking.append(li);
  } else {
    return;
  }
  event.preventDefault();
  li.focus();
  if (!said && li.parentElement === ranking) said = `${name}: posició ${[...ranking.children].indexOf(li) + 1} de ${ranking.children.length}.`;
  document.getElementById('ballotLive').textContent = said;
  updateFirstChoice();
}

function renderBallot(data) {
  previousTutorId = data.previousTutor?.id ?? null;
  app.innerHTML = `
    ${titleRow(esc(data.electionTitle), "Ordena el professorat i envia la teua resposta. Quan l'envies no podràs canviar-la.")}
    <form id="ballot">
      ${card('Les teues dades', `<div class="fields-row">
        <div class="field"><label for="firstName">Nom</label><input id="firstName" required maxlength="60" value="${esc(data.firstName)}"></div>
        <div class="field"><label for="lastName">Cognoms</label><input id="lastName" required maxlength="100" value="${esc(data.lastName)}"></div>
        <div class="field"><label for="curso">Curs</label><select id="curso" required>${selectOptions([1, 2, 3, 4], (n) => ORDINAL[n], data.curso)}</select></div>
        <div class="field"><label for="grupo">Grup</label><select id="grupo" required>${selectOptions(['A', 'B'], (g) => g, data.grupo)}</select></div>
      </div>`)}
      <div class="split ballot-grid">
        ${card('El teu ordre de preferència', `
          <p class="lead">Mantín premut un nom i arrossega'l per a ordenar. El primer és el que més preferixes.</p>
          <p class="first-choice" id="firstChoice"></p>
          <p class="kbd-hint" id="kbdHint">Amb el teclat: fletxes amunt i avall per a ordenar, dreta per a vetar, esquerra per a tornar a la llista.</p>
          <p class="sr-only" id="ballotLive" aria-live="polite"></p>
          <ol id="ranking" class="drag-list">${data.teachers.map(teacherItem).join('')}</ol>
        `)}
        <div class="stack rail-sticky">
          ${card('Professors que no et poden tocar', `
            <p class="lead">Arrossega'n ací fins a 2. El professorat no veurà esta tria.</p>
            <ul id="vetoes" class="drag-list"></ul>
          `, { meta: '(opcional)', action: '<span class="panel-meta" id="vetoCount">0 de 2</span>' })}
          <section class="panel">
            <button class="btn primary" style="width:100%">Enviar</button>
            <p id="msg" class="msg-error"></p>
          </section>
        </div>
      </div>
    </form>`;

  const ranking = document.getElementById('ranking');
  const vetoes = document.getElementById('vetoes');
  const dragOptions = {
    animation: 120,
    delay: 150,
    touchStartThreshold: 5,
    forceFallback: true,
    fallbackOnBody: true,
    onStart: () => { dragging = true; },
    onEnd: () => {
      dragging = false;
      updateFirstChoice();
      if (refreshAfterDrag) scheduleRefresh();
    },
  };
  Sortable.create(ranking, { ...dragOptions, group: 'teachers' });
  Sortable.create(vetoes, {
    ...dragOptions,
    group: { name: 'teachers', put: (to) => to.el.children.length < 2 },
  });

  const form = document.getElementById('ballot');
  form.onkeydown = (event) => moveWithKeyboard(event, ranking, vetoes);
  updateFirstChoice();

  const idsIn = (list) => [...list.children].map((li) => Number(li.dataset.id));
  form.onsubmit = async (event) => {
    event.preventDefault();
    try {
      await api('/api/alumno/eleccion', 'POST', {
        firstName: document.getElementById('firstName').value,
        lastName: document.getElementById('lastName').value,
        curso: Number(document.getElementById('curso').value),
        grupo: document.getElementById('grupo').value,
        vetoes: idsIn(vetoes),
        ranking: idsIn(ranking),
      });
      await renderStudent();
    } catch (err) {
      document.getElementById('msg').textContent = err.message;
    }
  };
}

// --- Profesorado ---

const profileFields = (data) => `
  <div class="field"><label for="pFirstName">Nom</label>
  <input id="pFirstName" required maxlength="60" value="${esc(data.firstName)}"></div>
  <div class="field"><label for="pLastName">Cognoms</label>
  <input id="pLastName" required maxlength="100" value="${esc(data.lastName)}"></div>
  <div class="field"><label for="pDepartment">Departament</label>
  <select id="pDepartment" required>
    <option value="">— Tria —</option>
    ${data.departments.map((d) => `<option ${d === data.department ? 'selected' : ''}>${esc(d)}</option>`).join('')}
  </select></div>
  <button class="btn primary">Guardar</button>`;

function bindProfile() {
  document.getElementById('profile').onsubmit = (event) => {
    event.preventDefault();
    act(async () => {
      await api('/api/profesor/perfil', 'PUT', {
        firstName: document.getElementById('pFirstName').value,
        lastName: document.getElementById('pLastName').value,
        department: document.getElementById('pDepartment').value,
      });
      await refreshHeader();
    });
  };
}

const groupLabel = (group) => `${ORDINAL[group[0]]} ${group[1]}`;

function groupSection(data) {
  const { group } = data;
  return card('Tutoria de grup', `
    <p class="lead">No és la tutoria personal. Pots canviar-la quan vulgues.</p>
    <div class="field" style="margin:12px 0 0">
      <label for="tutorGroup">Soc tutor de</label>
      <select id="tutorGroup">
        <option value="">No soc tutor de grup</option>
        ${data.groups.map((g) => `<option value="${g}" ${g === data.tutorGroup ? 'selected' : ''}>${groupLabel(g)}</option>`).join('')}
      </select>
    </div>
    ${ui.groupSaved ? '<p class="msg-ok">Tutoria de grup guardada.</p>' : ''}
    ${data.tutorGroup && !group ? '<p class="panel-note">Encara no hi ha eleccions.</p>' : ''}
    ${group ? `
      <h3 class="subhead">${groupLabel(data.tutorGroup)}</h3>
      <div class="ring-block">
        <button type="button" id="groupDonut" class="donut-button" aria-expanded="${ui.groupOpen}" title="Toca per a vore l'alumnat">${donut(group.stats)}</button>
        ${legend(group.stats)}
      </div>
      <p class="panel-note">Toca el cercle per a vore l'estat de cada alumne.</p>
      ${ui.groupOpen ? (group.students.length ? `<ul class="rows" style="margin-top:8px">
        ${group.students.map((s) => `<li><div class="grow">${esc(listName(s))}
          <span class="sub">${s.tutor ? esc(listName(s.tutor)) : 'Sense tutor personal'}</span></div>
          ${stateTag(s.status)}</li>`).join('')}
      </ul>` : '<p class="empty" style="margin-top:8px">Sense alumnat.</p>') : ''}
    ` : ''}`);
}

async function renderTeacher() {
  const data = await api('/api/profesor');
  ui.counts = { pending: data.pending.length + data.editRequests.length };
  renderHeader();
  if (!data.department) {
    app.innerHTML = `<div class="column narrow">
      ${titleRow('Completa les teues dades', 'Abans de continuar, indica el teu nom i el teu departament.')}
      <section class="panel"><form id="profile">${profileFields(data)}</form></section>
    </div>`;
    bindProfile();
    return;
  }
  const current = route();
  if (current === 'buscar') return renderTeacherSearch();
  if (current === 'dades') return renderTeacherProfile(data);

  const permitSub = data.editRequests.length
    ? `<strong>${plural(data.editRequests.length, 'alumne vol', 'alumnes volen')} canviar les seues dades.</strong> `
    : '';
  const pendingSub = permitSub + (data.pending.length
    ? `<strong>${data.pending.length === 1 ? 'Tens 1 sol·licitud' : `Tens ${data.pending.length} sol·licituds`}</strong> esperant la teua resposta.`
    : 'No tens sol·licituds de tutoria pendents.');

  app.innerHTML = `
    ${titleRow('Tauler', pendingSub)}
    <div class="split">
      <div class="stack">
        ${data.editRequests.length ? card('Permisos per a canviar dades', `<p class="lead">Confirma només si este alumne està ara a càrrec teu.</p>
          <table class="stack-table">
          <thead><tr><th><span class="col">Alumne</span></th><th><span class="col">Classe</span></th><th></th></tr></thead>
          <tbody>${data.editRequests.map((r) => `<tr>
            <td class="person">${esc(listName(r))}</td><td>${esc(classLabel(r))}</td>
            <td class="end"><div class="cell-actions">
              <button class="btn primary" data-permit="${r.id}" data-action="confirmar">Confirmar</button>
              <button class="btn" data-permit="${r.id}" data-action="rechazar">Rebutjar</button>
            </div></td></tr>`).join('')}</tbody>
        </table>`, { meta: String(data.editRequests.length) }) : ''}
        ${card('Sol·licituds pendents', data.pending.length ? `<table class="stack-table">
          <thead><tr><th><span class="col">Alumne</span></th><th><span class="col">Classe</span></th><th></th></tr></thead>
          <tbody>${data.pending.map((r) => `<tr>
            <td class="person">${esc(listName(r))}</td><td>${esc(classLabel(r))}</td>
            <td class="end"><div class="cell-actions">
              <button class="btn primary" data-request="${r.id}" data-action="confirmar">Confirmar</button>
              <button class="btn" data-request="${r.id}" data-action="rechazar">Rebutjar</button>
            </div></td></tr>`).join('')}</tbody>
        </table>` : '<p class="empty">No tens sol·licituds pendents.</p>', { meta: String(data.pending.length) })}
        ${card('Els teus alumnes tutoritzats', `${data.limit ? `<div class="limit-line">${loadMeter(data.students.length, data.limit)}<span>${data.students.length >= data.limit
          ? 'Has arribat al teu límit: les sol·licituds noves passen a la següent preferència de l\'alumne.'
          : `Et queden ${plural(data.limit - data.students.length, 'plaça', 'places')}.`}</span></div>` : ''}${data.students.length
          ? `<table class="stack-table">${tutoredRows(data.students)}</table>`
          : '<p class="empty">Encara no tens alumnes.</p>'}`, { meta: data.limit ? `${data.students.length} de ${data.limit}` : String(data.students.length), action: composeAll(data.students) })}
      </div>
      <div class="stack">
        ${card(LLOC, `
          <form id="meeting" class="joined">
            <input id="meetingPlace" maxlength="200" aria-label="${LLOC}" placeholder="Ex.: Aula 12, pati del dimarts" value="${esc(data.meetingPlace)}">
            <button class="btn outline">Guardar</button>
          </form>
          ${ui.meetingSaved ? `<p class="msg-ok" id="meetingOk">${LLOC} guardat.</p>` : ''}
          <p class="panel-note">El veu l'alumnat que tutoritzes.</p>`)}
        ${groupSection(data)}
      </div>
    </div>`;

  app.querySelectorAll('[data-request]').forEach((btn) => {
    btn.onclick = () => act(() => api(`/api/profesor/solicitudes/${btn.dataset.request}`, 'POST', { accion: btn.dataset.action }));
  });
  app.querySelectorAll('[data-permit]').forEach((btn) => {
    btn.onclick = () => act(() => api(`/api/profesor/permisos/${btn.dataset.permit}`, 'POST', { accion: btn.dataset.action }));
  });
  document.getElementById('tutorGroup').onchange = (event) => {
    act(async () => {
      await api('/api/profesor/grup', 'PUT', { group: event.target.value });
      ui.groupSaved = true;
      ui.groupOpen = false;
    });
  };
  const groupDonut = document.getElementById('groupDonut');
  if (groupDonut) {
    groupDonut.onclick = () => {
      ui.groupOpen = !ui.groupOpen;
      act(() => {});
    };
  }
  const meetingInput = document.getElementById('meetingPlace');
  meetingInput.oninput = () => {
    ui.meetingSaved = false;
    document.getElementById('meetingOk')?.remove();
  };
  document.getElementById('meeting').onsubmit = (event) => {
    event.preventDefault();
    act(async () => {
      await api('/api/profesor/meeting', 'PUT', { meetingPlace: meetingInput.value });
      ui.meetingSaved = true;
    });
  };
}

async function renderTeacherSearch() {
  const search = ui.searchQuery
    ? (await api(`/api/profesor/buscar?q=${encodeURIComponent(ui.searchQuery)}`)).results
    : null;
  app.innerHTML = `
    ${titleRow("Buscar el tutor d'un alumne")}
    <div class="split left-rail stretch">
      ${card('Alumne', `
        <form id="search" class="joined">
          <input id="q" minlength="2" aria-label="Alumne" placeholder="Nom, cognoms o usuari" value="${esc(ui.searchQuery)}">
          <button class="btn primary">Buscar</button>
        </form>`)}
      ${card('Resultats', search ? (search.length ? `<table class="stack-table">
        <thead><tr><th><span class="col">Alumne</span></th><th><span class="col">Classe</span></th><th><span class="col">Tutor</span></th></tr></thead>
        <tbody>${search.map((s) => `<tr><td class="person">${esc(listName(s))}</td><td>${esc(classLabel(s))}</td><td>${s.tutor ? esc(listName(s.tutor)) : '<span class="dash">sense tutor</span>'}</td></tr>`).join('')}</tbody>
      </table>` : '<p class="empty">Sense resultats.</p>') : '<p class="empty">Encara no has buscat cap alumne.</p>', { meta: search ? String(search.length) : '' })}
    </div>`;
  document.getElementById('search').onsubmit = (event) => {
    event.preventDefault();
    ui.searchQuery = document.getElementById('q').value.trim();
    act(() => {});
  };
}

function renderTeacherProfile(data) {
  app.innerHTML = `<div class="column narrow">
    ${titleRow('Les meues dades', "L'alumnat veu el teu nom i el teu departament quan ordena el professorat.")}
    <section class="panel"><form id="profile">${profileFields(data)}</form></section>
  </div>`;
  bindProfile();
}

// --- Administración ---

const STATUS_LABEL = {
  sin_convocatoria: '—',
  por_contestar: 'Sense contestar',
  sin_respuesta: 'No va contestar',
  en_proceso: "A l'espera",
  agotada: 'Rebutjat per tota la llista',
  asignado: 'Confirmat',
};

// Un tono en tres intensidades. El cuadrado, además, cambia de forma: lleno, tenue y vacío.
const SEGMENTS = [
  { key: 'confirmed', label: 'Confirmats', stroke: 'var(--hue)' },
  { key: 'waiting', label: "A l'espera", stroke: 'var(--hue-pale)' },
  { key: 'unanswered', label: 'Sense contestar', stroke: 'var(--empty)' },
];
const segmentOf = (student) => {
  if (student.status === 'asignado') return 'confirmed';
  return student.status === 'en_proceso' || student.status === 'agotada' ? 'waiting' : 'unanswered';
};
const unit = (key) => `<i class="u ${key}"></i>`;

const stateTag = (status) => (status === 'sin_convocatoria'
  ? DASH
  : `<span class="state${status === 'agotada' || status === 'sin_respuesta' ? ' alert' : ''}">${unit(segmentOf({ status }))}${esc(STATUS_LABEL[status])}</span>`);

function donut(stats) {
  const radius = 88;
  const circumference = 2 * Math.PI * radius;
  const visible = SEGMENTS.filter((s) => stats[s.key] > 0);
  const gap = visible.length > 1 ? 3 : 0;
  let start = 0;
  const arcs = visible.map((s) => {
    const length = (stats[s.key] / stats.students) * circumference;
    const dash = Math.max(length - gap, 1);
    const arc = `<circle cx="100" cy="100" r="${radius}" fill="none" stroke="${s.stroke}" stroke-width="12"
      stroke-dasharray="${dash} ${circumference - dash}" stroke-dashoffset="${-start}"
      transform="rotate(-90 100 100)"><title>${esc(s.label)}: ${stats[s.key]}</title></circle>`;
    start += length;
    return arc;
  }).join('');
  const voted = stats.confirmed + stats.waiting;
  return `
    <svg class="donut" viewBox="0 0 200 200" role="img"
      aria-label="${voted} de ${stats.students} han votat. ${SEGMENTS.map((s) => `${esc(s.label)}: ${stats[s.key]}`).join('. ')}">
      ${stats.students ? arcs : `<circle cx="100" cy="100" r="${radius}" fill="none" stroke="var(--empty)" stroke-width="12"/>`}
      <text x="100" y="106" font-size="38" font-weight="500">${voted}<tspan class="of" font-size="22" font-weight="400">/${stats.students}</tspan></text>
      <text x="100" y="130" font-size="16" class="of">han votat</text>
    </svg>`;
}

const legend = (stats) => `<ul class="legend">
  ${SEGMENTS.map((s) => `<li>${unit(s.key)}<span>${esc(s.label)}</span><span class="value">${stats[s.key]}</span></li>`).join('')}
</ul>`;

function classGroups(students) {
  const groups = [];
  for (const curso of [1, 2, 3, 4]) {
    for (const grupo of ['A', 'B']) {
      groups.push({ key: `${curso}${grupo}`, label: `${ORDINAL[curso]} ${grupo}`, students: students.filter((s) => s.curso === curso && s.grupo === grupo) });
    }
  }
  const unknown = students.filter((s) => !s.curso);
  if (unknown.length) groups.push({ key: 'none', label: 'Sense classe', students: unknown });
  return groups;
}

// Cens per classe: un cuadrado por alumno, de confirmado a sin contestar.
function classBars(students, teacherName) {
  return classGroups(students).map((group) => {
    const counts = Object.fromEntries(SEGMENTS.map((s) => [s.key, group.students.filter((st) => segmentOf(st) === s.key).length]));
    const voted = counts.confirmed + counts.waiting;
    const summary = SEGMENTS.map((s) => `${s.label}: ${counts[s.key]}`).join(' · ');
    const open = ui.classKey === group.key;
    return `
      <button class="bar-row" type="button" data-class="${group.key}" aria-expanded="${open}" title="${esc(summary)}"
        aria-label="${esc(group.label)}: ${voted} de ${group.students.length} han votat. ${esc(summary)}">
        <span class="class-name">${esc(group.label)}</span>
        <span class="units">${group.students.length
          ? SEGMENTS.map((s) => unit(s.key).repeat(counts[s.key])).join('')
          : '<span class="dash">Sense alumnat</span>'}</span>
        <span class="bar-count">${voted}<small>/${group.students.length}</small></span>
      </button>
      ${open ? `<div class="class-detail">${group.students.length ? `<table class="stack-table">
        <thead><tr><th><span class="col">Alumne</span></th><th><span class="col">Estat</span></th><th><span class="col">Tutor</span></th></tr></thead>
        <tbody>${group.students.map((s) => `<tr><td class="person">${esc(listName(s))}</td><td>${stateTag(s.status)}</td><td>${s.tutorId ? esc(teacherName(s.tutorId)) : DASH}</td></tr>`).join('')}</tbody>
      </table>` : '<p class="empty">Sense alumnat.</p>'}</div>` : ''}`;
  }).join('');
}

const accountActions = (user, role, data) => {
  const self = user.id === data.me;
  return `<td class="ctl"><select class="compact" data-role="${user.id}" aria-label="Nivell de ${esc(listName(user))}" ${self ? 'disabled title="No pots canviar el teu propi nivell"' : ''}>
      ${Object.entries(ROLE_LABEL).map(([value, label]) => `<option value="${value}" ${role === value ? 'selected' : ''}>${label}</option>`).join('')}
    </select></td>
    <td class="end inline">${self ? '' : `<button type="button" class="btn quiet" data-delete="${user.id}">Eliminar</button>`}</td>`;
};

function previewDialog(teacher) {
  return `<dialog id="preview">
    <div class="dialog-head">${chip(teacher)}<h2>${esc(listName(teacher))}</h2></div>
    <dl class="facts">
      <div><dt>Departament</dt><dd>${teacher.department ? esc(teacher.department) : '<span class="dash">sense definir</span>'}</dd></div>
      <div><dt>${LLOC}</dt><dd>${teacher.meeting_place ? esc(teacher.meeting_place) : '<span class="dash">sense definir</span>'}</dd></div>
    </dl>
    <div class="dialog-actions">${composeAll(teacher.students)}<button type="button" class="btn primary" id="closePreview">Tancar</button></div>
    <h3>Alumnes tutoritzats: ${teacher.students.length}</h3>
    ${teacher.students.length ? `<table class="stack-table">${tutoredRows(teacher.students)}</table>` : '<p class="empty">Encara no té alumnes.</p>'}
  </dialog>`;
}

const panel = (key, title, body, { meta = '' } = {}) => `<details class="panel" data-panel="${key}" ${ui.closedPanels.has(key) ? '' : 'open'}>
  <summary><h2>${esc(title)}${meta ? ` <span class="panel-meta">${esc(meta)}</span>` : ''}</h2></summary>
  <div class="panel-body">${body}</div>
</details>`;

// --- Pas de curs: solo se marcan las anomalías; el resto sube al confirmar. ---

function promotionOptions(student) {
  const noClass = !student.curso;
  const promoteLabel = noClass ? 'Es queda igual' : student.curso === 4 ? "Promociona i ix de l'institut" : 'Promociona';
  const options = [['', promoteLabel], ...(noClass ? [] : [['no_promociona', 'No promociona']]), ['baixa', 'Es dona de baixa']];
  return options.map(([value, label]) => `<option value="${value}" ${(student.promotionMark ?? '') === value ? 'selected' : ''}>${esc(label)}</option>`).join('');
}

function promotionClass(group) {
  const anomalies = group.students.filter((s) => s.promotionMark).length;
  return `<details class="subpanel" data-promotion-class="${group.key}" ${ui.promotionClasses.has(group.key) ? 'open' : ''}>
    <summary>${esc(group.label)} <span class="panel-meta">${plural(group.students.length, 'alumne', 'alumnes')}</span>${anomalies ? `<span class="pill anomalies">${plural(anomalies, 'anomalia', 'anomalies')}</span>` : ''}</summary>
    ${group.students.length ? `<div><table>
      <tbody>${group.students.map((s) => `<tr class="${s.promotionMark ? 'marked' : ''}">
        <td class="person">${esc(listName(s))}</td>
        <td class="end"><select class="compact" data-mark="${s.id}" aria-label="Pas de curs de ${esc(listName(s))}">${promotionOptions(s)}</select></td>
      </tr>`).join('')}</tbody>
    </table></div>` : '<p class="lead">Sense alumnat.</p>'}
  </details>`;
}

// Las cifras del resumen salen de las mismas filas que se muestran y suman el total.
function promotionTotals(students) {
  const marked = (mark) => students.filter((s) => s.promotionMark === mark).length;
  const unmarked = students.filter((s) => !s.promotionMark);
  const totals = {
    promoted: unmarked.filter((s) => s.curso && s.curso < 4).length,
    kept: marked('no_promociona'),
    withdrawn: marked('baixa'),
    graduating: unmarked.filter((s) => s.curso === 4).length,
    noClass: unmarked.filter((s) => !s.curso).length,
  };
  console.assert(Object.values(totals).reduce((a, b) => a + b, 0) === students.length, 'El resum del pas de curs no quadra.');
  return totals;
}

function promotionView(data) {
  let body;
  let sub = '';
  if (ui.promotionResult && data.promotion === 'hecho') {
    const r = ui.promotionResult;
    body = `<p class="msg-ok">Pas de curs fet: ${plural(r.promoted, 'alumne puja', 'alumnes pugen')}, ${plural(r.kept, 'no promociona', 'no promocionen')} i ${plural(r.withdrawn + r.graduated, 'compte eliminat', 'comptes eliminats')}.</p>`;
  } else if (data.promotion === 'sin_eleccion') {
    body = '<p class="empty">Encara no hi ha eleccions.</p>';
  } else if (data.promotion === 'abierta') {
    body = '<p class="empty">Es podrà fer quan es tanquen les eleccions.</p>';
  } else if (data.promotion === 'hecho') {
    body = "<p class=\"empty\">Ja s'ha fet per a estes eleccions. Es podrà tornar a fer quan es tanquen les pròximes.</p>";
  }
  if (body) return `${titleRow('Pas de curs')}<div class="column narrow" style="margin-inline:0"><section class="panel">${body}</section></div>`;

  sub = "Marca només les anomalies. Tota la resta de l'alumnat pujarà 1 curs quan ho confirmes.";
  const t = promotionTotals(data.students);
  const deleted = t.withdrawn + t.graduating;
  return `${titleRow('Pas de curs', sub)}
    <div class="split">
      ${panel('pas-de-curs', 'Classes', classGroups(data.students).map(promotionClass).join(''))}
      <div class="stack rail-sticky">
        ${card('Què passarà', `<ul class="ledger">
          <li><span>Pugen 1 curs</span><span class="value">${t.promoted}</span></li>
          <li><span>No promocionen</span><span class="value">${t.kept}</span></li>
          <li><span>Es donen de baixa</span><span class="value">${t.withdrawn}</span></li>
          <li><span>Acaben 4t i ixen de l'institut</span><span class="value">${t.graduating}</span></li>
          ${t.noClass ? `<li><span>Sense classe, es queden igual</span><span class="value">${t.noClass}</span></li>` : ''}
          <li><span class="total">Total</span><span class="total">${data.students.length}</span></li>
        </ul>
        ${deleted ? `<p class="warn-line">${deleted === 1 ? "S'eliminarà 1 compte." : `S'eliminaran ${deleted} comptes.`}</p>` : ''}
        <button type="button" id="reviewPromotion" class="btn primary" style="width:100%;margin-top:16px">Revisar i confirmar</button>`)}
      </div>
    </div>`;
}

function promotionDialog(data) {
  const withMark = (mark) => data.students.filter((s) => s.promotionMark === mark);
  const list = (title, students) => (students.length ? `<h3>${esc(title)}: ${students.length}</h3>
    <ul>${students.map((s) => `<li>${esc(listName(s))} <span class="dash">· ${esc(classLabel(s))}</span></li>`).join('')}</ul>` : '');
  const kept = withMark('no_promociona');
  const withdrawn = withMark('baixa');
  const graduating = data.students.filter((s) => s.curso === 4 && !s.promotionMark).length;
  const noClass = data.students.filter((s) => !s.curso && !s.promotionMark).length;
  const deleted = graduating + withdrawn.length;
  return `<dialog id="promotionReview">
    <h2>Confirmar el pas de curs</h2>
    ${kept.length || withdrawn.length
      ? list('No promocionen', kept) + list('Es donen de baixa', withdrawn)
      : '<p class="lead">Sense anomalies.</p>'}
    <p><strong>Una vegada confirmat, tot l'alumnat menys esta llista pujarà 1 curs.</strong></p>
    ${graduating ? `<p>${plural(graduating, "alumne de 4t acaba i ix de l'institut", "alumnes de 4t acaben i ixen de l'institut")}.</p>` : ''}
    ${noClass ? `<p>${plural(noClass, 'alumne sense classe es queda igual', 'alumnes sense classe es queden igual')}.</p>` : ''}
    ${deleted ? `<p class="warn-line">${deleted === 1 ? "S'eliminarà definitivament 1 compte. No es podrà recuperar." : `S'eliminaran definitivament ${deleted} comptes. No es podran recuperar.`}</p>` : ''}
    <div class="dialog-actions">
      <button type="button" class="btn outline" id="cancelPromotion">Tornar</button>
      <button type="button" class="btn primary" id="confirmPromotion">Confirmar</button>
    </div>
  </dialog>`;
}

// La frase bajo el título: lo que más necesita atención ahora mismo.
function electionFinding({ election, open, stats }, unassigned) {
  if (!election) return "Encara no s'han convocat eleccions.";
  if (open) {
    if (!stats.students) return 'Encara no ha entrat cap alumne.';
    if (stats.unanswered) return `<strong>${stats.unanswered === 1 ? 'Falta 1 alumne' : `Falten ${stats.unanswered} alumnes`} per votar.</strong> Les eleccions no es poden tancar fins que voten.`;
    return "<strong>Ja ha votat tot l'alumnat.</strong> Ja es poden tancar les eleccions.";
  }
  return unassigned.length
    ? `<strong>Tancades, amb ${plural(unassigned.length, 'alumne', 'alumnes')} sense tutor.</strong>`
    : "<strong>Tancades.</strong> Tot l'alumnat té tutor.";
}

const convokeForm = () => `<form id="open" class="convoke">
  <input id="title" required maxlength="100" aria-label="Títol de les eleccions" placeholder="Títol, ex.: Curs 2026-27">
  <button class="btn primary">Convocar eleccions</button>
</form>`;

const excelButton = (label = 'Descarregar Excel') => `<a class="btn outline" href="/api/admin/informe.xlsx" title="Informe complet en Excel: resum, alumnat, professorat i alumnat per tutor">${icon('download')}${esc(label)}</a>`;

function electionsView(data, unassigned, teacherName) {
  const { election, open, stats, canClose } = data;
  const heading = election
    ? `${esc(election.title)} <span class="pill">${open ? 'Obertes' : 'Tancades'}</span>`
    : 'Eleccions';
  const pdf = '<a class="btn outline" href="/api/admin/informe.pdf" title="Descarregar el cartell en PDF amb tutors, alumnes i llocs de reunió">Descarregar cartell</a>';
  const actions = !election ? ''
    : open ? `${pdf}${excelButton()}<button id="close" type="button" class="btn primary" ${canClose ? '' : 'disabled'}>Tancar les eleccions</button>`
      : `${pdf}${excelButton()}${convokeForm()}`;
  if (!election) {
    return `${titleRow(heading, electionFinding(data, unassigned))}
      <div class="column narrow" style="margin-inline:0">${card('Convocar les primeres eleccions', convokeForm())}</div>`;
  }
  // Primero quienes ya no recibirán solicitudes: son los que necesitan a administración.
  const urgency = { agotada: 0, sin_respuesta: 1 };
  const nextUp = [...unassigned].sort((a, b) => (urgency[a.status] ?? 2) - (urgency[b.status] ?? 2)).slice(0, 3);
  return `${titleRow(heading, electionFinding(data, unassigned), actions)}
    <div class="split">
      ${panel('cens', 'Cens per classe', `
        <ul class="key">${SEGMENTS.map((s) => `<li>${unit(s.key)}${esc(s.label)}</li>`).join('')}</ul>
        <div class="census">${classBars(data.students, teacherName)}</div>`)}
      <div class="stack">
        ${panel('participacio', 'Participació', `
          <div class="ring-block">${donut(stats)}${legend(stats)}</div>
          <p class="panel-note">Compta l'alumnat que ha iniciat sessió o que s'ha importat.</p>`)}
        <div class="grow-last" style="display:contents">
        ${panel('sense-tutor', 'Sense tutor', nextUp.length ? `
          <ul class="rows">${nextUp.map((s) => `<li><div class="grow">${esc(listName(s))}<span class="sub">${esc(classLabel(s))}</span></div>${stateTag(s.status)}</li>`).join('')}</ul>
          <a class="link-more" href="#sense-tutor">Vore'ls tots i assignar tutor</a>` : '<p class="empty">Cap alumne sense tutor.</p>', { meta: String(unassigned.length) })}
        </div>
      </div>
    </div>`;
}

function unassignedView(data, unassigned) {
  const { election } = data;
  const teacherOptions = (ids) => `<option value="">— Professor —</option>` +
    data.teachers.filter((t) => ids.includes(t.id)).map((t) => `<option value="${t.id}">${esc(listName(t))}</option>`).join('');
  if (!election) return `${titleRow('Alumnat sense tutor')}<div class="column narrow" style="margin-inline:0"><section class="panel"><p class="empty">Encara no s'han convocat eleccions.</p></section></div>`;
  return `${titleRow('Alumnat sense tutor', unassigned.length ? plural(unassigned.length, 'alumne sense tutor.', 'alumnes sense tutor.') : '')}
    ${panel('sense-tutor-llista', 'Assignar tutor', unassigned.length ? `${filterBar('sense-tutor', [CLASS_FILTER, STATUS_FILTER])}<table class="stack-table">
      <thead class="sticky"><tr><th><span class="col">Alumne</span></th><th><span class="col">Classe</span></th><th><span class="col">Estat</span></th><th><span class="col">Assignar</span></th></tr></thead>
      <tbody>${unassigned.map((s) => `<tr ${rowAttrs('sense-tutor', `${listName(s)} ${s.username}`, studentFilterFields(s))}>
        <td class="person">${esc(listName(s))}</td><td>${esc(classLabel(s))}</td><td>${stateTag(s.status)}</td>
        <td class="end"><div class="cell-actions"><select class="compact" id="assign-${s.id}" aria-label="Tutor de ${esc(listName(s))}">${teacherOptions(s.allowedTeacherIds)}</select>
          <button type="button" class="btn outline" data-assign="${s.id}">Assignar</button></div></td>
      </tr>`).join('')}</tbody>
    </table>${noMatches('sense-tutor')}` : '<p class="empty">Cap alumne sense tutor.</p>')}`;
}

// Filtros comunes del alumnado.
const CLASS_FILTER = { name: 'classe', label: 'Classe', options: [1, 2, 3, 4].flatMap((c) => ['A', 'B'].map((g) => [`${c}${g}`, `${ORDINAL[c]} ${g}`])).concat([['none', 'Sense classe']]) };
const STATUS_FILTER = { name: 'estat', label: 'Estat', options: [['asignado', 'Confirmat'], ['en_proceso', "A l'espera"], ['agotada', 'Rebutjat per tota la llista'], ['por_contestar', 'Sense contestar'], ['sin_respuesta', 'No va contestar']] };
const studentFilterFields = (s) => ({ classe: s.curso ? `${s.curso}${s.grupo}` : 'none', estat: s.status, tutor: s.tutorId ?? 'none' });

function importPanel() {
  const preview = ui.importPreview;
  const result = ui.importResult;
  let body = `<p class="lead" style="margin-bottom:12px">Puja un Excel (.xlsx) o un CSV amb les columnes <strong>Correu, Nom, Cognoms, Curs i Grup</strong>. També val una columna «Classe» amb valors com «2n B». Si l'alumne ja existix, s'actualitzen les seues dades.</p>
    <div class="import-actions">
      <label class="file-pick">${icon('upload')}<span id="importFileName">Tria un arxiu…</span><input type="file" id="importFile" accept=".xlsx,.csv,text/csv"></label>
      <button type="button" class="btn primary" id="importCheck" disabled>Revisar</button>
      <a class="btn quiet" href="/api/admin/plantilla.xlsx">${icon('download')}Plantilla d'Excel</a>
    </div>`;
  if (result) {
    body += `<p class="msg-ok" style="margin-top:12px">Importació feta: ${plural(result.created, 'alumne nou', 'alumnes nous')} i ${plural(result.updated, 'actualitzat', 'actualitzats')}${result.skipped ? `, ${result.skipped} descartats` : ''}.</p>`;
  }
  if (preview) {
    const count = (action) => preview.rows.filter((r) => r.action === action).length;
    const valid = preview.rows.filter((r) => r.action !== 'error');
    const tag = { nou: '<span class="pill pill-new">Nou</span>', actualitza: '<span class="pill pill-update">Actualitza</span>', error: '<span class="pill pill-error">Error</span>' };
    body += `<div class="import-preview">
      <div class="import-summary">
        <span class="pill pill-new">${plural(count('nou'), 'nou', 'nous')}</span>
        <span class="pill pill-update">${plural(count('actualitza'), 'a actualitzar', 'a actualitzar')}</span>
        ${count('error') ? `<span class="pill pill-error">${plural(count('error'), 'error', 'errors')}</span>` : ''}
      </div>
      <div class="import-table"><table class="stack-table">
        <thead><tr><th><span class="col">Fila</span></th><th><span class="col">Alumne</span></th><th><span class="col">Classe</span></th><th><span class="col">Resultat</span></th></tr></thead>
        <tbody>${preview.rows.map((r) => `<tr class="${r.action === 'error' ? 'row-error' : ''}">
          <td data-label="Fila">${r.line}</td>
          <td class="person">${esc([r.lastName, r.firstName].filter(Boolean).join(', ') || '—')}<span class="sub">${esc(r.username)}</span></td>
          <td>${r.curso && r.grupo ? esc(`${ORDINAL[r.curso]} ${r.grupo}`) : DASH}</td>
          <td>${tag[r.action]}${r.error ? `<span class="sub">${esc(r.error)}</span>` : ''}</td></tr>`).join('')}</tbody>
      </table></div>
      <div class="form-actions">
        <button type="button" class="btn primary" id="importConfirm" ${valid.length ? '' : 'disabled'}>Importar ${plural(valid.length, 'alumne', 'alumnes')}</button>
        <button type="button" class="btn quiet" id="importCancel">Cancel·lar</button>
      </div>
      ${count('error') ? '<p class="panel-note">Les files amb error no s\'importaran.</p>' : ''}
    </div>`;
  }
  return panel('importar', 'Importar alumnat des d\'Excel', body);
}

function studentsView(data, teacherName) {
  const { election, open } = data;
  const teacherOptions = `<option value="">— Professor —</option>` + data.teachers.map((t) => `<option value="${t.id}">${esc(listName(t))}</option>`).join('');
  const tutorFilter = { name: 'tutor', label: 'Tutor', options: [['none', 'Sense tutor'], ...data.teachers.map((t) => [String(t.id), listName(t)])] };
  const table = panel('alumnat', 'Comptes d\'alumnat', data.students.length ? `${filterBar('alumnat', [CLASS_FILTER, STATUS_FILTER, tutorFilter])}<table class="stack-table">
    <thead class="sticky"><tr><th><span class="col">Alumne</span></th><th><span class="col">Classe</span></th><th><span class="col">Tutor</span></th><th><span class="col">Resposta</span></th><th><span class="col">Nivell</span></th><th></th></tr></thead>
    <tbody>${data.students.map((s) => `<tr ${rowAttrs('alumnat', `${listName(s)} ${s.username}`, studentFilterFields(s))}>
      <td class="person">${esc(listName(s))}<span class="sub">${esc(emailOf(s))}</span></td>
      <td>${esc(classLabel(s))}</td>
      <td>${s.tutorId ? `<span class="who-cell">${chip(data.teachers.find((t) => t.id === s.tutorId))}${esc(teacherName(s.tutorId))}</span>` : '<span class="dash">sense tutor</span>'}</td>
      <td class="ctl">${open && s.hasBallot ? `<button type="button" class="btn quiet" data-clear-answer="${s.id}">Esborrar</button>` : ''}</td>
      ${accountActions(s, 'alumno', data)}</tr>`).join('')}</tbody>
  </table>${noMatches('alumnat')}` : '<p class="empty">Encara no hi ha alumnat. Importa\'l des d\'Excel o espera que inicie sessió.</p>', { meta: String(data.students.length) });
  const title = titleRow('Alumnat', "L'alumnat es dona d'alta sol la primera vegada que inicia sessió, o el pots importar des d'Excel.", excelButton());
  if (!(election && !open)) return `${title}<div class="stack">${importPanel()}${table}</div>`;
  return `${title}<div class="stack">
    ${importPanel()}
    ${panel('alumne-nou', 'Alumne nou a mitjan curs', `
      <p class="lead" style="margin-bottom:12px">Crea el compte i assigna-li tutor directament, sense confirmació.</p>
      <form id="newStudent" class="form-strip new-student">
        ${emailField('nsUser', 'Correu')}
        <div class="field"><label for="nsFirst">Nom</label><input id="nsFirst" required maxlength="60"></div>
        <div class="field"><label for="nsLast">Cognoms</label><input id="nsLast" required maxlength="100"></div>
        <div class="field"><label for="nsCurso">Curs</label><select id="nsCurso" required><option value="">—</option>${[1, 2, 3, 4].map((n) => `<option value="${n}">${ORDINAL[n]}</option>`).join('')}</select></div>
        <div class="field"><label for="nsGrupo">Grup</label><select id="nsGrupo" required><option value="">—</option><option>A</option><option>B</option></select></div>
        <div class="field"><label for="nsTutor">Tutor</label><select id="nsTutor" required>${teacherOptions}</select></div>
        <button class="btn primary">Crear i assignar</button>
      </form>`)}
    ${table}
  </div>`;
}

const createAccountPanel = (defaultRole, strip = false) => panel('alta', "Donar d'alta un compte", `
  <p class="lead" style="margin-bottom:12px">El professorat indicarà el seu nom i departament quan inicie sessió.</p>
  <form id="create" class="${strip ? 'form-strip new-account' : ''}">
    ${emailField('newUser', 'Correu')}
    <div class="field"><label for="newRole">Nivell</label>
    <select id="newRole">
      <option value="profesor" ${defaultRole === 'profesor' ? 'selected' : ''}>Professor</option>
      <option value="admin" ${defaultRole === 'admin' ? 'selected' : ''}>Administrador</option>
    </select></div>
    <button class="btn primary">Donar d'alta</button>
  </form>`);

// Ocupación: «3 / 6» con una barra; sin límite, solo el número.
const loadMeter = (count, limit) => (limit
  ? `<span class="load ${count >= limit ? 'full' : ''}" title="${count} de ${limit} places"><span class="load-bar"><i style="width:${Math.min(100, Math.round((count / limit) * 100))}%"></i></span><span>${count}/${limit}</span></span>`
  : `<span class="load"><span>${count}</span></span>`);

const placesOf = (t) => (t.limit === null ? 'sense-limit' : t.students.length >= t.limit ? 'ple' : 'amb-places');

function limitPanel(data) {
  return panel('limit', "Límit d'alumnes per professor", `
    <p class="lead" style="margin-bottom:12px">Quan un professor arriba al límit, les sol·licituds noves passen soles a la següent preferència de l'alumne. Es pot canviar per a cada professor en la llista.</p>
    <form id="limitForm" class="joined limit-form">
      <input id="limitDefault" type="number" min="1" max="500" inputmode="numeric" placeholder="Sense límit" aria-label="Límit general d'alumnes" value="${data.defaultLimit ?? ''}">
      <button class="btn outline">Guardar</button>
    </form>
    ${ui.limitSaved ? '<p class="msg-ok">Límit guardat.</p>' : ''}`);
}

function teachersView(data) {
  const departments = [...new Set(data.teachers.map((t) => t.department).filter(Boolean))].sort();
  const filters = [
    { name: 'dept', label: 'Departament', options: departments.map((d) => [d, d]) },
    { name: 'places', label: 'Places', options: [['amb-places', 'Amb places'], ['ple', 'Ple'], ['sense-limit', 'Sense límit']] },
  ];
  return `${titleRow('Professorat', '', excelButton())}
    <div class="stack">
      <div class="split even">${createAccountPanel('profesor')}${limitPanel(data)}</div>
      ${panel('professorat', 'Comptes de professorat', data.teachers.length ? `${filterBar('professorat', filters, 'Buscar professor')}<table class="stack-table">
        <thead class="sticky"><tr><th><span class="col">Professor</span></th><th><span class="col">Departament</span></th><th><span class="col">Tutor de grup</span></th><th><span class="col">Alumnes</span></th><th><span class="col">Límit</span></th><th><span class="col">Nivell</span></th><th></th></tr></thead>
        <tbody>${data.teachers.map((t) => `<tr ${rowAttrs('professorat', `${listName(t)} ${t.username} ${t.department ?? ''}`, { dept: t.department ?? '', places: placesOf(t) })}>
          <td class="person"><span class="who-cell">${chip(t)}<button type="button" class="link" data-preview="${t.id}">${esc(listName(t))}</button></span></td>
          <td>${t.department ? esc(t.department) : DASH}</td>
          <td data-label="Tutor de grup">${t.tutor_group ? esc(groupLabel(t.tutor_group)) : DASH}</td>
          <td data-label="Alumnes">${loadMeter(t.students.length, t.limit)}</td>
          <td class="ctl" data-label="Límit"><input class="compact limit-input" type="number" min="1" max="500" inputmode="numeric" data-limit="${t.id}" value="${t.max_students ?? ''}" placeholder="${data.defaultLimit ?? '∞'}" aria-label="Límit de ${esc(listName(t))}" title="Buit: el límit general"></td>
          ${accountActions(t, 'profesor', data)}</tr>`).join('')}</tbody>
      </table>${noMatches('professorat')}` : "<p class=\"empty\">Encara no hi ha professorat. Dona'n d'alta un per a poder convocar eleccions.</p>", { meta: String(data.teachers.length) })}
    </div>`;
}

// --- Estadístiques ---

const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);

function statsView(data) {
  const { stats, election } = data;
  const voted = stats.confirmed + stats.waiting;
  const kpi = (label, value, note = '', tone = '') => `<div class="kpi ${tone}"><span class="kpi-label">${esc(label)}</span><span class="kpi-value">${value}</span>${note ? `<span class="kpi-note">${note}</span>` : ''}</div>`;
  if (!election) return `${titleRow('Estadístiques')}<section class="panel"><p class="empty">Encara no s'han convocat eleccions.</p></section>`;

  const classes = classGroups(data.students).filter((g) => g.students.length);
  const classBarsHtml = classes.map((g) => {
    const c = Object.fromEntries(SEGMENTS.map((s) => [s.key, g.students.filter((st) => segmentOf(st) === s.key).length]));
    const total = g.students.length;
    return `<div class="hbar-row"><span class="hbar-label">${esc(g.label)}</span>
      <span class="hbar stacked" title="${SEGMENTS.map((s) => `${s.label}: ${c[s.key]}`).join(' · ')}">${SEGMENTS.map((s) => (c[s.key] ? `<i class="seg ${s.key}" style="width:${(c[s.key] / total) * 100}%"></i>` : '')).join('')}</span>
      <span class="hbar-value">${pct(c.confirmed + c.waiting, total)}%</span></div>`;
  }).join('');

  const maxLoad = Math.max(1, ...data.teachers.map((t) => Math.max(t.students.length + t.pendingCount, t.limit ?? 0)));
  const loadRows = [...data.teachers].sort((a, b) => b.students.length - a.students.length).map((t) => `<div class="hbar-row">
    <span class="hbar-label">${esc(listName(t))}</span>
    <span class="hbar" title="${t.students.length} confirmats · ${t.pendingCount} pendents${t.limit ? ` · límit ${t.limit}` : ''}">
      <i class="seg confirmed" style="width:${(t.students.length / maxLoad) * 100}%"></i><i class="seg waiting" style="width:${(t.pendingCount / maxLoad) * 100}%"></i>
      ${t.limit ? `<b class="limit-mark" style="left:${(t.limit / maxLoad) * 100}%" title="Límit: ${t.limit}"></b>` : ''}
    </span>
    <span class="hbar-value">${t.students.length}${t.limit ? `<small>/${t.limit}</small>` : ''}</span></div>`).join('');

  const maxFirst = Math.max(1, ...data.teachers.map((t) => t.firstChoiceCount));
  const popular = [...data.teachers].filter((t) => t.firstChoiceCount).sort((a, b) => b.firstChoiceCount - a.firstChoiceCount).slice(0, 8);
  const popularRows = popular.map((t) => `<div class="hbar-row"><span class="hbar-label">${esc(listName(t))}</span>
    <span class="hbar"><i class="seg violet" style="width:${(t.firstChoiceCount / maxFirst) * 100}%"></i></span>
    <span class="hbar-value">${t.firstChoiceCount}</span></div>`).join('');

  const byDept = new Map();
  for (const t of data.teachers) {
    const key = t.department || 'Sense departament';
    byDept.set(key, (byDept.get(key) ?? 0) + t.students.length);
  }
  const deptList = [...byDept.entries()].filter(([, n]) => n).sort((a, b) => b[1] - a[1]);
  const maxDept = Math.max(1, ...deptList.map(([, n]) => n));
  const deptRows = deptList.map(([d, n]) => `<div class="hbar-row"><span class="hbar-label">${esc(d)}</span>
    <span class="hbar"><i class="seg teal" style="width:${(n / maxDept) * 100}%"></i></span><span class="hbar-value">${n}</span></div>`).join('');

  const full = data.teachers.filter((t) => t.limit && t.students.length >= t.limit).length;
  const rejected = data.teachers.reduce((n, t) => n + t.rejectedCount, 0);
  const state = kpi('Estat', data.open ? 'Obertes' : 'Tancades', esc(election.title), 'tone-violet');

  return `${titleRow('Estadístiques', esc(election.title), excelButton())}
    <div class="kpis">
      ${kpi('Alumnat', stats.students)}
      ${kpi('Participació', `${pct(voted, stats.students)}%`, `${voted} de ${stats.students} han votat`, 'tone-brand')}
      ${kpi('Confirmats', stats.confirmed, `${pct(stats.confirmed, stats.students)}% del total`, 'tone-good')}
      ${kpi("A l'espera", stats.waiting, '', 'tone-warn')}
      ${kpi('Sense contestar', stats.unanswered)}
      ${state}
    </div>
    <div class="split even stats-grid">
      ${card('Participació per classe', `<ul class="key">${SEGMENTS.map((s) => `<li>${unit(s.key)}${esc(s.label)}</li>`).join('')}</ul>${classBarsHtml || '<p class="empty">Sense alumnat.</p>'}`)}
      ${card('Càrrega del professorat', `<ul class="key"><li>${unit('confirmed')}Confirmats</li><li>${unit('waiting')}Pendents</li><li><b class="limit-key"></b>Límit</li></ul>${loadRows || '<p class="empty">Sense professorat.</p>'}
        <p class="panel-note">${plural(full, 'professor ple', 'professors plens')} · ${plural(rejected, 'sol·licitud rebutjada', 'sol·licituds rebutjades')} en total.</p>`)}
      ${card('Més triats en primer lloc', popularRows || '<p class="empty">Encara no ha votat ningú.</p>')}
      ${card('Alumnat per departament del tutor', deptRows || '<p class="empty">Encara no hi ha tutors confirmats.</p>')}
    </div>`;
}

// --- Historial ---

const ACTION_TONE = (action) => (/eliminat|esborrad|rebutjad|denegat/i.test(action) ? 'tone-alert'
  : /convocad|tancad|pas de curs|importat/i.test(action) ? 'tone-violet'
    : /acceptad|assignat|concedit|alta|tutor/i.test(action) ? 'tone-good' : 'tone-brand');

function historyView() {
  const items = ui.history ?? [];
  const actions = [...new Set(items.map((i) => i.action))].sort();
  return `${titleRow('Historial', 'Qui ha fet què i quan. Es guarden les últimes 1000 accions.')}
    ${panel('historial', 'Accions', items.length ? `${filterBar('historial', [{ name: 'accio', label: 'Acció', options: actions.map((a) => [plainText(a).replace(/\s+/g, '-'), a]) }], 'Buscar per persona o detall')}
      <table class="stack-table history">
        <thead class="sticky"><tr><th><span class="col">Quan</span></th><th><span class="col">Qui</span></th><th><span class="col">Acció</span></th><th><span class="col">Detall</span></th></tr></thead>
        <tbody>${items.map((i) => `<tr ${rowAttrs('historial', `${i.actor_name} ${i.action} ${i.detail}`, { accio: plainText(i.action).replace(/\s+/g, '-') })}>
          <td class="when" data-label="Quan"><time datetime="${new Date(i.at).toISOString()}" title="${esc(fmtShort(i.at))}">${esc(fmtShort(i.at))}</time></td>
          <td class="person">${esc(i.actor_name)}</td>
          <td><span class="pill ${ACTION_TONE(i.action)}">${esc(i.action)}</span></td>
          <td class="detail">${i.detail ? esc(i.detail) : DASH}</td></tr>`).join('')}</tbody>
      </table>${noMatches('historial')}` : '<p class="empty">Encara no hi ha cap acció registrada.</p>', { meta: String(items.length) })}`;
}

function adminsView(data) {
  return `${titleRow('Administradors')}
    <div class="split">
      ${panel('administradors', 'Comptes d\'administració', `<table class="stack-table">
        <thead><tr><th><span class="col">Nom</span></th><th><span class="col">Nivell</span></th><th></th></tr></thead>
        <tbody>${data.admins.map((a) => `<tr><td class="person">${esc(listName(a))}<span class="sub">${esc(emailOf(a))}</span></td>${accountActions(a, 'admin', data)}</tr>`).join('')}</tbody>
      </table>`, { meta: String(data.admins.length) })}
      <div class="stack rail-sticky">${createAccountPanel('admin')}</div>
    </div>`;
}

async function renderAdmin() {
  const data = await api('/api/admin');
  const teacherById = new Map(data.teachers.map((t) => [t.id, t]));
  const teacherName = (id) => listName(teacherById.get(id));
  const unassigned = data.election ? data.students.filter((s) => !s.tutorId) : [];
  const preview = teacherById.get(ui.previewId);
  ui.counts = { unassigned: unassigned.length };
  renderHeader();

  if (route() === 'historial') ui.history = (await api('/api/admin/historial')).items;

  const views = {
    eleccions: () => electionsView(data, unassigned, teacherName),
    estadistiques: () => statsView(data),
    historial: () => historyView(),
    'sense-tutor': () => unassignedView(data, unassigned),
    'pas-de-curs': () => promotionView(data),
    alumnat: () => studentsView(data, teacherName),
    professorat: () => teachersView(data),
    administradors: () => adminsView(data),
  };

  app.innerHTML = `${views[route()]()}
    ${preview ? previewDialog(preview) : ''}
    ${ui.promotionReview && data.promotion === 'disponible' ? promotionDialog(data) : ''}`;

  bindAdmin(data, teacherById);
}

function bindAdmin(data, teacherById) {
  const { election } = data;
  const on = (id, event, handler) => {
    const el = document.getElementById(id);
    if (el) el[event] = handler;
  };

  bindFilters();

  on('limitForm', 'onsubmit', (event) => {
    event.preventDefault();
    act(async () => {
      await api('/api/admin/limit', 'PUT', { value: document.getElementById('limitDefault').value || null });
      ui.limitSaved = true;
    });
  });
  app.querySelectorAll('[data-limit]').forEach((input) => {
    input.onchange = () => act(() => api(`/api/admin/professors/${input.dataset.limit}/limit`, 'PUT', { value: input.value || null }));
  });

  // Importar alumnado
  const file = document.getElementById('importFile');
  if (file) {
    file.onchange = () => {
      document.getElementById('importFileName').textContent = file.files[0]?.name ?? 'Tria un arxiu…';
      document.getElementById('importCheck').disabled = !file.files[0];
    };
    on('importCheck', 'onclick', () => act(async () => {
      const res = await fetch('/api/admin/importar', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file.files[0] });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "No s'ha pogut llegir l'arxiu.");
      ui.importPreview = body;
      ui.importResult = null;
    }));
  }
  on('importCancel', 'onclick', () => {
    ui.importPreview = null;
    act(() => {});
  });
  on('importConfirm', 'onclick', () => act(async () => {
    const rows = ui.importPreview.rows.filter((r) => r.action !== 'error');
    ui.importResult = await api('/api/admin/importar/confirmar', 'POST', { rows });
    ui.importPreview = null;
  }));

  on('close', 'onclick', async () => {
    if (await ask("Tancar les eleccions? L'alumnat ja no podrà contestar.", { confirmLabel: 'Tancar les eleccions' })) act(() => api('/api/admin/terminar', 'POST'));
  });
  on('open', 'onsubmit', async (event) => {
    event.preventDefault();
    const warnings = [];
    if (election) warnings.push('Les assignacions de tutor actuals deixaran de ser vigents.');
    if (data.promotion === 'disponible') warnings.push("Encara no s'ha fet el pas de curs: l'alumnat mantindrà el curs actual i es perdran les anomalies marcades.");
    const title = document.getElementById('title').value;
    if (await ask(`Convocar les eleccions? ${warnings.join(' ')}`, { confirmLabel: 'Convocar eleccions' })) {
      act(() => api('/api/admin/convocar', 'POST', { title }));
    }
  });
  on('create', 'onsubmit', (event) => {
    event.preventDefault();
    act(async () => {
      await api('/api/admin/usuarios', 'POST', {
        username: document.getElementById('newUser').value,
        role: document.getElementById('newRole').value,
      });
      event.target.reset();
    });
  });
  on('newStudent', 'onsubmit', (event) => {
    event.preventDefault();
    act(async () => {
      await api('/api/admin/alumnes', 'POST', {
        username: document.getElementById('nsUser').value,
        firstName: document.getElementById('nsFirst').value,
        lastName: document.getElementById('nsLast').value,
        curso: Number(document.getElementById('nsCurso').value),
        grupo: document.getElementById('nsGrupo').value,
        teacherId: Number(document.getElementById('nsTutor').value),
      });
      event.target.reset();
    });
  });

  app.querySelectorAll('[data-panel]').forEach((details) => {
    details.ontoggle = () => {
      if (!details.isConnected) return; // Un repintado ya sustituyó esta sección.
      if (details.open) ui.closedPanels.delete(details.dataset.panel);
      else ui.closedPanels.add(details.dataset.panel);
      try {
        localStorage.setItem(CLOSED_PANELS_KEY, JSON.stringify([...ui.closedPanels]));
      } catch {
        // Sin almacenamiento solo se pierde al recargar.
      }
    };
  });
  app.querySelectorAll('[data-promotion-class]').forEach((details) => {
    details.ontoggle = () => {
      if (!details.isConnected) return;
      if (details.open) ui.promotionClasses.add(details.dataset.promotionClass);
      else ui.promotionClasses.delete(details.dataset.promotionClass);
    };
  });
  app.querySelectorAll('[data-mark]').forEach((select) => {
    select.onchange = () => act(() => api(`/api/admin/pas-de-curs/${select.dataset.mark}`, 'PUT', { mark: select.value }));
  });
  on('reviewPromotion', 'onclick', () => {
    ui.promotionReview = true;
    act(() => {});
  });
  const review = document.getElementById('promotionReview');
  if (review) {
    review.showModal();
    review.onclose = () => { ui.promotionReview = false; };
    document.getElementById('cancelPromotion').onclick = () => review.close();
    document.getElementById('confirmPromotion').onclick = () => act(async () => {
      ui.promotionResult = await api('/api/admin/pas-de-curs', 'POST');
      ui.promotionReview = false;
    });
  }
  app.querySelectorAll('[data-class]').forEach((btn) => {
    btn.onclick = () => {
      ui.classKey = ui.classKey === btn.dataset.class ? null : btn.dataset.class;
      act(() => {});
    };
  });
  app.querySelectorAll('[data-assign]').forEach((btn) => {
    btn.onclick = () => {
      const teacherId = Number(document.getElementById(`assign-${btn.dataset.assign}`).value);
      if (!teacherId) return ask('Tria un professor.', { alertOnly: true });
      act(() => api('/api/admin/asignar', 'POST', { studentId: Number(btn.dataset.assign), teacherId }));
    };
  });
  app.querySelectorAll('[data-role]').forEach((select) => {
    select.onchange = () => act(() => api(`/api/admin/usuarios/${select.dataset.role}`, 'PATCH', { role: select.value }));
  });
  app.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.onclick = async () => {
      const id = Number(btn.dataset.delete);
      const teacher = teacherById.get(id);
      const person = teacher ?? data.students.find((s) => s.id === id) ?? data.admins.find((a) => a.id === id);
      const extra = teacher?.students.length
        ? ` Els seus ${teacher.students.length} alumnes passaran a la següent preferència o es quedaran sense tutor.`
        : '';
      if (await ask(`Eliminar definitivament el compte de ${listName(person)}?${extra}`, { confirmLabel: 'Eliminar', danger: true })) {
        act(() => api(`/api/admin/usuarios/${id}`, 'DELETE'));
      }
    };
  });
  app.querySelectorAll('[data-clear-answer]').forEach((btn) => {
    btn.onclick = async () => {
      const student = data.students.find((s) => s.id === Number(btn.dataset.clearAnswer));
      if (await ask(`Esborrar la resposta de ${listName(student)}? Haurà de tornar a votar i perdrà el tutor si ja el tenia confirmat.`, { confirmLabel: 'Esborrar', danger: true })) {
        act(() => api(`/api/admin/alumnes/${student.id}/resposta`, 'DELETE'));
      }
    };
  });
  app.querySelectorAll('[data-preview]').forEach((btn) => {
    btn.onclick = () => {
      ui.previewId = Number(btn.dataset.preview);
      act(() => {});
    };
  });

  const dialog = document.getElementById('preview');
  if (dialog) {
    dialog.showModal();
    dialog.onclose = () => { ui.previewId = null; };
    document.getElementById('closePreview').onclick = () => dialog.close();
  }
}

// --- Tiempo real ---

let refreshTimer = null;

async function refreshHeader() {
  const data = await api('/api/me');
  if (!data.user || data.user.role !== me?.role) return location.reload();
  me = data.user;
  renderHeader();
}

function scheduleRefresh() {
  if (dragging) {
    refreshAfterDrag = true;
    return;
  }
  refreshAfterDrag = false;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    try {
      await refreshHeader();
      await rerender();
    } catch {
      // Sin conexión: el siguiente aviso o la reconexión vuelven a intentarlo.
    }
  }, 150);
}

function connectLive() {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${scheme}://${location.host}/ws`);
  let opened = false;
  socket.onopen = () => {
    if (connectLive.connected) scheduleRefresh();
    connectLive.connected = true;
    opened = true;
  };
  socket.onmessage = scheduleRefresh;
  socket.onclose = () => setTimeout(connectLive, opened ? 1000 : 5000);
}

// --- Aviso de cookies ---
// Solo hay cookie de sesión y preferencias locales (técnicas): basta con informar, no hace falta pedir permiso.
const COOKIES_KEY = 'tutoria.avisCookies';
function cookieNotice() {
  try {
    if (localStorage.getItem(COOKIES_KEY)) return;
  } catch { /* sin almacenamiento: se enseña cada vez */ }
  const bar = document.createElement('div');
  bar.className = 'cookie-bar';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Avís de cookies');
  bar.innerHTML = `<p>Fem servir només la cookie necessària per a mantindre't la sessió oberta i guardem algunes preferències en este navegador. No hi ha publicitat ni analítica. <a href="/cookies.html">Més informació</a></p>
    <button type="button" class="btn primary">D'acord</button>`;
  bar.querySelector('button').onclick = () => {
    try { localStorage.setItem(COOKIES_KEY, '1'); } catch { /* res */ }
    bar.remove();
  };
  document.body.append(bar);
}

// --- Arranque ---

window.addEventListener('hashchange', async () => {
  if (!me) return;
  ui.navOpen = false;
  try {
    await view();
    window.scrollTo(0, 0);
  } catch (err) {
    await ask(err.message, { alertOnly: true });
  }
});

cookieNotice();

(async () => {
  const data = await api('/api/me');
  domain = data.domain;
  me = data.user;
  renderHeader();
  if (!me) return renderLogin();
  view = { alumno: renderStudent, profesor: renderTeacher, admin: renderAdmin }[me.role];
  await view();
  connectLive();
})().catch((err) => {
  app.innerHTML = `<p class="msg-error">${esc(err.message)}</p>`;
});
