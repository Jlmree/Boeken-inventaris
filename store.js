import { DEFAULTS } from './config.js';

const K = { books: 'boeken.books', queue: 'boeken.queue', settings: 'boeken.settings' };
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));

export function getSettings() {
  return { name: '', family: DEFAULTS.family, supabaseUrl: DEFAULTS.supabaseUrl, supabaseKey: DEFAULTS.supabaseKey, googleKey: DEFAULTS.googleKey, ...read(K.settings, {}) };
}
export function saveSettings(s) { write(K.settings, s); }

const remoteOn = () => { const s = getSettings(); return !!(s.supabaseUrl && s.supabaseKey && s.family); };
export const syncEnabled = remoteOn;

function api(path, opts = {}) {
  const s = getSettings();
  return fetch(s.supabaseUrl.replace(/\/$/, '') + '/rest/v1/' + path, {
    ...opts,
    headers: {
      apikey: s.supabaseKey,
      Authorization: 'Bearer ' + s.supabaseKey,
      'Content-Type': 'application/json',
      'x-family': s.family,
      ...(opts.headers || {})
    }
  });
}

export function loadBooks() { return read(K.books, []); }
const saveLocal = (b) => write(K.books, b);

export function newId() { return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2); }

export async function putBook(book) {
  book.updated = Date.now();
  const all = loadBooks();
  const i = all.findIndex(b => b.id === book.id);
  if (i >= 0) all[i] = book; else all.push(book);
  saveLocal(all);
  enqueue({ op: 'put', id: book.id });
  return flush();
}

export async function deleteBook(id) {
  saveLocal(loadBooks().filter(b => b.id !== id));
  enqueue({ op: 'del', id });
  return flush();
}

function enqueue(item) {
  const q = read(K.queue, []).filter(x => x.id !== item.id);
  q.push(item);
  write(K.queue, q);
}

/** Stuurt openstaande wijzigingen naar de server. Geeft 'off' | 'ok' | 'offline' terug. */
export async function flush() {
  if (!remoteOn()) return 'off';
  let q = read(K.queue, []);
  try {
    for (const item of [...q]) {
      if (item.op === 'put') {
        const book = loadBooks().find(b => b.id === item.id);
        if (book) {
          const r = await api('books?on_conflict=id', {
            method: 'POST',
            headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify({ id: book.id, family: getSettings().family, data: book, updated_at: new Date(book.updated).toISOString() })
          });
          if (!r.ok) throw new Error(await r.text());
        }
      } else {
        const r = await api('books?id=eq.' + encodeURIComponent(item.id), { method: 'DELETE' });
        if (!r.ok) throw new Error(await r.text());
      }
      q = q.filter(x => x !== item && !(x.id === item.id && x.op === item.op));
      write(K.queue, q);
    }
    return 'ok';
  } catch (e) {
    console.warn('sync mislukt', e);
    return 'offline';
  }
}

/** Haalt de server-stand op en voegt samen met lokaal (nieuwste wijziging wint). */
export async function pull() {
  if (!remoteOn()) return { state: 'off', books: loadBooks() };
  const st = await flush();
  if (st !== 'ok') return { state: 'offline', books: loadBooks() };
  try {
    const r = await api('books?select=id,data');
    if (!r.ok) throw new Error(await r.text());
    const remote = (await r.json()).map(x => x.data);
    const pending = new Set(read(K.queue, []).map(x => x.id));
    const local = new Map(loadBooks().map(b => [b.id, b]));
    const merged = remote.map(rb => {
      const lb = local.get(rb.id);
      return lb && pending.has(rb.id) && (lb.updated || 0) > (rb.updated || 0) ? lb : rb;
    });
    // lokale boeken die nog niet op de server staan, blijven staan
    for (const [id, lb] of local) if (pending.has(id) && !merged.find(b => b.id === id)) merged.push(lb);
    saveLocal(merged);
    return { state: 'ok', books: merged };
  } catch (e) {
    console.warn('pull mislukt', e);
    return { state: 'offline', books: loadBooks() };
  }
}
