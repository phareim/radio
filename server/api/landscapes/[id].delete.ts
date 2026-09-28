import { paramId, radioFetch } from '~/server/utils/radioApi'
import { asListener, listenerOf } from '~/server/utils/listener'

export default defineEventHandler(async (event) => {
  const listener = await listenerOf(event)
  const id = paramId(event, /^[a-z0-9][a-z0-9-]{1,40}$/)
  return radioFetch(event, `/landscapes/${id}`, { method: 'DELETE', headers: asListener(listener) })
})
