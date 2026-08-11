# Handoff

## Start here

Read `PROJECT_STATE.md`, then run:

```powershell
npm install
npm run build
npm run dev
```

Windows artifacts are always built into `release/`, and `release/BUILD-INFO.txt` records the version, build time, and a SHA-256 for each artifact. The running app reports its own version in the tray tooltip and tray menu, so an installed copy never has to be identified by guesswork.

The earlier `release-update/` directory has been removed. It existed only because a running Capturo instance held `release/win-unpacked` open during a build, and keeping two directories of similarly named installers made it impossible to tell which build was current. Close any running Capturo before packaging instead of writing to a second directory.

## Product invariant

Capturo opens directly into capture and disappears after copy, save, or cancel. Do not introduce a dashboard, account flow, cloud dependency, or persistent editor without an explicit product decision recorded in `DECISIONS.md`.

## Implementation map

- Native lifecycle and OS integrations: `src/main/index.ts`
- Renderer API boundary: `src/preload/index.ts`
- Capture/editor controller: `src/renderer/editor.ts`
- Canvas replay/export: `src/renderer/render.ts`
- Visual system: `src/renderer/styles.css`
- Shared types and geometry: `src/shared/`
- Annotation bounds, hit-testing, movement, and resizing: `src/shared/annotations.ts`
- Settings window UI: `src/renderer/settings.ts` / `settings.html` / `settings.css`
- Settings validation and shortcut parsing (pure, tested): `src/shared/settings.ts`, `src/shared/shortcut.ts`
- Settings persistence and application: `src/main/settings.ts`, plus the tray, shortcut, and save wiring in `src/main/index.ts`. See D-016.
- Native HDR capture helper: `native/capturo-capture/main.cpp` (one-shot `--output` mode plus a persistent serve mode). Its lifecycle — spawn, warm at launch, batch request with timeout, restart, kill on quit — is `src/main/capture-helper.ts`. See D-015, D-017.
- GIF capture: region-selection overlay `src/renderer/gif.ts` / `gif.html`; recording control bar `src/renderer/gif-record.ts` / `gif-record.html`; encoder + worker `src/renderer/gif-encoder.ts` / `gif-worker.ts` (uses `gifenc`); shared types and timing helpers in `src/shared/gif.ts`. The recording windows (selection teardown, control bar, content-protected border and shade, `setDisplayMediaRequestHandler`, save) live in `src/main/index.ts`. `GifSettings.preTimerSeconds` is validated to 0-10 seconds and defaults to 3. The stream is prepared before the countdown; frame sampling, the active timer, and smoke auto-stop begin only when it reaches zero. Frame timestamps then use active elapsed time from the recording renderer; the encoder assigns actual deltas to pending frames and carries GIF centisecond rounding error forward. Do not replace this with fixed nominal delays or start active time during the countdown. See D-018 and D-019.

## Documentation handoff

Documentation is part of the implementation, not a release-day cleanup. Before handing work to another developer or LLM, follow the document-routing checklist in `CONTRIBUTING.md`, update every file whose present-tense claims changed, and record new regression coverage in `TESTING.md`. Historical release notes stay historical; current-state sections must not keep superseded targets or unfinished-release language.

## Verification expectations

Every behavior change should pass `npm run typecheck`, `npm test`, and `npm run build`. UI changes require at least one real capture smoke test. Update the functional checklist and known constraints in `PROJECT_STATE.md` before handing off.

## Current performance follow-up

The next planned work is GIF encoding optimization, not another timing rewrite. A real 27-second capture at 30 fps and 70% quality produced roughly 800 sampled frames and a ~22 MB GIF, then waited noticeably after Stop. The recorder currently posts every sampled RGBA buffer without worker acknowledgement, so a worker that cannot sustain the requested cadence accumulates a queue; the `finish` message must wait behind it.

Take **OPT1** first: bound the worker queue to two or three frames, acknowledge processed frames, skip sampling while the bound is reached, and expose finalization progress. Skipped samples are compatible with the existing timestamp invariant: the preceding visible frame simply receives the longer real elapsed duration. Then take **OPT2**: compute the changed-pixel set before quantization, combine the identity and difference walks, and run palette work only over changed pixels. Keep a full-frame fallback for broadly changing content. `PROJECT_STATE.md` records the baseline and measured synthetic result. Neither optimization is implemented in the current commit.

## Platform follow-up

Windows can be built and exercised from this repository's current host. The final macOS pass must verify Screen Recording permission recovery, Retina output, menu-bar behavior, clipboard copy, native Save As, signing, and notarization on real macOS hardware or a macOS CI runner.

The development-only `CAPTURO_CAPTURE_ON_START=1` environment flag opens capture at launch and uses a temporary user-data scope. It exists for smoke automation and does not alter normal single-instance production behavior.

Set `CAPTURO_TIMING=1` to print capture-path phase timings to stderr: how long frames took to grab (with the native helper's own setup/acquire/convert/encode breakdown, which it always reports in its JSON) and how long overlays took to load. It is silent otherwise and is the way to quantify invocation latency.

Two GIF smoke flags mirror `CAPTURO_CAPTURE_ON_START`: `CAPTURO_GIF_ON_START=1` opens GIF region selection at launch, and `CAPTURO_GIF_RECORD_SMOKE=1` records a fixed centre region for a few seconds and saves it to `%TEMP%\capturo-smoke.gif` with no dialog — the way to exercise the record → encode → save pipeline without the selection UI.

Beware when verifying GIF recording: the control bar, border ring, and shade are content-protected (`setContentProtection(true)` → WDA_EXCLUDEFROMCAPTURE), which excludes them from **all** screen capture, including any automated screenshot. They are invisible to tooling and can only be judged by eye on real hardware. That same property is what keeps them out of the recorded GIF.

Overlay presentation has two separate hazards, and fixing one does not fix the other.

First, do not reveal the overlay from `did-finish-load`. The renderer must draw the captured desktop and acknowledge `capture:ready`, or Windows presents the BrowserWindow background as a full-screen flash.

Second, reveal the overlay by opacity, not by taking it from hidden to shown. `showInactive()` is called immediately after the window is created, while it is still fully transparent and set to ignore mouse events, and `capture:ready` reveals it with `setOpacity(1)`. This keeps the window painting while invisible and stops it swallowing pointer input before it is ready. The reveal is immediate — there is no longer a fixed delay — because dropping `WS_THICKFRAME` (`thickFrame: false`) suppresses the window-open animation the old 250 ms floor existed to hide. Do not reintroduce that floor, and do not move `showInactive()` into the ready handler. See D-011.

When verifying either, difference consecutive video frames. Average luminance does not change meaningfully during a scale animation and will report a broken build as fixed.

Third, the overlay's size passed to the `BrowserWindow` constructor is only a request. Windows adds frame insets and clamps it, so `setBounds` is re-applied immediately after the window is created and before the renderer loads. See D-012.

Fourth, a display is covered by several tiled overlays, never by one window spanning it: an editor over `display.workArea` plus a filler per uncovered strip. Merging them into a single full-display window makes Windows classify it as a full-screen application and switch on Do Not Disturb during every capture. See D-013.

That tiling is why the renderer derives scale from `captureSize` and offsets pointer positions by `imageOrigin`, instead of dividing by its own viewport. Each overlay holds the whole frozen desktop and shows one slice of it. Reverting that maths to the viewport rescales the desktop to fit whichever slice a window covers and skews every selection, subtly enough to look fine.

Only the editor takes input; pointer capture carries a drag that began there out over the fillers, which is how selections reach the taskbar. The editor publishes the scene to its fillers on every redraw. Drop that and the strips stop shading with the selection.

The two toolbar rows are intentionally ordered primary-first and contextual-second in `src/renderer/index.html`.

The renderer is a two-page build: `electron.vite.config.ts` lists both `index.html` (capture overlay) and `settings.html` (settings window) as Rollup inputs, and both emit into `out/renderer`. Dropping the second input, or renaming a page, breaks the settings window, which `src/main/index.ts` loads by filename (`settings.html`) in packaged builds and as `${ELECTRON_RENDERER_URL}/settings.html` in dev.

`npm run icons` regenerates the application icon plus Windows/macOS tray PNGs from SVG sources under `build/`. Keep tray strokes heavy enough to survive at 16 px; do not restore runtime SVG decoding in the Electron main process.
