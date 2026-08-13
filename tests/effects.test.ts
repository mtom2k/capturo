import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { blurRadiusForIntensity, pixelBlockForIntensity } from '../src/renderer/render'

describe('blur and pixelate intensity', () => {
  it('exposes a percentage Intensity control instead of an effect Size control', () => {
    const html = readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8')
    expect(html).toContain('<span>Intensity</span>')
    expect(html).toMatch(/id="effect-intensity"[^>]+min="1"[^>]+max="100"/)
    expect(html).toContain('<output id="effect-intensity-value">50%</output>')
  })

  it('maps the complete percentage range to useful rendering strengths', () => {
    expect(blurRadiusForIntensity(1)).toBe(1)
    expect(blurRadiusForIntensity(100)).toBe(32)
    expect(pixelBlockForIntensity(1)).toBe(2)
    expect(pixelBlockForIntensity(100)).toBe(64)
  })

  it('gets strictly stronger as the percentage increases', () => {
    const percentages = [1, 10, 25, 50, 75, 100]
    const blur = percentages.map(blurRadiusForIntensity)
    const pixelate = percentages.map(pixelBlockForIntensity)
    for (let index = 1; index < percentages.length; index += 1) {
      expect(blur[index]).toBeGreaterThan(blur[index - 1])
      expect(pixelate[index]).toBeGreaterThan(pixelate[index - 1])
    }
  })

  it('clamps invalid or out-of-range inputs', () => {
    expect(blurRadiusForIntensity(-20)).toBe(1)
    expect(blurRadiusForIntensity(Number.NaN)).toBe(blurRadiusForIntensity(50))
    expect(pixelBlockForIntensity(250)).toBe(64)
  })

  it('preserves visible strength at higher source-pixel scales', () => {
    expect(blurRadiusForIntensity(100, 2)).toBe(64)
    expect(pixelBlockForIntensity(100, 2)).toBe(128)
    expect(blurRadiusForIntensity(50, 0)).toBe(blurRadiusForIntensity(50, 1))
  })
})
