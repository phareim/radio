import type { Landscape } from '../types.ts'
import { coast } from './coast.ts'
import { neonrain } from './neonrain.ts'
export const LANDSCAPES: Record<string, Landscape> = { coast, neonrain }
