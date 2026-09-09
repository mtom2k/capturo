// Pointer model and sampling geometry for the colour picker's magnifier. Kept pure and separate
// from the overlay so zoom-scaled movement, which is fiddly and easy to regress, is
// covered by tests rather than only by dragging a mouse across a screen.

import type { Rgb } from './color'

export type Point = { x: number; y: number }
export type Bounds = { width: number; height: number }
export type OffsetLimits = { minX: number; maxX: number; minY: number; maxY: number }

// The tightest zoom level moves the sampled point by one eighth of physical pointer travel.
// Precision is selected only by wheel zoom; keyboard modifiers do not alter pointer movement.
export const MAXIMUM_ZOOM_MOVEMENT_FACTOR = 1 / 8

// A monitor-sized transparent Electron surface can disrupt Chromium hardware-video planes on
// Windows. Keep the floating picker comfortably below a display-sized surface while leaving room
// for the selector and zoom-scaled displacement.
export const FLOATING_PICKER_MAX_SIZE = 640

// Wheel zoom changes both how many source pixels fit into the fixed 200px aperture and, at the
// tighter levels, how quickly Capturo's owned sample point moves. Start with the widest view and
// let the user scroll up into precision. Every grid is odd so one source pixel is always centred.
export const PICKER_ZOOM_LEVELS = [
  { cells: 25, movementFactor: 1, maxSpeed: Number.POSITIVE_INFINITY },
  { cells: 17, movementFactor: 1, maxSpeed: Number.POSITIVE_INFINITY },
  { cells: 13, movementFactor: 1 / 2, maxSpeed: 720 },
  { cells: 9, movementFactor: 1 / 4, maxSpeed: 240 },
  { cells: 5, movementFactor: MAXIMUM_ZOOM_MOVEMENT_FACTOR, maxSpeed: 80 }
] as const
export const DEFAULT_PICKER_ZOOM_INDEX = 0

// Live preview samples cannot be displayed more often than the selector is painted, and desktop
// capture may report pointer-only updates at the mouse's polling rate. Bound the expensive
// main/helper round trip so those updates never starve the renderer's pointer and animation work.
// A click still requests its exact point immediately in picker-live.ts.
export const PICKER_SAMPLE_INTERVAL_MS = 1000 / 30

/** Remaining delay before another live preview sample may start. */
export function pickerSampleDelay(lastStartedAt: number, now: number): number {
  if (!Number.isFinite(lastStartedAt)) return 0
  const elapsed = Number.isFinite(now) ? Math.max(0, now - lastStartedAt) : 0
  return Math.max(0, PICKER_SAMPLE_INTERVAL_MS - elapsed)
}

/**
 * Converts Electron's display size from DIP units to source-image pixels.
 *
 * `screen.dipToScreenRect` is not available in Electron's macOS runtime even though it is part
 * of the cross-platform TypeScript surface. Picker payloads only need the display's pixel size,
 * so deriving it from the documented scale factor keeps the macOS and Windows paths aligned
 * without calling a platform-specific screen conversion API.
 */
export function displayPixelSize(size: Bounds, scaleFactor: number): Bounds {
  const scale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1
  const width = Number.isFinite(size.width) ? Math.max(0, size.width) : 0
  const height = Number.isFinite(size.height) ? Math.max(0, size.height) : 0
  return {
    width: Math.max(1, Math.ceil(width * scale)),
    height: Math.max(1, Math.ceil(height * scale))
  }
}

export function stepPickerZoomIndex(index: number, wheelDeltaY: number): number {
  const current = Math.min(Math.max(Math.round(Number.isFinite(index) ? index : DEFAULT_PICKER_ZOOM_INDEX), 0), PICKER_ZOOM_LEVELS.length - 1)
  if (!Number.isFinite(wheelDeltaY) || wheelDeltaY === 0) return current
  const direction = wheelDeltaY < 0 ? 1 : -1
  return Math.min(Math.max(current + direction, 0), PICKER_ZOOM_LEVELS.length - 1)
}

// How much of a coarse movement is spent pulling the sample back onto the physical cursor.
// Precision zoom necessarily displaces the two, and the physical cursor stops at the edge of the
// screen: with a displacement of 300px still standing, the cursor pinned against the left edge
// leaves everything left of x=300 unreachable. Bleeding the displacement off over ordinary
// coarse movement restores the whole screen without the visible jump a hard resync would cause.
export const OFFSET_DECAY = 0.5

export type PointerState = {
  // Sampled position in source-image pixels.
  point: Point
  // How far the sampled point has been displaced from the physical cursor by zoom-scaled movement.
  // The real cursor is hidden under the overlay, so this displacement is invisible; it exists
  // only so zooming back out does not snap the magnifier somewhere else.
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

/** Stable movement between absolute points; unaffected by a floating window changing position. */
export function pointDelta(previous: Point, current: Point): Point {
  return {
    x: finite(current.x) - finite(previous.x),
    y: finite(current.y) - finite(previous.y)
  }
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
 * Precision zoom advances the sample by a fraction of the cursor's delta, which necessarily
 * displaces it from the cursor. That displacement is carried in `offset` so zooming back out does
 * not teleport the magnifier to wherever the physical cursor drifted to.
 *
 * Coarse movement then bleeds the displacement off gradually, rather than tracking one-to-one.
 * A hard resync would be a visible jump; leaving the displacement standing would make part of
 * the screen unreachable once the physical cursor is pinned against an edge. Clamping also
 * recomputes the offset from the clamped result, which collapses it at the edges.
 */
/** Advances the owned point at a discrete zoom/precision movement factor. */
export function advancePointerAtFactor(
  state: PointerState,
  cursor: Point,
  delta: Point,
  movementFactor: number,
  bounds: Bounds,
  maxDistance = Number.POSITIVE_INFINITY
): PointerState {
  const dx = finite(delta.x)
  const dy = finite(delta.y)
  const cursorX = finite(cursor.x)
  const cursorY = finite(cursor.y)
  const factor = Number.isFinite(movementFactor)
    ? Math.min(Math.max(movementFactor, MAXIMUM_ZOOM_MOVEMENT_FACTOR), 1)
    : 1

  if (factor < 1) {
    // Reconstruct the previous owned point from the previous physical cursor and stored offset.
    // This is normally identical to state.point; keeping the relationship authoritative also
    // collapses a stale displacement safely when an image edge has clamped one side.
    const startX = cursorX - dx + state.offset.x
    const startY = cursorY - dy + state.offset.y
    let stepX = dx * factor
    let stepY = dy * factor
    const requestedDistance = Math.hypot(stepX, stepY)
    const allowedDistance = Number.isFinite(maxDistance) ? Math.max(0, maxDistance) : Number.POSITIVE_INFINITY
    if (requestedDistance > allowedDistance && requestedDistance > 0) {
      const scale = allowedDistance / requestedDistance
      stepX *= scale
      stepY *= scale
    }
    const x = clampAxis(startX + stepX, bounds.width)
    const y = clampAxis(startY + stepY, bounds.height)
    return { point: { x, y }, offset: { x: x - cursorX, y: y - cursorY } }
  }

  const offsetX = decayOffset(state.offset.x, dx)
  const offsetY = decayOffset(state.offset.y, dy)

  const x = clampAxis(cursorX + offsetX, bounds.width)
  const y = clampAxis(cursorY + offsetY, bounds.height)
  return { point: { x, y }, offset: { x: x - cursorX, y: y - cursorY } }
}

/**
 * Keeps an owned sample point within the space available around the physical cursor.
 *
 * Windows uses a compact floating picker surface so it does not interfere with hardware video
 * planes. Precision zoom deliberately lets the sample trail the cursor, so an unbounded offset can
 * eventually put the magnifier outside that surface. The renderer supplies the live, asymmetric
 * room on each side of the cursor; this clamps only when the selector would otherwise be clipped.
 */
export function constrainPointerOffset(
  state: PointerState,
  cursor: Point,
  limits: OffsetLimits,
  bounds: Bounds
): PointerState {
  const cursorX = finite(cursor.x)
  const cursorY = finite(cursor.y)
  const minX = Math.min(finite(limits.minX), finite(limits.maxX))
  const maxX = Math.max(finite(limits.minX), finite(limits.maxX))
  const minY = Math.min(finite(limits.minY), finite(limits.maxY))
  const maxY = Math.max(finite(limits.minY), finite(limits.maxY))
  const desiredX = finite(state.point.x) - cursorX
  const desiredY = finite(state.point.y) - cursorY
  const offsetX = Math.min(Math.max(desiredX, minX), maxX)
  const offsetY = Math.min(Math.max(desiredY, minY), maxY)
  const x = clampAxis(cursorX + offsetX, bounds.width)
  const y = clampAxis(cursorY + offsetY, bounds.height)
  return { point: { x, y }, offset: { x: x - cursorX, y: y - cursorY } }
}

/** Arrow-key nudge, which is always pixel-exact regardless of zoom level. */
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

/**
 * A compact picker window centred on a screen-space point.
 *
 * The 16px reserve is load-bearing on Windows: a transparent window that equals a display
 * dimension can be classified/composed as a monitor surface and disrupt hardware video planes.
 * The rectangle may hang outside the display so the real pointer remains inside it while crossing
 * a monitor seam or reaching an outer edge.
 */
export function floatingPickerRect(
  point: Point,
  bounds: Point & Bounds,
  maxSize = FLOATING_PICKER_MAX_SIZE
): { x: number; y: number; width: number; height: number } {
  const limit = Math.max(1, Math.floor(maxSize))
  const width = Math.max(1, Math.min(limit, bounds.width - 16))
  const height = Math.max(1, Math.min(limit, bounds.height - 16))
  return {
    x: Math.round(point.x - width / 2),
    y: Math.round(point.y - height / 2),
    width,
    height
  }
}

/**
 * Predicts the floating window's next display-relative origin from the same geometry main uses.
 *
 * This is needed before a recenter IPC is sent. Moving a transparent native window carries its
 * existing bitmap with it; if the renderer waits for `window.screenX/Y` to update, the selector is
 * carried past the cursor for one frame and then snaps back. Painting against this predicted origin
 * makes the local selector position and the native window move land on the same screen point.
 */
export function floatingPickerRegionOrigin(
  center: Point,
  displayBounds: Point & Bounds,
  maxSize = FLOATING_PICKER_MAX_SIZE
): Point {
  const rect = floatingPickerRect(center, displayBounds, maxSize)
  return { x: rect.x - displayBounds.x, y: rect.y - displayBounds.y }
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

/** Decodes the native helper's compact row-major RRGGBB grid into canvas-ready RGBA bytes. */
export function parseRgbHexGrid(value: string, width: number, height: number): Uint8ClampedArray | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) return null
  if (value.length !== width * height * 6 || !/^[0-9a-f]+$/i.test(value)) return null
  const data = new Uint8ClampedArray(width * height * 4)
  for (let pixel = 0; pixel < width * height; pixel++) {
    const source = pixel * 6
    const target = pixel * 4
    data[target] = parseInt(value.slice(source, source + 2), 16)
    data[target + 1] = parseInt(value.slice(source + 2, source + 4), 16)
    data[target + 2] = parseInt(value.slice(source + 4, source + 6), 16)
    data[target + 3] = 255
  }
  return data
}

/**
 * Top-left of the magnifier, which is centred on the sampled point: the magnifier *is* the
 * cursor, and its centre cell is the pixel being picked.
 *
 * Deliberately not clamped here. Nudging it back from an edge would slide its centre off the
 * sampled pixel, and the centre is the whole readout - a magnifier that lies about which pixel it
 * is showing is worse than one that is clipped. Full-display overlays may clip it at a true screen
 * edge; the compact Windows renderer instead constrains the owned sample point before placement.
 */
export function magnifierPlacement(point: Point, size: number): Point {
  return { x: point.x - size / 2, y: point.y - size / 2 }
}
