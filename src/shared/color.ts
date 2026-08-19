// Colour maths for the screen colour picker. Everything here is pure so the conversions, the
// related-colour palette, and the naming can be covered by tests rather than only by eye.

export type Rgb = { r: number; g: number; b: number }
export type Hsl = { h: number; s: number; l: number }
export type ColorFormat = 'hex' | 'rgb' | 'hsl'

export const COLOR_FORMATS: ColorFormat[] = ['hex', 'rgb', 'hsl']

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

export function clampChannel(value: number): number {
  return Math.round(clamp(value, 0, 255))
}

export function clampAlpha(value: number): number {
  return Math.round(clamp(value, 0, 100))
}

export function normalizeRgb(rgb: Rgb): Rgb {
  return { r: clampChannel(rgb.r), g: clampChannel(rgb.g), b: clampChannel(rgb.b) }
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const hex = [r, g, b]
    .map((channel) => clampChannel(channel).toString(16).padStart(2, '0'))
    .join('')
  return `#${hex.toUpperCase()}`
}

// Accepts #RGB and #RRGGBB, with or without the hash, in either case. Returns null rather than a
// fallback colour so a half-typed value in the hex field leaves the current colour alone instead
// of silently snapping to black.
export function hexToRgb(input: string): Rgb | null {
  const value = input.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]+$/.test(value)) return null
  if (value.length === 3) {
    return {
      r: parseInt(value[0] + value[0], 16),
      g: parseInt(value[1] + value[1], 16),
      b: parseInt(value[2] + value[2], 16)
    }
  }
  if (value.length === 6) {
    return {
      r: parseInt(value.slice(0, 2), 16),
      g: parseInt(value.slice(2, 4), 16),
      b: parseInt(value.slice(4, 6), 16)
    }
  }
  return null
}

export function rgbToHsl(rgb: Rgb): Hsl {
  const r = clampChannel(rgb.r) / 255
  const g = clampChannel(rgb.g) / 255
  const b = clampChannel(rgb.b) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  const l = (max + min) / 2

  if (delta === 0) return { h: 0, s: 0, l: Math.round(l * 100) }

  // Denominator flips above 50% lightness: the same delta spans a shrinking range as the colour
  // approaches white, so saturation stays comparable across the lightness axis.
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min)

  let h: number
  if (max === r) h = ((g - b) / delta) % 6
  else if (max === g) h = (b - r) / delta + 2
  else h = (r - g) / delta + 4

  h = Math.round(h * 60)
  if (h < 0) h += 360

  return { h: h % 360, s: Math.round(s * 100), l: Math.round(l * 100) }
}

export function hslToRgb(hsl: Hsl): Rgb {
  const h = ((Math.round(hsl.h) % 360) + 360) % 360
  const s = clamp(hsl.s, 0, 100) / 100
  const l = clamp(hsl.l, 0, 100) / 100

  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2

  let rgb: [number, number, number]
  if (h < 60) rgb = [c, x, 0]
  else if (h < 120) rgb = [x, c, 0]
  else if (h < 180) rgb = [0, c, x]
  else if (h < 240) rgb = [0, x, c]
  else if (h < 300) rgb = [x, 0, c]
  else rgb = [c, 0, x]

  return {
    r: Math.round((rgb[0] + m) * 255),
    g: Math.round((rgb[1] + m) * 255),
    b: Math.round((rgb[2] + m) * 255)
  }
}

// Relative luminance per WCAG 2.1, used to decide whether text over a swatch should be black or
// white. This is not the same as HSL lightness: HSL calls pure yellow and pure blue equally
// light, and white text is unreadable on the first.
export function relativeLuminance(rgb: Rgb): number {
  const channels = [rgb.r, rgb.g, rgb.b].map((raw) => {
    const channel = clampChannel(raw) / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

export function readableTextColor(rgb: Rgb): string {
  return relativeLuminance(rgb) > 0.4 ? '#0b1220' : '#ffffff'
}

export function formatColor(rgb: Rgb, format: ColorFormat, alpha = 100): string {
  const value = normalizeRgb(rgb)
  const a = clampAlpha(alpha)
  if (format === 'rgb') {
    return a >= 100
      ? `rgb(${value.r}, ${value.g}, ${value.b})`
      : `rgba(${value.r}, ${value.g}, ${value.b}, ${+(a / 100).toFixed(2)})`
  }
  if (format === 'hsl') {
    const { h, s, l } = rgbToHsl(value)
    return a >= 100 ? `hsl(${h}, ${s}%, ${l}%)` : `hsla(${h}, ${s}%, ${l}%, ${+(a / 100).toFixed(2)})`
  }
  // Hex carries alpha as a fourth byte rather than a different function name, so the value stays
  // pasteable into CSS and design tools alike.
  const hex = rgbToHex(value)
  if (a >= 100) return hex
  return `${hex}${Math.round((a / 100) * 255).toString(16).padStart(2, '0').toUpperCase()}`
}

export function cssColor(rgb: Rgb, alpha = 100): string {
  const value = normalizeRgb(rgb)
  const a = clampAlpha(alpha)
  return a >= 100
    ? `rgb(${value.r}, ${value.g}, ${value.b})`
    : `rgba(${value.r}, ${value.g}, ${value.b}, ${a / 100})`
}

// A small reference set, chosen to cover the hue circle plus the greys rather than to be
// exhaustive. The picker shows the nearest name as a label for the palette; it is a human
// handle for the colour, never presented as the colour's identity.
const NAMED_COLORS: { name: string; rgb: Rgb }[] = [
  { name: 'Black', rgb: { r: 0, g: 0, b: 0 } },
  { name: 'Charcoal', rgb: { r: 54, g: 58, b: 64 } },
  { name: 'Slate', rgb: { r: 100, g: 116, b: 139 } },
  { name: 'Silver', rgb: { r: 192, g: 197, b: 204 } },
  { name: 'White', rgb: { r: 255, g: 255, b: 255 } },
  { name: 'Crimson', rgb: { r: 220, g: 38, b: 38 } },
  { name: 'Rose', rgb: { r: 244, g: 114, b: 152 } },
  { name: 'Rust', rgb: { r: 154, g: 74, b: 40 } },
  { name: 'Amber', rgb: { r: 245, g: 158, b: 11 } },
  { name: 'Sand', rgb: { r: 214, g: 197, b: 152 } },
  { name: 'Olive', rgb: { r: 128, g: 128, b: 43 } },
  { name: 'Grass', rgb: { r: 156, g: 170, b: 51 } },
  { name: 'Forest', rgb: { r: 34, g: 108, b: 62 } },
  { name: 'Mint', rgb: { r: 134, g: 224, b: 186 } },
  { name: 'Teal', rgb: { r: 13, g: 148, b: 136 } },
  { name: 'Sky', rgb: { r: 56, g: 176, b: 246 } },
  { name: 'Ocean', rgb: { r: 22, g: 119, b: 232 } },
  { name: 'Navy', rgb: { r: 30, g: 41, b: 99 } },
  { name: 'Violet', rgb: { r: 124, g: 58, b: 237 } },
  { name: 'Plum', rgb: { r: 112, g: 45, b: 92 } },
  { name: 'Magenta', rgb: { r: 214, g: 51, b: 168 } }
]

export function colorName(rgb: Rgb): string {
  const value = normalizeRgb(rgb)
  let best = NAMED_COLORS[0]
  let bestDistance = Number.POSITIVE_INFINITY
  for (const candidate of NAMED_COLORS) {
    // Weighted squared distance in RGB. Not perceptually uniform, but weighting green above red
    // above blue tracks human sensitivity closely enough for a one-word label.
    const dr = value.r - candidate.rgb.r
    const dg = value.g - candidate.rgb.g
    const db = value.b - candidate.rgb.b
    const distance = 2 * dr * dr + 4 * dg * dg + 3 * db * db
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  }
  return best.name
}

// The swatch row beside the picked colour: two lighter steps, the colour itself, and two darker
// steps, all at the same hue. Lightness rather than hue is varied because the row exists to offer
// usable neighbours of the picked colour - a tint for a background, a shade for text - not a
// harmony scheme the user did not ask for.
export function relatedColors(rgb: Rgb, count = 5): Rgb[] {
  if (count < 1) return []
  const base = rgbToHsl(normalizeRgb(rgb))
  const middle = Math.floor(count / 2)
  const colors: Rgb[] = []
  for (let index = 0; index < count; index++) {
    const step = index - middle
    if (step === 0) {
      colors.push(normalizeRgb(rgb))
      continue
    }
    // Steps move towards white above the colour and towards black below it, so the row keeps its
    // spread even for a colour that starts near either end.
    const room = step < 0 ? 100 - base.l : base.l
    const fraction = Math.abs(step) / (middle + 1)
    const lightness = step < 0 ? base.l + room * fraction : base.l - room * fraction
    // Very light and very dark steps lose saturation the way pigment does; holding it constant
    // makes the pale end look artificially neon.
    const saturation = base.s * (1 - 0.25 * fraction)
    colors.push(hslToRgb({ h: base.h, s: saturation, l: lightness }))
  }
  return colors
}

// Bridge for the picker overlay and the colour window. The overlay reports the pixel it picked;
// the window reads the result, copies it, and can send the user back for another pick.
// Picking copies straight to the clipboard, so the window is told whether that succeeded rather
// than having to ask or assume.
export type PickedColor = { color: Rgb; copied: boolean }

export type CapturoColorApi = {
  onInitialize: (listener: (picked: PickedColor) => void) => () => void
  pick: (sessionId: string, color: Rgb) => Promise<boolean>
  copy: (text: string) => Promise<boolean>
  pickAgain: () => Promise<void>
}
