// Audio level check: renders every voice, kit, ambience texture, a full mix
// and the ten landscapes offline in headless Chromium, and prints peak / RMS
// and problems (clipping, silence, DC, NaN, harsh top end).
//
//   flock /tmp/claude-1000/chrome.lock node tests/audio-check.mjs [filter] [--wav] [--json]
//
// filter: substring of "group:name", e.g. "voice:pad", "landscape", "hits:kit.chip".
// --smoke: also run the live player for ~16 s (worker clock, AudioContext, onBar, stop/start,
//   and jam's transport: cut while playing, cut + setIdle, live notes while idle, an idle start).
// --wav: also write WAVs of the full mix and every landscape to the out dir.
// Out dir: $RADIO_AUDIO_OUT or ~/zshots/radio-audio (snap Chromium cannot read /tmp).
import { build } from 'esbuild'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch } from './audio-cdp.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const filter = args.find(a => !a.startsWith('--')) ?? ''
const wantWav = args.includes('--wav')
const json = args.includes('--json')
const smoke = args.includes('--smoke')
const out = process.env.RADIO_AUDIO_OUT ?? join(homedir(), 'zshots', 'radio-audio')
mkdirSync(out, { recursive: true })

await build({
  entryPoints: [join(here, 'audio-harness.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  outfile: join(out, 'audio-harness.js'),
  logLevel: 'warning',
})
copyFileSync(join(here, 'audio-harness.html'), join(out, 'audio-harness.html'))

const b = await launch(out)
let rows = []
const smokeProblems = []
try {
  await b.goto(`file://${join(out, 'audio-harness.html')}`)
  if (smoke) {
    const r = await b.eval('smokePlayer()')
    console.log('player smoke test:', JSON.stringify(r, null, 1))
    smokeProblems.push(...(r.problems ?? []).map(p => `smoke: ${p}`))
  }
  rows = smoke && !filter ? [] : await b.eval(`runAudioCheck(${JSON.stringify(filter)}, ${wantWav})`)
  if (b.errors.length) console.error('browser errors:\n  ' + [...new Set(b.errors)].slice(0, 10).join('\n  '))
} finally {
  await b.close()
}

const f1 = x => (x <= -199 ? '  -inf' : x.toFixed(1).padStart(6))
const problems = [...smokeProblems]
const check = (label, s) => {
  if (s.nan) problems.push(`${label}: ${s.nan} NaN samples`)
  if (s.clip) problems.push(`${label}: ${s.clip} samples at full scale`)
  if (s.peak > -1) problems.push(`${label}: peak ${s.peak.toFixed(1)} dBFS (over -1)`)
  if (s.peak < -60) problems.push(`${label}: silent (peak ${s.peak.toFixed(1)} dBFS)`)
  if (s.dc > 0.005) problems.push(`${label}: DC offset ${s.dc.toFixed(4)}`)
  if (s.hf > 20) problems.push(`${label}: ${s.hf.toFixed(0)} % of energy above 5 kHz (harsh?)`)
}

if (json) {
  console.log(JSON.stringify(rows.map(({ wav, ...r }) => r), null, 1))
} else {
  let group = ''
  for (const r of rows) {
    if (r.group !== group) {
      group = r.group
      console.log(`\n${group.toUpperCase()}\n${'name'.padEnd(18)}  peak    rms   lufs   loud    pre  centroid  >5k%  nodes/s   render`)
    }
    const s = r.stats
    console.log(`${r.name.padEnd(18)} ${f1(s.peak)} ${f1(s.rms)} ${f1(s.lufs)} ${f1(s.mom)} ${f1(s.pre)} ${String(Math.round(s.centroid)).padStart(8)} ${s.hf.toFixed(1).padStart(5)} ${String(Math.round(r.nodesPerSec)).padStart(8)} ${String(Math.round(r.ms)).padStart(6)}ms`)
    if (r.windows) console.log('   hits ' + r.windows.map(([h, w]) => `${h}:${w.peak.toFixed(0)}/${w.rms.toFixed(0)}`).join(' '))
  }
}
for (const r of rows) {
  check(`${r.group}:${r.name}`, r.stats)
  for (const e of r.visualErrors ?? []) problems.push(`${r.group}:${r.name}: visual ${e}`)
  for (const e of r.checkErrors ?? []) problems.push(`${r.group}:${r.name}: ${e}`)
  for (const [h, w] of r.windows ?? []) {
    if (w.nan || w.clip || w.peak > -1) check(`${r.group}:${r.name}:${h}`, w)
    if (w.peak < -60) problems.push(`${r.group}:${r.name}:${h}: silent`)
  }
  if (r.wav) {
    const file = join(out, `${r.group}-${r.name}.wav`)
    writeFileSync(file, Buffer.from(r.wav, 'base64'))
    console.log(`wrote ${file}`)
  }
}
console.log(problems.length ? `\nPROBLEMS (${problems.length}):\n  ${problems.join('\n  ')}` : '\nno problems found')
process.exitCode = problems.length ? 1 : 0
