import { requireAllowedUser } from '~/server/utils/readerSession'
import { radioFetch } from '~/server/utils/radioApi'
import { asListener } from '~/server/utils/listener'

export default defineEventHandler(async (event) => {
  const user = await requireAllowedUser(event)
  const body = await readBody(event)
  const hidden = Array.isArray(body?.hidden) ? body.hidden.filter((x: unknown) => typeof x === 'string').slice(0, 200) : []
  return radioFetch(event, '/settings', { method: 'PUT', body: JSON.stringify({ hidden }), headers: asListener(user.email.toLowerCase()) })
})
