# Pieces (engine/piece/)

jam (jam.phareim.no) plays pieces on the radio's engine. A piece is a loop
of 1–4 eight-bar phrases: one progression per phrase in the radio's chord
grammar, and tracks that keep one short string per bar. The format and the
bar notation are documented in `engine/piece/types.ts`.

| File | What it does |
|---|---|
| `notation.ts` | note names, note bars (`0:C3+G3:8 8:E3:4:5`), drum bars (`k:x.......x.......`), `quantize`. Formatting is canonical: `format(parse(format(x))) === format(x)` |
| `validate.ts` | `validatePiece`: every field, with messages that name track, bar and token (`tracks[2] 'keys' bar 5: bad pitch 'H4' in token '4:H4:2'`). Voice and kit ids come from `catalog.ts` |
| `chords.ts` | `phraseSpans` (chord spans per loop bar, as written, no added colour), `chordAt`, `diatonicChords` for the chord chips |
| `conductor.ts` | `createPieceConductor`: a `ConductorLike` for the radio's player. Plays the tracks at or below the intensity (mute, solo, gain), a click, and the base landscape's effects and ambience shaped as the radio shapes them (`shapeFx`, `thinAmbience` in `engine/conductor.ts`) |
| `derive.ts` | `pieceToLandscape`: the piece as a radio Landscape over its base (bass line → pattern of chord functions, typical grooves per level, lead phrase openings → written motifs, voices, ladder). Always passes `validateLandscape` |
| `grow.ts` | `growLayer` / `growLadder`: the radio's composer writes a layer over the piece's chords and the result is written down as bars |
| `library.ts` | `patternLibrary` (grooves, fills, bass/arp/lead/pad parts per landscape), `pieceFromLandscape`, `emptyPiece`, `INSTRUMENT_DEFAULTS` |

## Choices worth knowing

- The conductor plans nothing ahead: `setPiece`, `seek` and intensity land
  on the next planned bar. Mix is flat (gain 1); tracks come and go by
  playing or not.
- Growing composes the loop twice and keeps the second pass, so bar 0's pad
  voicing and melody follow on from the loop's last bar. Each grown layer
  plays the pattern the radio plays at the piece's intensity (or at the
  layer's entry level, when that is higher). Phrases on the opening chords
  state the theme (varied from the third phrase), other phrases a contrast
  motif; drums fill at the loop end, after every second phrase, and now and
  then elsewhere, with a crash on bar 0.
- A drum track's groove in a derived landscape is its most common bar, so a
  crash or fill bar is not taken for the groove; the fill is the first
  phrase-end bar that differs from it.
- Grown notes keep the composer's velocities (rounded to 1..9) and lose its
  per-note pans and `arp.seq` cutoff sweep; the conductor pans by layer as the
  composer does.

Tests: `node --no-warnings --test tests/piece.test.ts`.
