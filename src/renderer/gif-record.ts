import './gif-record.css'
import { countdownSecondsRemaining, type GifRecordPayload } from '../shared/gif'

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
let countdownTimer: number | null = null
let autoStopTimer: number | null = null
let recording = false
let countingDown = false
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
  if (countdownTimer !== null) {
    window.clearInterval(countdownTimer)
    countdownTimer = null
  }
  if (autoStopTimer !== null) {
    window.clearTimeout(autoStopTimer)
    autoStopTimer = null
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
  const interval = 1000 / payload.fps
  const sampleFrame = (): void => {
    if (countingDown || paused || !recording || !worker) return
    context.drawImage(video, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight)
    // Timestamp the pixels when they are sampled. setInterval is only a scheduling request: a
    // large crop or a busy renderer can make callbacks late, and stamping every frame with the
    // nominal FPS would then make the GIF play faster than the recording happened in real time.
    const timestampMs = elapsedMs()
    const { buffer } = context.getImageData(0, 0, cropWidth, cropHeight).data
    frameCount += 1
    worker.postMessage({ type: 'frame', data: buffer, timestampMs }, [buffer])
    updateHud()
  }
  const startActiveRecording = (): void => {
    if (!recording) return
    if (countdownTimer !== null) {
      window.clearInterval(countdownTimer)
      countdownTimer = null
    }
    countingDown = false
    paused = false
    accumulatedMs = 0
    activeSince = performance.now()
    bar.classList.remove('countdown')
    pauseButton.disabled = false
    stopButton.disabled = false

    // Capture the initial state immediately, then use the selected FPS as the requested sampling
    // cadence. Actual elapsed timestamps remain authoritative when sampling is late.
    sampleFrame()
    sampleTimer = window.setInterval(sampleFrame, interval)
    updateHud()
    if (payload.autoStopMs) autoStopTimer = window.setTimeout(() => stop(), payload.autoStopMs)
  }

  const preTimerMs = payload.preTimerSeconds * 1000
  if (preTimerMs <= 0) {
    startActiveRecording()
    return
  }

  countingDown = true
  bar.classList.add('countdown')
  pauseButton.disabled = true
  stopButton.disabled = true
  framesEl.textContent = 'Starting…'
  const deadlineMs = performance.now() + preTimerMs
  const updateCountdown = (): void => {
    if (!recording) return
    const remaining = countdownSecondsRemaining(deadlineMs, performance.now())
    if (remaining === 0) {
      startActiveRecording()
      return
    }
    timerEl.textContent = String(remaining)
  }
  updateCountdown()
  countdownTimer = window.setInterval(updateCountdown, 50)
}

function togglePause(): void {
  if (!recording || countingDown || finishing) return
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
  if (!recording || countingDown || finishing) return
  // Nothing captured (stopped instantly): just discard.
  if (frameCount === 0) {
    void window.capturoGif.cancelRecording()
    return
  }
  const stoppedAtMs = elapsedMs()
  finishing = true
  recording = false
  stopStream()
  pauseButton.disabled = true
  stopButton.disabled = true
  cancelButton.disabled = true
  timerEl.textContent = 'Encoding…'
  worker?.postMessage({ type: 'finish', timestampMs: stoppedAtMs })
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
  countingDown = false
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
