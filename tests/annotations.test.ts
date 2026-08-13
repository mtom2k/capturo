import { describe, expect, it } from 'vitest'
import {
  annotationBounds,
  clampAnnotationDelta,
  hitTestAnnotation,
  resizeAnnotation,
  translateAnnotation
} from '../src/shared/annotations'
import type { AnnotationStyle, TextAnnotation } from '../src/shared/types'

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
