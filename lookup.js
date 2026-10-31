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

export const CATEGORIES = ['Fictie', 'Non-fictie', 'Kinderboeken', 'Stripboeken', 'Studie & naslag'];
export const GENRES = ['Roman', 'Thriller', 'Detective', 'Fantasy', 'Sciencefiction', 'Romantiek', 'Historisch', 'Horror', 'Humor', 'Poëzie', 'Biografie', 'Geschiedenis', 'Wetenschap', 'Psychologie', 'Zelfhulp', 'Reizen', 'Koken', 'Kunst', 'Religie', 'Natuur', 'Techniek', 'Informatica', 'Economie', 'Sport'];

const GENRE_RULES = [
  [/thriller|suspense/, 'Thriller'], [/mystery|detective|crime/, 'Detective'], [/fantasy/, 'Fantasy'],
  [/science fiction|sci-fi/, 'Sciencefiction'], [/romance|love stor/, 'Romantiek'], [/historical fiction/, 'Historisch'],
  [/horror/, 'Horror'], [/humou?r|comedy/, 'Humor'], [/poetry|poem/, 'Poëzie'],
  [/biograph|autobiograph|memoir/, 'Biografie'], [/history/, 'Geschiedenis'], [/psycholog/, 'Psychologie'],
  [/self-help|personal growth/, 'Zelfhulp'], [/travel/, 'Reizen'], [/cook|food|recipe/, 'Koken'],
  [/\bart\b|photograph|design/, 'Kunst'], [/religio|spiritual|bible/, 'Religie'], [/nature|animal|garden/, 'Natuur'],
  [/computer|programming|software/, 'Informatica'], [/technology|engineering/, 'Techniek'],
  [/business|econom|finance/, 'Economie'], [/sport|recreation/, 'Sport'], [/science|math|physics|biology/, 'Wetenschap'],
  [/literary|general fiction|fiction/, 'Roman']
];

/** Leidt categorie en genre af uit Engelse categorieën/onderwerpen van Google Books of Open Library. */
export function classify(raw) {
  const t = (Array.isArray(raw) ? raw.join(' / ') : String(raw || '')).toLowerCase();
  if (!t) return {};
  let category = '';
  if (/juvenile|children|young adult/.test(t)) category = 'Kinderboeken';
  else if (/comic|graphic novel|manga/.test(t)) category = 'Stripboeken';
  else if (/textbook|study|reference|education/.test(t)) category = 'Studie & naslag';
  else if (/fiction|novel|stories/.test(t) && !/nonfiction|non-fiction/.test(t)) category = 'Fictie';
  else category = 'Non-fictie';
  const genre = GENRE_RULES.find(([re]) => re.test(t))?.[1] || '';
  return { category, genre };
}

const https = (u) => (u ? u.replace(/^http:/, 'https:') : '');

/** Probeert één keer opnieuw bij een serverfout (5xx). */
async function fetchRetry(url) {
  const r = await fetch(url);
  if (r.status < 500) return r;
  await new Promise(res => setTimeout(res, 800));
  return fetch(url);
}

async function google(isbn, { googleKey } = {}) {
  const key = googleKey ? '&key=' + encodeURIComponent(googleKey) : '';
  const r = await fetchRetry('https://www.googleapis.com/books/v1/volumes?q=isbn:' + isbn + '&maxResults=1' + key);
  if (r.status === 429 || r.status === 403) throw new Error('google-limiet');
  if (!r.ok) throw new Error('google-fout');
  const v = (await r.json()).items?.[0]?.volumeInfo;
  if (!v) return null;
  return {
    title: [v.title, v.subtitle].filter(Boolean).join(': '),
    authors: (v.authors || []).join(', '),
    publisher: v.publisher || '',
    year: (v.publishedDate || '').slice(0, 4),
    ...classify(v.categories),
    cover: https(v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || '').replace('&edge=curl', '')
  };
}

async function openLibrary(isbn) {
  // Eigen foutmelding zodat de app kan uitleggen waarom er niets gevonden is.
  const r = await fetchRetry('https://openlibrary.org/api/books?bibkeys=ISBN:' + isbn + '&format=json&jscmd=data');
  if (!r.ok) throw new Error('openlibrary-fout');
  const v = (await r.json())['ISBN:' + isbn];
  if (!v) return null;
  return {
    title: [v.title, v.subtitle].filter(Boolean).join(': '),
    authors: (v.authors || []).map(a => a.name).join(', '),
    publisher: (v.publishers || [])[0]?.name || '',
    year: (v.publish_date || '').match(/\d{4}/)?.[0] || '',
    ...classify((v.subjects || []).map(s => s.name).slice(0, 12)),
    cover: https(v.cover?.medium || v.cover?.small || '') || `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false`
  };
}

/** Controleert of een afbeelding echt laadt (en geen leeg plaatje van 1x1 pixel is). */
function imageOk(url) {
  return new Promise(resolve => {
    const img = new Image();
    const t = setTimeout(() => resolve(false), 5000);
    img.onload = () => { clearTimeout(t); resolve(img.naturalWidth > 40 && img.naturalHeight > 40); };
    img.onerror = () => { clearTimeout(t); resolve(false); };
    img.referrerPolicy = 'no-referrer';
    img.src = url;
  });
}

const FIELDS = ['title', 'authors', 'publisher', 'year', 'category', 'genre'];

/**
 * Zoekt in alle bronnen, vult ontbrekende velden aan uit de volgende bron en kiest de eerste cover die echt laadt.
 * Geeft { info, problems } terug: info is null als niets gevonden is, problems bevat bronnen die niet antwoordden.
 */
export async function lookupIsbn(isbn, opts = {}) {
  const problems = [];
  const results = await Promise.all([['google', google], ['openlibrary', openLibrary]].map(async ([name, fn]) => {
    try { return await fn(isbn, opts); } catch (e) {
      console.warn('lookup fout', name, e);
      problems.push(e.message === 'Failed to fetch' || e instanceof TypeError ? name + '-netwerk' : e.message);
      return null;
    }
  }));
  const found = results.filter(r => r && r.title);
  if (!found.length) return { info: null, problems };
  const merged = { isbn };
  for (const f of FIELDS) merged[f] = found.map(r => r[f]).find(Boolean) || '';
  const covers = [...found.map(r => r.cover), `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`].filter(Boolean);
  merged.cover = '';
  for (const c of [...new Set(covers)]) if (await imageOk(c)) { merged.cover = c; break; }
  return { info: merged, problems };
}

/** Uitleg voor de gebruiker als er niets gevonden is. */
export function explainProblems(problems) {
  if (problems.includes('google-limiet')) return 'Google Books-limiet bereikt. Zet een gratis API-sleutel bij Instellingen, of vul de titel zelf in.';
  if (problems.some(p => p.endsWith('-netwerk'))) return 'Geen verbinding met de opzoekdienst. Controleer je internet, of vul de titel zelf in.';
  if (problems.length) return 'De opzoekdienst gaf een fout. Probeer het later opnieuw, of vul de titel zelf in.';
  return 'Dit boek staat niet in de opzoekdiensten. Vul de titel zelf in.';
}
