/**
 * Read-only auth state. Reader (reader.phareim.no) is the identity provider
 * and its session cookie covers *.phareim.no. The radio itself is public;
 * `allowed` unlocks thumbs, notes and composing. On localhost (dev) every
 * listener counts as allowed.
 */
import { load, save } from './storage'
import { useChannels } from './useChannels'

export const READER_LOGIN = 'https://reader.phareim.no/login'

/** The member this browser last kept data for. */
const MEMBER_KEY = 'radio.member'

/**
 * A fresh session answer named someone other than the member this browser
 * kept data for (another member, or nobody): drop that member's copies here,
 * both in localStorage and in the service worker's API cache. Their unsent
 * notes are kept for them across a sign-out, and dropped when someone else
 * signs in.
 */
async function forgetOtherMember(who: string | null): Promise<void> {
  const before = load<string | null>(MEMBER_KEY, null)
  save(MEMBER_KEY, who ?? undefined)
  if (!before || before === who) return
  for (const key of ['radio.composed', 'radio.job', 'radio.hidden']) save(key, undefined)
  if (who) save('radio.outbox', undefined)
  useChannels().forget()
  try { await caches.delete('radio-api-v1') } catch { /* no CacheStorage */ }
}

interface SessionUser {
  id: string
  email: string
  name: string | null
}

export function useAuth() {
  const user = useState<SessionUser | null>('auth_user', () => null)
  const allowed = useState<boolean>('auth_allowed', () => false)
  const checked = useState<boolean>('auth_checked', () => false)

  async function fetchSession(): Promise<boolean> {
    if (import.meta.client && ['localhost', '127.0.0.1'].includes(window.location.hostname)) {
      allowed.value = true
      checked.value = true
      return true
    }
    try {
      const data = await $fetch<{ user: SessionUser | null; allowed: boolean }>('/api/auth/session')
      user.value = data.user
      allowed.value = !!data.allowed
      // A cached answer (offline) repeats the member it was cached for; that is
      // left as is.
      await forgetOtherMember(allowed.value && data.user ? data.user.email.toLowerCase() : null)
    } catch {
      user.value = null
      allowed.value = false
    }
    checked.value = true
    return allowed.value
  }

  function loginUrl(): string {
    const here = import.meta.client ? window.location.href : 'https://radio.phareim.no/'
    return `${READER_LOGIN}?redirect=${encodeURIComponent(here)}`
  }

  return { user, allowed, checked, fetchSession, loginUrl }
}
