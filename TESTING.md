# Testing

## Automated checks

Run the complete non-GUI gate with:

```powershell
npm run build
```

This performs strict type checking, Vitest tests, and a production build of main, preload, and renderer targets. The transparency suite verifies that only the color-matching component connected to the seed is removed, nearby tones obey tolerance without crossing a non-matching barrier, and feathering produces a partial-alpha boundary. Highlight geometry tests assert every geometric operation against the pen rather than in isolation, since the two must stay identical: bounds including the half-stroke padding that keeps a fat highlight grabbable, hit testing along and beside the stroke, translation, resize remapping, and clamping into the selection. Blur/Pixelate tests verify that 1-100% maps to useful rendering bounds, increases strictly across representative percentages, and clamps invalid input. OCR tests verify BOM/Windows-line-ending cleanup, preservation of internal spaces and blank lines, and rejection of non-text or empty recognition results. Update tests verify strict stable-semver parsing/comparison, newer/equal/older release evaluation, and rejection of drafts, prereleases, malformed responses, and unsafe tags. The GIF suite parses encoded Graphic Control Extensions and verifies that every selectable FPS totals one real second without rounding drift, irregular sample timestamps preserve their actual duration, identical-frame coalescing does not lose time, and static spans beyond the 16-bit delay limit split without truncation. Color tests verify hex/HSL conversion in both directions including the greys where hue is undefined, that a half-typed hex value is rejected rather than guessed, the alpha-carrying output forms, that readable text colour follows luminance rather than HSL lightness, and that the related-colour row stays on one hue and still spreads for a colour starting near black or white. Picker tests cover the pointer model: one-to-one coarse tracking, eighth-speed fine movement, that releasing Shift does not snap the sample back, that the displacement bleeds off over coarse movement so the far screen edge stays reachable, single-pixel arrow nudges, and that the magnifier region stays centred on a corner pixel rather than being clamped inwards. It also verifies the two-frame queue boundary, sparse/coalesced/full palette-path selection, decoded sparse-frame compositing through Sharp, preview signature validation, and that temporary clipboard cleanup targets only expired Capturo-owned GIF files. Color picker settings tests verify that a settings file written before the feature existed gains the whole section rather than leaving the picker unbound, that only the three real formats are accepted, and that a truthy non-boolean is not read as consent to write to the clipboard. Settings tests verify the open-on-startup/update-check defaults and boolean/timestamp normalization plus the pre-timer default and 0-10 second normalization; the pure countdown helper covers every whole-second boundary through zero. Screen-permission tests verify that unrecognized statuses normalize to `unknown` rather than to `denied`, that `denied` keeps offering the request action because macOS reports a never-asked app that way, that no message accuses the user of refusing, that policy-restricted and unreadable states route only to System Settings, and that every message sending the user outside Capturo tells them to reopen it.

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

2. `Ctrl + Shift + 2` opens the same flow.
3. On multiple displays, interact with each display in separate captures and confirm the selected display remains while sibling overlays close.
4. Drag a region in every direction; move it; resize every edge and corner.
5. Exercise every annotation tool. For pen, test Low/Medium/High smoothing and hold Shift or Control. For line/arrow, verify 45-degree locking.
    - **Highlighter.** Confirm it sits directly right of the Pen and responds to `H`. Draw across a line of dark text on a light background: the text must stay readable through the stroke, not be washed towards the highlight colour. Draw a stroke that crosses itself and confirm the crossing is the same tone as the rest, not a darker patch. Confirm the stroke ends exactly where the drag ended rather than overhanging it.
    - Change color mid-session and confirm each color highlights. Hold **Shift**, then **Ctrl**, and confirm each locks the stroke straight for running along a line of text. Drag the Size slider and confirm its range is the highlighter's own, that it is wide enough to cover a line of text, and that switching to the Pen restores the Pen's own size and range rather than carrying the highlighter's across.
    - Select a finished highlight with the Select tool: confirm it can be moved, resized by its handles, restyled by color and Size, and undone, exactly like a pen stroke. Confirm the saved and copied image match what the editor showed.
    - Highlight something on a **dark** background and confirm the result is weak but present — that is the documented trade-off of multiply (D-035), not a bug.
6. Add text in every font family and size, including bold, italic, multiple lines, Escape cancel, and `Ctrl+Enter` commit.
    - **Clicking away places the text.** Type into a text box and click elsewhere inside the selection: the text must be placed at its original point and a fresh empty box must open where you clicked. Repeat clicking outside the selection and clicking a toolbar button; both must place the text and close the box. A box holding only whitespace must place nothing.
    - **Escape unwinds one level.** With a text box open and text typed, one Escape must discard that text and leave the capture, the selection, and every other annotation intact. Only a second Escape cancels the capture. Verify this from a box opened by double-clicking existing text as well as a new one.
    - **Resize grip.** The corner grip must be easy to grab without precise aiming, including from just outside the box, and must resize on drag without placing or closing the text. Keep typing after a manual resize and confirm the box keeps the size you dragged rather than snapping back to fit the content.
7. Apply Blur and Pixelate over fine text. Each tool must show **Intensity**, never **Size**, as a live 1-100% slider with a clear hover explanation. At 1%, text should be only lightly obscured; at 50%, the effect should be visibly stronger; at 100%, Blur should use its widest radius and Pixelate its largest blocks. Select each existing region and confirm its percentage is restored, then change it and confirm both the preview and exported image (not only the selection overlay) match the new strength.
8. Verify `Ctrl+C`, `Ctrl+S`, toolbar Copy, toolbar Save, Undo, and Escape.
    - **Copy text (Windows).** Confirm the OCR action is immediately beside regular Copy and its hover tooltip explains both local Windows OCR and `Ctrl/Cmd+Shift+C`. Select clear multiline text, use the button, paste into Notepad, and verify plausible reading order and line breaks. Repeat through the shortcut. Success must close the editor; a blank/non-text selection or recognition failure must leave it open with useful status. Test a language installed in the Windows profile and a language without its OCR pack. Important text must be reviewed because OCR is not guaranteed exact.
    - Add a visible text annotation and confirm Copy text can recognize the final composite. Cover source text with Blur or Pixelate and confirm Capturo does not bypass that privacy effect by OCRing the original frame. Leave a transparency preview pending and verify Copy text commits what is visible before recognition. Regular Copy must still place an image, never text.
    - During Copy text, confirm no screenshot appears in `%TEMP%`, the repository, or the Pictures folder, and no network request is made. Recognized text must not appear in Capturo's stderr/log output. An over-64-MiB PNG, native-helper failure, or 20-second timeout should fail closed and leave the editor available rather than hanging it.
    - For Transparent background, use an image with an enclosed area that shares the sampled background color. Confirm only the connected outside background disappears and the enclosed matching area remains.
    - Test tolerance at 0%, a useful mid value, and 100%; test feather at 0px and 10px. Hex, RGB, and native color inputs must stay synchronized, and every control must explain itself on hover.
    - Check Before, After, and the draggable Split preview. Apply, then press `Ctrl+Z` and confirm the original pixels return. In separate captures, leave the preview pending and use `Ctrl+C`, toolbar Copy, `Ctrl+S`, and toolbar Save; each must automatically apply the preview before export. Configure JPEG in Settings and Save with a `.jpg` name: the resulting path and bytes must be PNG with an alpha channel. Paste Copy into an alpha-aware editor and confirm transparency is retained.
9. Confirm copy, save, and cancel remove overlay renderers but leave the tray process alive.
10. With Select active, click every annotation type, drag it, resize all eight handles, change each applicable property, and press Delete.
11. Move the crop frame after placing annotations and confirm the crop moves while annotations stay at their original desktop coordinates.
12. Type new text, commit with `Ctrl+Enter`, edit it by double-clicking with Select, and verify text in the exported PNG. Repeat the commit by clicking away instead of `Ctrl+Enter` and confirm the exported PNG is identical.
13. **Color picker.** Open **Color picker** from the tray menu and confirm it sits directly below **New GIF**, showing its current shortcut as its accelerator. Confirm the default `Ctrl/Cmd+Shift+4` opens it too, from another application being frontmost.
    - The system cursor must disappear and the magnifier take its place, **centred on the pixel it is reading**, with that pixel outlined in the middle of the aperture and the hex below. Check the outline stays visible over both white and black areas.
    - **The magnifier must be on the pointer the instant the picker opens, before the mouse is moved at all.** Park the pointer somewhere distinctive, invoke the picker, and confirm the aperture is centred there rather than in the middle of the screen. Repeat near each screen edge and corner: the centre must stay on the pixel even where that means the magnifier is clipped by the edge — it must never slide inwards to fit, because that would put its centre on a different pixel than the one it reports.
    - Hover a known color (a saturated app icon, pure white, pure black) and confirm the hex is exactly right rather than approximately right. Compare against the same pixel in a saved screenshot.
    - Hold **Shift**: a Fine badge appears and a full mouse sweep must move the sample only a short distance, enough to pick a one-pixel window border. Release and confirm the magnifier does not jump, then sweep normally and confirm it catches back up to the cursor within one sweep and can still reach all four screen edges.
    - Nudge with the arrow keys and confirm each press moves exactly one pixel. Pick with a click, `Enter`, and `Space`; cancel another attempt with `Esc`.
    - **Multi-display, both regressions this covers.** With the pointer on the *secondary* monitor, invoke the picker: the crosshair must appear under the pointer on that monitor, and the primary must show no magnifier or crosshair at all. Then, without clicking anything first, hold **Shift** and confirm fine movement works there — a key listener only reaches the focused overlay, so this silently worked on one monitor only. Drag across the seam in both directions and confirm exactly one magnifier is visible at a time, that it appears immediately on the monitor being entered, and that it picks up from the pointer rather than from a stale position. Confirm `Esc` cancels while the pointer is on the secondary monitor.
    - Confirm the color is right on a scaled (non-100% DPI) display and on an HDR display, and that fine movement resolves single device pixels on a scaled display rather than single CSS pixels.
14. **Color window.** After picking, confirm the value shown is the exact pixel color, not one level off, and that it **matches the hex the magnifier was showing at the moment of the click**.
    - **Picking copies on its own.** Without pressing Copy, paste into Notepad and confirm you get the hex that was picked. The window must say which value it copied, and that line must still be there a minute later rather than fading like the other statuses. Copy is still there for changing format or copying an adjusted color.
    - **Settings → Color picker.** Rebind the shortcut, confirm the tray label follows it and the new binding works from another app. Bind it to a chord another application already owns and confirm the field rolls back to the previous shortcut with a red explanation rather than silently keeping the new label. Reset returns it to `Ctrl/Cmd+Shift+4`. Restart and confirm the binding persisted.
    - Turn **Copy on pick** off and confirm picking no longer touches the clipboard: put known text on the clipboard first, pick a color, and confirm the text is still there and the window shows no "Copied" line. The **Copy format** row must dim and stop responding while it is off, because it decides nothing then. Turn it back on, set the format to RGB and then HSL, and confirm each pick copies that form and the color window opens in the same format.
    - **Pick again must clear the way.** Position the color window over something you want to sample, press **Pick again**, and confirm the window disappears completely from the frozen screen — no window, and no half-faded ghost of one — so the pixels underneath can be picked. Pick one of them and confirm the window comes back at full opacity with the new color. Repeat but cancel with `Esc`, and confirm the window returns still holding the previous color.
    - Switch HEX/RGB/HSL and confirm the field and the copy both change format. Copy with the button and with `Ctrl/Cmd+C`, then paste to verify.
    - Drag each slider and confirm the preview, all three readouts, the name, and the related-color row update while dragging, not only on release. Drag hue on a pure grey and confirm the thumb stays where it is put once saturation is raised.
    - Drag alpha below 100 and confirm the checkerboard shows through and the copied value gains its alpha form.
    - Type a hex value and confirm the window follows it; type a partial one and confirm the field marks itself invalid and the color does not change. Click a related swatch and confirm it is adopted exactly.
    - Use **Pick again**, cancel the overlay with `Esc`, and confirm the window still holds the previous color.
15. Confirm the supplied Capturo logo is consistent across the installed executable, installer UI, Settings title/taskbar window, Windows notification area, and notifications, and that its corners are transparent rather than showing the delivered backdrop as a coloured tile.
16. Confirm the contextual color/type/stroke controls appear below the primary tool row for every applicable tool and selected object.
    - Confirm the toolbar's four right-hand actions stay distinguishable: Copy blue, Copy text violet, Save green, and Cancel a red tint that deepens rather than turning grey on hover. Check each mark still identifies its button with colour ignored.
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
    - **Shortcut rebind.** Record a new combination (e.g. `Ctrl+Shift+4`): the new chord starts capture, the old one no longer does, and the tray tooltip and menu label both show the new binding. Then try a combination already owned by another app and confirm the settings window reports it and keeps the previous shortcut. Restart and confirm the last accepted shortcut is still bound.

21. Measure invocation latency with `CAPTURO_TIMING=1`. Run capture from both a **static** desktop (no animated wallpaper or moving content) and a busy one. Read the per-capture stderr summary: total frame-grab time, the helper's own `setup`/`acquire`/`convert`/`encode` breakdown, and overlays-loaded time. The static-desktop `acquire` must be bounded (no multi-hundred-millisecond stall), and the overlay must appear with no perceptible delay. This is also where the native-helper acquire change is re-verified for behaviour: on a static screen the capture must still contain the live desktop, not a black or stale frame. Pair it with the HDR known-pattern check under [DECISIONS.md](./DECISIONS.md) D-015. The greys `0/32/64/96/128/160/192/255` must round-trip exactly, confirming that bounded acquire has not altered the pixels.

22. On a setup with a **rotated display**, confirm it is captured natively and correctly. The `CAPTURO_TIMING=1` log should show a helper line for the rotated display (not a `desktopCapturer` fallback), reporting the rotated (portrait) dimensions. The captured image must be upright and not mirrored: text reads left to right and window controls stay top-right. Running the helper standalone against the display's physical origin (`capturo-capture.exe --output test.png --origin-x <x> --origin-y <y>`) and opening the PNG is the quickest check. Only the 90/270 orientation matching the test hardware is exercised; 180 follows by symmetry.

23. **Persistent capture helper (D-017).** With `CAPTURO_TIMING=1`, confirm warm captures report `setup 0` and that the first capture after a reboot is not slow (the helper warms at launch). Then exercise its resilience:

    - **Display change mid-session.** Between two captures, rotate a monitor, change its resolution, or unplug/replug one. Confirm the next capture still produces a correct, correctly-sized overlay because duplication is rebuilt on `DXGI_ERROR_ACCESS_LOST` rather than returning a black or stale frame. Lock the screen or trigger a UAC prompt, then capture again.
    - **Dead helper.** Kill `capturo-capture.exe` from Task Manager mid-session; the next capture must still succeed (respawn, or `desktopCapturer` fallback) and a helper should be running again afterwards.
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
6. Verify the Global Settings Screen recording row in each state, using `CAPTURO_SCREEN_ACCESS_STATE` in a development build to reach the ones this machine cannot produce. Granted must be a quiet line with a green chip and no buttons. Denied must be a callout with a numbered next step and **Request access**, **Open System Settings**, **Reopen Capturo**. With `screenAccessWasGranted: true` in the development `settings.json`, denied must instead read **NEEDS RE-GRANTING** and tell the user to switch the permission off and on. Confirm the row refreshes when the window regains focus, and that no state overflows the fixed-size window.
7. Verify Capturo asks at most once, and never twice at the same time. With Screen Recording not granted, trigger capture repeatedly and quickly from the menu bar and the shortcut. **Only one dialog may ever be on screen**: the attempt that raises Apple's system prompt must not also show Capturo's dialog behind it. Exactly one system prompt may appear per launch, exactly one Capturo dialog may be open at a time, and dismissing it must not reveal another queued behind it. When reproducing this with extra `electron .` instances, give every instance the same smoke flag: `second-instance` only reaches the running app when `userData` matches, so instances launched without it run independently and prove nothing. `stderr` prints one `[permission] capture refused` line per genuine refusal, so the count is checkable rather than a judgement call. A regression here pushes users into pressing **Deny**, which records a refusal only System Settings can undo.
8. Verify **Reopen Capturo** from both Settings and the capture permission dialog: Capturo must quit and come back with its tray icon, working shortcuts, and a permission state that reflects any change made in System Settings while it was running.
9. Verify that a first run raises the macOS system prompt and that Capturo then appears in System Settings → Privacy & Security → Screen & System Audio Recording.
10. Verify Open on startup registers and unregisters a login item, and that an ordinary launch logs no login-item error.
11. Verify `Esc` cancels immediately, before any region is dragged, for both a screenshot and a GIF capture, and with another application frontmost when the capture is started (menu-bar click *and* global shortcut). macOS gives the overlay no keyboard focus unless the application itself is activated, so a regression here leaves Esc dead until the first drag. Confirm the frontmost application becomes Capturo when the overlay appears: `lsappinfo info -only name "$(lsappinfo front)"`.
12. Verify the capture overlay's own UI clears the system edges. On a MacBook Pro with a notch, the "Drag to select" hint must sit fully below the camera housing and be legible end to end, and the status toast must clear the Dock. The frozen desktop must still fill both edges and a selection must still be able to include them — insetting the canvas rather than the chrome would be a regression (D-029).
13. Verify GIF Copy on macOS actually pastes. Record a GIF, press Copy, then paste into Finder, Mail and a chat app: each must receive the animated `.gif` file, not a still frame. Confirm with `osascript -e 'clipboard info'` that the pasteboard reports `«class furl»`. An empty pasteboard while Capturo reports success is the exact `public.gif` regression D-023 describes.
14. Verify the color picker on a Retina display: the magnifier must show real device pixels rather than a smoothed upscale, the reported color must match the same pixel in a saved screenshot, and Shift-fine movement must resolve single device pixels rather than points.
15. Verify Retina exports match the dimension label and contain no scaling blur.
16. Verify `Cmd + Shift + 2`, `Cmd+C`, `Cmd+S`, Spaces, and fullscreen applications.
17. Verify the app has no Dock icon while resident.
18. Verify Copy text is absent or degrades with a clear message: OCR is Windows-only and the native helper is not packaged for macOS.
19. Confirm `codesign --verify --deep --strict` passes and `codesign -dv` reports `Identifier=com.capturo.app` with sealed resources.

## Packaging checks

Windows:

```powershell
npm run dist:win
```

macOS (on macOS only):

```bash
npm run dist:mac
```

Install and launch the packaged binary; do not treat a development preview as sufficient release validation.
