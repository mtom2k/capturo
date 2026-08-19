import { describe, expect, it } from 'vitest'
import {
  FINE_FACTOR,
  advancePointer,
  initialPointerState,
  magnifierPlacement,
  magnifierRegion,
  nudgePointer,
  pixelAt
} from '../src/shared/picker'

const bounds = { width: 1920, height: 1080 }

describe('advancePointer', () => {
  it('tracks the cursor one-to-one in coarse mode', () => {
    const state = initialPointerState({ x: 100, y: 100 })
    const next = advancePointer(state, { x: 140, y: 130 }, { x: 40, y: 30 }, false, bounds)
    expect(next.point).toEqual({ x: 140, y: 130 })
    expect(next.offset).toEqual({ x: 0, y: 0 })
  })

  it('moves a fraction of the cursor delta while shift is held', () => {
    const state = initialPointerState({ x: 500, y: 500 })
    const next = advancePointer(state, { x: 580, y: 500 }, { x: 80, y: 0 }, true, bounds)
    // 80 physical pixels become 10 sampled pixels at one eighth.
    expect(next.point.x).toBeCloseTo(500 + 80 * FINE_FACTOR)
    expect(next.point.y).toBe(500)
  })

  it('lets a whole mouse sweep resolve single pixels', () => {
    let state = initialPointerState({ x: 500, y: 500 })
    for (let step = 0; step < 8; step++) {
      state = advancePointer(state, { x: 500 + step + 1, y: 500 }, { x: 1, y: 0 }, true, bounds)
    }
    // Eight physical pixels of travel land exactly one pixel across.
    expect(state.point.x).toBeCloseTo(501)
  })

  it('does not snap back when shift is released', () => {
    // The whole reason the offset exists: leaving fine mode must not teleport the magnifier to
    // wherever the physical cursor drifted to.
    let state = initialPointerState({ x: 500, y: 500 })
    state = advancePointer(state, { x: 580, y: 500 }, { x: 80, y: 0 }, true, bounds)
    const fineX = state.point.x
    expect(fineX).toBeCloseTo(510)

    const afterRelease = advancePointer(state, { x: 590, y: 500 }, { x: 10, y: 0 }, false, bounds)
    // It carries on from where fine mode left it, moving a little faster than the cursor while
    // it catches up. What it must never do is jump to the physical cursor at 590.
    expect(afterRelease.point.x).toBeGreaterThan(fineX)
    expect(afterRelease.point.x).toBeLessThan(fineX + 30)
  })

  it('bleeds the fine displacement off over coarse movement instead of jumping', () => {
    // Coarse movement after a fine excursion is deliberately not one-to-one: it spends part of
    // the travel pulling the sample back onto the cursor. A hard resync would be a visible jump,
    // and leaving the displacement standing would strand part of the screen (see the edge test).
    let state = initialPointerState({ x: 400, y: 400 })
    state = advancePointer(state, { x: 464, y: 400 }, { x: 64, y: 0 }, true, bounds)
    expect(state.offset.x).toBeLessThan(0)
    const displaced = state.offset.x

    const before = state.point.x
    state = advancePointer(state, { x: 564, y: 400 }, { x: 100, y: 0 }, false, bounds)
    // Still moves right, still smooth, but slightly faster than the cursor while catching up.
    expect(state.point.x).toBeGreaterThan(before)
    expect(Math.abs(state.offset.x)).toBeLessThan(Math.abs(displaced))
  })

  it('returns to one-to-one tracking once the displacement is spent', () => {
    let state = initialPointerState({ x: 400, y: 400 })
    state = advancePointer(state, { x: 464, y: 400 }, { x: 64, y: 0 }, true, bounds)
    let cursor = 464
    for (let step = 0; step < 20; step++) {
      cursor += 40
      state = advancePointer(state, { x: cursor, y: 400 }, { x: 40, y: 0 }, false, bounds)
    }
    expect(state.offset.x).toBe(0)

    const before = state.point.x
    state = advancePointer(state, { x: cursor + 50, y: 400 }, { x: 50, y: 0 }, false, bounds)
    expect(state.point.x).toBeCloseTo(before + 50)
  })

  it('clamps the sample inside the image', () => {
    const state = initialPointerState({ x: 10, y: 10 })
    const low = advancePointer(state, { x: -50, y: -50 }, { x: -60, y: -60 }, false, bounds)
    expect(low.point).toEqual({ x: 0, y: 0 })
    const high = advancePointer(state, { x: 5000, y: 5000 }, { x: 4990, y: 4990 }, false, bounds)
    expect(high.point).toEqual({ x: bounds.width - 1, y: bounds.height - 1 })
  })

  it('lets the sample still reach the far edge after a long fine excursion', () => {
    // This is the failure the decay exists to prevent. Fine movement leftwards displaces the
    // sample to the right of the physical cursor; once the cursor is pinned against the left
    // edge of the screen it can deliver no more leftward travel, so a standing displacement
    // would leave a band of the screen permanently unpickable.
    let cursor = 900
    let state = initialPointerState({ x: cursor, y: 500 })
    for (let step = 0; step < 60; step++) {
      cursor -= 10
      state = advancePointer(state, { x: cursor, y: 500 }, { x: -10, y: 0 }, true, bounds)
    }
    expect(state.offset.x).toBeGreaterThan(100)

    // Ordinary coarse movement to the left edge, with the cursor stopping at 0 as a real one does.
    for (let step = 0; step < 40; step++) {
      cursor = Math.max(0, cursor - 40)
      state = advancePointer(state, { x: cursor, y: 500 }, { x: -40, y: 0 }, false, bounds)
    }
    expect(cursor).toBe(0)
    expect(state.point.x).toBe(0)
    expect(state.offset.x).toBe(0)
  })

  it('collapses the displacement when the sample is clamped at an edge', () => {
    const state = { point: { x: 100, y: 100 }, offset: { x: -400, y: 0 } }
    const next = advancePointer(state, { x: 10, y: 100 }, { x: 0, y: 0 }, true, bounds)
    expect(next.point.x).toBe(0)
    expect(next.offset.x).toBe(-10)
  })

  it('survives a non-finite delta without corrupting the state', () => {
    const state = initialPointerState({ x: 100, y: 100 })
    const next = advancePointer(state, { x: Number.NaN, y: 100 }, { x: Number.NaN, y: 0 }, true, bounds)
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

describe('magnifierPlacement', () => {
  const viewport = { width: 1000, height: 800 }

  it('prefers below and to the right of the sampled point', () => {
    expect(magnifierPlacement({ x: 100, y: 100 }, 180, 24, viewport)).toEqual({ x: 124, y: 124 })
  })

  it('flips rather than covering the pixel being picked', () => {
    const nearRight = magnifierPlacement({ x: 980, y: 100 }, 180, 24, viewport)
    expect(nearRight.x + 180).toBeLessThanOrEqual(980)
    const nearBottom = magnifierPlacement({ x: 100, y: 780 }, 180, 24, viewport)
    expect(nearBottom.y + 180).toBeLessThanOrEqual(780)
  })

  it('keeps the magnifier fully inside the viewport in every corner', () => {
    for (const point of [
      { x: 0, y: 0 },
      { x: 999, y: 0 },
      { x: 0, y: 799 },
      { x: 999, y: 799 }
    ]) {
      const placed = magnifierPlacement(point, 180, 24, viewport)
      expect(placed.x).toBeGreaterThanOrEqual(0)
      expect(placed.y).toBeGreaterThanOrEqual(0)
      expect(placed.x + 180).toBeLessThanOrEqual(viewport.width)
      expect(placed.y + 180).toBeLessThanOrEqual(viewport.height)
    }
  })
})
