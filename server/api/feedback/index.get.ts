import { requireAllowedUser } from '~/server/utils/readerSession'
import { radioFetch } from '~/server/utils/radioApi'

export default defineEventHandler(async (event) => {
  await requireAllowedUser(event)
  const q = getQuery(event)
  const params = new URLSearchParams()
  if (q.limit !== undefined && /^\d{1,3}$/.test(String(q.limit))) params.set('limit', String(q.limit))
  if (typeof q.landscape === 'string' && q.landscape) params.set('landscape', q.landscape)
  const qs = params.toString()
  return radioFetch(event, `/feedback${qs ? `?${qs}` : ''}`)
})
