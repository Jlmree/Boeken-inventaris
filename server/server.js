import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, existsSync, createReadStream, statSync } from 'node:fs';
import { writeFile, rm, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { makeSession, checkSession, samePassword, parseCookies, makeLimiter } from './auth.js';
import { analyze } from './ai.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ID = /^[a-z0-9-]{8,40}$/;
const PID = /^[a-f0-9]{8,32}$/;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json' };

const S = (v, n = 200) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const isJpeg = (b) => b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/** Maakt van binnenkomende gegevens een veilig kledingstuk: alleen bekende velden, begrensde lengtes. */
export function cleanItem(inp, id, old) {
  const price = inp.price === null || inp.price === '' || inp.price === undefined ? null : Number(inp.price);
  return {
    id,
    name: S(inp.name, 120),
    category: S(inp.category, 40),
    color: S(inp.color, 30),
    size: S(inp.size, 20),
    brand: S(inp.brand, 60),
    season: S(inp.season, 20),
    material: S(inp.material, 60),
    location: S(inp.location, 80),
    owner: S(inp.owner, 40),
    status: ['kast', 'was', 'weg'].includes(inp.status) ? inp.status : 'kast',
    price: Number.isFinite(price) ? Math.max(0, Math.min(100000, price)) : null,
    boughtAt: /^\d{4}-\d{2}-\d{2}$/.test(inp.boughtAt || '') ? inp.boughtAt : '',
    tags: Array.isArray(inp.tags) ? inp.tags.map(t => S(t, 30)).filter(Boolean).slice(0, 20) : [],
    notes: S(inp.notes, 2000),
    photos: Array.isArray(inp.photos) ? inp.photos.filter(p => typeof p === 'string' && PID.test(p)).slice(0, 10) : [],
    wears: Array.isArray(inp.wears) ? inp.wears.filter(Number.isFinite).slice(-2000) : [],
    created: old?.created ?? (Number.isFinite(inp.created) ? inp.created : Date.now()),
    updated: Date.now()
  };
}

export function createApp(cfg) {
  const dataDir = path.resolve(cfg.dataDir);
  const publicDir = path.resolve(cfg.publicDir || path.join(HERE, '..', 'public'));
  mkdirSync(path.join(dataDir, 'photos'), { recursive: true });
  const db = openDb(path.join(dataDir, 'kast.db'));

  let secret = cfg.sessionSecret;
  if (!secret) {
    const f = path.join(dataDir, 'secret');
    if (!existsSync(f)) writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    secret = readFileSync(f, 'utf8');
  }
  const loginOk = makeLimiter(8, 60_000);
  const aiOk = makeLimiter(30, 60_000);
  const members = cfg.members;

  const send = (res, code, body, headers = {}) => {
    const isObj = body !== null && typeof body === 'object' && !Buffer.isBuffer(body);
    res.writeHead(code, { 'content-type': isObj ? 'application/json' : 'text/plain; charset=utf-8', ...headers });
    res.end(code === 204 ? undefined : isObj ? JSON.stringify(body) : body);
  };

  async function readBody(req, limit) {
    const chunks = []; let n = 0;
    for await (const c of req) {
      n += c.length;
      if (n > limit) { const e = new Error('te groot'); e.status = 413; throw e; }
      chunks.push(c);
    }
    return Buffer.concat(chunks);
  }
  const readJson = async (req, limit = 200_000) => { try { return JSON.parse((await readBody(req, limit)).toString() || '{}'); } catch (e) { if (e.status) throw e; const err = new Error('ongeldige JSON'); err.status = 400; throw err; } };

  const photoPath = (id, pid, thumb) => path.join(dataDir, 'photos', id, pid + (thumb ? '.t.jpg' : '.jpg'));
  const cookieFlags = (req) => 'Path=/; HttpOnly; SameSite=Lax' + (cfg.cookieSecure || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '');
  const clientIp = (req) => (cfg.trustProxy && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.socket.remoteAddress);

  async function serveStatic(req, res, pathname) {
    const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
    const file = path.resolve(publicDir, rel);
    if (!file.startsWith(publicDir + path.sep) || !existsSync(file) || !statSync(file).isFile()) return send(res, 404, 'Niet gevonden');
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    createReadStream(file).pipe(res);
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    const m = req.method;
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'same-origin');
    res.setHeader('content-security-policy', "default-src 'self'; img-src 'self' blob: data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");

    if (p === '/healthz') return send(res, 200, 'ok');

    const authed = checkSession(secret, parseCookies(req.headers.cookie).kast);

    if (p === '/api/login' && m === 'POST') {
      if (!loginOk(clientIp(req))) return send(res, 429, { error: 'Te vaak geprobeerd, wacht even.' });
      const body = await readJson(req, 2000);
      if (!samePassword(body.password ?? '', cfg.password)) return send(res, 401, { error: 'Onjuist wachtwoord' });
      return send(res, 200, { ok: true }, { 'set-cookie': `kast=${makeSession(secret, cfg.sessionDays)}; Max-Age=${cfg.sessionDays * 86400}; ${cookieFlags(req)}` });
    }
    if (p === '/api/logout' && m === 'POST') return send(res, 200, { ok: true }, { 'set-cookie': `kast=; Max-Age=0; ${cookieFlags(req)}` });
    if (p === '/api/session' && m === 'GET') return send(res, 200, authed ? { authed: true, members, ai: !!cfg.anthropicKey } : { authed: false });

    if (!(p.startsWith('/api/') || p.startsWith('/photos/'))) return serveStatic(req, res, p);
    if (!authed) return send(res, 401, { error: 'Niet ingelogd' });

    if (p === '/api/items' && m === 'GET') return send(res, 200, db.list());

    let mt;
    if ((mt = p.match(/^\/api\/items\/([a-z0-9-]{8,40})$/))) {
      const id = mt[1];
      if (m === 'PUT') {
        const old = db.get(id);
        const item = cleanItem(await readJson(req), id, old);
        db.put(item);
        for (const pid of old?.photos || []) if (!item.photos.includes(pid)) {
          await rm(photoPath(id, pid, false), { force: true }); await rm(photoPath(id, pid, true), { force: true });
        }
        return send(res, 200, item);
      }
      if (m === 'DELETE') {
        db.del(id);
        await rm(path.join(dataDir, 'photos', id), { recursive: true, force: true });
        return send(res, 204, '');
      }
    }

    if ((mt = p.match(/^\/api\/items\/([a-z0-9-]{8,40})\/photos$/)) && m === 'POST') {
      const id = mt[1], pid = url.searchParams.get('pid') || '', thumb = url.searchParams.get('kind') === 'thumb';
      if (!PID.test(pid)) return send(res, 400, { error: 'ongeldige foto-id' });
      const buf = await readBody(req, 8_000_000);
      if (!isJpeg(buf)) return send(res, 415, { error: 'alleen JPEG' });
      await mkdir(path.join(dataDir, 'photos', id), { recursive: true });
      await writeFile(photoPath(id, pid, thumb), buf);
      return send(res, 201, { ok: true });
    }

    if ((mt = p.match(/^\/photos\/([a-z0-9-]{8,40})\/([a-f0-9]{8,32})(\.t)?\.jpg$/)) && m === 'GET') {
      const f = photoPath(mt[1], mt[2], !!mt[3]);
      if (!existsSync(f)) return send(res, 404, 'Niet gevonden');
      res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=31536000, immutable' });
      return createReadStream(f).pipe(res);
    }

    if (p === '/api/analyze' && m === 'POST') {
      if (!cfg.anthropicKey) return send(res, 503, { error: 'AI staat uit' });
      if (!aiOk(clientIp(req))) return send(res, 429, { error: 'Even rustig aan' });
      const buf = await readBody(req, 6_000_000);
      if (!isJpeg(buf)) return send(res, 415, { error: 'alleen JPEG' });
      try {
        return send(res, 200, await analyze({ apiKey: cfg.anthropicKey, model: cfg.aiModel, image: buf, fetchImpl: cfg.fetchImpl }));
      } catch (e) {
        console.warn('AI-fout:', e.message);
        return send(res, 502, { error: 'Herkenning mislukt' });
      }
    }

    return send(res, 404, { error: 'Niet gevonden' });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(e => {
      if (e.status) return send(res, e.status, { error: e.message });
      console.error(e);
      if (!res.headersSent) send(res, 500, { error: 'Serverfout' });
    });
  });
  server.on('close', () => db.close());
  return server;
}

/** Start direct als dit bestand zelf wordt uitgevoerd. */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const env = process.env;
  if (!env.FAMILY_PASSWORD) { console.error('Zet FAMILY_PASSWORD (zie .env.example).'); process.exit(1); }
  const port = Number(env.PORT || 3000);
  createApp({
    dataDir: env.DATA_DIR || './data',
    password: env.FAMILY_PASSWORD,
    members: (env.MEMBERS || 'Papa,Mama,Kind').split(',').map(s => s.trim()).filter(Boolean),
    anthropicKey: env.ANTHROPIC_API_KEY || '',
    aiModel: env.AI_MODEL || 'claude-haiku-5-5',
    sessionSecret: env.SESSION_SECRET || '',
    sessionDays: Number(env.SESSION_DAYS || 90),
    trustProxy: env.TRUST_PROXY === '1',
    cookieSecure: env.COOKIE_SECURE === '1'
  }).listen(port, () => console.log(`Kledingkast draait op poort ${port}`));
}
