// run_dev_probe.mjs — like run_dev_capture but sets TEAMUQ_DEVTOOLS so index.ts
// emits the [mount-probe] line (window opened + renderer mounted + window.tuq present).
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import process from 'node:process'

const LOG = 'C:/teamuq/teamuq-electron/output/sw/local-first-split-plan-20260604/devprobe.log'
const WAIT_MS = Number(process.argv[2] || 35000)

const out = createWriteStream(LOG, { flags: 'w' })
const stamp = () => new Date().toISOString()
out.write(`[launcher] start ${stamp()} waitMs=${WAIT_MS} TEAMUQ_DEVTOOLS=1\n`)

const child = spawn('npm', ['run', 'dev'], {
  cwd: 'C:/teamuq/teamuq-electron',
  shell: true,
  env: { ...process.env, TEAMUQ_DEVTOOLS: '1' },
})

child.stdout.on('data', (d) => out.write(d))
child.stderr.on('data', (d) => out.write(d))
child.on('exit', (code, sig) => {
  out.write(`\n[launcher] child exited code=${code} sig=${sig} ${stamp()}\n`)
})

setTimeout(() => {
  out.write(`\n[launcher] wait window elapsed, killing tree ${stamp()}\n`)
  try {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { shell: true })
  } catch (e) {
    out.write(`[launcher] kill error ${String(e)}\n`)
  }
  setTimeout(() => {
    out.write(`[launcher] done ${stamp()}\n`)
    out.end(() => process.exit(0))
  }, 2500)
}, WAIT_MS)
