import { paramId, radioFetch } from '~/server/utils/radioApi'
import { asListener, listenerOf } from '~/server/utils/listener'

// radio-api answers a job only to the listener who started it.
export default defineEventHandler(async (event) => {
  const listener = await listenerOf(event)
  const id = paramId(event, /^\d{1,10}$/)
  return radioFetch(event, `/jobs/${id}`, { headers: asListener(listener) })
})
