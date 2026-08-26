import './scroll-record.css'
import {
  analyzePanoramicMovement,
  chooseHistoryAnchoredPanoramicMovement,
  panoramicMovementCandidates,
  panoramicBounds,
  panoramicCursorMask,
  panoramicExposure,
  panoramicTrustedInterior,
  panoramicViewportAfterMovement,
  refreshablePanoramicRects,
  rollingCaptureFits,
  uncoveredPanoramicRects,
  type PanoramicMovement,
  type PanoramicPointer,
  type ScrollCapturePayload
} from '../shared/scroll'
import type { Point, Rect } from '../shared/types'

const bar = document.querySelector<HTMLElement>('#bar')!
const title = document.querySelector<HTMLElement>('#title')!
const status = document.querySelector<HTMLElement>('#status')!
const finishButton = document.querySelector<HTMLButtonElement>('#finish')!
const cancelButton = document.querySelector<HTMLButtonElement>('#cancel')!
const preview = document.querySelector<HTMLCanvasElement>('#preview')!
const video = document.querySelector<HTMLVideoElement>('#video')!

const SAMPLE_INTERVAL_MS = 50
const HISTORY_CELL_SIZE = 16
const HISTORY_KEY_OFFSET = 2_048
const HISTORY_KEY_STRIDE = 4_096

type CapturedLayer = {
  canvas: HTMLCanvasElement
  world: Rect
}

let stream: MediaStream | null = null
let sampleTimer: number | null = null
let videoFrameCallback: number | null = null
let lastSampleTime = 0
let frameCanvas: HTMLCanvasElement | null = null
let frameContext: CanvasRenderingContext2D | null = null
let previousFrame: Uint8ClampedArray | null = null
let layers: CapturedLayer[] = []
let capturedRects: Rect[] = []
let trustedRects: Rect[] = []
let viewportPosition: Point = { x: 0, y: 0 }
const capturedHistory = new Map<number, number>()
let lastMovement: PanoramicMovement | null = null
let processing = false
let finishing = false
let rejectedFrames = 0
// The pointer positions bracketing the frame currently being read. Two samples are taken because
// a pointer can travel further than its own footprint between 20 fps samples, and a single stale
// position would leave the real pointer unmasked in newly exposed pixels.
let pointerSamples: PanoramicPointer[] = []

function stopStream(): void {
  if (sampleTimer !== null) {
    window.clearInterval(sampleTimer)
    sampleTimer = null
  }
  if (videoFrameCallback !== null) {
    video.cancelVideoFrameCallback(videoFrameCallback)
    videoFrameCallback = null
  }
  stream?.getTracks().forEach((track) => track.stop())
  stream = null
}

function scheduleVideoFrame(): void {
  videoFrameCallback = video.requestVideoFrameCallback((now) => {
    videoFrameCallback = null
    if (!stream || finishing) return
    if (now - lastSampleTime >= SAMPLE_INTERVAL_MS) {
      lastSampleTime = now
      void sampleFrame()
    }
    scheduleVideoFrame()
  })
}

function setFailure(message: string): void {
  bar.classList.add('error')
  status.textContent = message
}

function copyRegion(source: HTMLCanvasElement, rect: Rect): HTMLCanvasElement {
  const copy = document.createElement('canvas')
  copy.width = Math.max(1, Math.round(rect.width))
  copy.height = Math.max(1, Math.round(rect.height))
  copy.getContext('2d')?.drawImage(
    source,
    Math.round(rect.x),
    Math.round(rect.y),
    copy.width,
    copy.height,
    0,
    0,
    copy.width,
    copy.height
  )
  return copy
}

function viewportRect(): Rect | null {
  return frameCanvas
    ? { x: viewportPosition.x, y: viewportPosition.y, width: frameCanvas.width, height: frameCanvas.height }
    : null
}

function renderPreview(): void {
  const bounds = panoramicBounds(capturedRects)
  const viewport = viewportRect()
  if (!bounds || !viewport) return

  const ratio = Math.max(1, window.devicePixelRatio || 1)
  const cssWidth = Math.max(1, preview.clientWidth)
  const cssHeight = Math.max(1, preview.clientHeight)
  const pixelWidth = Math.round(cssWidth * ratio)
  const pixelHeight = Math.round(cssHeight * ratio)
  if (preview.width !== pixelWidth || preview.height !== pixelHeight) {
    preview.width = pixelWidth
    preview.height = pixelHeight
  }
  const context = preview.getContext('2d')
  if (!context) return
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, cssWidth, cssHeight)
  context.fillStyle = '#080d15'
  context.fillRect(0, 0, cssWidth, cssHeight)

  const padding = 4
  const scale = Math.min(
    (cssWidth - padding * 2) / Math.max(1, bounds.width),
    (cssHeight - padding * 2) / Math.max(1, bounds.height)
  )
  const originX = (cssWidth - bounds.width * scale) / 2 - bounds.x * scale
  const originY = (cssHeight - bounds.height * scale) / 2 - bounds.y * scale
  context.imageSmoothingEnabled = true
  for (const layer of layers) {
    context.drawImage(
      layer.canvas,
      originX + layer.world.x * scale,
      originY + layer.world.y * scale,
      layer.world.width * scale,
      layer.world.height * scale
    )
  }

  context.fillStyle = 'rgba(14, 165, 233, 0.13)'
  context.strokeStyle = '#38bdf8'
  context.lineWidth = 1.5
  const viewportX = originX + viewport.x * scale
  const viewportY = originY + viewport.y * scale
  const viewportWidth = Math.max(2, viewport.width * scale)
  const viewportHeight = Math.max(2, viewport.height * scale)
  context.fillRect(viewportX, viewportY, viewportWidth, viewportHeight)
  context.strokeRect(viewportX + 0.75, viewportY + 0.75, Math.max(0.5, viewportWidth - 1.5), Math.max(0.5, viewportHeight - 1.5))
}

function updateProgress(hasNewCoverage = false): void {
  const bounds = panoramicBounds(capturedRects)
  if (!frameCanvas || !bounds) return
  title.textContent = `Panoramic capture · ${Math.round(bounds.width)}×${Math.round(bounds.height)}`
  if (lastMovement) {
    status.textContent = hasNewCoverage
      ? `Capturing new area while moving ${lastMovement.direction} · pan in any direction`
      : 'Already captured here · continue panning in any direction'
  } else {
    status.textContent = 'Click inside the selected area, then scroll or pan in any direction'
  }
  bar.classList.remove('error')
  renderPreview()
}

function sampledFrameDifference(previous: Uint8ClampedArray, current: Uint8ClampedArray): number {
  const stride = Math.max(4, Math.floor(previous.length / 16_384 / 4) * 4)
  let error = 0
  let channels = 0
  for (let index = 0; index < previous.length; index += stride) {
    error += Math.abs(previous[index] - current[index])
    channels += 1
  }
  return channels > 0 ? error / channels : 0
}

function historyKey(cellX: number, cellY: number): number {
  return (cellY + HISTORY_KEY_OFFSET) * HISTORY_KEY_STRIDE + cellX + HISTORY_KEY_OFFSET
}

function recordHistoryPixels(
  pixels: Uint8ClampedArray,
  viewport: Point,
  viewportWidth: number,
  viewportHeight: number,
  world: Rect
): void {
  const firstCellX = Math.ceil((world.x - HISTORY_CELL_SIZE / 2) / HISTORY_CELL_SIZE)
  const lastCellX = Math.floor((world.x + world.width - 1 - HISTORY_CELL_SIZE / 2) / HISTORY_CELL_SIZE)
  const firstCellY = Math.ceil((world.y - HISTORY_CELL_SIZE / 2) / HISTORY_CELL_SIZE)
  const lastCellY = Math.floor((world.y + world.height - 1 - HISTORY_CELL_SIZE / 2) / HISTORY_CELL_SIZE)
  for (let cellY = firstCellY; cellY <= lastCellY; cellY += 1) {
    const worldY = cellY * HISTORY_CELL_SIZE + HISTORY_CELL_SIZE / 2
    const localY = Math.round(worldY - viewport.y)
    if (localY < 0 || localY >= viewportHeight) continue
    for (let cellX = firstCellX; cellX <= lastCellX; cellX += 1) {
      const worldX = cellX * HISTORY_CELL_SIZE + HISTORY_CELL_SIZE / 2
      const localX = Math.round(worldX - viewport.x)
      if (localX < 0 || localX >= viewportWidth) continue
      const index = (localY * viewportWidth + localX) * 4
      capturedHistory.set(
        historyKey(cellX, cellY),
        (pixels[index] << 16) | (pixels[index + 1] << 8) | pixels[index + 2]
      )
    }
  }
}

function historicalAlignmentScore(
  current: Uint8ClampedArray,
  position: Point,
  width: number,
  height: number
): { score: number; samples: number } {
  const firstCellX = Math.ceil((position.x - HISTORY_CELL_SIZE / 2) / HISTORY_CELL_SIZE)
  const lastCellX = Math.floor((position.x + width - 1 - HISTORY_CELL_SIZE / 2) / HISTORY_CELL_SIZE)
  const firstCellY = Math.ceil((position.y - HISTORY_CELL_SIZE / 2) / HISTORY_CELL_SIZE)
  const lastCellY = Math.floor((position.y + height - 1 - HISTORY_CELL_SIZE / 2) / HISTORY_CELL_SIZE)
  const cellCount = Math.max(1, (lastCellX - firstCellX + 1) * (lastCellY - firstCellY + 1))
  const step = Math.max(1, Math.ceil(Math.sqrt(cellCount / 900)))
  let broadError = 0
  let broadSamples = 0
  let detailError = 0
  let detailSamples = 0
  const localContrast = (localX: number, localY: number): number => {
    let minimum = Number.POSITIVE_INFINITY
    let maximum = Number.NEGATIVE_INFINITY
    for (const [offsetX, offsetY] of [[0, 0], [-4, 0], [4, 0], [0, -4], [0, 4]]) {
      const x = Math.max(0, Math.min(width - 1, localX + offsetX))
      const y = Math.max(0, Math.min(height - 1, localY + offsetY))
      const index = (y * width + x) * 4
      const brightness = current[index] + current[index + 1] + current[index + 2]
      minimum = Math.min(minimum, brightness)
      maximum = Math.max(maximum, brightness)
    }
    return maximum - minimum
  }
  for (let cellY = firstCellY; cellY <= lastCellY; cellY += step) {
    const worldY = cellY * HISTORY_CELL_SIZE + HISTORY_CELL_SIZE / 2
    const localY = Math.round(worldY - position.y)
    if (localY < height * 0.12 || localY >= height) continue
    for (let cellX = firstCellX; cellX <= lastCellX; cellX += step) {
      const packed = capturedHistory.get(historyKey(cellX, cellY))
      if (packed === undefined) continue
      const worldX = cellX * HISTORY_CELL_SIZE + HISTORY_CELL_SIZE / 2
      const localX = Math.round(worldX - position.x)
      if (localX < width * 0.05 || localX >= width * 0.95) continue
      // Flat card backgrounds and margins repeat frequently and contain almost no alignment
      // information on their own, but they can still disprove a false detail-only match. Require
      // both the broad viewport colors and text/borders to agree with captured history.
      const index = (localY * width + localX) * 4
      const sampleError = Math.abs(current[index] - ((packed >> 16) & 0xff)) +
        Math.abs(current[index + 1] - ((packed >> 8) & 0xff)) +
        Math.abs(current[index + 2] - (packed & 0xff))
      broadError += sampleError
      broadSamples += 1
      if (localContrast(localX, localY) >= 36) {
        detailError += sampleError
        detailSamples += 1
      }
    }
  }
  const broadScore = broadSamples > 0 ? broadError / (broadSamples * 3) : Number.POSITIVE_INFINITY
  const detailScore = detailSamples >= 24 ? detailError / (detailSamples * 3) : broadScore
  return { score: Math.max(broadScore, detailScore), samples: broadSamples }
}

function choosePanoramicMovement(
  previous: Uint8ClampedArray,
  current: Uint8ClampedArray,
  width: number,
  height: number
): PanoramicMovement | null {
  const candidates = panoramicMovementCandidates(previous, current, width, height)
  const historyDecision = chooseHistoryAnchoredPanoramicMovement(candidates.map((movement) => {
    const position = panoramicViewportAfterMovement(viewportPosition, movement)
    const history = historicalAlignmentScore(current, position, width, height)
    return { movement, historyScore: history.score, historySamples: history.samples }
  }))
  // If known panorama pixels disprove every candidate, the frame is unsafe. Do not fall back to
  // the two-frame matcher: repeated page structure can make a large jump look locally plausible.
  if (historyDecision.anchored) return historyDecision.movement
  return analyzePanoramicMovement(previous, current, width, height)
}

function addExposure(
  frame: HTMLCanvasElement,
  pixels: Uint8ClampedArray,
  exposure: ReturnType<typeof panoramicExposure>
): number {
  const uncovered = uncoveredPanoramicRects(exposure.world, capturedRects)
  const cursorMasks = cursorWorldRects(frame.width, frame.height)
  let added = 0
  for (const candidate of uncovered) {
    const visible = cursorMasks.length > 0 ? uncoveredPanoramicRects(candidate, cursorMasks) : [candidate]
    for (const world of visible) {
      const source = {
        x: exposure.source.x + world.x - exposure.world.x,
        y: exposure.source.y + world.y - exposure.world.y,
        width: world.width,
        height: world.height
      }
      layers.push({ canvas: copyRegion(frame, source), world })
      recordHistoryPixels(pixels, viewportPosition, frame.width, frame.height, world)
      capturedRects.push(world)
      added += world.width * world.height
    }
  }
  return added
}

// The pointer stays visible to the user, so it is Capturo's job to keep it out of the output.
// Treat its footprint as missing coverage even when Chromium ignores `cursor: never`. Scrolling
// carries those world pixels to another place in the viewport, where addExposure can safely fill
// the hole. Main sizes the mask from the region so it covers a high-DPI pointer and its shadow.
function cursorWorldRects(width: number, height: number): Rect[] {
  const masks: Rect[] = []
  for (const pointer of pointerSamples) {
    const mask = panoramicCursorMask(viewportPosition, pointer, width, height)
    if (mask) masks.push(mask)
  }
  return masks
}

function refreshTrustedInterior(frame: HTMLCanvasElement, pixels: Uint8ClampedArray, movement: PanoramicMovement): void {
  // Only promote a strong alignment. A weaker-but-accepted frame may safely extend provisional
  // coverage, but a later, cleaner observation should be the one allowed to replace a seam.
  if (movement.score > 18 || movement.confidence < 0.25) return
  const interior = panoramicTrustedInterior(viewportPosition, frame, movement.direction)
  const refreshable = refreshablePanoramicRects(interior, capturedRects, trustedRects)
  const cursorMasks = cursorWorldRects(frame.width, frame.height)
  for (const candidate of refreshable) {
    const visible = cursorMasks.length > 0 ? uncoveredPanoramicRects(candidate, cursorMasks) : [candidate]
    for (const world of visible) {
      const source = {
        x: world.x - viewportPosition.x,
        y: world.y - viewportPosition.y,
        width: world.width,
        height: world.height
      }
      layers.push({ canvas: copyRegion(frame, source), world })
      recordHistoryPixels(pixels, viewportPosition, frame.width, frame.height, world)
      trustedRects.push(world)
    }
  }
}

async function sampleFrame(): Promise<void> {
  if (processing || finishing || !frameCanvas || !frameContext || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
  processing = true
  try {
    const pointerBefore = await window.capturoScroll.cursorPosition()
    const cropX = Number(frameCanvas.dataset.x)
    const cropY = Number(frameCanvas.dataset.y)
    frameContext.drawImage(
      video,
      cropX,
      cropY,
      frameCanvas.width,
      frameCanvas.height,
      0,
      0,
      frameCanvas.width,
      frameCanvas.height
    )
    const current = frameContext.getImageData(0, 0, frameCanvas.width, frameCanvas.height).data
    // The composited frame belongs to some instant between these two reports, so mask both.
    pointerSamples = [pointerBefore, await window.capturoScroll.cursorPosition()]
      .filter((pointer): pointer is PanoramicPointer => pointer !== null)
    if (!previousFrame) {
      previousFrame = current.slice()
      const base = { x: 0, y: 0, width: frameCanvas.width, height: frameCanvas.height }
      layers = []
      capturedRects = []
      const baseArea = addExposure(frameCanvas, current, { source: base, world: base })
      // The first viewport is usable immediately, but its edges are not quality-promoted yet. If
      // scrolling later carries those pixels into the safe interior, redraw them from that cleaner
      // observation so an initial hover/status overlay is not permanently baked into the base.
      trustedRects = []
      if (baseArea === 0) {
        // Only a viewport smaller than the pointer footprint can be masked away entirely. Wait for
        // a frame that has something in it rather than enabling a Finish with nothing to stitch.
        previousFrame = null
        setFailure('Move the pointer out of the selected area to start capturing')
        return
      }
      finishButton.disabled = false
      updateProgress()
      return
    }

    const rawDifference = sampledFrameDifference(previousFrame, current)
    const movement = choosePanoramicMovement(previousFrame, current, frameCanvas.width, frameCanvas.height)
    if (!movement) {
      if (rawDifference < 0.6) {
        // Retracing exactly to the last verified viewport is a successful recovery. Clear a stale
        // fast-movement warning even though there is no new motion to append.
        if (rejectedFrames > 0) {
          rejectedFrames = 0
          updateProgress(false)
        }
        return
      }
      rejectedFrames += 1
      if (rejectedFrames >= 2) setFailure('Movement was too fast to verify · pause briefly or retrace the missed area')
      return
    }

    const nextPosition = panoramicViewportAfterMovement(viewportPosition, movement)
    const exposure = panoramicExposure(nextPosition, frameCanvas, movement)
    const uncovered = uncoveredPanoramicRects(exposure.world, capturedRects)
    const prospectiveBounds = panoramicBounds([...capturedRects, ...uncovered])
    if (!prospectiveBounds || !rollingCaptureFits(prospectiveBounds.width, prospectiveBounds.height)) {
      stopStream()
      finishButton.disabled = false
      setFailure('Maximum panoramic-capture size reached · choose Finish')
      return
    }

    viewportPosition = nextPosition
    lastMovement = movement
    // Use the whole visible viewport, not only its new edge strip. This both extends the panorama
    // and fills pointer-shaped holes from earlier frames after those pixels move clear.
    const addedArea = addExposure(frameCanvas, current, {
      source: { x: 0, y: 0, width: frameCanvas.width, height: frameCanvas.height },
      world: { x: viewportPosition.x, y: viewportPosition.y, width: frameCanvas.width, height: frameCanvas.height }
    })
    refreshTrustedInterior(frameCanvas, current, movement)
    previousFrame = current.slice()
    rejectedFrames = 0
    updateProgress(addedArea > 0)
  } catch (error) {
    console.error('Panoramic capture frame failed', error)
    setFailure('Could not read the selected area · choose Cancel and try again')
  } finally {
    processing = false
  }
}

async function begin(payload: ScrollCapturePayload): Promise<void> {
  try {
    const videoConstraints = {
      frameRate: { ideal: 20, max: 24 },
      cursor: 'never'
    } as MediaTrackConstraints
    stream = await navigator.mediaDevices.getDisplayMedia({ video: videoConstraints, audio: false })
    const [track] = stream.getVideoTracks()
    if (track) {
      try { await track.applyConstraints({ cursor: 'never' } as MediaTrackConstraints) } catch {
        // The initial getDisplayMedia constraint remains in force on Chromium versions that do
        // not expose cursor as an applyConstraints capability.
      }
    }
  } catch (error) {
    console.error('Panoramic capture getDisplayMedia failed', error)
    await window.capturoScroll.cancel()
    return
  }

  video.srcObject = stream
  try { await video.play() } catch { /* Muted display streams normally autoplay. */ }
  if (!video.videoWidth) {
    await new Promise<void>((resolve) => video.addEventListener('loadedmetadata', () => resolve(), { once: true }))
  }

  const cropX = Math.max(0, Math.round(payload.crop.x * video.videoWidth))
  const cropY = Math.max(0, Math.round(payload.crop.y * video.videoHeight))
  const cropWidth = Math.max(1, Math.min(video.videoWidth - cropX, Math.round(payload.crop.width * video.videoWidth)))
  const cropHeight = Math.max(1, Math.min(video.videoHeight - cropY, Math.round(payload.crop.height * video.videoHeight)))
  if (!rollingCaptureFits(cropWidth, cropHeight)) {
    stopStream()
    setFailure('The selected viewport is too large for a panoramic capture')
    return
  }

  frameCanvas = document.createElement('canvas')
  frameCanvas.width = cropWidth
  frameCanvas.height = cropHeight
  frameCanvas.dataset.x = String(cropX)
  frameCanvas.dataset.y = String(cropY)
  frameContext = frameCanvas.getContext('2d', { willReadFrequently: true })
  if (!frameContext) {
    await window.capturoScroll.cancel()
    return
  }

  void sampleFrame()
  if ('requestVideoFrameCallback' in video) scheduleVideoFrame()
  else sampleTimer = window.setInterval(() => void sampleFrame(), SAMPLE_INTERVAL_MS)
}

async function fillFinalCursorHole(): Promise<void> {
  if (!frameCanvas || !frameContext || !stream || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
  // Finish is clicked outside the selected viewport. Wait for one fresh display frame, then fill
  // any pointer mask still visible in the current world position before stopping the stream.
  await new Promise<void>((resolve) => {
    const timeout = window.setTimeout(resolve, 120)
    video.requestVideoFrameCallback(() => {
      window.clearTimeout(timeout)
      resolve()
    })
  })
  const pointerBefore = await window.capturoScroll.cursorPosition()
  const cropX = Number(frameCanvas.dataset.x)
  const cropY = Number(frameCanvas.dataset.y)
  frameContext.drawImage(video, cropX, cropY, frameCanvas.width, frameCanvas.height, 0, 0, frameCanvas.width, frameCanvas.height)
  const current = frameContext.getImageData(0, 0, frameCanvas.width, frameCanvas.height).data
  pointerSamples = [pointerBefore, await window.capturoScroll.cursorPosition()]
    .filter((pointer): pointer is PanoramicPointer => pointer !== null)
  addExposure(frameCanvas, current, {
    source: { x: 0, y: 0, width: frameCanvas.width, height: frameCanvas.height },
    world: { x: viewportPosition.x, y: viewportPosition.y, width: frameCanvas.width, height: frameCanvas.height }
  })
}

async function finish(): Promise<void> {
  if (layers.length === 0 || !frameCanvas || finishing) return
  finishing = true
  while (processing) await new Promise((resolve) => window.setTimeout(resolve, 10))
  await fillFinalCursorHole()
  stopStream()
  finishButton.disabled = true
  cancelButton.disabled = true
  title.textContent = 'Building the panoramic screenshot…'
  status.textContent = 'Finalizing the captured areas…'

  const bounds = panoramicBounds(capturedRects)
  if (!bounds || !rollingCaptureFits(bounds.width, bounds.height)) {
    setFailure('Could not determine the panoramic image bounds')
    finishing = false
    cancelButton.disabled = false
    return
  }
  const output = document.createElement('canvas')
  output.width = Math.round(bounds.width)
  output.height = Math.round(bounds.height)
  const context = output.getContext('2d')
  if (!context) {
    setFailure('Could not build the final image')
    finishing = false
    cancelButton.disabled = false
    return
  }
  for (const layer of layers) {
    context.drawImage(layer.canvas, layer.world.x - bounds.x, layer.world.y - bounds.y)
  }

  const blob = await new Promise<Blob | null>((resolve) => output.toBlob(resolve, 'image/png'))
  if (!blob) {
    setFailure('Could not encode the final image')
    finishing = false
    cancelButton.disabled = false
    return
  }
  const result = await window.capturoScroll.finish(await blob.arrayBuffer())
  if (!result.opened) {
    setFailure(result.error)
    finishing = false
    cancelButton.disabled = false
  }
}

function cancel(): void {
  if (finishing) return
  finishing = true
  stopStream()
  void window.capturoScroll.cancel()
}

finishButton.addEventListener('click', () => void finish())
cancelButton.addEventListener('click', cancel)
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') cancel()
})

void window.capturoScroll.requestInitialization().then((payload) => {
  if (payload) void begin(payload)
  else void window.capturoScroll.cancel()
})
