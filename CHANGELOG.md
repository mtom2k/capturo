# Changelog

## 0.13.0 - 2026-08-09

### Added

- GIF capture. Select a screen region from the tray **New GIF** item or a rebindable shortcut and
  record it to an animated GIF. While recording, a red ring frames the region, everything outside
  it is dimmed to emphasize what is captured, and a control bar shows Pause/Resume, Stop, a timer,
  and a frame counter — all excluded from the recording. Frames are captured live (the mouse
  cursor is included) and encoded off the main thread by `gifenc` with inter-frame differencing —
  and runs of identical frames coalesce into one, extending its delay rather than re-encoding — so
  files stay small (a 3-second clip that was ~18 MB is ~0.5 MB) and unlimited-duration recording
  is viable. The Settings **GIF** tab controls frame rate, quality, and the GIF shortcut. Stop
  saves a `.gif`. See D-018.

### Fixed

- Escape now cancels a capture or GIF region selection before a region has been dragged, not only
  after. The selection overlays are shown without keyboard focus (so they never steal input
  before they are ready), which meant the renderer never received the keypress until the first
  click; the editor overlay is now focused the moment it is revealed.

### Notes

- Copying a GIF to the clipboard is not included in this release. There is no clean cross-platform
  way to place an animated GIF or a file drop on the clipboard, and a PowerShell shell-out was
  rejected as too heavy for this tool. It may return later, done properly per platform. See D-018.

## 0.12.0 - 2026-08-08

### Changed

- The native capture helper is now a persistent background process, warmed when Capturo
  launches, instead of a fresh process spawned for every capture. Creating the graphics
  device and desktop duplication — about 190 ms of work, plus a one-time cold start on the
  first capture after boot — now happens once, in the background, so captures no longer pay
  for it. On the 4K + rotated-1080p setup, frame capture dropped from about 0.5 s to about
  0.33 s, and the first capture after a reboot is no longer slow. See D-017.

### Internal

- The helper gained a serve mode (line-delimited requests over stdin, one JSON result per
  line) alongside the existing one-shot `--output` mode, kept for testing and fallback. Its
  process lifecycle — spawn, warm, batch request with a timeout, restart on death, kill on
  quit — lives in `src/main/capture-helper.ts`. Desktop-duplication invalidation from display
  changes is detected and rebuilt; a dead or hung helper falls back to `desktopCapturer`; and
  the helper self-terminates if its parent dies, leaving no orphan process.

## 0.11.0 - 2026-08-08

### Changed

- The native helper now captures rotated displays instead of bailing on them. It turns the
  duplicated (unrotated) surface back to the desktop orientation and reports the rotated
  dimensions. This removes the slow `desktopCapturer` fallback that a rotated display used to
  force — which grabbed every screen — so capture on a multi-monitor setup with a rotated
  display is much faster. Measured on a 4K + rotated-1080p setup, frame capture dropped from
  about 1.7 s to about 0.5 s.

### Fixed

- Screenshots of a rotated display are now HDR-correct, captured through the same native FP16
  path as every other display rather than the washed-out fallback. Removes the 0.8.0 known
  issue that rotated displays skipped the HDR path.

## 0.10.0 - 2026-08-08

### Changed

- Invoking a capture is much faster. The overlay now appears with no artificial delay, and
  the work to grab each display's frozen desktop runs in parallel rather than one screen at
  a time.
- The reveal no longer waits out a fixed 250 ms. That delay existed to hide Windows'
  window-open animation, which the 0.9.1 `thickFrame:false` change already suppresses, so it
  was pure latency. The overlay is revealed the instant it has painted (D-011).
- `desktopCapturer` is no longer consulted on Windows when the native helper serves the
  frame. It used to grab a full-resolution thumbnail of every screen on every capture and
  then throw the result away; it is now fetched only when a display actually needs the
  fallback.
- The native capture helper no longer stalls on a static desktop. It used to discard the
  first (valid) duplicated frame and block for the full timeout waiting for a screen update
  that an idle desktop never makes; it now prefers a presented frame but falls back to the
  current desktop surface after a short budget. Output pixels are unchanged (D-015).
- On a multi-monitor setup with a rotated display, capture is faster. A rotated display
  cannot use the native helper, so it uses the `desktopCapturer` fallback; that fallback now
  runs in parallel with the helper captures instead of after them, and the helper is no
  longer launched for a display it cannot serve.

### Fixed

- The screen dims as soon as a capture is invoked, the same tint shown outside a selection,
  so it is clear that Capturo is in capture mode rather than showing the live desktop.
  Dragging a region reveals it at full brightness with the surroundings still dimmed.

### Internal

- The capture helper reports per-stage timings, and `CAPTURO_TIMING=1` prints capture-path
  phase timings, so invocation latency can be measured.
- `startCapture` was refactored into focused helpers, the pure `uncoveredStrips` tiling maths
  moved to `src/shared/geometry.ts` with unit tests, and unused payload fields were removed.
  No behaviour change.

## 0.9.1 - 2026-08-07

### Fixed

- A 1px border appeared around the whole screen during a capture, and as a hairline along
  the seam between the work area and the taskbar. A frameless window keeps `WS_THICKFRAME`
  by default, and Windows 11 draws a border around any window that has it; because a
  display is tiled into several overlays, that border showed at every overlay edge. The
  overlays now drop `WS_THICKFRAME`, which removes the border. They are not resizable, so
  the sizing frame was never needed.

## 0.9.0 - 2026-08-07

### Added

- A settings window, opened from the tray. It is minimal on purpose and holds two tabs:
  - **Capture:** choose PNG or JPEG for saved files, a JPEG quality slider, a toggle for
    the post-capture notification, and a rebindable capture shortcut.
  - **GIF:** a placeholder for a planned future feature; no controls yet.
- Preferences persist to `settings.json` under the app's user-data folder. It is the only
  file Capturo writes without an explicit Save and it holds no captured pixels — just the
  four values above. A corrupt or missing file falls back to defaults. See D-016.

### Changed

- Save can now write JPEG. Format and quality apply to **saved files only**; copy always
  places a lossless bitmap on the clipboard. The save dialog honours an explicit `.jpg`,
  `.jpeg`, or `.png` you type over the stored default.
- The capture shortcut is no longer hardcoded. Rebinding re-registers the global
  accelerator and updates the tray label; if the chosen combination is already taken by
  another app, the previous working shortcut is kept and the reason is shown.
- The post-capture notification can be turned off.

## 0.8.0 - 2026-08-07

### Fixed

- Screenshots on an HDR display are now exact. Against a known pattern the greys
  0/32/64/96/128/160/192/255 come back as themselves, with no error at all. 0.7.0 was still
  2.5x too bright in linear light and clipped everything above roughly 180, because the
  browser capture pipeline converts to 8 bit before the app can see the frame and never
  undoes the SDR white level.
- The mouse pointer is no longer captured. The frame comes from desktop duplication, which
  excludes it.

### Added

- A native Windows capture helper, `capturo-capture.exe`, sitting behind an ordinary
  process boundary. It duplicates the desktop in `R16G16B16A16_FLOAT`, normalises against
  the live SDR white level read from Windows, tone maps in linear light, and only then
  encodes sRGB. The rest of the app is unchanged.
- Displays are matched to DXGI outputs by physical desktop origin. DXGI enumerates outputs
  in a different order from Electron, so selecting by index captured the wrong monitor.

### Known issues

- Rotated displays fall back to the previous capture path, because a duplicated frame
  arrives unrotated and is not turned back. Affects portrait monitors only, and only on
  HDR ones would the colour differ.
- Capture takes noticeably longer, around 460 ms for the helper alone on a 4K display.

## 0.7.0 - 2026-08-07

### Fixed

- Screenshots taken on an HDR display were roughly 1.6x too bright, with everything above
  about 60% grey clipped to flat white. Measured against a known pattern, greys drawn as
  32/64/96/128/160/192 came back as 59/109/160/210/255/255. The frozen desktop is now
  grabbed through a capture stream in the renderer instead of a `desktopCapturer`
  thumbnail, which returns the same pixels the display is showing. The same pattern now
  round-trips within 1/255, and a real-world capture matches a GDI reference exactly on
  all three channels. SDR displays were never affected and are unchanged.

### Known issues

- The mouse pointer is now composited into the capture when it sits on the display being
  captured. `desktopCapturer` excluded it; the capture stream does not, and neither the
  `cursor: never` constraint nor hiding the cursor from the overlay prevents it. This is
  the outstanding defect for 0.7.x; see D-014.

## 0.6.0 - 2026-08-06

### Changed

- Drawing tools are sized with a pixel slider instead of Small, Medium, and Large. Stroke
  width covers 1-24px and numbered steps 10-48px, both showing their value in `px` and
  updating while dragged, so a size can be judged against the screenshot underneath. The
  slider follows the selected object when an existing annotation is picked with the
  Select tool.
- Text keeps a list of preset sizes, now labelled in `px`, with 12px added.

## 0.5.0 - 2026-08-06

### Fixed

- The taskbar could not be included in a screenshot. 0.4.0 had shrunk the overlay to the
  work area to stop Windows classifying it as a full-screen application, which is what
  switched on Do Not Disturb. A display is now covered by an editor window over the work
  area plus a filler window for each strip it leaves uncovered. Windows only tests one
  window at a time, so tiled overlays cover everything without the classification: the
  whole display is capturable again and Do Not Disturb stays off.

### Changed

- Every overlay of a display receives the whole frozen desktop and its own origin within
  it, and derives scale from the captured region rather than from its own viewport. The
  editor owns all interaction and publishes the scene to the fillers, so a selection
  crossing into the taskbar shades and highlights correctly.

## 0.4.0 - 2026-08-06

### Fixed

- Starting a capture switched Windows into Do Not Disturb, showing the bell indicator
  in the notification area and suppressing notifications for the duration. Windows
  classifies any window covering a monitor as a full-screen application, and 0.3.0 had
  started covering the monitor exactly. The overlay now covers the work area instead,
  and the frozen desktop is cropped to match so selections stay pixel-exact.

### Changed

- The taskbar is no longer part of the capture surface. It stays live during a capture
  and cannot be included in a screenshot. Restored in 0.5.0 by tiling the overlay.

## 0.3.0 - 2026-08-06

### Fixed

- The capture overlay did not cover the whole display. Windows clamps a window's
  construction size to the work area, so the overlay was built about 48 DIP short and
  the live taskbar stayed visible below it while the frozen desktop was squashed into
  the remaining space. Two consequences followed: the taskbar could never be included
  in a screenshot, and every selection was skewed, because the renderer derives
  source-image pixels from its own viewport. A 700 x 500 selection exported as
  699 x 516. The overlay now re-applies its bounds after creation, which Windows
  honours in full, so selections and exports are exact on both axes.

## 0.2.0 - 2026-08-06

### Fixed

- Starting a capture played a window-open animation, so the desktop appeared to zoom
  and cross-fade into the frozen overlay instead of freezing in place. The overlay is
  now shown transparent before it loads, so the platform's show transition is spent
  while nothing is visible, and the frozen desktop is revealed by an opacity change.
  Measured at 60 fps, the transition went from 13 animated frames (217 ms) to a single
  frame (17 ms).

### Added

- The tray tooltip and tray menu now show the running version, so the installed build
  can be identified without inspecting files on disk.

### Known issues

- Exported screenshots are about 3.2% taller than the region dragged on a scaled
  display. This predates 0.2.0 and is not caused by the overlay change above.
  Fixed in 0.3.0.

## 0.1.0 - superseded, never released

### Added

- Direct selection of existing annotations from the Select tool.
- Object movement, eight-handle resizing, Delete removal, and live property editing.
- Double-click editing for existing text annotations.
- Dedicated Windows and macOS raster tray assets generated from SVG sources.
- Redesigned Capturo application mark emphasizing a display, capture brackets, and focus point.
- Small, Medium, and Large styling options for numbered steps.

### Fixed

- Windows notification-area icon could be clickable but visually transparent because it was decoded from an SVG data URL at runtime.
- Moving the crop frame incorrectly translated all placed annotations.
- Canvas pointer capture could steal focus immediately after opening the text editor, preventing visible text entry.
- Numbered steps lacked the requested white outside border.
- Contextual customization controls appeared above instead of below the primary tool toolbar.
- Capture invocation could briefly present the full-screen overlay background before the desktop image was decoded and painted.
