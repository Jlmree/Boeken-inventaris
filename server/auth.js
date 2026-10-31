import crypto from 'node:crypto';

const b64 = (b) => Buffer.from(b).toString('base64url');

/** Ondertekent een sessie met HMAC; er staat geen persoonsinformatie in. */
export function makeSession(secret, days) {
  const body = b64(JSON.stringify({ exp: Date.now() + days * 864e5 }));
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return body + '.' + sig;
}

export function checkSession(secret, token) {
  if (typeof token !== 'string') return false;
  const [body, sig] = token.split('.');
  if (!body || !sig) return false;
  const want = crypto.createHmac('sha256', secret).update(body).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return false;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString()).exp > Date.now(); } catch { return false; }
}

export function samePassword(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Eenvoudige teller tegen het raden van het wachtwoord. */
export function makeLimiter(max, windowMs) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || now - h.t > windowMs) { hits.set(key, { n: 1, t: now }); return true; }
    h.n += 1;
    return h.n <= max;
  };
}
