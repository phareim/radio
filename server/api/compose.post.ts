import { requireAllowedUser } from '~/server/utils/readerSession'
import { radioFetch } from '~/server/utils/radioApi'

export default defineEventHandler(async (event) => {
  await requireAllowedUser(event)
  const body = await readBody(event)
  const prompt = String(body?.prompt ?? '').trim().slice(0, 2000)
  if (!prompt) throw createError({ statusCode: 400, statusMessage: 'prompt required' })
  const base = typeof body?.base === 'string' && body.base ? body.base : undefined
  return radioFetch(event, '/compose', { method: 'POST', body: JSON.stringify({ prompt, base }) })
})
