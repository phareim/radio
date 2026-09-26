/**
 * Browser side of the audio level check (bundled by tests/audio-check.mjs).
 *
 * Renders each case through the real core (voices, drums, ambience, fx,
 * master chain) in an OfflineAudioContext, ticking the scheduler as the
 * render advances, and measures the result: peak, RMS, loudest 400 ms,
 * pre-limiter peak, DC, NaN, clipped samples, spectral centroid and the
 * share of energy above 5 kHz.
 */
import type { AmbienceId, ConductorLike, KitId, LiveNote, VoiceId } from '../engine/types.ts'
import { createCore } from '../engine/audio/core.ts'
import { createPlayer } from '../engine/audio/player.ts'
import { VOICE_IDS } from '../engine/audio/voices.ts'
import { KIT_IDS } from '../engine/audio/drums.ts'
import { AMBIENCE_IDS } from '../engine/audio/ambience.ts'
import { createConductor } from '../engine/conductor.ts'
import { LANDSCAPES } from '../engine/landscapes/index.ts'
import { soloVoice, kitHits, kitGroove, soloAmbience, fullMix, playPart, silentLayer, layerOf, HIT_ORDER } from './audio-fixtures.ts'

const SR = 48000

interface Case {
  group: string
  name: string
  seconds: number
  conductor: () => ConductorLike
  /** Measure from this time on (skip build-ups). */
  from?: number
  /** Measure these windows separately: [label, start, end]. */
  windows?: Array<[string, number, number]>
  wav?: boolean
  /** Check visual() invariants while rendering. */
  visual?: boolean
  /** Called at every scheduler tick (0.5 s apart) after core.tick: live notes. */
  onTick?: (core: ReturnType<typeof createCore>, t: number, errs: string[]) => void
}

export interface Stats {
  peak: number
  rms: number
  /** Loudness (BS.1770 K-weighted, ungated) over the window, and the loudest 400 ms. */
  lufs: number
  mom: number
  pre: number
  dc: number
  nan: number
  clip: number
  centroid: number
  hf: number
}

export interface Row {
  group: string
  name: string
  stats: Stats
  windows?: Array<[string, Stats]>
  wav?: string
  ms: number
  /** Audio nodes created per second of audio. */
  nodesPerSec: number
  /** visual() invariant violations (first few). */
  visualErrors: string[]
  /** Core queue lengths at the end of the render. */
  sizes: Record<string, number>
}

/** Count every create*() call on a context. */
function countNodes(ac: BaseAudioContext): () => number {
  let n = 0
  const proto = Object.getPrototypeOf(Object.getPrototypeOf(ac)) as Record<string, unknown>
  for (const key of Object.getOwnPropertyNames(proto)) {
    if (!key.startsWith('create') || key === 'createBuffer' || key === 'createPeriodicWave') continue
    const fn = proto[key]
    if (typeof fn !== 'function') continue
    Object.defineProperty(ac, key, { value: (...a: unknown[]) => { n++; return (fn as (...x: unknown[]) => unknown).apply(ac, a) } })
  }
  return () => n
}

function checkVisual(v: ReturnType<ReturnType<typeof createCore>['visual']>, t: number, errs: string[]): void {
  const bad = (m: string) => { if (errs.length < 6) errs.push(`t=${t.toFixed(1)}: ${m}`) }
  if (!(v.step >= 0 && v.step <= 16)) bad(`step ${v.step}`)
  if (!(v.beat >= 0 && v.beat <= 1)) bad(`beat ${v.beat}`)
  if (!(v.scene.blend >= 0 && v.scene.blend <= 1)) bad(`blend ${v.scene.blend}`)
  if (v.recent.length > 24) bad(`recent ${v.recent.length}`)
  for (let i = 1; i < v.recent.length; i++) if (v.recent[i]!.age > v.recent[i - 1]!.age) bad('recent not newest-last')
  for (const [l, x] of Object.entries(v.levels)) if (!(x >= 0 && x <= 1)) bad(`level ${l} ${x}`)
  if (t > 3 && !v.bar) bad('no bar')
  if (!Number.isFinite(v.time)) bad('time')
}

const db = (x: number) => (x > 0 ? 20 * Math.log10(x) : -200)

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j]!, re[i]!]; [im[i], im[j]] = [im[j]!, im[i]!] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2
        const xr = re[b]! * cr - im[b]! * ci
        const xi = re[b]! * ci + im[b]! * cr
        re[b] = re[a]! - xr; im[b] = im[a]! - xi
        re[a] = re[a]! + xr; im[a] = im[a]! + xi
        const t = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = t
      }
    }
  }
}

/** BS.1770 K-weighting at 48 kHz: the head shelf, then the RLB high-pass. */
function kWeight(x: Float32Array, a: number, b: number): Float64Array {
  const y = new Float64Array(b - a)
  const stage = (inp: ArrayLike<number>, off: number, out: Float64Array, bb: number[], aa: number[]) => {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0
    for (let i = 0; i < out.length; i++) {
      const x0 = inp[off + i]!
      const v = bb[0]! * x0 + bb[1]! * x1 + bb[2]! * x2 - aa[1]! * y1 - aa[2]! * y2
      x2 = x1; x1 = x0; y2 = y1; y1 = v
      out[i] = v
    }
  }
  const tmp = new Float64Array(b - a)
  stage(x, a, tmp, [1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585])
  stage(tmp, 0, y, [1, -2, 1], [1, -1.99004745483398, 0.99007225036621])
  return y
}

function measure(buf: AudioBuffer, t0: number, t1: number): Stats {
  const a = Math.max(0, Math.floor(t0 * SR))
  const b = Math.min(buf.length, Math.floor(t1 * SR))
  const L = buf.getChannelData(0), R = buf.getChannelData(1)
  const PL = buf.getChannelData(2), PR = buf.getChannelData(3)
  let peak = 0, pre = 0, sum = 0, dcL = 0, dcR = 0, nan = 0, clip = 0
  for (let i = a; i < b; i++) {
    const l = L[i]!, r = R[i]!
    if (!Number.isFinite(l) || !Number.isFinite(r)) { nan++; continue }
    const m = Math.max(Math.abs(l), Math.abs(r))
    if (m > peak) peak = m
    if (m >= 0.999) clip++
    const p = Math.max(Math.abs(PL[i]!), Math.abs(PR[i]!))
    if (p > pre) pre = p
    sum += l * l + r * r
    dcL += l; dcR += r
  }
  const n = Math.max(1, b - a)
  // K-weighted power per sample (both channels summed), then integrated and loudest 400 ms.
  const kl = kWeight(L, a, b), kr = kWeight(R, a, b)
  const pw = new Float64Array(b - a)
  let ksum = 0
  for (let i = 0; i < pw.length; i++) { pw[i] = kl[i]! * kl[i]! + kr[i]! * kr[i]!; ksum += pw[i]! }
  const lufsOf = (e: number) => (e > 0 ? -0.691 + 10 * Math.log10(e) : -200)
  const w = Math.floor(0.4 * SR)
  let mom = 0
  for (let s = 0; s + w <= pw.length; s += Math.floor(w / 4)) {
    let e = 0
    for (let i = s; i < s + w; i++) e += pw[i]!
    mom = Math.max(mom, e / w)
  }
  // Average spectrum over up to 48 Hann windows.
  const N = 4096
  const spec = new Float64Array(N / 2)
  const count = Math.min(48, Math.floor((b - a) / N))
  for (let k = 0; k < count; k++) {
    const s = a + Math.floor(((b - a - N) * k) / Math.max(1, count - 1))
    const re = new Float64Array(N), im = new Float64Array(N)
    for (let i = 0; i < N; i++) re[i] = ((L[s + i]! + R[s + i]!) / 2) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)))
    fft(re, im)
    for (let i = 0; i < N / 2; i++) spec[i] = spec[i]! + re[i]! * re[i]! + im[i]! * im[i]!
  }
  let tot = 0, cen = 0, hi = 0
  for (let i = 1; i < N / 2; i++) {
    const f = (i * SR) / N
    tot += spec[i]!
    cen += f * spec[i]!
    if (f > 5000) hi += spec[i]!
  }
  return {
    peak: db(peak), rms: db(Math.sqrt(sum / (2 * n))), lufs: lufsOf(ksum / n), mom: lufsOf(mom), pre: db(pre),
    dc: Math.max(Math.abs(dcL / n), Math.abs(dcR / n)), nan, clip,
    centroid: tot > 0 ? cen / tot : 0, hf: tot > 0 ? (100 * hi) / tot : 0,
  }
}

function wav16(buf: AudioBuffer, t0: number): string {
  const a = Math.floor(t0 * SR)
  const n = buf.length - a
  const out = new DataView(new ArrayBuffer(44 + n * 4))
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)) }
  w(0, 'RIFF'); out.setUint32(4, 36 + n * 4, true); w(8, 'WAVE'); w(12, 'fmt ')
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true)
  out.setUint32(24, SR, true); out.setUint32(28, SR * 4, true); out.setUint16(32, 4, true); out.setUint16(34, 16, true)
  w(36, 'data'); out.setUint32(40, n * 4, true)
  const L = buf.getChannelData(0), R = buf.getChannelData(1)
  for (let i = 0; i < n; i++) {
    out.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[a + i]!)) * 32767, true)
    out.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[a + i]!)) * 32767, true)
  }
  const bytes = new Uint8Array(out.buffer)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

async function render(c: Case): Promise<Row> {
  const started = performance.now()
  const ac = new OfflineAudioContext(4, Math.floor(SR * c.seconds), SR)
  ac.destination.channelInterpretation = 'discrete'
  const nodes = countNodes(ac)
  const core = createCore(ac, c.conductor())
  const visualErrors: string[] = []
  const merge = ac.createChannelMerger(4)
  merge.channelInterpretation = 'discrete'
  const post = ac.createChannelSplitter(2)
  const pre = ac.createChannelSplitter(2)
  core.output.connect(post)
  core.fx.probe.connect(pre)
  post.connect(merge, 0, 0); post.connect(merge, 1, 1)
  pre.connect(merge, 0, 2); pre.connect(merge, 1, 3)
  merge.connect(ac.destination)
  // Tick the scheduler as the render advances, like the live clock (0.5 s steps, 0.7 s lookahead).
  core.tick(0, 0.7)
  for (let t = 0.5; t < c.seconds; t += 0.5) {
    const at = t
    ac.suspend(at).then(() => {
      core.tick(at, at + 0.7)
      core.due(at)
      c.onTick?.(core, at, visualErrors)
      if (c.visual) checkVisual(core.visual(at), at, visualErrors)
      return ac.resume()
    }).catch(() => {})
  }
  const buf = await ac.startRendering()
  const row: Row = {
    group: c.group, name: c.name, stats: measure(buf, c.from ?? 0, c.seconds), ms: performance.now() - started,
    nodesPerSec: nodes() / c.seconds, visualErrors, sizes: core.sizes(),
  }
  if (c.windows) row.windows = c.windows.map(([label, a, b]) => [label, measure(buf, a, b)])
  if (c.wav) row.wav = wav16(buf, 0)
  return row
}

function cases(filter: string, wavAll: boolean): Case[] {
  const out: Case[] = []
  for (const v of VOICE_IDS) out.push({ group: 'voice', name: v, seconds: 14, conductor: () => soloVoice(v as VoiceId) })
  for (const k of KIT_IDS) {
    const bar = 2.4
    out.push({
      group: 'hits', name: k, seconds: 16.5, conductor: () => kitHits(k as KitId),
      windows: HIT_ORDER.map((h, i) => [h, 0.08 + (i * bar) / 2, 0.08 + ((i + 1) * bar) / 2 + (h === 'z' ? 0.2 : 0)]),
    })
    out.push({ group: 'kit', name: k, seconds: 18, conductor: () => kitGroove(k as KitId) })
  }
  for (const a of AMBIENCE_IDS) out.push({ group: 'ambience', name: a, seconds: 20, conductor: () => soloAmbience(a as AmbienceId), from: 1 })
  out.push({ group: 'mix', name: 'fullmix', seconds: 24, conductor: fullMix, from: 2, wav: true, visual: true })
  // The played instruments as a player uses them (listen with --wav).
  for (const v of PLAYED) out.push({ group: 'play', name: v, seconds: 14, conductor: () => playPart(v), wav: wavAll })
  // Live notes: a chord (or a hit) held for half a second, then let go; dry, so a click at the release would show.
  for (const v of [...PLAYED, 'lead.glide', 'pad.warm'] as VoiceId[]) {
    out.push({ group: 'live', name: v, seconds: 8, conductor: () => silentLayer(layerOf(v), { reverb: 0, delay: 0 }), wav: wavAll, onTick: liveChords(v) })
  }
  out.push({ group: 'live', name: 'kit.soft', seconds: 8, conductor: () => silentLayer('drums'), wav: wavAll, onTick: liveHits('kit.soft') })
  // Reverb/delay share: the same line dry and at the default sends.
  for (const v of ['lead.square', 'pad.saw', 'bell.glass'] as VoiceId[]) {
    out.push({ group: 'wet', name: `${v}:dry`, seconds: 14, conductor: () => soloVoice(v, { reverb: 0, delay: 0 }) })
    out.push({ group: 'wet', name: `${v}:wet`, seconds: 14, conductor: () => soloVoice(v) })
  }
  for (const id of Object.keys(LANDSCAPES)) {
    out.push({
      group: 'landscape', name: id, seconds: 50, from: 22, wav: wavAll, visual: true,
      conductor: () => createConductor({ lookup: x => LANDSCAPES[x], seed: 7, controls: { landscape: id, intensity: 4 } }),
    })
  }
  // Opt-in (filter 'long'): ten minutes of a landscape with a control change, for queue growth and node counts.
  out.push({
    group: 'long', name: 'coast-10min', seconds: 600, from: 30, visual: true,
    conductor: () => {
      const c = createConductor({ lookup: x => LANDSCAPES[x], seed: 3, controls: { landscape: 'coast', intensity: 3 } })
      let n = 0
      const next = c.nextBar.bind(c)
      c.nextBar = () => {
        n++
        if (n === 100) c.setControls({ landscape: 'nightdrive', intensity: 4 })
        if (n === 200) c.setControls({ landscape: 'deepspace', intensity: 1 })
        return next()
      }
      return c
    },
  })
  const pickd = filter ? out.filter(c => `${c.group}:${c.name}`.includes(filter)) : out.filter(c => c.group !== 'long')
  return pickd
}

const PLAYED: VoiceId[] = ['keys.piano', 'keys.felt', 'guitar.nylon', 'guitar.steel', 'guitar.mute', 'bass.finger']

/**
 * Live notes: a chord on even ticks, released on the next tick (so each
 * release sits alone, where a click would show); the glide lead plays
 * overlapping notes instead so it slides. Checks visual() shows them.
 */
function liveChords(v: VoiceId): NonNullable<Case['onTick']> {
  let held: LiveNote[] = []
  let k = 0
  let tick = 0
  const glide = v === 'lead.glide'
  const low = v.startsWith('bass') ? -24 : glide ? 12 : 0
  const shapes = [[62, 65, 69], [59, 62, 67], [60, 64, 67], [57, 60, 64]]
  return (core, t, errs) => {
    const odd = tick++ % 2 === 1
    if (glide) {
      // Start the next note, then let go of the previous one: legato.
      const prev = held
      held = []
      if (t <= 6.5) held.push(core.live('lead', { voice: v, midi: shapes[k++ % shapes.length]![0]! + low }, 0.8))
      for (const h of prev) h.release()
      return
    }
    for (const h of held) h.release()
    held = []
    if (t > 6.5 || odd) return
    const shape = shapes[k++ % shapes.length]!
    const notes = v.startsWith('bass') ? [shape[0]!] : shape
    for (const m of notes) held.push(core.live(layerOf(v), { voice: v, midi: m + low }, 0.5 + 0.4 * ((k % 3) / 2)))
    const vis = core.visual(core.res.ac.currentTime + 0.02)
    if (!vis.recent.some(r => r.age < 0.1) && errs.length < 6) errs.push(`t=${t.toFixed(1)}: live note missing from recent`)
    if (!(vis.levels[layerOf(v)] > 0) && errs.length < 6) errs.push(`t=${t.toFixed(1)}: live note missing from levels`)
  }
}

function liveHits(kit: KitId): NonNullable<Case['onTick']> {
  const seq = ['k', 'h', 's', 'h'] as const
  let k = 0
  return (core, t) => {
    if (t > 6.5) return
    core.live('drums', { kit, hit: seq[k++ % seq.length]! }, 0.85).release()
  }
}

declare global {
  interface Window {
    runAudioCheck(filter: string, wavAll: boolean): Promise<Row[]>
    smokePlayer(): Promise<Record<string, unknown>>
  }
}

/** The live player end to end: worker clock, real AudioContext, onBar, visual(), stop. */
window.smokePlayer = async () => {
  const conductor = createConductor({ lookup: x => LANDSCAPES[x], seed: 1, controls: { landscape: 'nightdrive', intensity: 4 } })
  const p = createPlayer(conductor)
  const bars: number[] = []
  const off = p.onBar(b => bars.push(b.index))
  const liveBefore = p.live('lead', { voice: 'keys.piano', midi: 60 }, 0.8)
  await p.start()
  const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
  await wait(6000)
  const v = p.visual()
  const res: Record<string, unknown> = {
    state: p.context?.state, playing: p.playing, bars: bars.slice(), time: +v.time.toFixed(2), step: +v.step.toFixed(2),
    bar: v.bar?.index ?? null, beatSeen: false, levels: Object.fromEntries(Object.entries(v.levels).map(([k, x]) => [k, +x.toFixed(2)])),
    recent: v.recent.length, stream: !!p.stream,
  }
  let beat = 0
  for (let i = 0; i < 40; i++) { beat = Math.max(beat, p.visual().beat); await wait(25) }
  res.beatSeen = beat > 0.3
  // Live notes and the clock position (jam): null before start, a note and a position while playing.
  const note = p.live('lead', { voice: 'keys.piano', midi: 64 }, 0.8)
  const hit = p.live('drums', { kit: 'kit.soft', hit: 's' }, 0.8)
  await wait(300)
  note?.release()
  hit?.release()
  const ctx = p.context!
  res.live = { before: liveBefore, note: !!note, hit: !!hit, recent: p.visual().recent.some(r => r.midi === 64) }
  res.positionAt = p.positionAt(ctx.currentTime - p.latency)
  res.positionFar = p.positionAt(ctx.currentTime + 60)
  res.latency = +p.latency.toFixed(4)
  res.sampleRate = ctx.sampleRate
  p.setOutput('stream')
  p.setOutput('stream')
  p.setOutput('speakers')
  res.setOutput = 'ok'
  p.setVolume(0.5)
  p.stop()
  await wait(1400)
  res.afterStop = { state: p.context?.state, playing: p.playing }
  await p.start()
  await wait(1500)
  res.afterRestart = { state: p.context?.state, playing: p.playing, bars: bars.length }
  off()
  p.stop()
  return res
}

/** Does a second stop() move the stop time (pad/drone ties rely on it)? Energy between 0.6 and 0.9 s says yes. */
async function probeStopTwice(): Promise<string> {
  const ac = new OfflineAudioContext(1, SR * 1.5, SR)
  const o = ac.createOscillator()
  o.connect(ac.destination)
  o.start(0)
  o.stop(0.5)
  let threw = ''
  try { o.stop(1.0) } catch (e) { threw = String(e) }
  const buf = await ac.startRendering()
  const d = buf.getChannelData(0)
  let e = 0
  for (let i = Math.floor(0.6 * SR); i < 0.9 * SR; i++) e += d[i]! * d[i]!
  return threw ? `second stop() threw: ${threw}` : e > 1 ? 'ok' : 'second stop() ignored'
}

window.runAudioCheck = async (filter: string, wavAll: boolean) => {
  const rows: Row[] = []
  const tie = await probeStopTwice()
  if (tie !== 'ok') console.error(`ties: ${tie}`)
  for (const c of cases(filter, wavAll)) rows.push(await render(c))
  return rows
}
