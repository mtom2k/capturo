# Changelog

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
