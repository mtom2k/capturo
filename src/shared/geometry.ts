import type { Point, Rect, ResizeHandle } from './types'

export const MIN_SELECTION_SIZE = 8

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

export function translatePoint(point: Point, delta: Point): Point {
  return { x: point.x + delta.x, y: point.y + delta.y }
}

export function translateRect(rect: Rect, delta: Point): Rect {
  return { ...rect, x: rect.x + delta.x, y: rect.y + delta.y }
}
