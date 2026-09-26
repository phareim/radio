// Audio math that needs no Web Audio: step timing (tempo glide, swing, fades,
// positionAt), the rendered instruments (Karplus-Strong strings, additive
// pianos) and their buffer cache. Run: node --no-warnings --test tests/audio-timing.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { barTiming, swingWarp, swingUnwarp, dottedEighth, fadeAtBarStart, fadeAtBarEnd, positionIn, type PlacedBar } from '../engine/audio/timing.ts'
import { renderPluck, renderPiano, loopCoefficient } from '../engine/audio/render.ts'
import { renderInstrument, INSTRUMENTS, type InstrumentId } from '../engine/audio/instruments.ts'
import { createBufferCache } from '../engine/audio/synth.ts'
import { VOICE_IDS } from '../engine/catalog.ts'
import { VOICE_IDS as PLAYABLE } from '../engine/audio/voices.ts'

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`)

test('constant tempo: a sixteenth at 120 bpm is 0.125 s, a bar 2 s', () => {
  const t = barTiming(120, 120, 0)
  close(t.dur, 2)
  close(t.at(1), 0.125)
  close(t.at(4), 0.5)
  close(t.at(2.5), 0.3125)
  close(t.at(20), 2.5) // past the bar end the tempo holds
})

test('swing delays odd sixteenths only, by swing × sixteenth', () => {
  const t = barTiming(120, 120, 0.3)
  close(t.at(0), 0)
  close(t.at(1), 0.125 * 1.3)
  close(t.at(2), 0.25)
  close(t.at(3), 0.25 + 0.125 * 1.3)
  close(t.at(16), 2)
  // Swing is capped at half a sixteenth.
  close(barTiming(120, 120, 0.9).at(1), 0.125 * 1.5)
})

test('swing warp is continuous and monotonic', () => {
  let prev = -1
  for (let s = 0; s <= 16; s += 0.01) {
    const w = swingWarp(s, 0.4)
    assert.ok(w >= prev, `warp not monotonic at ${s}`)
    prev = w
  }
  close(swingWarp(1 - 1e-12, 0.4), swingWarp(1, 0.4), 1e-9)
})

test('tempo glide integrates step durations', () => {
  const t = barTiming(100, 140, 0)
  // Closed form: (15 / b) ln(140 / 100), b = 2.5
  close(t.dur, 6 * Math.log(1.4))
  // Numeric integration agrees.
  let sum = 0
  const n = 160000
  for (let i = 0; i < n; i++) {
    const s = ((i + 0.5) / n) * 16
    sum += (15 / (100 + 2.5 * s)) * (16 / n)
  }
  close(t.dur, sum, 1e-7)
  // Steps get shorter as the tempo rises.
  assert.ok(t.at(1) - t.at(0) > t.at(16) - t.at(15))
  close(t.bpmAt(8), 120)
})

test('stepAt inverts straight, also past the bar and while slowing down', () => {
  for (const [a, e] of [[120, 120], [100, 140], [140, 90]] as const) {
    const t = barTiming(a, e, 0)
    for (const s of [0, 0.5, 3, 7.25, 15.9, 16, 18]) close(t.stepAt(t.straight(s)), s, 1e-7)
  }
})

test('dotted eighth at 120 bpm is 0.375 s; junk tempo does not produce NaN', () => {
  close(dottedEighth(120), 0.375)
  assert.ok(Number.isFinite(barTiming(NaN, 0, 0).dur))
})

test('fades evaluate per bar', () => {
  const f = { from: 0, to: 1, start: 10, bars: 4 }
  close(fadeAtBarStart(f, 10), 0)
  close(fadeAtBarEnd(f, 10), 0.25)
  close(fadeAtBarStart(f, 12), 0.5)
  close(fadeAtBarEnd(f, 13), 1)
  close(fadeAtBarEnd(f, 40), 1)
  const jump = { from: 0.2, to: 0.8, start: 3, bars: 0 }
  close(fadeAtBarStart(jump, 3), 0.2)
  close(fadeAtBarEnd(jump, 3), 0.8)
  close(fadeAtBarStart(jump, 4), 0.8)
})

// ---- positionAt ----------------------------------------------------------------------

/** Back-to-back bars from `t0`, as the core schedules them. */
function lay(t0: number, specs: Array<[number, number, number]>, first = 0): PlacedBar[] {
  const out: PlacedBar[] = []
  let t = t0
  specs.forEach(([a, e, sw], i) => {
    const tm = barTiming(a, e, sw)
    out.push({ index: first + i, t0: t, t1: t + tm.dur, tm })
    t += tm.dur
  })
  return out
}

test('swingUnwarp inverts swingWarp', () => {
  for (const sw of [0, 0.1, 0.33, 0.5, 0.9]) {
    for (let s = 0; s <= 16; s += 0.137) close(swingUnwarp(swingWarp(s, sw), sw), s, 1e-9)
  }
})

test('positionAt: steps at a steady tempo, the bar index, null outside', () => {
  const bars = lay(10, [[120, 120, 0], [120, 120, 0]], 40)
  assert.equal(positionIn(bars, 9.99), null)
  assert.deepEqual(positionIn(bars, 10), { bar: 40, step: 0 })
  const p = positionIn(bars, 10 + 0.125 * 5.5)!
  assert.equal(p.bar, 40)
  close(p.step, 5.5)
  const q = positionIn(bars, 12.5)!
  assert.equal(q.bar, 41)
  close(q.step, 4)
  assert.equal(positionIn(bars, 14), null)
  assert.equal(positionIn(bars, NaN), null)
  assert.equal(positionIn([], 3), null)
})

test('positionAt undoes swing: a swung off-beat lands on its step', () => {
  const bars = lay(0, [[100, 100, 0.3]])
  const tm = bars[0]!.tm
  for (const s of [0, 1, 2, 3, 6.5, 7, 13, 15.75]) close(positionIn(bars, tm.at(s))!.step, s, 1e-7)
  // A note played on the straight sixteenth comes out early of the swung one.
  close(positionIn(bars, tm.straight(1))!.step, 1 / 1.3, 1e-7)
})

test('positionAt follows a tempo glide across bars', () => {
  const bars = lay(5, [[90, 120, 0.2], [120, 120, 0.2], [120, 80, 0]], 7)
  for (const [i, b] of bars.entries()) {
    for (const s of [0, 0.5, 3, 9.25, 15.5]) {
      const p = positionIn(bars, b.t0 + b.tm.at(s))!
      assert.equal(p.bar, 7 + i)
      close(p.step, s, 1e-7)
    }
  }
})

test('positionAt: a gap between bars (a stalled clock) is null, steps stay under 16', () => {
  const a = lay(0, [[120, 120, 0]])
  const b = lay(3, [[120, 120, 0]], 1)
  const bars = [...a, ...b]
  assert.equal(positionIn(bars, 2.5), null)
  assert.equal(positionIn(bars, 3)!.bar, 1)
  assert.ok(positionIn(bars, 1.9999999)!.step < 16)
})

// ---- rendered instruments -----------------------------------------------------------------

const SR = 48000

function stats(x: Float32Array, sr = SR) {
  let peak = 0, nan = 0
  for (const v of x) { if (!Number.isFinite(v)) nan++; else peak = Math.max(peak, Math.abs(v)) }
  const rms = (a: number, b: number) => {
    let s = 0
    for (let i = Math.floor(a * sr); i < Math.min(x.length, Math.floor(b * sr)); i++) s += x[i]! * x[i]!
    return Math.sqrt(s / Math.max(1, Math.floor(b * sr) - Math.floor(a * sr)))
  }
  return { peak, nan, rms, dur: x.length / sr }
}

/** Pitch by autocorrelation over 0.2..0.5 s, refined by a parabola. */
function pitchOf(x: Float32Array, f: number): number {
  const a = Math.floor(0.2 * SR), n = Math.floor(0.3 * SR)
  const c = (lag: number) => { let s = 0; for (let i = a; i < a + n; i++) s += x[i]! * x[i + lag]!; return s }
  let best = -Infinity, lag0 = 0
  for (let lag = Math.floor(SR / (f * 1.06)); lag <= Math.ceil(SR / (f / 1.06)); lag++) { const v = c(lag); if (v > best) { best = v; lag0 = lag } }
  const y0 = c(lag0 - 1), y1 = c(lag0), y2 = c(lag0 + 1)
  return SR / (lag0 + (0.5 * (y0 - y2)) / (y0 - 2 * y1 + y2))
}

test('Karplus-Strong: length, in tune, decays, no NaN, peak ≤ 1, silent ends', () => {
  for (const midi of [28, 40, 52, 64, 76, 88]) {
    const f = 440 * Math.pow(2, (midi - 69) / 12)
    const x = renderPluck({ sr: SR, f, t60: 3, hiT60: 0.5, hiHz: 2500, exciteHz: 3000, pos: 0.18, maxDur: 4, seed: midi })
    const s = stats(x)
    assert.equal(s.nan, 0)
    assert.ok(s.peak <= 1 && s.peak > 0.1, `peak ${s.peak}`)
    // Length: min(maxDur, 1.05 t60) less the one period the burst takes to come round.
    close(s.dur, 3.15 - (SR / f) / SR, 2 / f + 0.01)
    // About 60 dB down by t60: the last 10 % is far below the first.
    assert.ok(s.rms(s.dur * 0.85, s.dur * 0.95) < s.rms(0, s.dur * 0.1) * 0.01, `midi ${midi} does not decay`)
    assert.ok(Math.abs(x[0]!) < 1e-3 && Math.abs(x[x.length - 1]!) < 1e-6, 'ends not at zero')
    const cents = 1200 * Math.log2(pitchOf(x, f) / f)
    assert.ok(Math.abs(cents) < 1.5, `midi ${midi} off by ${cents.toFixed(2)} cents`)
  }
})

test('Karplus-Strong: the loop filter makes the highs die faster, deterministic by seed', () => {
  assert.equal(loopCoefficient(SR, 110, 3, 3, 2500), 0)
  const dark = loopCoefficient(SR, 110, 3, 0.2, 2500)
  const bright = loopCoefficient(SR, 110, 3, 1.5, 2500)
  assert.ok(dark > bright && bright > 0 && dark < 1)
  const spec = { sr: SR, f: 196, t60: 2, hiT60: 0.4, hiHz: 2000, exciteHz: 2500, pos: 0.2, maxDur: 2, seed: 9 }
  assert.deepEqual(renderPluck(spec), renderPluck(spec))
  assert.notDeepEqual(renderPluck(spec), renderPluck({ ...spec, seed: 10 }))
})

test('piano: decays with pitch, brighter when struck harder, no NaN, peak ≤ 1', () => {
  /** High-frequency share: RMS of the first difference over RMS, early in the note. */
  const edge = (x: Float32Array) => {
    let d = 0, e = 0
    for (let i = 1; i < 0.3 * SR; i++) { d += (x[i]! - x[i - 1]!) ** 2; e += x[i]! * x[i]! }
    return Math.sqrt(d / e)
  }
  for (const felt of [false, true]) {
    let lastDur = Infinity
    for (const midi of [36, 60, 84]) {
      const soft = renderPiano({ sr: SR, midi, vel: 0.3, felt, maxDur: 6, seed: 1 })
      const hard = renderPiano({ sr: SR, midi, vel: 0.9, felt, maxDur: 6, seed: 1 })
      for (const x of [soft, hard]) {
        const s = stats(x)
        assert.equal(s.nan, 0)
        assert.ok(s.peak <= 1 && s.peak > 0.2, `peak ${s.peak}`)
        assert.ok(s.rms(s.dur * 0.8, s.dur * 0.9) < s.rms(0, 0.3) * 0.1, 'no decay')
        assert.ok(Math.abs(x[0]!) < 1e-3 && x[x.length - 1] === 0)
      }
      assert.ok(edge(hard) > edge(soft) * 1.05, `${felt ? 'felt' : 'piano'} ${midi}: velocity does not brighten`)
      const dur = stats(hard).dur
      assert.ok(dur <= lastDur, 'higher notes should not ring longer')
      lastDur = dur
    }
  }
  // The felt piano is darker than the piano.
  const p = renderPiano({ sr: SR, midi: 60, vel: 0.7, felt: false, maxDur: 6, seed: 1 })
  const f = renderPiano({ sr: SR, midi: 60, vel: 0.7, felt: true, maxDur: 6, seed: 1 })
  assert.ok(edge(p) > edge(f) * 1.3)
})

test('every instrument renders cleanly across its range', () => {
  const ranges: Record<InstrumentId, number[]> = {
    'keys.piano': [21, 48, 72, 96, 108], 'keys.felt': [21, 48, 72, 96, 108],
    'guitar.nylon': [40, 55, 70, 88], 'guitar.steel': [40, 55, 70, 88], 'guitar.mute': [40, 52, 64],
    'bass.finger': [28, 33, 43, 55],
  }
  for (const id of Object.keys(INSTRUMENTS) as InstrumentId[]) {
    for (const midi of ranges[id]) {
      for (const vel of [0.2, 0.95]) {
        const x = renderInstrument(id, midi, vel, SR)
        const s = stats(x)
        assert.equal(s.nan, 0, `${id} ${midi}`)
        assert.ok(s.peak <= 1 && s.peak > 0.05, `${id} ${midi}: peak ${s.peak}`)
        assert.ok(s.dur > 0.1 && s.dur <= 6.01, `${id} ${midi}: ${s.dur} s`)
        assert.ok(Math.abs(x[x.length - 1]!) < 1e-6, `${id} ${midi}: does not end at zero`)
      }
    }
  }
})

test('the new voices are in the catalog and playable', () => {
  for (const id of Object.keys(INSTRUMENTS)) {
    assert.ok(VOICE_IDS.includes(id as never), `${id} missing from catalog`)
    assert.ok(PLAYABLE.includes(id as never), `${id} missing from voices.ts`)
  }
  assert.equal(new Set(PLAYABLE).size, VOICE_IDS.length)
})

test('buffer cache: hits, least recently used out past the budget', () => {
  const fakeAc = {
    sampleRate: SR,
    createBuffer: (_c: number, n: number) => {
      const d = new Float32Array(n)
      return { length: n, duration: n / SR, getChannelData: () => d }
    },
  } as unknown as BaseAudioContext
  const cache = createBufferCache(fakeAc, 250)
  let renders = 0
  const make = (n: number) => () => { renders++; return new Float32Array(n).fill(0.5) }
  const a = cache.get('a', make(100))
  assert.equal(cache.get('a', make(100)), a)
  cache.get('b', make(100))
  cache.get('a', make(100)) // a is now the most recent
  cache.get('c', make(100)) // over budget: b goes
  assert.equal(renders, 3)
  assert.equal(cache.size, 2)
  assert.equal(cache.samples, 200)
  cache.get('a', make(100))
  assert.equal(renders, 3)
  cache.get('b', make(100))
  assert.equal(renders, 4)
  assert.equal(a.getChannelData(0)[5], 0.5)
})
