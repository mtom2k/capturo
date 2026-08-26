import { describe, expect, it } from 'vitest'
import {
  analyzePanoramicMovement,
  chooseHistoryAnchoredPanoramicMovement,
  findScrollOffset,
  panoramicBounds,
  panoramicCursorMask,
  panoramicExposure,
  panoramicOutlineHole,
  panoramicOutlineRect,
  panoramicRectIntersection,
  PANORAMIC_OUTLINE_GAP,
  PANORAMIC_OUTLINE_THICKNESS,
  panoramicTrustedInterior,
  panoramicViewportAfterMovement,
  refreshablePanoramicRects,
  rollingCaptureDimensions,
  rollingCaptureFits,
  uncoveredPanoramicRects
} from '../src/shared/scroll'

function patternedImage(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4
      data[index] = (x * 17 + y * 3 + Math.floor(y / 7) * 29) % 256
      data[index + 1] = (x * 5 + y * 13 + Math.floor(x / 5) * 31) % 256
      data[index + 2] = (x * 11 + y * 19 + Math.floor((x + y) / 9) * 23) % 256
      data[index + 3] = 255
    }
  }
  return data
}

function sparseDocument(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const line = Math.floor(y / 18)
    const withinLine = y % 18
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4
      const glyph = x < width * 0.38 && withinLine >= 3 && withinLine <= 12 &&
        ((x + line * 7) % 17 < 5 || (x * 3 + line * 11) % 29 < 4)
      const value = glyph ? 170 + (line * 19) % 75 : 28
      data[index] = value
      data[index + 1] = glyph ? 190 + (line * 11) % 55 : 28
      data[index + 2] = glyph ? 215 + (line * 7) % 35 : 28
      data[index + 3] = 255
    }
  }
  return data
}

function periodicDocument(width: number, height: number, period: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4
      const repeatedY = y % period
      data[index] = (x * 17 + repeatedY * 11) % 256
      data[index + 1] = (x * 7 + repeatedY * 23) % 256
      data[index + 2] = (x * 29 + repeatedY * 5) % 256
      data[index + 3] = 255
    }
  }
  return data
}

function crop(
  source: Uint8ClampedArray,
  sourceWidth: number,
  x: number,
  y: number,
  width: number,
  height: number
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(width * height * 4)
  for (let row = 0; row < height; row += 1) {
    const start = ((y + row) * sourceWidth + x) * 4
    result.set(source.subarray(start, start + width * 4), row * width * 4)
  }
  return result
}

describe('rolling capture overlap detection', () => {
  it('finds exact vertical movement between overlapping viewports', () => {
    const width = 96
    const viewportHeight = 120
    const offset = 37
    const source = patternedImage(width, viewportHeight + offset)
    const previous = crop(source, width, 0, 0, width, viewportHeight)
    const current = crop(source, width, 0, offset, width, viewportHeight)
    expect(findScrollOffset(previous, current, width, viewportHeight, 'vertical')?.offset).toBe(offset)
  })

  it('finds exact horizontal movement between overlapping viewports', () => {
    const viewportWidth = 140
    const height = 84
    const offset = 43
    const source = patternedImage(viewportWidth + offset, height)
    const previous = crop(source, viewportWidth + offset, 0, 0, viewportWidth, height)
    const current = crop(source, viewportWidth + offset, offset, 0, viewportWidth, height)
    expect(findScrollOffset(previous, current, viewportWidth, height, 'horizontal')?.offset).toBe(offset)
  })

  it('finds movement in a sparse document with a large uniform background', () => {
    const width = 360
    const viewportHeight = 220
    const offset = 72
    const source = sparseDocument(width, viewportHeight + offset)
    const previous = crop(source, width, 0, 0, width, viewportHeight)
    const current = crop(source, width, 0, offset, width, viewportHeight)
    expect(findScrollOffset(previous, current, width, viewportHeight, 'vertical')?.offset).toBe(offset)
  })

  it('ignores a sticky leading header while matching the moving document', () => {
    const width = 100
    const viewportHeight = 140
    const offset = 31
    const source = patternedImage(width, viewportHeight + offset)
    const previous = crop(source, width, 0, 0, width, viewportHeight)
    const current = crop(source, width, 0, offset, width, viewportHeight)
    // Simulate a fixed 12px header that stays identical while the rest scrolls.
    current.set(previous.subarray(0, width * 12 * 4), 0)
    expect(findScrollOffset(previous, current, width, viewportHeight, 'vertical')?.offset).toBe(offset)
  })

  it('rejects unchanged or unrelated frames instead of appending corrupt pixels', () => {
    const frame = patternedImage(90, 100)
    expect(findScrollOffset(frame, frame.slice(), 90, 100, 'vertical')).toBeNull()
    expect(findScrollOffset(frame, patternedImage(90, 100).reverse(), 90, 100, 'vertical')).toBeNull()
  })

  it('rejects a jump that leaves too little overlap to verify safely', () => {
    const width = 120
    const height = 160
    const offset = 112
    const source = patternedImage(width, height + offset)
    const previous = crop(source, width, 0, 0, width, height)
    const current = crop(source, width, 0, offset, width, height)
    expect(findScrollOffset(previous, current, width, height, 'vertical')).toBeNull()
  })

  it('rejects periodic layouts with several equally plausible offsets', () => {
    const width = 120
    const height = 180
    const offset = 24
    const source = periodicDocument(width, height + offset, 32)
    const previous = crop(source, width, 0, 0, width, height)
    const current = crop(source, width, 0, offset, width, height)
    expect(findScrollOffset(previous, current, width, height, 'vertical')).toBeNull()
  })
})

describe('panoramic movement and coverage', () => {
  it('maps a high-DPI cursor footprint into panorama world coordinates', () => {
    // 40 DIP of pointer radius on a 800x600 DIP region captured at 1600x1200 physical pixels.
    const pointer = { x: 0.5, y: 0.25, radiusX: 40 / 800, radiusY: 40 / 600 }
    expect(panoramicCursorMask({ x: 400, y: 700 }, pointer, 1600, 1200)).toEqual({
      x: 1120,
      y: 920,
      width: 160,
      height: 160
    })
    expect(panoramicCursorMask({ x: 0, y: 0 }, null, 1600, 1200)).toBeNull()
  })

  it('keeps the pointer mask on whole pixels so layers never land between them', () => {
    // A fractional mask edge survives into every retained rectangle and makes the final canvas
    // resample that layer, softening the seam around each repaired pointer hole.
    const mask = panoramicCursorMask(
      { x: 3, y: 7 },
      { x: 0.3137, y: 0.6193, radiusX: 0.031, radiusY: 0.028 },
      1063,
      797
    )!
    for (const value of [mask.x, mask.y, mask.width, mask.height]) {
      expect(Number.isInteger(value)).toBe(true)
    }
    expect(mask.width).toBeGreaterThanOrEqual(64)
  })

  it('leaves whole-pixel coverage behind a masked pointer', () => {
    // Retained rectangles are carved out of the pointer mask, and the size guard only accepts whole
    // pixels. A fractional mask therefore both blurred every repaired seam and made a healthy
    // session report that it had reached the maximum panoramic size.
    const viewport = { x: 0, y: 0, width: 1063, height: 797 }
    const mask = panoramicCursorMask(
      { x: 0, y: 0 },
      { x: 0.4371, y: 0.5119, radiusX: 0.0413, radiusY: 0.0551 },
      viewport.width,
      viewport.height
    )!
    const retained = uncoveredPanoramicRects(viewport, [mask])
    expect(retained.length).toBeGreaterThan(0)
    for (const rect of retained) {
      for (const value of [rect.x, rect.y, rect.width, rect.height]) {
        expect(Number.isInteger(value)).toBe(true)
      }
    }
    const bounds = panoramicBounds(retained)!
    expect(bounds).toEqual(viewport)
    expect(rollingCaptureFits(bounds.width, bounds.height)).toBe(true)
  })

  it('outlines the selected viewport without painting inside the captured crop', () => {
    const region = { x: 240, y: 130, width: 900, height: 620 }
    const outline = panoramicOutlineRect(region)
    const hole = panoramicOutlineHole(region)
    expect(outline).toEqual({
      x: region.x - PANORAMIC_OUTLINE_GAP - PANORAMIC_OUTLINE_THICKNESS,
      y: region.y - PANORAMIC_OUTLINE_GAP - PANORAMIC_OUTLINE_THICKNESS,
      width: region.width + (PANORAMIC_OUTLINE_GAP + PANORAMIC_OUTLINE_THICKNESS) * 2,
      height: region.height + (PANORAMIC_OUTLINE_GAP + PANORAMIC_OUTLINE_THICKNESS) * 2
    })
    // Display-capture rounding can reach a pixel or two past the requested crop, so everything the
    // outline paints must clear the region by the full gap. Only its transparent centre may
    // overlap the captured pixels, and it has to cover them completely.
    expect(hole.x).toBe(region.x - PANORAMIC_OUTLINE_GAP)
    expect(hole.y).toBe(region.y - PANORAMIC_OUTLINE_GAP)
    expect(hole.width).toBe(region.width + PANORAMIC_OUTLINE_GAP * 2)
    expect(hole.height).toBe(region.height + PANORAMIC_OUTLINE_GAP * 2)
    expect(panoramicRectIntersection(hole, region)).toEqual(region)
    // A window only a couple of pixels tall is silently inflated by Windows, which once pushed a
    // strip of the outline through the top of the captured region. Keep it one large ring.
    expect(Math.min(outline.width, outline.height)).toBeGreaterThan(64)
  })

  it('infers all four directions without a preselected axis', () => {
    const width = 120
    const height = 100
    const verticalOffset = 29
    const verticalSource = patternedImage(width, height + verticalOffset)
    const verticalTop = crop(verticalSource, width, 0, 0, width, height)
    const verticalBottom = crop(verticalSource, width, 0, verticalOffset, width, height)
    expect(analyzePanoramicMovement(verticalTop, verticalBottom, width, height)?.direction).toBe('down')
    expect(analyzePanoramicMovement(verticalBottom, verticalTop, width, height)?.direction).toBe('up')

    const horizontalOffset = 33
    const horizontalSource = patternedImage(width + horizontalOffset, height)
    const horizontalLeft = crop(horizontalSource, width + horizontalOffset, 0, 0, width, height)
    const horizontalRight = crop(horizontalSource, width + horizontalOffset, horizontalOffset, 0, width, height)
    expect(analyzePanoramicMovement(horizontalLeft, horizontalRight, width, height)?.direction).toBe('right')
    expect(analyzePanoramicMovement(horizontalRight, horizontalLeft, width, height)?.direction).toBe('left')
  })

  it('places newly exposed pixels in panoramic coordinates', () => {
    const down = { direction: 'down' as const, offset: 30, delta: { x: 0, y: 30 }, score: 0, confidence: 1 }
    const position = panoramicViewportAfterMovement({ x: 10, y: 20 }, down)
    expect(position).toEqual({ x: 10, y: 50 })
    expect(panoramicExposure(position, { width: 200, height: 120 }, down)).toEqual({
      source: { x: 0, y: 90, width: 200, height: 30 },
      world: { x: 10, y: 140, width: 200, height: 30 }
    })
  })

  it('fails closed when known panorama pixels disprove a plausible repeated-layout match', () => {
    const movement = {
      direction: 'down' as const,
      offset: 120,
      delta: { x: 0, y: 120 },
      score: 4,
      confidence: 0.9
    }
    expect(chooseHistoryAnchoredPanoramicMovement([
      { movement, historyScore: 76, historySamples: 180 }
    ])).toEqual({ anchored: true, movement: null })
    expect(chooseHistoryAnchoredPanoramicMovement([
      { movement, historyScore: 5, historySamples: 180 }
    ])).toEqual({ anchored: true, movement })
    expect(chooseHistoryAnchoredPanoramicMovement([
      { movement, historyScore: 5, historySamples: 12 }
    ])).toEqual({ anchored: false, movement: null })
  })

  it('subtracts already-captured areas and retains only genuinely new coverage', () => {
    const captured = [{ x: 0, y: 0, width: 100, height: 100 }]
    const pieces = uncoveredPanoramicRects({ x: 80, y: 20, width: 60, height: 60 }, captured)
    expect(pieces).toEqual([{ x: 100, y: 20, width: 40, height: 60 }])
    expect(uncoveredPanoramicRects({ x: 20, y: 20, width: 40, height: 40 }, captured)).toEqual([])
  })

  it('tracks bounds across negative and positive movement', () => {
    expect(panoramicBounds([
      { x: 0, y: 0, width: 100, height: 80 },
      { x: -35, y: 10, width: 35, height: 50 },
      { x: 20, y: 80, width: 70, height: 25 }
    ])).toEqual({ x: -35, y: 0, width: 135, height: 105 })
  })

  it('promotes provisional edge pixels only after they enter the trusted viewport interior', () => {
    const interior = panoramicTrustedInterior({ x: 0, y: 80 }, { width: 200, height: 300 }, 'down')
    expect(interior).toEqual({ x: 0, y: 122, width: 200, height: 216 })
    expect(refreshablePanoramicRects(
      interior,
      [
        { x: 0, y: 0, width: 200, height: 300 },
        { x: 0, y: 300, width: 200, height: 80 }
      ],
      [{ x: 0, y: 0, width: 200, height: 300 }]
    )).toEqual([{ x: 0, y: 300, width: 200, height: 38 }])
  })
})

describe('rolling capture bounds', () => {
  it('extends only the selected axis', () => {
    expect(rollingCaptureDimensions({ width: 800, height: 600 }, 1200, 'vertical')).toEqual({ width: 800, height: 1800 })
    expect(rollingCaptureDimensions({ width: 800, height: 600 }, 1200, 'horizontal')).toEqual({ width: 2000, height: 600 })
  })

  it('caps dimensions and total decoded pixels', () => {
    expect(rollingCaptureFits(1200, 20_000)).toBe(true)
    expect(rollingCaptureFits(31_000, 100)).toBe(false)
    expect(rollingCaptureFits(20_000, 20_000)).toBe(false)
  })
})
