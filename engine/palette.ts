/**
 * The Era palette: which voice and kit a layer plays at a given Era.
 *
 * Era 0.5 is the landscape as written. Away from the middle the layers hand
 * over one by one: toward 0 (8-bit) to chip voices, soft beds first and the
 * lead last; toward 1 (modern) to festival EDM, the beat and the bass first
 * (a kick on every beat and a deep sub are most of what makes it sound now),
 * then the beds, the arp and the bells, the counter line, the lead last. The
 * conductor maps each bar after composing it (at the modern end modern.ts
 * remakes its drums and bass first), so the composer, the written quotes and
 * the orchestration never need to know.
 */
import type { DrumEvent, KitId, Layer, NoteEvent, VoiceId } from './types.ts'

/**
 * How far toward 8-bit (0..1) the knob must be before a layer hands over.
 * Beds and drums go first, so the colour shifts before the tune does; the
 * lead goes last. Every layer has handed over at era 0.
 */
export const HANDOVER: Record<Layer, number> = {
  drone: 0.2, pad: 0.2, drums: 0.35, perc: 0.35, bells: 0.45, arp: 0.55, bass: 0.65, counter: 0.75, lead: 0.85,
  ambience: 1,
}

/**
 * The same toward modern: the drums and the bass on the first step past the
 * middle, then the beds and the perc, the arp and the bells, the counter, the
 * lead. Every layer has handed over at era 1.
 */
export const MODERN_HANDOVER: Record<Layer, number> = {
  drums: 0.2, bass: 0.2, drone: 0.35, pad: 0.35, perc: 0.35, arp: 0.55, bells: 0.55, counter: 0.75, lead: 0.85,
  ambience: 1,
}

/** The 8-bit counterpart of every voice. Chip voices (`chip.*`, `arp.square`, `lead.pulse`) keep themselves. */
export const CHIP: Record<VoiceId, VoiceId> = {
  // Melodic voices of any kind become the NES pulse lead; lead.pulse is chip already.
  'lead.square': 'chip.lead', 'lead.saw': 'chip.lead', 'lead.pulse': 'lead.pulse', 'lead.ep': 'chip.lead',
  'lead.hollow': 'chip.lead', 'lead.fm': 'chip.lead', 'lead.glide': 'chip.lead', 'lead.whistle': 'chip.lead',
  'mallet.kalimba': 'chip.lead', 'mallet.marimba': 'chip.lead', 'pluck.harp': 'chip.lead',
  'keys.piano': 'chip.lead', 'keys.felt': 'chip.lead',
  'guitar.nylon': 'chip.lead', 'guitar.steel': 'chip.lead', 'guitar.mute': 'chip.lead',
  'wind.flute': 'chip.lead', 'mallet.vibes': 'chip.lead',
  'lead.super': 'chip.lead', 'pluck.super': 'chip.lead', 'vox.chop': 'chip.lead',
  // Arps: the chip arp.
  'arp.square': 'arp.square', 'arp.pluck': 'arp.square', 'arp.warm': 'arp.square', 'arp.glass': 'arp.square', 'arp.seq': 'arp.square',
  // Pads: the chord as a frame-rate arpeggio.
  'pad.saw': 'chip.pad', 'pad.strings': 'chip.pad', 'pad.choir': 'chip.pad', 'pad.glass': 'chip.pad',
  'pad.warm': 'chip.pad', 'pad.dark': 'chip.pad', 'strings.ensemble': 'chip.pad', 'pad.super': 'chip.pad',
  // Basses and drones: the triangle channel.
  'bass.saw': 'chip.bass', 'bass.square': 'chip.bass', 'bass.round': 'chip.bass', 'bass.sub': 'chip.bass',
  'bass.pluck': 'chip.bass', 'bass.fm': 'chip.bass', 'bass.finger': 'chip.bass', 'bass.upright': 'chip.bass',
  'bass.deep': 'chip.bass', 'bass.808': 'chip.bass',
  'drone.sub': 'chip.bass', 'drone.organ': 'chip.bass', 'drone.shimmer': 'chip.bass',
  // Bells: the thin pulse blip.
  'bell.glass': 'chip.bell', 'bell.fm': 'chip.bell', 'bell.chime': 'chip.bell',
  // Counter lines: the thinner pulse, so the line stays apart from the lead.
  'counter.strings': 'lead.pulse', 'counter.soft': 'lead.pulse',
  'chip.lead': 'chip.lead', 'chip.bass': 'chip.bass', 'chip.pad': 'chip.pad', 'chip.bell': 'chip.bell',
}

/** The modern counterpart of every voice (modernOn refines it by layer). Modern voices keep themselves. */
export const MODERN: Record<VoiceId, VoiceId> = {
  // Synth leads become the supersaw anthem lead; the airy ones a vocal.
  'lead.square': 'lead.super', 'lead.saw': 'lead.super', 'lead.pulse': 'lead.super', 'lead.fm': 'lead.super',
  'lead.glide': 'lead.super', 'chip.lead': 'lead.super',
  'lead.hollow': 'vox.chop', 'lead.whistle': 'vox.chop', 'wind.flute': 'vox.chop',
  // Keys, mallets, plucked strings and arps: the supersaw pluck.
  'lead.ep': 'pluck.super', 'keys.piano': 'pluck.super', 'keys.felt': 'pluck.super',
  'mallet.kalimba': 'pluck.super', 'mallet.marimba': 'pluck.super', 'mallet.vibes': 'pluck.super', 'pluck.harp': 'pluck.super',
  'guitar.nylon': 'pluck.super', 'guitar.steel': 'pluck.super', 'guitar.mute': 'pluck.super',
  'arp.square': 'pluck.super', 'arp.pluck': 'pluck.super', 'arp.warm': 'pluck.super', 'arp.glass': 'pluck.super', 'arp.seq': 'pluck.super',
  // Pads and bowed strings: the supersaw pad.
  'pad.saw': 'pad.super', 'pad.strings': 'pad.super', 'pad.choir': 'pad.super', 'pad.glass': 'pad.super',
  'pad.warm': 'pad.super', 'pad.dark': 'pad.super', 'strings.ensemble': 'pad.super', 'chip.pad': 'pad.super',
  // Basses: the deep sub (modern.ts gives the half-time grooves the 808).
  'bass.saw': 'bass.deep', 'bass.square': 'bass.deep', 'bass.round': 'bass.deep', 'bass.sub': 'bass.deep',
  'bass.pluck': 'bass.deep', 'bass.fm': 'bass.deep', 'bass.finger': 'bass.deep', 'bass.upright': 'bass.deep',
  'chip.bass': 'bass.deep',
  // Bells: vocal chops, sprinkled high.
  'bell.glass': 'vox.chop', 'bell.fm': 'vox.chop', 'bell.chime': 'vox.chop', 'chip.bell': 'vox.chop',
  // Counter lines: the soft one sings; the string line becomes one wide supersaw line.
  'counter.soft': 'vox.chop', 'counter.strings': 'pad.super',
  // Drones: the sub holds (the sidechain makes it breathe); the shimmer becomes a high supersaw.
  'drone.sub': 'drone.sub', 'drone.organ': 'drone.sub', 'drone.shimmer': 'pad.super',
  'lead.super': 'lead.super', 'pluck.super': 'pluck.super', 'pad.super': 'pad.super',
  'bass.deep': 'bass.deep', 'bass.808': 'bass.808', 'vox.chop': 'vox.chop',
}

/** Kits: the NES noise channel toward 8-bit. */
export const CHIP_KITS: Record<KitId, KitId> = {
  'kit.synthwave': 'kit.chip', 'kit.soft': 'kit.chip', 'kit.tribal': 'kit.chip', 'kit.brush': 'kit.chip',
  'kit.motorik': 'kit.chip', 'kit.heartbeat': 'kit.chip', 'kit.chip': 'kit.chip', 'kit.acoustic': 'kit.chip',
  'kit.edm': 'kit.chip',
}

/** Kits: the festival kit toward modern. */
export const MODERN_KITS: Record<KitId, KitId> = {
  'kit.synthwave': 'kit.edm', 'kit.soft': 'kit.edm', 'kit.tribal': 'kit.edm', 'kit.brush': 'kit.edm',
  'kit.motorik': 'kit.edm', 'kit.heartbeat': 'kit.edm', 'kit.chip': 'kit.edm', 'kit.acoustic': 'kit.edm',
  'kit.edm': 'kit.edm',
}

/**
 * A melodic chip voice fits some layers badly: an arp gets the chip arp, a
 * counter line the thinner pulse (apart from the lead), a pad the chord
 * arpeggio, a bass the triangle, bells the blip.
 */
const CHIP_LAYER: Partial<Record<Layer, VoiceId>> = {
  arp: 'arp.square', counter: 'lead.pulse', pad: 'chip.pad', bass: 'chip.bass', bells: 'chip.bell',
}

/**
 * Toward modern some layers want one sound whatever they played: the arp the
 * supersaw pluck, the pad the supersaw pad, the bells vocal chops, the bass
 * the deep sub (or the 808 it already is). A counter line never takes the
 * anthem lead or a bass (it sings), and the lead never a pad, a drone or a bass.
 */
function modernOn(layer: Layer, v: VoiceId): VoiceId {
  switch (layer) {
    case 'arp': return 'pluck.super'
    case 'pad': return 'pad.super'
    case 'bells': return 'vox.chop'
    case 'bass': return v === 'bass.808' ? v : 'bass.deep'
    case 'counter': return v === 'lead.super' || v === 'bass.deep' || v === 'bass.808' || v === 'drone.sub' ? 'vox.chop' : v
    case 'lead': return v === 'pad.super' || v === 'bass.deep' || v === 'bass.808' || v === 'drone.sub' ? 'lead.super' : v
    default: return v
  }
}

/** 0 at the middle of the knob, 1 at either end. */
export function eraDistance(era: number): number {
  return Math.min(1, Math.abs(era - 0.5) * 2)
}

/** How far toward modern (0 at and below the middle, 1 at the top). */
export function modernAmount(era: number): number {
  return Math.max(0, Math.min(1, (era - 0.5) * 2))
}

/** Whether `layer` has handed over at this era (never at 0.5). */
export function handedOver(layer: Layer, era: number): boolean {
  const d = eraDistance(era)
  return d > 0 && d + 1e-9 >= (era > 0.5 ? MODERN_HANDOVER : HANDOVER)[layer]
}

/** The voice `layer` plays at `era` in place of `voice`. */
export function eraVoice(voice: VoiceId, layer: Layer, era: number): VoiceId {
  if (!handedOver(layer, era)) return voice
  if (era > 0.5) return modernOn(layer, MODERN[voice])
  const v = CHIP[voice]
  return v === 'chip.lead' ? CHIP_LAYER[layer] ?? v : v
}

/** The kit `layer` plays at `era` in place of `kit`. */
export function eraKit(kit: KitId, layer: Layer, era: number): KitId {
  if (!handedOver(layer, era)) return kit
  return era > 0.5 ? MODERN_KITS[kit] : CHIP_KITS[kit]
}

/**
 * One bar's notes and drums at `era`. Events that keep their sound are
 * passed through as they are (at 0.5 the arrays come back unchanged);
 * changed ones are copies, so nothing the composer or a landscape holds is
 * touched. Then every chip.pad note learns its place in its chord.
 */
export function eraBar(notes: NoteEvent[], drums: DrumEvent[], era: number): { notes: NoteEvent[]; drums: DrumEvent[] } {
  let ns = notes
  let ds = drums
  if (eraDistance(era) > 0) {
    ns = notes.map(n => {
      const v = eraVoice(n.voice, n.layer, era)
      return v === n.voice ? n : { ...n, voice: v }
    })
    ds = drums.map(d => {
      const k = eraKit(d.kit, d.layer, era)
      return k === d.kit ? d : { ...d, kit: k }
    })
  }
  return { notes: chipChords(ns), drums: ds }
}

/**
 * chip.pad plays a chord as an arpeggio, so each of its notes needs its
 * place: `opts.chord = [index, count]`, by pitch from low to high among the
 * chip.pad notes of the same layer starting on the same step.
 */
export function chipChords(notes: NoteEvent[]): NoteEvent[] {
  if (!notes.some(n => n.voice === 'chip.pad')) return notes
  const groups = new Map<string, number[]>()
  notes.forEach((n, i) => {
    if (n.voice !== 'chip.pad') return
    const k = `${n.layer}@${n.step}`
    const g = groups.get(k)
    if (g) g.push(i)
    else groups.set(k, [i])
  })
  const out = notes.slice()
  for (const idx of groups.values()) {
    const order = [...idx].sort((a, b) => notes[a]!.midi - notes[b]!.midi || a - b)
    order.forEach((i, place) => {
      const n = notes[i]!
      const c = n.opts?.chord
      if (c && c[0] === place && c[1] === order.length) return
      out[i] = { ...n, opts: { ...n.opts, chord: [place, order.length] } }
    })
  }
  return out
}
