// radio.phareim.no: Nuxt 3 on a Cloudflare Worker behind Reader login,
// proxying feedback and Opus composing to radio-api on Sleeper.
export default defineNuxtConfig({
  compatibilityDate: '2024-09-23',
  devtools: { enabled: false },
  // The music, the scene and the page are client-side; the Worker renders
  // the shell and serves the /api proxies.
  ssr: true,

  css: ['~/scene/assets/pixel.css', '~/assets/css/main.css'],

  app: {
    head: {
      title: 'Radio',
      htmlAttrs: { lang: 'en' },
      meta: [
        { name: 'description', content: 'Generative background music you can steer: ten pixel places, from a neon coast to deep space.' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'theme-color', content: '#0b0616' },
        { name: 'color-scheme', content: 'dark' },
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
        { name: 'apple-mobile-web-app-title', content: 'Radio' },
        { property: 'og:title', content: 'Radio · phareim.no' },
        { property: 'og:description', content: 'Generative background music you can steer: ten pixel places, from a neon coast to deep space.' },
        { property: 'og:image', content: 'https://radio.phareim.no/og.png' },
        { property: 'og:url', content: 'https://radio.phareim.no/' },
        { name: 'twitter:card', content: 'summary_large_image' },
      ],
      link: [
        { rel: 'icon', href: '/favicon.ico', sizes: '16x16 32x32 48x48' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
        { rel: 'manifest', href: '/manifest.webmanifest' },
      ],
    },
  },

  nitro: {
    preset: 'cloudflare-module',
  },

  runtimeConfig: {
    radioApiUrl: '', // NUXT_RADIO_API_URL (wrangler [vars])
    radioApiKey: '', // NUXT_RADIO_API_KEY (Worker secret)
    allowedUserEmails: '', // NUXT_ALLOWED_USER_EMAILS (wrangler [vars], comma-separated)
  },

  typescript: {
    strict: true,
    typeCheck: false,
    // The engine and scene import each other with `.ts` extensions (Node runs them with type stripping).
    tsConfig: { compilerOptions: { allowImportingTsExtensions: true, noEmit: true } },
  },

  devServer: { port: 3040 },
})
