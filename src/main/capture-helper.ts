// Owns the persistent native capture helper. The helper (native/capturo-capture) is spawned
// once and kept alive: it creates the Direct3D device and desktop duplication a single time
// and answers capture requests over stdin/stdout, so the per-capture setup cost is paid only
// on the first (warm-up) run rather than every capture. See D-017.
//
// Protocol: one request per line on stdin, "<originX>\t<originY>\t<outputPath>"; one JSON
// result line per request on stdout, in order. This module keeps a single batch in flight and
// serializes callers, so a capture session's requests and their responses never interleave.

import { app } from 'electron'
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { Readable, Writable } from 'node:stream'

type HelperProcess = ChildProcessByStdio<Writable, Readable, null>

export type HelperRequest = { originX: number; originY: number; output: string }

export type HelperResult = {
  ok: boolean
  width?: number
  height?: number
  stage?: string
  timings?: Record<string, number>
}

function helperPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'capture', 'capturo-capture.exe')
    : path.join(app.getAppPath(), 'native', 'capturo-capture', 'build', 'capturo-capture.exe')
}

export function helperAvailable(): boolean {
  return process.platform === 'win32' && existsSync(helperPath())
}

// A capture must never hang the app; a helper that has not answered within this bound is
// treated as failed (the caller falls back) and restarted.
const REQUEST_TIMEOUT_MS = 6000

type Pending = {
  expected: number
  results: HelperResult[]
  resolve: (results: HelperResult[]) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

let child: HelperProcess | null = null
let stdoutBuffer = ''
let pending: Pending | null = null
// Serializes capture batches so their responses cannot interleave on the shared pipe.
let queue: Promise<unknown> = Promise.resolve()

function killChild(): void {
  if (child) {
    child.removeAllListeners()
    child.stdout?.removeAllListeners()
    try {
      child.kill()
    } catch {
      // Already gone.
    }
    child = null
  }
  stdoutBuffer = ''
}

function rejectPending(error: Error): void {
  if (!pending) return
  clearTimeout(pending.timer)
  const settled = pending
  pending = null
  settled.reject(error)
}

function onResponseLine(line: string): void {
  if (!pending) return
  let result: HelperResult
  try {
    result = JSON.parse(line) as HelperResult
  } catch {
    result = { ok: false, stage: 'parse' }
  }
  pending.results.push(result)
  if (pending.results.length >= pending.expected) {
    clearTimeout(pending.timer)
    const settled = pending
    pending = null
    settled.resolve(settled.results)
  }
}

function ensureStarted(): boolean {
  if (child) return true
  if (!helperAvailable()) return false
  let proc: HelperProcess
  try {
    proc = spawn(helperPath(), [], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })
  } catch {
    child = null
    return false
  }
  child = proc
  proc.stdout.setEncoding('utf8')
  proc.stdout.on('data', (chunk: string) => {
    stdoutBuffer += chunk
    let newline = stdoutBuffer.indexOf('\n')
    while (newline >= 0) {
      const line = stdoutBuffer.slice(0, newline).replace(/\r$/, '')
      stdoutBuffer = stdoutBuffer.slice(newline + 1)
      if (line) onResponseLine(line)
      newline = stdoutBuffer.indexOf('\n')
    }
  })
  const onGone = (): void => {
    killChild()
    rejectPending(new Error('capture helper exited'))
  }
  proc.on('exit', onGone)
  proc.on('error', onGone)
  return true
}

// Start (and warm) the helper. Safe to call more than once; a no-op if already running or the
// helper is not present on this platform/build.
export function startCaptureHelper(): void {
  ensureStarted()
}

export function stopCaptureHelper(): void {
  killChild()
}

// Captures the requested displays through the persistent helper. Rejects if the helper is
// unavailable, already busy, times out, or dies — the caller then falls back to
// desktopCapturer. Results are returned in request order.
export function captureDisplays(requests: HelperRequest[]): Promise<HelperResult[]> {
  const run = (): Promise<HelperResult[]> =>
    new Promise<HelperResult[]>((resolve, reject) => {
      if (requests.length === 0) return resolve([])
      if (!ensureStarted() || !child) return reject(new Error('capture helper unavailable'))
      if (pending) return reject(new Error('capture helper busy'))

      const timer = setTimeout(() => {
        rejectPending(new Error('capture helper timed out'))
        killChild() // a hung helper is restarted on the next capture
      }, REQUEST_TIMEOUT_MS)
      pending = { expected: requests.length, results: [], resolve, reject, timer }

      const payload =
        requests
          .map((request) => `${Math.round(request.originX)}\t${Math.round(request.originY)}\t${request.output}`)
          .join('\n') + '\n'
      try {
        child.stdin.write(payload)
      } catch (error) {
        rejectPending(error instanceof Error ? error : new Error('capture helper write failed'))
        killChild()
      }
    })

  const result = queue.then(run, run)
  queue = result.then(
    () => undefined,
    () => undefined
  )
  return result
}
