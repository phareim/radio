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
engine/orchestra.ts    which instrument plays each layer, section by section (Landscape.alt, KIN)
engine/palette.ts      the Era knob: each voice's and kit's chip and acoustic counterpart, the handover order
engine/written.ts      written phrases (Landscape.written): parsing, pitch mapping, one bar of a quote
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
| landscape | the current progression runs to its cadence, the lead drops out, then a 4-bar bridge pivots the harmony (common chord, else the new key's dominant) while tempo, fx and ambience glide; the new landscape arrives with pad and drone, then builds up layer by layer to the target intensity. Across a tempo gap of 12 bpm or more the bridge takes 8 bars (each chord two), the bass leaves with the arp two bars in, and the tempo glide (eased at both ends) runs on 4 bars past the arrival; nothing rhythmic enters until it has landed |
| mood | the mode changes when the next progression starts |
| density | next phrase |
| era | voices and kits at the next phrase start (layer by layer, see Era); crush and tape glide over about a bar |
| space | glides over about a bar. The radio has no Space knob: Era sets it too (`space = era`), dry at 8-bit, vast at analog; jam keeps its own |
| tempo | glides across the next phrase (eased at both ends) |
| hold | freezes progression and motif; the section loops until released |

The conductor plans lazily, one bar at a time, so a new control value
re-plans from wherever the music is.

## Variation (engine 1.2.0)

Left at one intensity, the music still develops:

- **Phrase shapes** (`PhraseShape` in `composer.ts`). Each 8-bar phrase
  picks how the lead spends it, from the section's seed: *classic*
  (statement, the statement again from the next chord tone up, variation,
  cadence), *period* (a question ending on a half cadence in bar 4, then
  the answer restating the opening and closing on the root), *sentence*
  (the idea, the idea higher, its first half repeated and rising, a climb,
  the cadence) and *call* (the lead states the idea and falls silent for
  two bars while the counter line echoes it in its own register; only
  while the counter sounds). A sections lean classic/period, A2 sentence,
  B call.
- **Register**: each phrase sets where the lead's statements start
  (`lift`, semitones from the centre of its range): A low then higher, A2
  higher, B below the centre, the returning A at the centre then a
  third up.
- **Motif variations** (`varyMotif`): inversion, retrograde, a new
  contour, the rhythm pushed two sixteenths late, long notes ornamented
  with a passing or neighbour note, a new last bar.
- **Orchestration** (`orchestra.ts`). A keeps the landscape's own voices.
  A2 may give the arp or the counter another instrument (40 % each); B may
  hand over the lead (65 %), arp (50 %), bass (35 %) or pad (30 %), and
  half the time plays the arp in another pattern. The alternatives are
  `Landscape.alt`, else `KIN` (related voices, jam's piano, felt piano,
  guitars and fingered bass among them), so composed channels get them
  too. An A that returns after B at intensity 3–4 doubles the lead an
  octave below (`alt.double`, else `DOUBLE`).
- **Arc**: B starts a pattern level lighter at intensity 3–4 and builds
  back in its second phrase; a riser under its last bar lifts into the
  returning A, which opens with a crash. The bass walks up into the next
  chord at the end of every section (and half the phrases) from pattern
  level 2.

W sections (quotes) keep the landscape's own voices and shape.

## Era

The Era knob runs from 8-BIT (0) through the landscape as written (0.5)
to ANALOG (1). All of it is synthesis; the acoustic end is modelled
instruments, not samples.

- **Voices** (`palette.ts`). Two tables give every `VoiceId` a chip
  counterpart (`CHIP`: melodic voices → `chip.lead`, arps → `arp.square`,
  pads → `chip.pad`, basses and drones → `chip.bass`, bells → `chip.bell`,
  counter lines → `lead.pulse`) and an acoustic one (`ANALOG`: square and EP
  leads → piano, saw lead → steel guitar, pulse → marimba, hollow, glide and
  whistle → flute, FM lead and bells → vibes, arps → nylon or muted guitar
  or harp, pads → `strings.ensemble` except the choir, basses → fingered or
  upright, drones → organ); `CHIP_KITS` and `ANALOG_KITS` do the same for
  kits (every kit → `kit.chip`; toward analog → `kit.acoustic`, brush and
  tribal stay). A voice already of the end's character keeps itself. On the
  chip side a melodic voice fits some layers badly, so on the arp layer it
  becomes `arp.square`, on the counter `lead.pulse` (apart from the lead),
  on pad, bass and bells their chip voice.
- **Handover**: with `d = |era − 0.5| · 2`, a layer hands over once `d`
  reaches its threshold: drone and pad 0.2, drums and perc 0.35, bells 0.45,
  arp 0.55, bass 0.65, counter 0.75, lead 0.85. The beds change colour first
  and the tune last; at 0 or 1 everything has handed over, at 0.5 nothing.
- **Latching**: the conductor reads `era` for the voices at phrase starts
  (and on a landscape's arrival), so no one changes instrument mid-phrase.
  It maps each bar after composing it, over every note and drum hit
  (composed, quoted, bridge, lead double, riser), copying the events it
  changes; the composer never sees Era, so the music itself is the same at
  any setting. Then every `chip.pad` note gets `opts.chord = [index, count]`,
  its place by pitch among the chip.pad notes of its layer starting on the
  same step, for the voice to arpeggiate the chord.
- **Effects** (`shapeFx`): with `c = max(0, 0.5 − era)·2` and
  `a = max(0, era − 0.5)·2`, tape (`fx.grit`) is the landscape's own at the
  middle (`FxSpec.grit·0.4 + 0.225`), falls to 0 toward 8-bit and rises by up
  to 0.35 toward analog; `fx.crush = 0.75·c²` (`ERA_CRUSH`), so the first
  stretch toward 8-bit is subtle and the far end stops short of the coarse
  staircase's crackle. They glide like the other fx.
- jam's piece conductor uses Era only for the effects: a piece's
  instruments are hand-picked.

## Written phrases

A landscape may carry `written` phrases: eight bars written note for note
in jam (the bar notation of `engine/piece/types.ts`), each with its own
progression and up to ten parts (a layer, a voice or kit, an `enter`
level). A channel made from a jam piece has one per phrase of the piece.
The conductor quotes them now and then between its own sections:

- **When**: where a section would start in the running form (not at the
  very start, not on a landscape's arrival or while it builds up, not
  while a move is pending, not into a breath, never twice in a row), with
  chance `quote` (default 0.35, seeded like everything else) the section
  becomes W: one written phrase, picked by `weight` and not the one quoted
  last. It lasts eight bars (two phrases in a 4-bar landscape); then the
  section that was due follows, so the A A2 B cycle goes on where it was.
  `hold` freezes whatever section is playing, so a held quote loops and a
  held generated section never quotes.
- **What plays**: the phrase's chords as written (no added colour), in the
  current mode. A part sounds when its layer is on (the ladder and the
  layer entries decide, as for everything else) and its `enter` is at or
  below the pattern level, which climbs and falls with the layers, so parts
  come in with a build and play the phrase out when the intensity drops.
  On a layer the phrase has a part for, the composer is silent for the
  whole quote, also while that part waits for a higher level: the quote is
  sparse where the piece is sparse. Layers without a part keep being
  composed over the written chords (pad, arp, counter around a written
  bass and lead). Drum parts play as written, without the composer's
  fills and crash.
- **Key**: parts are written in the landscape's tonic and its mode at mood
  0.5. When the mood knob has moved the mode, each note that is a tone of
  the chord sounding under it stays (notes over a written major V in minor
  keep fitting it); other scale notes move by scale degree (D mixolydian's
  C becomes C# in ionian); chromatic notes keep their pitch. A different
  tonic would transpose first (it does not happen: quotes never play in a
  bridge).
- **Display**: `meta.section` is `W:<name>` (or `W`) and, when nothing
  else is going on, `transition.note` says `quoting <name>`.

A landscape without `written` plans exactly as before; a test pins main's
output for the built-ins by hash.

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
- **FX** (`fx.ts`): master chain = tone low-pass → bit crush → tape
  saturation (grit) → stereo width → compressor → limiter → destination and a
  MediaStreamDestination. The crush is a parallel path through two
  staircase WaveShapers (7 and 5 bits, no oversampling, so it aliases like a
  console), the finer fading into the coarser as `fx.crush` rises, low-passed
  at 9 kHz and mixed in at up to 45 % (dry + wet stays at unity).
  Reverb is a convolver with a generated impulse;
  `reverbSize` changes rebuild it and crossfade old/new over a bar. Delay is
  tempo-synced dotted eighth with filtered feedback.
- **Voices** (`voices.ts`): `playVoice(v: VoiceCtx, id: VoiceId, midi, at, dur, vel, opts)`.
  Every voice in `VoiceId` exists. The tape amount (`fx.grit`) adds detune
  spread and tape wow. The returned `NoteHandle` can `extend` a tie,
  `release(at)` a note early, or `cut` it for the transport.
- **Played instruments** (`instruments.ts`, renderers in `render.ts`):
  `keys.piano`, `keys.felt` (additive, stretched partials, two-stage unison
  decay, hammer knock, velocity → brightness), `guitar.nylon`, `guitar.steel`,
  `guitar.mute`, `bass.finger`, `bass.upright` (Karplus-Strong in JS: a
  DelayNode loop cannot be shorter than one 128-frame render quantum),
  `mallet.vibes` (a rendered bar through a shared motor tremolo). Notes render once per voice,
  pitch, velocity bucket and round-robin variant into an LRU cache of
  AudioBuffers (`res.bufs`, 12 M samples) and play through a gated VCA: they
  ring while held and damp on release. First press of a low piano key renders
  in up to ~60 ms; mid-range notes in 5–20 ms.
- **Era voices** (in `voices.ts` unless named above; `engine/palette.ts`
  picks them). The chip voices are NES channels: exactly in tune, unfiltered,
  no grit spread; volume and vibrato step at the driver's 60 Hz frame rate.
  `chip.lead` is a 25 % pulse (a 50 % square on accents) with a 4-bit stepped
  envelope and a stepped vibrato from 0.25 s. `chip.bass` is the 32-step
  triangle, one level for the whole note. `chip.pad` plays a chord as a
  frame-rate arpeggio: `opts.chord = [index, count]` gives each note its
  two-frame slot, gated by an oscillator rather than automation (so it never
  ties); a note without a chord is a plain 12.5 % pulse. `chip.bell` is a
  12.5 % blip with the NES echo 0.18 s later. The acoustic voices are
  modelled: `strings.ensemble` is two sawtooth players per note with their own
  late vibrato, bow noise and a shared body (levelled for 4-note chords; a
  single line plays louder); `wind.flute` has harmonics, breath, a chiff and
  a late vibrato. `kit.acoustic` is a kit in a small shared room.
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
