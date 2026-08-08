import './styles.css'
import './gif.css'
import {
  clampPoint,
  getResizeHandle,
  MIN_SELECTION_SIZE,
  moveRect,
  normalizeRect,
  pointInRect,
  resizeRect
} from '../shared/geometry'
import type { CapturePayload, OverlayRole, Point, Rect, ResizeHandle } from '../shared/types'
import { renderScene } from './render'

// The GIF overlay is the screenshot overlay minus annotations: it freezes the desktop, lets
// the user pick a region, and hands that region to the recorder. Selection maths, the frozen
// desktop decode, the paint-gated reveal, and the editor/filler split are all shared with the
// screenshot path (see editor.ts); only the toolbar and the post-selection action differ.

const canvas = document.querySelector<HTMLCanvasElement>('#capture-canvas')!
const context = canvas.getContext('2d')!
const hint = document.querySelector<HTMLElement>('#hint')!
const dimensions = document.querySelector<HTMLElement>('#dimensions')!
const editorUi = document.querySelector<HTMLElement>('#editor-ui')!
const recordButton = document.querySelector<HTMLButtonElement>('#record')!
const cancelButton = document.querySelector<HTMLButtonElement>('#cancel')!
const status = document.querySelector<HTMLElement>('#status')!

type Interaction =
  | { mode: 'new-selection'; start: Point }
  | { mode: 'move-selection'; last: Point }
  | { mode: 'resize-selection'; handle: ResizeHandle; original: Rect }

let payload: CapturePayload | null = null
let role: OverlayRole = 'editor'
let sourceImage: HTMLCanvasElement | null = null
let selection: Rect | null = null
let interaction: Interaction | null = null
let claimed = false
let busy = false

// Scale comes from the captured region, not this window's viewport, since each overlay holds
// the whole frozen desktop and shows one slice of it. See D-013.
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

function redraw(): void {
  if (!sourceImage) return
  renderScene(context, sourceImage, [], null, { selection, shade: true, uiScale: imageScale().x })
  if (role === 'filler') return
  updateUiPosition()
  recordButton.disabled = !selection
  publishScene()
}

// Fillers cover the strips the editor does not and paint from what the editor publishes, so a
// selection crossing into them shades in step.
function publishScene(): void {
  if (!payload) return
  window.capturo.publishScene(payload.sessionId, { annotations: [], draft: null, selection })
}

function setStatus(message: string): void {
  status.textContent = message
  status.classList.add('visible')
  window.setTimeout(() => {
    if (status.textContent === message) status.classList.remove('visible')
  }, 1800)
}

function updateCursor(point?: Point): void {
  if (!selection) {
    canvas.style.cursor = 'crosshair'
    return
  }
  if (!point) {
    canvas.style.cursor = 'default'
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

  const handle = getResizeHandle(point, selection, 8 * imageScale().x)
  canvas.setPointerCapture(event.pointerId)
  if (handle) {
    interaction = { mode: 'resize-selection', handle, original: { ...selection } }
  } else if (pointInRect(point, selection)) {
    interaction = { mode: 'move-selection', last: point }
  } else {
    selection = { x: point.x, y: point.y, width: 0, height: 0 }
    interaction = { mode: 'new-selection', start: point }
  }
  redraw()
}

function pointerMove(event: PointerEvent): void {
  if (role === 'filler') return
  if (!payload || !sourceImage) return
  const rawPoint = clampPoint(pointFromEvent(event), imageBounds())
  if (!interaction) {
    updateCursor(rawPoint)
    return
  }
  if (interaction.mode === 'new-selection') {
    selection = normalizeRect(interaction.start, rawPoint)
  } else if (interaction.mode === 'move-selection' && selection) {
    const requested = { x: rawPoint.x - interaction.last.x, y: rawPoint.y - interaction.last.y }
    selection = moveRect(selection, requested, imageBounds())
    interaction.last = rawPoint
  } else if (interaction.mode === 'resize-selection') {
    selection = resizeRect(interaction.original, interaction.handle, rawPoint, imageBounds())
  }
  redraw()
}

function pointerUp(event: PointerEvent): void {
  if (role === 'filler' || !interaction) return
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
  if (interaction.mode === 'new-selection') {
    if (!selection || selection.width < MIN_SELECTION_SIZE || selection.height < MIN_SELECTION_SIZE) {
      selection = null
      hint.hidden = false
    }
  }
  interaction = null
  redraw()
}

async function cancelCapture(): Promise<void> {
  if (!payload) return
  await window.capturo.cancelSession(payload.sessionId)
}

async function startRecording(): Promise<void> {
  if (busy || !payload || !selection) return
  busy = true
  const accepted = await window.capturoGif.startRecording(payload.sessionId, selection)
  if (accepted) setStatus('Region set — recording is wired up next')
  else {
    busy = false
    setStatus('Could not start recording')
  }
}

function handleShortcut(event: KeyboardEvent): void {
  if (!payload) return
  if (event.key === 'Escape') {
    event.preventDefault()
    void cancelCapture()
  }
}

// Decodes the frozen desktop main captured. A blob URL avoids the base64 round trip a data URL
// would cost on a 4K frame.
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
  canvas.style.left = `${-nextPayload.imageOrigin.x}px`
  canvas.style.top = `${-nextPayload.imageOrigin.y}px`
  canvas.style.width = `${nextPayload.captureSize.width}px`
  canvas.style.height = `${nextPayload.captureSize.height}px`

  if (role === 'filler') {
    hint.hidden = true
    editorUi.hidden = true
    canvas.style.cursor = 'default'
  }

  void (async () => {
    try {
      const frame = await decodeFrozenDesktop(nextPayload)
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
window.addEventListener('keydown', handleShortcut)
window.addEventListener('resize', redraw)

recordButton.addEventListener('click', () => void startRecording())
cancelButton.addEventListener('click', () => void cancelCapture())
for (const element of [editorUi, dimensions]) {
  element.addEventListener('pointerdown', (event) => event.stopPropagation())
}

window.capturo.onInitialize(initialize)
window.capturo.onSessionClosed(() => window.close())
window.capturo.onScene((scene) => {
  if (role !== 'filler') return
  selection = scene.selection
  redraw()
})
