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

**Amended 2026-08-17: a second accent for Copy text.** The capture toolbar has two copy actions - image Copy and Copy text - and a single accent forced one of them to look secondary when neither is. Copy text therefore carries Capturo's violet where image Copy keeps the blue. This is a second accent, not an open palette: any further colour needs its own justification, and the interface still has exactly one focus colour.

Colour is deliberately the weaker of the two signals. The buttons are told apart by their marks - two sheets for image Copy, a clipboard holding "Aa" for Copy text - so the pair remains distinguishable for anyone who cannot rely on hue, which colour-coding alone would not achieve. Green and red were rejected for carrying success and danger meanings the actions do not have.

**Amended 2026-08-18: Save is filled, Cancel is tinted.** Save completes the capture exactly as the two copies do, so leaving it transparent made the third primary action read as secondary. It takes green - the meaning the earlier amendment rejected for the copy pair precisely because *those* actions do not complete anything, while Save does. Cancel takes a red tint rather than a fill: it is the one destructive control in the row, so it has to be distinguishable from the actions beside it without competing with them for attention, and its hover deepens the tint instead of falling back to the neutral grey the other secondary buttons use. Both keep their existing marks, so the row is still readable without hue, and the interface still has exactly one focus colour.

## D-008: Crop and annotation coordinates remain independent

**Status:** accepted

Moving the capture rectangle changes only what will be cropped. Annotation geometry remains anchored to the frozen desktop image. This matches the expectation that moving a viewport does not move the content placed over the desktop.

## D-009: Explicit raster application and tray assets

**Status:** accepted

The application and tray marks are maintained as high-resolution canonical PNG sources, then converted into explicit output sizes at build time. Windows tray icons never depend on runtime SVG data-URL decoding, which can create a clickable but visually transparent notification-area entry.

**Amended in 0.15.1:** `build/icon-source.png` is the sole canonical Capturo artwork. The icon generator only resizes that exact image into the 512px package icon, 256px Settings/taskbar/notification icon, and 16px/32px notification-area/menu-bar files. There is no secondary tray source, crop, mask, recoloring, or macOS template substitution. The visible Settings window receives its derivative explicitly through `BrowserWindow.icon`, notifications receive the same runtime resource, electron-builder uses the 512px derivative, and both Windows and macOS tray creation load the same full-color 16px derivative (with its `@2x` sibling available on high-DPI displays). Keep every brand surface derived from this one source rather than hand-editing generated PNGs.

**Amended 2026-08-15:** the canonical file was replaced byte-for-byte with the user-supplied 1254px camera/scissors PNG. Its fully opaque pixels, including the supplied black outer background, are intentional input and remain unmodified except for size reduction. Transparent corners or a different small-icon treatment would require a new supplied source or an explicit product decision, not an undocumented generator transform.


**Amended 2026-08-17: the delivered backdrop is keyed out, and macOS gets a monochrome menu bar template.** The two prohibitions above were written when macOS was untested, and running Capturo in a real menu bar disproved both.

A logo delivered on a filled backdrop is correct as *artwork* and wrong as an *icon*: macOS draws Dock and Finder icons with transparent corners, and a menu bar full of system glyphs makes a coloured tile obvious. The generator therefore keys out only the background connected to the outer edges, so the focus brackets survive even though they are as dark as the backdrop, and un-blends the anti-aliased rim so the cutout carries no halo. A source that already ships transparent corners skips the step entirely.

A menu bar icon must additionally be a *template*: monochrome artwork whose alpha macOS paints itself so it follows the light or dark bar, dims when the app is inactive, and inverts while the menu is open. That cannot be a resize of a colour logo, so the generator reduces the mark to a black silhouette, drops the card it sits on, and emits `tray-iconTemplate.png` with its `@2x` sibling. `trayImage()` sets `setTemplateImage(true)` explicitly rather than relying on Electron inferring it from the filename. Windows has no such convention and keeps the colour mark.

This supersedes "no secondary tray source, crop, mask, recoloring, or macOS template substitution" and the removal of the macOS template recorded for 0.15.1. What remains prohibited is unchanged and is the point of the rule: no hand-editing of generated PNGs, no second logo, and no transformation that is not performed by `scripts/generate-icon.mjs` from the one canonical source.

**Amended 2026-08-17 (artwork):** the canonical source is the supplied 400px rounded-card "C" logo with focus brackets. It is kept exactly as delivered, backdrop included, so the canonical file always matches the designer's file; every visible surface is derived. At 400px it is below the 1024px a macOS `.icns` wants, so the package icon is upscaled and `npm run icons` prints a note saying so. Replacing the source with a >=1024px or vector export is a drop-in improvement that needs no code change.

## D-010: Present capture overlays only after first paint

**Status:** accepted

Capture overlays remain hidden while their desktop data URL decodes and paints. The renderer acknowledges readiness after two animation frames, and only then may the main process present the window. This prevents the full-screen BrowserWindow background from appearing as a black/maximized flash during capture startup.

## D-011: Reveal overlays by opacity, never by a hidden-to-shown transition

**Status:** accepted

Windows plays a scale-and-fade transition whenever a window goes from hidden to shown, and it honours that setting for borderless full-screen windows. Showing a painted overlay therefore still animated the desktop into place even though D-010 had removed the black flash. The two are separate defects, and D-010 alone does not fix this one.

The overlay is now shown transparent immediately after it is created, so the platform transition runs before there is anything to see, and D-010's readiness acknowledgement raises its opacity instead of calling `show`. An opacity change is composited directly and is never animated. Until the reveal the window sets `setIgnoreMouseEvents(true)` so an invisible full-screen window cannot swallow clicks meant for the app underneath.

Verification must measure geometric motion between consecutive frames, not average luminance. A scale animation moves the same desktop image, so frame-average brightness barely changes and a luminance check reports success while the animation is still plainly visible.

**Amended: on macOS the reveal activates the application, not just the window.** Showing the overlay inactive means it holds no keyboard focus, and the editor's `Escape` handler lives on a renderer `keydown` listener, so before a first drag there was nothing to receive the key. `BrowserWindow.focus()` covers that on Windows, but macOS will not make a window key while its application is inactive — and Capturo is a tray app with no Dock icon, so the click or shortcut that starts a capture leaves the user's previous application active. `focus()` then silently did nothing and Escape was dead until the user dragged.

Measured with another application frontmost: the current reveal left `isFocused` false, and activating the application first made it true; end to end, the frontmost application went from Finder to Capturo when the overlay appeared. `revealOverlay` therefore calls `app.focus({ steal: true })` before focusing the editor window on macOS. Stealing focus is correct here rather than rude: the user has just asked for a surface that covers their whole screen, and the global-shortcut path has no click to fall back on. Only the editor is focused; fillers are left alone so they can never take it from the editor.

**Amended (0.10.0): the reveal no longer waits out a fixed delay.** The opacity reveal above once carried a 250 ms floor that spent the window's show transition while the overlay was invisible. Dropping `WS_THICKFRAME` (`thickFrame: false`, added in 0.9.1 to remove the Windows 11 border) also suppresses that open transition, so there is no animation left to wait out. `revealOverlay` now raises the opacity the instant the renderer acknowledges `capture:ready`, with no timer. The transparent-early + opacity mechanism is kept: it still guarantees the window has painted before it is visible (D-010) and cannot swallow pointer events before then, and an opacity change is itself never animated. The same frame-differencing verification applies: a correct reveal is a single hard cut with no black frame and no motion on either side.

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

A rotated output duplicates into an unrotated surface. The helper turns the pixels back to the desktop orientation while it writes the output, mapping each destination pixel to its source under the output's `DXGI_MODE_ROTATION` (90 and 270 swap width and height), and reports the rotated dimensions. The rotation direction is verified against real rotated hardware, since the DXGI convention is easy to invert. A rotated display is therefore captured natively with fast, HDR-correct output instead of falling back. This supersedes the earlier behavior, where rotated displays bailed out and used `desktopCapturer`.

Do not benchmark this against a GDI screen grab. GDI is itself wrong on an HDR display, and an earlier fix was declared correct on exactly that basis while the captures were still visibly blown out. Compare against content whose values are known, or against Snipping Tool. Note that Snipping Tool is not pixel-exact either: it lifts shadows and renders white as about 225, reserving headroom for HDR highlights. Faithful reproduction of SDR content is the goal here, so exactness against the drawn values is the test that matters.

**Amended (0.10.0): the frame-acquire wait is bounded.** The helper used to loop on `AcquireNextFrame(500ms)` and discard every frame until one reported a present (`LastPresentTime` or `AccumulatedFrames` non-zero). On an *active* desktop a present arrives within milliseconds, but a *static* desktop never presents. The first frame, which was already valid, was thrown away and the helper then blocked for the full timeout, capture after capture. The loop now still prefers a genuinely presented frame but keeps the most recent acquired surface as a fallback (copied into the staging texture immediately so the frame can be released), and uses it once a short budget (~100 ms) elapses. This removes the static-desktop stall without changing pixels: a presented frame is still preferred when one is available, and the fallback surface is the current desktop. Re-verify colour with the known-pattern test, not by eye. The helper also now reports per-stage timings (setup, acquire, convert, encode) in its JSON so the cost is measurable.

## D-016: An on-demand settings window with minimal on-disk preferences

**Status:** accepted

Capturo is tray-first with no persistent window (D-002) and writes nothing to disk unless the user chooses Save (D-006, Privacy). A preferences surface appears to cut against both, so it is introduced deliberately rather than by drift.

The settings window is opened only from the tray and destroyed when closed. It is not a resident dashboard and does not change the steady state: with settings closed, Capturo is still one tray process and no window. This keeps D-002's intent. The icon still opens straight into capture, and nothing else is on screen between captures.

Preferences persist to a single `settings.json` in `app.getPath('userData')`. This is the one thing Capturo writes without an explicit Save, and it is compatible with D-006 because it holds **no captured pixels**: only validated global, capture, and GIF preferences. A corrupt or half-written file is never fatal; `normalizeSettings` in `src/shared/settings.ts` turns any input into a complete, valid object, so the app always starts.

The scope is kept small on purpose. Format and JPEG quality apply to **saved files only**. Copy-to-clipboard stays a lossless bitmap, which is the only meaningful thing to put on the Windows clipboard, so format and quality live entirely in the main process at save time and never reach the renderer. The renderer keeps producing a lossless PNG data URL; `capture:save` chooses the on-disk encoding, honouring an explicit `.jpg`/`.jpeg`/`.png` the user types into the save dialog over the stored default.

The logic is split the way the rest of the codebase is: pure validation and accelerator parsing in `src/shared/` with unit tests, and side effects (filesystem, `globalShortcut`, tray) in `src/main/`. The security boundary is unchanged. The settings window reuses the existing sandboxed, context-isolated preload and talks only through explicit typed IPC handlers.

A rebindable capture shortcut is the one preference with a failure mode: the chosen accelerator may be owned by another application. `globalShortcut.register` reports this (or throws for a malformed accelerator), so a rebind that does not take effect rolls both the live registration and the stored value back to the previous working shortcut and reports the reason to the settings window. At startup an unavailable saved shortcut falls back to the default so the tray label stays truthful.

A second **GIF** tab ships as a disabled placeholder. It records that GIF capture is planned without adding capture or encoding logic in this change.

**Amended by D-018 and D-019.** The GIF tab is no longer a placeholder. It persists frame rate, palette quality, GIF shortcut, and the 0-10 second recording pre-timer alongside the capture preferences; the file still contains settings only and no captured pixels.

**Amended in 0.15.2.** Settings now begins with a **Global** tab whose Open on startup toggle defaults off. The renderer only sends the typed preference; the main process owns `app.setLoginItemSettings`, applies it only for packaged Windows/macOS builds, verifies the resulting OS state, and rolls back both UI and persistence when registration fails. The stored value is reconciled on each packaged launch so moving or reinstalling the executable cannot silently preserve a stale login-item path. Development runs never register Electron as a startup application.

## D-017: The capture helper is a persistent background process

**Status:** accepted

The native helper used to be spawned fresh for every capture: it loaded the graphics DLLs, created a Direct3D device, and started DXGI desktop duplication before it could grab a frame. Measured, that was ~187 ms of setup on *every* capture, plus a ~586 ms one-time cold DLL load on the first capture after boot. This cost far more than the pixel work itself. The helper is now spawned once, warmed at app launch, and kept alive to answer capture requests, creating the device and duplication a single time. Warm captures then pay no setup, and the first capture after boot is fast because the cold start happened in the background before the user asked.

This adds a resident child process, which is a change to the quiet-resident model, so it is recorded rather than introduced by drift. It is compatible with that model: the helper has no window, captures nothing until asked, communicates only over a private stdin/stdout pipe with its parent (no network), and holds only a graphics device and desktop-duplication handles. The renderer and security boundary is unchanged. The helper is a main-process concern behind `src/main/capture-helper.ts`.

The helper keeps a one-shot mode (`--output …`) for standalone testing and as a definition of a single capture. Serve mode (no arguments) reads requests in the form `originX \t originY \t outputPath`, writes one JSON result for each line, and reuses the same FP16/rotation/tone-map/encode path.

Three failure modes shape the design:

**Duplication goes invalid.** Desktop duplication is lost (`DXGI_ERROR_ACCESS_LOST`) whenever the display setup changes, including resolution, rotation, monitor plug/unplug, the secure desktop, or a full-screen exclusive app. Each output's duplication is cached by desktop origin and, on a loss, dropped and rebuilt; a removed device (`DXGI_ERROR_DEVICE_REMOVED`) rebuilds everything, and a stale factory (`IsCurrent()` false) re-enumerates. A capture retries once through a rebuild before giving up. HDR state and SDR white are re-read per capture, never cached, since the user can toggle them.

**A hung or dead helper must never hang or break a capture.** The main side keeps a single batch in flight with a timeout; on timeout or process death it rejects, and the caller falls back to `desktopCapturer` (the same fallback used on non-Windows). A dead helper is respawned on the next capture.

**Orphaned processes.** The serve loop exits on stdin EOF, so the helper self-terminates when its parent dies even on a hard kill, in addition to being killed on a normal quit (`before-quit`). Verified: force-killing the app leaves no `capturo-capture.exe` behind.

A kept-alive duplication buffers frames between captures. The bounded-acquire logic (D-015) prefers a presented frame and otherwise reuses the last surface it holds. This makes a capture after a long idle return the current desktop rather than a stale or empty one.

## D-018: GIF capture records the live screen, encoded off the main thread

**Status:** accepted (shipped in 0.13.0)

GIF capture records a selected screen region to an animated GIF, opened from the tray **New GIF** item or a rebindable shortcut, parallel to a screenshot. Annotations are out of scope for GIFs. It differs from a screenshot in one fundamental way: it records the **live** desktop over time rather than freezing one frame, and that difference drives the design.

**Live capture, not the HDR helper.** Frames come from Chromium desktop capture (`getDisplayMedia`), which is efficient at frame rate and **includes the mouse cursor**, as users usually want for an interaction GIF. 8-bit colour is irrelevant to a 256-colour format, so the FP16 helper (D-015), which excludes the cursor and is per-frame heavy, is not used here. `session.setDisplayMediaRequestHandler` returns the display currently being recorded, so there is no system picker.

**Region selection is reused.** Picking the region reuses the screenshot's frozen-overlay machinery and `src/shared/geometry.ts` through a slim GIF renderer (`gif.ts`); only the toolbar and the post-selection action differ. The user picks a rectangle on a stable frozen image, then recording runs live over it.

**Recording chrome is invisible to the capture.** On Start, the selection overlays are torn down and three pieces of chrome appear over the recorded display: a small **control bar** (Pause/Resume, Stop, timer, and an optional frame counter), a thin **border ring** around the region, and **dim strips** shading everything outside the region to emphasize what is captured. All three set `setContentProtection(true)` (WDA_EXCLUDEFROMCAPTURE on Windows 11), so `getDisplayMedia` never sees them and they never appear in the GIF. Verification confirms that the recorded region comes out full-brightness and unringed. The border and shade are click-through so the region stays live and interactive, and the shade is **tiled into strips** rather than one full-monitor window so it does not trip the full-screen classification that switches on Do Not Disturb, the same reason the screenshot overlay tiles (D-013). A consequence worth noting: content protection hides this chrome from *all* capture, including test screenshots, so its appearance can only be judged on real hardware. `showFrameCount` only hides the counter span and all numeric sampling/finalization totals; it does not alter worker acknowledgements, backpressure, or output.

**Encoding is off the main thread and incremental.** Sampled frames are handed as transferable RGBA buffers to a `gifenc` Web Worker (`gif-worker.ts` / `gif-encoder.ts`). `gifenc` is a small dependency, justified over hand-rolling GIF LZW and colour quantization. Each frame is quantized to its own palette and written immediately, so memory holds only the growing compressed GIF, not raw frames. This is what makes long recordings viable. Quality maps to palette size; FPS requests a sampling cadence.

**Inter-frame differencing is the main size win.** Pixels identical to the previous frame are written as a reserved transparent index with "do not dispose", so only what changed is re-encoded. On a 3-second recording this took the file from ~18 MB to ~0.5 MB (~34×) even over an *animated* wallpaper; a unit test shows 30 identical frames stay a few KB instead of ~120 KB. Static UI recordings therefore stay small. On top of this, a run of frames *fully* identical to the pending one is coalesced into a single written frame whose delay is extended, rather than emitting a new frame per tick, dropping the residual per-frame palette and header overhead. This is why the encoder writes each frame with a one-frame lag.

**Amended after 0.13.0: timestamps, not nominal FPS, own playback time.** A fixed `setInterval(1000/fps)` schedule is not a clock: canvas sampling can finish late on a large region or a busy renderer. Giving every encoded frame the nominal delay made those recordings play faster than wall time. It also introduced deterministic rounding drift because GIF stores whole centiseconds. At 30 fps the nominal 33 ms delay caused `gifenc` to round every frame to 30 ms. The recorder now timestamps each sample on the active recording timeline with `performance.now()`, excluding paused spans, and sends the final timestamp on Stop. The pending frame receives the actual elapsed interval until the next sample. Centisecond rounding remainder carries forward, so the encoded total tracks the active timer instead of accumulating per-frame error. A coalesced static span beyond the 16-bit delay limit is split into repeated frames rather than clamped and shortened.

The original workflow saved the finished GIF immediately through a native dialog. D-023 supersedes that handoff with an in-memory preview while retaining the fixed-file smoke path. The pure quality→palette and fps→delay mapping lives in `src/shared/gif.ts` with unit tests, and two smoke flags (`CAPTURO_GIF_ON_START`, `CAPTURO_GIF_RECORD_SMOKE`) exist for automation, mirroring `CAPTURO_CAPTURE_ON_START`.

**Superseded by D-023.** Copy-to-clipboard was initially deferred because Electron's image API would flatten an animated GIF and Windows requires a `CF_HDROP` file drop. D-023 implements that platform-specific path in Capturo's existing native helper without adding a PowerShell subprocess.

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

## D-023: Finished GIFs are reviewed in memory before export

**Status:** accepted

Stopping a recording must not force a filesystem decision before the user has seen the result. Once the worker finishes, the main process therefore destroys the content-protected recording chrome and opens a normal framed preview window. The encoded bytes remain in main-process memory; the sandboxed preview receives a clone only to create a local Blob URL for animation. Closing or discarding an untouched preview writes nothing. Save uses the native dialog, retains the preview after success, and records the confirmed path so Open folder can reveal only a real user-selected file. Retake clears the old byte references before reopening region selection.

Copy must preserve animation rather than pass the GIF through Electron's decoded-image clipboard API. On Windows, the main process writes an unsaved preview to `%TEMP%\Capturo\Clipboard` only after the user explicitly chooses Copy, then sends `clipboard-file\t<absolutePath>` through the already-running native helper. The helper publishes a double-null-terminated Unicode `DROPFILES` block as `CF_HDROP`; no PowerShell or additional process is introduced. If the GIF was saved and still exists, its permanent path is copied directly. A temporary clipboard file cannot be deleted when the preview closes because Windows stores the path, not the file bytes, and paste must continue to work afterward. Capturo limits residue by deleting only its own matching temporary GIFs older than 24 hours on a later launch.

The preview owns Copy, Save, Open folder, Retake, and Discard through narrow typed IPC calls. Copy and Save have the conventional `Ctrl/Cmd+C` and `Ctrl/Cmd+S` shortcuts; Escape discards. A second tray or shortcut request while a preview is open focuses that preview instead of silently losing the pending GIF.

**macOS copies the file too, for the same reason Windows does.** The original raw-GIF pasteboard fallback wrote `clipboard.writeBuffer('public.gif', bytes)`, and `public.gif` is not a real UTI: macOS accepted the call, wrote nothing, and left `availableFormats()` empty, so Copy reported success and pasted nothing at all. macOS therefore takes the same file-based path as Windows — reusing the same temporary `Capturo/Clipboard` directory and the same 24-hour cleanup — and publishes the path as `public.file-url`, the pasteboard type Finder, Mail and Messages read. Measured on macOS 26.2, that type reports as `«class furl»` and the system resolves it back to the exact file, including the spaces in Capturo's generated filenames, so the receiving application gets the animated `.gif` rather than a flattened frame.

Copy now reads the pasteboard back before reporting success. A write that silently lands nowhere is otherwise indistinguishable from one that worked, which is exactly how the `public.gif` bug survived: the handler returned `ok` unconditionally and the preview reported "Animated GIF copied to the clipboard".

## D-024: Blur and Pixelate strength is percentage intensity, not stroke size

**Status:** accepted

Blur and Pixelate previously reused `AnnotationStyle.lineWidth` and the toolbar's **Size** label even though neither effect draws a stroke. This also meant a pen or shape width silently determined the next privacy effect. Each annotation now stores an independent `effectIntensity` from 1-100%, and the contextual toolbar labels it **Intensity** with a percentage readout.

The percentage has the same direction for both effects: higher means stronger obscuring. Blur maps monotonically from a 1px to 32px CSS-pixel-equivalent canvas-filter radius; Pixelate maps from 2px to 64px CSS-pixel-equivalent blocks. These bounds keep 1% visibly subtle and 100% strongly obscuring without creating zero-effect annotations. The capture's source-pixel scale is stored separately and applied during rendering so the same percentage has comparable visible strength on scaled displays. The mapping functions are pure and regression-tested. Intensity itself is dimensionless and must not change when an annotation moves or resizes.

## D-025: Update checks are opt-in stable-release notifications

**Status:** accepted

A repository commit is not an application update: it may be unfinished, untested, and has no Windows artifact. Capturo therefore compares only the packaged `app.getVersion()` with GitHub's latest published stable Release. Pure parsing accepts only `vMAJOR.MINOR.PATCH`, rejects drafts and prereleases even if GitHub returns one unexpectedly, and treats an older published release as up to date for a newer local development build.

The main process owns the bounded ten-second HTTPS request to the public Capturo `releases/latest` API. It sends no authentication token, capture pixels, settings, filenames, usage data, or device identifier. The sandboxed Settings renderer receives only a typed result and cannot provide an outbound URL; **View release**, the tray action, and the notification click all open one fixed official URL. Manual checks require an explicit Settings action. Automatic checks are disabled by default, run only in packaged builds after opt-in, persist the last-check time so restarts cannot exceed one scheduled request per 24 hours, and defer while a screenshot/GIF capture or encoding window is active.

This is notification-only by design. Capturo neither downloads nor installs an update, which keeps portable and installed builds consistent and avoids establishing an unsigned update chain while Windows releases lack Authenticode signing. If signed automatic installation is added later, it requires a separate decision, same-build installer/update metadata, installed-NSIS migration testing, and an explicit portable-build policy. README privacy language must distinguish this narrow version request from telemetry: Capturo still never uploads screen or usage data, but it can no longer claim that no network request exists after the user opts in or presses **Check for updates**.

**Deployment gap resolved 2026-08-13:** `mtom2k/capturo` is now public. Its anonymous repository and latest-release APIs returned public metadata and stable `v0.15.1`, and packaged Capturo 0.16.0 completed the real check as up to date. Public feed visibility is now a release invariant. A GitHub token must never be compiled into Capturo; if the feed moves, both the API and browser URLs must be deliberately migrated together.

## D-026: Screenshot text extraction uses local Windows OCR behind the native helper

**Status:** accepted

Copy text must preserve Capturo's local-first privacy boundary and must work on ordinary supported Windows 11 hardware. The baseline therefore uses the established `Windows.Media.Ocr.OcrEngine` API with the current user's installed OCR languages. The newer Windows AI Text Recognition API is not the baseline because its hardware/support contract is limited to supported NPU-equipped Copilot+ PCs. Bundling Tesseract or a separate model would increase package size, update burden, cold-start cost, and language-data management for a capability Windows already supplies. macOS remains unsupported and receives no OCR claim until a native implementation is designed and tested on real Apple hardware.

The user asks OCR to process the final rendered selection, not the untouched frozen desktop. The renderer commits a pending transparency preview, replays the crop, annotations, and pixel effects into the same offscreen export used by Copy/Save, then sends a PNG through the narrow `capture:copy-text` context-bridge method. The main process validates both sender and active session before accepting it. This means text intentionally hidden by Blur or Pixelate is not recoverable through Capturo's OCR action, while text added as an annotation can be recognized like any other visible pixel.

OCR bytes stay in memory. The main process sends base64 PNG bytes over the already-private, serialized stdin pipe to `capturo-capture.exe`; the helper decodes an in-memory WinRT stream, scales down only when required by `OcrEngine::MaxImageDimension`, and returns JSON-escaped UTF-8 text. There is no OCR network request, credential, telemetry event, downloaded model, or temporary screenshot file. A 64 MiB main-side PNG bound and 20-second request timeout prevent unbounded allocation or a permanently blocked editor. Recognized contents are never logged by the application or its smoke harness.

Clipboard ownership remains in the Electron main process. It normalizes CRLF and trailing presentation whitespace while preserving internal spaces and blank lines, writes only non-empty plain text, then closes the session. No-text, missing-language, helper, image, or clipboard failures leave the editor open and display a useful status. `Ctrl/Cmd+Shift+C` is distinct from regular `Ctrl/Cmd+C`, and the button sits immediately beside regular Copy so the image/text choice is explicit.

The C++ helper uses a multithreaded COM apartment: synchronous C++/WinRT `.get()` is not valid in a single-threaded apartment. Because that process also owns DXGI desktop duplication, WIC PNG encoding, DWM frame suppression, and Windows GIF `CF_HDROP`, changing this initialization requires regression testing all relevant native paths rather than OCR alone. OCR accuracy is inherently source- and language-dependent; documentation must tell users to install the appropriate Windows language pack and review important results rather than presenting recognition as exact.

## D-027: macOS screen-capture permission is surfaced in Settings, not only at capture time

**Status:** accepted

macOS refuses screen capture until the user grants Screen Recording, and a refused Capturo simply captures nothing. The permission therefore has a visible home in Global Settings rather than appearing only as a dialog at the moment a capture fails. Windows has no equivalent gate, so the row reports itself unsupported and hides; the platform test lives in the main process, not in a renderer user-agent sniff.

The decisive constraint is that macOS has no readable "not asked yet" state for this permission. `systemPreferences.getMediaAccessStatus('screen')` is backed by a boolean preflight, so a first run and a genuine refusal both report `denied`. Two rules follow, and both are covered by `tests/permissions.test.ts`:

- No message may tell the user they refused something, because macOS reports a never-asked Capturo identically.
- `denied` must still offer the request path. Attempting a capture is the only thing that raises the system prompt, and it is also what adds Capturo to the Screen Recording list at all. `ensureScreenPermission` therefore attempts the request before showing its dialog. Sending the user to System Settings first would send them to a pane that does not yet list Capturo. `restricted` is a policy state no prompt can move and routes straight to System Settings.

Granting the permission does not reach an already-running process; macOS applies it to a newly launched app. Every message that sends the user to System Settings therefore also tells them to reopen Capturo, or they grant it, see nothing change, and conclude Capturo is broken.

The renderer can read the status but cannot grant it. Requesting and opening the Screen Recording pane are main-process actions behind the same Settings-sender check as the update handlers, and no renderer code path can name a different permission or a different System Settings pane.

**Capturo asks the system at most once per launch, and only ever holds one permission conversation at a time.** Both limits are load-bearing and were added after a real failure. Raising the prompt is not free: `desktopCapturer.getSources` re-raises the macOS modal, and capture triggers are fire-and-forget from the tray, the global shortcut, `activate` and `second-instance`, so an unguarded implementation queued one system prompt and one dialog per trigger. The user dismissed one, the next appeared, and it read as Capturo asking forever. They eventually pressed **Deny** to make it stop, which writes an explicit refusal that only System Settings can undo — the retry destroyed the permission it was trying to obtain.

macOS records the answer the first time, so a second prompt cannot produce a better outcome than the first. `screenAccessRequested` therefore allows exactly one system prompt per launch and every later attempt goes straight to Capturo's own dialog, and `screenPermissionCheck` memoizes the in-flight check the way `updateCheckInFlight` does, so concurrent triggers share one conversation. That check must never reject, because callers treat it as a boolean gate and an escaping rejection would leave capture blocked for the rest of the session.

**The attempt that raises the system prompt shows nothing else.** `desktopCapturer.getSources` raises Apple's Screen Recording prompt but is answered asynchronously: it returns "still denied" within milliseconds, while Apple's dialog is still on screen and unanswered. Continuing straight to Capturo's dialog therefore put two permission dialogs on screen for one permission, and only Apple's could actually grant it. The attempt that raises the prompt now returns without showing anything of Capturo's, and the explanation is left to the next attempt. The cost is that when macOS stays silent because it already holds an answer, the first capture appears to do nothing; that is one wasted click which the next click corrects, and it is a better trade than a pair of stacked dialogs on every first run.

Measuring this needs care. Extra `electron .` instances only reach the running app through `second-instance`, and that requires the *same* `userData`, which the smoke flags redirect — instances launched without the matching flag run as independent apps and prove nothing about coalescing. With the flag matched, seven rapid triggers against a denied build produced exactly one deferral and one dialog.

**Reopening is part of the instruction, not advice.** Because macOS applies a grant only to a newly launched app, every path that asks the user to change the permission also offers **Reopen Capturo**, which runs `app.relaunch()` through `app.quit()` so the capture helper stops and the global shortcuts are released for the new instance. Telling the user to reopen while making them quit from the tray and find Capturo again is where the grant was most often lost.

**A lost grant is named, not re-explained.** `GlobalSettings.screenAccessWasGranted` records the first time Capturo observes a granted status. A denied status after that is a distinct state with distinct wording: System Settings normally still lists Capturo as switched on, so repeating "turn it on" sends the user to a pane that already looks correct. That state instead says the access was lost and to switch it off and on again. It is the common outcome of an unsigned build changing identity (D-028), but it is written for anyone whose grant has gone stale, and the first-run wording must never mention switching anything off.

The row is a quiet line when the permission is granted and becomes a bordered callout with a one-word status chip only while an action is outstanding, so a blocked capture is visible at a glance without making a healthy permission shout.

**Capturo does not revoke its own permission.** Adding a "remove permission" action was considered and rejected. `tccutil reset ScreenCapture com.capturo.app` would shell out to a tool Apple documents for the terminal and never exposed to applications, whose behavior varies by macOS release; the privacy database is System Settings' responsibility, and an application resetting its own grants is the kind of authority this codebase deliberately keeps out of reach. It would also not fix anything: macOS re-prompts for an app whose designated requirement no longer matches, so a stale entry is confusing rather than blocking, and the recovery is the off/on toggle the message now names. Opening the correct System Settings pane and explaining the toggle achieves the same outcome without touching TCC.

## D-028: macOS builds are ad-hoc signed locally and require a Developer ID to be usable

**Status:** accepted

electron-builder signs only when it finds a Developer ID Application certificate. With none on the build host it leaves the bundle as Electron shipped it: linker-signed, carrying the identifier `Electron` instead of Capturo's, and with no sealed resources. macOS treats that bundle as damaged, and `spctl` rejects it outright. The `afterPack` hook in `scripts/adhoc-sign-mac.mjs` therefore ad-hoc signs the packaged app before the DMG and ZIP are produced, which restores the real bundle identifier, seals resources, and makes the app verify. The hook stands aside when a real Developer ID certificate is present.

Ad-hoc signing is a local-development measure and not a distribution path. Two limits are load-bearing:

- Gatekeeper still refuses an ad-hoc signed app on any machine that downloads it, because notarization is impossible without a Developer ID.
- TCC cannot hold a Screen Recording grant across builds. Observed on macOS 26.2: Capturo appears in Screen & System Audio Recording and can be toggled on, yet a rebuilt ad-hoc app still preflights as `denied` and captures nothing.

The mechanism behind the second limit was measured rather than assumed. TCC stores an app's designated requirement when a permission is granted, and the signature determines it:

```
Capturo, ad-hoc   designated => cdhash H"7c7f1a44..."
Chrome, signed    designated => identifier "com.google.Chrome" ... certificate leaf[subject.OU] = EQHXZ8M8AV
```

An ad-hoc designated requirement is a hash of the app's own code, so any build that changes a byte is a different app to TCC: the toggle stays visibly on while the new build is denied and prompts again. A signed app's requirement names its certificate, which is why signed applications keep permissions across updates. A rebuild that changes nothing is harmless — the build is deterministic and the hash is unchanged — so it is *changing* the app, not rebuilding it, that invalidates the grant.

That makes any stable certificate, not only a Developer ID, enough to stop the repeated prompting during development. `scripts/sign-mac.mjs` therefore prefers a Developer ID, then a stable local certificate (`Capturo Local Signing`, or `CAPTURO_MAC_SIGN_IDENTITY`), and only falls back to ad-hoc, where it warns and prints the resulting requirement so the consequence is visible in the build log. RELEASING.md documents creating the local certificate.

Distribution is still gated on a real Developer ID Application certificate. Until one exists, no macOS artifact may be published, and a locally signed build proves nothing about Gatekeeper or notarization.

## D-029: macOS covers a display with one overlay window, not tiles

**Status:** accepted

D-013 tiles a Windows display into an editor over the work area plus a filler per uncovered strip, so no single window covers the monitor and trips the full-screen classification that switches on Do Not Disturb. That arrangement cannot work on macOS. AppKit constrains an ordinary window to the screen's visible frame, which is precisely the work area, so a strip positioned over the menu bar or the Dock is silently moved back inside it.

Measured on macOS 26.2 with a 1512x982 display, a 33pt menu bar, and an 83pt Dock: a menu-bar strip requested at `y=0` was placed at `y=33`, and a Dock strip requested at `y=899` was placed at `y=867`. Both landed inside the work area, on top of the editor. The visible result was the reported bug: the frozen Dock painted about 32pt too high while the real Dock stayed uncovered below it, producing two Docks, and the menu bar never covered at all, so its contents could not be selected.

macOS therefore uses a single overlay over the whole of `display.bounds`, created with `enableLargerThanScreen: true`. That option is Electron's opt-out from the frame constraint and is the only reason the window can reach either strip; without it the same window is pushed to `y=33` and hangs off the bottom of the screen. At `screen-saver` level the window then covers the menu bar and the Dock, which was verified by measuring that both bands darken under the overlay shade in the same proportion as ordinary desktop content.

The Do Not Disturb hazard that motivated tiling does not apply here, because macOS keys that behavior on an application actually entering fullscreen rather than on a window that happens to cover the screen. Capturo never calls `setFullScreen` and sets `fullscreenable: false`. If a future macOS release does start treating a screen-covering window that way, the fix is a macOS-specific tiling scheme that respects the visible frame, not a return to the Windows strips, which cannot reach the menu bar or Dock at all.

The division itself is pure and lives in `overlayRegions` in `src/shared/geometry.ts`, so both arrangements are covered by `tests/geometry.test.ts` rather than being observable only by running the app on each platform.

Covering the whole display puts Capturo's own floating UI over screen edges the system owns, so `CapturePayload.safeArea` carries how far the overlay reaches past the work area at the top and bottom, and the hint and status toast are offset by those insets through CSS custom properties. The top inset matters most: on a MacBook Pro the menu bar area contains the camera housing, and the selection hint was drawn straight through it and clipped. Only Capturo's own chrome moves — the frozen desktop still fills those edges and stays selectable, which is the whole point of covering them.

## D-030: The tray's primary click always starts a capture

**Status:** accepted

Capturo's tray icon is a capture button first and a menu second: the product invariant is that Capturo opens directly into capture. On Windows, assigning a context menu with `setContextMenu` binds it to the secondary button while the primary button still only emits `click`, so a single assignment gives both behaviors.

macOS does not work that way. An assigned tray menu opens on the primary click as well, and Electron still emits `click`, so a menu-bar click both opened the menu and started a capture at the same time. The user then had a region-selection overlay running underneath an open menu.

On macOS the menu is therefore built but deliberately not assigned to the `Tray`. The primary click starts a capture, and the menu is popped up explicitly with `popUpContextMenu` from the secondary click and from Control-click, which macOS treats as a secondary click. Windows keeps `setContextMenu`, because the platform already separates the two buttons correctly and `popUpContextMenu` there would replace working behavior with a hand-rolled equivalent.

Because the menu is rebuilt whenever the tray refreshes, the retained reference must be replaced on every refresh; popping up a stale menu would show an outdated shortcut label or a dismissed update entry.

## D-031: Text is placed by clicking away, and Escape unwinds one level

**Status:** accepted

A text box commits its contents whenever focus leaves it - a click on the canvas, on the toolbar, or anywhere else - and `Ctrl/Cmd+Enter` remains an explicit commit for keyboard use. Discarding requires Escape. The previous behavior lost typed text on any click inside the selection, because the click reopened an empty box at the new point before the blur that would have committed the old one arrived, so the commit saw an empty value.

That ordering is the fragile part and the reason the implementation looks the way it does. The browser moves focus as the default action of the click, *after* the `pointerdown` handler has run, so the handler cannot simply rely on blur: it commits the open box itself and then suppresses the single blur that the same click is about to deliver. Reordering those two steps, or dropping the suppression, silently reintroduces the original data loss, which no type check or unit test catches.

Escape unwinds one level at a time rather than cancelling the capture outright. While a text box is open, Escape discards that text and stops there; a second Escape cancels the capture. Both keystrokes are the same key on the same window, so the text box's handler must stop propagation - otherwise the window-level shortcut sees an editor that the first handler has already hidden and cancels the whole capture on a single press, discarding every other annotation with it. This matches how Escape already unwinds the transparency panel and annotation selection before reaching cancel.

The resize grip is a Capturo element (`#text-editor-resize`), not the textarea's native corner. The native grip is a fixed ~15px square that CSS cannot enlarge, which at this box size demanded near-pixel accuracy; the replacement is 24px square and straddles the corner, so roughly 2.6x the area and half of it reachable from outside the box. A manual resize then locks the height, because the box otherwise re-fits itself to its content on the next keystroke and undoes the drag.

## D-032: The colour picker samples a point Capturo owns, not the OS cursor

**Status:** accepted

The picker overlay hides the system cursor and draws a magnifier at a position this renderer
maintains. Sampling follows that position rather than the cursor's, and the whole feature depends
on the difference.

Slowing the pointer down is the reason. Shift moves the sample an eighth as far as the mouse
travels, which is what makes a one-pixel border or an anti-aliased edge pickable at all. Nothing
in Electron can slow the operating system's cursor, and warping it is not exposed either, so a
picker that samples wherever the OS cursor happens to be cannot offer fine movement. Owning the
sampled point is the only way to have it.

The cost is that the sampled point and the physical cursor drift apart during fine movement. Three
options existed and two are wrong:

- **Snap the sample back to the cursor when Shift is released.** The magnifier jumps away from the
  pixel the user just spent effort aiming at, which defeats the point of aiming.
- **Leave the displacement standing forever.** The physical cursor stops at the edge of the screen
  while the sample sits hundreds of pixels away from it, so a band along one edge becomes
  permanently unpickable.
- **Bleed the displacement off over ordinary coarse movement**, which is what Capturo does. Coarse
  movement is deliberately not one-to-one: it spends half of each movement pulling the sample back
  onto the cursor. Nothing jumps, and the whole screen stays reachable within one ordinary sweep.
  Clamping also recomputes the displacement from the clamped result, which collapses it at an edge.

None of that is observable by reading the code, and all of it regresses silently, so the pointer
model is pure in `src/shared/picker.ts` and covered by `tests/picker.test.ts` rather than living in
the overlay. Arrow keys nudge exactly one pixel as a guaranteed-exact fallback.

**Amended 2026-08-19: owning the sampled point means owning where it starts and how it is shown.**
The first implementation owned the point but neither seeded nor displayed it, and both omissions
read to the user as the picker having lost the cursor.

`CapturePayload` now carries the pointer position, in CSS pixels relative to that display, or null
on the displays it is not on. Without it the overlay had nothing to start from and opened its
magnifier at the centre of the frozen image while the cursor sat somewhere else entirely; it only
came right once the user happened to move. The mapping is `cursorForDisplay` in
`src/shared/picker.ts`, pure and tested, because "which display owns this pointer" is wrong in a
way that looks like nothing at all - the overlay simply opens somewhere the user is not pointing.

A crosshair is drawn on the sampled pixel. Hiding the system cursor and placing the magnifier
deliberately clear of the target leaves nothing at the sampled point itself, so the offset
magnifier reads as floating at random. Both are positioned from the same point, so they cannot
disagree.

**Amended 2026-08-19: modifier state comes from the pointer event.** Fine movement was driven by
a window `keydown` listener, and keyboard events only reach the focused window. A multi-display
capture has one overlay per display and only one of them is focused, so Shift worked on a single
monitor and silently did nothing on the others. Pointer events carry the modifier state and arrive
at whichever overlay the pointer is over, so `movePointer` reads `shiftKey` from the event. The key
listeners remain only to keep the Fine badge honest while the pointer is still.

The reveal also focused every editor overlay as each finished painting, so whichever was revealed
last held the keyboard regardless of where the user was pointing. It now focuses the editor the
pointer is actually over, which puts Escape on the same screen as the user for every capture mode.

The picked colour is the pixel of the frozen desktop, so it inherits D-014: on Windows it is the
native helper's tone-mapped capture rather than a raw read-back, and it matches what a screenshot
of the same pixel would contain. It also inherits the freeze, so a colour cannot be picked out of
a playing video; re-invoking the picker is the answer, which is what **Pick again** does.

**Amended 2026-08-19: the magnifier is the cursor.** It was placed beside the sampled point so as
not to cover it, with a crosshair marking the point itself. That is backwards: the magnifier shows
the sampled pixel at its centre, so covering the point is exactly what it should do, and putting it
anywhere else leaves the user tracking two things that look unrelated. It is now centred on the
sampled pixel, and the crosshair is gone because the middle cell of the aperture already marks it.

Its placement is deliberately not clamped into the viewport. Nudging it back from a screen edge
would slide its centre off the sampled pixel, and a magnifier that lies about which pixel it is
showing is worse than one that is clipped by the edge of the screen.

## D-034: Picking a colour copies it

**Status:** accepted

Picking copies the hex to the clipboard without a second action, and the colour window opens on top
of that saying so. Copying is what picking a colour is *for*; making the user pick and then press
Copy adds a step to the common path to save nothing on the rare one, since the window is still
there to convert, adjust, or pick a neighbour before copying again.

Both halves of that are settings, under a Color picker tab beside Capture and GIF. Copy-on-pick can
be switched off by anyone who would rather their clipboard were never written to unasked, and the
format it copies is theirs to choose - a developer wanting `rgb(...)` should not have to convert by
hand every time. The colour window opens in that same format, so the value on screen is the one
already on the clipboard, and the window reports the exact text that was written rather than
re-deriving it: a window that assumed hex would name something the user never copied.

The window says which value it put on the clipboard, and that line does not time out the way its
other statuses do: it is the window describing its own state rather than acknowledging an action,
and it needs to still be there when the user looks up from whatever they were doing. If the
clipboard write fails the window says that instead, rather than quietly implying success.

**Pick again hides the window first.** The picker freezes the desktop as it starts, so a window
left on screen is baked into the frozen frame and everything it covers becomes unpickable - gone
from the screen but still in the picture. Hiding it is not enough on its own: Windows animates the
hide, and the frozen frame catches the window mid-fade, semi-transparent over the content behind
it. The opacity is dropped to zero first, which is immediate and unanimated - the same reason the
overlays themselves are shown at zero opacity (D-010, D-011) - and a short settle covers the
compositor's remaining frame of lag. The window keeps its colour throughout and comes back whether
the next pick succeeds or the user cancels out of the overlay.

## D-033: The picked colour is never round-tripped through HSL

**Status:** accepted

The colour window shows sliders for hue, saturation and lightness, so the obvious implementation
holds the colour as HSL and derives RGB for display. That is wrong, and visibly so: HSL is stored
as integer degrees and percents, one step of lightness is already 2.55 levels of a channel, and
`#9CAA33` comes back from the round trip as `#9BA932`. A colour picker that cannot report the pixel
it just sampled has failed at the only thing it does.

Deriving HSL from RGB on every render instead fails in the other direction. Every hue maps to the
same grey, so dragging the hue slider across a grey would compute hue back as zero and snap the
thumb to the left on release.

The window therefore holds both. The sampled RGB is authoritative for every readout and for the
swatch row; the HSL exists only to position the sliders. Moving a slider makes HSL authoritative
for that edit and recomputes RGB from it; a colour arriving whole - picked, typed as hex, or chosen
from the related row - is stored exactly and the sliders are repositioned from it. Neither
representation is continuously derived from the other.
