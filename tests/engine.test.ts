/** Engine invariants: `node --no-warnings --test tests/engine.test.ts` */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createConductor } from '../engine/conductor.ts'
import { BUILTIN, LANDSCAPES } from '../engine/landscapes/index.ts'
import { validateLandscape } from '../engine/validate.ts'
import { createRng } from '../engine/rng.ts'
import { parseToken } from '../engine/theory.ts'
import type { BarPlan, Controls, Layer } from '../engine/types.ts'

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
