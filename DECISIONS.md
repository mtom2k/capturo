# Decision Log

## D-001: Electron with a framework-free renderer

**Status:** accepted

Electron provides one practical screen-capture, tray/menu-bar, clipboard, global-shortcut, and packaging surface for both Windows and macOS. The renderer uses TypeScript, DOM, and Canvas directly; a component framework would add lifecycle and bundle machinery without improving this single-screen interaction.

## D-002: No persistent main window

**Status:** accepted

Capturo is tray/menu-bar first. Clicking the icon starts capture immediately. Preferences and screenshot history are excluded until a concrete need justifies their steady-state cost.

## D-003: Physical-pixel canvas coordinates

**Status:** accepted

All selection and annotation geometry is stored in captured-image pixels. Pointer coordinates are scaled at the renderer boundary. This keeps exports crisp at Windows display scaling and on Retina screens.

## D-004: Vector command annotations

**Status:** accepted

Annotations remain editable/replayable commands until export. This makes preview, undo, selection movement, blur/pixelate ordering, and future serialization simpler than mutating the source bitmap after every pointer event.

## D-005: One-display selection per capture

**Status:** accepted for 0.1

Every connected display gets an overlay, but the first display interacted with owns the capture. A cross-display selection is misleading when displays use different physical scale factors; implementing it correctly requires a compositor and explicit product design.

## D-006: No account, cloud upload, or telemetry

**Status:** accepted

Capturo handles desktop pixels, so local-only behavior is both the smaller product and the safer default.

## D-007: Neutral compact visual system

**Status:** accepted

The UI uses system fonts, solid neutral surfaces, one blue focus color, small radii, and restrained shadows. There are no gradients, oversized headings, mascots, glass effects, onboarding panels, or generative-AI motifs.

## D-008: Crop and annotation coordinates remain independent

**Status:** accepted

Moving the capture rectangle changes only what will be cropped. Annotation geometry remains anchored to the frozen desktop image. This matches the expectation that moving a viewport does not move the content placed over the desktop.

## D-009: Explicit raster application and tray assets

**Status:** accepted

The application and tray marks are maintained as high-resolution canonical PNG sources, then converted into explicit output sizes at build time. Windows tray icons never depend on runtime SVG data-URL decoding, which can create a clickable but visually transparent notification-area entry.

**Amended in 0.15.1:** `build/icon-source.png` is the sole canonical Capturo artwork. The icon generator only resizes that exact image into the 512px package icon, 256px Settings/taskbar/notification icon, and 16px/32px notification-area/menu-bar files. There is no secondary tray source, crop, mask, recoloring, or macOS template substitution. The visible Settings window receives its derivative explicitly through `BrowserWindow.icon`, notifications receive the same runtime resource, electron-builder uses the 512px derivative, and both Windows and macOS tray creation load the same full-color 16px derivative (with its `@2x` sibling available on high-DPI displays). Keep every brand surface derived from this one source rather than hand-editing generated PNGs.

## D-010: Present capture overlays only after first paint

**Status:** accepted

Capture overlays remain hidden while their desktop data URL decodes and paints. The renderer acknowledges readiness after two animation frames, and only then may the main process present the window. This prevents the full-screen BrowserWindow background from appearing as a black/maximized flash during capture startup.

## D-011: Reveal overlays by opacity, never by a hidden-to-shown transition

**Status:** accepted

Windows plays a scale-and-fade transition whenever a window goes from hidden to shown, and it honours that setting for borderless full-screen windows. Showing a painted overlay therefore still animated the desktop into place even though D-010 had removed the black flash. The two are separate defects, and D-010 alone does not fix this one.

The overlay is now shown transparent immediately after it is created, so the platform transition runs before there is anything to see, and D-010's readiness acknowledgement raises its opacity instead of calling `show`. An opacity change is composited directly and is never animated. Until the reveal the window sets `setIgnoreMouseEvents(true)` so an invisible full-screen window cannot swallow clicks meant for the app underneath.

Verification must measure geometric motion between consecutive frames, not average luminance. A scale animation moves the same desktop image, so frame-average brightness barely changes and a luminance check reports success while the animation is still plainly visible.

**Amended (0.10.0): the reveal no longer waits out a fixed delay.** The opacity reveal above once carried a 250 ms floor that spent the window's show transition while the overlay was invisible. Dropping `WS_THICKFRAME` (`thickFrame: false`, added in 0.9.1 to remove the Windows 11 border) also suppresses that open transition, so there is no animation left to wait out. `revealOverlay` now raises the opacity the instant the renderer acknowledges `capture:ready`, with no timer. The transparent-early + opacity mechanism is kept: it still guarantees the window has painted before it is visible (D-010) and cannot swallow pointer events before then, and an opacity change is itself never animated. The same frame-differencing verification applies — a correct reveal is a single hard cut with no black frame and no motion on either side.

## D-012: Overlay bounds are re-applied after the window exists

**Status:** accepted, target amended by D-013

Windows treats a window's *construction* size as a request: it adds frame insets and clamps the result, so the overlay's viewport did not match the area it was meant to occupy. Calling `setBounds` once the window exists is honoured exactly. D-013 changes which rectangle is applied; the need to re-apply it is unchanged.

This is not a cosmetic detail. Because the renderer converts pointer positions into source-image pixels using its own viewport size, a viewport smaller than the display silently rescales everything: the frozen desktop is squashed to fit, and every selection and export is skewed by the ratio between the two. The defect appeared as exports about 3.2% too tall, which is small enough to survive casual inspection and is why it went unnoticed through 0.2.0.

The bounds must be re-applied before the renderer loads, and the window is still transparent at that point, so the resize is never visible. Verify with an exact-pixel test rather than by eye: drag a known rectangle, then confirm both the exported dimensions and the exported pixels match that rectangle. A size-only check passes builds that are correctly sized but misaligned.

## D-013: A display is covered by tiled overlays, never by one full-screen window

**Status:** accepted

Windows classifies any window that covers a monitor as a full-screen application, and that classification drives the "turn on Do Not Disturb when using an app in full-screen mode" rule, which is enabled by default on Windows 11. A single overlay sized to the display therefore switched the machine into Do Not Disturb for the length of every capture and showed the bell indicator in the notification area.

The classification is geometry alone. Measured against `SHQueryUserNotificationState`, it is unaffected by always-on-top level, focusability, transparency, or taskbar presence, and a window falling 4 DIP short of the monitor still counts while one falling 8 DIP short does not. Shrinking the overlay is therefore not a fix: it only moves which strip of the screen cannot be captured.

What the check does not do is add windows together. A display covered by an editor window over `display.workArea` plus a filler window for each strip the work area leaves uncovered reads as `QUNS_ACCEPTS_NOTIFICATIONS`, while a single window over the same pixels reads as `QUNS_BUSY`. Capturo therefore tiles: the whole display stays capturable, the taskbar included, and no window is ever classified as full screen.

Two consequences shape the renderer:

Every overlay of a display receives the whole frozen desktop plus its own origin within it, and derives scale from the captured region rather than from its viewport. Deriving scale from the viewport would rescale the desktop to fit whichever slice the window happens to cover and skew every coordinate by the difference, which is the defect D-012 was written for.

Only the editor handles input. Pointer capture keeps a drag that started in the editor alive over the fillers, so selections extend into the taskbar normally. Fillers are passive and repaint from scene updates the editor publishes, so the strips they cover shade and highlight in step; without that they would sit visibly undimmed while the rest of the screen darkened.

## D-014: The frozen desktop is grabbed in the renderer, not handed over as an image

**Status:** accepted, with one unresolved consequence

`desktopCapturer` thumbnails are wrong on an HDR display. Windows composites the desktop in scRGB where 1.0 is 80 nits and ordinary windows sit above that, scaled by the SDR content brightness setting. The thumbnail conversion does not divide that back out, so the result is roughly 1.6x too bright and clips. Measured against a drawn pattern, greys of 32/64/96/128/160/192 came back as 59/109/160/210/255/255: everything above about 60% grey became flat white, and no correction after the fact can recover it.

Chromium switches do not help. WGC capturer flags, `force-color-profile=srgb`, and HDR-disabling flags all produced byte-identical broken output, because they govern the stream pipeline rather than the one-shot thumbnail.

A capture stream opened in the renderer does return correct pixels: the same pattern round-trips within 1/255, and a real capture matches a GDI reference exactly. Each overlay therefore opens a stream for its own display, takes one frame, and uses that as the frozen desktop. Main only resolves source identities, so no large image crosses the process boundary and the PNG encode and base64 round trip are gone.

Verify against ground truth, not against Capturo's own rendering. Comparing an export with a grab of the overlay displaying it is self-consistent and passes even when the colour is wrong. Compare a static region against a GDI grab of the same pixels with no overlay running; a correct capture matches on every channel.

**Superseded by D-015.** The stream was better than the thumbnail but still wrong: measured against Snipping Tool it was 2.5x too bright in linear light and clipped everything above roughly 180, because Chromium converts to 8 bit before any JavaScript sees the frame. It also composited the mouse pointer, which no amount of cursor hiding prevented. Both are fixed by capturing natively.

## D-015: Windows captures through a native FP16 helper

**Status:** accepted

Chromium hands over an 8-bit frame that has already been converted, and on an HDR display that conversion is wrong. Windows composites in scRGB where 1.0 is 80 nits, then renders ordinary content at its own reference white, so SDR white sits well above 1.0 in the buffer. Converting without undoing that scale multiplies everything and clips the result. No option available inside the app avoids it: WGC and colour-profile switches changed nothing, `float16` canvas pixel formats are ignored, and the wide-gamut canvas colour spaces do not exist in this Chromium.

Windows capture therefore runs through `native/capturo-capture`, a small executable invoked per capture. It duplicates the output in `DXGI_FORMAT_R16G16B16A16_FLOAT`, reads the live SDR white level through the display configuration APIs, divides by `sdrWhiteNits / 80`, tone maps in linear light, and encodes sRGB only at the end. Everything below SDR white passes through untouched, so ordinary window content is reproduced with the values it was authored with. Against a known pattern the round trip is exact, with zero error on every step from black to white.

Three details are easy to get wrong:

`DuplicateOutput1` returns `DXGI_ERROR_UNSUPPORTED` unless the process is per-monitor DPI aware. This is a documented requirement and gives no other clue as to the cause.

DXGI enumerates outputs in its own order, which does not match the host's display list. Selecting by index captures the wrong monitor, silently and convincingly. Displays are matched by physical desktop origin instead, obtained with `screen.dipToScreenRect`.

A rotated output duplicates into an unrotated surface. The helper turns the pixels back to the desktop orientation while it writes the output, mapping each destination pixel to its source under the output's `DXGI_MODE_ROTATION` (90 and 270 swap width and height), and reports the rotated dimensions. The rotation direction is verified against real rotated hardware, since the DXGI convention is easy to invert. A rotated display is therefore captured natively — HDR-correct and fast — rather than falling back. (Superseding the earlier note: rotated displays used to bail and fall back to `desktopCapturer`.)

Do not benchmark this against a GDI screen grab. GDI is itself wrong on an HDR display, and an earlier fix was declared correct on exactly that basis while the captures were still visibly blown out. Compare against content whose values are known, or against Snipping Tool. Note that Snipping Tool is not pixel-exact either: it lifts shadows and renders white as about 225, reserving headroom for HDR highlights. Faithful reproduction of SDR content is the goal here, so exactness against the drawn values is the test that matters.

**Amended (0.10.0): the frame-acquire wait is bounded.** The helper used to loop on `AcquireNextFrame(500ms)` and discard every frame until one reported a present (`LastPresentTime` or `AccumulatedFrames` non-zero). On an *active* desktop a present arrives within milliseconds, but a *static* desktop never presents, so the first — already valid — frame was thrown away and the helper then blocked for the full timeout, capture after capture. The loop now still prefers a genuinely presented frame but keeps the most recent acquired surface as a fallback (copied into the staging texture immediately so the frame can be released), and uses it once a short budget (~100 ms) elapses. This removes the static-desktop stall without changing pixels: a presented frame is still preferred when one is available, and the fallback surface is the current desktop. Re-verify colour with the known-pattern test, not by eye. The helper also now reports per-stage timings (setup, acquire, convert, encode) in its JSON so the cost is measurable.

## D-016: An on-demand settings window with minimal on-disk preferences

**Status:** accepted

Capturo is tray-first with no persistent window (D-002) and writes nothing to disk unless the user chooses Save (D-006, Privacy). A preferences surface appears to cut against both, so it is introduced deliberately rather than by drift.

The settings window is opened only from the tray and destroyed when closed. It is not a resident dashboard and does not change the steady state: with settings closed, Capturo is still one tray process and no window. This keeps D-002's intent — the icon still opens straight into capture, and nothing else is on screen between captures.

Preferences persist to a single `settings.json` in `app.getPath('userData')`. This is the one thing Capturo writes without an explicit Save, and it is compatible with D-006 because it holds **no captured pixels**: only four values — save format, JPEG quality, the notification toggle, and the capture shortcut. A corrupt or half-written file is never fatal; `normalizeSettings` in `src/shared/settings.ts` turns any input into a complete, valid object, so the app always starts.

The scope is kept small on purpose. Format and JPEG quality apply to **saved files only**. Copy-to-clipboard stays a lossless bitmap, which is the only meaningful thing to put on the Windows clipboard, so format and quality live entirely in the main process at save time and never reach the renderer. The renderer keeps producing a lossless PNG data URL; `capture:save` chooses the on-disk encoding, honouring an explicit `.jpg`/`.jpeg`/`.png` the user types into the save dialog over the stored default.

The logic is split the way the rest of the codebase is: pure validation and accelerator parsing in `src/shared/` with unit tests, side effects (filesystem, `globalShortcut`, tray) in `src/main/`. The security boundary is unchanged — the settings window reuses the existing sandboxed, context-isolated preload and talks only through explicit typed IPC handlers.

A rebindable capture shortcut is the one preference with a failure mode: the chosen accelerator may be owned by another application. `globalShortcut.register` reports this (or throws for a malformed accelerator), so a rebind that does not take effect rolls both the live registration and the stored value back to the previous working shortcut and reports the reason to the settings window. At startup an unavailable saved shortcut falls back to the default so the tray label stays truthful.

A second **GIF** tab ships as a disabled placeholder. It records intent — GIF capture is a planned future feature — without any capture or encoding logic in this change.

**Amended by D-018 and D-019.** The GIF tab is no longer a placeholder. It persists frame rate, palette quality, GIF shortcut, and the 0-10 second recording pre-timer alongside the capture preferences; the file still contains settings only and no captured pixels.

## D-017: The capture helper is a persistent background process

**Status:** accepted

The native helper used to be spawned fresh for every capture: it loaded the graphics DLLs, created a Direct3D device, and started DXGI desktop duplication before it could grab a frame. Measured, that was ~187 ms of setup on *every* capture, plus a ~586 ms one-time cold DLL load on the first capture after boot — far more than the pixel work itself. So the helper is now spawned once, warmed at app launch, and kept alive to answer capture requests, creating the device and duplication a single time. Warm captures then pay no setup, and the first capture after boot is fast because the cold start happened in the background before the user asked.

This adds a resident child process, which is a change to the quiet-resident model, so it is recorded rather than introduced by drift. It is compatible with that model: the helper has no window, captures nothing until asked, communicates only over a private stdin/stdout pipe with its parent (no network), and holds only a graphics device and desktop-duplication handles. The renderer/security boundary is unchanged — the helper is a main-process concern behind `src/main/capture-helper.ts`.

The helper keeps a one-shot mode (`--output …`), used for standalone testing and as a definition of a single capture; serve mode (no arguments) reads one request per line — `originX \t originY \t outputPath` — and writes one JSON result line each, reusing the same FP16/rotation/tone-map/encode path.

Three failure modes shape the design:

**Duplication goes invalid.** Desktop duplication is lost (`DXGI_ERROR_ACCESS_LOST`) whenever the display setup changes — resolution, rotation, monitor plug/unplug, the secure desktop, a full-screen exclusive app. Each output's duplication is cached by desktop origin and, on a loss, dropped and rebuilt; a removed device (`DXGI_ERROR_DEVICE_REMOVED`) rebuilds everything, and a stale factory (`IsCurrent()` false) re-enumerates. A capture retries once through a rebuild before giving up. HDR state and SDR white are re-read per capture, never cached, since the user can toggle them.

**A hung or dead helper must never hang or break a capture.** The main side keeps a single batch in flight with a timeout; on timeout or process death it rejects, and the caller falls back to `desktopCapturer` (the same fallback used on non-Windows). A dead helper is respawned on the next capture.

**Orphaned processes.** The serve loop exits on stdin EOF, so the helper self-terminates when its parent dies even on a hard kill, in addition to being killed on a normal quit (`before-quit`). Verified: force-killing the app leaves no `capturo-capture.exe` behind.

A kept-alive duplication buffers frames between captures; the bounded-acquire logic (D-015) — prefer a presented frame, else reuse the last surface it holds — is what makes a capture after a long idle return the current desktop rather than a stale or empty one.

## D-018: GIF capture records the live screen, encoded off the main thread

**Status:** accepted (shipped in 0.13.0)

GIF capture records a selected screen region to an animated GIF, opened from the tray **New GIF** item or a rebindable shortcut, parallel to a screenshot. Annotations are out of scope for GIFs. It differs from a screenshot in one fundamental way: it records the **live** desktop over time rather than freezing one frame, and that difference drives the design.

**Live capture, not the HDR helper.** Frames come from Chromium desktop capture (`getDisplayMedia`), which is efficient at frame rate and **includes the mouse cursor** — usually wanted for an interaction GIF. 8-bit colour is irrelevant to a 256-colour format, so the FP16 helper (D-015), which excludes the cursor and is per-frame heavy, is not used here. `session.setDisplayMediaRequestHandler` returns the display currently being recorded, so there is no system picker.

**Region selection is reused.** Picking the region reuses the screenshot's frozen-overlay machinery and `src/shared/geometry.ts` through a slim GIF renderer (`gif.ts`); only the toolbar and the post-selection action differ. The user picks a rectangle on a stable frozen image, then recording runs live over it.

**Recording chrome is invisible to the capture.** On Start, the selection overlays are torn down and three pieces of chrome appear over the recorded display: a small **control bar** (Pause/Resume, Stop, timer, and an optional frame counter), a thin **border ring** around the region, and **dim strips** shading everything outside the region to emphasize what is captured. All three set `setContentProtection(true)` (WDA_EXCLUDEFROMCAPTURE on Windows 11), so `getDisplayMedia` never sees them and they never appear in the GIF — verified: the recorded region comes out full-brightness and unringed. The border and shade are click-through so the region stays live and interactive, and the shade is **tiled into strips** rather than one full-monitor window so it does not trip the full-screen classification that switches on Do Not Disturb, the same reason the screenshot overlay tiles (D-013). A consequence worth noting: content protection hides this chrome from *all* capture, including test screenshots, so its appearance can only be judged on real hardware. `showFrameCount` only hides the counter span and all numeric sampling/finalization totals; it does not alter worker acknowledgements, backpressure, or output.

**Encoding is off the main thread and incremental.** Sampled frames are handed as transferable RGBA buffers to a `gifenc` Web Worker (`gif-worker.ts` / `gif-encoder.ts`). `gifenc` is a small dependency, justified over hand-rolling GIF LZW and colour quantization. Each frame is quantized to its own palette and written immediately, so memory holds only the growing compressed GIF, not raw frames — this is what makes long recordings viable. Quality maps to palette size; FPS requests a sampling cadence.

**Inter-frame differencing is the main size win.** Pixels identical to the previous frame are written as a reserved transparent index with "do not dispose", so only what changed is re-encoded. On a 3-second recording this took the file from ~18 MB to ~0.5 MB (~34×) even over an *animated* wallpaper; a unit test shows 30 identical frames stay a few KB instead of ~120 KB. Static UI recordings therefore stay small. On top of this, a run of frames *fully* identical to the pending one is coalesced into a single written frame whose delay is extended, rather than emitting a new frame per tick, dropping the residual per-frame palette and header overhead. This is why the encoder writes each frame with a one-frame lag.

**Amended after 0.13.0: timestamps, not nominal FPS, own playback time.** A fixed `setInterval(1000/fps)` schedule is not a clock: canvas sampling can finish late on a large region or a busy renderer. Giving every encoded frame the nominal delay made those recordings play faster than wall time. It also introduced deterministic rounding drift because GIF stores whole centiseconds — 30 fps became 33 ms and `gifenc` rounded every frame to 30 ms. The recorder now timestamps each sample on the active recording timeline with `performance.now()`, excluding paused spans, and sends the final timestamp on Stop. The pending frame receives the actual elapsed interval until the next sample. Centisecond rounding remainder carries forward, so the encoded total tracks the active timer instead of accumulating per-frame error. A coalesced static span beyond the 16-bit delay limit is split into repeated frames rather than clamped and shortened.

The finished GIF is saved via a native dialog; the "GIF saved" toast respects the notification setting. The pure quality→palette and fps→delay mapping lives in `src/shared/gif.ts` with unit tests, and two smoke flags (`CAPTURO_GIF_ON_START`, `CAPTURO_GIF_RECORD_SMOKE`) exist for automation, mirroring `CAPTURO_CAPTURE_ON_START`.

**Copy-to-clipboard is deliberately not part of this.** There is no clean, Electron-native, cross-platform way to put an animated GIF on the clipboard: Windows has no animated-image clipboard format and would need a `CF_HDROP` file drop, while macOS would need a GIF-data or file-URL pasteboard write, and the two share no code. Shelling out to PowerShell `Set-Clipboard` for the Windows file drop was rejected as too heavy for a tool that otherwise spawns no external process but its own capture helper. If taken up later, do it properly per platform — Windows via a `--clipboard-file` mode on the native helper (Win32 clipboard API, no PowerShell); macOS via NSPasteboard once macOS is actually supported.

## D-019: GIF recording has a protected pre-timer before active capture

**Status:** accepted

Pressing **Start Recording** first prepares the display stream and recording chrome, then runs a user-visible countdown before any GIF frame or active recording time is accumulated. The setting is a whole number from 0-10 seconds, defaults to 3, persists with the other GIF settings, and treats 0 as disabled. This gives the user time to move the pointer and prepare the application being demonstrated without requiring that setup motion to be trimmed from the output.

The countdown lives in the existing content-protected control bar, so it cannot appear in the GIF. Pause and Stop are disabled until active capture begins; Cancel remains available throughout. At zero, the renderer resets active elapsed time, samples the first frame immediately, starts the FPS sampling interval, and only then schedules the smoke-test auto-stop. Countdown wall time must never be folded into frame timestamps or GIF duration. The display stream is opened before the countdown so reaching zero always means capture can begin immediately rather than waiting on media initialization.

## D-020: GIF encoding uses bounded backpressure and change-first palette work

**Status:** accepted

A requested FPS is not permission to queue raw frames without limit. The recording renderer can produce `drawImage`/`getImageData` buffers faster than one JavaScript worker can quantize and LZW-encode them, especially for a large or high-colour region. The old fire-and-forget path accumulated every buffer in the worker event queue, so memory and the wait after Stop grew with recording length. The worker now acknowledges each frame only after its encoder work finishes, and the renderer allows at most two frames in flight: one executing and one waiting. A sampling tick that finds the bound full is skipped before canvas readback. This bounds raw queued memory and makes Stop wait for at most the bounded tail rather than an arbitrary recording backlog.

Skipping a sample does not skip time. D-018's active timestamps remain authoritative: the next observed timestamp, or Stop's final timestamp, extends the frame that was actually visible across the gap. The requested FPS therefore remains a target; effective FPS adapts to encoder capacity without speeding up playback. When frame counts are enabled, the control bar reports skipped sampling ticks during recording, then processed/total progress while the bounded tail finalizes; with counts hidden, the generic Finalizing and Saving states remain.

Palette work is change-first for ordinary desktop motion. The equality scan collects changed pixel positions and RGBA values up to 25% of the region. A non-empty set within that bound is quantized and mapped compactly, then scattered into a full indexed frame prefilled with the transparent index. Fully identical frames still coalesce. Once changes exceed the threshold, collection stops and the established full-frame quantization/difference path is used; this prevents broadly changing video from paying for a near-full sparse copy. The threshold is an implementation trade-off, covered by path-selection and decoded-output regression tests, and should be changed only with representative benchmarks.

The final worker transfer also reuses `gifenc.bytes()` directly when it owns its complete buffer, eliminating an unnecessary full-GIF copy. A multi-worker encoder and `rgb444` fast mode remain possible later optimizations, but they add ordering or colour-fidelity trade-offs and are not required to bound the current pipeline.

## D-021: Windows recording chrome suppresses the DWM-owned frame

**Status:** accepted

Electron's `frame: false`, `thickFrame: false`, transparent, shadowless recording windows still report a 2-physical-pixel DWM visible-frame border on the tested Windows 11 build. That compositor-owned decoration appeared as grey horizontal bands at the top and bottom as soon as recording chrome was shown. It disappeared on Stop or Cancel and could not be captured by Snipping Tool because every affected window correctly had `WDA_EXCLUDEFROMCAPTURE` through `setContentProtection(true)`.

The persistent Windows helper therefore accepts a serialized `window-border\t<nativeHandle>` request and calls `DwmSetWindowAttribute` twice: `DWMWA_NCRENDERING_POLICY = DWMNCRP_DISABLED` disables all DWM non-client rendering, while `DWMWA_BORDER_COLOR = DWMWA_COLOR_NONE` explicitly suppresses the Windows 11 border colour. The stronger policy was added after real-hardware feedback found that colour suppression alone removed the top band but left a fainter bottom line. The main process sends the request after `ready-to-show` and before first show for the control bar, ring, and each shade strip. Failure is best-effort and logged; it must never prevent recording chrome from appearing. Content protection remains mandatory, and Capturo's red selection ring remains a CSS border rather than a native frame.

There was a related geometry defect: Windows constructed the nominal 1030x582 ring as 1033x585 and the 340x46 control bar as 340x48. Recording chrome now uses one pure integer-bounds normalizer and reapplies those exact outer bounds immediately after `BrowserWindow` construction, matching the established screenshot-overlay fix in D-012. Native window inspection verifies the requested sizes exactly. The cosmetic absence of the protected DWM border still requires an eyes-on-hardware check because capture tools intentionally omit these windows.

**Amended after hardware feedback: hide shade edges structurally.** Colour suppression removed the original top band and weakened the bottom one; disabling non-client rendering did not eliminate the intermittent residual. A user-supplied simulation showed why: the line extended far beyond the selection and aligned exactly with the top edge of the full-width bottom shade window. The issue was therefore a compositor edge on a shade surface, not the red ring. GIF shade tiling now uses full-height left/right strips and selection-width top/bottom strips. Every internal shade edge is constrained to the selection perimeter, where the red ring covers it. Because each data-URL renderer reaches `ready-to-show` independently, every chrome show also raises the ring, removing nondeterministic z-order as a second route for the edge to leak through. Keep the DWM suppression as defence in depth, but do not rely on it as the structural fix.

## D-022: Background transparency is a connected, non-destructive command

A sampled background color must not act as a global replace: logos, highlights, and enclosed foreground details can legitimately contain the same color. The Transparent background tool therefore flood-fills outward from one seed through four-neighbor pixels that meet a Rec. 709-weighted RGB tolerance. It stores the seed, target color, current crop region, tolerance, and feather radius as a replayable command. The source bitmap is never mutated, and the existing command-stack Undo removes the operation.

Transparency commands are replayed before visible annotations regardless of creation order. Otherwise applying background removal after drawing an arrow could erase matching pixels inside the arrow. Feathering blurs the connected removal mask and multiplies it into source alpha; it does not recolor the retained foreground. The editor exposes Before, After, and draggable Split views over a checkerboard while the command is pending, and caches only those two processed states to prevent repeated large-region flood fills without retaining every slider position.

JPEG has no alpha channel. Once an applied transparency command exists, the renderer marks the capture as PNG-required and the main-process save handler forces both a `.png` path and PNG encoding, overriding the configured format and any typed JPEG extension. The clipboard continues receiving the renderer's lossless native image. This exception is explicit in the IPC rather than inferred from pixels, so an opaque capture whose selected color happened not to match still follows the user's deliberate transparency workflow.
