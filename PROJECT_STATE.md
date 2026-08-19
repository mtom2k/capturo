# Project State

Last updated: 2026-08-19

## Phase

`0.21.0` is the current source version, prepared as an unpublished GitHub Release draft carrying the Windows x64 Setup and Portable executables. `0.20.0` is the latest *published* stable Release, published 2026-08-18 with Windows x64 and universal macOS artifacts. Windows x64 remains the only *supported* platform; the macOS artifacts attached to 0.20.0 are ad-hoc signed and carry the Gatekeeper warning described under macOS state. Note that 0.20.0 was published before the hands-on acceptance matrix in `TESTING.md` had been run against the packaged app, which inverts the order `RELEASING.md` requires.

The first real macOS pass shipped in 0.20.0, and it went considerably further than expected: capture, annotation, save, clipboard, GIF recording and copy, the menu-bar flow, `Esc` cancellation, the Screen Recording permission flow, and start-at-login all work on macOS 26.2 (arm64). macOS artifacts are attached to the published 0.20.0 but macOS is not a supported platform. The blocker is an Apple Developer ID Application certificate, without which a build cannot be notarized and Gatekeeper refuses it on any machine that downloads it — and an ad-hoc signature also makes the Screen Recording grant lapse on every code change. **Copy text** and HDR-correct capture stay Windows-only because both run through the native helper. See the macOS section below and D-027 through D-030.

Version 0.21.0 adds two features.

**The screen colour picker.** **Color picker** in the tray menu, directly below **New GIF**, or `Ctrl/Cmd+Shift+4`. It freezes the desktop the way a screenshot does and *replaces the mouse cursor* with a 17x magnifier centred on the pixel it reads; Shift slows sampling to an eighth speed and the arrow keys nudge one pixel. Picking copies the colour to the clipboard on its own and opens a colour window with HEX/RGB/HSL output, live hue/saturation/lightness/alpha sliders, a related-colour row, and the nearest colour name. A Color picker tab in Settings carries the rebindable shortcut, a copy-on-pick switch, and the clipboard format. See D-032 through D-034.

**The highlighter**, in the toolbar directly right of the Pen (`H`). Geometrically a pen stroke and sharing that code; what makes it a highlighter is compositing with `multiply` at 45% alpha, so text under the stroke keeps its contrast and stays readable rather than being covered. Shift or Ctrl locks it straight, every annotation colour applies, and it keeps its own width and slider range separate from the Pen's. See D-035.

A macOS artifact for 0.21.0 is outstanding and remains subject to D-028: without a Developer ID Application certificate the build is ad-hoc signed, Gatekeeper refuses it on any machine that downloads it, and the Screen Recording grant lapses on every rebuild.

Version 0.20.0 also reworks text placement: a text box commits when focus leaves it rather than only on `Ctrl/Cmd+Enter`, Escape unwinds the text before the capture instead of cancelling both at once, and the resize grip is a Capturo element sized to be grabbed rather than the browser's fixed ~15px corner. The toolbar gives Save its own green fill and Cancel a red tint. See D-031 and the D-007 amendment.

The screenshot toolbar now places **Copy text** immediately beside regular Copy. It OCRs the final rendered selection through Windows' installed OCR languages, copies non-empty plain text, supports `Ctrl/Cmd+Shift+C`, automatically commits pending transparency, and leaves the editor open on no-text or failure. Pixels remain in memory over Capturo's private native-helper pipe; there is no OCR network request, model download, or temporary screenshot file.

Version 0.20.0 replaces the canonical artwork with the supplied rounded-card "C" logo, keys out its delivered backdrop so every icon has transparent corners, and adds a monochrome macOS menu bar template. Version 0.18.1 had replaced the artwork with the supplied 1254px camera/scissors logo. Package/Desktop, Settings/taskbar/notification, and 16px/32px tray/menu-bar images are regenerated from that exact source by resizing only; no alternate mark, crop, transparency conversion, mask, or recoloring is introduced.

Version 0.17.0 adds a manual **Check for updates** action and an opt-in, persisted daily stable-release check to Global Settings. The implementation is notification-only, main-process-owned, and never downloads or installs software. `mtom2k/capturo` is public, and installed builds can query its stable Releases anonymously without an embedded credential.

Version 0.16.0 gives Blur and Pixelate a dedicated 1-100% Intensity control whose strength increases consistently and is stored per effect. It also refreshes the user documentation with current GIF Settings and finished-preview screenshots. Version 0.15.2 replaced the immediate post-recording GIF Save As dialog with an animated preview offering Copy, Save, Open folder, Retake, and Discard. Windows GIF Copy uses a native `CF_HDROP` file entry so animation is preserved. It also added the Global Settings section with an Open on startup toggle; launch after a real sign-out/sign-in remains in the hands-on checklist below.

Version 0.15.1 adds a non-destructive Transparent background screenshot tool with connected-pixel removal, sampled/hex/RGB target colors, perceptual tolerance, 0-10px feathering, checkerboard Before/After/Split preview, undo, automatic application on Copy/Save, and automatic PNG output. It also replaces the application and tray/menu-bar branding with the supplied purple Capturo artwork and disables Electron's unused spellchecker so Windows does not create malformed cache folders beside the source tree.

## Current build

The package version is `0.21.0`. `release/BUILD-INFO.txt` inventories the current v0.21.0 Setup and Portable executables, which include the colour picker and the highlighter. Local Windows binaries are not Authenticode-signed - `Get-AuthenticodeSignature` reports `NotSigned` for both - and may trigger an unknown-publisher warning.

`0.1.0` through `0.11.0` are superseded. `0.1.0` was never released, and the duplicate `release-update/` directory has been deleted.

## Completed 0.9.0 milestone

`0.9.0` - the complete local capture, annotation, copy, and save workflow, HDR-correct native capture, and a minimal tray-opened settings window: save format (PNG/JPEG) with JPEG quality, a post-capture notification toggle, and a rebindable capture shortcut, plus a placeholder GIF tab for a future feature.

## Functional checklist

- [x] Tray icon starts capture
- [x] Global shortcut starts capture
- [x] Multi-display overlays and single-display claim
- [x] Region selection, move, and resize
- [x] Clipboard copy and native Save As
- [x] Windows Copy text OCR beside image Copy, with local in-memory recognition and a text-clipboard shortcut
- [x] Escape cancellation
- [x] Pen with smoothing and modifier-axis lock
- [x] Line and arrow
- [x] Rectangle and ellipse
- [x] Numbered steps
- [x] Pixel sliders for stroke width and numbered-step size
- [x] Text with font family, size, bold, and italic
- [x] Existing-object selection, movement, resizing, deletion, and property editing
- [x] Blur and pixelate with independent 1-100% intensity controls
- [x] Connected-background transparency with tolerance, feathering, live comparison, undo, and forced PNG output
- [x] Color palette
- [x] Contextual customization bar below the primary toolbar
- [x] Paint-gated, flash-free overlay presentation
- [x] Animation-free capture transition
- [x] Tiled overlays cover the whole display, taskbar included, without triggering Do Not Disturb (Windows); a single full-display overlay covers the menu bar and Dock on macOS
- [x] Pixel-exact selection and export on scaled displays
- [x] Version visible from the tray
- [x] One supplied Capturo logo consistently drives executable, window/taskbar, tray/menu-bar, notification, and installer assets, with the delivered backdrop keyed out and a monochrome macOS menu bar template
- [x] Undo
- [x] Tray-opened settings window with Capture and GIF tabs
- [x] Save as PNG or JPEG with a JPEG quality control (save-only; clipboard stays lossless)
- [x] Post-capture notification toggle
- [x] Rebindable capture shortcut with conflict fallback
- [x] Settings persisted to `userData/settings.json` (no captured pixels)
- [x] Global Open on startup preference defaults off, is isolated from development login items, and registers/removes the packaged Windows login item
- [x] Manual and opt-in daily stable-release checks with inline status, notification, and tray action; no download/install
- [x] Public anonymous release feed for installed update checks
- [x] GIF: tray New GIF item and rebindable GIF shortcut open region selection
- [x] GIF: record a region live (cursor included) and preview a valid, correctly-cropped animation before export
- [x] GIF: inter-frame differencing keeps files small (static content ~30x smaller)
- [x] GIF: runs of identical frames coalesce into a single written frame (delay extended)
- [x] GIF: content-protected control bar, border ring, and shade (absent from the capture)
- [x] GIF: FPS and quality settings, persisted
- [x] GIF: configurable 0-10 second pre-timer before active capture (default 3 seconds)
- [x] GIF: persisted toggle to hide recording and encoding frame totals (shown by default)
- [x] GIF: playback duration follows active sample timestamps, with unbiased centisecond rounding and no long-static-run truncation
- [x] GIF: encoder backpressure caps transferred raw frames at two and reports skipped/finalizing progress
- [x] GIF: localized changes quantize/map only changed pixels, with a 25% full-frame fallback threshold
- [x] GIF: exact Windows recording-chrome bounds with the DWM-owned grey border suppressed
- [x] GIF: post-recording preview with Copy, Save, Open folder, Retake, and Discard
- [x] GIF: animated-file clipboard copy, native `CF_HDROP` on Windows and `public.file-url` on macOS
- [ ] GIF: interactive GUI smoke on Windows (drag-select, Pause/Resume/Stop, shade/border look)
- [x] Windows smoke test (through 0.6.0)
- [ ] Settings GUI smoke test on Windows
- [x] macOS smoke test of capture, GIF, settings, permissions, and login item (arm64; hands-on matrix not yet walked by a second person)
- [x] Windows packages
- [ ] Signed/notarized macOS packages

## Verification record

- `npm run typecheck`: passed
- `npm test`: 83/83 passed
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
  - not verifiable by automation (content protection hides the recording chrome from all screen capture, including test screenshots): the drag-select, Pause/Resume/Stop flow, and the on-screen look of the border ring and shade need a hands-on pass on Windows
- 2026-08-09 Phase 4 (0.13.0):
  - Escape now cancels a capture or GIF selection before any region is dragged. The selection overlays are shown with `showInactive()` (D-011), so they held no keyboard focus until the first click and the renderer's window `keydown` never fired. `revealOverlay` now focuses the editor overlay once it is painted. The user validated on real hardware that Escape cancels immediately in both flows. Committed to `main` (`a64067a`)
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
- 2026-08-11 Windows GIF recording-chrome fix:
  - diagnosed the uncapturable top/bottom grey bands as DWM-owned borders on the content-protected recording windows; every affected window reported a 2-physical-pixel visible-frame border despite `frame: false` and `thickFrame: false`
  - extended the persistent native helper with a serialized `window-border` request that disables DWM non-client rendering and applies `DWMWA_BORDER_COLOR = DWMWA_COLOR_NONE` after renderer readiness and before first show; the stronger non-client policy was added after hardware feedback found a fainter residual line at the bottom, and content protection remains enabled
  - a user-supplied simulation established that the intermittent residual extended well beyond the selection width and aligned with the top edge of the full-width bottom shade, not the ring; recording shade tiling now uses full-height sides plus selection-width top/bottom strips, and the ring is raised after every asynchronous chrome show so all internal shade edges remain beneath its red perimeter
- 2026-08-11 GIF frame-count visibility:
  - GIF Settings persists a `showFrameCount` toggle that defaults on for backward compatibility; when disabled, the protected control bar keeps its timer and generic Finalizing/Saving states but hides sampled, skipped, processed, ready, and encoded totals
- 2026-08-11 Windows GIF recording-chrome verification:
  - reapplied canonical integer outer bounds after each recording window is constructed; native smoke inspection now reports the centre-region ring at exactly 1030x582 rather than 1033x585 and the control bar at exactly 340x46 rather than 340x48
  - native helper and production app build passed; 58/58 tests passed. The final absence of the content-protected cosmetic border must still be confirmed by eye because screenshot tools intentionally omit these windows (D-021)
- 2026-08-11 GIF optimization acceptance:
  - the user accepted the improved Stop-to-save behavior after the repeat 27-second stress capture; size and throughput gains remain content-dependent
- 2026-08-11 `0.14.0` Windows release gate:
  - package and lockfile versions are both `0.14.0`; `npm install` reports zero vulnerabilities
  - `npm run dist:win` passed the typecheck, 58/58-test, and production-build gate and produced fresh x64 installer and local portable artifacts; obsolete 0.13.0 artifacts were removed before regenerating `release/BUILD-INFO.txt`
  - `Get-AuthenticodeSignature` reports `NotSigned`, so the release notes explicitly retain the unknown-publisher warning; only the Windows installer is published, and no untested macOS asset is produced
- 2026-08-11 `0.15.0` local Windows packaging gate:
  - package and lockfile versions are both `0.15.0`; `npm run dist:win` passed type checking, all 61 tests, and the production build before producing fresh x64 setup and portable executables
  - superseded 0.14.0 local executables were removed first, so `release/BUILD-INFO.txt` inventories only the two 0.15.0 artifacts; after replacing the canonical source with the final supplied 500px transparent logo and disabling the unused spellchecker, their SHA-256 values are `043e889f29a004d641318beb2bd4adc3b796a44a66d47f61a62a4df3404019ce` (setup) and `a7fbfce7c4807ca4a4ae8227f09ea527b0266989c06e97b84b31dc8ec93ddbb9` (portable)
  - both executables report product version `0.15.0`; `Get-AuthenticodeSignature` reports `NotSigned` for each. These are local validation builds and have not been published to GitHub
  - the final brand consolidation removes the secondary tray source, rounded-mask taskbar derivative, and macOS monochrome template; executable/installer, Settings taskbar window, notifications, Windows notification area, and macOS menu bar now derive unchanged from the one supplied `build/icon-source.png`
  - the Settings window and notifications explicitly use the packaged 256px derivative, avoiding fallback to a legacy cached icon; macOS remains untested on Apple hardware
- 2026-08-12 `0.15.1` Windows release gate:
  - package and lockfile versions are both `0.15.1`; `npm install` reports zero vulnerabilities, and `npm run dist:win` passed type checking, all 61 tests, and the production build
  - `release/BUILD-INFO.txt` inventories only the two 0.15.1 artifacts; their SHA-256 values are `2471b4ecc19de9b0ec92a8f37e88a29b1d5c3e6417537b0d8788118e4c9036f8` (setup) and `5b90ee0c02d6ea06f48009757739aabe9aca5240d9115ecf8d6b9937fb5a8eb6` (portable)
  - both executables report product version `0.15.1`; `Get-AuthenticodeSignature` reports `NotSigned` for each, so the GitHub release publishes only the Windows x64 installer with an explicit unknown-publisher warning
  - packaged taskbar and tray assets match their generated source hashes, and no malformed Unicode or renamed spelling-cache directories remain in the repository root
- 2026-08-13 `0.15.2` source verification gate:
  - package and lockfile versions are both `0.15.2`; `npm install` reports zero vulnerabilities, and the initial source gate passed type checking, all 63 tests, and the production build
  - the Global Settings layout was inspected at its exact 460x452 window size, and a packaged Windows unpacked-app smoke verified that enabling Open on startup creates the expected current-executable login entry and disabling it removes that entry
  - the smoke left no login entry, temporary settings file, or Capturo process behind; a real sign-out/sign-in launch remains a hands-on check
  - this initial gate preceded the GIF preview work and local Windows packaging recorded below; `v0.15.1` remains the published GitHub release
- 2026-08-13 unreleased GIF preview verification:
  - the native Windows helper rebuild passed, including its new serialized `clipboard-file` request; a real `CF_HDROP` smoke reported the existing `%TEMP%\capturo-smoke.gif` as a `.gif` FileDropList item with the expected 12,737-byte length
  - `npm run build` passes strict type checking, all 65 tests, and the production build; added regressions reject incomplete/non-GIF signatures before preview creation and constrain temporary cleanup to expired Capturo-owned GIF files
  - the dev-only preview smoke rendered the animated `%TEMP%\capturo-smoke.gif`, reported its 12.4 KB size and unsaved state, kept Open folder disabled, and produced `%TEMP%\capturo-gif-preview-smoke.png` for visual inspection; the smoke process tree and native helper were stopped afterward
  - hands-on Save dialog, post-preview paste into Explorer, Retake, and Discard remain in the GUI checklist
- 2026-08-13 `0.15.2` local Windows packaging gate:
  - `npm run dist:win` passed type checking, all 65 tests, and the production build before producing fresh Windows x64 setup and portable executables; `release/BUILD-INFO.txt` inventories only those two 0.15.2 artifacts
  - the setup SHA-256 is `16789ffa0a19c84a22d8f316b0a71a6d1df9f5702f3d4c046568fdc164c939cf`; the portable SHA-256 is `b6b0c54796536c3cc32c7d77020415ef1891360501e781115e28074d33e2f115`
  - both executables report product and file version `0.15.2`; `Get-AuthenticodeSignature` reports `NotSigned` for each
  - the packaged native helper hash exactly matches the freshly compiled helper, confirming the `CF_HDROP` GIF-copy implementation is included; no tag or GitHub release was created
  - the portable executable launched with isolated preview-smoke settings, rendered the packaged GIF preview, and refreshed `%TEMP%\capturo-gif-preview-smoke.png`; its process tree was stopped after verification
- 2026-08-13 v0.16.0 Blur/Pixelate intensity gate:
  - Blur and Pixelate no longer expose or consume stroke Size; each stores its own 1-100% Intensity and restores it when selected
  - pure mappings are strictly monotonic across representative percentages, clamp invalid input, and preserve visible strength at scaled source-pixel densities: Blur spans 1-32 CSS-pixel-equivalent radius and Pixelate spans 2-64 CSS-pixel-equivalent blocks
  - `npm run build` passes strict type checking, all 70 tests, and the production build; hands-on comparison over fine text at 1%, 50%, and 100% remains in the GUI checklist
  - the unpacked production app rendered the current GIF Settings and animated GIF Preview surfaces into `docs/gif-settings.png` and `docs/gif-preview.png`; the preview smoke also exposed and verified a containment fix for wide GIFs, keeping the header and full action row visible
- 2026-08-13 update-check development gate:
  - `npm run build` passes strict type checking, all 80 tests, and the production main/preload/renderer build
  - stable-semver regressions cover newer/equal/older versions plus draft, prerelease, malformed, leading-zero, and unsafe-number rejection; settings regressions cover the opt-in default and persisted timestamp validation
  - an unpacked packaged Windows smoke opened the Global tab, invoked **Check for updates** through the real typed IPC/network path, and rendered the complete layout at 460x452
  - after the repository became public, anonymous repository/release API requests confirmed `visibility: public` and returned stable, non-draft, non-prerelease `v0.15.1`
  - the packaged 0.16.0 UI completed the real typed IPC/network path and rendered **Capturo 0.16.0 is up to date**; no credential is embedded and no download/install path exists
- 2026-08-13 v0.17.0 release gate:
  - `npm run build` passes strict type checking, all 80 tests, and the production main/preload/renderer build
  - Windows x64 Setup and Portable packages both report product version 0.17.0 and match the hashes in `release/BUILD-INFO.txt`; the Setup SHA-256 is `03b259376262cb2bafa8d6d4028ce718a4ef3c163685415c73db4f5e79b32cb3`
  - `Get-AuthenticodeSignature` reports `NotSigned` for both packages, so the GitHub release and README retain the explicit unknown-publisher warning
  - GitHub published stable `v0.17.0` from `main` with the Windows installer; its anonymous latest-release API returned the same tag and asset digest
  - the exact 0.16.0 packaged `app.asar`, run with the matching Electron runtime files in a disposable smoke directory, detected the live public release as **Version 0.17.0 is available. You have 0.16.0.** and exposed **View release**
- 2026-08-14 v0.18.0 Windows Copy text gate:
  - added the Copy text button immediately beside image Copy, `Ctrl/Cmd+Shift+C`, typed/sender-validated IPC, final-composite export, pending-transparency commit, no-text/error retention, and useful tooltips/status
  - the native helper recognizes in-memory PNG bytes with `Windows.Media.Ocr`, current-user languages, maximum-dimension scaling, JSON-safe Unicode text, a 64 MiB caller bound, and a 20-second timeout; no OCR pixels are written or uploaded
  - `npm run build` passes strict type checking, all 83 tests, and the production main/preload/renderer build; OCR normalization regressions cover Windows line endings, spacing/blank-line preservation, and empty/non-string values
  - one-shot native OCR recognized a real Capturo UI screenshot; the application smoke copied 249 characters through persistent helper serve mode and Electron's real clipboard without logging contents, while a no-text image produced the expected message and non-zero automation exit
  - after switching the helper to a multithreaded COM apartment for C++/WinRT, a native DXGI regression still captured and decoded a valid 3840x2160 four-channel sRGB PNG; the temporary test capture was removed
  - `npm run dist:win` passed the same 83-test gate and produced only the fresh 0.18.0 Windows x64 Setup and Portable executables; both report product/file version 0.18.0 and are inventoried in `release/BUILD-INFO.txt`
  - Setup SHA-256 is `d4eda632523413d4b84d49e73cc1d88ab4aec8de2ef0ed0a4facdfac62412619`; Portable SHA-256 is `ef6231272bb2822d6176035b696dd53e1536b1da0bfd35a0bf0a23ee8003d32b`
  - `Get-AuthenticodeSignature` reports `NotSigned` for both artifacts. The packaged helper exactly matches the freshly built native helper, and the unpacked packaged app completed the real local OCR → Electron clipboard smoke with exit code 0
  - GitHub published stable `v0.18.0` from release commit `aa45bac` with the Windows x64 installer only; the public latest-release feed returns that tag and the uploaded asset digest exactly matches the locally verified Setup SHA-256
- 2026-08-15 v0.18.1 logo refresh gate:
  - the supplied 1254x1254 sRGB PNG matches tracked `build/icon-source.png` byte-for-byte; `npm run icons` regenerated the 512px package, 256px taskbar/notification, and 16px/32px tray/menu-bar derivatives
  - repository audit found no secondary logo path: electron-builder, Desktop/Explorer executable resources, Settings/taskbar windows, notifications, Windows tray, and the macOS menu-bar placeholder all route through those tracked assets
  - the 256px and 16px outputs were inspected, all generated dimensions/hashes are valid, `npm run build` passes all 83 tests, and an unpacked Windows package contains exact copies of the taskbar/tray files plus the new embedded `Capturo.exe` icon
  - package and lockfile versions are `0.18.1`; `npm install` reports zero vulnerabilities, and `npm run dist:win` passed strict type checking, all 83 tests, the production build, and Windows packaging
  - only fresh v0.18.1 Windows x64 Setup and Portable executables remain locally, both report product/file version 0.18.1, and `release/BUILD-INFO.txt` inventories exactly those two artifacts
  - Setup SHA-256 is `5b76f8c17ebc946b2ab58a1c1ba5d8ceb13dd81aa50b91b667a2b2398907406b`; Portable SHA-256 is `e167071cde5c85d24cc5d3600dc912f1adb1f31a660f5b943930a5a19a72798c`
  - `Get-AuthenticodeSignature` reports `NotSigned` for both artifacts. The packaged taskbar, 16px/32px tray, and native-helper files exactly match their tracked sources
  - the packaged v0.18.1 app opened its real Global Settings renderer and produced a valid smoke screenshot; the executable's embedded icon was extracted and visually confirmed as the new camera/scissors mark
- 2026-08-18 v0.20.0 Windows release gate:
  - `npm run dist:win` passed strict type checking, all 102 tests, the production build, and Windows packaging on Windows 11 x64 with Node v24.17.0
  - only fresh v0.20.0 Setup and Portable executables remain locally, both report product/file version 0.20.0, and `release/BUILD-INFO.txt` inventories exactly those two artifacts; the superseded v0.18.1 pair was deleted
  - Setup SHA-256 is `60abe1faf3b26116966cc7f8f55b1b9773c3529a1c0c8579cbcb5cc2114b9bbf`; Portable SHA-256 is `ace5b52a9980c6c27f547088d91bf83e5c9af2141dceae152bb84314c8adcbeb`
  - `Get-AuthenticodeSignature` reports `NotSigned` for both artifacts, and the release notes carry the unknown-publisher warning and all four checksums
  - the packaged `app.asar` was confirmed to contain the text-placement and toolbar work rather than only the source tree
  - the text placement rules were exercised against the built renderer bundle through a stubbed-preload harness, not the packaged app: click-away commit from inside the selection, outside it, and onto the toolbar; whitespace-only placing nothing; the first Escape leaving the session uncancelled and the second cancelling it; and a grip drag surviving both release and subsequent typing
  - GitHub published stable `v0.20.0`; the anonymous latest-release feed returns that tag with four assets, and both uploaded Windows digests exactly match the locally verified SHA-256 values
  - a clean local rebuild on 2026-08-18 from the same source produced Setup `7e3a2d832e406d5d8b5a1a6e6e53b7d236580498d467799a69679cf308b499a0` and Portable `5d86501dbc12906a5f0639832ca5919b7fe82ffb807577d11701801bf72ee795`, which differ from the published assets by a few dozen bytes. electron-builder embeds build timestamps, so packaging is not byte-reproducible: local artifacts are never expected to match a release's published checksums, and a mismatch is not evidence of a source difference. Compare the packaged `app.asar` contents rather than installer digests when that question comes up
  - the release was published from `gh release edit`, which promotes a draft as a side effect. The tag was created at `05acbdf`, one commit behind the shipped code, and was force-moved to release commit `f8ab25f` once that commit was on `main`. A published tag was therefore rewritten minutes after publication; check the draft state explicitly after any `gh release edit` rather than assuming it is preserved

- 2026-08-19 v0.21.0 packaged smoke, driven over Electron's remote debugging port:
  - the desktop-automation tooling was unavailable, so the packaged `win-unpacked` build was launched with `--remote-debugging-port` and driven over CDP. This exercises the real packaged renderer rather than a browser harness, and can screenshot it and read its canvas pixels directly. `--inspect` gives the same access to the main process
  - highlighter, verified from screenshots of the packaged app on a 1440x2514 portrait display: it sits right of the Pen; an amber stroke over dark-mode text leaves the text readable and tinted; a freehand stroke crossing itself holds one even tone with no darkening at the crossings; a Pen stroke of the same gesture is opaque and covers the text, which is the distinction D-035 exists for
  - the exported image carries the highlight: Copy was clicked and the clipboard bitmap read back at 1512x452, matching the selection at the display's 1.5x scale, with the highlight rendered as the editor showed it
  - Settings renders the Color picker tab with its shortcut row, copy-on-pick switch, and HEX/RGB/HSL control
  - `globalShortcut.isRegistered` reports true for all three accelerators in the packaged app, and a real OS-level `Ctrl+Shift+4` opened the picker overlays. `SendKeys` does *not* trigger them - it uses a journal hook that `RegisterHotKey` ignores - so a failure sent that way is a test artifact, not a regression
  - `Esc` cancels a capture: a CDP `Input.dispatchKeyEvent` tore down all four overlays within half a second. An earlier report that Escape did nothing came from the desktop-automation tool's key mapping, and was already shown to fail identically against the unchanged screenshot overlay
  - `CAPTURO_SETTINGS_SCREENSHOT_TAB` rejected `colorPicker` and silently fell back to GIF, because its whitelist was never updated when the tab was added. Fixed in the same session; it was found only by running the packaged build

## macOS state (2026-08-17, macOS 26.2, Apple Silicon)

macOS moved from "launches but cannot capture" to a working preview during this session. Verified
on this host:

- Packaging: `npm run dist:mac` produces a DMG and ZIP, the `afterPack` hook ad-hoc signs the app so
  `codesign --verify --deep --strict` passes with `Identifier=com.capturo.app` and sealed resources,
  and Electron's five unused camera/microphone/Bluetooth usage descriptions are stripped so the app
  declares only `NSScreenCaptureUsageDescription`.
- Capture: the overlay covers the whole display, menu bar and Dock included, and both are part of
  the capture. `Esc` cancels from the moment the overlay appears, from the menu bar and the shortcut.
- Menu bar: a primary click starts a capture; the menu is on right-click and Control-click.
- Permissions: Screen Recording is surfaced in Global Settings with request, System Settings and
  Reopen actions, distinguishes a first run from a lapsed grant, asks the system at most once per
  launch, and never stacks its own dialog on top of Apple's.
- GIF: recording, preview, and Copy, which now places the animated `.gif` file on the clipboard as
  `public.file-url` rather than writing a bogus pasteboard type and reporting success.
- Open on startup registers and unregisters an SMAppService login item, exercised end to end.

Not available on macOS, by dependency rather than defect: **Copy text** and HDR-correct capture both
run through the Windows-only native helper.

Still blocked on a certificate, not on code:

- No Apple Developer ID Application certificate exists, so a macOS build cannot be notarized and
  Gatekeeper refuses it on any machine that downloads it. **No macOS artifact may be published.**
- An ad-hoc signature binds the Screen Recording grant to the build's own code hash, so the
  permission must be granted again after every build that changes code. A self-signed
  `Capturo Local Signing` certificate removes that for local development; see RELEASING.md.
- Intel and universal builds are unbuilt; current output is arm64 only.
- The hands-on matrix in TESTING.md has not been walked end to end by a second person.

## Open follow-up

- Hands-on text smoke on Windows for the placement rules: click-away commit from inside the selection, outside it, and onto the toolbar; the two-step Escape; and the enlarged resize grip. Exercised through a stubbed-preload harness only; not driven by hand or over CDP in the packaged app.
- Hands-on highlighter smoke by mouse: the CDP pass drove synthetic pointer events, so freehand feel, cursor behaviour, and dragging the Size slider by hand are unproven. Also unverified: highlighting on a **light** background, where multiply is at its strongest and the effect should look most like a marker. Every packaged screenshot so far is of a dark-mode UI.
- Decide whether the highlighter should keep `multiply` (D-035). On a dark background it tints the text rather than the background, which reads clearly but not like a marker on paper; plain alpha is a one-line change with the opposite trade-off. There is now a real screenshot to judge it against.
- Hands-on screenshot transparency smoke on Windows: sampled/custom colors, tolerance and feather extremes, split drag, Undo, clipboard alpha, and forced-PNG save while JPEG is configured.
- Hands-on Copy text toolbar smoke on Windows: button/tooltip placement, multiline paste, shortcut, annotation/privacy-effect composite, no-text retention, and installed/missing language behavior.
- Hands-on GUI smoke on Windows (drag-select, Pause/Resume/Stop, border/shade appearance, save).
- Confirm the mouse cursor appears in a real recording (getDisplayMedia default; the smoke region had no cursor motion).
- Exercise the visible Windows notification click and tray-menu release action by hand on the next available-update pass; the live 0.16.0-to-0.17.0 Settings result and fixed **View release** action are verified.
- Authenticode-sign Windows releases before considering automatic update download or installation; portable builds still need an explicit policy.
- Obtain a Developer ID Application certificate before any further macOS work. It unblocks notarization, Gatekeeper, and the TCC Screen Recording grant at once; nothing in the codebase can substitute for it.
- Decide how the macOS artifact coexists with the in-app update checker, which reads a single `releases/latest` feed shared by every platform. 0.20.0 shipped macOS assets on that shared feed already.
- Decide whether to publish 0.21.0. Publishing makes it the `releases/latest` answer, so every 0.20.0 user is offered it; the draft holds Windows artifacts only, and a macOS build for this version has not been made.

### GIF optimization status

- **OPT1 complete:** worker acknowledgements, a two-frame bound, pre-readback sample skipping, and finalization progress prevent recording-length-dependent queue growth.
- **OPT2 complete:** the equality scan collects localized changes and palette work runs only on that compact set; a 25% threshold retains the full-frame path for widespread motion. A synthetic 1920x1080 screen-style profile with ~6% changed pixels reduced that stage from 23.6 ms to 5.9 ms per frame. The packaged validation above confirmed a substantial end-to-end size and saving improvement, but results remain content-dependent rather than a product guarantee.
- The redundant final GIF copy is also removed. If a real 30 fps stress pass still needs more throughput, profile a balanced `rgb444` path before taking on the ordering and CPU complexity of a multi-worker encoder.

### Done in Phase 4

- Runs of identical frames coalesce into a single written frame. The pending frame's delay is extended instead of emitting another full-palette frame. Combined with transparent-pixel differencing, this cuts per-frame palette overhead for static content. Covered by unit tests in `tests/gif.test.ts`.

## Known constraints

- A drag must start inside the editor window, which covers the work area. A selection extends into the taskbar normally once it has begun, because the editor keeps pointer capture, but a drag cannot be started by pressing on the taskbar itself.
- A selection cannot span two physical displays.
- Copy text is Windows-only, depends on OCR languages installed for the current user, returns plain text rather than document layout, and can misrecognize small, stylized, low-contrast, rotated, or obscured characters.
- macOS screen capture requires user-granted Screen Recording permission, and macOS applies a new grant only to a freshly launched app. macOS also has no readable "not asked yet" state for this permission, so Capturo cannot distinguish a first run from a refusal and must attempt the request before reporting either.
- An ad-hoc signed macOS build cannot hold that grant at all, so local macOS builds cannot capture.
- Animated GIF clipboard behavior is implemented on Windows as a file drop and its native protocol is verified; an end-to-end paste from the preview remains in the hands-on checklist. The macOS raw-GIF pasteboard fallback remains unverified with real applications.
- macOS build, sign, and notarization must run on macOS; they cannot be validated from the Windows development host.
- Local Windows artifacts are not Authenticode-signed unless signing credentials are supplied to `electron-builder`.
