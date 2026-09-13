import './styles.css'
import './picker.css'
import { applySafeArea } from './safe-area'
import { rgbToHex } from '../shared/color'
import type { ColorPickerPayload, ColorSample, Rgb } from '../shared/color'
import {
  DEFAULT_PICKER_ZOOM_INDEX,
  FLOATING_PICKER_MAX_SIZE,
  PICKER_ZOOM_LEVELS,
  advancePointerAtFactor,
  constrainPointerOffset,
  floatingPickerOffsetLimits,
  floatingPickerRegionOrigin,
  initialPointerState,
  magnifierPlacement,
  nudgePointer,
  parseRgbHexGrid,
  pickerSampleDelay,
  pointDelta,
  stepPickerZoomIndex
} from '../shared/picker'
import type { PointerState } from '../shared/picker'

// This overlay never paints a screenshot. It is a transparent pointer surface whose magnifier
// is fed a tiny live sample by main. The sample uses the same HDR conversion as Capturo's native
// screenshot path, while content protection keeps this window out of the captured pixels.
const canvas = document.querySelector<HTMLCanvasElement>('#capture-canvas')!
const canvasContext = canvas.getContext('2d')!
// Keep sampled pixels in an offscreen bitmap. The visible picker is rendered onto the hit canvas
// in one atomic frame, so Chromium never has a separately moving transparent layer to retain.
const aperture = document.createElement('canvas')
const apertureContext = aperture.getContext('2d')!
// Upload each returned grid as one tiny bitmap, then scale it into the device-pixel-backed
// aperture. Repainting hundreds of individual cells for every live sample can monopolize the
// renderer precisely while it is also trying to process high-rate pointer input.
const samplePixels = document.createElement('canvas')
const samplePixelsContext = samplePixels.getContext('2d')!
const status = document.querySelector<HTMLElement>('#status')!

const MAGNIFIER_SIZE = 200
const RECENTER_MARGIN = 160
const SELECTOR_RECENTER_GUARD = 48
const SELECTOR_SIDE_PADDING = MAGNIFIER_SIZE / 2 + 16
const SELECTOR_TOP_PADDING = MAGNIFIER_SIZE / 2 + 16
// The color caption sits below the 200px aperture. Reserve its rendered height plus
// the same 16px breathing room; using only half the aperture would keep the lens visible but still
// clip the readout along the compact surface's bottom edge.
const SELECTOR_BOTTOM_PADDING = MAGNIFIER_SIZE / 2 + 64
type SampledGrid = {
  displayId: string
  point: { x: number; y: number }
  cells: number
  data: Uint8ClampedArray
  color: Rgb
}
type DesiredSample = { point: { x: number; y: number }; cells: number }

let payload: ColorPickerPayload | null = null
let pointer: PointerState = initialPointerState({ x: 0, y: 0 })
let sampled: SampledGrid | null = null
let renderedSample: SampledGrid | null = null
let desiredSample: DesiredSample | null = null
let sampling = false
let sampleTimer: number | null = null
let lastSampleStartedAt = Number.NEGATIVE_INFINITY
let zoomIndex = DEFAULT_PICKER_ZOOM_INDEX
let picked = false
let hasPointer = false
let renderPending = false
let recentering = false
let pendingRecenter: {
  cursor: { x: number; y: number }
  center: { x: number; y: number }
  regionOrigin: { x: number; y: number }
} | null = null
let observedCursor = { x: 0, y: 0 }
let lastDomMovementAt = Number.NEGATIVE_INFINITY
// `window.screenX/Y` can lag a native BrowserWindow move by a compositor frame. Keep an explicit
// origin that is advanced from the same recenter geometry as main before the move is requested.
let floatingRegionOrigin = { x: 0, y: 0 }
let renderScale = 1
let cursorPollTimer: number | null = null
let cursorPollInFlight = false

function imageScale(): { x: number; y: number } {
  if (!payload) return { x: 1, y: 1 }
  return {
    x: payload.imageSize.width / payload.displaySize.width,
    y: payload.imageSize.height / payload.displaySize.height
  }
}

function currentRegionOrigin(): { x: number; y: number } {
  if (!payload) return { x: 0, y: 0 }
  if (!payload.floating) return payload.regionOrigin
  return floatingRegionOrigin
}

function displayBounds(): { x: number; y: number; width: number; height: number } {
  if (!payload) return { x: 0, y: 0, width: 1, height: 1 }
  return {
    x: payload.displayOrigin.x,
    y: payload.displayOrigin.y,
    width: payload.displaySize.width,
    height: payload.displaySize.height
  }
}

function configureCanvasResolution(): void {
  const ratio = Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
    ? window.devicePixelRatio
    : 1
  renderScale = ratio

  const width = Math.max(1, Math.round(window.innerWidth * ratio))
  const height = Math.max(1, Math.round(window.innerHeight * ratio))
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  canvas.style.width = `${window.innerWidth}px`
  canvas.style.height = `${window.innerHeight}px`
  canvasContext.setTransform(ratio, 0, 0, ratio, 0, 0)
  canvasContext.imageSmoothingEnabled = false

  const apertureSize = Math.max(1, Math.round(MAGNIFIER_SIZE * ratio))
  if (aperture.width !== apertureSize || aperture.height !== apertureSize) {
    aperture.width = apertureSize
    aperture.height = apertureSize
  }
  apertureContext.setTransform(ratio, 0, 0, ratio, 0, 0)
  apertureContext.imageSmoothingEnabled = false
  renderedSample = null
}

function pointFromScreen(screenX: number, screenY: number): { x: number; y: number } {
  if (!payload || !Number.isFinite(screenX) || !Number.isFinite(screenY)) return observedCursor
  const scale = imageScale()
  return {
    x: (screenX - payload.displayOrigin.x) * scale.x,
    y: (screenY - payload.displayOrigin.y) * scale.y
  }
}

function activeZoom(): (typeof PICKER_ZOOM_LEVELS)[number] {
  return PICKER_ZOOM_LEVELS[zoomIndex] ?? PICKER_ZOOM_LEVELS[DEFAULT_PICKER_ZOOM_INDEX]
}

function movementFactor(): number {
  return activeZoom().movementFactor
}

function clientFromPoint(point: { x: number; y: number }): { x: number; y: number } {
  const scale = imageScale()
  const origin = currentRegionOrigin()
  return { x: point.x / scale.x - origin.x, y: point.y / scale.y - origin.y }
}

function clientFromScreen(point: { x: number; y: number }): { x: number; y: number } {
  if (!payload) return { x: 0, y: 0 }
  const origin = currentRegionOrigin()
  return {
    x: point.x - payload.displayOrigin.x - origin.x,
    y: point.y - payload.displayOrigin.y - origin.y
  }
}

function imageBounds(): { width: number; height: number } {
  return payload?.imageSize ?? { width: 1, height: 1 }
}

function floatingMargins(): {
  cursorX: number; cursorY: number
  selectorLeft: number; selectorRight: number; selectorTop: number; selectorBottom: number
} {
  const width = window.innerWidth
  const height = window.innerHeight
  const selectorX = Math.min(SELECTOR_SIDE_PADDING + SELECTOR_RECENTER_GUARD, width / 3)
  return {
    cursorX: Math.min(RECENTER_MARGIN, width / 3),
    cursorY: Math.min(RECENTER_MARGIN, height / 3),
    selectorLeft: selectorX,
    selectorRight: selectorX,
    selectorTop: Math.min(SELECTOR_TOP_PADDING + SELECTOR_RECENTER_GUARD, height / 3),
    selectorBottom: Math.min(SELECTOR_BOTTOM_PADDING + SELECTOR_RECENTER_GUARD, height / 3)
  }
}

function constrainToFloatingSurface(next: PointerState, cursor: { x: number; y: number }): PointerState {
  if (!payload?.floating || payload.nativeInput) return next
  const scale = imageScale()
  const limits = floatingPickerOffsetLimits(
    { width: window.innerWidth, height: window.innerHeight },
    floatingMargins()
  )
  return constrainPointerOffset(next, cursor, {
    minX: limits.minX * scale.x,
    maxX: limits.maxX * scale.x,
    minY: limits.minY * scale.y,
    maxY: limits.maxY * scale.y
  }, imageBounds())
}

function roundedPoint(point: { x: number; y: number }): { x: number; y: number } {
  return { x: Math.round(point.x), y: Math.round(point.y) }
}

function samePoint(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return a.x === b.x && a.y === b.y
}

async function decodePngSample(sample: Extract<ColorSample, { ok: true; png: Uint8Array }>): Promise<Uint8ClampedArray> {
  const bytes = new Uint8Array(sample.png)
  const url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: 'image/png' }))
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.addEventListener('load', () => resolve())
      image.addEventListener('error', () => reject(new Error('Live sample could not be decoded')))
      image.src = url
    })
    const frame = document.createElement('canvas')
    frame.width = sample.width
    frame.height = sample.height
    const context = frame.getContext('2d')!
    context.fillStyle = '#000000'
    context.fillRect(0, 0, frame.width, frame.height)
    context.drawImage(image, sample.offsetX, sample.offsetY)
    return context.getImageData(0, 0, frame.width, frame.height).data
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function sampleData(result: ColorSample, cells: number): Promise<Uint8ClampedArray | null> {
  if (!result.ok || result.width !== cells || result.height !== cells) return null
  if ('pixels' in result) return parseRgbHexGrid(result.pixels, result.width, result.height)
  try {
    return await decodePngSample(result)
  } catch {
    return null
  }
}

function centerColor(data: Uint8ClampedArray, cells: number): Rgb | null {
  const center = Math.floor(cells / 2)
  const index = (center * cells + center) * 4
  if (index + 2 >= data.length) return null
  return { r: data[index], g: data[index + 1], b: data[index + 2] }
}

async function fetchSample(point: { x: number; y: number }, cells: number): Promise<SampledGrid | null> {
  const active = payload
  if (!active) return null
  const result = await window.capturoColor.sample(active.sessionId, point, cells)
  const data = await sampleData(result, cells)
  const color = data && centerColor(data, cells)
  return data && color ? { displayId: active.displayId, point, cells, data, color } : null
}

function setStatus(message: string): void {
  status.textContent = message
  status.classList.add('visible')
}

function drawMagnifier(grid: SampledGrid): void {
  const cell = MAGNIFIER_SIZE / grid.cells
  if (samplePixels.width !== grid.cells || samplePixels.height !== grid.cells) {
    samplePixels.width = grid.cells
    samplePixels.height = grid.cells
  }
  // Copy into an ArrayBuffer-backed view: IPC/Blob decode types may permit SharedArrayBufferLike,
  // while ImageData deliberately accepts only renderer-owned ArrayBuffer storage.
  samplePixelsContext.putImageData(
    new ImageData(new Uint8ClampedArray(grid.data), grid.cells, grid.cells),
    0,
    0
  )
  apertureContext.clearRect(0, 0, MAGNIFIER_SIZE, MAGNIFIER_SIZE)
  apertureContext.save()
  apertureContext.beginPath()
  apertureContext.roundRect(1.5, 1.5, MAGNIFIER_SIZE - 3, MAGNIFIER_SIZE - 3, 24.5)
  apertureContext.clip()
  apertureContext.fillStyle = '#050910'
  apertureContext.fillRect(0, 0, MAGNIFIER_SIZE, MAGNIFIER_SIZE)
  apertureContext.imageSmoothingEnabled = false
  apertureContext.drawImage(samplePixels, 0, 0, grid.cells, grid.cells, 0, 0, MAGNIFIER_SIZE, MAGNIFIER_SIZE)
  apertureContext.strokeStyle = 'rgba(0, 0, 0, 0.16)'
  apertureContext.lineWidth = 1
  for (let index = 1; index < grid.cells; index++) {
    const offset = Math.round(index * cell) + 0.5
    apertureContext.beginPath()
    apertureContext.moveTo(offset, 0)
    apertureContext.lineTo(offset, MAGNIFIER_SIZE)
    apertureContext.moveTo(0, offset)
    apertureContext.lineTo(MAGNIFIER_SIZE, offset)
    apertureContext.stroke()
  }
  const half = Math.floor(grid.cells / 2)
  const cx = Math.round(half * cell)
  const cy = Math.round(half * cell)
  const size = Math.round(cell)
  apertureContext.lineWidth = 3
  apertureContext.strokeStyle = 'rgba(0, 0, 0, 0.85)'
  apertureContext.strokeRect(cx - 1.5, cy - 1.5, size + 3, size + 3)
  apertureContext.lineWidth = 1.5
  apertureContext.strokeStyle = '#ffffff'
  apertureContext.strokeRect(cx - 0.75, cy - 0.75, size + 1.5, size + 1.5)
  apertureContext.restore()

  apertureContext.lineWidth = 3
  apertureContext.strokeStyle = '#ffffff'
  apertureContext.beginPath()
  apertureContext.roundRect(1.5, 1.5, MAGNIFIER_SIZE - 3, MAGNIFIER_SIZE - 3, 24.5)
  apertureContext.stroke()
}

function drawHexCaption(hex: string, placement: { x: number; y: number }): void {
  const align = (value: number): number => Math.round(value * renderScale) / renderScale
  const height = 30
  const top = align(placement.y + MAGNIFIER_SIZE + 12)
  canvasContext.save()
  canvasContext.font = '600 14px "Segoe UI", sans-serif'
  const width = align(Math.ceil(canvasContext.measureText(hex).width * renderScale) / renderScale + 24)
  const left = align(placement.x + (MAGNIFIER_SIZE - width) / 2)
  canvasContext.fillStyle = 'rgba(17, 24, 39, 0.94)'
  canvasContext.strokeStyle = 'rgba(255, 255, 255, 0.16)'
  canvasContext.lineWidth = 1
  canvasContext.beginPath()
  canvasContext.roundRect(left, top, width, height, height / 2)
  canvasContext.fill()
  canvasContext.stroke()
  canvasContext.fillStyle = '#f8fafc'
  canvasContext.textAlign = 'center'
  canvasContext.textBaseline = 'middle'
  canvasContext.fillText(hex, align(left + width / 2), align(top + height / 2))
  canvasContext.restore()
}

function renderMagnifierFrame(): void {
  renderPending = false
  // Clearing the whole visible bitmap is deliberate. On Windows, moving the old DOM magnifier
  // through a transparent BrowserWindow could leave a one-frame DWM ghost after abrupt direction
  // changes. One cleared canvas frame has no retained child layer and therefore no old position.
  // Mark the complete transparent surface as replaced, not merely cleared. Chromium/DWM can
  // optimize clearRect as a small dirty region around the old and new aperture; with a moving
  // transparent window that briefly retained the old square after a sharp reversal. A full
  // copy-composite invalidates every prior pixel in the same canvas frame before the new aperture
  // is drawn.
  canvasContext.save()
  canvasContext.setTransform(1, 0, 0, 1, 0, 0)
  canvasContext.globalCompositeOperation = 'copy'
  canvasContext.fillStyle = 'rgba(0, 0, 0, 0)'
  canvasContext.fillRect(0, 0, canvas.width, canvas.height)
  canvasContext.restore()
  // Sampling crosses into main and the native helper, so the newest grid necessarily trails a
  // moving pointer by a few milliseconds. Keep the last valid grid visible and move it with the
  // owned point while the replacement is in flight. Requiring an exact point match here made the
  // magnifier disappear continuously during motion and reappear only once the pointer stopped.
  // pick() still requires an exact match (or fetches one), so this visual continuity cannot make
  // the selected colour stale.
  const current = sampled
  if (!hasPointer || !current) return
  const placement = magnifierPlacement(clientFromPoint(pointer.point), MAGNIFIER_SIZE)
  if (renderedSample !== current) {
    drawMagnifier(current)
    renderedSample = current
  }
  canvasContext.drawImage(aperture, placement.x, placement.y, MAGNIFIER_SIZE, MAGNIFIER_SIZE)
  drawHexCaption(rgbToHex(current.color), placement)
}

function updateMagnifier(): void {
  // Coalesce raw pointer input to the display's frame rate. This prevents a backlog of obsolete
  // selector positions when the user jerks the mouse or reverses direction quickly.
  if (renderPending) return
  renderPending = true
  requestAnimationFrame(renderMagnifierFrame)
}

function paintBeforeWindowMove(): Promise<void> {
  // Recentring is the exceptional case where the paint must lead the native move. If main moves
  // first, DWM is allowed to carry the previous local bitmap to the new origin for one frame.
  // Run the corrected local placement in the animation-frame phase, then request setBounds from
  // the same turn so Chromium can commit the new pixels and window position together.
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      renderMagnifierFrame()
      resolve()
    })
  })
}

async function sampleNext(): Promise<void> {
  sampleTimer = null
  if (sampling || !desiredSample || !payload || picked) return
  const target = desiredSample
  desiredSample = null
  sampling = true
  lastSampleStartedAt = performance.now()
  try {
    const next = await fetchSample(target.point, target.cells)
    if (next && next.displayId === payload?.displayId && next.cells === activeZoom().cells) sampled = next
    updateMagnifier()
  } catch {
    // The session may close while an IPC sample is in flight. There is nothing left to render.
  } finally {
    sampling = false
    scheduleSample()
  }
}

function scheduleSample(): void {
  if (sampling || sampleTimer !== null || !desiredSample || !payload || picked) return
  const delay = pickerSampleDelay(lastSampleStartedAt, performance.now())
  sampleTimer = window.setTimeout(() => void sampleNext(), delay)
}

function queueSample(): void {
  desiredSample = { point: roundedPoint(pointer.point), cells: activeZoom().cells }
  updateMagnifier()
  scheduleSample()
}

function movePointerAt(screenPoint: { x: number; y: number }): void {
  const nextCursor = pointFromScreen(screenPoint.x, screenPoint.y)
  // BrowserWindow-relative event deltas can jump or reverse when that window recentres, even
  // though the physical cursor continued smoothly. Absolute screen points
  // stay stable across the move, so derive the only delta the precision model consumes from them.
  const delta = pointDelta(observedCursor, nextCursor)
  observedCursor = nextCursor
  pointer = advancePointerAtFactor(
    pointer,
    observedCursor,
    delta,
    movementFactor(),
    imageBounds()
  )
  // Limit precision displacement to what the *next centred window* can hold. Constraining it to
  // the old native bounds pins one axis during a sweep that outruns the setBounds round trip.
  pointer = constrainToFloatingSurface(pointer, observedCursor)
  hasPointer = true
  queueSample()
}

async function flushRecenter(active: ColorPickerPayload): Promise<void> {
  if (recentering) return
  recentering = true
  try {
    while (pendingRecenter && payload?.sessionId === active.sessionId) {
      const point = pendingRecenter
      pendingRecenter = null
      // Predict the new local coordinate space before main moves the native window. Otherwise the
      // compositor carries the old selector bitmap with the window for one frame, visibly placing
      // it past the pointer until `window.screenX/Y` catches up and the next frame corrects it.
      floatingRegionOrigin = point.regionOrigin
      await paintBeforeWindowMove()
      if (payload?.sessionId !== active.sessionId || payload.displayId !== active.displayId) break
      const moved = await window.capturoColor.recenterPicker(active.sessionId, {
        cursor: point.cursor,
        center: point.center,
        displayId: active.displayId
      })
      if (!moved && payload?.sessionId === active.sessionId) {
        floatingRegionOrigin = {
          x: window.screenX - payload.displayOrigin.x,
          y: window.screenY - payload.displayOrigin.y
        }
        updateMagnifier()
      }
    }
  } finally {
    recentering = false
    if (pendingRecenter && payload) void flushRecenter(payload)
  }
}

function maybeRecenterAt(screenPoint: { x: number; y: number }): void {
  const active = payload
  if (!active?.floating) return
  const clientPoint = clientFromScreen(screenPoint)
  const margins = floatingMargins()
  const selectorClient = clientFromPoint(pointer.point)
  const selectorFits =
    selectorClient.x >= margins.selectorLeft && selectorClient.x <= window.innerWidth - margins.selectorRight &&
    selectorClient.y >= margins.selectorTop && selectorClient.y <= window.innerHeight - margins.selectorBottom
  const cursorFits =
    clientPoint.x >= margins.cursorX && clientPoint.x <= window.innerWidth - margins.cursorX &&
    clientPoint.y >= margins.cursorY && clientPoint.y <= window.innerHeight - margins.cursorY
  if (selectorFits && (active.nativeInput || cursorFits)) return
  // Never discard the newest physical position while a previous window move is in flight. Fast
  // motion can cross the remaining margin inside one IPC round trip; processing the latest queued
  // point keeps the compact hit surface under the cursor instead of losing input at its edge.
  // Derive the owned selector's absolute position from display/image space, never from the moving
  // BrowserWindow. `window.screenX/Y` is specifically the value that can lag the native move and
  // would feed the transient overshoot back into the next requested centre.
  const scale = imageScale()
  const selectorScreen = {
    x: active.displayOrigin.x + pointer.point.x / scale.x,
    y: active.displayOrigin.y + pointer.point.y / scale.y
  }
  const center = {
    // Main rounds this center before setBounds. Use the same integer now so predicted paint and
    // native geometry agree even when a small display gives the floating window an odd width.
    x: Math.round(active.nativeInput ? selectorScreen.x : (screenPoint.x + selectorScreen.x) / 2),
    y: Math.round(active.nativeInput ? selectorScreen.y : (screenPoint.y + selectorScreen.y) / 2)
  }
  pendingRecenter = {
    cursor: screenPoint,
    center,
    regionOrigin: floatingPickerRegionOrigin(center, displayBounds(), FLOATING_PICKER_MAX_SIZE)
  }
  void flushRecenter(active)
}

function observeScreenPoint(screenPoint: { x: number; y: number }): void {
  const nextCursor = pointFromScreen(screenPoint.x, screenPoint.y)
  if (hasPointer && samePoint(observedCursor, nextCursor)) return
  movePointerAt(screenPoint)
  maybeRecenterAt(screenPoint)
}

async function pollCursor(sessionId: string): Promise<void> {
  if (cursorPollInFlight || payload?.sessionId !== sessionId) return
  cursorPollInFlight = true
  const requestedAt = performance.now()
  try {
    const point = await window.capturoColor.pickerCursor(sessionId)
    const active = payload
    // A DOM event received after this query began is fresher than the asynchronous response.
    // Applying that response used to pull the picker backwards during fast motion.
    if (!point || active?.sessionId !== sessionId || lastDomMovementAt >= requestedAt) return
    observeScreenPoint(point)
  } catch {
    // The window can close while an IPC query is in flight.
  } finally {
    cursorPollInFlight = false
  }
}

async function pick(): Promise<void> {
  if (picked || !payload) return
  const target = roundedPoint(pointer.point)
  const cells = activeZoom().cells
  const exact = sampled && sampled.displayId === payload.displayId &&
    sampled.cells === cells && samePoint(sampled.point, target)
    ? sampled
    : await fetchSample(target, cells)
  if (!exact || !payload) return
  picked = true
  setStatus(`Copied ${rgbToHex(exact.color)}`)
  await window.capturoColor.pick(payload.sessionId, exact.color)
}

function cancel(): void {
  if (payload) void window.capturoColor.cancelPicker(payload.sessionId)
}

function handleKey(event: KeyboardEvent): void {
  if (!payload) return
  if (event.key === 'Escape') {
    event.preventDefault()
    cancel()
    return
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    void pick()
    return
  }
  const nudges: Record<string, { x: number; y: number }> = {
    ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
    ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 }
  }
  const nudge = nudges[event.key]
  if (!nudge) return
  event.preventDefault()
  pointer = nudgePointer(pointer, nudge, imageBounds())
  pointer = constrainToFloatingSurface(pointer, observedCursor)
  hasPointer = true
  queueSample()
}

function changeZoom(deltaY: number): void {
  if (!payload || deltaY === 0) return
  const next = stepPickerZoomIndex(zoomIndex, deltaY)
  if (next === zoomIndex) return
  zoomIndex = next
  // Keep the last valid grid visible until the differently sized replacement arrives. Picking
  // checks both coordinates and cell count, so a transient preview can never select stale pixels.
  queueSample()
}

function handleWheel(event: WheelEvent): void {
  event.preventDefault()
  // The native input surface owns physical wheel events on Windows. A focused Chromium window
  // can also receive the same wheel message, and using both would advance two zoom steps.
  if (payload?.nativeInput) return
  changeZoom(event.deltaY)
}

function initialize(nextPayload: ColorPickerPayload): void {
  payload = nextPayload
  if (cursorPollTimer !== null) window.clearInterval(cursorPollTimer)
  cursorPollTimer = null
  pendingRecenter = null
  // Never carry a grid across a monitor transition. Coordinates can coincide on two displays;
  // accepting an old grid by point and size alone could preview or even pick the other monitor.
  sampled = null
  renderedSample = null
  desiredSample = null
  if (sampleTimer !== null) window.clearTimeout(sampleTimer)
  sampleTimer = null
  lastSampleStartedAt = Number.NEGATIVE_INFINITY
  floatingRegionOrigin = { ...nextPayload.regionOrigin }
  configureCanvasResolution()
  applySafeArea(nextPayload.safeArea)
  const scale = imageScale()
  const seed = nextPayload.cursor
  hasPointer = seed !== null
  pointer = initialPointerState(seed
    ? { x: seed.x * scale.x, y: seed.y * scale.y }
    : { x: Math.floor(nextPayload.imageSize.width / 2), y: Math.floor(nextPayload.imageSize.height / 2) })
  observedCursor = { ...pointer.point }
  lastDomMovementAt = Number.NEGATIVE_INFINITY
  if (hasPointer) queueSample()
  if (nextPayload.floating && !nextPayload.nativeInput) {
    // A native position query keeps the magnifier alive if a transparent window misses motion.
    cursorPollTimer = window.setInterval(() => void pollCursor(nextPayload.sessionId), 25)
    void pollCursor(nextPayload.sessionId)
  }
  requestAnimationFrame(() => requestAnimationFrame(() => void window.capturoColor.pickerReady(nextPayload.sessionId)))
}

canvas.addEventListener('pointermove', (event) => {
  if (payload?.nativeInput) return
  lastDomMovementAt = performance.now()
  observeScreenPoint({ x: event.screenX, y: event.screenY })
})
canvas.addEventListener('pointerenter', (event) => {
  if (payload?.nativeInput) return
  // Recentring the floating Windows surface can synthesize leave/enter at the same physical
  // pointer. Preserve zoom-scaled displacement across that window move.
  if (!payload?.floating || !hasPointer) {
    observedCursor = pointFromScreen(event.screenX, event.screenY)
    pointer = initialPointerState(observedCursor)
    hasPointer = false
  }
  lastDomMovementAt = performance.now()
  observeScreenPoint({ x: event.screenX, y: event.screenY })
})
window.addEventListener('pagehide', () => {
  if (cursorPollTimer !== null) window.clearInterval(cursorPollTimer)
  cursorPollTimer = null
})
canvas.addEventListener('wheel', handleWheel, { passive: false })
canvas.addEventListener('pointerleave', () => {
  if (payload?.floating) return
  hasPointer = false
  updateMagnifier()
})
canvas.addEventListener('pointerdown', (event) => {
  if (payload?.nativeInput) return
  if (event.button !== 0) return
  event.preventDefault()
  void pick()
})
window.addEventListener('keydown', handleKey)
window.addEventListener('resize', () => {
  configureCanvasResolution()
  updateMagnifier()
})

window.capturoColor.onPickerInitialize(initialize)
window.capturoColor.onPickerInput((input) => {
  if (!payload?.nativeInput) return
  observeScreenPoint(input.point)
  if (input.kind === 'wheel') changeZoom(input.deltaY ?? 0)
  if (input.kind === 'pick') void pick()
})
