import type { Annotation, Point, Rect, Smoothing } from '../shared/types'
import { annotationBounds } from '../shared/annotations'
import { removeConnectedColor } from '../shared/transparency'

type RenderOptions = {
  selection?: Rect | null
  selectedAnnotation?: Annotation | null
  shade?: boolean
  uiScale?: number
}

type TransparencyCacheEntry = {
  signature: string
  canvas: HTMLCanvasElement
}

const transparencyCache = new WeakMap<HTMLCanvasElement, TransparencyCacheEntry[]>()

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

// Strong enough to read as a marker on a light background without hiding what is underneath.
const HIGHLIGHT_ALPHA = 0.45

function smoothingStride(smoothing: Smoothing): number {
  if (smoothing === 'low') return 1
  if (smoothing === 'medium') return 2
  return 4
}

// Shared by the pen and the highlighter, which differ only in how the result is composited.
function strokePath(
  context: CanvasRenderingContext2D,
  annotation: Extract<Annotation, { type: 'pen' | 'highlight' }>
): void {
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

function clampedIntensity(intensity: number): number {
  return Math.max(1, Math.min(100, Number.isFinite(intensity) ? intensity : 50))
}

function clampedEffectScale(scale: number): number {
  return Number.isFinite(scale) && scale > 0 ? scale : 1
}

export function blurRadiusForIntensity(intensity: number, scale = 1): number {
  return (1 + ((clampedIntensity(intensity) - 1) / 99) * 31) * clampedEffectScale(scale)
}

// How much real image a blur of this radius needs around the region it is covering. A Gaussian is
// effectively zero past three standard deviations; anything less lets the blur read past the edge
// of what it was given, which is what made the effect fade out towards its own border.
export function blurPaddingForRadius(radius: number): number {
  return Math.ceil(Math.max(0, Number.isFinite(radius) ? radius : 0) * 3)
}

export function pixelBlockForIntensity(intensity: number, scale = 1): number {
  return Math.max(1, Math.round((2 + ((clampedIntensity(intensity) - 1) / 99) * 62) * clampedEffectScale(scale)))
}

// Blurring a region needs real image from *around* it. A Gaussian samples outwards, so a blur fed
// only the region's own pixels reads transparency past every edge: the result fades out towards
// the border and the untouched original shows through underneath. That looked like a blur which
// only worked in the middle, and it got worse as Intensity rose, because a larger radius widens
// the faded band - so the control appeared to do nothing. The region is therefore blurred with a
// margin of surrounding pixels and only its centre is drawn back.
function applyBlur(context: CanvasRenderingContext2D, rect: Rect, intensity: number, scale: number): void {
  const x = Math.round(rect.x)
  const y = Math.round(rect.y)
  const width = Math.round(rect.width)
  const height = Math.round(rect.height)
  if (width < 2 || height < 2) return

  const radius = blurRadiusForIntensity(intensity, scale)
  // A Gaussian is effectively zero past three standard deviations, so that much margin is enough
  // for the pixels drawn back to be indistinguishable from blurring the whole image.
  const pad = blurPaddingForRadius(radius)

  const source = context.canvas
  // The margin is clamped to the image; a region against the edge simply has less to work with.
  const left = Math.max(0, x - pad)
  const top = Math.max(0, y - pad)
  const right = Math.min(source.width, x + width + pad)
  const bottom = Math.min(source.height, y + height + pad)
  const availableWidth = right - left
  const availableHeight = bottom - top
  if (availableWidth < 1 || availableHeight < 1) return

  const padded = document.createElement('canvas')
  padded.width = width + pad * 2
  padded.height = height + pad * 2
  const paddedContext = padded.getContext('2d')
  if (!paddedContext) return

  // Where the clamped source lands inside the padded canvas.
  const offsetX = pad - (x - left)
  const offsetY = pad - (y - top)
  paddedContext.drawImage(source, left, top, availableWidth, availableHeight, offsetX, offsetY, availableWidth, availableHeight)

  // Where the image ran out, repeat its edge outwards. Without this a region touching the edge of
  // the screenshot keeps the same faded border this function exists to remove. Sides first, then
  // full-width top and bottom, which fills the corners as a side effect.
  const edgeRight = offsetX + availableWidth
  const edgeBottom = offsetY + availableHeight
  if (offsetX > 0) paddedContext.drawImage(padded, offsetX, offsetY, 1, availableHeight, 0, offsetY, offsetX, availableHeight)
  if (padded.width > edgeRight) {
    paddedContext.drawImage(padded, edgeRight - 1, offsetY, 1, availableHeight, edgeRight, offsetY, padded.width - edgeRight, availableHeight)
  }
  if (offsetY > 0) paddedContext.drawImage(padded, 0, offsetY, padded.width, 1, 0, 0, padded.width, offsetY)
  if (padded.height > edgeBottom) {
    paddedContext.drawImage(padded, 0, edgeBottom - 1, padded.width, 1, 0, edgeBottom, padded.width, padded.height - edgeBottom)
  }

  const blurred = document.createElement('canvas')
  blurred.width = padded.width
  blurred.height = padded.height
  const blurredContext = blurred.getContext('2d')
  if (!blurredContext) return
  blurredContext.filter = `blur(${radius}px)`
  blurredContext.drawImage(padded, 0, 0)

  // Only the centre is taken back, so every pixel written is fully covered by blurred neighbours.
  context.save()
  context.filter = 'none'
  context.drawImage(blurred, pad, pad, width, height, x, y, width, height)
  context.restore()
}

function applyPixelate(context: CanvasRenderingContext2D, rect: Rect, intensity: number, scale: number): void {
  if (rect.width < 2 || rect.height < 2) return
  const block = pixelBlockForIntensity(intensity, scale)
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

function applyTransparency(
  context: CanvasRenderingContext2D,
  annotation: Extract<Annotation, { type: 'transparent' }>
): void {
  const left = Math.max(0, Math.floor(annotation.region.x))
  const top = Math.max(0, Math.floor(annotation.region.y))
  const right = Math.min(context.canvas.width, Math.ceil(annotation.region.x + annotation.region.width))
  const bottom = Math.min(context.canvas.height, Math.ceil(annotation.region.y + annotation.region.height))
  const width = right - left
  const height = bottom - top
  if (width < 1 || height < 1) return
  const pixels = context.getImageData(left, top, width, height)
  removeConnectedColor(pixels.data, width, height, {
    seedX: annotation.seed.x - left,
    seedY: annotation.seed.y - top,
    target: annotation.target,
    tolerance: annotation.tolerance,
    feather: annotation.feather
  })
  context.putImageData(pixels, left, top)
}

function transparencySignature(annotations: Array<Extract<Annotation, { type: 'transparent' }>>): string {
  return annotations.map((annotation) => [
    annotation.id,
    annotation.seed.x,
    annotation.seed.y,
    annotation.region.x,
    annotation.region.y,
    annotation.region.width,
    annotation.region.height,
    annotation.target.r,
    annotation.target.g,
    annotation.target.b,
    annotation.tolerance,
    annotation.feather
  ].join(':')).join('|')
}

function transparencyComposite(
  image: HTMLCanvasElement,
  annotations: Array<Extract<Annotation, { type: 'transparent' }>>
): HTMLCanvasElement {
  const signature = transparencySignature(annotations)
  const cached = transparencyCache.get(image) ?? []
  const hit = cached.find((entry) => entry.signature === signature)
  if (hit) {
    transparencyCache.set(image, [...cached.filter((entry) => entry !== hit), hit])
    return hit.canvas
  }
  const composite = document.createElement('canvas')
  composite.width = image.width
  composite.height = image.height
  const compositeContext = composite.getContext('2d')
  if (!compositeContext) return image
  compositeContext.drawImage(image, 0, 0)
  for (const annotation of annotations) applyTransparency(compositeContext, annotation)
  // Two entries retain the live result and its Before counterpart during split preview;
  // old slider states are released instead of accumulating full-size canvases.
  transparencyCache.set(image, [...cached, { signature, canvas: composite }].slice(-2))
  return composite
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
    case 'transparent':
      break
    case 'pen':
      strokePath(context, annotation)
      break
    case 'highlight':
      // Multiply rather than a plain translucent stroke, because a highlighter must leave what it
      // marks readable: multiplying can only darken, so text under the stroke keeps its contrast
      // instead of being washed towards the highlight colour. See D-035.
      context.globalCompositeOperation = 'multiply'
      context.globalAlpha = HIGHLIGHT_ALPHA
      // Flat ends, like a chisel tip, so a stroke across a line of text stops where the drag
      // stopped rather than overhanging it by half the (considerable) stroke width.
      context.lineCap = 'butt'
      // One stroke() call rasterizes the whole path as a single shape, so a stroke that crosses
      // itself does not darken at the crossing. Drawing it segment by segment would.
      strokePath(context, annotation)
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
      applyBlur(context, annotation.rect, style.effectIntensity ?? 50, style.effectScale ?? 1)
      break
    case 'pixelate':
      applyPixelate(context, annotation.rect, style.effectIntensity ?? 50, style.effectScale ?? 1)
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
  // Background removal always runs against source pixels. This prevents a transparency
  // edit from punching holes in arrows, labels, or other annotations created earlier.
  const transparencyAnnotations = annotations.filter(
    (annotation): annotation is Extract<Annotation, { type: 'transparent' }> => annotation.type === 'transparent'
  )
  if (draft?.type === 'transparent') transparencyAnnotations.push(draft)
  const base = transparencyAnnotations.length > 0
    ? transparencyComposite(image, transparencyAnnotations)
    : image
  context.drawImage(base, 0, 0, context.canvas.width, context.canvas.height)
  for (const annotation of annotations) {
    if (annotation.type !== 'transparent') renderAnnotation(context, annotation)
  }
  if (draft && draft.type !== 'transparent') renderAnnotation(context, draft)
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
