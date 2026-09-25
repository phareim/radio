/**
 * Client-side login bounce: without a valid Reader session, send the
 * browser to Reader's login with a redirect back here. Runs client-only —
 * SSR renders the shell and every data endpoint is guarded server-side
 * anyway (401/403 from the proxies). Skipped on localhost.
 */
export default defineNuxtRouteMiddleware(async () => {
  if (import.meta.server) return
  // Local dev (npm run dev on port 3040) has no Reader session; API calls
  // fail quietly there instead.
  if (['localhost', '127.0.0.1'].includes(window.location.hostname)) return

  const { user, checked, fetchSession, loginUrl } = useAuth()
  if (!checked.value) {
    await fetchSession()
  }
  if (!user.value) {
    window.location.href = loginUrl()
    return abortNavigation()
  }
})
