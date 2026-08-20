// User preferences, kept deliberately small. These are the only values Capturo persists,
// and they hold no captured pixels. See D-016. The logic here is pure: the main process
// wraps normalizeSettings with the filesystem in src/main/settings.ts, and both the store
// and its tests share this one definition of what a valid settings object is.

import { COLOR_FORMATS, type ColorFormat } from './color'

export type CaptureFormat = 'png' | 'jpeg'

export type GlobalSettings = {
  // Whether the packaged app asks the OS to launch Capturo when the user signs in.
  openAtStartup: boolean
  // Whether packaged builds may contact GitHub Releases after launch and once per day.
  // Disabled by default so Capturo never gains network behavior without explicit consent.
  automaticallyCheckForUpdates: boolean
  // Internal scheduling metadata for the opt-in check. It contains no device or capture data.
  lastUpdateCheckAt: number
  // Whether Capturo has ever observed macOS granting Screen Recording. A denied status after that
  // is a distinct situation worth naming: System Settings usually still shows Capturo switched on,
  // so repeating "turn it on" at someone who already has is useless. Never true on Windows, which
  // has no such permission. Records only that a system permission was once granted. See D-027.
  screenAccessWasGranted: boolean
}

export type CaptureSettings = {
  // Encoding used when saving to a file. Copy-to-clipboard is always a lossless bitmap and
  // is unaffected by this. See D-016.
  format: CaptureFormat
  // JPEG compression quality, 60-100. Ignored for PNG, which is lossless.
  jpegQuality: number
  // Whether the toast fires after a copy or save.
  showNotification: boolean
  // Electron accelerator that opens capture, e.g. 'CommandOrControl+Shift+7'.
  captureShortcut: string
}

export type GifSettings = {
  // Recording frame rate; one of GIF_FPS_OPTIONS. Higher is smoother and larger.
  fps: number
  // Palette/dithering quality, 1-100. Higher keeps more colour detail at a larger size. GIF
  // stays at the region's native resolution regardless. See D-018.
  quality: number
  // Countdown after Start Recording and before the first frame, in whole seconds. Zero disables
  // the countdown.
  preTimerSeconds: number
  // Whether the protected recording bar shows sampled, skipped, processed, and encoded counts.
  showFrameCount: boolean
  // Electron accelerator that starts a GIF capture, e.g. 'CommandOrControl+Shift+8'.
  shortcut: string
}

export type ColorPickerSettings = {
  // Electron accelerator that opens the colour picker, e.g. 'CommandOrControl+Shift+9'.
  shortcut: string
  // Whether picking writes the colour to the clipboard on its own. On by default: copying is
  // what picking a colour is for (D-034). Turning it off leaves the colour window's own Copy
  // as the only writer, for anyone who would rather their clipboard was never touched
  // without asking.
  copyOnPick: boolean
  // Which format the automatic copy uses. The colour window can still copy any of the three.
  copyFormat: ColorFormat
}

export type Settings = {
  global: GlobalSettings
  capture: CaptureSettings
  gif: GifSettings
  colorPicker: ColorPickerSettings
}

// A partial update to any section, as sent from the settings window.
export type SettingsUpdate = {
  global?: Partial<GlobalSettings>
  capture?: Partial<CaptureSettings>
  gif?: Partial<GifSettings>
  colorPicker?: Partial<ColorPickerSettings>
}

// Result of a settings:update round trip. shortcutError is set when a requested shortcut could
// not be registered (already owned by another app, or otherwise rejected by the OS); the
// returned settings then still hold the previously working shortcut.
export type SettingsUpdateResult = {
  settings: Settings
  shortcutError?: string
  startupError?: string
}

export type CapturoSettingsApi = {
  get: () => Promise<Settings>
  update: (update: SettingsUpdate) => Promise<SettingsUpdateResult>
}

// The three capture actions share one sequential family so the set is learnable as a group.
//
// It sits at 7/8/9 rather than the more obvious 2/3/4 because macOS reserves Shift-Cmd-3 through
// Shift-Cmd-6 for its own screenshot and recording shortcuts, which the earlier defaults collided
// with directly: GIF sat on the system's "screenshot selection to file" and the colour picker on
// "screenshot and recording options". Electron's globalShortcut.register returns true for a
// system-reserved combination, so the conflict does not surface as an error at startup -- it
// surfaces as a shortcut that quietly does the wrong thing. Nothing in the 7/8/9 range is claimed
// by macOS or by Windows. See D-037.
//
// These are defaults, not constraints: every one is rebindable in Settings, and a shortcut already
// stored in settings.json is kept, so changing these moves new installations only.
export const DEFAULT_CAPTURE_SHORTCUT = 'CommandOrControl+Shift+7'
export const DEFAULT_GIF_SHORTCUT = 'CommandOrControl+Shift+8'
export const DEFAULT_COLOR_PICKER_SHORTCUT = 'CommandOrControl+Shift+9'

export const MIN_JPEG_QUALITY = 60
export const MAX_JPEG_QUALITY = 100

export const MIN_GIF_QUALITY = 1
export const MAX_GIF_QUALITY = 100
export const MIN_GIF_PRE_TIMER_SECONDS = 0
export const MAX_GIF_PRE_TIMER_SECONDS = 10
export const GIF_FPS_OPTIONS = [10, 15, 20, 30] as const

export const DEFAULT_SETTINGS: Settings = {
  global: {
    openAtStartup: false,
    automaticallyCheckForUpdates: false,
    lastUpdateCheckAt: 0,
    screenAccessWasGranted: false
  },
  capture: {
    format: 'png',
    jpegQuality: 92,
    showNotification: true,
    captureShortcut: DEFAULT_CAPTURE_SHORTCUT
  },
  gif: {
    fps: 15,
    quality: 70,
    preTimerSeconds: 3,
    showFrameCount: true,
    shortcut: DEFAULT_GIF_SHORTCUT
  },
  colorPicker: {
    shortcut: DEFAULT_COLOR_PICKER_SHORTCUT,
    copyOnPick: true,
    copyFormat: 'hex'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeFormat(value: unknown): CaptureFormat {
  return value === 'jpeg' ? 'jpeg' : 'png'
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

function normalizeFps(value: unknown): number {
  return (GIF_FPS_OPTIONS as readonly number[]).includes(value as number)
    ? (value as number)
    : DEFAULT_SETTINGS.gif.fps
}

// Enough to reject empty or non-string junk. Whether an accelerator is actually registrable is
// decided by the OS at register time, not here.
function normalizeShortcut(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeTimestamp(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function normalizeCapture(raw: unknown): CaptureSettings {
  const capture = isRecord(raw) ? raw : {}
  return {
    format: normalizeFormat(capture.format),
    jpegQuality: clampInteger(capture.jpegQuality, MIN_JPEG_QUALITY, MAX_JPEG_QUALITY, DEFAULT_SETTINGS.capture.jpegQuality),
    showNotification: normalizeBoolean(capture.showNotification, DEFAULT_SETTINGS.capture.showNotification),
    captureShortcut: normalizeShortcut(capture.captureShortcut, DEFAULT_CAPTURE_SHORTCUT)
  }
}

function normalizeGlobal(raw: unknown): GlobalSettings {
  const global = isRecord(raw) ? raw : {}
  return {
    openAtStartup: normalizeBoolean(global.openAtStartup, DEFAULT_SETTINGS.global.openAtStartup),
    automaticallyCheckForUpdates: normalizeBoolean(
      global.automaticallyCheckForUpdates,
      DEFAULT_SETTINGS.global.automaticallyCheckForUpdates
    ),
    lastUpdateCheckAt: normalizeTimestamp(global.lastUpdateCheckAt),
    screenAccessWasGranted: normalizeBoolean(
      global.screenAccessWasGranted,
      DEFAULT_SETTINGS.global.screenAccessWasGranted
    )
  }
}

function normalizeGif(raw: unknown): GifSettings {
  const gif = isRecord(raw) ? raw : {}
  return {
    fps: normalizeFps(gif.fps),
    quality: clampInteger(gif.quality, MIN_GIF_QUALITY, MAX_GIF_QUALITY, DEFAULT_SETTINGS.gif.quality),
    preTimerSeconds: clampInteger(
      gif.preTimerSeconds,
      MIN_GIF_PRE_TIMER_SECONDS,
      MAX_GIF_PRE_TIMER_SECONDS,
      DEFAULT_SETTINGS.gif.preTimerSeconds
    ),
    showFrameCount: normalizeBoolean(gif.showFrameCount, DEFAULT_SETTINGS.gif.showFrameCount),
    shortcut: normalizeShortcut(gif.shortcut, DEFAULT_GIF_SHORTCUT)
  }
}

function normalizeColorPicker(raw: unknown): ColorPickerSettings {
  const picker = isRecord(raw) ? raw : {}
  return {
    shortcut: normalizeShortcut(picker.shortcut, DEFAULT_COLOR_PICKER_SHORTCUT),
    copyOnPick: normalizeBoolean(picker.copyOnPick, DEFAULT_SETTINGS.colorPicker.copyOnPick),
    copyFormat: COLOR_FORMATS.includes(picker.copyFormat as ColorFormat)
      ? (picker.copyFormat as ColorFormat)
      : DEFAULT_SETTINGS.colorPicker.copyFormat
  }
}

// Turns arbitrary parsed JSON (or a partial update) into a complete, valid Settings object.
// Every field falls back to its default rather than throwing, so a corrupt or half-written
// settings file can never stop the app from starting.
export function normalizeSettings(raw: unknown): Settings {
  const root = isRecord(raw) ? raw : {}
  return {
    global: normalizeGlobal(root.global),
    capture: normalizeCapture(root.capture),
    gif: normalizeGif(root.gif),
    colorPicker: normalizeColorPicker(root.colorPicker)
  }
}

// Merges a partial update over the current settings, then re-normalizes the result.
export function mergeSettings(current: Settings, update: SettingsUpdate): Settings {
  return normalizeSettings({
    global: { ...current.global, ...(update.global ?? {}) },
    capture: { ...current.capture, ...(update.capture ?? {}) },
    gif: { ...current.gif, ...(update.gif ?? {}) },
    colorPicker: { ...current.colorPicker, ...(update.colorPicker ?? {}) }
  })
}
