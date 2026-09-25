import type { Landscape } from '../types.ts'
export const neonrain: Landscape = {
  id: 'neonrain', name: 'Neon Rain', blurb: 'a rainy street at night', tonic: 7, bpm: 84,
  layers: [['pad'], ['pad', 'bass'], ['pad', 'bass', 'drums'], ['pad', 'bass', 'drums'], ['pad', 'bass', 'drums', 'lead']],
  origin: 'builtin',
}
