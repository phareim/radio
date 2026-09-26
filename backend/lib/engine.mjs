// The engine's pure TS modules, imported directly (Node strips the types).
// RADIO_ENGINE_DIR points tests at a stub; the default is the repo's engine/.

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function engineDir() {
  return process.env.RADIO_ENGINE_DIR ? resolve(process.env.RADIO_ENGINE_DIR) : join(ROOT, 'engine');
}

let cached = null;

/**
 * { validateLandscape, LANDSCAPES, SCENES, dir } — loaded once per process.
 * SCENES is every painted scene (catalog.ts), which includes those painted
 * for composed channels; without a catalog it is the built-in ids.
 */
export async function loadEngine() {
  if (cached) return cached;
  const dir = engineDir();
  const validate = await import(pathToFileURL(join(dir, 'validate.ts')).href);
  const index = await import(pathToFileURL(join(dir, 'landscapes', 'index.ts')).href);
  const catalogFile = join(dir, 'catalog.ts');
  const catalog = existsSync(catalogFile) ? await import(pathToFileURL(catalogFile).href) : {};
  const SCENES = [...(catalog.SCENE_IDS ?? Object.keys(index.LANDSCAPES))];
  cached = { validateLandscape: validate.validateLandscape, LANDSCAPES: index.LANDSCAPES, SCENES, dir };
  return cached;
}

let pieceCached = null;

/**
 * loadEngine() plus jam's piece module (engine/piece/index.ts) and the id
 * lists from catalog.ts: { validatePiece, pieceToLandscape, phraseSpans,
 * parseNoteBar, parseDrumBar, VOICE_IDS, KIT_IDS, TRACK_LAYERS, ... }.
 * Separate from loadEngine so the radio's own routes never depend on the
 * piece module loading.
 */
export async function loadPieceEngine() {
  if (pieceCached) return pieceCached;
  const base = await loadEngine();
  const piece = await import(pathToFileURL(join(base.dir, 'piece', 'index.ts')).href);
  const catalogFile = join(base.dir, 'catalog.ts');
  const catalog = existsSync(catalogFile) ? await import(pathToFileURL(catalogFile).href) : {};
  const list = (k) => [...(catalog[k] ?? piece[k] ?? [])];
  pieceCached = {
    ...base,
    validatePiece: piece.validatePiece,
    pieceToLandscape: piece.pieceToLandscape,
    phraseSpans: piece.phraseSpans,
    parseNoteBar: piece.parseNoteBar,
    parseDrumBar: piece.parseDrumBar,
    MAX_TRACKS: piece.MAX_TRACKS ?? 24,
    VOICE_IDS: list('VOICE_IDS'),
    KIT_IDS: list('KIT_IDS'),
    DRUM_HITS: list('DRUM_HITS'),
    /** Layers a track may play on (every layer but ambience). */
    TRACK_LAYERS: list('LAYER_IDS').filter((l) => l !== 'ambience'),
  };
  return pieceCached;
}

/** The header comment of engine/piece/types.ts: the piece format and the bar notation. */
export function pieceNotation() {
  const text = readEngineFile(join('piece', 'types.ts'));
  const end = text.indexOf('*/');
  return end > 0 ? text.slice(0, end + 2).trim() : '';
}

/** Level, TrackSource, Instrument and Track from engine/piece/types.ts. */
export function trackType() {
  const text = readEngineFile(join('piece', 'types.ts'));
  const start = text.indexOf('export type Level');
  const t = text.indexOf('export interface Track');
  const end = t >= 0 ? text.indexOf('\n}', t) : -1;
  return start >= 0 && end > start ? text.slice(start, end + 2).trim() : '';
}

/** VoiceId, KitId and DrumHit with their one-line descriptions, from engine/types.ts. */
export function soundTypes() {
  const text = readEngineFile('types.ts');
  const start = text.indexOf('/**\n * Pitched voices');
  const end = text.indexOf('/** Background textures');
  return start >= 0 && end > start ? text.slice(start, end).trim() : '';
}

function readEngineFile(rel) {
  const file = join(engineDir(), rel);
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

/** The Landscape part of types.ts (theory through landscapes), for prompts. */
export function landscapeSchema() {
  const text = readFileSync(join(engineDir(), 'types.ts'), 'utf8');
  const start = text.indexOf('// ---- theory');
  const end = text.indexOf('// ---- controls');
  return start >= 0 && end > start ? text.slice(start, end).trim() : text;
}

/** The validator's source (its limits go in the compose prompt), or ''. */
export function validatorSource() {
  const file = join(engineDir(), 'validate.ts');
  if (!existsSync(file)) return '';
  const text = readFileSync(file, 'utf8');
  const start = text.indexOf('export function validateLandscape');
  return (start >= 0 ? text.slice(start) : text).trim();
}

/** Source of a built-in landscape file, or null. */
export function builtinSource(id) {
  if (!/^[a-z0-9_-]+$/i.test(id)) return null;
  const file = join(engineDir(), 'landscapes', `${id}.ts`);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

export function readDoc(rel) {
  const file = join(ROOT, rel);
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}
