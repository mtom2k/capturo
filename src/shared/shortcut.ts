// Turns a keyboard event from the settings recorder into an Electron accelerator string,
// and formats an accelerator for display. Pure so the renderer and its tests share one
// definition; whether the OS will actually register the result is decided later, at
// globalShortcut.register time, not here.

export type KeyChord = {
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
  // event.code, the physical key, which is layout-independent unlike event.key.
  code: string
}

const FUNCTION_KEY = /^F([1-9]|1[0-9]|2[0-4])$/

// Physical key codes Electron exposes as accelerator tokens. Keeping this mapping here lets the
// recorder accept the full supported keyboard surface without trusting arbitrary renderer text.
// The OS remains the final arbiter at globalShortcut.register time.
function keyToken(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^Numpad[0-9]$/.test(code)) return `num${code.slice(6)}`
  if (FUNCTION_KEY.test(code)) return code
  switch (code) {
    case 'ArrowUp':
      return 'Up'
    case 'ArrowDown':
      return 'Down'
    case 'ArrowLeft':
      return 'Left'
    case 'ArrowRight':
      return 'Right'
    case 'Space':
      return 'Space'
    case 'Enter':
      return 'Return'
    case 'Tab':
      return 'Tab'
    case 'Backspace':
      return 'Backspace'
    case 'Delete':
      return 'Delete'
    case 'Insert':
      return 'Insert'
    case 'Home':
      return 'Home'
    case 'End':
      return 'End'
    case 'PageUp':
      return 'PageUp'
    case 'PageDown':
      return 'PageDown'
    case 'Escape':
      return 'Escape'
    case 'CapsLock':
      return 'Capslock'
    case 'NumLock':
      return 'Numlock'
    case 'ScrollLock':
      return 'Scrolllock'
    case 'PrintScreen':
      return 'PrintScreen'
    case 'Backquote':
      return '`'
    case 'Minus':
      return '-'
    case 'Equal':
    case 'NumpadEqual':
      return '='
    case 'BracketLeft':
      return '['
    case 'BracketRight':
      return ']'
    case 'Backslash':
    case 'IntlBackslash':
      return '\\'
    case 'Semicolon':
      return ';'
    case 'Quote':
      return '"'
    case 'Comma':
      return ','
    case 'Period':
      return '.'
    case 'Slash':
      return '/'
    case 'NumpadDecimal':
    case 'NumpadComma':
      return 'numdec'
    case 'NumpadAdd':
      return 'numadd'
    case 'NumpadSubtract':
      return 'numsub'
    case 'NumpadMultiply':
      return 'nummult'
    case 'NumpadDivide':
      return 'numdiv'
    case 'AudioVolumeUp':
      return 'VolumeUp'
    case 'AudioVolumeDown':
      return 'VolumeDown'
    case 'AudioVolumeMute':
      return 'VolumeMute'
    case 'MediaTrackNext':
      return 'MediaNextTrack'
    case 'MediaTrackPrevious':
      return 'MediaPreviousTrack'
    case 'MediaStop':
      return 'MediaStop'
    case 'MediaPlayPause':
      return 'MediaPlayPause'
    default:
      return null
  }
}

// Builds a canonical accelerator, or null when the chord is not a usable shortcut.
// Every Electron-supported non-modifier key is intentionally valid on its own. A bare letter can
// therefore shadow ordinary typing system-wide, but that is an explicit user choice rather than a
// policy Capturo imposes. Modifier-only events still return null because an Electron accelerator
// requires one key code.
export function acceleratorFromKeyEvent(chord: KeyChord): string | null {
  const token = keyToken(chord.code)
  if (!token) return null

  const parts: string[] = []
  if (chord.ctrlKey || chord.metaKey) parts.push('CommandOrControl')
  if (chord.altKey) parts.push('Alt')
  if (chord.shiftKey) parts.push('Shift')
  parts.push(token)
  return parts.join('+')
}

// A friendly label for an accelerator. Windows-first, so CommandOrControl reads as Ctrl by
// default; pass isMac to render the mac glyphs instead.
export function formatAccelerator(accelerator: string, isMac = false): string {
  return accelerator
    .split('+')
    .map((part) => {
      if (part === 'CommandOrControl') return isMac ? '⌘' : 'Ctrl'
      if (part === 'Alt') return isMac ? '⌥' : 'Alt'
      if (part === 'Shift') return isMac ? '⇧' : 'Shift'
      if (part === 'Super') return isMac ? '⌘' : 'Win'
      if (part === 'PrintScreen') return 'Print Screen'
      if (part === 'Capslock') return 'Caps Lock'
      if (part === 'Numlock') return 'Num Lock'
      if (part === 'Scrolllock') return 'Scroll Lock'
      if (part.startsWith('num')) return `Num ${part.slice(3)}`
      return part
    })
    .join(isMac ? '' : '+')
}
