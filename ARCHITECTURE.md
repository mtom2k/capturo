# Architecture

## Goals

Capturo is a resident utility, not a document manager. Its steady state must be quiet: one Electron main process, one tray/menu-bar icon, no visible application window. Capture overlays are created only for an active screenshot and destroyed afterward.

## Process model

```text
Tray click / global shortcut
          |
          v
Electron main process
  - enumerates displays and screen sources
  - creates one temporary overlay per display
  - owns clipboard, local OCR bridge, save dialog, notifications, lifecycle
          |
          | narrow, typed IPC through contextBridge
          v
Capture renderer (temporary)
  - renders frozen desktop image
  - selects/moves/resizes capture region
  - stores and renders vector annotation and non-destructive pixel-effect commands
  - exports a cropped PNG data URL
```

The preload exposes only Capturo-specific methods. Renderers have no Node.js access and run with context isolation and sandboxing enabled.

## Capture flow

1. The main process hides any prior overlays and grabs each display's frozen desktop. On Windows this is the native FP16 helper (D-015), which runs as a persistent background process warmed at launch so a capture pays no device/duplication setup (D-017); other platforms, or a Windows machine without the helper, fall back to a `desktopCapturer` thumbnail. The helper captures the requested displays in one batch, and the fallback `desktopCapturer` sources, full-resolution grabs of every screen, are fetched only when a display actually needs them, never on the Windows happy path.
2. It creates a borderless, always-on-top overlay over each display's regions and loads them concurrently, sending each the frozen image plus the origin and size it needs. Every overlay is shown fully transparent while it loads so it paints without being visible and without stealing pointer input. How a display is divided into regions is platform-specific and lives in `overlayRegions` in `src/shared/geometry.ts`: Windows tiles an editor over the work area plus a filler per uncovered strip (D-013), while macOS uses a single window over the whole display created with `enableLargerThanScreen: true`, because AppKit otherwise clamps a window into the work area and leaves the menu bar and Dock uncovered (D-029).
3. Each renderer decodes the desktop image, paints it to the canvas, waits through two animation frames, and acknowledges `capture:ready`. The main process then reveals that overlay by raising its opacity, immediately and with no delay; an unpainted or half-shown full-screen window is never visible (D-010, D-011).
4. The first overlay receiving a pointer press claims the session. Sibling overlays close so only one display is edited.
5. Renderer coordinates are stored in source-image pixels, not CSS pixels. This preserves sharp output on scaled/Retina displays.
6. Copy, Copy text, and save exports render the base image plus edit commands into an offscreen canvas, then crop to the selection. A pending transparency preview is committed before every export.
7. Regular Copy asks the main process to write the lossless bitmap to the clipboard. Save opens a native dialog and forces a `.png` path and PNG bytes when the command list contains transparency.
8. On Windows, Copy text sends that rendered PNG through sender/session-validated IPC to the persistent native helper. The helper recognizes it with `Windows.Media.Ocr`; the main process normalizes line endings and writes only non-empty plain text to the clipboard. Success closes the capture, while no-text or failure leaves the editor open.

Capturo currently selects within one display at a time. This is deliberate: spanning displays with different scale factors requires a normalized virtual-desktop compositor and is outside the minimal first release.

## Annotation model

Annotations are serializable commands rather than baked pixels. Each command contains a tool-specific geometry and its style at creation time. The renderer replays commands whenever selection, tool preview, undo, or export changes.

Every command also exposes deterministic bounds and hit-testing through `src/shared/annotations.ts`. The Select tool searches commands from front to back, then uses those bounds for movement, eight-handle resizing, deletion, and property synchronization. Annotation coordinates are absolute source-image pixels: moving the crop frame never translates annotations.

- `pen`: sampled points, simplified and rendered with quadratic smoothing
- `line` / `arrow`: two endpoints; Shift or Control locks to a 45-degree axis
- `rectangle` / `ellipse`: bounding rectangle
- `step`: numbered circular marker; numbering follows creation order and its slider size is stored through the style's source-pixel font size
- `text`: content, font family, font size, color
- `blur` / `pixelate`: bounding rectangle applied to pixels already rendered beneath it
- `transparent`: seed, crop region, target RGB color, perceptual tolerance, and feather radius; applied to source pixels before visible annotations

The transparency command uses a four-neighbor flood fill, so only matching pixels connected to the sampled seed are removed. Matching uses a Rec. 709-weighted RGB distance exposed as 0-100% tolerance. The binary connected mask is softened with a bounded separable blur for 0-10px feathering, then multiplied into the original alpha. The source image is never mutated. Rendering partitions transparency commands ahead of visible annotations so background removal cannot punch holes through arrows or text, even if those annotations were created earlier.

The renderer caches at most two processed composites per frozen source: the current After result and its Before counterpart for split comparison. Slider changes replace old entries instead of retaining every state. This matters because replaying a connected fill over a large crop on every pointer redraw would make the rest of the editor sluggish.

Text entry is a temporary DOM textarea because it provides native keyboard, IME, multiline, and selection behavior. It does not share pointer capture with the canvas. Committing converts its content into a replayable text command; double-clicking an existing text command reopens the textarea for editing.

The editor UI is a two-row stack anchored to the crop rectangle. The primary tool/action toolbar is always the first row. Tool-specific color, stroke, smoothing, step-size, and typography controls occupy a contextual second row underneath it.

Geometric sizes are continuous and expressed in pixels. Stroke width and numbered-step size are sliders that report their value in `px` and update while being dragged, so a size can be judged against the screenshot underneath rather than guessed from a named step. Text is the exception and keeps a list of preset sizes, because type is conventionally chosen from known values. All of these are CSS-pixel values converted to source-image pixels through the capture scale at the point they are stored, so a size means the same thing on any display.

Blur and Pixelate are not geometric stroke sizes. Their `effectIntensity` is stored independently as 1-100%. Rendering maps that percentage monotonically to a 1-32 CSS-pixel-equivalent canvas blur radius or a 2-64 CSS-pixel-equivalent pixel block, multiplied by the capture's source-pixel scale so the visible strength is consistent on scaled displays. This gives both tools a common direction (higher always obscures more) without allowing a previous pen width to change the next privacy effect. Existing effect annotations retain their percentage and capture scale when selected, moved, resized, or exported.

## Copy text (Windows OCR)

Copy text deliberately reuses the final screenshot export rather than OCRing the original display frame. Crop, annotations, privacy effects, and automatically committed transparency therefore match what the user sees. The sandboxed renderer receives no native capability: it can request `capture:copy-text` only for its active session and supplies a PNG data URL under the same typed context bridge as image Copy/Save.

`src/main/capture-helper.ts` converts the validated PNG to base64 and sends one `ocr-png` request over the existing serialized private stdin/stdout protocol. The request is bounded to 64 MiB of PNG bytes and a 20-second timeout. `native/capturo-capture/main.cpp` decodes entirely into a WinRT in-memory stream, downsizes images beyond `OcrEngine::MaxImageDimension`, obtains an engine from the current user's installed OCR languages, and returns JSON-escaped UTF-8 text. It never writes OCR pixels to disk or opens a network connection. The main process trims only outer/presentation whitespace, preserves internal spaces and blank lines, and owns `clipboard.writeText`.

The helper initializes a multithreaded COM apartment because the synchronous C++/WinRT `.get()` calls used by its private worker process are not legal in a single-threaded apartment. DXGI desktop duplication, WIC encoding, DWM attributes, `CF_HDROP`, and OCR all share this process and serialized protocol; a change to its COM apartment requires rerunning both the OCR/clipboard smoke and a native screenshot regression. See D-026.

## Settings

Preferences are opened on demand from the tray and never form part of the steady state: the settings window is a normal framed `BrowserWindow`, reused if already open and destroyed on close. It loads the second renderer entry point (`settings.html`) through the same sandboxed, context-isolated preload as the capture overlays, and communicates only through the explicit `settings:get` / `settings:update`, `updates:check`, and `updates:open-releases` IPC handlers. See D-016 and D-025.

The source of truth is an in-memory settings object in the main process, validated by `normalizeSettings` in `src/shared/settings.ts` and persisted to `settings.json` under `app.getPath('userData')`. This is the only settings file Capturo writes, and it holds no captured pixels, only the global open-on-startup/update-check preferences and last-check timestamp, capture format/quality/notification/shortcut preferences, and GIF frame-rate/quality/pre-timer/frame-count-visibility/shortcut preferences. Capture format and quality affect saved files only; the clipboard stays a lossless bitmap, so they are applied in the main process at save time and never cross into the renderer. Rebinding either shortcut re-registers the global accelerator and rebuilds the tray menu, rolling back to the previous working shortcut if the new one is rejected by the OS.

Open on startup is also applied in the main process. Packaged Windows and macOS builds call Electron's login-item API when the preference changes and reconcile it again on every launch; a rejected change rolls the stored toggle back and returns an inline error to Settings. Development builds persist and render the value for UI work but deliberately do not register the Electron development executable with the operating system.

On macOS the Global tab also shows the Screen Recording permission, because the platform refuses
capture until the user grants it and a refused Capturo captures nothing (D-027). `screenAccessState()`
in the main process reads `systemPreferences.getMediaAccessStatus('screen')`; the pure presentation
logic in `src/shared/permissions.ts` turns that into a message and the actions to offer. macOS has no
readable "not asked yet" state for screen capture — the status is a boolean preflight, so a first run
and a refusal both report `denied` — so the copy never accuses the user of refusing, and `denied`
still offers the request path. Requesting attempts a one-pixel `desktopCapturer` grab, which is the
only thing that raises the system prompt and the only thing that adds Capturo to the Screen Recording
list; `ensureScreenPermission` does the same before falling back to its dialog. The row hides itself
where the platform reports the permission unsupported, so Windows Settings is unchanged. The renderer
reads status but cannot grant it: requesting and opening the Screen Recording pane are main-process
actions behind the same Settings-sender check as the update handlers.

Update checks are stable-release notifications, not an installer (D-025). `src/main/updates.ts` performs one bounded HTTPS GET to GitHub's public `releases/latest` API with no authentication or application data. Pure validation in `src/shared/updates.ts` accepts only non-draft, non-prerelease `vMAJOR.MINOR.PATCH` releases and compares them with `app.getVersion()`. Manual checks are available only from the Settings sender; automatic checks are packaged-build-only, disabled by default, delayed after startup, persisted to at most once per 24 hours across restarts, and deferred while screenshot/GIF capture or encoding is active. A newer version adds a fixed official-release action to the tray and a local notification. The sandboxed renderer cannot provide a URL, download bytes, or initiate installation.

The endpoint must remain publicly readable. `mtom2k/capturo` is public and its anonymous `releases/latest` endpoint is the production feed; Capturo intentionally carries no GitHub token because a credential shipped in a desktop binary is not secret. If releases ever move to a dedicated public repository, migrate the API constant in `src/main/updates.ts` and browser URL in `src/shared/updates.ts` together and repeat the packaged network smoke.

## GIF capture

GIF capture records a live screen region to an animated GIF, opened from the tray **New GIF** item or a rebindable shortcut, parallel to a screenshot (see D-018). Region selection reuses the screenshot's frozen-overlay machinery through a slim GIF renderer (`gif.html`/`gif.ts`); only the toolbar and the post-selection action differ.

On Start, the selection overlays are torn down and the main process opens the recording chrome over the display: a control bar (`gif-record.html`/`gif-record.ts`), a border ring, and dim shade strips outside the region. All are content-protected so they are excluded from the capture, the border and shade are click-through so the region stays live, and the shade is tiled (never one full-monitor window) to avoid the Do Not Disturb classification (D-013). On Windows, every recording-chrome window has its exact integer bounds reapplied after construction and the persistent native helper disables DWM non-client rendering and sets the border colour to `DWMWA_COLOR_NONE` before first show. The side shades span the display height while top and bottom span only the selection width, so every internal compositor edge ends at the red ring and is covered by it. The ring's z-order is reasserted after independently loaded chrome appears (D-021). Once `getDisplayMedia` is ready, the control bar runs the configured 0-10 second pre-timer (default 3); Pause and Stop remain disabled, Cancel remains available, and no frame or active recording time is accumulated during this state. At zero, the recording renderer samples the first frame immediately, then samples the region to a canvas at the chosen FPS and streams frames to a `gifenc` Web Worker (`gif-worker.ts`/`gif-encoder.ts`) that quantizes, applies inter-frame differencing, and writes incrementally. Worker acknowledgements cap transferred raw frames at two (one executing and one waiting); when the worker cannot sustain the requested cadence, sampling ticks are skipped before `drawImage`/`getImageData`, bounding both memory and the work left after Stop. The main process's `setDisplayMediaRequestHandler` targets the recorded display, cursor included.

Stop finalizes the worker, destroys all protected recording chrome, and opens a normal framed preview window (`gif-preview.html`/`gif-preview.ts`) with the encoded bytes still held only in main-process memory (D-023). The renderer receives a cloned buffer solely to animate a local Blob URL. Save writes through a native dialog but leaves the preview alive; Open folder is enabled only for that confirmed saved path; Retake clears the preview before reopening region selection; and Discard clears both renderer and main-process references. On Windows, Copy writes an unsaved preview to an app-owned temporary path only on explicit request and asks the persistent native helper to publish that file as `CF_HDROP`. A copied temporary file must survive preview teardown because the clipboard contains its path; files older than 24 hours are eligible for cleanup on a later launch.

The selected FPS is a requested sampling cadence, not the playback clock. Every sampled frame carries its active-recording timestamp from `performance.now()` (paused spans excluded), and Stop sends the final active timestamp. The encoder's one-frame lag assigns each observed elapsed interval to the frame that was actually visible during it, including a longer interval when backpressure skipped sampling ticks. GIF stores delays in whole centiseconds, so rounding remainder is carried between frames. At 30 fps the encoder alternates 30 ms and 40 ms delays rather than rounding every frame down to 30 ms. Static spans longer than GIF's 655.35-second per-frame limit are split across repeated frames instead of being truncated. These rules keep playback duration aligned with the recording timer even when canvas sampling is late or irregular.

For a distinct frame whose changed pixels cover at most 25% of the region, the encoder collects those pixels in the equality scan and quantizes/maps only that compact set; unchanged positions receive the transparent index directly. Frames with broader motion use the full-frame path, avoiding a large sparse copy when it would not help. Fully identical frames still coalesce. The threshold bounds scratch memory and preserves per-frame palettes while making the ordinary desktop case proportional to changed content rather than total region area. See D-020.

## Color picker

The tray menu's **Color picker** opens the same frozen-desktop session a screenshot does, in
`picker` mode, so the overlay renderer is `picker.html` instead of `index.html`. The colour
reported is therefore a pixel of the tone-mapped native capture (D-014), not an untreated
read-back, and it is frozen at invocation: a colour cannot be picked out of a running animation.

`CapturePayload.cursor` carries the pointer position for each overlay, in CSS pixels relative to
that display and null on the displays it is not on, so the picker opens on the pixel already under
the pointer and only the display holding it shows a magnifier. The reveal focuses that display's
editor rather than whichever overlay painted last.

The overlay hides the system cursor, draws a crosshair on the sampled pixel, and draws a magnifier
at a point it owns rather than at the OS cursor position. That indirection is what lets Shift slow sampling to an eighth speed without
the operating system's pointer acceleration fighting it. The pointer model, including how the
resulting displacement is bled off so the screen edges stay reachable, is pure and lives in
`src/shared/picker.ts`. Fine movement reads the modifier from the pointer event, not from a key
listener, because keyboard events only reach the focused overlay and a multi-display capture has
several. See D-032.

Picking closes the capture session and opens the colour window, a plain window rather than an
overlay because the colour outlives the session. It holds the sampled RGB and a separate HSL used
only to position the sliders; the picked value is never round-tripped through HSL, which would
quantize it. Conversions, the related-colour row, and naming are pure in `src/shared/color.ts`.

The renderer can send only a colour and a plain-text clipboard write. The main process validates
the sender, clamps the channels, and bounds the clipboard string; no path or URL crosses this
bridge.

## Platform conventions

Capturo is one codebase for Windows and macOS, not a fork per platform. The platforms differ in
real ways — window management, permissions, clipboard formats, native capture — but the capture
model, annotation model, settings, GIF pipeline, and the entire renderer layer are shared, so
forking would duplicate the large part to isolate the small one. Four rules keep that workable.

**Platform decisions belong to the main process.** Renderers receive data, not platform checks. The
overlay does not ask which OS it is on to avoid the notch; it is handed `CapturePayload.safeArea`
and offsets by it. A renderer that branches on platform cannot be reasoned about from the main
process, and `navigator.userAgent` sniffing in a renderer is not a substitute for the authoritative
answer main already has.

**Platform-varying logic is pure, with the platform as a parameter.** `overlayRegions(bounds,
workArea, tiled)` takes a boolean rather than reading `process.platform`, so both the Windows tiled
arrangement and the macOS full-display arrangement are unit-tested on any machine, on any OS. The
same applies to `presentScreenAccess`, which is exercised for every permission state including the
ones the developer's own machine cannot produce. Anything shaped like `if (isMac)` inside a
calculation is a branch that will only ever be tested on one platform.

**Capability, not platform, decides behaviour where it can.** The screen-permission API reports
`supported: false` rather than making the renderer ask whether it is on macOS, so the Settings row
disappears on Windows without Windows knowing why. `helperAvailable()` gates the native helper the
same way, which is also what lets a Windows machine without the helper fall back cleanly.

**Native code and packaging are scoped at the build.** `native/capturo-capture` is Windows-only and
is declared under the `win` target, so a macOS build neither needs nor copies it. macOS-only
concerns — ad-hoc signing, stripping Electron's unused usage descriptions — live in the
`afterPack` hook and no-op elsewhere. Platform-specific behaviour that cannot be shared is
therefore visible at the edges of the build rather than scattered through the source.

The cost of this is honest feature asymmetry rather than divergence: **Copy text** and HDR-correct
capture are Windows-only because they depend on the native helper, and that is stated in the UI and
the README rather than papered over.

## Source layout

```text
src/main/       Electron lifecycle, capture, tray, native integrations, settings/update checks + capture-helper,
                GIF recording windows (selection, chrome, preview, file actions)
src/preload/    contextBridge API (capture + settings + GIF + updates + permissions + color)
src/renderer/   capture/editor UI, settings window, GIF selection + recording + preview windows,
                color picker overlay + color window, canvas rendering, styles, GIF encoder + worker
src/shared/     IPC, geometry, settings, update-version validation, OCR text normalization,
                screen-permission presentation, transparency, GIF, and color/picker logic
tests/          deterministic unit tests for pure geometry/model/settings/update/OCR/permission/
                transparency/GIF/color/picker behavior
```

## Security boundary

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- no remote content
- no telemetry or captured-data network requests; OCR is local, and optional version checks contact only GitHub Releases
- all native operations are explicit IPC handlers

## Packaging

`electron-vite` builds the three Electron targets. `electron-builder` produces NSIS/portable Windows artifacts and DMG/ZIP macOS artifacts. Code signing and notarization credentials are release-environment concerns and are intentionally not stored in this repository.
