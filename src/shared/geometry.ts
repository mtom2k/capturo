import type { OverlayRole, Point, Rect, ResizeHandle } from './types'

export const MIN_SELECTION_SIZE = 8

// BrowserWindow construction can add a few device-independent pixels on Windows even for a
// frameless window. Keeping one canonical integer rectangle lets the main process reapply the
// exact outer bounds after construction (see D-021).
export function integerRect(rect: Rect): Rect {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height))
  }
}

export function normalizeRect(start: Point, end: Point): Rect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y)
  }
}

export function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

export function clampPoint(point: Point, bounds: Rect): Point {
  return {
    x: Math.max(bounds.x, Math.min(bounds.x + bounds.width, point.x)),
    y: Math.max(bounds.y, Math.min(bounds.y + bounds.height, point.y))
  }
}

export function moveRect(rect: Rect, delta: Point, bounds: Rect): Rect {
  return {
    ...rect,
    x: Math.max(bounds.x, Math.min(bounds.x + bounds.width - rect.width, rect.x + delta.x)),
    y: Math.max(bounds.y, Math.min(bounds.y + bounds.height - rect.height, rect.y + delta.y))
  }
}

export function resizeRect(
  original: Rect,
  handle: ResizeHandle,
  pointer: Point,
  bounds: Rect,
  minimum = MIN_SELECTION_SIZE
): Rect {
  let left = original.x
  let top = original.y
  let right = original.x + original.width
  let bottom = original.y + original.height

  if (handle.includes('west')) left = Math.min(pointer.x, right - minimum)
  if (handle.includes('east')) right = Math.max(pointer.x, left + minimum)
  if (handle.includes('north')) top = Math.min(pointer.y, bottom - minimum)
  if (handle.includes('south')) bottom = Math.max(pointer.y, top + minimum)

  left = Math.max(bounds.x, left)
  top = Math.max(bounds.y, top)
  right = Math.min(bounds.x + bounds.width, right)
  bottom = Math.min(bounds.y + bounds.height, bottom)

  return { x: left, y: top, width: right - left, height: bottom - top }
}

export function getResizeHandle(point: Point, rect: Rect, tolerance: number): ResizeHandle | null {
  const nearLeft = Math.abs(point.x - rect.x) <= tolerance
  const nearRight = Math.abs(point.x - (rect.x + rect.width)) <= tolerance
  const nearTop = Math.abs(point.y - rect.y) <= tolerance
  const nearBottom = Math.abs(point.y - (rect.y + rect.height)) <= tolerance
  const withinX = point.x >= rect.x - tolerance && point.x <= rect.x + rect.width + tolerance
  const withinY = point.y >= rect.y - tolerance && point.y <= rect.y + rect.height + tolerance

  if (nearLeft && nearTop) return 'north-west'
  if (nearRight && nearTop) return 'north-east'
  if (nearRight && nearBottom) return 'south-east'
  if (nearLeft && nearBottom) return 'south-west'
  if (nearTop && withinX) return 'north'
  if (nearRight && withinY) return 'east'
  if (nearBottom && withinX) return 'south'
  if (nearLeft && withinY) return 'west'
  return null
}

export function snapToAxis(start: Point, point: Point, diagonal = true): Point {
  const dx = point.x - start.x
  const dy = point.y - start.y

  if (!diagonal) {
    return Math.abs(dx) >= Math.abs(dy) ? { x: point.x, y: start.y } : { x: start.x, y: point.y }
  }

  const distance = Math.hypot(dx, dy)
  if (distance === 0) return point
  const increment = Math.PI / 4
  const angle = Math.round(Math.atan2(dy, dx) / increment) * increment
  return {
    x: start.x + Math.cos(angle) * distance,
    y: start.y + Math.sin(angle) * distance
  }
}

// The parts of a display the work area does not reach: usually a single taskbar strip, but
// docked bars on any edge are handled. Top and bottom strips span the full width and the
// side strips fill what is left, so the rectangles never overlap. Used to tile a display
// into an editor over the work area plus a filler per uncovered strip (see D-013).
export function uncoveredStrips(bounds: Rect, area: Rect): Rect[] {
  const strips: Rect[] = []
  const areaRight = area.x + area.width
  const areaBottom = area.y + area.height
  const boundsRight = bounds.x + bounds.width
  const boundsBottom = bounds.y + bounds.height

  if (area.y > bounds.y) {
    strips.push({ x: bounds.x, y: bounds.y, width: bounds.width, height: area.y - bounds.y })
  }
  if (areaBottom < boundsBottom) {
    strips.push({ x: bounds.x, y: areaBottom, width: bounds.width, height: boundsBottom - areaBottom })
  }
  if (area.x > bounds.x) {
    strips.push({ x: bounds.x, y: area.y, width: area.x - bounds.x, height: area.height })
  }
  if (areaRight < boundsRight) {
    strips.push({ x: areaRight, y: area.y, width: boundsRight - areaRight, height: area.height })
  }
  return strips.filter((strip) => strip.width > 0 && strip.height > 0)
}

export type OverlayRegion = { rect: Rect; role: OverlayRole }

// How a display is divided into capture overlays.
//
// `tiled` (Windows): an editor over the work area plus a filler per uncovered strip, so no single
// window covers the monitor and trips the full-screen classification that switches on Do Not
// Disturb. See D-013.
//
// Untiled (macOS): one window over the whole display. AppKit constrains an ordinary window to the
// screen's visible frame, so a strip placed over the menu bar or the Dock is pushed back inside
// the work area and covers neither. See D-029.
export function overlayRegions(bounds: Rect, workArea: Rect, tiled: boolean): OverlayRegion[] {
  if (!tiled) return [{ rect: bounds, role: 'editor' }]
  return [
    { rect: workArea, role: 'editor' },
    ...uncoveredStrips(bounds, workArea).map((rect) => ({ rect, role: 'filler' as const }))
  ]
}

// Tiles the space around an interior rectangle with every exposed internal edge constrained
// to that rectangle's perimeter. Unlike uncoveredStrips, the side strips span full height and
// the top/bottom strips span only the area's width. Recording chrome uses this orientation so
// a compositor edge can never continue horizontally beyond the red selection ring (D-021).
export function surroundingStrips(bounds: Rect, area: Rect): Rect[] {
  const areaRight = area.x + area.width
  const areaBottom = area.y + area.height
  const boundsRight = bounds.x + bounds.width
  const boundsBottom = bounds.y + bounds.height
  return [
    { x: bounds.x, y: bounds.y, width: area.x - bounds.x, height: bounds.height },
    { x: areaRight, y: bounds.y, width: boundsRight - areaRight, height: bounds.height },
    { x: area.x, y: bounds.y, width: area.width, height: area.y - bounds.y },
    { x: area.x, y: areaBottom, width: area.width, height: boundsBottom - areaBottom }
  ].filter((strip) => strip.width > 0 && strip.height > 0)
}

export function translatePoint(point: Point, delta: Point): Point {
  return { x: point.x + delta.x, y: point.y + delta.y }
}

export function translateRect(rect: Rect, delta: Point): Rect {
  return { ...rect, x: rect.x + delta.x, y: rect.y + delta.y }
}
