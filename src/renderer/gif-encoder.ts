import { GIFEncoder, quantize, applyPalette, type GifPalette } from 'gifenc'
import { frameDelayMs, paletteColorsForQuality } from '../shared/gif'

// GIF stores each frame delay as an unsigned 16-bit centisecond value.
const MAX_FRAME_DELAY_CS = 65535
// Sparse desktop motion is the common case. Below this ratio, palette work is performed only
// for changed pixels; above it, the existing full-frame path avoids large scratch copies.
const SPARSE_FRAME_MAX_CHANGED_RATIO = 0.25

export type GifFrameStrategy = 'coalesced' | 'sparse' | 'full'

// Encodes a stream of RGBA frames into an animated GIF, one frame at a time so memory holds
// only the growing compressed output rather than every raw frame. This is what makes long
// recordings viable. Quality controls the palette size. Frame timing comes
// from active recording timestamps supplied by the recorder, rather than assuming the renderer
// kept up with its requested sampling interval. Pure enough to unit-test with synthetic frames.
// See D-018.
//
// Frames are written with a one-frame lag: the most recent distinct frame is held pending
// rather than written immediately, so a run of frames identical to it is coalesced by extending
// that pending frame's delay instead of emitting a new full-palette frame each tick. This drops
// the per-frame palette and header overhead for static content on top of the transparent-pixel
// differencing below. See D-018.
export class GifRecordingEncoder {
  private readonly encoder = GIFEncoder()
  private readonly colors: number
  private readonly nominalDelay: number
  private readonly pixelCount: number
  private readonly sparsePixelLimit: number
  private readonly changedPixels: Uint8Array
  private readonly changedPositions: Uint32Array
  private framesWritten = 0
  private lastTimestampMs: number | null = null
  // GIF can only store whole centiseconds. Carry each rounding remainder into the next frame so
  // rates such as 30 fps alternate 30/40 ms instead of rounding every frame down to 30 ms.
  private delayCarryMs = 0

  // The most recent distinct frame, built but not yet written so its delay can still grow.
  private pending: {
    raw: Uint8Array
    index: Uint8Array
    palette: GifPalette
    transparentIndex: number
    durationMs: number
  } | null = null

  constructor(
    private readonly width: number,
    private readonly height: number,
    fps: number,
    quality: number
  ) {
    this.colors = paletteColorsForQuality(quality)
    this.nominalDelay = frameDelayMs(fps)
    this.pixelCount = width * height
    this.sparsePixelLimit = Math.max(1, Math.floor(this.pixelCount * SPARSE_FRAME_MAX_CHANGED_RATIO))
    this.changedPixels = new Uint8Array(this.sparsePixelLimit * 4)
    this.changedPositions = new Uint32Array(this.sparsePixelLimit)
  }

  // rgba is the frame's pixels, width*height*4 bytes. A frame identical to the pending one just
  // extends its delay (coalescing). A distinct frame gets its own quantized palette (accurate
  // colour as content changes); pixels identical to the previously displayed frame are written
  // as a reserved transparent index with "do not dispose", so only what changed is re-encoded.
  // This is the main size win, especially for mostly-static content. See D-018.
  addFrame(rgba: Uint8Array, timestampMs?: number): GifFrameStrategy {
    const timestamp = this.resolveTimestamp(timestampMs)
    if (this.pending && this.lastTimestampMs !== null) {
      // A sampled frame describes what should be displayed from its sample time until the next
      // sample. Therefore the newly observed elapsed time belongs to the frame already pending.
      this.pending.durationMs += timestamp - this.lastTimestampMs
    }

    const previous = this.pending?.raw ?? null
    const sparseChanges = previous ? this.collectSparseChanges(rgba, previous) : -1
    if (sparseChanges === 0) {
      this.lastTimestampMs = timestamp
      return 'coalesced'
    }

    const frame = previous && sparseChanges > 0
      ? this.indexSparseFrame(sparseChanges)
      : this.indexFullFrame(rgba, previous)

    if (this.pending) this.flushPending()

    // On the first sample, cover the small span from recording start to that sample with the
    // first captured image. Later distinct samples start with zero duration; their duration is
    // learned when the next sample (or Stop) supplies a timestamp.
    this.pending = {
      raw: rgba.slice(),
      index: frame.index,
      palette: frame.palette,
      transparentIndex: frame.transparentIndex,
      durationMs: this.lastTimestampMs === null ? timestamp : 0
    }
    this.lastTimestampMs = timestamp
    return sparseChanges > 0 ? 'sparse' : 'full'
  }

  // Returns 0 for an identical frame, a positive changed-pixel count for a sparse frame, and -1
  // once the sparse threshold is exceeded. The early -1 keeps widespread motion on the normal
  // full-frame path without allocating or copying an entire second representation.
  private collectSparseChanges(rgba: Uint8Array, previous: Uint8Array): number {
    let changed = 0
    for (let pixel = 0, p = 0; pixel < this.pixelCount; pixel += 1, p += 4) {
      if (rgba[p] === previous[p] && rgba[p + 1] === previous[p + 1] && rgba[p + 2] === previous[p + 2]) continue
      if (changed >= this.sparsePixelLimit) return -1
      this.changedPositions[changed] = pixel
      const target = changed * 4
      this.changedPixels[target] = rgba[p]
      this.changedPixels[target + 1] = rgba[p + 1]
      this.changedPixels[target + 2] = rgba[p + 2]
      this.changedPixels[target + 3] = rgba[p + 3]
      changed += 1
    }
    return changed
  }

  private indexSparseFrame(changed: number): {
    index: Uint8Array
    palette: GifPalette
    transparentIndex: number
  } {
    // gifenc currently reads the complete backing ArrayBuffer, so slice to an exact buffer rather
    // than passing a subarray of the reusable sparse scratch space.
    const pixels = this.changedPixels.slice(0, changed * 4)
    const palette = quantize(pixels, Math.max(2, this.colors - 1))
    const changedIndex = applyPalette(pixels, palette)
    const transparentIndex = palette.length
    palette.push([0, 0, 0])

    const index = new Uint8Array(this.pixelCount)
    index.fill(transparentIndex)
    for (let changedPixel = 0; changedPixel < changed; changedPixel += 1) {
      index[this.changedPositions[changedPixel]] = changedIndex[changedPixel]
    }
    return { index, palette, transparentIndex }
  }

  private indexFullFrame(rgba: Uint8Array, previous: Uint8Array | null): {
    index: Uint8Array
    palette: GifPalette
    transparentIndex: number
  } {
    const palette = quantize(rgba, Math.max(2, this.colors - 1))
    const index = applyPalette(rgba, palette)
    const transparentIndex = palette.length
    palette.push([0, 0, 0])

    if (previous) {
      for (let i = 0, p = 0; i < index.length; i += 1, p += 4) {
        if (rgba[p] === previous[p] && rgba[p + 1] === previous[p + 1] && rgba[p + 2] === previous[p + 2]) {
          index[i] = transparentIndex
        }
      }
    }
    return { index, palette, transparentIndex }
  }

  // Writes the held frame to the encoder. repeat:0 (loop forever) is set once, on the first
  // frame actually written; dispose:1 leaves the frame in place so the next frame's transparent
  // (unchanged) pixels show it through.
  private flushPending(): void {
    if (!this.pending) return
    const { index, palette, transparentIndex, durationMs } = this.pending
    let remainingCs = this.quantizeDelay(durationMs)

    // A single GIF delay tops out at 655.35 seconds. Split a longer static run into repeated
    // frames instead of clamping it and silently shortening the recording.
    while (remainingCs > 0) {
      const delayCs = Math.min(MAX_FRAME_DELAY_CS, remainingCs)
      this.encoder.writeFrame(index, this.width, this.height, {
        palette,
        delay: delayCs * 10,
        transparent: true,
        transparentIndex,
        dispose: 1,
        repeat: this.framesWritten === 0 ? 0 : undefined
      })
      this.framesWritten += 1
      remainingCs -= delayCs
    }
  }

  private resolveTimestamp(timestampMs?: number): number {
    const fallback = this.lastTimestampMs === null ? 0 : this.lastTimestampMs + this.nominalDelay
    const requested = typeof timestampMs === 'number' && Number.isFinite(timestampMs)
      ? Math.max(0, timestampMs)
      : fallback
    return this.lastTimestampMs === null ? requested : Math.max(this.lastTimestampMs, requested)
  }

  private quantizeDelay(durationMs: number): number {
    const withCarry = Math.max(0, durationMs) + this.delayCarryMs
    const centiseconds = Math.max(1, Math.round(withCarry / 10))
    this.delayCarryMs = withCarry - centiseconds * 10
    return centiseconds
  }

  // The number of frames written to the GIF, which is at most the number of frames added:
  // coalesced identical runs collapse into a single written frame.
  get frameCount(): number {
    return this.framesWritten + (this.pending ? 1 : 0)
  }

  finish(timestampMs?: number): Uint8Array {
    if (this.pending && this.lastTimestampMs !== null) {
      const endTimestamp = timestampMs === undefined
        ? this.lastTimestampMs + this.nominalDelay
        : this.resolveTimestamp(timestampMs)
      this.pending.durationMs += endTimestamp - this.lastTimestampMs
      this.lastTimestampMs = endTimestamp
    }
    this.flushPending()
    this.pending = null
    this.encoder.finish()
    return this.encoder.bytes()
  }
}
