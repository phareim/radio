/** Print what the conductor does over a scripted session: `node --no-warnings tests/timeline.ts`. */
import { createConductor } from '../engine/conductor.ts'
import { LANDSCAPES } from '../engine/landscapes/index.ts'
import { midiName } from '../engine/theory.ts'
import type { Controls } from '../engine/types.ts'

const script: Record<number, Partial<Controls>> = {
  24: { intensity: 4 },
  44: { landscape: 'jungle' },
  76: { intensity: 1 },
  92: { mood: 1 },
  104: { landscape: 'deepspace', intensity: 3 },
}
const c = createConductor({ lookup: id => LANDSCAPES[id], seed: 42, controls: { landscape: 'coast', intensity: 2 } })
const bars = Number(process.argv[2] ?? 140)
for (let i = 0; i < bars; i++) {
  if (script[i]) { c.setControls(script[i]!); console.log(`      >>> ${JSON.stringify(script[i])}`) }
  const p = c.nextBar()
  const lead = p.notes.filter(n => n.layer === 'lead').map(n => midiName(n.midi, p.key)).join(' ')
  const counts = p.meta.active.filter(l => l !== 'ambience').map(l => l[0]!.toUpperCase() + l.slice(1, 3)).join(' ')
  const kick = p.drums.filter(d => d.hit === 'k').length
  console.log(
    `${String(p.index).padStart(3)} ${p.meta.landscape.padEnd(9)} ${p.meta.section.padEnd(6)} ${p.meta.phraseBar + 1}/${p.meta.phraseBars}`,
    `${p.bpmStart.toFixed(0)}bpm ${p.chords.map(s => s.chord.symbol).join('|').padEnd(14)} [${counts}] k${kick}`,
    p.meta.transition.note ? `«${p.meta.transition.note}»` : '',
    lead ? `lead: ${lead}` : '',
  )
}
