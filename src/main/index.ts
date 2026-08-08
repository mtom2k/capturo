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
import { DEFAULT_CAPTURE_SHORTCUT, type CaptureSettings, type SettingsUpdateResult } from '../shared/settings'
import { formatAccelerator } from '../shared/shortcut'
import { uncoveredStrips } from '../shared/geometry'
import { getSettings, loadSettings, updateSettings } from './settings'

type OverlayEntry = {
  window: BrowserWindow
  payload: CapturePayload
  revealed: boolean
}

// The frozen desktop for one display, ready to hand to its overlays.
type DisplayImage = { bytes: Uint8Array; width: number; height: number }

type CaptureSession = {
  id: string
  overlays: Map<number, OverlayEntry>
}

let tray: Tray | null = null
let session: CaptureSession | null = null
let settingsWindow: BrowserWindow | null = null
// The capture shortcut currently registered with the OS. Tracked so a rebind can cleanly
// unregister the old accelerator and roll back to it if the new one is rejected.
let activeShortcut: string | null = null
let isQuitting = false

const isMac = process.platform === 'darwin'
const isSmokeInstance = process.env.CAPTURO_CAPTURE_ON_START === '1'
// Opt-in phase timings for the capture path, printed to stderr. Off by default so normal
// runs stay quiet; used to measure the invocation latency end to end.
const timingEnabled = process.env.CAPTURO_TIMING === '1'

function logTiming(message: string): void {
  if (timingEnabled) console.error(`[timing] ${message}`)
}

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

// The renderer has painted the frozen desktop, so the overlay can be revealed. The window
// has been on screen but fully transparent since it was created, so this is an immediate
// opacity change onto an already-painted frame: no black flash (D-010), and with the sizing
// frame gone (thickFrame:false) no window-open animation to wait out (D-011). It is revealed
// the instant it is ready, with no artificial delay.
function revealOverlay(entry: OverlayEntry): void {
  if (entry.revealed || entry.window.isDestroyed()) return
  entry.revealed = true
  entry.window.setIgnoreMouseEvents(false)
  entry.window.setOpacity(1)
}

function notify(title: string, body: string): void {
  if (!getSettings().capture.showNotification) return
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
  const started = performance.now()
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
    const parsed = JSON.parse(report.trim()) as {
      ok: boolean
      width: number
      height: number
      timings?: Record<string, number>
    }
    if (!parsed.ok || !parsed.width || !parsed.height) return null
    if (timingEnabled) {
      const stages = parsed.timings
        ? ` [${Object.entries(parsed.timings).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', ')}]`
        : ''
      logTiming(`helper display ${display.id}: ${(performance.now() - started).toFixed(0)}ms total${stages}`)
    }
    return { bytes, width: parsed.width, height: parsed.height }
  } catch (error) {
    console.error('capturo-capture failed, falling back to desktopCapturer', error)
    return null
  } finally {
    void fs.rm(output, { force: true }).catch(() => {})
  }
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

async function captureSources(
  displays: Electron.Display[],
  sizingDisplays: Electron.Display[] = displays
): Promise<Electron.DesktopCapturerSource[]> {
  // getSources returns every screen, but the thumbnail size only needs to fit the displays
  // that will actually use the fallback (the others are served by the helper and discarded
  // here). Sizing to just those keeps the grab from paying for a 4K thumbnail of a screen it
  // will throw away.
  const sized = sizingDisplays.length > 0 ? sizingDisplays : displays
  const maxWidth = Math.max(...sized.map((d) => Math.ceil(d.size.width * d.scaleFactor)))
  const maxHeight = Math.max(...sized.map((d) => Math.ceil(d.size.height * d.scaleFactor)))
  return desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: maxWidth, height: maxHeight },
    fetchWindowIcons: false
  })
}

function imageFromSource(source: Electron.DesktopCapturerSource | undefined): DisplayImage | null {
  if (!source || source.thumbnail.isEmpty()) return null
  const size = source.thumbnail.getSize()
  return { bytes: source.thumbnail.toPNG(), width: size.width, height: size.height }
}

// One editor over the work area, plus a filler for every strip it leaves uncovered. Together
// they cover the display so the taskbar is still part of the capture, while no single window
// covers the monitor and trips the full-screen classification. See D-013.
function overlayRegions(display: Electron.Display): { rect: Rect; role: OverlayRole }[] {
  return [
    { rect: display.workArea, role: 'editor' },
    ...uncoveredStrips(display.bounds, display.workArea).map((rect) => ({ rect, role: 'filler' as const }))
  ]
}

function buildPayload(
  sessionId: string,
  display: Electron.Display,
  region: { rect: Rect; role: OverlayRole },
  image: DisplayImage
): CapturePayload {
  const bounds = display.bounds
  const area = region.rect
  return {
    sessionId,
    displayId: String(display.id),
    role: region.role,
    imageBytes: image.bytes,
    imageWidth: image.width,
    imageHeight: image.height,
    imageOrigin: { x: area.x - bounds.x, y: area.y - bounds.y },
    captureSize: { width: bounds.width, height: bounds.height }
  }
}

function createOverlayWindow(area: Rect): BrowserWindow {
  const overlay = new BrowserWindow({
    x: area.x,
    y: area.y,
    width: area.width,
    height: area.height,
    frame: false,
    // A frameless window keeps WS_THICKFRAME by default, and Windows 11 draws a 1px DWM
    // border around any window that has it. Because a display is tiled into several overlays
    // (D-013), that border appears at every window edge: a hairline around the screen and,
    // doubled, along the editor/taskbar seam. Dropping WS_THICKFRAME removes it. The window
    // is not resizable, so the sizing frame is not wanted anyway, and this also suppresses
    // the platform's open animation, which is why the reveal no longer waits one out (D-011).
    thickFrame: false,
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

  // Show fully transparent right away so the window paints while invisible and cannot swallow
  // pointer events meant for whatever the user is still working in. capture:ready later raises
  // the opacity. See D-011.
  overlay.setOpacity(0)
  overlay.setIgnoreMouseEvents(true)
  overlay.showInactive()

  // A window's construction size is only a request; Windows adds frame insets and clamps it,
  // which previously left the viewport a few pixels off the intended area. Re-applying the
  // bounds once the window exists is honoured exactly, and must happen before the renderer
  // loads: the renderer derives source-image pixels from its own viewport, so any mismatch
  // silently rescales the desktop and skews every selection. See D-012.
  overlay.setBounds(area)
  return overlay
}

// Creates one overlay window for a region and loads the renderer into it. Resolves once the
// renderer has loaded; the caller awaits all overlays together so they load concurrently.
async function spawnOverlay(
  owner: CaptureSession,
  display: Electron.Display,
  region: { rect: Rect; role: OverlayRole },
  image: DisplayImage
): Promise<void> {
  const payload = buildPayload(owner.id, display, region, image)
  const overlay = createOverlayWindow(region.rect)

  const webContentsId = overlay.webContents.id
  overlay.on('closed', () => {
    owner.overlays.delete(webContentsId)
    if (session === owner && owner.overlays.size === 0) session = null
  })
  overlay.webContents.on('did-finish-load', () => {
    if (!overlay.isDestroyed() && session === owner) {
      overlay.webContents.send('capture:initialize', payload)
    }
  })
  owner.overlays.set(webContentsId, { window: overlay, payload, revealed: false })

  const devUrl = rendererUrl()
  if (devUrl) await overlay.loadURL(devUrl)
  else await overlay.loadFile(path.join(__dirname, '../renderer/index.html'))
}

async function startCapture(): Promise<void> {
  if (!(await ensureScreenPermission())) return
  closeSession()

  const displays = screen.getAllDisplays()
  if (displays.length === 0) return

  const started = performance.now()

  // The native helper serves the frame on Windows; desktopCapturer is only the fallback for
  // other platforms or a Windows machine where the helper did not ship. Its thumbnails are
  // full-resolution grabs of every screen, so they are fetched only when actually needed.
  const helperReady = process.platform === 'win32' && existsSync(helperPath())

  // Grab every display through the native helper, in parallel. It handles rotated displays
  // now too (see D-015), so desktopCapturer is only the fallback for platforms without the
  // helper or the rare display it cannot serve. Grabbing every screen that way is expensive,
  // so it is fetched once, afterwards, and sized only to the displays that came back empty.
  const images: (DisplayImage | null)[] = helperReady
    ? await Promise.all(displays.map(async (display) => (await captureWithHelper(display)) as DisplayImage | null))
    : displays.map(() => null)

  const missing = displays.filter((_display, index) => !images[index])
  if (missing.length > 0) {
    const sources = await captureSources(displays, missing)
    displays.forEach((display, index) => {
      if (!images[index]) images[index] = imageFromSource(sourceForDisplay(sources, display, index))
    })
  }
  logTiming(`frames captured in ${(performance.now() - started).toFixed(0)}ms`)

  const nextSession: CaptureSession = { id: randomUUID(), overlays: new Map() }
  session = nextSession

  const loads: Promise<void>[] = []
  displays.forEach((display, index) => {
    const image = images[index]
    if (!image) return
    for (const region of overlayRegions(display)) loads.push(spawnOverlay(nextSession, display, region, image))
  })
  await Promise.all(loads)

  if (nextSession.overlays.size === 0) {
    closeSession()
    await dialog.showMessageBox({
      type: 'error',
      title: 'Capture unavailable',
      message: 'Capturo could not read an image from the connected display.'
    })
    return
  }
  logTiming(`${nextSession.overlays.size} overlays loaded in ${(performance.now() - started).toFixed(0)}ms`)
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

// Format and quality apply to saved files only; the clipboard always gets a lossless
// bitmap (see D-016). The renderer hands over a lossless PNG data URL regardless, and the
// on-disk encoding is chosen here. The user can override the extension in the save dialog,
// so an explicit .jpg/.jpeg or .png on the chosen path wins over the stored format.
function encodeCapture(image: Electron.NativeImage, filePath: string, settings: CaptureSettings): Buffer {
  const extension = path.extname(filePath).toLowerCase()
  const asJpeg =
    extension === '.jpg' ||
    extension === '.jpeg' ||
    (extension !== '.png' && settings.format === 'jpeg')
  return asJpeg ? image.toJPEG(settings.jpegQuality) : image.toPNG()
}

function registerIpc(): void {
  ipcMain.handle('settings:get', () => getSettings())

  // A settings change is persisted immediately. A shortcut change additionally re-registers
  // the global accelerator; if the OS rejects the new one, the stored shortcut and the live
  // registration are both rolled back to the previous working value and the reason is
  // returned so the settings window can show it.
  ipcMain.handle('settings:update', (_event, update: Partial<CaptureSettings>): SettingsUpdateResult => {
    const previousShortcut = getSettings().capture.captureShortcut
    let next = updateSettings(update)
    let shortcutError: string | undefined

    if (next.capture.captureShortcut !== previousShortcut) {
      if (applyShortcut(next.capture.captureShortcut)) {
        refreshTray()
      } else {
        next = updateSettings({ captureShortcut: previousShortcut })
        shortcutError = `${formatAccelerator(update.captureShortcut ?? '', isMac)} is unavailable. Kept ${formatAccelerator(previousShortcut, isMac)}.`
      }
    }
    return { settings: next, shortcutError }
  })

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
      const settings = getSettings().capture
      const jpeg = settings.format === 'jpeg'
      const options: Electron.SaveDialogOptions = {
        title: 'Save screenshot',
        defaultPath: path.join(app.getPath('pictures'), `Capturo ${stamp}.${jpeg ? 'jpg' : 'png'}`),
        filters: jpeg
          ? [{ name: 'JPEG image', extensions: ['jpg', 'jpeg'] }, { name: 'PNG image', extensions: ['png'] }]
          : [{ name: 'PNG image', extensions: ['png'] }, { name: 'JPEG image', extensions: ['jpg', 'jpeg'] }]
      }
      const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return { saved: false, canceled: true }
      await fs.writeFile(result.filePath, encodeCapture(image, result.filePath, settings))
      closeSession()
      notify('Screenshot saved', path.basename(result.filePath))
      return { saved: true, canceled: false, filePath: result.filePath }
    }
  )
}

// Registers a capture accelerator with the OS, replacing whatever is currently bound. On
// failure the previous accelerator is put back so a rejected rebind never leaves the app
// with no working shortcut. Returns whether the requested accelerator took effect.
function applyShortcut(accelerator: string): boolean {
  if (activeShortcut) globalShortcut.unregister(activeShortcut)
  let registered = false
  try {
    registered = globalShortcut.register(accelerator, () => void startCapture())
  } catch {
    // Electron throws rather than returning false for a syntactically invalid accelerator.
    registered = false
  }
  if (registered) {
    activeShortcut = accelerator
    return true
  }
  if (activeShortcut) {
    try {
      globalShortcut.register(activeShortcut, () => void startCapture())
    } catch {
      // The previous accelerator was valid a moment ago; nothing more to do if it now fails.
    }
  }
  return false
}

// At startup, bind the saved shortcut. If it is unavailable (taken by another app since it
// was chosen), fall back to the default and persist that so the tray label stays truthful.
function registerInitialShortcut(): void {
  const configured = getSettings().capture.captureShortcut
  if (applyShortcut(configured)) return
  if (configured !== DEFAULT_CAPTURE_SHORTCUT && applyShortcut(DEFAULT_CAPTURE_SHORTCUT)) {
    updateSettings({ captureShortcut: DEFAULT_CAPTURE_SHORTCUT })
  }
}

// The tray tooltip and menu both surface the version and the live capture shortcut, so the
// running build and its binding can be read without opening anything.
function refreshTray(): void {
  if (!tray) return
  const version = app.getVersion()
  const shortcut = getSettings().capture.captureShortcut
  tray.setToolTip(`Capturo ${version} — ${formatAccelerator(shortcut, isMac)} to capture`)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'New screenshot', accelerator: shortcut, click: () => void startCapture() },
      { label: 'Settings…', click: () => openSettings() },
      { type: 'separator' },
      { label: `Version ${version}`, enabled: false },
      { label: 'Quit Capturo', click: () => { isQuitting = true; app.quit() } }
    ])
  )
}

function createTray(): void {
  tray = new Tray(trayImage())
  refreshTray()
  tray.on('click', () => void startCapture())
}

// A small, framed, on-demand preferences window. Reused if already open. It is not a
// resident surface: closing it destroys it and the app stays tray-only. See D-016.
function openSettings(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) settingsWindow.restore()
    settingsWindow.show()
    settingsWindow.focus()
    return
  }

  const window = new BrowserWindow({
    width: 460,
    height: 452,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Capturo Settings',
    backgroundColor: '#050910',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  settingsWindow = window
  window.on('closed', () => {
    if (settingsWindow === window) settingsWindow = null
  })
  window.once('ready-to-show', () => window.show())

  const devUrl = rendererUrl()
  if (devUrl) void window.loadURL(`${devUrl}/settings.html`)
  else void window.loadFile(path.join(__dirname, '../renderer/settings.html'))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => void startCapture())
  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('com.capturo.app')
    if (isMac) app.dock?.hide()
    loadSettings()
    registerIpc()
    registerInitialShortcut()
    createTray()
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
