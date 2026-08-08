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

// Physical key codes we are willing to bind, mapped to their Electron accelerator token.
// Anything not here returns null so the recorder rejects it rather than producing an
// accelerator the OS will refuse.
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
    case 'PrintScreen':
      return 'PrintScreen'
    default:
      return null
  }
}

// Builds a canonical accelerator, or null when the chord is not a usable shortcut.
//
// A "real" modifier (Ctrl/Cmd or Alt) is required so a plain letter cannot shadow ordinary
// typing; the sole exception is a bare function key, which is a conventional standalone
// global shortcut. Shift on its own does not count as a real modifier.
export function acceleratorFromKeyEvent(chord: KeyChord): string | null {
  const token = keyToken(chord.code)
  if (!token) return null

  const hasRealModifier = chord.ctrlKey || chord.metaKey || chord.altKey
  const isFunctionKey = FUNCTION_KEY.test(token)
  if (!hasRealModifier && !isFunctionKey) return null

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
      if (part.startsWith('num')) return `Num ${part.slice(3)}`
      return part
    })
    .join(isMac ? '' : '+')
}
