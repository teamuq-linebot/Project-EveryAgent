// run_dev_capture.mjs — launch `npm run dev`, capture combined output to a log,
// wait a fixed window for the app to boot or crash, then terminate the tree.
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import process from 'node:process'

const LOG = 'C:/teamuq/teamuq-electron/output/sw/local-first-split-plan-20260604/devrun.log'
const WAIT_MS = Number(process.argv[2] || 35000)

const out = createWriteStream(LOG, { flags: 'w' })
const stamp = () => new Date().toISOString()
out.write(`[launcher] start ${stamp()} waitMs=${WAIT_MS}\n`)

// electron-vite dev; shell:true so npm resolves on Windows
const child = spawn('npm', ['run', 'dev'], {
  cwd: 'C:/teamuq/teamuq-electron',
  shell: true,
  env: { ...process.env },
})

child.stdout.on('data', (d) => out.write(d))
child.stderr.on('data', (d) => out.write(d))
child.on('exit', (code, sig) => {
  out.write(`\n[launcher] child exited code=${code} sig=${sig} ${stamp()}\n`)
})

setTimeout(() => {
  out.write(`\n[launcher] wait window elapsed, killing tree ${stamp()}\n`)
  try {
    // kill the whole process tree on Windows
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { shell: true })
  } catch (e) {
    out.write(`[launcher] kill error ${String(e)}\n`)
  }
  setTimeout(() => {
    out.write(`[launcher] done ${stamp()}\n`)
    out.end(() => process.exit(0))
  }, 2500)
}, WAIT_MS)
