// Shared Panoramic Scrolling types, overlap detection, and unique-coverage geometry. The renderer
// owns live display frames and layers; this module stays pure so all cardinal movement can be exercised
// without Electron or a real desktop. See D-042.

import type { CropRect } from './gif'
import type { Point, Rect } from './types'

export type ScrollAxis = 'vertical' | 'horizontal'

export type PanoramicDirection = 'up' | 'down' | 'left' | 'right'

export type ScrollCapturePayload = {
  crop: CropRect
}

export type StartScrollCaptureResult =
  | { started: true }
  | { started: false; canceled?: boolean; error?: string }

export type FinishScrollCaptureResult =
  | { opened: true }
  | { opened: false; error: string }

export type CapturoScrollApi = {
  start: (sessionId: string, region: Rect) => Promise<StartScrollCaptureResult>
  requestInitialization: () => Promise<ScrollCapturePayload | null>
  cursorPosition: () => Promise<PanoramicPointer | null>
  finish: (png: ArrayBuffer) => Promise<FinishScrollCaptureResult>
  cancel: () => Promise<void>
}

export type ScrollMatch = {
  // Newly revealed source pixels along the selected axis.
  offset: number
  // Mean absolute RGB error at the matched overlap, 0-255.
  score: number
  // Relative improvement over comparing the two frames without a scroll, 0-1.
  confidence: number
}

export type ScrollAnalysis = ScrollMatch & {
  unchangedScore: number
  accepted: boolean
}

export type PanoramicMovement = ScrollMatch & {
  direction: PanoramicDirection
  delta: Point
}

export type PanoramicHistoryCandidate = {
  movement: PanoramicMovement
  historyScore: number
  historySamples: number
}

export type PanoramicHistoryDecision = {
  // True means at least one candidate overlapped enough known pixels to make history authoritative.
  anchored: boolean
  movement: PanoramicMovement | null
}

// The live pointer inside the selected region. Positions and footprint radii are fractions of the
// region, so one report stays correct whatever resolution the display stream is delivered at.
export type PanoramicPointer = {
  x: number
  y: number
  radiusX: number
  radiusY: number
}

// Half of the pointer bitmap's footprint in device-independent pixels. Windows draws the standard
// pointers at 32 DIP and grows them with the display scale, so this covers the arrow, its shadow,
// and a little slack around a scaled or themed shape.
export const PANORAMIC_POINTER_RADIUS_DIP = 40

// The footprint Capturo refuses to trust because the pointer may be painted into it. Rounded
// outward to whole frame pixels: every retained rectangle is carved out of this one, and a
// fractional edge would place its layer between output pixels and resample the seam.
export function panoramicCursorMask(
  viewport: Point,
  pointer: PanoramicPointer | null,
  width: number,
  height: number
): Rect | null {
  if (!pointer || !Number.isFinite(pointer.x) || !Number.isFinite(pointer.y)) return null
  const radiusX = Math.max(24, Math.round((Number.isFinite(pointer.radiusX) ? pointer.radiusX : 0) * width))
  const radiusY = Math.max(24, Math.round((Number.isFinite(pointer.radiusY) ? pointer.radiusY : 0) * height))
  const centerX = viewport.x + pointer.x * width
  const centerY = viewport.y + pointer.y * height
  const left = Math.floor(centerX - radiusX)
  const top = Math.floor(centerY - radiusY)
  return {
    x: left,
    y: top,
    width: Math.ceil(centerX + radiusX) - left,
    height: Math.ceil(centerY + radiusY) - top
  }
}

// The selected viewport gets a thin outline so the user can see what Panoramic Scrolling is
// following while they work in the live application. Unlike the GIF ring this chrome is
// deliberately left capturable, because excluding a window from capture is what can stall the
// Windows display-media stream a panoramic session reads. Only its clearance gap keeps it out of
// the output, so the painted band must clear the crop by more than display-capture rounding can
// reach back across. It is one bordered window rather than four thin strips: Windows refuses to
// make a window a couple of pixels tall and silently inflates it, which put a strip straight
// through the top of the captured region. See D-042.
export const PANORAMIC_OUTLINE_GAP = 4
export const PANORAMIC_OUTLINE_THICKNESS = 2

/** Outer bounds of the outline window. Its border is painted just inside these edges. */
export function panoramicOutlineRect(
  region: Rect,
  gap: number = PANORAMIC_OUTLINE_GAP,
  thickness: number = PANORAMIC_OUTLINE_THICKNESS
): Rect {
  const inset = gap + thickness
  return {
    x: region.x - inset,
    y: region.y - inset,
    width: region.width + inset * 2,
    height: region.height + inset * 2
  }
}

/** The transparent centre of that window: everything Capturo leaves untouched on screen. */
export function panoramicOutlineHole(
  region: Rect,
  gap: number = PANORAMIC_OUTLINE_GAP,
  thickness: number = PANORAMIC_OUTLINE_THICKNESS
): Rect {
  const outer = panoramicOutlineRect(region, gap, thickness)
  return {
    x: outer.x + thickness,
    y: outer.y + thickness,
    width: outer.width - thickness * 2,
    height: outer.height - thickness * 2
  }
}

export type PanoramicExposure = {
  // Rectangle inside the current viewport that has just been revealed.
  source: Rect
  // The same pixels in the unbounded panoramic coordinate space.
  world: Rect
}

export const MAX_SCROLL_AXIS_PIXELS = 30_000
export const MAX_SCROLL_TOTAL_PIXELS = 120_000_000

const MIN_SCORE_IMPROVEMENT = 2.5
const MAX_MATCH_SCORE = 28
const MIN_CONFIDENCE = 0.18
const MAX_SAFE_STEP_RATIO = 0.62
const MIN_ALTERNATIVE_SCORE_MARGIN = 1.5

function validFrame(data: Uint8ClampedArray | Uint8Array, width: number, height: number): boolean {
  return Number.isInteger(width) && Number.isInteger(height) && width > 1 && height > 1 &&
    data.length >= width * height * 4
}

function channelError(
  previous: Uint8ClampedArray | Uint8Array,
  current: Uint8ClampedArray | Uint8Array,
  previousIndex: number,
  currentIndex: number
): number {
  return Math.abs(previous[previousIndex] - current[currentIndex]) +
    Math.abs(previous[previousIndex + 1] - current[currentIndex + 1]) +
    Math.abs(previous[previousIndex + 2] - current[currentIndex + 2])
}

// Flat desktop regions (page margins, empty editor space, solid panels) carry no alignment
// information. Point sampling lets those regions overwhelm the few useful text/edge pixels and
// can make many offsets look equally perfect. Score a small sparse patch and ignore it unless at
// least one side contains visible local contrast.
function informativePatchError(
  previous: Uint8ClampedArray | Uint8Array,
  current: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  previousX: number,
  previousY: number,
  currentX: number,
  currentY: number
): { error: number; channels: number } | null {
  let error = 0
  let channels = 0
  let minimum = Number.POSITIVE_INFINITY
  let maximum = Number.NEGATIVE_INFINITY

  for (let patchY = -2; patchY <= 2; patchY += 2) {
    const py = Math.max(0, Math.min(height - 1, previousY + patchY))
    const cy = Math.max(0, Math.min(height - 1, currentY + patchY))
    for (let patchX = -2; patchX <= 2; patchX += 2) {
      const px = Math.max(0, Math.min(width - 1, previousX + patchX))
      const cx = Math.max(0, Math.min(width - 1, currentX + patchX))
      const previousIndex = (py * width + px) * 4
      const currentIndex = (cy * width + cx) * 4
      const previousBrightness = previous[previousIndex] + previous[previousIndex + 1] + previous[previousIndex + 2]
      const currentBrightness = current[currentIndex] + current[currentIndex + 1] + current[currentIndex + 2]
      minimum = Math.min(minimum, previousBrightness, currentBrightness)
      maximum = Math.max(maximum, previousBrightness, currentBrightness)
      error += channelError(previous, current, previousIndex, currentIndex)
      channels += 3
    }
  }

  return maximum - minimum >= 36 ? { error, channels } : null
}

// Scores current(x,y) against previous(x,y+offset) for vertical scrolling, or
// previous(x+offset,y) for horizontal scrolling. Sampling a fixed grid bounds work regardless of
// viewport size. The leading 12% is ignored because sticky page headers/sidebars otherwise vote
// for zero movement while the document underneath is moving.
function overlapScore(
  previous: Uint8ClampedArray | Uint8Array,
  current: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  axis: ScrollAxis,
  offset: number
): number {
  const axisLength = axis === 'vertical' ? height : width
  const crossLength = axis === 'vertical' ? width : height
  const overlap = axisLength - offset
  if (overlap < Math.max(24, axisLength * 0.15)) return Number.POSITIVE_INFINITY

  const leadingIgnore = Math.min(Math.floor(overlap * 0.22), Math.floor(axisLength * 0.12))
  const trailingIgnore = Math.floor(overlap * 0.04)
  const usableAlong = overlap - leadingIgnore - trailingIgnore
  if (usableAlong < 8) return Number.POSITIVE_INFINITY

  const alongSamples = Math.min(40, usableAlong)
  const crossMargin = Math.floor(crossLength * 0.05)
  const usableCross = Math.max(1, crossLength - crossMargin * 2)
  const crossSamples = Math.min(56, usableCross)
  let error = 0
  let samples = 0
  let informativePatches = 0

  for (let alongIndex = 0; alongIndex < alongSamples; alongIndex += 1) {
    const along = leadingIgnore + Math.floor((alongIndex + 0.5) * usableAlong / alongSamples)
    for (let crossIndex = 0; crossIndex < crossSamples; crossIndex += 1) {
      const cross = crossMargin + Math.floor((crossIndex + 0.5) * usableCross / crossSamples)
      const currentX = axis === 'vertical' ? cross : along
      const currentY = axis === 'vertical' ? along : cross
      const previousX = axis === 'vertical' ? cross : along + offset
      const previousY = axis === 'vertical' ? along + offset : cross
      const patch = informativePatchError(
        previous,
        current,
        width,
        height,
        previousX,
        previousY,
        currentX,
        currentY
      )
      if (!patch) continue
      error += patch.error
      samples += patch.channels
      informativePatches += 1
    }
  }
  return informativePatches >= 8 ? error / samples : Number.POSITIVE_INFINITY
}

/**
 * Finds a forward/downward or forward/rightward scroll between two equal-sized RGBA frames.
 * Returns null for an unchanged frame, an ambiguous/repetitive frame, or a weak overlap. Rejecting
 * a frame is safer than silently appending corrupt pixels; the recorder keeps the last accepted
 * frame and asks the user to scroll more slowly.
 */
export function analyzeScrollOffset(
  previous: Uint8ClampedArray | Uint8Array,
  current: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  axis: ScrollAxis
): ScrollAnalysis | null {
  if (!validFrame(previous, width, height) || !validFrame(current, width, height)) return null
  const axisLength = axis === 'vertical' ? height : width
  const minOffset = Math.max(2, Math.floor(axisLength * 0.004))
  // Large jumps leave too little shared content to distinguish a real scroll from repeated page
  // structure or a partially composited frame. Higher-frequency sampling should observe fast
  // movement as several safe steps; if it does not, reject the gap rather than corrupt the output.
  const maxOffset = Math.max(minOffset, Math.floor(axisLength * MAX_SAFE_STEP_RATIO))
  const unchangedScore = overlapScore(previous, current, width, height, axis, 0)
  if (!Number.isFinite(unchangedScore)) return null
  if (unchangedScore < 0.75) {
    return { offset: 0, score: unchangedScore, confidence: 0, unchangedScore, accepted: false }
  }

  let bestOffset = 0
  let bestScore = Number.POSITIVE_INFINITY
  const offsetScores = new Map<number, number>()
  // A two-pixel coarse pass halves the hot path. Refine around the winner below so appended seams
  // still land on an exact source row/column.
  for (let offset = minOffset; offset <= maxOffset; offset += 2) {
    const score = overlapScore(previous, current, width, height, axis, offset)
    offsetScores.set(offset, score)
    if (score < bestScore) {
      bestScore = score
      bestOffset = offset
    }
  }
  if (bestOffset === 0) return null
  const refineStart = Math.max(minOffset, bestOffset - 3)
  const refineEnd = Math.min(maxOffset, bestOffset + 3)
  for (let offset = refineStart; offset <= refineEnd; offset += 1) {
    const score = overlapScore(previous, current, width, height, axis, offset)
    offsetScores.set(offset, score)
    if (score < bestScore) {
      bestScore = score
      bestOffset = offset
    }
  }

  const improvement = unchangedScore - bestScore
  const confidence = Math.max(0, Math.min(1, improvement / Math.max(1, unchangedScore)))
  // Repeated rows/cards can produce several excellent but mutually incompatible offsets. Ignore
  // the normal score basin immediately around the winner, then require a clear margin over any
  // distant alternative. An ambiguous periodic page must be retraced, never guessed.
  const alternativeSeparation = Math.max(8, Math.min(48, Math.floor(axisLength * 0.025)))
  const alternativeScore = Math.min(...[...offsetScores.entries()]
    .filter(([offset]) => Math.abs(offset - bestOffset) >= alternativeSeparation)
    .map(([, score]) => score))
  const unambiguous = !Number.isFinite(alternativeScore) ||
    alternativeScore - bestScore >= MIN_ALTERNATIVE_SCORE_MARGIN
  const accepted = bestScore <= MAX_MATCH_SCORE && improvement >= MIN_SCORE_IMPROVEMENT &&
    confidence >= MIN_CONFIDENCE && unambiguous
  return { offset: bestOffset, score: bestScore, confidence, unchangedScore, accepted }
}

export function findScrollOffset(
  previous: Uint8ClampedArray | Uint8Array,
  current: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  axis: ScrollAxis
): ScrollMatch | null {
  const analysis = analyzeScrollOffset(previous, current, width, height, axis)
  return analysis?.accepted
    ? { offset: analysis.offset, score: analysis.score, confidence: analysis.confidence }
    : null
}

/**
 * Infers one cardinal movement without asking the user to choose an axis. Reversing the two
 * frames lets the existing one-way overlap scorer safely recognize up and left as well as down
 * and right. A weak or axis-ambiguous result is rejected instead of corrupting the panorama.
 */
export function panoramicMovementCandidates(
  previous: Uint8ClampedArray | Uint8Array,
  current: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): PanoramicMovement[] {
  const candidates: PanoramicMovement[] = []
  const add = (
    analysis: ScrollAnalysis | null,
    direction: PanoramicDirection,
    delta: Point
  ): void => {
    if (!analysis?.accepted) return
    candidates.push({
      direction,
      delta,
      offset: analysis.offset,
      score: analysis.score,
      confidence: analysis.confidence
    })
  }

  const down = analyzeScrollOffset(previous, current, width, height, 'vertical')
  const up = analyzeScrollOffset(current, previous, width, height, 'vertical')
  const right = analyzeScrollOffset(previous, current, width, height, 'horizontal')
  const left = analyzeScrollOffset(current, previous, width, height, 'horizontal')
  add(down, 'down', { x: 0, y: down?.offset ?? 0 })
  add(up, 'up', { x: 0, y: -(up?.offset ?? 0) })
  add(right, 'right', { x: right?.offset ?? 0, y: 0 })
  add(left, 'left', { x: -(left?.offset ?? 0), y: 0 })

  candidates.sort((a, b) => a.score - b.score || b.confidence - a.confidence)
  return candidates
}

/**
 * Uses the already-built panorama as a second alignment authority. Once a candidate overlaps
 * enough known pixels, a poor historical match must fail closed: falling back to frame-to-frame
 * matching here can mistake repeated cards/rows for nearby content after a large scrollbar jump.
 */
export function chooseHistoryAnchoredPanoramicMovement(
  candidates: readonly PanoramicHistoryCandidate[]
): PanoramicHistoryDecision {
  const anchored = candidates
    .filter((candidate) => candidate.historySamples >= 24 && Number.isFinite(candidate.historyScore))
    .sort((a, b) => a.historyScore - b.historyScore || a.movement.score - b.movement.score)
  if (anchored.length === 0) return { anchored: false, movement: null }

  const best = anchored[0]
  const runnerUp = anchored[1]
  const unambiguous = !runnerUp || runnerUp.historyScore - best.historyScore >= 1.5
  return {
    anchored: true,
    movement: best.historyScore <= 28 && unambiguous ? best.movement : null
  }
}

export function analyzePanoramicMovement(
  previous: Uint8ClampedArray | Uint8Array,
  current: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): PanoramicMovement | null {
  const candidates = panoramicMovementCandidates(previous, current, width, height)
  const best = candidates[0]
  if (!best) return null
  const runnerUp = candidates[1]
  if (runnerUp && Math.abs(runnerUp.score - best.score) < 1.25 &&
      Math.abs(runnerUp.confidence - best.confidence) < 0.06) {
    return null
  }
  return best
}

export function panoramicViewportAfterMovement(position: Point, movement: PanoramicMovement): Point {
  return { x: position.x + movement.delta.x, y: position.y + movement.delta.y }
}

export function panoramicExposure(
  viewportPosition: Point,
  viewport: { width: number; height: number },
  movement: Pick<PanoramicMovement, 'direction' | 'offset'>
): PanoramicExposure {
  const width = Math.max(1, Math.round(viewport.width))
  const height = Math.max(1, Math.round(viewport.height))
  const limit = movement.direction === 'up' || movement.direction === 'down' ? height : width
  const offset = Math.max(1, Math.min(limit, Math.round(movement.offset)))
  if (movement.direction === 'up') {
    return {
      source: { x: 0, y: 0, width, height: offset },
      world: { x: viewportPosition.x, y: viewportPosition.y, width, height: offset }
    }
  }
  if (movement.direction === 'down') {
    return {
      source: { x: 0, y: height - offset, width, height: offset },
      world: { x: viewportPosition.x, y: viewportPosition.y + height - offset, width, height: offset }
    }
  }
  if (movement.direction === 'left') {
    return {
      source: { x: 0, y: 0, width: offset, height },
      world: { x: viewportPosition.x, y: viewportPosition.y, width: offset, height }
    }
  }
  return {
    source: { x: width - offset, y: 0, width: offset, height },
    world: { x: viewportPosition.x + width - offset, y: viewportPosition.y, width: offset, height }
  }
}

export function panoramicRectIntersection(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null
}

function subtractRect(source: Rect, covered: Rect): Rect[] {
  const overlap = panoramicRectIntersection(source, covered)
  if (!overlap) return [source]
  const right = source.x + source.width
  const bottom = source.y + source.height
  const overlapRight = overlap.x + overlap.width
  const overlapBottom = overlap.y + overlap.height
  const pieces: Rect[] = []
  if (overlap.y > source.y) {
    pieces.push({ x: source.x, y: source.y, width: source.width, height: overlap.y - source.y })
  }
  if (overlapBottom < bottom) {
    pieces.push({ x: source.x, y: overlapBottom, width: source.width, height: bottom - overlapBottom })
  }
  if (overlap.x > source.x) {
    pieces.push({ x: source.x, y: overlap.y, width: overlap.x - source.x, height: overlap.height })
  }
  if (overlapRight < right) {
    pieces.push({ x: overlapRight, y: overlap.y, width: right - overlapRight, height: overlap.height })
  }
  return pieces
}

/** Returns only portions of a rectangle which have not been captured before. */
export function uncoveredPanoramicRects(rect: Rect, captured: readonly Rect[]): Rect[] {
  let pieces = [rect]
  for (const covered of captured) {
    pieces = pieces.flatMap((piece) => subtractRect(piece, covered))
    if (pieces.length === 0) break
  }
  return pieces
}

/**
 * Returns the part of the current viewport far enough from its moving edges to be a higher-quality
 * observation. Browser hover UI, sticky chrome, and display-capture boundary pixels tend to live at
 * those edges. Content first seen there remains provisional until scrolling carries it inward.
 */
export function panoramicTrustedInterior(
  viewportPosition: Point,
  viewport: { width: number; height: number },
  direction: PanoramicDirection
): Rect {
  const width = Math.max(1, Math.round(viewport.width))
  const height = Math.max(1, Math.round(viewport.height))
  const vertical = direction === 'up' || direction === 'down'
  const axisLength = vertical ? height : width
  const maximumGuard = Math.max(0, Math.floor((axisLength - 1) / 2))
  const guard = Math.min(maximumGuard, Math.max(12, Math.min(120, Math.round(axisLength * 0.14))))
  return vertical
    ? { x: viewportPosition.x, y: viewportPosition.y + guard, width, height: Math.max(1, height - guard * 2) }
    : { x: viewportPosition.x + guard, y: viewportPosition.y, width: Math.max(1, width - guard * 2), height }
}

/**
 * Finds captured pixels inside a trusted viewport interior which have only been observed at an
 * edge so far. The renderer redraws these pieces from the current full-resolution frame, upgrading
 * provisional seams without duplicating already-trusted coverage.
 */
export function refreshablePanoramicRects(
  interior: Rect,
  captured: readonly Rect[],
  trusted: readonly Rect[]
): Rect[] {
  const refreshable: Rect[] = []
  for (const capturedRect of captured) {
    const overlap = panoramicRectIntersection(interior, capturedRect)
    if (!overlap) continue
    refreshable.push(...uncoveredPanoramicRects(overlap, [...trusted, ...refreshable]))
  }
  return refreshable
}

export function panoramicBounds(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null
  const left = Math.min(...rects.map((rect) => rect.x))
  const top = Math.min(...rects.map((rect) => rect.y))
  const right = Math.max(...rects.map((rect) => rect.x + rect.width))
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export function rollingCaptureDimensions(
  viewport: { width: number; height: number },
  appendedPixels: number,
  axis: ScrollAxis
): { width: number; height: number } {
  const addition = Math.max(0, Math.round(Number.isFinite(appendedPixels) ? appendedPixels : 0))
  return axis === 'vertical'
    ? { width: viewport.width, height: viewport.height + addition }
    : { width: viewport.width + addition, height: viewport.height }
}

export function rollingCaptureFits(width: number, height: number): boolean {
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 &&
    width <= MAX_SCROLL_AXIS_PIXELS && height <= MAX_SCROLL_AXIS_PIXELS &&
    width * height <= MAX_SCROLL_TOTAL_PIXELS
}
