import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const pickerCss = readFileSync(new URL('../src/renderer/picker.css', import.meta.url), 'utf8')
const pickerRenderer = readFileSync(new URL('../src/renderer/picker-live.ts', import.meta.url), 'utf8')
const pickerHtml = readFileSync(new URL('../src/renderer/picker.html', import.meta.url), 'utf8')
const pickerMain = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
const nativeHelper = readFileSync(new URL('../native/capturo-capture/main.cpp', import.meta.url), 'utf8')

describe('live picker transparency', () => {
  it('clears the root document, body, and hit canvas together', () => {
    // styles.css paints html and body navy for every ordinary Capturo page. Clearing only the
    // picker body leaves the root canvas opaque in packaged Windows builds, covering the entire
    // desktop even though the live sample underneath still works.
    expect(pickerCss).toMatch(
      /html,\s*\.picker-body,\s*\.picker-body #capture-canvas\s*\{[^}]*background:\s*transparent\s*!important/s
    )
  })
})

describe('live picker sampling continuity', () => {
  it('keeps the latest grid visible during movement but requires an exact grid to pick', () => {
    expect(pickerRenderer).toMatch(/function renderMagnifierFrame\(\)[\s\S]*?const current = sampled/)
    expect(pickerRenderer).toMatch(
      /async function pick\(\)[\s\S]*?sampled && sampled\.displayId === payload\.displayId &&[\s\S]*?samePoint\(sampled\.point, target\)/
    )
    expect(pickerRenderer).toMatch(/next\.displayId === payload\?\.displayId/)
  })

  it('bounds preview sampling and uploads each grid as one bitmap', () => {
    expect(pickerRenderer).toMatch(/pickerSampleDelay\(lastSampleStartedAt, performance\.now\(\)\)/)
    expect(pickerRenderer).toMatch(/sampleTimer = window\.setTimeout\(\(\) => void sampleNext\(\), delay\)/)
    expect(pickerRenderer).toMatch(/samplePixelsContext\.putImageData\(\s*new ImageData/)
    expect(pickerRenderer).toMatch(/apertureContext\.drawImage\(samplePixels/)
    expect(pickerRenderer).not.toMatch(/for \(let row = 0; row < grid\.cells; row\+\+\)/)
  })

  it('uses absolute screen positions so BrowserWindow recentering cannot corrupt pointer deltas', () => {
    expect(pickerRenderer).toMatch(/pointFromScreen\(event\.screenX, event\.screenY\)/)
    expect(pickerRenderer).toMatch(/const delta = pointDelta\(observedCursor, nextCursor\)/)
    expect(pickerRenderer).not.toMatch(/event\.movementX|event\.movementY/)
  })

  it('predicts the new floating origin before moving the native window', () => {
    expect(pickerRenderer).toMatch(
      /floatingRegionOrigin = point\.regionOrigin[\s\S]*?await paintBeforeWindowMove\(\)[\s\S]*?recenterPicker/
    )
    expect(pickerRenderer).toMatch(/floatingPickerRegionOrigin\(center, displayBounds\(\), FLOATING_PICKER_MAX_SIZE\)/)
    expect(pickerRenderer).not.toMatch(
      /function currentRegionOrigin\(\)[\s\S]{0,240}window\.screenX - payload\.displayOrigin\.x/
    )
    expect(pickerRenderer).toMatch(/x: active\.displayOrigin\.x \+ pointer\.point\.x \/ scale\.x/)
  })

  it('renders one cleared frame instead of moving a transparent DOM layer that can leave trails', () => {
    expect(pickerRenderer).toMatch(
      /function renderMagnifierFrame\(\)[\s\S]*?globalCompositeOperation = 'copy'[\s\S]*?fillRect\(0, 0, canvas\.width, canvas\.height\)/
    )
    expect(pickerRenderer).toMatch(/requestAnimationFrame\(renderMagnifierFrame\)/)
    expect(pickerRenderer).toMatch(
      /canvasContext\.drawImage\(aperture, placement\.x, placement\.y, MAGNIFIER_SIZE, MAGNIFIER_SIZE\)/
    )
    expect(pickerRenderer).not.toMatch(/magnifier\.style\.(?:left|top)/)
    expect(pickerHtml).not.toMatch(/id=["']magnifier["']/)
  })
})

describe('macOS live picker compatibility', () => {
  it('derives picker image dimensions without Electron screen conversion APIs unavailable on macOS', () => {
    expect(pickerMain).toMatch(
      /function buildPickerPayload[\s\S]*?const physical = displayPixelSize\(display\.size, display\.scaleFactor\)/
    )
    expect(pickerMain).toMatch(
      /async function fallbackColorSample[\s\S]*?const expected = displayPixelSize\(display\.size, display\.scaleFactor\)/
    )
  })
})

describe('live picker chrome', () => {
  it('does not display an invocation instruction popup', () => {
    expect(pickerHtml).not.toContain('Click to pick a color')
    expect(pickerHtml).not.toMatch(/id=["']hint["']/)
    expect(pickerRenderer).not.toMatch(/querySelector<HTMLElement>\(['"]#hint['"]\)/)
  })

  it('keeps the zoom-displaced selector inside the compact Windows surface', () => {
    expect(pickerRenderer).toContain('constrainPointerOffset')
    expect(pickerRenderer).toMatch(/SELECTOR_RECENTER_GUARD = 48/)
    expect(pickerRenderer).toMatch(
      /selectorClient\.x >= selectorMarginX[\s\S]*?selectorClient\.y <= window\.innerHeight - selectorMarginBottom/
    )
    expect(pickerRenderer).toMatch(/x: \(event\.screenX \+ selectorScreen\.x\) \/ 2/)
    expect(pickerRenderer).toMatch(/SELECTOR_BOTTOM_PADDING = MAGNIFIER_SIZE \/ 2 \+ 64/)
  })

  it('provides stepped wheel magnification without modifier-driven precision', () => {
    expect(pickerHtml).not.toMatch(/magnifier-(?:zoom|fine)/)
    expect(pickerRenderer).not.toMatch(/\.label|magnifierZoom|magnifierFine/)
    expect(pickerRenderer).toMatch(/addEventListener\('wheel', handleWheel, \{ passive: false \}\)/)
    expect(pickerRenderer).toMatch(/stepPickerZoomIndex\(zoomIndex, event\.deltaY\)/)
    expect(pickerRenderer).toMatch(/return activeZoom\(\)\.movementFactor/)
    expect(pickerRenderer).toMatch(/maxSpeed \* elapsedMs \/ 1000/)
    expect(pickerRenderer).not.toMatch(/event\.shiftKey|setFine|FINE_FACTOR/)
  })

  it('queues the newest recenter instead of dropping fast pointer positions', () => {
    expect(pickerRenderer).toMatch(/while \(pendingRecenter && payload\?\.sessionId === active\.sessionId\)/)
    expect(pickerRenderer).toMatch(
      /pendingRecenter = \{[\s\S]*?cursor: \{ x: event\.screenX, y: event\.screenY \}/
    )
  })


  it('renders the selector and hex caption at the display device-pixel ratio', () => {
    expect(pickerRenderer).toMatch(/Math\.round\(window\.innerWidth \* ratio\)/)
    expect(pickerRenderer).toMatch(/canvasContext\.setTransform\(ratio, 0, 0, ratio, 0, 0\)/)
    expect(pickerRenderer).toMatch(/apertureContext\.setTransform\(ratio, 0, 0, ratio, 0, 0\)/)
    expect(pickerRenderer).toMatch(
      /drawImage\(aperture, placement\.x, placement\.y, MAGNIFIER_SIZE, MAGNIFIER_SIZE\)/
    )
    expect(pickerRenderer).toContain('600 14px "Segoe UI"')
  })
})

describe('Windows video-plane compatibility', () => {
  it('uses one compact floating picker instead of monitor-sized transparent windows', () => {
    expect(pickerMain).toContain('FLOATING_PICKER_MAX_SIZE')
    expect(pickerMain).toMatch(
      /if \(isMac\)[\s\S]*?displayOverlayRegions\(display\)[\s\S]*?else \{[\s\S]*?floatingPickerRect\(cursor, display\.bounds, FLOATING_PICKER_MAX_SIZE\)[\s\S]*?true/
    )
    expect(pickerMain).toMatch(/ipcMain\.handle\('color:picker-recenter'/)
    expect(pickerMain).toMatch(/floatingPickerRect\(center, display\.bounds, FLOATING_PICKER_MAX_SIZE\)/)
    expect(pickerMain).toMatch(/const currentBounds = entry\.window\.getBounds\(\)/)
    expect(pickerMain).toMatch(/PICKER_ZOOM_LEVELS\.some\(\(level\) => level\.cells === size\)/)
    expect(pickerMain).toMatch(
      /overlay\.setContentProtection\(app\.isPackaged \|\| process\.env\.CAPTURO_PICKER_VISUAL_SMOKE !== '1'\)/
    )
    expect(pickerMain).toMatch(/setSystemCursorHidden\(true\)/)
    expect(pickerMain).toMatch(/setSystemCursorHidden\(false\)/)
    // The picker replaces the pointer with its own magnifier, so it is the one live tool that
    // suppresses the system cursor. ShowCursor's per-thread counter cannot do that from a helper.
    expect(nativeHelper).toContain('SetSystemCursor(transparent, cursorId)')
    expect(nativeHelper).toContain('SystemParametersInfoW(SPI_SETCURSORS')
    expect(nativeHelper).not.toContain('ShowCursor(')
  })
})
