#!/usr/bin/env node
// Stands in for `slp -p - --model opus` in the backend tests.
// Compose prompt: echoes the first example landscape from the prompt, renamed.
// Repair prompt: returns "Your JSON" with the scene fixed. Review prompt: a report.
// FAKE_SLP_MODE: 'bad-first' (first compose has an invalid scene), 'fail', 'hang'.
// FAKE_SLP_LOG: append {args, cwd, claudecode, prompt} as JSON lines.
import fs from 'node:fs';

const prompt = fs.readFileSync(0, 'utf8');
const mode = process.env.FAKE_SLP_MODE ?? '';
if (process.env.FAKE_SLP_LOG) {
  fs.appendFileSync(process.env.FAKE_SLP_LOG, JSON.stringify({
    args: process.argv.slice(2), cwd: process.cwd(),
    claudecode: process.env.CLAUDECODE ?? null, entrypoint: process.env.CLAUDE_CODE_ENTRYPOINT ?? null,
    prompt,
  }) + '\n');
}
if (mode === 'hang') setInterval(() => {}, 1000);
else if (mode === 'fail') { process.stderr.write('usage limit reached\n'); process.exit(1); }
else if (prompt.includes('# Radio review')) {
  process.stdout.write('```markdown\n# Radio review\n\n## Summary\n\nListeners like the coast at cruise.\nThe rain drags.\n\n## Patterns\n\n- up on coast (#1)\n\n## Proposed changes\n\n1. none\n```\n');
} else if (prompt.includes('## Validator errors')) {
  const json = JSON.parse(prompt.split('## Your JSON')[1].match(/```json\n([\s\S]*?)\n```/)[1]);
  const scene = prompt.split('## Valid scene ids')[1].trim().split(/[,\s]+/)[0];
  process.stdout.write(JSON.stringify({ ...json, scene }));
} else {
  const example = JSON.parse(prompt.match(/```json\n([\s\S]*?)\n```/)[1]);
  const out = { ...example, name: 'Amber Tide', scene: mode === 'bad-first' ? 'nowhere' : example.id };
  delete out.id; delete out.origin;
  process.stdout.write('Here you go:\n```json\n' + JSON.stringify(out, null, 2) + '\n```\n');
}
