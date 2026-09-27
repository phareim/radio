import { requireAllowedUser } from '~/server/utils/readerSession'
import { paramId, radioFetch } from '~/server/utils/radioApi'
import { asListener } from '~/server/utils/listener'

// radio-api lets only the listener who gave the feedback change it.
export default defineEventHandler(async (event) => {
  const user = await requireAllowedUser(event)
  const id = paramId(event, /^\d{1,10}$/)
  const body = await readBody(event)
  return radioFetch(event, `/feedback/${id}`, { method: 'PATCH', body: JSON.stringify({ comment: String(body?.comment ?? '') }), headers: asListener(user.email.toLowerCase()) })
})
