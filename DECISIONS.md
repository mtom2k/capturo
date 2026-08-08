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

## D-009: Raster tray assets, vector source

**Status:** accepted

The application and tray marks are maintained as deterministic SVG source, then converted into explicit PNG sizes at build time. Windows tray icons never depend on runtime SVG data-URL decoding, which can create a clickable but visually transparent notification-area entry.

## D-010: Present capture overlays only after first paint

**Status:** accepted

Capture overlays remain hidden while their desktop data URL decodes and paints. The renderer acknowledges readiness after two animation frames, and only then may the main process present the window. This prevents the full-screen BrowserWindow background from appearing as a black/maximized flash during capture startup.

## D-011: Reveal overlays by opacity, never by a hidden-to-shown transition

**Status:** accepted

Windows plays a scale-and-fade transition whenever a window goes from hidden to shown, and it honours that setting for borderless full-screen windows. Showing a painted overlay therefore still animated the desktop into place even though D-010 had removed the black flash. The two are separate defects, and D-010 alone does not fix this one.

The overlay is now shown transparent immediately after it is created, so the platform transition runs before there is anything to see, and D-010's readiness acknowledgement raises its opacity instead of calling `show`. An opacity change is composited directly and is never animated. Until the reveal the window sets `setIgnoreMouseEvents(true)` so an invisible full-screen window cannot swallow clicks meant for the app underneath.

Verification must measure geometric motion between consecutive frames, not average luminance. A scale animation moves the same desktop image, so frame-average brightness barely changes and a luminance check reports success while the animation is still plainly visible.

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

A rotated output duplicates into an unrotated surface. Rather than rotate the pixels back, the helper reports the rotation and the caller falls back to its previous path for that monitor.

Do not benchmark this against a GDI screen grab. GDI is itself wrong on an HDR display, and an earlier fix was declared correct on exactly that basis while the captures were still visibly blown out. Compare against content whose values are known, or against Snipping Tool. Note that Snipping Tool is not pixel-exact either: it lifts shadows and renders white as about 225, reserving headroom for HDR highlights. Faithful reproduction of SDR content is the goal here, so exactness against the drawn values is the test that matters.

## D-016: An on-demand settings window with minimal on-disk preferences

**Status:** accepted

Capturo is tray-first with no persistent window (D-002) and writes nothing to disk unless the user chooses Save (D-006, Privacy). A preferences surface appears to cut against both, so it is introduced deliberately rather than by drift.

The settings window is opened only from the tray and destroyed when closed. It is not a resident dashboard and does not change the steady state: with settings closed, Capturo is still one tray process and no window. This keeps D-002's intent — the icon still opens straight into capture, and nothing else is on screen between captures.

Preferences persist to a single `settings.json` in `app.getPath('userData')`. This is the one thing Capturo writes without an explicit Save, and it is compatible with D-006 because it holds **no captured pixels**: only four values — save format, JPEG quality, the notification toggle, and the capture shortcut. A corrupt or half-written file is never fatal; `normalizeSettings` in `src/shared/settings.ts` turns any input into a complete, valid object, so the app always starts.

The scope is kept small on purpose. Format and JPEG quality apply to **saved files only**. Copy-to-clipboard stays a lossless bitmap, which is the only meaningful thing to put on the Windows clipboard, so format and quality live entirely in the main process at save time and never reach the renderer. The renderer keeps producing a lossless PNG data URL; `capture:save` chooses the on-disk encoding, honouring an explicit `.jpg`/`.jpeg`/`.png` the user types into the save dialog over the stored default.

The logic is split the way the rest of the codebase is: pure validation and accelerator parsing in `src/shared/` with unit tests, side effects (filesystem, `globalShortcut`, tray) in `src/main/`. The security boundary is unchanged — the settings window reuses the existing sandboxed, context-isolated preload and talks only through explicit typed IPC handlers.

A rebindable capture shortcut is the one preference with a failure mode: the chosen accelerator may be owned by another application. `globalShortcut.register` reports this (or throws for a malformed accelerator), so a rebind that does not take effect rolls both the live registration and the stored value back to the previous working shortcut and reports the reason to the settings window. At startup an unavailable saved shortcut falls back to the default so the tray label stays truthful.

A second **GIF** tab ships as a disabled placeholder. It records intent — GIF capture is a planned future feature — without any capture or encoding logic in this change.
