import { radioFetch } from '~/server/utils/radioApi'
import { asListener, listenerOf } from '~/server/utils/listener'

export default defineEventHandler(async (event) => {
  const listener = await listenerOf(event)
  const body = await readBody(event)
  const hidden = Array.isArray(body?.hidden) ? body.hidden.filter((x: unknown) => typeof x === 'string').slice(0, 200) : []
  return radioFetch(event, '/settings', { method: 'PUT', body: JSON.stringify({ hidden }), headers: asListener(listener) })
})
