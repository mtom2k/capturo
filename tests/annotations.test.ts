import { describe, expect, it } from 'vitest'
import {
  annotationBounds,
  clampAnnotationDelta,
  hitTestAnnotation,
  resizeAnnotation,
  translateAnnotation
} from '../src/shared/annotations'
import type { AnnotationStyle, HighlightAnnotation, PenAnnotation, TextAnnotation } from '../src/shared/types'

const style: AnnotationStyle = {
  color: '#ef4444',
  lineWidth: 4,
  effectIntensity: 50,
  effectScale: 1,
  fontFamily: 'system-ui, sans-serif',
  fontSize: 20,
  fontWeight: 'normal',
  fontStyle: 'normal',
  smoothing: 'medium'
}

describe('annotation geometry', () => {
  it('gives multiline text a selectable non-zero box', () => {
    const text: TextAnnotation = { id: 'text', type: 'text', style, origin: { x: 20, y: 30 }, text: 'One\nLonger line' }
    expect(annotationBounds(text)).toEqual({ x: 20, y: 30, width: 136.4, height: 50 })
    expect(hitTestAnnotation(text, { x: 40, y: 45 }, 4)).toBe(true)
  })

  it('hit-tests the interior of a shape for direct manipulation', () => {
    const rectangle = { id: 'rect', type: 'rectangle' as const, style, rect: { x: 10, y: 10, width: 80, height: 50 } }
    expect(hitTestAnnotation(rectangle, { x: 50, y: 35 }, 4)).toBe(true)
  })

  it('translates an object without changing its style', () => {
    const line = { id: 'line', type: 'line' as const, style, start: { x: 10, y: 20 }, end: { x: 30, y: 40 } }
    expect(translateAnnotation(line, { x: 5, y: -3 })).toEqual({
      ...line,
      start: { x: 15, y: 17 },
      end: { x: 35, y: 37 }
    })
  })

  it('clamps object movement to the selection', () => {
    const text: TextAnnotation = { id: 'text', type: 'text', style, origin: { x: 60, y: 40 }, text: 'Move' }
    const delta = clampAnnotationDelta(text, { x: 100, y: 100 }, { x: 0, y: 0, width: 120, height: 80 })
    expect(delta.x).toBeCloseTo(10.4)
    expect(delta.y).toBe(15)
  })

  it('resizes line endpoints with its selected bounding box', () => {
    const line = { id: 'line', type: 'line' as const, style, start: { x: 10, y: 10 }, end: { x: 30, y: 30 } }
    const original = annotationBounds(line)
    const resized = resizeAnnotation(line, original, { x: original.x, y: original.y, width: original.width * 2, height: original.height * 2 })
    expect(resized.type).toBe('line')
    if (resized.type === 'line') {
      expect(resized.start).toEqual({ x: 12, y: 12 })
      expect(resized.end).toEqual({ x: 52, y: 52 })
    }
  })

  it('scales numbered-step bounds from the selected size style', () => {
    const small = annotationBounds({
      id: 'small-step',
      type: 'step',
      style: { ...style, fontSize: 14 },
      center: { x: 50, y: 50 },
      number: 1
    })
    const large = annotationBounds({
      id: 'large-step',
      type: 'step',
      style: { ...style, fontSize: 26 },
      center: { x: 50, y: 50 },
      number: 2
    })
    expect(large.width).toBeGreaterThan(small.width)
    expect(large.height).toBeGreaterThan(small.height)
  })
})

describe('highlight geometry', () => {
  // A highlighter is a pen stroke that composites differently, so every geometric operation must
  // treat the two identically. Each case here is asserted against the pen to keep them honest:
  // adding a geometry branch for one and not the other is exactly the drift this guards.
  const points = [
    { x: 10, y: 20 },
    { x: 60, y: 24 },
    { x: 120, y: 18 }
  ]
  const wide: AnnotationStyle = { ...style, lineWidth: 18 }
  const highlight: HighlightAnnotation = { id: 'h', type: 'highlight', style: wide, points }
  const pen: PenAnnotation = { id: 'p', type: 'pen', style: wide, points }

  it('bounds the stroke exactly as a pen of the same width would', () => {
    expect(annotationBounds(highlight)).toEqual(annotationBounds(pen))
  })

  it('pads the bounds by half the stroke so a fat highlight stays grabbable', () => {
    // Without the padding the selection box would sit inside the visible stroke, and an 18px
    // highlighter would be hard to select by clicking what you can see.
    expect(annotationBounds(highlight)).toEqual({ x: 1, y: 9, width: 128, height: 24 })
  })

  it('hit-tests along the stroke, and not beside it', () => {
    expect(hitTestAnnotation(highlight, { x: 60, y: 24 }, 4)).toBe(true)
    // Just inside the half-width plus tolerance, then clearly outside it.
    expect(hitTestAnnotation(highlight, { x: 60, y: 34 }, 4)).toBe(true)
    expect(hitTestAnnotation(highlight, { x: 60, y: 90 }, 4)).toBe(false)
    expect(hitTestAnnotation(highlight, { x: 60, y: 24 }, 4)).toBe(hitTestAnnotation(pen, { x: 60, y: 24 }, 4))
  })

  it('moves every point together', () => {
    const moved = translateAnnotation(highlight, { x: 5, y: -3 })
    expect(moved.type).toBe('highlight')
    expect((moved as HighlightAnnotation).points).toEqual([
      { x: 15, y: 17 },
      { x: 65, y: 21 },
      { x: 125, y: 15 }
    ])
    expect((moved as HighlightAnnotation).points)
      .toEqual((translateAnnotation(pen, { x: 5, y: -3 }) as PenAnnotation).points)
  })

  it('resizes by remapping its points into the new box', () => {
    const original = annotationBounds(highlight)
    const target = { x: original.x, y: original.y, width: original.width * 2, height: original.height }
    const resized = resizeAnnotation(highlight, original, target) as HighlightAnnotation
    expect(resized.type).toBe('highlight')
    expect(resized.points).toHaveLength(3)
    // Stretched horizontally only: the span doubles, the vertical positions hold.
    const width = resized.points[2].x - resized.points[0].x
    expect(width).toBeCloseTo((points[2].x - points[0].x) * 2)
    expect(resized.points[0].y).toBeCloseTo(points[0].y)
    expect(resized.points).toEqual((resizeAnnotation(pen, original, target) as PenAnnotation).points)
  })

  it('is clamped into the selection like any other annotation', () => {
    const selection = { x: 0, y: 0, width: 200, height: 100 }
    const delta = clampAnnotationDelta(highlight, { x: 500, y: 0 }, selection)
    const moved = translateAnnotation(highlight, delta) as HighlightAnnotation
    const bounds = annotationBounds(moved)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(selection.width + 0.001)
  })
})
