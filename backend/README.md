# radio-api

Sleeper backend for radio.phareim.no. The music runs in the browser; this
service stores thumbs-up/down feedback and asks Opus (through `slp`, on
Petter's Claude Max subscription) to compose new landscapes and to review
the feedback.

- **PM2:** `radio-api` · **port:** 3033 (127.0.0.1) · **nginx:** `sleeper.phareim.no/radio/` (prefix stripped; `/radio/health` open)
- **Stack:** Node 22, no npm deps: `node:http`, `node:sqlite`. It imports the engine's TypeScript directly (`engine/validate.ts`, `engine/landscapes/index.ts`); Node strips the types. Runs with `--no-warnings`.
- **Deploy:** a push to `main` on `phareim/radio` hits the `sleeper-deploy` webhook, which runs `git pull --ff-only && pm2 restart radio-api`.

## Files

```
server.mjs        entrypoint: env, DB, listen
lib/app.mjs       routes, auth, CORS
lib/db.mjs        schema (feedback, landscapes, jobs, reviews)
lib/jobs.mjs      job queue: one Opus call at a time
lib/opus.mjs      spawns slp -p - --model opus (cwd = OS temp dir, 6 min timeout)
lib/engine.mjs    loads the engine modules and the schema text for prompts
compose.mjs       compose prompt, JSON parse, validate, one repair round, store
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

Job `status` is `queued`, `running`, `done` or `error`. A compose result is
`{landscape, repaired}`; a review result is `{review: {id, path, summary, feedbackFrom, feedbackTo, items}}`
or `{skipped}` when there is nothing to review. Jobs cut off by a restart are
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

SQLite at `backend/data/radio.db` (gitignored, WAL mode). Backed up nightly
with the rest of `~/github` by the host backup (`~/github/sleeper/backup/`).
The review reports in `reviews/` live in git.

## Tests

```bash
node --no-warnings --test 'backend/test/*.test.mjs'
```

Temp DB, stub engine, fake `slp`. `engine.test.mjs` runs against the real
engine and skips until it exists.

## What would make it redundant

If the radio stops asking Opus for landscapes and reviews (for example when
the site composes with a model called straight from a Cloudflare Worker) and
feedback moves to D1, this service has nothing left to do. Then: `pm2 delete
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
