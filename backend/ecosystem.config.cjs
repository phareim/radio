// pm2 entry for radio-api. pm2 copies the environment of the shell that runs
// `pm2 start` into the app (filter_env does not stop it in pm2 6), and agent
// shells carry every API key. So clear it before pm2 reads it: the service gets
// only the env below and its key from backend/.env. The Opus jobs (slp) and the
// painter (claude) run on Petter's Max login in ~/.claude, no API keys.
// Re-create with
//   pm2 delete radio-api; pm2 start backend/ecosystem.config.cjs && pm2 save
// The deploy hook's plain `pm2 restart radio-api` keeps it. Never --update-env.
for (const k of Object.keys(process.env)) if (!k.startsWith('PM2_')) delete process.env[k]
const HOME = '/home/petter'
const PATH = `${HOME}/.local/bin:${HOME}/.npm-global/bin:/usr/local/bin:/usr/bin:/bin`
process.env.PATH = PATH
module.exports = {
  apps: [{
    name: 'radio-api',
    cwd: `${HOME}/github/radio`,
    script: 'backend/server.mjs',
    interpreter: '/usr/bin/node',
    node_args: '--no-warnings',
    env: { HOME, USER: 'petter', LOGNAME: 'petter', SHELL: '/usr/bin/zsh', LANG: 'en_US.UTF-8', PATH },
  }],
}
