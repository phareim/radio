/**
 * Standalone harness for the scenes: a fake VisualState (kick on every
 * beat, arp eighths, bells and a lead line, chords changing every bar)
 * driving `createScene` on a full-window canvas. Bundle with
 * `node scene/tools/build-dev.mjs` and open `scene/dev.html`.
 *
 *   ?scene=jungle            one place
 *   ?from=coast&to=summit&blend=0.5   a frozen dissolve
 *   ?tour=1                  every place in turn, dissolving between them
 *   ?intensity=3&mode=aeolian&clean=1
 *
 * `window.__radio.set({...})` changes the same fields at run time (the
 * screenshot script uses it); `__radio.cost()` is the mean ms per frame.
 */
import type { BarPlan, Layer, Mode, VisualState } from '../engine/types.ts'
import { createScene, SCENE_IDS } from './index.ts'

interface Opts { from: string; to: string; blend: number; intensity: number; mode: Mode; tour: boolean; idle: boolean; bpm: number }

const q = new URLSearchParams(location.search)
const opts: Opts = {
  from: q.get('from') ?? q.get('scene') ?? 'coast',
  to: q.get('to') ?? q.get('scene') ?? 'coast',
  blend: Number(q.get('blend') ?? 1),
  intensity: Number(q.get('intensity') ?? 2),
  mode: (q.get('mode') as Mode) ?? 'dorian',
  tour: q.get('tour') === '1',
  idle: q.get('idle') === '1',
  bpm: Number(q.get('bpm') ?? 100),
}

const canvas = document.getElementById('c') as HTMLCanvasElement
const info = document.getElementById('info') as HTMLElement
if (q.get('clean') === '1') info.style.display = 'none'
const scene = createScene(canvas)

function fit() {
  scene.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1)
}
fit()
window.addEventListener('resize', fit)

// ---- fake music -------------------------------------------------------------

const SCALE = [0, 2, 3, 5, 7, 9, 10]
const ROOTS = [2, 10, 5, 0, 7, 3]
const t0 = performance.now()

function recentAt(time: number, spb: number): VisualState['recent'] {
  const out: VisualState['recent'] = []
  const eighth = spb / 2
  const first = Math.floor((time - 2) / eighth)
  const last = Math.floor(time / eighth)
  for (let i = Math.max(0, first); i <= last; i++) {
    const start = i * eighth
    const age = time - start
    if (age < 0 || age > 2) continue
    const deg = [0, 2, 4, 6, 4, 2, 1, 3][i % 8]!
    out.push({ layer: 'arp', midi: 62 + SCALE[deg % 7]! + (i % 16 >= 8 ? 12 : 0), age })
    if (i % 6 === 3) out.push({ layer: 'lead', midi: 67 + SCALE[(i * 3) % 7]!, age })
    if (i % 16 === 0) out.push({ layer: 'bells', midi: 81 + SCALE[(i / 16) % 7]!, age })
  }
  return out.slice(-24)
}

function visual(now: number): VisualState {
  const time = Math.max(0, (now - t0) / 1000)
  const spb = 60 / opts.bpm
  const beatPhase = (time / spb) % 1
  const barLen = spb * 4
  const barIx = Math.floor(time / barLen)
  const step = ((time % barLen) / barLen) * 16
  const root = ROOTS[barIx % ROOTS.length]!
  let from = opts.from
  let to = opts.to
  let blend = opts.blend
  if (opts.tour) {
    const per = 10
    const k = time / per
    const i = Math.floor(k)
    from = SCENE_IDS[i % SCENE_IDS.length]!
    to = SCENE_IDS[(i + 1) % SCENE_IDS.length]!
    const f = k - i
    blend = f < 0.6 ? 0 : Math.min(1, (f - 0.6) / 0.35)
  }
  const bar = opts.idle ? null : ({
    index: barIx,
    bpmStart: opts.bpm,
    bpmEnd: opts.bpm,
    swing: 0,
    chords: [{ from: 0, len: 16, chord: { root, bass: root, tones: [0, 3, 7], symbol: '', degree: '' } }],
    key: { tonic: 2, mode: opts.mode },
    scale: SCALE,
    notes: [],
    drums: [],
    mix: {},
    fx: { reverb: 0, delay: 0, reverbSize: 2, tone: 1, grit: 0, pump: 0, width: 1 },
    ambience: {},
    ambienceFadeBars: 1,
    meta: {
      landscape: to,
      scene: { from, to, blendStart: blend, blendEnd: blend },
      phraseBar: barIx % 8,
      phraseBars: 8,
      section: 'a',
      active: ['pad', 'arp'] as Layer[],
      upcoming: [],
      transition: { kind: 'none', from: '', to: '', progress: 0, note: '' },
      intensity: opts.intensity,
    },
  } as BarPlan)
  const levels = { ambience: 1, drone: 0.5, pad: 0.8, bass: 0.7, drums: 0.8, perc: 0.3, arp: 0.7, lead: 0.5, counter: 0, bells: 0.4 } as Record<Layer, number>
  return {
    bar,
    step,
    scene: { from, to, blend },
    beat: opts.intensity >= 1 ? Math.exp(-beatPhase * 5) : 0,
    levels,
    recent: recentAt(time, spb),
    time,
    playing: true,
  }
}

// ---- loop -------------------------------------------------------------------

const costs: number[] = []
let failed = false
function loop(now: number) {
  const v = visual(now)
  const a = performance.now()
  try {
    scene.frame(v, now)
  } catch (e) {
    if (!failed) console.error((e as Error).stack)
    failed = true
  }
  const ms = performance.now() - a
  costs.push(ms)
  if (costs.length > 120) costs.shift()
  if (info.style.display !== 'none' && costs.length % 10 === 0) {
    info.textContent = `${v.scene.from} → ${v.scene.to} ${v.scene.blend.toFixed(2)} · int ${opts.intensity} · ${cost().toFixed(2)} ms/frame`
  }
  requestAnimationFrame(loop)
}
function cost() { return costs.reduce((s, x) => s + x, 0) / Math.max(1, costs.length) }
requestAnimationFrame(loop)

declare global {
  interface Window { __radio: { set(o: Partial<Opts>): void; cost(): number; ids: readonly string[] } }
}
window.__radio = {
  set(o) {
    Object.assign(opts, o)
    costs.length = 0
  },
  cost,
  ids: SCENE_IDS,
}
