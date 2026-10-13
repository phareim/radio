/**
 * Minutes played. The page counts on its own, since the radio plays without
 * a network: seconds of the audio clock, which stands still while the music
 * is paused or the device sleeps, kept in localStorage per device.
 *
 * The device's running total goes to radio-api when the page starts and
 * about once an hour after that, best effort: a report that fails is simply
 * tried again an hour later, and since it is a total and not a step, one
 * that arrives twice counts once. The answer has the listener's sum (every
 * device of a signed-in member, this device for a guest) and everyone's.
 */
import { computed, ref } from 'vue'
import { load, save } from './storage'
import { useRadio } from './useRadio'

const DEVICE_KEY = 'radio.device'
const PLAYED_KEY = 'radio.played'
const HOUR = 3600_000
/** Seconds counted before they are written to localStorage. */
const KEEP_EVERY = 15

interface Answer {
  /** What radio-api holds for this device. */
  device: number
  /** The listener's sum over their devices. */
  mine: number
  /** Every listener's sum. */
  all: number
}

interface Kept {
  /** Seconds this listener has played on this device. */
  seconds: number
  /** radio-api's last answer, so the counter shows offline too. */
  server: Answer | null
}

const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0)

function read(): Kept {
  const k = load<Partial<Kept>>(PLAYED_KEY, {})
  const s = k.server
  return { seconds: num(k.seconds), server: s ? { device: num(s.device), mine: num(s.mine), all: num(s.all) } : null }
}

function deviceId(): string {
  const had = load<string>(DEVICE_KEY, '')
  if (/^[a-f0-9]{32}$/.test(had)) return had
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const id = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
  save(DEVICE_KEY, id)
  return id
}

const kept = ref<Kept>({ seconds: 0, server: null })
/** Seconds counted since the last write. */
let pending = 0
let clock: AudioContext | null = null
let mark = 0
let lastTry = 0
let sending = false
let wired = false
let sampleTimer: ReturnType<typeof setTimeout> | null = null

/** Write what was counted. Read first: another tab may have counted too. */
function keep(): void {
  if (pending <= 0) return
  const k = read()
  k.seconds += pending
  pending = 0
  save(PLAYED_KEY, k)
  kept.value = k
}

/** Take what the audio clock has run since the last look. */
function sample(): void {
  const ac = useRadio().context()
  if (!ac) return
  // A new context starts at zero, and all of its time is music.
  if (ac !== clock) { clock = ac; mark = 0 }
  const d = ac.currentTime - mark
  mark = ac.currentTime
  if (d > 0) pending += d
  if (pending >= KEEP_EVERY) keep()
  if (Date.now() - lastTry >= HOUR) void sync()
}

async function sync(): Promise<void> {
  if (sending) return
  sending = true
  lastTry = Date.now()
  keep()
  try {
    const answer = await $fetch<Answer>('/api/played', { method: 'POST', body: { device: deviceId(), seconds: Math.floor(read().seconds) } })
    const k = read()
    // Cleared storage: radio-api still knows what this device had played.
    k.seconds = Math.max(k.seconds, num(answer.device))
    k.server = { device: num(answer.device), mine: num(answer.mine), all: num(answer.all) }
    save(PLAYED_KEY, k)
    kept.value = k
  } catch {
    /* offline: the next hour tries again */
  } finally {
    sending = false
  }
}

/** Count from the player's bars (they keep coming with the screen locked) and when the page is put away. */
function start(): void {
  if (wired) return
  wired = true
  kept.value = read()
  // The page's first report waits for the session answer (RadioApp sends it).
  lastTry = Date.now()
  // Off the bar callback, like the lock screen's cover.
  useRadio().onBar(() => { if (!sampleTimer) sampleTimer = setTimeout(() => { sampleTimer = null; sample() }, 0) })
  const away = () => { sample(); keep() }
  window.addEventListener('pagehide', away)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') away() })
  // A page left paused still sends its last minutes.
  setInterval(() => { if (Date.now() - lastTry >= HOUR && read().seconds > (kept.value.server?.device ?? -1)) void sync() }, 10 * 60_000)
}

/** Another listener took over this browser: their count starts from what radio-api has for them here. */
function forget(): void {
  pending = 0
  save(PLAYED_KEY, undefined)
  kept.value = { seconds: 0, server: null }
}

// The device's own seconds are fresher here than in radio-api's answer.
const ahead = computed(() => kept.value.seconds - (kept.value.server?.device ?? 0))
const minutes = (s: number) => Math.floor(Math.max(0, s) / 60)
/** Minutes this listener has played. */
const mine = computed(() => minutes((kept.value.server?.mine ?? 0) + ahead.value))
/** Minutes every listener has played together; null until radio-api has answered once. */
const all = computed(() => (kept.value.server ? minutes(kept.value.server.all + ahead.value) : null))

export function usePlayed() {
  return { mine, all, start, sync, forget }
}
