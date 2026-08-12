// Shared GIF types and pure helpers. Kept separate from the settings model so the recording
// renderer, the worker, and the main process share one definition. See D-018.

import type { Rect } from './types'

export const MIN_GIF_COLORS = 8
export const MAX_GIF_COLORS = 256
// Keep at most one frame executing and one waiting in the worker. When the encoder cannot
// sustain the requested sampling cadence, the recorder skips samples instead of building an
// unbounded queue of full-resolution RGBA buffers. Active timestamps preserve wall-clock time.
export const MAX_GIF_FRAMES_IN_FLIGHT = 2

// A crop rectangle expressed as fractions (0-1) of the recorded display, so it is resolution
// independent between the frozen selection image and the live capture stream.
export type CropRect = { x: number; y: number; width: number; height: number }

// Sent to the recording window once it opens: what to crop from the display stream, and how
// to encode it.
export type GifRecordPayload = {
  crop: CropRect
  fps: number
  quality: number
  // Active capture begins only after this user-visible countdown completes.
  preTimerSeconds: number
  // Hides frame sampling and encoding totals from the recording HUD when false.
  showFrameCount: boolean
  // Smoke-test only: auto-stop after this many milliseconds.
  autoStopMs?: number
}

export type GifSaveResult = { saved: boolean; canceled: boolean; filePath?: string }

export type CapturoGifApi = {
  // Called by the selection overlay: the user chose a region and pressed Start Recording.
  // Resolves to whether recording was accepted.
  startRecording: (sessionId: string, region: Rect) => Promise<boolean>
  // Subscribed by the recording window to receive its crop, encoding settings, and pre-timer.
  onRecordInitialize: (listener: (payload: GifRecordPayload) => void) => () => void
  // Called by the recording window with the finished GIF bytes; main saves (and copies).
  saveRecording: (bytes: ArrayBuffer) => Promise<GifSaveResult>
  // Called by the recording window to abandon the recording.
  cancelRecording: () => Promise<void>
}

// Quality (1-100) maps to GIF palette size — fewer colours means smaller files. The GIF keeps
// the region's native resolution regardless (see D-018).
export function paletteColorsForQuality(quality: number): number {
  const q = Math.min(100, Math.max(1, Math.round(quality)))
  const colors = Math.round((q / 100) * MAX_GIF_COLORS)
  return Math.min(MAX_GIF_COLORS, Math.max(MIN_GIF_COLORS, colors))
}

// Nominal sampling interval in milliseconds for a given frame rate. Live recordings carry
// actual active-elapsed timestamps; the encoder uses this only as a fallback for synthetic or
// timestamp-free callers.
export function frameDelayMs(fps: number): number {
  return Math.max(1, Math.round(1000 / Math.max(1, fps)))
}

// User-facing whole seconds remaining for an absolute countdown deadline. Keeping this pure
// makes boundary behavior deterministic and testable while the renderer owns the timer itself.
export function countdownSecondsRemaining(deadlineMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000))
}

export function canQueueGifFrame(
  framesInFlight: number,
  limit = MAX_GIF_FRAMES_IN_FLIGHT
): boolean {
  return Number.isFinite(framesInFlight) && framesInFlight >= 0 && framesInFlight < Math.max(1, limit)
}
