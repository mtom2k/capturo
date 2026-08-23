import { describe, expect, it } from 'vitest'
import { acceleratorFromKeyEvent, formatAccelerator, type KeyChord } from '../src/shared/shortcut'

function chord(partial: Partial<KeyChord>): KeyChord {
  return { ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, code: '', ...partial }
}

describe('acceleratorFromKeyEvent', () => {
  it('builds a canonical modifier order', () => {
    expect(acceleratorFromKeyEvent(chord({ ctrlKey: true, shiftKey: true, code: 'Digit2' }))).toBe(
      'CommandOrControl+Shift+2'
    )
    expect(acceleratorFromKeyEvent(chord({ altKey: true, code: 'KeyA' }))).toBe('Alt+A')
  })

  it('treats meta as CommandOrControl', () => {
    expect(acceleratorFromKeyEvent(chord({ metaKey: true, code: 'KeyS' }))).toBe('CommandOrControl+S')
  })

  it('allows any mapped key without requiring a modifier', () => {
    expect(acceleratorFromKeyEvent(chord({ code: 'KeyA' }))).toBe('A')
    expect(acceleratorFromKeyEvent(chord({ shiftKey: true, code: 'KeyA' }))).toBe('Shift+A')
    expect(acceleratorFromKeyEvent(chord({ code: 'PrintScreen' }))).toBe('PrintScreen')
    expect(acceleratorFromKeyEvent(chord({ code: 'Escape' }))).toBe('Escape')
  })

  it('allows a bare function key', () => {
    expect(acceleratorFromKeyEvent(chord({ code: 'F9' }))).toBe('F9')
    expect(acceleratorFromKeyEvent(chord({ ctrlKey: true, code: 'F12' }))).toBe('CommandOrControl+F12')
  })

  it('rejects modifier-only and keys Electron cannot register', () => {
    expect(acceleratorFromKeyEvent(chord({ ctrlKey: true, code: 'ControlLeft' }))).toBeNull()
    expect(acceleratorFromKeyEvent(chord({ code: 'Pause' }))).toBeNull()
  })

  it('maps arrows, punctuation, lock, media, and numpad keys', () => {
    expect(acceleratorFromKeyEvent(chord({ ctrlKey: true, code: 'ArrowUp' }))).toBe('CommandOrControl+Up')
    expect(acceleratorFromKeyEvent(chord({ altKey: true, code: 'Numpad5' }))).toBe('Alt+num5')
    expect(acceleratorFromKeyEvent(chord({ code: 'Backquote' }))).toBe('`')
    expect(acceleratorFromKeyEvent(chord({ code: 'NumpadAdd' }))).toBe('numadd')
    expect(acceleratorFromKeyEvent(chord({ code: 'CapsLock' }))).toBe('Capslock')
    expect(acceleratorFromKeyEvent(chord({ code: 'AudioVolumeMute' }))).toBe('VolumeMute')
    expect(acceleratorFromKeyEvent(chord({ code: 'MediaTrackNext' }))).toBe('MediaNextTrack')
  })
})

describe('formatAccelerator', () => {
  it('renders Windows labels by default', () => {
    expect(formatAccelerator('CommandOrControl+Shift+2')).toBe('Ctrl+Shift+2')
    expect(formatAccelerator('PrintScreen')).toBe('Print Screen')
  })

  it('renders mac glyphs when asked', () => {
    expect(formatAccelerator('CommandOrControl+Shift+2', true)).toBe('⌘⇧2')
  })
})
