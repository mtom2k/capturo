import './styles.css'
import { applySafeArea } from './safe-area'
import {
  clampPoint,
  getResizeHandle,
  MIN_SELECTION_SIZE,
  moveRect,
  normalizeRect,
  pointInRect,
  resizeRect,
  snapToAxis
} from '../shared/geometry'
import {
  annotationBounds,
  clampAnnotationDelta,
  hitTestAnnotation,
  resizeAnnotation,
  translateAnnotation
} from '../shared/annotations'
import type {
  Annotation,
  AnnotationStyle,
  CapturePayload,
  OverlayRole,
  Point,
  Rect,
  ResizeHandle,
  RgbColor,
  Smoothing,
  Tool
} from '../shared/types'
import { exportSelection, renderScene } from './render'

const canvas = document.querySelector<HTMLCanvasElement>('#capture-canvas')!
const context = canvas.getContext('2d')!
const hint = document.querySelector<HTMLElement>('#hint')!
const dimensions = document.querySelector<HTMLElement>('#dimensions')!
const editorUi = document.querySelector<HTMLElement>('#editor-ui')!
const optionsBar = document.querySelector<HTMLElement>('#options-bar')!
const toolbar = document.querySelector<HTMLElement>('#toolbar')!
const colorOptions = document.querySelector<HTMLElement>('#color-options')!
const lineWidthOption = document.querySelector<HTMLElement>('#line-width-option')!
const effectIntensityOption = document.querySelector<HTMLElement>('#effect-intensity-option')!
const smoothingOption = document.querySelector<HTMLElement>('#smoothing-option')!
const stepSizeOption = document.querySelector<HTMLElement>('#step-size-option')!
const textOptions = document.querySelector<HTMLElement>('#text-options')!
const lineWidthSlider = document.querySelector<HTMLInputElement>('#line-width')!
const lineWidthValue = document.querySelector<HTMLElement>('#line-width-value')!
const effectIntensitySlider = document.querySelector<HTMLInputElement>('#effect-intensity')!
const effectIntensityValue = document.querySelector<HTMLElement>('#effect-intensity-value')!
const smoothingSelect = document.querySelector<HTMLSelectElement>('#smoothing')!
const stepSizeSlider = document.querySelector<HTMLInputElement>('#step-size')!
const stepSizeValue = document.querySelector<HTMLElement>('#step-size-value')!
const fontFamilySelect = document.querySelector<HTMLSelectElement>('#font-family')!
const fontSizeSelect = document.querySelector<HTMLSelectElement>('#font-size')!
const boldButton = document.querySelector<HTMLButtonElement>('#font-bold')!
const italicButton = document.querySelector<HTMLButtonElement>('#font-italic')!
const undoButton = document.querySelector<HTMLButtonElement>('#undo')!
const copyButton = document.querySelector<HTMLButtonElement>('#copy')!
const copyTextButton = document.querySelector<HTMLButtonElement>('#copy-text')!
const saveButton = document.querySelector<HTMLButtonElement>('#save')!
const cancelButton = document.querySelector<HTMLButtonElement>('#cancel')!
const textEditor = document.querySelector<HTMLTextAreaElement>('#text-editor')!
const status = document.querySelector<HTMLElement>('#status')!
const pngFlag = document.querySelector<HTMLElement>('#png-flag')!
const transparentPanel = document.querySelector<HTMLElement>('#transparent-panel')!
const transparentClose = document.querySelector<HTMLButtonElement>('#transparent-close')!
const transparentColorInput = document.querySelector<HTMLInputElement>('#transparent-color')!
const transparentHexInput = document.querySelector<HTMLInputElement>('#transparent-hex')!
const transparentRedInput = document.querySelector<HTMLInputElement>('#transparent-r')!
const transparentGreenInput = document.querySelector<HTMLInputElement>('#transparent-g')!
const transparentBlueInput = document.querySelector<HTMLInputElement>('#transparent-b')!
const transparentToleranceSlider = document.querySelector<HTMLInputElement>('#transparent-tolerance')!
const transparentToleranceValue = document.querySelector<HTMLOutputElement>('#transparent-tolerance-value')!
const transparentFeatherSlider = document.querySelector<HTMLInputElement>('#transparent-feather')!
const transparentFeatherValue = document.querySelector<HTMLOutputElement>('#transparent-feather-value')!
const previewBeforeButton = document.querySelector<HTMLButtonElement>('#preview-before')!
const previewSplitButton = document.querySelector<HTMLButtonElement>('#preview-split')!
const previewAfterButton = document.querySelector<HTMLButtonElement>('#preview-after')!
const splitPositionWrap = document.querySelector<HTMLElement>('#split-position-wrap')!
const splitPositionSlider = document.querySelector<HTMLInputElement>('#split-position')!
const splitPositionValue = document.querySelector<HTMLOutputElement>('#split-position-value')!
const transparentCancel = document.querySelector<HTMLButtonElement>('#transparent-cancel')!
const transparentApply = document.querySelector<HTMLButtonElement>('#transparent-apply')!

type Interaction =
  | { mode: 'new-selection'; start: Point }
  | { mode: 'move-selection'; last: Point }
  | { mode: 'resize-selection'; handle: ResizeHandle; original: Rect }
  | { mode: 'move-annotation'; annotationId: string; last: Point }
  | { mode: 'resize-annotation'; annotationId: string; handle: ResizeHandle; original: Annotation; originalBounds: Rect }
  | { mode: 'draw'; start: Point }

let payload: CapturePayload | null = null
let role: OverlayRole = 'editor'
let sourceImage: HTMLCanvasElement | null = null
let selection: Rect | null = null
let annotations: Annotation[] = []
let draft: Annotation | null = null
let interaction: Interaction | null = null
let activeTool: Tool = 'select'
let selectedAnnotationId: string | null = null
let claimed = false
let color = '#ef4444'
let lineWidth = 4
let effectIntensity = 50
let smoothing: Smoothing = 'medium'
let stepSize = 18
let fontFamily = 'system-ui, sans-serif'
let fontSize = 18
let fontWeight: AnnotationStyle['fontWeight'] = 'normal'
let fontStyle: AnnotationStyle['fontStyle'] = 'normal'
let textOrigin: Point | null = null
let textEditingId: string | null = null
let busy = false
let transparencyTarget: RgbColor = { r: 255, g: 255, b: 255 }
let transparencyTolerance = 12
let transparencyFeather = 1
let transparencyPreview: 'before' | 'split' | 'after' = 'split'
let transparencySplit = 50
let beforeCanvas: HTMLCanvasElement | null = null
let splitPreviewPointerId: number | null = null

function id(): string {
  return crypto.randomUUID()
}

// Scale comes from the captured region, not from this window's viewport. A window covers
// only part of its display, so dividing by the viewport would rescale the frozen desktop
// and skew every coordinate by the difference.
function imageScale(): { x: number; y: number } {
  if (!payload) return { x: 1, y: 1 }
  return {
    x: payload.imageWidth / payload.captureSize.width,
    y: payload.imageHeight / payload.captureSize.height
  }
}

function pointFromEvent(event: Pick<PointerEvent, 'clientX' | 'clientY'>): Point {
  const scale = imageScale()
  const origin = payload?.imageOrigin ?? { x: 0, y: 0 }
  return { x: (event.clientX + origin.x) * scale.x, y: (event.clientY + origin.y) * scale.y }
}

function imageBounds(): Rect {
  return { x: 0, y: 0, width: canvas.width, height: canvas.height }
}

function styleSnapshot(): AnnotationStyle {
  const scale = imageScale()
  const pixelScale = (scale.x + scale.y) / 2
  return {
    color,
    lineWidth: lineWidth * pixelScale,
    effectIntensity,
    effectScale: pixelScale,
    fontFamily,
    fontSize: (activeTool === 'step' ? stepSize : fontSize) * scale.y,
    fontWeight,
    fontStyle,
    smoothing
  }
}

function selectedAnnotation(): Annotation | null {
  return annotations.find((annotation) => annotation.id === selectedAnnotationId) ?? null
}

function replaceAnnotation(id: string, replacement: Annotation): void {
  annotations = annotations.map((annotation) => annotation.id === id ? replacement : annotation)
}

function hasTransparency(): boolean {
  return annotations.some((annotation) => annotation.type === 'transparent') || draft?.type === 'transparent'
}

function drawTransparencySeed(): void {
  if (draft?.type !== 'transparent') return
  const radius = Math.max(5, 5 * imageScale().x)
  context.save()
  context.beginPath()
  context.arc(draft.seed.x, draft.seed.y, radius, 0, Math.PI * 2)
  context.fillStyle = 'rgba(15, 23, 42, 0.72)'
  context.fill()
  context.strokeStyle = '#ffffff'
  context.lineWidth = Math.max(1, imageScale().x)
  context.stroke()
  context.beginPath()
  context.arc(draft.seed.x, draft.seed.y, Math.max(1.5, radius * 0.28), 0, Math.PI * 2)
  context.fillStyle = '#38bdf8'
  context.fill()
  context.restore()
}

function drawSplitPreview(): void {
  if (!sourceImage || !selection || draft?.type !== 'transparent') return
  if (!beforeCanvas) beforeCanvas = document.createElement('canvas')
  if (beforeCanvas.width !== canvas.width || beforeCanvas.height !== canvas.height) {
    beforeCanvas.width = canvas.width
    beforeCanvas.height = canvas.height
  }
  const beforeContext = beforeCanvas.getContext('2d')
  if (!beforeContext) return
  renderScene(beforeContext, sourceImage, annotations, null, {
    selection,
    selectedAnnotation: selectedAnnotation(),
    shade: true,
    uiScale: imageScale().x
  })
  const divider = selection.x + selection.width * transparencySplit / 100
  context.save()
  context.beginPath()
  context.rect(selection.x, selection.y, Math.max(0, divider - selection.x), selection.height)
  context.clip()
  context.drawImage(beforeCanvas, 0, 0)
  context.restore()
  context.save()
  context.strokeStyle = '#38bdf8'
  context.lineWidth = Math.max(1, 1.5 * imageScale().x)
  context.beginPath()
  context.moveTo(divider, selection.y)
  context.lineTo(divider, selection.y + selection.height)
  context.stroke()
  context.fillStyle = '#38bdf8'
  context.beginPath()
  context.arc(divider, selection.y + selection.height / 2, Math.max(4, 5 * imageScale().x), 0, Math.PI * 2)
  context.fill()
  context.restore()
}

function annotationAt(point: Point): Annotation | null {
  const tolerance = 7 * imageScale().x
  return [...annotations].reverse().find((annotation) => hitTestAnnotation(annotation, point, tolerance)) ?? null
}

function redraw(): void {
  if (!sourceImage) return
  const pendingTransparency = draft?.type === 'transparent'
  const shownDraft = pendingTransparency && transparencyPreview === 'before' ? null : draft
  canvas.classList.toggle('transparency-preview', hasTransparency() && transparencyPreview !== 'before')
  renderScene(context, sourceImage, annotations, shownDraft, {
    selection,
    selectedAnnotation: selectedAnnotation(),
    shade: true,
    uiScale: imageScale().x
  })
  if (pendingTransparency && transparencyPreview === 'split') drawSplitPreview()
  drawTransparencySeed()
  if (role === 'filler') return
  updateUiPosition()
  undoButton.disabled = annotations.length === 0
  transparentApply.disabled = !pendingTransparency
  pngFlag.hidden = !hasTransparency()
  publishScene()
}

// Fillers cover the strips this window does not, and paint from what the editor sends so
// a selection crossing into them shades and highlights in step.
function publishScene(): void {
  if (!payload) return
  window.capturo.publishScene(payload.sessionId, { annotations, draft, selection })
}

// Source-image pixels back to this window's own CSS coordinates.
function toCssRect(rect: Rect): Rect {
  const scale = imageScale()
  const origin = payload?.imageOrigin ?? { x: 0, y: 0 }
  return {
    x: rect.x / scale.x - origin.x,
    y: rect.y / scale.y - origin.y,
    width: rect.width / scale.x,
    height: rect.height / scale.y
  }
}

function updateUiPosition(): void {
  if (!selection) {
    editorUi.hidden = true
    dimensions.hidden = true
    return
  }

  const rect = toCssRect(selection)
  editorUi.hidden = false
  dimensions.hidden = false
  dimensions.textContent = `${Math.round(selection.width)} × ${Math.round(selection.height)}`

  const dimensionWidth = dimensions.offsetWidth
  dimensions.style.left = `${Math.max(8, Math.min(window.innerWidth - dimensionWidth - 8, rect.x))}px`
  dimensions.style.top = `${rect.y > 34 ? rect.y - 29 : rect.y + 7}px`

  const uiWidth = editorUi.offsetWidth
  const uiHeight = editorUi.offsetHeight
  const left = Math.max(8, Math.min(window.innerWidth - uiWidth - 8, rect.x + rect.width - uiWidth))
  const below = rect.y + rect.height + 8
  const top = below + uiHeight <= window.innerHeight - 8 ? below : Math.max(8, rect.y - uiHeight - 8)
  editorUi.style.left = `${left}px`
  editorUi.style.top = `${top}px`
}

function setStatus(message: string, duration = 1800): void {
  status.textContent = message
  status.classList.add('visible')
  if (duration <= 0) return
  window.setTimeout(() => {
    if (status.textContent === message) status.classList.remove('visible')
  }, duration)
}

function setExportBusy(value: boolean): void {
  busy = value
  copyButton.disabled = value
  copyTextButton.disabled = value
  saveButton.disabled = value
}

function configureOptions(tool: Tool): void {
  const usesColor = !['select', 'blur', 'pixelate', 'transparent'].includes(tool)
  colorOptions.hidden = !usesColor
  lineWidthOption.hidden = tool === 'select' || tool === 'text' || tool === 'step' || tool === 'transparent'
  if (tool === 'blur' || tool === 'pixelate') lineWidthOption.hidden = true
  effectIntensityOption.hidden = tool !== 'blur' && tool !== 'pixelate'
  smoothingOption.hidden = tool !== 'pen'
  stepSizeOption.hidden = tool !== 'step'
  textOptions.hidden = tool !== 'text'
  optionsBar.hidden = tool === 'select' || tool === 'transparent'
}

function setTool(tool: Tool): void {
  if (activeTool === 'transparent' && tool !== 'transparent') {
    draft = null
    transparentPanel.hidden = true
  }
  activeTool = tool
  selectedAnnotationId = null
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
    button.classList.toggle('selected', button.dataset.tool === tool)
  }
  configureOptions(tool)
  if (tool === 'transparent') {
    draft = null
    transparentPanel.hidden = false
    transparencyPreview = 'split'
    updatePreviewButtons()
    setStatus('Click the connected background color to remove')
  }
  updateCursor()
  redraw()
  updateUiPosition()
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(Number.isFinite(value) ? value : 0)))
}

function rgbToHex(value: RgbColor): string {
  return `#${[value.r, value.g, value.b].map((channel) => clampChannel(channel).toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

function parseHex(value: string): RgbColor | null {
  const match = value.trim().match(/^#?([0-9a-f]{6})$/i)
  if (!match) return null
  return {
    r: Number.parseInt(match[1].slice(0, 2), 16),
    g: Number.parseInt(match[1].slice(2, 4), 16),
    b: Number.parseInt(match[1].slice(4, 6), 16)
  }
}

function syncTransparencyColorInputs(): void {
  const hex = rgbToHex(transparencyTarget)
  transparentColorInput.value = hex
  transparentHexInput.value = hex
  transparentRedInput.value = String(transparencyTarget.r)
  transparentGreenInput.value = String(transparencyTarget.g)
  transparentBlueInput.value = String(transparencyTarget.b)
}

function updateTransparencyDraft(update: Partial<Extract<Annotation, { type: 'transparent' }>>): void {
  if (draft?.type !== 'transparent') return
  draft = { ...draft, ...update }
  redraw()
}

function setTransparencyTarget(target: RgbColor): void {
  transparencyTarget = {
    r: clampChannel(target.r),
    g: clampChannel(target.g),
    b: clampChannel(target.b)
  }
  syncTransparencyColorInputs()
  updateTransparencyDraft({ target: transparencyTarget })
}

function updatePreviewButtons(): void {
  previewBeforeButton.classList.toggle('selected', transparencyPreview === 'before')
  previewSplitButton.classList.toggle('selected', transparencyPreview === 'split')
  previewAfterButton.classList.toggle('selected', transparencyPreview === 'after')
  splitPositionWrap.hidden = transparencyPreview !== 'split'
}

function setTransparencyPreview(mode: 'before' | 'split' | 'after'): void {
  transparencyPreview = mode
  updatePreviewButtons()
  redraw()
}

function closeTransparencyPanel(): void {
  setTool('select')
}

function commitTransparencyDraft(): boolean {
  if (draft?.type !== 'transparent') return false
  annotations.push(draft)
  draft = null
  setTool('select')
  return true
}

function applyTransparencyDraft(): void {
  if (!commitTransparencyDraft()) return
  setStatus('Background removed · PNG output enabled')
}

// Pixel-size sliders show the value they are set to rather than snapping
// to a named step. Selecting an existing object can produce a fractional size, which is
// rounded for display only; the object keeps its exact size until the slider is moved.
function setSlider(slider: HTMLInputElement, readout: HTMLElement, value: number): void {
  const clamped = Math.min(Number(slider.max), Math.max(Number(slider.min), Math.round(value)))
  slider.value = String(clamped)
  readout.textContent = `${clamped}px`
}

function closestOption(select: HTMLSelectElement, value: number): void {
  const options = [...select.options]
  const closest = options.reduce((best, option) =>
    Math.abs(Number(option.value) - value) < Math.abs(Number(best.value) - value) ? option : best
  )
  select.value = closest.value
}

function selectAnnotation(annotation: Annotation | null): void {
  selectedAnnotationId = annotation?.id ?? null
  if (!annotation) {
    configureOptions('select')
    redraw()
    return
  }
  const scale = imageScale()
  const pixelScale = (scale.x + scale.y) / 2
  color = annotation.style.color
  lineWidth = annotation.style.lineWidth / pixelScale
  effectIntensity = annotation.style.effectIntensity ?? 50
  smoothing = annotation.style.smoothing
  fontFamily = annotation.style.fontFamily
  fontSize = annotation.style.fontSize / scale.y
  if (annotation.type === 'step') stepSize = annotation.style.fontSize / scale.y
  fontWeight = annotation.style.fontWeight
  fontStyle = annotation.style.fontStyle
  for (const swatch of document.querySelectorAll<HTMLElement>('[data-color]')) {
    swatch.classList.toggle('selected', swatch.dataset.color === color)
  }
  setSlider(lineWidthSlider, lineWidthValue, lineWidth)
  effectIntensitySlider.value = String(Math.max(1, Math.min(100, Math.round(effectIntensity))))
  effectIntensityValue.textContent = `${effectIntensitySlider.value}%`
  smoothingSelect.value = smoothing
  fontFamilySelect.value = fontFamily
  closestOption(fontSizeSelect, fontSize)
  setSlider(stepSizeSlider, stepSizeValue, stepSize)
  boldButton.classList.toggle('selected', fontWeight === 'bold')
  italicButton.classList.toggle('selected', fontStyle === 'italic')
  configureOptions(annotation.type)
  redraw()
}

function updateSelectedStyle(update: Partial<AnnotationStyle>): void {
  const annotation = selectedAnnotation()
  if (!annotation) return
  replaceAnnotation(annotation.id, { ...annotation, style: { ...annotation.style, ...update } })
  redraw()
}

function updateCursor(point?: Point): void {
  if (!selection) {
    canvas.style.cursor = 'crosshair'
    return
  }
  if (activeTool !== 'select') {
    if (activeTool === 'transparent' && point && selection && draft?.type === 'transparent' && transparencyPreview === 'split') {
      const divider = selection.x + selection.width * transparencySplit / 100
      canvas.style.cursor = Math.abs(point.x - divider) <= 10 * imageScale().x ? 'ew-resize' : 'crosshair'
    } else {
      canvas.style.cursor = activeTool === 'text' ? 'text' : 'crosshair'
    }
    return
  }
  if (!point) {
    canvas.style.cursor = 'default'
    return
  }
  const selected = selectedAnnotation()
  if (selected) {
    const objectHandle = getResizeHandle(point, annotationBounds(selected), 8 * imageScale().x)
    if (objectHandle) {
      const cursors: Record<ResizeHandle, string> = {
        'north-west': 'nwse-resize', north: 'ns-resize', 'north-east': 'nesw-resize', east: 'ew-resize',
        'south-east': 'nwse-resize', south: 'ns-resize', 'south-west': 'nesw-resize', west: 'ew-resize'
      }
      canvas.style.cursor = cursors[objectHandle]
      return
    }
  }
  if (annotationAt(point)) {
    canvas.style.cursor = 'move'
    return
  }
  const handle = getResizeHandle(point, selection, 8 * imageScale().x)
  const cursors: Record<ResizeHandle, string> = {
    'north-west': 'nwse-resize',
    north: 'ns-resize',
    'north-east': 'nesw-resize',
    east: 'ew-resize',
    'south-east': 'nwse-resize',
    south: 'ns-resize',
    'south-west': 'nesw-resize',
    west: 'ew-resize'
  }
  canvas.style.cursor = handle ? cursors[handle] : pointInRect(point, selection) ? 'move' : 'crosshair'
}

async function claimSession(): Promise<void> {
  if (claimed || !payload) return
  claimed = true
  const accepted = await window.capturo.claimSession(payload.sessionId)
  if (!accepted) claimed = false
}

function createDraft(tool: Tool, point: Point): Annotation | null {
  const style = styleSnapshot()
  if (tool === 'pen') return { id: id(), type: 'pen', style, points: [point] }
  if (tool === 'line' || tool === 'arrow') return { id: id(), type: tool, style, start: point, end: point }
  if (tool === 'rectangle' || tool === 'ellipse' || tool === 'blur' || tool === 'pixelate') {
    return { id: id(), type: tool, style, rect: { x: point.x, y: point.y, width: 0, height: 0 } }
  }
  return null
}

function sampleTransparency(point: Point): void {
  if (!sourceImage || !selection) return
  const sampleContext = sourceImage.getContext('2d', { willReadFrequently: true })
  if (!sampleContext) return
  const x = Math.max(0, Math.min(sourceImage.width - 1, Math.floor(point.x)))
  const y = Math.max(0, Math.min(sourceImage.height - 1, Math.floor(point.y)))
  const pixel = sampleContext.getImageData(x, y, 1, 1).data
  transparencyTarget = { r: pixel[0], g: pixel[1], b: pixel[2] }
  syncTransparencyColorInputs()
  const scale = imageScale()
  draft = {
    id: id(),
    type: 'transparent',
    style: styleSnapshot(),
    seed: { x, y },
    region: { ...selection },
    target: { ...transparencyTarget },
    tolerance: transparencyTolerance,
    feather: transparencyFeather * ((scale.x + scale.y) / 2)
  }
  redraw()
}

function nextStepNumber(): number {
  return annotations.filter((annotation) => annotation.type === 'step').length + 1
}

function openTextEditor(origin: Point, editing: Extract<Annotation, { type: 'text' }> | null = null): void {
  textOrigin = origin
  textEditingId = editing?.id ?? null
  const css = toCssRect({ x: origin.x, y: origin.y, width: 0, height: 0 })
  textEditor.value = editing?.text ?? ''
  textEditor.style.left = `${css.x}px`
  textEditor.style.top = `${css.y}px`
  textEditor.style.fontFamily = fontFamily
  textEditor.style.fontSize = `${fontSize}px`
  textEditor.style.fontWeight = fontWeight
  textEditor.style.fontStyle = fontStyle
  textEditor.style.color = color
  textEditor.hidden = false
  textEditor.style.width = `${Math.max(140, Math.min(320, window.innerWidth - css.x - 12))}px`
  textEditor.style.height = 'auto'
  textEditor.style.height = `${Math.max(38, textEditor.scrollHeight)}px`
  setStatus('Type text · Ctrl+Enter to apply')
  requestAnimationFrame(() => {
    textEditor.focus()
    if (editing) textEditor.select()
  })
}

function closeTextEditor(commit: boolean): void {
  if (textEditor.hidden) return
  const text = textEditor.value.trimEnd()
  if (commit && text && textOrigin) {
    const replacement: Extract<Annotation, { type: 'text' }> = {
      id: textEditingId ?? id(),
      type: 'text',
      style: styleSnapshot(),
      origin: textOrigin,
      text
    }
    if (textEditingId) replaceAnnotation(textEditingId, replacement)
    else annotations.push(replacement)
  }
  textEditor.hidden = true
  textOrigin = null
  textEditingId = null
  redraw()
}

function pointerDown(event: PointerEvent): void {
  if (role === 'filler') return
  if (!payload || !sourceImage || event.button !== 0 || busy) return
  void claimSession()
  const point = clampPoint(pointFromEvent(event), imageBounds())

  if (!selection) {
    canvas.setPointerCapture(event.pointerId)
    interaction = { mode: 'new-selection', start: point }
    selection = { x: point.x, y: point.y, width: 0, height: 0 }
    hint.hidden = true
    redraw()
    return
  }

  if (activeTool === 'select') {
    const selected = selectedAnnotation()
    const objectHandle = selected
      ? getResizeHandle(point, annotationBounds(selected), 8 * imageScale().x)
      : null
    const hit = annotationAt(point)
    if (selected && objectHandle) {
      canvas.setPointerCapture(event.pointerId)
      interaction = {
        mode: 'resize-annotation',
        annotationId: selected.id,
        handle: objectHandle,
        original: structuredClone(selected),
        originalBounds: annotationBounds(selected)
      }
    } else if (hit) {
      selectAnnotation(hit)
      canvas.setPointerCapture(event.pointerId)
      interaction = { mode: 'move-annotation', annotationId: hit.id, last: point }
    } else {
      const handle = getResizeHandle(point, selection, 8 * imageScale().x)
      selectAnnotation(null)
      if (handle) {
        canvas.setPointerCapture(event.pointerId)
        interaction = { mode: 'resize-selection', handle, original: { ...selection } }
      } else if (pointInRect(point, selection)) {
        canvas.setPointerCapture(event.pointerId)
        interaction = { mode: 'move-selection', last: point }
      } else {
        canvas.setPointerCapture(event.pointerId)
        selection = { x: point.x, y: point.y, width: 0, height: 0 }
        interaction = { mode: 'new-selection', start: point }
      }
    }
    redraw()
    return
  }

  if (!pointInRect(point, selection)) return
  selectedAnnotationId = null
  if (activeTool === 'transparent') {
    if (draft?.type === 'transparent' && transparencyPreview === 'split') {
      const divider = selection.x + selection.width * transparencySplit / 100
      if (Math.abs(point.x - divider) <= 10 * imageScale().x) {
        canvas.setPointerCapture(event.pointerId)
        splitPreviewPointerId = event.pointerId
        canvas.style.cursor = 'ew-resize'
        return
      }
    }
    sampleTransparency(point)
    return
  }
  if (activeTool === 'step') {
    annotations.push({ id: id(), type: 'step', style: styleSnapshot(), center: point, number: nextStepNumber() })
    redraw()
    return
  }
  if (activeTool === 'text') {
    openTextEditor(point)
    return
  }
  draft = createDraft(activeTool, point)
  if (draft) {
    canvas.setPointerCapture(event.pointerId)
    interaction = { mode: 'draw', start: point }
  }
  redraw()
}

function pointerMove(event: PointerEvent): void {
  if (role === 'filler') return
  if (!payload || !sourceImage) return
  const rawPoint = clampPoint(pointFromEvent(event), imageBounds())
  if (splitPreviewPointerId === event.pointerId && selection) {
    transparencySplit = Math.round(Math.max(0, Math.min(100, (rawPoint.x - selection.x) / selection.width * 100)))
    splitPositionSlider.value = String(transparencySplit)
    splitPositionValue.textContent = `${transparencySplit}%`
    redraw()
    return
  }
  if (!interaction) {
    updateCursor(rawPoint)
    return
  }

  if (interaction.mode === 'new-selection') {
    selection = normalizeRect(interaction.start, rawPoint)
  } else if (interaction.mode === 'move-selection' && selection) {
    const requested = { x: rawPoint.x - interaction.last.x, y: rawPoint.y - interaction.last.y }
    const moved = moveRect(selection, requested, imageBounds())
    selection = moved
    interaction.last = rawPoint
  } else if (interaction.mode === 'resize-selection') {
    selection = resizeRect(interaction.original, interaction.handle, rawPoint, imageBounds())
  } else if (interaction.mode === 'move-annotation' && selection) {
    const annotationId = interaction.annotationId
    const annotation = annotations.find((item) => item.id === annotationId)
    if (annotation) {
      const requested = { x: rawPoint.x - interaction.last.x, y: rawPoint.y - interaction.last.y }
      const delta = clampAnnotationDelta(annotation, requested, selection)
      replaceAnnotation(annotation.id, translateAnnotation(annotation, delta))
    }
    interaction.last = rawPoint
  } else if (interaction.mode === 'resize-annotation' && selection) {
    const target = resizeRect(
      interaction.originalBounds,
      interaction.handle,
      rawPoint,
      selection,
      12 * imageScale().x
    )
    replaceAnnotation(
      interaction.annotationId,
      resizeAnnotation(interaction.original, interaction.originalBounds, target)
    )
  } else if (interaction.mode === 'draw' && draft && selection) {
    const point = clampPoint(rawPoint, selection)
    const axisLocked = event.shiftKey || event.ctrlKey
    if (draft.type === 'pen') {
      if (axisLocked) {
        draft = { ...draft, points: [interaction.start, snapToAxis(interaction.start, point, false)] }
      } else {
        const last = draft.points[draft.points.length - 1]
        if (Math.hypot(point.x - last.x, point.y - last.y) >= imageScale().x * 1.2) {
          draft = { ...draft, points: [...draft.points, point] }
        }
      }
    } else if (draft.type === 'line' || draft.type === 'arrow') {
      draft = { ...draft, end: axisLocked ? snapToAxis(interaction.start, point, true) : point }
    } else if (
      draft.type === 'rectangle' ||
      draft.type === 'ellipse' ||
      draft.type === 'blur' ||
      draft.type === 'pixelate'
    ) {
      draft = { ...draft, rect: normalizeRect(interaction.start, point) }
    }
  }
  redraw()
}

function pointerUp(event: PointerEvent): void {
  if (splitPreviewPointerId === event.pointerId) {
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    splitPreviewPointerId = null
    updateCursor(pointFromEvent(event))
    return
  }
  if (role === 'filler' || !interaction) return
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)

  if (interaction.mode === 'new-selection') {
    if (!selection || selection.width < MIN_SELECTION_SIZE || selection.height < MIN_SELECTION_SIZE) {
      selection = null
      hint.hidden = false
    }
  } else if (interaction.mode === 'draw' && draft) {
    const valid =
      (draft.type === 'pen' && draft.points.length >= 2) ||
      ((draft.type === 'line' || draft.type === 'arrow') && Math.hypot(draft.end.x - draft.start.x, draft.end.y - draft.start.y) > 2) ||
      ((draft.type === 'rectangle' || draft.type === 'ellipse' || draft.type === 'blur' || draft.type === 'pixelate') &&
        draft.rect.width > 2 && draft.rect.height > 2)
    if (valid) annotations.push(draft)
  }

  draft = null
  interaction = null
  if (selectedAnnotationId) selectAnnotation(selectedAnnotation())
  redraw()
}

function exportedImage(): string | null {
  if (!sourceImage || !selection) return null
  return exportSelection(sourceImage, selection, annotations)
}

async function copyImage(): Promise<void> {
  if (busy || !payload) return
  commitTransparencyDraft()
  const dataUrl = exportedImage()
  if (!dataUrl) return
  setExportBusy(true)
  const copied = await window.capturo.copyImage(payload.sessionId, dataUrl)
  if (!copied) {
    setExportBusy(false)
    setStatus('Could not copy screenshot')
  }
}

async function copyText(): Promise<void> {
  if (busy || !payload) return
  commitTransparencyDraft()
  const dataUrl = exportedImage()
  if (!dataUrl) return
  setExportBusy(true)
  setStatus('Extracting text with Windows OCR…', 0)
  try {
    const result = await window.capturo.copyText(payload.sessionId, dataUrl)
    if (!result.copied) {
      setExportBusy(false)
      setStatus(result.error, result.empty ? 2600 : 3400)
    }
  } catch {
    setExportBusy(false)
    setStatus('Capturo could not extract text from this selection.', 3400)
  }
}

async function saveImage(): Promise<void> {
  if (busy || !payload) return
  commitTransparencyDraft()
  const dataUrl = exportedImage()
  if (!dataUrl) return
  setExportBusy(true)
  const result = await window.capturo.saveImage(payload.sessionId, dataUrl, hasTransparency())
  if (!result.saved) {
    setExportBusy(false)
    if (!result.canceled) setStatus('Could not save screenshot')
  }
}

async function cancelCapture(): Promise<void> {
  if (!payload) return
  await window.capturo.cancelSession(payload.sessionId)
}

function handleShortcut(event: KeyboardEvent): void {
  if (!payload) return
  // A filler can hold focus if the user clicks the strip it covers, so Escape has to keep
  // working there; it owns nothing else.
  if (role === 'filler') {
    if (event.key === 'Escape') {
      event.preventDefault()
      void cancelCapture()
    }
    return
  }
  if (!textEditor.hidden) return
  if (event.target instanceof Element && event.target.closest('#transparent-panel') && event.key !== 'Escape') {
    return
  }
  const command = event.ctrlKey || event.metaKey
  if (event.key === 'Escape') {
    event.preventDefault()
    if (!transparentPanel.hidden) closeTransparencyPanel()
    else if (selectedAnnotationId) selectAnnotation(null)
    else void cancelCapture()
    return
  }
  if ((event.key === 'Delete' || event.key === 'Backspace') && selectedAnnotationId) {
    event.preventDefault()
    annotations = annotations.filter((annotation) => annotation.id !== selectedAnnotationId)
    selectAnnotation(null)
    return
  }
  if (command && event.shiftKey && event.key.toLowerCase() === 'c') {
    event.preventDefault()
    void copyText()
    return
  }
  if (command && event.key.toLowerCase() === 'c') {
    event.preventDefault()
    void copyImage()
    return
  }
  if (command && event.key.toLowerCase() === 's') {
    event.preventDefault()
    void saveImage()
    return
  }
  if (command && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    annotations.pop()
    if (selectedAnnotationId && !annotations.some((annotation) => annotation.id === selectedAnnotationId)) {
      selectedAnnotationId = null
      configureOptions('select')
    }
    redraw()
    return
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return
  const shortcuts: Record<string, Tool> = {
    v: 'select',
    p: 'pen',
    l: 'line',
    a: 'arrow',
    r: 'rectangle',
    e: 'ellipse',
    n: 'step',
    t: 'text',
    b: 'blur',
    x: 'pixelate',
    k: 'transparent'
  }
  const tool = shortcuts[event.key.toLowerCase()]
  if (tool && selection) setTool(tool)
}

// Decodes the frozen desktop main captured. A blob URL avoids the base64 round trip a data
// URL would cost on a 4K frame.
async function decodeFrozenDesktop(source: CapturePayload): Promise<HTMLCanvasElement> {
  const bytes = new Uint8Array(source.imageBytes)
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'image/png' })
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.addEventListener('load', () => resolve())
      image.addEventListener('error', () => reject(new Error('Frozen desktop could not be decoded')))
      image.src = url
    })
    const frame = document.createElement('canvas')
    frame.width = image.naturalWidth
    frame.height = image.naturalHeight
    const frameContext = frame.getContext('2d')
    if (!frameContext) throw new Error('Canvas rendering is unavailable')
    frameContext.drawImage(image, 0, 0)
    return frame
  } finally {
    URL.revokeObjectURL(url)
  }
}

function initialize(nextPayload: CapturePayload): void {
  payload = nextPayload
  role = nextPayload.role
  canvas.width = nextPayload.imageWidth
  canvas.height = nextPayload.imageHeight

  // Lay the whole frozen desktop over the display and let the window clip it, so every
  // overlay shares one coordinate space no matter which slice it covers.
  canvas.style.left = `${-nextPayload.imageOrigin.x}px`
  canvas.style.top = `${-nextPayload.imageOrigin.y}px`
  canvas.style.width = `${nextPayload.captureSize.width}px`
  canvas.style.height = `${nextPayload.captureSize.height}px`

  applySafeArea(nextPayload.safeArea)

  if (role === 'filler') {
    hint.hidden = true
    editorUi.hidden = true
    canvas.style.cursor = 'default'
  }

  void (async () => {
    try {
      const frame = await decodeFrozenDesktop(nextPayload)
      // Trust the frame's real size over the requested size.
      nextPayload.imageWidth = frame.width
      nextPayload.imageHeight = frame.height
      canvas.width = frame.width
      canvas.height = frame.height
      sourceImage = frame
    } catch (error) {
      console.error('Capturo could not read the display', error)
      void window.capturo.captureFailed(nextPayload.sessionId)
      return
    }

    if (role === 'filler') canvas.style.cursor = 'default'
    else updateCursor()
    redraw()
    requestAnimationFrame(() => {
      requestAnimationFrame(() => void window.capturo.captureReady(nextPayload.sessionId))
    })
  })()
}

canvas.addEventListener('pointerdown', pointerDown)
canvas.addEventListener('pointermove', pointerMove)
canvas.addEventListener('pointerup', pointerUp)
canvas.addEventListener('pointercancel', pointerUp)
canvas.addEventListener('dblclick', (event) => {
  if (role === 'filler') return
  if (activeTool !== 'select' || !selection) return
  const annotation = annotationAt(pointFromEvent(event))
  if (annotation?.type !== 'text') return
  selectAnnotation(annotation)
  openTextEditor(annotation.origin, annotation)
})
window.addEventListener('keydown', handleShortcut)
window.addEventListener('resize', redraw)

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
  button.addEventListener('click', () => setTool(button.dataset.tool as Tool))
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-color]')) {
  button.addEventListener('click', () => {
    color = button.dataset.color ?? color
    for (const swatch of document.querySelectorAll('[data-color]')) swatch.classList.toggle('selected', swatch === button)
    updateSelectedStyle({ color })
  })
}

// Sliders update while being dragged so size or effect intensity can be judged live.
lineWidthSlider.addEventListener('input', () => {
  lineWidth = Number(lineWidthSlider.value)
  lineWidthValue.textContent = `${lineWidth}px`
  const scale = imageScale()
  updateSelectedStyle({ lineWidth: lineWidth * ((scale.x + scale.y) / 2) })
})
effectIntensitySlider.addEventListener('input', () => {
  effectIntensity = Number(effectIntensitySlider.value)
  effectIntensityValue.textContent = `${effectIntensity}%`
  updateSelectedStyle({ effectIntensity })
})
smoothingSelect.addEventListener('change', () => {
  smoothing = smoothingSelect.value as Smoothing
  updateSelectedStyle({ smoothing })
})
stepSizeSlider.addEventListener('input', () => {
  stepSize = Number(stepSizeSlider.value)
  stepSizeValue.textContent = `${stepSize}px`
  updateSelectedStyle({ fontSize: stepSize * imageScale().y })
})
fontFamilySelect.addEventListener('change', () => {
  fontFamily = fontFamilySelect.value
  updateSelectedStyle({ fontFamily })
})
fontSizeSelect.addEventListener('change', () => {
  fontSize = Number(fontSizeSelect.value)
  updateSelectedStyle({ fontSize: fontSize * imageScale().y })
})
boldButton.addEventListener('click', () => {
  fontWeight = fontWeight === 'normal' ? 'bold' : 'normal'
  boldButton.classList.toggle('selected', fontWeight === 'bold')
  updateSelectedStyle({ fontWeight })
})
italicButton.addEventListener('click', () => {
  fontStyle = fontStyle === 'normal' ? 'italic' : 'normal'
  italicButton.classList.toggle('selected', fontStyle === 'italic')
  updateSelectedStyle({ fontStyle })
})
undoButton.addEventListener('click', () => {
  annotations.pop()
  if (selectedAnnotationId && !annotations.some((annotation) => annotation.id === selectedAnnotationId)) selectAnnotation(null)
  else redraw()
})
copyButton.addEventListener('click', () => void copyImage())
copyTextButton.addEventListener('click', () => void copyText())
saveButton.addEventListener('click', () => void saveImage())
cancelButton.addEventListener('click', () => void cancelCapture())

transparentClose.addEventListener('click', closeTransparencyPanel)
transparentCancel.addEventListener('click', closeTransparencyPanel)
transparentApply.addEventListener('click', applyTransparencyDraft)
transparentColorInput.addEventListener('input', () => {
  const parsed = parseHex(transparentColorInput.value)
  if (parsed) setTransparencyTarget(parsed)
})
transparentHexInput.addEventListener('input', () => {
  const parsed = parseHex(transparentHexInput.value)
  if (parsed) setTransparencyTarget(parsed)
})
for (const input of [transparentRedInput, transparentGreenInput, transparentBlueInput]) {
  input.addEventListener('input', () => {
    setTransparencyTarget({
      r: Number(transparentRedInput.value),
      g: Number(transparentGreenInput.value),
      b: Number(transparentBlueInput.value)
    })
  })
}
transparentToleranceSlider.addEventListener('input', () => {
  transparencyTolerance = Number(transparentToleranceSlider.value)
  transparentToleranceValue.textContent = `${transparencyTolerance}%`
  updateTransparencyDraft({ tolerance: transparencyTolerance })
})
transparentFeatherSlider.addEventListener('input', () => {
  transparencyFeather = Number(transparentFeatherSlider.value)
  transparentFeatherValue.textContent = `${transparencyFeather}px`
  const scale = imageScale()
  updateTransparencyDraft({ feather: transparencyFeather * ((scale.x + scale.y) / 2) })
})
previewBeforeButton.addEventListener('click', () => setTransparencyPreview('before'))
previewSplitButton.addEventListener('click', () => setTransparencyPreview('split'))
previewAfterButton.addEventListener('click', () => setTransparencyPreview('after'))
splitPositionSlider.addEventListener('input', () => {
  transparencySplit = Number(splitPositionSlider.value)
  splitPositionValue.textContent = `${transparencySplit}%`
  redraw()
})

for (const element of [toolbar, optionsBar, dimensions, transparentPanel]) {
  element.addEventListener('pointerdown', (event) => event.stopPropagation())
}

textEditor.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeTextEditor(false)
  } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    closeTextEditor(true)
  }
})
textEditor.addEventListener('input', () => {
  textEditor.style.height = 'auto'
  textEditor.style.height = `${Math.max(38, textEditor.scrollHeight)}px`
})
textEditor.addEventListener('pointerdown', (event) => event.stopPropagation())
textEditor.addEventListener('blur', () => closeTextEditor(true))

window.capturo.onInitialize(initialize)
window.capturo.onSessionClosed(() => window.close())
window.capturo.onScene((scene) => {
  if (role !== 'filler') return
  annotations = scene.annotations
  draft = scene.draft
  selection = scene.selection
  redraw()
})
