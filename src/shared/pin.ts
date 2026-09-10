import type { Rect } from './types'

export type PinResult = { opened: true } | { opened: false; error: string }
export type PinPayload = { png: Uint8Array; width: number; height: number }
export type CapturoPinApi = {
  initialize: () => Promise<PinPayload | null>
  ready: () => Promise<boolean>
  opacity: (value: number) => Promise<boolean>
  copy: () => Promise<boolean>
  close: () => Promise<void>
}

export const MAX_PINS = 8
export const MAX_PIN_PIXELS = 40_000_000
export const MAX_TOTAL_PIN_PIXELS = 80_000_000
export const PIN_BAR_HEIGHT = 40

export function pinBounds(width: number, height: number, work: Rect, density: number): Rect {
  const scale = Math.min(1 / Math.max(1, density), 720 / width, 480 / height,
    Math.max(1, work.width - 32) / width, Math.max(1, work.height - 72) / height)
  const w = Math.min(work.width, Math.max(320, Math.round(width * scale)))
  const h = Math.min(work.height, Math.max(140, Math.round(height * scale) + PIN_BAR_HEIGHT))
  return { x: Math.round(work.x + (work.width - w) / 2),
    y: Math.round(work.y + (work.height - h) / 2), width: w, height: h }
}
