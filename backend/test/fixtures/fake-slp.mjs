#!/usr/bin/env node
// Stands in for `slp -p - --model opus` in the backend tests.
// Compose prompt: echoes the first example landscape from the prompt, renamed.
// Repair prompt: returns "Your JSON" with the scene fixed. Review prompt: a report.
// jam: track → a bass track (id 'bass', so it collides); track repair → H4 → C4;
// feel → { reply, brief } ('prose' mode: plain text); channel → the draft, renamed.
// FAKE_SLP_MODE: 'bad-first' (first compose/channel has an invalid scene, first
// track a bad pitch), 'fail', 'hang', 'prose', 'mangle' (channel: alters the
// written phrases' notes, names, weights, quote, tonic and ladder, or invents
// written phrases when the draft has none).
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
} else if (prompt.includes('## The conversation so far')) {
  if (mode === 'prose') process.stdout.write('Det høres ut som en havn i skumringen. Hvem er der?');
  else process.stdout.write('```json\n' + JSON.stringify({ reply: 'Jeg hører en havn i skumringen. Regner det?', brief: 'A small harbour at dusk, wet stones, a few lit windows.' }) + '\n```');
} else if (prompt.includes('## Your tracks')) {
  const json = prompt.split('## Your tracks')[1].match(/```json\n([\s\S]*?)\n```/)[1];
  process.stdout.write(json.replaceAll('H4', 'C4'));
} else if (prompt.includes('## What Petter wants')) {
  const piece = JSON.parse(prompt.split('## The piece')[1].match(/```json\n([\s\S]*?)\n```/)[1]);
  const bars = Array.from({ length: piece.phrases * 8 }, (_, i) => (mode === 'bad-first' && i === 3 ? '0:H4:4' : '0:A2:8 8:E2:8:5'));
  const track = { id: 'bass', name: 'Walking bass', layer: 'bass', voice: 'bass.finger', instrument: 'bass', enter: 1, source: 'played', bars };
  process.stdout.write(JSON.stringify({ tracks: [track], note: 'A slow bass under it.\nsecond line' }));
} else if (prompt.includes('## The draft')) {
  const draft = JSON.parse(prompt.split('## The draft')[1].match(/```json\n([\s\S]*?)\n```/)[1]);
  const out = { ...draft, name: 'Harbour Jam', scene: mode === 'bad-first' ? 'nowhere' : draft.scene };
  delete out.id; delete out.origin; delete out.prompt;
  if (mode === 'mangle' && draft.written) {
    out.written = structuredClone(draft.written);
    out.written[0].parts[0].bars[0] = '0:C4:1';
    out.written[0].name = 'The theme';
    out.written[0].weight = 2;
    out.written[1].name = 'a name far too long for the display';
    out.written[1].weight = -1;
    out.written.pop();
    out.quote = 0.6;
    out.tonic = (draft.tonic + 2) % 12;
    out.layers = draft.layers.map((ls) => ls.filter((l) => l !== 'bass'));
  } else if (mode === 'mangle') {
    out.written = [{ chords: '1:8', parts: [{ layer: 'pad', voice: 'pad.warm', enter: 0, bars: Array(8).fill('0:C4:16') }] }];
    out.quote = 0.9;
  }
  process.stdout.write(JSON.stringify(out));
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
