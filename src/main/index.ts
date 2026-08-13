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
  session as electronSession,
  shell,
  systemPreferences,
  Tray
} from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { CapturePayload, OverlayRole, Point, Rect, SaveResult } from '../shared/types'
import {
  DEFAULT_CAPTURE_SHORTCUT,
  DEFAULT_GIF_SHORTCUT,
  type CaptureSettings,
  type SettingsUpdate,
  type SettingsUpdateResult
} from '../shared/settings'
import { formatAccelerator } from '../shared/shortcut'
import type { CropRect, GifRecordPayload, GifSaveResult } from '../shared/gif'
import { integerRect, surroundingStrips, uncoveredStrips } from '../shared/geometry'
import { getSettings, loadSettings, updateSettings } from './settings'
import {
  captureDisplays,
  helperAvailable,
  startCaptureHelper,
  stopCaptureHelper,
  suppressWindowBorder
} from './capture-helper'

type OverlayEntry = {
  window: BrowserWindow
  payload: CapturePayload
  revealed: boolean
}

// The frozen desktop for one display, ready to hand to its overlays.
type DisplayImage = { bytes: Uint8Array; width: number; height: number }

// A screenshot capture and a GIF capture share the same region-selection overlays; the mode
// decides which renderer they load and what happens once a region is chosen.
type CaptureMode = 'screenshot' | 'gif'

// The two global shortcuts Capturo registers.
type ShortcutKind = 'capture' | 'gif'

type CaptureSession = {
  id: string
  mode: CaptureMode
  overlays: Map<number, OverlayEntry>
}

let tray: Tray | null = null
let session: CaptureSession | null = null
let settingsWindow: BrowserWindow | null = null
// The GIF recording control window, plus which display it records and how. The display id
// drives setDisplayMediaRequestHandler so the renderer's getDisplayMedia targets it.
let recordingWindow: BrowserWindow | null = null
// A click-through, content-protected ring drawn around the region while recording, plus dim
// strips shading everything outside it to emphasize what is being captured.
let recordingBorderWindow: BrowserWindow | null = null
let recordingShadeWindows: BrowserWindow[] = []
let recordingTargetDisplayId: string | null = null
let recordingPayload: GifRecordPayload | null = null
// The accelerators currently registered with the OS, per action. Tracked so a rebind can
// cleanly unregister the old one and roll back to it if the new one is rejected.
const activeShortcuts: Partial<Record<ShortcutKind, string>> = {}
let isQuitting = false

const isMac = process.platform === 'darwin'
const isSmokeInstance = process.env.CAPTURO_CAPTURE_ON_START === '1'
const isGifSmokeInstance = process.env.CAPTURO_GIF_ON_START === '1'
const isSettingsSmokeInstance = process.env.CAPTURO_SETTINGS_ON_START === '1'
// Opens a recording of a fixed centre region directly (no selection UI), for smoke-testing
// the record → encode → save pipeline.
const isGifRecordSmoke = process.env.CAPTURO_GIF_RECORD_SMOKE === '1'
// Opt-in phase timings for the capture path, printed to stderr. Off by default so normal
// runs stay quiet; used to measure the invocation latency end to end.
const timingEnabled = process.env.CAPTURO_TIMING === '1'

function logTiming(message: string): void {
  if (timingEnabled) console.error(`[timing] ${message}`)
}

if (isSmokeInstance || isGifSmokeInstance || isGifRecordSmoke || isSettingsSmokeInstance) {
  app.setPath('userData', path.join(app.getPath('temp'), 'capturo-development'))
}

function trayAsset(name: string): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'tray', name)
    : path.join(app.getAppPath(), 'build', 'tray', name)
}

function trayImage(): Electron.NativeImage | string {
  return trayAsset('tray-icon.png')
}

function taskbarIcon(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'taskbar-icon.png')
    : path.join(app.getAppPath(), 'build', 'taskbar-icon.png')
}

// Login-item registration is a privileged OS integration, so it stays in the main process.
// Development runs deliberately do not register Electron itself as a startup application.
function applyOpenAtStartup(enabled: boolean): boolean {
  if (!app.isPackaged) return true
  if (process.platform !== 'win32' && process.platform !== 'darwin') return false
  try {
    if (process.platform === 'win32') {
      // electron-builder's portable target runs the inner app from a temporary directory.
      // Register the stable outer executable when that path is available.
      const executablePath = process.env.PORTABLE_EXECUTABLE_FILE ?? process.execPath
      app.setLoginItemSettings({ openAtLogin: enabled, path: executablePath })
      return app.getLoginItemSettings({ path: executablePath }).openAtLogin === enabled
    }
    app.setLoginItemSettings({ openAtLogin: enabled })
    return app.getLoginItemSettings().openAtLogin === enabled
  } catch (error) {
    console.error('Could not update open-on-startup setting', error)
    return false
  }
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
  // The overlay was shown with showInactive() (D-011), so it holds no keyboard focus until the
  // user's first click. Without focus the renderer's window 'keydown' never fires, so Escape did
  // nothing until a region drag had begun. Now that the editor is painted and interactive, give
  // it focus so Escape cancels from the moment the frozen desktop appears. Only the editor takes
  // input; fillers are left unfocused so they never steal it from the editor.
  if (entry.payload.role === 'editor') entry.window.focus()
}

function notify(title: string, body: string): void {
  if (!getSettings().capture.showNotification) return
  if (Notification.isSupported()) new Notification({ title, body, silent: true, icon: taskbarIcon() }).show()
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

// Captures displays through the persistent native helper (see capture-helper.ts). It keeps
// the frame in FP16 scRGB, normalises against the live SDR white level, tone maps, turns a
// rotated surface back to the desktop orientation, and only then encodes sRGB — none of which
// Chromium's own 8-bit capture does correctly on an HDR display. It also excludes the mouse
// pointer. See D-014, D-015, D-017. Returns one DisplayImage per display, null where the
// helper could not serve it (the caller falls back to desktopCapturer for those).
async function captureWithHelper(displays: Electron.Display[]): Promise<(DisplayImage | null)[]> {
  if (!helperAvailable()) return displays.map(() => null)

  // DXGI enumerates outputs in its own order, so each monitor is identified by its physical
  // desktop origin. dipToScreenRect performs the per-monitor scaling conversion.
  const outputs = displays.map(() => path.join(app.getPath('temp'), `capturo-${randomUUID()}.png`))
  const requests = displays.map((display, index) => {
    const physical = screen.dipToScreenRect(null, display.bounds)
    return { originX: physical.x, originY: physical.y, output: outputs[index] }
  })

  let results: Awaited<ReturnType<typeof captureDisplays>> = []
  try {
    results = await captureDisplays(requests)
  } catch (error) {
    console.error('capture helper failed, falling back to desktopCapturer', error)
  }

  const images = await Promise.all(
    displays.map(async (_display, index) => {
      const result = results[index]
      if (!result?.ok || !result.width || !result.height) return null
      try {
        // Trust the helper's reported dimensions rather than re-decoding, so nothing can
        // reinterpret the image at a different scale factor on the way through.
        const bytes = await fs.readFile(outputs[index])
        return { bytes, width: result.width, height: result.height } as DisplayImage
      } catch {
        return null
      }
    })
  )

  for (const output of outputs) void fs.rm(output, { force: true }).catch(() => {})
  if (timingEnabled) {
    results.forEach((result, index) => {
      if (!result?.timings) return
      const stages = Object.entries(result.timings).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', ')
      logTiming(`helper display ${displays[index].id}: [${stages}]`)
    })
  }
  return images
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
function overlayHtml(mode: CaptureMode): string {
  return mode === 'gif' ? 'gif.html' : 'index.html'
}

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
  const html = overlayHtml(owner.mode)
  if (devUrl) await overlay.loadURL(owner.mode === 'gif' ? `${devUrl}/${html}` : devUrl)
  else await overlay.loadFile(path.join(__dirname, `../renderer/${html}`))
}

// Opens the region-selection overlays for a screenshot or a GIF. Both freeze the desktop the
// same way and reuse the same selection UI; the mode picks which renderer loads and what
// happens after a region is chosen (screenshot exports; GIF starts recording).
async function openSelectionOverlays(mode: CaptureMode): Promise<void> {
  if (!(await ensureScreenPermission())) return
  closeSession()

  const displays = screen.getAllDisplays()
  if (displays.length === 0) return

  const started = performance.now()

  // The persistent native helper serves the frame on Windows, handling rotated and HDR
  // displays. desktopCapturer is only the fallback for platforms without the helper or the
  // rare display it cannot serve; grabbing every screen that way is expensive, so it is
  // fetched once, afterwards, and sized only to the displays that came back empty.
  const images = await captureWithHelper(displays)

  const missing = displays.filter((_display, index) => !images[index])
  if (missing.length > 0) {
    const sources = await captureSources(displays, missing)
    displays.forEach((display, index) => {
      if (!images[index]) images[index] = imageFromSource(sourceForDisplay(sources, display, index))
    })
  }
  logTiming(`frames captured in ${(performance.now() - started).toFixed(0)}ms`)

  const nextSession: CaptureSession = { id: randomUUID(), mode, overlays: new Map() }
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

function startCapture(): Promise<void> {
  return openSelectionOverlays('screenshot')
}

function startGifCapture(): Promise<void> {
  return openSelectionOverlays('gif')
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
// A filename-safe local timestamp, e.g. 20260808-131500, shared by screenshot and GIF saves.
function fileTimestamp(): string {
  const now = new Date()
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0')
  ].join('')
}

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
  ipcMain.handle('settings:update', (_event, update: SettingsUpdate): SettingsUpdateResult => {
    const before = getSettings()
    let next = updateSettings(update)
    let shortcutError: string | undefined
    let startupError: string | undefined

    if (next.global.openAtStartup !== before.global.openAtStartup &&
        !applyOpenAtStartup(next.global.openAtStartup)) {
      next = updateSettings({ global: { openAtStartup: before.global.openAtStartup } })
      startupError = `Could not ${update.global?.openAtStartup ? 'enable' : 'disable'} Open on startup. Kept the previous setting.`
    }

    if (next.capture.captureShortcut !== before.capture.captureShortcut &&
        !applyShortcut('capture', next.capture.captureShortcut)) {
      next = updateSettings({ capture: { captureShortcut: before.capture.captureShortcut } })
      shortcutError = `${formatAccelerator(update.capture?.captureShortcut ?? '', isMac)} is unavailable. Kept ${formatAccelerator(before.capture.captureShortcut, isMac)}.`
    }
    if (next.gif.shortcut !== before.gif.shortcut && !applyShortcut('gif', next.gif.shortcut)) {
      next = updateSettings({ gif: { shortcut: before.gif.shortcut } })
      shortcutError = `${formatAccelerator(update.gif?.shortcut ?? '', isMac)} is unavailable. Kept ${formatAccelerator(before.gif.shortcut, isMac)}.`
    }
    refreshTray()
    return { settings: next, shortcutError, startupError }
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

  // The GIF selection overlay has a region and the user pressed Start Recording. Tear down
  // the selection overlays and open the recording control window over the chosen display; it
  // captures the live region and encodes it. The region arrives in the frozen image's pixels,
  // converted to a resolution-independent fractional crop for the live stream.
  ipcMain.handle('gif:start', (event, sessionId: string, region: Rect) => {
    const active = validSession(event, sessionId)
    if (!active || active.mode !== 'gif') return false
    const entry = active.overlays.get(event.sender.id)
    if (!entry) return false
    const display = screen.getAllDisplays().find((d) => String(d.id) === entry.payload.displayId)
    if (!display) return false

    const { imageWidth, imageHeight } = entry.payload
    const crop = {
      x: region.x / imageWidth,
      y: region.y / imageHeight,
      width: region.width / imageWidth,
      height: region.height / imageHeight
    }
    const gif = getSettings().gif
    closeSession()
    openRecordingWindow(display, {
      crop,
      fps: gif.fps,
      quality: gif.quality,
      preTimerSeconds: gif.preTimerSeconds,
      showFrameCount: gif.showFrameCount
    })
    return true
  })

  // The recording window finished encoding and sent the GIF bytes. Save via a native dialog.
  ipcMain.handle('gif:save', async (event, bytes: ArrayBuffer): Promise<GifSaveResult> => {
    if (!recordingWindow || event.sender.id !== recordingWindow.webContents.id) return { saved: false, canceled: false }
    // Smoke path: write to a fixed file and log it, so the record→encode→save pipeline can be
    // exercised without the save dialog.
    if (isGifRecordSmoke) {
      const smokePath = path.join(app.getPath('temp'), 'capturo-smoke.gif')
      await fs.writeFile(smokePath, Buffer.from(bytes))
      console.error(`[gif-smoke] saved ${bytes.byteLength} bytes to ${smokePath}`)
      closeRecording()
      return { saved: true, canceled: false, filePath: smokePath }
    }
    const options: Electron.SaveDialogOptions = {
      title: 'Save GIF',
      defaultPath: path.join(app.getPath('pictures'), `Capturo ${fileTimestamp()}.gif`),
      filters: [{ name: 'GIF image', extensions: ['gif'] }]
    }
    const result = await dialog.showSaveDialog(recordingWindow, options)
    if (result.canceled || !result.filePath) {
      closeRecording()
      return { saved: false, canceled: true }
    }
    await fs.writeFile(result.filePath, Buffer.from(bytes))
    closeRecording()
    notify('GIF saved', path.basename(result.filePath))
    return { saved: true, canceled: false, filePath: result.filePath }
  })

  ipcMain.handle('gif:cancel', (event) => {
    if (recordingWindow && event.sender.id === recordingWindow.webContents.id) {
      if (isGifRecordSmoke) console.error('[gif-smoke] recording canceled (no frames or getDisplayMedia failed)')
      closeRecording()
    }
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
    async (event, sessionId: string, dataUrl: string, forcePng = false): Promise<SaveResult> => {
      const active = validSession(event, sessionId)
      const image = imageFromDataUrl(dataUrl)
      if (!active || !image) return { saved: false, canceled: false }
      const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined
      const stamp = fileTimestamp()
      const settings = getSettings().capture
      const jpeg = !forcePng && settings.format === 'jpeg'
      const options: Electron.SaveDialogOptions = {
        title: forcePng ? 'Save transparent screenshot as PNG' : 'Save screenshot',
        defaultPath: path.join(app.getPath('pictures'), `Capturo ${stamp}.${jpeg ? 'jpg' : 'png'}`),
        filters: forcePng
          ? [{ name: 'PNG image with transparency', extensions: ['png'] }]
          : jpeg
          ? [{ name: 'JPEG image', extensions: ['jpg', 'jpeg'] }, { name: 'PNG image', extensions: ['png'] }]
          : [{ name: 'PNG image', extensions: ['png'] }, { name: 'JPEG image', extensions: ['jpg', 'jpeg'] }]
      }
      const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return { saved: false, canceled: true }
      const chosenPath = forcePng
        ? (path.extname(result.filePath).toLowerCase() === '.png'
            ? result.filePath
            : `${result.filePath.slice(0, result.filePath.length - path.extname(result.filePath).length)}.png`)
        : result.filePath
      await fs.writeFile(chosenPath, forcePng ? image.toPNG() : encodeCapture(image, chosenPath, settings))
      closeSession()
      notify('Screenshot saved', path.basename(chosenPath))
      return { saved: true, canceled: false, filePath: chosenPath }
    }
  )
}

function closeRecording(): void {
  const window = recordingWindow
  const border = recordingBorderWindow
  const shade = recordingShadeWindows
  recordingWindow = null
  recordingBorderWindow = null
  recordingShadeWindows = []
  recordingTargetDisplayId = null
  recordingPayload = null
  if (window && !window.isDestroyed()) window.destroy()
  if (border && !border.isDestroyed()) border.destroy()
  for (const strip of shade) if (!strip.isDestroyed()) strip.destroy()
}

function nativeWindowHandle(window: BrowserWindow): bigint | null {
  const handle = window.getNativeWindowHandle()
  if (handle.length >= 8) return handle.readBigUInt64LE(0)
  if (handle.length >= 4) return BigInt(handle.readUInt32LE(0))
  return null
}

// Content-protected windows are intentionally invisible to screenshot tools, but DWM can
// still draw a visible system border around them on Windows 11. Remove that border after the
// renderer is ready and before the window is first shown. See D-021.
async function prepareRecordingChrome(window: BrowserWindow): Promise<void> {
  if (process.platform !== 'win32' || window.isDestroyed()) return
  const handle = nativeWindowHandle(window)
  if (handle !== null && !(await suppressWindowBorder(handle))) {
    console.error('[recording-chrome] Windows DWM border suppression failed')
  }
}

// A tiny transparent, click-through, content-protected window filling a rectangle. Used both
// for the shade strips and (with a border) is close to the ring window. Loads inline HTML so
// no renderer entry is needed; no preload since it is purely visual.
function createChromeWindow(rect: Rect, bodyStyle: string): BrowserWindow {
  const bounds = integerRect(rect)
  const window = new BrowserWindow({
    ...bounds,
    frame: false,
    thickFrame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    focusable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  // BrowserWindow construction may expand a transparent frameless window on Windows. Reapply
  // the requested outer bounds so adjacent shade strips and the selection ring remain exact.
  window.setBounds(bounds)
  window.setAlwaysOnTop(true, 'screen-saver')
  window.setContentProtection(true)
  window.setIgnoreMouseEvents(true)
  const html = `<!doctype html><html><body style="margin:0;${bodyStyle}"></body></html>`
  void window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  window.once('ready-to-show', () => {
    void prepareRecordingChrome(window).finally(() => {
      if (!window.isDestroyed()) window.showInactive()
      // Shade and ring renderers become ready independently. Whichever one shows last must not
      // cover the ring where their edges meet, so reassert its z-order after every chrome show.
      const border = recordingBorderWindow
      if (border && !border.isDestroyed() && border.isVisible()) border.moveTop()
    })
  })
  return window
}

// Dims everything on the display outside the region. Tiled into strips (never one full-monitor
// window) so it does not trip the full-screen classification that switches on Do Not Disturb,
// the same reason the screenshot overlay tiles (D-013).
function createShadeWindows(display: Electron.Display, region: Rect): BrowserWindow[] {
  return surroundingStrips(display.bounds, region).map((strip) =>
    createChromeWindow(strip, 'background:rgba(5,9,16,0.5)')
  )
}

// The recorded region in the display's DIP coordinates, from the resolution-independent crop.
function regionInDip(display: Electron.Display, crop: CropRect): Rect {
  const bounds = display.bounds
  return {
    x: bounds.x + crop.x * bounds.width,
    y: bounds.y + crop.y * bounds.height,
    width: crop.width * bounds.width,
    height: crop.height * bounds.height
  }
}

// Puts the control bar just above the region, else just below, else inside its top edge —
// always horizontally centred on the region and kept on the display.
function placeControlBar(display: Electron.Display, region: Rect, width: number, height: number): Point {
  const bounds = display.bounds
  const margin = 8
  const x = Math.round(
    Math.max(bounds.x + margin, Math.min(bounds.x + bounds.width - width - margin, region.x + region.width / 2 - width / 2))
  )
  const above = region.y - height - margin
  if (above >= bounds.y + margin) return { x, y: Math.round(above) }
  const below = region.y + region.height + margin
  if (below + height <= bounds.y + bounds.height - margin) return { x, y: Math.round(below) }
  return { x, y: Math.round(Math.min(region.y + margin, bounds.y + bounds.height - height - margin)) }
}

// A thin red ring around the region. Transparent centre, click-through, content-protected, so
// it frames the recording for the user without appearing in it.
function createBorderWindow(region: Rect): BrowserWindow {
  const pad = 3
  return createChromeWindow(
    { x: region.x - pad, y: region.y - pad, width: region.width + pad * 2, height: region.height + pad * 2 },
    `height:100vh;box-sizing:border-box;border:${pad}px solid #ef4444`
  )
}

// The GIF recording control bar: a small always-on-top window over the recorded display, next
// to the region. It is content-protected so it is excluded from the capture, and it runs
// getDisplayMedia + the encoder for the selected region. See D-018.
function openRecordingWindow(display: Electron.Display, payload: GifRecordPayload): void {
  closeRecording()
  recordingTargetDisplayId = String(display.id)
  recordingPayload = payload

  const region = regionInDip(display, payload.crop)
  recordingShadeWindows = createShadeWindows(display, region)
  recordingBorderWindow = createBorderWindow(region)

  const width = 340
  const height = 46
  const { x, y } = placeControlBar(display, region, width, height)
  const bounds = integerRect({ x, y, width, height })
  const window = new BrowserWindow({
    ...bounds,
    frame: false,
    thickFrame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
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
      sandbox: true
    }
  })
  window.setBounds(bounds)
  recordingWindow = window
  window.setAlwaysOnTop(true, 'screen-saver')
  // Keep the control bar out of the recording. On Windows 11 this uses
  // WDA_EXCLUDEFROMCAPTURE, so getDisplayMedia never sees it.
  window.setContentProtection(true)

  window.on('closed', () => {
    if (recordingWindow === window) {
      recordingWindow = null
      recordingTargetDisplayId = null
      recordingPayload = null
    }
    const border = recordingBorderWindow
    const shade = recordingShadeWindows
    recordingBorderWindow = null
    recordingShadeWindows = []
    if (border && !border.isDestroyed()) border.destroy()
    for (const strip of shade) if (!strip.isDestroyed()) strip.destroy()
  })
  window.webContents.on('did-finish-load', () => {
    if (!window.isDestroyed() && recordingPayload) window.webContents.send('gif:record-init', recordingPayload)
  })
  window.once('ready-to-show', () => {
    void prepareRecordingChrome(window).finally(() => {
      if (!window.isDestroyed()) window.show()
    })
  })

  const devUrl = rendererUrl()
  if (devUrl) void window.loadURL(`${devUrl}/gif-record.html`)
  else void window.loadFile(path.join(__dirname, '../renderer/gif-record.html'))
}

// getDisplayMedia in the recording window is answered here with the display currently being
// recorded, so there is no system picker and the stream is always the right screen.
function registerDisplayMediaHandler(): void {
  electronSession.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      const displayId = recordingTargetDisplayId
      if (!displayId) {
        callback({})
        return
      }
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => {
          const source = sources.find((candidate) => candidate.display_id === displayId) ?? sources[0]
          callback(source ? { video: source } : {})
        })
        .catch(() => callback({}))
    },
    { useSystemPicker: false }
  )
}

function shortcutHandler(kind: ShortcutKind): () => void {
  return kind === 'gif' ? () => void startGifCapture() : () => void startCapture()
}

// Registers an accelerator for one action with the OS, replacing whatever it currently has
// bound. On failure the previous accelerator is put back so a rejected rebind never leaves
// the action with no working shortcut. Returns whether the requested accelerator took effect.
function applyShortcut(kind: ShortcutKind, accelerator: string): boolean {
  const previous = activeShortcuts[kind]
  if (previous) globalShortcut.unregister(previous)
  let registered = false
  try {
    registered = globalShortcut.register(accelerator, shortcutHandler(kind))
  } catch {
    // Electron throws rather than returning false for a syntactically invalid accelerator.
    registered = false
  }
  if (registered) {
    activeShortcuts[kind] = accelerator
    return true
  }
  if (previous) {
    try {
      globalShortcut.register(previous, shortcutHandler(kind))
    } catch {
      // The previous accelerator was valid a moment ago; nothing more to do if it now fails.
    }
  }
  return false
}

// At startup, bind each saved shortcut. If one is unavailable (taken by another app since it
// was chosen), fall back to its default and persist that so the tray label stays truthful.
function registerInitialShortcuts(): void {
  const settings = getSettings()
  if (!applyShortcut('capture', settings.capture.captureShortcut) &&
      settings.capture.captureShortcut !== DEFAULT_CAPTURE_SHORTCUT &&
      applyShortcut('capture', DEFAULT_CAPTURE_SHORTCUT)) {
    updateSettings({ capture: { captureShortcut: DEFAULT_CAPTURE_SHORTCUT } })
  }
  if (!applyShortcut('gif', settings.gif.shortcut) &&
      settings.gif.shortcut !== DEFAULT_GIF_SHORTCUT &&
      applyShortcut('gif', DEFAULT_GIF_SHORTCUT)) {
    updateSettings({ gif: { shortcut: DEFAULT_GIF_SHORTCUT } })
  }
}

// The tray tooltip and menu both surface the version and the live capture shortcut, so the
// running build and its binding can be read without opening anything.
function refreshTray(): void {
  if (!tray) return
  const version = app.getVersion()
  const settings = getSettings()
  tray.setToolTip(`Capturo ${version} — ${formatAccelerator(settings.capture.captureShortcut, isMac)} to capture`)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'New screenshot', accelerator: settings.capture.captureShortcut, click: () => void startCapture() },
      { label: 'New GIF', accelerator: settings.gif.shortcut, click: () => void startGifCapture() },
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
    icon: taskbarIcon(),
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
    // Capturo does not expose spelling suggestions or a dictionary UI. Electron otherwise
    // enables its spellchecker by default, which can make Windows initialise
    // Microsoft/Spelling/neutral cache directories in the process working directory when the
    // OS returns a malformed dictionary base path. Keep the service off before any renderer is
    // created so those unrelated cache trees cannot reappear beside the source code.
    electronSession.defaultSession.setSpellCheckerEnabled(false)
    const loadedSettings = loadSettings()
    // Reconcile the OS login item on every packaged launch so uninstall/reinstall or a moved
    // executable cannot leave the persisted preference and the registered path out of sync.
    if (!applyOpenAtStartup(loadedSettings.global.openAtStartup)) {
      updateSettings({ global: { openAtStartup: false } })
    }
    // Warm the persistent capture helper now so the first capture pays no device/duplication
    // setup and no cold DLL load. See D-017.
    startCaptureHelper()
    registerIpc()
    registerDisplayMediaHandler()
    registerInitialShortcuts()
    createTray()
    if (isSettingsSmokeInstance) openSettings()
    if (isSmokeInstance) void startCapture()
    if (isGifSmokeInstance) void startGifCapture()
    if (isGifRecordSmoke) {
      openRecordingWindow(screen.getPrimaryDisplay(), {
        crop: { x: 0.3, y: 0.3, width: 0.4, height: 0.4 },
        fps: 15,
        quality: 70,
        preTimerSeconds: 0,
        showFrameCount: true,
        autoStopMs: 3000
      })
    }
  })
  app.on('activate', () => void startCapture())
  app.on('window-all-closed', () => {
    // Capturo remains resident in the tray/menu bar.
  })
  app.on('before-quit', () => {
    isQuitting = true
    closeSession()
    closeRecording()
    stopCaptureHelper()
    globalShortcut.unregisterAll()
  })
  app.on('will-quit', () => {
    if (!isQuitting) globalShortcut.unregisterAll()
  })
}
