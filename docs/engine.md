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
and as live notes; `--smoke` runs the real player).
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
  returned `NoteHandle` can `extend` a tie or `release(at)` a note early.
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
  player is running, and a layer at mix gain 0 swallows them.
- **Position**: `player.positionAt(t)` maps an audio-clock time to the bar
  index and musical step (swing and tempo glide undone), from the last few
  seconds of scheduled bars; `player.latency` is output + base latency. An
  instrument places a played note at `positionAt(ac.currentTime - latency)`.
  The radio keeps `latencyHint: 'playback'`; jam asks for `'interactive'`.
- **Drums** (`drums.ts`): `playDrum(v, kit, hit, at, vel, len?)`.
- **Ambience** (`ambience.ts`): continuous textures with gain ramps, plus
  event sounds (birds, owls, gulls, chimes) spawned by the ambience's own
  random timers inside the scheduler tick; key-aware ones use `BarPlan.scale`.
- **Visual**: `visual()` returns the sounding bar, step, a kick-driven beat
  envelope, per-layer levels and recent notes, from queues keyed to the audio
  clock.
- Starts on a user gesture; `stop()` fades out and suspends.

## Landscapes

Ten built in (ids): `coast`, `summit`, `jungle`, `frostwood`, `village`,
`nightdrive`, `voyager`, `deepspace`, `neonrain`, `caverns`. Opus can
compose more on request (backend `POST /compose`); those name a built-in
`scene` to be painted with.
