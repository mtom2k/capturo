import { BrowserWindow, clipboard, ipcMain, nativeImage } from 'electron'
import { MAX_PINS, MAX_PIN_PIXELS, MAX_TOTAL_PIN_PIXELS, pinBounds, type PinEditResult, type PinPayload, type PinResult } from '../shared/pin'
import { lockAppNavigation } from './window-security'

type Pin = {
  window: BrowserWindow
  payload: PinPayload
  ready: boolean
  finish: (opened: boolean) => void
}

// Independent from capture sessions. Only the window owning a pin may read or operate it.
export class PinManager {
  private pins = new Map<number, Pin>()

  constructor(private options: {
    preload: string
    icon: Electron.NativeImage | string
    load: (window: BrowserWindow) => Promise<unknown>
    edit: (payload: PinPayload, window: BrowserWindow) => Promise<PinEditResult>
  }) {
    const owner = (event: Electron.IpcMainInvokeEvent): Pin | undefined => {
      const pin = this.pins.get(event.sender.id)
      return pin && !pin.window.isDestroyed() && event.senderFrame === event.sender.mainFrame ? pin : undefined
    }
    ipcMain.handle('pin:initialize', (event) => owner(event)?.payload ?? null)
    ipcMain.handle('pin:ready', (event) => {
      const pin = owner(event)
      if (!pin) return false
      pin.ready = true
      pin.window.show()
      pin.finish(true)
      return true
    })
    ipcMain.handle('pin:opacity', (event, value: unknown) => {
      const pin = owner(event)
      if (!pin || typeof value !== 'number' || !Number.isFinite(value) || value < 0.25 || value > 1) return false
      pin.window.setOpacity(value)
      return true
    })
    ipcMain.handle('pin:copy', (event) => {
      const pin = owner(event)
      if (!pin) return false
      clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(pin.payload.png)))
      return true
    })
    ipcMain.handle('pin:edit', (event): Promise<PinEditResult> => {
      const pin = owner(event)
      if (!pin || !pin.ready) return Promise.resolve({ opened: false, error: 'This pin is no longer available.' })
      return this.options.edit(pin.payload, pin.window)
    })
    ipcMain.handle('pin:close', (event) => owner(event)?.window.destroy())
  }

  async open(image: Electron.NativeImage, display: Electron.Display): Promise<PinResult> {
    const { width, height } = image.getSize()
    const pixels = width * height
    const total = [...this.pins.values()].reduce((sum, pin) => sum + pin.payload.width * pin.payload.height, 0)
    if (!pixels || pixels > MAX_PIN_PIXELS) return { opened: false, error: 'This image is too large to pin. Select a smaller region.' }
    if (this.pins.size >= MAX_PINS || total + pixels > MAX_TOTAL_PIN_PIXELS) {
      return { opened: false, error: 'Close an existing pin before pinning another screenshot.' }
    }
    let window: BrowserWindow | undefined
    try {
      const png = image.toPNG()
      const bounds = pinBounds(width, height, display.workArea, display.scaleFactor)
      window = new BrowserWindow({
        ...bounds, minWidth: Math.min(320, display.workArea.width), minHeight: Math.min(140, display.workArea.height),
        title: 'Capturo — Pinned screenshot', icon: this.options.icon,
        frame: false, resizable: true, maximizable: false, fullscreenable: false,
        alwaysOnTop: true, skipTaskbar: true, show: false, backgroundColor: '#111820',
        webPreferences: { preload: this.options.preload, sandbox: true, contextIsolation: true, nodeIntegration: false }
      })
      const target = window
      const senderId = target.webContents.id
      let resolve!: (opened: boolean) => void
      const ready = new Promise<boolean>((done) => { resolve = done })
      const timer = setTimeout(() => { if (!target.isDestroyed()) target.destroy() }, 10_000)
      const pin: Pin = { window: target, payload: { png, width, height }, ready: false,
        finish: (opened) => { clearTimeout(timer); resolve(opened) } }
      this.pins.set(senderId, pin)
      target.on('closed', () => { this.pins.delete(senderId); pin.finish(false) })
      target.webContents.on('render-process-gone', () => target.destroy())
      target.on('unresponsive', () => { if (!pin.ready) target.destroy() })
      lockAppNavigation(target)
      // The deadline also covers a load that never resolves.
      void this.options.load(target).catch(() => { if (!target.isDestroyed()) target.destroy() })
      return await ready ? { opened: true } : { opened: false, error: 'Capturo could not open the pinned screenshot.' }
    } catch (error) {
      if (window && !window.isDestroyed()) window.destroy()
      console.error('Could not pin screenshot', error)
      return { opened: false, error: 'Capturo could not open the pinned screenshot.' }
    }
  }

  closeAll(): void {
    for (const pin of [...this.pins.values()]) pin.window.destroy()
  }
}
