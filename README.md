# radio.phareim.no

Generative background music you can steer, in Neon Shrine's pixel look. The
music is composed and synthesised in the browser (`engine/`, `engine/audio/`),
the painted place is `scene/`, and `backend/` (radio-api on Sleeper) keeps
feedback and asks Opus for new places. This file covers the web app at the
repo root; see `AGENTS.md` for the map. A walk-through of how the engine
works, with editable code cells running it in the page (Norwegian):
[phareim.md/sleeper/radio-motoren](https://phareim.md/sleeper/radio-motoren/).

## The web app

Nuxt 3 on a Cloudflare Worker (`radio-web`, custom domain `radio.phareim.no`),
open to anyone with the link, no login needed: listening, thumbs, notes,
composing and settings. A listener without a Reader session is a guest,
named by a random id in the `radio_guest` cookie (so their channels and
settings follow that browser); a Reader session names them by email (every
device). The email allowlist (Petter, tier 3 in the `phareim-webapps` skill)
is the owner: no daily limits, and only the owner reaches the reviews and
everyone's feedback (`/api/review`, `/api/reviews`, `GET /api/feedback`,
`/api/feedback/stats`). The Worker renders a shell; everything else runs client-side in
`components/RadioApp.client.vue`.

```
pages/index.vue            the shell, RadioApp inside <ClientOnly>
components/
  RadioApp.client.vue      layout, keyboard, media session, hidden <audio>
  SceneWindow.vue          the canvas (scene/createScene) and the HUD over it
  StationDial.vue          the channels shown (1–0), then CHANNELS
  ChannelsDialog.vue       show/hide each channel, remove your own, + NEW PLACE
  IntensityBar.vue         STILL … SURGE
  PxSlider.vue             segmented knobs (mood, space, grit, density, tempo)
  LayerStrip.vue           the ten layers lit by level, entries counting down
  CommentBox.vue           words after ▲ / ▼ / NOTE
  ComposeDialog.vue        ask Opus for a place, wait for the job
  PxText.vue               pixel text that keeps b d i j m s u a lower-case (Am7, Bb)
composables/
  useRadio.ts              controls, the conductor and player, HUD state
  useFeedback.ts           thumbs and notes, with an outbox in localStorage
  usePlaces.ts             your composed places: load, compose job, remove
  useChannels.ts           which channels show: this browser, or a member's settings on radio-api
  useAuto.ts               AUTO: slow drift from place to place
server/api/                proxies to radio-api; listener.ts names the listener, the owner's routes use requireAllowedUser
server/utils/              readerSession.ts + cloudflare.ts (vendored Reader auth), radioApi.ts
scripts/make-icons.py      favicon, apple-touch and manifest icons (Pillow)
```

- One conductor per session, created on the first PLAY with the controls set
  so far; every change goes through `useRadio().set()`, which calls
  `conductor.setControls` with only the changed fields. Controls persist in
  localStorage. There is no volume knob; the device's own volume rules.
- Keys: Space play/pause, 1–9 and 0 places, ← → previous/next place, ↑ ↓
  intensity, H hold, A auto, G glide on, D dim, + / − thumbs, N note; as a
  guest L goes to Reader's login. Ignored while typing.
- Channels: composed places are private to whoever composed them (radio-api
  keeps an owner per landscape; the Worker passes the listener as
  `X-Radio-User`: an email, or `<guest id>@guest`, plus `X-Radio-Ip`, a
  salted hash of the IP, and `X-Radio-Owner: 1` for the allowlist). Which
  channels show is kept in radio-api's `settings` table under that id.
  Guests get daily limits (radio-api answers 429; `backend/README.md`), and
  their channels borrow a built-in scene: only the owner's are painted.
  When a fresh session answer names another listener,
  `useAuth` drops the last member's copies in this browser: composed
  channels, the compose job, hidden channels, the service worker's API
  cache, and their unsent notes if someone else signed in. Offline, the
  service worker's cached session answer stands.
- DIM (`radio.calm`) hides everything but the picture; AUTO, ▶▶ and SHOW
  stay in the corner and fade after a few seconds without the pointer.
- AUTO (`composables/useAuto.ts`) stays 7–11 listening minutes in a place,
  then glides to another near in tempo and not among the last three; ▶▶
  glides on at once. Crossing time and paused time don't count.
- Feedback: ▲ / ▼ save at once with a full `FeedbackSnapshot`; the comment
  box PATCHes words onto it. Failed saves wait in `radio.outbox`.
- Audio output: the master stream plays through a hidden `<audio>` element
  so the OS treats the page as media (lock screen, media keys, background
  playback on iOS); once the element plays, `player.setOutput('stream')`
  turns off the direct speaker output so the music is not doubled.
- Lock screen: the media session shows the place's name, the intensity and
  a cover painted from the place's scene in the sounding bar's mood
  (`scene/cover.ts`, 512² JPEG, cached). The player's bars drive it, since
  the HUD stands still while the screen is locked.

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
