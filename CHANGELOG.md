# Changelog

## Unreleased

## 0.21.0 - 2026-08-18

### Added

- **Color picker.** A new tray-menu entry below **New GIF** picks a color from anywhere on screen.
  A magnifier follows the pointer showing the pixels around it at 17x zoom with the sampled pixel
  outlined, and its hex value beside it. Holding **Shift** slows sampling to an eighth speed for
  picking a one-pixel border or an anti-aliased edge; the arrow keys nudge exactly one pixel.
  `Esc` cancels. A crosshair marks the exact pixel being sampled, since the system cursor is
  hidden while the picker is open.
- The picker works across multiple displays: it opens on the pixel the pointer is already over,
  shows nothing on the displays the pointer is not on, and Shift-fine movement works on whichever
  monitor the pointer is on rather than only the focused one.
- Picking opens a color window with the value in HEX, RGB, or HSL, live hue, saturation, lightness
  and alpha sliders, a row of related colors a click away, and the nearest color name. Every
  readout updates while a slider is dragged rather than on release. The value can also be typed as
  hex, copied with the button or `Ctrl/Cmd+C`, and **Pick again** returns to the screen without
  losing the color already held.

## 0.20.0 - 2026-08-18

### Fixed

- Clicking away from a text box now places the text instead of discarding it. Typing into a text
  box and then clicking anywhere else in the selection lost everything typed: the click reopened
  an empty box at the new point before the old one was committed, so the commit saw an empty
  value. `Ctrl/Cmd+Enter` still commits explicitly, and Escape is now the only way to discard.
- Escape while placing text cancels the text, not the capture. A single press discarded the text
  and cancelled the whole screenshot with it, taking every other annotation. It now unwinds one
  level at a time: the first Escape discards the text, a second cancels the capture.
- Blur now actually blurs the whole region. It was fed only the pixels inside its own rectangle,
  so the Gaussian read transparency past every edge: the effect faded out towards the border and
  the untouched original showed through underneath. That looked like a blur which only worked in
  the middle, and raising **Intensity** appeared to do nothing because a larger radius simply
  widened the faded band. The region is now blurred with a margin of the surrounding image, with
  the image edge repeated outwards where a region sits against the edge of the screenshot, and
  only its centre is drawn back.

### Changed

- The text box's resize corner is much easier to grab. It replaces the browser's fixed ~15px
  native grip with a 24px target that straddles the corner, so it can be grabbed from outside the
  box as well as inside, and a manual resize is no longer undone by the next keystroke.
- Save carries its own green accent instead of reading as a secondary control beside the two
  filled copy actions, and Cancel carries a red tint that deepens on hover, so the one destructive
  button in the toolbar is identifiable before it is clicked.
- New Capturo logo across every surface: executable and installer, Settings and GIF preview
  windows, notifications, the Windows notification area, and the macOS menu bar.
- Icons now have transparent corners. The logo is delivered on a filled backdrop, which is correct
  as artwork but renders as a coloured tile in the macOS Dock and the notification area, so the
  generator keys out the backdrop connected to the outer edges. The focus brackets survive because
  they sit inside the card, and the anti-aliased rim is un-blended so the cutout carries no halo.
- The macOS menu bar now uses a monochrome template icon, so it follows the light or dark bar,
  dims while the app is inactive, and matches the system glyphs beside it. Windows keeps the
  colour mark.
- **Copy text** now uses a clipboard holding "Aa", and carries its own violet accent beside image
  Copy's blue. The previous mark read as a document and sat next to Save, which is also a document
  shape, and nothing said the button copies anything. The two marks stay distinguishable without
  relying on colour.

## 0.19.0 - 2026-08-17

### Added

- Global Settings shows the macOS Screen Recording permission. While something is blocking
  capture it becomes a callout with a one-word status, a numbered next step, and **Request
  access**, **Open System Settings**, and **Reopen Capturo** actions; once granted it collapses to
  a quiet line. The row is hidden on Windows, which has no equivalent permission.
- **Reopen Capturo** restarts the app from Settings and from the permission dialog. macOS applies
  a newly granted permission only to a newly launched app, so this is a step in the flow rather
  than a workaround.
- Capturo now recognises when Screen Recording access it previously had has gone away, and says
  so specifically: System Settings usually still lists Capturo as switched on, so it asks you to
  switch it off and on again instead of repeating "turn it on".

### Fixed

- `Esc` now cancels a screenshot or GIF capture immediately on macOS, instead of doing nothing
  until a region had been dragged. The overlay never received keyboard focus, because macOS will
  not make a window key while its application is inactive and Capturo runs in the menu bar.
- The GIF overlay's "Drag to select a region to record" hint is no longer clipped by the camera
  housing on a MacBook Pro. The screenshot overlay was corrected for this; the GIF overlay is a
  separate entry point and was missed, and both now share one helper so they cannot drift again.
- Copying a finished GIF now works on macOS. Capturo wrote the clipboard data under `public.gif`,
  which is not a real pasteboard type, so macOS accepted the write, stored nothing, and Capturo
  still reported success. It now copies the `.gif` file itself the way the Windows build does, so
  the animation survives the paste, and it verifies the clipboard before claiming success.
- The "Drag to select" hint is no longer clipped by the camera housing on a MacBook Pro. The
  capture overlay covers the whole display on macOS, so Capturo's own on-screen text is now inset
  past the menu bar area at the top and the Dock at the bottom. The frozen desktop still fills
  those edges and remains selectable.
- Capturo no longer shows its own permission dialog on top of the macOS Screen Recording prompt.
  The system prompt is answered asynchronously, so Capturo saw "still denied" and stacked a second
  dialog behind Apple's, for one permission that only Apple's dialog could grant.
- Capturo no longer asks for Screen Recording permission repeatedly on macOS. Every capture
  attempt re-raised the system prompt, and each trigger queued its own prompt and dialog, so
  dismissing one only brought up the next — with **Deny** as the only way to stop it, which
  records a refusal that only System Settings can undo. Capturo now raises the system prompt at
  most once per launch and holds a single permission conversation at a time.
- Clicking the Capturo icon in the macOS menu bar now starts a screenshot instead of opening the
  menu and starting a capture at the same time. The menu moved to right-click and Control-click,
  matching macOS conventions. Windows tray behaviour is unchanged.
- macOS captures now include the menu bar and the Dock, and no longer show a duplicated Dock.
  macOS pushed the overlay strips covering those areas back inside the work area, so their frozen
  copies were painted over the editor while the real menu bar and Dock stayed on screen. macOS now
  covers the display with a single overlay that is exempt from that clamp.
- macOS capture no longer refuses on a first run. macOS reports a never-asked app the same way it
  reports a refused one, so Capturo now attempts the request before concluding permission was
  denied. Without this it sent users to a System Settings pane that did not list Capturo yet.
- macOS development builds can be signed with a stable local certificate, so macOS stops asking
  for Screen Recording after every rebuild. An ad-hoc signature's designated requirement is the
  app's own code hash, so each changed build looked like a different app to macOS even though the
  permission toggle stayed on. The build now prefers a Developer ID, then a local certificate, and
  warns when it falls back to ad-hoc.
- macOS builds are ad-hoc signed during packaging. Previously the packaged app kept Electron's
  linker signature, reported its identifier as `Electron`, sealed no resources, and was treated
  by macOS as damaged.
- macOS no longer logs `Unable to set login item: Operation not permitted` on every launch. The
  startup reconciliation asked macOS to unregister a login item that had never been registered.
- `release/BUILD-INFO.txt` names the unpacked directory that was actually produced instead of
  always claiming `win-unpacked/`.
- A macOS build no longer requires the Windows native helper directory to exist; that resource is
  now scoped to the Windows target.

## 0.18.1 - 2026-08-15

### Changed

- Replaced the sole canonical Capturo logo with the supplied camera/scissors artwork and
  regenerated the package/Desktop, taskbar/notification, and 16px/32px tray/menu-bar assets.
  Every brand surface continues to use an unchanged resize of the same source image.
- Streamlined the README around Capturo's current Windows capabilities, removed superseded local
  release notes, and refreshed the contributor documentation for clearer handoff.

## 0.18.0 - 2026-08-14

### Added

- Screenshot captures now have **Copy text** immediately beside Copy. It uses the current
  rendered selection, runs Windows' built-in OCR locally, and places recognized plain text on
  the clipboard. `Ctrl/Cmd+Shift+C` invokes the same action, pending transparency is applied
  automatically, and an empty or failed result leaves the editor open with useful feedback.

### Security and privacy

- OCR image bytes stay in memory and travel only over Capturo's private native-helper pipe;
  Capturo adds no OCR network service, model download, telemetry, or temporary screenshot file.

## 0.17.0 - 2026-08-13

### Added

- Global Settings now has a manual **Check for updates** button and an opt-in automatic check.
  Packaged builds compare their stable semantic version with GitHub's latest published Capturo
  Release after launch and at most once per 24 hours. An available update is surfaced in
  Settings, the tray menu, and a local notification; Capturo never downloads or installs it.

### Security and privacy

- Update requests run only in the main process, send no capture pixels, settings, account token,
  or device identifier, reject drafts/prereleases/malformed version tags, and open only Capturo's
  fixed official Releases URL. Automatic network access is disabled by default.

## 0.16.0 - 2026-08-13

### Changed

- Blur and Pixelate now use a dedicated **Intensity** control from 1-100% instead of exposing
  the shared stroke **Size** slider. Higher percentages produce a stronger blur or larger
  pixel blocks, and selecting an existing effect restores its own saved percentage.

### Fixed

- Wide GIFs now remain contained inside the preview stage instead of allowing the initially
  focused action row to scroll the header or footer out of view.

### Documentation

- Added current GIF Settings and finished-preview screenshots to the README, alongside a
  concise walkthrough of selection, protected recording chrome, preview, copy, save, reveal,
  retake, and discard behavior.

## 0.15.2 - 2026-08-13

### Added

- Stopping a GIF now opens an animated preview instead of immediately opening Save As. The
  preview keeps the encoded bytes in memory and offers Copy, Save, Open folder, Retake, and
  Discard actions, with `Ctrl/Cmd+C`, `Ctrl/Cmd+S`, and Escape shortcuts.
- GIF Copy preserves animation. Windows places a real `.gif` file drop (`CF_HDROP`) on the
  clipboard through Capturo's existing native helper rather than copying a decoded still frame.
  An unsaved GIF is materialized in Capturo's temporary clipboard directory only when Copy is
  requested; expired temporary copies are cleaned on a later launch.
- Settings now includes a **Global** section with an **Open on startup** toggle. It defaults
  off, persists with the other preferences, and registers or removes Capturo as an OS login item
  in packaged Windows and macOS builds. Development runs never register Electron itself.

### Changed

- Saving from the GIF preview no longer closes the workflow, so the saved file can still be
  copied, revealed in its folder, reviewed, or followed by a retake.

## 0.15.1 - 2026-08-12

### Added

- Capturo now uses the final supplied 500px transparent logo across every brand surface. The executable/installer,
  Settings taskbar window, Windows notification area, macOS menu bar, and notifications all
  receive unchanged resized derivatives of `build/icon-source.png`; the previous secondary tray
  mark, rounded-mask derivative, and monochrome template split have been removed.
- Screenshot editing now includes a **Transparent background** tool. Click a background pixel
  to remove only the connected area whose colors fall within a configurable perceptual tolerance,
  or refine the target with a hex, RGB, or native color input. A 0-10 px feather control smooths
  cutout edges, and Before, After, and draggable Split views update before the edit is applied.
- Transparency is a non-destructive command in the existing undo history. Transparent captures
  display a checkerboard preview and a PNG indicator; saving automatically uses `.png` even when
  JPEG is the configured screenshot format so the alpha channel is not lost.
- Copy and Save, including `Ctrl/Cmd+C` and `Ctrl/Cmd+S`, automatically commit a pending
  transparency preview before exporting. The explicit Apply button remains available when the
  user wants to continue editing instead of exporting immediately.

### Fixed

- Disabled Electron's unused built-in spellchecker before creating renderer windows. This
  prevents Windows from leaving malformed Unicode `Microsoft/Spelling/neutral` cache folders in
  Capturo's working directory; the two existing empty cache trees were removed.

### Internal

- Connected-color removal is covered by unit tests for isolated components, tolerance, and
  feathered alpha. Processed composites are cached as a two-entry Before/After pair so normal
  editor redraws do not repeat the flood fill.

### Platform notes

- This release is tested and published for Windows x64 only. The GitHub release contains the
  interactive installer; the portable executable remains a local validation artifact.
- The installer is not Authenticode-signed and may show an unknown-publisher warning. macOS
  remains untested, unsigned, un-notarized, unsupported, and is not published.

## 0.14.0 - 2026-08-11

### Added

- GIF Settings now includes a persisted **Frame count** toggle. Turning it off hides sampled,
  skipped, processed, ready, and encoded frame totals from the protected recording bar while
  retaining the timer and generic Finalizing/Saving states. Existing behavior remains the default.
- GIF recording now has a configurable 0-10 second pre-timer, defaulting to 3 seconds. The
  content-protected control bar counts down before the first frame and active timer begin; 0
  disables the countdown.

### Fixed

- Removed the Windows DWM-owned grey horizontal bands that could appear along GIF recording
  chrome after **Start Recording**. Recording windows now reapply their exact outer bounds,
  disable non-client rendering, and suppress the system border colour before first show. Shade
  windows are tiled so their internal edges cannot extend beyond the red ring, which is kept
  deterministically above them. The chrome remains content-protected and excluded from the GIF.
- GIF playback now follows active recording time instead of assigning every sampled frame the
  nominal FPS delay. Large or high-FPS regions therefore no longer play fast when canvas
  sampling runs late. GIF centisecond rounding remainder is carried between frames, preventing
  systematic drift at rates such as 30 fps; pause spans remain excluded; Stop preserves the
  final visible frame's duration; and static spans beyond the per-frame delay limit are split
  rather than truncated.

### Performance

- GIF recording now keeps at most two frames in flight to the encoder worker. If encoding cannot
  sustain the selected FPS, sampling ticks are skipped before canvas readback instead of queuing
  unbounded raw frames; active timestamps preserve the correct playback duration. The control
  bar reports skipped ticks and bounded finalization progress.
- Localized GIF changes now quantize and map only changed pixels when they cover at most 25% of
  the region, while broadly changing frames retain the full-frame path. The final GIF buffer is
  also transferred without a redundant complete copy.
- A packaged 30 fps, 70% quality validation capture retained its complete 27.78-second timeline,
  decoded without errors, and produced a 2.41 MB GIF versus roughly 22 MB in the comparable
  pre-optimization capture. Results vary with region size and screen activity.

### Platform notes

- This release is tested and published for Windows x64 only. The GitHub release contains the
  interactive installer; the portable executable remains a local build output.
- The Windows installer is not Authenticode-signed and may show an unknown-publisher warning.
  macOS remains untested, unsigned, un-notarized, unsupported, and is not published.

## 0.13.0 - 2026-08-09

### Added

- GIF capture. Select a screen region from the tray **New GIF** item or a rebindable shortcut and
  record it to an animated GIF. While recording, a red ring frames the region, everything outside
  it is dimmed to emphasize what is captured, and a control bar shows Pause/Resume, Stop, a timer,
  and a frame counter, all excluded from the recording. Frames are captured live (the mouse
  cursor is included) and encoded off the main thread by `gifenc` with inter-frame differencing.
  Runs of identical frames coalesce into one and extend its delay rather than re-encoding, so
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
  device and desktop duplication (about 190 ms of work, plus a one-time cold start on the
  first capture after boot) now happens once in the background, so captures no longer pay
  for it. On the 4K + rotated-1080p setup, frame capture dropped from about 0.5 s to about
  0.33 s, and the first capture after a reboot is no longer slow. See D-017.

### Internal

- The helper gained a serve mode (line-delimited requests over stdin, one JSON result per
  line) alongside the existing one-shot `--output` mode, kept for testing and fallback. Its
  process lifecycle lives in `src/main/capture-helper.ts`: spawn, warm, batch request with a
  timeout, restart on death, and kill on quit. Desktop-duplication invalidation from display
  changes is detected and rebuilt; a dead or hung helper falls back to `desktopCapturer`; and
  the helper self-terminates if its parent dies, leaving no orphan process.

## 0.11.0 - 2026-08-08

### Changed

- The native helper now captures rotated displays instead of bailing on them. It turns the
  duplicated (unrotated) surface back to the desktop orientation and reports the rotated
  dimensions. This removes the slow `desktopCapturer` fallback that a rotated display used to
  force. That fallback grabbed every screen, so capture on a multi-monitor setup with a rotated
  display is now much faster. Measured on a 4K + rotated-1080p setup, frame capture dropped from
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
  file Capturo writes without an explicit Save and it holds no captured pixels, just the
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
