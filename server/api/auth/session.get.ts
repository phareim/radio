import { getReaderUser } from '~/server/utils/readerSession'

/**
 * Who is listening. The radio is public; `allowed` (a Reader session on the
 * allowlist) unlocks thumbs, notes and composing.
 */
export default defineEventHandler(async (event) => {
  const user = await getReaderUser(event)
  const list = (useRuntimeConfig(event).allowedUserEmails || '')
    .split(',')
    .map((e: string) => e.trim().toLowerCase())
    .filter(Boolean)
  const allowed = !!user && list.includes(user.email.toLowerCase())
  return { user: allowed ? user : null, allowed }
})
