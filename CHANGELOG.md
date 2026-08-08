# Changelog

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
