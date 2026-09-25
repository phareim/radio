// Review unreviewed feedback with Opus as composer/producer and write a
// markdown report to reviews/YYYY-MM-DD[-n].md.
//
// From the service: POST /review (queued job). From a shell:
//   node --no-warnings backend/review.mjs            run it
//   node --no-warnings backend/review.mjs --prompt   print the prompt, call nothing

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ROOT, builtinSource, readDoc } from './lib/engine.mjs';
import { askOpus } from './lib/opus.mjs';
import { now } from './lib/db.mjs';

const MAX_ITEMS = Number(process.env.RADIO_REVIEW_MAX ?? 400);

export function reviewsDir() {
  return process.env.RADIO_REVIEWS_DIR ? resolve(process.env.RADIO_REVIEWS_DIR) : join(ROOT, 'reviews');
}

function unreviewed(db) {
  return db
    .prepare('SELECT * FROM feedback WHERE reviewed_at IS NULL ORDER BY id LIMIT ?')
    .all(MAX_ITEMS)
    .map((r) => ({ ...r, snapshot: safeParse(r.snapshot) }));
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

/** One compact line per feedback item. */
function feedbackLine(f) {
  const s = f.snapshot ?? {};
  const c = s.controls ?? {};
  return JSON.stringify({
    id: f.id,
    at: f.at,
    rating: f.rating === 1 ? 'up' : f.rating === -1 ? 'down' : 'comment',
    comment: f.comment || undefined,
    landscape: f.landscape,
    intensity: c.intensity,
    mood: c.mood,
    density: c.density,
    space: c.space,
    grit: c.grit,
    tempo: c.tempo,
    hold: c.hold || undefined,
    key: s.key,
    chords: s.chords,
    section: s.section,
    bar: s.bar,
    active: s.active,
    transition: s.transition && s.transition !== 'none' ? s.transition : undefined,
    engine: s.engineVersion,
  });
}

function tally(items, keyOf) {
  const t = new Map();
  for (const f of items) {
    const k = keyOf(f);
    const row = t.get(k) ?? { up: 0, down: 0, comments: 0 };
    if (f.rating === 1) row.up++;
    if (f.rating === -1) row.down++;
    if (f.comment) row.comments++;
    t.set(k, row);
  }
  return [...t.entries()].map(([k, v]) => `| ${k} | ${v.up} | ${v.down} | ${v.comments} |`).join('\n');
}

function landscapeSources(db, ids) {
  return ids
    .map((id) => {
      const src = builtinSource(id);
      if (src) return `### ${id} (built-in, engine/landscapes/${id}.ts)\n\n\`\`\`ts\n${src.trim()}\n\`\`\``;
      const row = db.prepare('SELECT json FROM landscapes WHERE id = ?').get(id);
      if (row) return `### ${id} (composed by Opus, stored JSON)\n\n\`\`\`json\n${JSON.stringify(JSON.parse(row.json), null, 1)}\n\`\`\``;
      return `### ${id}\n\n(source not found)`;
    })
    .join('\n\n');
}

export function buildReviewPrompt(db, items, date) {
  const ids = [...new Set(items.map((f) => f.landscape))];
  return [
    `You are the composer and record producer behind a generative radio: Petter's background music for working, an electronic semi-retro game soundtrack in the vein of Neon Shrine. Below is listener feedback (thumbs up/down, comments) with a snapshot of what was playing at the moment of each press, the sources of the landscapes involved, and the engine's design notes. Find what the feedback says and turn it into concrete edits.`,
    `## Engine notes (docs/engine.md)\n\n${readDoc('docs/engine.md').trim()}`,
    `## Tallies\n\nPer landscape:\n\n| landscape | up | down | comments |\n|---|---|---|---|\n${tally(items, (f) => f.landscape)}\n\nPer intensity (0 STILL … 4 SURGE):\n\n| intensity | up | down | comments |\n|---|---|---|---|\n${tally(items, (f) => f.snapshot?.controls?.intensity ?? '?')}`,
    `## Feedback (${items.length} items, one JSON per line, oldest first)\n\n${items.map(feedbackLine).join('\n')}`,
    `## Landscape sources\n\n${landscapeSources(db, ids)}`,
    `## Your report

Write markdown with exactly these sections:

# Radio review ${date}
## Summary
Two to four sentences: the main findings.
## Patterns
What is liked and disliked: per landscape, per intensity, around transitions, by voice or layer. Cite feedback ids for every claim; say when the evidence is thin (fewer than three presses).
## Proposed changes
Numbered, most valuable first. Each one: the file, the change (progressions, voices, grooves, bass patterns, levels, fx, ambience, layer order, conductor behaviour), why (feedback ids), and the exact edit as a before/after code block that could be applied as is.
## Keep
What works and must not be touched.
## Listen for
What the feedback cannot settle yet, and what to press the buttons on next time.

Rules: no change without evidence in the feedback; comments outweigh bare thumbs; prefer small, reversible edits; stay inside the schema. Reply with the report only.`,
  ].join('\n\n');
}

function stripOuterFence(text) {
  const m = text.trim().match(/^```(?:markdown|md)?\s*\n([\s\S]*)\n```$/);
  return m ? m[1] : text.trim();
}

export function extractSummary(md) {
  const m = md.match(/^##\s+Summary\s*\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/m);
  return (m ? m[1] : md).trim().replace(/\s+/g, ' ').slice(0, 1000);
}

function localDate() {
  return new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD in the host's zone
}

function reviewPath(date) {
  const dir = reviewsDir();
  mkdirSync(dir, { recursive: true });
  for (let n = 1; ; n++) {
    const file = join(dir, n === 1 ? `${date}.md` : `${date}-${n}.md`);
    if (!existsSync(file)) return file;
  }
}

/** Run one review. Returns { skipped } or { review: {id, path, summary, feedbackFrom, feedbackTo, items} }. */
export async function runReview({ db, ask = askOpus }) {
  const items = unreviewed(db);
  if (items.length === 0) return { skipped: 'no unreviewed feedback' };

  const date = localDate();
  const report = stripOuterFence(await ask(buildReviewPrompt(db, items, date)));
  const file = reviewPath(date);
  writeFileSync(file, report.endsWith('\n') ? report : `${report}\n`);

  const summary = extractSummary(report);
  const from = items[0].id;
  const to = items[items.length - 1].id;
  const at = now();
  const rel = relative(ROOT, file);
  const mark = db.prepare('UPDATE feedback SET reviewed_at = ? WHERE id = ?');
  let reviewId;
  db.exec('BEGIN');
  try {
    for (const f of items) mark.run(at, f.id);
    reviewId = db
      .prepare('INSERT INTO reviews (at, feedback_from, feedback_to, path, summary) VALUES (?, ?, ?, ?, ?)')
      .run(at, from, to, rel, summary).lastInsertRowid;
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { review: { id: Number(reviewId), path: rel, summary, feedbackFrom: from, feedbackTo: to, items: items.length } };
}

// ---- CLI -------------------------------------------------------------------

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const here = dirname(fileURLToPath(import.meta.url));
  const { loadEnv } = await import('./lib/env.mjs');
  const { openDb } = await import('./lib/db.mjs');
  loadEnv(join(here, '.env'));
  const db = openDb(process.env.RADIO_DB ?? join(here, 'data', 'radio.db'));
  if (process.argv.includes('--prompt')) {
    const items = unreviewed(db);
    console.log(items.length ? buildReviewPrompt(db, items, localDate()) : 'No unreviewed feedback.');
  } else {
    console.error('[review] asking Opus (can take a few minutes)…');
    const res = await runReview({ db });
    if (res.skipped) console.log(res.skipped);
    else console.log(`${res.review.path}: ${res.review.items} items (#${res.review.feedbackFrom}–#${res.review.feedbackTo})\n${res.review.summary}`);
  }
  db.close();
}
