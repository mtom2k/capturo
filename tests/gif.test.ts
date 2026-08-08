import { describe, expect, it } from 'vitest'
import { frameDelayMs, MIN_GIF_COLORS, paletteColorsForQuality } from '../src/shared/gif'
import { GifRecordingEncoder } from '../src/renderer/gif-encoder'

describe('gif helpers', () => {
  it('maps quality to a clamped palette size', () => {
    expect(paletteColorsForQuality(100)).toBe(256)
    expect(paletteColorsForQuality(50)).toBe(128)
    expect(paletteColorsForQuality(1)).toBe(MIN_GIF_COLORS)
    expect(paletteColorsForQuality(500)).toBe(256)
  })

  it('maps fps to a frame delay in ms', () => {
    expect(frameDelayMs(10)).toBe(100)
    expect(frameDelayMs(20)).toBe(50)
    expect(frameDelayMs(0)).toBe(1000)
  })
})

describe('GifRecordingEncoder', () => {
  it('encodes synthetic frames into a valid animated GIF', () => {
    const width = 8
    const height = 8
    const encoder = new GifRecordingEncoder(width, height, 15, 80)
    for (let frame = 0; frame < 3; frame += 1) {
      const rgba = new Uint8Array(width * height * 4)
      for (let pixel = 0; pixel < width * height; pixel += 1) {
        rgba[pixel * 4] = frame === 0 ? 255 : 0
        rgba[pixel * 4 + 1] = frame === 1 ? 255 : 0
        rgba[pixel * 4 + 2] = frame === 2 ? 255 : 0
        rgba[pixel * 4 + 3] = 255
      }
      encoder.addFrame(rgba)
    }
    const bytes = encoder.finish()
    expect(encoder.frameCount).toBe(3)
    expect(String.fromCharCode(...bytes.slice(0, 6))).toBe('GIF89a')
    expect(bytes.length).toBeGreaterThan(20)
  })

  it('inter-frame differencing keeps static content tiny', () => {
    const width = 64
    const height = 64
    const staticFrame = (): Uint8Array => {
      const rgba = new Uint8Array(width * height * 4)
      for (let pixel = 0; pixel < width * height; pixel += 1) {
        rgba[pixel * 4] = 100
        rgba[pixel * 4 + 1] = 150
        rgba[pixel * 4 + 2] = 200
        rgba[pixel * 4 + 3] = 255
      }
      return rgba
    }
    const encoder = new GifRecordingEncoder(width, height, 15, 80)
    for (let frame = 0; frame < 30; frame += 1) encoder.addFrame(staticFrame())
    const bytes = encoder.finish()
    // Every frame after the first is fully transparent, so 30 identical frames stay a few KB
    // rather than the ~120 KB of 30 full frames — roughly an order of magnitude smaller.
    expect(bytes.length).toBeLessThan(8000)
  })
})
