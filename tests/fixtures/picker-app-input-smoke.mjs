// Interactive Windows smoke: launch the development app with an isolated picker profile, then
// verify physical mouse movement and wheel travel through the native input HWND into its renderer.
// Run only on a desktop session; this moves the cursor briefly and restores it in a finally block.
import { spawn, spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import electron from 'electron'

const port = 9244
const app = spawn(electron, ['.', `--remote-debugging-port=${port}`], {
  windowsHide: true,
  env: { ...process.env, CAPTURO_PICKER_ON_START: '1' },
  stdio: ['ignore', 'pipe', 'pipe']
})
let stderr = ''
app.stderr.setEncoding('utf8')
app.stderr.on('data', (chunk) => { stderr += chunk })

async function target() {
  const started = Date.now()
  while (Date.now() - started < 5000) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const picker = targets.find((entry) => entry.url?.endsWith('/picker.html'))
      if (picker) return picker
    } catch { /* Electron is still loading. */ }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`picker renderer did not start: ${stderr.slice(-1200)}`)
}

try {
  const picker = await target()
  const socket = new WebSocket(picker.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  let id = 0
  const pending = new Map()
  socket.addEventListener('message', (message) => {
    const response = JSON.parse(message.data)
    if (pending.has(response.id)) {
      pending.get(response.id)(response)
      pending.delete(response.id)
    }
  })
  const evaluate = async (expression) => {
    const requestId = ++id
    const response = new Promise((resolve) => pending.set(requestId, resolve))
    socket.send(JSON.stringify({ id: requestId, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
    const result = await response
    if (result.error || result.result.exceptionDetails) throw new Error(JSON.stringify(result))
    return result.result.result.value
  }
  assert.equal(await evaluate(`window.__pickerInputSmoke = []; window.__pickerWheelSmoke = []; window.capturoColor.onPickerInput(event => window.__pickerInputSmoke.push(event)); document.addEventListener('wheel', event => window.__pickerWheelSmoke.push(event.deltaY)); true`), true)

  const move = String.raw`
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class CursorProbe { [StructLayout(LayoutKind.Sequential)] public struct Point { public int X; public int Y; } [StructLayout(LayoutKind.Sequential)] public struct CursorInfo { public int Size; public int Flags; public IntPtr Handle; public Point Position; } [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point p); [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index); [DllImport("user32.dll")] public static extern bool GetCursorInfo(ref CursorInfo info); [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra); }'
$original = New-Object CursorProbe+Point
if (-not [CursorProbe]::GetCursorPos([ref]$original)) { throw 'GetCursorPos failed' }
$right = [CursorProbe]::GetSystemMetrics(76) + [CursorProbe]::GetSystemMetrics(78)
$left = [CursorProbe]::GetSystemMetrics(76)
$nextX = if ($original.X + 40 -lt $right) { $original.X + 40 } else { $original.X - 40 }
$farX = if ($nextX + 420 -lt $right) { $nextX + 420 } elseif ($nextX - 420 -ge $left) { $nextX - 420 } else { $nextX }
try {
  if (-not [CursorProbe]::SetCursorPos($nextX, $original.Y)) { throw 'SetCursorPos failed' }
  Start-Sleep -Milliseconds 100
  for ($step = 0; $step -lt 4; $step++) {
    [CursorProbe]::mouse_event(0x0800, 0, 0, 120, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 65
  }
  for ($sweep = 0; $sweep -lt 6; $sweep++) {
    $targetX = if ($sweep % 2 -eq 0) { $farX } else { $nextX }
    if (-not [CursorProbe]::SetCursorPos($targetX, $original.Y)) { throw 'sweep SetCursorPos failed' }
    Start-Sleep -Milliseconds 25
    $cursor = New-Object CursorProbe+CursorInfo
    $cursor.Size = [Runtime.InteropServices.Marshal]::SizeOf($cursor)
    if (-not [CursorProbe]::GetCursorInfo([ref]$cursor) -or $cursor.Handle -ne [IntPtr]::Zero) {
      throw "Windows arrow appeared during sweep $sweep"
    }
  }
} finally {
  [void][CursorProbe]::SetCursorPos($original.X, $original.Y)
}
`
  const probe = spawnSync('powershell.exe', ['-NoProfile', '-Command', move], { encoding: 'utf8', timeout: 5000 })
  assert.equal(probe.status, 0, probe.stderr || 'mouse input probe failed')
  await new Promise((resolve) => setTimeout(resolve, 250))
  const events = await evaluate('window.__pickerInputSmoke')
  assert.ok(events.some((event) => event.kind === 'move'), `no native move reached the renderer: ${JSON.stringify(events)}`)
  const moveX = events.filter((event) => event.kind === 'move').map((event) => event.point.x)
  assert.ok(Math.max(...moveX) - Math.min(...moveX) >= 400,
    `a wide physical sweep did not reach the renderer: ${JSON.stringify(moveX)}`)
  const domWheel = await evaluate('window.__pickerWheelSmoke')
  assert.ok(events.filter((event) => event.kind === 'wheel').length + domWheel.length >= 4,
    `the four zoom steps did not reach the renderer: ${JSON.stringify({ events, domWheel })}`)
  console.log(JSON.stringify({ renderer: picker.title, moveEvents: events.filter((event) => event.kind === 'move').length, nativeWheelEvents: events.filter((event) => event.kind === 'wheel').length, domWheelEvents: domWheel.length }))
  const keyId = ++id
  const keyResponse = new Promise((resolve) => pending.set(keyId, resolve))
  socket.send(JSON.stringify({ id: keyId, method: 'Input.dispatchKeyEvent', params: { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 } }))
  await keyResponse
  const cancelStarted = Date.now()
  let closed = false
  while (Date.now() - cancelStarted < 2000) {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    closed = !targets.some((entry) => entry.url?.endsWith('/picker.html'))
    if (closed) break
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.equal(closed, true, 'Escape did not close the picker with the native input surface active')
  socket.close()
} finally {
  app.kill()
  await new Promise((resolve) => setTimeout(resolve, 500))
}
