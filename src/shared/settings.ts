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

export type Settings = {
  capture: CaptureSettings
}

// Result of a settings:update round trip. shortcutError is set when the requested capture
// shortcut could not be registered (already owned by another app, or otherwise rejected by
// the OS); the returned settings then still hold the previously working shortcut.
export type SettingsUpdateResult = {
  settings: Settings
  shortcutError?: string
}

export type CapturoSettingsApi = {
  get: () => Promise<Settings>
  update: (update: Partial<CaptureSettings>) => Promise<SettingsUpdateResult>
}

export const DEFAULT_CAPTURE_SHORTCUT = 'CommandOrControl+Shift+2'

export const MIN_JPEG_QUALITY = 60
export const MAX_JPEG_QUALITY = 100

export const DEFAULT_SETTINGS: Settings = {
  capture: {
    format: 'png',
    jpegQuality: 92,
    showNotification: true,
    captureShortcut: DEFAULT_CAPTURE_SHORTCUT
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeFormat(value: unknown): CaptureFormat {
  return value === 'jpeg' ? 'jpeg' : 'png'
}

function normalizeQuality(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SETTINGS.capture.jpegQuality
  return Math.min(MAX_JPEG_QUALITY, Math.max(MIN_JPEG_QUALITY, Math.round(value)))
}

function normalizeShortcut(value: unknown): string {
  // Enough to reject empty or non-string junk. Whether an accelerator is actually
  // registrable is decided by the OS at register time, not here.
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : DEFAULT_CAPTURE_SHORTCUT
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

// Turns arbitrary parsed JSON (or a partial update) into a complete, valid Settings object.
// Every field falls back to its default rather than throwing, so a corrupt or half-written
// settings file can never stop the app from starting.
export function normalizeSettings(raw: unknown): Settings {
  const root = isRecord(raw) ? raw : {}
  const capture = isRecord(root.capture) ? root.capture : {}
  return {
    capture: {
      format: normalizeFormat(capture.format),
      jpegQuality: normalizeQuality(capture.jpegQuality),
      showNotification: normalizeBoolean(capture.showNotification, DEFAULT_SETTINGS.capture.showNotification),
      captureShortcut: normalizeShortcut(capture.captureShortcut)
    }
  }
}

// Merges a partial capture update over the current settings, then re-normalizes the result.
export function mergeSettings(current: Settings, update: Partial<CaptureSettings>): Settings {
  return normalizeSettings({ capture: { ...current.capture, ...update } })
}
