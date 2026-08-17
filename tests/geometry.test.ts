import { describe, expect, it } from 'vitest'
import {
  getResizeHandle,
  integerRect,
  moveRect,
  overlayRegions,
  normalizeRect,
  resizeRect,
  snapToAxis,
  surroundingStrips,
  uncoveredStrips
} from '../src/shared/geometry'

describe('integerRect', () => {
  it('rounds fractional window bounds consistently', () => {
    expect(integerRect({ x: 10.4, y: -2.6, width: 99.5, height: 45.4 })).toEqual({
      x: 10,
      y: -3,
      width: 100,
      height: 45
    })
  })

  it('never creates a zero-sized BrowserWindow', () => {
    expect(integerRect({ x: 0, y: 0, width: 0.2, height: -4 })).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1
    })
  })
})

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

describe('surroundingStrips', () => {
  it('keeps top and bottom internal edges within the selected width', () => {
    expect(
      surroundingStrips(
        { x: 0, y: 0, width: 2560, height: 1440 },
        { x: 768, y: 432, width: 1024, height: 576 }
      )
    ).toEqual([
      { x: 0, y: 0, width: 768, height: 1440 },
      { x: 1792, y: 0, width: 768, height: 1440 },
      { x: 768, y: 0, width: 1024, height: 432 },
      { x: 768, y: 1008, width: 1024, height: 432 }
    ])
  })

  it('omits zero-sized strips when the area touches a display edge', () => {
    expect(
      surroundingStrips(
        { x: 0, y: 0, width: 1000, height: 800 },
        { x: 0, y: 100, width: 700, height: 700 }
      )
    ).toEqual([
      { x: 700, y: 0, width: 300, height: 800 },
      { x: 0, y: 0, width: 700, height: 100 }
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

describe('overlayRegions', () => {
  // Real geometry measured on macOS 26.2: a 33pt menu bar and an 83pt Dock strip.
  const macBounds = { x: 0, y: 0, width: 1512, height: 982 }
  const macWorkArea = { x: 0, y: 33, width: 1512, height: 866 }

  it('tiles a display into an editor over the work area plus fillers', () => {
    const regions = overlayRegions(
      { x: 0, y: 0, width: 2560, height: 1440 },
      { x: 0, y: 0, width: 2560, height: 1392 },
      true
    )
    expect(regions[0]).toEqual({ rect: { x: 0, y: 0, width: 2560, height: 1392 }, role: 'editor' })
    expect(regions.slice(1).every((region) => region.role === 'filler')).toBe(true)
    expect(regions).toHaveLength(2)
  })

  it('covers an untiled display with exactly one editor over the whole display', () => {
    // macOS cannot tile: AppKit pushes a menu-bar or Dock strip back inside the work area, which
    // leaves the real menu bar and Dock on screen and paints their frozen copies over the editor
    // (the "two Docks" regression). One full-display window is the only arrangement that covers
    // them, so there must be no fillers and the editor must reach every edge.
    const regions = overlayRegions(macBounds, macWorkArea, false)
    expect(regions).toEqual([{ rect: macBounds, role: 'editor' }])
  })

  it('reaches the menu bar and the Dock when untiled', () => {
    const [editor] = overlayRegions(macBounds, macWorkArea, false)
    expect(editor.rect.y).toBe(macBounds.y)
    expect(editor.rect.y + editor.rect.height).toBe(macBounds.y + macBounds.height)
    // The work area alone would miss both strips; this is what regressed.
    expect(editor.rect.height).toBeGreaterThan(macWorkArea.height)
  })

  it('leaves no part of the display uncovered in either mode', () => {
    for (const tiled of [true, false]) {
      const area = overlayRegions(macBounds, macWorkArea, tiled)
        .reduce((total, region) => total + region.rect.width * region.rect.height, 0)
      expect(area).toBe(macBounds.width * macBounds.height)
    }
  })
})
