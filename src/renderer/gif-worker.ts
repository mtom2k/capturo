// GIF encoding worker. Frames arrive as transferable RGBA buffers so the recording UI never
// blocks on quantization/encoding. See D-018.

import { GifRecordingEncoder } from './gif-encoder'

type StartMessage = { type: 'start'; width: number; height: number; fps: number; quality: number }
type FrameMessage = { type: 'frame'; data: ArrayBuffer; timestampMs: number }
type FinishMessage = { type: 'finish'; timestampMs: number }
type WorkerMessage = StartMessage | FrameMessage | FinishMessage

// tsconfig.web uses the DOM lib (not WebWorker), whose Window typing for `self` does not match
// a worker; a minimal local interface avoids the lib conflict.
interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null
  postMessage(message: unknown, transfer?: Transferable[]): void
}
const ctx = self as unknown as WorkerScope

let encoder: GifRecordingEncoder | null = null

ctx.onmessage = (event) => {
  const message = event.data
  if (message.type === 'start') {
    encoder = new GifRecordingEncoder(message.width, message.height, message.fps, message.quality)
  } else if (message.type === 'frame' && encoder) {
    encoder.addFrame(new Uint8Array(message.data), message.timestampMs)
  } else if (message.type === 'finish' && encoder) {
    const bytes = encoder.finish(message.timestampMs)
    const frames = encoder.frameCount
    // Copy out of the encoder's buffer so it can be transferred without detaching internals.
    const out = bytes.slice()
    encoder = null
    ctx.postMessage({ type: 'done', bytes: out.buffer, frames }, [out.buffer])
  }
}
