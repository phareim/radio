/**
 * The signed-in listener, when they are on the allowlist (a member), else
 * null. Members' composed channels and settings live on radio-api under
 * their email, passed as X-Radio-User; the radio itself needs no login.
 */
import type { H3Event } from 'h3'
import { getReaderUser } from '~/server/utils/readerSession'

export async function memberEmail(event: H3Event): Promise<string | null> {
  const user = await getReaderUser(event)
  if (!user) return null
  const list = (useRuntimeConfig(event).allowedUserEmails || '')
    .split(',')
    .map((e: string) => e.trim().toLowerCase())
    .filter(Boolean)
  const email = user.email.toLowerCase()
  return list.includes(email) ? email : null
}

export function asListener(email: string): Record<string, string> {
  return { 'X-Radio-User': email }
}
