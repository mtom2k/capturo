import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PICKER_ZOOM_INDEX,
  MAXIMUM_ZOOM_MOVEMENT_FACTOR,
  PICKER_ZOOM_LEVELS,
  advancePointerAtFactor,
  constrainPointerOffset,
  cursorForDisplay,
  displayPixelSize,
  floatingPickerRect,
  floatingPickerRegionOrigin,
  initialPointerState,
  magnifierPlacement,
  magnifierRegion,
  nudgePointer,
  parseRgbHexGrid,
  PICKER_SAMPLE_INTERVAL_MS,
  pickerSampleDelay,
  pixelAt,
  pointDelta,
  stepPickerZoomIndex
} from '../src/shared/picker'

const bounds = { width: 1920, height: 1080 }

describe('displayPixelSize', () => {
  it('converts a Retina display from DIP units to source-image pixels', () => {
    expect(displayPixelSize({ width: 1512, height: 982 }, 2)).toEqual({ width: 3024, height: 1964 })
  })

  it('rounds fractional scaled dimensions up and survives an invalid scale factor', () => {
    expect(displayPixelSize({ width: 1365, height: 768 }, 1.25)).toEqual({ width: 1707, height: 960 })
    expect(displayPixelSize({ width: 800, height: 600 }, Number.NaN)).toEqual({ width: 800, height: 600 })
  })
})

describe('pickerSampleDelay', () => {
  it('starts the first live sample immediately', () => {
    expect(pickerSampleDelay(Number.NEGATIVE_INFINITY, 100)).toBe(0)
  })

  it('limits preview sampling to 30 starts per second', () => {
    expect(PICKER_SAMPLE_INTERVAL_MS).toBeCloseTo(1000 / 30)
    expect(pickerSampleDelay(100, 105)).toBeCloseTo(PICKER_SAMPLE_INTERVAL_MS - 5)
    expect(pickerSampleDelay(100, 100 + PICKER_SAMPLE_INTERVAL_MS)).toBe(0)
    expect(pickerSampleDelay(100, 1000)).toBe(0)
  })

  it('does not grant negative or invalid elapsed time extra sample capacity', () => {
    expect(pickerSampleDelay(100, 90)).toBeCloseTo(PICKER_SAMPLE_INTERVAL_MS)
    expect(pickerSampleDelay(100, Number.NaN)).toBeCloseTo(PICKER_SAMPLE_INTERVAL_MS)
  })
})

describe('advancePointerAtFactor', () => {
  it('tracks the cursor one-to-one at wide zoom', () => {
    const state = initialPointerState({ x: 100, y: 100 })
    const next = advancePointerAtFactor(state, { x: 140, y: 130 }, { x: 40, y: 30 }, 1, bounds)
    expect(next.point).toEqual({ x: 140, y: 130 })
    expect(next.offset).toEqual({ x: 0, y: 0 })
  })

  it('moves a fraction of the cursor delta at maximum zoom', () => {
    const state = initialPointerState({ x: 500, y: 500 })
    const next = advancePointerAtFactor(
      state,
      { x: 580, y: 500 },
      { x: 80, y: 0 },
      MAXIMUM_ZOOM_MOVEMENT_FACTOR,
      bounds
    )
    // 80 physical pixels become 10 sampled pixels at one eighth.
    expect(next.point.x).toBeCloseTo(500 + 80 * MAXIMUM_ZOOM_MOVEMENT_FACTOR)
    expect(next.point.y).toBe(500)
  })

  it('lets maximum zoom resolve single pixels', () => {
    let state = initialPointerState({ x: 500, y: 500 })
    for (let step = 0; step < 8; step++) {
      state = advancePointerAtFactor(
        state,
        { x: 500 + step + 1, y: 500 },
        { x: 1, y: 0 },
        MAXIMUM_ZOOM_MOVEMENT_FACTOR,
        bounds
      )
    }
    // Eight physical pixels of travel land exactly one pixel across.
    expect(state.point.x).toBeCloseTo(501)
  })

  it('does not snap back when returning to wide zoom', () => {
    // The whole reason the offset exists: leaving precision zoom must not teleport the magnifier to
    // wherever the physical cursor drifted to.
    let state = initialPointerState({ x: 500, y: 500 })
    state = advancePointerAtFactor(
      state,
      { x: 580, y: 500 },
      { x: 80, y: 0 },
      MAXIMUM_ZOOM_MOVEMENT_FACTOR,
      bounds
    )
    const precisionX = state.point.x
    expect(precisionX).toBeCloseTo(510)

    const afterZoomOut = advancePointerAtFactor(state, { x: 590, y: 500 }, { x: 10, y: 0 }, 1, bounds)
    // It carries on from where precision zoom left it, moving a little faster than the cursor while
    // it catches up. What it must never do is jump to the physical cursor at 590.
    expect(afterZoomOut.point.x).toBeGreaterThan(precisionX)
    expect(afterZoomOut.point.x).toBeLessThan(precisionX + 30)
  })

  it('bleeds precision-zoom displacement off at wide zoom instead of jumping', () => {
    // Wide movement after a precision excursion is deliberately not one-to-one: it spends part of
    // the travel pulling the sample back onto the cursor. A hard resync would be a visible jump,
    // and leaving the displacement standing would strand part of the screen (see the edge test).
    let state = initialPointerState({ x: 400, y: 400 })
    state = advancePointerAtFactor(state, { x: 464, y: 400 }, { x: 64, y: 0 }, MAXIMUM_ZOOM_MOVEMENT_FACTOR, bounds)
    expect(state.offset.x).toBeLessThan(0)
    const displaced = state.offset.x

    const before = state.point.x
    state = advancePointerAtFactor(state, { x: 564, y: 400 }, { x: 100, y: 0 }, 1, bounds)
    // Still moves right, still smooth, but slightly faster than the cursor while catching up.
    expect(state.point.x).toBeGreaterThan(before)
    expect(Math.abs(state.offset.x)).toBeLessThan(Math.abs(displaced))
  })

  it('returns to one-to-one tracking once the displacement is spent', () => {
    let state = initialPointerState({ x: 400, y: 400 })
    state = advancePointerAtFactor(state, { x: 464, y: 400 }, { x: 64, y: 0 }, MAXIMUM_ZOOM_MOVEMENT_FACTOR, bounds)
    let cursor = 464
    for (let step = 0; step < 20; step++) {
      cursor += 40
      state = advancePointerAtFactor(state, { x: cursor, y: 400 }, { x: 40, y: 0 }, 1, bounds)
    }
    expect(state.offset.x).toBe(0)

    const before = state.point.x
    state = advancePointerAtFactor(state, { x: cursor + 50, y: 400 }, { x: 50, y: 0 }, 1, bounds)
    expect(state.point.x).toBeCloseTo(before + 50)
  })

  it('clamps the sample inside the image', () => {
    const state = initialPointerState({ x: 10, y: 10 })
    const low = advancePointerAtFactor(state, { x: -50, y: -50 }, { x: -60, y: -60 }, 1, bounds)
    expect(low.point).toEqual({ x: 0, y: 0 })
    const high = advancePointerAtFactor(state, { x: 5000, y: 5000 }, { x: 4990, y: 4990 }, 1, bounds)
    expect(high.point).toEqual({ x: bounds.width - 1, y: bounds.height - 1 })
  })

  it('lets the sample still reach the far edge after a long precision-zoom excursion', () => {
    // This is the failure the decay exists to prevent. Precision movement leftwards displaces the
    // sample to the right of the physical cursor; once the cursor is pinned against the left
    // edge of the screen it can deliver no more leftward travel, so a standing displacement
    // would leave a band of the screen permanently unpickable.
    let cursor = 900
    let state = initialPointerState({ x: cursor, y: 500 })
    for (let step = 0; step < 60; step++) {
      cursor -= 10
      state = advancePointerAtFactor(state, { x: cursor, y: 500 }, { x: -10, y: 0 }, MAXIMUM_ZOOM_MOVEMENT_FACTOR, bounds)
    }
    expect(state.offset.x).toBeGreaterThan(100)

    // Ordinary coarse movement to the left edge, with the cursor stopping at 0 as a real one does.
    for (let step = 0; step < 40; step++) {
      cursor = Math.max(0, cursor - 40)
      state = advancePointerAtFactor(state, { x: cursor, y: 500 }, { x: -40, y: 0 }, 1, bounds)
    }
    expect(cursor).toBe(0)
    expect(state.point.x).toBe(0)
    expect(state.offset.x).toBe(0)
  })

  it('collapses the displacement when the sample is clamped at an edge', () => {
    const state = { point: { x: 100, y: 100 }, offset: { x: -400, y: 0 } }
    const next = advancePointerAtFactor(state, { x: 10, y: 100 }, { x: 0, y: 0 }, MAXIMUM_ZOOM_MOVEMENT_FACTOR, bounds)
    expect(next.point.x).toBe(0)
    expect(next.offset.x).toBe(-10)
  })

  it('survives a non-finite delta without corrupting the state', () => {
    const state = initialPointerState({ x: 100, y: 100 })
    const next = advancePointerAtFactor(
      state,
      { x: Number.NaN, y: 100 },
      { x: Number.NaN, y: 0 },
      MAXIMUM_ZOOM_MOVEMENT_FACTOR,
      bounds
    )
    expect(Number.isFinite(next.point.x)).toBe(true)
    expect(Number.isFinite(next.point.y)).toBe(true)
  })
})

describe('nudgePointer', () => {
  it('moves exactly one pixel per arrow press', () => {
    const state = initialPointerState({ x: 100.4, y: 100.6 })
    expect(nudgePointer(state, { x: 1, y: 0 }, bounds).point).toEqual({ x: 101, y: 101 })
    expect(nudgePointer(state, { x: 0, y: -1 }, bounds).point).toEqual({ x: 100, y: 100 })
  })

  it('stops at the image edge', () => {
    const state = initialPointerState({ x: 0, y: 0 })
    expect(nudgePointer(state, { x: -1, y: -1 }, bounds).point).toEqual({ x: 0, y: 0 })
  })
})

describe('magnifierRegion', () => {
  it('centres the region on the sampled pixel', () => {
    expect(magnifierRegion({ x: 100, y: 50 }, 9)).toEqual({ x: 96, y: 46, size: 9 })
  })

  it('lets the region hang off the image so a corner pixel stays centred', () => {
    // Clamping the region instead would slide the crosshair off the pixel being picked.
    expect(magnifierRegion({ x: 0, y: 0 }, 9)).toEqual({ x: -4, y: -4, size: 9 })
  })

  it('forces an odd-sized region to have a true centre', () => {
    const region = magnifierRegion({ x: 10, y: 10 }, 9)
    expect(region.x + Math.floor(region.size / 2)).toBe(10)
  })
})

describe('pixelAt', () => {
  const width = 2
  const height = 2
  // Red, green, blue, white.
  const data = new Uint8ClampedArray([
    255, 0, 0, 255,
    0, 255, 0, 255,
    0, 0, 255, 255,
    255, 255, 255, 255
  ])

  it('reads each pixel', () => {
    expect(pixelAt(data, width, height, 0, 0)).toEqual({ r: 255, g: 0, b: 0 })
    expect(pixelAt(data, width, height, 1, 0)).toEqual({ r: 0, g: 255, b: 0 })
    expect(pixelAt(data, width, height, 0, 1)).toEqual({ r: 0, g: 0, b: 255 })
    expect(pixelAt(data, width, height, 1, 1)).toEqual({ r: 255, g: 255, b: 255 })
  })

  it('returns null outside the image rather than wrapping to another row', () => {
    expect(pixelAt(data, width, height, -1, 0)).toBeNull()
    expect(pixelAt(data, width, height, 2, 0)).toBeNull()
    expect(pixelAt(data, width, height, 0, -1)).toBeNull()
    expect(pixelAt(data, width, height, 0, 2)).toBeNull()
  })
})

describe('zoom-aware pointer movement', () => {
  it('moves smoothly at each discrete precision factor', () => {
    const state = initialPointerState({ x: 500, y: 500 })
    const next = advancePointerAtFactor(state, { x: 580, y: 500 }, { x: 80, y: 0 }, 1 / 4, bounds)
    expect(next.point.x).toBeCloseTo(520)
    expect(next.offset.x).toBeCloseTo(-60)
  })

  it('caps an extreme maximum-zoom movement to the frame budget', () => {
    const state = initialPointerState({ x: 500, y: 500 })
    const fastest = PICKER_ZOOM_LEVELS[PICKER_ZOOM_LEVELS.length - 1]
    const frameBudget = fastest.maxSpeed / 60
    const next = advancePointerAtFactor(
      state,
      { x: 1500, y: 500 },
      { x: 1000, y: 0 },
      fastest.movementFactor,
      bounds,
      frameBudget
    )
    expect(next.point.x - state.point.x).toBeCloseTo(frameBudget)
    expect(next.point.y).toBe(state.point.y)
  })

  it('does not cap normal movement at the wide zoom levels', () => {
    const state = initialPointerState({ x: 500, y: 500 })
    const widest = PICKER_ZOOM_LEVELS[0]
    const next = advancePointerAtFactor(
      state,
      { x: 900, y: 500 },
      { x: 400, y: 0 },
      widest.movementFactor,
      bounds,
      widest.maxSpeed
    )
    expect(next.point.x).toBe(900)
  })

  it('derives movement from absolute screen points rather than window-relative event deltas', () => {
    expect(pointDelta({ x: 400, y: 300 }, { x: 480, y: 260 })).toEqual({ x: 80, y: -40 })
    // A BrowserWindow recenter can change client coordinates by hundreds of pixels while the
    // physical screen point does not move. Absolute-point movement correctly remains zero.
    expect(pointDelta({ x: 480, y: 260 }, { x: 480, y: 260 })).toEqual({ x: 0, y: 0 })
  })

  it('steps wheel zoom in both directions and clamps at the endpoints', () => {
    expect(PICKER_ZOOM_LEVELS[DEFAULT_PICKER_ZOOM_INDEX]).toMatchObject({ cells: 25, movementFactor: 1 })
    expect(stepPickerZoomIndex(DEFAULT_PICKER_ZOOM_INDEX, -100)).toBe(DEFAULT_PICKER_ZOOM_INDEX + 1)
    expect(stepPickerZoomIndex(DEFAULT_PICKER_ZOOM_INDEX, 100)).toBe(DEFAULT_PICKER_ZOOM_INDEX)
    expect(stepPickerZoomIndex(PICKER_ZOOM_LEVELS.length - 1, -100)).toBe(PICKER_ZOOM_LEVELS.length - 1)
    expect(stepPickerZoomIndex(0, 100)).toBe(0)
  })

  it('uses odd grids and progressively slower movement only at tighter zoom levels', () => {
    expect(PICKER_ZOOM_LEVELS.map((level) => level.cells)).toEqual([25, 17, 13, 9, 5])
    expect(PICKER_ZOOM_LEVELS.every((level) => level.cells % 2 === 1)).toBe(true)
    expect(PICKER_ZOOM_LEVELS.map((level) => level.movementFactor)).toEqual([1, 1, 1 / 2, 1 / 4, 1 / 8])
    expect(PICKER_ZOOM_LEVELS.map((level) => level.maxSpeed)).toEqual([
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      720,
      240,
      80
    ])
    expect(PICKER_ZOOM_LEVELS.every((level) => !('label' in level))).toBe(true)
  })
})

describe('constrainPointerOffset', () => {
  it('preserves zoom displacement while the selector fits inside the floating surface', () => {
    const state = { point: { x: 450, y: 480 }, offset: { x: -50, y: -20 } }
    expect(constrainPointerOffset(
      state,
      { x: 500, y: 500 },
      { minX: -200, maxX: 200, minY: -200, maxY: 200 },
      bounds
    )).toEqual(state)
  })

  it('clamps an owned selector before it can leave the compact picker window', () => {
    const next = constrainPointerOffset(
      { point: { x: 100, y: 900 }, offset: { x: -400, y: 400 } },
      { x: 500, y: 500 },
      { minX: -204, maxX: 204, minY: -204, maxY: 204 },
      bounds
    )
    expect(next.point).toEqual({ x: 296, y: 704 })
    expect(next.offset).toEqual({ x: -204, y: 204 })
  })

  it('recomputes displacement when the image edge is closer than the surface limit', () => {
    const next = constrainPointerOffset(
      { point: { x: -100, y: 50 }, offset: { x: -200, y: 0 } },
      { x: 10, y: 50 },
      { minX: -204, maxX: 204, minY: -204, maxY: 204 },
      bounds
    )
    expect(next.point.x).toBe(0)
    expect(next.offset.x).toBe(-10)
  })
})

describe('floatingPickerRect', () => {
  it('centres a compact picker surface on the screen-space pointer', () => {
    expect(floatingPickerRect(
      { x: 1200, y: 700 },
      { x: 0, y: 0, width: 2560, height: 1440 }
    )).toEqual({ x: 880, y: 380, width: 640, height: 640 })
  })

  it('never equals a small display dimension', () => {
    const rect = floatingPickerRect(
      { x: -640, y: 400 },
      { x: -1280, y: 0, width: 640, height: 480 }
    )
    expect(rect.width).toBe(624)
    expect(rect.height).toBe(464)
  })

  it('may hang beyond a display edge so the pointer stays inside it', () => {
    const rect = floatingPickerRect(
      { x: 0, y: 0 },
      { x: 0, y: 0, width: 1920, height: 1080 }
    )
    expect(rect.x).toBe(-320)
    expect(rect.y).toBe(-320)
  })
})

describe('floatingPickerRegionOrigin', () => {
  it('predicts the same local origin that a recentered floating window will use', () => {
    const display = { x: 0, y: 0, width: 1920, height: 1080 }
    expect(floatingPickerRegionOrigin({ x: 560, y: 500 }, display)).toEqual({ x: 240, y: 180 })
  })

  it('keeps the selector on its absolute point while the native window recenters', () => {
    const display = { x: 0, y: 0, width: 1920, height: 1080 }
    const selectorScreenX = 560
    const previousOriginX = floatingPickerRegionOrigin({ x: 400, y: 500 }, display).x
    const staleLocalX = selectorScreenX - previousOriginX
    const nextOriginX = floatingPickerRegionOrigin({ x: selectorScreenX, y: 500 }, display).x

    // Carrying the previous bitmap with the moved window produces the reported 160px overshoot.
    expect(nextOriginX + staleLocalX).toBe(720)
    // Painting against the predicted origin before the move holds the selector on the cursor.
    expect(nextOriginX + (selectorScreenX - nextOriginX)).toBe(selectorScreenX)
  })
})

describe('parseRgbHexGrid', () => {
  it('decodes row-major RRGGBB pixels into opaque RGBA', () => {
    expect(Array.from(parseRgbHexGrid('FF000000FF00', 2, 1) ?? [])).toEqual([
      255, 0, 0, 255, 0, 255, 0, 255
    ])
  })

  it('rejects malformed or incorrectly sized helper output', () => {
    expect(parseRgbHexGrid('FFFFFF', 2, 1)).toBeNull()
    expect(parseRgbHexGrid('GGGGGG', 1, 1)).toBeNull()
    expect(parseRgbHexGrid('', 0, 1)).toBeNull()
  })
})

describe('magnifierPlacement', () => {
  it('centres the magnifier on the sampled point', () => {
    // The magnifier replaces the cursor, so its centre must land exactly on the pixel it reads.
    const size = 200
    const placed = magnifierPlacement({ x: 400, y: 300 }, size)
    expect(placed).toEqual({ x: 300, y: 200 })
    expect(placed.x + size / 2).toBe(400)
    expect(placed.y + size / 2).toBe(300)
  })

  it('keeps the centre on the pixel at every edge rather than nudging into view', () => {
    // Clamping the magnifier back onto the screen would slide its centre off the sampled pixel
    // and make the readout a lie. Hanging off the edge is the correct trade.
    for (const point of [{ x: 0, y: 0 }, { x: 1919, y: 0 }, { x: 0, y: 1079 }, { x: 1919, y: 1079 }]) {
      const placed = magnifierPlacement(point, 200)
      expect(placed.x + 100).toBe(point.x)
      expect(placed.y + 100).toBe(point.y)
    }
  })

  it('handles an odd size without drifting half a pixel off centre', () => {
    const placed = magnifierPlacement({ x: 100, y: 100 }, 101)
    expect(placed.x + 101 / 2).toBe(100)
  })
})

describe('cursorForDisplay', () => {
  // A typical two-monitor layout: the secondary sits to the right of the primary, and a third
  // above it, so display origins are both positive and negative.
  const primary = { x: 0, y: 0, width: 1920, height: 1080 }
  const secondary = { x: 1920, y: 0, width: 2560, height: 1440 }
  const above = { x: 0, y: -1080, width: 1920, height: 1080 }

  it('reports the pointer only on the display it is actually on', () => {
    const cursor = { x: 2200, y: 300 }
    expect(cursorForDisplay(cursor, primary)).toBeNull()
    expect(cursorForDisplay(cursor, above)).toBeNull()
    expect(cursorForDisplay(cursor, secondary)).toEqual({ x: 280, y: 300 })
  })

  it('makes the position relative to the display, not the desktop', () => {
    // The overlay draws in its own coordinate space, so a pointer at desktop x=1920 is at x=0 on
    // the secondary display. Passing the desktop coordinate straight through would put the
    // magnifier a whole screen width away.
    expect(cursorForDisplay({ x: 1920, y: 0 }, secondary)).toEqual({ x: 0, y: 0 })
  })

  it('handles displays at negative origins', () => {
    expect(cursorForDisplay({ x: 100, y: -500 }, above)).toEqual({ x: 100, y: 580 })
    expect(cursorForDisplay({ x: 100, y: -500 }, primary)).toBeNull()
  })

  it('claims the pointer for exactly one display along a shared edge', () => {
    // The seam between two displays must not be owned by both, or two overlays would each show a
    // magnifier, nor by neither, which would leave the picker showing none at all.
    for (const cursor of [{ x: 1919, y: 500 }, { x: 1920, y: 500 }, { x: 1921, y: 500 }]) {
      const claims = [primary, secondary].filter((bounds) => cursorForDisplay(cursor, bounds) !== null)
      expect(claims).toHaveLength(1)
    }
  })

  it('excludes the far edge so the last pixel belongs to one display only', () => {
    expect(cursorForDisplay({ x: 1919, y: 1079 }, primary)).toEqual({ x: 1919, y: 1079 })
    expect(cursorForDisplay({ x: 1920, y: 0 }, primary)).toBeNull()
    expect(cursorForDisplay({ x: 0, y: 1080 }, primary)).toBeNull()
  })
})
