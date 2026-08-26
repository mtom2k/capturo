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
