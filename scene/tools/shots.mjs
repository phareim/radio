// Screenshot every place (and a few mid-dissolve frames) in ONE headless
// Chromium session, desktop then phone. Run it under the server's browser
// lock:
//   flock /tmp/claude-1000/chrome.lock node scene/tools/shots.mjs [ids,comma] [desktop|phone|both] [intensity]
// Writes scene/shots/<id>-<view>.png and dissolve-*.png, prints ms/frame.
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch } from './cdp.mjs'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(dir, 'shots')
mkdirSync(out, { recursive: true })
const ALL = ['coast', 'summit', 'jungle', 'frostwood', 'village', 'nightdrive', 'voyager', 'deepspace', 'neonrain', 'caverns', 'crossroads-cafe-5b44', 'autumn-harbour-4ce5']
const ids = process.argv[2] && process.argv[2] !== 'all' ? process.argv[2].split(',') : ALL
const which = process.argv[3] ?? 'both'
const intensity = Number(process.argv[4] ?? 2)
const dissolves = process.argv[5] !== 'nodissolve'
const views = [
  { name: 'desktop', width: 1440, height: 900, dpr: 1, mobile: false },
  { name: 'phone', width: 390, height: 844, dpr: 2, mobile: true },
].filter(v => which === 'both' || v.name === which)

const b = await launch(views[0])
try {
  await b.goto(`file://${join(dir, 'dev.html')}?clean=1&intensity=${intensity}`)
  for (const v of views) {
    await b.send('Emulation.setDeviceMetricsOverride', { width: v.width, height: v.height, deviceScaleFactor: v.dpr, mobile: v.mobile })
    await b.eval('window.dispatchEvent(new Event("resize")), 1')
    await b.sleep(300)
    for (const id of ids) {
      await b.eval(`window.__radio.set({ from: '${id}', to: '${id}', blend: 1, tour: false, intensity: ${intensity} }), 1`)
      await b.sleep(2600)
      await b.shot(join(out, `${id}-${v.name}.png`))
      const ms = await b.eval('window.__radio.cost()')
      console.log(`${id} ${v.name}: ${ms.toFixed(2)} ms/frame`)
    }
    const pairs = ids.length > 1 ? [[ids[0], ids[1]], [ids[ids.length - 2], ids[ids.length - 1]]] : []
    if (dissolves) for (const [from, to] of pairs.slice(0, ids.length > 3 ? 2 : 1)) {
      for (const [bl, tag] of [[0.3, '30'], [0.6, '60']]) {
        await b.eval(`window.__radio.set({ from: '${from}', to: '${to}', blend: ${bl} }), 1`)
        await b.sleep(1200)
        await b.shot(join(out, `dissolve-${from}-${to}-${tag}-${v.name}.png`))
        const ms = await b.eval('window.__radio.cost()')
        console.log(`dissolve ${from}→${to} ${bl} ${v.name}: ${ms.toFixed(2)} ms/frame`)
      }
    }
  }
  if (b.errors.length) console.log('page errors:', b.errors.slice(0, 5))
} finally {
  await b.close()
}
