const $ = (id) => document.getElementById(id);

const CATEGORIES = ['Tops', 'Broeken', 'Jurken & rokken', 'Jassen', 'Schoenen', 'Accessoires', 'Ondergoed & sokken', 'Nachtkleding', 'Sport'];
const CAT_ICON = { Tops: '👕', Broeken: '👖', 'Jurken & rokken': '👗', Jassen: '🧥', Schoenen: '👟', Accessoires: '👜', 'Ondergoed & sokken': '🧦', Nachtkleding: '🌙', Sport: '🏃' };
const COLORS = { zwart: '#1b1b1d', wit: '#f5f5f2', grijs: '#8b8d93', beige: '#d8c7a6', bruin: '#6d4a32', rood: '#c0392b', roze: '#e58fb0', oranje: '#e67e22', geel: '#e9c53a', groen: '#3f8f55', blauw: '#3478c6', marineblauw: '#1f2f58', paars: '#7b4fa8', multi: 'linear-gradient(135deg,#c0392b,#e9c53a,#3f8f55,#3478c6)' };
const SEASONS = ['alle seizoenen', 'zomer', 'winter', 'lente/herfst'];
const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '34', '36', '38', '40', '42', '44', '46', '48', '50', '56', '62', '68', '74', '80', '86', '92', '98', '104', '110', '116', '122', '128', '134', '140', '152', '164', '176'];
const AV_COLORS = ['#c06a3f', '#4f7f95', '#7c6aa8', '#5f8f5a', '#b5527a', '#8a7a3a'];
const LAZY_DAYS = 180;

let items = [];
let session = { members: [], ai: false };
let cur = null; // { item, isNew, pending: [{pid, full, thumb, url}], photos: [pid] }
const F = { q: '', cat: '', color: '', owner: '', season: '', size: '', status: 'kast', sort: 'new', view: 'grid' };

/* ---------- helpers ---------- */
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}
let toastT;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2400);
}
const uid = () => crypto.randomUUID();
const pid = () => [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');
const local = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } };
const lastWorn = (it) => (it.wears.length ? Math.max(...it.wears) : 0);
const daysAgo = (ts) => Math.floor((Date.now() - ts) / 864e5);
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
function agoText(ts) {
  const d = daysAgo(ts);
  return d <= 0 ? 'vandaag' : d === 1 ? 'gisteren' : d < 60 ? `${d} dagen geleden` : `${Math.round(d / 30)} maanden geleden`;
}
const isLazy = (it) => it.status === 'kast' && (it.wears.length ? daysAgo(lastWorn(it)) > LAZY_DAYS : daysAgo(it.created) > LAZY_DAYS);
const swatch = (c) => COLORS[c] || '#9a9a9a';
const money = (n) => '€' + Math.round(n).toLocaleString('nl-NL');
function avatar(name, cls = '') {
  const i = Math.max(0, session.members.indexOf(name));
  const el = h('span', { class: 'av ' + cls, title: name }, (name || '?').slice(0, 1).toUpperCase());
  el.style.setProperty('--av', AV_COLORS[i % AV_COLORS.length]);
  return el;
}

async function api(path, opts = {}) {
  const r = await fetch(path, { credentials: 'same-origin', ...opts });
  if (r.status === 401 && !path.endsWith('/login')) { showLogin(); throw new Error('Niet ingelogd'); }
  if (!r.ok) { let m = r.statusText; try { m = (await r.json()).error || m; } catch { /* geen JSON */ } throw new Error(m); }
  return r.status === 204 ? null : r.json();
}

/* ---------- inloggen ---------- */
function showLogin() { $('app').hidden = true; $('login').hidden = false; $('pw').focus(); }
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault(); $('loginErr').textContent = '';
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ password: $('pw').value }) });
    $('pw').value = ''; await start();
  } catch (err) { $('loginErr').textContent = err.message; }
});
$('logout').addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }).catch(() => {}); items = []; showLogin(); });

async function start() {
  const s = await fetch('/api/session', { credentials: 'same-origin' }).then(r => r.json());
  if (!s.authed) return showLogin();
  session = s;
  $('login').hidden = true; $('app').hidden = false;
  fillStatic();
  $('moreFilters').open = false;
  items = await api('/api/items');
  render();
}

/* ---------- opties vullen ---------- */
const opt = (v, t = v) => h('option', { value: v }, t);
function fillStatic() {
  const me = local('kast.me') && session.members.includes(local('kast.me')) ? local('kast.me') : session.members[0];
  $('me').replaceChildren(...session.members.map(m => opt(m))); $('me').value = me;
  $('fCategory').replaceChildren(opt('', '—'), ...CATEGORIES.map(c => opt(c)));
  $('fColorSel').replaceChildren(opt('', '—'), ...Object.keys(COLORS).map(c => opt(c)));
  $('fSeasonSel').replaceChildren(opt('', '—'), ...SEASONS.map(c => opt(c)));
  $('fOwnerSel').replaceChildren(opt('', '—'), ...session.members.map(c => opt(c)));
  $('sizes').replaceChildren(...SIZES.map(s => opt(s)));
  $('fSeason').replaceChildren(opt('', 'Elk seizoen'), ...SEASONS.map(c => opt(c)));
}
$('me').addEventListener('change', () => local('kast.me', $('me').value));
const meName = () => $('me').value || session.members[0] || '';

/* ---------- overzicht ---------- */
const matchesBase = (it, skip) => {
  const q = F.q.trim().toLowerCase();
  if (skip !== 'status') {
    if (F.status === 'kast' && it.status !== 'kast') return false;
    if (F.status === 'was' && it.status !== 'was') return false;
    if (F.status === 'weg' && it.status !== 'weg') return false;
    if (F.status === 'lazy' && !isLazy(it)) return false;
  }
  if (skip !== 'cat' && F.cat && it.category !== F.cat) return false;
  if (skip !== 'color' && F.color && it.color !== F.color) return false;
  if (skip !== 'owner' && F.owner && it.owner !== F.owner) return false;
  if (F.season && it.season !== F.season) return false;
  if (F.size && it.size !== F.size) return false;
  if (q && !`${it.name} ${it.brand} ${it.color} ${it.category} ${it.material} ${it.location} ${it.notes} ${it.tags.join(' ')}`.toLowerCase().includes(q)) return false;
  return true;
};

function visible() {
  const cmp = {
    new: (a, b) => b.created - a.created,
    name: (a, b) => a.name.localeCompare(b.name, 'nl'),
    least: (a, b) => a.wears.length - b.wears.length || lastWorn(a) - lastWorn(b),
    most: (a, b) => b.wears.length - a.wears.length
  }[F.sort];
  return items.filter(it => matchesBase(it)).sort(cmp);
}

function thumb(it) {
  const box = h('div', { class: 'thumb' });
  box.style.setProperty('--sw', swatch(it.color));
  if (it.photos[0]) box.append(h('img', { src: photoUrl(it.id, it.photos[0], true), alt: '', loading: 'lazy' }));
  else box.append(CAT_ICON[it.category] || '👕');
  return box;
}
const photoUrl = (id, p, thumb) => `/photos/${id}/${p}${thumb ? '.t' : ''}.jpg`;

function card(it) {
  const wornToday = it.wears.length && sameDay(lastWorn(it), Date.now());
  const meta1 = h('div', { class: 'cmeta' }, h('span', { class: 'dot' }), [it.size && 'Maat ' + it.size, it.color].filter(Boolean).join(' · ') || ' ');
  meta1.firstChild.style.setProperty('--sw', swatch(it.color));
  const label = 'Open ' + (it.name || 'kledingstuk');
  return h('article', { class: 'card' },
    h('div', { class: 'media' },
      h('button', { class: 'open thumbbtn', onclick: () => openItem(it), 'aria-label': label }, thumb(it)),
      it.wears.length ? h('span', { class: 'tag worn' }, it.wears.length + '×') : null,
      it.owner ? avatar(it.owner, 'on-card') : null,
      it.status === 'kast' ? h('button', { class: 'quick' + (wornToday ? ' done' : ''), 'aria-label': 'Vandaag gedragen', title: 'Vandaag gedragen', onclick: () => wearToday(it) }, '👕') : null),
    h('button', { class: 'open textbtn', onclick: () => openItem(it), 'aria-label': label },
      h('div', { class: 'cname' }, it.name || 'Zonder naam'),
      meta1,
      h('div', { class: 'cmeta' }, [it.category, it.status === 'was' ? 'in de was' : it.status === 'weg' ? 'weggegeven' : ''].filter(Boolean).join(' · ') || ' ')));
}

async function wearToday(it) {
  if (it.wears.length && sameDay(lastWorn(it), Date.now())) return toast('Vandaag al genoteerd');
  try {
    const saved = await api(`/api/items/${it.id}`, { method: 'PUT', body: JSON.stringify({ ...it, wears: [...it.wears, Date.now()] }) });
    replace(saved); render(); toast(`Genoteerd: ${saved.name} 👕`);
    return saved;
  } catch (e) { toast(e.message); }
}

function render() {
  const base = items.filter(it => it.status === 'kast');
  const lazy = items.filter(isLazy).length;
  const value = base.reduce((s, i) => s + (i.price || 0), 0);

  /* samenvatting */
  const tile = (n, label, on, hot) => h('button', { class: 'tile' + (hot ? ' hot' : ''), onclick: on }, h('b', {}, n), h('span', {}, label));
  $('summary').replaceChildren(
    tile(base.length, 'in de kast', () => { F.status = 'kast'; sync(); }),
    tile(lazy, 'lang niet gedragen', () => { F.status = 'lazy'; sync(); }, lazy > 0),
    tile(value ? money(value) : '—', 'aankoopwaarde', () => {}));

  /* categorieën: alleen wat voorkomt, met aantallen binnen de andere filters */
  const inCat = (c) => items.filter(it => matchesBase(it, 'cat') && it.category === c).length;
  const cats = [...CATEGORIES, ...new Set(items.map(i => i.category).filter(c => c && !CATEGORIES.includes(c)))].filter(c => inCat(c) || F.cat === c);
  const allCount = items.filter(it => matchesBase(it, 'cat')).length;
  $('catRow').replaceChildren(
    h('button', { class: 'cat' + (!F.cat ? ' on' : ''), onclick: () => { F.cat = ''; sync(); } }, h('span', { class: 'ci' }, '✨'), `Alles ${allCount}`),
    ...cats.map(c => h('button', { class: 'cat' + (F.cat === c ? ' on' : ''), onclick: () => { F.cat = F.cat === c ? '' : c; sync(); } }, h('span', { class: 'ci' }, CAT_ICON[c] || '🏷️'), `${c.split(' ')[0]} ${inCat(c)}`)));

  /* kleuren */
  const usedColors = Object.keys(COLORS).filter(c => items.some(it => matchesBase(it, 'color') && it.color === c) || F.color === c);
  $('colorRow').replaceChildren(...usedColors.map(c => {
    const b = h('button', { class: 'sw' + (F.color === c ? ' on' : ''), 'aria-label': c, 'aria-pressed': String(F.color === c), title: c, onclick: () => { F.color = F.color === c ? '' : c; sync(); } });
    b.style.setProperty('--sw', swatch(c)); b.style.background = swatch(c);
    return b;
  }));

  /* personen */
  const owners = session.members.filter(m => items.some(i => i.owner === m));
  $('personRow').replaceChildren(
    h('button', { class: 'pbtn all' + (!F.owner ? ' on' : ''), onclick: () => { F.owner = ''; sync(); } }, 'Iedereen'),
    ...owners.map(m => h('button', { class: 'pbtn' + (F.owner === m ? ' on' : ''), onclick: () => { F.owner = F.owner === m ? '' : m; sync(); } }, avatar(m), m)));

  /* meer filters */
  const sizes = [...new Set(items.map(i => i.size).filter(Boolean))].sort((a, b) => (SIZES.indexOf(a) < 0 ? 999 : SIZES.indexOf(a)) - (SIZES.indexOf(b) < 0 ? 999 : SIZES.indexOf(b)) || a.localeCompare(b));
  const keepSize = F.size;
  $('fSize').replaceChildren(opt('', 'Alle maten'), ...sizes.map(s => opt(s))); $('fSize').value = sizes.includes(keepSize) ? keepSize : '';
  $('fSeason').value = F.season; $('fSort').value = F.sort;
  document.querySelectorAll('#chips button').forEach(b => b.classList.toggle('on', b.dataset.c === F.status));
  const extra = [F.season, F.size, F.status !== 'kast' ? 'x' : ''].filter(Boolean).length;
  $('moreSum').textContent = extra ? `Meer filters (${extra} actief)` : 'Meer filters';

  /* resultaat */
  const list = visible();
  const active = [F.q, F.cat, F.color, F.owner, F.season, F.size].filter(Boolean).length + (F.status !== 'kast' ? 1 : 0);
  $('resultCount').textContent = `${list.length} ${list.length === 1 ? 'stuk' : 'stuks'}`;
  $('clearFilters').hidden = !active;
  document.querySelectorAll('#viewToggle button').forEach(b => b.classList.toggle('on', b.dataset.view === F.view));

  $('grid').hidden = F.view !== 'grid' || !list.length;
  $('shelves').hidden = F.view !== 'shelf' || !list.length;
  $('grid').replaceChildren(...(F.view === 'grid' ? list.map(card) : []));
  if (F.view === 'shelf') {
    const groups = new Map();
    for (const it of list) { const k = it.category || 'Overig'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
    const order = [...CATEGORIES, 'Overig'];
    $('shelves').replaceChildren(...[...groups.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
      .map(([name, arr]) => h('section', { class: 'shelf' }, h('h3', {}, (CAT_ICON[name] || '🏷️') + ' ' + name, h('small', {}, arr.length)), h('div', { class: 'shelfrow' }, arr.map(card)))));
  }

  const empty = $('empty');
  empty.hidden = list.length > 0;
  empty.replaceChildren();
  if (!list.length) {
    if (!items.length) empty.append(h('div', { class: 'big' }, '🧺'), h('h3', {}, 'Je kast is nog leeg'), h('p', {}, 'Tik op + en maak een foto van je eerste kledingstuk.'));
    else empty.append(h('div', { class: 'big' }, '🔍'), h('h3', {}, 'Niets gevonden'), h('p', {}, 'Er is geen kleding met deze filters.'), h('button', { onclick: clearAll }, 'Wis filters'));
  }
  $('stats').textContent = `${items.length} items, ${lazy} lang niet gedragen${value ? `, aankoopwaarde ${money(value)}` : ''}.`;
}
const sync = () => render();
function clearAll() { Object.assign(F, { q: '', cat: '', color: '', owner: '', season: '', size: '', status: 'kast' }); $('search').value = ''; render(); }
$('clearFilters').addEventListener('click', clearAll);
$('search').addEventListener('input', () => { F.q = $('search').value; render(); });
$('fSeason').addEventListener('input', () => { F.season = $('fSeason').value; render(); });
$('fSize').addEventListener('input', () => { F.size = $('fSize').value; render(); });
$('fSort').addEventListener('input', () => { F.sort = $('fSort').value; render(); });
$('chips').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { F.status = b.dataset.c; render(); } });
$('viewToggle').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { F.view = b.dataset.view; local('kast.view', F.view); render(); } });
F.view = local('kast.view') === 'shelf' ? 'shelf' : 'grid';
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
  $('view-kast').hidden = b.dataset.v !== 'kast'; $('view-settings').hidden = b.dataset.v !== 'settings';
  $('add').hidden = b.dataset.v !== 'kast';
}));
window.addEventListener('scroll', () => $('app').hidden || document.querySelector('.bar')?.classList.toggle('stuck', window.scrollY > 90), { passive: true });

/* ---------- foto's verwerken ---------- */
async function bitmap(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { return createImageBitmap(file); }
}
const toBlob = (canvas, q) => new Promise(r => canvas.toBlob(r, 'image/jpeg', q));
async function shrink(bmp, max, q) {
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bmp.width * s)); c.height = Math.max(1, Math.round(bmp.height * s));
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return { blob: await toBlob(c, q), canvas: c };
}

/** Schat de hoofdkleur uit het midden van de foto en vertaalt die naar een van de kleurnamen. */
function guessColor(canvas) {
  const n = 24, c = document.createElement('canvas'); c.width = c.height = n;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const w = canvas.width, hgt = canvas.height;
  ctx.drawImage(canvas, w * 0.25, hgt * 0.25, w * 0.5, hgt * 0.5, 0, 0, n, n);
  const d = ctx.getImageData(0, 0, n, n).data;
  let r = 0, g = 0, b = 0, k = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; k++; }
  r /= k; g /= k; b /= k;
  const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255, l = (mx + mn) / 2, dl = mx - mn;
  const s = dl === 0 ? 0 : dl / (1 - Math.abs(2 * l - 1));
  let hue = 0;
  if (dl) { const M = Math.max(r, g, b) / 255; hue = M === r / 255 ? ((g - b) / 255 / dl) % 6 : M === g / 255 ? (b - r) / 255 / dl + 2 : (r - g) / 255 / dl + 4; hue = (hue * 60 + 360) % 360; }
  if (l < 0.14) return 'zwart';
  if (l > 0.86 && s < 0.25) return 'wit';
  if (s < 0.14) return l < 0.35 ? 'zwart' : 'grijs';
  if (s < 0.35 && l > 0.65 && hue >= 20 && hue < 65) return 'beige';
  if (hue < 14 || hue >= 345) return l < 0.3 ? 'bruin' : 'rood';
  if (hue < 40) return l < 0.42 ? 'bruin' : 'oranje';
  if (hue < 70) return l < 0.35 ? 'bruin' : 'geel';
  if (hue < 170) return 'groen';
  if (hue < 255) return l < 0.3 ? 'marineblauw' : 'blauw';
  if (hue < 290) return 'paars';
  return 'roze';
}

async function addFiles(files) {
  for (const file of files) {
    if (cur.photos.length + cur.pending.length >= 6) { toast('Maximaal 6 foto\'s per kledingstuk'); break; }
    try {
      const bmp = await bitmap(file);
      const full = await shrink(bmp, 1280, 0.82), thumb = await shrink(bmp, 420, 0.8);
      const first = !cur.photos.length && !cur.pending.length;
      cur.pending.push({ pid: pid(), full: full.blob, thumb: thumb.blob, url: URL.createObjectURL(thumb.blob) });
      if (first && !$('fColorSel').value) $('fColorSel').value = guessColor(full.canvas);
      drawPhotos();
      if (first && session.ai) analyzeFirst();
    } catch (e) { toast('Foto kon niet gelezen worden'); console.warn(e); }
  }
}
$('shot').addEventListener('change', async (e) => { const f = [...e.target.files]; e.target.value = ''; await addFiles(f); });
$('pick').addEventListener('change', async (e) => { const f = [...e.target.files]; e.target.value = ''; await addFiles(f); });

function drawPhotos() {
  const strip = $('photos');
  strip.replaceChildren(
    ...cur.photos.map(p => h('div', { class: 'ph' }, h('img', { src: photoUrl(cur.item.id, p, true), alt: '' }),
      h('button', { type: 'button', 'aria-label': 'Foto verwijderen', onclick: () => { cur.photos = cur.photos.filter(x => x !== p); drawPhotos(); } }, '×'))),
    ...cur.pending.map(p => h('div', { class: 'ph' }, h('img', { src: p.url, alt: '' }),
      h('button', { type: 'button', 'aria-label': 'Foto verwijderen', onclick: () => { URL.revokeObjectURL(p.url); cur.pending = cur.pending.filter(x => x !== p); drawPhotos(); } }, '×'))));
  $('aiBtn').hidden = !(session.ai && cur.pending.length);
  $('photoTip').hidden = cur.photos.length + cur.pending.length > 0;
}

/* ---------- AI-herkenning ---------- */
async function analyzeFirst() {
  if (!cur.pending.length) return;
  $('aiMsg').textContent = 'Herkennen…'; $('aiBtn').disabled = true;
  try {
    const r = await api('/api/analyze', { method: 'POST', body: cur.pending[0].full });
    const put = (id, v, force) => { if (v && (force || !$(id).value)) $(id).value = v; };
    put('fName', r.name); put('fCategory', r.category); put('fColorSel', r.color, true); put('fSeasonSel', r.season);
    put('fMaterial', r.material); put('fBrand', r.brand);
    if (r.pattern && r.pattern !== 'effen' && !$('fTags').value.includes(r.pattern)) $('fTags').value = [$('fTags').value, r.pattern].filter(Boolean).join(', ');
    $('aiMsg').textContent = 'Voorgesteld door AI. Controleer en pas aan waar nodig.';
  } catch (e) { $('aiMsg').textContent = 'Herkennen is niet gelukt. Vul zelf in.'; console.warn(e); }
  $('aiBtn').disabled = false;
}
$('aiBtn').addEventListener('click', analyzeFirst);


/* ---------- kledingstuk bekijken en bewerken ---------- */
const dlg = $('dlg');
const showPanel = (name) => { $('viewPanel').hidden = name !== 'view'; $('itemForm').hidden = name !== 'edit'; };
function replace(it) { const i = items.findIndex(x => x.id === it.id); if (i >= 0) items[i] = it; else items.unshift(it); }

function openItem(it) {
  if (!it) return openEdit(null);
  renderView(it);
  if (!dlg.open) dlg.showModal();
}

function renderView(it) {
  const gal = h('div', { class: 'gallery' });
  if (it.photos.length) for (const p of it.photos) gal.append(h('div', { class: 'gph' }, h('img', { src: photoUrl(it.id, p, false), alt: it.name })));
  else { const g = h('div', { class: 'gph' }, CAT_ICON[it.category] || '👕'); g.style.setProperty('--sw', swatch(it.color)); gal.append(g); }

  const dot = h('span', { class: 'dot' }); dot.style.setProperty('--sw', swatch(it.color));
  const facts = h('div', { class: 'facts' },
    it.category ? h('span', { class: 'fact' }, (CAT_ICON[it.category] || '') + ' ' + it.category) : null,
    it.size ? h('span', { class: 'fact' }, 'Maat ' + it.size) : null,
    it.color ? h('span', { class: 'fact' }, dot, it.color) : null,
    it.season ? h('span', { class: 'fact' }, it.season) : null,
    it.owner ? h('span', { class: 'fact' }, avatar(it.owner), it.owner) : null,
    it.status !== 'kast' ? h('span', { class: 'fact' }, it.status === 'was' ? 'In de was' : 'Weggegeven') : null);

  const rows = [['Merk', it.brand], ['Materiaal', it.material], ['Plek', it.location], ['Prijs', it.price != null ? '€' + it.price.toFixed(2).replace('.', ',') : ''],
    ['Gekocht', it.boughtAt ? new Date(it.boughtAt).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' }) : ''], ['Tags', it.tags.join(', ')], ['Notities', it.notes]].filter(r => r[1]);
  const detail = rows.length ? h('dl', { class: 'detail' }, rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])) : null;

  const n = it.wears.length;
  const perWear = it.price && n ? ` · €${(it.price / n).toFixed(2).replace('.', ',')} per keer` : '';
  const wear = h('div', { class: 'wear' },
    h('div', {}, h('b', {}, n + '×'), h('div', { class: 'muted' }, (n ? `laatst ${agoText(lastWorn(it))}` : 'nog niet gedragen') + perWear)),
    it.status === 'kast' ? h('button', { class: 'primary', id: 'wearBtn', onclick: async () => { const s = await wearToday(it); if (s) renderView(s); } }, '👕 Vandaag gedragen') : null);

  $('viewPanel').replaceChildren(gal, h('h2', { class: 'vtitle' }, it.name || 'Zonder naam'), facts, wear, detail,
    h('div', { class: 'row' }, h('button', { id: 'editBtn', onclick: () => openEdit(it) }, '✏️ Bewerken'), h('button', { id: 'viewClose', onclick: () => dlg.close() }, 'Sluiten')));
  showPanel('view');
}

function openEdit(it) {
  const isNew = !it;
  const item = it || { id: uid(), name: '', category: F.cat, color: '', size: '', brand: '', season: '', material: '', location: '', owner: meName(), status: 'kast', price: null, boughtAt: '', tags: [], notes: '', photos: [], wears: [], created: Date.now() };
  cur = { item, isNew, pending: [], photos: [...item.photos] };
  $('formTitle').textContent = isNew ? 'Nieuw kledingstuk' : 'Bewerken';
  $('fName').value = item.name; $('fCategory').value = item.category; $('fColorSel').value = item.color; $('fSizeIn').value = item.size;
  $('fBrand').value = item.brand; $('fSeasonSel').value = item.season; $('fOwnerSel').value = item.owner; $('fMaterial').value = item.material;
  $('fLocation').value = item.location; $('fPrice').value = item.price ?? ''; $('fBought').value = item.boughtAt; $('fTags').value = item.tags.join(', ');
  $('fStatus').value = item.status; $('fNotes').value = item.notes; $('saveErr').textContent = ''; $('aiMsg').textContent = '';
  $('moreDetails').open = !isNew;
  $('delBtn').hidden = isNew;
  drawPhotos(); showPanel('edit');
  if (!dlg.open) dlg.showModal();
}
$('add').addEventListener('click', () => openEdit(null));
$('closeBtn').addEventListener('click', () => { if (cur && !cur.isNew) renderView(cur.item); else dlg.close(); });
dlg.addEventListener('close', () => { for (const p of cur?.pending || []) URL.revokeObjectURL(p.url); cur = null; });

$('itemForm').addEventListener('submit', async (e) => {
  e.preventDefault(); $('saveErr').textContent = '';
  const btn = e.submitter; btn.disabled = true;
  const old = cur.item;
  try {
    for (const p of cur.pending) {
      await api(`/api/items/${old.id}/photos?pid=${p.pid}&kind=full`, { method: 'POST', body: p.full });
      await api(`/api/items/${old.id}/photos?pid=${p.pid}&kind=thumb`, { method: 'POST', body: p.thumb });
    }
    const body = {
      ...old,
      name: $('fName').value.trim(), category: $('fCategory').value, color: $('fColorSel').value, size: $('fSizeIn').value.trim(),
      brand: $('fBrand').value.trim(), season: $('fSeasonSel').value, owner: $('fOwnerSel').value, material: $('fMaterial').value.trim(),
      location: $('fLocation').value.trim(), price: $('fPrice').value === '' ? null : Number($('fPrice').value), boughtAt: $('fBought').value,
      tags: $('fTags').value.split(',').map(t => t.trim()).filter(Boolean), status: $('fStatus').value, notes: $('fNotes').value.trim(),
      photos: [...cur.photos, ...cur.pending.map(p => p.pid)]
    };
    const saved = await api(`/api/items/${old.id}`, { method: 'PUT', body: JSON.stringify(body) });
    replace(saved); render();
    if (cur.isNew) { dlg.close(); toast('Toegevoegd ✓'); } else { cur = null; renderView(saved); toast('Opgeslagen ✓'); }
  } catch (err) { $('saveErr').textContent = 'Opslaan mislukt: ' + err.message; }
  btn.disabled = false;
});
$('delBtn').addEventListener('click', async () => {
  const btn = $('delBtn');
  if (btn.dataset.sure !== '1') { btn.dataset.sure = '1'; btn.textContent = 'Zeker weten?'; setTimeout(() => { btn.dataset.sure = ''; btn.textContent = 'Verwijderen'; }, 3000); return; }
  btn.dataset.sure = ''; btn.textContent = 'Verwijderen';
  try { await api(`/api/items/${cur.item.id}`, { method: 'DELETE' }); items = items.filter(i => i.id !== cur.item.id); dlg.close(); render(); toast('Verwijderd'); }
  catch (e) { $('saveErr').textContent = e.message; }
});

/* ---------- export ---------- */
$('exportCsv').addEventListener('click', () => {
  const cols = ['name', 'category', 'color', 'size', 'brand', 'season', 'material', 'location', 'owner', 'status', 'price', 'boughtAt', 'tags', 'wears', 'notes'];
  const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const rows = items.map(i => cols.map(c => q(c === 'tags' ? i.tags.join('; ') : c === 'wears' ? i.wears.length : i[c])).join(','));
  const url = URL.createObjectURL(new Blob(['﻿' + cols.join(',') + '\n' + rows.join('\n')], { type: 'text/csv' }));
  h('a', { href: url, download: 'kleding.csv' }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

start().catch(() => showLogin());
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
