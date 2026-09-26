// jam's Opus jobs (jam.phareim.no, the radio's sister instrument).
//   jam-track    Opus writes new tracks for a piece, in the bar notation;
//                validated with the piece, one repair round.
//   jam-feel     one turn of the "what does it feel like" conversation, and
//                the brief a painter and a channel name are made from.
//   jam-channel  the piece distilled into a radio Landscape, stored and
//                painted like a compose (compose.mjs generateLandscape). The
//                piece's phrases ride along verbatim as `written` phrases the
//                radio quotes; the service, not Opus, owns their notes.

import { loadPieceEngine, landscapeSchema, pieceNotation, trackType, soundTypes } from './lib/engine.mjs';
import { askOpus } from './lib/opus.mjs';
import { now } from './lib/db.mjs';
import { INTENT, validatorPart, parseJsonObject, generateLandscape } from './compose.mjs';

const PC = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const isObj = (x) => typeof x === 'object' && x !== null && !Array.isArray(x);
const fence = (lang, text) => `\`\`\`${lang}\n${text}\n\`\`\``;
const MAX_ERRORS = 40;

export const JAM_INTENT = `jam is an instrument on the radio's engine. The sound world is the radio's:

${INTENT}

jam differs in one way that matters: the piece is Petter's. He plays it on
piano, guitar, bass, drums and a touch lead, writes it in a step editor and
loops it. You are a bandmate adding a part. Serve the piece: fit its chords,
groove and register, leave room for the parts already there, repeat and vary
rather than fill every bar. A track sounds at its \`enter\` intensity and
above, so a part that enters at 3 may be busier than one entering at 1.`;

export const keyName = (p) => `${PC[p.tonic] ?? p.tonic} ${p.mode}`;

/** The piece as JSON without the feel conversation (prompts give the brief on its own). */
function pieceJson(piece) {
  const { feel, ...rest } = piece;
  return JSON.stringify(rest, null, 1);
}

function chordLabel(c) {
  const tones = c.tones.map((t) => PC[(c.root + t) % 12]).join(' ');
  return `${c.symbol} (${c.degree}: ${tones})`;
}

/** Loop bar by loop bar, the chords that sound, from phraseSpans. */
export function chordChart(piece, phraseSpans) {
  const lines = [];
  phraseSpans(piece).forEach((spans, bar) => {
    if (bar % 8 === 0) {
      const p = bar / 8;
      lines.push(`phrase ${p + 1}, bars ${bar}–${bar + 7}: '${piece.chords[p]}' (${(piece.chordBars ?? 2) === 1 ? '1 bar' : '2 bars'} per token unless ':n')`);
    }
    const text = spans.length === 1
      ? chordLabel(spans[0].chord)
      : spans.map((s) => `steps ${s.from}–${s.from + s.len - 1} ${chordLabel(s.chord)}`).join(', ');
    lines.push(`  bar ${bar}: ${text}`);
  });
  return lines.join('\n');
}

/** Key, tempo, loop and one line per track. */
export function pieceSummary(piece) {
  const bars = piece.phrases * 8;
  const lines = [
    `"${piece.name}": ${keyName(piece)}, ${piece.bpm} bpm, swing ${piece.swing}, ${piece.phrases} phrase${piece.phrases > 1 ? 's' : ''} of 8 bars (${bars} bars loop), left at intensity ${piece.intensity}${piece.base ? `, sounds from the radio landscape '${piece.base}'` : ''}.`,
  ];
  if (!piece.tracks.length) lines.push('No tracks yet.');
  for (const t of piece.tracks) {
    const written = t.bars.filter((b) => b.trim()).length;
    lines.push(`- '${t.id}' ${t.name}: layer ${t.layer}, ${t.voice ? `voice ${t.voice}` : `kit ${t.kit}`}, enters at ${t.enter}, ${written}/${bars} bars written${t.mute ? ', muted' : ''}${t.source ? `, ${t.source}` : ''}`);
  }
  return lines.join('\n');
}

/** A few written bars per track, so a listener can "hear" it. */
function sampleBars(piece, perTrack = 2) {
  const out = [];
  for (const t of piece.tracks) {
    if (t.mute) continue;
    const bars = t.bars.map((b, i) => [i, b]).filter(([, b]) => b.trim()).slice(0, perTrack);
    if (!bars.length) continue;
    out.push(`'${t.id}' (${t.voice ?? t.kit}):\n${bars.map(([i, b]) => `  bar ${i}: ${b}`).join('\n')}`);
  }
  return out.join('\n');
}

function idsPart(E) {
  return [
    `## Voices, kits and drum hits (engine/types.ts)\n\n${fence('ts', soundTypes())}`,
    `Valid ids. voice: ${E.VOICE_IDS.join(', ')}. kit: ${E.KIT_IDS.join(', ')}. layer: ${E.TRACK_LAYERS.join(', ')} (a kit track plays on drums or perc).`,
  ].join('\n\n');
}

function notationPart() {
  return [
    `## Bar notation (engine/piece/types.ts)\n\n${fence('ts', pieceNotation())}`,
    `## The Track type\n\n${fence('ts', trackType())}`,
  ].join('\n\n');
}

const phraseList = (phrases) => phrases.map((p) => `phrase ${p + 1} (bars ${p * 8}–${p * 8 + 7})`).join(', ');

// ---- jam-track ---------------------------------------------------------------

export function buildTrackPrompt({ piece, request, layer, phrases, E }) {
  const bars = piece.phrases * 8;
  const room = E.MAX_TRACKS - piece.tracks.length;
  const asks = [request];
  if (layer) asks.push(`Layer: ${layer}.`);
  if (phrases?.length) asks.push(`Write only in ${phraseList(phrases)}; leave every other bar an empty string.`);
  return [
    'You are a bandmate in jam, Petter\'s instrument. He is playing the piece below and asks you to add a part: new tracks in jam\'s bar notation, which he will hear muted-in and then keep or drop.',
    `## Musical intent\n\n${JAM_INTENT}`,
    notationPart(),
    idsPart(E),
    `## The piece\n\n${pieceSummary(piece)}\n\n${fence('json', pieceJson(piece))}`,
    `## Chord chart (what sounds in each bar of the loop)\n\n${chordChart(piece, E.phraseSpans)}`,
    `## What Petter wants\n\n${asks.join('\n\n')}`,
    `## Output

Reply with ONE JSON object and nothing else (no prose, no code fence):
{ "tracks": [Track, ...], "note": "one line on what you added" }

- Usually one track; more only when the request calls for it (at most ${room}).
- Each track: id, name (at most 40 chars), layer, exactly one of voice (note bars) or kit (drum bars), instrument (optional), enter 0..4, gain (optional), and bars: exactly ${bars} strings, one per loop bar, '' for a bar left empty. \`source\` is set for you.
- Fit the chord chart: chord tones on the strong beats, scale tones of ${keyName(piece)} between, voice leading that moves little. Mind the register of the parts already there.
- Write the note in the language of Petter's request.`,
  ].join('\n\n');
}

export function buildTrackRepairPrompt({ piece, json, errors, E }) {
  return [
    'You wrote these tracks for a piece in jam, but the validator rejected them.',
    notationPart(),
    idsPart(E),
    `## The piece's shape\n\n${keyName(piece)}; ${piece.phrases} phrase(s), so every track needs exactly ${piece.phrases * 8} bar strings. Existing track ids: ${piece.tracks.map((t) => t.id).join(', ') || '(none)'}.`,
    `## Your tracks\n\n${fence('json', json)}`,
    `## Validator errors\n\n${errors.slice(0, MAX_ERRORS).map((e) => `- ${e}`).join('\n')}${errors.length > MAX_ERRORS ? `\n- … and ${errors.length - MAX_ERRORS} more of the same kinds` : ''}`,
    '## Output\n\nFix every error and change nothing else. Reply with the corrected JSON object `{ "tracks": [...], "note": "..." }` only: no prose, no code fence.',
  ].join('\n\n');
}

const slugId = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28);

/** Source 'opus', ids unique against the piece and each other, bars outside `phrases` emptied. */
export function stampTracks(tracks, piece, phrases) {
  const taken = new Set(piece.tracks.map((t) => t.id));
  return tracks.map((t, i) => {
    if (!isObj(t)) return t;
    const out = { ...t, source: 'opus' };
    const want = typeof t.id === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(t.id) ? t.id : slugId(t.name) || `opus-${i + 1}`;
    let id = want;
    for (let n = 2; taken.has(id); n++) id = `${want.slice(0, 28)}-${n}`;
    taken.add(id);
    out.id = id;
    if (phrases?.length && Array.isArray(out.bars)) out.bars = out.bars.map((b, j) => (phrases.includes(Math.floor(j / 8)) ? b : ''));
    return out;
  });
}

/** Parse, stamp and validate one reply against the piece. */
export function checkTracks(reply, { piece, layer, phrases, E }) {
  let obj;
  try {
    obj = parseJsonObject(reply);
  } catch (e) {
    return { ok: false, errors: [`not valid JSON: ${e.message}`], json: String(reply) };
  }
  if (!isObj(obj) || !Array.isArray(obj.tracks)) {
    return { ok: false, errors: ['the reply must be an object { "tracks": [...], "note": "..." }'], json: JSON.stringify(obj, null, 1) };
  }
  const tracks = stampTracks(obj.tracks, piece, phrases);
  const note = typeof obj.note === 'string' ? obj.note.trim().split('\n')[0].slice(0, 300) : '';
  const json = JSON.stringify({ tracks, note }, null, 1);
  const k = piece.tracks.length;
  const errors = [];
  if (!tracks.length) errors.push('tracks: at least one new track');
  const res = E.validatePiece({ ...piece, tracks: [...piece.tracks, ...tracks] });
  for (const e of res.errors) {
    // The validator counts the piece's tracks too; point at the reply's own list.
    const m = e.match(/^tracks\[(\d+)\](.*)$/);
    if (m) errors.push(Number(m[1]) >= k ? `tracks[${Number(m[1]) - k}]${m[2]}` : e);
    else if (/^tracks: at most/.test(e)) errors.push(`tracks: at most ${E.MAX_TRACKS - k} new tracks (the piece has ${k})`);
    else errors.push(e);
  }
  if (layer) tracks.forEach((t, i) => { if (isObj(t) && t.layer !== layer) errors.push(`tracks[${i}] '${t.id}'.layer: Petter asked for the ${layer} layer`); });
  if (errors.length) return { ok: false, errors, json };
  return { ok: true, errors: [], tracks: res.piece.tracks.slice(k), note, json };
}

/** jam-track: { tracks: Track[], note, repaired }. */
export async function jamTrack({ piece, request, layer, phrases, ask = askOpus }) {
  const E = await loadPieceEngine();
  const ctx = { piece, layer, phrases, E };
  let res = checkTracks(await ask(buildTrackPrompt({ piece, request, layer, phrases, E })), ctx);
  let repaired = false;
  if (!res.ok) {
    console.log(`[radio-api] jam-track: ${res.errors.length} validation errors, asking for a repair`);
    res = checkTracks(await ask(buildTrackRepairPrompt({ piece, json: res.json, errors: res.errors, E })), ctx);
    repaired = true;
  }
  if (!res.ok) throw new Error(`tracks still invalid after one repair: ${res.errors.slice(0, 20).join('; ')}`);
  return { tracks: res.tracks, note: res.note, repaired };
}

// ---- jam-feel ----------------------------------------------------------------

export function buildFeelPrompt({ piece, messages, E }) {
  const brief = piece.feel?.brief?.trim();
  const talk = messages.length
    ? messages.map((m) => `${m.role === 'petter' ? 'Petter' : 'You'}: ${m.text}`).join('\n\n')
    : '(nothing yet: you open the conversation)';
  return [
    'You are Petter\'s friend, sitting in while he plays a piece in jam, his instrument on the engine of his generative radio. He wants to make the piece a radio channel with its own painted pixel scene, and first wants to find what it feels like. You listen and talk it through with him: what place it sounds like, the time of day, the weather and the light, who is there and what they are doing.',
    `## The piece\n\n${pieceSummary(piece)}`,
    `## Chord chart\n\n${chordChart(piece, E.phraseSpans)}`,
    `## A few bars of each part (jam's bar notation: <step>:<pitches>:<len>[:<vel>] in sixteenths; drums <hit>:<16 steps>)\n\n${sampleBars(piece) || '(no parts written yet)'}`,
    `## The brief so far\n\n${brief || '(none yet)'}`,
    `## The conversation so far\n\n${talk}`,
    `## How to answer

- Two to four sentences. Talk like a friend who hears the music, not like a critic or an assistant: react to what he said, name something concrete you hear (a bass line, the hats, where the chords turn), and ask ONE question.
- Answer in the language Petter writes in. He mostly writes Norwegian bokmål; then write natural bokmål, not Danish or dialect. If he has not written yet, open in bokmål with what you hear and your first question.
- Keep the brief: two to four sentences in English, for a painter who paints the channel's pixel scene and names it: the place, time of day, weather, light, who or what is there, the mood. Fold in everything settled so far; what Petter said wins over your guesses.`,
    '## Output\n\nReply with ONE JSON object and nothing else: `{ "reply": "...", "brief": "..." }`',
  ].join('\n\n');
}

/** jam-feel: { reply, brief }. A reply that is not JSON is taken as the reply, the brief kept. */
export async function jamFeel({ piece, messages = [], ask = askOpus }) {
  const E = await loadPieceEngine();
  const text = await ask(buildFeelPrompt({ piece, messages, E }));
  const before = piece.feel?.brief ?? '';
  let obj = null;
  try { obj = parseJsonObject(text); } catch { /* prose */ }
  const reply = typeof obj?.reply === 'string' && obj.reply.trim() ? obj.reply.trim() : String(text).trim();
  const brief = typeof obj?.brief === 'string' && obj.brief.trim() ? obj.brief.trim() : before;
  return { reply: reply.slice(0, 2000), brief: brief.slice(0, 1200) };
}

// ---- jam-channel -------------------------------------------------------------

/** The piece's base landscape: a built-in, or one of the owner's composed channels. */
export function baseLandscape(db, id, owner, LANDSCAPES) {
  if (!id) return undefined;
  if (LANDSCAPES[id]) return LANDSCAPES[id];
  const row = owner ? db.prepare('SELECT json FROM landscapes WHERE id = ? AND owner = ?').get(id, owner) : null;
  return row ? JSON.parse(row.json) : undefined;
}

/** The prompt part about the draft's written phrases (only when it has some). */
function writtenPart(draft) {
  if (!draft.written?.length) return [];
  const list = draft.written.map((w, i) => `written[${i}] '${w.name}': '${w.chords}', parts ${w.parts.map((p) => `${p.layer} (${p.voice ?? p.kit}, enters at ${p.enter})`).join(', ')}`).join('\n');
  return [`## Written phrases

The draft's \`written\` holds the piece's phrases note for note: each phrase's progression and one part per track, eight bars in the bar notation above. The channel keeps them verbatim. Now and then (\`quote\`, the chance a section does it) the radio plays one of them for eight bars in place of a phrase of its own, so the piece comes back between the generated music; layers the phrase has no part on keep being composed over its chords.

${list}

Copy \`written\` unchanged: the same phrases in the same order, every part and bar as it is. You may give each phrase a \`name\` (at most 24 characters: what it is to a listener, like 'theme' or 'the turn') and a \`weight\`, and set \`quote\` (0..1; the draft's ${draft.quote} is a good default, higher when the piece should come back often, lower for a channel that mostly wanders). The phrases are written in the key of \`tonic\` and the mode at mood 0.5, so keep \`tonic\`, \`moods\` and \`mood\` giving that mode, and keep each part's layer on the \`layers\` ladder from its \`enter\` level up. Compose the generative rest of the channel around them: its own progressions, patterns and motifs should sound like the same place.`];
}

export function buildChannelPrompt({ piece, draft, brief, E }) {
  return [
    'You are turning a piece from jam (Petter\'s instrument on the radio\'s engine) into a channel for his generative radio: one Landscape JSON object that the engine plays for hours.',
    `## Musical intent\n\n${INTENT}`,
    `## The schema (TypeScript, from engine/types.ts)\n\n${fence('ts', landscapeSchema())}`,
    ...validatorPart(),
    `## The piece\n\n${pieceSummary(piece)}\n\n${fence('ts', pieceNotation())}\n\n${fence('json', pieceJson(piece))}`,
    `## The draft\n\nThe piece read back as a Landscape by engine/piece/derive.ts (\`pieceToLandscape\`): its progressions, its bass line as a pattern of chord functions, its grooves per intensity, its lead's openings as motifs, its voices and ladder, over its base landscape${piece.base ? ` '${piece.base}'` : ''}. It passes the validator as it is.\n\n${fence('json', JSON.stringify(draft, null, 1))}`,
    `## What to do

Keep its progressions, grooves, bass patterns and motifs as written; add what a channel needs to last for hours: a contrasting 'b' progression if missing, patterns for every intensity, fills, ambience. Every per-intensity array must make sense on its own. Name, blurb, accent colour, ambience and scene come from the feel below.`,
    ...writtenPart(draft),
    `## The feel\n\n${brief || `(no brief yet: go by the piece's name, "${piece.name}", and how it sounds)`}`,
    `## Scene\n\n\`scene\` must be one of these painted scene ids (pick the place closest to the feel; the channel may get its own painting later): ${E.SCENES.map((s) => `\`${s}\``).join(', ')}.`,
    '## Output\n\nReply with ONE JSON object, the complete Landscape, and nothing else: no prose, no code fence. Use only the voice, kit, ambience, mode and layer names from the schema. Give it a short evocative `name` (at most 24 characters), a one-line `blurb`, and an `accent` hex colour. Leave `id`, `origin` and `prompt` out; they are set for you.',
  ].join('\n\n');
}

const SPEC_OF = { arp: 'arp', lead: 'lead', counter: 'counter', bells: 'bells', drone: 'drone' };

/**
 * Opus's landscape with the draft's written phrases put back, so the model
 * never alters a note: `written` is the draft's (Opus's names and weights
 * kept where valid, matched by position), `quote` Opus's if 0..1 else the
 * draft's; `tonic` is the draft's and the mode at mood 0.5 too (the notes
 * are written in that key), and every part's layer is on the ladder from
 * its enter level up, with the draft's spec for it if Opus dropped one.
 * Without written phrases in the draft, `written` and `quote` are removed.
 */
export function enforceWritten(obj, draft, E) {
  if (!isObj(obj)) return obj;
  const out = { ...obj };
  if (!draft.written?.length) {
    delete out.written;
    delete out.quote;
    return out;
  }
  const theirs = Array.isArray(obj.written) ? obj.written : [];
  out.written = draft.written.map((w, i) => {
    const t = isObj(theirs[i]) ? theirs[i] : {};
    const phrase = structuredClone(w);
    if (typeof t.name === 'string' && t.name.trim() && t.name.trim().length <= 24) phrase.name = t.name.trim();
    if (typeof t.weight === 'number' && Number.isFinite(t.weight) && t.weight > 0 && t.weight <= 10) phrase.weight = t.weight;
    return phrase;
  });
  out.quote = typeof obj.quote === 'number' && obj.quote >= 0 && obj.quote <= 1 ? obj.quote : draft.quote;
  out.tonic = draft.tonic;
  let mode = null;
  try { mode = E.modeFor(out, 0.5); } catch { /* moods not a list */ }
  if (mode !== E.modeFor(draft, 0.5)) {
    out.moods = draft.moods;
    out.mood = draft.mood;
  }
  if (Array.isArray(out.layers) && out.layers.length === 5 && out.layers.every(Array.isArray)) {
    out.layers = out.layers.map((ls) => [...ls]);
    for (const w of draft.written) for (const p of w.parts) {
      for (let lvl = p.enter; lvl < 5; lvl++) if (!out.layers[lvl].includes(p.layer)) out.layers[lvl].push(p.layer);
      const k = SPEC_OF[p.layer];
      if (k && out[k] === undefined && draft[k] !== undefined) out[k] = draft[k];
      if (p.layer === 'perc' && isObj(out.drums) && out.drums.perc === undefined && draft.drums.perc) out.drums = { ...out.drums, perc: draft.drums.perc };
    }
  }
  return out;
}

/**
 * jam-channel: { landscape, repaired }. Stored like a compose (owner, origin
 * 'opus'); the owner's saved copy of the piece gets `channel`. The caller
 * paints. With `written` (default) the piece's phrases come along as
 * written phrases (enforceWritten); `written: false` makes a purely
 * generative channel.
 */
export async function jamChannel({ db, piece, owner = null, written = true, ask = askOpus }) {
  const E = await loadPieceEngine();
  const draft = E.pieceToLandscape(piece, baseLandscape(db, piece.base, owner, E.LANDSCAPES), { written });
  const brief = piece.feel?.brief?.trim() ?? '';
  const prompt = [brief, `(made in jam from "${piece.name}")`].filter(Boolean).join('\n\n');
  const first = buildChannelPrompt({ piece, draft, brief, E });
  const fix = (obj) => enforceWritten(obj, draft, E);
  const res = await generateLandscape({ db, first, prompt, owner, ask, label: 'jam-channel', fix });

  const row = owner ? db.prepare('SELECT json FROM jam_pieces WHERE owner = ? AND id = ?').get(owner, piece.id) : null;
  if (row) {
    const saved = { ...JSON.parse(row.json), channel: res.landscape.id };
    db.prepare('UPDATE jam_pieces SET json = ?, updated_at = ? WHERE owner = ? AND id = ?')
      .run(JSON.stringify(saved), now(), owner, piece.id);
  }
  return res;
}
