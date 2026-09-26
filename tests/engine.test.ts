/** Engine invariants: `node --no-warnings --test tests/engine.test.ts` */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createConductor } from '../engine/conductor.ts'
import { BUILTIN, LANDSCAPES } from '../engine/landscapes/index.ts'
import { validateLandscape } from '../engine/validate.ts'
import { createRng } from '../engine/rng.ts'
import { parseToken } from '../engine/theory.ts'
import { noteName } from '../engine/piece/notation.ts'
import { mapPitch } from '../engine/written.ts'
import type { BarPlan, Controls, Landscape, Layer } from '../engine/types.ts'

const lookup = (id: string) => LANDSCAPES[id]

test('every built-in landscape validates', () => {
  for (const l of BUILTIN) assert.deepEqual(validateLandscape(l).errors, [], l.id)
})

test('chord tokens follow the mode', () => {
  const sym = (t: string, mode: 'dorian' | 'aeolian' | 'ionian') => parseToken(t, { tonic: 2, mode })!.chord.symbol
  assert.equal(sym('4', 'dorian'), 'G')
  assert.equal(sym('4', 'aeolian'), 'Gm')
  assert.equal(sym('b7M', 'ionian'), 'C')
  assert.equal(sym('5M7', 'aeolian'), 'A7')
  assert.equal(sym('1add9/5', 'ionian'), 'Dadd9/A')
})

function run(seed: number, bars: number, script: (i: number) => Partial<Controls> | null, start: Partial<Controls> = {}): BarPlan[] {
  const c = createConductor({ lookup, seed, controls: start })
  const out: BarPlan[] = []
  for (let i = 0; i < bars; i++) {
    const s = script(i)
    if (s) c.setControls(s)
    out.push(c.nextBar())
  }
  return out
}

test('random sessions stay in range and never throw', () => {
  const ids = BUILTIN.map(l => l.id)
  for (let seed = 1; seed <= 12; seed++) {
    const r = createRng(seed)
    const plans = run(seed, 600, i => {
      if (!r.chance(0.04)) return null
      const k = r.int(6)
      if (k === 0) return { landscape: r.pick(ids) }
      if (k === 1) return { intensity: r.int(5) as Controls['intensity'] }
      if (k === 2) return { mood: r.next() }
      if (k === 3) return { density: r.next(), space: r.next(), grit: r.next() }
      if (k === 4) return { tempo: r.range(-20, 20) }
      return { hold: r.chance(0.5) }
    })
    for (const p of plans) {
      assert.ok(p.bpmStart >= 30 && p.bpmStart <= 200, `bpm ${p.bpmStart}`)
      const covered = p.chords.reduce((n, s) => n + s.len, 0)
      assert.equal(covered, 16, `bar ${p.index} chords cover ${covered}`)
      for (const n of p.notes) {
        assert.ok(Number.isFinite(n.midi) && n.midi >= 24 && n.midi <= 108, `note ${n.midi} on ${n.layer} (${p.meta.landscape})`)
        assert.ok(n.step >= 0 && n.step < 16 && n.len > 0, `step ${n.step} len ${n.len}`)
        assert.ok(p.meta.active.includes(n.layer), `${n.layer} note while silent`)
      }
      for (const d of p.drums) assert.ok(d.step >= 0 && d.step < 16)
      for (const v of Object.values(p.fx)) assert.ok(Number.isFinite(v))
    }
  }
})

test('a build brings layers in one at a time on the grid', () => {
  const plans = run(7, 40, () => null, { landscape: 'coast', intensity: 4 })
  const firstBar = new Map<Layer, number>()
  for (const p of plans) for (const l of p.meta.active) if (!firstBar.has(l)) firstBar.set(l, p.index)
  const entries = [...firstBar.entries()].filter(([l]) => l !== 'ambience').sort((a, b) => a[1] - b[1])
  for (let i = 1; i < entries.length; i++) assert.ok(entries[i]![1] - entries[i - 1]![1] >= 2, `entries too close: ${JSON.stringify(entries)}`)
  assert.equal(firstBar.get('drums')! % 4, 0, 'drums on a half-phrase')
  assert.equal(firstBar.get('lead')! % 8, 0, 'lead on a phrase')
})

test('a landscape change waits for the phrase, bridges four bars, then arrives', () => {
  const plans = run(3, 60, i => (i === 21 ? { landscape: 'frostwood' } : null), { landscape: 'coast', intensity: 3 })
  const bridge = plans.filter(p => p.meta.section === 'bridge')
  assert.equal(bridge.length, 4)
  assert.equal(bridge[0]!.index, 24, 'bridge starts at the next phrase')
  assert.ok(!bridge.some(p => p.meta.active.includes('drums')), 'no drums in the bridge')
  assert.ok(plans[23]!.drums.length > 0, 'the old beat plays out the phrase')
  const after = plans[28]!
  assert.equal(after.meta.landscape, 'frostwood')
  assert.equal(Math.round(after.bpmStart), 72)
  assert.ok(bridge[3]!.meta.scene.blendEnd === 1 && bridge[0]!.meta.scene.blendStart === 0)
})

test('lowering intensity waits for the phrase end, with a closing fill', () => {
  const plans = run(5, 40, i => (i === 18 ? { intensity: 0 } : null), { landscape: 'nightdrive', intensity: 3 })
  assert.ok(plans[23]!.meta.active.includes('drums'))
  assert.ok(!plans[24]!.meta.active.includes('drums'))
  assert.ok(plans[23]!.drums.some(d => d.hit === 's' && d.step >= 12), 'fill before the drums leave')
})

test('hold loops the section exactly', () => {
  const plans = run(9, 80, i => (i === 0 ? { hold: true } : null), { landscape: 'village', intensity: 3 })
  const sig = (p: BarPlan) => p.notes.filter(n => n.layer === 'lead').map(n => `${n.step}:${n.midi}`).join(',')
  assert.equal(new Set(plans.slice(40).map(p => p.meta.section)).size, 1)
  assert.equal(sig(plans[48]!), sig(plans[64]!))
})

// ---- written phrases ------------------------------------------------------------

test('built-in landscapes play exactly as before written phrases existed', () => {
  // SHA-256 of main's plans at 08d2695 over scripted sessions on every
  // built-in: a landscape without `written` must plan byte for byte the same.
  // Change the hash only for a deliberate change to the composer or conductor.
  const h = createHash('sha256')
  const ids = BUILTIN.map(l => l.id)
  for (const id of ids) for (const seed of [1, 2, 3]) {
    const r = createRng(seed * 131 + id.length)
    const c = createConductor({ lookup, seed, controls: { landscape: id, intensity: 2 } })
    for (let i = 0; i < 300; i++) {
      if (r.chance(0.04)) {
        const k = r.int(6)
        c.setControls(k === 0 ? { landscape: r.pick(ids) } : k === 1 ? { intensity: r.int(5) as Controls['intensity'] }
          : k === 2 ? { mood: r.next() } : k === 3 ? { density: r.next(), space: r.next(), grit: r.next() }
            : k === 4 ? { tempo: r.range(-20, 20) } : { hold: r.chance(0.5) })
      }
      h.update(JSON.stringify(c.nextBar()))
    }
  }
  assert.equal(h.digest('hex'), '387591d82a265d4fe6286ddfee7c4dc6c6efcd1264586110e20a7976895476e2')
})

/**
 * Coast with written phrases in D mixolydian (its mood-0.5 mode here), moods
 * ionian → mixolydian → dorian. 'theme' has bass, lead and a pad that
 * enters at 3; 'answer' only drums.
 */
function writtenLandscape(over: Partial<Landscape> = {}): Landscape {
  const L: Landscape = structuredClone(LANDSCAPES.coast!)
  L.id = 'written-test'
  L.scene = 'coast'
  L.moods = ['ionian', 'mixolydian', 'dorian']
  L.mood = 0.5
  L.written = [
    {
      name: 'theme', chords: '1 7 4 5', parts: [
        { layer: 'bass', voice: 'bass.round', enter: 1, bars: Array(8).fill('0:D2:4 4:A2:4 8:C3:4 12:F#2:2 14:D#2:2') },
        { layer: 'lead', voice: 'lead.square', enter: 2, gain: 0.5, bars: ['0:D5:4 4:C5:4 8:F#5:4 12:D#5:4', '0:E5:16', '', '', '0:G5:8:9', '', '', ''] },
        { layer: 'pad', voice: 'pad.warm', enter: 3, bars: Array(8).fill('0:D4+F#4+A4:16') },
      ],
    },
    { name: 'answer', chords: '4 5 1:4', parts: [{ layer: 'drums', kit: 'kit.soft', enter: 2, bars: Array(8).fill('k:x...x...x...x...') }] },
  ]
  L.quote = 1
  return { ...L, ...over }
}

function runOn(L: Landscape, seed: number, bars: number, controls: Partial<Controls>, script: (i: number) => Partial<Controls> | null = () => null): BarPlan[] {
  const look = (id: string) => (id === L.id ? L : LANDSCAPES[id])
  const c = createConductor({ lookup: look, seed, controls: { landscape: L.id, ...controls } })
  return Array.from({ length: bars }, (_, i) => { const s = script(i); if (s) c.setControls(s); return c.nextBar() })
}

const isW = (p: BarPlan) => p.meta.section.startsWith('W')
const sig = (p: BarPlan, layer: string) => p.notes.filter(n => n.layer === layer).map(n => `${n.step}:${n.midi}:${n.len}:${n.vel}`).join(' ')

test('written phrases validate, and bad ones say what to fix', () => {
  assert.deepEqual(validateLandscape(writtenLandscape()).errors, [])
  assert.deepEqual(validateLandscape(writtenLandscape({ quote: undefined })).errors, [])
  const L = writtenLandscape() as unknown as Record<string, any>
  L.quote = 1.5
  L.written[0].chords = '1 7 4'
  const parts = L.written[0].parts
  parts[0].kit = 'kit.soft'
  parts[1].bars[3] = '0:H4:2'
  parts[2].bars = parts[2].bars.slice(0, 7)
  parts.push({ layer: 'lead', kit: 'kit.chip', enter: 2, bars: Array(8).fill('') })
  parts.push({ layer: 'arp', voice: 'arp.nope', enter: 5, bars: Array(8).fill('') })
  parts.push({ layer: 'lead', voice: 'lead.ep', enter: 1, bars: ['0:C4:1 '.repeat(100), '', '', '', '', '', '', ''] })
  L.written[1].name = 'a name much longer than twenty-four'
  const errs = validateLandscape(L).errors
  const want = [
    /^quote: 0\.\.1/,
    /^written\[0\] 'theme'\.chords: '1 7 4' lasts 6 bars \(needs exactly 8/,
    /^written\[0\] 'theme'\.parts\[0\] \(bass\): exactly one of voice/,
    /^written\[0\] 'theme'\.parts\[1\] \(lead\) bar 3: bad pitch 'H4' in token '0:H4:2'/,
    /^written\[0\] 'theme'\.parts\[2\] \(pad\)\.bars: 8 strings/,
    /^written\[0\] 'theme'\.parts\[3\] \(lead\): a kit part plays on layer 'drums' or 'perc'/,
    /^written\[0\] 'theme'\.parts\[4\] \(arp\)\.voice: unknown voice 'arp\.nope'/,
    /^written\[0\] 'theme'\.parts\[4\] \(arp\)\.enter: integer 0\.\.4/,
    /^written\[0\] 'theme'\.parts\[5\] \(lead\): enters at 1 but layers\[1\] has no 'lead', so it could not sound there; raise enter to 2 or add 'lead' to layers\[1\]/,
    /^written\[0\] 'theme'\.parts\[5\] \(lead\) bar 0: 700 chars \(max 600\)/,
    /^written\[1\] 'a name much .*'\.name: 1–24 chars/,
  ]
  for (const w of want) assert.ok(errs.some(e => w.test(e)), `${w} in ${JSON.stringify(errs, null, 1)}`)
  assert.equal(errs.length, want.length, JSON.stringify(errs, null, 1))

  const many = writtenLandscape()
  many.written = Array.from({ length: 9 }, () => structuredClone(many.written![0]!))
  assert.match(validateLandscape(many).errors.join('\n'), /^written: at most 8 phrases, got 9$/m)
  const crowded = writtenLandscape()
  crowded.written![0]!.parts = Array.from({ length: 11 }, () => structuredClone(crowded.written![0]!.parts[0]!))
  assert.match(validateLandscape(crowded).errors.join('\n'), /parts: 1 to 10 parts/)
  assert.match(validateLandscape({ ...writtenLandscape(), written: {} }).errors.join('\n'), /^written: a list of phrases/m)
  assert.match(validateLandscape({ ...writtenLandscape(), written: [{ chords: '1:8', parts: [] }] }).errors.join('\n'), /written\[0\]\.parts: 1 to 10/)
})

test('a landscape with written phrases quotes them deterministically, eight bars at a time', () => {
  const L = writtenLandscape()
  const a = runOn(L, 11, 400, { intensity: 3 })
  assert.deepEqual(runOn(L, 11, 400, { intensity: 3 }), a, 'same seed, same music')
  const sections: Array<{ name: string; start: number; bars: number }> = []
  for (const p of a) {
    const last = sections.at(-1)
    if (last && last.name === p.meta.section && p.meta.phraseBar !== 0) last.bars++
    else if (last && last.name === p.meta.section && !isW(p) && last.bars < 16) last.bars++
    else sections.push({ name: p.meta.section, start: p.index, bars: 1 })
  }
  const ws = sections.filter(s => s.name.startsWith('W'))
  assert.ok(ws.length >= 5, JSON.stringify(sections))
  for (const w of ws) {
    assert.equal(w.bars, 8, `${w.name} at ${w.start}`)
    assert.equal(a[w.start]!.meta.phraseBar, 0)
    assert.equal(a[w.start]!.meta.transition.note, `quoting ${w.name.slice(2)}`)
  }
  for (let i = 1; i < ws.length; i++) assert.notEqual(ws[i]!.name, ws[i - 1]!.name, 'not the same phrase twice running')
  for (let i = 1; i < sections.length; i++) assert.ok(!(sections[i]!.name.startsWith('W') && sections[i - 1]!.name.startsWith('W')), 'never two quotes in a row')
  // Take the quotes out and the cycle A A2 B runs on where it was.
  const cycle = sections.filter(s => !s.name.startsWith('W')).map(s => s.name)
  cycle.forEach((n, i) => assert.equal(n, ['A', 'A2', 'B'][i % 3], cycle.join(' ')))
  // Written chords, as written (no added colour), in the current mode.
  const theme = a.find(p => p.meta.section === 'W:theme' && p.meta.phraseBar === 2)!
  assert.deepEqual(theme.chords.map(s => s.chord.symbol), ['C'])

  assert.ok(!runOn(writtenLandscape({ quote: 0 }), 11, 300, { intensity: 3 }).some(isW), 'quote 0: never')
  const some = runOn(writtenLandscape({ quote: undefined }), 5, 800, { intensity: 3 })
  const n = new Set(some.filter(isW).map(p => p.index - p.meta.phraseBar)).size
  assert.ok(n >= 2 && n <= 14, `default quote 0.35: ${n} quotes in 800 bars`)
  assert.ok(!runOn(L, 11, 300, { intensity: 3, hold: true }).some(isW), 'hold keeps the section it froze')
})

test('quoted parts replace the composer on their layers; the rest is composed over the written chords', () => {
  const plans = runOn(writtenLandscape(), 11, 300, { intensity: 4 })
  const theme = plans.filter(p => p.meta.section === 'W:theme' && p.meta.active.includes('lead'))
  const answer = plans.filter(p => p.meta.section === 'W:answer' && p.meta.active.includes('drums'))
  assert.ok(theme.length >= 8 && answer.length >= 8)
  for (const p of theme) {
    const wb = p.meta.phraseBar
    assert.equal(sig(p, 'bass'), '0:38:4:0.7777777777777778 4:45:4:0.7777777777777778 8:48:4:0.7777777777777778 12:42:2:0.7777777777777778 14:39:2:0.7777777777777778')
    assert.equal(p.notes.filter(n => n.layer === 'pad').map(n => n.midi).join(' '), '62 66 69', 'the pad part at intensity 4')
    const lead = p.notes.filter(n => n.layer === 'lead')
    if (wb === 0) assert.deepEqual(lead.map(n => [n.midi, n.vel]), [[74, 7 / 18], [72, 7 / 18], [78, 7 / 18], [75, 7 / 18]])
    if (wb === 4) assert.deepEqual(lead.map(n => [n.step, n.midi, n.len, n.vel]), [[0, 79, 8, 0.5]])
    if (wb === 2) assert.equal(lead.length, 0, 'an empty written bar is silence, not the composer')
    assert.ok(p.notes.some(n => n.layer === 'arp') && p.drums.some(d => d.layer === 'drums'), 'arp and drums still composed')
  }
  for (const p of answer) {
    assert.deepEqual(p.drums.filter(d => d.layer === 'drums').map(d => [d.kit, d.hit, d.step, d.vel]), [0, 4, 8, 12].map(s => ['kit.soft', 'k', s, 0.8]))
    assert.ok(p.notes.some(n => n.layer === 'bass' && n.voice === LANDSCAPES.coast!.bass.voice), 'bass composed')
  }
  for (const p of plans) for (const n of p.notes) assert.ok(p.meta.active.includes(n.layer))
})

test('parts follow the ladder: above the level they are silent, off the ladder they cannot sound', () => {
  const at = (intensity: Controls['intensity']) => runOn(writtenLandscape(), 11, 300, { intensity }).filter(p => p.meta.section === 'W:theme')
  const two = at(2)
  assert.ok(two.length >= 8)
  for (const p of two) {
    assert.ok(p.meta.active.includes('pad'))
    assert.equal(p.notes.filter(n => n.layer === 'pad').length, 0, 'the pad part enters at 3; the composer leaves the layer to it')
    assert.equal(p.notes.filter(n => n.layer === 'bass').length, 5)
  }
  assert.ok(two.some(p => p.notes.some(n => n.layer === 'lead')))
  const one = at(1)
  assert.ok(one.length >= 8)
  for (const p of one) {
    assert.ok(!p.meta.active.includes('lead'), 'coast has no lead at 1')
    assert.equal(p.notes.filter(n => n.layer === 'lead').length, 0)
    assert.equal(p.notes.filter(n => n.layer === 'bass').length, 5)
  }
  // Intensity down in a quote: the parts play out the phrase with their layers.
  const w = runOn(writtenLandscape(), 11, 300, { intensity: 4 }).findIndex(p => p.meta.section === 'W:theme' && p.meta.active.includes('lead'))
  const ps = runOn(writtenLandscape(), 11, w + 9, { intensity: 4 }, i => (i === w + 2 ? { intensity: 1 } : null))
  for (let i = w + 2; i < w + 8; i++) assert.equal(ps[i]!.notes.filter(n => n.layer === 'pad').length, 3, `pad part plays the phrase out (bar ${i})`)
  assert.ok(!ps[w + 8]!.meta.active.includes('lead'), 'and leaves with the phrase')
})

test('mood moves a quote by scale degree; chord tones and chromatic notes stay', () => {
  const bar0 = (mood: number) => {
    const p = runOn(writtenLandscape(), 11, 300, { intensity: 4, mood }).find(p => p.meta.section === 'W:theme' && p.meta.phraseBar === 0 && p.meta.active.includes('lead'))!
    return { p, lead: p.notes.filter(n => n.layer === 'lead').map(n => noteName(n.midi)), bass: p.notes.filter(n => n.layer === 'bass').map(n => noteName(n.midi)) }
  }
  const mixo = bar0(0.5)
  const ion = bar0(0)
  const dor = bar0(1)
  assert.equal(mixo.p.key.mode, 'mixolydian')
  assert.deepEqual(mixo.lead, ['D5', 'C5', 'F#5', 'D#5'])
  assert.deepEqual(ion.lead, ['D5', 'C#5', 'F#5', 'D#5'], 'ionian: b7 → 7')
  assert.deepEqual(dor.lead, ['D5', 'C5', 'F5', 'D#5'], 'dorian: 3 → b3 (the chord is Dm)')
  assert.deepEqual(dor.bass, ['D2', 'A2', 'C3', 'F2', 'D#2'])
  for (const { p } of [ion, dor]) {
    const scale = new Set(p.scale)
    for (const n of p.notes) if (n.layer === 'lead' || n.layer === 'bass') assert.ok(scale.has(n.midi % 12) || n.midi % 12 === 3, `${noteName(n.midi)} in ${p.key.mode}`)
  }
  // Unit: a tone of the chord sounding stays; other degrees move; a new tonic transposes.
  const from = { tonic: 2, mode: 'mixolydian' as const }
  assert.equal(mapPitch(72, from, { tonic: 2, mode: 'ionian' }), 73)
  assert.equal(mapPitch(72, from, { tonic: 2, mode: 'ionian' }, [9, 0, 4]), 72, 'C is in the Am sounding under it')
  assert.equal(mapPitch(66, from, { tonic: 2, mode: 'aeolian' }), 65)
  assert.equal(mapPitch(63, from, { tonic: 2, mode: 'aeolian' }), 63, 'chromatic D# stays')
  assert.equal(mapPitch(62, from, { tonic: 0, mode: 'mixolydian' }), 60)
  assert.equal(mapPitch(62, from, { tonic: 9, mode: 'mixolydian' }), 69 - 12)
})

test('no quote during a landscape move or while a new place builds; a bridge plays no written part', () => {
  const W = writtenLandscape()
  // In a quote, asked to leave: the quote plays out, the bridge is the bridge.
  const first = runOn(W, 11, 200, { intensity: 3 }).findIndex(isW)
  const plans = runOn(W, 11, first + 40, { intensity: 3 }, i => (i === first + 3 ? { landscape: 'nightdrive' } : null))
  for (let i = first; i < first + 8; i++) assert.ok(isW(plans[i]!), `bar ${i} still quoting`)
  const bridge = plans.filter(p => p.meta.section === 'bridge')
  assert.equal(bridge.length, 4)
  assert.equal(bridge[0]!.index, first + 8)
  const writtenBass = sig(plans.find(p => p.meta.section === 'W:theme' && p.meta.active.includes('bass'))!, 'bass')
  for (const p of bridge) {
    assert.notEqual(sig(p, 'bass'), writtenBass, 'no written bass in the bridge')
    assert.ok(!p.drums.some(d => d.kit === 'kit.soft'), 'no written drums in the bridge')
  }
  assert.ok(plans.slice(first + 12).every(p => p.meta.landscape === 'nightdrive' && !isW(p)))
  // Arriving at a place with written phrases: it opens with its own A and builds before it quotes.
  const into = runOn(W, 3, 120, { landscape: 'coast', intensity: 4 }, i => (i === 5 ? { landscape: 'written-test' } : null))
  const arrive = into.findIndex(p => p.meta.landscape === 'written-test' && p.meta.section !== 'bridge')
  assert.equal(into[arrive]!.meta.section, 'A')
  const firstW = into.findIndex(isW)
  assert.ok(firstW > arrive, 'quotes come later')
  assert.ok(!into.slice(arrive, firstW).some(p => p.meta.transition.note.startsWith('arriving') && isW(p)))
})

test('random sessions with written landscapes stay in range', () => {
  const W = writtenLandscape()
  const ids = [...BUILTIN.map(l => l.id), W.id]
  const look = (id: string) => (id === W.id ? W : LANDSCAPES[id])
  for (let seed = 1; seed <= 6; seed++) {
    const r = createRng(seed)
    const c = createConductor({ lookup: look, seed, controls: { landscape: W.id } })
    for (let i = 0; i < 600; i++) {
      if (r.chance(0.04)) {
        const k = r.int(5)
        c.setControls(k === 0 ? { landscape: r.pick(ids) } : k === 1 ? { intensity: r.int(5) as Controls['intensity'] } : k === 2 ? { mood: r.next() } : k === 3 ? { landscape: W.id } : { hold: r.chance(0.5) })
      }
      const p = c.nextBar()
      assert.equal(p.chords.reduce((n, s) => n + s.len, 0), 16)
      for (const n of p.notes) {
        assert.ok(n.midi >= 24 && n.midi <= 108 && n.step >= 0 && n.step < 16 && n.len > 0)
        assert.ok(p.meta.active.includes(n.layer), `${n.layer} note while silent`)
      }
      if (isW(p)) assert.equal(p.meta.landscape, W.id)
    }
  }
})
