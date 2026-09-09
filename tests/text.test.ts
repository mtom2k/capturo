import { describe, expect, it, vi } from 'vitest'
import { wrapText } from '../src/shared/text'
import { stepMetrics } from '../src/shared/step'
import { annotationBounds, resizeAnnotation, translateAnnotation } from '../src/shared/annotations'
import { resizeRect } from '../src/shared/geometry'
import { renderAnnotation } from '../src/renderer/render'
import type { AnnotationStyle, ResizeHandle, TextAnnotation } from '../src/shared/types'

const style: AnnotationStyle = {
  color: '#ef4444', lineWidth: 4, effectIntensity: 50, effectScale: 1,
  fontFamily: 'sans-serif', fontSize: 20, fontWeight: 'normal', fontStyle: 'normal', smoothing: 'medium'
}
const text: TextAnnotation = {
  id: 'text', type: 'text', style, origin: { x: 100, y: 100 },
  box: { width: 200, height: 100 }, text: 'A sentence that wraps without pressing Enter.'
}

describe('text wrapping', () => {
  const measure = (value: string): number => value.length * 10
  it('wraps words to the box and reflows when widened without inserting newlines', () => {
    const value = 'One two three four'
    expect(wrapText(value, 80, measure)).toEqual(['One two', 'three', 'four'])
    expect(wrapText(value, 180, measure)).toEqual([value])
  })
  it('retains explicit line breaks and empty paragraphs', () => {
    expect(wrapText('One\r\n\r\nTwo\n', 200, measure)).toEqual(['One', '', 'Two', ''])
  })
  it('breaks a long unspaced word without losing characters', () => {
    expect(wrapText('abcdefgh', 30, measure)).toEqual(['abc', 'def', 'gh'])
  })
  it('measures glyph widths instead of guessing from character count', () => {
    const proportional = (value: string): number => [...value].reduce((n, c) => n + (c === 'W' ? 20 : 5), 0)
    expect(wrapText('iiii WWW', 40, proportional)).toEqual(['iiii', 'WW', 'W'])
  })
  it('does not split emoji or combining-character graphemes', () => {
    expect(wrapText('👩‍💻👩‍💻', 1, measure)).toEqual(['👩‍💻', '👩‍💻'])
    expect(wrapText('éé', 1, measure)).toEqual(['é', 'é'])
  })
})

describe('persistent text box geometry', () => {
  it('selects the entire box, including its empty space', () => {
    expect(annotationBounds(text)).toEqual({ x: 100, y: 100, width: 200, height: 100 })
  })
  it.each([
    ['north', { x: 180, y: 50 }, { x: 100, y: 50, width: 200, height: 150 }],
    ['south', { x: 180, y: 250 }, { x: 100, y: 100, width: 200, height: 150 }],
    ['west', { x: 50, y: 150 }, { x: 50, y: 100, width: 250, height: 100 }],
    ['east', { x: 350, y: 150 }, { x: 100, y: 100, width: 250, height: 100 }],
    ['north-west', { x: 50, y: 50 }, { x: 50, y: 50, width: 250, height: 150 }]
  ] as const)('moves only the requested %s edges and preserves font size', (handle, pointer, expected) => {
    const bounds = annotationBounds(text)
    const target = resizeRect(bounds, handle as ResizeHandle, pointer, { x: 0, y: 0, width: 1000, height: 1000 })
    const resized = resizeAnnotation(text, bounds, target)
    expect(annotationBounds(resized)).toEqual(expected)
    expect(resized.style).toEqual(style)
    expect((resized as TextAnnotation).text).toBe(text.text)
  })
  it('moves the box without changing wrapping dimensions', () => {
    expect(annotationBounds(translateAnnotation(text, { x: 20, y: 30 })))
      .toEqual({ x: 120, y: 130, width: 200, height: 100 })
  })
})

describe('independent numbered step size', () => {
  it('keeps border, radius and selectable bounds identical after changing shape stroke width', () => {
    const thin = { ...style, lineWidth: 1 }
    const thick = { ...style, lineWidth: 24 }
    expect(stepMetrics(thin)).toEqual(stepMetrics(thick))
    const step = { id: 'step', type: 'step' as const, number: 1, center: { x: 80, y: 80 } }
    expect(annotationBounds({ ...step, style: thin })).toEqual(annotationBounds({ ...step, style: thick }))
  })
  it('scales its border with its own size and device scale', () => {
    const base = stepMetrics(style)
    const doubled = stepMetrics({ ...style, fontSize: 40, effectScale: 2 })
    expect(doubled.radius).toBeCloseTo(base.radius * 2)
    expect(doubled.border).toBeCloseTo(base.border * 2)
  })
})

describe('text canvas output', () => {
  it('uses measured wrapping, CSS line spacing and the persisted clipping box', () => {
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      fillText: vi.fn(), measureText(value: string) {
        return {
          width: value.length * 10,
          fontBoundingBoxAscent: this.textBaseline === 'alphabetic' ? 16 : -4,
          fontBoundingBoxDescent: this.textBaseline === 'alphabetic' ? 4 : 24
        }
      }, textBaseline: ''
    }
    renderAnnotation(context as unknown as CanvasRenderingContext2D, {
      ...text, text: 'One two three', box: { width: 80, height: 100 }
    })
    expect(context.fillText.mock.calls).toEqual([['One two', 100, 118.5], ['three', 100, 143.5]])
    expect(context.rect).toHaveBeenCalledWith(100, 100, 80, 100)
    expect(context.clip).toHaveBeenCalledOnce()
    expect(context.textBaseline).toBe('alphabetic')
  })
})
