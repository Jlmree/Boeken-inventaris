/** ISBN-hulpfuncties en opzoeken van boekgegevens (Google Books, daarna Open Library). */

export function normalizeIsbn(raw) {
  const s = String(raw || '').replace(/[^0-9Xx]/g, '').toUpperCase();
  if (s.length === 13 && /^97[89]/.test(s) && ean13Ok(s)) return s;
  if (s.length === 10 && isbn10Ok(s)) return '978' + s.slice(0, 9) + ean13Check('978' + s.slice(0, 9));
  return null;
}
function ean13Check(d12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += +d12[i] * (i % 2 ? 3 : 1);
  return String((10 - (sum % 10)) % 10);
}
const ean13Ok = (s) => ean13Check(s.slice(0, 12)) === s[12];
function isbn10Ok(s) {
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (s[i] === 'X' ? 10 : +s[i]) * (10 - i);
  return sum % 11 === 0;
}

const https = (u) => (u ? u.replace(/^http:/, 'https:') : '');

async function google(isbn) {
  const r = await fetch('https://www.googleapis.com/books/v1/volumes?q=isbn:' + isbn + '&maxResults=1');
  if (!r.ok) return null;
  const v = (await r.json()).items?.[0]?.volumeInfo;
  if (!v) return null;
  return {
    title: [v.title, v.subtitle].filter(Boolean).join(': '),
    authors: (v.authors || []).join(', '),
    publisher: v.publisher || '',
    year: (v.publishedDate || '').slice(0, 4),
    cover: https(v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || '')
  };
}

async function openLibrary(isbn) {
  const r = await fetch('https://openlibrary.org/api/books?bibkeys=ISBN:' + isbn + '&format=json&jscmd=data');
  if (!r.ok) return null;
  const v = (await r.json())['ISBN:' + isbn];
  if (!v) return null;
  return {
    title: [v.title, v.subtitle].filter(Boolean).join(': '),
    authors: (v.authors || []).map(a => a.name).join(', '),
    publisher: (v.publishers || [])[0]?.name || '',
    year: (v.publish_date || '').match(/\d{4}/)?.[0] || '',
    cover: https(v.cover?.medium || v.cover?.small || '') || `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false`
  };
}

export async function lookupIsbn(isbn) {
  for (const fn of [google, openLibrary]) {
    try {
      const res = await fn(isbn);
      if (res && res.title) return { isbn, ...res };
    } catch (e) { console.warn('lookup fout', e); }
  }
  return null;
}
