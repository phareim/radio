/**
 * Opus-composed places: load them from radio-api (cached in localStorage so
 * a reload or a dead backend still finds the one you were listening to),
 * compose new ones and hide old ones.
 *
 * A compose is a job on the backend (one to three minutes); the page polls
 * it every 3 s and keeps the job id in localStorage, so a reload picks the
 * wait back up.
 */
import { ref } from 'vue'
import type { Landscape } from '~/engine/types.ts'
import { validateLandscape } from '~/engine/validate.ts'
import { load, save } from './storage'
import { useRadio } from './useRadio'

const CACHE_KEY = 'radio.composed'
const JOB_KEY = 'radio.job'

interface Job {
  id: number
  kind: string
  status: 'queued' | 'running' | 'done' | 'error'
  result?: { landscape?: Landscape; repaired?: boolean } | null
  error?: string | null
}

type ComposeState =
  | { phase: 'idle' }
  | { phase: 'working'; jobId: number; prompt: string; status: Job['status']; since: number }
  | { phase: 'done'; landscape: Landscape }
  | { phase: 'error'; message: string }

const compose = ref<ComposeState>({ phase: 'idle' })
let pollTimer: ReturnType<typeof setTimeout> | null = null

function validList(list: unknown[]): Landscape[] {
  const out: Landscape[] = []
  for (const raw of list) {
    const v = validateLandscape(raw)
    if (v.ok && v.landscape) out.push({ ...v.landscape, origin: 'opus' })
  }
  return out
}

async function refresh(): Promise<void> {
  const { setComposed } = useRadio()
  setComposed(validList(load<unknown[]>(CACHE_KEY, [])))
  try {
    const r = await $fetch<{ landscapes: unknown[] }>('/api/landscapes')
    const list = validList(r.landscapes ?? [])
    setComposed(list)
    save(CACHE_KEY, list)
  } catch {
    /* backend unreachable: the cache stands */
  }
}

async function start(prompt: string, base?: string): Promise<void> {
  const text = prompt.trim()
  if (!text) return
  compose.value = { phase: 'working', jobId: -1, prompt: text, status: 'queued', since: Date.now() }
  try {
    const r = await $fetch<{ job: Job }>('/api/compose', { method: 'POST', body: { prompt: text, base: base || undefined } })
    compose.value = { phase: 'working', jobId: r.job.id, prompt: text, status: r.job.status, since: Date.now() }
    save(JOB_KEY, { id: r.job.id, prompt: text, since: Date.now() })
    poll()
  } catch {
    compose.value = { phase: 'error', message: 'COULD NOT REACH THE STUDIO' }
  }
}

function poll(): void {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = setTimeout(check, 3000)
}

async function check(): Promise<void> {
  const c = compose.value
  if (c.phase !== 'working') return
  let job: Job
  try {
    job = (await $fetch<{ job: Job }>(`/api/jobs/${c.jobId}`)).job
  } catch {
    poll() // a blip: keep waiting
    return
  }
  if (job.status === 'queued' || job.status === 'running') {
    compose.value = { ...c, status: job.status }
    poll()
    return
  }
  save(JOB_KEY, undefined)
  if (job.status === 'error' || !job.result?.landscape) {
    compose.value = { phase: 'error', message: (job.error || 'OPUS COULD NOT FINISH IT').slice(0, 160) }
    return
  }
  const v = validateLandscape({ ...job.result.landscape, origin: 'opus' })
  if (!v.ok || !v.landscape) {
    compose.value = { phase: 'error', message: `DID NOT VALIDATE: ${v.errors.slice(0, 2).join('; ')}` }
    return
  }
  const L: Landscape = { ...v.landscape, origin: 'opus' }
  const { composed, setComposed } = useRadio()
  setComposed([...composed.value.filter(x => x.id !== L.id), L])
  save(CACHE_KEY, composed.value)
  compose.value = { phase: 'done', landscape: L }
}

/** Pick up a compose that was running when the page was closed. */
function resume(): void {
  const j = load<{ id: number; prompt: string; since: number } | null>(JOB_KEY, null)
  if (!j || typeof j.id !== 'number') return
  if (Date.now() - j.since > 20 * 60_000) { save(JOB_KEY, undefined); return }
  compose.value = { phase: 'working', jobId: j.id, prompt: j.prompt, status: 'running', since: j.since }
  void check()
}

function reset(): void {
  if (compose.value.phase !== 'working') compose.value = { phase: 'idle' }
}

async function hide(id: string): Promise<boolean> {
  const { composed, setComposed, controls, set } = useRadio()
  try {
    await $fetch(`/api/landscapes/${id}`, { method: 'DELETE' })
  } catch {
    return false
  }
  setComposed(composed.value.filter(l => l.id !== id))
  save(CACHE_KEY, composed.value)
  if (controls.landscape === id) set({ landscape: 'coast' })
  return true
}

export function usePlaces() {
  return { compose, refresh, start, resume, reset, hide }
}
