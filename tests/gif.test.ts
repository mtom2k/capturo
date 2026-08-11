import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import {
  canQueueGifFrame,
  countdownSecondsRemaining,
  frameDelayMs,
  MIN_GIF_COLORS,
  paletteColorsForQuality
} from '../src/shared/gif'
import { GifRecordingEncoder } from '../src/renderer/gif-encoder'

function solidFrame(width: number, height: number, value: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4)
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    rgba[pixel * 4] = value
    rgba[pixel * 4 + 1] = value
    rgba[pixel * 4 + 2] = value
    rgba[pixel * 4 + 3] = 255
  }
  return rgba
}

function setPixel(
  rgba: Uint8Array,
  width: number,
  x: number,
  y: number,
  [red, green, blue]: [number, number, number]
): void {
  const offset = (y * width + x) * 4
  rgba[offset] = red
  rgba[offset + 1] = green
  rgba[offset + 2] = blue
  rgba[offset + 3] = 255
}

// Graphic Control Extensions carry each frame delay as a little-endian 16-bit centisecond
// value: 21 F9 04 <packed> <delay lo> <delay hi> <transparent index> 00.
function frameDelaysMs(bytes: Uint8Array): number[] {
  const delays: number[] = []
  for (let index = 0; index <= bytes.length - 8; index += 1) {
    if (bytes[index] !== 0x21 || bytes[index + 1] !== 0xf9 || bytes[index + 2] !== 0x04) continue
    delays.push((bytes[index + 4] | (bytes[index + 5] << 8)) * 10)
    index += 7
  }
  return delays
}

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

  it('reports whole countdown seconds until an absolute deadline', () => {
    expect(countdownSecondsRemaining(3000, 0)).toBe(3)
    expect(countdownSecondsRemaining(3000, 1)).toBe(3)
    expect(countdownSecondsRemaining(3000, 1000)).toBe(2)
    expect(countdownSecondsRemaining(3000, 2999)).toBe(1)
    expect(countdownSecondsRemaining(3000, 3000)).toBe(0)
    expect(countdownSecondsRemaining(3000, 4000)).toBe(0)
  })

  it('bounds the number of frames queued for the GIF worker', () => {
    expect(canQueueGifFrame(0)).toBe(true)
    expect(canQueueGifFrame(1)).toBe(true)
    expect(canQueueGifFrame(2)).toBe(false)
    expect(canQueueGifFrame(2, 3)).toBe(true)
    expect(canQueueGifFrame(3, 3)).toBe(false)
    expect(canQueueGifFrame(-1)).toBe(false)
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

  it('coalesces a run of identical frames into a single written frame', () => {
    const width = 32
    const height = 32
    const solid = (value: number): Uint8Array => {
      const rgba = new Uint8Array(width * height * 4)
      for (let pixel = 0; pixel < width * height; pixel += 1) {
        rgba[pixel * 4] = value
        rgba[pixel * 4 + 1] = value
        rgba[pixel * 4 + 2] = value
        rgba[pixel * 4 + 3] = 255
      }
      return rgba
    }
    const encoder = new GifRecordingEncoder(width, height, 15, 80)
    for (let frame = 0; frame < 30; frame += 1) encoder.addFrame(solid(120))
    const bytes = encoder.finish()
    // 30 identical frames collapse into one frame whose delay covers the whole static span,
    // rather than 30 separate transparent frames.
    expect(encoder.frameCount).toBe(1)
    expect(String.fromCharCode(...bytes.slice(0, 6))).toBe('GIF89a')
  })

  it('writes one frame per distinct run, coalescing repeats within each', () => {
    const width = 16
    const height = 16
    const solid = (value: number): Uint8Array => {
      const rgba = new Uint8Array(width * height * 4)
      for (let pixel = 0; pixel < width * height; pixel += 1) {
        rgba[pixel * 4] = value
        rgba[pixel * 4 + 1] = value
        rgba[pixel * 4 + 2] = value
        rgba[pixel * 4 + 3] = 255
      }
      return rgba
    }
    const encoder = new GifRecordingEncoder(width, height, 15, 80)
    // A, A, B, B, B, A -> three distinct runs -> three written frames.
    for (const value of [10, 10, 200, 200, 200, 10]) encoder.addFrame(solid(value))
    encoder.finish()
    expect(encoder.frameCount).toBe(3)
  })

  it('uses sparse palette work for localized changes and coalesces the resulting frame', () => {
    const width = 8
    const height = 8
    const first = solidFrame(width, height, 20)
    const second = first.slice()
    setPixel(second, width, 3, 4, [240, 30, 10])

    const encoder = new GifRecordingEncoder(width, height, 30, 70)
    expect(encoder.addFrame(first, 0)).toBe('full')
    expect(encoder.addFrame(second, 100)).toBe('sparse')
    expect(encoder.addFrame(second.slice(), 200)).toBe('coalesced')
    expect(frameDelaysMs(encoder.finish(300))).toEqual([100, 200])
  })

  it('falls back to full-frame palette work when more than a quarter of pixels change', () => {
    const width = 8
    const height = 8
    const first = solidFrame(width, height, 20)
    const second = first.slice()
    for (let pixel = 0; pixel < 17; pixel += 1) {
      setPixel(second, width, pixel % width, Math.floor(pixel / width), [220, 40, 80])
    }

    const encoder = new GifRecordingEncoder(width, height, 30, 70)
    expect(encoder.addFrame(first, 0)).toBe('full')
    expect(encoder.addFrame(second, 100)).toBe('full')
    encoder.finish(200)
  })

  it('preserves localized changed pixels in the decoded animation', async () => {
    const width = 8
    const height = 8
    const first = solidFrame(width, height, 20)
    const second = first.slice()
    setPixel(second, width, 3, 4, [240, 30, 10])

    const encoder = new GifRecordingEncoder(width, height, 30, 100)
    encoder.addFrame(first, 0)
    expect(encoder.addFrame(second, 100)).toBe('sparse')
    const bytes = encoder.finish(200)
    const decoded = await sharp(bytes, { animated: true }).raw().toBuffer({ resolveWithObject: true })
    const pageHeight = decoded.info.pageHeight ?? height
    const channels = decoded.info.channels
    const changedOffset = ((pageHeight + 4) * width + 3) * channels
    const unchangedOffset = ((pageHeight + 4) * width + 2) * channels

    expect(decoded.info.pages).toBe(2)
    expect([...decoded.data.subarray(changedOffset, changedOffset + 3)]).toEqual([240, 30, 10])
    expect([...decoded.data.subarray(unchangedOffset, unchangedOffset + 3)]).toEqual([20, 20, 20])
  })

  it.each([10, 15, 20, 30])('preserves one second at %i fps without per-frame rounding drift', (fps) => {
    const width = 8
    const height = 8
    const encoder = new GifRecordingEncoder(width, height, fps, 80)
    for (let frame = 0; frame < fps; frame += 1) {
      encoder.addFrame(solidFrame(width, height, frame * 7), frame * (1000 / fps))
    }
    const delays = frameDelaysMs(encoder.finish(1000))

    expect(delays).toHaveLength(fps)
    expect(delays.reduce((total, delay) => total + delay, 0)).toBe(1000)
    if (fps === 30) expect(new Set(delays)).toEqual(new Set([30, 40]))
  })

  it('uses actual sample timestamps when renderer sampling is late', () => {
    const width = 8
    const height = 8
    const encoder = new GifRecordingEncoder(width, height, 30, 80)
    const timestamps = [0, 35, 120, 205, 410]
    timestamps.forEach((timestamp, frame) => {
      encoder.addFrame(solidFrame(width, height, frame * 30), timestamp)
    })
    const delays = frameDelaysMs(encoder.finish(550))

    expect(delays).toEqual([40, 80, 90, 200, 140])
    expect(delays.reduce((total, delay) => total + delay, 0)).toBe(550)
  })

  it('coalesces identical samples while preserving their full elapsed duration', () => {
    const encoder = new GifRecordingEncoder(8, 8, 30, 80)
    const frame = solidFrame(8, 8, 90)
    for (const timestamp of [0, 34, 111, 205, 401]) encoder.addFrame(frame, timestamp)
    const delays = frameDelaysMs(encoder.finish(500))

    expect(encoder.frameCount).toBe(1)
    expect(delays).toEqual([500])
  })

  it('splits a static delay that exceeds the GIF 16-bit centisecond limit', () => {
    const encoder = new GifRecordingEncoder(8, 8, 10, 80)
    encoder.addFrame(solidFrame(8, 8, 50), 0)
    const delays = frameDelaysMs(encoder.finish(700_000))

    expect(encoder.frameCount).toBe(2)
    expect(delays).toEqual([655_350, 44_650])
    expect(delays.reduce((total, delay) => total + delay, 0)).toBe(700_000)
  })
})
