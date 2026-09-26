// The HTTP app: routes, auth, CORS. server.mjs starts it; tests build it on a temp DB.

import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { now, feedbackRow } from './db.mjs';
import { createJobs } from './jobs.mjs';
import { loadEngine } from './engine.mjs';
import { composeLandscape } from '../compose.mjs';
import { startPaint } from '../paint.mjs';
import { runReview } from '../review.mjs';
import { jamTrack, jamFeel, jamChannel } from '../jam.mjs';
import { jamRoutes } from './jam.mjs';

const MAX_BODY = 256 * 1024;
const startedAt = Date.now();

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.trim()) return resolve({});
      try { resolve(JSON.parse(text)); } catch { reject(new HttpError(400, 'invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function authorized(req, key) {
  const h = req.headers.authorization ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m || !key) return false;
  const a = Buffer.from(m[1].trim());
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

function corsHeaders(req, origins) {
  const origin = req.headers.origin;
  if (!origin) return {};
  const ok = origins.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!ok) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type, x-radio-user',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

/**
 * The listener, as the Worker vouches for it: the signed-in email in
 * X-Radio-User. Only trusted because every route but /health needs the
 * Bearer key, which only the Worker holds.
 */
function listener(req) {
  const u = String(req.headers['x-radio-user'] ?? '').trim().toLowerCase();
  return /^[^\s@]{1,100}@[^\s@]{1,100}$/.test(u) ? u : null;
}

function needListener(req) {
  const u = listener(req);
  if (!u) throw new HttpError(401, 'X-Radio-User is required');
  return u;
}

/** Settings a listener may keep: the channels hidden from their dial. */
function cleanSettings(b) {
  const hidden = Array.isArray(b?.hidden) ? b.hidden.filter((x) => typeof x === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x)) : [];
  return { hidden: [...new Set(hidden)].slice(0, 200) };
}

export function createApp({ db, apiKey, corsOrigins = [], ask, paint = startPaint }) {
  const jobs = createJobs(db, {
    compose: async (input) => {
      const res = await composeLandscape({ db, prompt: input.prompt, base: input.base, owner: input.owner ?? null, ask });
      return { ...res, painting: paint(db, res.landscape, input.owner ?? null) };
    },
    review: () => runReview({ db, ask }),
    'jam-track': (input) => jamTrack({ ...input, ask }),
    'jam-feel': (input) => jamFeel({ ...input, ask }),
    'jam-channel': async (input) => {
      const res = await jamChannel({ db, piece: input.piece, owner: input.owner ?? null, ask });
      return { ...res, painting: paint(db, res.landscape, input.owner ?? null) };
    },
  });

  const routes = [
    ['GET', /^\/health$/, async () => {
      const unreviewed = db.prepare('SELECT COUNT(*) AS n FROM feedback WHERE reviewed_at IS NULL').get().n;
      return { ok: true, service: 'radio-api', uptime_s: Math.round((Date.now() - startedAt) / 1000), jobsPending: jobs.pending, unreviewed };
    }],

    ['POST', /^\/feedback$/, async (req) => {
      const b = await readJson(req);
      if (![1, -1, 0].includes(b.rating)) throw new HttpError(400, 'rating must be 1, -1 or 0');
      if (!b.snapshot || typeof b.snapshot !== 'object' || Array.isArray(b.snapshot)) throw new HttpError(400, 'snapshot must be an object');
      const landscape = str(b.snapshot.landscape, 100);
      if (!landscape) throw new HttpError(400, 'snapshot.landscape is required');
      const comment = str(b.comment, 4000);
      if (b.rating === 0 && !comment.trim()) throw new HttpError(400, 'a comment-only entry needs a comment');
      const r = db.prepare('INSERT INTO feedback (at, rating, comment, snapshot, landscape, user) VALUES (?, ?, ?, ?, ?, ?)')
        .run(now(), b.rating, comment, JSON.stringify(b.snapshot), landscape, listener(req));
      return [201, { id: Number(r.lastInsertRowid) }];
    }],

    ['GET', /^\/feedback\/stats$/, async () => {
      const stats = db.prepare(`
        SELECT landscape,
               SUM(rating = 1) AS up, SUM(rating = -1) AS down,
               SUM(comment <> '') AS comments, COUNT(*) AS total,
               SUM(reviewed_at IS NULL) AS unreviewed
        FROM feedback GROUP BY landscape ORDER BY total DESC, landscape`).all();
      return { stats: stats.map((s) => ({ ...s })) };
    }],

    ['PATCH', /^\/feedback\/(\d+)$/, async (req, [, id]) => {
      const b = await readJson(req);
      if (typeof b.comment !== 'string') throw new HttpError(400, 'comment must be a string');
      const r = db.prepare('UPDATE feedback SET comment = ? WHERE id = ?').run(b.comment.slice(0, 4000), Number(id));
      if (r.changes === 0) throw new HttpError(404, 'no such feedback');
      return { feedback: feedbackRow(db.prepare('SELECT * FROM feedback WHERE id = ?').get(Number(id))) };
    }],

    ['GET', /^\/feedback$/, async (req, _m, url) => {
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 500);
      const landscape = url.searchParams.get('landscape');
      const rows = landscape
        ? db.prepare('SELECT * FROM feedback WHERE landscape = ? ORDER BY id DESC LIMIT ?').all(landscape, limit)
        : db.prepare('SELECT * FROM feedback ORDER BY id DESC LIMIT ?').all(limit);
      return { feedback: rows.map(feedbackRow) };
    }],

    // Composed landscapes are private to whoever composed them.
    ['GET', /^\/landscapes$/, async (req) => {
      const u = listener(req);
      if (!u) return { landscapes: [] };
      const rows = db.prepare('SELECT json FROM landscapes WHERE hidden = 0 AND owner = ? ORDER BY created_at').all(u);
      return { landscapes: rows.map((r) => JSON.parse(r.json)) };
    }],

    // Removing one keeps the row (hidden = 1), so it can be brought back by hand.
    ['DELETE', /^\/landscapes\/([A-Za-z0-9_-]+)$/, async (req, [, id]) => {
      const u = needListener(req);
      const r = db.prepare('UPDATE landscapes SET hidden = 1 WHERE id = ? AND owner = ?').run(id, u);
      if (r.changes === 0) throw new HttpError(404, 'no such landscape');
      return { id, hidden: true };
    }],

    ['GET', /^\/settings$/, async (req) => {
      const u = needListener(req);
      const row = db.prepare('SELECT json, updated_at FROM settings WHERE user = ?').get(u);
      return { settings: row ? cleanSettings(JSON.parse(row.json)) : null, updatedAt: row?.updated_at ?? null };
    }],

    ['PUT', /^\/settings$/, async (req) => {
      const u = needListener(req);
      const settings = cleanSettings(await readJson(req));
      const at = now();
      db.prepare('INSERT INTO settings (user, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(user) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at')
        .run(u, JSON.stringify(settings), at);
      return { settings, updatedAt: at };
    }],

    ['POST', /^\/compose$/, async (req) => {
      const owner = needListener(req);
      const b = await readJson(req);
      const prompt = typeof b.prompt === 'string' ? b.prompt.trim() : '';
      if (!prompt) throw new HttpError(400, 'prompt is required');
      if (prompt.length > 2000) throw new HttpError(400, 'prompt is too long (2000 chars max)');
      let base;
      if (b.base != null && b.base !== '') {
        const { LANDSCAPES } = await loadEngine();
        if (typeof b.base !== 'string' || !LANDSCAPES[b.base]) {
          throw new HttpError(400, `base must be a built-in landscape id (${Object.keys(LANDSCAPES).join(', ')})`);
        }
        base = b.base;
      }
      return [202, { job: jobs.enqueue('compose', { prompt, base, owner }) }];
    }],

    ['POST', /^\/review$/, async () => [202, { job: jobs.enqueue('review', {}) }]],

    ['GET', /^\/reviews$/, async () => {
      const rows = db.prepare('SELECT * FROM reviews ORDER BY id DESC').all();
      return {
        reviews: rows.map((r) => ({
          id: r.id, at: r.at, feedbackFrom: r.feedback_from, feedbackTo: r.feedback_to, path: r.path, summary: r.summary,
        })),
      };
    }],

    ...jamRoutes({ db, jobs, HttpError, readJson, needListener }),

    ['GET', /^\/jobs\/(\d+)$/, async (_req, [, id]) => {
      const job = jobs.get(Number(id));
      if (!job) throw new HttpError(404, 'no such job');
      return { job };
    }],
  ];

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const cors = corsHeaders(req, corsOrigins);
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    try {
      const path = url.pathname.replace(/\/+$/, '') || '/';
      let match;
      let pathKnown = false;
      for (const [method, re, handler] of routes) {
        const m = path.match(re);
        if (!m) continue;
        pathKnown = true;
        if (method !== req.method) continue;
        match = [handler, m];
        break;
      }
      if (!match) throw new HttpError(pathKnown ? 405 : 404, pathKnown ? 'method not allowed' : 'not found');
      if (path !== '/health' && !authorized(req, apiKey)) throw new HttpError(401, 'unauthorized');
      const out = await match[0](req, match[1], url);
      const [status, body] = Array.isArray(out) ? out : [200, out];
      send(res, status, body, cors);
    } catch (e) {
      const status = e.status ?? 500;
      if (status === 500) console.error(`[radio-api] ${req.method} ${url.pathname}:`, e);
      send(res, status, { error: status === 500 ? 'internal error' : e.message }, cors);
    }
  });

  return { server, jobs };
}
