# radio-api

Sleeper backend for radio.phareim.no and its sister instrument
jam.phareim.no. The music runs in the browser; this service stores
thumbs-up/down feedback and jam's pieces, and asks Opus (through `slp`, on
Petter's Claude Max subscription) to compose new landscapes, review the
feedback, and play along in jam.

- **PM2:** `radio-api` · **port:** 3033 (127.0.0.1) · **nginx:** `sleeper.phareim.no/radio/` (prefix stripped; `/radio/health` open)
- **Stack:** Node 22, no npm deps: `node:http`, `node:sqlite`. It imports the engine's TypeScript directly (`engine/validate.ts`, `engine/landscapes/index.ts`, `engine/piece/index.ts`); Node strips the types. Runs with `--no-warnings`.
- **Deploy:** a push to `main` on `phareim/radio` hits the `sleeper-deploy` webhook, which runs `git pull --ff-only && pm2 restart radio-api`.

## Files

```
server.mjs        entrypoint: env, DB, listen
lib/app.mjs       routes, auth, CORS
lib/jam.mjs       jam's routes (/jam/*), mounted by app.mjs
lib/db.mjs        schema (feedback, landscapes, jobs, settings, reviews, jam_pieces, jam_snippets)
lib/jobs.mjs      job queue: one Opus call at a time
lib/opus.mjs      spawns slp -p - --model opus (cwd = OS temp dir, 6 min timeout)
lib/engine.mjs    loads the engine modules and the schema text for prompts
compose.mjs       compose prompt, JSON parse, validate, one repair round, store
jam.mjs           jam's Opus jobs: jam-track, jam-feel, jam-channel
paint.mjs         paints a composed channel its own scene with a Claude Code agent; also a CLI
review.mjs        review prompt and report writer; also a CLI
test/             node:test suites, stub engine and fake slp in fixtures/
```

## Endpoints

All JSON. Everything except `GET /health` needs `Authorization: Bearer $RADIO_API_KEY`.

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/health` | | `{ok, service, uptime_s, jobsPending, unreviewed}` |
| POST | `/feedback` | `{rating: 1\|-1\|0, comment, snapshot: FeedbackSnapshot}` (rating 0 needs a comment) | 201 `{id}` |
| PATCH | `/feedback/:id` | `{comment}` | `{feedback}` |
| GET | `/feedback` | `?limit=` (default 50, max 500) `&landscape=` | `{feedback: [...]}`, newest first |
| GET | `/feedback/stats` | | `{stats: [{landscape, up, down, comments, total, unreviewed}]}` |
| GET | `/landscapes` | | `{landscapes: Landscape[]}`: Opus-composed, not hidden, oldest first, each with `origin: 'opus'` and `prompt` |
| DELETE | `/landscapes/:id` | | `{id, hidden: true}` (kept in the DB, just hidden) |
| POST | `/compose` | `{prompt, base?: built-in id}` | 202 `{job}` |
| POST | `/review` | | 202 `{job}` |
| GET | `/reviews` | | `{reviews: [{id, at, feedbackFrom, feedbackTo, path, summary}]}` |
| GET | `/jobs/:id` | | `{job: {id, kind, status, input, result, error, createdAt, finishedAt}}` |
| GET | `/jam/pieces` | | `{pieces: [{id, name, updatedAt, channel?}]}`, last saved first |
| GET | `/jam/pieces/:id` | | `{piece, updatedAt}` |
| PUT | `/jam/pieces/:id` | Piece (`engine/piece/types.ts`) | `{piece, updatedAt}`: the validated copy |
| DELETE | `/jam/pieces/:id` | | `{id, hidden: true}` (kept, just hidden) |
| GET | `/jam/snippets` | | `{snippets: [{id, name, kind, track, createdAt}]}`, newest first |
| POST | `/jam/snippets` | `{name, kind, track: {bars, voice\|kit, layer?, name?, instrument?, enter?, gain?}}` | 201 `{snippet}` |
| DELETE | `/jam/snippets/:id` | | `{id, deleted: true}` |
| POST | `/jam/track` | `{piece, request, layer?, phrases?: number[]}` | 202 `{job}` |
| POST | `/jam/feel` | `{piece, messages?: [{role: 'petter'\|'opus', text}]}` | 202 `{job}` |
| POST | `/jam/channel` | `{piece, written?: boolean}` | 202 `{job}` |

Job `status` is `queued`, `running`, `done` or `error`. A compose result is
`{landscape, repaired, painting}`; a review result is `{review: {id, path, summary, feedbackFrom, feedbackTo, items}}`
or `{skipped}` when there is nothing to review. jam's results are under Jam below. Jobs cut off by a restart are
marked `error: interrupted by a restart`.

CORS allows `RADIO_CORS_ORIGINS` and any `http://localhost:*`.

## Compose

`POST /compose` queues a job. The prompt gives Opus the musical intent, the
Landscape part of `engine/types.ts` (sliced live from the file), two built-in
landscapes as JSON examples, the `base` landscape if given, the built-in scene
ids, and Petter's request, and asks for one JSON object. The service strips
fences, sets `origin: 'opus'`, `prompt` and a fresh id (slug of the name plus
four hex chars), and runs `validateLandscape` plus a check that `scene` is a
built-in id. On errors it sends one repair round with the error list; if that
still fails the job errors with the validator's messages. A compose takes one
to three minutes.

## Jam

jam (jam.phareim.no, repo `phareim/jam`) is an instrument on the radio's
engine: a piece is a loop of 1–4 eight-bar phrases with tracks in a compact
bar notation (`engine/piece/types.ts`, `docs/piece.md`). Its Worker proxies
`/api/jam/**` and `/api/jobs/:id` here. Every `/jam` route belongs to the
member in `X-Radio-User` (401 without it); nobody sees another member's
pieces or snippets.

- **Pieces** are stored as JSON in `jam_pieces`, keyed by (owner, id). `PUT`
  runs `validatePiece` (400 with its messages, which name the field, track,
  bar and token) and stores the normalised copy; the body's `id` must match
  the path. `DELETE` sets `hidden = 1`; saving the piece again brings it back.
- **Snippets** (`jam_snippets`) are a member's saved bars for the library:
  1–32 bars that parse in the notation, with a voice or a kit. `DELETE`
  removes the row.

The Opus jobs share the queue with compose and review (one Opus call at a
time). Each validates the piece in the body first (400 if invalid).

- **`jam-track`** — Opus as a bandmate adding a part. The prompt has the
  radio's musical intent framed for an instrument Petter plays, the bar
  notation (the header comment of `engine/piece/types.ts`) and the `Track`
  type, the voice/kit/drum-hit ids with their descriptions, the piece as
  JSON, a chord chart (each loop bar's chords with degree and tones, from
  `phraseSpans`), and the request. `layer` asks for that layer; `phrases` are
  phrase indices (0 = bars 0–7) and every other bar comes back empty.
  The service sets `source: 'opus'`, makes ids unique against the piece
  (`bass` → `bass-2`) and runs `validatePiece` on the piece plus the new
  tracks; errors go back for one repair round, else the job fails with the
  validator's messages. Result `{tracks: Track[], note, repaired}`. The
  piece is not changed; the app previews the tracks and keeps or drops them.
- **`jam-feel`** — one turn of a conversation with a friend listening to
  the piece (summary, chord chart, a couple of bars per track): what place,
  time of day, weather, light, who is there. The reply is 2–4 sentences, one
  question, in the language Petter writes (bokmål when he has not written
  yet). `messages` default to the piece's `feel.messages`; the last one must
  be Petter's, or none to let Opus open. Result `{reply, brief}`: the brief is
  2–4 sentences in English for the painter and the channel name. A reply
  that is not JSON is taken as the reply and the old brief is kept.
- **`jam-channel`** — the piece distilled into a radio channel. The prompt
  is the compose prompt's intent, schema and validator plus the piece,
  `pieceToLandscape(piece, base)` as the draft (base: a built-in, or one of
  the owner's composed channels), the instruction to keep its progressions,
  grooves, bass patterns and motifs and add what lasts for hours, the feel
  brief and the scene ids. The draft carries the piece's phrases as
  `written` phrases (the radio quotes them now and then, see
  `docs/engine.md`); the prompt lists them and asks Opus to copy them
  unchanged, name them, weigh them and set `quote`, and to compose the rest
  around them. Whatever Opus sends, `enforceWritten` puts the draft's
  phrases back before validation (Opus's names, weights and `quote` kept
  when valid), keeps `tonic` and the mood-0.5 mode the notes are written
  in, and puts each part's layer back on the ladder from its `enter` up, so
  the model never changes a note. `written: false` in the body makes a
  purely generative channel (no written phrases; any Opus invents are
  dropped). It then takes the compose path
  (`generateLandscape` in `compose.mjs`: stamp, validate, one repair round,
  store with the owner and `origin: 'opus'`), with `prompt` = the brief plus
  `(made in jam from "<name>")`, and is painted like a compose. If the owner
  has the piece saved, its `channel` is set to the new id. Result
  `{landscape, repaired, painting}`.

## Paint

After a compose, radio-api starts `backend/paint.mjs <id>` detached (through
`flock` on `$TMPDIR/radio-paint.lock`, so one painting at a time; log in
`backend/data/paint/<id>.log`). Until it finishes, the channel shows the
scene Opus borrowed. The painter:

1. makes a throwaway git worktree of `origin/main` in `$TMPDIR/radio-paint/<id>`;
2. runs `claude --permission-mode auto --effort high --model opus -p …` there.
   The agent writes `scene/scenes/<id>.ts`, registers it (`scene/index.ts`,
   `SCENE_IDS` in `engine/catalog.ts`, the shots list, `docs/landscapes.md`),
   screenshots it under the Chromium flock and iterates;
3. fails the job if the diff touches any other file or the scene is not
   registered, then runs the engine tests and bundles the scene harness;
4. commits, rebases and pushes to `main`, waits for the deploy workflow with
   `gh run list`, and only then sets the landscape's `scene` to its own id.

Only compositions by `RADIO_PAINT_OWNERS` are painted automatically: the
agent runs with Petter's tools and pushes to a public repo, and the scene
file names the channel. By hand, for any landscape:

```bash
node --no-warnings backend/paint.mjs <landscape id>
```

A failed run leaves its worktree; the next run on the same id reuses the
scene already written there and skips the agent. Delete
`$TMPDIR/radio-paint/<id>` (and `git worktree prune`) to paint from scratch.

State is on the landscape row: `paint_status` (`queued`, `painting`,
`deploying`, `done`, `error`), `paint_error`, `painted_at`. A painting takes
the agent's time plus one deploy; it runs on the Claude Max subscription.

## Review

`POST /review`, or from a shell in the repo root:

```bash
node --no-warnings backend/review.mjs            # run it now
node --no-warnings backend/review.mjs --prompt   # print the prompt, call nothing
```

It takes feedback not yet reviewed (up to `RADIO_REVIEW_MAX`, default 400),
with snapshots and per-landscape and per-intensity tallies, the source of each
landscape involved (`engine/landscapes/<id>.ts`, or the stored JSON for Opus
ones) and `docs/engine.md`. Opus answers as composer/producer with a markdown
report (Summary, Patterns, Proposed changes with before/after edits, Keep,
Listen for). It is written to `reviews/YYYY-MM-DD.md` (`-2`, `-3` on the same
day), the feedback is marked reviewed and a `reviews` row keeps the summary.
The reports are meant to be committed with the repo.

## Env

`backend/.env` (mode 600, gitignored), loaded by the service with override
semantics:

| Var | |
|---|---|
| `RADIO_API_KEY` | Bearer token (64 hex chars) |
| `RADIO_PORT` | default 3033 |
| `RADIO_CORS_ORIGINS` | comma list, default `https://radio.phareim.no` |
| `RADIO_DB` | default `backend/data/radio.db` |
| `RADIO_OPUS_MODEL` | default `opus` |
| `RADIO_OPUS_TIMEOUT_MS` | default 360000 |
| `RADIO_SLP_BIN` | default `slp`; tests point it at `test/fixtures/fake-slp.mjs` |
| `RADIO_ENGINE_DIR` | default `engine/`; tests point it at a stub |
| `RADIO_REVIEWS_DIR` | default `reviews/` |
| `RADIO_PAINT` | `off` turns automatic painting off |
| `RADIO_PAINT_OWNERS` | comma list of listeners whose compositions get painted; default `RADIO_LEGACY_OWNER` |
| `RADIO_PAINT_CLAUDE_BIN` | default `claude` |
| `RADIO_PAINT_TIMEOUT_MS` | agent timeout, default 45 min |
| `RADIO_PAINT_DIR` | where worktrees go, default `$TMPDIR/radio-paint` |

## Data

SQLite at `backend/data/radio.db` (gitignored, WAL mode). `jobs.kind` is
free text; on start, a table from before jam (with a CHECK limiting kinds to
compose/review) is rebuilt in one transaction with the same rows and ids. Backed up nightly
with the rest of `~/github` by the host backup (`~/github/sleeper/backup/`).
The review reports in `reviews/` live in git.

## Tests

```bash
node --no-warnings --test 'backend/test/*.test.mjs'
```

Temp DB, stub engine, fake `slp`. `engine.test.mjs` runs against the real
engine and skips until it exists; `jam.test.mjs` runs jam's routes, the
jobs migration and the three jam jobs against the real engine.

## What would make it redundant

If the radio and jam stop asking Opus for landscapes, reviews and parts (for
example when the sites call a model straight from a Cloudflare Worker) and
feedback and jam's pieces move to D1, this service has nothing left to do. Then: `pm2 delete
radio-api && pm2 save`, drop the nginx `/radio/` locations and the
`phareim/radio` route in `sleeper-deploy`, and mark it retired in
`~/github/sleeper/docs/agent-environment-reference.md`.

## Listeners (2026-09-25)

The Worker passes the signed-in member's email as `X-Radio-User` (trusted
because only the Worker holds the Bearer key). Composed landscapes carry an
`owner` and are listed and removable only by their owner (`GET /landscapes`
without the header returns none). `GET` / `PUT /settings` keep a member's
settings (`{ hidden: [channel ids] }`). Feedback rows record the `user`.
Rows from before owners existed belong to `RADIO_LEGACY_OWNER`
(default phareim@gmail.com); the migration runs on start.
