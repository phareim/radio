import { radioFetch } from '~/server/utils/radioApi'
import { asListener, listenerOf } from '~/server/utils/listener'

/** This device's running total of seconds played; the answer has the listener's sum and everyone's. */
export default defineEventHandler(async (event) => {
  const listener = await listenerOf(event)
  const body = await readBody(event)
  const played = { device: String(body?.device ?? ''), seconds: Number(body?.seconds) }
  return radioFetch(event, '/played', { method: 'POST', body: JSON.stringify(played), headers: asListener(listener) })
})
