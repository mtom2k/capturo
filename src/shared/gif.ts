// Shared GIF types and pure helpers. Kept separate from the settings model so the recording
// renderer, the worker, and the main process share one definition. See D-018.

import type { Rect } from './types'

export const MIN_GIF_COLORS = 8
export const MAX_GIF_COLORS = 256
// Keep at most one frame executing and one waiting in the worker. When the encoder cannot
// sustain the requested sampling cadence, the recorder skips samples instead of building an
// unbounded queue of full-resolution RGBA buffers. Active timestamps preserve wall-clock time.
export const MAX_GIF_FRAMES_IN_FLIGHT = 2
export const GIF_CLIPBOARD_FILE_MAX_AGE_MS = 24 * 60 * 60 * 1000

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

export type GifPreviewPayload = {
  bytes: ArrayBuffer
  byteLength: number
}

export type GifPreviewActionResult = {
  ok: boolean
  canceled?: boolean
  filePath?: string
  error?: string
}

export type CapturoGifApi = {
  // Called by the selection overlay: the user chose a region and pressed Start Recording.
  // Resolves to whether recording was accepted.
  startRecording: (sessionId: string, region: Rect) => Promise<boolean>
  // Subscribed by the recording window to receive its crop, encoding settings, and pre-timer.
  onRecordInitialize: (listener: (payload: GifRecordPayload) => void) => () => void
  // Hands finished bytes to the main process, which replaces the recording chrome with the
  // post-recording preview. No file is written until the user chooses Save or Copy.
  showPreview: (bytes: ArrayBuffer) => Promise<boolean>
  onPreviewInitialize: (listener: (payload: GifPreviewPayload) => void) => () => void
  copyPreview: () => Promise<GifPreviewActionResult>
  savePreview: () => Promise<GifPreviewActionResult>
  openPreviewFolder: () => Promise<GifPreviewActionResult>
  retakePreview: () => Promise<void>
  discardPreview: () => Promise<void>
  // Called by the recording window to abandon the recording.
  cancelRecording: () => Promise<void>
}

export function hasGifSignature(bytes: ArrayBuffer | Uint8Array): boolean {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  if (view.byteLength < 6) return false
  const version = String.fromCharCode(...view.subarray(0, 6))
  return version === 'GIF87a' || version === 'GIF89a'
}

export function isExpiredGifClipboardFile(name: string, modifiedMs: number, nowMs = Date.now()): boolean {
  return name.startsWith('Capturo ') && name.endsWith('.gif') &&
    Number.isFinite(modifiedMs) && nowMs - modifiedMs > GIF_CLIPBOARD_FILE_MAX_AGE_MS
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
