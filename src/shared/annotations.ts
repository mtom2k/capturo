import type { Annotation, Point, Rect } from './types'
import { pointInRect, translatePoint, translateRect } from './geometry'

function boundsFromPoints(points: Point[], padding = 0): Rect {
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const left = Math.min(...xs) - padding
  const top = Math.min(...ys) - padding
  const right = Math.max(...xs) + padding
  const bottom = Math.max(...ys) + padding
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export function annotationBounds(annotation: Annotation): Rect {
  const strokePadding = Math.max(2, annotation.style.lineWidth / 2)
  switch (annotation.type) {
    case 'transparent':
      return { ...annotation.region }
    case 'pen':
    case 'highlight':
      return boundsFromPoints(annotation.points, strokePadding)
    case 'line':
      return boundsFromPoints([annotation.start, annotation.end], strokePadding)
    case 'arrow':
      return boundsFromPoints(
        [annotation.start, annotation.end],
        Math.max(strokePadding, annotation.style.lineWidth * 4, 12)
      )
    case 'rectangle':
    case 'ellipse':
      return {
        x: annotation.rect.x - strokePadding,
        y: annotation.rect.y - strokePadding,
        width: annotation.rect.width + strokePadding * 2,
        height: annotation.rect.height + strokePadding * 2
      }
    case 'blur':
    case 'pixelate':
      return { ...annotation.rect }
    case 'step': {
      const radius = Math.max(13, annotation.style.fontSize * 0.78) + Math.max(2, annotation.style.lineWidth / 2)
      return {
        x: annotation.center.x - radius,
        y: annotation.center.y - radius,
        width: radius * 2,
        height: radius * 2
      }
    }
    case 'text': {
      const lines = annotation.text.split('\n')
      const longest = Math.max(1, ...lines.map((line) => line.length))
      return {
        x: annotation.origin.x,
        y: annotation.origin.y,
        width: Math.max(annotation.style.fontSize * 0.6, longest * annotation.style.fontSize * 0.62),
        height: Math.max(annotation.style.fontSize * 1.25, lines.length * annotation.style.fontSize * 1.25)
      }
    }
  }
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y)
  const amount = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
  const closest = { x: start.x + amount * dx, y: start.y + amount * dy }
  return Math.hypot(point.x - closest.x, point.y - closest.y)
}

function nearRectEdge(point: Point, rect: Rect, tolerance: number): boolean {
  if (
    point.x < rect.x - tolerance ||
    point.x > rect.x + rect.width + tolerance ||
    point.y < rect.y - tolerance ||
    point.y > rect.y + rect.height + tolerance
  ) return false
  const horizontal = Math.min(Math.abs(point.y - rect.y), Math.abs(point.y - (rect.y + rect.height))) <= tolerance
  const vertical = Math.min(Math.abs(point.x - rect.x), Math.abs(point.x - (rect.x + rect.width))) <= tolerance
  return horizontal || vertical
}

export function hitTestAnnotation(annotation: Annotation, point: Point, tolerance: number): boolean {
  switch (annotation.type) {
    case 'transparent':
      return false
    case 'pen':
    case 'highlight':
      return annotation.points.slice(1).some((end, index) =>
        distanceToSegment(point, annotation.points[index], end) <= tolerance + annotation.style.lineWidth / 2
      )
    case 'line':
    case 'arrow':
      return distanceToSegment(point, annotation.start, annotation.end) <= tolerance + annotation.style.lineWidth / 2
    case 'rectangle':
      return pointInRect(point, annotation.rect) || nearRectEdge(point, annotation.rect, tolerance + annotation.style.lineWidth / 2)
    case 'ellipse': {
      const radiusX = Math.max(1, annotation.rect.width / 2)
      const radiusY = Math.max(1, annotation.rect.height / 2)
      const centerX = annotation.rect.x + radiusX
      const centerY = annotation.rect.y + radiusY
      const normalized = Math.hypot((point.x - centerX) / radiusX, (point.y - centerY) / radiusY)
      return normalized <= 1 + tolerance / Math.min(radiusX, radiusY) + annotation.style.lineWidth / Math.min(radiusX, radiusY)
    }
    case 'blur':
    case 'pixelate':
    case 'text':
      return pointInRect(point, annotationBounds(annotation))
    case 'step': {
      const bounds = annotationBounds(annotation)
      const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
      return Math.hypot(point.x - center.x, point.y - center.y) <= bounds.width / 2 + tolerance
    }
  }
}

export function translateAnnotation(annotation: Annotation, delta: Point): Annotation {
  switch (annotation.type) {
    case 'transparent':
      return annotation
    case 'pen':
    case 'highlight':
      return { ...annotation, points: annotation.points.map((point) => translatePoint(point, delta)) }
    case 'line':
    case 'arrow':
      return {
        ...annotation,
        start: translatePoint(annotation.start, delta),
        end: translatePoint(annotation.end, delta)
      }
    case 'rectangle':
    case 'ellipse':
    case 'blur':
    case 'pixelate':
      return { ...annotation, rect: translateRect(annotation.rect, delta) }
    case 'step':
      return { ...annotation, center: translatePoint(annotation.center, delta) }
    case 'text':
      return { ...annotation, origin: translatePoint(annotation.origin, delta) }
  }
}

export function clampAnnotationDelta(annotation: Annotation, requested: Point, bounds: Rect): Point {
  const object = annotationBounds(annotation)
  return {
    x: Math.max(bounds.x - object.x, Math.min(bounds.x + bounds.width - object.x - object.width, requested.x)),
    y: Math.max(bounds.y - object.y, Math.min(bounds.y + bounds.height - object.y - object.height, requested.y))
  }
}

function mapPoint(point: Point, original: Rect, target: Rect): Point {
  const scaleX = target.width / Math.max(1, original.width)
  const scaleY = target.height / Math.max(1, original.height)
  return {
    x: target.x + (point.x - original.x) * scaleX,
    y: target.y + (point.y - original.y) * scaleY
  }
}

export function resizeAnnotation(annotation: Annotation, original: Rect, target: Rect): Annotation {
  const scaleX = target.width / Math.max(1, original.width)
  const scaleY = target.height / Math.max(1, original.height)
  const fontScale = Math.max(0.2, (Math.abs(scaleX) + Math.abs(scaleY)) / 2)
  switch (annotation.type) {
    case 'transparent':
      return annotation
    case 'pen':
    case 'highlight':
      return { ...annotation, points: annotation.points.map((point) => mapPoint(point, original, target)) }
    case 'line':
    case 'arrow':
      return {
        ...annotation,
        start: mapPoint(annotation.start, original, target),
        end: mapPoint(annotation.end, original, target)
      }
    case 'rectangle':
    case 'ellipse':
    case 'blur':
    case 'pixelate': {
      const topLeft = mapPoint({ x: annotation.rect.x, y: annotation.rect.y }, original, target)
      const bottomRight = mapPoint(
        { x: annotation.rect.x + annotation.rect.width, y: annotation.rect.y + annotation.rect.height },
        original,
        target
      )
      return { ...annotation, rect: { x: topLeft.x, y: topLeft.y, width: bottomRight.x - topLeft.x, height: bottomRight.y - topLeft.y } }
    }
    case 'step':
      return {
        ...annotation,
        center: mapPoint(annotation.center, original, target),
        style: { ...annotation.style, fontSize: annotation.style.fontSize * fontScale }
      }
    case 'text':
      return {
        ...annotation,
        origin: mapPoint(annotation.origin, original, target),
        style: { ...annotation.style, fontSize: annotation.style.fontSize * Math.max(0.2, scaleY) }
      }
  }
}
