// jam's routes (/jam/*): saved pieces, snippets, and the three Opus jobs.
// Every route belongs to the member in X-Radio-User; app.mjs mounts them.

import { now } from './db.mjs';
import { loadPieceEngine } from './engine.mjs';

const isObj = (x) => typeof x === 'object' && x !== null && !Array.isArray(x);
const SNIPPET_KEYS = ['name', 'layer', 'voice', 'kit', 'instrument', 'enter', 'gain', 'bars'];
const MAX_MESSAGES = 60;

function snippetRow(r) {
  return { id: r.id, name: r.name, kind: r.kind, track: JSON.parse(r.json), createdAt: r.created_at };
}

export function jamRoutes({ db, jobs, HttpError, readJson, needListener }) {
  /** The body's piece, validated (400 with the validator's messages). */
  async function validPiece(input) {
    const { validatePiece } = await loadPieceEngine();
    const res = validatePiece(input);
    if (!res.ok) throw new HttpError(400, `invalid piece: ${res.errors.slice(0, 20).join('; ')}`);
    return res.piece;
  }

  /** A snippet's track: known ids, 1..32 bars that parse. */
  async function cleanSnippetTrack(t) {
    const { VOICE_IDS, KIT_IDS, TRACK_LAYERS, parseNoteBar, parseDrumBar } = await loadPieceEngine();
    if (!isObj(t)) throw new HttpError(400, 'track must be an object');
    const out = {};
    for (const k of SNIPPET_KEYS) if (t[k] !== undefined) out[k] = t[k];
    if ((out.voice === undefined) === (out.kit === undefined)) throw new HttpError(400, 'track needs exactly one of voice and kit');
    if (out.voice !== undefined && !VOICE_IDS.includes(out.voice)) throw new HttpError(400, `unknown voice ${out.voice}`);
    if (out.kit !== undefined && !KIT_IDS.includes(out.kit)) throw new HttpError(400, `unknown kit ${out.kit}`);
    if (out.layer !== undefined && !TRACK_LAYERS.includes(out.layer)) throw new HttpError(400, `unknown layer ${out.layer}`);
    if (out.enter !== undefined && !(Number.isInteger(out.enter) && out.enter >= 0 && out.enter <= 4)) throw new HttpError(400, 'track.enter: integer 0..4');
    if (out.gain !== undefined && !(typeof out.gain === 'number' && out.gain >= 0 && out.gain <= 1.5)) throw new HttpError(400, 'track.gain: 0..1.5');
    if (out.name !== undefined && (typeof out.name !== 'string' || out.name.length > 40)) throw new HttpError(400, 'track.name: at most 40 chars');
    if (out.instrument !== undefined && !['piano', 'guitar', 'bass', 'drums', 'touch'].includes(out.instrument)) throw new HttpError(400, 'track.instrument: piano, guitar, bass, drums or touch');
    if (!Array.isArray(out.bars) || out.bars.length < 1 || out.bars.length > 32) throw new HttpError(400, 'track.bars: 1 to 32 bar strings');
    out.bars.forEach((b, i) => {
      if (typeof b !== 'string' || b.length > 600) throw new HttpError(400, `track.bars[${i}]: a string of at most 600 chars`);
      const r = (out.kit ? parseDrumBar : parseNoteBar)(b);
      if ('error' in r) throw new HttpError(400, `track.bars[${i}]: ${r.error}`);
    });
    return out;
  }

  return [
    ['GET', /^\/jam\/pieces$/, async (req) => {
      const owner = needListener(req);
      const rows = db.prepare('SELECT id, name, json, updated_at FROM jam_pieces WHERE owner = ? AND hidden = 0 ORDER BY updated_at DESC').all(owner);
      return {
        pieces: rows.map((r) => {
          const channel = JSON.parse(r.json).channel;
          return { id: r.id, name: r.name, updatedAt: r.updated_at, ...(channel ? { channel } : {}) };
        }),
      };
    }],

    ['GET', /^\/jam\/pieces\/([A-Za-z0-9_-]{1,40})$/, async (req, [, id]) => {
      const owner = needListener(req);
      const row = db.prepare('SELECT json, updated_at FROM jam_pieces WHERE owner = ? AND id = ? AND hidden = 0').get(owner, id);
      if (!row) throw new HttpError(404, 'no such piece');
      return { piece: JSON.parse(row.json), updatedAt: row.updated_at };
    }],

    // Saving a deleted piece again brings it back.
    ['PUT', /^\/jam\/pieces\/([A-Za-z0-9_-]{1,40})$/, async (req, [, id]) => {
      const owner = needListener(req);
      const b = await readJson(req);
      if (isObj(b) && b.id !== undefined && b.id !== id) throw new HttpError(400, `piece id ${JSON.stringify(b.id)} does not match the path`);
      const piece = await validPiece(isObj(b) ? { ...b, id } : b);
      const at = now();
      db.prepare(`INSERT INTO jam_pieces (owner, id, name, json, created_at, updated_at, hidden) VALUES (?, ?, ?, ?, ?, ?, 0)
                  ON CONFLICT(owner, id) DO UPDATE SET name = excluded.name, json = excluded.json, updated_at = excluded.updated_at, hidden = 0`)
        .run(owner, id, piece.name, JSON.stringify(piece), at, at);
      return { piece, updatedAt: at };
    }],

    // Kept in the DB (hidden = 1), like a removed channel.
    ['DELETE', /^\/jam\/pieces\/([A-Za-z0-9_-]{1,40})$/, async (req, [, id]) => {
      const owner = needListener(req);
      const r = db.prepare('UPDATE jam_pieces SET hidden = 1 WHERE owner = ? AND id = ? AND hidden = 0').run(owner, id);
      if (r.changes === 0) throw new HttpError(404, 'no such piece');
      return { id, hidden: true };
    }],

    ['GET', /^\/jam\/snippets$/, async (req) => {
      const owner = needListener(req);
      const rows = db.prepare('SELECT * FROM jam_snippets WHERE owner = ? ORDER BY id DESC').all(owner);
      return { snippets: rows.map(snippetRow) };
    }],

    ['POST', /^\/jam\/snippets$/, async (req) => {
      const owner = needListener(req);
      const b = await readJson(req);
      const name = typeof b.name === 'string' ? b.name.trim().slice(0, 60) : '';
      if (!name) throw new HttpError(400, 'name is required');
      if (typeof b.kind !== 'string' || !/^[a-z]{1,16}$/.test(b.kind)) throw new HttpError(400, 'kind must be a short lowercase word (drums, perc, bass, arp, lead, pad, ...)');
      const track = await cleanSnippetTrack(b.track);
      const r = db.prepare('INSERT INTO jam_snippets (owner, name, kind, json, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(owner, name, b.kind, JSON.stringify(track), now());
      return [201, { snippet: snippetRow(db.prepare('SELECT * FROM jam_snippets WHERE id = ?').get(Number(r.lastInsertRowid))) }];
    }],

    ['DELETE', /^\/jam\/snippets\/(\d+)$/, async (req, [, id]) => {
      const owner = needListener(req);
      const r = db.prepare('DELETE FROM jam_snippets WHERE id = ? AND owner = ?').run(Number(id), owner);
      if (r.changes === 0) throw new HttpError(404, 'no such snippet');
      return { id: Number(id), deleted: true };
    }],

    ['POST', /^\/jam\/track$/, async (req) => {
      const owner = needListener(req);
      const b = await readJson(req);
      const piece = await validPiece(b.piece);
      const { TRACK_LAYERS, MAX_TRACKS } = await loadPieceEngine();
      const request = typeof b.request === 'string' ? b.request.trim() : '';
      if (!request) throw new HttpError(400, 'request is required');
      if (request.length > 2000) throw new HttpError(400, 'request is too long (2000 chars max)');
      let layer;
      if (b.layer != null && b.layer !== '') {
        if (!TRACK_LAYERS.includes(b.layer)) throw new HttpError(400, `layer must be one of ${TRACK_LAYERS.join(', ')}`);
        layer = b.layer;
      }
      let phrases;
      if (b.phrases != null) {
        const ok = Array.isArray(b.phrases) && b.phrases.length > 0
          && b.phrases.every((p) => Number.isInteger(p) && p >= 0 && p < piece.phrases);
        if (!ok) throw new HttpError(400, `phrases must be a list of phrase indices 0..${piece.phrases - 1}`);
        phrases = [...new Set(b.phrases)].sort((x, y) => x - y);
      }
      if (piece.tracks.length >= MAX_TRACKS) throw new HttpError(400, `the piece already has ${MAX_TRACKS} tracks`);
      return [202, { job: jobs.enqueue('jam-track', { piece, request, layer, phrases, owner }) }];
    }],

    ['POST', /^\/jam\/feel$/, async (req) => {
      const owner = needListener(req);
      const b = await readJson(req);
      const piece = await validPiece(b.piece);
      const raw = b.messages ?? piece.feel?.messages ?? [];
      if (!Array.isArray(raw) || raw.length > MAX_MESSAGES) throw new HttpError(400, `messages must be a list of at most ${MAX_MESSAGES}`);
      const messages = raw.map((m, i) => {
        if (!isObj(m) || (m.role !== 'petter' && m.role !== 'opus') || typeof m.text !== 'string' || m.text.length > 4000) {
          throw new HttpError(400, `messages[${i}] must be { role: 'petter' | 'opus', text } (text at most 4000 chars)`);
        }
        return { role: m.role, text: m.text.trim() };
      });
      if (messages.length && messages.at(-1).role !== 'petter') throw new HttpError(400, "the last message must be Petter's");
      return [202, { job: jobs.enqueue('jam-feel', { piece, messages, owner }) }];
    }],

    ['POST', /^\/jam\/channel$/, async (req) => {
      const owner = needListener(req);
      const b = await readJson(req);
      const piece = await validPiece(b.piece);
      return [202, { job: jobs.enqueue('jam-channel', { piece, owner }) }];
    }],
  ];
}
