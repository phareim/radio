import { radioFetch } from '~/server/utils/radioApi'

/**
 * Opus-composed places, public: every listener can tune in to them. The
 * words they were composed from stay private.
 */
export default defineEventHandler(async (event) => {
  const data = await radioFetch(event, '/landscapes') as { landscapes?: Array<Record<string, unknown>> }
  return { landscapes: (data.landscapes ?? []).map(({ prompt: _prompt, ...rest }) => rest) }
})
