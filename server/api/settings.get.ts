import { requireAllowedUser } from '~/server/utils/readerSession'
import { radioFetch } from '~/server/utils/radioApi'
import { asListener } from '~/server/utils/listener'

/** The member's radio settings (hidden channels), the same on every device. */
export default defineEventHandler(async (event) => {
  const user = await requireAllowedUser(event)
  return radioFetch(event, '/settings', { headers: asListener(user.email.toLowerCase()) })
})
