/**
 * The modern end of the Era knob, the way a producer would remake a bar.
 *
 * palette.ts hands the layers over to modern voices; this remakes the
 * rhythm section of every composed bar once the drums and the bass have
 * handed over (the first step past the middle), so the place sounds like a
 * festival set rather than its own groove on new sounds:
 *
 * - From 100 bpm up, four on the floor (big room, progressive house): a kick
 *   on every beat, the clap on two and four, an open hat on every offbeat,
 *   sixteenth hats as the level climbs; the bass on the offbeats, rolling in
 *   sixteenths at the top. Below 100 bpm, half time (future bass, melodic
 *   trap): a kick on one and the and-of-three, snare and clap on two and
 *   four, hats that roll in thirty-seconds at the top, and long 808s that
 *   slide from note to note.
 * - The fill before a new section becomes a build: a snare roll thickening
 *   from eighths into sixteenths under a white-noise riser, the kick and the
 *   bass gone for the last beat, so the crash on the next downbeat lands as
 *   the drop. A fill inside a section is a lift (the groove, then a sixteenth
 *   roll over its second half); drums about to leave close with a tom run,
 *   and drums about to enter get the build's second half as their pickup.
 * - The bass plays the chord's bass note in the sub, E1 to D#2, now and then
 *   an octave up for bounce. Without drums under it, it holds.
 *
 * Written quotes keep their own drum and bass parts (the conductor lays
 * them over this, on the modern sounds). Pure and deterministic, no random
 * draws: back in the middle, the music is what it would have been.
 */
import type { ChordSpan, DrumEvent, DrumHit, Groove, Layer, NoteEvent } from './types.ts'
import { handedOver } from './palette.ts'
import { grooveHits } from './written.ts'

export type ModernStyle = 'four' | 'half'

/** Four on the floor from this tempo up, half time below it. */
export const FOUR_FROM_BPM = 100

export function modernStyle(bpm: number): ModernStyle {
  return bpm >= FOUR_FROM_BPM ? 'four' : 'half'
}

const KICKS = 'x...x...x...x...'
const OFFBEAT = '..x...x...x...x.'

/** Grooves per pattern level (0 is never played: the drums are not on there). */
const GROOVES: Record<ModernStyle, Groove[]> = {
  four: [
    {},
    { k: KICKS, h: OFFBEAT },
    { k: KICKS, c: '....x.......x...', o: OFFBEAT },
    { k: KICKS, c: '....x.......x...', s: '....g.......g...', o: OFFBEAT, h: '.g.g.g.g.g.g.g.g' },
    { k: KICKS, c: '....X.......X...', s: '....x.......x...', o: OFFBEAT, h: 'xg.gxg.gxg.gxg.g' },
  ],
  half: [
    {},
    { k: 'x.........x.....', h: 'x...x...x...x...' },
    { k: 'x.........x.....', s: '....x.......x...', c: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
    { k: 'x.........x..x..', s: '....x.......x...', c: '....x.......x...', h: 'x.xgx.xgx.xgx.xg', o: '..............x.' },
    { k: 'x......x..x.....', s: '....X.......X...', c: '....x.......x...', h: 'xgxgxgxgxgxgxgxg', o: '......x.......x.' },
  ],
}

/**
 * Bass rhythms per pattern level with drums: [step, length in steps, octave
 * up]. Four on the floor sits between the kicks; half time lands on them,
 * 808s held to the next note.
 */
const BASS: Record<ModernStyle, Array<Array<[number, number, boolean]>>> = {
  four: [
    [],
    [],
    [[2, 1.5, false], [6, 1.5, false], [10, 1.5, false], [14, 1.5, false]],
    [[2, 0.9, false], [3, 0.9, false], [6, 0.9, false], [7, 0.9, false], [10, 0.9, false], [11, 0.9, false], [14, 0.9, false], [15, 0.9, true]],
    [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15].map(s => [s, 0.85, s === 15] as [number, number, boolean]),
  ],
  half: [
    [],
    [],
    [[0, 10, false], [10, 6, false]],
    [[0, 7, false], [7, 3, true], [10, 6, false]],
    [[0, 3, false], [3, 4, false], [7, 3, true], [10, 3, false], [13, 3, false]],
  ],
}

/** The chord's bass note in the sub: E1 (28) to D#2 (39). */
export function subNote(pc: number): number {
  return 28 + ((((pc - 4) % 12) + 12) % 12)
}

function chordAt(spans: ChordSpan[], step: number): ChordSpan['chord'] {
  let c = spans[0]!.chord
  for (const s of spans) if (s.from <= step) c = s.chord
  return c
}

export interface ModernContext {
  /** The era the voices hear (latched at phrase starts). */
  era: number
  style: ModernStyle
  /** The pattern level the composer played at. */
  level: number
  /** The lowest level at which the landscape has drums on its ladder. */
  drumsFrom: number
  spans: ChordSpan[]
  phraseBar: number
  present: ReadonlySet<Layer>
  /**
   * The composer played a fill: a build into a new section (the drop), a lift
   * inside one, or a close (the drums leave next bar).
   */
  fill: 'build' | 'lift' | 'close' | null
  /** The drums enter next bar: the build's second half as their pickup. */
  pickup: boolean
}

/** A snare roll from `from` to the bar's end: eighths in the first half of the bar, sixteenths after, rising. */
function roll(from: number): DrumEvent[] {
  const out: DrumEvent[] = []
  for (let s = from; s < 16; s += s < 8 ? 2 : 1) {
    out.push({ layer: 'drums', kit: 'kit.edm', hit: 's', step: s, vel: Math.min(1, 0.3 + 0.7 * (s / 15) ** 1.4) })
  }
  return out
}

function drumsBar(m: ModernContext, kept: DrumEvent[]): DrumEvent[] {
  const lvl = Math.max(1, Math.min(4, Math.round(Math.max(m.level, m.drumsFrom))))
  const groove = GROOVES[m.style][lvl]!
  const hits = (g: Groove) => grooveHits(g, 'drums', 'kit.edm')
  let out: DrumEvent[]
  if (m.pickup && !m.present.has('drums')) {
    out = roll(8)
  } else if (m.fill === 'build') {
    // The groove's kick and hats through the first half, the roll under it, and the last beat bare for the drop.
    out = [...hits(groove).filter(d => d.step < 8 && (d.hit === 'k' || d.hit === 'o' || d.hit === 'h')), ...roll(0)]
    if (m.style === 'four') out.push({ layer: 'drums', kit: 'kit.edm', hit: 'k', step: 8, vel: 0.8 })
  } else if (m.fill === 'lift') {
    // The groove through the first half, a sixteenth roll over the second; the kick keeps going.
    out = [...hits(groove).filter(d => d.step < 8 || d.hit === 'k'), ...roll(8)]
  } else if (m.fill === 'close') {
    const toms: Array<[DrumHit, number, number]> = [['T', 12, 0.7], ['T', 13, 0.6], ['m', 14, 0.8], ['t', 15, 0.9]]
    out = [...hits(groove).filter(d => d.step < 12), ...toms.map(([hit, step, vel]) => ({ layer: 'drums' as const, kit: 'kit.edm' as const, hit, step, vel }))]
  } else {
    out = hits(groove)
    // Half time at the top: the hats roll in thirty-seconds into every other bar.
    if (m.style === 'half' && lvl >= 4 && m.phraseBar % 2 === 1) {
      out = out.filter(d => !(d.hit === 'h' && d.step >= 14))
      for (const [step, vel] of [[14, 0.45], [14.5, 0.5], [15, 0.6], [15.5, 0.72]] as const) out.push({ layer: 'drums', kit: 'kit.edm', hit: 'h', step, vel })
    }
  }
  // The conductor's punctuation stays: the crash on a downbeat (the drop) and any riser; a build always gets one.
  out.push(...kept)
  const riser = kept.some(d => d.hit === 'z')
  if (!riser && m.fill === 'build') out.push({ layer: 'drums', kit: 'kit.edm', hit: 'z', step: 0, vel: 0.7, len: 16 })
  if (!riser && m.pickup && !m.present.has('drums')) out.push({ layer: 'drums', kit: 'kit.edm', hit: 'z', step: 8, vel: 0.7, len: 8 })
  return out.sort((a, b) => a.step - b.step)
}

function bassBar(m: ModernContext, own: NoteEvent[]): NoteEvent[] {
  // Keep the composer's rests: no bass where it wrote none this bar.
  if (!own.length) return []
  const voice = m.style === 'half' ? 'bass.808' : 'bass.deep'
  const out: NoteEvent[] = []
  const drums = m.present.has('drums')
  const lvl = Math.max(0, Math.min(4, Math.round(m.level)))
  const rhythm = drums ? BASS[m.style][lvl]! : []
  if (!rhythm.length) {
    // No beat under it (or a low level): the sub holds each chord.
    for (const s of m.spans) out.push({ layer: 'bass', voice, midi: subNote(s.chord.bass), step: s.from, len: s.len, vel: 0.8 })
    return out
  }
  for (const [step, len, up] of rhythm) {
    const midi = subNote(chordAt(m.spans, step).bass) + (up ? 12 : 0)
    const accent = m.style === 'four' ? step % 4 === 2 : step % 8 === 0
    out.push({ layer: 'bass', voice, midi, step, len, vel: accent ? 0.9 : 0.72 })
  }
  // 808s slide when one runs into the next on another pitch.
  if (m.style === 'half') {
    for (let i = 1; i < out.length; i++) {
      const a = out[i - 1]!
      const b = out[i]!
      if (a.step + a.len >= b.step && a.midi !== b.midi) out[i] = { ...b, opts: { legato: true } }
    }
  }
  // A build leaves the last beat empty for the drop.
  if (m.fill === 'build') return out.filter(n => n.step < 12).map(n => (n.step + n.len > 12 ? { ...n, len: 12 - n.step } : n))
  return out
}

/**
 * One composed bar at the modern end: its drums and bass remade once those
 * layers have handed over (everything else, and every other era, passes
 * through untouched). Voices and kits are palette.ts's business; this only
 * writes in the ones it means (kit.edm, bass.deep or bass.808).
 */
export function modernBar(notes: NoteEvent[], drums: DrumEvent[], m: ModernContext): { notes: NoteEvent[]; drums: DrumEvent[] } {
  if (m.era <= 0.5) return { notes, drums }
  let ns = notes
  let ds = drums
  if (handedOver('drums', m.era) && (m.present.has('drums') || m.pickup)) {
    const kept = drums.filter(d => d.layer === 'drums' && (d.hit === 'x' || d.hit === 'z'))
    ds = [...drums.filter(d => d.layer !== 'drums'), ...drumsBar(m, kept)]
  }
  if (handedOver('bass', m.era) && m.present.has('bass')) {
    const own = notes.filter(n => n.layer === 'bass')
    ns = [...notes.filter(n => n.layer !== 'bass'), ...bassBar(m, own)]
  }
  return { notes: ns, drums: ds }
}
