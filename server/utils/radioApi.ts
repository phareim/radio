/**
 * Server-side client for radio-api on Sleeper (proxied at
 * https://sleeper.phareim.no/radio). The Bearer key is a Worker secret and
 * never reaches the browser; every route gates on requireAllowedUser first.
 */
import { H3Event, createError, setResponseStatus } from 'h3'

export async function radioFetch(event: H3Event, path: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<any> {
  const config = useRuntimeConfig(event)
  if (!config.radioApiUrl || !config.radioApiKey) {
    throw createError({ statusCode: 503, statusMessage: 'Radio backend is not configured' })
  }
  const res = await fetch(`${String(config.radioApiUrl).replace(/\/$/, '')}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.radioApiKey}`,
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw createError({
      statusCode: res.status,
      statusMessage: `Radio backend error (${res.status})`,
      data: body.slice(0, 500),
    })
  }
  // 201 on feedback, 202 on jobs: pass the status through.
  if (res.status !== 200) setResponseStatus(event, res.status)
  return res.json()
}

/** Route params go into the backend path: keep them to ids. */
export function paramId(event: H3Event, pattern: RegExp): string {
  const id = getRouterParam(event, 'id') ?? ''
  if (!pattern.test(id)) throw createError({ statusCode: 400, statusMessage: 'Bad id' })
  return id
}
