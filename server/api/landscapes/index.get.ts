import { radioFetch } from '~/server/utils/radioApi'
import { asListener, memberEmail } from '~/server/utils/listener'

/**
 * The listener's own composed channels (private to whoever composed them).
 * Signed out: none. The words they were composed from stay on the backend.
 */
export default defineEventHandler(async (event) => {
  const email = await memberEmail(event)
  if (!email) return { landscapes: [] }
  const data = await radioFetch(event, '/landscapes', { headers: asListener(email) }) as { landscapes?: Array<Record<string, unknown>> }
  return { landscapes: (data.landscapes ?? []).map(({ prompt: _prompt, ...rest }) => rest) }
})
