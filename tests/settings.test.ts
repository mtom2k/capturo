import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CAPTURE_SHORTCUT,
  DEFAULT_COLOR_PICKER_SHORTCUT,
  DEFAULT_GIF_SHORTCUT,
  DEFAULT_SETTINGS,
  mergeSettings,
  normalizeSettings
} from '../src/shared/settings'

describe('normalizeSettings', () => {
  it('returns defaults for garbage input', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings('nonsense')).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({ global: 42, capture: 42, gif: 42 })).toEqual(DEFAULT_SETTINGS)
  })

  it('defaults and normalizes open-on-startup', () => {
    expect(DEFAULT_SETTINGS.global.openAtStartup).toBe(false)
    expect(normalizeSettings({ global: { openAtStartup: true } }).global.openAtStartup).toBe(true)
    expect(normalizeSettings({ global: { openAtStartup: 'true' } }).global.openAtStartup).toBe(false)
  })

  it('starts with no record of screen access and normalizes it', () => {
    // Drives the difference between "turn it on" and "switch it off and on again" guidance, so a
    // corrupt value must fall back to the first-run wording rather than the stale-grant wording.
    expect(DEFAULT_SETTINGS.global.screenAccessWasGranted).toBe(false)
    expect(normalizeSettings({ global: { screenAccessWasGranted: true } }).global.screenAccessWasGranted).toBe(true)
    expect(normalizeSettings({ global: { screenAccessWasGranted: 'true' } }).global.screenAccessWasGranted).toBe(false)
  })

  it('keeps automatic update checks explicitly opt-in', () => {
    expect(DEFAULT_SETTINGS.global.automaticallyCheckForUpdates).toBe(false)
    expect(DEFAULT_SETTINGS.global.lastUpdateCheckAt).toBe(0)
    expect(normalizeSettings({ global: { automaticallyCheckForUpdates: true } }).global.automaticallyCheckForUpdates).toBe(true)
    expect(normalizeSettings({ global: { automaticallyCheckForUpdates: 'true' } }).global.automaticallyCheckForUpdates).toBe(false)
    expect(normalizeSettings({ global: { lastUpdateCheckAt: 1234 } }).global.lastUpdateCheckAt).toBe(1234)
    expect(normalizeSettings({ global: { lastUpdateCheckAt: -1 } }).global.lastUpdateCheckAt).toBe(0)
  })

  it('clamps and rounds JPEG quality into range', () => {
    expect(normalizeSettings({ capture: { jpegQuality: 200 } }).capture.jpegQuality).toBe(100)
    expect(normalizeSettings({ capture: { jpegQuality: 5 } }).capture.jpegQuality).toBe(60)
    expect(normalizeSettings({ capture: { jpegQuality: 71.6 } }).capture.jpegQuality).toBe(72)
    expect(normalizeSettings({ capture: { jpegQuality: 'x' } }).capture.jpegQuality).toBe(
      DEFAULT_SETTINGS.capture.jpegQuality
    )
  })

  it('falls back an unknown format to png', () => {
    expect(normalizeSettings({ capture: { format: 'gif' } }).capture.format).toBe('png')
    expect(normalizeSettings({ capture: { format: 'jpeg' } }).capture.format).toBe('jpeg')
  })

  it('rejects empty shortcuts but keeps real ones', () => {
    expect(normalizeSettings({ capture: { captureShortcut: '   ' } }).capture.captureShortcut).toBe(
      DEFAULT_CAPTURE_SHORTCUT
    )
    expect(normalizeSettings({ capture: { captureShortcut: 'Alt+F9' } }).capture.captureShortcut).toBe('Alt+F9')
    expect(normalizeSettings({ gif: { shortcut: '' } }).gif.shortcut).toBe(DEFAULT_GIF_SHORTCUT)
    expect(normalizeSettings({ gif: { shortcut: 'Alt+G' } }).gif.shortcut).toBe('Alt+G')
  })

  it('accepts only known GIF frame rates', () => {
    expect(normalizeSettings({ gif: { fps: 30 } }).gif.fps).toBe(30)
    expect(normalizeSettings({ gif: { fps: 12 } }).gif.fps).toBe(DEFAULT_SETTINGS.gif.fps)
    expect(normalizeSettings({ gif: { fps: 'x' } }).gif.fps).toBe(DEFAULT_SETTINGS.gif.fps)
  })

  it('clamps GIF quality into 1-100', () => {
    expect(normalizeSettings({ gif: { quality: 500 } }).gif.quality).toBe(100)
    expect(normalizeSettings({ gif: { quality: 0 } }).gif.quality).toBe(1)
    expect(normalizeSettings({ gif: { quality: 63.4 } }).gif.quality).toBe(63)
  })

  it('defaults, clamps, and rounds the GIF pre-timer into 0-10 seconds', () => {
    expect(DEFAULT_SETTINGS.gif.preTimerSeconds).toBe(3)
    expect(normalizeSettings({ gif: { preTimerSeconds: 0 } }).gif.preTimerSeconds).toBe(0)
    expect(normalizeSettings({ gif: { preTimerSeconds: 7.6 } }).gif.preTimerSeconds).toBe(8)
    expect(normalizeSettings({ gif: { preTimerSeconds: -4 } }).gif.preTimerSeconds).toBe(0)
    expect(normalizeSettings({ gif: { preTimerSeconds: 99 } }).gif.preTimerSeconds).toBe(10)
    expect(normalizeSettings({ gif: { preTimerSeconds: 'x' } }).gif.preTimerSeconds).toBe(3)
  })

  it('defaults and normalizes GIF frame-count visibility', () => {
    expect(DEFAULT_SETTINGS.gif.showFrameCount).toBe(true)
    expect(normalizeSettings({ gif: { showFrameCount: false } }).gif.showFrameCount).toBe(false)
    expect(normalizeSettings({ gif: { showFrameCount: 'false' } }).gif.showFrameCount).toBe(true)
  })

  it('preserves valid partial input and defaults the rest', () => {
    expect(normalizeSettings({ capture: { showNotification: false } })).toEqual({
      global: DEFAULT_SETTINGS.global,
      capture: { ...DEFAULT_SETTINGS.capture, showNotification: false },
      gif: DEFAULT_SETTINGS.gif,
      colorPicker: DEFAULT_SETTINGS.colorPicker
    })
  })
})

describe('mergeSettings', () => {
  it('overlays a capture update and re-normalizes', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { capture: { format: 'jpeg', jpegQuality: 500 } })
    expect(merged.capture.format).toBe('jpeg')
    expect(merged.capture.jpegQuality).toBe(100)
    expect(merged.capture.showNotification).toBe(true)
    expect(merged.global).toEqual(DEFAULT_SETTINGS.global)
    expect(merged.gif).toEqual(DEFAULT_SETTINGS.gif)
  })

  it('overlays a gif update without touching capture', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { gif: { fps: 30, preTimerSeconds: 5 } })
    expect(merged.gif.fps).toBe(30)
    expect(merged.gif.quality).toBe(DEFAULT_SETTINGS.gif.quality)
    expect(merged.gif.preTimerSeconds).toBe(5)
    expect(merged.gif.showFrameCount).toBe(true)
    expect(merged.capture).toEqual(DEFAULT_SETTINGS.capture)
    expect(merged.global).toEqual(DEFAULT_SETTINGS.global)
  })

  it('overlays a global update without touching capture or GIF', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      global: { openAtStartup: true, automaticallyCheckForUpdates: true, lastUpdateCheckAt: 1234 }
    })
    expect(merged.global.openAtStartup).toBe(true)
    expect(merged.global.automaticallyCheckForUpdates).toBe(true)
    expect(merged.global.lastUpdateCheckAt).toBe(1234)
    expect(merged.capture).toEqual(DEFAULT_SETTINGS.capture)
    expect(merged.gif).toEqual(DEFAULT_SETTINGS.gif)
  })
})

describe('color picker settings', () => {
  it('defaults to copying hex on pick', () => {
    expect(DEFAULT_SETTINGS.colorPicker).toEqual({
      shortcut: DEFAULT_COLOR_PICKER_SHORTCUT,
      copyOnPick: true,
      copyFormat: 'hex'
    })
  })

  it('fills in the whole section when it is missing', () => {
    // Settings files written by an earlier version have no colorPicker at all, and must not stop
    // the app from starting or leave the picker with no shortcut.
    const normalized = normalizeSettings({ capture: { format: 'jpeg' } })
    expect(normalized.colorPicker).toEqual(DEFAULT_SETTINGS.colorPicker)
  })

  it('keeps a custom shortcut and rejects an empty one', () => {
    expect(normalizeSettings({ colorPicker: { shortcut: 'Alt+P' } }).colorPicker.shortcut).toBe('Alt+P')
    for (const bad of ['', '   ', 42, null]) {
      expect(normalizeSettings({ colorPicker: { shortcut: bad } }).colorPicker.shortcut)
        .toBe(DEFAULT_COLOR_PICKER_SHORTCUT)
    }
  })

  it('accepts only the three real formats', () => {
    for (const format of ['hex', 'rgb', 'hsl']) {
      expect(normalizeSettings({ colorPicker: { copyFormat: format } }).colorPicker.copyFormat).toBe(format)
    }
    for (const bad of ['cmyk', '', 7, null, undefined]) {
      expect(normalizeSettings({ colorPicker: { copyFormat: bad } }).colorPicker.copyFormat).toBe('hex')
    }
  })

  it('normalizes copyOnPick to a real boolean', () => {
    expect(normalizeSettings({ colorPicker: { copyOnPick: false } }).colorPicker.copyOnPick).toBe(false)
    // A truthy non-boolean must not be read as "on": the setting decides whether Capturo writes
    // to the clipboard without being asked, so it falls back to the default rather than guessing.
    expect(normalizeSettings({ colorPicker: { copyOnPick: 'yes' } }).colorPicker.copyOnPick).toBe(true)
    expect(normalizeSettings({ colorPicker: { copyOnPick: 0 } }).colorPicker.copyOnPick).toBe(true)
  })

  it('overlays a color picker update without touching the other sections', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { colorPicker: { copyFormat: 'rgb' } })
    expect(merged.colorPicker.copyFormat).toBe('rgb')
    expect(merged.colorPicker.shortcut).toBe(DEFAULT_COLOR_PICKER_SHORTCUT)
    expect(merged.colorPicker.copyOnPick).toBe(true)
    expect(merged.capture).toEqual(DEFAULT_SETTINGS.capture)
    expect(merged.gif).toEqual(DEFAULT_SETTINGS.gif)
    expect(merged.global).toEqual(DEFAULT_SETTINGS.global)
  })
})

describe('default shortcuts', () => {
  const defaults = [DEFAULT_CAPTURE_SHORTCUT, DEFAULT_GIF_SHORTCUT, DEFAULT_COLOR_PICKER_SHORTCUT]

  // macOS owns Shift-Cmd-3 through Shift-Cmd-6 for its own screenshot and screen-recording
  // shortcuts. Electron's globalShortcut.register returns true for those anyway, so a collision
  // never announces itself at startup -- it shows up as a default that silently does the wrong
  // thing on a Mac. Pinning the range here is the only place it can fail loudly. See D-037.
  it('avoids the combinations macOS reserves for its own screenshot shortcuts', () => {
    for (const shortcut of defaults) {
      for (const reserved of ['3', '4', '5', '6']) {
        expect(shortcut).not.toBe(`CommandOrControl+Shift+${reserved}`)
      }
    }
  })

  it('gives each capture action a distinct binding', () => {
    expect(new Set(defaults).size).toBe(defaults.length)
  })

  it('ships defaults that survive normalization unchanged', () => {
    const settings = normalizeSettings({})
    expect(settings.capture.captureShortcut).toBe(DEFAULT_CAPTURE_SHORTCUT)
    expect(settings.gif.shortcut).toBe(DEFAULT_GIF_SHORTCUT)
    expect(settings.colorPicker.shortcut).toBe(DEFAULT_COLOR_PICKER_SHORTCUT)
  })
})
