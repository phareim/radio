/**
 * Print what the conductor does over a scripted session, bar by bar:
 *   node --no-warnings tests/timeline.ts [bars] [--seed=N] [--jam=<landscape id>]
 * --jam plays a channel made in jam from that landscape (pieceFromLandscape,
 * then pieceToLandscape with its phrases written), so the quoted sections
 * (W:P1, W:P2) show, with intensity and mood moves along the way.
 */
import { createConductor } from '../engine/conductor.ts'
import { LANDSCAPES } from '../engine/landscapes/index.ts'
import { midiName } from '../engine/theory.ts'
import { pieceFromLandscape, pieceToLandscape } from '../engine/piece/index.ts'
import type { Controls, Landscape } from '../engine/types.ts'

const args = process.argv.slice(2)
const flag = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1]
const bars = Number(args.find(a => /^\d+$/.test(a)) ?? 140)
const seed = Number(flag('seed') ?? 42)
const jamFrom = flag('jam')

let lookup = (id: string): Landscape | undefined => LANDSCAPES[id]
let start: Partial<Controls> = { landscape: 'coast', intensity: 2 }
let script: Record<number, Partial<Controls>> = {
  24: { intensity: 4 },
  44: { landscape: 'jungle' },
  76: { intensity: 1 },
  92: { mood: 1 },
  104: { landscape: 'deepspace', intensity: 3 },
}
if (jamFrom) {
  const from = LANDSCAPES[jamFrom]
  if (!from) throw new Error(`no landscape '${jamFrom}'`)
  const J = pieceToLandscape(pieceFromLandscape(from, { lookup, seed: 1 }), from)
  const builtin = lookup
  lookup = id => (id === J.id ? J : builtin(id))
  start = { landscape: J.id, intensity: 2 }
  script = { 40: { intensity: 4 }, 88: { mood: 0 }, 136: { mood: 1 }, 184: { intensity: 1 } }
  console.log(`      ${J.id}: ${J.written?.length ?? 0} written phrases (${J.written?.map(w => `${w.name} '${w.chords}' ${w.parts.map(p => `${p.layer}@${p.enter}`).join(' ')}`).join('; ')}), quote ${J.quote}`)
}

const c = createConductor({ lookup, seed, controls: start })
for (let i = 0; i < bars; i++) {
  if (script[i]) { c.setControls(script[i]!); console.log(`      >>> ${JSON.stringify(script[i])}`) }
  const p = c.nextBar()
  const lead = p.notes.filter(n => n.layer === 'lead').map(n => midiName(n.midi, p.key)).join(' ')
  const counts = p.meta.active.filter(l => l !== 'ambience').map(l => l[0]!.toUpperCase() + l.slice(1, 3)).join(' ')
  const kick = p.drums.filter(d => d.hit === 'k').length
  console.log(
    `${String(p.index).padStart(3)} ${p.meta.landscape.padEnd(9)} ${p.meta.section.padEnd(6)} ${p.meta.phraseBar + 1}/${p.meta.phraseBars}`,
    `${p.bpmStart.toFixed(0)}bpm ${p.key.mode.slice(0, 4)} ${p.chords.map(s => s.chord.symbol).join('|').padEnd(14)} [${counts}] k${kick}`,
    p.meta.transition.note ? `«${p.meta.transition.note}»` : '',
    lead ? `lead: ${lead}` : '',
  )
}
