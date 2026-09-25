# AGENTS.md — radio

radio.phareim.no: generative background music you can steer. Pick a
landscape, move intensity and a few vibe knobs; the music flows into the
change over a few phrases. Thumbs up/down with comments feed a review that
Opus does; Opus can also compose new landscapes.

## Layout

| Part | Where | Docs |
|---|---|---|
| Engine (pure TS: theory, composer, conductor, landscapes) | `engine/` | `docs/engine.md` |
| Audio (Web Audio player, voices, drums, ambience, fx) | `engine/audio/` | `docs/engine.md` (player) |
| Pixel scenes, one per landscape | `scene/` | `docs/landscapes.md` |
| Web app (Nuxt 3 Worker, Reader login, proxies to the backend) | repo root | `README.md` |
| Backend `radio-api` on Sleeper (feedback, compose, review) | `backend/` | `backend/README.md` |

## Rules

- `engine/` is erasable-syntax TypeScript with `.ts` import extensions, so
  Node runs it natively (the backend validates Opus's landscapes with it)
  and Vite bundles it. No enums, namespaces or parameter properties.
- `engine/types.ts` is the contract between composer, conductor, player,
  scene and backend. Change it deliberately and update every side.
- Landscapes live in `engine/landscapes/<id>.ts`; the validator in
  `engine/validate.ts` is the schema Opus composes against (the backend
  pastes it into the compose prompt), so keep its error messages useful.
- Bump `ENGINE_VERSION` in `engine/catalog.ts` when the composer or
  conductor changes audibly, so feedback can be read against the version.

## Commands

- `node --no-warnings --test tests/engine.test.ts` — engine invariants
- `node --no-warnings tests/timeline.ts [bars]` — print a scripted session bar by bar
- `node --no-warnings --test 'backend/test/*.test.mjs'` — backend
- `npm run dev` — the app on port 3040 (no login on localhost)
- `node --no-warnings backend/review.mjs` — run an Opus review of new feedback now

## Deploy

Push to `main`: GitHub Actions tests, builds and deploys the Worker
`radio-web`; the Sleeper deploy webhook pulls the repo and restarts
`radio-api`.
