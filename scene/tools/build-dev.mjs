// Bundle the scene harness: scene/dev.ts → scene/dev.js (IIFE, opens from file://).
//   node scene/tools/build-dev.mjs
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..')
execFileSync('npx', ['--yes', 'esbuild', join(dir, 'dev.ts'), '--bundle', '--format=iife', '--target=es2022', `--outfile=${join(dir, 'dev.js')}`, '--log-level=warning'], { stdio: 'inherit' })
console.log('built scene/dev.js')
