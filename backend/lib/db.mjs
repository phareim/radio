// SQLite store (node:sqlite). One file, five tables.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

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

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('compose', 'review')),
  status TEXT NOT NULL,
  input TEXT,
  result TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
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
  if (!cols('feedback').includes('user')) {
    db.exec('ALTER TABLE feedback ADD COLUMN user TEXT');
    db.prepare('UPDATE feedback SET user = ? WHERE user IS NULL').run(legacy);
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
