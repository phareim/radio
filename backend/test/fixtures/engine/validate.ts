// Stub validator for the backend tests: a few structural checks.
export function validateLandscape(x: unknown): { ok: boolean; errors: string[]; landscape?: any } {
  const errors: string[] = []
  const l = x as any
  if (!l || typeof l !== 'object') return { ok: false, errors: ['not an object'] }
  if (typeof l.id !== 'string' || !l.id) errors.push('id: required string')
  if (typeof l.name !== 'string' || !l.name) errors.push('name: required string')
  if (typeof l.tonic !== 'number' || l.tonic < 0 || l.tonic > 11) errors.push('tonic: 0..11')
  if (typeof l.bpm !== 'number' || l.bpm < 40 || l.bpm > 200) errors.push('bpm: 40..200')
  if (!Array.isArray(l.layers) || l.layers.length !== 5) errors.push('layers: five arrays')
  return errors.length ? { ok: false, errors } : { ok: true, errors, landscape: l }
}
