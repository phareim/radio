import { requireAllowedUser } from '~/server/utils/readerSession'
import { radioFetch } from '~/server/utils/radioApi'

export default defineEventHandler(async (event) => {
  await requireAllowedUser(event)
  const body = await readBody(event)
  return radioFetch(event, '/feedback', { method: 'POST', body: JSON.stringify(body) })
})
