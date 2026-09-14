# Testing

## Automated checks

Run the complete non-GUI gate with:

```powershell
npm run build
```

This performs strict type checking, Vitest tests, and a production build of main, preload, and renderer targets. The transparency suite verifies connected-component removal, tolerance, and feathered alpha. Highlight geometry tests cover bounds, hit testing, translation, resize remapping, and clamping. Blur/Pixelate tests verify monotonic 1-100% rendering bounds. OCR tests verify cleanup, spacing, blank lines, and rejection of empty results. Rolling-capture tests cover exact vertical/horizontal offsets, sticky leading content, sparse documents, unchanged/unrelated rejection, output growth and limits, whole-pixel pointer masking and the coverage it leaves behind, and an outline that paints clear of the crop; static tests pin the renderer entry, typed bridge, owner checks, the cursor-free stream request, the absence of any system-cursor suppression in the panoramic path, decoded-frame sampling, out-of-crop chrome, strip assembly, and toolbar entry. The remaining suites cover update semver, GIF timing/encoding, color conversion, picker movement and rendering—including the 30 Hz live-sample cadence and single-bitmap grid upload—settings normalization, and screen-permission routing.

On an interactive Windows desktop, rebuild the native helper and run the picker input smokes:

```powershell
cmd /c native\capturo-capture\build.cmd
node tests/fixtures/picker-native-smoke.mjs
node tests/fixtures/picker-native-actions-smoke.mjs
node tests/fixtures/picker-app-input-smoke.mjs
```

The first verifies a desktop-wide hit surface and null cursor before readiness, the second injects
a physical wheel and click into the native HWND, and the last launches an isolated development app,
steps through all four zoom changes, makes a wide mouse sweep, and checks that Escape closes the
picker. The scripts briefly move or intercept the cursor and restore normal input on completion.
They cannot prove that a one-frame cursor flash or video-plane artifact is absent; use the visual
desktop checks below as well.

`tests/action-icons.test.ts` checks that Copy, Save, Cancel/Discard, and Full Tab handoff controls
declare identical glyph/tone pairs across modes and that every icon-only control has an accessible
name and tooltip. In the desktop app, inspect the screenshot toolbar, GIF selection/recording/
preview, panoramic bar, color result, and pin header at their compact window sizes. Check hover,
focus, disabled states, and that Pause visibly changes to Resume with the correct accessible name.

## Pinned screenshots (D-045)

`tests/pin.test.ts` exercises real manager logic with Electron mocks: decoded reveal, owner/frame
isolation, opacity input validation, original-image copy, startup failure/crash/timeout cleanup,
independent windows, capacity recovery, pixel limits, and placement on scaled/negative displays.
It also checks that Edit can use only a decoded pin owned by the invoking main frame, passes the
retained PNG to Full Tab, and leaves the source pin open.

For the actual Windows main/preload/editor workflow, build and launch an isolated development
instance, then run the smoke script:

```powershell
$env:CAPTURO_CAPTURE_ON_START = '1'
Start-Process node_modules/electron/dist/electron.exe -ArgumentList '.', '--remote-debugging-port=9235', '--inspect=9236' -WindowStyle Hidden
node tests/fixtures/pin-smoke.mjs
```

The runner uses generated image content, copies it through the real clipboard and restores common
text/HTML/RTF/image formats, verifies both editor entry paths and new-capture survival, and writes
`tmp-pin-smoke/pin.png`. It quits that test app afterward. Set `CAPTURO_PIN_SMOKE_KEEP_OPEN=1`
in the runner's environment to retain generated pins for a manual native drag/edge-resize pass.
Verify transparency, 25%/100% opacity, Ctrl/Cmd+C, close buttons, keyboard focus, and moving across
different-DPI displays. Repeat on macOS and in a packaged app before release.
The smoke runner also checks that Edit refuses to replace an occupied Full Tab, then opens a pin's
original 960×480 PNG with forced PNG export after the prior editor closes. Check that annotations
can be added in the new Full Tab and pinned as a separate snapshot without changing the source pin.

## Text boxes and independent step sizes (D-043)

Run `npm run build`, then launch the generated-image desktop fixture:

```powershell
node_modules/electron/dist/electron.exe tests/fixtures/annotation-app.cjs --remote-debugging-port=9235 --inspect=9236
node tests/fixtures/annotation-smoke.mjs
```

The fixture uses the actual built editor/preload with a white image, isolates its profile under
`tmp-annotation-smoke`, and writes generated test exports there. The runner checks live north-edge
resizing, placed width resizing, font/box persistence, Escape cancellation, step/shape/text size
independence, and PNG export. Inspect `tmp-annotation-smoke/save.png` for wrapping and unclipped
first-line glyphs. It does not prove installed clipboard behavior or native screen capture.

The same runner covers D-044: near-8x zoom must show a sharp rectangle edge with at most two
partially covered device pixels; the backing-store ratio must match devicePixelRatio. It resizes
the window to 720x520, 1500x950, 820x900, and 1100x744, checking both tool rows stay inside the
top dock and the canvas stays below it. At 1:1 it compares preview against exported PNG pixels,
including overlapping Blur/Pixelate, and verifies the output stays 1000x620. It saves a preview
in `tmp-annotation-smoke/editor.png`. Also exercise maximizing, panning, and moving the window
between monitors with different DPI; existing screenshot pixels cannot gain detail under zoom.

For the desktop pass, type a paragraph without Enter, resize each edge/corner while editing and
with Select after placement, and verify only those edges move. Widening recombines lines; the
font-size menu alone changes lettering size. Reopen with a double-click, edit, click away, and
compare the PNG. Repeat at scaled DPI and Full Tab zoom. Make a box too short, then enlarge it
and verify all text returns. Set rectangle/ellipse stroke to 1 and 24px and place steps after
each: their size and border must match. Selecting a step must preserve shape stroke and text size.

## Diagnosing a washed or over-saturated capture on HDR

Run the app with `CAPTURO_TIMING=1`. Each display prints its pixel format, HDR state, SDR white
level, and where that level came from, for example:

```
[timing] helper display 1148328176: R16G16B16A16_FLOAT, hdr on, sdr white 240 nits (queried) [...]
```

`R16G16B16A16_FLOAT` with `hdr on` is the tone-mapped path. A Windows screenshot now stops
with **Capture unavailable** rather than showing an unverified frame. Read these signatures:

- A line saying the helper did not serve a display means selection was stopped. The message names
  the helper's failing stage; `SdrWhiteLevel` means Windows did not provide a current exposure.
- `(cached)` or `(fallback)` may still occur in Color Picker's live samples, but a frozen FP16
  screenshot must report `(queried)` or be rejected.
- `B8G8R8A8_UNORM` with `hdr on` must be rejected; it means DXGI declined the float format.

For the reported intermittent case, leave Capturo running, lock and unlock Windows on a
multi-monitor HDR desktop, then invoke screenshot and GIF selection without resizing any window.
Check each frozen monitor against the live desktop immediately after Escape. Repeat after resume
and after changing the HDR/SDR content brightness setting. The first capture must be correctly
colored or show the retry message, never an over-saturated overlay. Check a static desktop too:
the first post-unlock frame must be current, not a pre-lock cached image. Retry after a temporary
error and confirm capture recovers without restarting Capturo. Do not save diagnostic screenshots
that include private desktop content.

For a non-persistent desktop-path smoke on Windows, run
`node tests/fixtures/hdr-capture-app-smoke.mjs` in a normal interactive session. It starts an
isolated development app, waits for native HDR metadata and the selection overlay, then exits
without saving the image. The smoke cannot judge visual color and can be blocked by a sandbox
that denies DXGI duplication; run it with normal desktop access before treating that failure as
an application defect.

To test the packaged 0.42.3 build across lock/unlock while keeping an installed 0.42.2 app and its
in-memory pins alive, start `release/win-unpacked/Capturo.exe` with
`CAPTURO_CAPTURE_ON_START=1` and `CAPTURO_TIMING=1` in its environment. The smoke flag gives this
instance a separate development profile. Cancel its first selection, lock and unlock Windows,
then start the same executable with the same environment again: its `second-instance` handler
starts a new selection in the already-running 0.42.3 process. Inspect the frozen image and
metadata, then quit only that test instance from its tray menu. Do not install over the running
0.42.2 app until its pins have been saved or intentionally discarded.

For color accuracy, use a chart whose sRGB values are known (including greys at
`0/32/64/96/128/160/192/255`) and inspect the Capturo overlay before saving. A GDI capture is
not a reliable HDR reference; see D-015 and D-038. Do not persist a private desktop image merely
to diagnose the capture path.

## Driving a build without a person at the keyboard

Several checks below can be run unattended against the packaged app rather than by hand: the
renderer harness, Electron's remote debugging port, and the app's own smoke flags. `HANDOFF.md`
describes all three, including the traps that produce false results. Use them to narrow what has to
be checked by hand; they do not replace the hands-on passes, which is where feel, real input, and
real displays are judged.

## Windows desktop matrix

Verify on at least 100% and one scaled DPI setting:

1. Tray left-click opens a frozen overlay covering the whole display, taskbar included, tiled across an editor window and one filler per uncovered strip; see D-013. Exactly one taskbar may be visible, at its normal position. Two taskbars, or one that is squashed, means an overlay and the image handed to it describe different regions.

    Confirm a capture does not switch on Do Not Disturb. The notification area must show no bell indicator while the overlay is up, and `SHQueryUserNotificationState` must stay at `QUNS_ACCEPTS_NOTIFICATIONS` rather than reporting `QUNS_BUSY`.

    Confirm the fillers paint the shared scene rather than letting the live taskbar show through. Drag a selection well away from the taskbar and check the strip darkens with the rest of the screen; a live taskbar never dims. Then drag from the work area down into the taskbar and confirm the export is the dragged size and contains the taskbar.

    Do not judge capture fidelity by comparing an export against a GDI screen grab. `desktopCapturer` and `gdigrab` disagree on colour for acrylic surfaces and animated wallpaper: on the development machine, two grabs of an untouched screen score SSIM 0.82 over the taskbar and 0.67 over the desktop. Compare geometry and position across capture paths, and compare pixels only against Capturo's own frozen image.

    Confirm selection accuracy numerically rather than by eye, because the failure this guards against is only a few percent. Drag a rectangle of known pixel size and check the exported image matches on both axes, then confirm the exported pixels are the right region:

    ```powershell
    ffmpeg -i exported.png -i reference-crop.png -lavfi ssim -f null -
    ```

    An aligned export scores SSIM 1.000000. Validate the comparison itself with a deliberately offset crop; a 4 px shift over detailed content should drop it to roughly 0.64. Over a flat region SSIM stays at 1.0 no matter how far it is shifted, so always compare over detailed content.

2. `Ctrl + Shift + 7` opens the same flow.
3. On multiple displays, interact with each display in separate captures and confirm the selected display remains while sibling overlays close.
4. Drag a region in every direction; move it; resize every edge and corner.
5. Exercise every annotation tool. For pen, test Low/Medium/High smoothing and hold Shift or Control. For line/arrow, verify 45-degree locking.
    - **Highlighter.** Confirm it sits directly right of the Pen and responds to `H`. Draw across dark text on both light and dark backgrounds: every palette colour must look like a bright, obvious marker while the text remains readable beneath it. Draw a stroke that crosses itself and confirm the crossing is the same tone as the rest, not a darker patch. Confirm the stroke ends exactly where the drag ended rather than overhanging it.
    - Change color mid-session and confirm each color highlights. Hold **Shift**, then **Ctrl**, and confirm each locks the stroke straight for running along a line of text. Drag the Size slider and confirm its range is the highlighter's own, that it is wide enough to cover a line of text, and that switching to the Pen restores the Pen's own size and range rather than carrying the highlighter's across.
    - Select a finished highlight with the Select tool: confirm it can be moved, resized by its handles, restyled by color and Size, and undone, exactly like a pen stroke. Confirm the saved and copied image match what the editor showed.
    - The `CAPTURO_SETTINGS_SCREENSHOT_TAB` smoke accepts `colorPicker` alongside `global`, `capture` and `gif`, so the Color picker tab can be captured without opening Settings by hand.
    - On a **dark** background, confirm the result remains vivid rather than collapsing to a dim tint; this specifically guards the former `multiply` regression (D-035).
6. Add text in every font family and size, including bold, italic, multiple lines, Escape cancel, and `Ctrl+Enter` commit.
    - **Clicking away places the text.** Type into a text box and click elsewhere inside the selection: the text must be placed at its original point and a fresh empty box must open where you clicked. Repeat clicking outside the selection and clicking a toolbar button; both must place the text and close the box. A box holding only whitespace must place nothing.
    - **Escape unwinds one level.** With a text box open and text typed, one Escape must discard that text and leave the capture, the selection, and every other annotation intact. Only a second Escape cancels the capture. Verify this from a box opened by double-clicking existing text as well as a new one.
    - **Resize grips.** All eight edge/corner grips must be reachable, including from just outside the box, and resize without placing or closing the text. Each edge moves only its own side. Keep typing after a manual resize and confirm the box keeps its size rather than snapping back to fit the content.
7. Apply Blur and Pixelate over fine text. Each tool must show **Intensity**, never **Size**, as a live 1-100% slider with a clear hover explanation. At 1%, text should be only lightly obscured; at 50%, the effect should be visibly stronger; at 100%, Blur should use its widest radius and Pixelate its largest blocks. Select each existing region and confirm its percentage is restored, then change it and confirm both the preview and exported image (not only the selection overlay) match the new strength.
8. Verify `Ctrl+C`, `Ctrl+S`, toolbar Copy, toolbar Save, Undo, and Escape.
    - **Open in full tab.** Confirm the cyan action is exactly between **Copy text** and **Save**.
      Add annotations, move the crop, and leave a transparency preview pending, then open the full
      editor. The full-screen overlays must disappear only after one normal taskbar window appears;
      the checkpoint must match the visible crop, retain alpha, and remain sharp at the source
      dimensions. Resize and minimize/restore the window, add another annotation, then exercise
      Copy, Copy text, Save, and Close. Each terminal action must close only this window while the
      tray process stays alive. Start a new capture while the full editor is open and confirm it
       remains; attempting to detach the second capture must focus the existing editor and must not
       overwrite either image.
      Repeat detach several times after closing the prior editor. Simulate or observe a slow/failed
      renderer load and confirm the overlay remains available, the hidden attempt is discarded after
      the timeout, and a later attempt can open normally instead of reporting a phantom existing tab.
      In Full Tab, use the visible minus, percentage/Fit, and plus controls. Verify Ctrl/Cmd `+`,
      `-`, and `0`, then Ctrl/Cmd-wheel around a corner and ordinary wheel panning at high zoom.
      Annotations must remain aligned to source pixels at every level and after window resizing.
    - **Panoramic Scrolling (Windows and macOS).** Select a browser/document viewport and choose the amber
      action. There must be no direction prompt. The frozen overlay
      must close, the live application must accept wheel/touchpad input, and neither the cyan
      viewport outline nor the out-of-crop control bar may appear inside the captured pixels. The
      outline must frame the selected region with a visible gap, must not swallow clicks, scrolls,
      or hover states in the application underneath, and must disappear on Finish, Cancel, and
      Escape. The miniature must show
      captured content and a cyan current-viewport rectangle. Move down, back up over captured
      content, right, left, and down again. Direction and viewport must follow each change;
      retracing must add no duplicate pixels while genuinely uncovered rectangles expand the map.
      Finish and confirm one seam-free PNG opens in Full Tab with transparent holes retained for an
      L-shaped route. Annotate, Copy, Copy text, and Save it. Move too far between samples, move
      diagonally, and animate a large portion of the viewport: Capturo must ask for slower movement and must not append a corrupted
      strip. Use a periodic list/grid and make a scrollbar jump greater than 62% of the viewport;
      neither may be accepted on a merely local match. Retrace the last verified view and confirm
      the warning clears. Trigger a transient bottom-edge URL/status overlay while scrolling and
      confirm a later trusted interior frame repairs it. The mouse pointer must stay visible and
      normally shaped everywhere, inside the selected viewport included; if it ever disappears
      there, the session is hiding the system cursor and that is a regression. Keep the pointer
      inside the viewport while moving, sweep it quickly across newly exposed content, then move it
      to Finish; no cursor, shadow, or masked hole may remain in the PNG. Repeat once with a
      Windows large-pointer setting and once on a scaled display, since the mask is sized from the
      display scale. Kill the app mid-session and confirm the system cursor is unaffected.
      Confirm unchanged frames add nothing, Escape/Cancel restores the tray-only state, a
      second capture focuses the active panoramic controls, and reaching the size limit still permits
      Finish.
    - **Panoramic Scrolling on macOS.** Run the whole procedure above again on macOS, where it is
      newer and less proven than on Windows. `tests/fixtures/panoramic-app.cjs` is a scrollable
      target for it. Three macOS-specific checks come first. Select a viewport whose top edge is
      close under the menu bar and one whose bottom edge is close over the Dock: the control bar
      must appear fully inside the work area and never overlap the selected region, and a viewport
      that fills the work area must refuse to start with the clearance message rather than opening
      a session. Confirm the cyan outline keeps a visible gap on all four sides, including where
      the region sits against the top or bottom of the screen, and that no ring pixel reaches the
      output. On a Retina display, check the finished PNG at 1:1 for outline or control-bar pixels
      along any edge, since display-capture rounding works in device pixels. Then confirm the
      target application still scrolls by wheel and trackpad while the control bar holds focus, and
      note whether keyboard scrolling in the target requires clicking back into it.
    - **Copy text (Windows).** Confirm the OCR action is immediately beside regular Copy and its hover tooltip explains both local Windows OCR and `Ctrl/Cmd+Shift+C`. Select clear multiline text, use the button, paste into Notepad, and verify plausible reading order and line breaks. Repeat through the shortcut. Success must close the editor; a blank/non-text selection or recognition failure must leave it open with useful status. Test a language installed in the Windows profile and a language without its OCR pack. Important text must be reviewed because OCR is not guaranteed exact.
    - Add a visible text annotation and confirm Copy text can recognize the final composite. Cover source text with Blur or Pixelate and confirm Capturo does not bypass that privacy effect by OCRing the original frame. Leave a transparency preview pending and verify Copy text commits what is visible before recognition. Regular Copy must still place an image, never text.
    - During Copy text, confirm no screenshot appears in `%TEMP%`, the repository, or the Pictures folder, and no network request is made. Recognized text must not appear in Capturo's stderr/log output. An over-64-MiB PNG, native-helper failure, or 20-second timeout should fail closed and leave the editor available rather than hanging it.
    - For Transparent background, use an image with an enclosed area that shares the sampled background color. Confirm only the connected outside background disappears and the enclosed matching area remains.
    - Test tolerance at 0%, a useful mid value, and 100%; test feather at 0px and 10px. Hex, RGB, and native color inputs must stay synchronized, and every control must explain itself on hover.
    - Check Before, After, and the draggable Split preview. Apply, then press `Ctrl+Z` and confirm the original pixels return. In separate captures, leave the preview pending and use `Ctrl+C`, toolbar Copy, `Ctrl+S`, and toolbar Save; each must automatically apply the preview before export. Configure JPEG in Settings and Save with a `.jpg` name: the resulting path and bytes must be PNG with an alpha channel. Paste Copy into an alpha-aware editor and confirm transparency is retained.
9. Confirm copy, save, and cancel remove their owning overlay or detached-editor renderer but leave the tray process alive.
    - Trigger New screenshot twice rapidly with the shortcut, then with a tray click and shortcut
      close together. Wait for loading to finish. There must be one capture session (one editor and
      its expected filler regions per display), and Escape and the Cancel button must each close
      every overlay. Repeat with New GIF and Color Picker. A second trigger while the same mode is
      already visible must keep that selection rather than create another. Switching modes should
      close the prior selection. Cancel during a slow multi-display load and confirm no late
      "Capture unavailable" dialog appears. After cancellation, click the live taskbar and open
      another application to confirm no frozen taskbar filler or input-blocking overlay remains.
    - Pin a screenshot, then start and cancel a GIF selection. The pin must remain visible and
      functional throughout; its Escape/Close action should still close only that pin.
10. With Select active, click every annotation type, drag it, resize all eight handles, change each applicable property, and press Delete.
11. Move the crop frame after placing annotations and confirm the crop moves while annotations stay at their original desktop coordinates.
12. Type new text, commit with `Ctrl+Enter`, edit it by double-clicking with Select, and verify text in the exported PNG. Repeat the commit by clicking away instead of `Ctrl+Enter` and confirm the exported PNG is identical.
13. **Color picker.** Open **Color picker** from the tray menu and confirm it sits directly below **New GIF**, showing its current shortcut as its accelerator. Confirm the default `Ctrl/Cmd+Shift+9` opens it too, from another application being frontmost. On macOS also confirm the default does not trigger the system screenshot UI, which the previous `Ctrl/Cmd+Shift+4` default did (D-037).
    - Confirm the picker opens without any "Click to pick a color" instruction popup; only the
      magnifier/readout should appear over the live desktop.
    - **Invocation must stay live and visually unchanged.** Start a video or animated clock over
      pure white, pure black, and a saturated background, then invoke Color Picker. Motion must
      continue, and no frozen copy, shade, tint, exposure shift, flash, or taskbar duplication may
      appear. Repeat by hotkey and tray. Screenshot and GIF capture should still freeze normally.
      Run this against a packaged build as well as development: the picker stylesheet must clear
      the root `html` canvas, not only its body, or the shipped overlay can become solid navy while
      sampling underneath continues to work.
    - **Windows browser video must remain composited normally.** Test a YouTube or other
      hardware-accelerated browser video both paused and playing. The entire video rectangle must
      stay sharp, visible, and color-pickable while the rest of the page remains unchanged. Move
      far enough in every direction to make the compact picker surface recenter several times;
      neither recentering nor crossing a monitor seam may turn the video grey, blurred, or black.
    - Move the magnifier over changing video and confirm its grid and hex continue to update. The
      aperture, caption, and hint must never appear recursively inside the grid; that indicates the
      picker window lost content protection. Move rapidly and confirm the magnifier catches the
      newest point rather than replaying a long backlog of old positions.
    - Keep the pointer moving in large circles for at least five seconds. The magnifier must remain
      visible, centred, and smooth throughout motion, not disappear or stutter until the pointer
      stops. Its placement should update on every display frame while the grid refreshes at the live
      sampler's cadence. Repeat with a high-polling-rate mouse if available: preview sample work is
      capped at 30 starts per second and must not slow selector motion; clicking must still return
      the exact current pixel rather than the latest cadence-limited preview.
    - The Windows cursor should disappear across the whole desktop while the picker is active and the magnifier take its place, **centred on the pixel it is reading**, with that pixel outlined in the middle of the aperture and the hex below. Shake and sweep the physical mouse as fast as possible at every zoom level; no arrow may flash, including outside the compact visual window. Cancel, pick, and force-quit Capturo during a picker session, confirming the Windows cursor remains visible afterward in each case. Check the outline over both white and black areas.
    - On Windows, move the pointer far outside the compact visual surface and back while the magnifier is visible. The magnifier should keep tracking and recentering from the native input HWND. Verify click, wheel, Escape, and monitor-seam behavior still work.
    - **The magnifier must be on the pointer the instant the picker opens, before the mouse is moved at all.** Park the pointer somewhere distinctive, invoke the picker, and confirm the aperture is centred there rather than in the middle of the screen. Repeat near each screen edge and corner: the centre must stay on the pixel even where that means the magnifier is clipped by the edge — it must never slide inwards to fit, because that would put its centre on a different pixel than the one it reports.
    - Hover a known color (a saturated app icon, pure white, pure black) and confirm the hex is exactly right rather than approximately right. Compare against the same pixel in a saved screenshot.
    - At maximum wheel zoom, a full mouse sweep must move the sample only a short distance, enough to pick a one-pixel window border. Continue sweeping far enough to create a large gap between the physical pointer and owned sample: the complete magnifier must remain visible while moving and the compact Windows surface must follow the owned point. Zoom back out and confirm the magnifier does not jump, then sweep normally and confirm it catches back up to the cursor within one sweep and can still reach all four screen edges.
    - Repeat maximum-zoom movement with several fast diagonal sweeps that move the physical cursor
      more than 400 pixels away from the owned point and cross the compact visual surface's edge.
      The selector must continue in the same direction at a consistent rate; it must not reverse,
      jump, oscillate, or pause because the BrowserWindow moved underneath it. After one rapid
      sweep, immediately make another in both axes while the first window move may still be
      pending; neither axis should stick at the old compact window edge. Repeat at the
      widest zoom, where the selector should track the physical pointer one-to-one.
      Repeat at normal speed, reversing direction immediately after each guard
      crossing. Record at 60 fps or higher: no frame may show the selector one recenter distance
      beyond the pointer before returning. This specifically checks native-window bitmap carry.
    - Confirm the picker opens at its widest view and that no zoom-level badge is
      shown. Scroll upward and confirm the aperture advances exactly one step at a time through all
      five levels, enlarging each source pixel; scroll down through the same steps. The tighter
      three levels must move at approximately 1/2, 1/4, and 1/8 speed. Hold and release Shift at
      every level and confirm it never changes movement speed or placement. At both wheel limits,
      further scrolling must leave the level unchanged.
      At the 13-, 9-, and 5-cell levels, sweep rapidly at a shallow diagonal with one axis moving
      much farther than the other, then reverse without pausing. Both axes must continue to follow
      their respective pointer deltas at the selected 1/2, 1/4, or 1/8 factor; neither axis may
      freeze until the mouse stops. The selector must remain inside the compact picker window.
    - Jerk the pointer quickly in alternating directions over both black and white backgrounds.
      Only one aperture may be visible in each frame: no duplicate rim, caption, or short-lived
      trail may remain at a prior selector position. Record this at high frame rate if a one-frame
      compositor artifact is too brief to judge live.
    - Nudge with the arrow keys and confirm each press moves exactly one pixel. Pick with a click, `Enter`, and `Space`; cancel another attempt with `Esc`.
    - **Multi-display.** With the pointer on the *secondary* monitor, invoke the picker: the crosshair must appear under the pointer on that monitor, and the primary must show no magnifier or crosshair at all. Drag across the seam in both directions and confirm exactly one magnifier is visible at a time, that it appears immediately on the monitor being entered, and that it picks up from the pointer rather than from a stale position. Confirm `Esc` cancels while the pointer is on the secondary monitor.
      Cross while the grid is visibly changing on both monitors, then click immediately after entry;
      the preview and picked value must come from the new display even when both displays use the
      same relative coordinates.
    - Confirm the color is right on a scaled (non-100% DPI) display and on an HDR display, and that maximum zoom resolves single device pixels on a scaled display rather than single CSS pixels. At 125%, 150%, and 200% where available, inspect the hex pill: letter edges, border, and rounded ends must remain crisp rather than looking like a 1× bitmap enlarged by Windows. Development-only `CAPTURO_PICKER_VISUAL_SMOKE=1` makes the normally content-protected selector visible to Windows.Graphics.Capture; it is ignored by packaged builds and must never be used for color-accuracy or recursion checks.
14. **Color window.** After picking, confirm the value shown is the exact pixel color, not one level off, and that it **matches the hex the magnifier was showing at the moment of the click**.
    - **Picking copies on its own.** Without pressing Copy, paste into Notepad and confirm you get the hex that was picked. The window must say which value it copied, and that line must still be there a minute later rather than fading like the other statuses. Copy is still there for changing format or copying an adjusted color.
    - **Settings → Color picker.** Rebind the shortcut, confirm the tray label follows it and the new binding works from another app. Verify bare Print Screen, a bare letter, Escape, punctuation, an arrow, a numpad operation, and a media/volume key can each be recorded without the former "add Ctrl or Alt" rejection. A bare key should replace its ordinary system-wide behavior while Capturo owns it. Bind a chord another application already owns and confirm the field rolls back to the previous shortcut with a red explanation rather than silently keeping the new label. Reset returns it to `Ctrl/Cmd+Shift+9`. Restart and confirm the binding persisted.
    - Turn **Copy on pick** off and confirm picking no longer touches the clipboard: put known text on the clipboard first, pick a color, and confirm the text is still there and the window shows no "Copied" line. The **Copy format** row must dim and stop responding while it is off, because it decides nothing then. Turn it back on, set the format to RGB and then HSL, and confirm each pick copies that form and the color window opens in the same format.
    - **Pick again must clear the way.** Position the color window over something you want to
      sample, press **Pick again**, and confirm the window disappears immediately with no ghost and
      the live content beneath it keeps moving. Pick one of those pixels and confirm the window
      comes back at full opacity with the new color. Repeat but cancel with `Esc`, and confirm the
      window returns still holding the previous color.
    - Switch HEX/RGB/HSL and confirm the field and the copy both change format. Copy with the button and with `Ctrl/Cmd+C`, then paste to verify.
    - Drag each slider and confirm the preview, all three readouts, the name, and the related-color row update while dragging, not only on release. Drag hue on a pure grey and confirm the thumb stays where it is put once saturation is raised.
    - Drag alpha below 100 and confirm the checkerboard shows through and the copied value gains its alpha form.
    - Type a hex value and confirm the window follows it; type a partial one and confirm the field marks itself invalid and the color does not change. Click a related swatch and confirm it is adopted exactly.
    - Use **Pick again**, cancel the overlay with `Esc`, and confirm the window still holds the previous color.
15. Confirm the supplied Capturo logo is consistent across the installed executable, installer UI, Settings title/taskbar window, Windows notification area, and notifications, and that its corners are transparent rather than showing the delivered backdrop as a coloured tile.
16. Confirm the contextual color/type/stroke controls appear below the primary tool row for every applicable tool and selected object.
    - Confirm the toolbar's five right-hand actions stay distinguishable: Copy blue, Copy text violet, Open in full tab cyan, Save green, and Cancel a red tint that deepens rather than turning grey on hover. Check each mark still identifies its button with colour ignored.
17. Drag the stroke slider from one end to the other and confirm the `px` readout tracks it, that the drawn size changes while dragging rather than only on release, and that the extremes are usable. Repeat for the numbered-step slider, placing markers at the smallest and largest sizes. Then select each existing object with the Select tool and confirm the slider moves to that object's size instead of resetting to the default, and that dragging it restyles the selected object.
18. Record capture invocation at 60 fps from both the tray and hotkey. No unpainted black/background frame may appear before the frozen desktop overlay, and the overlay must arrive as a single hard cut with no zoom or cross-fade.

    Measure geometric motion, not brightness. A window-open animation scales the same desktop image, so average luminance stays flat while the animation is clearly visible; an average-luminance check will pass a broken build. Difference consecutive frames instead:

    ```powershell
    ffmpeg -i capture.mkv -vf "tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=signal.txt" -f null -
    ```

    Count consecutive frames whose difference exceeds the noise floor. One or two frames is a correct hard cut. A run of ten or more, especially one that decays smoothly toward zero, is an animation. The `file=` argument must be a bare relative filename, because `ffmpeg` treats `:` in a filter argument as an option separator.

19. Right-click the tray and open **Settings…**. Confirm it opens once and refocuses rather than stacking a second window when reopened, that closing it leaves the tray process resident, and that the **Global**, **Capture**, and **GIF** tabs switch. In GIF, verify frame rate, quality, the 0-10 second pre-timer, frame-count visibility, and the GIF shortcut persist after closing and reopening Settings.

20. Exercise each capture setting and confirm it persists across an app restart (the values live in `settings.json` under the user-data folder):

    - **Global → Open on startup.** In an installed/package build, turn it on and confirm Windows lists Capturo as an enabled startup app and launches it into the notification area after sign-out/sign-in. Turn it off, confirm the OS entry is removed or disabled, and confirm Capturo no longer starts automatically. The toggle must survive closing/reopening Settings and an app restart. A development build must never register Electron itself.
    - **Global → Updates.** With automatic checks off, restart and confirm Capturo makes no GitHub request. Press **Check for updates** in a packaged build and verify the inline current/latest result against the public feed; an available version must expose **View release**, add one tray action, and show at most one notification per version in that run. The link must open `https://github.com/mtom2k/capturo/releases/latest`. Enable automatic checks and confirm the opt-in persists, the last-check timestamp prevents another automatic request for 24 hours across restarts, and an active screenshot/GIF recording defers rather than interrupts the check. Offline, HTTP error, rate-limit, 404/private feed, malformed JSON, draft/prerelease, and invalid-tag cases must remain non-fatal and must never request a credential or download an executable. In development, **Check for updates** must explain that packaged Capturo is required. Reconfirm the available-version notification/tray/link path whenever the public feed first becomes newer than the packaged test build.
    - **Notification.** Turn it off, capture and copy, and confirm no toast appears; turn it on and confirm it returns.
    - **Format and quality.** Set JPEG at a low quality and Save: the file is a `.jpg`, decodes correctly, and is visibly smaller than a PNG of the same region. Switch back to PNG and confirm Save writes a `.png`. In both cases, Copy still places a lossless bitmap on the clipboard, and the JPEG quality slider is inactive while PNG is selected. Also type an explicit `.png` extension into the dialog while JPEG is the setting, and confirm the written bytes match the extension you chose.
    - **Shortcut rebind.** Record a new combination (e.g. `Ctrl+Shift+4`, which is deliberately not a default any more): the new chord starts capture, the old one no longer does, and the tray tooltip and menu label both show the new binding. Repeat with bare **Print Screen** for Capture, GIF, and Color picker in separate passes and trigger each from another application; the Settings recorder must display `Print Screen`, persist it, and never demand a modifier. Then try a combination already owned by another app and confirm the settings window reports the OS refusal and keeps the previous shortcut. Restart and confirm the last accepted shortcut is still bound.

21. Measure invocation latency with `CAPTURO_TIMING=1`. Run capture from both a **static** desktop (no animated wallpaper or moving content) and a busy one. Read the per-capture stderr summary: total frame-grab time, the helper's own `setup`/`acquire`/`convert`/`encode` breakdown, and overlays-loaded time. The static-desktop `acquire` must be bounded (no multi-hundred-millisecond stall), and the overlay must appear with no perceptible delay. This is also where the native-helper acquire change is re-verified for behaviour: on a static screen the capture must still contain the live desktop, not a black or stale frame. Pair it with the HDR known-pattern check under [DECISIONS.md](./DECISIONS.md) D-015 and D-038. The greys `0/32/64/96/128/160/192/255` must round-trip exactly. Then compare bright colored HDR content over both a mostly black scene and a mostly white scene: freezing the frame must not wash the colors toward white or increase their saturation, and neutral highlights must remain neutral. Run `native\capturo-capture\build\capturo-capture.exe --self-test` before the visual pass.

22. On a setup with a **rotated display**, confirm it is captured natively and correctly. The `CAPTURO_TIMING=1` log should show a helper line for the rotated display (not a `desktopCapturer` fallback), reporting the rotated (portrait) dimensions. The captured image must be upright and not mirrored: text reads left to right and window controls stay top-right. Running the helper standalone against the display's physical origin (`capturo-capture.exe --output test.png --origin-x <x> --origin-y <y>`) and opening the PNG is the quickest check. Only the 90/270 orientation matching the test hardware is exercised; 180 follows by symmetry.

23. **Persistent capture helper (D-017).** With `CAPTURO_TIMING=1`, confirm warm captures report `setup 0` and that the first capture after a reboot is not slow (the helper warms at launch). Then exercise its resilience:

    - **Display change mid-session.** Between two captures, rotate a monitor, change its resolution, or unplug/replug one. Confirm the next capture still produces a correct, correctly-sized overlay because duplication is rebuilt on `DXGI_ERROR_ACCESS_LOST` rather than returning a black or stale frame. Lock the screen or trigger a UAC prompt, then capture again.
    - **Dead helper.** Kill `capturo-capture.exe` from Task Manager mid-session; the next capture must respawn it and succeed. If it cannot, selection must show a retry message rather than a Chromium screenshot.
    - **No orphan.** Quit Capturo (and separately, force-kill it) and confirm no `capturo-capture.exe` is left behind.
    - **Idle then capture.** Leave the app resident for a while on a static desktop, then capture, and confirm it shows the current desktop, not a stale frame.
    - **OCR protocol (D-026).** Run `capturo-capture.exe --ocr <non-sensitive-image>` to isolate native recognition, then run the application smoke below to cover persistent serve mode and Electron's text clipboard. The one-shot command prints recognized text; the app smoke must log only counts. After any COM-apartment or C++/WinRT change, also rerun `--output` and decode the PNG so DXGI/WIC capture is proven alongside OCR.

24. **GIF capture (D-018/D-023).** From the tray **New GIF** or the GIF shortcut, drag a region and press **Start Recording**. With **Frame count** enabled, confirm the emphasis chrome: a red border ring around the region, everything outside it dimmed, and a control bar with a live timer and frame counter. None of these elements should steal focus (the region stays interactive) or trip Do Not Disturb. Record a few seconds of motion including moving the mouse, use **Pause/Resume**, then press **Stop**. Confirm all protected recording chrome disappears and one normal GIF preview window opens instead of a Save As dialog.

    Confirm the animation loops in the preview and scales to fit when the window is resized. Before saving, **Open folder** must be disabled. Cancel a Save dialog and confirm the preview remains usable; then save successfully, confirm the preview still remains open, its full path appears, and **Open folder** reveals the file in Explorer. `Ctrl/Cmd+S` must match Save, `Ctrl/Cmd+C` must match Copy, and Escape must discard the preview. Retake must clear the old preview and return to fresh region selection; closing or Discarding an unsaved preview must not create a GIF file.

    On Windows, use Copy before Save, close the preview, and paste into Explorer or another file-aware target. The pasted item must be an animated `.gif`, not a static bitmap, and it must remain available after preview teardown. Repeat Copy after Save and confirm the saved file is the clipboard item. Capturo may create `%TEMP%\Capturo\Clipboard\Capturo *.gif` only for an explicit unsaved Copy; files older than 24 hours are eligible for cleanup on a later launch. Check that arbitrary files in that directory are never removed.

    Open the saved `.gif` and confirm: it plays and loops; the **mouse cursor is present**; it contains only the region (the content-protected border, shade, and control bar are absent); and the file is reasonably small (static content should be well under a megabyte). Try low vs high **quality** and **FPS** in Settings → GIF and confirm the size/smoothness trade-off. Recording chrome cannot be seen in a screenshot tool (content protection hides it from all capture), so this step must be done by eye. On Windows, watch the instant **Start Recording** is pressed: only the thin red ring may outline the selected region. No grey horizontal bands or system-coloured border may flash or remain along the top, bottom, or control bar (D-021).

    Verify timing at **10, 15, 20, and 30 fps**, with special emphasis on 30 fps and a large region. Record a visible stopwatch or other known-duration motion for at least 10 active seconds. The saved GIF's total duration should match the control-bar active timer to GIF's 10 ms precision; it must not speed up when the renderer misses sampling deadlines. Pause for several seconds and resume: the paused wall-clock span must be absent, while the active motion before and after the pause remains correctly timed. Stop between sampling ticks and confirm the last visible frame is held through the Stop time rather than being shortened to a nominal frame.

    In Settings → GIF, test pre-timers of **0, 3, and 10 seconds**. At 3 and 10, the protected control bar must show every countdown number, Pause and Stop must remain disabled, Cancel must work, and the active timer/frame count must not begin until zero. The first captured frame should show the desktop state at zero, with no countdown chrome and no setup motion in the GIF. At 0, active recording must begin immediately. For `CAPTURO_GIF_RECORD_SMOKE`, the hard-coded pre-timer is 0 so its ~3-second output remains a ~3-second active recording.

    Toggle **Frame count** off in GIF Settings. The recording timer and controls must remain visible, but sampled/skipped counts and processed/ready/encoded totals must never appear; Finalizing and Saving remain visible through the timer/status field. Turn the toggle back on and confirm all existing counts return. The setting must persist across restart and must not change the recorded GIF's duration, frame processing, or bytes.

    Stress backpressure with a large region at **30 fps / 70% quality** for at least 30 seconds. If the worker cannot keep up, the control bar must report skipped ticks rather than becoming unresponsive or accumulating unchecked memory. Stop must switch to `Finalizing…`, show processed/total progress for no more than the two-frame bounded tail, then switch to `Opening preview…`. The previewed and saved GIF duration must still match active wall time even when ticks were skipped. Record the sampled count, skipped count, Stop-to-preview time, output size, region dimensions, and peak process memory so future encoder changes can be compared against the same baseline.

    For pipeline-only automation, `CAPTURO_GIF_RECORD_SMOKE=1` records a fixed centre region for ~3 s and writes `%TEMP%\capturo-smoke.gif` with no dialog; opening that file confirms the record → encode → save path and the crop. `CAPTURO_GIF_PREVIEW_ON_START=1` then opens that file directly in the development preview for repeatable visual and action checks; pair it with `CAPTURO_GIF_PREVIEW_SCREENSHOT=1` to write `%TEMP%\capturo-gif-preview-smoke.png` after rendering. For documentation or layout checks, `CAPTURO_SETTINGS_ON_START=1` plus `CAPTURO_SETTINGS_SCREENSHOT=1` opens the real Settings renderer; `CAPTURO_SETTINGS_SCREENSHOT_TAB=global|capture|gif` selects the tab (GIF by default), and `CAPTURO_SETTINGS_CHECK_UPDATES=1` exercises the packaged manual update check before capture.

    For the complete OCR image → persistent helper → Windows OCR → Electron clipboard smoke, set `CAPTURO_OCR_SMOKE_IMAGE` to an absolute non-sensitive image and launch Electron. It uses isolated user data, runs before login-item reconciliation, prints only character/line counts, and quits; it intentionally overwrites the clipboard:

    ```powershell
    $env:CAPTURO_OCR_SMOKE_IMAGE = 'C:\path\to\ocr-sample.png'
    .\node_modules\.bin\electron.cmd .
    ```

The 2026-08-04 passes covered scaled DPI, multi-display claim, pen rendering, exact-dimension clipboard export, lifecycle teardown, text entry, object manipulation, crop/annotation independence, step borders and sizing, contextual-toolbar ordering, paint-gated presentation, and the raster tray asset path on Windows 11.

The 2026-08-13 release pass published stable v0.17.0 and then ran the exact packaged 0.16.0
application code against GitHub's anonymous latest-release endpoint. Settings reported v0.17.0
available, retained local v0.16.0 as the current version, and exposed **View release**. This proves
the real older-client network and comparison path rather than only the pure synthetic fixture.

## macOS desktop matrix

Launch the build with `open -a /Applications/Capturo.app`, never by executing
`Capturo.app/Contents/MacOS/Capturo` from a shell: TCC attributes a directly executed binary's
capture request to the parent terminal, so any permission result measured that way is invalid.
Smoke environment flags pass through `open` with `--env NAME=1`.

Everything below the permission checks presumes a Developer ID signed build. An ad-hoc signed
build cannot hold a Screen Recording grant (D-028), so its capture results prove nothing.

In addition to the common matrix:

1. Test both Intel and Apple Silicon when available.
2. Verify first-run Screen Recording permission, denial guidance, System Settings link, and behavior after permission is granted.
3. Verify a menu-bar click starts a capture immediately and opens no menu, that right-click and Control-click open the menu without starting a capture, and that a rebound shortcut shows its new label in that menu.
4. Verify the capture overlay covers the menu bar and the Dock: both must dim with the rest of the frozen desktop, exactly one Dock may be visible, and a selection must be able to include menu-bar and Dock content. Two Docks, or an undimmed menu bar, means the overlay was clamped back into the work area (D-029).
5. Verify that a capture does not switch on a Focus mode; the single full-display overlay is the one arrangement D-013 avoids on Windows.
6. Verify the Global Settings Screen recording row in each state, using `CAPTURO_SCREEN_ACCESS_STATE` in a development build to reach the ones this machine cannot produce. Granted must be a quiet line with a green chip and exactly one button, **Manage Permissions**, which opens Privacy & Security → Screen Recording; it must carry no callout styling and offer no Request access or Reopen Capturo. Denied must be a callout with a numbered next step and **Request access**, **Manage Permissions**, **Reopen Capturo**. With `screenAccessWasGranted: true` in the development `settings.json`, denied must instead read **NEEDS RE-GRANTING** and tell the user to switch the permission off and on. Confirm the row refreshes when the window regains focus, and that no state overflows the fixed-size window.
7. Verify Capturo asks at most once, and never twice at the same time. With Screen Recording not granted, trigger capture repeatedly and quickly from the menu bar and the shortcut. **Only one dialog may ever be on screen**: the attempt that raises Apple's system prompt must not also show Capturo's dialog behind it. Exactly one system prompt may appear per launch, exactly one Capturo dialog may be open at a time, and dismissing it must not reveal another queued behind it. When reproducing this with extra `electron .` instances, give every instance the same smoke flag: `second-instance` only reaches the running app when `userData` matches, so instances launched without it run independently and prove nothing. `stderr` prints one `[permission] capture refused` line per genuine refusal, so the count is checkable rather than a judgement call. A regression here pushes users into pressing **Deny**, which records a refusal only System Settings can undo.
8. Verify **Reopen Capturo** from both Settings and the capture permission dialog: Capturo must quit and come back with its tray icon, working shortcuts, and a permission state that reflects any change made in System Settings while it was running.
9. Verify that a first run raises the macOS system prompt and that Capturo then appears in System Settings → Privacy & Security → Screen & System Audio Recording.
10. Verify Open on startup registers and unregisters a login item, and that an ordinary launch logs no login-item error.
11. Verify `Esc` cancels immediately, before any region is dragged, for both a screenshot and a GIF capture, and with another application frontmost when the capture is started (menu-bar click *and* global shortcut). macOS gives the overlay no keyboard focus unless the application itself is activated, so a regression here leaves Esc dead until the first drag. Confirm the frontmost application becomes Capturo when the overlay appears: `lsappinfo info -only name "$(lsappinfo front)"`.
12. Verify the capture overlay's own UI clears the system edges. On a MacBook Pro with a notch, the "Drag to select" hint must sit fully below the camera housing and be legible end to end, and the status toast must clear the Dock. The frozen desktop must still fill both edges and a selection must still be able to include them — insetting the canvas rather than the chrome would be a regression (D-029).
13. Verify GIF Copy on macOS actually pastes. Record a GIF, press Copy, then paste into Finder, Mail and a chat app: each must receive the animated `.gif` file, not a still frame. Confirm with `osascript -e 'clipboard info'` that the pasteboard reports `«class furl»`. An empty pasteboard while Capturo reports success is the exact `public.gif` regression D-023 describes.
14. Verify the color picker on a Retina display: the magnifier must show real device pixels rather than a smoothed upscale, the reported color must match the same pixel in a saved screenshot, and maximum zoom must resolve single device pixels rather than points.
15. Verify Retina exports match the dimension label and contain no scaling blur.
16. Verify `Cmd + Shift + 2`, `Cmd+C`, `Cmd+S`, Spaces, and fullscreen applications.
17. Verify the app has no Dock icon while resident.
18. Verify **Copy text** on macOS (D-036). Recognition runs through `native/capturo-ocr-mac` and Apple's Vision framework, so it must work without any permission prompt and without a network connection — test with Wi-Fi off. Check a real selection with annotations, a Blur region (whose text must *not* be recoverable), and a no-text selection, which must leave the editor open with a message. Nothing may tell a macOS user to install a language pack; that message is Windows-only and `tests/ocr.test.ts` pins it.

    Isolate the recognizer from the app with the one-shot mode, which mirrors the Windows helper's `--ocr`:

    ```bash
    /Applications/Capturo.app/Contents/Resources/ocr/capturo-ocr --ocr <non-sensitive-image>
    npm run ocr:mac && native/capturo-ocr-mac/build/capturo-ocr --languages
    ```

    Then run the whole app/helper/clipboard path against the packaged build. Smoke flags reach a packaged app through `open --env`, and this one deliberately overwrites the clipboard:

    ```bash
    open -a /Applications/Capturo.app --env CAPTURO_OCR_SMOKE_IMAGE=/path/to/ocr-sample.png
    pbpaste
    ```

    Confirm the helper is actually inside the bundle at `Contents/Resources/ocr/capturo-ocr`, that `lipo -archs` on it covers the architectures the app was built for, and that `codesign --verify --deep --strict` still passes with it present — an unsigned nested binary passes locally but is a standard notarization rejection.

19. Verify the macOS build has no Dock icon while resident: `lsappinfo list` must report `type="UIElement"`.
19. Confirm `codesign --verify --deep --strict` passes and `codesign -dv` reports `Identifier=com.capturo.app` with sealed resources.

## Packaging checks

Windows:

```powershell
native\capturo-capture\build\capturo-capture.exe --self-test
npm run dist:win
```

macOS (on macOS only):

```bash
npm run dist:mac
```

Install and launch the packaged binary; do not treat a development preview as sufficient release validation.

For the 0.40.0 editor regression runner, set `CAPTURO_ANNOTATION_APP_ROOT` to the absolute
`release/win-unpacked/resources/app.asar` path before launching `annotation-app.cjs`. This loads
the packaged renderer and preload with the generated-image fixture. It checks shipped editor
assets, but does not replace installer acceptance or the real clipboard/export workflow.
