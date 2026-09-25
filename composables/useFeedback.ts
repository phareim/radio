/**
 * Thumbs and notes. A thumb is saved the moment it is pressed, with the
 * snapshot of that moment; the comment box that opens afterwards PATCHes
 * words onto it. A note (rating 0) is posted when its words are sent, with
 * the snapshot taken when NOTE was pressed.
 *
 * Anything the backend does not take (offline, local dev) waits in an outbox
 * in localStorage and is sent with the next successful save.
 */
import { ref } from 'vue'
import type { Feedback } from '~/engine/types.ts'
import { load, save } from './storage'
import { useRadio } from './useRadio'

const OUTBOX_KEY = 'radio.outbox'

interface Draft {
  rating: Feedback['rating']
  snapshot: Feedback['snapshot']
  /** Backend id once saved; null while it waits in the outbox. */
  id: number | null
  /** Index in the outbox while unsaved. */
  local: string | null
}

const draft = ref<Draft | null>(null)
const toast = ref<{ text: string; tone: 'ok' | 'warn'; n: number } | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | null = null

function say(text: string, tone: 'ok' | 'warn' = 'ok'): void {
  toast.value = { text, tone, n: (toast.value?.n ?? 0) + 1 }
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = null }, 1600)
}

type Pending = Feedback & { local: string }
const outbox = (): Pending[] => load<Pending[]>(OUTBOX_KEY, [])
const keep = (items: Pending[]) => save(OUTBOX_KEY, items.length ? items : undefined)

async function post(f: Feedback): Promise<number> {
  const r = await $fetch<{ id: number }>('/api/feedback', { method: 'POST', body: f })
  return r.id
}

let flushing = false
async function flush(): Promise<void> {
  if (flushing) return
  flushing = true
  try {
    for (const item of outbox()) {
      if (item.rating === 0 && !item.comment.trim()) { keep(outbox().filter(x => x.local !== item.local)); continue }
      await post({ rating: item.rating, comment: item.comment, snapshot: item.snapshot })
      keep(outbox().filter(x => x.local !== item.local))
    }
  } catch {
    /* still offline */
  } finally {
    flushing = false
  }
}

/** ▲ (1) or ▼ (-1): save now, then open the comment box. NOTE (0): open the box; saved on send. */
async function rate(rating: Feedback['rating']): Promise<void> {
  const { snapshot } = useRadio()
  const snap = snapshot()
  draft.value = { rating, snapshot: snap, id: null, local: null }
  if (rating === 0) return
  const d = draft.value
  try {
    d.id = await post({ rating, comment: '', snapshot: snap })
    say('SAVED')
    void flush()
  } catch {
    d.local = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    keep([...outbox(), { rating, comment: '', snapshot: snap, local: d.local }])
    say('KEPT · WILL SEND', 'warn')
  }
}

/** Send the comment box's words. */
async function comment(text: string): Promise<void> {
  const d = draft.value
  draft.value = null
  const words = text.trim()
  if (!d || !words) return
  try {
    if (d.id !== null) {
      await $fetch(`/api/feedback/${d.id}`, { method: 'PATCH', body: { comment: words } })
    } else if (d.local !== null) {
      // The thumb itself is still in the outbox: put the words on it.
      keep(outbox().map(x => (x.local === d.local ? { ...x, comment: words } : x)))
      await flush()
      if (outbox().some(x => x.local === d.local)) throw new Error('offline')
    } else {
      await post({ rating: 0, comment: words, snapshot: d.snapshot })
    }
    say('SAVED')
    void flush()
  } catch {
    if (d.id !== null) {
      // The thumb is saved; only the words did not arrive.
      say('WORDS NOT SAVED', 'warn')
      return
    }
    if (d.local === null) {
      keep([...outbox(), { rating: 0, comment: words, snapshot: d.snapshot, local: `${Date.now()}` }])
    }
    say('KEPT · WILL SEND', 'warn')
  }
}

function dismiss(): void {
  draft.value = null
}

export function useFeedback() {
  return { draft, toast, rate, comment, dismiss, flush, say }
}
