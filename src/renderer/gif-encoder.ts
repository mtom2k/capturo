import { GIFEncoder, quantize, applyPalette } from 'gifenc'
import { frameDelayMs, paletteColorsForQuality } from '../shared/gif'

// Encodes a stream of RGBA frames into an animated GIF, one frame at a time so memory holds
// only the growing compressed output rather than every raw frame — this is what makes an
// unlimited-duration recording viable. Quality controls the palette size; FPS the frame
// delay. Pure enough to unit-test with synthetic frames. See D-018.
export class GifRecordingEncoder {
  private readonly encoder = GIFEncoder()
  private readonly colors: number
  private readonly delay: number
  private frames = 0
  private previous: Uint8Array | null = null

  constructor(
    private readonly width: number,
    private readonly height: number,
    fps: number,
    quality: number
  ) {
    this.colors = paletteColorsForQuality(quality)
    this.delay = frameDelayMs(fps)
  }

  // rgba is the frame's pixels, width*height*4 bytes. Each frame gets its own quantized
  // palette (accurate colour as content changes), and pixels identical to the previous frame
  // are written as a reserved transparent index with "do not dispose", so only what changed is
  // re-encoded. This is the main size win, especially for mostly-static content. See D-018.
  addFrame(rgba: Uint8Array): void {
    const first = this.frames === 0
    // Reserve one palette slot for transparency.
    const palette = quantize(rgba, Math.max(2, this.colors - 1))
    const index = applyPalette(rgba, palette)
    const transparentIndex = palette.length
    palette.push([0, 0, 0])

    if (this.previous) {
      const prev = this.previous
      for (let i = 0, p = 0; i < index.length; i += 1, p += 4) {
        if (rgba[p] === prev[p] && rgba[p + 1] === prev[p + 1] && rgba[p + 2] === prev[p + 2]) {
          index[i] = transparentIndex
        }
      }
    }

    this.encoder.writeFrame(index, this.width, this.height, {
      palette,
      delay: this.delay,
      transparent: true,
      transparentIndex,
      // 1 = leave the frame in place so the next frame's transparent (unchanged) pixels show
      // it through. The GIF loops forever (repeat 0), set once on the first frame.
      dispose: 1,
      repeat: first ? 0 : undefined
    })

    this.previous = rgba.slice()
    this.frames += 1
  }

  get frameCount(): number {
    return this.frames
  }

  finish(): Uint8Array {
    this.encoder.finish()
    return this.encoder.bytes()
  }
}
