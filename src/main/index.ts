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
  powerMonitor,
  screen,
  session as electronSession,
  shell,
  systemPreferences,
  Tray
} from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { AsyncGate } from '../shared/async-gate'
import { PinManager } from './pins'
import type { PinEditResult, PinResult } from '../shared/pin'

import type {
  CapturePayload,
  CopyTextResult,
  OpenDetachedEditorResult,
  Point,
  Rect,
  SaveResult
} from '../shared/types'
import {
  DEFAULT_CAPTURE_SHORTCUT,
  DEFAULT_COLOR_PICKER_SHORTCUT,
  DEFAULT_GIF_SHORTCUT,
  type CaptureSettings,
  type SettingsUpdate,
  type SettingsUpdateResult
} from '../shared/settings'
import { formatAccelerator } from '../shared/shortcut'
import { normalizeRecognizedText, recognitionFailureMessage, textRecognitionUnavailableMessage } from '../shared/ocr'
import {
  CAPTURO_RELEASES_URL,
  nextAutomaticUpdateDelay,
  type UpdateCheckResult
} from '../shared/updates'
import { normalizeScreenAccessStatus, type ScreenAccessState } from '../shared/permissions'
import {
  formatColor,
  normalizeRgb,
  rgbToHex,
  type ColorPickerPayload,
  type ColorSample,
  type PickedColor,
  type Rgb
} from '../shared/color'
import {
  FLOATING_PICKER_MAX_SIZE,
  PICKER_ZOOM_LEVELS,
  cursorForDisplay,
  displayPixelSize,
  floatingPickerRect
} from '../shared/picker'
import {
  hasGifSignature,
  isExpiredGifClipboardFile,
  type CropRect,
  type GifPreviewActionResult,
  type GifRecordPayload
} from '../shared/gif'
import {
  panoramicOutlineRect,
  PANORAMIC_OUTLINE_THICKNESS,
  PANORAMIC_POINTER_RADIUS_DIP,
  type FinishScrollCaptureResult,
  type PanoramicPointer,
  type ScrollCapturePayload,
  type StartScrollCaptureResult
} from '../shared/scroll'
import {
  controlBarPlacement,
  controlBarPlacementOutside,
  integerRect,
  overlayRegions,
  surroundingStrips,
  type OverlayRegion
} from '../shared/geometry'
import { getSettings, loadSettings, updateSettings } from './settings'
import {
  captureDisplays,
  captureHelperAvailable,
  copyFileToClipboard,
  MAX_OCR_PNG_BYTES,
  recognizeTextFromPng,
  resetCaptureDisplays,
  sampleDisplayColor,
  startCaptureHelper,
  stopCaptureHelper,
  suppressWindowBorder,
  textRecognitionAvailable
} from './capture-helper'
import { checkGithubForUpdate } from './updates'
import { startPickerInput, type PickerInputController } from './picker-input'
import { captureTempPath, cleanupAbandonedCaptureTemps } from './capture-temp'
import {
  isMainFrameSender,
  isOnlyConnectedDisplay,
  lockAppNavigation,
  ownsDisplayMediaRequest,
  ownsWindow,
  permittedDisplayMediaSource
} from './window-security'

type OverlayEntry = {
  window: BrowserWindow
  payload: CapturePayload
  revealed: boolean
}

type PickerOverlayEntry = {
  window: BrowserWindow
  payload: ColorPickerPayload
  revealed: boolean
}

// The frozen desktop for one display, ready to hand to its overlays.
type DisplayImage = { bytes: Uint8Array; width: number; height: number }

// A screenshot capture and a GIF capture share the same region-selection overlays; the mode
// decides which renderer they load and what happens once a region is chosen.
type CaptureMode = 'screenshot' | 'gif'

// The two global shortcuts Capturo registers.
type ShortcutKind = 'capture' | 'gif' | 'colorPicker'

type CaptureSession = {
  id: string
  mode: CaptureMode
  overlays: Map<number, OverlayEntry>
}

type ColorPickerSession = {
  id: string
  overlays: Map<number, PickerOverlayEntry>
}

type DetachedEditorState = {
  id: string
  window: BrowserWindow
  payload: CapturePayload
  revealed: boolean
  readyPromise: Promise<boolean>
  resolveReady: (opened: boolean) => void
  readySettled: boolean
  readyTimer: ReturnType<typeof setTimeout> | null
}

let tray: Tray | null = null
// Kept so macOS can pop the menu up on demand: it is deliberately not assigned to the Tray there,
// because an assigned menu would also open on the primary click. See D-030.
let trayMenu: Menu | null = null
let session: CaptureSession | null = null
// The picker is deliberately not a CaptureSession: it never freezes or paints the desktop. Its
// transparent windows only own pointer input while main samples a tiny live grid underneath.
let pickerSession: ColorPickerSession | null = null
let pickerInputController: PickerInputController | null = null
const liveToolLaunch = new AsyncGate()
// A selected screenshot can leave the full-screen overlay and live in one ordinary editor
// window. It is intentionally independent from `session`, so starting another capture does not
// destroy work that the user moved aside. A second detach focuses this editor instead of replacing
// an unsaved image.
let detachedEditor: DetachedEditorState | null = null
let pins: PinManager | null = null
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
// Panoramic Scrolling uses the same display-media grant as GIF recording but owns a separate,
// out-of-crop control window and final-image lifecycle. Its frames are stitched in the renderer and
// transferred back as one PNG for the normal detached editor. See D-042.
let scrollingWindow: BrowserWindow | null = null
let scrollingTargetDisplayId: string | null = null
let scrollingPayload: ScrollCapturePayload | null = null
// A click-through outline drawn around the selected viewport, so the user can see what the session
// is following while they keep working in the live application. It is deliberately not
// content-protected; its clearance gap is what keeps it out of the capture. See D-042.
let scrollingOutlineWindow: BrowserWindow | null = null
const PANORAMIC_CONTROL_WIDTH = 650
const PANORAMIC_CONTROL_HEIGHT = 58
type GifPreviewState = {
  bytes: Buffer
  savedPath: string | null
  clipboardPath: string | null
}
let gifPreviewWindow: BrowserWindow | null = null
let gifPreviewState: GifPreviewState | null = null
// The window that shows a picked colour. One at a time: picking again reuses it rather than
// leaving a trail of windows behind.
let colorWindow: BrowserWindow | null = null
let pickedColor: PickedColor | null = null
// Set while the colour window is hidden for a Pick again, so it comes back whether the next pick
// succeeds or the user cancels out of the overlay.
let colorWindowHiddenForPick = false
let automaticUpdateTimer: ReturnType<typeof setTimeout> | null = null
let updateCheckInFlight: Promise<UpdateCheckResult> | null = null
let availableUpdateVersion: string | null = null
let lastNotifiedUpdateVersion: string | null = null
// The accelerators currently registered with the OS, per action. Tracked so a rebind can
// cleanly unregister the old one and roll back to it if the new one is rejected.
const activeShortcuts: Partial<Record<ShortcutKind, string>> = {}
let isQuitting = false

const isMac = process.platform === 'darwin'

// Panoramic Scrolling needs three things from a platform: a live display-media stream it can crop,
// chrome it can keep outside that crop, and a readable cursor position to mask. Windows and macOS
// both provide all three -- macOS through the same display-media grant and external control bar
// that GIF recording already uses there. Everything else hides the action rather than offering a
// capture that would silently produce nothing. See D-042.
const panoramicCaptureSupported = process.platform === 'win32' || isMac
const isSmokeInstance = process.env.CAPTURO_CAPTURE_ON_START === '1'
const isGifSmokeInstance = process.env.CAPTURO_GIF_ON_START === '1'
const isPickerSmokeInstance = process.env.CAPTURO_PICKER_ON_START === '1'
const isSettingsSmokeInstance = process.env.CAPTURO_SETTINGS_ON_START === '1'
const isSettingsScreenshot = process.env.CAPTURO_SETTINGS_SCREENSHOT === '1'
const requestedSettingsScreenshotTab = process.env.CAPTURO_SETTINGS_SCREENSHOT_TAB
const settingsScreenshotTab = ['global', 'capture', 'gif', 'colorPicker'].includes(requestedSettingsScreenshotTab ?? '')
  ? requestedSettingsScreenshotTab!
  : 'gif'
const isSettingsUpdateCheckSmoke = process.env.CAPTURO_SETTINGS_CHECK_UPDATES === '1'
const isGifPreviewSmokeInstance = process.env.CAPTURO_GIF_PREVIEW_ON_START === '1'
const isGifPreviewScreenshot = process.env.CAPTURO_GIF_PREVIEW_SCREENSHOT === '1'
const ocrSmokeImagePath = process.env.CAPTURO_OCR_SMOKE_IMAGE?.trim() || null
// Development-only Screen Recording status override, so every permission state can be exercised
// on a machine where the permission is already granted. Never read in a packaged build.
const forcedScreenAccessState = !app.isPackaged ? process.env.CAPTURO_SCREEN_ACCESS_STATE?.trim() || null : null
// Whether this launch has already raised the macOS Screen Recording prompt. macOS answers it once
// and remembers, so asking again only puts the same modal back in front of the user. See D-027.
let screenAccessRequested = false
// Opens a recording of a fixed centre region directly (no selection UI), for smoke-testing
// the record → encode → save pipeline.
const isGifRecordSmoke = process.env.CAPTURO_GIF_RECORD_SMOKE === '1'
// Opt-in phase timings for the capture path, printed to stderr. Off by default so normal
// runs stay quiet; used to measure the invocation latency end to end.
const timingEnabled = process.env.CAPTURO_TIMING === '1'
const MAX_OCR_DATA_URL_CHARS = 'data:image/png;base64,'.length + Math.ceil(MAX_OCR_PNG_BYTES * 4 / 3) + 4
const MAX_DETACHED_IMAGE_DATA_URL_CHARS = 128 * 1024 * 1024
const DETACHED_EDITOR_READY_TIMEOUT_MS = 10_000
const AUTOMATIC_UPDATE_INITIAL_DELAY_MS = 15_000
const AUTOMATIC_UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000
const AUTOMATIC_UPDATE_BUSY_RETRY_MS = 5 * 60 * 1000
// Documentation screenshots must also work on headless/virtualized Windows hosts where
// Chromium cannot start a GPU process. This affects screenshot smoke runs only.
if (isSettingsScreenshot || isGifPreviewScreenshot) app.disableHardwareAcceleration()

function logTiming(message: string): void {
  if (timingEnabled) console.error(`[timing] ${message}`)
}

function createAppWindow(options: Electron.BrowserWindowConstructorOptions): BrowserWindow {
  const window = new BrowserWindow(options)
  lockAppNavigation(window)
  return window
}

if (isSmokeInstance || isGifSmokeInstance || isPickerSmokeInstance || isGifRecordSmoke || isSettingsSmokeInstance || isGifPreviewSmokeInstance || ocrSmokeImagePath) {
  app.setPath('userData', path.join(app.getPath('temp'), 'capturo-development'))
}

function trayAsset(name: string): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'tray', name)
    : path.join(app.getAppPath(), 'build', 'tray', name)
}

// The macOS menu bar expects a template image: monochrome artwork whose alpha macOS paints
// itself, so the icon follows the light or dark bar, dims when the app is inactive, and inverts
// while the menu is open. A colour logo there renders as a filled tile among the system glyphs.
// Windows has no such convention and keeps the colour mark. See D-009.
function trayImage(): Electron.NativeImage | string {
  if (!isMac) return trayAsset('tray-icon.png')
  const image = nativeImage.createFromPath(trayAsset('tray-iconTemplate.png'))
  // Electron also infers this from the `Template` filename suffix; setting it explicitly means the
  // behaviour does not silently depend on the asset keeping that exact name.
  image.setTemplateImage(true)
  return image
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
      // Register the stable outer executable when that path is available. This always writes,
      // because the launch reconciliation also has to repair a registration left pointing at a
      // moved or reinstalled executable, which the openAtLogin flag alone does not reveal.
      const executablePath = process.env.PORTABLE_EXECUTABLE_FILE ?? process.execPath
      app.setLoginItemSettings({ openAtLogin: enabled, path: executablePath })
      return app.getLoginItemSettings({ path: executablePath }).openAtLogin === enabled
    }
    // macOS registers through SMAppService, which fails with "Operation not permitted" when it
    // is asked to unregister an app that was never registered. The launch reconciliation calls
    // this with the stored preference on every start, so an ordinary tray-only launch logged
    // that error every time. There is no executable path to reconcile here, unlike Windows, so
    // a state that already matches needs no write at all.
    if (app.getLoginItemSettings().openAtLogin === enabled) return true
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

function closePickerSession(): void {
  pickerInputController?.stop()
  pickerInputController = null
  const active = pickerSession
  pickerSession = null
  if (active) {
    for (const entry of active.overlays.values()) {
      if (!entry.window.isDestroyed()) entry.window.destroy()
    }
  }
}

function settleDetachedEditorReady(state: DetachedEditorState, opened: boolean): void {
  if (state.readySettled) return
  state.readySettled = true
  if (state.readyTimer !== null) clearTimeout(state.readyTimer)
  state.readyTimer = null
  state.resolveReady(opened)
}

function closeDetachedEditor(expected: DetachedEditorState | null = detachedEditor): void {
  if (!expected || detachedEditor !== expected) return
  detachedEditor = null
  settleDetachedEditorReady(expected, false)
  if (!expected.window.isDestroyed()) expected.window.destroy()
}

// A hidden editor is not useful work and must not block the next detach attempt. This is the
// recovery path for a renderer that failed before capture:ready; a genuinely opened editor is
// restored and focused instead.
function focusExistingDetachedEditor(): boolean {
  const existing = detachedEditor
  if (!existing) return false
  if (existing.window.isDestroyed()) {
    detachedEditor = null
    settleDetachedEditorReady(existing, false)
    return false
  }
  if (!existing.revealed) {
    closeDetachedEditor(existing)
    return false
  }
  if (existing.window.isMinimized()) existing.window.restore()
  existing.window.show()
  existing.window.focus()
  return true
}

type CaptureOwner =
  | { kind: 'overlay'; session: CaptureSession }
  | { kind: 'detached'; editor: DetachedEditorState }

function validCaptureOwner(event: Electron.IpcMainInvokeEvent, sessionId: string): CaptureOwner | null {
  const active = validSession(event, sessionId)
  if (active?.mode === 'screenshot') return { kind: 'overlay', session: active }
  const editor = detachedEditor
  if (editor && editor.id === sessionId && !editor.window.isDestroyed() &&
      ownsWindow(event, editor.window)) {
    return { kind: 'detached', editor }
  }
  return null
}

function closeCaptureOwner(owner: CaptureOwner): void {
  if (owner.kind === 'overlay') {
    if (session === owner.session) closeSession()
  } else {
    closeDetachedEditor(owner.editor)
  }
}

// Brings the colour window back after a Pick again that did not end in a pick.
function restoreColorWindow(): void {
  if (!colorWindowHiddenForPick) return
  colorWindowHiddenForPick = false
  if (!colorWindow || colorWindow.isDestroyed()) return
  colorWindow.show()
  colorWindow.setOpacity(1)
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
  if (entry.payload.role !== 'editor') return

  // With more than one display there is an editor per display, and each was focused as it
  // finished painting, so whichever happened to be revealed last held the keyboard. Keyboard
  // input then landed on a screen the user was not pointing at, and Escape was equally arbitrary.
  // Focus the editor the pointer
  // is actually over, and leave the others alone.
  if (!entry.payload.cursor) return
  // macOS will not make a window key while its application is inactive, and Capturo is a
  // background tray app with no Dock icon, so the click that starts a capture leaves whatever the
  // user was in as the active application. `focus()` alone therefore silently did nothing and
  // Escape stayed dead until the first drag. Measured with another app frontmost: focus() alone
  // left isFocused false, and activating the app first made it true. Stealing focus is correct
  // here — the user just asked for a full-screen capture surface — and it is exactly what the
  // shortcut path needs, since there is no click to fall back on.
  if (isMac) app.focus({ steal: true })
  entry.window.focus()
}

function revealPickerOverlay(entry: PickerOverlayEntry): void {
  if (entry.revealed || entry.window.isDestroyed()) return
  entry.revealed = true
  entry.window.setIgnoreMouseEvents(entry.payload.nativeInput)
  entry.window.setOpacity(1)
  // Every tile is interactive for the live picker, including taskbar/menu-bar strips. Only the
  // tile under the invocation pointer takes focus so Escape works immediately without whichever
  // window happened to load last stealing it.
  if (!entry.payload.cursor) return
  if (isMac) app.focus({ steal: true })
  entry.window.focus()
}

function notify(title: string, body: string): void {
  if (!getSettings().capture.showNotification) return
  if (Notification.isSupported()) new Notification({ title, body, silent: true, icon: taskbarIcon() }).show()
}

function updateCheckBlockedByCapture(): boolean {
  return session !== null || pickerSession !== null || recordingWindow !== null || scrollingWindow !== null
}

async function openCapturoReleases(): Promise<boolean> {
  try {
    await shell.openExternal(CAPTURO_RELEASES_URL)
    return true
  } catch {
    return false
  }
}

function showUpdateAvailable(result: Extract<UpdateCheckResult, { status: 'available' }>): void {
  availableUpdateVersion = result.latestVersion
  refreshTray()
  if (lastNotifiedUpdateVersion === result.latestVersion || !Notification.isSupported()) return
  lastNotifiedUpdateVersion = result.latestVersion
  const notification = new Notification({
    title: `Capturo ${result.latestVersion} is available`,
    body: 'Open the official GitHub release to review and download it.',
    silent: true,
    icon: taskbarIcon()
  })
  notification.on('click', () => void openCapturoReleases())
  notification.show()
}

function performUpdateCheck(): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion()
  if (!app.isPackaged) {
    return Promise.resolve({
      status: 'unavailable',
      currentVersion,
      message: 'Update checks are available in packaged Capturo builds.'
    })
  }
  if (updateCheckBlockedByCapture()) {
    return Promise.resolve({
      status: 'unavailable',
      currentVersion,
      message: 'Finish the active capture or recording, then check again.'
    })
  }
  if (!updateCheckInFlight) {
    updateCheckInFlight = checkGithubForUpdate(currentVersion).then((result) => {
      updateSettings({ global: { lastUpdateCheckAt: Date.now() } })
      if (result.status === 'available') showUpdateAvailable(result)
      else if (result.status === 'up-to-date') {
        availableUpdateVersion = null
        refreshTray()
      }
      return result
    }).finally(() => {
      updateCheckInFlight = null
    })
  }
  return updateCheckInFlight
}

function automaticUpdateDelay(minimumMs: number): number {
  return nextAutomaticUpdateDelay(
    getSettings().global.lastUpdateCheckAt,
    Date.now(),
    minimumMs,
    AUTOMATIC_UPDATE_INTERVAL_MS
  )
}

function cancelAutomaticUpdateCheck(): void {
  if (automaticUpdateTimer) clearTimeout(automaticUpdateTimer)
  automaticUpdateTimer = null
}

function scheduleAutomaticUpdateCheck(delayMs = AUTOMATIC_UPDATE_INTERVAL_MS): void {
  cancelAutomaticUpdateCheck()
  if (!app.isPackaged || !getSettings().global.automaticallyCheckForUpdates || isQuitting) return
  automaticUpdateTimer = setTimeout(() => {
    automaticUpdateTimer = null
    if (updateCheckBlockedByCapture()) {
      scheduleAutomaticUpdateCheck(AUTOMATIC_UPDATE_BUSY_RETRY_MS)
      return
    }
    void performUpdateCheck().finally(() => scheduleAutomaticUpdateCheck())
  }, delayMs)
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
// rotated surface back to the desktop orientation, and only then encodes sRGB. Chromium's own
// 8-bit capture does none of this correctly on an HDR display. It also excludes the mouse
// pointer. See D-014, D-015, D-017. Windows refuses a failed or unverified frame; other
// platforms return null for the desktopCapturer path.
async function captureWithHelper(displays: Electron.Display[]): Promise<(DisplayImage | null)[]> {
  if (!captureHelperAvailable()) {
    if (process.platform === 'win32') throw new Error('The HDR-aware Windows capture helper is unavailable.')
    return displays.map(() => null)
  }

  // DXGI enumerates outputs in its own order, so each monitor is identified by its physical
  // desktop origin. dipToScreenRect performs the per-monitor scaling conversion.
  const outputs = displays.map(() => captureTempPath(app.getPath('temp')))
  const requests = displays.map((display, index) => {
    const physical = screen.dipToScreenRect(null, display.bounds)
    return { originX: physical.x, originY: physical.y, output: outputs[index] }
  })

  let results: Awaited<ReturnType<typeof captureDisplays>> = []
  try {
    results = await captureDisplays(requests)
  } catch (error) {
    console.error('capture helper failed', error)
  }

  const images = await Promise.all(
    displays.map(async (display, index) => {
      const result = results[index]
      if (!result?.ok || !result.width || !result.height) {
        console.error(
          `capture helper did not serve display ${display.id}` +
          `${result?.stage ? ` (stage ${result.stage}${result.hr ? ` hr ${result.hr}` : ''})` : ''}`
        )
        return null
      }
      if (result.format !== 'R16G16B16A16_FLOAT' && result.format !== 'B8G8R8A8_UNORM') {
        console.error(`display ${display.id} has an unknown native pixel format (${result.format ?? 'missing'})`)
        return null
      }
      if (result.format === 'R16G16B16A16_FLOAT' &&
        (result.whiteLevelSource !== 'queried' || result.whiteLevelQueried !== true ||
          !Number.isFinite(result.sdrWhiteNits) || result.sdrWhiteNits! < 40 || result.sdrWhiteNits! > 1000)) {
        console.error(
          `display ${display.id} has an FP16 frame without a measured SDR white level ` +
          `(${result.whiteLevelSource ?? 'unknown'})`
        )
        return null
      }
      if (result.hdrActive && result.format !== 'R16G16B16A16_FLOAT') {
        console.error(`display ${display.id} is HDR but the helper returned ${result.format ?? 'an unknown format'}`)
        return null
      }
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
  // Chromium's 8-bit fallback is known to clip HDR desktop pixels before Capturo can correct
  // them. On Windows, an unverified display must stop the whole capture instead of creating a
  // plausible-looking frozen overlay that could be copied or saved as a damaged image.
  if (process.platform === 'win32') {
    const failedIndex = images.findIndex((image) => !image)
    if (failedIndex >= 0) {
      const result = results[failedIndex]
      throw new Error(
        `Display ${displays[failedIndex].id} could not be captured with verified color` +
        `${result?.stage ? ` (stage ${result.stage}${result.hr ? `, ${result.hr}` : ''})` : ''}.`
      )
    }
  }
  if (timingEnabled) {
    results.forEach((result, index) => {
      if (!result?.timings) return
      const stages = Object.entries(result.timings).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', ')
      const colour = `${result.format ?? 'unknown'}, hdr ${result.hdrActive ? 'on' : 'off'}, ` +
        `sdr white ${result.sdrWhiteNits ?? '?'} nits (${result.whiteLevelSource ?? 'unknown'})`
      logTiming(`helper display ${displays[index].id}: ${colour} [${stages}]`)
    })
  }
  return images
}

// Deep link to System Settings → Privacy & Security → Screen Recording. macOS only re-prompts
// for a permission it has never been asked about, so once the user has answered, this pane is
// the only way to change the answer.
const SCREEN_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'

// The current Screen Recording permission, as the Settings window sees it. Windows does not gate
// screen capture, so it reports unsupported and the Settings row hides itself there.
//
// Observing a granted status is recorded permanently, because losing access afterwards is a
// distinct situation: System Settings usually still shows Capturo switched on, and the recovery
// is to switch it off and on rather than to "turn it on" again. See D-027.
function screenAccessState(): ScreenAccessState {
  if (!isMac) return { supported: false, status: 'granted', previouslyGranted: false }
  // A machine that has already granted the permission cannot reach the states that matter most,
  // so development builds can name one directly. This is how the Screen Recording states are
  // exercised and screenshotted; it is read only when the app is unpackaged and never persists.
  if (forcedScreenAccessState) {
    return {
      supported: true,
      status: normalizeScreenAccessStatus(forcedScreenAccessState),
      previouslyGranted: getSettings().global.screenAccessWasGranted
    }
  }
  const status = normalizeScreenAccessStatus(systemPreferences.getMediaAccessStatus('screen'))
  if (status === 'granted' && !getSettings().global.screenAccessWasGranted) {
    updateSettings({ global: { screenAccessWasGranted: true } })
  }
  return { supported: true, status, previouslyGranted: getSettings().global.screenAccessWasGranted }
}

// macOS has no "ask for screen access" API: systemPreferences.askForMediaAccess covers only the
// microphone and camera. The Screen Recording prompt is raised by actually attempting a capture,
// so request the smallest thumbnail the API will take and then re-read the authoritative status.
//
// This runs for 'denied' as well as 'not-determined'. macOS reports screen capture through a
// boolean preflight, so a Capturo that has never asked is indistinguishable from one the user
// refused, and skipping the attempt on 'denied' would mean the system prompt is never raised on
// a first run. 'restricted' is a policy decision no prompt can move.
//
// Attempting is NOT free: each attempt can raise the system modal again, so the caller decides
// when it is appropriate. Capture only asks once per launch, via `screenAccessRequested`.
async function requestScreenAccess(): Promise<ScreenAccessState> {
  const before = screenAccessState()
  if (!before.supported || before.status === 'granted' || before.status === 'restricted') return before
  screenAccessRequested = true
  try {
    await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1, height: 1 },
      fetchWindowIcons: false
    })
  } catch {
    // The rejection carries no more information than the status read below does.
  }
  return screenAccessState()
}

// One permission conversation at a time. startCapture() is fire-and-forget from the tray, the
// global shortcut, `activate` and `second-instance`, and both the request and the dialog are
// awaited, so without this every trigger queues its own system prompt and its own dialog. The
// user then dismisses one only for the next to appear, which reads as Capturo asking forever.
let screenPermissionCheck: Promise<boolean> | null = null

async function ensureScreenPermission(): Promise<boolean> {
  if (!isMac) return true
  if (!screenPermissionCheck) {
    // Never let this reject. Callers treat it as a boolean gate, and a rejection would both
    // surface as an unhandled rejection from the fire-and-forget capture triggers and, worse,
    // escape before the shared promise is cleared, leaving capture blocked for the whole session.
    screenPermissionCheck = resolveScreenPermission()
      .catch((error) => {
        console.error('Could not resolve Screen Recording permission', error)
        return false
      })
      .finally(() => {
        screenPermissionCheck = null
      })
  }
  return screenPermissionCheck
}

async function resolveScreenPermission(): Promise<boolean> {
  if (screenAccessState().status === 'granted') return true

  // Raise the system prompt at most once per launch. macOS records the answer the first time, so
  // a second prompt cannot produce a better outcome; what it does produce is the same modal in
  // front of a user who has already dealt with it, until they press Deny to make it stop. That
  // writes an explicit refusal only System Settings can undo, so re-asking actively destroys the
  // permission it is trying to obtain. On a first run this attempt is still what raises the
  // prompt and what puts Capturo into the Screen Recording list at all.
  if (!screenAccessRequested) {
    if ((await requestScreenAccess()).status === 'granted') return true
    // Defer to macOS for this attempt. Its prompt is raised by the request above but is answered
    // asynchronously, so `getSources` returns "still denied" while Apple's dialog is on screen
    // and unanswered. Continuing here stacked Capturo's dialog on top of it: two permission
    // dialogs for one permission, and only Apple's could actually grant it. If macOS stayed
    // silent because it already holds an answer, the next capture attempt explains instead —
    // one wasted click that corrects itself, rather than a confusing pair of dialogs every time.
    console.error('[permission] capture refused: deferring to the macOS Screen Recording prompt')
    return false
  }

  const state = screenAccessState()

  // A user who has had access before does not need to be told to turn it on: System Settings will
  // still show Capturo switched on, and repeating the generic instruction sends them to a pane
  // that looks correct. Name the actual recovery instead. See D-027.
  const detail = state.previouslyGranted
    ? 'Capturo had Screen Recording access and no longer does. Open System Settings → Privacy & Security → Screen Recording. If Capturo is still switched on there, switch it off and on again, then reopen Capturo.'
    : 'Step 1: allow Capturo in System Settings → Privacy & Security → Screen Recording. Step 2: reopen Capturo, because macOS only applies the change to a newly launched app.'

  // One line per refusal. A permission loop is invisible from the outside and was reported as
  // "it keeps asking"; this makes the number of times Capturo actually asked countable.
  console.error(`[permission] capture refused: Screen Recording is ${state.status}`)

  const result = await dialog.showMessageBox({
    type: 'warning',
    title: 'Screen Recording permission required',
    message: 'Capturo needs Screen Recording access to capture your desktop.',
    detail,
    buttons: ['Open System Settings', 'Reopen Capturo', 'Cancel'],
    defaultId: 0,
    cancelId: 2
  })
  if (result.response === 0) await shell.openExternal(SCREEN_SETTINGS_URL)
  else if (result.response === 1) {
    isQuitting = true
    app.relaunch()
    app.quit()
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
  const pixelSizes = sized.map((display) => displayPixelSize(display.size, display.scaleFactor))
  const maxWidth = Math.max(...pixelSizes.map((size) => size.width))
  const maxHeight = Math.max(...pixelSizes.map((size) => size.height))
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

// Windows tiles a display; macOS covers it with one window, because AppKit pushes a strip placed
// over the menu bar or the Dock back inside the work area — measured on macOS 26.2, a menu-bar
// strip requested at y=0 landed at y=33 and a Dock strip requested at y=899 landed at y=867, so
// tiling left the real menu bar and Dock on screen and painted their frozen copies over the
// editor. See D-013 and D-029; the division itself is pure and tested in tests/geometry.test.ts.
function displayOverlayRegions(display: Electron.Display): OverlayRegion[] {
  return overlayRegions(display.bounds, display.workArea, !isMac)
}

function buildPayload(
  sessionId: string,
  display: Electron.Display,
  region: OverlayRegion,
  image: DisplayImage,
  cursor: Point
): CapturePayload {
  const bounds = display.bounds
  const area = region.rect
  const localCursor = cursorForDisplay(cursor, bounds)
  return {
    sessionId,
    displayId: String(display.id),
    role: region.role,
    imageBytes: image.bytes,
    imageWidth: image.width,
    imageHeight: image.height,
    imageOrigin: { x: area.x - bounds.x, y: area.y - bounds.y },
    captureSize: { width: bounds.width, height: bounds.height },
    // How far this overlay reaches past the work area at each end. A macOS overlay spans the
    // whole display, so the top inset is the menu bar area (which contains the notch on the
    // Macs that have one) and the bottom inset is the Dock. A Windows editor sits inside the
    // work area, so both are zero.
    safeArea: {
      top: Math.max(0, display.workArea.y - area.y),
      bottom: Math.max(0, area.y + area.height - (display.workArea.y + display.workArea.height))
    },
    cursor: localCursor,
    rollingCaptureAvailable: panoramicCaptureSupported
  }
}

function createOverlayWindow(area: Rect): BrowserWindow {
  const overlay = createAppWindow({
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
    // macOS clamps a window into the screen's visible frame, which would push an overlay off the
    // menu bar and the Dock and leave both uncovered. This opts out of that clamp; it is the only
    // way a full-display overlay can reach either one. macOS-only in Electron. See D-029.
    enableLargerThanScreen: isMac,
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

function buildPickerPayload(
  sessionId: string,
  display: Electron.Display,
  region: OverlayRegion,
  cursor: Point,
  floating = false
): ColorPickerPayload {
  const bounds = display.bounds
  const area = region.rect
  const physical = displayPixelSize(display.size, display.scaleFactor)
  const displayCursor = cursorForDisplay(cursor, bounds)
  const regionOrigin = { x: area.x - bounds.x, y: area.y - bounds.y }
  const cursorInRegion = displayCursor &&
    displayCursor.x >= regionOrigin.x && displayCursor.x < regionOrigin.x + area.width &&
    displayCursor.y >= regionOrigin.y && displayCursor.y < regionOrigin.y + area.height
      ? displayCursor
      : null
  return {
    sessionId,
    displayId: String(display.id),
    role: region.role === 'filler' ? 'filler' : 'editor',
    floating,
    nativeInput: floating && process.platform === 'win32' && captureHelperAvailable(),
    displayOrigin: { x: bounds.x, y: bounds.y },
    regionOrigin,
    displaySize: { width: bounds.width, height: bounds.height },
    imageSize: { width: physical.width, height: physical.height },
    safeArea: {
      top: Math.max(0, display.workArea.y - area.y),
      bottom: Math.max(0, area.y + area.height - (display.workArea.y + display.workArea.height))
    },
    cursor: cursorInRegion
  }
}

function createPickerOverlayWindow(area: Rect): BrowserWindow {
  const overlay = createAppWindow({
    x: area.x,
    y: area.y,
    width: area.width,
    height: area.height,
    frame: false,
    thickFrame: false,
    enableLargerThanScreen: isMac,
    transparent: true,
    backgroundColor: '#00000000',
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
  // The magnifier is real UI above the desktop, but must never become one of the pixels it is
  // sampling. Windows maps this to WDA_EXCLUDEFROMCAPTURE for Desktop Duplication.
  // Development-only visual smoke mode lets Windows.Graphics.Capture inspect the selector itself.
  // Packaged builds remain protected even if an inherited environment variable has this name.
  overlay.setContentProtection(app.isPackaged || process.env.CAPTURO_PICKER_VISUAL_SMOKE !== '1')
  overlay.setOpacity(0)
  overlay.setIgnoreMouseEvents(true)
  overlay.showInactive()
  overlay.setBounds(area)
  return overlay
}

async function spawnPickerOverlay(
  owner: ColorPickerSession,
  display: Electron.Display,
  region: OverlayRegion,
  cursor: Point,
  floating = false
): Promise<void> {
  const payload = buildPickerPayload(owner.id, display, region, cursor, floating)
  const overlay = createPickerOverlayWindow(region.rect)
  const webContentsId = overlay.webContents.id
  overlay.on('closed', () => {
    owner.overlays.delete(webContentsId)
    if (pickerSession === owner && owner.overlays.size === 0) {
      pickerInputController?.stop()
      pickerInputController = null
      pickerSession = null
    }
  })
  overlay.webContents.on('did-finish-load', () => {
    if (!overlay.isDestroyed() && pickerSession === owner) {
      overlay.webContents.send('color:picker-initialize', payload)
    }
  })
  owner.overlays.set(webContentsId, { window: overlay, payload, revealed: false })

  const devUrl = rendererUrl()
  if (devUrl) await overlay.loadURL(`${devUrl}/picker.html`)
  else await overlay.loadFile(path.join(__dirname, '../renderer/picker.html'))
}

function activateWindowsPickerInput(owner: ColorPickerSession, entry: PickerOverlayEntry): boolean {
  if (!entry.payload.nativeInput || pickerInputController) return true
  const controller = startPickerInput(
    () => {
      if (pickerSession !== owner || entry.window.isDestroyed()) return
      // The native input-only window owns every desktop mouse point. The compact Electron window
      // now paints just the lens and must not intercept those events even when it sits above it.
      revealPickerOverlay(entry)
      entry.window.moveTop()
      entry.window.focus()
      entry.window.webContents.send('color:picker-input', {
        kind: 'move', point: screen.getCursorScreenPoint()
      })
    },
    (input) => {
      if (pickerSession !== owner || entry.window.isDestroyed()) return
      const point = screen.screenToDipPoint({ x: input.x, y: input.y })
      const display = screen.getDisplayNearestPoint(point)
      if (String(display.id) !== entry.payload.displayId) {
        // Precision is display-local. On a seam, restart at the physical point on the new output
        // so sampling uses its native HDR output and DPI scale instead of the previous display.
        const rect = floatingPickerRect(point, display.bounds, FLOATING_PICKER_MAX_SIZE)
        entry.window.setBounds(rect)
        entry.payload = buildPickerPayload(owner.id, display, { rect, role: 'editor' }, point, true)
        entry.window.webContents.send('color:picker-initialize', entry.payload)
      }
      entry.window.webContents.send('color:picker-input', {
        kind: input.kind,
        point,
        deltaY: input.deltaY
      })
    },
    () => {
      if (pickerSession !== owner) return
      // A lost heartbeat or input process must never leave an invisible desktop-wide hit surface
      // or an unresponsive picker. Destroying the HWND restores normal OS mouse routing.
      closePickerSession()
      restoreColorWindow()
    }
  )
  if (!controller) return false
  pickerInputController = controller
  return true
}

async function openDetachedEditorWindow(
  image: Electron.NativeImage,
  displayId: string,
  forcePng: boolean
): Promise<boolean> {
  if (focusExistingDetachedEditor()) return false

  const display = screen.getAllDisplays().find((candidate) => String(candidate.id) === displayId)
    ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const workArea = display.workArea
  const width = Math.max(640, Math.min(1400, workArea.width - 48))
  const height = Math.max(520, Math.min(920, workArea.height - 48))
  const window = createAppWindow({
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height,
    minWidth: 640,
    minHeight: 520,
    title: 'Capturo — Full editor',
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
  const size = image.getSize()
  let resolveReady!: (opened: boolean) => void
  const readyPromise = new Promise<boolean>((resolve) => { resolveReady = resolve })
  const state: DetachedEditorState = {
    id: randomUUID(),
    window,
    revealed: false,
    readyPromise,
    resolveReady,
    readySettled: false,
    readyTimer: null,
    payload: {
      sessionId: '',
      displayId,
      role: 'detached',
      imageBytes: image.toPNG(),
      imageWidth: size.width,
      imageHeight: size.height,
      imageOrigin: { x: 0, y: 0 },
      captureSize: { width: size.width, height: size.height },
      safeArea: { top: 0, bottom: 0 },
      cursor: null,
      forcePng,
      rollingCaptureAvailable: false
    }
  }
  state.payload.sessionId = state.id
  detachedEditor = state
  state.readyTimer = setTimeout(() => {
    if (detachedEditor !== state || state.revealed) return
    console.error('Detached screenshot editor did not become ready in time')
    closeDetachedEditor(state)
  }, DETACHED_EDITOR_READY_TIMEOUT_MS)

  window.on('closed', () => {
    settleDetachedEditorReady(state, false)
    if (detachedEditor === state) detachedEditor = null
  })
  window.webContents.on('render-process-gone', () => {
    if (detachedEditor === state) closeDetachedEditor(state)
  })
  window.on('unresponsive', () => {
    if (detachedEditor === state && !state.revealed) closeDetachedEditor(state)
  })

  try {
    const devUrl = rendererUrl()
    if (devUrl) await window.loadURL(devUrl)
    else await window.loadFile(path.join(__dirname, '../renderer/index.html'))
    return await state.readyPromise
  } catch (error) {
    console.error('Could not open detached screenshot editor', error)
    closeDetachedEditor(state)
    return false
  }
}

// Creates one overlay window for a region and loads the renderer into it. Resolves once the
// renderer has loaded; the caller awaits all overlays together so they load concurrently.
function overlayHtml(mode: CaptureMode): string {
  if (mode === 'gif') return 'gif.html'
  return 'index.html'
}

async function spawnOverlay(
  owner: CaptureSession,
  display: Electron.Display,
  region: OverlayRegion,
  image: DisplayImage,
  cursor: Point
): Promise<void> {
  const payload = buildPayload(owner.id, display, region, image, cursor)
  const overlay = createOverlayWindow(region.rect)

  const webContentsId = overlay.webContents.id
  overlay.on('closed', () => {
    owner.overlays.delete(webContentsId)
    if (session === owner && owner.overlays.size === 0) session = null
  })
  owner.overlays.set(webContentsId, { window: overlay, payload, revealed: false })

  const devUrl = rendererUrl()
  const html = overlayHtml(owner.mode)
  if (devUrl) await overlay.loadURL(owner.mode === 'screenshot' ? devUrl : `${devUrl}/${html}`)
  else await overlay.loadFile(path.join(__dirname, `../renderer/${html}`))
}

// Opens the region-selection overlays for a screenshot or a GIF. Both freeze the desktop the
// same way and reuse the same selection UI; the mode picks which renderer loads and what
// happens after a region is chosen (screenshot exports; GIF starts recording).
async function openSelectionOverlays(mode: CaptureMode): Promise<void> {
  if (focusScrollingCapture()) return
  // Repeated tray/shortcut/second-instance triggers should keep the current selection, not
  // replace it with another frozen copy of the desktop.
  if (session?.mode === mode) return
  if (!(await ensureScreenPermission())) return
  closePickerSession()
  closeSession()

  const displays = screen.getAllDisplays()
  if (displays.length === 0) return

  const started = performance.now()

  // The persistent native helper serves the frame on Windows, handling rotated and HDR
  // displays. Other platforms use desktopCapturer. On Windows an unverified native frame
  // aborts the capture, because Chromium's 8-bit source can silently damage HDR colors.
  let images: (DisplayImage | null)[]
  try {
    images = await captureWithHelper(displays)
  } catch (error) {
    console.error('Could not capture a color-safe desktop frame', error)
    await dialog.showMessageBox({
      type: 'error',
      title: 'Capture unavailable',
      message: 'Capturo could not verify the display colors. Please try the capture again.',
      detail: error instanceof Error ? error.message : undefined
    })
    return
  }

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

  // Read once for the whole session so every overlay agrees on where the pointer was, rather
  // than each sampling it at a slightly different moment as the windows are created.
  const cursor = screen.getCursorScreenPoint()

  const loads: Promise<void>[] = []
  displays.forEach((display, index) => {
    const image = images[index]
    if (!image) return
    for (const region of displayOverlayRegions(display)) {
      loads.push(spawnOverlay(nextSession, display, region, image, cursor))
    }
  })
  try {
    await Promise.all(loads)
  } catch (error) {
    console.error('Could not open capture overlays', error)
    if (session === nextSession) closeSession()
    return
  }

  // The user may cancel while another display's renderer is still loading. That session is
  // finished, not a capture failure, and must not leave a late error dialog behind.
  if (session !== nextSession) return

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

function launchLiveTool(action: () => Promise<void>): Promise<void> {
  return liveToolLaunch.run(async () => {
    try {
      await action()
    } catch (error) {
      console.error('Could not start live tool', error)
      restoreColorWindow()
    }
  })
}

function startCapture(): Promise<void> {
  return launchLiveTool(() => openSelectionOverlays('screenshot'))
}

async function openColorPicker(): Promise<void> {
  if (focusScrollingCapture()) return
  if (pickerSession) return
  if (!(await ensureScreenPermission())) {
    restoreColorWindow()
    return
  }
  closeSession()
  closePickerSession()

  const displays = screen.getAllDisplays()
  if (displays.length === 0) {
    restoreColorWindow()
    return
  }

  const owner: ColorPickerSession = { id: randomUUID(), overlays: new Map() }
  pickerSession = owner
  const cursor = screen.getCursorScreenPoint()
  const loads: Promise<void>[] = []
  if (isMac) {
    for (const display of displays) {
      for (const region of displayOverlayRegions(display)) {
        loads.push(spawnPickerOverlay(owner, display, region, cursor))
      }
    }
  } else {
    // One compact window follows the pointer across displays. Unlike a monitor-sized transparent
    // BrowserWindow, it does not disturb Chromium/DirectComposition video surfaces.
    const display = screen.getDisplayNearestPoint(cursor)
    loads.push(spawnPickerOverlay(
      owner,
      display,
      { rect: floatingPickerRect(cursor, display.bounds, FLOATING_PICKER_MAX_SIZE), role: 'editor' },
      cursor,
      true
    ))
  }
  try {
    await Promise.all(loads)
  } catch (error) {
    console.error('Could not open live colour picker', error)
    if (pickerSession === owner) closePickerSession()
  }
  if (!pickerSession || pickerSession.overlays.size === 0) restoreColorWindow()
}

function startColorPicker(): Promise<void> {
  return launchLiveTool(openColorPicker)
}

function startGifCapture(): Promise<void> {
  if (focusScrollingCapture()) return Promise.resolve()
  if (gifPreviewWindow && !gifPreviewWindow.isDestroyed()) {
    if (gifPreviewWindow.isMinimized()) gifPreviewWindow.restore()
    gifPreviewWindow.show()
    gifPreviewWindow.focus()
    return Promise.resolve()
  }
  return launchLiveTool(() => openSelectionOverlays('gif'))
}

function validSession(event: Electron.IpcMainInvokeEvent, sessionId: string): CaptureSession | null {
  if (!isMainFrameSender(event) || !session || session.id !== sessionId || !session.overlays.has(event.sender.id)) return null
  return session
}

function validPicker(event: Electron.IpcMainInvokeEvent, sessionId: string): ColorPickerSession | null {
  if (!isMainFrameSender(event) || !pickerSession || pickerSession.id !== sessionId || !pickerSession.overlays.has(event.sender.id)) return null
  return pickerSession
}

async function fallbackColorSample(
  display: Electron.Display,
  point: Point,
  size: number
): Promise<ColorSample> {
  try {
    const displays = screen.getAllDisplays()
    const displayIndex = displays.findIndex((candidate) => candidate.id === display.id)
    const sources = await captureSources(displays, [display])
    const source = sourceForDisplay(sources, display, Math.max(0, displayIndex))
    if (!source || source.thumbnail.isEmpty()) return { ok: false }
    const image = source.thumbnail
    const actual = image.getSize()
    const expected = displayPixelSize(display.size, display.scaleFactor)
    const centerX = Math.round(point.x * actual.width / Math.max(1, expected.width))
    const centerY = Math.round(point.y * actual.height / Math.max(1, expected.height))
    const half = Math.floor(size / 2)
    const left = centerX - half
    const top = centerY - half
    const x = Math.max(0, left)
    const y = Math.max(0, top)
    const width = Math.min(size - (x - left), actual.width - x)
    const height = Math.min(size - (y - top), actual.height - y)
    if (width <= 0 || height <= 0) return { ok: false }
    return {
      ok: true,
      width: size,
      height: size,
      png: image.crop({ x, y, width, height }).toPNG(),
      offsetX: x - left,
      offsetY: y - top
    }
  } catch {
    return { ok: false }
  }
}

async function liveColorSample(display: Electron.Display, point: Point, size: number): Promise<ColorSample> {
  if (captureHelperAvailable()) {
    const physical = screen.dipToScreenRect(null, display.bounds)
    const result = await sampleDisplayColor({
      originX: physical.x,
      originY: physical.y,
      centerX: point.x,
      centerY: point.y,
      size
    })
    const pixels = result.pixels
    if (result.ok && typeof pixels === 'string' &&
        pixels.length === size * size * 6 && /^[0-9a-f]+$/i.test(pixels)) {
      return { ok: true, width: size, height: size, pixels }
    }
  }
  return fallbackColorSample(display, point, size)
}

function imageFromDataUrl(dataUrl: string): Electron.NativeImage | null {
  if (!dataUrl.startsWith('data:image/png;base64,')) return null
  const image = nativeImage.createFromDataURL(dataUrl)
  return image.isEmpty() ? null : image
}

async function recognizeAndCopyText(image: Electron.NativeImage): Promise<CopyTextResult> {
  if (!textRecognitionAvailable()) {
    return { copied: false, error: textRecognitionUnavailableMessage(process.platform) }
  }

  const result = await recognizeTextFromPng(image.toPNG())
  if (!result.ok) {
    return { copied: false, error: recognitionFailureMessage(result.stage, process.platform) }
  }

  const text = normalizeRecognizedText(result.text)
  if (!text) return { copied: false, empty: true, error: 'No text was found in this selection.' }

  try {
    clipboard.writeText(text)
  } catch {
    return { copied: false, error: 'Capturo could not write the extracted text to the clipboard.' }
  }
  return { copied: true }
}

// Opt-in developer smoke for the complete app/helper/clipboard path. The recognized contents
// are deliberately not logged; only the copied character and line counts leave the process.
async function runOcrSmoke(imagePath: string): Promise<void> {
  let exitCode = 0
  try {
    const bytes = await fs.readFile(path.resolve(imagePath))
    const image = nativeImage.createFromBuffer(bytes)
    if (image.isEmpty()) throw new Error('input is not a readable image')
    const result = await recognizeAndCopyText(image)
    if (!result.copied) throw new Error(result.error)
    const copied = clipboard.readText()
    if (!copied) throw new Error('clipboard verification returned no text')
    console.error(`[ocr-smoke] copied ${copied.length} characters across ${copied.split('\n').length} line(s)`)
  } catch (error) {
    exitCode = 1
    console.error(`[ocr-smoke] ${error instanceof Error ? error.message : 'failed'}`)
  } finally {
    if (exitCode) app.exit(exitCode)
    else app.quit()
  }
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

// Update checks and permission actions are Settings-window affordances, not capabilities the
// sandboxed capture overlays may reach for. Every one of those handlers proves its sender first.
function fromSettingsWindow(event: Electron.IpcMainInvokeEvent): boolean {
  return ownsWindow(event, settingsWindow)
}

function registerIpc(): void {
  pins = new PinManager({
    preload: path.join(__dirname, '../preload/index.js'), icon: taskbarIcon(),
    load: (window) => {
      const devUrl = rendererUrl()
      return devUrl ? window.loadURL(`${devUrl}/pin.html`) : window.loadFile(path.join(__dirname, '../renderer/pin.html'))
    },
    edit: async (payload, pinWindow): Promise<PinEditResult> => {
      if (detachedEditor && !detachedEditor.window.isDestroyed() && !detachedEditor.revealed) {
        return { opened: false, error: 'A full editor is already opening. Try again shortly.' }
      }
      if (focusExistingDetachedEditor()) {
        return { opened: false, error: 'A full editor is already open. Finish or close it before editing this pin.' }
      }
      const image = nativeImage.createFromBuffer(Buffer.from(payload.png))
      if (image.isEmpty()) return { opened: false, error: 'Capturo could not read this pinned image.' }
      const displayId = String(screen.getDisplayMatching(pinWindow.getBounds()).id)
      const opened = await openDetachedEditorWindow(image, displayId, true)
      return opened ? { opened: true } : { opened: false, error: 'Capturo could not open the full editor.' }
    }
  })
  ipcMain.handle('capture:pin', async (event, sessionId: string, dataUrl: unknown): Promise<PinResult> => {
    const owner = validCaptureOwner(event, sessionId)
    if (!owner || !pins || event.senderFrame !== event.sender.mainFrame) return { opened: false, error: 'This capture is no longer available.' }
    if (owner.kind === 'overlay' && owner.session.overlays.get(event.sender.id)?.payload.role !== 'editor') {
      return { opened: false, error: 'Select a screenshot before pinning it.' }
    }
    if (typeof dataUrl !== 'string' || dataUrl.length > MAX_DETACHED_IMAGE_DATA_URL_CHARS) {
      return { opened: false, error: 'This selection is too large to pin.' }
    }
    const image = imageFromDataUrl(dataUrl)
    if (!image) return { opened: false, error: 'Capturo could not prepare this selection.' }
    const window = BrowserWindow.fromWebContents(event.sender)
    const display = window ? screen.getDisplayMatching(window.getBounds()) : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const result = await pins.open(image, display)
    // Keep Full Tab editable. Release overlays only once the pin has decoded and appeared.
    if (result.opened && owner.kind === 'overlay') setImmediate(() => closeCaptureOwner(owner))
    return result
  })
  ipcMain.handle('settings:get', (event) => fromSettingsWindow(event) ? getSettings() : null)

  // Renderer-owned initialization handshake. Returning the payload from an invoke means the
  // listener and module are already installed, unlike a did-finish-load push that can race the
  // renderer's onInitialize subscription and strand a hidden full editor.
  ipcMain.handle('capture:request-initialization', (event): CapturePayload | null => {
    if (!isMainFrameSender(event)) return null
    const overlay = session?.overlays.get(event.sender.id)
    if (overlay && !overlay.window.isDestroyed()) return overlay.payload
    const editor = detachedEditor
    if (editor && ownsWindow(event, editor.window)) {
      return editor.payload
    }
    return null
  })

  ipcMain.handle('updates:check', (event): Promise<UpdateCheckResult> => {
    if (!fromSettingsWindow(event)) {
      return Promise.resolve({
        status: 'error',
        currentVersion: app.getVersion(),
        message: 'The update check is only available from Capturo Settings.'
      })
    }
    return performUpdateCheck()
  })

  ipcMain.handle('updates:open-releases', (event): Promise<boolean> => {
    if (!fromSettingsWindow(event)) return Promise.resolve(false)
    return openCapturoReleases()
  })

  // Reading the permission is harmless from anywhere, but acting on it is not: requesting can
  // raise a system prompt and opening System Settings pulls the user out of the app.
  ipcMain.handle('permissions:screen-get', (): ScreenAccessState => screenAccessState())

  ipcMain.handle('permissions:screen-request', (event): Promise<ScreenAccessState> => {
    if (!fromSettingsWindow(event)) return Promise.resolve(screenAccessState())
    return requestScreenAccess()
  })

  ipcMain.handle('permissions:screen-open-settings', async (event): Promise<boolean> => {
    if (!fromSettingsWindow(event) || !isMac) return false
    try {
      await shell.openExternal(SCREEN_SETTINGS_URL)
      return true
    } catch {
      return false
    }
  })

  // macOS hands a newly granted permission only to a newly launched app, so restarting is a real
  // step in the flow rather than a workaround. Doing it here saves the user quitting from the
  // tray and finding Capturo again, which is the point at which the grant was most often lost.
  ipcMain.handle('permissions:relaunch', (event): void => {
    if (!fromSettingsWindow(event)) return
    // Tear down deliberately: quitting through app.quit() runs before-quit, which stops the
    // capture helper and releases the global shortcuts the relaunched instance re-registers.
    isQuitting = true
    app.relaunch()
    app.quit()
  })

  // A settings change is persisted immediately. A shortcut change additionally re-registers
  // the global accelerator; if the OS rejects the new one, the stored shortcut and the live
  // registration are both rolled back to the previous working value and the reason is
  // returned so the settings window can show it.
  ipcMain.handle('settings:update', (event, update: SettingsUpdate): SettingsUpdateResult | null => {
    if (!fromSettingsWindow(event)) return null
    const before = getSettings()
    let next = updateSettings(update)
    let shortcutError: string | undefined
    let startupError: string | undefined

    if (next.global.openAtStartup !== before.global.openAtStartup &&
        !applyOpenAtStartup(next.global.openAtStartup)) {
      next = updateSettings({ global: { openAtStartup: before.global.openAtStartup } })
      startupError = `Could not ${update.global?.openAtStartup ? 'enable' : 'disable'} Open on startup. Kept the previous setting.`
    }

    if (next.global.automaticallyCheckForUpdates !== before.global.automaticallyCheckForUpdates) {
      if (next.global.automaticallyCheckForUpdates) scheduleAutomaticUpdateCheck(automaticUpdateDelay(1_000))
      else cancelAutomaticUpdateCheck()
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
    if (next.colorPicker.shortcut !== before.colorPicker.shortcut &&
        !applyShortcut('colorPicker', next.colorPicker.shortcut)) {
      next = updateSettings({ colorPicker: { shortcut: before.colorPicker.shortcut } })
      shortcutError = `${formatAccelerator(update.colorPicker?.shortcut ?? '', isMac)} is unavailable. Kept ${formatAccelerator(before.colorPicker.shortcut, isMac)}.`
    }
    refreshTray()
    return { settings: next, shortcutError, startupError }
  })

  ipcMain.handle('capture:ready', (event, sessionId: string) => {
    const active = validSession(event, sessionId)
    const entry = active?.overlays.get(event.sender.id)
    if (entry && !entry.window.isDestroyed()) {
      revealOverlay(entry)
      return true
    }
    const editor = detachedEditor
    if (!editor || editor.id !== sessionId || !ownsWindow(event, editor.window)) return false
    if (!editor.revealed) {
      editor.revealed = true
      editor.window.show()
      editor.window.focus()
    }
    settleDetachedEditorReady(editor, true)
    return true
  })

  // Claiming closes the other displays, but not the fillers of the claimed display: those
  // cover its taskbar strip and remain part of the same capture surface.
  ipcMain.handle('capture:claim', (event, sessionId: string) => {
    if (detachedEditor?.id === sessionId && ownsWindow(event, detachedEditor.window)) return true
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
    if (!isMainFrameSender(event) || !session || session.id !== sessionId) return
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
    const owner = validCaptureOwner(event, sessionId)
    if (owner) {
      closeCaptureOwner(owner)
      return
    }
    if (!validSession(event, sessionId)) return
    closeSession()
    // Cancelling out of a Pick again puts the colour window back, still holding its colour.
    restoreColorWindow()
  })

  ipcMain.handle('color:picker-ready', (event, sessionId: string) => {
    const active = validPicker(event, sessionId)
    const entry = active?.overlays.get(event.sender.id)
    if (!entry || entry.window.isDestroyed()) return false
    if (entry.payload.nativeInput && !activateWindowsPickerInput(active!, entry)) {
      closePickerSession()
      restoreColorWindow()
      return false
    }
    if (!entry.payload.nativeInput) revealPickerOverlay(entry)
    return true
  })

  // Transparent Windows surfaces can miss pointer events while their compositor position changes.
  // Read the physical pointer independently so the compact magnifier can keep following it.
  ipcMain.handle('color:picker-cursor', (event, sessionId: string): Point | null => {
    if (!validPicker(event, sessionId)) return null
    return screen.getCursorScreenPoint()
  })

  ipcMain.handle('color:picker-recenter', (event, sessionId: string, request: unknown) => {
    const active = validPicker(event, sessionId)
    const entry = active?.overlays.get(event.sender.id)
    if (!active || !entry || entry.window.isDestroyed() || !entry.payload.floating) return false
    if (!request || typeof request !== 'object') return false
    const { cursor: rawCursor, center: rawCenter, displayId } = request as {
      cursor?: Partial<Point>; center?: Partial<Point>; displayId?: string
    }
    if (!rawCursor || !rawCenter ||
        !Number.isFinite(rawCursor.x) || !Number.isFinite(rawCursor.y) ||
        !Number.isFinite(rawCenter.x) || !Number.isFinite(rawCenter.y)) return false
    const cursor = { x: Math.round(rawCursor.x as number), y: Math.round(rawCursor.y as number) }
    const center = { x: Math.round(rawCenter.x as number), y: Math.round(rawCenter.y as number) }
    if (displayId !== entry.payload.displayId) return false
    const displayPoint = entry.payload.nativeInput ? center : cursor
    const display = screen.getAllDisplays().find((candidate) => cursorForDisplay(displayPoint, candidate.bounds) !== null)
    if (!display) return false

    // Balance the compact surface between the physical pointer and Capturo's slowed owned point.
    // Centring only on the physical cursor gives zoom-scaled movement half as much usable separation and
    // forces an abrupt one-to-one catch-up when a fast sweep reaches that limit.
    const rect = floatingPickerRect(center, display.bounds, FLOATING_PICKER_MAX_SIZE)
    const currentBounds = entry.window.getBounds()
    if (currentBounds.x !== rect.x || currentBounds.y !== rect.y ||
        currentBounds.width !== rect.width || currentBounds.height !== rect.height) {
      entry.window.setBounds(rect)
    }
    if (String(display.id) !== entry.payload.displayId) {
      // Crossing a display changes both the DIP-to-device-pixel scale and the native output the
      // sample request must address. Reinitialize the same small window in the new coordinate
      // space instead of creating monitor-sized surfaces ahead of time.
      entry.payload = buildPickerPayload(
        active.id,
        display,
        { rect, role: 'editor' },
        cursor,
        true
      )
      entry.window.webContents.send('color:picker-initialize', entry.payload)
    } else {
      // Keep main's payload consistent with the renderer's predicted origin without forcing a
      // reinitialization that would reset zoom-scaled displacement on every window move.
      entry.payload = {
        ...entry.payload,
        regionOrigin: { x: rect.x - display.bounds.x, y: rect.y - display.bounds.y }
      }
    }
    return true
  })

  ipcMain.handle('color:sample', async (event, sessionId: string, point: unknown, size: unknown) => {
    const active = validPicker(event, sessionId)
    const entry = active?.overlays.get(event.sender.id)
    const validSize = typeof size === 'number' && PICKER_ZOOM_LEVELS.some((level) => level.cells === size)
    if (!active || !entry || !point || typeof point !== 'object' || !validSize) return { ok: false }
    const { x, y } = point as Partial<Point>
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false }
    const px = Math.round(x as number)
    const py = Math.round(y as number)
    if (px < 0 || py < 0 || px >= entry.payload.imageSize.width || py >= entry.payload.imageSize.height) {
      return { ok: false }
    }
    const display = screen.getAllDisplays().find((candidate) => String(candidate.id) === entry.payload.displayId)
    if (!display) return { ok: false }
    return liveColorSample(display, { x: px, y: py }, size)
  })

  ipcMain.handle('color:picker-cancel', (event, sessionId: string) => {
    if (!validPicker(event, sessionId)) return
    closePickerSession()
    restoreColorWindow()
  })

  // Only an overlay of the live picker session may report a colour, and the value is clamped here
  // rather than trusted: it crosses a process boundary and ends up in the clipboard.
  ipcMain.handle('color:pick', (event, sessionId: string, color: unknown) => {
    const active = validPicker(event, sessionId)
    if (!active) return false
    if (!color || typeof color !== 'object') return false
    const { r, g, b } = color as Partial<Rgb>
    if (typeof r !== 'number' || typeof g !== 'number' || typeof b !== 'number') return false

    const value = normalizeRgb({ r, g, b })
    closePickerSession()

    // Copying is the point of picking a colour, so it happens without a second action unless the
    // user has turned that off in Settings. The window still opens on top of it for adjusting,
    // converting, or picking a neighbour, and it reports whether the write actually landed rather
    // than claiming it did.
    const picker = getSettings().colorPicker
    let copied: string | null = null
    if (picker.copyOnPick) {
      const text = formatColor(value, picker.copyFormat)
      try {
        clipboard.writeText(text)
        copied = text
      } catch {
        copied = null
      }
    }

    openColorWindow({ color: value, copied, format: picker.copyFormat })
    logTiming(`color picked ${rgbToHex(value)}${copied ? ` and copied ${copied}` : ''}`)
    return true
  })

  // Only the colour window may copy, and only text. Nothing here can name a file or a format
  // other than plain text.
  ipcMain.handle('color:copy', (event, text: unknown) => {
    if (!ownsWindow(event, colorWindow)) return false
    if (typeof text !== 'string' || !text || text.length > 64) return false
    try {
      clipboard.writeText(text)
    } catch {
      return false
    }
    return true
  })

  ipcMain.handle('color:pick-again', (event) => {
    if (!ownsWindow(event, colorWindow)) return

    // Hide the result window for the duration of the pick so the user can reach the pixels behind
    // it. The live picker does not take a frozen frame, so there is no compositor-settle delay.
    colorWindowHiddenForPick = true
    colorWindow.setOpacity(0)
    colorWindow.hide()
    void startColorPicker().then(() => {
      if (!pickerSession) restoreColorWindow()
    })
  })

  // Panoramic capture begins from an ordinary screenshot selection. The recorder infers a safe
  // cardinal movement from every pair of frames, so one session can change between up, down,
  // left, and right without a direction prompt.
  ipcMain.handle(
    'scroll:start',
    async (event, sessionId: string, region: Rect): Promise<StartScrollCaptureResult> => {
      const active = validSession(event, sessionId)
      const entry = active?.overlays.get(event.sender.id)
      if (!active || active.mode !== 'screenshot' || !entry || entry.payload.role !== 'editor') {
        return { started: false, error: 'This capture is no longer available.' }
      }
      if (!panoramicCaptureSupported) {
        return { started: false, error: 'Panoramic capture is not available on this platform.' }
      }
      if (focusExistingDetachedEditor()) {
        return { started: false, error: 'Close the existing full editor before starting a panoramic capture.' }
      }
      if (!region || !Number.isFinite(region.x) || !Number.isFinite(region.y) ||
          !Number.isFinite(region.width) || !Number.isFinite(region.height) ||
          region.width < 8 || region.height < 8 ||
          region.x < 0 || region.y < 0 ||
          region.x + region.width > entry.payload.imageWidth + 1 ||
          region.y + region.height > entry.payload.imageHeight + 1) {
        return { started: false, error: 'Select a valid viewport before starting Panoramic Scrolling.' }
      }

      const display = screen.getAllDisplays().find((candidate) => String(candidate.id) === entry.payload.displayId)
      if (!display) return { started: false, error: 'The selected display is no longer available.' }
      const payload: ScrollCapturePayload = {
        crop: {
          x: region.x / entry.payload.imageWidth,
          y: region.y / entry.payload.imageHeight,
          width: region.width / entry.payload.imageWidth,
          height: region.height / entry.payload.imageHeight
        }
      }
      if (!placeControlBarOutside(
        display,
        regionInDip(display, payload.crop),
        PANORAMIC_CONTROL_WIDTH,
        PANORAMIC_CONTROL_HEIGHT
      )) {
        return {
          started: false,
          error: 'Leave at least 66 pixels above or below the selected viewport for the panoramic-capture controls.'
        }
      }
      closeSession()
      openScrollingWindow(display, payload)
      return { started: true }
    }
  )

  ipcMain.handle('scroll:request-initialization', (event): ScrollCapturePayload | null => {
    if (!scrollingPayload || !ownsWindow(event, scrollingWindow)) return null
    return scrollingPayload
  })

  // The pointer stays visible throughout a panoramic session: hiding it inside the selected
  // viewport made the live application feel broken. Capturo instead reports where it is, and the
  // recorder treats that footprint as untrusted coverage, so the pointer is excluded from the
  // output the way the frozen screenshot path never records one at all. The reported area extends
  // one pointer radius past every edge, because a bitmap whose hotspot sits just outside the
  // region still paints into it. See D-042.
  ipcMain.handle('scroll:cursor-position', (event): PanoramicPointer | null => {
    if (!scrollingPayload || !ownsWindow(event, scrollingWindow)) return null
    const display = screen.getAllDisplays().find((candidate) => String(candidate.id) === scrollingTargetDisplayId)
    if (!display) return null
    const region = regionInDip(display, scrollingPayload.crop)
    if (region.width <= 0 || region.height <= 0) return null
    const radius = PANORAMIC_POINTER_RADIUS_DIP
    const cursor = screen.getCursorScreenPoint()
    if (cursor.x < region.x - radius || cursor.x >= region.x + region.width + radius ||
        cursor.y < region.y - radius || cursor.y >= region.y + region.height + radius) return null
    return {
      x: (cursor.x - region.x) / region.width,
      y: (cursor.y - region.y) / region.height,
      radiusX: radius / region.width,
      radiusY: radius / region.height
    }
  })

  ipcMain.handle('scroll:finish', async (event, png: ArrayBuffer): Promise<FinishScrollCaptureResult> => {
    if (!ownsWindow(event, scrollingWindow)) {
      return { opened: false, error: 'The panoramic capture is no longer active.' }
    }
    if (!(png instanceof ArrayBuffer) || png.byteLength === 0 || png.byteLength > 512 * 1024 * 1024) {
      return { opened: false, error: 'The stitched image is too large to open.' }
    }
    const image = nativeImage.createFromBuffer(Buffer.from(png))
    if (image.isEmpty()) return { opened: false, error: 'Capturo could not decode the stitched image.' }
    const displayId = scrollingTargetDisplayId
    if (!displayId) return { opened: false, error: 'The captured display is no longer available.' }

    // Keep the control renderer alive until the detached editor acknowledges readiness. This lets
    // it surface a useful error and retry instead of disappearing if the editor fails to load.
    const activeWindow = scrollingWindow
    activeWindow.hide()
    setScrollingOutlineVisible(false)
    // A two-dimensional route can leave uncaptured transparent space inside its bounding box.
    // Preserve that truth in the full editor and all subsequent saves.
    if (!(await openDetachedEditorWindow(image, displayId, true))) {
      if (scrollingWindow === activeWindow && !activeWindow.isDestroyed()) {
        activeWindow.show()
        activeWindow.focus()
        setScrollingOutlineVisible(true)
      }
      return { opened: false, error: 'Capturo could not open the stitched image in the full editor.' }
    }
    closeScrollingCapture()
    return { opened: true }
  })

  ipcMain.handle('scroll:cancel', (event) => {
    if (ownsWindow(event, scrollingWindow)) closeScrollingCapture()
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

  // The recording window finished encoding. Keep the bytes in memory and replace recording
  // chrome with a review window; saving and copying are now explicit preview actions.
  ipcMain.handle('gif:show-preview', async (event, bytes: ArrayBuffer): Promise<boolean> => {
    if (!ownsWindow(event, recordingWindow)) return false
    const encoded = bytes instanceof ArrayBuffer ? Buffer.from(bytes) : Buffer.alloc(0)
    if (!hasGifSignature(encoded)) {
      closeRecording()
      notify('GIF unavailable', 'Capturo could not finish this recording.')
      return false
    }
    // Smoke automation deliberately retains its fixed-file output and does not open UI.
    if (isGifRecordSmoke) {
      const smokePath = path.join(app.getPath('temp'), 'capturo-smoke.gif')
      await fs.writeFile(smokePath, encoded)
      console.error(`[gif-smoke] saved ${encoded.byteLength} bytes to ${smokePath}`)
      closeRecording()
      return true
    }
    closeRecording()
    openGifPreview(encoded)
    return true
  })

  ipcMain.handle('gif:preview-save', async (event): Promise<GifPreviewActionResult> => {
    const preview = validGifPreview(event)
    if (!preview || !gifPreviewWindow) return { ok: false, error: 'The GIF preview is no longer available.' }
    const result = await dialog.showSaveDialog(gifPreviewWindow, {
      title: 'Save GIF',
      defaultPath: preview.savedPath ?? path.join(app.getPath('pictures'), `Capturo ${fileTimestamp()}.gif`),
      filters: [{ name: 'GIF image', extensions: ['gif'] }]
    })
    if (result.canceled || !result.filePath) return { ok: false, canceled: true }
    const extension = path.extname(result.filePath)
    const filePath = extension.toLowerCase() === '.gif'
      ? result.filePath
      : `${result.filePath.slice(0, result.filePath.length - extension.length)}.gif`
    try {
      await fs.writeFile(filePath, preview.bytes)
      preview.savedPath = filePath
      notify('GIF saved', path.basename(filePath))
      return { ok: true, filePath }
    } catch {
      return { ok: false, error: 'Capturo could not write the GIF to that location.' }
    }
  })

  ipcMain.handle('gif:preview-copy', async (event): Promise<GifPreviewActionResult> => {
    const preview = validGifPreview(event)
    if (!preview) return { ok: false, error: 'The GIF preview is no longer available.' }
    try {
      // Linux and anything else: raw bytes under the MIME type, which is all its clipboard
      // conventions offer. Windows and macOS both copy the GIF as a *file*, below, so the
      // animation survives instead of being flattened to a still frame.
      if (!isMac && process.platform !== 'win32') {
        clipboard.writeBuffer('image/gif', preview.bytes)
        return { ok: true }
      }

      let copyPath = preview.savedPath
      if (copyPath) {
        try {
          await fs.access(copyPath)
        } catch {
          copyPath = null
        }
      }
      if (!copyPath) {
        const clipboardDirectory = path.join(app.getPath('temp'), 'Capturo', 'Clipboard')
        await fs.mkdir(clipboardDirectory, { recursive: true })
        copyPath = preview.clipboardPath ?? path.join(
          clipboardDirectory,
          `Capturo ${fileTimestamp()} ${randomUUID().slice(0, 8)}.gif`
        )
        await fs.writeFile(copyPath, preview.bytes)
        preview.clipboardPath = copyPath
      }
      if (isMac) {
        // The macOS counterpart of Windows' CF_HDROP. `public.file-url` is the pasteboard type
        // Finder, Mail, Messages and the like read, and because it references the .gif itself the
        // animation is preserved; raw image data would be flattened to a still frame by whatever
        // conversion the receiving app picks.
        //
        // The previous type here, `public.gif`, is not a real UTI — macOS silently accepted the
        // write and left the pasteboard empty, so Copy reported success and pasted nothing. The
        // read-back below is what makes that class of failure impossible to report as success.
        clipboard.writeBuffer('public.file-url', Buffer.from(`file://${encodeURI(copyPath)}`, 'utf8'))
        if (clipboard.readBuffer('public.file-url').length === 0) {
          return { ok: false, error: 'Capturo could not place the animated GIF file on the clipboard.' }
        }
        return { ok: true, filePath: copyPath }
      }

      if (!(await copyFileToClipboard(copyPath))) {
        return { ok: false, error: 'Capturo could not place the animated GIF file on the clipboard.' }
      }
      return { ok: true, filePath: copyPath }
    } catch {
      return { ok: false, error: 'Capturo could not prepare the GIF for copying.' }
    }
  })

  ipcMain.handle('gif:preview-open-folder', async (event): Promise<GifPreviewActionResult> => {
    const preview = validGifPreview(event)
    if (!preview?.savedPath) return { ok: false, error: 'Save the GIF before opening its folder.' }
    try {
      await fs.access(preview.savedPath)
      shell.showItemInFolder(preview.savedPath)
      return { ok: true, filePath: preview.savedPath }
    } catch {
      return { ok: false, error: 'The saved GIF is no longer at that location.' }
    }
  })

  ipcMain.handle('gif:preview-retake', (event) => {
    if (!validGifPreview(event)) return
    closeGifPreview()
    setImmediate(() => void startGifCapture())
  })

  ipcMain.handle('gif:preview-discard', (event) => {
    if (validGifPreview(event)) closeGifPreview()
  })

  ipcMain.handle('gif:cancel', (event) => {
    if (ownsWindow(event, recordingWindow)) {
      if (isGifRecordSmoke) console.error('[gif-smoke] recording canceled (no frames or getDisplayMedia failed)')
      closeRecording()
    }
  })

  // A renderer could not open its capture stream. Tear the session down rather than
  // leaving an invisible overlay holding the pointer.
  ipcMain.handle('capture:failed', (event, sessionId: string) => {
    const owner = validCaptureOwner(event, sessionId)
    if (owner) closeCaptureOwner(owner)
    else if (validSession(event, sessionId)) closeSession()
    else return
    notify('Capture unavailable', 'Capturo could not read an image from the display.')
  })

  ipcMain.handle(
    'capture:open-detached',
    async (
      event,
      sessionId: string,
      dataUrl: string,
      forcePng: boolean
    ): Promise<OpenDetachedEditorResult> => {
      const active = validSession(event, sessionId)
      const entry = active?.overlays.get(event.sender.id)
      if (!active || active.mode !== 'screenshot' || !entry || entry.payload.role !== 'editor') {
        return { opened: false, error: 'This capture is no longer available.' }
      }
      if (focusExistingDetachedEditor()) {
        return { opened: false, error: 'A full editor is already open. Finish or close it before opening another.' }
      }
      if (typeof dataUrl !== 'string' || dataUrl.length > MAX_DETACHED_IMAGE_DATA_URL_CHARS) {
        return { opened: false, error: 'This selection is too large to open in the full editor.' }
      }
      const image = imageFromDataUrl(dataUrl)
      if (!image) return { opened: false, error: 'Capturo could not prepare this selection.' }

      const opened = await openDetachedEditorWindow(image, entry.payload.displayId, forcePng === true)
      if (!opened) return { opened: false, error: 'Capturo could not open the full editor.' }

      // Let the invoke response reach the overlay before destroying its webContents. The new
      // editor is already loaded and will reveal only after its selected image is decoded.
      setImmediate(() => {
        if (session === active) closeSession()
      })
      return { opened: true }
    }
  )

  ipcMain.handle('capture:copy', (event, sessionId: string, dataUrl: string) => {
    const owner = validCaptureOwner(event, sessionId)
    if (!owner) return false
    const image = imageFromDataUrl(dataUrl)
    if (!image) return false
    clipboard.writeImage(image)
    closeCaptureOwner(owner)
    notify('Copied to clipboard', 'Your screenshot is ready to paste.')
    return true
  })

  ipcMain.handle(
    'capture:copy-text',
    async (event, sessionId: string, dataUrl: string): Promise<CopyTextResult> => {
      if (typeof dataUrl !== 'string' || dataUrl.length > MAX_OCR_DATA_URL_CHARS) {
        return { copied: false, error: 'This selection is too large for text extraction.' }
      }
      const owner = validCaptureOwner(event, sessionId)
      const image = imageFromDataUrl(dataUrl)
      if (!owner || !image) {
        return { copied: false, error: 'The selected image is no longer available.' }
      }
      const result = await recognizeAndCopyText(image)
      if (!result.copied) return result
      closeCaptureOwner(owner)
      notify('Text copied to clipboard', 'Extracted text is ready to paste.')
      return { copied: true }
    }
  )

  ipcMain.handle(
    'capture:save',
    async (event, sessionId: string, dataUrl: string, forcePng = false): Promise<SaveResult> => {
      const captureOwner = validCaptureOwner(event, sessionId)
      const image = imageFromDataUrl(dataUrl)
      if (!captureOwner || !image) return { saved: false, canceled: false }
      const dialogOwner = BrowserWindow.fromWebContents(event.sender) ?? undefined
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
      const result = dialogOwner ? await dialog.showSaveDialog(dialogOwner, options) : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return { saved: false, canceled: true }
      const chosenPath = forcePng
        ? (path.extname(result.filePath).toLowerCase() === '.png'
            ? result.filePath
            : `${result.filePath.slice(0, result.filePath.length - path.extname(result.filePath).length)}.png`)
        : result.filePath
      await fs.writeFile(chosenPath, forcePng ? image.toPNG() : encodeCapture(image, chosenPath, settings))
      closeCaptureOwner(captureOwner)
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

function closeScrollingCapture(): void {
  const window = scrollingWindow
  scrollingWindow = null
  scrollingTargetDisplayId = null
  scrollingPayload = null
  closeScrollingOutline()
  if (window && !window.isDestroyed()) window.destroy()
}

// A thin cyan ring around the selected viewport, with a transparent, click-through centre. The
// painted band clears the crop by PANORAMIC_OUTLINE_GAP device-independent pixels, further than
// display-capture rounding reaches back across, so the indicator stays capturable rather than
// content-protected. Do not rebuild this as separate thin strips: Windows inflates a window that
// small, and the inflated top strip lands inside the captured region.
function openScrollingOutline(region: Rect): void {
  closeScrollingOutline()
  scrollingOutlineWindow = createChromeWindow(
    panoramicOutlineRect(region),
    `height:100vh;box-sizing:border-box;border:${PANORAMIC_OUTLINE_THICKNESS}px solid rgba(56,189,248,0.9)`,
    false
  )
}

function closeScrollingOutline(): void {
  const outline = scrollingOutlineWindow
  scrollingOutlineWindow = null
  if (outline && !outline.isDestroyed()) outline.destroy()
}

function setScrollingOutlineVisible(visible: boolean): void {
  const outline = scrollingOutlineWindow
  if (!outline || outline.isDestroyed()) return
  if (visible) outline.showInactive()
  else outline.hide()
}

function focusScrollingCapture(): boolean {
  const window = scrollingWindow
  if (!window || window.isDestroyed()) return false
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  return true
}

async function cleanupExpiredGifClipboardFiles(): Promise<void> {
  const directory = path.join(app.getPath('temp'), 'Capturo', 'Clipboard')
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    await Promise.all(entries.map(async (entry) => {
      if (!entry.isFile()) return
      const filePath = path.join(directory, entry.name)
      const stats = await fs.stat(filePath)
      if (isExpiredGifClipboardFile(entry.name, stats.mtimeMs)) await fs.unlink(filePath)
    }))
  } catch {
    // The directory normally does not exist until an unsaved preview is copied.
  }
}

function validGifPreview(event: Electron.IpcMainInvokeEvent): GifPreviewState | null {
  return gifPreviewState && ownsWindow(event, gifPreviewWindow) ? gifPreviewState : null
}

function closeGifPreview(): void {
  const window = gifPreviewWindow
  gifPreviewWindow = null
  gifPreviewState = null
  if (window && !window.isDestroyed()) window.destroy()
}

function openGifPreview(bytes: Buffer): void {
  closeGifPreview()
  gifPreviewState = { bytes, savedPath: null, clipboardPath: null }

  const window = createAppWindow({
    width: 820,
    height: 620,
    minWidth: 620,
    minHeight: 460,
    title: 'Capturo GIF Preview',
    icon: taskbarIcon(),
    backgroundColor: '#080c13',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  gifPreviewWindow = window
  window.on('closed', () => {
    if (gifPreviewWindow === window) {
      gifPreviewWindow = null
      gifPreviewState = null
    }
  })
  window.webContents.on('did-finish-load', () => {
    if (window.isDestroyed() || gifPreviewWindow !== window || !gifPreviewState) return
    const source = gifPreviewState.bytes
    const payloadBytes = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer
    window.webContents.send('gif:preview-init', { bytes: payloadBytes, byteLength: source.byteLength })
    if (isGifPreviewScreenshot) {
      setTimeout(() => {
        if (window.isDestroyed()) return
        void window.capturePage().then((image) => {
          const output = path.join(app.getPath('temp'), 'capturo-gif-preview-smoke.png')
          return fs.writeFile(output, image.toPNG()).then(() => {
            console.error(`[gif-preview-smoke] screenshot ${output}`)
          })
        })
      }, 1000)
    }
  })
  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) {
      window.show()
      window.focus()
    }
  })

  const devUrl = rendererUrl()
  if (devUrl) void window.loadURL(`${devUrl}/gif-preview.html`)
  else void window.loadFile(path.join(__dirname, '../renderer/gif-preview.html'))
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
function createChromeWindow(rect: Rect, bodyStyle: string, protectFromCapture = true): BrowserWindow {
  const bounds = integerRect(rect)
  const window = createAppWindow({
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
    // macOS clamps an ordinary window into the screen's visible frame, which would slide chrome
    // requested over the menu bar or the Dock back inside the work area. A panoramic outline is
    // drawn just outside the recorded crop, so that slide would move the painted band into the
    // crop and stitch it into the output. Opting out keeps every ring exactly where it was asked
    // for. macOS-only in Electron; ignored elsewhere. See D-029 and D-042.
    enableLargerThanScreen: isMac,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  // BrowserWindow construction may expand a transparent frameless window on Windows. Reapply
  // the requested outer bounds so adjacent shade strips and the selection ring remain exact.
  window.setBounds(bounds)
  window.setAlwaysOnTop(true, 'screen-saver')
  window.setContentProtection(protectFromCapture)
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

// The area a floating control bar may occupy on this display. Windows may use the whole display,
// but macOS must stay inside the work area: AppKit pushes a window requested over the menu bar or
// the Dock back into the visible frame, and for a panoramic session that reflow can drop the bar
// inside the recorded crop. See D-029 and D-042.
function controlBarBounds(display: Electron.Display): Rect {
  return isMac ? display.workArea : display.bounds
}

// Puts the control bar just above the region, else just below, else inside its top edge.
// It is always horizontally centred on the region and kept within the usable bounds.
function placeControlBar(display: Electron.Display, region: Rect, width: number, height: number): Point {
  return controlBarPlacement(controlBarBounds(display), region, width, height)
}

function placeControlBarOutside(display: Electron.Display, region: Rect, width: number, height: number): Point | null {
  return controlBarPlacementOutside(controlBarBounds(display), region, width, height)
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

// A user-driven panoramic capture leaves the selected application interactive and records only its
// viewport. The control bar and the viewport outline both live entirely outside that crop, because
// panoramic chrome inside it would be captured: content protection is not an option here, since
// excluding a window from capture can stall the Windows display-media stream this session reads.
// The outline's clearance gap is what keeps display-capture rounding from reaching it. See D-042.
function openScrollingWindow(display: Electron.Display, payload: ScrollCapturePayload): void {
  closeRecording()
  closeScrollingCapture()
  scrollingTargetDisplayId = String(display.id)
  scrollingPayload = payload

  const region = regionInDip(display, payload.crop)
  const width = PANORAMIC_CONTROL_WIDTH
  const height = PANORAMIC_CONTROL_HEIGHT
  const position = placeControlBarOutside(display, region, width, height)
  if (!position) {
    closeScrollingCapture()
    return
  }
  const { x, y } = position
  const bounds = integerRect({ x, y, width, height })
  const window = createAppWindow({
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
      sandbox: true,
      backgroundThrottling: false
    }
  })
  window.setBounds(bounds)
  scrollingWindow = window
  openScrollingOutline(region)
  window.setAlwaysOnTop(true, 'screen-saver')
  window.on('closed', () => {
    if (scrollingWindow === window) {
      scrollingWindow = null
      scrollingTargetDisplayId = null
      scrollingPayload = null
      closeScrollingOutline()
    }
  })
  window.once('ready-to-show', () => {
    void prepareRecordingChrome(window).finally(() => {
      if (!window.isDestroyed()) {
        window.show()
        window.focus()
      }
    })
  })

  const devUrl = rendererUrl()
  const load = devUrl
    ? window.loadURL(`${devUrl}/scroll-record.html`)
    : window.loadFile(path.join(__dirname, '../renderer/scroll-record.html'))
  void load.catch((error) => {
    console.error('Could not open panoramic capture controls', error)
    if (scrollingWindow === window) closeScrollingCapture()
  })
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
  const window = createAppWindow({
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
    (request, callback) => {
      const owner = ownsDisplayMediaRequest(request, recordingWindow)
        ? recordingWindow
        : ownsDisplayMediaRequest(request, scrollingWindow) ? scrollingWindow : null
      const displayId = owner === recordingWindow ? recordingTargetDisplayId :
        owner === scrollingWindow ? scrollingTargetDisplayId : null
      if (!owner || !displayId) {
        callback({})
        return
      }
      void permittedDisplayMediaSource(
        request,
        owner,
        displayId,
        () => desktopCapturer.getSources({ types: ['screen'] }),
        () => owner === recordingWindow && recordingTargetDisplayId === displayId ||
          owner === scrollingWindow && scrollingTargetDisplayId === displayId,
        () => isOnlyConnectedDisplay(screen.getAllDisplays(), displayId)
      ).then((source) => callback(source ? { video: source } : {}))
    },
    { useSystemPicker: false }
  )
}

function shortcutHandler(kind: ShortcutKind): () => void {
  if (kind === 'gif') return () => void startGifCapture()
  if (kind === 'colorPicker') return () => void startColorPicker()
  return () => void startCapture()
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
  if (!applyShortcut('colorPicker', settings.colorPicker.shortcut) &&
      settings.colorPicker.shortcut !== DEFAULT_COLOR_PICKER_SHORTCUT &&
      applyShortcut('colorPicker', DEFAULT_COLOR_PICKER_SHORTCUT)) {
    updateSettings({ colorPicker: { shortcut: DEFAULT_COLOR_PICKER_SHORTCUT } })
  }
}

// The tray tooltip and menu both surface the version and the live capture shortcut, so the
// running build and its binding can be read without opening anything.
function refreshTray(): void {
  if (!tray) return
  const version = app.getVersion()
  const settings = getSettings()
  tray.setToolTip(`Capturo ${version}: ${formatAccelerator(settings.capture.captureShortcut, isMac)} to capture`)
  trayMenu = Menu.buildFromTemplate([
    { label: 'New screenshot', accelerator: settings.capture.captureShortcut, click: () => void startCapture() },
    { label: 'New GIF', accelerator: settings.gif.shortcut, click: () => void startGifCapture() },
    { label: 'Color picker', accelerator: settings.colorPicker.shortcut, click: () => void startColorPicker() },
    { label: 'Settings…', click: () => openSettings() },
    ...(availableUpdateVersion
      ? [{ label: `Update available: v${availableUpdateVersion}`, click: () => void openCapturoReleases() }]
      : []),
    { type: 'separator' },
    { label: `Version ${version}`, enabled: false },
    { label: 'Quit Capturo', click: () => { isQuitting = true; app.quit() } }
  ])
  // On Windows an assigned context menu belongs to the secondary button and the primary button
  // still only emits 'click'. On macOS assigning one makes the primary button open the menu too,
  // so a menu-bar click would open the menu *and* start a capture at the same time. There the
  // menu is left unassigned and popped up explicitly from the secondary click. See D-030.
  if (!isMac) tray.setContextMenu(trayMenu)
}

function popUpTrayMenu(): void {
  if (tray && !tray.isDestroyed() && trayMenu) tray.popUpContextMenu(trayMenu)
}

function createTray(): void {
  tray = new Tray(trayImage())
  refreshTray()
  tray.on('click', (event) => {
    // macOS treats Control-click as a secondary click, so it opens the menu rather than capturing.
    if (isMac && event.ctrlKey) {
      popUpTrayMenu()
      return
    }
    void startCapture()
  })
  if (isMac) tray.on('right-click', () => popUpTrayMenu())
}

// A small, framed, on-demand preferences window. Reused if already open. It is not a
// resident surface: closing it destroys it and the app stays tray-only. See D-016.
// Opens (or reuses) the window that shows a picked colour. Deliberately a plain window rather
// than an overlay: the colour outlives the capture session, and the user is expected to sit in it
// adjusting sliders and copying values while doing something else.
function openColorWindow(picked: PickedColor): void {
  pickedColor = picked
  colorWindowHiddenForPick = false

  if (colorWindow && !colorWindow.isDestroyed()) {
    if (colorWindow.isMinimized()) colorWindow.restore()
    colorWindow.show()
    // Cleared in case this pick came from a Pick again, which hides the window by dropping its
    // opacity to zero first.
    colorWindow.setOpacity(1)
    colorWindow.focus()
    colorWindow.webContents.send('color:initialize', pickedColor)
    return
  }

  const window = createAppWindow({
    width: 340,
    height: 560,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Capturo Color',
    icon: taskbarIcon(),
    backgroundColor: '#171b22',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  colorWindow = window
  window.on('closed', () => {
    if (colorWindow === window) {
      colorWindow = null
      pickedColor = null
    }
  })
  window.once('ready-to-show', () => window.show())
  window.webContents.on('did-finish-load', () => {
    if (!window.isDestroyed() && pickedColor) window.webContents.send('color:initialize', pickedColor)
  })

  const devUrl = rendererUrl()
  if (devUrl) void window.loadURL(`${devUrl}/color.html`)
  else void window.loadFile(path.join(__dirname, '../renderer/color.html'))
}

function openSettings(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) settingsWindow.restore()
    settingsWindow.show()
    settingsWindow.focus()
    return
  }

  const window = createAppWindow({
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
  if (isSettingsScreenshot) {
    window.webContents.once('did-finish-load', () => {
      void window.webContents.executeJavaScript(
        `document.querySelector('[data-tab="${settingsScreenshotTab}"]')?.click();` +
        (isSettingsUpdateCheckSmoke ? "document.querySelector('#check-updates')?.click();" : '')
      ).then(() => new Promise<void>((resolve) => setTimeout(resolve, isSettingsUpdateCheckSmoke ? 2_000 : 250)))
        .then(() => window.capturePage())
        .then((image) => {
          const output = path.join(app.getPath('temp'), `capturo-${settingsScreenshotTab}-settings-smoke.png`)
          return fs.writeFile(output, image.toPNG()).then(() => {
            console.error(`[settings-smoke] screenshot ${output}`)
          })
        })
    })
  }

  const devUrl = rendererUrl()
  if (devUrl) void window.loadURL(`${devUrl}/settings.html`)
  else void window.loadFile(path.join(__dirname, '../renderer/settings.html'))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => void startCapture())
  app.whenReady().then(async () => {
    if (process.platform === 'win32') app.setAppUserModelId('com.capturo.app')
    if (isMac) app.dock?.hide()
    // Capturo does not expose spelling suggestions or a dictionary UI. Electron otherwise
    // enables its spellchecker by default, which can make Windows initialise
    // Microsoft/Spelling/neutral cache directories in the process working directory when the
    // OS returns a malformed dictionary base path. Keep the service off before any renderer is
    // created so those unrelated cache trees cannot reappear beside the source code.
    electronSession.defaultSession.setSpellCheckerEnabled(false)
    // The OCR smoke runs before settings/login-item reconciliation so its isolated profile
    // cannot modify the user's real startup registration.
    if (ocrSmokeImagePath) {
      startCaptureHelper()
      await runOcrSmoke(ocrSmokeImagePath)
      return
    }
    void cleanupExpiredGifClipboardFiles()
    void cleanupAbandonedCaptureTemps(app.getPath('temp'))
    const loadedSettings = loadSettings()
    // Reconcile the OS login item on every packaged launch so uninstall/reinstall or a moved
    // executable cannot leave the persisted preference and the registered path out of sync.
    if (!applyOpenAtStartup(loadedSettings.global.openAtStartup)) {
      updateSettings({ global: { openAtStartup: false } })
    }
    // Warm the persistent capture helper now so the first capture pays no device/duplication
    // setup and no cold DLL load. See D-017.
    startCaptureHelper()
    if (process.platform === 'win32') {
      const resetDisplays = (): void => {
        void resetCaptureDisplays().catch((error) => console.error('Could not reset capture displays', error))
      }
      powerMonitor.on('lock-screen', resetDisplays)
      powerMonitor.on('unlock-screen', resetDisplays)
      powerMonitor.on('resume', resetDisplays)
    }
    registerIpc()
    registerDisplayMediaHandler()
    registerInitialShortcuts()
    createTray()
    scheduleAutomaticUpdateCheck(automaticUpdateDelay(AUTOMATIC_UPDATE_INITIAL_DELAY_MS))
    if (isSettingsSmokeInstance) openSettings()
    if (isGifPreviewSmokeInstance) {
      void fs.readFile(path.join(app.getPath('temp'), 'capturo-smoke.gif'))
        .then((bytes) => openGifPreview(bytes))
        .catch(() => console.error('[gif-preview-smoke] %TEMP%\\capturo-smoke.gif is unavailable'))
    }
    if (isSmokeInstance) void startCapture()
    if (isGifSmokeInstance) void startGifCapture()
    if (isPickerSmokeInstance) void startColorPicker()
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
    pins?.closeAll()
    closePickerSession()
    closeRecording()
    closeScrollingCapture()
    closeGifPreview()
    cancelAutomaticUpdateCheck()
    stopCaptureHelper()
    globalShortcut.unregisterAll()
  })
  app.on('will-quit', () => {
    if (!isQuitting) globalShortcut.unregisterAll()
  })
}
