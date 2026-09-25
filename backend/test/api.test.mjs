// radio-api against a temp DB, a stub engine and a fake slp.
// Run: node --no-warnings --test backend/test/

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TMP = mkdtempSync(join(tmpdir(), 'radio-api-test-'));
const LOG = join(TMP, 'slp.log');
const KEY = 'test-key';

process.env.RADIO_ENGINE_DIR = join(HERE, 'fixtures', 'engine');
process.env.RADIO_SLP_BIN = join(HERE, 'fixtures', 'fake-slp.mjs');
process.env.RADIO_REVIEWS_DIR = join(TMP, 'reviews');
process.env.FAKE_SLP_LOG = LOG;
process.env.CLAUDECODE = '1';
process.env.CLAUDE_CODE_ENTRYPOINT = 'cli';

const { openDb } = await import('../lib/db.mjs');
const { createApp } = await import('../lib/app.mjs');

let db, server, jobs, base;
/** Paintings the app asked for after a compose (the real one spawns an agent). */
const painted = [];

before(async () => {
  db = openDb(join(TMP, 'radio.db'));
  const paint = (_db, landscape, owner) => { painted.push({ id: landscape.id, owner }); return true; };
  ({ server, jobs } = createApp({ db, apiKey: KEY, corsOrigins: ['https://radio.phareim.no'], paint }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  db.close();
  rmSync(TMP, { recursive: true, force: true });
});

const USER = 'listener@example.com'

async function api(method, path, body, { key = KEY, headers = {}, user = USER } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(user ? { 'x-radio-user': user } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

const snapshot = (landscape, intensity = 2) => ({
  landscape,
  controls: { landscape, intensity, mood: 0.5, space: 0.5, grit: 0.3, density: 0.5, tempo: 0, hold: false },
  bar: 42, key: 'D mixolydian', chords: ['D', 'C'], section: 'A', seed: 7, engineVersion: 'test',
  active: ['pad', 'bass', 'drums'], transition: 'none',
});

async function waitJob(id) {
  await jobs.idle();
  return (await api('GET', `/jobs/${id}`)).body.job;
}

test('health is open, everything else needs the key', async () => {
  const h = await api('GET', '/health', null, { key: null });
  assert.equal(h.status, 200);
  assert.equal(h.body.ok, true);
  assert.equal((await api('GET', '/feedback', null, { key: null })).status, 401);
  assert.equal((await api('GET', '/feedback', null, { key: 'wrong' })).status, 401);
  assert.equal((await api('GET', '/nope')).status, 404);
  assert.equal((await api('PUT', '/feedback')).status, 405);
});

test('CORS answers the radio origin and localhost only', async () => {
  const pre = await fetch(base + '/feedback', { method: 'OPTIONS', headers: { origin: 'https://radio.phareim.no' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), 'https://radio.phareim.no');
  const evil = await fetch(base + '/feedback', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  const local = await api('GET', '/health', null, { headers: { origin: 'http://localhost:3000' } });
  assert.equal(local.headers.get('access-control-allow-origin'), 'http://localhost:3000');
});

test('feedback: create, validate, patch, list, stats', async () => {
  assert.equal((await api('POST', '/feedback', { rating: 2, snapshot: snapshot('coast') })).status, 400);
  assert.equal((await api('POST', '/feedback', { rating: 1 })).status, 400);
  assert.equal((await api('POST', '/feedback', { rating: 0, comment: ' ', snapshot: snapshot('coast') })).status, 400);

  const a = await api('POST', '/feedback', { rating: 1, comment: '', snapshot: snapshot('coast') });
  assert.equal(a.status, 201);
  const b = await api('POST', '/feedback', { rating: -1, comment: 'too busy', snapshot: snapshot('neonrain', 4) });
  const c = await api('POST', '/feedback', { rating: 0, comment: 'love this bass', snapshot: snapshot('coast', 3) });
  assert.ok(a.body.id < b.body.id && b.body.id < c.body.id);

  const p = await api('PATCH', `/feedback/${a.body.id}`, { comment: 'the lead here' });
  assert.equal(p.status, 200);
  assert.equal(p.body.feedback.comment, 'the lead here');
  assert.equal((await api('PATCH', '/feedback/9999', { comment: 'x' })).status, 404);

  const list = await api('GET', '/feedback?limit=2');
  assert.deepEqual(list.body.feedback.map((f) => f.id), [c.body.id, b.body.id]);
  assert.equal(list.body.feedback[0].snapshot.controls.intensity, 3);
  const coast = await api('GET', '/feedback?landscape=coast');
  assert.deepEqual(coast.body.feedback.map((f) => f.landscape), ['coast', 'coast']);

  const stats = (await api('GET', '/feedback/stats')).body.stats;
  const byId = Object.fromEntries(stats.map((s) => [s.landscape, s]));
  assert.deepEqual(
    { up: byId.coast.up, down: byId.coast.down, comments: byId.coast.comments, total: byId.coast.total },
    { up: 1, down: 0, comments: 2, total: 2 },
  );
  assert.equal(byId.neonrain.down, 1);
});

test('compose: prompt, stamp, validate, store, list, hide', async () => {
  writeFileSync(LOG, '');
  const r = await api('POST', '/compose', { prompt: 'warm evening harbour, slow', base: 'neonrain' });
  assert.equal(r.status, 202);
  assert.equal(r.body.job.kind, 'compose');
  const job = await waitJob(r.body.job.id);
  assert.equal(job.status, 'done', job.error);
  const l = job.result.landscape;
  assert.equal(l.name, 'Amber Tide');
  assert.equal(l.origin, 'opus');
  assert.equal(l.prompt, 'warm evening harbour, slow');
  assert.match(l.id, /^amber-tide-[0-9a-f]{4}$/);
  assert.equal(job.result.repaired, false);

  const call = JSON.parse(readFileSync(LOG, 'utf8').trim().split('\n')[0]);
  assert.deepEqual(call.args, ['-p', '-', '--model', 'opus']);
  assert.equal(call.cwd, tmpdir());
  assert.equal(call.claudecode, null);
  assert.equal(call.entrypoint, null);
  assert.match(call.prompt, /Start from this one/);
  assert.match(call.prompt, /`coast`, `neonrain`/);
  assert.match(call.prompt, /warm evening harbour, slow/);
  assert.match(call.prompt, /export interface Landscape/);

  const listed = (await api('GET', '/landscapes')).body.landscapes;
  assert.deepEqual(listed.map((x) => x.id), [l.id]);
  // Private to the composer: nobody else sees it or can remove it.
  assert.deepEqual((await api('GET', '/landscapes', null, { user: 'other@example.com' })).body.landscapes, [])
  assert.deepEqual((await api('GET', '/landscapes', null, { user: null })).body.landscapes, [])
  assert.equal((await api('DELETE', `/landscapes/${l.id}`, null, { user: 'other@example.com' })).status, 404)
  assert.equal((await api('DELETE', `/landscapes/${l.id}`)).status, 200);
  assert.deepEqual((await api('GET', '/landscapes')).body.landscapes, []);
  assert.equal((await api('DELETE', '/landscapes/nope')).status, 404);
});

test('compose: one repair round fixes an invalid scene', async () => {
  process.env.FAKE_SLP_MODE = 'bad-first';
  try {
    const r = await api('POST', '/compose', { prompt: 'somewhere new' });
    const job = await waitJob(r.body.job.id);
    assert.equal(job.status, 'done', job.error);
    assert.equal(job.result.repaired, true);
    assert.equal(job.result.landscape.scene, 'coast');
  } finally {
    delete process.env.FAKE_SLP_MODE;
  }
});

test('compose: bad input is refused, slp failure becomes a job error', async () => {
  assert.equal((await api('POST', '/compose', {})).status, 400);
  assert.equal((await api('POST', '/compose', { prompt: 'x', base: 'atlantis' })).status, 400);
  process.env.FAKE_SLP_MODE = 'fail';
  try {
    const r = await api('POST', '/compose', { prompt: 'anything' });
    const job = await waitJob(r.body.job.id);
    assert.equal(job.status, 'error');
    assert.match(job.error, /usage limit/);
  } finally {
    delete process.env.FAKE_SLP_MODE;
  }
  assert.equal((await api('GET', '/jobs/9999')).status, 404);
});

test('compose: a hung slp is killed at the timeout', async () => {
  process.env.FAKE_SLP_MODE = 'hang';
  process.env.RADIO_OPUS_TIMEOUT_MS = '400';
  try {
    const job = await waitJob((await api('POST', '/compose', { prompt: 'anything' })).body.job.id);
    assert.equal(job.status, 'error');
    assert.match(job.error, /timed out/);
  } finally {
    delete process.env.FAKE_SLP_MODE;
    delete process.env.RADIO_OPUS_TIMEOUT_MS;
  }
});

test('review: writes the report, marks feedback, lists it, skips when empty', async () => {
  writeFileSync(LOG, '');
  const r = await api('POST', '/review');
  assert.equal(r.status, 202);
  const job = await waitJob(r.body.job.id);
  assert.equal(job.status, 'done', job.error);
  const rev = job.result.review;
  assert.equal(rev.items, 3);
  assert.equal(rev.summary, 'Listeners like the coast at cruise. The rain drags.');

  const file = join(process.env.RADIO_REVIEWS_DIR, rev.path.split('/').pop());
  assert.match(rev.path.split('/').pop(), /^\d{4}-\d{2}-\d{2}\.md$/);
  assert.ok(existsSync(file));
  assert.match(readFileSync(file, 'utf8'), /^# Radio review\n/);

  const prompt = JSON.parse(readFileSync(LOG, 'utf8').trim()).prompt;
  assert.match(prompt, /### coast \(built-in, engine\/landscapes\/coast\.ts\)/);
  assert.match(prompt, /"comment":"too busy"/);
  assert.match(prompt, /\| coast \| 1 \| 0 \| 2 \|/);

  const health = (await api('GET', '/health')).body;
  assert.equal(health.unreviewed, 0);
  const reviews = (await api('GET', '/reviews')).body.reviews;
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].feedbackTo - reviews[0].feedbackFrom, 2);

  const again = await waitJob((await api('POST', '/review')).body.job.id);
  assert.deepEqual(again.result, { skipped: 'no unreviewed feedback' });

  await api('POST', '/feedback', { rating: 1, comment: '', snapshot: snapshot('coast') });
  const second = await waitJob((await api('POST', '/review')).body.job.id);
  assert.match(second.result.review.path, /-2\.md$/);
});

test('settings: per listener, cleaned, required listener', async () => {
  assert.equal((await api('GET', '/settings', null, { user: null })).status, 401)
  assert.equal((await api('GET', '/settings')).body.settings, null)
  const put = await api('PUT', '/settings', { hidden: ['jungle', 'jungle', 'bad id!', 42, 'deepspace'], extra: 1 })
  assert.deepEqual(put.body.settings, { hidden: ['jungle', 'deepspace'] })
  assert.deepEqual((await api('GET', '/settings')).body.settings, { hidden: ['jungle', 'deepspace'] })
  assert.equal((await api('GET', '/settings', null, { user: 'other@example.com' })).body.settings, null)
  assert.equal((await api('POST', '/compose', { prompt: 'x' }, { user: null })).status, 401)
})

test('compose: a finished landscape is handed to the painter with its owner', async () => {
  const before = painted.length;
  const res = await fetch(`${base}/compose`, {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json', 'x-radio-user': 'painter@example.com' },
    body: JSON.stringify({ prompt: 'a quiet harbour' }),
  });
  assert.equal(res.status, 202);
  await jobs.idle();
  assert.equal(painted.length, before + 1);
  assert.equal(painted.at(-1).owner, 'painter@example.com');
  const cols = db.prepare('PRAGMA table_info(landscapes)').all().map((c) => c.name);
  for (const c of ['paint_status', 'paint_error', 'painted_at']) assert.ok(cols.includes(c), c);
});
