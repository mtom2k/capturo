import { describe, expect, it } from 'vitest'
import {
  controlBarPlacement,
  controlBarPlacementOutside,
  detachedEditorCanvasRect,
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

describe('detached editor canvas', () => {
  it('reserves the measured dock height plus workspace padding', () => {
    const rect = detachedEditorCanvasRect({ width: 900, height: 1600 }, { width: 800, height: 600 }, 126)
    expect(rect.y).toBe(126)
    expect(rect.y + rect.height).toBeLessThanOrEqual(576)
    expect(rect.width / rect.height).toBeCloseTo(900 / 1600)
  })
  it('fits and centers a wide capture below the toolbar reserve', () => {
    expect(detachedEditorCanvasRect(
      { width: 1600, height: 900 },
      { width: 1200, height: 800 }
    )).toEqual({ x: 24, y: 102, width: 1152, height: 648 })
  })

  it('fits a tall capture by height and centers it horizontally', () => {
    expect(detachedEditorCanvasRect(
      { width: 900, height: 1600 },
      { width: 1200, height: 800 }
    )).toEqual({ x: 403.125, y: 76, width: 393.75, height: 700 })
  })

  it('stays finite for a tiny window or invalid image dimensions', () => {
    const rect = detachedEditorCanvasRect(
      { width: 0, height: 0 },
      { width: 20, height: 20 }
    )
    expect(rect).toEqual({ x: 9.5, y: 76, width: 1, height: 1 })
  })
})

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

describe('control bar placement', () => {
  // A 1512x982 Retina MacBook display: 38pt of menu bar at the top and a 74pt Dock at the bottom.
  const display = { x: 0, y: 0, width: 1512, height: 982 }
  const workArea = { x: 0, y: 38, width: 1512, height: 870 }
  const width = 650
  const height = 58

  it('prefers the space above the region and centres the bar on it', () => {
    const region = { x: 400, y: 400, width: 600, height: 300 }
    const point = controlBarPlacement(display, region, width, height)
    expect(point.y + height).toBeLessThanOrEqual(region.y)
    expect(point.x + width / 2).toBe(region.x + region.width / 2)
  })

  it('falls below the region when there is no room above it', () => {
    const region = { x: 400, y: 10, width: 600, height: 300 }
    const point = controlBarPlacement(display, region, width, height)
    expect(point.y).toBeGreaterThanOrEqual(region.y + region.height)
  })

  it('keeps the bar inside the bounds it was given', () => {
    const region = { x: 1400, y: 400, width: 100, height: 200 }
    const point = controlBarPlacement(workArea, region, width, height)
    expect(point.x).toBeGreaterThanOrEqual(workArea.x)
    expect(point.x + width).toBeLessThanOrEqual(workArea.x + workArea.width)
    expect(point.y).toBeGreaterThanOrEqual(workArea.y)
  })

  // The macOS reason the bounds are a parameter at all. AppKit pushes a window requested over the
  // menu bar back into the visible frame, and for a panoramic session that reflow lands the bar
  // inside the crop it must stay out of. Placing against the work area asks for a position macOS
  // will actually honour. See D-029 and D-042.
  it('never requests the macOS menu bar or Dock when placed against the work area', () => {
    const region = { x: 300, y: 80, width: 900, height: 500 }
    const point = controlBarPlacement(workArea, region, width, height)
    expect(point.y).toBeGreaterThanOrEqual(workArea.y)
    expect(point.y + height).toBeLessThanOrEqual(workArea.y + workArea.height)
  })

  it('refuses a placement that would overlap the region', () => {
    // A region filling the work area leaves nowhere outside it, so a panoramic session must not
    // start rather than stitch its own control bar into the output.
    const region = { ...workArea }
    expect(controlBarPlacementOutside(workArea, region, width, height)).toBeNull()
  })

  it('returns the placement whenever one clears the region', () => {
    const region = { x: 400, y: 400, width: 600, height: 300 }
    const point = controlBarPlacementOutside(workArea, region, width, height)
    expect(point).not.toBeNull()
    expect(point!.y + height).toBeLessThanOrEqual(region.y)
  })

  // A region tall enough to squeeze the bar out of the work area but not out of the display is
  // exactly the case where using display bounds on macOS produces a bar the compositor then moves
  // into the crop. The work area must report no room instead.
  it('reports no room where the display alone would have found some on macOS', () => {
    const region = { x: 0, y: 38, width: 1512, height: 870 }
    expect(controlBarPlacementOutside(display, region, width, height)).not.toBeNull()
    expect(controlBarPlacementOutside(workArea, region, width, height)).toBeNull()
  })
})
