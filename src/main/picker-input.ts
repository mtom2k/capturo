// Owns the short-lived Windows picker input process. Its HWND covers the virtual desktop but
// allocates no DWM redirection surface; the Electron BrowserWindow paints only the compact lens.
// The pipe and heartbeat are fail-safe: if main hangs or exits, the native window destroys itself.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { pickerInputHelperPath } from './capture-helper'

export type NativePickerInputEvent = {
  kind: 'move' | 'wheel' | 'pick'
  x: number
  y: number
  deltaY?: number
}

export type PickerInputController = { stop: () => void }

export function startPickerInput(
  onReady: () => void,
  onEvent: (event: NativePickerInputEvent) => void,
  onLost: () => void
): PickerInputController | null {
  const helper = pickerInputHelperPath()
  if (!helper || !existsSync(helper)) return null
  let child: ChildProcessWithoutNullStreams
  try {
    child = spawn(helper, ['--picker-input'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  } catch {
    return null
  }

  let stopped = false
  let ready = false
  let buffer = ''
  child.stdin.on('error', () => child.kill())
  child.stdout.on('error', () => child.kill())
  const heartbeat = setInterval(() => {
    if (!stopped && !child.stdin.destroyed) child.stdin.write('ping\n')
  }, 500)
  const startup = setTimeout(() => {
    if (!ready) child.kill()
  }, 2000)
  const stop = (): void => {
    if (stopped) return
    stopped = true
    clearInterval(heartbeat)
    clearTimeout(startup)
    child.stdin.end()
    const kill = setTimeout(() => { if (child.exitCode === null) child.kill() }, 500)
    kill.unref()
  }

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    if (stopped) return
    buffer += chunk
    if (buffer.length > 16_384) {
      child.kill()
      return
    }
    let end = buffer.indexOf('\n')
    while (end >= 0) {
      const line = buffer.slice(0, end)
      buffer = buffer.slice(end + 1)
      let event: Record<string, unknown>
      try {
        event = JSON.parse(line) as Record<string, unknown>
      } catch {
        child.kill()
        return
      }
      if (event.kind === 'ready') {
        if (event.nullCursor !== true || event.inputHit !== true) {
          child.kill()
          return
        }
        ready = true
        clearTimeout(startup)
        onReady()
      } else if (ready && (event.kind === 'move' || event.kind === 'wheel' || event.kind === 'pick') &&
          typeof event.x === 'number' && Number.isFinite(event.x) &&
          typeof event.y === 'number' && Number.isFinite(event.y) &&
          (event.kind !== 'wheel' || (typeof event.deltaY === 'number' && Number.isFinite(event.deltaY)))) {
        onEvent(event as NativePickerInputEvent)
      }
      end = buffer.indexOf('\n')
    }
  })
  const lost = (): void => {
    const notify = !stopped
    stopped = true
    clearInterval(heartbeat)
    clearTimeout(startup)
    if (notify) onLost()
  }
  child.on('exit', lost)
  child.on('error', lost)
  return { stop }
}
