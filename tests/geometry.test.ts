import { describe, expect, it } from 'vitest'
import {
  getResizeHandle,
  moveRect,
  normalizeRect,
  resizeRect,
  snapToAxis,
  uncoveredStrips
} from '../src/shared/geometry'

describe('normalizeRect', () => {
  it('normalizes a reverse drag', () => {
    expect(normalizeRect({ x: 40, y: 30 }, { x: 10, y: 12 })).toEqual({
      x: 10,
      y: 12,
      width: 30,
      height: 18
    })
  })
})

describe('selection movement', () => {
  const bounds = { x: 0, y: 0, width: 100, height: 80 }

  it('keeps a moved selection inside the source image', () => {
    expect(moveRect({ x: 70, y: 50, width: 25, height: 20 }, { x: 40, y: 40 }, bounds)).toEqual({
      x: 75,
      y: 60,
      width: 25,
      height: 20
    })
  })

  it('resizes from a corner and respects minimum size', () => {
    expect(
      resizeRect(
        { x: 20, y: 20, width: 50, height: 40 },
        'north-west',
        { x: 68, y: 58 },
        bounds,
        10
      )
    ).toEqual({ x: 60, y: 50, width: 10, height: 10 })
  })
})

describe('resize handles', () => {
  const rect = { x: 20, y: 20, width: 60, height: 40 }

  it('prefers corner handles where edges overlap', () => {
    expect(getResizeHandle({ x: 21, y: 21 }, rect, 5)).toBe('north-west')
  })

  it('finds a side handle', () => {
    expect(getResizeHandle({ x: 80, y: 40 }, rect, 5)).toBe('east')
  })
})

describe('uncoveredStrips', () => {
  it('returns a single strip for a bottom taskbar', () => {
    expect(
      uncoveredStrips({ x: 0, y: 0, width: 2560, height: 1440 }, { x: 0, y: 0, width: 2560, height: 1392 })
    ).toEqual([{ x: 0, y: 1392, width: 2560, height: 48 }])
  })

  it('returns nothing when the work area covers the display', () => {
    const full = { x: 0, y: 0, width: 1920, height: 1080 }
    expect(uncoveredStrips(full, full)).toEqual([])
  })

  it('handles a left-docked bar', () => {
    expect(
      uncoveredStrips({ x: 0, y: 0, width: 1000, height: 800 }, { x: 60, y: 0, width: 940, height: 800 })
    ).toEqual([{ x: 0, y: 0, width: 60, height: 800 }])
  })

  it('produces non-overlapping strips when every edge is inset', () => {
    const strips = uncoveredStrips(
      { x: 0, y: 0, width: 1000, height: 800 },
      { x: 10, y: 20, width: 980, height: 760 }
    )
    expect(strips).toEqual([
      { x: 0, y: 0, width: 1000, height: 20 },
      { x: 0, y: 780, width: 1000, height: 20 },
      { x: 0, y: 20, width: 10, height: 760 },
      { x: 990, y: 20, width: 10, height: 760 }
    ])
  })
})

describe('axis locking', () => {
  it('locks a freehand stroke to its dominant cardinal axis', () => {
    expect(snapToAxis({ x: 10, y: 10 }, { x: 45, y: 18 }, false)).toEqual({ x: 45, y: 10 })
  })

  it('locks a segment to a 45-degree axis', () => {
    const snapped = snapToAxis({ x: 0, y: 0 }, { x: 13, y: 10 })
    expect(snapped.x).toBeCloseTo(snapped.y)
  })
})
