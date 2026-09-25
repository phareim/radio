// Stub of engine/types.ts for the backend tests (the real one is richer).
// ---- theory --------------------------------------------------------------
export type Mode = 'ionian' | 'dorian' | 'aeolian'
// ---- landscapes ----------------------------------------------------------
export interface Landscape {
  id: string
  name: string
  blurb: string
  tonic: number
  bpm: number
  layers: string[][]
  scene?: string
  origin?: 'builtin' | 'opus'
  prompt?: string
}
// ---- controls ------------------------------------------------------------
export interface Controls { landscape: string }
