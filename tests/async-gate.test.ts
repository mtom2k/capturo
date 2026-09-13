import { describe, expect, it } from 'vitest'
import { AsyncGate } from '../src/shared/async-gate'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('live-tool launch gate', () => {
  it('allows one asynchronous launch when shortcut, tray, and app activation trigger together', async () => {
    const gate = new AsyncGate()
    const capture = deferred()
    let screenshots = 0
    let gifs = 0
    const first = gate.run(async () => {
      screenshots++
      await capture.promise
    })
    const second = gate.run(async () => { screenshots++ })
    const third = gate.run(async () => { gifs++ })

    expect(second).toBe(first)
    expect(third).toBe(first)
    await Promise.resolve()
    expect({ screenshots, gifs }).toEqual({ screenshots: 1, gifs: 0 })

    capture.resolve()
    await first
    await gate.run(async () => { gifs++ })
    expect(gifs).toBe(1)
  })

  it('releases the gate after a failed launch so later actions still work', async () => {
    const gate = new AsyncGate()
    await expect(gate.run(async () => { throw new Error('capture failed') })).rejects.toThrow('capture failed')
    let started = false
    await gate.run(async () => { started = true })
    expect(started).toBe(true)
  })
})
