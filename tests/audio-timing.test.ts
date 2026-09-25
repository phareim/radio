// Step timing: tempo glide, swing, fades. Run: node --no-warnings tests/audio-timing.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { barTiming, swingWarp, dottedEighth, fadeAtBarStart, fadeAtBarEnd } from '../engine/audio/timing.ts'

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
