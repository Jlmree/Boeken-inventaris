const $ = (id) => document.getElementById(id);

const CATEGORIES = ['Tops', 'Broeken', 'Jurken & rokken', 'Jassen', 'Schoenen', 'Accessoires', 'Ondergoed & sokken', 'Nachtkleding', 'Sport'];
const COLORS = { zwart: '#1b1b1d', wit: '#f5f5f2', grijs: '#8b8d93', beige: '#d8c7a6', bruin: '#6d4a32', rood: '#c0392b', roze: '#e58fb0', oranje: '#e67e22', geel: '#e9c53a', groen: '#3f8f55', blauw: '#3478c6', marineblauw: '#1f2f58', paars: '#7b4fa8', multi: '#9a9a9a' };
const SEASONS = ['alle seizoenen', 'zomer', 'winter', 'lente/herfst'];
const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '34', '36', '38', '40', '42', '44', '46', '48', '50', '56', '62', '68', '74', '80', '86', '92', '98', '104', '110', '116', '122', '128', '134', '140', '152', '164', '176'];
const LAZY_DAYS = 180;

let items = [];
let session = { members: [], ai: false };
let cur = null; // { item, isNew, pending: [{pid, full, thumb, url}], photos: [pid] }
let chip = 'kast';

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
function agoText(ts) {
  const d = daysAgo(ts);
  return d <= 0 ? 'vandaag' : d === 1 ? 'gisteren' : d < 60 ? `${d} dagen geleden` : `${Math.round(d / 30)} maanden geleden`;
}
const isLazy = (it) => it.status === 'kast' && (it.wears.length ? daysAgo(lastWorn(it)) > LAZY_DAYS : daysAgo(it.created) > LAZY_DAYS);

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
  $('filterBox').open = window.innerWidth > 700;
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
}
$('me').addEventListener('change', () => local('kast.me', $('me').value));
const meName = () => $('me').value || session.members[0] || '';

function fillFilters() {
  const keep = (id) => $(id).value;
  const set = (id, all, values) => { const k = keep(id); $(id).replaceChildren(opt('', all), ...values.map(v => opt(v))); $(id).value = values.includes(k) ? k : ''; };
  const used = (key) => [...new Set(items.map(i => i[key]).filter(Boolean))];
  set('fCat', 'Alle categorieën', CATEGORIES.filter(c => used('category').includes(c)).concat(used('category').filter(c => !CATEGORIES.includes(c))));
  set('fOwner', 'Van iedereen', used('owner').sort());
  set('fSeason', 'Elk seizoen', SEASONS.filter(s => used('season').includes(s)));
  set('fColor', 'Alle kleuren', Object.keys(COLORS).filter(c => used('color').includes(c)));
  const sizeOrder = (s) => { const i = SIZES.indexOf(s); return i < 0 ? 999 : i; };
  set('fSize', 'Alle maten', used('size').sort((a, b) => sizeOrder(a) - sizeOrder(b) || a.localeCompare(b)));
}

/* ---------- overzicht ---------- */
function visible() {
  const q = $('search').value.trim().toLowerCase();
  const f = { category: $('fCat').value, owner: $('fOwner').value, season: $('fSeason').value, color: $('fColor').value, size: $('fSize').value };
  let list = items.filter(it => {
    if (chip === 'kast' && it.status !== 'kast') return false;
    if (chip === 'was' && it.status !== 'was') return false;
    if (chip === 'weg' && it.status !== 'weg') return false;
    if (chip === 'lazy' && !isLazy(it)) return false;
    for (const [k, v] of Object.entries(f)) if (v && it[k] !== v) return false;
    if (q && !`${it.name} ${it.brand} ${it.color} ${it.category} ${it.material} ${it.location} ${it.notes} ${it.tags.join(' ')}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const sort = $('fSort').value;
  const cmp = {
    new: (a, b) => b.created - a.created,
    name: (a, b) => a.name.localeCompare(b.name, 'nl'),
    least: (a, b) => a.wears.length - b.wears.length || lastWorn(a) - lastWorn(b),
    most: (a, b) => b.wears.length - a.wears.length,
    cat: (a, b) => a.category.localeCompare(b.category, 'nl') || a.name.localeCompare(b.name, 'nl')
  }[sort];
  return list.sort(cmp);
}

const photoUrl = (id, p, thumb) => `/photos/${id}/${p}${thumb ? '.t' : ''}.jpg`;

function thumb(it) {
  const box = h('div', { class: 'thumb' });
  box.style.setProperty('--sw', COLORS[it.color] || '#9a9a9a');
  if (it.photos[0]) box.append(h('img', { src: photoUrl(it.id, it.photos[0], true), alt: '', loading: 'lazy' }));
  else box.append('👕');
  return box;
}

function render() {
  fillFilters();
  const list = visible();
  const nFilters = ['fCat', 'fOwner', 'fSeason', 'fColor', 'fSize'].filter(id => $(id).value).length;
  $('filterSum').textContent = nFilters ? `Filters en sorteren (${nFilters} actief)` : 'Filters en sorteren';
  $('grid').replaceChildren(...list.map(it => h('button', { class: 'card', onclick: () => openItem(it) },
    thumb(it),
    h('div', { class: 'cname' }, it.name || 'Zonder naam'),
    h('div', { class: 'cmeta' }, [it.size && 'Maat ' + it.size, it.color].filter(Boolean).join(' · ') || ' '),
    h('div', { class: 'cmeta' }, [it.category, it.owner].filter(Boolean).join(' · ') || ' '),
    it.status === 'was' ? h('span', { class: 'tag' }, 'In de was') : null,
    it.wears.length ? h('span', { class: 'tag worn' }, it.wears.length + '×') : null)));
  const active = items.filter(i => i.status === 'kast').length;
  $('count').textContent = `${active} in de kast`;
  const empty = $('empty');
  empty.hidden = list.length > 0;
  empty.textContent = items.length ? 'Niets gevonden met deze filters.' : 'Nog geen kleding. Tik op + om je eerste kledingstuk te fotograferen.';
  const value = items.filter(i => i.status === 'kast').reduce((s, i) => s + (i.price || 0), 0);
  $('stats').textContent = `${items.length} items, ${items.filter(isLazy).length} lang niet gedragen${value ? `, aankoopwaarde €${Math.round(value)}` : ''}.`;
}
for (const id of ['search', 'fCat', 'fOwner', 'fSeason', 'fColor', 'fSize', 'fSort']) $(id).addEventListener('input', render);
$('chips').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  chip = b.dataset.c;
  document.querySelectorAll('#chips button').forEach(x => x.classList.toggle('on', x === b));
  render();
});
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
  $('view-kast').hidden = b.dataset.v !== 'kast'; $('view-settings').hidden = b.dataset.v !== 'settings';
  $('add').hidden = b.dataset.v !== 'kast';
}));

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

/* ---------- kledingstuk bewerken ---------- */
const dlg = $('dlg');
function openItem(it) {
  const isNew = !it;
  const item = it || { id: uid(), name: '', category: '', color: '', size: '', brand: '', season: '', material: '', location: '', owner: meName(), status: 'kast', price: null, boughtAt: '', tags: [], notes: '', photos: [], wears: [], created: Date.now() };
  cur = { item, isNew, pending: [], photos: [...item.photos] };
  $('fName').value = item.name; $('fCategory').value = item.category; $('fColorSel').value = item.color; $('fSizeIn').value = item.size;
  $('fBrand').value = item.brand; $('fSeasonSel').value = item.season; $('fOwnerSel').value = item.owner; $('fMaterial').value = item.material;
  $('fLocation').value = item.location; $('fPrice').value = item.price ?? ''; $('fBought').value = item.boughtAt; $('fTags').value = item.tags.join(', ');
  $('fStatus').value = item.status; $('fNotes').value = item.notes; $('saveErr').textContent = ''; $('aiMsg').textContent = '';
  $('delBtn').hidden = isNew; $('wearBox').hidden = isNew;
  updateWear(); drawPhotos();
  dlg.showModal();
}
function updateWear() {
  const w = cur.item.wears;
  $('wearInfo').textContent = w.length ? `${w.length}× gedragen, laatst ${agoText(Math.max(...w))}` : 'Nog niet gedragen';
  const p = cur.item.price;
  if (p && w.length) $('wearInfo').textContent += ` · €${(p / w.length).toFixed(2)} per keer`;
}
$('add').addEventListener('click', () => openItem(null));
$('closeBtn').addEventListener('click', () => dlg.close());
dlg.addEventListener('close', () => { for (const p of cur?.pending || []) URL.revokeObjectURL(p.url); });

$('wearBtn').addEventListener('click', async () => {
  const last = lastWorn(cur.item);
  if (last && daysAgo(last) === 0 && new Date(last).getDate() === new Date().getDate()) return toast('Vandaag al genoteerd');
  const next = { ...cur.item, wears: [...cur.item.wears, Date.now()] };
  try { cur.item = await api(`/api/items/${next.id}`, { method: 'PUT', body: JSON.stringify(next) }); replace(cur.item); updateWear(); render(); toast('Genoteerd 👕'); }
  catch (e) { toast(e.message); }
});
function replace(it) { const i = items.findIndex(x => x.id === it.id); if (i >= 0) items[i] = it; else items.unshift(it); }

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
    replace(await api(`/api/items/${old.id}`, { method: 'PUT', body: JSON.stringify(body) }));
    dlg.close(); render(); toast('Opgeslagen ✓');
  } catch (err) { $('saveErr').textContent = 'Opslaan mislukt: ' + err.message; }
  btn.disabled = false;
});
$('delBtn').addEventListener('click', async () => {
  if ($('delBtn').dataset.sure !== '1') { $('delBtn').dataset.sure = '1'; $('delBtn').textContent = 'Zeker weten?'; setTimeout(() => { $('delBtn').dataset.sure = ''; $('delBtn').textContent = 'Verwijderen'; }, 3000); return; }
  $('delBtn').dataset.sure = ''; $('delBtn').textContent = 'Verwijderen';
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
