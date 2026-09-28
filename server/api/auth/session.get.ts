import { getReaderUser } from '~/server/utils/readerSession'
import { listenerOf } from '~/server/utils/listener'

/**
 * Who is listening. Everyone may give thumbs and notes, compose and keep
 * settings (`allowed` is always true); `guest` means no Reader session, so
 * what they keep follows this browser. `member` is the id their data is kept
 * under, so the page can drop another listener's copies.
 */
export default defineEventHandler(async (event) => {
  const listener = await listenerOf(event)
  const user = listener.guest ? null : await getReaderUser(event)
  return { user, allowed: true, guest: listener.guest, owner: listener.owner, member: listener.id }
})
