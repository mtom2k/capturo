# Project State

Last updated: 2026-08-11

## Phase

`0.13.0` is the last released build. GIF capture shipped: a region is selected, recorded live, and saved as an animated GIF, with a content-protected control bar, border, and shade, and with identical-frame coalescing on top of the transparent-pixel differencing. Current `main` contains unreleased follow-up work: playback timing follows actual active sample timestamps, and GIF recording has a configurable 0-10 second pre-timer that defaults to 3 seconds. Copy-to-clipboard was deliberately deferred past 0.13.0 (see the to-do list below). The official Windows release publishes the NSIS installer only; local packaging also produces a portable executable.

## Current build

The package version remains `0.13.0` while the timing and pre-timer changes sit under **Unreleased**. Windows artifacts live in `release/`, described by `release/BUILD-INFO.txt`; local artifacts may therefore contain newer source than the published tag despite carrying the same package version. The running app shows its package version in the tray tooltip and tray menu. The published GitHub release is `v0.13.0` (installer only).

`0.1.0` through `0.11.0` are superseded. `0.1.0` was never released, and the duplicate `release-update/` directory has been deleted.

## Completed 0.9.0 milestone

`0.9.0` - the complete local capture, annotation, copy, and save workflow, HDR-correct native capture, and a minimal tray-opened settings window: save format (PNG/JPEG) with JPEG quality, a post-capture notification toggle, and a rebindable capture shortcut, plus a placeholder GIF tab for a future feature.

## Functional checklist

- [x] Tray icon starts capture
- [x] Global shortcut starts capture
- [x] Multi-display overlays and single-display claim
- [x] Region selection, move, and resize
- [x] Clipboard copy and native Save As
- [x] Escape cancellation
- [x] Pen with smoothing and modifier-axis lock
- [x] Line and arrow
- [x] Rectangle and ellipse
- [x] Numbered steps
- [x] Pixel sliders for stroke width and numbered-step size
- [x] Text with font family, size, bold, and italic
- [x] Existing-object selection, movement, resizing, deletion, and property editing
- [x] Blur and pixelate
- [x] Color palette
- [x] Contextual customization bar below the primary toolbar
- [x] Paint-gated, flash-free overlay presentation
- [x] Animation-free capture transition
- [x] Tiled overlays cover the whole display, taskbar included, without triggering Do Not Disturb
- [x] Pixel-exact selection and export on scaled displays
- [x] Version visible from the tray
- [x] Undo
- [x] Tray-opened settings window with Capture and GIF tabs
- [x] Save as PNG or JPEG with a JPEG quality control (save-only; clipboard stays lossless)
- [x] Post-capture notification toggle
- [x] Rebindable capture shortcut with conflict fallback
- [x] Settings persisted to `userData/settings.json` (no captured pixels)
- [x] GIF: tray New GIF item and rebindable GIF shortcut open region selection
- [x] GIF: record a region live (cursor included) and save a valid, correctly-cropped `.gif`
- [x] GIF: inter-frame differencing keeps files small (static content ~30x smaller)
- [x] GIF: runs of identical frames coalesce into a single written frame (delay extended)
- [x] GIF: content-protected control bar, border ring, and shade (absent from the capture)
- [x] GIF: FPS and quality settings, persisted
- [x] GIF: configurable 0-10 second pre-timer before active capture (default 3 seconds)
- [x] GIF: playback duration follows active sample timestamps, with unbiased centisecond rounding and no long-static-run truncation
- [x] GIF: encoder backpressure caps transferred raw frames at two and reports skipped/finalizing progress
- [x] GIF: localized changes quantize/map only changed pixels, with a 25% full-frame fallback threshold
- [ ] GIF: copy the finished GIF to the clipboard — deferred past 0.13.0 (per-platform work; see To do)
- [ ] GIF: interactive GUI smoke on Windows (drag-select, Pause/Resume/Stop, shade/border look)
- [x] Windows smoke test (through 0.6.0)
- [ ] Settings GUI smoke test on Windows
- [ ] macOS smoke test
- [x] Windows packages
- [ ] Signed/notarized macOS packages

## Verification record

- `npm run typecheck`: passed
- `npm test`: 53/53 passed
- `npm run build`: passed
- `npm run dist:win`: passed; distinct NSIS and portable x64 artifacts produced
- Windows desktop smoke: passed on a scaled, multi-display Windows 11 desktop
  - full-screen frozen overlay and selection hint rendered
  - region label and compact toolbar rendered at scaled DPI
  - selecting one display reduced two overlay renderers to one
  - pen input rendered on the source-pixel canvas
  - `Ctrl+C` exported the exact `988 x 620` selected bitmap to the clipboard
  - copy closed the renderer while leaving the tray process resident
- 2026-08-04 regression pass:
  - text entry and `Ctrl+Enter` commit rendered correctly
  - rectangle hit-testing, movement, eight-handle resizing, and live color editing passed
  - crop-frame movement left rectangle and text coordinates unchanged
  - numbered step rendered with a white outside border
  - tray now loads a packaged, non-empty 16 px PNG instead of a runtime SVG data URL
  - contextual controls render beneath the primary tool row
  - numbered-step dropdown exposes Small, Medium, and Large and remains editable after placement
  - a 60 fps startup recording analyzed 156 invocation frames with no near-black frame; luminance varied by only 0.119 after paint-gated presentation
- 2026-08-06 `0.2.0` pass:
  - the 2026-08-04 luminance check above was not sufficient. It measured average brightness, which barely moves while the same desktop image scales, so it passed a build that still animated visibly
  - re-measured with consecutive-frame differencing at 60 fps: the capture transition was 13 animated frames (217 ms) with a smoothly decaying tail, confirming a window-open animation
  - after revealing the overlay by opacity instead of by showing it, the same measurement gives 1 frame (17 ms) with zero motion on either side, in both the development build and the packaged `0.2.0` binary
  - packaged `release/win-unpacked/Capturo.exe` drag, `Ctrl+C`, clipboard write, session teardown, and resident tray all verified
  - overlay confirmed not click-through after reveal (`WS_EX_TRANSPARENT` clear), so `setIgnoreMouseEvents` cannot strand an invisible window over the desktop
- 2026-08-06 `0.3.0` pass:
  - measured the overlay viewport against the display it covers: requested 2560 x 1440 DIP, actually got 2565 x 1395, with a renderer viewport of 2564 x 1394 against a work area of 2560 x 1392. Windows had clamped the construction size
  - captured a full-resolution frame mid-capture and saw two taskbars: the frozen desktop's taskbar squashed above the live taskbar showing through below the overlay's bottom edge
  - compared seven window configurations; re-applying `setBounds(display.bounds)` after the window exists gives an exact viewport match, while `setFullScreen` and `transparent: true` do not
  - after the fix, drags of 700 x 500, 500 x 800, and 3400 x 1950 export at exactly those sizes. The last extends to y=2100, inside the region the taskbar previously made unreachable
  - alignment verified, not just size: exported pixels are SSIM 1.000000 against the same rectangle cropped from the frozen overlay. The comparison was validated by controls at 4, 16, and 48 px offsets, which score 0.64, 0.56, and 0.46
  - capture transition re-measured after the change and still resolves in a single 60 fps frame
- 2026-08-06 `0.4.0` pass:
  - covering the display made Windows classify the overlay as a full-screen application, which switched on Do Not Disturb for the length of every capture. `SHQueryUserNotificationState` read `QUNS_BUSY` while the overlay was up and `QUNS_ACCEPTS_NOTIFICATIONS` otherwise
  - the classification is geometric only. It was unchanged by removing always-on-top, by every always-on-top level, by `focusable: false`, by `transparent: true`, and by showing in the taskbar. A window 4 DIP short of the monitor still counted; 8 DIP short did not
  - after moving the overlay to the work area and cropping the frozen desktop to match, the state stays `QUNS_ACCEPTS_NOTIFICATIONS` before, during, and after a capture, and the notification area shows no Do Not Disturb indicator
  - accuracy retained: 700 x 500 and 500 x 800 drags export at exactly those sizes, and exported pixels remain SSIM 1.000000 against the frozen overlay
  - capture transition still resolves in a single 60 fps frame
- 2026-08-06 `0.5.0` pass:
  - confirmed the full-screen classification tests one window at a time: a single window over the display reads `QUNS_BUSY`, while an editor over the work area plus a filler over the taskbar strip, covering the same pixels, reads `QUNS_ACCEPTS_NOTIFICATIONS`
  - window enumeration during a capture shows the filler above `Shell_TrayWnd` in the topmost z-order at `alpha=255`, covering the taskbar. The +/-11 px in `GetWindowRect` is the invisible resize border; the client area is exact
  - scene sync verified by measurement: making a selection away from the taskbar drops the strip's mean luma from 35.5 to 27.3, so the filler shades with the editor rather than showing a live taskbar
  - a drag from the work area into the taskbar exports at exactly the dragged size, and the exported taskbar is geometrically identical to the real one
  - the residual tone difference when comparing an export against a GDI screen grab is not a Capturo defect: with no overlay running at all, a GDI grab and a raw `desktopCapturer` frame of the same screen score SSIM 0.821 over the taskbar and 0.673 over the desktop. Comparisons between the two capture paths are only meaningful for geometry on this machine, whose wallpaper animates
  - Do Not Disturb stays off before, during, and after a capture; selections remain exact at 700 x 500 and 500 x 800; the capture transition still resolves in a single 60 fps frame
- 2026-08-06 `0.6.0` pass:
  - stroke slider driven end to end in the running app: readout tracked the drag to `24px` and the rectangle drawn afterwards carried the heavier stroke
  - numbered-step slider driven to `48px` and the placed marker scaled with it
  - selecting the existing rectangle with the Select tool moved the slider to `24px` rather than resetting to the default
  - text retains its preset list, now labelled `12px` through `48px`
- 2026-08-07 `0.9.0` settings:
  - automated gate green: `npm run typecheck`, `npm test` (27/27, including new `settings` and `shortcut` suites), and `npm run build`, which emits `out/renderer/settings.html` alongside `index.html` from the new two-page Rollup input
  - pure logic covered by unit tests: quality clamping, invalid-input fallback, partial merges; accelerator building for modifier combinations, bare function keys, and rejection of modifier-only or unmapped chords
  - GUI smoke test still to run on the Windows desktop: tab switching, the notification toggle, PNG↔JPEG save output and quality, and shortcut rebind including the taken-chord fallback (see TESTING.md)
- 2026-08-07 `0.9.1` fix:
  - a 1px border framed the capture overlay around the whole screen and along the work-area/taskbar seam. Cause: frameless windows keep `WS_THICKFRAME`, which Windows 11 borders, and the display is tiled into several overlays, so every overlay edge showed it
  - dropping `WS_THICKFRAME` (`thickFrame: false`) removes the border; confirmed gone in the running app on Windows 11
- 2026-08-08 `0.10.0` performance:
  - automated gate green: `npm run typecheck`, `npm test` (31/31, including new `uncoveredStrips` cases), `npm run build`; the native helper rebuilds clean under `/W4`
  - removed avoidable invocation cost: the redundant full-resolution `desktopCapturer` pass is skipped on the Windows helper path, per-display frame grabs and overlay loads run in parallel, and the reveal's fixed 250 ms floor is gone (the animation it hid is already suppressed by `thickFrame:false`)
  - native helper no longer stalls on a static desktop: the frame-acquire wait is bounded and falls back to the current desktop surface (D-015 amended); it now also reports per-stage timings, and `CAPTURO_TIMING=1` logs the capture path
  - still to run on real hardware: `CAPTURO_TIMING` before/after numbers, the reveal frame-diff (single hard cut, no black frame), the HDR known-pattern re-check, and pixel-exact selection (D-012)
- 2026-08-08 `0.11.0` rotated-display capture:
  - the native helper now turns a rotated output back to the desktop orientation instead of falling back. Verified on a real portrait (1080x1920) secondary: the helper reported `ok` with the rotated dimensions and the written PNG was correctly oriented (upright, not mirrored)
  - with the rotated display served by the helper, the `desktopCapturer` fallback no longer runs. Measured with `CAPTURO_TIMING=1` on a 4K + rotated-1080p desktop: frame capture went from ~1700ms (0.9.x) to ~927ms (0.10.0 parallel fallback) to ~498ms once the rotated display used the helper, both displays grabbed in parallel
  - automated gate green: typecheck, 31/31 tests, build; helper rebuilds clean under `/W4`
  - the 90/270 rotation direction is verified for this display's orientation; 180 and the opposite 90 follow by symmetry and are not yet exercised on hardware
- 2026-08-08 `0.12.0` persistent capture helper:
  - the helper is now spawned once and warmed at launch. Measured with `CAPTURO_TIMING=1` on the 4K + rotated-1080p desktop: warm captures report `setup 0` on every display and frame capture holds at ~323-335ms (down from ~498ms), bounded now by the sequential convert+encode
  - serve mode verified: a two-display batch over stdin returned correct main (3840x2160 HDR, `hdrActive:true`) and rotated (1080x1920) PNGs; the main HDR capture is not washed out and the rotated one is upright
  - resilience verified: killing the persistent helper mid-session respawned and warmed a fresh one and the capture still succeeded; force-killing the app (bypassing the graceful quit) left no `capturo-capture.exe` behind, because the serve loop exits on stdin EOF
  - not yet exercised on hardware: a display-config change (rotate / resolution / unplug) between captures; the `DXGI_ERROR_ACCESS_LOST` rebuild path handles it and the desktopCapturer fallback is the safety net, but it should be confirmed manually (see TESTING.md)
  - automated gate green: typecheck, 31/31 tests, build; helper rebuilds clean under `/W4`
- 2026-08-08 GIF capture (Phases 1-3, unreleased on `main`):
  - full pipeline verified end to end via `CAPTURO_GIF_RECORD_SMOKE`: `getDisplayMedia` → sample region → `gifenc` worker → saved a valid, correctly-cropped `.gif`; the recorded region is full-brightness (shade correctly outside it) and free of the border ring (chrome is content-protected)
  - inter-frame differencing measured: a 3s recording over the animated wallpaper dropped from ~18 MB to ~0.5 MB (~34x); a unit test shows 30 identical frames stay a few KB
  - automated gate green: typecheck, 38 tests (new `gif` suite), build; all four renderer pages emit (`index`, `settings`, `gif`, `gif-record`)
  - not verifiable by automation (content protection hides the recording chrome from all screen capture, including test screenshots): the drag-select, Pause/Resume/Stop flow, and the on-screen look of the border ring and shade — these need a hands-on pass on Windows
- 2026-08-09 Phase 4 (0.13.0):
  - Escape now cancels a capture or GIF selection before any region is dragged. The selection overlays are shown with `showInactive()` (D-011) so they held no keyboard focus until the first click, and the renderer's window `keydown` never fired; `revealOverlay` now focuses the editor overlay once it is painted. Validated by the user on real hardware — Escape cancels immediately in both flows. Committed to `main` (`a64067a`)
  - identical-frame coalescing added to the GIF encoder: a run of frames identical to the pending one extends its delay rather than emitting a new full-palette frame, on top of the existing transparent-pixel differencing. Accumulated delay is capped at the GIF 16-bit centisecond max
  - automated gate green: `npm run typecheck`, `npm test` (40 tests, +2 coalescing cases in `gif`)
- 2026-08-10 post-0.13.0 GIF timing fix:
  - sampled frames now carry active elapsed timestamps from the recording renderer; the encoder assigns each actual delta to the preceding frame, so late sampling on large/high-FPS regions no longer shortens playback
  - GIF's whole-centisecond delays use carried rounding remainder, preventing deterministic drift at 30 fps; Stop supplies the final active timestamp and paused spans remain excluded
  - a coalesced static span beyond the 655.35-second per-frame delay limit is split into repeated frames instead of being clamped and shortened
  - regression coverage parses encoded delays at every selectable FPS, irregular sampling, identical-frame coalescing, and an over-limit static span; full gate green: typecheck, 47/47 tests, and production build
- 2026-08-10 GIF pre-timer:
  - GIF Settings now persists a whole-second pre-timer from 0-10 seconds, defaulting to 3; 0 starts recording immediately
  - after the display stream is ready, the content-protected control bar counts down with Pause and Stop disabled and Cancel available; the active timer, first frame, FPS sampler, and smoke auto-stop begin only at zero
  - settings normalization/clamping and countdown deadline boundaries are covered by unit tests; full gate green: typecheck, 49/49 tests, and production build; see D-019
- 2026-08-11 local Windows package and performance baseline:
  - `npm run dist:win` completed with the current unreleased changes after a green 49/49-test build, producing the installer and portable executable under the git-ignored `release/` directory
  - a real 27-second capture at 30 fps and 70% quality produced roughly 800 sampled frames and a ~22 MB GIF, but exposed a long post-Stop encoding wait
  - read-only profiling identified the cause: the renderer could enqueue frames faster than the single worker quantized and wrote them, so Stop sat behind the accumulated worker queue
- 2026-08-11 GIF optimization (OPT1 and OPT2):
  - the worker acknowledges completed frame work and the renderer caps in-flight frames at two; full queues skip sampling before canvas readback, while active timestamps preserve wall-clock playback duration
  - the control bar reports skipped ticks during recording, processed/total progress during bounded finalization, and a distinct Saving state
  - frames changing at most 25% of the region quantize/map only their compact changed-pixel set; broader changes use the existing full-frame path, identical frames still coalesce, and the final GIF no longer receives a redundant complete copy before transfer
  - regression coverage asserts queue boundaries and sparse/coalesced/full strategy selection, then decodes a sparse animation through Sharp to verify changed and transparent-composited pixels; full gate green: typecheck, 53/53 tests, and production build; see D-020
  - `npm run dist:win` then rebuilt both Windows artifacts from this optimized source after the same 53/53-test gate; `release/BUILD-INFO.txt` records their hashes and build time
  - packaged-build validation at 30 fps and 70% quality produced a valid 1163x753 GIF with 529 distinct encoded frames over the complete 27.78-second timeline; all frames decoded cleanly, 80.9% used the expected 30/40 ms cadence, and the 2.41 MB output was about 89% smaller than the comparable ~22 MB pre-optimization capture
  - the user accepted the improved Stop-to-save behavior after the repeat 27-second stress capture; size and throughput gains remain content-dependent

## Post-0.13.0 follow-up

- Hands-on GUI smoke on Windows (drag-select, Pause/Resume/Stop, border/shade appearance, save).
- Confirm the mouse cursor appears in a real recording (getDisplayMedia default; the smoke region had no cursor motion).

### GIF optimization status

- **OPT1 complete:** worker acknowledgements, a two-frame bound, pre-readback sample skipping, and finalization progress prevent recording-length-dependent queue growth.
- **OPT2 complete:** the equality scan collects localized changes and palette work runs only on that compact set; a 25% threshold retains the full-frame path for widespread motion. A synthetic 1920x1080 screen-style profile with ~6% changed pixels reduced that stage from 23.6 ms to 5.9 ms per frame. The packaged validation above confirmed a substantial end-to-end size and saving improvement, but results remain content-dependent rather than a product guarantee.
- The redundant final GIF copy is also removed. If a real 30 fps stress pass still needs more throughput, profile a balanced `rgb444` path before taking on the ordering and CPU complexity of a multi-worker encoder.

### Done in Phase 4

- Runs of identical frames coalesce into a single written frame — the pending frame's delay is extended instead of emitting a new full-palette frame — on top of the transparent-pixel differencing, cutting per-frame palette overhead for static content. Covered by unit tests in `tests/gif.test.ts`.

### Deferred past 0.13.0

- Copy the finished GIF to the clipboard. There is no clean, Electron-native, cross-platform way to put an animated GIF (or a `CF_HDROP` file drop) on the clipboard: Windows needs a file drop, macOS a GIF-data/file-URL pasteboard write, and the two share no code. A PowerShell `Set-Clipboard` shell-out was rejected as too heavy for a privacy-minimal app that otherwise spawns no external process but its own capture helper. When taken up, do it properly per platform — Windows via a `--clipboard-file` mode on the existing native helper; macOS via NSPasteboard once macOS is actually supported.

## Known constraints

- A drag must start inside the editor window, which covers the work area. A selection extends into the taskbar normally once it has begun, because the editor keeps pointer capture, but a drag cannot be started by pressing on the taskbar itself.
- A selection cannot span two physical displays.
- macOS screen capture requires user-granted Screen Recording permission.
- macOS build, sign, and notarization must run on macOS; they cannot be validated from the Windows development host.
- Local Windows artifacts are not Authenticode-signed unless signing credentials are supplied to `electron-builder`.
