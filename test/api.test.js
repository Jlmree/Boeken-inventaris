import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/server.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const dir = mkdtempSync(path.join(tmpdir(), 'kast-'));
let aiCalls = [];
const server = createApp({
  dataDir: dir, password: 'geheim', members: ['Papa', 'Mama', 'Kind'], anthropicKey: 'sk-test', aiModel: 'test-model', sessionDays: 1,
  fetchImpl: async (url, opts) => {
    aiCalls.push({ url, body: JSON.parse(opts.body), key: opts.headers['x-api-key'] });
    return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Hier:\n{"name":"Blauwe jeans","category":"Broeken","color":"Blauw","season":"alle seizoenen","material":"denim","pattern":"effen","brand":"","extra":"x"}' }] }));
  }
});
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
let cookie = '';
const call = (p, o = {}) => fetch(base + p, { ...o, headers: { cookie, ...(o.headers || {}) } });
const json = (body) => ({ method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const ID = 'aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb';
const PID = 'abcdef0123456789';

test.after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

test('zonder login is er geen toegang', async () => {
  assert.equal((await call('/api/items')).status, 401);
  assert.equal((await call(`/photos/${ID}/${PID}.jpg`)).status, 401);
  assert.equal((await call('/api/session').then(r => r.json())).authed, false);
});

test('verkeerd wachtwoord wordt geweigerd, goed wachtwoord geeft een sessie', async () => {
  const bad = await fetch(base + '/api/login', { method: 'POST', body: JSON.stringify({ password: 'fout' }) });
  assert.equal(bad.status, 401);
  const ok = await fetch(base + '/api/login', { method: 'POST', body: JSON.stringify({ password: 'geheim' }) });
  assert.equal(ok.status, 200);
  cookie = ok.headers.get('set-cookie').split(';')[0];
  assert.match(ok.headers.get('set-cookie'), /HttpOnly/);
  const s = await call('/api/session').then(r => r.json());
  assert.deepEqual([s.authed, s.members, s.ai], [true, ['Papa', 'Mama', 'Kind'], true]);
});

test('een vervalste sessie werkt niet', async () => {
  const r = await fetch(base + '/api/items', { headers: { cookie: 'kast=' + Buffer.from('{"exp":9999999999999}').toString('base64url') + '.AAAA' } });
  assert.equal(r.status, 401);
});

test('item opslaan, ophalen en opschonen', async () => {
  const r = await call(`/api/items/${ID}`, json({ name: '  Trui ', category: 'Tops', price: '19.5', status: 'raar', tags: ['a', '', 'b'], photos: ['../../etc', PID], wears: [1, 'x', 2], evil: '<script>', size: 'M' }));
  assert.equal(r.status, 200);
  const it = await r.json();
  assert.equal(it.name, 'Trui');
  assert.equal(it.price, 19.5);
  assert.equal(it.status, 'kast');
  assert.deepEqual(it.tags, ['a', 'b']);
  assert.deepEqual(it.photos, [PID]);
  assert.deepEqual(it.wears, [1, 2]);
  assert.equal('evil' in it, false);
  const list = await call('/api/items').then(r => r.json());
  assert.equal(list.length, 1);
});

test('foto uploaden en ophalen, geen niet-JPEG, geen pad-trucs', async () => {
  const up = (q, body) => call(`/api/items/${ID}/photos?${q}`, { method: 'POST', body });
  assert.equal((await up(`pid=${PID}`, JPEG)).status, 201);
  assert.equal((await up(`pid=${PID}&kind=thumb`, JPEG)).status, 201);
  assert.equal((await up(`pid=${PID}`, Buffer.from('<html>'))).status, 415);
  assert.equal((await up('pid=../../x', JPEG)).status, 400);
  const full = await call(`/photos/${ID}/${PID}.jpg`);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'image/jpeg');
  assert.equal((await call(`/photos/${ID}/${PID}.t.jpg`)).status, 200);
  assert.equal((await call('/photos/../../etc/passwd')).status, 404);
});

test('foto verwijderen uit het item ruimt het bestand op', async () => {
  await call(`/api/items/${ID}`, json({ name: 'Trui', photos: [] }));
  assert.equal((await call(`/photos/${ID}/${PID}.jpg`)).status, 404);
  assert.equal((await call(`/photos/${ID}/${PID}.t.jpg`)).status, 404);
});

test('statische bestanden: geen toegang buiten public', async () => {
  const r = await fetch(base + '/..%2fserver%2fserver.js');
  assert.ok([404, 400].includes(r.status));
  assert.notEqual((await fetch(base + '/%2e%2e/server/server.js')).status, 200);
});

test('AI-herkenning geeft alleen gecontroleerde waarden terug', async () => {
  const r = await call('/api/analyze', { method: 'POST', body: JSON.stringify({}) });
  assert.equal(r.status, 415);
  const ok = await call('/api/analyze', { method: 'POST', body: JPEG });
  assert.equal(ok.status, 200);
  const j = await ok.json();
  assert.deepEqual(j, { name: 'Blauwe jeans', category: 'Broeken', color: 'blauw', season: 'alle seizoenen', material: 'denim', pattern: 'effen', brand: '' });
  const c = aiCalls.at(-1);
  assert.equal(c.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(c.key, 'sk-test');
  assert.equal(c.body.model, 'test-model');
  assert.equal(c.body.messages[0].content[0].type, 'image');
});

test('verwijderen haalt item en foto-map weg', async () => {
  await call(`/api/items/${ID}/photos?pid=${PID}`, { method: 'POST', body: JPEG });
  assert.equal((await call(`/api/items/${ID}`, { method: 'DELETE' })).status, 204);
  assert.equal((await call('/api/items').then(r => r.json())).length, 0);
  assert.equal(existsSync(path.join(dir, 'photos', ID)), false);
});

test('login wordt afgeremd na te veel pogingen', async () => {
  let last;
  for (let i = 0; i < 10; i++) last = await fetch(base + '/api/login', { method: 'POST', body: JSON.stringify({ password: 'x' }) });
  assert.equal(last.status, 429);
});
