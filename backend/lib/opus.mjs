// One Opus call: `slp -p - --model opus`, prompt on stdin, answer on stdout.
// slp runs on Petter's Claude Max subscription (OAuth, no API key) and sets
// effort high for Opus itself. cwd is the OS temp dir so no AGENTS.md is
// folded into the system prompt; without --yes, print mode denies every tool,
// so this is text in, text out. RADIO_SLP_BIN swaps in a fake for tests.

import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

export function askOpus(prompt, { timeoutMs = Number(process.env.RADIO_OPUS_TIMEOUT_MS ?? 360_000) } = {}) {
  const bin = process.env.RADIO_SLP_BIN || 'slp';
  const model = process.env.RADIO_OPUS_MODEL || 'opus';
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;

  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['-p', '-', '--model', model], {
      cwd: tmpdir(),
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    let done = false;
    const finish = (fn, v) => { if (!done) { done = true; clearTimeout(timer); fn(v); } };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000).unref();
      finish(reject, new Error(`Opus timed out after ${Math.round(timeoutMs / 1000)} s`));
    }, timeoutMs);

    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (err += c));
    child.on('error', (e) => finish(reject, e));
    child.on('close', (code) => {
      if (code !== 0) finish(reject, new Error(`slp exited ${code}: ${(err || out).trim().slice(0, 500)}`));
      else if (!out.trim()) finish(reject, new Error(`slp returned nothing${err ? `: ${err.trim().slice(0, 300)}` : ''}`));
      else finish(resolve, out.trim());
    });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
  });
}
