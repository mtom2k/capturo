import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CAPTURE_SHORTCUT,
  DEFAULT_SETTINGS,
  mergeSettings,
  normalizeSettings
} from '../src/shared/settings'

describe('normalizeSettings', () => {
  it('returns defaults for garbage input', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings('nonsense')).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({ capture: 42 })).toEqual(DEFAULT_SETTINGS)
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

  it('rejects an empty shortcut but keeps a real one', () => {
    expect(normalizeSettings({ capture: { captureShortcut: '   ' } }).capture.captureShortcut).toBe(
      DEFAULT_CAPTURE_SHORTCUT
    )
    expect(normalizeSettings({ capture: { captureShortcut: 'Alt+F9' } }).capture.captureShortcut).toBe('Alt+F9')
  })

  it('preserves valid partial input and defaults the rest', () => {
    expect(normalizeSettings({ capture: { showNotification: false } })).toEqual({
      capture: { ...DEFAULT_SETTINGS.capture, showNotification: false }
    })
  })
})

describe('mergeSettings', () => {
  it('overlays an update and re-normalizes', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { format: 'jpeg', jpegQuality: 500 })
    expect(merged.capture.format).toBe('jpeg')
    expect(merged.capture.jpegQuality).toBe(100)
    expect(merged.capture.showNotification).toBe(true)
  })
})
