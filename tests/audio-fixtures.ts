/**
 * Fake conductors for the audio harness: bars that exercise one voice, one
 * kit, one ambience texture, or a full arrangement, without the composer.
 */
import type {
  AmbienceId, BarPlan, ConductorLike, Controls, DrumEvent, DrumHit, FxState, KitId, Layer, LayerMix, NoteEvent, VoiceId,
} from '../engine/types.ts'
import { DEFAULT_CONTROLS, LAYERS } from '../engine/types.ts'

export const DORIAN_D = [2, 4, 5, 7, 9, 11, 0]

export const FX: FxState = { reverb: 0.35, delay: 0.25, reverbSize: 2.5, tone: 0.75, grit: 0.2, pump: 0, width: 0.6 }

interface Bar {
  notes?: NoteEvent[]
  drums?: DrumEvent[]
  mix?: Partial<Record<Layer, LayerMix>>
  ambience?: Partial<Record<AmbienceId, number>>
  fx?: Partial<FxState>
  bpm?: number
  swing?: number
}

export function plan(index: number, b: Bar): BarPlan {
  const bpm = b.bpm ?? 100
  return {
    index,
    bpmStart: bpm,
    bpmEnd: bpm,
    swing: b.swing ?? 0,
    chords: [],
    key: { tonic: 2, mode: 'dorian' },
    scale: DORIAN_D,
    notes: b.notes ?? [],
    drums: b.drums ?? [],
    mix: b.mix ?? {},
    fx: { ...FX, ...b.fx },
    ambience: b.ambience ?? {},
    ambienceFadeBars: 0,
    meta: {
      landscape: 'test',
      scene: { from: 'coast', to: 'coast', blendStart: 0, blendEnd: 0 },
      phraseBar: index % 8,
      phraseBars: 8,
      section: 'A',
      active: [],
      upcoming: [],
      transition: { kind: 'none', from: '', to: '', progress: 0, note: '' },
      intensity: 2,
    },
  }
}

function fake(bar: (i: number) => Bar): ConductorLike {
  let i = 0
  const controls: Controls = { ...DEFAULT_CONTROLS }
  return { nextBar: () => plan(i, bar(i++)), setControls: () => {}, controls }
}

export function layerOf(v: VoiceId): Layer {
  const fam = v.split('.')[0]
  return ({ lead: 'lead', mallet: 'lead', pluck: 'lead', arp: 'arp', pad: 'pad', bass: 'bass', bell: 'bells', counter: 'counter', drone: 'drone' } as Record<string, Layer>)[fam!] ?? 'lead'
}

const on = (l: Layer): Partial<Record<Layer, LayerMix>> => ({ [l]: { gain: 1, fadeBars: 0 } })
const n = (layer: Layer, voice: VoiceId, midi: number, step: number, len: number, vel: number, extra: Partial<NoteEvent> = {}): NoteEvent =>
  ({ layer, voice, midi, step, len, vel, ...extra })

// Chords in D dorian: Dm9, G, C/E, Am.
const CHORDS = [[50, 53, 57, 60, 64], [43, 55, 59, 62, 67], [52, 55, 60, 64, 67], [45, 57, 60, 64, 69]]
const MELODY: Array<[number, number, number, number]> = [
  // step, len, midi, vel
  [0, 3, 69, 0.85], [3, 1, 67, 0.6], [4, 4, 65, 0.75], [8, 2, 64, 0.7], [10, 2, 62, 0.65], [12, 4, 64, 0.8],
]
const MELODY_B: Array<[number, number, number, number]> = [
  [0, 2, 72, 0.9], [2, 2, 74, 0.7], [4, 6, 76, 0.85], [10, 2, 74, 0.6], [12, 2, 72, 0.7], [14, 2, 69, 0.6],
]

/** Bars that play one voice the way its family is used. */
export function soloVoice(voice: VoiceId, fx: Partial<FxState> = {}): ConductorLike {
  const layer = layerOf(voice)
  const fam = voice.split('.')[0]
  return fake(i => {
    const ch = CHORDS[Math.floor(i / 2) % 4]!
    const notes: NoteEvent[] = []
    if (fam === 'pad') {
      // Same chord two bars running (ties), then the next.
      for (const m of ch.slice(1)) notes.push(n(layer, voice, m, 0, 16, 0.7))
    } else if (fam === 'drone') {
      notes.push(n(layer, voice, 38 + (Math.floor(i / 4) % 2) * 5, 0, 16, 0.8))
    } else if (fam === 'bass') {
      const root = ch[0]! < 48 ? ch[0]! : ch[0]! - 12
      for (let s = 0; s < 16; s += 2) notes.push(n(layer, voice, s === 6 || s === 14 ? root + 7 : root, s, voice === 'bass.pluck' ? 1.5 : 2, s % 4 === 0 ? 0.9 : 0.7))
    } else if (fam === 'arp') {
      const tones = [...ch.slice(1), ...ch.slice(1).map(m => m + 12)]
      for (let s = 0; s < 16; s++) notes.push(n(layer, voice, tones[s % tones.length]! + 12, s, 1, s % 4 === 0 ? 0.85 : 0.65, voice === 'arp.seq' ? { opts: { cutoff: 0.2 + 0.6 * ((i * 16 + s) % 64) / 64 } } : {}))
    } else if (fam === 'bell') {
      notes.push(n(layer, voice, 81, 0, 8, 0.8), n(layer, voice, 88, 6, 8, 0.6), n(layer, voice, 86, 12, 4, 0.7))
    } else if (fam === 'mallet' || fam === 'pluck') {
      const tones = ch.slice(1).map(m => m + 12)
      for (let s = 0; s < 16; s += 2) notes.push(n(layer, voice, tones[(s / 2 + i) % tones.length]!, s, 2, s % 4 === 0 ? 0.85 : 0.6))
    } else {
      const mel = i % 2 ? MELODY_B : MELODY
      for (const [s, len, m, vel] of mel) notes.push(n(layer, voice, fam === 'counter' ? m - 12 : m, s, len, vel, voice === 'lead.glide' ? { opts: { legato: true } } : {}))
    }
    return { notes, mix: on(layer), fx }
  })
}

export const HIT_ORDER: DrumHit[] = ['k', 's', 'c', 'h', 'o', 'r', 'p', 't', 'm', 'T', 'x', 'z']

/** Every hit of a kit alone, one every `gap` seconds (at 100 bpm, 16 steps = 2.4 s). */
export function kitHits(kit: KitId): ConductorLike {
  // One hit per half bar: 1.2 s apart at 100 bpm.
  return fake(i => {
    const drums: DrumEvent[] = []
    for (const k of [0, 1]) {
      const hit = HIT_ORDER[i * 2 + k]
      if (hit) drums.push({ layer: 'drums', kit, hit, step: k * 8, vel: 1, len: hit === 'z' ? 6 : undefined })
    }
    return { drums, mix: on('drums') }
  })
}

/** A groove that uses every hit of the kit over eight bars. */
export function kitGroove(kit: KitId): ConductorLike {
  return fake(i => {
    const d: DrumEvent[] = []
    const hit = (h: DrumHit, step: number, vel: number, len?: number) => d.push({ layer: 'drums', kit, hit: h, step, vel, len })
    for (const s of [0, 4, 8, 12]) hit('k', s, 0.95)
    for (const s of [4, 12]) hit(i % 4 === 2 ? 'c' : 's', s, 0.85)
    for (let s = 0; s < 16; s += 2) hit(i % 4 === 3 ? 'r' : 'h', s, s % 4 === 0 ? 0.8 : 0.55)
    hit('o', 14, 0.6)
    for (const s of [3, 7, 11, 15]) hit('p', s, 0.5)
    if (i % 8 === 7) { hit('t', 8, 0.8); hit('m', 10, 0.8); hit('T', 12, 0.8); hit('t', 14, 0.9) }
    if (i % 8 === 0) hit('x', 0, 0.8)
    if (i % 8 === 6) hit('z', 8, 0.8, 8)
    return { drums: d, mix: on('drums'), bpm: 110 }
  })
}

/** One texture at full level. */
export function soloAmbience(id: AmbienceId): ConductorLike {
  return fake(() => ({ ambience: { [id]: 1 }, mix: on('ambience') }))
}

/** A full synthwave arrangement: every layer on, pump, gated snare, ambience. */
export function fullMix(): ConductorLike {
  const all: Partial<Record<Layer, LayerMix>> = {}
  for (const l of LAYERS) all[l] = { gain: 1, fadeBars: 0 }
  return fake(i => {
    const ch = CHORDS[Math.floor(i / 2) % 4]!
    const notes: NoteEvent[] = []
    for (const m of ch.slice(1)) notes.push(n('pad', 'pad.saw', m, 0, 16, 0.7))
    notes.push(n('drone', 'drone.sub', 38, 0, 16, 0.7))
    const root = ch[0]! < 48 ? ch[0]! : ch[0]! - 12
    for (let s = 0; s < 16; s += 2) notes.push(n('bass', 'bass.pluck', root, s, 1.5, s % 4 === 0 ? 0.9 : 0.7))
    const tones = [...ch.slice(1), ...ch.slice(1).map(m => m + 12)]
    for (let s = 0; s < 16; s++) notes.push(n('arp', 'arp.pluck', tones[s % tones.length]! + 12, s, 1, s % 4 === 0 ? 0.85 : 0.6))
    for (const [s, len, m, vel] of i % 2 ? MELODY_B : MELODY) notes.push(n('lead', 'lead.square', m + 12, s, len, vel))
    notes.push(n('counter', 'counter.soft', 62, 0, 8, 0.6), n('counter', 'counter.soft', 64, 8, 8, 0.6))
    notes.push(n('bells', 'bell.glass', 86, 6, 4, 0.6))
    const d: DrumEvent[] = []
    for (const s of [0, 4, 8, 12]) d.push({ layer: 'drums', kit: 'kit.synthwave', hit: 'k', step: s, vel: 0.95 })
    for (const s of [4, 12]) d.push({ layer: 'drums', kit: 'kit.synthwave', hit: 's', step: s, vel: 0.9 })
    for (let s = 0; s < 16; s += 2) d.push({ layer: 'drums', kit: 'kit.synthwave', hit: 'h', step: s, vel: 0.6 })
    for (const s of [3, 7, 11, 15]) d.push({ layer: 'perc', kit: 'kit.synthwave', hit: 'p', step: s, vel: 0.5 })
    if (i % 4 === 0) d.push({ layer: 'drums', kit: 'kit.synthwave', hit: 'x', step: 0, vel: 0.7 })
    return { notes, drums: d, mix: all, ambience: { waves: 0.6, gulls: 0.5 }, fx: { pump: 0.5 }, bpm: 108 }
  })
}
