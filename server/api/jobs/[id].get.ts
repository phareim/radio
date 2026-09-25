import { requireAllowedUser } from '~/server/utils/readerSession'
import { paramId, radioFetch } from '~/server/utils/radioApi'

export default defineEventHandler(async (event) => {
  await requireAllowedUser(event)
  const id = paramId(event, /^\d{1,10}$/)
  return radioFetch(event, `/jobs/${id}`)
})
