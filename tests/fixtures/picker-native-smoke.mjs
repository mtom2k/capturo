// Run on a Windows desktop after native/capturo-capture/build.cmd. This exercises the actual
// input-only HWND and verifies that it forwards physical movement, then tears down on pipe EOF.
import { spawn, spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const helper = path.join(root, 'native/capturo-capture/build/capturo-capture.exe')
const child = spawn(helper, ['--picker-input-smoke'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
const events = []
let buffer = ''
let desktopCursorAvailable = false
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
  const ready = events.find((event) => event.kind === 'ready')
  assert.ok(ready, 'input surface did not start')
  assert.equal(ready.inputHit, true, 'input-only surface did not own the current cursor point')

  await new Promise((resolve) => child.once('exit', resolve))
  const probe = events.find((event) => event.kind === 'probe')
  if (probe?.deltaY === -2) {
    // Some CI/sandbox desktops permit creating an HWND but deny GetCursorPos. The same fixture
    // should still run on an interactive Windows desktop, where it verifies actual input.
    console.log(JSON.stringify({ skipped: 'desktop cursor unavailable', ready }))
  } else {
    desktopCursorAvailable = true
    assert.equal(ready.nullCursor, true, 'the native surface announced readiness before hiding the pointer')
    assert.equal(probe?.deltaY, 1, `SetCursorPos failed: ${JSON.stringify(events)}`)
    assert.ok(events.some((event) => event.kind === 'move'), `native surface did not forward movement: ${JSON.stringify(events)}`)
    assert.equal(events.find((event) => event.kind === 'cursor-check')?.deltaY, 1,
      `input-only surface did not hide the cursor after movement: ${JSON.stringify(events)}`)
    console.log(JSON.stringify({ ready, moveEvents: events.filter((event) => event.kind === 'move').length }))
  }
} finally {
  child.stdin.end()
  await new Promise((resolve) => {
    if (child.exitCode !== null) return resolve()
    const timer = setTimeout(() => { child.kill(); resolve() }, 1000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
  })
}

if (desktopCursorAvailable) {
  const inspect = String.raw`
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class RestoredCursorProbe { [StructLayout(LayoutKind.Sequential)] public struct Point { public int X; public int Y; } [StructLayout(LayoutKind.Sequential)] public struct CursorInfo { public int Size; public int Flags; public IntPtr Handle; public Point Position; } [DllImport("user32.dll")] public static extern bool GetCursorInfo(ref CursorInfo info); }'
$info = New-Object RestoredCursorProbe+CursorInfo
$info.Size = [Runtime.InteropServices.Marshal]::SizeOf($info)
if (-not [RestoredCursorProbe]::GetCursorInfo([ref]$info)) { throw 'GetCursorInfo failed' }
Write-Output ($info.Handle -ne [IntPtr]::Zero)
`
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', inspect], { encoding: 'utf8', timeout: 5000 })
  assert.equal(result.status, 0, result.stderr || 'post-picker cursor inspection failed')
  assert.equal(result.stdout.trim(), 'True', 'normal cursor did not return after the picker helper exited')
}
