import type { Annotation, Point, Rect, Smoothing } from '../shared/types'
import { annotationBounds } from '../shared/annotations'

type RenderOptions = {
  selection?: Rect | null
  selectedAnnotation?: Annotation | null
  shade?: boolean
  uiScale?: number
}

// The dim laid over the frozen desktop during a capture. Before a selection exists it
// covers the whole screen, so invoking Capturo visibly enters capture mode; once a region is
// selected the same tint darkens everything outside it while the selection reads at full
// brightness.
const SHADE_FILL = 'rgba(5, 9, 16, 0.52)'

function drawScreenDim(context: CanvasRenderingContext2D): void {
  context.save()
  context.fillStyle = SHADE_FILL
  context.fillRect(0, 0, context.canvas.width, context.canvas.height)
  context.restore()
}

function roundedRectPath(context: CanvasRenderingContext2D, rect: Rect, radius: number): void {
  const r = Math.min(radius, rect.width / 2, rect.height / 2)
  context.beginPath()
  context.roundRect(rect.x, rect.y, rect.width, rect.height, r)
}

function smoothingStride(smoothing: Smoothing): number {
  if (smoothing === 'low') return 1
  if (smoothing === 'medium') return 2
  return 4
}

function drawPen(context: CanvasRenderingContext2D, annotation: Extract<Annotation, { type: 'pen' }>): void {
  const stride = smoothingStride(annotation.style.smoothing)
  const points = annotation.points.filter((_point, index) => index === 0 || index === annotation.points.length - 1 || index % stride === 0)
  if (points.length < 2) return
  context.beginPath()
  context.moveTo(points[0].x, points[0].y)
  if (annotation.style.smoothing === 'low') {
    for (const point of points.slice(1)) context.lineTo(point.x, point.y)
  } else {
    for (let index = 1; index < points.length - 1; index += 1) {
      const point = points[index]
      const next = points[index + 1]
      context.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2)
    }
    const last = points[points.length - 1]
    context.lineTo(last.x, last.y)
  }
  context.stroke()
}

function drawArrowHead(context: CanvasRenderingContext2D, start: Point, end: Point, lineWidth: number): void {
  const angle = Math.atan2(end.y - start.y, end.x - start.x)
  const length = Math.max(12, lineWidth * 4)
  context.beginPath()
  context.moveTo(end.x, end.y)
  context.lineTo(end.x - length * Math.cos(angle - Math.PI / 6), end.y - length * Math.sin(angle - Math.PI / 6))
  context.moveTo(end.x, end.y)
  context.lineTo(end.x - length * Math.cos(angle + Math.PI / 6), end.y - length * Math.sin(angle + Math.PI / 6))
  context.stroke()
}

function applyBlur(context: CanvasRenderingContext2D, rect: Rect, lineWidth: number): void {
  if (rect.width < 2 || rect.height < 2) return
  const temporary = document.createElement('canvas')
  temporary.width = Math.max(1, Math.round(rect.width))
  temporary.height = Math.max(1, Math.round(rect.height))
  const tempContext = temporary.getContext('2d')
  if (!tempContext) return
  tempContext.drawImage(context.canvas, rect.x, rect.y, rect.width, rect.height, 0, 0, temporary.width, temporary.height)
  context.save()
  context.beginPath()
  context.rect(rect.x, rect.y, rect.width, rect.height)
  context.clip()
  context.filter = `blur(${Math.max(5, lineWidth * 2)}px)`
  context.drawImage(temporary, rect.x, rect.y, rect.width, rect.height)
  context.restore()
}

function applyPixelate(context: CanvasRenderingContext2D, rect: Rect, lineWidth: number): void {
  if (rect.width < 2 || rect.height < 2) return
  const block = Math.max(8, Math.round(lineWidth * 3))
  const temporary = document.createElement('canvas')
  temporary.width = Math.max(1, Math.ceil(rect.width / block))
  temporary.height = Math.max(1, Math.ceil(rect.height / block))
  const tempContext = temporary.getContext('2d')
  if (!tempContext) return
  tempContext.imageSmoothingEnabled = false
  tempContext.drawImage(context.canvas, rect.x, rect.y, rect.width, rect.height, 0, 0, temporary.width, temporary.height)
  context.save()
  context.imageSmoothingEnabled = false
  context.drawImage(temporary, 0, 0, temporary.width, temporary.height, rect.x, rect.y, rect.width, rect.height)
  context.restore()
}

export function renderAnnotation(context: CanvasRenderingContext2D, annotation: Annotation): void {
  const { style } = annotation
  context.save()
  context.strokeStyle = style.color
  context.fillStyle = style.color
  context.lineWidth = style.lineWidth
  context.lineCap = 'round'
  context.lineJoin = 'round'

  switch (annotation.type) {
    case 'pen':
      drawPen(context, annotation)
      break
    case 'line':
    case 'arrow':
      context.beginPath()
      context.moveTo(annotation.start.x, annotation.start.y)
      context.lineTo(annotation.end.x, annotation.end.y)
      context.stroke()
      if (annotation.type === 'arrow') drawArrowHead(context, annotation.start, annotation.end, style.lineWidth)
      break
    case 'rectangle':
      context.strokeRect(annotation.rect.x, annotation.rect.y, annotation.rect.width, annotation.rect.height)
      break
    case 'ellipse':
      context.beginPath()
      context.ellipse(
        annotation.rect.x + annotation.rect.width / 2,
        annotation.rect.y + annotation.rect.height / 2,
        Math.abs(annotation.rect.width / 2),
        Math.abs(annotation.rect.height / 2),
        0,
        0,
        Math.PI * 2
      )
      context.stroke()
      break
    case 'step': {
      const radius = Math.max(13, style.fontSize * 0.78)
      context.beginPath()
      context.arc(annotation.center.x, annotation.center.y, radius, 0, Math.PI * 2)
      context.fillStyle = style.color
      context.fill()
      context.strokeStyle = '#ffffff'
      context.lineWidth = Math.max(2.5, style.lineWidth * 0.7)
      context.stroke()
      context.fillStyle = style.color === '#ffffff' ? '#111827' : '#ffffff'
      context.font = `bold ${Math.round(radius * 1.05)}px system-ui, sans-serif`
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(String(annotation.number), annotation.center.x, annotation.center.y + 0.5)
      break
    }
    case 'text': {
      context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`
      context.textAlign = 'left'
      context.textBaseline = 'top'
      const lineHeight = style.fontSize * 1.25
      for (const [index, line] of annotation.text.split('\n').entries()) {
        context.fillText(line, annotation.origin.x, annotation.origin.y + index * lineHeight)
      }
      break
    }
    case 'blur':
      applyBlur(context, annotation.rect, style.lineWidth)
      break
    case 'pixelate':
      applyPixelate(context, annotation.rect, style.lineWidth)
      break
  }
  context.restore()
}

function drawSelection(context: CanvasRenderingContext2D, selection: Rect, uiScale: number): void {
  const width = context.canvas.width
  const height = context.canvas.height
  context.save()
  context.fillStyle = SHADE_FILL
  context.fillRect(0, 0, width, selection.y)
  context.fillRect(0, selection.y, selection.x, selection.height)
  context.fillRect(selection.x + selection.width, selection.y, width - selection.x - selection.width, selection.height)
  context.fillRect(0, selection.y + selection.height, width, height - selection.y - selection.height)

  context.lineWidth = Math.max(1, uiScale)
  context.strokeStyle = '#ffffff'
  context.strokeRect(selection.x + context.lineWidth / 2, selection.y + context.lineWidth / 2, selection.width - context.lineWidth, selection.height - context.lineWidth)
  context.setLineDash([4 * uiScale, 3 * uiScale])
  context.strokeStyle = '#1683ff'
  context.strokeRect(selection.x + context.lineWidth * 1.5, selection.y + context.lineWidth * 1.5, selection.width - context.lineWidth * 3, selection.height - context.lineWidth * 3)
  context.setLineDash([])

  const size = 7 * uiScale
  const points: Point[] = [
    { x: selection.x, y: selection.y },
    { x: selection.x + selection.width / 2, y: selection.y },
    { x: selection.x + selection.width, y: selection.y },
    { x: selection.x + selection.width, y: selection.y + selection.height / 2 },
    { x: selection.x + selection.width, y: selection.y + selection.height },
    { x: selection.x + selection.width / 2, y: selection.y + selection.height },
    { x: selection.x, y: selection.y + selection.height },
    { x: selection.x, y: selection.y + selection.height / 2 }
  ]
  context.fillStyle = '#ffffff'
  context.strokeStyle = '#1683ff'
  context.lineWidth = uiScale
  for (const point of points) {
    context.fillRect(point.x - size / 2, point.y - size / 2, size, size)
    context.strokeRect(point.x - size / 2, point.y - size / 2, size, size)
  }
  context.restore()
}

function drawAnnotationSelection(context: CanvasRenderingContext2D, annotation: Annotation, uiScale: number): void {
  const bounds = annotationBounds(annotation)
  const size = 7 * uiScale
  const points: Point[] = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width / 2, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height / 2 }
  ]
  context.save()
  context.strokeStyle = '#38bdf8'
  context.lineWidth = Math.max(1, uiScale)
  context.setLineDash([4 * uiScale, 3 * uiScale])
  context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height)
  context.setLineDash([])
  context.fillStyle = '#ffffff'
  for (const point of points) {
    context.fillRect(point.x - size / 2, point.y - size / 2, size, size)
    context.strokeRect(point.x - size / 2, point.y - size / 2, size, size)
  }
  context.restore()
}

export function renderScene(
  context: CanvasRenderingContext2D,
  image: HTMLCanvasElement,
  annotations: Annotation[],
  draft: Annotation | null,
  options: RenderOptions = {}
): void {
  context.save()
  context.clearRect(0, 0, context.canvas.width, context.canvas.height)
  context.drawImage(image, 0, 0, context.canvas.width, context.canvas.height)
  for (const annotation of annotations) renderAnnotation(context, annotation)
  if (draft) renderAnnotation(context, draft)
  if (options.shade !== false) {
    // With a selection, dim everything outside it; before one exists, dim the whole screen
    // so the frozen desktop reads as capture mode rather than the live desktop.
    if (options.selection) drawSelection(context, options.selection, options.uiScale ?? 1)
    else drawScreenDim(context)
  }
  if (options.selectedAnnotation && options.shade !== false) {
    drawAnnotationSelection(context, options.selectedAnnotation, options.uiScale ?? 1)
  }
  context.restore()
}

export function exportSelection(
  image: HTMLCanvasElement,
  selection: Rect,
  annotations: Annotation[]
): string {
  const composite = document.createElement('canvas')
  composite.width = image.width
  composite.height = image.height
  const compositeContext = composite.getContext('2d')
  if (!compositeContext) throw new Error('Canvas rendering is unavailable')
  renderScene(compositeContext, image, annotations, null, { shade: false })

  const output = document.createElement('canvas')
  output.width = Math.max(1, Math.round(selection.width))
  output.height = Math.max(1, Math.round(selection.height))
  const outputContext = output.getContext('2d')
  if (!outputContext) throw new Error('Canvas export is unavailable')
  outputContext.drawImage(
    composite,
    selection.x,
    selection.y,
    selection.width,
    selection.height,
    0,
    0,
    output.width,
    output.height
  )
  return output.toDataURL('image/png')
}
