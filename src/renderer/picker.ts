import './styles.css'
import './picker.css'
import { applySafeArea } from './safe-area'
import { rgbToHex } from '../shared/color'
import type { Rgb } from '../shared/color'
import {
  advancePointer,
  initialPointerState,
  magnifierPlacement,
  magnifierRegion,
  nudgePointer,
  pixelAt
} from '../shared/picker'
import type { PointerState } from '../shared/picker'
import type { CapturePayload, OverlayRole } from '../shared/types'

// The colour picker overlay. It reuses the same frozen desktop as the screenshot and GIF paths
// (D-014), so the colours it reports are the tone-mapped pixels Capturo would capture rather
// than whatever a live read-back would return. The desktop is frozen at invocation, which is
// also why a colour cannot be picked out of a running animation.
//
// The system cursor is hidden and a magnifier is drawn in its place. Sampling therefore follows
// a point this renderer owns, not the OS cursor, which is what makes Shift able to slow it down.
// See D-032 and src/shared/picker.ts for the pointer model.

const canvas = document.querySelector<HTMLCanvasElement>('#capture-canvas')!
const context = canvas.getContext('2d')!
const hint = document.querySelector<HTMLElement>('#hint')!
const magnifier = document.querySelector<HTMLElement>('#magnifier')!
const magnifierCanvas = document.querySelector<HTMLCanvasElement>('#magnifier-canvas')!
const magnifierContext = magnifierCanvas.getContext('2d')!
const magnifierHex = document.querySelector<HTMLElement>('#magnifier-hex')!
const magnifierFine = document.querySelector<HTMLElement>('#magnifier-fine')!
const status = document.querySelector<HTMLElement>('#status')!

// Odd so there is a true centre cell for the crosshair to sit on.
const MAGNIFIER_CELLS = 17
const MAGNIFIER_SIZE = 200

let payload: CapturePayload | null = null
let role: OverlayRole = 'editor'
let sourceImage: HTMLCanvasElement | null = null
let sourcePixels: ImageData | null = null
let pointer: PointerState = initialPointerState({ x: 0, y: 0 })
let fine = false
let picked = false
let hasPointer = false

function imageScale(): { x: number; y: number } {
  if (!payload) return { x: 1, y: 1 }
  return {
    x: payload.imageWidth / payload.captureSize.width,
    y: payload.imageHeight / payload.captureSize.height
  }
}

/** Client coordinates to source-image pixels, matching the other overlays. */
function pointFromClient(clientX: number, clientY: number): { x: number; y: number } {
  const scale = imageScale()
  const origin = payload?.imageOrigin ?? { x: 0, y: 0 }
  return { x: (clientX + origin.x) * scale.x, y: (clientY + origin.y) * scale.y }
}

/** Source-image pixels back to this window's client coordinates. */
function clientFromPoint(point: { x: number; y: number }): { x: number; y: number } {
  const scale = imageScale()
  const origin = payload?.imageOrigin ?? { x: 0, y: 0 }
  return { x: point.x / scale.x - origin.x, y: point.y / scale.y - origin.y }
}

function imageBounds(): { width: number; height: number } {
  return { width: canvas.width, height: canvas.height }
}

function colorAt(point: { x: number; y: number }): Rgb | null {
  if (!sourcePixels) return null
  return pixelAt(sourcePixels.data, sourcePixels.width, sourcePixels.height, point.x, point.y)
}

function setStatus(message: string): void {
  status.textContent = message
  status.classList.add('visible')
}

function drawMagnifier(): void {
  if (!sourcePixels) return
  const region = magnifierRegion(pointer.point, MAGNIFIER_CELLS)
  const cell = MAGNIFIER_SIZE / region.size

  magnifierContext.clearRect(0, 0, MAGNIFIER_SIZE, MAGNIFIER_SIZE)
  // Anything off the edge of the desktop stays this flat backing colour, which is how a pixel in
  // the very corner of the screen still sits under the crosshair instead of being pushed inwards.
  magnifierContext.fillStyle = '#050910'
  magnifierContext.fillRect(0, 0, MAGNIFIER_SIZE, MAGNIFIER_SIZE)

  for (let row = 0; row < region.size; row++) {
    for (let column = 0; column < region.size; column++) {
      const color = colorAt({ x: region.x + column, y: region.y + row })
      if (!color) continue
      magnifierContext.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`
      // Cells are drawn a hair large so no seam of backing colour shows between them.
      magnifierContext.fillRect(column * cell, row * cell, cell + 1, cell + 1)
    }
  }

  // A grid at this zoom makes it obvious that whole pixels are being selected, not a smooth image.
  magnifierContext.strokeStyle = 'rgba(0, 0, 0, 0.16)'
  magnifierContext.lineWidth = 1
  for (let index = 1; index < region.size; index++) {
    const offset = Math.round(index * cell) + 0.5
    magnifierContext.beginPath()
    magnifierContext.moveTo(offset, 0)
    magnifierContext.lineTo(offset, MAGNIFIER_SIZE)
    magnifierContext.moveTo(0, offset)
    magnifierContext.lineTo(MAGNIFIER_SIZE, offset)
    magnifierContext.stroke()
  }

  // The centre cell is outlined in black and white together so it stays visible whatever colour
  // it sits on; a single-colour crosshair disappears against its own match.
  const half = Math.floor(region.size / 2)
  const cx = Math.round(half * cell)
  const cy = Math.round(half * cell)
  const size = Math.round(cell)
  magnifierContext.lineWidth = 3
  magnifierContext.strokeStyle = 'rgba(0, 0, 0, 0.85)'
  magnifierContext.strokeRect(cx - 1.5, cy - 1.5, size + 3, size + 3)
  magnifierContext.lineWidth = 1.5
  magnifierContext.strokeStyle = '#ffffff'
  magnifierContext.strokeRect(cx - 0.75, cy - 0.75, size + 1.5, size + 1.5)
}

function updateMagnifier(): void {
  if (role === 'filler' || !sourcePixels) return
  const color = colorAt(pointer.point)
  const hex = color ? rgbToHex(color) : '#000000'

  magnifier.hidden = !hasPointer
  magnifierFine.hidden = !fine
  magnifierHex.textContent = hex

  // Centred on the sampled pixel, so the magnifier stands in for the cursor rather than trailing
  // beside it. Its middle cell is the pixel the hex describes.
  const client = clientFromPoint(pointer.point)
  const placement = magnifierPlacement(client, MAGNIFIER_SIZE)
  magnifier.style.left = `${placement.x}px`
  magnifier.style.top = `${placement.y}px`

  drawMagnifier()
}

function movePointer(
  clientX: number,
  clientY: number,
  deltaX: number,
  deltaY: number,
  shiftKey: boolean
): void {
  // Shift is read off the pointer event rather than from a window key listener. Keyboard events
  // only reach the focused window, and with one overlay per display only one of them is focused,
  // so a key listener made fine movement work on a single monitor and silently do nothing on the
  // others. Pointer events carry the modifier state and arrive at whichever overlay the pointer
  // is actually over.
  fine = shiftKey
  const cursor = pointFromClient(clientX, clientY)
  const scale = imageScale()
  // Movement deltas arrive in CSS pixels and have to be scaled the same way positions are, or
  // fine mode would behave differently on a scaled display than on an unscaled one.
  pointer = advancePointer(
    pointer,
    cursor,
    { x: deltaX * scale.x, y: deltaY * scale.y },
    fine,
    imageBounds()
  )
  hasPointer = true
  updateMagnifier()
}

function pick(): void {
  if (picked || role === 'filler' || !payload) return
  const color = colorAt(pointer.point)
  if (!color) return
  picked = true
  setStatus(`Copied ${rgbToHex(color)}`)
  void window.capturoColor.pick(payload.sessionId, color)
}

function cancel(): void {
  if (!payload) return
  void window.capturo.cancelSession(payload.sessionId)
}

function handleKey(event: KeyboardEvent): void {
  if (!payload) return
  if (role === 'filler') {
    if (event.key === 'Escape') {
      event.preventDefault()
      cancel()
    }
    return
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    cancel()
    return
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    pick()
    return
  }
  // Arrow keys are the guaranteed-exact route to a specific pixel, for when even fine mouse
  // movement is more trouble than it is worth.
  const nudges: Record<string, { x: number; y: number }> = {
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 }
  }
  const nudge = nudges[event.key]
  if (nudge) {
    event.preventDefault()
    pointer = nudgePointer(pointer, nudge, imageBounds())
    hasPointer = true
    updateMagnifier()
  }
}

function setFine(next: boolean): void {
  if (fine === next) return
  fine = next
  updateMagnifier()
}

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

  applySafeArea(nextPayload.safeArea)

  if (role === 'filler') {
    hint.hidden = true
    magnifier.hidden = true
  }

  void (async () => {
    try {
      const frame = await decodeFrozenDesktop(nextPayload)
      nextPayload.imageWidth = frame.width
      nextPayload.imageHeight = frame.height
      canvas.width = frame.width
      canvas.height = frame.height
      sourceImage = frame

      const frameContext = frame.getContext('2d')
      // Read the pixels once. Sampling per movement through getImageData would be a full
      // read-back of the frozen desktop on every mouse event.
      sourcePixels = frameContext ? frameContext.getImageData(0, 0, frame.width, frame.height) : null

      context.drawImage(frame, 0, 0)

      // Start on the pixel the pointer is already over. Seeding the middle of the screen instead
      // put the magnifier somewhere the user was not pointing until they happened to move, which
      // read as the picker having lost track of the cursor entirely. `cursor` is null on the
      // displays the pointer is not on, and those overlays show no magnifier at all.
      const scale = imageScale()
      const seed = nextPayload.cursor
      hasPointer = seed !== null
      pointer = initialPointerState(
        seed
          ? { x: seed.x * scale.x, y: seed.y * scale.y }
          : { x: Math.floor(frame.width / 2), y: Math.floor(frame.height / 2) }
      )
      updateMagnifier()
    } catch {
      void window.capturo.captureFailed(nextPayload.sessionId)
      return
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => void window.capturo.captureReady(nextPayload.sessionId))
    })
  })()
}

canvas.addEventListener('pointermove', (event) => {
  if (role === 'filler') return
  movePointer(event.clientX, event.clientY, event.movementX, event.movementY, event.shiftKey)
})
canvas.addEventListener('pointerenter', (event) => {
  if (role === 'filler') return
  // Entering from another display re-seeds from the real pointer, so any displacement carried
  // over from fine movement on the display just left cannot follow the pointer across.
  pointer = initialPointerState(pointFromClient(event.clientX, event.clientY))
  movePointer(event.clientX, event.clientY, 0, 0, event.shiftKey)
})
canvas.addEventListener('pointerleave', () => {
  if (role === 'filler') return
  hasPointer = false
  magnifier.hidden = true
})
canvas.addEventListener('pointerdown', (event) => {
  if (role === 'filler' || event.button !== 0) return
  event.preventDefault()
  // Pick from where the magnifier is, not from the click position: after fine movement those
  // are deliberately different, and the magnifier is the thing the user was aiming.
  pick()
})
// These only keep the Fine badge honest while the pointer is still, on whichever overlay holds
// focus. Fine movement itself does not depend on them: see movePointer.
window.addEventListener('keydown', (event) => {
  setFine(event.shiftKey)
  handleKey(event)
})
window.addEventListener('keyup', (event) => setFine(event.shiftKey))
window.addEventListener('blur', () => setFine(false))

window.capturo.onInitialize(initialize)
window.capturo.onSessionClosed(() => window.close())
