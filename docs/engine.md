# The radio engine

Generative, steerable background music in the electronic semi-retro game
vein of Neon Shrine. The music runs in the browser (Web Audio, all
synthesised, no samples). Sleeper stores feedback and asks Opus to compose
new landscapes.

## Pieces

```
engine/types.ts        contracts (read this first)
engine/theory.ts       modes, chord tokens → chords, voice leading, scales
engine/validate.ts     validateLandscape(): checks a Landscape (built-in or Opus-composed)
engine/rng.ts          seeded RNG
engine/composer.ts     writes bars: melody from motifs, bass, arp, drums, pads, bells
engine/conductor.ts    ConductorLike: steers toward the Controls at musical boundaries
engine/landscapes/     the built-in landscapes, one file each, index.ts lists them
engine/audio/          the Web Audio side: player (scheduler), voices, drums, ambience, fx
scene/                 the pixel-art window: one painted scene per landscape, dithered dissolves
backend/               Sleeper service radio-api: feedback, Opus compose, review
```

Data flow: the page sets `Controls` on the conductor. The player asks the
conductor for one `BarPlan` at a time, a little ahead of the audio clock, and
schedules its notes, drums, mix moves, fx glides and ambience levels. The page
reads `player.visual()` every frame for the scene and the display.

## Time and transitions

A bar is 16 steps. A phrase is 8 bars (4 in a few slow landscapes). A
section is 2–4 phrases sharing one progression and one motif. Changes land
where a musician would put them:

| Control | When it lands |
|---|---|
| intensity up | layers enter one at a time, from the next half-phrase boundary, 2 bars apart: drone/pad → bass → perc → drums (on a half-phrase, with a pickup fill) → arp → bells → counter → lead (on a phrase start); the patterns (bass line, groove, arp rate) climb one level per entry or half-phrase |
| intensity down | the current phrase finishes as it is; drums play out with a closing fill; layers leave and patterns drop at the phrase boundary |
| landscape | the current progression runs to its cadence, the lead drops out, then a 4-bar bridge pivots the harmony (common chord, else the new key's dominant) while tempo, fx and ambience glide; the new landscape arrives with pad and drone, then builds up layer by layer to the target intensity |
| mood | the mode changes when the next progression starts |
| density | next phrase |
| space, grit | glide over about a bar |
| tempo | glides across the next phrase |
| hold | freezes progression and motif; the section loops until released |

The conductor plans lazily, one bar at a time, so a new control value
re-plans from wherever the music is.

## The player (engine/audio/)

`createPlayer(conductor: ConductorLike, opts?: PlayerOptions): RadioPlayer` in
`player.ts` (types in `types.ts`) is the live wrapper: AudioContext, Worker clock, volume, the
MediaStream and `setOutput('speakers' | 'stream')` (the page plays the stream
through an `<audio>` element for iOS lock-screen playback and then turns the
direct speaker output off). The scheduling itself lives in `core.ts` and runs
on any `BaseAudioContext`, so `tests/audio-check.mjs` renders it offline in
headless Chromium and meters every voice, kit, texture and landscape
(`npm run check:audio -- [filter] [--wav]`; WAVs go to `~/zshots/radio-audio/`;
groups `play` and `live` render the played instruments as a player uses them
and as live notes; group `cut` renders jam's transport (STOP, a live note while
idle, PLAY; a SEEK) and checks the silences; `--smoke` runs the real player,
including cut, setIdle and an idle start).
A texture missing from `BarPlan.ambience` fades to 0; a layer missing from
`mix` keeps its previous target.

- **Clock**: a lookahead scheduler ticking from a Web Worker (timers in a
  hidden tab's main thread are throttled to 1 Hz; worker timers are not).
  Lookahead 0.2 s while visible, 2 s while hidden. When the scheduled time
  reaches the end of the current bar, it asks for the next `BarPlan`.
- **Tempo**: step duration follows `bpmStart → bpmEnd` linearly across the
  bar. Swing delays odd sixteenths by `swing × sixteenth`.
- **Mix**: every `Layer` has its own gain bus with sends to reverb and delay.
  `mix[layer].gain` is reached over `fadeBars` bars from the bar start
  (`linearRampToValueAtTime`). The kick ducks pad and drone by `fx.pump`.
- **FX** (`fx.ts`): master chain = tone low-pass → tape saturation (grit) →
  stereo width → compressor → limiter → destination and a
  MediaStreamDestination. Reverb is a convolver with a generated impulse;
  `reverbSize` changes rebuild it and crossfade old/new over a bar. Delay is
  tempo-synced dotted eighth with filtered feedback.
- **Voices** (`voices.ts`): `playVoice(v: VoiceCtx, id: VoiceId, midi, at, dur, vel, opts)`.
  Every voice in `VoiceId` exists. Grit adds detune spread and tape wow. The
  returned `NoteHandle` can `extend` a tie, `release(at)` a note early, or
  `cut` it for the transport.
- **Played instruments** (`instruments.ts`, renderers in `render.ts`):
  `keys.piano`, `keys.felt` (additive, stretched partials, two-stage unison
  decay, hammer knock, velocity → brightness), `guitar.nylon`, `guitar.steel`,
  `guitar.mute`, `bass.finger` (Karplus-Strong in JS: a DelayNode loop cannot
  be shorter than one 128-frame render quantum). Notes render once per voice,
  pitch, velocity bucket and round-robin variant into an LRU cache of
  AudioBuffers (`res.bufs`, 12 M samples) and play through a gated VCA: they
  ring while held and damp on release. First press of a low piano key renders
  in up to ~60 ms; mid-range notes in 5–20 ms.
- **Live notes**: `player.live(layer, sound, vel, pan?)` plays a voice or a drum
  hit 5 ms from now on the layer's bus (a voice with a 30 s nominal length that
  `release()` ends; the glide lead slides while the previous live note is held).
  They show in `visual()` like scheduled notes. It returns null unless the
  player is running (idle or not), and a layer at mix gain 0 swallows them.
  A cut never touches them.
- **Transport** (jam; the radio never calls these, so its playback is as
  before). The contract is in `types.ts` (`RadioPlayer.cut`, `setIdle`, `start`).
  - `cut({ at?, fade?, ring? })` takes back what is scheduled from `at`
    (default now + 10 ms, on a render quantum). Every scheduled note, drum hit
    and ambience event keeps a `Cuttable` handle (`synth.ts`) in the core
    until its sources stop: one starting from `at` never sounds (VCA held at
    0, sources stopped at their start); one sounding fades over `fade`
    (0.08 s), except that percussive sounds (drum hits other than the riser,
    plucked and struck voices, ambience events) ring out unless
    `ring: false`. Events not yet built are dropped from the queue. Bars
    from `at` go, the bar sounding at `at` ends there (`visual().bar` goes
    null at its cut end, `positionAt` is null until the next bar). Mix, pump,
    fx and ambience-level automation after `at` is dropped and held at its
    value there (`cancelAndHoldAtTime`; Firefox lands on the value read back
    from the bar ramps); a reverb-size crossfade finishes over 0.3 s. The
    next bar is planned in a microtask and starts at `at`, so
    `conductor.seek(n)` + `cut()` plays loop bar n about 10 ms later.
  - `setIdle(true)` idles the transport (named apart from `Controls.hold`,
    which freezes the progression): no bar is planned (what is scheduled
    plays out; `cut()` too to stop at once), then the ambience fades out
    over 0.5 s. The context keeps running, `live()` works, `playing` stays
    true, `visual().bar` and `positionAt` are null. `setIdle(false)` plans a
    bar at once, 10 ms ahead. `start({ idle: true })` wakes the context into
    the idle state (volume up in 20 ms, nothing scheduled). jam: STOP =
    `cut()` + `setIdle(true)`; PLAY from bar n = `seek(n)` +
    `setIdle(false)` (or `start({ idle: false })` when the context is not
    running); SEEK while playing = `seek(n)` + `cut()`.
- **Position**: `player.positionAt(t)` maps an audio-clock time to the bar
  index and musical step (swing and tempo glide undone), from the last few
  seconds of scheduled bars; `player.latency` is output + base latency. An
  instrument places a played note at `positionAt(ac.currentTime - latency)`.
  The radio keeps `latencyHint: 'playback'`; jam asks for `'interactive'`.
- **Drums** (`drums.ts`): `playDrum(v, kit, hit, at, vel, len?)` → a
  `Cuttable` (or null).
- **Ambience** (`ambience.ts`): continuous textures with gain ramps, plus
  event sounds (birds, owls, gulls, chimes) spawned by the ambience's own
  random timers inside the scheduler tick; key-aware ones use `BarPlan.scale`.
  Each event registers a `Cuttable` (its input gain is the cut gate).
- **Visual**: `visual()` returns the sounding bar, step, a kick-driven beat
  envelope, per-layer levels and recent notes, from queues keyed to the audio
  clock.
- Starts on a user gesture; `stop()` fades out and suspends (`idle` keeps
  its setting).

## Landscapes

Ten built in (ids): `coast`, `summit`, `jungle`, `frostwood`, `village`,
`nightdrive`, `voyager`, `deepspace`, `neonrain`, `caverns`. Opus can
compose more on request (backend `POST /compose`); those name a built-in
`scene` to be painted with.
