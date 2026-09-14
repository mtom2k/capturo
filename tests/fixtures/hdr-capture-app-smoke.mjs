// Exercises a real, unsaved Windows selection in an isolated development profile. It checks
// that the native helper served every display and that the overlay loaded; visual color and
// post-unlock acceptance still require a person at the desktop.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import electron from 'electron'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const packaged = process.argv[2] ? path.resolve(process.argv[2]) : null
const child = spawn(packaged ?? electron, packaged ? [] : ['.'], {
  cwd: root,
  windowsHide: true,
  env: { ...process.env, CAPTURO_CAPTURE_ON_START: '1', CAPTURO_TIMING: '1' },
  stdio: ['ignore', 'ignore', 'pipe']
})

let log = ''
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('selection did not load within 15 seconds')), 15_000)
    const finish = (error) => {
      clearTimeout(timer)
      error ? reject(error) : resolve()
    }
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      log += chunk
      if (log.includes('Could not capture a color-safe desktop frame')) {
        finish(new Error('native capture was rejected'))
      } else if (log.includes('overlays loaded')) {
        finish()
      }
    })
    child.once('exit', (code) => finish(new Error(`Capturo exited before selection loaded (${code})`)))
  })
  const displays = log.split(/\r?\n/).filter((line) => line.includes('[timing] helper display'))
  if (displays.length === 0) throw new Error('no native display metadata was logged')
  for (const line of displays) console.log(line.trim())
  console.log('Selection overlays loaded from verified native frames.')
} catch (error) {
  console.error(error)
  console.error(log.slice(-1200))
  process.exitCode = 1
} finally {
  child.kill()
}
