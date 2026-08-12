import type { RgbColor } from './types'

export type ConnectedTransparencyOptions = {
  seedX: number
  seedY: number
  target: RgbColor
  tolerance: number
  feather: number
}

function perceptualDistanceSquared(r: number, g: number, b: number, target: RgbColor): number {
  const dr = r - target.r
  const dg = g - target.g
  const db = b - target.b
  // Rec. 709 weights make equal numeric changes track perceived brightness more closely
  // than a plain RGB distance. Keep it squared so a large flood fill avoids one square root
  // per examined pixel; the UI threshold is squared once below for the same comparison.
  return 0.2126 * dr * dr + 0.7152 * dg * dg + 0.0722 * db * db
}

function blurMask(mask: Uint8ClampedArray, width: number, height: number, radius: number): Uint8ClampedArray {
  const horizontal = new Uint8ClampedArray(mask.length)
  const blurred = new Uint8ClampedArray(mask.length)

  for (let y = 0; y < height; y++) {
    const row = y * width
    let sum = 0
    for (let x = 0; x < Math.min(width, radius + 1); x++) sum += mask[row + x]
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - radius)
      const right = Math.min(width - 1, x + radius)
      horizontal[row + x] = Math.round(sum / (right - left + 1))
      const leaving = x - radius
      const entering = x + radius + 1
      if (leaving >= 0) sum -= mask[row + leaving]
      if (entering < width) sum += mask[row + entering]
    }
  }

  for (let x = 0; x < width; x++) {
    let sum = 0
    for (let y = 0; y < Math.min(height, radius + 1); y++) sum += horizontal[y * width + x]
    for (let y = 0; y < height; y++) {
      const top = Math.max(0, y - radius)
      const bottom = Math.min(height - 1, y + radius)
      blurred[y * width + x] = Math.round(sum / (bottom - top + 1))
      const leaving = y - radius
      const entering = y + radius + 1
      if (leaving >= 0) sum -= horizontal[leaving * width + x]
      if (entering < height) sum += horizontal[entering * width + x]
    }
  }

  return blurred
}

/**
 * Removes only the tolerance-matching component connected to the seed. The RGBA buffer is
 * changed in place and returned for convenient use with ImageData and unit tests.
 */
export function removeConnectedColor(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options: ConnectedTransparencyOptions
): Uint8ClampedArray {
  if (width < 1 || height < 1 || data.length < width * height * 4) return data
  const seedX = Math.max(0, Math.min(width - 1, Math.round(options.seedX)))
  const seedY = Math.max(0, Math.min(height - 1, Math.round(options.seedY)))
  const threshold = Math.max(0, Math.min(100, options.tolerance))
  const thresholdSquared = (threshold / 100 * 255) ** 2
  const mask = new Uint8ClampedArray(width * height)
  const visited = new Uint8Array(width * height)
  const queue = new Int32Array(width * height)
  let head = 0
  let tail = 0
  const seed = seedY * width + seedX
  queue[tail++] = seed
  visited[seed] = 1

  while (head < tail) {
    const pixel = queue[head++]
    const offset = pixel * 4
    if (perceptualDistanceSquared(data[offset], data[offset + 1], data[offset + 2], options.target) > thresholdSquared) {
      continue
    }
    mask[pixel] = 255
    const x = pixel % width
    const y = Math.floor(pixel / width)
    if (x > 0 && visited[pixel - 1] === 0) {
      visited[pixel - 1] = 1
      queue[tail++] = pixel - 1
    }
    if (x + 1 < width && visited[pixel + 1] === 0) {
      visited[pixel + 1] = 1
      queue[tail++] = pixel + 1
    }
    if (y > 0 && visited[pixel - width] === 0) {
      visited[pixel - width] = 1
      queue[tail++] = pixel - width
    }
    if (y + 1 < height && visited[pixel + width] === 0) {
      visited[pixel + width] = 1
      queue[tail++] = pixel + width
    }
  }

  const radius = Math.max(0, Math.min(10, Math.round(options.feather)))
  const alphaMask = radius > 0 ? blurMask(mask, width, height, radius) : mask
  for (let pixel = 0; pixel < alphaMask.length; pixel++) {
    const removal = alphaMask[pixel]
    if (removal === 0) continue
    const alphaOffset = pixel * 4 + 3
    data[alphaOffset] = Math.round(data[alphaOffset] * (255 - removal) / 255)
  }
  return data
}
