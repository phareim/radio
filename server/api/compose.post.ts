import { radioFetch } from '~/server/utils/radioApi'
import { asListener, listenerOf } from '~/server/utils/listener'

// Anyone may compose; radio-api keeps the guests' daily limits (429).
export default defineEventHandler(async (event) => {
  const listener = await listenerOf(event)
  const body = await readBody(event)
  const prompt = String(body?.prompt ?? '').trim().slice(0, 2000)
  if (!prompt) throw createError({ statusCode: 400, statusMessage: 'prompt required' })
  const base = typeof body?.base === 'string' && body.base ? body.base : undefined
  return radioFetch(event, '/compose', { method: 'POST', body: JSON.stringify({ prompt, base }), headers: asListener(listener) })
})
