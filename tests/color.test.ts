import { describe, expect, it } from 'vitest'
import {
  clampAlpha,
  colorName,
  cssColor,
  formatColor,
  hexToRgb,
  hslToRgb,
  readableTextColor,
  relatedColors,
  relativeLuminance,
  rgbToHex,
  rgbToHsl
} from '../src/shared/color'

describe('hex conversion', () => {
  it('round-trips a colour through hex', () => {
    const rgb = { r: 156, g: 170, b: 51 }
    expect(rgbToHex(rgb)).toBe('#9CAA33')
    expect(hexToRgb('#9CAA33')).toEqual(rgb)
  })

  it('accepts shorthand, a missing hash, and mixed case', () => {
    expect(hexToRgb('#abc')).toEqual({ r: 170, g: 187, b: 204 })
    expect(hexToRgb('9caa33')).toEqual({ r: 156, g: 170, b: 51 })
    expect(hexToRgb('  #9caA33 ')).toEqual({ r: 156, g: 170, b: 51 })
  })

  it('rejects a half-typed or malformed value instead of guessing', () => {
    // The hex field is edited character by character, so anything but a complete colour has to
    // leave the current one alone rather than snapping to black.
    for (const input of ['', '#', '#9', '#9CAA3', '#9CAA333', 'nothex', '#12345g']) {
      expect(hexToRgb(input)).toBeNull()
    }
  })

  it('pads channels that need a leading zero', () => {
    expect(rgbToHex({ r: 0, g: 5, b: 16 })).toBe('#000510')
  })

  it('clamps out-of-range channels rather than emitting invalid hex', () => {
    expect(rgbToHex({ r: -20, g: 300, b: 128.6 })).toBe('#00FF81')
  })
})

describe('hsl conversion', () => {
  it('matches known values across the hue circle', () => {
    expect(rgbToHsl({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 100, l: 50 })
    expect(rgbToHsl({ r: 0, g: 255, b: 0 })).toEqual({ h: 120, s: 100, l: 50 })
    expect(rgbToHsl({ r: 0, g: 0, b: 255 })).toEqual({ h: 240, s: 100, l: 50 })
  })

  it('reports greys as unsaturated with hue zero', () => {
    expect(rgbToHsl({ r: 128, g: 128, b: 128 })).toEqual({ h: 0, s: 0, l: 50 })
    expect(rgbToHsl({ r: 0, g: 0, b: 0 })).toEqual({ h: 0, s: 0, l: 0 })
    expect(rgbToHsl({ r: 255, g: 255, b: 255 })).toEqual({ h: 0, s: 0, l: 100 })
  })

  it('reads the sample colour from the picker design', () => {
    // #9CAA33 is the colour in the reference design; its readouts are 67/54/43.
    expect(rgbToHsl({ r: 156, g: 170, b: 51 })).toEqual({ h: 67, s: 54, l: 43 })
  })

  it('round-trips within rounding error', () => {
    for (const rgb of [
      { r: 156, g: 170, b: 51 },
      { r: 12, g: 200, b: 240 },
      { r: 250, g: 3, b: 128 },
      { r: 77, g: 77, b: 78 }
    ]) {
      // HSL is stored as integer degrees and percents, so one step of lightness is already 2.55
      // levels of a channel. A few levels of loss is the quantization, not a conversion error.
      const back = hslToRgb(rgbToHsl(rgb))
      expect(Math.abs(back.r - rgb.r)).toBeLessThanOrEqual(5)
      expect(Math.abs(back.g - rgb.g)).toBeLessThanOrEqual(5)
      expect(Math.abs(back.b - rgb.b)).toBeLessThanOrEqual(5)
    }
  })

  it('wraps hue and clamps saturation and lightness', () => {
    expect(hslToRgb({ h: 360, s: 100, l: 50 })).toEqual(hslToRgb({ h: 0, s: 100, l: 50 }))
    expect(hslToRgb({ h: -60, s: 100, l: 50 })).toEqual(hslToRgb({ h: 300, s: 100, l: 50 }))
    expect(hslToRgb({ h: 0, s: 500, l: -20 })).toEqual({ r: 0, g: 0, b: 0 })
  })
})

describe('formatColor', () => {
  const rgb = { r: 156, g: 170, b: 51 }

  it('emits each format at full alpha', () => {
    expect(formatColor(rgb, 'hex')).toBe('#9CAA33')
    expect(formatColor(rgb, 'rgb')).toBe('rgb(156, 170, 51)')
    expect(formatColor(rgb, 'hsl')).toBe('hsl(67, 54%, 43%)')
  })

  it('switches to the alpha-carrying form below full alpha', () => {
    expect(formatColor(rgb, 'rgb', 50)).toBe('rgba(156, 170, 51, 0.5)')
    expect(formatColor(rgb, 'hsl', 50)).toBe('hsla(67, 54%, 43%, 0.5)')
    // Hex carries alpha as a fourth byte so the value stays pasteable as CSS.
    expect(formatColor(rgb, 'hex', 50)).toBe('#9CAA3380')
    expect(formatColor(rgb, 'hex', 0)).toBe('#9CAA3300')
  })

  it('treats alpha at or above 100 as opaque', () => {
    expect(formatColor(rgb, 'hex', 100)).toBe('#9CAA33')
    expect(formatColor(rgb, 'rgb', 140)).toBe('rgb(156, 170, 51)')
  })

  it('produces css that a browser can consume', () => {
    expect(cssColor(rgb)).toBe('rgb(156, 170, 51)')
    expect(cssColor(rgb, 40)).toBe('rgba(156, 170, 51, 0.4)')
  })

  it('clamps alpha into range', () => {
    expect(clampAlpha(-5)).toBe(0)
    expect(clampAlpha(180)).toBe(100)
    expect(clampAlpha(Number.NaN)).toBe(0)
  })
})

describe('readableTextColor', () => {
  it('puts dark text on light colours and light text on dark ones', () => {
    expect(readableTextColor({ r: 255, g: 255, b: 255 })).toBe('#0b1220')
    expect(readableTextColor({ r: 0, g: 0, b: 0 })).toBe('#ffffff')
  })

  it('follows luminance rather than hsl lightness', () => {
    // Pure yellow and pure blue are both 50% lightness in HSL, but white text is unreadable on
    // yellow. Luminance separates them; HSL lightness would not.
    const yellow = { r: 255, g: 255, b: 0 }
    const blue = { r: 0, g: 0, b: 255 }
    expect(rgbToHsl(yellow).l).toBe(rgbToHsl(blue).l)
    expect(readableTextColor(yellow)).toBe('#0b1220')
    expect(readableTextColor(blue)).toBe('#ffffff')
  })

  it('orders luminance by human sensitivity to each channel', () => {
    const red = relativeLuminance({ r: 255, g: 0, b: 0 })
    const green = relativeLuminance({ r: 0, g: 255, b: 0 })
    const blue = relativeLuminance({ r: 0, g: 0, b: 255 })
    expect(green).toBeGreaterThan(red)
    expect(red).toBeGreaterThan(blue)
  })
})

describe('relatedColors', () => {
  it('keeps the picked colour in the middle of the row', () => {
    const rgb = { r: 156, g: 170, b: 51 }
    const row = relatedColors(rgb, 5)
    expect(row).toHaveLength(5)
    expect(row[2]).toEqual(rgb)
  })

  it('runs light to dark across the row', () => {
    const row = relatedColors({ r: 156, g: 170, b: 51 }, 5)
    const lightness = row.map((color) => rgbToHsl(color).l)
    for (let index = 1; index < lightness.length; index++) {
      expect(lightness[index]).toBeLessThan(lightness[index - 1])
    }
  })

  it('holds the hue steady so the row reads as one colour', () => {
    const base = rgbToHsl({ r: 22, g: 119, b: 232 })
    for (const color of relatedColors({ r: 22, g: 119, b: 232 }, 5)) {
      const hue = rgbToHsl(color).h
      // Near-black and near-white steps drift a degree or two through integer rounding.
      if (rgbToHsl(color).s > 5) expect(Math.abs(hue - base.h)).toBeLessThanOrEqual(3)
    }
  })

  it('still spreads for a colour that starts near black or white', () => {
    for (const rgb of [{ r: 4, g: 4, b: 6 }, { r: 252, g: 252, b: 250 }]) {
      const row = relatedColors(rgb, 5)
      const lightness = row.map((color) => rgbToHsl(color).l)
      expect(new Set(lightness).size).toBeGreaterThan(1)
      expect(Math.max(...lightness) - Math.min(...lightness)).toBeGreaterThan(5)
    }
  })

  it('handles degenerate counts', () => {
    expect(relatedColors({ r: 10, g: 10, b: 10 }, 0)).toEqual([])
    expect(relatedColors({ r: 10, g: 10, b: 10 }, 1)).toEqual([{ r: 10, g: 10, b: 10 }])
  })
})

describe('colorName', () => {
  it('names the reference colour the way the design does', () => {
    expect(colorName({ r: 156, g: 170, b: 51 })).toBe('Grass')
  })

  it('names the ends of the grey axis', () => {
    expect(colorName({ r: 0, g: 0, b: 0 })).toBe('Black')
    expect(colorName({ r: 255, g: 255, b: 255 })).toBe('White')
  })

  it('always returns a name, including for out-of-range input', () => {
    expect(colorName({ r: -10, g: 999, b: 40 })).toBeTruthy()
  })
})
