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
