import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pinBounds, MAX_PINS } from '../src/shared/pin'

const state = vi.hoisted(() => ({ handlers: new Map<string, Function>(), windows: [] as any[], copy: vi.fn() }))
vi.mock('electron', () => ({
  ipcMain: { handle: (name: string, fn: Function) => state.handlers.set(name, fn) },
  clipboard: { writeImage: state.copy },
  nativeImage: { createFromBuffer: (bytes: Buffer) => bytes },
  BrowserWindow: class extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), { id: state.windows.length + 1, mainFrame: {}, setWindowOpenHandler: vi.fn() })
    destroyed = false
    show = vi.fn()
    setOpacity = vi.fn()
    constructor(public options: unknown) { super(); state.windows.push(this) }
    isDestroyed() { return this.destroyed }
    destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('closed') } }
  }
}))
import { PinManager } from '../src/main/pins'

const image = (width = 600, height = 300) => ({ getSize: () => ({ width, height }), toPNG: () => Buffer.from('original PNG') }) as Electron.NativeImage
const display = { workArea: { x: -1600, y: 0, width: 1600, height: 900 }, scaleFactor: 1.5 } as Electron.Display
const event = (window: any) => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame })
const invoke = (name: string, sender: any, ...args: unknown[]) => state.handlers.get(name)!(sender, ...args)
let manager: PinManager
beforeEach(() => {
  vi.useFakeTimers(); state.windows.length = 0; state.handlers.clear(); state.copy.mockClear()
  manager = new PinManager({ preload: 'preload', icon: 'icon', load: async () => {} })
})
afterEach(() => { manager.closeAll(); vi.useRealTimers() })

describe('pinned screenshot ownership and lifecycle', () => {
  it('reveals only after decoding and copies original bytes regardless of display opacity', async () => {
    const opening = manager.open(image(), display)
    const window = state.windows[0], sender = event(window)
    expect(window.options).toMatchObject({ alwaysOnTop: true, show: false, resizable: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
    expect(window.show).not.toHaveBeenCalled()
    expect(invoke('pin:initialize', sender)).toMatchObject({ width: 600, height: 300 })
    expect(invoke('pin:ready', sender)).toBe(true)
    expect(await opening).toEqual({ opened: true })
    expect(invoke('pin:opacity', sender, 0.25)).toBe(true)
    expect(window.setOpacity).toHaveBeenCalledWith(0.25)
    expect(invoke('pin:copy', sender)).toBe(true)
    expect(state.copy).toHaveBeenCalledWith(Buffer.from('original PNG'))
    expect(window.destroyed).toBe(false)
    invoke('pin:close', sender)
    expect(invoke('pin:initialize', sender)).toBeNull()
    expect(invoke('pin:copy', sender)).toBe(false)
  })
  it('rejects other windows and child frames, and refuses invalid opacity values', async () => {
    const opening = manager.open(image(), display), window = state.windows[0]
    const sender = event(window)
    for (const foreign of [{ sender: { id: 900, mainFrame: {} }, senderFrame: {} }, { ...sender, senderFrame: {} }]) {
      expect(invoke('pin:initialize', foreign)).toBeNull()
      expect(invoke('pin:ready', foreign)).toBe(false)
      expect(invoke('pin:copy', foreign)).toBe(false)
      expect(invoke('pin:opacity', foreign, 0.5)).toBe(false)
      invoke('pin:close', foreign)
      expect(window.destroyed).toBe(false)
    }
    for (const value of [NaN, Infinity, -1, 0, 0.24, 1.01, '0.5', null]) expect(invoke('pin:opacity', sender, value)).toBe(false)
    manager.closeAll()
    expect((await opening).opened).toBe(false)
  })
  it('times out a stalled load and recovers its slot', async () => {
    manager = new PinManager({ preload: 'preload', icon: 'icon', load: () => new Promise(() => {}) })
    const opening = manager.open(image(), display)
    await vi.advanceTimersByTimeAsync(10_000)
    expect((await opening).opened).toBe(false)
    expect(state.windows[0].destroyed).toBe(true)
  })
  it('cleans up rejected loads and renderer crashes without closing other pins', async () => {
    const a = manager.open(image(), display), b = manager.open(image(), display)
    invoke('pin:ready', event(state.windows[1]))
    state.windows[0].webContents.emit('render-process-gone')
    expect((await a).opened).toBe(false)
    expect((await b).opened).toBe(true)
    expect(state.windows[1].destroyed).toBe(false)
    manager.closeAll()
    manager = new PinManager({ preload: 'preload', icon: 'icon', load: async () => { throw new Error('load failed') } })
    expect((await manager.open(image(), display)).opened).toBe(false)
  })
  it('bounds pin count and releases capacity on close', async () => {
    for (let n = 0; n < MAX_PINS; n++) {
      const opening = manager.open(image(), display)
      invoke('pin:ready', event(state.windows[n])); await opening
    }
    expect((await manager.open(image(), display)).opened).toBe(false)
    state.windows[0].destroy()
    const opening = manager.open(image(), display)
    invoke('pin:ready', event(state.windows.at(-1)))
    expect((await opening).opened).toBe(true)
  })
  it('bounds decoded pixel allocations per pin and across pins', async () => {
    expect((await manager.open(image(10000, 10000), display)).opened).toBe(false)
    expect(state.windows).toHaveLength(0)
    for (let n = 0; n < 2; n++) {
      const opening = manager.open(image(8000, 5000), display)
      invoke('pin:ready', event(state.windows[n])); await opening
    }
    expect((await manager.open(image(), display)).opened).toBe(false)
  })
})

describe('initial pin placement', () => {
  it('uses display density and keeps negative-coordinate displays in bounds', () => {
    expect(pinBounds(900, 450, display.workArea, 1.5)).toEqual({ x: -1100, y: 280, width: 600, height: 340 })
  })
  it('fits extreme aspect ratios and small work areas without leaving the display', () => {
    const work = { x: 100, y: -400, width: 300, height: 250 }
    for (const [w, h] of [[30000, 50], [50, 30000], [1, 1]]) {
      const box = pinBounds(w, h, work, 2)
      expect(box.x).toBeGreaterThanOrEqual(work.x)
      expect(box.y).toBeGreaterThanOrEqual(work.y)
      expect(box.x + box.width).toBeLessThanOrEqual(work.x + work.width)
      expect(box.y + box.height).toBeLessThanOrEqual(work.y + work.height)
    }
  })
})
