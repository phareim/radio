// SQLite store (node:sqlite). One file, four tables.

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
  return db;
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
