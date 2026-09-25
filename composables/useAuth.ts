/**
 * Read-only auth state. Reader (reader.phareim.no) is the identity provider
 * and its session cookie covers *.phareim.no. The radio itself is public;
 * `allowed` unlocks thumbs, notes and composing. On localhost (dev) every
 * listener counts as allowed.
 */
export const READER_LOGIN = 'https://reader.phareim.no/login'

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
