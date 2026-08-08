import './gif-record.css'
import type { GifRecordPayload } from '../shared/gif'

const bar = document.querySelector<HTMLElement>('#bar')!
const timerEl = document.querySelector<HTMLElement>('#timer')!
const framesEl = document.querySelector<HTMLElement>('#frames')!
const pauseButton = document.querySelector<HTMLButtonElement>('#pause')!
const stopButton = document.querySelector<HTMLButtonElement>('#stop')!
const cancelButton = document.querySelector<HTMLButtonElement>('#cancel')!
const video = document.querySelector<HTMLVideoElement>('#video')!

let worker: Worker | null = null
let stream: MediaStream | null = null
let sampleTimer: number | null = null
let recording = false
let paused = false
let finishing = false
let frameCount = 0
// Elapsed recording time, excluding paused spans.
let activeSince = 0
let accumulatedMs = 0

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`
}

function elapsedMs(): number {
  return paused ? accumulatedMs : accumulatedMs + (performance.now() - activeSince)
}

function updateHud(): void {
  timerEl.textContent = formatTime(elapsedMs())
  framesEl.textContent = `${frameCount} frame${frameCount === 1 ? '' : 's'}`
}

function stopStream(): void {
  if (sampleTimer !== null) {
    window.clearInterval(sampleTimer)
    sampleTimer = null
  }
  stream?.getTracks().forEach((track) => track.stop())
  stream = null
}

async function begin(payload: GifRecordPayload): Promise<void> {
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: payload.fps },
      audio: false
    })
  } catch (error) {
    console.error('getDisplayMedia failed', error)
    void window.capturoGif.cancelRecording()
    return
  }

  video.srcObject = stream
  try {
    await video.play()
  } catch {
    // Autoplay of a muted stream should not be blocked, but proceed regardless.
  }
  if (!video.videoWidth) {
    await new Promise<void>((resolve) => video.addEventListener('loadedmetadata', () => resolve(), { once: true }))
  }

  const streamWidth = video.videoWidth
  const streamHeight = video.videoHeight
  const cropX = Math.round(payload.crop.x * streamWidth)
  const cropY = Math.round(payload.crop.y * streamHeight)
  const cropWidth = Math.max(1, Math.round(payload.crop.width * streamWidth))
  const cropHeight = Math.max(1, Math.round(payload.crop.height * streamHeight))

  const canvas = document.createElement('canvas')
  canvas.width = cropWidth
  canvas.height = cropHeight
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    void window.capturoGif.cancelRecording()
    return
  }

  worker = new Worker(new URL('./gif-worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent) => {
    if (event.data?.type === 'done') void onEncoded(event.data.bytes as ArrayBuffer)
  }
  worker.postMessage({ type: 'start', width: cropWidth, height: cropHeight, fps: payload.fps, quality: payload.quality })

  recording = true
  activeSince = performance.now()
  const interval = 1000 / payload.fps
  sampleTimer = window.setInterval(() => {
    if (paused || !recording || !worker) return
    context.drawImage(video, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight)
    const { buffer } = context.getImageData(0, 0, cropWidth, cropHeight).data
    frameCount += 1
    worker.postMessage({ type: 'frame', data: buffer }, [buffer])
    updateHud()
  }, interval)
  updateHud()

  if (payload.autoStopMs) window.setTimeout(() => stop(), payload.autoStopMs)
}

function togglePause(): void {
  if (!recording || finishing) return
  if (paused) {
    paused = false
    activeSince = performance.now()
    pauseButton.textContent = 'Pause'
    bar.classList.remove('paused')
  } else {
    paused = true
    accumulatedMs += performance.now() - activeSince
    pauseButton.textContent = 'Resume'
    bar.classList.add('paused')
  }
  updateHud()
}

function stop(): void {
  if (!recording || finishing) return
  // Nothing captured (stopped instantly): just discard.
  if (frameCount === 0) {
    void window.capturoGif.cancelRecording()
    return
  }
  finishing = true
  recording = false
  stopStream()
  pauseButton.disabled = true
  stopButton.disabled = true
  cancelButton.disabled = true
  timerEl.textContent = 'Encoding…'
  worker?.postMessage({ type: 'finish' })
}

async function onEncoded(bytes: ArrayBuffer): Promise<void> {
  worker?.terminate()
  worker = null
  await window.capturoGif.saveRecording(bytes)
  // Main closes this window after the save dialog resolves.
}

function cancel(): void {
  if (finishing) return
  recording = false
  stopStream()
  worker?.terminate()
  worker = null
  void window.capturoGif.cancelRecording()
}

pauseButton.addEventListener('click', togglePause)
stopButton.addEventListener('click', stop)
cancelButton.addEventListener('click', cancel)
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') cancel()
})

window.capturoGif.onRecordInitialize((payload) => void begin(payload))
