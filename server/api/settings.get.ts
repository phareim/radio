import { radioFetch } from '~/server/utils/radioApi'
import { asListener, listenerOf } from '~/server/utils/listener'

/** The member's radio settings (hidden channels), the same on every device. */
export default defineEventHandler(async (event) => {
  const listener = await listenerOf(event)
  return radioFetch(event, '/settings', { headers: asListener(listener) })
})
