# Testing

## Automated checks

Run the complete non-GUI gate with:

```powershell
npm run build
```

This performs strict type checking, Vitest tests, and a production build of main, preload, and renderer targets. The transparency suite verifies that only the color-matching component connected to the seed is removed, nearby tones obey tolerance without crossing a non-matching barrier, and feathering produces a partial-alpha boundary. Blur/Pixelate tests verify that 1-100% maps to useful rendering bounds, increases strictly across representative percentages, and clamps invalid input. Update tests verify strict stable-semver parsing/comparison, newer/equal/older release evaluation, and rejection of drafts, prereleases, malformed responses, and unsafe tags. The GIF suite parses encoded Graphic Control Extensions and verifies that every selectable FPS totals one real second without rounding drift, irregular sample timestamps preserve their actual duration, identical-frame coalescing does not lose time, and static spans beyond the 16-bit delay limit split without truncation. It also verifies the two-frame queue boundary, sparse/coalesced/full palette-path selection, decoded sparse-frame compositing through Sharp, preview signature validation, and that temporary clipboard cleanup targets only expired Capturo-owned GIF files. Settings tests verify the open-on-startup/update-check defaults and boolean/timestamp normalization plus the pre-timer default and 0-10 second normalization; the pure countdown helper covers every whole-second boundary through zero.

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
6. Add text in every font family and size, including bold, italic, multiple lines, Escape cancel, and `Ctrl+Enter` commit.
7. Apply Blur and Pixelate over fine text. Each tool must show **Intensity**, never **Size**, as a live 1-100% slider with a clear hover explanation. At 1%, text should be only lightly obscured; at 50%, the effect should be visibly stronger; at 100%, Blur should use its widest radius and Pixelate its largest blocks. Select each existing region and confirm its percentage is restored, then change it and confirm both the preview and exported image—not only the selection overlay—match the new strength.
8. Verify `Ctrl+C`, `Ctrl+S`, toolbar Copy, toolbar Save, Undo, and Escape.
    - For Transparent background, use an image with an enclosed area that shares the sampled background color. Confirm only the connected outside background disappears and the enclosed matching area remains.
    - Test tolerance at 0%, a useful mid value, and 100%; test feather at 0px and 10px. Hex, RGB, and native color inputs must stay synchronized, and every control must explain itself on hover.
    - Check Before, After, and the draggable Split preview. Apply, then press `Ctrl+Z` and confirm the original pixels return. In separate captures, leave the preview pending and use `Ctrl+C`, toolbar Copy, `Ctrl+S`, and toolbar Save; each must automatically apply the preview before export. Configure JPEG in Settings and Save with a `.jpg` name: the resulting path and bytes must be PNG with an alpha channel. Paste Copy into an alpha-aware editor and confirm transparency is retained.
9. Confirm copy, save, and cancel remove overlay renderers but leave the tray process alive.
10. With Select active, click every annotation type, drag it, resize all eight handles, change each applicable property, and press Delete.
11. Move the crop frame after placing annotations and confirm the crop moves while annotations stay at their original desktop coordinates.
12. Type new text, commit with `Ctrl+Enter`, edit it by double-clicking with Select, and verify text in the exported PNG.
13. Confirm the exact supplied Capturo logo is consistent across the installed executable, installer UI, Settings title/taskbar window, Windows notification area, notifications, and—when tested—macOS menu bar. The 16px result must remain recognizable, and any secondary `C`-only mark, legacy black icon, monochrome substitute, empty slot, or stale cached artwork is a failure. Close every running Capturo process before judging a rebuilt taskbar icon.
14. Confirm the contextual color/type/stroke controls appear below the primary tool row for every applicable tool and selected object.
15. Drag the stroke slider from one end to the other and confirm the `px` readout tracks it, that the drawn size changes while dragging rather than only on release, and that the extremes are usable. Repeat for the numbered-step slider, placing markers at the smallest and largest sizes. Then select each existing object with the Select tool and confirm the slider moves to that object's size instead of resetting to the default, and that dragging it restyles the selected object.
16. Record capture invocation at 60 fps from both the tray and hotkey. No unpainted black/background frame may appear before the frozen desktop overlay, and the overlay must arrive as a single hard cut with no zoom or cross-fade.

    Measure geometric motion, not brightness. A window-open animation scales the same desktop image, so average luminance stays flat while the animation is clearly visible; an average-luminance check will pass a broken build. Difference consecutive frames instead:

    ```powershell
    ffmpeg -i capture.mkv -vf "tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=signal.txt" -f null -
    ```

    Count consecutive frames whose difference exceeds the noise floor. One or two frames is a correct hard cut. A run of ten or more, especially one that decays smoothly toward zero, is an animation. The `file=` argument must be a bare relative filename, because `ffmpeg` treats `:` in a filter argument as an option separator.

17. Right-click the tray and open **Settings…**. Confirm it opens once and refocuses rather than stacking a second window when reopened, that closing it leaves the tray process resident, and that the **Global**, **Capture**, and **GIF** tabs switch. In GIF, verify frame rate, quality, the 0-10 second pre-timer, frame-count visibility, and the GIF shortcut persist after closing and reopening Settings.

18. Exercise each capture setting and confirm it persists across an app restart (the values live in `settings.json` under the user-data folder):

    - **Global → Open on startup.** In an installed/package build, turn it on and confirm Windows lists Capturo as an enabled startup app and launches it into the notification area after sign-out/sign-in. Turn it off, confirm the OS entry is removed or disabled, and confirm Capturo no longer starts automatically. The toggle must survive closing/reopening Settings and an app restart. A development build must never register Electron itself.
    - **Global → Updates.** With automatic checks off, restart and confirm Capturo makes no GitHub request. Press **Check for updates** in a packaged build and verify the inline current/latest result against the public feed; an available version must expose **View release**, add one tray action, and show at most one notification per version in that run. The link must open `https://github.com/mtom2k/capturo/releases/latest`. Enable automatic checks and confirm the opt-in persists, the last-check timestamp prevents another automatic request for 24 hours across restarts, and an active screenshot/GIF recording defers rather than interrupts the check. Offline, HTTP error, rate-limit, 404/private feed, malformed JSON, draft/prerelease, and invalid-tag cases must remain non-fatal and must never request a credential or download an executable. In development, **Check for updates** must explain that packaged Capturo is required. Reconfirm the available-version notification/tray/link path whenever the public feed first becomes newer than the packaged test build.
    - **Notification.** Turn it off, capture and copy, and confirm no toast appears; turn it on and confirm it returns.
    - **Format and quality.** Set JPEG at a low quality and Save: the file is a `.jpg`, decodes correctly, and is visibly smaller than a PNG of the same region. Switch back to PNG and confirm Save writes a `.png`. In both cases, Copy still places a lossless bitmap on the clipboard, and the JPEG quality slider is inactive while PNG is selected. Also type an explicit `.png` extension into the dialog while JPEG is the setting, and confirm the written bytes match the extension you chose.
    - **Shortcut rebind.** Record a new combination (e.g. `Ctrl+Shift+4`): the new chord starts capture, the old one no longer does, and the tray tooltip and menu label both show the new binding. Then try a combination already owned by another app and confirm the settings window reports it and keeps the previous shortcut. Restart and confirm the last accepted shortcut is still bound.

19. Measure invocation latency with `CAPTURO_TIMING=1`. Run capture from both a **static** desktop (no animated wallpaper or moving content) and a busy one, and read the per-capture stderr summary — total frame-grab time, the helper's own `setup`/`acquire`/`convert`/`encode` breakdown, and overlays-loaded time. The static-desktop `acquire` must be bounded (no multi-hundred-millisecond stall), and the overlay must appear with no perceptible delay. This is also where the native-helper acquire change is re-verified for behaviour: on a static screen the capture must still contain the live desktop, not a black or stale frame. Pair it with the HDR known-pattern check under [DECISIONS.md](./DECISIONS.md) D-015 — the greys `0/32/64/96/128/160/192/255` must round-trip exactly — so the bounded acquire is confirmed not to have altered pixels.

20. On a setup with a **rotated display**, confirm it is captured natively and correctly. The `CAPTURO_TIMING=1` log should show a helper line for the rotated display (not a `desktopCapturer` fallback), reporting the rotated (portrait) dimensions. The captured image of that display must be upright and not mirrored — text reads left to right, window controls stay top-right. Running the helper standalone against the display's physical origin (`capturo-capture.exe --output test.png --origin-x <x> --origin-y <y>`) and opening the PNG is the quickest check. Only the 90/270 orientation matching the test hardware is exercised; 180 follows by symmetry.

21. **Persistent capture helper (D-017).** With `CAPTURO_TIMING=1`, confirm warm captures report `setup 0` and that the first capture after a reboot is not slow (the helper warms at launch). Then exercise its resilience:

    - **Display change mid-session.** Between two captures, rotate a monitor, change its resolution, or unplug/replug one, and confirm the next capture still produces a correct, correctly-sized overlay for it — the duplication is rebuilt on `DXGI_ERROR_ACCESS_LOST` rather than returning a black or stale frame. Lock the screen or trigger a UAC prompt, then capture again.
    - **Dead helper.** Kill `capturo-capture.exe` from Task Manager mid-session; the next capture must still succeed (respawn, or `desktopCapturer` fallback) and a helper should be running again afterwards.
    - **No orphan.** Quit Capturo (and separately, force-kill it) and confirm no `capturo-capture.exe` is left behind.
    - **Idle then capture.** Leave the app resident for a while on a static desktop, then capture, and confirm it shows the current desktop, not a stale frame.

22. **GIF capture (D-018/D-023).** From the tray **New GIF** or the GIF shortcut, drag a region and press **Start Recording**. With **Frame count** enabled, confirm the emphasis chrome: a red border ring around the region, everything outside it dimmed, and a control bar with a live timer and frame counter — none of which are focus-stealing (the region stays interactive) and none of which trip Do Not Disturb. Record a few seconds of motion including moving the mouse, use **Pause/Resume**, then press **Stop**. Confirm all protected recording chrome disappears and one normal GIF preview window opens instead of a Save As dialog.

    Confirm the animation loops in the preview and scales to fit when the window is resized. Before saving, **Open folder** must be disabled. Cancel a Save dialog and confirm the preview remains usable; then save successfully, confirm the preview still remains open, its full path appears, and **Open folder** reveals the file in Explorer. `Ctrl/Cmd+S` must match Save, `Ctrl/Cmd+C` must match Copy, and Escape must discard the preview. Retake must clear the old preview and return to fresh region selection; closing or Discarding an unsaved preview must not create a GIF file.

    On Windows, use Copy before Save, close the preview, and paste into Explorer or another file-aware target. The pasted item must be an animated `.gif`, not a static bitmap, and it must remain available after preview teardown. Repeat Copy after Save and confirm the saved file is the clipboard item. Capturo may create `%TEMP%\Capturo\Clipboard\Capturo *.gif` only for an explicit unsaved Copy; files older than 24 hours are eligible for cleanup on a later launch. Check that arbitrary files in that directory are never removed.

    Open the saved `.gif` and confirm: it plays and loops; the **mouse cursor is present**; it contains only the region (no border, no shade, no control bar — the chrome is content-protected); and the file is reasonably small (static content should be well under a megabyte). Try low vs high **quality** and **FPS** in Settings → GIF and confirm the size/smoothness trade-off. Recording chrome cannot be seen in a screenshot tool (content protection hides it from all capture), so this step must be done by eye. On Windows, watch the instant **Start Recording** is pressed: only the thin red ring may outline the selected region. No grey horizontal bands or system-coloured border may flash or remain along the top, bottom, or control bar (D-021).

    Verify timing at **10, 15, 20, and 30 fps**, with special emphasis on 30 fps and a large region. Record a visible stopwatch or other known-duration motion for at least 10 active seconds. The saved GIF's total duration should match the control-bar active timer to GIF's 10 ms precision; it must not speed up when the renderer misses sampling deadlines. Pause for several seconds and resume: the paused wall-clock span must be absent, while the active motion before and after the pause remains correctly timed. Stop between sampling ticks and confirm the last visible frame is held through the Stop time rather than being shortened to a nominal frame.

    In Settings → GIF, test pre-timers of **0, 3, and 10 seconds**. At 3 and 10, the protected control bar must show every countdown number, Pause and Stop must remain disabled, Cancel must work, and the active timer/frame count must not begin until zero. The first captured frame should show the desktop state at zero, with no countdown chrome and no setup motion in the GIF. At 0, active recording must begin immediately. For `CAPTURO_GIF_RECORD_SMOKE`, the hard-coded pre-timer is 0 so its ~3-second output remains a ~3-second active recording.

    Toggle **Frame count** off in GIF Settings. The recording timer and controls must remain visible, but sampled/skipped counts and processed/ready/encoded totals must never appear; Finalizing and Saving remain visible through the timer/status field. Turn the toggle back on and confirm all existing counts return. The setting must persist across restart and must not change the recorded GIF's duration, frame processing, or bytes.

    Stress backpressure with a large region at **30 fps / 70% quality** for at least 30 seconds. If the worker cannot keep up, the control bar must report skipped ticks rather than becoming unresponsive or accumulating unchecked memory. Stop must switch to `Finalizing…`, show processed/total progress for no more than the two-frame bounded tail, then switch to `Opening preview…`. The previewed and saved GIF duration must still match active wall time even when ticks were skipped. Record the sampled count, skipped count, Stop-to-preview time, output size, region dimensions, and peak process memory so future encoder changes can be compared against the same baseline.

    For pipeline-only automation, `CAPTURO_GIF_RECORD_SMOKE=1` records a fixed centre region for ~3 s and writes `%TEMP%\capturo-smoke.gif` with no dialog; opening that file confirms the record → encode → save path and the crop. `CAPTURO_GIF_PREVIEW_ON_START=1` then opens that file directly in the development preview for repeatable visual and action checks; pair it with `CAPTURO_GIF_PREVIEW_SCREENSHOT=1` to write `%TEMP%\capturo-gif-preview-smoke.png` after rendering. For documentation or layout checks, `CAPTURO_SETTINGS_ON_START=1` plus `CAPTURO_SETTINGS_SCREENSHOT=1` opens the real Settings renderer; `CAPTURO_SETTINGS_SCREENSHOT_TAB=global|capture|gif` selects the tab (GIF by default), and `CAPTURO_SETTINGS_CHECK_UPDATES=1` exercises the packaged manual update check before capture.

The 2026-08-04 passes covered scaled DPI, multi-display claim, pen rendering, exact-dimension clipboard export, lifecycle teardown, text entry, object manipulation, crop/annotation independence, step borders and sizing, contextual-toolbar ordering, paint-gated presentation, and the raster tray asset path on Windows 11.

## macOS desktop matrix

In addition to the common matrix:

1. Test both Intel and Apple Silicon when available.
2. Verify first-run Screen Recording permission, denial guidance, System Settings link, and behavior after permission is granted.
3. Verify Retina exports match the dimension label and contain no scaling blur.
4. Verify menu-bar click, `Cmd + Shift + 2`, `Cmd+C`, `Cmd+S`, Spaces, and fullscreen applications.
5. Verify the app has no Dock icon while resident.

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
