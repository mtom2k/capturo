import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const helper = readFileSync(new URL('../native/capturo-capture/main.cpp', import.meta.url), 'utf8')
const main = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
const helperBridge = readFileSync(new URL('../src/main/capture-helper.ts', import.meta.url), 'utf8')

// The SDR white level divides the entire frame, so every way of getting it wrong shows up as a
// washed, over-saturated capture. These pin the ordering that keeps a transient Windows failure
// from silently rescaling an image. See D-015 and D-038.
describe('HDR white level resolution', () => {
  it('retries the display-configuration query instead of guessing after one failure', () => {
    // GetDisplayConfigBufferSizes and QueryDisplayConfig are a pair and the topology can change
    // between them; Windows answers ERROR_INSUFFICIENT_BUFFER, and build 26200 has been seen
    // answering ERROR_GEN_FAILURE. Both are transient.
    expect(helper).toMatch(/for \(int attempt = 0; attempt < 4; \+\+attempt\)/)
    expect(helper).toContain('ERROR_INSUFFICIENT_BUFFER')
    expect(helper).toContain('ERROR_GEN_FAILURE')
  })

  it('rejects an implausible level rather than rescaling the frame by it', () => {
    expect(helper).toMatch(/nits >= 40\.0f && nits <= 1000\.0f \? nits : 0\.0f/)
  })

  it('prefers a measured level, then the last measured one, and only then the guess', () => {
    expect(helper).toContain('float ResolveSdrWhiteNits(OutputCapture& oc, CaptureResult& r)')
    expect(helper).toContain('oc.lastGoodSdrWhiteNits = queried')
    expect(helper).toMatch(/if \(oc\.lastGoodSdrWhiteNits > 0\.0f\) \{\s*r\.whiteLevelSource = "cached"/)
    expect(helper).toContain('r.whiteLevelSource = "fallback"')
    // Neither capture path may reach for the compiled-in guess on its own again.
    expect(helper).not.toMatch(/whiteLevelQueried\s*=\s*nits > 0\.0f;\s*\n\s*if \(!r\.whiteLevelQueried\) nits = kFallbackSdrWhiteNits/)
  })

  it('reports where the level came from so a bad frame can be explained', () => {
    expect(helper).toContain('\\"whiteLevelSource\\":\\"%s\\"')
    expect(helperBridge).toContain('whiteLevelSource?: string')
  })
})

describe('HDR capture fallback visibility', () => {
  it('never falls back to Chromium capture silently', () => {
    // The fallback cannot tone map an HDR display, so an unreported fallback is indistinguishable
    // from the HDR handling having broken.
    expect(main).toContain('capture helper did not serve display')
    expect(main).toContain('cannot tone map HDR')
  })

  it('flags an HDR frame whose white level was not measured for that capture', () => {
    expect(main).toContain("result.whiteLevelSource !== 'queried'")
    expect(main).toContain('did not report its SDR white level')
  })

  it('logs the colour path alongside the timings', () => {
    expect(main).toContain('sdr white ${result.sdrWhiteNits ?? \'?\'} nits')
  })
})

describe('HDR tone mapping', () => {
  it('keeps one shared scale so hue and chroma survive', () => {
    // Scaling channels independently drives every bright channel toward 1.0 and is itself a
    // source of falsely saturated output.
    expect(helper).toMatch(/const float peak = std::max\(\{ red, green, blue \}\);/)
    expect(helper).toMatch(/const float scale = 1\.0f \/ peak;/)
    expect(helper).toContain('if (peak <= 1.0f) return;')
  })

  it('matches the output it means by an exact origin', () => {
    expect(helper).toContain('d.DesktopCoordinates.left == ox && d.DesktopCoordinates.top == oy')
    // A tolerance was tried and removed: a near match selects an output DuplicateOutput1 refuses.
    expect(helper).not.toContain('kOriginMatchTolerance')
  })
})
