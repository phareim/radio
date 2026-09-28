import { radioFetch } from '~/server/utils/radioApi'
import { asListener, listenerOf } from '~/server/utils/listener'

export default defineEventHandler(async (event) => {
  const listener = await listenerOf(event)
  const body = await readBody(event)
  return radioFetch(event, '/feedback', { method: 'POST', body: JSON.stringify(body), headers: asListener(listener) })
})
