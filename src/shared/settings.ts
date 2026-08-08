// User preferences, kept deliberately small. These are the only values Capturo persists,
// and they hold no captured pixels. See D-016. The logic here is pure: the main process
// wraps normalizeSettings with the filesystem in src/main/settings.ts, and both the store
// and its tests share this one definition of what a valid settings object is.

export type CaptureFormat = 'png' | 'jpeg'

export type CaptureSettings = {
  // Encoding used when saving to a file. Copy-to-clipboard is always a lossless bitmap and
  // is unaffected by this. See D-016.
  format: CaptureFormat
  // JPEG compression quality, 60-100. Ignored for PNG, which is lossless.
  jpegQuality: number
  // Whether the toast fires after a copy or save.
  showNotification: boolean
  // Electron accelerator that opens capture, e.g. 'CommandOrControl+Shift+2'.
  captureShortcut: string
}

export type GifSettings = {
  // Recording frame rate; one of GIF_FPS_OPTIONS. Higher is smoother and larger.
  fps: number
  // Palette/dithering quality, 1-100. Higher keeps more colour detail at a larger size. GIF
  // stays at the region's native resolution regardless. See D-018.
  quality: number
  // Electron accelerator that starts a GIF capture, e.g. 'CommandOrControl+Shift+3'.
  shortcut: string
}

export type Settings = {
  capture: CaptureSettings
  gif: GifSettings
}

// A partial update to any section, as sent from the settings window.
export type SettingsUpdate = {
  capture?: Partial<CaptureSettings>
  gif?: Partial<GifSettings>
}

// Result of a settings:update round trip. shortcutError is set when a requested shortcut could
// not be registered (already owned by another app, or otherwise rejected by the OS); the
// returned settings then still hold the previously working shortcut.
export type SettingsUpdateResult = {
  settings: Settings
  shortcutError?: string
}

export type CapturoSettingsApi = {
  get: () => Promise<Settings>
  update: (update: SettingsUpdate) => Promise<SettingsUpdateResult>
}

export const DEFAULT_CAPTURE_SHORTCUT = 'CommandOrControl+Shift+2'
export const DEFAULT_GIF_SHORTCUT = 'CommandOrControl+Shift+3'

export const MIN_JPEG_QUALITY = 60
export const MAX_JPEG_QUALITY = 100

export const MIN_GIF_QUALITY = 1
export const MAX_GIF_QUALITY = 100
export const GIF_FPS_OPTIONS = [10, 15, 20, 30] as const

export const DEFAULT_SETTINGS: Settings = {
  capture: {
    format: 'png',
    jpegQuality: 92,
    showNotification: true,
    captureShortcut: DEFAULT_CAPTURE_SHORTCUT
  },
  gif: {
    fps: 15,
    quality: 70,
    shortcut: DEFAULT_GIF_SHORTCUT
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeFormat(value: unknown): CaptureFormat {
  return value === 'jpeg' ? 'jpeg' : 'png'
}

function clampQuality(value: unknown, min: number, max: number, fallback: number): number {
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

function normalizeCapture(raw: unknown): CaptureSettings {
  const capture = isRecord(raw) ? raw : {}
  return {
    format: normalizeFormat(capture.format),
    jpegQuality: clampQuality(capture.jpegQuality, MIN_JPEG_QUALITY, MAX_JPEG_QUALITY, DEFAULT_SETTINGS.capture.jpegQuality),
    showNotification: normalizeBoolean(capture.showNotification, DEFAULT_SETTINGS.capture.showNotification),
    captureShortcut: normalizeShortcut(capture.captureShortcut, DEFAULT_CAPTURE_SHORTCUT)
  }
}

function normalizeGif(raw: unknown): GifSettings {
  const gif = isRecord(raw) ? raw : {}
  return {
    fps: normalizeFps(gif.fps),
    quality: clampQuality(gif.quality, MIN_GIF_QUALITY, MAX_GIF_QUALITY, DEFAULT_SETTINGS.gif.quality),
    shortcut: normalizeShortcut(gif.shortcut, DEFAULT_GIF_SHORTCUT)
  }
}

// Turns arbitrary parsed JSON (or a partial update) into a complete, valid Settings object.
// Every field falls back to its default rather than throwing, so a corrupt or half-written
// settings file can never stop the app from starting.
export function normalizeSettings(raw: unknown): Settings {
  const root = isRecord(raw) ? raw : {}
  return {
    capture: normalizeCapture(root.capture),
    gif: normalizeGif(root.gif)
  }
}

// Merges a partial update over the current settings, then re-normalizes the result.
export function mergeSettings(current: Settings, update: SettingsUpdate): Settings {
  return normalizeSettings({
    capture: { ...current.capture, ...(update.capture ?? {}) },
    gif: { ...current.gif, ...(update.gif ?? {}) }
  })
}
