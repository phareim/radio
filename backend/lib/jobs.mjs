// Job queue: rows in `jobs`, run one at a time (one Opus call at a time).
// Jobs left queued or running by a restart are marked as errors at startup.

import { now, jobRow } from './db.mjs';

export function createJobs(db, handlers) {
  let chain = Promise.resolve();
  let pending = 0;

  db.prepare(
    `UPDATE jobs SET status = 'error', error = 'interrupted by a restart', finished_at = ?
     WHERE status IN ('queued', 'running')`,
  ).run(now());

  const get = (id) => {
    const r = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    return r ? jobRow(r) : null;
  };

  async function run(id, kind, input) {
    db.prepare(`UPDATE jobs SET status = 'running' WHERE id = ?`).run(id);
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

  function enqueue(kind, input) {
    if (!handlers[kind]) throw new Error(`unknown job kind ${kind}`);
    const { lastInsertRowid } = db
      .prepare(`INSERT INTO jobs (kind, status, input, created_at) VALUES (?, 'queued', ?, ?)`)
      .run(kind, JSON.stringify(input ?? null), now());
    const id = Number(lastInsertRowid);
    pending++;
    chain = chain.then(() => run(id, kind, input));
    return get(id);
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
