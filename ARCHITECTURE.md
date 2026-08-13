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
  - owns clipboard, save dialog, notifications, lifecycle
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

1. The main process hides any prior overlays and grabs each display's frozen desktop. On Windows this is the native FP16 helper (D-015), which runs as a persistent background process warmed at launch so a capture pays no device/duplication setup (D-017); other platforms, or a Windows machine without the helper, fall back to a `desktopCapturer` thumbnail. The helper captures the requested displays in one batch, and the fallback `desktopCapturer` sources — full-resolution grabs of every screen — are fetched only when a display actually needs them, never on the Windows happy path.
2. It creates a borderless, always-on-top overlay over each display's regions and loads them concurrently, sending each the frozen image plus the origin and size it needs. Every overlay is shown fully transparent while it loads so it paints without being visible and without stealing pointer input.
3. Each renderer decodes the desktop image, paints it to the canvas, waits through two animation frames, and acknowledges `capture:ready`. The main process then reveals that overlay by raising its opacity, immediately and with no delay; an unpainted or half-shown full-screen window is never visible (D-010, D-011).
4. The first overlay receiving a pointer press claims the session. Sibling overlays close so only one display is edited.
5. Renderer coordinates are stored in source-image pixels, not CSS pixels. This preserves sharp output on scaled/Retina displays.
6. Copy and save exports render the base image plus edit commands into an offscreen canvas, then crop to the selection.
7. The main process writes the lossless bitmap to the clipboard or shows a native save dialog. If the command list contains transparency, Save forces a `.png` path and PNG bytes regardless of the stored JPEG preference. Successful copy/save closes the capture session.

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

Sizes are continuous and expressed in pixels. Stroke width and numbered-step size are sliders that report their value in `px` and update while being dragged, so a size can be judged against the screenshot underneath rather than guessed from a named step. Text is the exception and keeps a list of preset sizes, because type is conventionally chosen from known values. All of these are CSS-pixel values converted to source-image pixels through the capture scale at the point they are stored, so a size means the same thing on any display.

## Settings

Preferences are opened on demand from the tray and never form part of the steady state: the settings window is a normal framed `BrowserWindow`, reused if already open and destroyed on close. It loads the second renderer entry point (`settings.html`) through the same sandboxed, context-isolated preload as the capture overlays, and communicates only through the explicit `settings:get` / `settings:update` IPC handlers. See D-016.

The source of truth is an in-memory settings object in the main process, validated by `normalizeSettings` in `src/shared/settings.ts` and persisted to `settings.json` under `app.getPath('userData')`. This is the only settings file Capturo writes, and it holds no captured pixels — only the global open-on-startup preference, capture format/quality/notification/shortcut preferences, and GIF frame-rate/quality/pre-timer/frame-count-visibility/shortcut preferences. Capture format and quality affect saved files only; the clipboard stays a lossless bitmap, so they are applied in the main process at save time and never cross into the renderer. Rebinding either shortcut re-registers the global accelerator and rebuilds the tray menu, rolling back to the previous working shortcut if the new one is rejected by the OS.

Open on startup is also applied in the main process. Packaged Windows and macOS builds call Electron's login-item API when the preference changes and reconcile it again on every launch; a rejected change rolls the stored toggle back and returns an inline error to Settings. Development builds persist and render the value for UI work but deliberately do not register the Electron development executable with the operating system.

## GIF capture

GIF capture records a live screen region to an animated GIF, opened from the tray **New GIF** item or a rebindable shortcut, parallel to a screenshot (see D-018). Region selection reuses the screenshot's frozen-overlay machinery through a slim GIF renderer (`gif.html`/`gif.ts`); only the toolbar and the post-selection action differ.

On Start, the selection overlays are torn down and the main process opens the recording chrome over the display: a control bar (`gif-record.html`/`gif-record.ts`), a border ring, and dim shade strips outside the region. All are content-protected so they are excluded from the capture, the border and shade are click-through so the region stays live, and the shade is tiled (never one full-monitor window) to avoid the Do Not Disturb classification (D-013). On Windows, every recording-chrome window has its exact integer bounds reapplied after construction and the persistent native helper disables DWM non-client rendering and sets the border colour to `DWMWA_COLOR_NONE` before first show. The side shades span the display height while top and bottom span only the selection width, so every internal compositor edge ends at—and is covered by—the red ring; the ring's z-order is reasserted after independently loaded chrome appears (D-021). Once `getDisplayMedia` is ready, the control bar runs the configured 0-10 second pre-timer (default 3); Pause and Stop remain disabled, Cancel remains available, and no frame or active recording time is accumulated during this state. At zero, the recording renderer samples the first frame immediately, then samples the region to a canvas at the chosen FPS and streams frames to a `gifenc` Web Worker (`gif-worker.ts`/`gif-encoder.ts`) that quantizes, applies inter-frame differencing, and writes incrementally. Worker acknowledgements cap transferred raw frames at two (one executing and one waiting); when the worker cannot sustain the requested cadence, sampling ticks are skipped before `drawImage`/`getImageData`, bounding both memory and the work left after Stop. The main process's `setDisplayMediaRequestHandler` targets the recorded display, cursor included. Stop finalizes and the main process saves the bytes to a `.gif` via a native dialog.

The selected FPS is a requested sampling cadence, not the playback clock. Every sampled frame carries its active-recording timestamp from `performance.now()` (paused spans excluded), and Stop sends the final active timestamp. The encoder's one-frame lag assigns each observed elapsed interval to the frame that was actually visible during it, including a longer interval when backpressure skipped sampling ticks. GIF stores delays in whole centiseconds, so rounding remainder is carried between frames — at 30 fps the encoder alternates 30 ms and 40 ms delays rather than rounding every frame down to 30 ms. Static spans longer than GIF's 655.35-second per-frame limit are split across repeated frames instead of being truncated. These rules keep playback duration aligned with the recording timer even when canvas sampling is late or irregular.

For a distinct frame whose changed pixels cover at most 25% of the region, the encoder collects those pixels in the equality scan and quantizes/maps only that compact set; unchanged positions receive the transparent index directly. Frames with broader motion use the full-frame path, avoiding a large sparse copy when it would not help. Fully identical frames still coalesce. The threshold bounds scratch memory and preserves per-frame palettes while making the ordinary desktop case proportional to changed content rather than total region area. See D-020.

## Source layout

```text
src/main/       Electron lifecycle, capture, tray, native integrations, settings + capture-helper,
                GIF recording windows (selection teardown, control bar, border, shade)
src/preload/    contextBridge API (capture + settings + GIF)
src/renderer/   capture/editor UI, settings window, GIF selection overlay + recording control bar,
                canvas rendering, styles, GIF encoder + worker
src/shared/     IPC, geometry, settings, transparency, and GIF types/logic shared across process boundaries
tests/          deterministic unit tests for pure geometry/model/settings/transparency/GIF behavior
```

## Security boundary

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- no remote content
- no telemetry or network requests
- all native operations are explicit IPC handlers

## Packaging

`electron-vite` builds the three Electron targets. `electron-builder` produces NSIS/portable Windows artifacts and DMG/ZIP macOS artifacts. Code signing and notarization credentials are release-environment concerns and are intentionally not stored in this repository.
