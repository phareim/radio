/**
 * Who is listening. The radio is open to anyone with the link: thumbs, notes,
 * composing and settings need no login. A Reader session names the listener
 * by email; everyone else is a guest, named by a random id in the
 * `radio_guest` cookie (this browser). The allowlist (Petter) is the owner:
 * no daily limits, and the reviews and everyone's feedback are his.
 *
 * radio-api trusts these headers because only this Worker holds its key.
 * The IP goes over as a salted hash, only for the guests' daily limits.
 */
import type { H3Event } from 'h3'
import { getCookie, getRequestHeader, setCookie } from 'h3'
import { getReaderUser } from '~/server/utils/readerSession'

const GUEST_COOKIE = 'radio_guest'

export interface Listener {
  /** Email for a Reader session, `<32 hex>@guest` for a guest. */
  id: string
  guest: boolean
  owner: boolean
  /** Salted SHA-256 of the IP, 32 hex chars ('' when unknown). */
  ip: string
}

function allowlist(event: H3Event): string[] {
  return (useRuntimeConfig(event).allowedUserEmails || '')
    .split(',')
    .map((e: string) => e.trim().toLowerCase())
    .filter(Boolean)
}

async function ipHash(event: H3Event): Promise<string> {
  const ip = getRequestHeader(event, 'cf-connecting-ip') ?? ''
  if (!ip) return ''
  const salt = String(useRuntimeConfig(event).radioApiKey || 'radio')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}|${ip}`))
  return [...new Uint8Array(digest).slice(0, 16)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** This browser's guest id, made (and set as a cookie) on first use. */
function guestId(event: H3Event): string {
  const had = getCookie(event, GUEST_COOKIE)
  if (had && /^[a-f0-9]{32}$/.test(had)) return had
  const id = crypto.randomUUID().replace(/-/g, '')
  setCookie(event, GUEST_COOKIE, id, { maxAge: 2 * 365 * 24 * 3600, httpOnly: true, secure: true, sameSite: 'lax', path: '/' })
  return id
}

export async function listenerOf(event: H3Event): Promise<Listener> {
  const user = await getReaderUser(event)
  const ip = await ipHash(event)
  if (user) {
    const email = user.email.toLowerCase()
    return { id: email, guest: false, owner: allowlist(event).includes(email), ip }
  }
  return { id: `${guestId(event)}@guest`, guest: true, owner: false, ip }
}

/** The headers radio-api reads the listener from. */
export function asListener(l: Listener): Record<string, string> {
  return {
    'X-Radio-User': l.id,
    ...(l.ip ? { 'X-Radio-Ip': l.ip } : {}),
    ...(l.owner ? { 'X-Radio-Owner': '1' } : {}),
  }
}
