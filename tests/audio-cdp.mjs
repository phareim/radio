// Minimal Chrome DevTools Protocol driver (copied and trimmed from
// phareim.no/scripts/zelda-lab/cdp.mjs). Node 22's global WebSocket talks to
// a headless chromium-browser started with a debugging port.
//
// On Sleeper, run whatever calls launch() under the shared lock, one browser
// at a time:  flock /tmp/claude-1000/chrome.lock node tests/audio-check.mjs
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const sleep = ms => new Promise(r => setTimeout(r, ms))

/** `dir` must be somewhere snap Chromium can read (not /tmp, not a hidden dir in $HOME). */
export async function launch(dir) {
  mkdirSync(dir, { recursive: true })
  const port = 9300 + Math.floor(Math.random() * 500)
  const profile = mkdtempSync(join(dir, 'prof-'))
  const proc = spawn('chromium-browser', [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--mute-audio', '--autoplay-policy=no-user-gesture-required',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' })
  let targets
  for (let i = 0; i < 160; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break } catch { /* not yet */ }
    await sleep(250)
  }
  const page = targets?.find(t => t.type === 'page')
  if (!page) {
    proc.kill('SIGKILL')
    rmSync(profile, { recursive: true, force: true })
    throw new Error('chromium did not start within 40 s (server busy?)')
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise(r => ws.addEventListener('open', r, { once: true }))
  let id = 0
  const pending = new Map()
  const errors = []
  const logs = []
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text)
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map(a => a.value ?? a.description).join(' ')
      if (msg.params.type === 'error') errors.push(text)
      logs.push(text)
    }
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id
    pending.set(mid, m => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)))
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  await send('Runtime.enable')
  await send('Page.enable')
  return {
    errors,
    logs,
    async goto(url) { await send('Page.navigate', { url }); await sleep(1500) },
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
      return r.result.value
    },
    // Snap's chromium-browser is a wrapper: killing it orphans the real
    // browser, so ask the browser itself to quit first.
    async close() {
      try { await Promise.race([send('Browser.close'), sleep(1500)]) } catch { /* ignore */ }
      try { ws.close() } catch { /* ignore */ }
      proc.kill('SIGKILL')
      await sleep(300)
      rmSync(profile, { recursive: true, force: true })
    },
  }
}
