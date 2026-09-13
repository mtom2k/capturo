// Interactive Windows smoke for physical wheel and click routing through the input-only HWND.
// The native surface covers the desktop while these events are injected; no app action occurs.
import { spawn, spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const helper = path.join(root, 'native/capturo-capture/build/capturo-capture.exe')
const child = spawn(helper, ['--picker-input'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
const events = []
let buffer = ''
child.stdout.setEncoding('utf8')
child.stdout.on('data', (chunk) => {
  buffer += chunk
  let end = buffer.indexOf('\n')
  while (end >= 0) {
    events.push(JSON.parse(buffer.slice(0, end)))
    buffer = buffer.slice(end + 1)
    end = buffer.indexOf('\n')
  }
})

try {
  const started = Date.now()
  while (!events.some((event) => event.kind === 'ready') && Date.now() - started < 2000) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.equal(events.find((event) => event.kind === 'ready')?.inputHit, true,
    `native surface did not cover the current cursor: ${JSON.stringify(events)}`)

  const inject = String.raw`
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class PickerInputProbe { [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra); }'
[PickerInputProbe]::mouse_event(0x0800, 0, 0, 120, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 80
[PickerInputProbe]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
[PickerInputProbe]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
`
  const probe = spawnSync('powershell.exe', ['-NoProfile', '-Command', inject], { encoding: 'utf8', timeout: 5000 })
  assert.equal(probe.status, 0, probe.stderr || 'physical input probe failed')
  await new Promise((resolve) => setTimeout(resolve, 150))
  assert.ok(events.some((event) => event.kind === 'wheel' && event.deltaY === -120),
    `wheel missed the native surface: ${JSON.stringify(events)}`)
  assert.ok(events.some((event) => event.kind === 'pick'),
    `click missed the native surface: ${JSON.stringify(events)}`)
  console.log(JSON.stringify({ wheel: true, click: true }))
} finally {
  child.stdin.end()
  await new Promise((resolve) => {
    if (child.exitCode !== null) return resolve()
    const timer = setTimeout(() => { child.kill(); resolve() }, 1000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
  })
}
