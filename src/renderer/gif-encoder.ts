import { GIFEncoder, quantize, applyPalette, type GifPalette } from 'gifenc'
import { frameDelayMs, paletteColorsForQuality } from '../shared/gif'

// A GIF per-frame delay is a 16-bit centisecond value, so it cannot exceed 65535 cs. Coalescing
// a long static run into one frame accumulates delay, so cap it here to avoid a wraparound. A
// static span longer than this (~10.9 min) simply loops a hair early, which is imperceptible.
const MAX_FRAME_DELAY_MS = 65535 * 10

// Encodes a stream of RGBA frames into an animated GIF, one frame at a time so memory holds
// only the growing compressed output rather than every raw frame — this is what makes an
// unlimited-duration recording viable. Quality controls the palette size; FPS the frame
// delay. Pure enough to unit-test with synthetic frames. See D-018.
//
// Frames are written with a one-frame lag: the most recent distinct frame is held pending
// rather than written immediately, so a run of frames identical to it is coalesced by extending
// that pending frame's delay instead of emitting a new full-palette frame each tick. This drops
// the per-frame palette and header overhead for static content on top of the transparent-pixel
// differencing below. See D-018.
export class GifRecordingEncoder {
  private readonly encoder = GIFEncoder()
  private readonly colors: number
  private readonly delay: number
  private framesWritten = 0

  // The most recent distinct frame, built but not yet written so its delay can still grow.
  private pending: {
    raw: Uint8Array
    index: Uint8Array
    palette: GifPalette
    transparentIndex: number
    delay: number
  } | null = null

  constructor(
    private readonly width: number,
    private readonly height: number,
    fps: number,
    quality: number
  ) {
    this.colors = paletteColorsForQuality(quality)
    this.delay = frameDelayMs(fps)
  }

  // rgba is the frame's pixels, width*height*4 bytes. A frame identical to the pending one just
  // extends its delay (coalescing). A distinct frame gets its own quantized palette (accurate
  // colour as content changes); pixels identical to the previously displayed frame are written
  // as a reserved transparent index with "do not dispose", so only what changed is re-encoded.
  // This is the main size win, especially for mostly-static content. See D-018.
  addFrame(rgba: Uint8Array): void {
    if (this.pending && this.sameColour(rgba, this.pending.raw)) {
      this.pending.delay = Math.min(MAX_FRAME_DELAY_MS, this.pending.delay + this.delay)
      return
    }

    // Reserve one palette slot for transparency.
    const palette = quantize(rgba, Math.max(2, this.colors - 1))
    const index = applyPalette(rgba, palette)
    const transparentIndex = palette.length
    palette.push([0, 0, 0])

    // Difference against the previously displayed frame — the pending one, which is about to be
    // written as this frame's predecessor.
    if (this.pending) {
      const prev = this.pending.raw
      for (let i = 0, p = 0; i < index.length; i += 1, p += 4) {
        if (rgba[p] === prev[p] && rgba[p + 1] === prev[p + 1] && rgba[p + 2] === prev[p + 2]) {
          index[i] = transparentIndex
        }
      }
      this.flushPending()
    }

    this.pending = { raw: rgba.slice(), index, palette, transparentIndex, delay: this.delay }
  }

  // Writes the held frame to the encoder. repeat:0 (loop forever) is set once, on the first
  // frame actually written; dispose:1 leaves the frame in place so the next frame's transparent
  // (unchanged) pixels show it through.
  private flushPending(): void {
    if (!this.pending) return
    const { index, palette, transparentIndex, delay } = this.pending
    this.encoder.writeFrame(index, this.width, this.height, {
      palette,
      delay,
      transparent: true,
      transparentIndex,
      dispose: 1,
      repeat: this.framesWritten === 0 ? 0 : undefined
    })
    this.framesWritten += 1
  }

  private sameColour(a: Uint8Array, b: Uint8Array): boolean {
    for (let p = 0; p < a.length; p += 4) {
      if (a[p] !== b[p] || a[p + 1] !== b[p + 1] || a[p + 2] !== b[p + 2]) return false
    }
    return true
  }

  // The number of frames written to the GIF, which is at most the number of frames added:
  // coalesced identical runs collapse into a single written frame.
  get frameCount(): number {
    return this.framesWritten + (this.pending ? 1 : 0)
  }

  finish(): Uint8Array {
    this.flushPending()
    this.pending = null
    this.encoder.finish()
    return this.encoder.bytes()
  }
}
