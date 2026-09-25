// The backend against the real engine (engine/validate.ts, engine/landscapes/).
// Skips until those files exist.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE = join(HERE, '..', '..', 'engine');
const ready = existsSync(join(ENGINE, 'validate.ts')) && existsSync(join(ENGINE, 'landscapes', 'index.ts'));
delete process.env.RADIO_ENGINE_DIR;

test('real engine: every built-in validates, and a fake compose stores a valid landscape', { skip: !ready && 'engine/validate.ts not there yet' }, async () => {
  const { loadEngine, landscapeSchema } = await import('../lib/engine.mjs');
  const { validateLandscape, LANDSCAPES } = await loadEngine();
  assert.ok(Object.keys(LANDSCAPES).length >= 1);
  for (const [id, l] of Object.entries(LANDSCAPES)) {
    const res = validateLandscape(l);
    assert.equal(res.ok, true, `${id}: ${res.errors.join('; ')}`);
  }
  assert.match(landscapeSchema(), /export interface Landscape/);

  const { openDb } = await import('../lib/db.mjs');
  const { composeLandscape } = await import('../compose.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'radio-engine-test-'));
  const db = openDb(join(dir, 'radio.db'));
  process.env.RADIO_SLP_BIN = join(HERE, 'fixtures', 'fake-slp.mjs');
  try {
    const { landscape } = await composeLandscape({ db, prompt: 'test' });
    assert.equal(landscape.origin, 'opus');
    assert.equal(validateLandscape(landscape).ok, true);
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});
