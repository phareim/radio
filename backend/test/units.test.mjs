import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseJsonObject, slugify } from '../compose.mjs';
import { extractSummary } from '../review.mjs';
import { loadEnv } from '../lib/env.mjs';

test('parseJsonObject takes fences and stray prose', () => {
  assert.deepEqual(parseJsonObject('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonObject('Sure!\n```json\n{"a":{"b":2}}\n```\nEnjoy.'), { a: { b: 2 } });
  assert.deepEqual(parseJsonObject('Here: {"a":[1,2]} done'), { a: [1, 2] });
  assert.throws(() => parseJsonObject('no json'), /no JSON object/);
});

test('slugify', () => {
  assert.equal(slugify('Amber Tide'), 'amber-tide');
  assert.equal(slugify('Fjøsnissen på Tåke-fjellet!!'), 'fj-snissen-pa-take-fjellet');
  assert.equal(slugify(''), 'landscape');
  assert.ok(slugify('a'.repeat(80)).length <= 32);
});

test('extractSummary reads the Summary section', () => {
  const md = '# Radio review\n\n## Summary\n\nOne.\nTwo.\n\n## Patterns\n\n- x\n';
  assert.equal(extractSummary(md), 'One. Two.');
  assert.equal(extractSummary('## Summary\nOnly this.'), 'Only this.');
});

test('loadEnv overrides what is already set', () => {
  const dir = mkdtempSync(join(tmpdir(), 'radio-env-'));
  const file = join(dir, '.env');
  writeFileSync(file, '# c\nRADIO_T1=from-file\nexport RADIO_T2="quoted"\n\nbad line\n');
  process.env.RADIO_T1 = 'from-shell';
  assert.equal(loadEnv(file), true);
  assert.equal(process.env.RADIO_T1, 'from-file');
  assert.equal(process.env.RADIO_T2, 'quoted');
  assert.equal(loadEnv(join(dir, 'missing')), false);
  rmSync(dir, { recursive: true });
});
