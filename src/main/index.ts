import {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  screen,
  shell,
  systemPreferences,
  Tray
} from 'electron'
import { promises as fs, existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { CapturePayload, OverlayRole, Rect, SaveResult } from '../shared/types'

type OverlayEntry = {
  window: BrowserWindow
  payload: CapturePayload
  shownAt: number
  revealed: boolean
}

type CaptureSession = {
  id: string
  overlays: Map<number, OverlayEntry>
}

// Windows plays a scale-and-fade transition whenever a window goes from hidden to
// shown. On a borderless window sized to the whole display that reads as the desktop
// zooming into place, which is exactly what a capture overlay must never do. The
// overlay is therefore shown fully transparent as soon as it is created, so the
// transition runs while nothing is on screen, and is later revealed by raising its
// opacity, which is composited immediately and is never animated.
const SHOW_TRANSITION_MS = 250

let tray: Tray | null = null
let session: CaptureSession | null = null
let isQuitting = false

const isMac = process.platform === 'darwin'
const isSmokeInstance = process.env.CAPTURO_CAPTURE_ON_START === '1'

if (isSmokeInstance) {
  app.setPath('userData', path.join(app.getPath('temp'), 'capturo-development'))
}

function trayAsset(name: string): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'tray', name)
    : path.join(app.getAppPath(), 'build', 'tray', name)
}

function trayImage(): Electron.NativeImage | string {
  if (!isMac) return trayAsset('tray-win-16.png')
  const image = nativeImage.createFromPath(trayAsset('trayTemplate.png'))
  if (image.isEmpty()) throw new Error('Capturo menu-bar icon could not be loaded')
  image.setTemplateImage(true)
  return image
}

function closeSession(): void {
  const active = session
  session = null
  if (!active) return
  for (const entry of active.overlays.values()) {
    if (!entry.window.isDestroyed()) entry.window.destroy()
  }
}

// The renderer has painted the frozen desktop, so the overlay can become visible.
// The window has been on screen (transparent) since it was created; if its show
// transition has not finished yet, wait out the remainder so the reveal cannot
// expose a half-animated frame.
function revealOverlay(entry: OverlayEntry): void {
  if (entry.revealed || entry.window.isDestroyed()) return
  entry.revealed = true

  const present = (): void => {
    if (entry.window.isDestroyed()) return
    entry.window.setIgnoreMouseEvents(false)
    entry.window.setOpacity(1)
  }

  const remaining = SHOW_TRANSITION_MS - (Date.now() - entry.shownAt)
  if (remaining <= 0) present()
  else setTimeout(present, remaining)
}

function notify(title: string, body: string): void {
  if (Notification.isSupported()) new Notification({ title, body, silent: true }).show()
}

function rendererUrl(): string | null {
  return process.env.ELECTRON_RENDERER_URL ?? null
}

function sourceForDisplay(
  sources: Electron.DesktopCapturerSource[],
  display: Electron.Display,
  displayIndex: number
): Electron.DesktopCapturerSource | undefined {
  return sources.find((source) => source.display_id === String(display.id)) ?? sources[displayIndex]
}

function helperPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'capture', 'capturo-capture.exe')
    : path.join(app.getAppPath(), 'native', 'capturo-capture', 'build', 'capturo-capture.exe')
}

// Captures one display through the native helper.
//
// Chromium's own capture is wrong on an HDR display: it converts to 8-bit without undoing
// the SDR white level, so ordinary window content comes out several times too bright with
// the highlights clipped away. The helper keeps the frame in FP16 scRGB, normalises against
// the live SDR white level, tone maps, and only then encodes sRGB. It also excludes the
// mouse pointer, which the capture stream did not. See D-014.
type HelperCapture = { bytes: Buffer; width: number; height: number }

async function captureWithHelper(display: Electron.Display): Promise<HelperCapture | null> {
  if (process.platform !== 'win32') return null
  const helper = helperPath()
  if (!existsSync(helper)) return null

  // DXGI enumerates outputs in its own order, so the monitor is identified by its physical
  // desktop origin instead. dipToScreenRect performs the per-monitor scaling conversion.
  const physical = screen.dipToScreenRect(null, display.bounds)

  const output = path.join(app.getPath('temp'), `capturo-${randomUUID()}.png`)
  try {
    const report = await new Promise<string>((resolve, reject) => {
      execFile(
        helper,
        ['--output', output, '--origin-x', String(physical.x), '--origin-y', String(physical.y)],
        { timeout: 8000, windowsHide: true },
        (error, stdout) => (error ? reject(error) : resolve(stdout))
      )
    })
    const bytes = await fs.readFile(output)
    // Take the dimensions from the helper rather than re-decoding, so nothing can reinterpret
    // the image at a different scale factor on the way through.
    const parsed = JSON.parse(report.trim()) as { ok: boolean; width: number; height: number }
    if (!parsed.ok || !parsed.width || !parsed.height) return null
    return { bytes, width: parsed.width, height: parsed.height }
  } catch (error) {
    console.error('capturo-capture failed, falling back to desktopCapturer', error)
    return null
  } finally {
    void fs.rm(output, { force: true }).catch(() => {})
  }
}

// The parts of a display the work area does not reach: usually a single taskbar strip,
// but docked bars on any edge are handled. Top and bottom strips span the full width and
// the side strips fill what is left, so the rectangles never overlap.
function uncoveredStrips(bounds: Rect, area: Rect): Rect[] {
  const strips: Rect[] = []
  const areaRight = area.x + area.width
  const areaBottom = area.y + area.height
  const boundsRight = bounds.x + bounds.width
  const boundsBottom = bounds.y + bounds.height

  if (area.y > bounds.y) {
    strips.push({ x: bounds.x, y: bounds.y, width: bounds.width, height: area.y - bounds.y })
  }
  if (areaBottom < boundsBottom) {
    strips.push({ x: bounds.x, y: areaBottom, width: bounds.width, height: boundsBottom - areaBottom })
  }
  if (area.x > bounds.x) {
    strips.push({ x: bounds.x, y: area.y, width: area.x - bounds.x, height: area.height })
  }
  if (areaRight < boundsRight) {
    strips.push({ x: areaRight, y: area.y, width: boundsRight - areaRight, height: area.height })
  }
  return strips.filter((strip) => strip.width > 0 && strip.height > 0)
}

async function ensureScreenPermission(): Promise<boolean> {
  if (!isMac) return true
  const status = systemPreferences.getMediaAccessStatus('screen')
  if (status !== 'denied' && status !== 'restricted') return true

  const result = await dialog.showMessageBox({
    type: 'warning',
    title: 'Screen Recording permission required',
    message: 'Capturo needs Screen Recording access to capture your desktop.',
    detail: 'Enable Capturo in System Settings → Privacy & Security → Screen Recording, then start capture again.',
    buttons: ['Open System Settings', 'Cancel'],
    defaultId: 0,
    cancelId: 1
  })
  if (result.response === 0) {
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
  }
  return false
}

async function startCapture(): Promise<void> {
  if (!(await ensureScreenPermission())) return
  closeSession()

  const displays = screen.getAllDisplays()
  if (displays.length === 0) return

  // desktopCapturer is only the fallback now, so thumbnails are requested at full size for
  // the platforms that still use them.
  const maxWidth = Math.max(...displays.map((d) => Math.ceil(d.size.width * d.scaleFactor)))
  const maxHeight = Math.max(...displays.map((d) => Math.ceil(d.size.height * d.scaleFactor)))
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: maxWidth, height: maxHeight },
    fetchWindowIcons: false
  })

  const nextSession: CaptureSession = { id: randomUUID(), overlays: new Map() }
  session = nextSession

  for (const [index, display] of displays.entries()) {
    const source = sourceForDisplay(sources, display, index)
    if (!source) continue

    const bounds = display.bounds

    // Prefer the native helper; fall back to the thumbnail when it is unavailable, which is
    // every non-Windows platform and any Windows machine where the helper did not ship.
    const helperCapture = await captureWithHelper(display)
    let imageBytes: Uint8Array
    let imageSize: { width: number; height: number }
    if (helperCapture) {
      imageBytes = helperCapture.bytes
      imageSize = { width: helperCapture.width, height: helperCapture.height }
    } else {
      if (source.thumbnail.isEmpty()) continue
      imageBytes = source.thumbnail.toPNG()
      imageSize = source.thumbnail.getSize()
    }

    // One editor over the work area, plus a filler for every strip it leaves uncovered.
    // Together they cover the display, so the taskbar is still part of the capture, while
    // no single window covers the monitor and trips the full-screen classification.
    const regions: { rect: Rect; role: OverlayRole }[] = [
      { rect: display.workArea, role: 'editor' },
      ...uncoveredStrips(bounds, display.workArea).map((rect) => ({ rect, role: 'filler' as const }))
    ]

    for (const region of regions) {
    const area = region.rect
    const payload: CapturePayload = {
      sessionId: nextSession.id,
      displayId: String(display.id),
      role: region.role,
      imageBytes,
      imageWidth: imageSize.width,
      imageHeight: imageSize.height,
      imageOrigin: { x: area.x - bounds.x, y: area.y - bounds.y },
      captureSize: { width: bounds.width, height: bounds.height },
      displayBounds: { ...bounds },
      scaleFactor: display.scaleFactor
    }
    const overlay = new BrowserWindow({
      x: area.x,
      y: area.y,
      width: area.width,
      height: area.height,
      frame: false,
      transparent: false,
      backgroundColor: '#000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false
      }
    })

    overlay.setAlwaysOnTop(true, 'screen-saver')
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

    // Show before loading so the platform's show transition is spent on an invisible
    // window. Until the reveal it must not swallow the pointer events of whatever the
    // user is still working in.
    overlay.setOpacity(0)
    overlay.setIgnoreMouseEvents(true)
    overlay.showInactive()
    const shownAt = Date.now()

    // A window's construction size is only a request; Windows adds frame insets and
    // clamps it, which previously left the viewport a few pixels off the intended area.
    // Re-applying the bounds once the window exists is honoured exactly. This must happen
    // before the renderer loads: the renderer derives source-image pixels from its own
    // viewport, so any mismatch between viewport and frozen image silently rescales the
    // desktop and skews every selection.
    overlay.setBounds(area)

    const webContentsId = overlay.webContents.id
    overlay.on('closed', () => {
      nextSession.overlays.delete(webContentsId)
      if (session === nextSession && nextSession.overlays.size === 0) session = null
    })
    overlay.webContents.on('did-finish-load', () => {
      if (!overlay.isDestroyed() && session === nextSession) {
        overlay.webContents.send('capture:initialize', payload)
      }
    })
    nextSession.overlays.set(webContentsId, { window: overlay, payload, shownAt, revealed: false })

    const devUrl = rendererUrl()
    if (devUrl) await overlay.loadURL(devUrl)
    else await overlay.loadFile(path.join(__dirname, '../renderer/index.html'))
    }
  }

  if (nextSession.overlays.size === 0) {
    closeSession()
    await dialog.showMessageBox({
      type: 'error',
      title: 'Capture unavailable',
      message: 'Capturo could not read an image from the connected display.'
    })
  }
}

function validSession(event: Electron.IpcMainInvokeEvent, sessionId: string): CaptureSession | null {
  if (!session || session.id !== sessionId || !session.overlays.has(event.sender.id)) return null
  return session
}

function imageFromDataUrl(dataUrl: string): Electron.NativeImage | null {
  if (!dataUrl.startsWith('data:image/png;base64,')) return null
  const image = nativeImage.createFromDataURL(dataUrl)
  return image.isEmpty() ? null : image
}

function registerIpc(): void {
  ipcMain.handle('capture:ready', (event, sessionId: string) => {
    const active = validSession(event, sessionId)
    const entry = active?.overlays.get(event.sender.id)
    if (!entry || entry.window.isDestroyed()) return false
    revealOverlay(entry)
    return true
  })

  // Claiming closes the other displays, but not the fillers of the claimed display: those
  // cover its taskbar strip and remain part of the same capture surface.
  ipcMain.handle('capture:claim', (event, sessionId: string) => {
    const active = validSession(event, sessionId)
    const claimed = active?.overlays.get(event.sender.id)
    if (!active || !claimed) return false
    for (const [webContentsId, entry] of active.overlays) {
      const sameDisplay = entry.payload.displayId === claimed.payload.displayId
      if (webContentsId !== event.sender.id && !sameDisplay && !entry.window.isDestroyed()) {
        entry.window.destroy()
      }
    }
    return true
  })

  // The editor owns the scene; fillers repaint from it so their strips shade in step.
  ipcMain.on('capture:scene', (event, sessionId: string, scene: unknown) => {
    if (!session || session.id !== sessionId) return
    const sender = session.overlays.get(event.sender.id)
    if (!sender || sender.payload.role !== 'editor') return
    for (const [webContentsId, entry] of session.overlays) {
      if (webContentsId === event.sender.id) continue
      if (entry.payload.role !== 'filler') continue
      if (entry.payload.displayId !== sender.payload.displayId) continue
      if (!entry.window.isDestroyed()) entry.window.webContents.send('capture:scene', scene)
    }
  })

  ipcMain.handle('capture:cancel', (event, sessionId: string) => {
    if (validSession(event, sessionId)) closeSession()
  })

  // A renderer could not open its capture stream. Tear the session down rather than
  // leaving an invisible overlay holding the pointer.
  ipcMain.handle('capture:failed', (event, sessionId: string) => {
    if (!validSession(event, sessionId)) return
    closeSession()
    notify('Capture unavailable', 'Capturo could not read an image from the display.')
  })

  ipcMain.handle('capture:copy', (event, sessionId: string, dataUrl: string) => {
    if (!validSession(event, sessionId)) return false
    const image = imageFromDataUrl(dataUrl)
    if (!image) return false
    clipboard.writeImage(image)
    closeSession()
    notify('Copied to clipboard', 'Your screenshot is ready to paste.')
    return true
  })

  ipcMain.handle(
    'capture:save',
    async (event, sessionId: string, dataUrl: string): Promise<SaveResult> => {
      const active = validSession(event, sessionId)
      const image = imageFromDataUrl(dataUrl)
      if (!active || !image) return { saved: false, canceled: false }
      const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined
      const now = new Date()
      const stamp = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
        '-',
        String(now.getHours()).padStart(2, '0'),
        String(now.getMinutes()).padStart(2, '0'),
        String(now.getSeconds()).padStart(2, '0')
      ].join('')
      const options: Electron.SaveDialogOptions = {
        title: 'Save screenshot',
        defaultPath: path.join(app.getPath('pictures'), `Capturo ${stamp}.png`),
        filters: [{ name: 'PNG image', extensions: ['png'] }]
      }
      const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return { saved: false, canceled: true }
      await fs.writeFile(result.filePath, image.toPNG())
      closeSession()
      notify('Screenshot saved', path.basename(result.filePath))
      return { saved: true, canceled: false, filePath: result.filePath }
    }
  )
}

function createTray(): void {
  // The running build must be identifiable without inspecting files on disk, so the
  // version appears both on hover and in the menu.
  const version = app.getVersion()
  tray = new Tray(trayImage())
  tray.setToolTip(`Capturo ${version} - take a screenshot`)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'New screenshot', accelerator: 'CommandOrControl+Shift+2', click: () => void startCapture() },
      { type: 'separator' },
      { label: `Version ${version}`, enabled: false },
      { label: 'Quit Capturo', click: () => { isQuitting = true; app.quit() } }
    ])
  )
  tray.on('click', () => void startCapture())
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => void startCapture())
  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('com.capturo.app')
    if (isMac) app.dock?.hide()
    registerIpc()
    createTray()
    globalShortcut.register('CommandOrControl+Shift+2', () => void startCapture())
    if (isSmokeInstance) void startCapture()
  })
  app.on('activate', () => void startCapture())
  app.on('window-all-closed', () => {
    // Capturo remains resident in the tray/menu bar.
  })
  app.on('before-quit', () => {
    isQuitting = true
    closeSession()
    globalShortcut.unregisterAll()
  })
  app.on('will-quit', () => {
    if (!isQuitting) globalShortcut.unregisterAll()
  })
}
