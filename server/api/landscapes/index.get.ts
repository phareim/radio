import { radioFetch } from '~/server/utils/radioApi'
import { asListener, listenerOf } from '~/server/utils/listener'

/**
 * The listener's own composed channels (private to whoever composed them:
 * a member's on every device, a guest's in this browser). The words they
 * were composed from stay on the backend.
 */
export default defineEventHandler(async (event) => {
  const data = await radioFetch(event, '/landscapes', { headers: asListener(await listenerOf(event)) }) as { landscapes?: Array<Record<string, unknown>> }
  return { landscapes: (data.landscapes ?? []).map(({ prompt: _prompt, ...rest }) => rest) }
})
