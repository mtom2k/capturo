# Handoff

## Start here

Version **0.42.4** adds `src/main/window-security.ts` for main-frame ownership,
navigation guards, and display-media selection, plus `src/main/capture-temp.ts` for cleanup
of interrupted Windows capture PNGs. `settings:update` is now Settings-only, and the active GIF or
panoramic control window alone may request its selected display. On multi-monitor systems, do not
restore the first-display fallback; a sole source remains valid on one-monitor systems if Electron
omits its display id. Screenshot-editor pointer moves coalesce redraws per frame in `editor.ts`;
the synchronous export path is unchanged. These changes passed `npm run build`, the isolated
annotation smoke, an isolated Settings render, a verified HDR screenshot launch, and a short GIF
recording smoke. They have been packaged in isolated local Windows test builds, but not installed.
Non-primary GIF and panoramic UI acceptance still needs the desktop matrix before release. See D-048.

The current source version is **0.42.4**. Its Setup and Portable files are staged in
`release-0.42.4/`; the files in `release/` contain the earlier 0.42.3 code.

Version **0.42.3** includes Pin to desktop and **Edit** on each pin: the main process opens
its retained PNG in Full Tab while the original pin stays unchanged. See D-045 and the pinned-image
checks in `TESTING.md`; `pin.ts`/`pins.ts` own the renderer and main-process lifecycle.
Action controls now share `src/renderer/action-icons.ts` and `action-icons.css` across screenshot,
GIF, panoramic, color-result, and pin windows (D-046). Keep matching actions on the same
`data-action-icon` and `data-action-tone`; every icon-only button needs `aria-label` and `title`.
Live screenshot, GIF-selection, and Color Picker launches now share `AsyncGate` (D-047). Do not
move session assignment back behind an unguarded asynchronous screen grab: simultaneous shortcut,
tray, and second-instance triggers can orphan an overlay whose Cancel sender is no longer owned.
Pins and Full Tab remain outside this gate and survive later captures.
The Color Picker's rapid-motion correction in `picker-live.ts` ignores stale cursor-poll replies,
computes both recenter guards from absolute screen points, and limits precision displacement for
the next floating window's geometry (D-041). Verify fast diagonal sweeps in an interactive packaged
build; the pure tests cannot prove compositor timing.
The later zoom-motion fix removes the 720/240/80 source-pixel-per-second ceiling: it caused a fast
movement on one axis to starve the other at the third zoom step and beyond. Movement now follows
the 1/2, 1/4, or 1/8 factor on each axis; preview sampling remains limited to 30 starts per second.
Windows now routes picker movement, wheel, and click through a desktop-wide input-only HWND in
`native/capturo-capture/picker_input.cpp` and `src/main/picker-input.ts` (D-041). Keep the compact
Electron lens content-protected and mouse-ignoring, and reveal it only after native readiness
verifies cursor hiding. The HWND must stay non-activating so Escape and arrow keys reach the lens.
The helper's pipe/heartbeat teardown is essential: it returns input on parent failure without
changing Windows cursor images or global visibility counts. Rebuild the native helper before
packaging; the native desktop and Electron smoke fixtures verify movement, four wheel steps,
click, Escape, and null cursor readiness.
The 0.42.3 Setup and Portable executables and `SHA256SUMS-0.42.3.txt` are in `release/`. Its
`win-unpacked/` is also 0.42.3. Older local packages and temporary staging directories were
purged; the installed 0.42.2 app has not been replaced, preserving its in-memory pins. The HDR
post-unlock correction is packaged but still awaits first-capture-after-unlock visual acceptance.

The current source version is **0.42.4**; local Windows Setup and Portable test packages have been
built and verified in `release-0.42.4/`. Validation and packaging evidence live in
`PROJECT_STATE.md`. Older GitHub draft
artifacts documented here predate these fixes; check their remote state before any upload.
Complete the installed-app acceptance checks before creating or publishing a release.

Read `PROJECT_STATE.md`, then run:

```powershell
npm install
npm run build
npm run dev
```

Windows release artifacts are normally copied into `release/`, and `BUILD-INFO.txt` records the version,
build time, and SHA-256 for each artifact. The running app reports its own version in the tray
tooltip and tray menu, so an installed copy never has to be identified by guesswork.

When Capturo has in-memory pins, leave the installed session running and package in an isolated
staging directory. Do not overwrite a live `release/win-unpacked`; identify the versioned staging
output and copy only the verified release artifacts into `release/` when replacing the local release.
The 0.42.4 test package remains in its isolated staging directory for user installation.

## Verifying a build without a person at the keyboard

Most of what breaks in this app is invisible to a type check and to unit tests: compositing,
alignment, focus, and what actually reaches the clipboard. Three techniques cover it, in ascending
order of fidelity. Reach for the cheapest that can answer the question.

**1. Renderer harness.** Build with `npx electron-vite build`, copy `out/renderer` somewhere,
inject a `<script>` that defines `window.capturo*` stubs, and serve it. The real renderer bundle
then runs in a browser, driven with synthetic events. Fast, and enough for logic and layout. It
cannot prove anything about the main process, the OS, or real input.

**2. The packaged app over CDP.** Launch `release/win-unpacked/Capturo.exe` with
`--remote-debugging-port=9222` and drive the actual packaged renderers: `GET /json/list` for
targets, then `Runtime.evaluate`, `Page.captureScreenshot`, and `Input.dispatchKeyEvent` over a
WebSocket. Node 24's global `WebSocket` is all that is needed; there is no dependency to add. This
is how the highlighter's compositing and the picker's alignment were confirmed in a real build.
Add `--inspect=9229` to attach to the **main** process the same way and ask Electron directly, for
example `globalShortcut.isRegistered('CommandOrControl+Shift+9')`. Note that on macOS a `true`
here proves only that the accelerator was accepted, not that the keypress reaches Capturo: Electron
returns `true` for system-reserved combinations too, which is exactly how the pre-D-037 defaults
collided with the macOS screenshot shortcuts without any error.

Three traps, each of which produced a wrong conclusion first:

- A multi-display capture opens one editor *and* one filler per display. Fillers ignore input, so
  driving one looks like a completely broken app. Pick the target whose `#hint` is not hidden and
  whose viewport is largest.
- Cancelling destroys the window, so the CDP command that caused it never gets a reply. Treat the
  timeout as a possible success and re-check `/json/list` rather than reporting a failure.
- Coordinates are per display. One of the development machine's monitors is portrait, so hardcoded
  points landed off-screen.

**3. The app's own smoke flags.** `CAPTURO_CAPTURE_ON_START`, `CAPTURO_GIF_ON_START`,
`CAPTURO_PICKER_ON_START`, `CAPTURO_SETTINGS_ON_START`, and `CAPTURO_SETTINGS_SCREENSHOT` with
`CAPTURO_SETTINGS_SCREENSHOT_TAB` (which writes a PNG of a Settings tab straight to `%TEMP%`).
These redirect `userData` to a development folder, so they never touch real settings. Keep the tab
whitelist in `src/main/index.ts` in step when adding a Settings tab; it was missed once and the new
tab silently fell back to GIF.

**Sending real keystrokes.** Global shortcuts are registered with `RegisterHotKey`, which ignores
`SendKeys` because that uses a journal hook. Use `keybd_event` or `SendInput` through P/Invoke
instead. A shortcut that appears dead under `SendKeys` is a test artifact, not a regression.

## Product invariant

Capturo opens directly into capture and normally disappears after copy, save, or cancel. D-039 is
the explicit exception: one selected screenshot may outlive its overlay in a temporary normal
editor window, but it is not a dashboard, history database, or multi-document manager. Do not
broaden that lifecycle without another product decision recorded in `DECISIONS.md`.

## Implementation map

- Full Tab display quality/top dock (D-044): `canvasViewport` is source-image placement;
  `canvasSurface` is the visible display-backed canvas. Keep pointer coordinates and exports in
  source pixels. `previewTransform` feeds direct vector rendering; `renderScene` uses source-sized
  scratch compositing only for Blur/Pixelate. The dock's measured height sets the image reserve;
  `updateUiPosition` must return before floating placement for detached editors. Resize/DPI changes
  rebuild the preview backing store. The annotation smoke runner verifies sharp zoomed edges,
  four window shapes, 150% DPI, and source-aligned preview/export equality with overlapping effects.

- Text sizing/wrapping and step independence (D-043): `src/shared/text.ts` performs measured
  wrapping; `TextAnnotation.box` stores source-pixel dimensions; `resizeAnnotation` changes
  dimensions without scaling the font. `editor.ts` preserves them on commit/reopen and supplies
  eight live grips in `#text-editor-resize`, superseding the single corner grip. Keep opposite
  edges fixed and preserve click-away/Ctrl+Enter/Escape ordering. `src/shared/step.ts` supplies
  `stepMetrics` for both painting and bounds; it must never read a shape's `lineWidth`.
  The desktop fixture and CDP regression runner are documented in `TESTING.md`.

- Native lifecycle and OS integrations: `src/main/index.ts`
- Renderer API boundary: `src/preload/index.ts`
- Capture/editor controller: `src/renderer/editor.ts`
- Detached full editor: owner lifecycle and validated transfer in `src/main/index.ts`; the
  `detached` capture role and fitted canvas layout in `src/renderer/editor.ts`; pure
  `detachedEditorCanvasRect` geometry in `src/shared/geometry.ts`. It owns a separate id from the
  active overlay session, permits only one unsaved window, checkpoints existing edits, preserves
  forced PNG for inherited alpha, and must not be destroyed by starting another capture. Renderer
  initialization is a pull handshake installed after listeners; the overlay closes only after the
  detached renderer decodes the checkpoint and acknowledges readiness. A timeout or renderer death
  must clear an unrevealed state so it can never trigger a false "already open" response. See D-039.
- Canvas replay/export: `src/renderer/render.ts`
- Color picker: a separate live `ColorPickerSession` in `src/main/index.ts`; transparent overlay in
  `src/renderer/picker-live.ts`; result window in `src/renderer/color.*`; tiny HDR-aware
  `sample-display` request in the Windows helper; pure pointer/grid helpers in
  `src/shared/picker.ts`; colour maths in `src/shared/color.ts`. Never route it back through
  `openSelectionOverlays`: the picker must not capture, paint, freeze, or shade a desktop image.
  Never reintroduce a native `SetSystemCursor`/global cursor-hide request for Color Picker: a killed
  helper leaves Windows' pointer invisible after Capturo exits. The desktop-wide input-only HWND
  uses only window-owned `SetCursor(nullptr)` and must self-destruct on pipe or heartbeat loss.
  Its `WM_MOUSEMOVE` and Raw Input wheel feed the renderer through validated IPC; the small Electron
  lens ignores mouse hits. The legacy compact-input path still polls the physical pointer through
  owner-validated IPC when the native helper is unavailable.
  The Windows picker must remain one compact floating surface rather than a monitor-sized
  transparent BrowserWindow: the latter corrupts paused and playing Chromium video planes. It
  must remain content-protected or the magnifier can enter its own Desktop Duplication sample.
  Pointer requests stay coalesced to one in flight plus the newest point and preview starts stay
  capped at 30 per second; Desktop Duplication can otherwise answer pointer-only frames near the
  mouse polling rate and crowd out rendering. A click bypasses that cadence and rechecks the exact
  current point. Upload a returned grid as one tiny bitmap rather than restoring the per-cell
  canvas-fill loop. The owned-point displacement must bleed off during coarse
  movement so an edge is never stranded (D-032), and RGB must never round-trip through integer HSL
  (D-033). Native-input Windows constrains neither point to the compact window and recentres the
  lens on the owned sample. The legacy compact-input path still constrains excess zoom displacement
  and recentres on the physical/owned screen-space midpoint. Both paths reinitialize the display
  id, origin, scale, and HDR output when crossing a monitor seam. Picker movement must never read
  `shiftKey` or maintain a modifier-driven fine mode. Never restore raw
  `movementX/Y`: stable movement comes from consecutive absolute `screenX/Y` points because the
  floating BrowserWindow changes the relative coordinate frame. Wheel zoom uses the allow-listed
  25/17/13/9/5 grids, defaults to the widest grid, and automatically selects
  1×/1×/1/2×/1/4×/1/8× movement on each axis without a time-based velocity cap. An in-flight
  sample is valid only for its requested grid size.
  The UI deliberately shows no zoom badge. The aperture and hex are drawn onto the hit
  canvas in one `requestAnimationFrame` after replacing the complete prior bitmap with transparent
  pixels via `copy`. Both canvases require device-pixel backing stores and logical transforms or
  the hex caption becomes blurred on scaled DPI. Recenter ordering is also load-bearing: predict
  the shared floating-region origin, paint the corrected local selector, then call main to move the
  BrowserWindow. Reading `window.screenX/Y` after `setBounds` recreates the one-frame overshoot. Do
  not restore a
  separately positioned transparent DOM magnifier, which caused short DWM trails. See D-041. Any new page
  still needs a Vite entry or it will not be packaged. Derive the picker source-image size from
  `Display.size × Display.scaleFactor`; Electron 43's declared `screen.dipToScreenRect` API is not
  present at runtime on macOS and using it in the shared picker startup path aborts the session.
- Text placement: `openTextEditor`/`closeTextEditor` and the `#text-editor` / `#text-editor-resize` listeners in `src/renderer/editor.ts`. Two orderings are load-bearing and neither is caught by a type check or a unit test. `pointerDown` commits an open text box *itself* and arms `ignoreTextBlur`, because the browser moves focus after the handler returns and the blur would otherwise commit a box the same click has already emptied. The text box's Escape handler must call `stopPropagation`, because `handleShortcut` is on `window` and its `textEditor.hidden` guard is already false by the time the event bubbles, so without it one press cancels the whole capture. See D-031.
- Panoramic Scrolling: the screenshot-toolbar entry and start call live in `src/renderer/editor.ts`;
  the out-of-crop control lifecycle, display-media grant, and Full Tab handoff live in
  `src/main/index.ts`; `src/renderer/panoramic-record.ts` owns live cropping, the miniature map, and
  unique-coverage assembly; pure overlap, direction inference, rectangle subtraction, and output
  limits live in `src/shared/scroll.ts`. It is user-driven and Windows-only. Keep both the
  `cursor: never` request and the normalized pointer-mask repair path; neither alone is an output
  guarantee on Windows. Nothing may hide the system cursor here: the user must keep seeing their
  own pointer, and the mask is what keeps it out of the image. Main reports the pointer with a
  region-derived radius so the mask scales with DPI, reports it up to one radius outside the region,
  and the renderer masks a sample from before and after each frame read. Keep that mask on whole
  pixels; a fractional rectangle both softens repaired seams and can trip the integer size guard
  into a false "maximum size reached". The mask can still strand an uncovered region when the
  pointer is within one radius of the leading edge, or when one accepted step carries the masked
  band out of the viewport; that is a known, characterized gap with an intended repair, both
  recorded in D-042 and `PROJECT_STATE.md`. Do not close it by shrinking the mask. Keep the control bar wholly outside the crop, keep the
  viewport outline one click-through ring with a transparent centre placed `PANORAMIC_OUTLINE_GAP`
  outside the crop, and validate every IPC sender. The outline must stay capturable rather than
  content-protected (a protected window can stall the display-media stream), and must not be rebuilt
  from thin strips: Windows inflates a two-pixel window to about 30x38 and the inflated top strip
  lands inside the captured region. Never append a frame when
  `analyzePanoramicMovement` is not accepted: rejection is the corruption boundary. Retain only
  uncovered rectangles, not full viewport copies; revisiting coverage must add nothing. Pointer
  masks deliberately remain uncovered until another clean viewport fills them. Preserve trusted
  interior promotion for provisional edges, the 62% step bound, and broad-plus-detail history
  authority. Up, down,
  left, and right can change per match, but diagonal movement is deliberately rejected. The coarse
  `capturedHistory` grid in `panoramic-record.ts` is load-bearing for reverse routes: it resolves
  otherwise-symmetric consecutive-frame matches against the complete mosaic without lowering output
  resolution. The final
  canvas is allocated only once. Do not show the action on macOS until control exclusion and cursor
  repair are proven in ScreenCaptureKit output. See D-042.
- Highlighter: a pen stroke that composites differently. Geometry is shared with the pen throughout `src/shared/annotations.ts` (the switches are exhaustive, so adding an annotation type makes the compiler name every place that must handle it), and only `renderAnnotation` in `src/renderer/render.ts` diverges. It uses `source-over` at 52% so saturated colours remain visible on dark captures. Two details there are load-bearing: the path must be drawn in a single `stroke()` call or self-crossings composite twice and darken, and caps are `butt` because a round cap at highlighter widths overhangs the end of the drag. It also keeps its own width and slider range separate from the pen's. See D-035.
- Blur/Pixelate intensity: the 1-100% UI state lives in `src/renderer/editor.ts`; monotonic percentage-to-radius/block mappings live in `src/renderer/render.ts` and are covered by `tests/effects.test.ts`. Do not reconnect these effects to `lineWidth`.
- Visual system: `src/renderer/styles.css`
- Shared types and geometry: `src/shared/`
- Annotation bounds, hit-testing, movement, and resizing: `src/shared/annotations.ts`
- Connected-color flood fill, tolerance metric, and feather mask: `src/shared/transparency.ts`; command replay/cache and export ordering: `src/renderer/render.ts`; popup workflow and Before/After/Split preview: `src/renderer/editor.ts` / `index.html` / `styles.css`
- Settings window UI: `src/renderer/settings.ts` / `settings.html` / `settings.css`
- Settings validation and shortcut parsing (pure, tested): `src/shared/settings.ts`,
  `src/shared/shortcut.ts`. The recorder intentionally accepts every Electron-supported
  non-modifier key bare or in a chord—including Print Screen and Escape. Do not restore the former
  Ctrl/Alt requirement. Modifier-only/unsupported keys remain invalid, and a genuine OS
  registration refusal still restores the previous working shortcut. See D-040.
- Settings persistence and application: `src/main/settings.ts`, plus login-item, tray, shortcut, and save wiring in `src/main/index.ts`. `GlobalSettings.openAtStartup` defaults off; only packaged Windows/macOS builds may call Electron's login-item API, and failed changes must roll the persisted toggle back. See D-016.
- macOS GIF clipboard: `gif:preview-copy` in `src/main/index.ts`. macOS and Windows both copy the GIF as a *file* so the animation survives; only the mechanism differs (`public.file-url` versus the native helper's `CF_HDROP`). Do not go back to writing raw bytes: the old `public.gif` type is not a real UTI, so macOS stored nothing while Copy still reported success. The pasteboard read-back after the write is what stops that failing silently again. See D-023.
- Overlay safe areas: `CapturePayload.safeArea`, applied through `src/renderer/safe-area.ts`. The macOS overlay spans the whole display, so Capturo's hint and status toast must be inset past the menu bar area (which holds the notch) and the Dock. Never inset the canvas itself — those edges must stay capturable. The screenshot and GIF overlays are separate entry points with separate `initialize()` functions that share `styles.css`; the helper exists because fixing one and forgetting the other is precisely what happened. See D-029.
- macOS overlay focus: `revealOverlay` calls `app.focus({ steal: true })` before focusing the editor. macOS will not make a window key while the application is inactive, and Capturo is a tray app with no Dock icon, so without it the overlay has no keyboard focus and `Escape` does nothing until the first drag. Verify by checking the frontmost application (`lsappinfo front`) changes to Capturo when the overlay appears, with another app active beforehand. See D-011.
- macOS screen-capture permission: pure status/presentation in `src/shared/permissions.ts` (tested in `tests/permissions.test.ts`); `screenAccessState`, `requestScreenAccess`, `ensureScreenPermission`, and the sender-validated `permissions:*` handlers in `src/main/index.ts`; Global row in `src/renderer/settings.*`. macOS has no readable "not asked yet" state for screen capture, so `denied` must keep offering the request path and no message may say the user refused. Requesting attempts a one-pixel `desktopCapturer` grab: that is the only thing that raises the system prompt and the only thing that puts Capturo into the Screen Recording list. Always pair granting with **Reopen Capturo**, because macOS applies a grant only to a newly launched app. `GlobalSettings.screenAccessWasGranted` separates a first run from a grant that has gone stale; the stale wording says to switch the toggle off and on, and the first-run wording must never mention switching anything off. Capturo must not revoke its own permission with `tccutil`. See D-027.
- macOS packaging and signing: `scripts/sign-mac.mjs` runs as an `afterPack` hook, before the DMG/ZIP are produced. Do not remove it: without it macOS treats the bundle as damaged. It prefers a Developer ID certificate, then a stable local one, then ad-hoc. If macOS keeps re-asking for Screen Recording, that is the ad-hoc fallback, not a bug in the permission code: an ad-hoc designated requirement is `cdhash H"..."`, the app's own code hash, so every build that changes a byte is a different app to TCC while the toggle stays visibly on. Create the `Capturo Local Signing` certificate described in RELEASING.md and it stops. Distribution still needs a real Developer ID; Gatekeeper refuses anything else. See D-028.
- Release checking: bounded GitHub transport in `src/main/updates.ts`; stable semantic-version parsing/evaluation and typed renderer API in `src/shared/updates.ts`; scheduling, notifications, tray state, and sender-validated IPC in `src/main/index.ts`; Global UI in `src/renderer/settings.*`. Automatic checks default off, persist a last-check timestamp, run at most daily across restarts, and must stay notification-only until signed updating is designed. Never check commits, accept prereleases on the stable channel, send capture/settings data, accept an arbitrary release URL from a renderer, or check while capture/encoding is active. See D-025.
- Native Windows capture/OCR helper: `native/capturo-capture/main.cpp` (one-shot `--output`/`--ocr` modes plus a persistent serve mode). `src/main/capture-helper.ts` owns its lifecycle: spawn, warm at launch, batch request with timeout, restart, and kill on quit. The same serialized serve protocol owns HDR capture, local `Windows.Media.Ocr`, Windows DWM border suppression, and animated-GIF file copy through `CF_HDROP`; keep those native operations out of the sandboxed renderer. HDR pixels above SDR white must use one shared RGB scale so their channel ratios survive conversion, and `build.cmd` must keep running the helper's `--self-test`. The SDR white level divides the whole frame. For FP16 screenshots it must be measured after frame acquisition; a cached or guessed value is rejected after a short retry. The display-configuration query itself is retried because Windows can fail it transiently on build 26200. Picker live samples retain the older cached/guessed behavior for latency. Match outputs by exact desktop origin only. When a capture looks washed or over-saturated, run with `CAPTURO_TIMING=1` first: it names the pixel format, HDR state, SDR white level, and where that level came from, per display, and main stops Windows selection if the native frame cannot be verified, because Chromium capture cannot tone map HDR. Check factory freshness before and after warm acquisitions, and clear the helper display cache on lock, unlock, and resume. The helper must remain in a multithreaded COM apartment for C++/WinRT async `.get()`, and a COM/runtime change requires both OCR and DXGI capture regressions. See D-015, D-017, D-021, D-023, D-026, and D-038.
- Copy text: toolbar and `Ctrl/Cmd+Shift+C` handling in `src/renderer/index.html` / `editor.ts`; typed bridge in `src/shared/types.ts` / `preload/index.ts`; sender/session validation, normalization, clipboard ownership, and error mapping in `src/main/index.ts`; pure normalization and the platform message mapping in `src/shared/ocr.ts`; native in-memory PNG recognition in `src/main/capture-helper.ts` with `native/capturo-capture/main.cpp` on Windows and `native/capturo-ocr-mac/main.swift` on macOS. It must OCR the final rendered selection, automatically commit pending transparency, close only after a non-empty clipboard write, and never log, upload, or persist recognized pixels/text. See D-026 and D-036.
- macOS text recognition: `native/capturo-ocr-mac/main.swift`, built universal by `build.sh` and rebuilt automatically by `npm run dist:mac`. It answers only `ocr-png`, because macOS captures come from `desktopCapturer` and its clipboard from Electron. Two things are easy to get wrong: the availability gate is `textRecognitionAvailable()` rather than `captureHelperAvailable()` (the latter stays Windows-only), and the `language` failure stage cannot occur on macOS, so no macOS path may advise installing a language pack. Vision returns observations unordered in a bottom-left origin space, so reading order is reconstructed in the helper and is the part to check first if pasted text comes out scrambled. See D-036.
- GIF capture: region-selection overlay `src/renderer/gif.ts` / `gif.html`; recording control bar `src/renderer/gif-record.ts` / `gif-record.html`; post-recording preview `src/renderer/gif-preview.ts` / `gif-preview.html`; encoder + worker `src/renderer/gif-encoder.ts` / `gif-worker.ts` (uses `gifenc`); shared types and timing helpers in `src/shared/gif.ts`. Window lifecycle, in-memory preview bytes, save/reveal/retake/discard, and Windows clipboard-file actions live in `src/main/index.ts`. `GifSettings.preTimerSeconds` is validated to 0-10 seconds and defaults to 3; `showFrameCount` defaults true and only controls HUD visibility, never sampling, backpressure, or encoded output. The stream is prepared before the countdown; frame sampling, the active timer, and smoke auto-stop begin only when it reaches zero. Frame timestamps then use active elapsed time from the recording renderer; the encoder assigns actual deltas to pending frames and carries GIF centisecond rounding error forward. Do not replace this with fixed nominal delays or start active time during the countdown. See D-018, D-019, and D-023.

## Documentation handoff

Documentation is part of the implementation, not a release-day cleanup. Before handing work to another developer or LLM, follow the document-routing checklist in `CONTRIBUTING.md`, update every file whose present-tense claims changed, and record new regression coverage in `TESTING.md`. Historical release notes stay historical; current-state sections must not keep superseded targets or unfinished-release language.

## Verification expectations

Every behavior change should pass `npm run typecheck`, `npm test`, and `npm run build`. UI changes require at least one real capture smoke test. Update the functional checklist and known constraints in `PROJECT_STATE.md` before handing off.

Transparency is an annotation-history command but is deliberately not selectable as a vector object. It must run against source pixels before every visible annotation, remain constrained to the crop region captured when sampled, and force PNG only when at least one applied transparency command remains. Do not bake it into `sourceImage`, globally replace matching colors, or let save fall back to JPEG. The render cache keeps only the live and Before composites; retaining every slider state would hold multiple full-size RGBA canvases. `Ctrl/Cmd+Z` removes the most recently applied transparency command through the existing history. Copy and Save must call `commitTransparencyDraft()` before export so the live preview is never silently omitted when the user skips the optional Apply button.

## Current performance state

OPT1 and OPT2 are implemented in the GIF pipeline (D-020). Worker acknowledgements bound the queue to two transferred frames; do not remove the acknowledgement or raise the bound casually, because each queued 1920x1080 RGBA frame is about 7.9 MiB and a 4K frame is about 31.6 MiB. When the bound is full, the renderer skips the sampling tick before canvas readback. The timestamp invariant makes this safe: the preceding visible frame receives the longer real elapsed duration.

The encoder's equality scan collects at most 25% of the region into reusable changed-pixel and position scratch buffers. It quantizes/maps that compact set and scatters it into a transparent indexed frame. More widespread changes return early to full-frame quantization and differencing. Fully identical frames still coalesce. Tests assert sparse/coalesced/full strategy selection and decode a sparse animation through Sharp to prove both changed and unchanged pixels composite correctly. If further optimization is needed, profile real recordings before evaluating `rgb444` or a multi-worker ordered encoder; neither is part of the current pipeline.

## Platform follow-up

Windows can be built and exercised from this repository's current host. The final macOS pass must verify Screen Recording permission recovery, Retina output, menu-bar behavior, clipboard copy, native Save As, signing, and notarization on real macOS hardware or a macOS CI runner.

macOS builds now run and their non-capture surfaces have been exercised on macOS 26.2 (arm64). Capture itself remains unverified because TCC will not hold a Screen Recording grant for an ad-hoc signature. Get a Developer ID Application certificate before spending any more time on macOS capture behavior; nothing in the code can work around it.

When testing a macOS build, launch it with `open -a /Applications/Capturo.app`, never by executing `Capturo.app/Contents/MacOS/Capturo` from a shell. TCC attributes a directly executed binary's capture request to the parent terminal rather than to Capturo, so permission behavior measured that way is meaningless and can look like it works when it does not. The smoke environment flags below can be passed through `open` with `--env`.

The development-only `CAPTURO_CAPTURE_ON_START=1` environment flag opens capture at launch and uses a temporary user-data scope. It exists for smoke automation and does not alter normal single-instance production behavior.

`CAPTURO_SCREEN_ACCESS_STATE=denied` (also `not-determined`, `restricted`, `unknown`, `granted`) overrides the reported macOS Screen Recording status in unpackaged builds only. A machine that has already granted the permission cannot otherwise reach the states that matter, so this is how the Screen recording row is exercised and screenshotted. Combine it with a `settings.json` containing `screenAccessWasGranted: true` in the development user-data folder to see the stale-grant wording. It is ignored entirely once `app.isPackaged` is true.

`CAPTURO_SETTINGS_ON_START=1` likewise opens Settings at launch with temporary user data. Use it to exercise Global/Capture/GIF tab rendering and preference persistence without touching the installed app's settings or registering the development Electron executable as a login item.

Set `CAPTURO_TIMING=1` to print capture-path phase timings to stderr: how long frames took to grab (with the native helper's own setup/acquire/convert/encode breakdown, which it always reports in its JSON) and how long overlays took to load. It is silent otherwise and is the way to quantify invocation latency.

Two GIF smoke flags mirror `CAPTURO_CAPTURE_ON_START`: `CAPTURO_GIF_ON_START=1` opens GIF region selection at launch, and `CAPTURO_GIF_RECORD_SMOKE=1` records a fixed centre region for a few seconds and saves it to `%TEMP%\capturo-smoke.gif` with no dialog, the way to exercise the record → encode → save pipeline without the selection UI.

`CAPTURO_GIF_PREVIEW_ON_START=1` opens `%TEMP%\capturo-smoke.gif` directly in the post-recording preview with isolated development user data. Use it for repeatable layout, Copy, Save, Open folder, Retake, Discard, and keyboard checks without recording a new GIF each time. Add `CAPTURO_GIF_PREVIEW_SCREENSHOT=1` to write `%TEMP%\capturo-gif-preview-smoke.png` after the animated preview has rendered.

Set `CAPTURO_OCR_SMOKE_IMAGE` to an absolute PNG/JPEG path and launch Electron to exercise the real app → persistent helper → local recognizer → Electron clipboard path, on either platform. On macOS a packaged build takes it through `open -a /Applications/Capturo.app --env CAPTURO_OCR_SMOKE_IMAGE=...`, and `capturo-ocr --ocr <image>` / `--languages` isolate the recognizer the way `capturo-capture.exe --ocr` does on Windows. The smoke uses isolated user data, runs before login-item reconciliation, logs counts rather than recognized contents, and quits. It does overwrite the clipboard. The one-shot helper command `capturo-capture.exe --ocr <image>` is useful for native diagnosis but prints recognized text, so do not use a sensitive image. Always follow a helper COM/runtime change with one `--output` screenshot regression as well.

Beware when verifying GIF recording: the control bar, border ring, and shade are content-protected (`setContentProtection(true)` → WDA_EXCLUDEFROMCAPTURE), which excludes them from **all** screen capture, including any automated screenshot. They are invisible to tooling and can only be judged by eye on real hardware. That same property is what keeps them out of the recorded GIF. On Windows, do not remove the post-construction `setBounds` call, the native helper's `window-border` request, the recording-specific `surroundingStrips` orientation, or the ring z-order reassertion. Transparent frameless windows can acquire intermittent DWM edge rendering; every shade edge facing the recording now terminates under the red ring instead of crossing the display. See D-021.

Overlay presentation has two separate hazards, and fixing one does not fix the other.

First, do not reveal the overlay from `did-finish-load`. The renderer must draw the captured desktop and acknowledge `capture:ready`, or Windows presents the BrowserWindow background as a full-screen flash.

Second, reveal the overlay by opacity, not by taking it from hidden to shown. `showInactive()` is called immediately after the window is created, while it is still fully transparent and set to ignore mouse events, and `capture:ready` reveals it with `setOpacity(1)`. This keeps the window painting while invisible and stops it swallowing pointer input before it is ready. The reveal is immediate because dropping `WS_THICKFRAME` (`thickFrame: false`) suppresses the window-open animation that the old 250 ms floor existed to hide. Do not reintroduce that floor, and do not move `showInactive()` into the ready handler. See D-011.

When verifying either, difference consecutive video frames. Average luminance does not change meaningfully during a scale animation and will report a broken build as fixed.

Third, the overlay's size passed to the `BrowserWindow` constructor is only a request. Windows adds frame insets and clamps it, so `setBounds` is re-applied immediately after the window is created and before the renderer loads. See D-012.

Fourth, on Windows a display is covered by several tiled overlays, never by one window spanning it: an editor over `display.workArea` plus a filler per uncovered strip. Merging them into a single full-display window makes Windows classify it as a full-screen application and switch on Do Not Disturb during every capture. See D-013.

macOS is the exact opposite and the two must not be unified. AppKit clamps an ordinary window into the screen's visible frame, so a strip over the menu bar or the Dock is moved back inside the work area: measured on macOS 26.2, a menu-bar strip requested at `y=0` landed at `y=33` and a Dock strip requested at `y=899` landed at `y=867`, which painted the frozen Dock over the editor while the real Dock stayed visible below it. macOS therefore uses one overlay over the whole display with `enableLargerThanScreen: true`; without that option the same window is pushed to `y=33` and hangs off the bottom. The split is decided by `overlayRegions` in `src/shared/geometry.ts` and is covered by `tests/geometry.test.ts`. See D-029.

The tray's primary click must always start a capture. Do not call `setContextMenu` on macOS: there an assigned menu also opens on the primary click while `click` still fires, so a menu-bar click opened the menu and started a capture at once. macOS builds the menu, keeps it in `trayMenu`, and pops it up from the secondary click and Control-click; Windows keeps `setContextMenu`. Replace the retained menu on every tray refresh or a stale shortcut label survives a rebind. See D-030.

That tiling is why the renderer derives scale from `captureSize` and offsets pointer positions by `imageOrigin`, instead of dividing by its own viewport. Each overlay holds the whole frozen desktop and shows one slice of it. Reverting that maths to the viewport rescales the desktop to fit whichever slice a window covers and skews every selection, subtly enough to look fine.

Only the editor takes input; pointer capture carries a drag that began there out over the fillers, which is how selections reach the taskbar. The editor publishes the scene to its fillers on every redraw. Drop that and the strips stop shading with the selection.

The two toolbar rows are intentionally ordered primary-first and contextual-second in `src/renderer/index.html`.

The renderer is a two-page build: `electron.vite.config.ts` lists both `index.html` (capture overlay) and `settings.html` (settings window) as Rollup inputs, and both emit into `out/renderer`. Dropping the second input, or renaming a page, breaks the settings window, which `src/main/index.ts` loads by filename (`settings.html`) in packaged builds and as `${ELECTRON_RENDERER_URL}/settings.html` in dev.

`npm run icons` regenerates every Capturo brand asset from the sole canonical `build/icon-source.png`: `build/icon.png` (1024px, which electron-builder turns into the `.icns` and `.ico`), `build/taskbar-icon.png` (Settings window, GIF preview window, notifications), `build/tray/tray-icon.png` plus its `@2x` sibling (Windows notification area, in colour), and `build/tray/tray-iconTemplate.png` plus its `@2x` sibling (macOS menu bar, monochrome). The generator does two things beyond resizing, both recorded in D-009: it keys out the backdrop the logo is delivered on using a connected fill from the outer edges, so the dark focus brackets inside the card survive; and it reduces the mark to a black silhouette for the macOS template, because a colour logo renders as a filled tile among the system glyphs. Do not hand-edit a generated PNG, add a second logo, or apply a transform outside this script. Inspect the actual 16px and 32px output, on both a light and a dark bar, after changing the canonical source.
