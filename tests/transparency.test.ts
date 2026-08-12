import { describe, expect, it } from 'vitest'
import { removeConnectedColor } from '../src/shared/transparency'

function image(width: number, height: number, colors: Array<[number, number, number]>): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  colors.forEach(([r, g, b], pixel) => {
    data[pixel * 4] = r
    data[pixel * 4 + 1] = g
    data[pixel * 4 + 2] = b
    data[pixel * 4 + 3] = 255
  })
  return data
}

function alphas(data: Uint8ClampedArray): number[] {
  return Array.from({ length: data.length / 4 }, (_value, pixel) => data[pixel * 4 + 3])
}

describe('connected background transparency', () => {
  it('removes only matching pixels connected to the chosen seed', () => {
    const white: [number, number, number] = [255, 255, 255]
    const black: [number, number, number] = [0, 0, 0]
    const data = image(5, 1, [white, white, black, white, white])
    removeConnectedColor(data, 5, 1, {
      seedX: 0,
      seedY: 0,
      target: { r: 255, g: 255, b: 255 },
      tolerance: 0,
      feather: 0
    })
    expect(alphas(data)).toEqual([0, 0, 255, 255, 255])
  })

  it('uses tolerance for nearby tones without crossing a non-matching boundary', () => {
    const data = image(4, 1, [[240, 240, 240], [228, 228, 228], [120, 120, 120], [240, 240, 240]])
    removeConnectedColor(data, 4, 1, {
      seedX: 0,
      seedY: 0,
      target: { r: 240, g: 240, b: 240 },
      tolerance: 6,
      feather: 0
    })
    expect(alphas(data)).toEqual([0, 0, 255, 255])
  })

  it('softens the removal boundary when feathering is enabled', () => {
    const white: [number, number, number] = [255, 255, 255]
    const black: [number, number, number] = [0, 0, 0]
    const data = image(5, 1, [white, white, white, black, black])
    removeConnectedColor(data, 5, 1, {
      seedX: 0,
      seedY: 0,
      target: { r: 255, g: 255, b: 255 },
      tolerance: 0,
      feather: 1
    })
    const result = alphas(data)
    expect(result[0]).toBe(0)
    expect(result[2]).toBeGreaterThan(0)
    expect(result[2]).toBeLessThan(255)
    expect(result[3]).toBeGreaterThan(0)
    expect(result[3]).toBeLessThan(255)
    expect(result[4]).toBe(255)
  })
})
