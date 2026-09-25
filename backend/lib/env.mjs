// Loads backend/.env into process.env with override semantics (the file wins
// over anything PM2 or the shell passed in), like dotenv's { override: true }.
// KEY=value per line; # comments; optional surrounding quotes.

import { readFileSync } from 'node:fs';

export function loadEnv(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return false;
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    process.env[m[1]] = value;
  }
  return true;
}
