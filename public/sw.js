// radio.phareim.no service worker: once the page has loaded, the radio runs
// without a network (music and scenes are made in the browser), and this
// lets it load again offline too.
//
// - The page (/): network first, the last good copy when offline.
// - /_nuxt/ files are hashed and immutable: cache first. Each fresh page
//   caches the files it names and drops the ones it no longer names.
// - GET /api/landscapes, /api/settings, /api/auth/session: network first,
//   the last answer when offline, so composed channels still show.
// - Everything else (feedback, compose, jobs) goes to the network only.
const SHELL = 'radio-shell-v1'
const ASSETS = 'radio-assets-v1'
const API = 'radio-api-v1'
const KEEP = [SHELL, ASSETS, API]
const STATIC = ['/manifest.webmanifest', '/favicon.ico', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png']
const CACHED_API = ['/api/landscapes', '/api/settings', '/api/auth/session']

/** The /_nuxt/ files a page names (scripts, styles, preloads). */
function assetsIn(html) {
  const found = new Set()
  for (const m of html.matchAll(/["'(](\/_nuxt\/[^"'()\s]+\.(?:js|css|woff2?|png|svg))/g)) found.add(m[1])
  return [...found]
}

/** Cache a fresh page and the files it names; drop files it no longer names. */
async function keepPage(res) {
  const html = await res.clone().text()
  const urls = assetsIn(html)
  if (!urls.length) return
  await (await caches.open(SHELL)).put('/', res)
  const assets = await caches.open(ASSETS)
  await Promise.all(urls.map(async (u) => {
    if (await assets.match(u)) return
    try {
      const r = await fetch(u)
      if (r.ok) await assets.put(u, r)
    } catch { /* offline: the next page load tries again */ }
  }))
  const want = new Set(urls)
  for (const req of await assets.keys()) {
    const path = new URL(req.url).pathname
    if (!want.has(path) && !path.startsWith('/_nuxt/builds/')) await assets.delete(req)
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL)
    await Promise.all(STATIC.map((u) => shell.add(u).catch(() => {})))
    try {
      const res = await fetch('/', { credentials: 'include' })
      if (res.ok && !res.redirected) await keepPage(res)
    } catch { /* installed offline: the first online load fills it */ }
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (!KEEP.includes(k)) await caches.delete(k)
    await self.clients.claim()
  })())
})

async function networkFirst(req, cacheName, key = req) {
  const cache = await caches.open(cacheName)
  try {
    const res = await fetch(req)
    if (res.ok) await cache.put(key, res.clone())
    return res
  } catch (e) {
    const hit = await cache.match(key)
    if (hit) return hit
    throw e
  }
}

async function page(event) {
  try {
    const res = await fetch(event.request)
    if (res.ok && !res.redirected && new URL(event.request.url).pathname === '/') event.waitUntil(keepPage(res.clone()))
    return res
  } catch {
    const hit = await (await caches.open(SHELL)).match('/')
    return hit ?? new Response('Offline, and the radio has not been saved on this device yet.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  }
}

async function asset(req) {
  const cache = await caches.open(ASSETS)
  const hit = await cache.match(req)
  if (hit) return hit
  const res = await fetch(req)
  if (res.ok) await cache.put(req, res.clone())
  return res
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (req.mode === 'navigate') return event.respondWith(page(event))
  if (url.pathname.startsWith('/_nuxt/builds/')) return event.respondWith(networkFirst(req, ASSETS, url.pathname))
  if (url.pathname.startsWith('/_nuxt/')) return event.respondWith(asset(req))
  if (CACHED_API.includes(url.pathname)) return event.respondWith(networkFirst(req, API, url.pathname))
  if (STATIC.includes(url.pathname)) return event.respondWith(networkFirst(req, SHELL, url.pathname))
})
