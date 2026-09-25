// Compose a new landscape with Opus from Petter's request.
// Prompt → JSON → force origin/id/prompt → validate → (one repair round) → store.

import { randomBytes } from 'node:crypto';
import { loadEngine, landscapeSchema, validatorSource } from './lib/engine.mjs';
import { askOpus } from './lib/opus.mjs';
import { now } from './lib/db.mjs';

const EXAMPLE_PREFERENCE = ['coast', 'neonrain', 'voyager', 'jungle', 'frostwood'];

const INTENT = `The radio is Petter's generative background music for working: electronic,
semi-retro game soundtrack in the vein of Neon Shrine (his synthwave Zelda-like):
detuned square and saw leads, pads, chip and synthwave drums, warm tape, places
you could walk around in. It runs for hours in the background, so it must be
pleasant to leave on: clear harmony, motifs that repeat and vary, nothing harsh
or attention-grabbing, grooves that sit rather than show off. The listener steers
intensity 0..4 (STILL, DRIFT, CRUISE, DRIVE, SURGE); layers enter as intensity
rises, so every per-intensity array must make musical sense on its own:
level 0 is near-ambient, level 4 is the full band.`;

function pickExamples(LANDSCAPES, base) {
  const ids = Object.keys(LANDSCAPES);
  const order = [...EXAMPLE_PREFERENCE.filter((id) => ids.includes(id)), ...ids];
  const picked = [];
  for (const id of order) {
    if (id !== base && !picked.includes(id)) picked.push(id);
    if (picked.length === 2) break;
  }
  return picked;
}

const asJson = (o) => JSON.stringify(o, null, 1);

function validatorPart() {
  const src = validatorSource();
  return src ? [`## The validator (engine/validate.ts): your JSON must pass it\n\n\`\`\`ts\n${src}\n\`\`\``] : [];
}

export function buildComposePrompt({ prompt, base, LANDSCAPES }) {
  const sceneIds = Object.keys(LANDSCAPES);
  const examples = pickExamples(LANDSCAPES, base);
  const parts = [
    'You are composing a new landscape for a generative radio: one JSON object that the engine plays.',
    `## Musical intent\n\n${INTENT}`,
    `## The schema (TypeScript, from engine/types.ts)\n\n\`\`\`ts\n${landscapeSchema()}\n\`\`\``,
    ...validatorPart(),
    `## Built-in landscapes as examples\n\n${examples
      .map((id) => `### ${id}\n\n\`\`\`json\n${asJson(LANDSCAPES[id])}\n\`\`\``)
      .join('\n\n')}`,
  ];
  if (base && LANDSCAPES[base]) {
    parts.push(
      `## Start from this one\n\nPetter asked for a variation on \`${base}\`. Keep what makes it that place, change what the request asks for.\n\n\`\`\`json\n${asJson(LANDSCAPES[base])}\n\`\`\``,
    );
  }
  parts.push(
    `## Scene\n\n\`scene\` must be one of these built-in scene ids (pick the painted place closest to the mood): ${sceneIds.map((s) => `\`${s}\``).join(', ')}.`,
    `## Petter's request\n\n${prompt}`,
    `## Output\n\nReply with ONE JSON object, the complete Landscape, and nothing else: no prose, no code fence. Use only the voice, kit, ambience, mode and layer names from the schema. Give it a short evocative \`name\` (at most 24 characters), a one-line \`blurb\`, and an \`accent\` hex colour. Leave \`id\`, \`origin\` and \`prompt\` out; they are set for you.`,
  );
  return parts.join('\n\n');
}

export function buildRepairPrompt({ json, errors, LANDSCAPES }) {
  return [
    'You composed this landscape JSON for a generative radio engine, but the validator rejected it.',
    `## The schema (TypeScript, from engine/types.ts)\n\n\`\`\`ts\n${landscapeSchema()}\n\`\`\``,
    ...validatorPart(),
    `## Valid scene ids\n\n${Object.keys(LANDSCAPES).join(', ')}`,
    `## Your JSON\n\n\`\`\`json\n${json}\n\`\`\``,
    `## Validator errors\n\n${errors.map((e) => `- ${e}`).join('\n')}`,
    '## Output\n\nFix every error and change nothing else. Reply with the corrected JSON object only: no prose, no code fence.',
  ].join('\n\n');
}

/** Pull one JSON object out of a model reply (fences, stray prose). */
export function parseJsonObject(text) {
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in the reply');
  return JSON.parse(t.slice(start, end + 1));
}

export function slugify(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/, '') || 'landscape';
}

function freshId(db, name, LANDSCAPES) {
  const exists = db.prepare('SELECT 1 FROM landscapes WHERE id = ?');
  for (;;) {
    const id = `${slugify(name)}-${randomBytes(2).toString('hex')}`;
    if (!LANDSCAPES[id] && !exists.get(id)) return id;
  }
}

/** Parse, stamp and validate one reply. Returns { ok, errors, landscape, json }. */
function check(reply, { db, prompt, id, validateLandscape, LANDSCAPES }) {
  let obj;
  try {
    obj = parseJsonObject(reply);
  } catch (e) {
    return { ok: false, errors: [`not valid JSON: ${e.message}`], json: reply };
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, errors: ['the reply is not a JSON object'], json: reply };
  }
  const stamped = { ...obj, id: id ?? freshId(db, obj.name, LANDSCAPES), origin: 'opus', prompt };
  const json = JSON.stringify(stamped, null, 1);
  const res = validateLandscape(stamped);
  const errors = [...(res.errors ?? [])];
  const scenes = Object.keys(LANDSCAPES);
  if (!scenes.includes(stamped.scene) && !errors.some((e) => e.startsWith('scene'))) {
    errors.push(`scene must be one of the built-in ids (${scenes.join(', ')}); got ${JSON.stringify(stamped.scene)}`);
  }
  const ok = res.ok && errors.length === 0;
  const landscape = ok ? { ...(res.landscape ?? stamped), id: stamped.id, origin: 'opus', prompt } : undefined;
  return { ok, errors, landscape, json, id: stamped.id };
}

/**
 * Compose, validate (one repair round), store. Throws with the validator's
 * errors if the repaired landscape is still invalid.
 */
export async function composeLandscape({ db, prompt, base, ask = askOpus }) {
  const { validateLandscape, LANDSCAPES } = await loadEngine();
  if (base && !LANDSCAPES[base]) throw new Error(`unknown base landscape ${base}`);
  const ctx = { db, prompt, validateLandscape, LANDSCAPES };

  const first = await ask(buildComposePrompt({ prompt, base, LANDSCAPES }));
  let res = check(first, ctx);
  let repaired = false;
  if (!res.ok) {
    console.log(`[radio-api] compose: ${res.errors.length} validation errors, asking for a repair`);
    const second = await ask(buildRepairPrompt({ json: res.json, errors: res.errors, LANDSCAPES }));
    res = check(second, { ...ctx, id: res.id });
    repaired = true;
  }
  if (!res.ok) throw new Error(`landscape still invalid after one repair: ${res.errors.join('; ')}`);

  const l = res.landscape;
  db.prepare('INSERT INTO landscapes (id, name, json, prompt, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(l.id, String(l.name ?? l.id), JSON.stringify(l), prompt, now());
  return { landscape: l, repaired };
}
