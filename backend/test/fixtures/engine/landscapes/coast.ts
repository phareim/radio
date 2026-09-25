import type { Landscape } from '../types.ts'
export const coast: Landscape = {
  id: 'coast', name: 'Neon Coast', blurb: 'dusk over the sea', tonic: 2, bpm: 108,
  layers: [['pad'], ['pad', 'bass'], ['pad', 'bass', 'drums'], ['pad', 'bass', 'drums', 'arp'], ['pad', 'bass', 'drums', 'arp', 'lead']],
  origin: 'builtin',
}
