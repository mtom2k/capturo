import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const main = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
const preload = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8')
const editor = readFileSync(new URL('../src/renderer/editor.ts', import.meta.url), 'utf8')
const editorHtml = readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8')
const recorder = readFileSync(new URL('../src/renderer/panoramic-record.ts', import.meta.url), 'utf8')
const recorderHtml = readFileSync(new URL('../src/renderer/scroll-record.html', import.meta.url), 'utf8')
const vite = readFileSync(new URL('../electron.vite.config.ts', import.meta.url), 'utf8')
const nativeHelper = readFileSync(new URL('../native/capturo-capture/main.cpp', import.meta.url), 'utf8')

describe('panoramic capture workflow', () => {
  it('packages the recorder and keeps every panoramic surface outside the crop', () => {
    expect(vite).toContain("'scroll-record': resolve('src/renderer/scroll-record.html')")
    expect(main).toContain('placeControlBarOutside(display, region')
    expect(main).toContain("scroll-record.html")
  })

  it('marks the selected viewport with an unprotected outline placed clear of the crop', () => {
    expect(main).toContain('openScrollingOutline(region)')
    expect(main).toContain('panoramicOutlineRect(region)')
    expect(main).toContain('solid rgba(56,189,248,0.9)')
    // The last argument is protectFromCapture: the outline must stay capturable, because a
    // content-protected window can stall the display-media stream this session reads.
    expect(main).toMatch(/openScrollingOutline[\s\S]{0,400}?false\n  \)/)
    expect(main).toContain('closeScrollingOutline()')
  })

  it('exposes one typed bridge and validates lifecycle in main', () => {
    expect(preload).toContain("ipcRenderer.invoke('scroll:start'")
    expect(preload).toContain("ipcRenderer.invoke('scroll:finish'")
    expect(main).toContain("ipcMain.handle('scroll:request-initialization'")
    expect(main).toContain("ipcMain.handle('scroll:finish'")
  })

  it('starts only from a selected screenshot viewport', () => {
    expect(editorHtml).toContain('id="scroll-capture"')
    expect(editor).toContain('window.capturoScroll.start(payload.sessionId, selection)')
    expect(main).toContain("active.mode !== 'screenshot'")
  })

  it('uses one direction-free action and shows a live captured-area map', () => {
    expect(main).not.toContain('Rolling capture direction')
    expect(main).not.toContain('Vertical — scroll down')
    expect(recorderHtml).toContain('id="preview"')
    expect(recorderHtml).toContain('./panoramic-record.ts')
    expect(recorder).toContain('choosePanoramicMovement(previousFrame, current')
    expect(recorder).toContain('historicalAlignmentScore(current, position')
    expect(recorder).toContain('if (historyDecision.anchored) return historyDecision.movement')
    expect(recorder).toContain('uncoveredPanoramicRects(exposure.world, capturedRects)')
    expect(recorder).toContain('refreshTrustedInterior(frameCanvas, current, movement)')
    expect(recorder).toContain('renderPreview()')
  })

  it('leaves the pointer visible and excludes it with a reported mask', () => {
    expect(recorder).toContain("cursor: 'never'")
    expect(recorder).toContain("track.applyConstraints({ cursor: 'never' }")
    // The user must keep seeing their own pointer inside the selected viewport, exactly as they
    // do during an ordinary capture. Nothing in the panoramic path may hide the system cursor.
    expect(main).not.toContain('startScrollingCursorGuard')
    expect(main).not.toContain('systemCursorHiddenForScrolling')
    expect(main).not.toContain('setSystemCursorHidden(hide)')
    expect(main).toContain('PANORAMIC_POINTER_RADIUS_DIP')
    expect(main).toContain('screen.getCursorScreenPoint()')
    expect(preload).toContain("ipcRenderer.invoke('scroll:cursor-position')")
    expect(recorder).toContain('cursorWorldRects(frame.width, frame.height)')
    expect(recorder).toContain('fillFinalCursorHole()')
    expect(nativeHelper).not.toContain('ShowCursor(')
    expect(recorder).toContain('requestVideoFrameCallback')
    expect(recorder).toContain('choosePanoramicMovement(previousFrame, current')
    expect(recorder).toContain('const addedArea = addExposure(frameCanvas, current, {')
    expect(recorder).toContain('rollingCaptureFits(prospectiveBounds.width, prospectiveBounds.height)')
    expect(recorder).toContain('if (rejectedFrames > 0)')
  })

  it('keeps internal pixel totals out of user-facing progress', () => {
    expect(recorder).not.toContain('px²')
    expect(recorder).not.toContain('Joining ${')
    expect(recorder).toContain('Finalizing the captured areas…')
  })
})

describe('panoramic capture on macOS', () => {
  it('offers the action on both platforms that can hold chrome outside a live crop', () => {
    expect(main).toContain("const panoramicCaptureSupported = process.platform === 'win32' || isMac")
    expect(main).toContain('rollingCaptureAvailable: panoramicCaptureSupported')
    expect(main).toContain('if (!panoramicCaptureSupported) {')
    // The old gate refused macOS outright, and the editor hid the button from its payload flag.
    expect(main).not.toContain("Panoramic capture is currently available on Windows only.")
    expect(main).not.toContain("rollingCaptureAvailable: process.platform === 'win32'")
  })

  // AppKit constrains an ordinary window to the visible frame, so a control bar requested over the
  // menu bar or the Dock is pushed back inside it -- possibly into the crop being recorded, which
  // this capturable chrome would then be stitched into. Asking against the work area is what makes
  // the placement one macOS will honour. See D-029 and D-042.
  it('places its control bar where macOS will not move it', () => {
    expect(main).toContain('return isMac ? display.workArea : display.bounds')
    expect(main).toContain('controlBarPlacementOutside(controlBarBounds(display), region, width, height)')
  })

  // The outline is drawn just outside the crop, so the same clamp would slide its painted band
  // into the output. Chrome windows opt out of it the way the capture overlays already do.
  it('keeps the viewport outline clear of that clamp too', () => {
    expect(main).toMatch(/enableLargerThanScreen: isMac,\n    webPreferences: \{ sandbox: true/)
  })
})
