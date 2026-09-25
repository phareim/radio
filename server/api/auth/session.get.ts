import { getReaderUser } from '~/server/utils/readerSession'
import { memberEmail } from '~/server/utils/listener'

/**
 * Who is listening. The radio is public; `allowed` (a Reader session on the
 * allowlist) unlocks thumbs, notes, composing and settings on every device.
 */
export default defineEventHandler(async (event) => {
  const allowed = !!(await memberEmail(event))
  const user = allowed ? await getReaderUser(event) : null
  return { user, allowed }
})
