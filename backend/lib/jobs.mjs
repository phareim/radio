// Job queue: rows in `jobs`, run one at a time (one Opus call at a time).
// A restart (every deploy restarts radio-api) picks up the jobs it left
// queued or running and runs them again; a job that has already been started
// twice is marked as an error instead, so one that kills the process cannot
// loop.

import { now, jobRow } from './db.mjs';

/** Starts a job may have before a restart gives up on it. */
export const MAX_ATTEMPTS = 2;

export function createJobs(db, handlers, { maxPending = 20 } = {}) {
  let chain = Promise.resolve();
  let pending = 0;

  /** A job as `who` may see it: null when there is none or it is someone else's. */
  const get = (id, who) => {
    const r = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    return r && (r.owner == null || r.owner === who) ? jobRow(r) : null;
  };

  async function run(id, kind, input) {
    db.prepare(`UPDATE jobs SET status = 'running', attempts = attempts + 1 WHERE id = ?`).run(id);
    try {
      const result = await handlers[kind](input);
      db.prepare(`UPDATE jobs SET status = 'done', result = ?, finished_at = ? WHERE id = ?`)
        .run(JSON.stringify(result ?? null), now(), id);
    } catch (e) {
      console.error(`[radio-api] job ${id} (${kind}) failed: ${e.message}`);
      db.prepare(`UPDATE jobs SET status = 'error', error = ?, finished_at = ? WHERE id = ?`)
        .run(String(e.message ?? e).slice(0, 4000), now(), id);
    } finally {
      pending--;
    }
  }

  function schedule(id, kind, input) {
    pending++;
    chain = chain.then(() => run(id, kind, input));
  }

  const left = db.prepare(`SELECT id, kind, input, attempts FROM jobs WHERE status IN ('queued', 'running') ORDER BY id`).all();
  for (const j of left) {
    if (j.attempts < MAX_ATTEMPTS && handlers[j.kind]) {
      db.prepare(`UPDATE jobs SET status = 'queued' WHERE id = ?`).run(j.id);
      schedule(j.id, j.kind, j.input == null ? null : JSON.parse(j.input));
    } else {
      db.prepare(`UPDATE jobs SET status = 'error', error = 'interrupted by a restart', finished_at = ? WHERE id = ?`)
        .run(now(), j.id);
    }
  }

  function enqueue(kind, input) {
    if (!handlers[kind]) throw new Error(`unknown job kind ${kind}`);
    if (pending >= maxPending) throw Object.assign(new Error('the queue is full, try again in a few minutes'), { status: 503 });
    const { lastInsertRowid } = db
      .prepare(`INSERT INTO jobs (kind, status, input, owner, created_at) VALUES (?, 'queued', ?, ?, ?)`)
      .run(kind, JSON.stringify(input ?? null), input?.owner ?? null, now());
    const id = Number(lastInsertRowid);
    schedule(id, kind, input);
    return get(id, input?.owner ?? null);
  }

  return {
    enqueue,
    get,
    /** Jobs queued or running in this process. */
    get pending() { return pending; },
    /** Resolves when the queue is empty (tests). */
    idle: () => chain,
  };
}
