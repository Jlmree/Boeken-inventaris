import { getSettings, saveSettings, loadBooks, putBook, deleteBook, newId, pull, syncEnabled } from './store.js';
import { lookupIsbn, normalizeIsbn } from './lookup.js';
import { startCamera, decodeImage } from './scanner.js';

const $ = (id) => document.getElementById(id);
let books = loadBooks();
let filter = 'all';
let stopCam = null;
let busy = false;

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
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
}
const hue = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' }) : '';

function cover(book, cls = '') {
  const box = h('div', { class: 'cover ' + cls, style: `--h:${hue(book.title || '?')}` }, h('span', {}, book.title || '?'));
  if (book.cover) {
    const img = h('img', { src: book.cover, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => img.remove());
    img.addEventListener('load', () => { if (img.naturalWidth < 20) img.remove(); });
    box.append(img);
  }
  return box;
}

/* ---------- navigatie ---------- */
function show(view) {
  document.querySelectorAll('.view').forEach(v => v.hidden = v.id !== 'view-' + view);
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === view));
  if (view !== 'scan') stopScan();
  if (view === 'settings') fillSettings();
}
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => show(b.dataset.v)));

/* ---------- overzicht ---------- */
function render() {
  const q = $('search').value.trim().toLowerCase();
  const owner = $('ownerFilter').value;
  const sort = $('sort').value;
  let list = books.filter(b => {
    if (owner && b.owner !== owner) return false;
    if (filter === 'unread' && b.read) return false;
    if (filter === 'read' && !b.read) return false;
    if (filter === 'lent-out' && b.loan?.type !== 'out') return false;
    if (filter === 'lent-in' && b.loan?.type !== 'in') return false;
    if (q && !`${b.title} ${b.authors} ${b.isbn} ${b.owner} ${b.notes || ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const cmp = {
    added: (a, b) => (b.added || 0) - (a.added || 0),
    title: (a, b) => a.title.localeCompare(b.title, 'nl'),
    author: (a, b) => (a.authors || '').localeCompare(b.authors || '', 'nl')
  }[sort];
  list.sort(cmp);

  const grid = $('grid');
  grid.replaceChildren(...list.map(b => {
    const badges = [];
    if (b.read) badges.push(h('span', { class: 'badge ok', title: 'Gelezen' }, '✓'));
    if (b.loan?.type === 'out') badges.push(h('span', { class: 'badge warn' }, '→ ' + b.loan.who));
    if (b.loan?.type === 'in') badges.push(h('span', { class: 'badge info' }, '← ' + b.loan.who));
    return h('button', { class: 'card', onclick: () => openBook(b) },
      cover(b),
      h('div', { class: 'ctitle' }, b.title),
      h('div', { class: 'cauthor' }, b.authors || ''),
      b.owner ? h('div', { class: 'cowner' }, 'van ' + b.owner) : null,
      h('div', { class: 'badges' }, badges));
  }));
  $('empty').hidden = books.length > 0;
  const lentOut = books.filter(b => b.loan?.type === 'out').length;
  $('count').textContent = `${books.length} boeken${lentOut ? ` · ${lentOut} uitgeleend` : ''}`;

  const owners = [...new Set(books.map(b => b.owner).filter(Boolean))].sort();
  const cur = $('ownerFilter').value;
  $('ownerFilter').replaceChildren(h('option', { value: '' }, 'Van iedereen'), ...owners.map(o => h('option', { value: o }, o)));
  $('ownerFilter').value = owners.includes(cur) ? cur : '';
  $('owners').replaceChildren(...owners.map(o => h('option', { value: o })));
}
$('search').addEventListener('input', render);
$('ownerFilter').addEventListener('change', render);
$('sort').addEventListener('change', render);
$('filters').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  filter = b.dataset.f;
  document.querySelectorAll('#filters button').forEach(x => x.classList.toggle('on', x === b));
  render();
});

/* ---------- boek-dialoog ---------- */
const dlg = $('dlg');
let editing = null; // het boek dat in de dialoog zit
let isNew = false;

function openBook(book, fresh = false) {
  editing = book; isNew = fresh;
  $('dcover').replaceChildren(...cover(book, 'big').childNodes);
  $('dcover').style.setProperty('--h', hue(book.title || '?'));
  $('fTitle').value = book.title || '';
  $('fAuthors').value = book.authors || '';
  $('fMeta').textContent = [book.publisher, book.year, book.isbn && 'ISBN ' + book.isbn].filter(Boolean).join(' · ');
  $('fOwner').value = book.owner || (fresh ? getSettings().name : '') || '';
  $('fRead').checked = !!book.read;
  $('fReadBy').value = book.readBy || '';
  $('fLoan').value = book.loan?.type || '';
  $('fWho').value = book.loan?.who || '';
  $('fSince').value = book.loan?.since || today();
  $('fNotes').value = book.notes || '';
  $('dDelete').hidden = fresh;
  syncDialogRows();
  dlg.showModal();
}
function syncDialogRows() {
  $('readByRow').hidden = !$('fRead').checked;
  $('loanRow').hidden = !$('fLoan').value;
  $('fWho').placeholder = $('fLoan').value === 'in' ? 'Geleend van wie?' : 'Uitgeleend aan wie?';
  $('fWho').required = !!$('fLoan').value;
}
$('fRead').addEventListener('change', syncDialogRows);
$('fLoan').addEventListener('change', syncDialogRows);
$('dClose').addEventListener('click', () => dlg.close());

$('bookForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const loanType = $('fLoan').value;
  const book = {
    ...editing,
    title: $('fTitle').value.trim(),
    authors: $('fAuthors').value.trim(),
    owner: $('fOwner').value.trim(),
    read: $('fRead').checked,
    readBy: $('fRead').checked ? $('fReadBy').value.trim() : '',
    loan: loanType ? { type: loanType, who: $('fWho').value.trim(), since: $('fSince').value || today() } : null,
    notes: $('fNotes').value.trim()
  };
  dlg.close();
  const i = books.findIndex(b => b.id === book.id);
  if (i >= 0) books[i] = book; else books.push(book);
  render();
  setSync(await putBook(book));
  toast(isNew ? 'Toegevoegd ✓' : 'Opgeslagen ✓');
  if (isNew) { show('books'); }
});
$('dDelete').addEventListener('click', async () => {
  if (!confirm(`"${editing.title}" verwijderen?`)) return;
  dlg.close();
  books = books.filter(b => b.id !== editing.id);
  render();
  setSync(await deleteBook(editing.id));
  toast('Verwijderd');
});

/* ---------- scannen ---------- */
const scanmsg = (t) => $('scanmsg').textContent = t;

async function startScan() {
  if (stopCam) return;
  try {
    scanmsg('Camera starten…');
    stopCam = await startCamera($('video'), handleCode);
    $('scanStart').textContent = 'Camera stoppen';
    scanmsg('Houd de barcode in beeld.');
  } catch (e) {
    console.warn(e);
    stopCam = null;
    scanmsg('Camera niet beschikbaar. Geef toestemming, kies een foto of typ het ISBN.');
  }
}
function stopScan() {
  stopCam?.(); stopCam = null;
  $('scanStart').textContent = 'Camera starten';
}
$('scanStart').addEventListener('click', () => stopCam ? (stopScan(), scanmsg('Camera uit.')) : startScan());
$('photo').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  scanmsg('Foto lezen…');
  const code = await decodeImage(f);
  if (code) handleCode(code); else scanmsg('Geen barcode gevonden. Probeer scherper/dichterbij of typ het ISBN.');
});
$('manual').addEventListener('submit', (e) => { e.preventDefault(); handleCode($('isbnInput').value); });
$('blank').addEventListener('click', () => openBook({ id: newId(), title: '', authors: '', added: Date.now() }, true));

async function handleCode(raw) {
  if (busy) return;
  const isbn = normalizeIsbn(raw);
  if (!isbn) { scanmsg(`"${raw}" is geen geldig ISBN. Probeer opnieuw.`); return; }
  busy = true;
  try {
    stopScan();
    const have = books.find(b => b.isbn === isbn);
    if (have) { scanmsg('Dit boek heb je al.'); toast('Heb je al 📚'); openBook(have); return; }
    scanmsg('Opzoeken…');
    const info = await lookupIsbn(isbn);
    const base = { id: newId(), isbn, added: Date.now() };
    if (info) { scanmsg('Gevonden!'); openBook({ ...base, ...info }, true); }
    else { scanmsg('Niet gevonden. Vul de titel zelf in.'); openBook({ ...base, title: '', authors: '' }, true); }
    $('isbnInput').value = '';
  } finally { busy = false; }
}

/* ---------- instellingen & sync ---------- */
function fillSettings() {
  const s = getSettings();
  $('setName').value = s.name; $('setFamily').value = s.family;
  $('setUrl').value = s.supabaseUrl; $('setKey').value = s.supabaseKey;
}
$('saveSettings').addEventListener('click', async () => {
  saveSettings({
    name: $('setName').value.trim(), family: $('setFamily').value.trim(),
    supabaseUrl: $('setUrl').value.trim(), supabaseKey: $('setKey').value.trim()
  });
  $('setmsg').textContent = 'Synchroniseren…';
  await refresh();
  $('setmsg').textContent = syncEnabled() ? 'Klaar. Status: ' + $('syncstate').title : 'Opgeslagen (alleen lokaal).';
});
$('exportCsv').addEventListener('click', () => {
  const cols = ['title', 'authors', 'isbn', 'publisher', 'year', 'owner', 'read', 'readBy', 'loanType', 'loanWho', 'loanSince', 'notes'];
  const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const rows = books.map(b => [b.title, b.authors, b.isbn, b.publisher, b.year, b.owner, b.read ? 'ja' : 'nee', b.readBy, b.loan?.type, b.loan?.who, b.loan?.since, b.notes].map(q).join(','));
  const url = URL.createObjectURL(new Blob(['﻿' + cols.join(',') + '\n' + rows.join('\n')], { type: 'text/csv' }));
  h('a', { href: url, download: 'boeken.csv' }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

function setSync(state) {
  const el = $('syncstate');
  el.textContent = { off: '', ok: '☁️', offline: '⚠️' }[state] ?? '';
  el.title = { off: 'Alleen lokaal', ok: 'Gesynchroniseerd', offline: 'Sync mislukt, wordt later opnieuw geprobeerd' }[state];
}
async function refresh() {
  const r = await pull();
  books = r.books; setSync(r.state); render();
}

/* ---------- start ---------- */
render();
refresh();
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
window.addEventListener('online', refresh);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
