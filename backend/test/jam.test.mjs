// jam's routes and jobs against a temp DB, the real engine (engine/piece/)
// and the fake slp. Run: node --no-warnings --test backend/test/

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TMP = mkdtempSync(join(tmpdir(), 'radio-jam-test-'));
const LOG = join(TMP, 'slp.log');
const KEY = 'test-key';
const USER = 'petter@example.com';
const OTHER = 'other@example.com';

delete process.env.RADIO_ENGINE_DIR;
process.env.RADIO_SLP_BIN = join(HERE, 'fixtures', 'fake-slp.mjs');
process.env.FAKE_SLP_LOG = LOG;

const { openDb } = await import('../lib/db.mjs');
const { createApp } = await import('../lib/app.mjs');

let db, server, jobs, base;
const painted = [];

before(async () => {
  db = openDb(join(TMP, 'radio.db'));
  const paint = (_db, landscape, owner) => { painted.push({ id: landscape.id, owner }); return true; };
  ({ server, jobs } = createApp({ db, apiKey: KEY, paint }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  db.close();
  rmSync(TMP, { recursive: true, force: true });
});

async function api(method, path, body, { key = KEY, user = USER } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(user ? { 'x-radio-user': user } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function waitJob(id) {
  await jobs.idle();
  return (await api('GET', `/jobs/${id}`)).body.job;
}

const calls = () => readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

function withMode(mode, fn) {
  process.env.FAKE_SLP_MODE = mode;
  return fn().finally(() => { delete process.env.FAKE_SLP_MODE; });
}

const piece = (over = {}) => ({
  v: 1, id: 'p-harbour', name: 'Harbour', tonic: 9, mode: 'aeolian', bpm: 90, swing: 0.1,
  phrases: 2, chords: ['1 6 4 5', '4 5 1 1'], chordBars: 2, intensity: 2, base: 'coast',
  tracks: [
    { id: 'bass', name: 'Bass', layer: 'bass', voice: 'bass.finger', instrument: 'bass', enter: 1, source: 'played', bars: Array(16).fill('0:A1:8 8:E2:8') },
    { id: 'drums', name: 'Drums', layer: 'drums', kit: 'kit.soft', enter: 2, source: 'written', bars: Array(16).fill('k:x.......x....... s:....x.......x...') },
  ],
  feel: { messages: [], brief: 'A harbour at dusk.' },
  ...over,
});

test('migration: a jobs table with the old CHECK is rebuilt, rows and ids kept', () => {
  const file = join(TMP, 'old.db');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK (kind IN ('compose', 'review')),
    status TEXT NOT NULL, input TEXT, result TEXT, error TEXT,
    created_at TEXT NOT NULL, finished_at TEXT)`);
  const ins = old.prepare(`INSERT INTO jobs (kind, status, input, result, created_at) VALUES (?, 'done', ?, ?, '2026-09-25T10:00:00Z')`);
  ins.run('compose', '{"prompt":"a"}', '{"landscape":{}}');
  ins.run('review', '{}', '{"skipped":"x"}');
  ins.run('compose', '{"prompt":"c"}', null);
  old.exec('DELETE FROM jobs WHERE id = 3');
  assert.throws(() => old.prepare(`INSERT INTO jobs (kind, status, created_at) VALUES ('jam-feel', 'queued', 'x')`).run(), /CHECK/);
  old.close();

  for (let round = 0; round < 2; round++) {
    const d = openDb(file);
    const rows = d.prepare('SELECT id, kind, input, result FROM jobs ORDER BY id').all().map((r) => ({ ...r }));
    assert.deepEqual(rows.slice(0, 2), [
      { id: 1, kind: 'compose', input: '{"prompt":"a"}', result: '{"landscape":{}}' },
      { id: 2, kind: 'review', input: '{}', result: '{"skipped":"x"}' },
    ]);
    assert.doesNotMatch(d.prepare(`SELECT sql FROM sqlite_master WHERE name = 'jobs'`).get().sql, /CHECK/);
    assert.equal(d.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'jobs_free'`).get().n, 0);
    // The counter stays past the deleted row 3: a new job never reuses an id.
    const id = Number(d.prepare(`INSERT INTO jobs (kind, status, created_at) VALUES ('jam-feel', 'queued', 'x')`).run().lastInsertRowid);
    assert.equal(id, round === 0 ? 4 : 5);
    for (const t of ['jam_pieces', 'jam_snippets']) assert.ok(d.prepare(`SELECT 1 FROM sqlite_master WHERE name = ?`).get(t), t);
    d.close();
  }
});

test('pieces: every route needs the key and a member', async () => {
  assert.equal((await api('GET', '/jam/pieces', null, { key: null })).status, 401);
  for (const [m, p, b] of [['GET', '/jam/pieces'], ['GET', '/jam/pieces/p-harbour'], ['PUT', '/jam/pieces/p-harbour', piece()], ['DELETE', '/jam/pieces/p-harbour'],
    ['GET', '/jam/snippets'], ['POST', '/jam/track', { piece: piece(), request: 'x' }], ['POST', '/jam/feel', { piece: piece() }], ['POST', '/jam/channel', { piece: piece() }]]) {
    const r = await api(m, p, b, { user: null });
    assert.equal(r.status, 401, `${m} ${p}`);
    assert.match(r.body.error, /X-Radio-User/);
  }
});

test('pieces: save, validate, list, owner isolation, soft delete', async () => {
  const put = await api('PUT', '/jam/pieces/p-harbour', { ...piece(), junk: 1 });
  assert.equal(put.status, 200, put.body.error);
  assert.equal(put.body.piece.junk, undefined, 'stores the validated copy');
  assert.equal(put.body.piece.tracks.length, 2);

  const bad = await api('PUT', '/jam/pieces/p-bad', piece({ id: 'p-bad', tracks: [{ ...piece().tracks[0], bars: Array(16).fill('0:H4:2') }] }));
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /tracks\[0\] 'bass' bar 0: bad pitch 'H4'/);
  assert.equal((await api('PUT', '/jam/pieces/p-other', piece())).status, 400, 'body id must match the path');
  assert.equal((await api('PUT', '/jam/pieces/p-x', { ...piece({ id: 'p-x' }), chords: ['1 6'] })).status, 400);
  assert.equal((await api('PUT', '/jam/pieces/bad%20id', piece())).status, 404);

  await api('PUT', '/jam/pieces/p-two', piece({ id: 'p-two', name: 'Second' }));
  const list = (await api('GET', '/jam/pieces')).body.pieces;
  assert.deepEqual(list.map((p) => [p.id, p.name]), [['p-two', 'Second'], ['p-harbour', 'Harbour']]);
  assert.ok(list[0].updatedAt);
  assert.equal((await api('GET', '/jam/pieces/p-harbour')).body.piece.name, 'Harbour');

  // Someone else sees none of it and cannot touch it.
  assert.deepEqual((await api('GET', '/jam/pieces', null, { user: OTHER })).body.pieces, []);
  assert.equal((await api('GET', '/jam/pieces/p-harbour', null, { user: OTHER })).status, 404);
  assert.equal((await api('DELETE', '/jam/pieces/p-harbour', null, { user: OTHER })).status, 404);
  await api('PUT', '/jam/pieces/p-harbour', piece({ name: 'Theirs' }), { user: OTHER });
  assert.equal((await api('GET', '/jam/pieces/p-harbour')).body.piece.name, 'Harbour');

  const del = await api('DELETE', '/jam/pieces/p-two');
  assert.deepEqual(del.body, { id: 'p-two', hidden: true });
  assert.equal((await api('GET', '/jam/pieces/p-two')).status, 404);
  assert.equal((await api('DELETE', '/jam/pieces/p-two')).status, 404);
  assert.deepEqual((await api('GET', '/jam/pieces')).body.pieces.map((p) => p.id), ['p-harbour']);
  assert.equal(db.prepare('SELECT hidden FROM jam_pieces WHERE owner = ? AND id = ?').get(USER, 'p-two').hidden, 1);
  await api('PUT', '/jam/pieces/p-two', piece({ id: 'p-two', name: 'Second' }));
  assert.equal((await api('GET', '/jam/pieces/p-two')).status, 200, 'saving again brings it back');
});

test('snippets: create, validate, list per member, delete', async () => {
  const drums = { name: 'Brush groove', kind: 'drums', track: { kit: 'kit.brush', layer: 'drums', bars: ['k:x.......x....... s:....g.......g...'], junk: 1 } };
  const a = await api('POST', '/jam/snippets', drums);
  assert.equal(a.status, 201, a.body.error);
  assert.equal(a.body.snippet.track.junk, undefined);
  assert.deepEqual(a.body.snippet.track.bars, drums.track.bars);
  const b = await api('POST', '/jam/snippets', { name: 'Riff', kind: 'bass', track: { voice: 'bass.finger', bars: ['0:A1:4 4:C2:4', ''] } });
  assert.equal(b.status, 201, b.body.error);

  assert.equal((await api('POST', '/jam/snippets', { ...drums, name: '' })).status, 400);
  assert.equal((await api('POST', '/jam/snippets', { ...drums, kind: 'Drums!' })).status, 400);
  assert.equal((await api('POST', '/jam/snippets', { ...drums, track: { kit: 'kit.brush', voice: 'bass.finger', bars: [''] } })).status, 400);
  assert.match((await api('POST', '/jam/snippets', { ...drums, track: { voice: 'bass.finger', bars: ['0:H4:2'] } })).body.error, /bars\[0\]: .*H4/);
  assert.equal((await api('POST', '/jam/snippets', { ...drums, track: { kit: 'kit.nope', bars: [''] } })).status, 400);

  assert.deepEqual((await api('GET', '/jam/snippets')).body.snippets.map((s) => s.name), ['Riff', 'Brush groove']);
  assert.deepEqual((await api('GET', '/jam/snippets', null, { user: OTHER })).body.snippets, []);
  assert.equal((await api('DELETE', `/jam/snippets/${a.body.snippet.id}`, null, { user: OTHER })).status, 404);
  assert.equal((await api('DELETE', `/jam/snippets/${a.body.snippet.id}`)).status, 200);
  assert.deepEqual((await api('GET', '/jam/snippets')).body.snippets.map((s) => s.name), ['Riff']);
});

test('jam-track: prompt, stamped tracks with unique ids, phrases honoured', async () => {
  writeFileSync(LOG, '');
  const r = await api('POST', '/jam/track', { piece: piece(), request: 'en rolig bass som går', layer: 'bass', phrases: [1] });
  assert.equal(r.status, 202, r.body.error);
  assert.equal(r.body.job.kind, 'jam-track');
  const job = await waitJob(r.body.job.id);
  assert.equal(job.status, 'done', job.error);
  const [t] = job.result.tracks;
  assert.equal(t.id, 'bass-2', 'the piece has a bass already');
  assert.equal(t.source, 'opus');
  assert.equal(t.bars.length, 16);
  assert.deepEqual(t.bars.slice(0, 8), Array(8).fill(''), 'phrase 1 left empty');
  assert.equal(t.bars[8], '0:A2:8 8:E2:8:5');
  assert.equal(job.result.note, 'A slow bass under it.');
  assert.equal(job.result.repaired, false);

  const prompt = calls()[0].prompt;
  assert.match(prompt, /Bar notation \(engine\/piece\/types\.ts\)/);
  assert.match(prompt, /<step>:<pitches>:<len>\[:<vel>\]/);
  assert.match(prompt, /export interface Track/);
  assert.match(prompt, /'lead\.square'\s+\/\/ two detuned squares/);
  assert.match(prompt, /voice: .*bass\.finger/);
  assert.match(prompt, /bar 0: Am \(i: A C E\)/);
  assert.match(prompt, /bar 2: F/);
  assert.match(prompt, /A aeolian, 90 bpm/);
  assert.match(prompt, /en rolig bass som går/);
  assert.match(prompt, /Layer: bass/);
  assert.match(prompt, /Write only in phrase 2 \(bars 8–15\)/);
  assert.match(prompt, /exactly 16 strings/);
});

test('jam-track: one repair round, then failure with the validator messages', async () => {
  await withMode('bad-first', async () => {
    writeFileSync(LOG, '');
    const job = await waitJob((await api('POST', '/jam/track', { piece: piece(), request: 'bass' })).body.job.id);
    assert.equal(job.status, 'done', job.error);
    assert.equal(job.result.repaired, true);
    assert.equal(job.result.tracks[0].bars[3], '0:C4:4');
    const repair = calls()[1].prompt;
    assert.match(repair, /## Validator errors\n\n- tracks\[0\] 'bass-2' bar 3: bad pitch 'H4'/);
  });
  // Asked for a lead, the fake writes a bass both times.
  const job = await waitJob((await api('POST', '/jam/track', { piece: piece(), request: 'a lead', layer: 'lead' })).body.job.id);
  assert.equal(job.status, 'error');
  assert.match(job.error, /still invalid after one repair: tracks\[0\] 'bass-2'\.layer: Petter asked for the lead layer/);
});

test('jam-track: bad input is refused', async () => {
  assert.equal((await api('POST', '/jam/track', { piece: piece() })).status, 400);
  assert.equal((await api('POST', '/jam/track', { piece: piece(), request: 'x', layer: 'ambience' })).status, 400);
  assert.equal((await api('POST', '/jam/track', { piece: piece(), request: 'x', phrases: [2] })).status, 400);
  assert.equal((await api('POST', '/jam/track', { piece: piece(), request: 'x', phrases: [] })).status, 400);
  assert.match((await api('POST', '/jam/track', { piece: { ...piece(), bpm: 20 }, request: 'x' })).body.error, /bpm/);
});

test('jam-feel: a reply and a brief; prose keeps the old brief', async () => {
  writeFileSync(LOG, '');
  const messages = [{ role: 'opus', text: 'Hva ser du?' }, { role: 'petter', text: 'En havn, tror jeg. Kveld.' }];
  const r = await api('POST', '/jam/feel', { piece: piece(), messages });
  assert.equal(r.status, 202, r.body.error);
  const job = await waitJob(r.body.job.id);
  assert.equal(job.status, 'done', job.error);
  assert.equal(job.result.reply, 'Jeg hører en havn i skumringen. Regner det?');
  assert.match(job.result.brief, /^A small harbour at dusk/);
  const prompt = calls()[0].prompt;
  assert.match(prompt, /You: Hva ser du\?\n\nPetter: En havn, tror jeg\. Kveld\./);
  assert.match(prompt, /## The brief so far\n\nA harbour at dusk\./);
  assert.match(prompt, /'drums' \(kit\.soft\):\n  bar 0: k:x/);
  assert.match(prompt, /bokmål/);

  await withMode('prose', async () => {
    const j = await waitJob((await api('POST', '/jam/feel', { piece: piece() })).body.job.id);
    assert.equal(j.status, 'done', j.error);
    assert.deepEqual(j.result, { reply: 'Det høres ut som en havn i skumringen. Hvem er der?', brief: 'A harbour at dusk.' });
  });

  assert.equal((await api('POST', '/jam/feel', { piece: piece(), messages: [{ role: 'opus', text: 'hei' }] })).status, 400);
  assert.equal((await api('POST', '/jam/feel', { piece: piece(), messages: [{ role: 'x', text: 'hei' }] })).status, 400);
});

test('jam-channel: the draft distilled, stored like a compose, painted, piece linked', async () => {
  writeFileSync(LOG, '');
  await api('PUT', '/jam/pieces/p-harbour', piece());
  const r = await api('POST', '/jam/channel', { piece: piece() });
  assert.equal(r.status, 202, r.body.error);
  const job = await waitJob(r.body.job.id);
  assert.equal(job.status, 'done', job.error);
  const l = job.result.landscape;
  assert.match(l.id, /^harbour-jam-[0-9a-f]{4}$/);
  assert.equal(l.origin, 'opus');
  assert.equal(l.prompt, 'A harbour at dusk.\n\n(made in jam from "Harbour")');
  assert.deepEqual(l.progressions.map((p) => p.chords), ['1 6 4 5', '4 5 1 1'], 'the draft carried the progressions');
  assert.equal(job.result.repaired, false);
  assert.equal(job.result.painting, true);
  assert.deepEqual(painted.at(-1), { id: l.id, owner: USER });

  const row = db.prepare('SELECT owner, prompt FROM landscapes WHERE id = ?').get(l.id);
  assert.deepEqual({ ...row }, { owner: USER, prompt: l.prompt });
  assert.ok((await api('GET', '/landscapes')).body.landscapes.some((x) => x.id === l.id));
  assert.equal((await api('GET', '/jam/pieces/p-harbour')).body.piece.channel, l.id);
  assert.equal((await api('GET', '/jam/pieces')).body.pieces.find((p) => p.id === 'p-harbour').channel, l.id);

  const prompt = calls()[0].prompt;
  assert.match(prompt, /## Musical intent\n\nThe radio is Petter's/);
  assert.match(prompt, /export interface Landscape/);
  assert.match(prompt, /export function validateLandscape/);
  assert.match(prompt, /"id": "jam-p-harbour"/);
  assert.match(prompt, /Keep its progressions, grooves, bass patterns and motifs as written/);
  assert.match(prompt, /## The feel\n\nA harbour at dusk\./);
  assert.match(prompt, /`coast`, `summit`/);
});

test('jam-channel: one repair round; an unsaved piece is left alone', async () => {
  await withMode('bad-first', async () => {
    const other = piece({ id: 'p-unsaved', feel: undefined });
    const job = await waitJob((await api('POST', '/jam/channel', { piece: other })).body.job.id);
    assert.equal(job.status, 'done', job.error);
    assert.equal(job.result.repaired, true);
    assert.equal(job.result.landscape.scene, 'coast');
    assert.equal(job.result.landscape.prompt, '(made in jam from "Harbour")');
    assert.equal((await api('GET', '/jam/pieces/p-unsaved')).status, 404);
  });
});
