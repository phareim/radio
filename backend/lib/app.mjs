// The HTTP app: routes, auth, CORS. server.mjs starts it; tests build it on a temp DB.

import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { now, feedbackRow } from './db.mjs';
import { createJobs } from './jobs.mjs';
import { loadEngine } from './engine.mjs';
import { composeLandscape } from '../compose.mjs';
import { runReview } from '../review.mjs';

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
    'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

export function createApp({ db, apiKey, corsOrigins = [], ask }) {
  const jobs = createJobs(db, {
    compose: (input) => composeLandscape({ db, prompt: input.prompt, base: input.base, ask }),
    review: () => runReview({ db, ask }),
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
      const r = db.prepare('INSERT INTO feedback (at, rating, comment, snapshot, landscape) VALUES (?, ?, ?, ?, ?)')
        .run(now(), b.rating, comment, JSON.stringify(b.snapshot), landscape);
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

    ['GET', /^\/landscapes$/, async () => {
      const rows = db.prepare('SELECT json FROM landscapes WHERE hidden = 0 ORDER BY created_at').all();
      return { landscapes: rows.map((r) => JSON.parse(r.json)) };
    }],

    ['DELETE', /^\/landscapes\/([A-Za-z0-9_-]+)$/, async (_req, [, id]) => {
      const r = db.prepare('UPDATE landscapes SET hidden = 1 WHERE id = ?').run(id);
      if (r.changes === 0) throw new HttpError(404, 'no such landscape');
      return { id, hidden: true };
    }],

    ['POST', /^\/compose$/, async (req) => {
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
      return [202, { job: jobs.enqueue('compose', { prompt, base }) }];
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
