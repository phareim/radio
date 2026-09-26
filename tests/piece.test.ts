/** jam's piece engine: `node --no-warnings --test tests/piece.test.ts` */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BUILTIN, LANDSCAPES } from '../engine/landscapes/index.ts'
import { validateLandscape } from '../engine/validate.ts'
import { createConductor, modeFor } from '../engine/conductor.ts'
import { parseMotif } from '../engine/composer.ts'
import type { BarPlan } from '../engine/types.ts'
import {
  chordAt, createPieceConductor, diatonicChords, emptyPiece, formatDrumBar, formatNoteBar, growLadder, growLayer,
  motifFromNotes, noteName, parseDrumBar, parseNoteBar, parseNoteName, patternLibrary, phraseChords, phraseSpans,
  pieceFromLandscape, pieceToLandscape, quantize, validatePiece,
} from '../engine/piece/index.ts'
import type { Piece, Track } from '../engine/piece/index.ts'

const lookup = (id: string) => LANDSCAPES[id]

function track(over: Partial<Track> & Pick<Track, 'id' | 'layer'>, bars = 8): Track {
  return { name: over.id, enter: 0, source: 'written', bars: Array(bars).fill(''), ...over }
}

function plans(piece: Piece, n: number, setup?: (c: ReturnType<typeof createPieceConductor>) => void): BarPlan[] {
  const c = createPieceConductor({ piece, lookup })
  setup?.(c)
  return Array.from({ length: n }, () => c.nextBar())
}

// ---- notation ----------------------------------------------------------------

test('note names', () => {
  assert.equal(parseNoteName('C4'), 60)
  assert.equal(parseNoteName('Eb3'), 51)
  assert.equal(parseNoteName('F#5'), 78)
  assert.equal(parseNoteName('Cb4'), 59)
  assert.equal(parseNoteName('B#3'), 60)
  assert.equal(parseNoteName('C-1'), 0)
  for (const bad of ['H4', 'c4', 'C', 'C10', 'E#', 'Cbb4']) assert.equal(parseNoteName(bad), null, bad)
  assert.equal(noteName(61), 'C#4')
  assert.equal(noteName(61, true), 'Db4')
  for (let m = 12; m <= 120; m++) assert.equal(parseNoteName(noteName(m)), m)
})

test('note bars parse, merge and round-trip', () => {
  const r = parseNoteBar('0:C3+G3:8 8:E3:4:5 12:D3:2 14.5:B2:1.5:4')
  assert.ok('notes' in r)
  assert.equal(r.notes.length, 5)
  assert.deepEqual(r.notes[0], { step: 0, midi: 48, len: 8, vel: 7 / 9 })
  assert.equal(formatNoteBar(r.notes), '0:C3+G3:8 8:E3:4:5 12:D3:2 14.5:B2:1.5:4')
  // Equal step, length and velocity merge; sorted by step then pitch; decimals trimmed.
  const notes = [
    { step: 4, midi: 64, len: 2, vel: 0.78 }, { step: 0, midi: 67, len: 4, vel: 0.78 },
    { step: 0, midi: 60, len: 4, vel: 0.78 }, { step: 1.3333, midi: 62, len: 1.5, vel: 1 },
  ]
  assert.equal(formatNoteBar(notes), '0:C4+G4:4 1.33:D4:1.5:9 4:E4:2')
  for (const s of ['', '0:C4:16', '0:A2:1:8 2:A2:1 15.67:Bb3:3.33:1', '3:C#4+F4+Ab4:0.5:2']) {
    const once = formatNoteBar((parseNoteBar(s) as { notes: never[] }).notes)
    assert.equal(formatNoteBar((parseNoteBar(once) as { notes: never[] }).notes), once, s)
  }
  assert.deepEqual(parseNoteBar(''), { notes: [] })
})

test('note bar errors name the token', () => {
  const err = (s: string) => (parseNoteBar(s) as { error: string }).error
  assert.equal(err('4:H4:2'), "bad pitch 'H4' in token '4:H4:2'")
  assert.match(err('16:C4:2'), /bad step '16'/)
  assert.match(err('1.234:C4:2'), /bad step/)
  assert.match(err('0:C4:0'), /bad length/)
  assert.match(err('0:C4:2:0'), /bad velocity/)
  assert.match(err('0:C4'), /is not <step>/)
  assert.match(err('0::2'), /no pitches/)
})

test('drum bars parse, format and refuse bad rows', () => {
  const src = 'h:x.x.x.x.x.x.x.x. k:x.......x....... z:........x------- s:....X.......X..g'
  const r = parseDrumBar(src)
  assert.ok('groove' in r)
  assert.equal(formatDrumBar(r.groove), 'k:x.......x....... s:....X.......X..g h:x.x.x.x.x.x.x.x. z:........x-------')
  assert.equal(formatDrumBar({ k: '................', s: '....x...........' }), 's:....x...........')
  const err = (s: string) => (parseDrumBar(s) as { error: string }).error
  assert.match(err('q:x...............'), /unknown hit 'q'/)
  assert.match(err('k:x.......'), /has 8 steps/)
  assert.match(err('k:x-..............'), /only a z riser holds/)
  assert.match(err('z:-x..............'), /must follow a z hit/)
  assert.match(err('k:x............... k:x...............'), /twice/)
  assert.match(err('k:x..............o'), /bad char 'o'/)
})

test('quantize snaps starts and lengths by strength', () => {
  const n = [{ step: 0.9, midi: 60, len: 1.7, vel: 0.7 }, { step: 5.2, midi: 62, len: 0.3, vel: 0.7 }]
  assert.deepEqual(quantize(n).map(x => [x.step, x.len]), [[1, 2], [5, 1]])
  assert.deepEqual(quantize(n, 2).map(x => [x.step, x.len]), [[0, 2], [6, 2]])
  assert.deepEqual(quantize(n, 1, 0.5).map(x => [x.step, x.len]), [[0.95, 1.85], [5.1, 0.65]])
  assert.deepEqual(quantize([{ step: 1.4, midi: 60, len: 1, vel: 1 }], 4 / 3).map(x => x.step), [1.33])
})

// ---- validation and chords ------------------------------------------------------

test('validatePiece accepts good pieces and names what is wrong in bad ones', () => {
  assert.deepEqual(validatePiece(emptyPiece()).errors, [])
  const p = emptyPiece()
  p.tracks = [
    track({ id: 'bass', layer: 'bass', voice: 'bass.round' }),
    track({ id: 'keys', layer: 'pad', voice: 'pad.warm' }),
    track({ id: 'beat', layer: 'drums', kit: 'kit.soft' }),
  ]
  p.tracks[1]!.bars[5] = '0:C4:2 4:H4:2'
  p.tracks[2]!.bars[0] = 'k:x.......x.......'
  assert.deepEqual(validatePiece(p).errors, ["tracks[1] 'keys' bar 5: bad pitch 'H4' in token '4:H4:2'"])

  const bad = structuredClone(p) as unknown as Record<string, any>
  bad.tracks[1].bars[5] = ''
  bad.chords = ['1 6 4']
  bad.tracks[0].kit = 'kit.soft'
  bad.tracks[2].id = 'bass'
  bad.tracks[2].bars.pop()
  bad.tracks.push(track({ id: 'x', layer: 'lead', voice: 'lead.nope' as never }), track({ id: 'y', layer: 'lead', kit: 'kit.chip' }))
  bad.tracks.push(track({ id: 'z', layer: 'lead', voice: 'lead.ep' }))
  bad.tracks[5].bars[0] = '0:C#9:1'
  bad.tracks[5].bars[1] = '0:C4:1 '.repeat(100)
  const errs = validatePiece(bad).errors
  const want = [
    /^chords\[0\]: '1 6 4' lasts 6 bars/,
    /^tracks\[0\] 'bass': exactly one of voice/,
    /^tracks\[2\] 'bass'.bars: 8 strings/,
    /^tracks\[2\]: id 'bass' used twice/,
    /^tracks\[3\] 'x'.voice: unknown voice 'lead.nope'/,
    /^tracks\[4\] 'y': a kit track plays on layer 'drums' or 'perc'/,
    /^tracks\[5\] 'z' bar 0: note C#9 out of range/,
    /^tracks\[5\] 'z' bar 1: 700 chars/,
  ]
  for (const w of want) assert.ok(errs.some(e => w.test(e)), `${w} in ${JSON.stringify(errs)}`)
  const many = emptyPiece()
  many.tracks = Array.from({ length: 25 }, (_, i) => track({ id: `t${i}`, layer: 'pad', voice: 'pad.warm' }))
  assert.match(validatePiece(many).errors.join('\n'), /at most 24/)
  assert.deepEqual(validatePiece({ ...emptyPiece(), phrases: 2 }).errors, ['chords: 2 progressions (one per phrase), got 1'])
})

test('phrase spans follow the piece chords, diatonic in its mode', () => {
  const p = { ...emptyPiece(), phrases: 2 as const, chords: ['1 6 4 5', '4:4 5:2 1:0.5 1s4:1.5'] }
  const spans = phraseSpans(p)
  assert.equal(spans.length, 16)
  assert.deepEqual(spans.slice(0, 8).map(s => s[0]!.chord.symbol), ['Am', 'Am', 'F', 'F', 'Dm', 'Dm', 'Em', 'Em'])
  assert.deepEqual(spans[13]!.map(s => [s.from, s.len, s.chord.symbol]), [[0, 16, 'Em']])
  assert.deepEqual(spans[14]!.map(s => [s.from, s.len, s.chord.symbol]), [[0, 8, 'Am'], [8, 8, 'Asus4']])
  assert.deepEqual(spans[15]!.map(s => [s.from, s.len, s.chord.symbol]), [[0, 16, 'Asus4']])
  assert.equal(chordAt(p, 14, 10).symbol, 'Asus4')
  assert.equal(chordAt(p, 16, 0).symbol, 'Am')
  const chips = diatonicChords(0, 'ionian')
  assert.deepEqual(chips.slice(0, 7).map(c => c.chord.symbol), ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim'])
  assert.deepEqual(chips.slice(7).map(c => c.token), ['17', '27', '37', '47', '57', '67', '77'])
  assert.equal(chips[11]!.chord.symbol, 'G7')
})

// ---- conductor -----------------------------------------------------------------

function jamPiece(): Piece {
  const p = emptyPiece({ id: 'test' })
  p.tracks = [
    track({ id: 'pad', layer: 'pad', voice: 'pad.warm', enter: 0, bars: Array.from({ length: 8 }, (_, i) => `0:A3+C4+E4:16:${(i % 9) + 1}`) }),
    track({ id: 'bass', layer: 'bass', voice: 'bass.round', enter: 1, gain: 0.5, bars: Array(8).fill('0:A2:4:9') }),
    track({ id: 'beat', layer: 'drums', kit: 'kit.soft', enter: 2, bars: Array(8).fill('k:X.......x....... h:g.g.g.g.g.g.g.g. z:........x---....') }),
  ]
  return p
}

test('the piece loops, seeks and marks its place', () => {
  const ps = plans(jamPiece(), 20, c => c.setControls({ intensity: 4 }))
  assert.deepEqual(ps.map(p => p.meta.loopBar), [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3])
  assert.deepEqual(ps.map(p => p.index), Array.from({ length: 20 }, (_, i) => i))
  assert.equal(ps[3]!.notes.find(n => n.layer === 'pad')!.vel, 4 / 9)
  assert.equal(ps[0]!.meta.section, 'P1')
  assert.equal(ps[0]!.meta.phraseBars, 8)
  assert.equal(ps[7]!.meta.nextChord, 'Am')
  assert.equal(ps[0]!.meta.landscape, 'nightdrive')
  assert.equal(ps[0]!.bpmStart, 100)
  assert.deepEqual(ps[0]!.key, { tonic: 9, mode: 'aeolian' })
  const two = { ...jamPiece(), phrases: 2 as const, chords: ['1 6 4 5', '4 5 1:4'] }
  two.tracks = two.tracks.map(t => ({ ...t, bars: [...t.bars, ...t.bars] }))
  const c = createPieceConductor({ piece: two, lookup })
  c.nextBar()
  c.seek(13)
  const p = c.nextBar()
  assert.equal(p.meta.loopBar, 13)
  assert.equal(p.meta.section, 'P2')
  assert.equal(p.meta.phraseBar, 5)
  assert.equal(p.chords[0]!.chord.symbol, 'Am')
  assert.equal(c.nextBar().meta.loopBar, 14)
  c.setPiece(jamPiece())
  assert.equal(c.nextBar().meta.loopBar, 7)
  assert.equal(c.loopBars, 8)
})

test('tracks enter by intensity; mute and solo; gain and drum velocities', () => {
  const layers = (p: BarPlan) => [...new Set([...p.notes.map(n => n.layer), ...p.drums.map(d => d.layer)])].sort()
  const c = createPieceConductor({ piece: jamPiece(), lookup, controls: { intensity: 0 } })
  assert.deepEqual(layers(c.nextBar()), ['pad'])
  c.setControls({ intensity: 1 })
  assert.deepEqual(layers(c.nextBar()), ['bass', 'pad'])
  c.setControls({ intensity: 2 })
  const p = c.nextBar()
  assert.deepEqual(layers(p), ['bass', 'drums', 'pad'])
  assert.deepEqual(p.meta.active, ['ambience', 'pad', 'bass', 'drums'])
  assert.equal(p.notes.find(n => n.layer === 'bass')!.vel, 0.5)
  const k = p.drums.filter(d => d.hit === 'k')
  assert.deepEqual(k.map(d => [d.step, d.vel]), [[0, 1], [8, 0.8]])
  assert.ok(p.drums.filter(d => d.hit === 'h').every(d => d.vel === 0.35))
  assert.deepEqual(p.drums.filter(d => d.hit === 'z').map(d => [d.step, d.len]), [[8, 4]])
  assert.ok(p.fx.pump > 0, 'pump with drums')
  assert.ok(Object.values(p.mix).every(m => m.gain === 1 && m.fadeBars === 0))

  const muted = jamPiece()
  muted.tracks[0]!.mute = true
  muted.tracks[2]!.solo = true
  const q = plans(muted, 1, x => x.setControls({ intensity: 4 }))[0]!
  assert.deepEqual(layers(q), ['drums'])
  muted.tracks[2]!.solo = false
  const r = plans(muted, 1, x => x.setControls({ intensity: 1 }))[0]!
  assert.deepEqual(layers(r), ['bass'])
  assert.equal(r.fx.pump, 0, 'no pump without drums')
})

test('click, neutral fx without a base, and base effects shaped by the knobs', () => {
  const p = { ...jamPiece(), base: undefined, tracks: [] }
  const c = createPieceConductor({ piece: p, lookup: () => { throw new Error('no lookup without a base') }, click: true })
  const bar = c.nextBar()
  assert.deepEqual(bar.drums.map(d => [d.layer, d.kit, d.hit, d.step, d.vel]), [
    ['perc', 'kit.chip', 'h', 0, 1], ['perc', 'kit.chip', 'h', 4, 0.55], ['perc', 'kit.chip', 'h', 8, 0.55], ['perc', 'kit.chip', 'h', 12, 0.55],
  ])
  assert.equal(bar.meta.landscape, 'jam')
  assert.equal(bar.meta.scene.from, 'nightdrive')
  assert.deepEqual(bar.ambience, {})
  c.setClick(false)
  assert.equal(c.nextBar().drums.length, 0)
  const withBase = createPieceConductor({ piece: { ...jamPiece(), base: 'coast', fx: { reverb: 1 } }, lookup, controls: { space: 1 } }).nextBar()
  assert.equal(withBase.fx.reverb, 1)
  assert.ok(withBase.fx.delay > 0.3 * 1.5, 'coast delay, opened by space')
  assert.equal(withBase.meta.scene.to, 'coast')
  assert.ok((withBase.ambience.waves ?? 0) > 0)
})

// ---- landscapes from pieces ---------------------------------------------------------

test('pieceToLandscape validates for the empty piece and every built-in, with any base', () => {
  const check = (piece: Piece, base: string | undefined) => {
    const L = pieceToLandscape(piece, base ? LANDSCAPES[base] : undefined)
    assert.deepEqual(validateLandscape(L).errors, [], `${piece.id} on ${base}`)
    assert.equal(modeFor(L, 0.5), piece.mode, `${piece.id} mode`)
  }
  for (const mode of ['lydian', 'ionian', 'aeolian', 'phrygian', 'harmonicMinor'] as const) {
    const e = emptyPiece({ mode })
    check(e, undefined)
    for (const B of BUILTIN) check(e, B.id)
  }
  for (const L of BUILTIN) {
    const p = pieceFromLandscape(L, { lookup })
    assert.deepEqual(validatePiece(p).errors, [], L.id)
    check(p, undefined)
    for (const B of BUILTIN) check(p, B.id)
  }
})

test('a piece carries its bass line, grooves, motifs and ladder into the landscape', () => {
  const p = jamPiece()
  p.tracks[1]!.bars[0] = '0:A2:2 4:E3:2 8:A3:2 12:C3:1 13:F#2:1 14:G#2:2'
  p.tracks.push(track({ id: 'lead', layer: 'lead', voice: 'lead.glide', enter: 3, bars: ['0:A4:4 4:C5:4 8:E5:8', '0:D5:8', '', '', '', '', '', ''] }))
  p.tracks[2]!.bars[7] = 'k:x...x...x...x... s:....x...x.x.xxxx'
  const L = pieceToLandscape(p, LANDSCAPES.coast)
  assert.deepEqual(validateLandscape(L).errors, [])
  assert.equal(L.bass.patterns[1], 'R-..5-..O-..3a7-')
  assert.equal(L.bass.patterns[0], '')
  assert.equal(L.bass.octave, 36)
  assert.deepEqual(L.drums.grooves[1], {})
  assert.equal(formatDrumBar(L.drums.grooves[2]), 'k:X.......x....... h:g.g.g.g.g.g.g.g. z:........x---....')
  assert.equal(formatDrumBar(L.drums.fill), 'k:x...x...x...x... s:....x...x.x.xxxx')
  assert.deepEqual(L.lead!.motifs, ["1 - 3 - 5 - - - | 4 - - - . . . ."])
  assert.equal(L.lead!.voice, 'lead.glide')
  assert.deepEqual(L.layers[0], ['ambience', 'pad'])
  assert.ok(L.layers[3].includes('lead') && !L.layers[2].includes('lead'))
  assert.ok(L.layers[1].includes('arp'), 'the base brings in what the piece does not cover')
  assert.equal(L.id, 'jam-test')
  assert.equal(L.scene, 'coast')
})

test('a piece\'s phrases come along note for note as written phrases', () => {
  const p = { ...jamPiece(), phrases: 2 as const, chords: ['1 6 4 5', '4 5 1:4'] }
  p.tracks = p.tracks.map(t => ({ ...t, bars: [...t.bars, ...t.bars] }))
  p.tracks[1]!.bars.fill('', 8)
  p.tracks[2]!.solo = true
  p.tracks.push(track({ id: 'muted', layer: 'lead', voice: 'lead.ep', mute: true, bars: Array(16).fill('0:A4:4') }))
  p.tracks.push(track({ id: 'empty', layer: 'arp', voice: 'arp.warm', bars: Array(16).fill('') }))
  const L = pieceToLandscape(p, LANDSCAPES.coast)
  assert.deepEqual(validateLandscape(L).errors, [])
  assert.equal(L.quote, 0.35)
  assert.deepEqual(L.written!.map(w => [w.name, w.chords, w.chordBars]), [['P1', '1 6 4 5', 2], ['P2', '4 5 1:4', 2]])
  const [p1, p2] = L.written!
  assert.deepEqual(p1!.parts.map(x => [x.layer, x.voice ?? x.kit, x.enter, x.gain]), [['pad', 'pad.warm', 0, undefined], ['bass', 'bass.round', 1, 0.5], ['drums', 'kit.soft', 2, undefined]], 'muted and empty tracks left out, solo ignored')
  assert.deepEqual(p1!.parts[0]!.bars, p.tracks[0]!.bars.slice(0, 8))
  assert.deepEqual(p2!.parts[1]!.bars, Array(8).fill(''), 'a track silent in a phrase keeps the layer silent there')
  assert.equal(pieceToLandscape(p, LANDSCAPES.coast, { written: false }).written, undefined)
  assert.equal(pieceToLandscape(p, LANDSCAPES.coast, { written: false }).quote, undefined)
  assert.equal(pieceToLandscape(emptyPiece()).written, undefined, 'nothing written, nothing to quote')
  // More than ten tracks: the ones that play in the phrase first, then by entry.
  const crowd = { ...emptyPiece({ id: 'crowd' }), phrases: 2 as const, chords: ['1 6 4 5', '4 5 1:4'] }
  crowd.tracks = Array.from({ length: 12 }, (_, i) => track({ id: `t${i}`, layer: 'pad', voice: 'pad.warm', enter: (i % 5) as 0, bars: Array(16).fill('') }, 16))
  crowd.tracks.forEach((t, i) => { t.bars[i < 11 ? 8 : 0] = '0:C4:4' })
  const [c1, c2] = pieceToLandscape(crowd).written!
  assert.deepEqual(validateLandscape(pieceToLandscape(crowd)).errors, [])
  assert.equal(c1!.parts.length, 10)
  assert.ok(c1!.parts.some(x => x.bars[0] === '0:C4:4'), 'P1: the one track playing there is kept')
  assert.deepEqual(c2!.parts.map(x => x.enter), [0, 1, 2, 3, 4, 0, 1, 2, 3, 0], 'P2: of the eleven that play, the later of the two entering at 4 is dropped')
})

test('a channel made in jam quotes its phrases between the generated ones', () => {
  const J = pieceToLandscape(pieceFromLandscape(LANDSCAPES.coast!, { lookup, seed: 1 }), LANDSCAPES.coast)
  assert.deepEqual(validateLandscape(J).errors, [])
  const c = createConductor({ lookup: id => (id === J.id ? J : LANDSCAPES[id]), seed: 42, controls: { landscape: J.id, intensity: 3 } })
  const ps = Array.from({ length: 320 }, () => c.nextBar())
  const quotes = ps.filter(p => p.meta.section.startsWith('W:') && p.meta.phraseBar === 0).map(p => p.meta.section)
  assert.ok(quotes.length >= 2 && quotes.includes('W:P1') && quotes.includes('W:P2'), quotes.join(' '))
  // In a quote at mood 0.5 the written bass line sounds exactly as the piece has it.
  const bass = J.written![0]!.parts.find(x => x.layer === 'bass')!
  const q = ps.find(p => p.meta.section === 'W:P1' && p.meta.active.includes('bass'))!
  const wb = (q.index - ps.findIndex(p => p.meta.section === 'W:P1')) % 8
  assert.deepEqual(q.notes.filter(n => n.layer === 'bass').map(n => n.midi), (parseNoteBar(bass.bars[wb]!) as { notes: Array<{ midi: number }> }).notes.map(n => n.midi))
})

test('motifFromNotes writes eighth-note degrees with octave marks', () => {
  const key = { tonic: 2, mode: 'mixolydian' as const }
  const bar1 = (parseNoteBar('0:D5:4 4:A4:2 6:D5:2 8:E5:2 10:F#5:6') as { notes: never[] }).notes
  const bar2 = (parseNoteBar('0:G5:2 2:C6:2 4:B4:4') as { notes: never[] }).notes
  const m = motifFromNotes([bar1, bar2], key)
  assert.equal(m, "1 - 5, 1 2 3 - - | 4 7 6, - . . . .")
  assert.ok(parseMotif(m))
  assert.equal(motifFromNotes([[], []], key), '')
})

// ---- growing and the library -------------------------------------------------------

test('growing is deterministic and sounds like the landscape over the piece chords', () => {
  const p = emptyPiece({ id: 'grow' })
  const a = growLadder(p, { lookup, seed: 7 })
  const b = growLadder(p, { lookup, seed: 7 })
  assert.deepEqual(a, b)
  assert.notDeepEqual(growLadder(p, { lookup, seed: 8 }), a)
  assert.deepEqual(a.map(t => [t.layer, t.enter]), [['pad', 0], ['bass', 1], ['arp', 1], ['drums', 2], ['lead', 3], ['counter', 4]])
  const grown = { ...p, tracks: a }
  assert.deepEqual(validatePiece(grown).errors, [])
  const bass = a.find(t => t.layer === 'bass')!
  bass.bars.forEach((bar, i) => {
    const first = (parseNoteBar(bar) as { notes: Array<{ midi: number }> }).notes[0]!
    assert.equal(first.midi % 12, chordAt(p, i, 0).bass, `bass on the root in bar ${i}`)
  })
  const drums = a.find(t => t.layer === 'drums')!
  assert.equal(drums.kit, 'kit.synthwave')
  assert.equal(drums.bars[3], formatDrumBar(LANDSCAPES.nightdrive!.drums.grooves[2]))
  assert.equal(drums.bars[7], formatDrumBar(LANDSCAPES.nightdrive!.drums.fill))
  // Growing again skips covered layers; growLayer borrows another landscape's part.
  assert.deepEqual(growLadder(grown, { lookup }), [])
  const perc = growLayer(grown, 'perc', 2, { lookup, from: 'jungle' })
  assert.equal(perc.id, 'perc')
  assert.equal(perc.kit, 'kit.tribal')
  assert.equal(perc.bars[0], formatDrumBar(LANDSCAPES.jungle!.drums.perc![2]))
  const bass2 = growLayer(grown, 'bass', 3, { lookup, from: 'coast', enter: 1 })
  assert.equal(bass2.id, 'bass-2')
  assert.equal(bass2.voice, 'bass.saw')
  assert.equal(bass2.enter, 1)
})

test('pieces from landscapes lay the progressions over two phrases', () => {
  assert.equal(phraseChords('1 6 3 7', 1, { tonic: 9, mode: 'aeolian' }, 1), '1 6 3 7 1 6 3 7')
  assert.equal(phraseChords('6 7 1:2', 1, { tonic: 9, mode: 'aeolian' }, 2), '6:1 7:1 1 6:1 7:1 1')
  assert.equal(phraseChords('1 2', 4, { tonic: 0, mode: 'lydian' }, 2), '1:4 2:4')
  assert.equal(phraseChords('1 2 3', 4, { tonic: 0, mode: 'lydian' }, 2), '1:4 2:4')
  const p = pieceFromLandscape(LANDSCAPES.nightdrive!, { lookup, level: 3, seed: 1 })
  assert.deepEqual(p.chords, ['1 6 3 7 1 6 3 7', '4 6 7:2 4 6 7:2'])
  assert.equal(p.chordBars, 1)
  assert.equal(p.mode, 'aeolian')
  assert.equal(p.intensity, 3)
  assert.equal(p.base, 'nightdrive')
  assert.equal(pieceFromLandscape(LANDSCAPES.deepspace!, { lookup, phrases: 1 }).chords[0], '1:4 2:4')
})

test('the pattern library has every landscape\'s grooves and parts', () => {
  const lib = patternLibrary([...BUILTIN])
  assert.ok(lib.length >= 60 && lib.length <= 200, `${lib.length} items`)
  assert.equal(new Set(lib.map(i => i.id)).size, lib.length, 'unique ids')
  for (const i of lib) {
    if (i.kind === 'drums' || i.kind === 'perc') {
      assert.ok(i.bar && i.kit, i.id)
      assert.ok('groove' in parseDrumBar(i.bar!), i.id)
    } else assert.ok(i.voice && !i.bar, i.id)
  }
  for (const L of BUILTIN) for (const kind of ['bass', 'pad', 'drums'] as const) assert.ok(lib.some(i => i.from === L.id && i.kind === kind), `${L.id} ${kind}`)
  assert.ok(lib.some(i => i.id === 'jungle:perc:1'))
})
