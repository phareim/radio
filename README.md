# radio.phareim.no

Generative background music you can steer, in Neon Shrine's pixel look. The
music is composed and synthesised in the browser (`engine/`, `engine/audio/`),
the painted place is `scene/`, and `backend/` (radio-api on Sleeper) keeps
feedback and asks Opus for new places. This file covers the web app at the
repo root; see `AGENTS.md` for the map.

## The web app

Nuxt 3 on a Cloudflare Worker (`radio-web`, custom domain `radio.phareim.no`),
behind Reader login with the email allowlist (tier 3 in the `phareim-webapps`
skill). The Worker renders a shell; everything else runs client-side in
`components/RadioApp.client.vue`.

```
pages/index.vue            the shell, RadioApp inside <ClientOnly>
components/
  RadioApp.client.vue      layout, keyboard, media session, hidden <audio>
  SceneWindow.vue          the canvas (scene/createScene) and the HUD over it
  StationDial.vue          places: built-ins (1–0), Opus's (◈), + NEW PLACE
  IntensityBar.vue         STILL … SURGE
  PxSlider.vue             segmented knobs (mood, space, grit, density, tempo, volume)
  LayerStrip.vue           the ten layers lit by level, entries counting down
  CommentBox.vue           words after ▲ / ▼ / NOTE
  ComposeDialog.vue        ask Opus for a place, wait for the job
  PxText.vue               pixel text that keeps b d i j m s u a lower-case (Am7, Bb)
composables/
  useRadio.ts              controls, the conductor and player, HUD state
  useFeedback.ts           thumbs and notes, with an outbox in localStorage
  usePlaces.ts             composed places: load, compose job, hide
server/api/                proxies to radio-api, each gated by requireAllowedUser
server/utils/              readerSession.ts + cloudflare.ts (vendored Reader auth), radioApi.ts
scripts/make-icons.py      favicon, apple-touch and manifest icons (Pillow)
```

- One conductor per session, created on the first PLAY with the controls set
  so far; every change goes through `useRadio().set()`, which calls
  `conductor.setControls` with only the changed fields. Controls and volume
  persist in localStorage.
- Keys: Space play/pause, 1–9 and 0 places, ← → previous/next place, ↑ ↓
  intensity, H hold, + / − thumbs, N note, M mute. Ignored while typing.
- Feedback: ▲ / ▼ save at once with a full `FeedbackSnapshot`; the comment
  box PATCHes words onto it. Failed saves wait in `radio.outbox`.
- Audio output: where the AudioContext can be silenced (`setSinkId({type:
  'none'})`, Chromium), the master stream plays through a hidden `<audio>`
  element so the OS treats the page as media. Elsewhere the context plays
  straight to the speakers.

## Run and deploy

```bash
npm run dev          # http://localhost:3040, no login on localhost (API calls fail quietly)
npm run build
npx wrangler deploy  # CI does this on push to main
```

Worker config in `wrangler.toml`: Reader's D1 as `DB` (read-only), static
assets through the `ASSETS` binding, `[vars]` `NUXT_RADIO_API_URL` and
`NUXT_ALLOWED_USER_EMAILS`. The secret `NUXT_RADIO_API_KEY` is radio-api's
`RADIO_API_KEY` from `backend/.env`:

```bash
grep '^RADIO_API_KEY=' backend/.env | cut -d= -f2- | tr -d '\n' | npx wrangler secret put NUXT_RADIO_API_KEY
```

CI (`.github/workflows/deploy.yml`): npm ci → engine tests → backend tests →
build → a grep of `.output/public` for internal hostnames and keys → wrangler
deploy. Repo secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

## What would make it redundant

If the radio moved into phareim.no itself (its radio widget already plays
stations), this Worker would have nothing left to serve: then `npx wrangler
delete radio-web` and drop the custom domain.
