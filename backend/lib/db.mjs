// SQLite store (node:sqlite). One file, seven tables.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const JOBS_COLUMNS = `
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  input TEXT,
  result TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT`;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  rating INTEGER NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  snapshot TEXT NOT NULL,
  landscape TEXT NOT NULL,
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS feedback_landscape ON feedback (landscape);
CREATE INDEX IF NOT EXISTS feedback_unreviewed ON feedback (reviewed_at);

CREATE TABLE IF NOT EXISTS landscapes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  json TEXT NOT NULL,
  prompt TEXT NOT NULL,
  created_at TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0
);

-- kind: compose, review, jam-track, jam-feel, jam-channel (lib/jobs.mjs
-- refuses kinds without a handler).
CREATE TABLE IF NOT EXISTS jobs (
${JOBS_COLUMNS}
);

-- Per-listener settings (which channels show on the dial), keyed by the
-- signed-in email the Worker passes in X-Radio-User.
CREATE TABLE IF NOT EXISTS settings (
  user TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  feedback_from INTEGER,
  feedback_to INTEGER,
  path TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT ''
);

-- jam's saved pieces (engine/piece/types.ts Piece as JSON), per member.
-- Deleting one sets hidden = 1; saving it again brings it back.
CREATE TABLE IF NOT EXISTS jam_pieces (
  owner TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner, id)
);

-- jam's snippets: a member's saved bars (a partial Track) for the library.
CREATE TABLE IF NOT EXISTS jam_snippets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jam_snippets_owner ON jam_snippets (owner);
`;

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/**
 * Columns added after the first release (2026-09-25): a composed landscape
 * belongs to whoever composed it, and feedback remembers who gave it. Rows
 * from before then were all Petter's.
 */
function migrate(db) {
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  const legacy = process.env.RADIO_LEGACY_OWNER || 'phareim@gmail.com';
  if (!cols('landscapes').includes('owner')) {
    db.exec('ALTER TABLE landscapes ADD COLUMN owner TEXT');
    db.prepare('UPDATE landscapes SET owner = ? WHERE owner IS NULL').run(legacy);
  }
  // A composed channel's own painting (backend/paint.mjs), added 2026-09-25.
  const lc = cols('landscapes');
  for (const [col, type] of [['paint_status', 'TEXT'], ['paint_error', 'TEXT'], ['painted_at', 'TEXT']]) {
    if (!lc.includes(col)) db.exec(`ALTER TABLE landscapes ADD COLUMN ${col} ${type}`);
  }
  if (!cols('feedback').includes('user')) {
    db.exec('ALTER TABLE feedback ADD COLUMN user TEXT');
    db.prepare('UPDATE feedback SET user = ? WHERE user IS NULL').run(legacy);
  }
  freeJobKinds(db);
}

/**
 * The first jobs table limited kind to compose/review with a CHECK, which
 * SQLite cannot drop: copy the rows (same ids) into a table without it, in
 * one transaction, and keep the AUTOINCREMENT counter where it was.
 */
function freeJobKinds(db) {
  const sql = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'jobs'`).get()?.sql ?? '';
  if (!/CHECK\s*\(\s*kind/i.test(sql)) return;
  const seq = db.prepare(`SELECT seq FROM sqlite_sequence WHERE name = 'jobs'`).get()?.seq ?? 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`DROP TABLE IF EXISTS jobs_free; CREATE TABLE jobs_free (${JOBS_COLUMNS}\n)`);
    db.exec(`INSERT INTO jobs_free (id, kind, status, input, result, error, created_at, finished_at)
             SELECT id, kind, status, input, result, error, created_at, finished_at FROM jobs`);
    db.exec('DROP TABLE jobs; ALTER TABLE jobs_free RENAME TO jobs');
    const kept = db.prepare(`UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = 'jobs'`).run(seq);
    if (kept.changes === 0 && seq > 0) db.prepare(`INSERT INTO sqlite_sequence (name, seq) VALUES ('jobs', ?)`).run(seq);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export const now = () => new Date().toISOString();

const parse = (s) => {
  if (s == null) return null;
  try { return JSON.parse(s); } catch { return s; }
};

export function feedbackRow(r) {
  return {
    id: r.id,
    at: r.at,
    rating: r.rating,
    comment: r.comment,
    landscape: r.landscape,
    snapshot: parse(r.snapshot),
    reviewedAt: r.reviewed_at ?? null,
  };
}

export function jobRow(r) {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    input: parse(r.input),
    result: parse(r.result),
    error: r.error ?? null,
    createdAt: r.created_at,
    finishedAt: r.finished_at ?? null,
  };
}
