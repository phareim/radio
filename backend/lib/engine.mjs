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

/** { validateLandscape, LANDSCAPES, dir } — loaded once per process. */
export async function loadEngine() {
  if (cached) return cached;
  const dir = engineDir();
  const validate = await import(pathToFileURL(join(dir, 'validate.ts')).href);
  const index = await import(pathToFileURL(join(dir, 'landscapes', 'index.ts')).href);
  cached = { validateLandscape: validate.validateLandscape, LANDSCAPES: index.LANDSCAPES, dir };
  return cached;
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
