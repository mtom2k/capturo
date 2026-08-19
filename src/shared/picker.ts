// Pointer model and sampling geometry for the colour picker's magnifier. Kept pure and separate
// from the overlay so the fine-movement behaviour, which is fiddly and easy to regress, is
// covered by tests rather than only by dragging a mouse across a screen.

import type { Rgb } from './color'

export type Point = { x: number; y: number }
export type Bounds = { width: number; height: number }

// How far the sampled point moves per unit of physical mouse movement while Shift is held. One
// eighth means a full mouse-width sweep still lands inside a small icon, which is the point:
// picking a one-pixel border is otherwise a matter of luck.
export const FINE_FACTOR = 1 / 8

// How much of a coarse movement is spent pulling the sample back onto the physical cursor.
// Fine movement necessarily displaces the two, and the physical cursor stops at the edge of the
// screen: with a displacement of 300px still standing, the cursor pinned against the left edge
// leaves everything left of x=300 unreachable. Bleeding the displacement off over ordinary
// coarse movement restores the whole screen without the visible jump a hard resync would cause.
export const OFFSET_DECAY = 0.5

export type PointerState = {
  // Sampled position in source-image pixels.
  point: Point
  // How far the sampled point has been displaced from the physical cursor by fine movement.
  // The real cursor is hidden under the overlay, so this displacement is invisible; it exists
  // only so leaving fine mode does not snap the magnifier somewhere else.
  offset: Point
}

export function initialPointerState(point: Point): PointerState {
  return { point: { x: point.x, y: point.y }, offset: { x: 0, y: 0 } }
}

function clampAxis(value: number, limit: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(value, 0), Math.max(0, limit - 1))
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0
}

// Pulls a displacement towards zero by a share of how far the cursor just travelled, never
// overshooting past zero and never reversing the direction of travel.
function decayOffset(offset: number, delta: number): number {
  const room = Math.abs(delta) * OFFSET_DECAY
  if (offset > 0) return Math.max(0, offset - room)
  if (offset < 0) return Math.min(0, offset + room)
  return 0
}

/**
 * Advances the sampled point for one pointer movement.
 *
 * Fine movement advances the sample by a fraction of the cursor's delta, which necessarily
 * displaces it from the cursor. That displacement is carried in `offset` so releasing Shift does
 * not teleport the magnifier to wherever the physical cursor drifted to.
 *
 * Coarse movement then bleeds the displacement off gradually, rather than tracking one-to-one.
 * A hard resync would be a visible jump; leaving the displacement standing would make part of
 * the screen unreachable once the physical cursor is pinned against an edge. Clamping also
 * recomputes the offset from the clamped result, which collapses it at the edges.
 */
export function advancePointer(
  state: PointerState,
  cursor: Point,
  delta: Point,
  fine: boolean,
  bounds: Bounds
): PointerState {
  const dx = finite(delta.x)
  const dy = finite(delta.y)
  const cursorX = finite(cursor.x)
  const cursorY = finite(cursor.y)

  const offsetX = fine ? state.offset.x + dx * (FINE_FACTOR - 1) : decayOffset(state.offset.x, dx)
  const offsetY = fine ? state.offset.y + dy * (FINE_FACTOR - 1) : decayOffset(state.offset.y, dy)

  const x = clampAxis(cursorX + offsetX, bounds.width)
  const y = clampAxis(cursorY + offsetY, bounds.height)
  return { point: { x, y }, offset: { x: x - cursorX, y: y - cursorY } }
}

/** Arrow-key nudge, which is always pixel-exact regardless of Shift. */
export function nudgePointer(state: PointerState, delta: Point, bounds: Bounds): PointerState {
  const x = clampAxis(Math.round(state.point.x) + delta.x, bounds.width)
  const y = clampAxis(Math.round(state.point.y) + delta.y, bounds.height)
  return { point: { x, y }, offset: { x: state.offset.x, y: state.offset.y } }
}

/**
 * The square of source pixels the magnifier shows, in source-image coordinates. Returns the
 * top-left corner and the side length in pixels; the caller draws it scaled up.
 *
 * The region is not clamped into the image. A pixel at the very corner of the screen must stay
 * centred under the crosshair, so the region is allowed to hang off the edge and the caller
 * leaves those cells blank.
 */
export function magnifierRegion(center: Point, cells: number): { x: number; y: number; size: number } {
  const size = Math.max(1, Math.floor(cells))
  const half = Math.floor(size / 2)
  return { x: Math.round(center.x) - half, y: Math.round(center.y) - half, size }
}

/**
 * Where the pointer sits within one display, in CSS pixels relative to that display's origin, or
 * null when it is on a different display.
 *
 * Every overlay of a multi-display capture receives the same screen-space pointer position and
 * has to decide for itself whether it is the one under the pointer. Getting this wrong is not
 * visibly wrong: the overlay simply opens its magnifier somewhere the user is not pointing.
 */
export function cursorForDisplay(
  cursor: Point,
  bounds: { x: number; y: number; width: number; height: number }
): Point | null {
  const inside =
    cursor.x >= bounds.x &&
    cursor.x < bounds.x + bounds.width &&
    cursor.y >= bounds.y &&
    cursor.y < bounds.y + bounds.height
  return inside ? { x: cursor.x - bounds.x, y: cursor.y - bounds.y } : null
}

/** Reads one pixel out of RGBA image data, or null when the point lies outside it. */
export function pixelAt(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number
): Rgb | null {
  const px = Math.round(x)
  const py = Math.round(y)
  if (px < 0 || py < 0 || px >= width || py >= height) return null
  const index = (py * width + px) * 4
  if (index + 2 >= data.length) return null
  return { r: data[index], g: data[index + 1], b: data[index + 2] }
}

/**
 * Top-left of the magnifier, which is centred on the sampled point: the magnifier *is* the
 * cursor, and its centre cell is the pixel being picked.
 *
 * Deliberately not clamped into the viewport. Nudging it back from an edge would slide its centre
 * off the sampled pixel, and the centre is the whole readout - a magnifier that lies about which
 * pixel it is showing is worse than one that is clipped. Near an edge it simply hangs off, and
 * the overlay clips it.
 */
export function magnifierPlacement(point: Point, size: number): Point {
  return { x: point.x - size / 2, y: point.y - size / 2 }
}
