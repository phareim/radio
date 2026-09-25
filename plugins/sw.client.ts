// Registers public/sw.js so the radio loads again without a network, and
// moves an open page onto a new deploy. Nuxt polls /_nuxt/builds/latest.json
// (checkOutdatedBuildInterval in nuxt.config.ts); when the build changes,
// the page reloads at once if the music is stopped, or as soon as it stops,
// so a deploy never cuts the music. The service worker serves the page
// network first, so the reload gets the new files.
// Not on localhost: a service worker there would serve stale dev builds.
export default defineNuxtPlugin((nuxtApp) => {
  const { playing } = useRadio()
  let outdated = false
  const reloadIfIdle = () => { if (outdated && !playing.value) location.reload() }
  nuxtApp.hooks.hook('app:manifest:update', () => {
    outdated = true
    reloadIfIdle()
  })
  watch(playing, reloadIfIdle)

  if (!('serviceWorker' in navigator)) return
  if (['localhost', '127.0.0.1'].includes(location.hostname)) return
  const register = async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js')
      // A PWA brought back from the background checks for a new worker too.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {})
      })
    } catch { /* the radio works without it */ }
  }
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
})
