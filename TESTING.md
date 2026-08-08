# Testing

## Automated checks

Run the complete non-GUI gate with:

```powershell
npm run build
```

This performs strict type checking, Vitest geometry tests, and a production build of main, preload, and renderer targets. Geometry tests cover reverse selection drags, movement clamping, minimum resize size, handle priority, cardinal locking, and 45-degree locking.

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
7. Apply blur and pixelate over fine text and confirm the exported image - not only the preview - contains the effect.
8. Verify `Ctrl+C`, `Ctrl+S`, toolbar Copy, toolbar Save, Undo, and Escape.
9. Confirm copy, save, and cancel remove overlay renderers but leave the tray process alive.
10. With Select active, click every annotation type, drag it, resize all eight handles, change each applicable property, and press Delete.
11. Move the crop frame after placing annotations and confirm the crop moves while annotations stay at their original desktop coordinates.
12. Type new text, commit with `Ctrl+Enter`, edit it by double-clicking with Select, and verify text in the exported PNG.
13. Inspect the 16 px Windows tray mark on both light and dark taskbars; an empty but clickable slot is a failure.
14. Confirm the contextual color/type/stroke controls appear below the primary tool row for every applicable tool and selected object.
15. Drag the stroke slider from one end to the other and confirm the `px` readout tracks it, that the drawn size changes while dragging rather than only on release, and that the extremes are usable. Repeat for the numbered-step slider, placing markers at the smallest and largest sizes. Then select each existing object with the Select tool and confirm the slider moves to that object's size instead of resetting to the default, and that dragging it restyles the selected object.
16. Record capture invocation at 60 fps from both the tray and hotkey. No unpainted black/background frame may appear before the frozen desktop overlay, and the overlay must arrive as a single hard cut with no zoom or cross-fade.

    Measure geometric motion, not brightness. A window-open animation scales the same desktop image, so average luminance stays flat while the animation is clearly visible; an average-luminance check will pass a broken build. Difference consecutive frames instead:

    ```powershell
    ffmpeg -i capture.mkv -vf "tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=signal.txt" -f null -
    ```

    Count consecutive frames whose difference exceeds the noise floor. One or two frames is a correct hard cut. A run of ten or more, especially one that decays smoothly toward zero, is an animation. The `file=` argument must be a bare relative filename, because `ffmpeg` treats `:` in a filter argument as an option separator.

17. Right-click the tray and open **Settings…**. Confirm it opens once and refocuses rather than stacking a second window when reopened, that closing it leaves the tray process resident, and that the **Capture** and **GIF** tabs switch (GIF shows only the placeholder).

18. Exercise each capture setting and confirm it persists across an app restart (the values live in `settings.json` under the user-data folder):

    - **Notification.** Turn it off, capture and copy, and confirm no toast appears; turn it on and confirm it returns.
    - **Format and quality.** Set JPEG at a low quality and Save: the file is a `.jpg`, decodes correctly, and is visibly smaller than a PNG of the same region. Switch back to PNG and confirm Save writes a `.png`. In both cases, Copy still places a lossless bitmap on the clipboard, and the JPEG quality slider is inactive while PNG is selected. Also type an explicit `.png` extension into the dialog while JPEG is the setting, and confirm the written bytes match the extension you chose.
    - **Shortcut rebind.** Record a new combination (e.g. `Ctrl+Shift+4`): the new chord starts capture, the old one no longer does, and the tray tooltip and menu label both show the new binding. Then try a combination already owned by another app and confirm the settings window reports it and keeps the previous shortcut. Restart and confirm the last accepted shortcut is still bound.

19. Measure invocation latency with `CAPTURO_TIMING=1`. Run capture from both a **static** desktop (no animated wallpaper or moving content) and a busy one, and read the per-capture stderr summary — total frame-grab time, the helper's own `setup`/`acquire`/`convert`/`encode` breakdown, and overlays-loaded time. The static-desktop `acquire` must be bounded (no multi-hundred-millisecond stall), and the overlay must appear with no perceptible delay. This is also where the native-helper acquire change is re-verified for behaviour: on a static screen the capture must still contain the live desktop, not a black or stale frame. Pair it with the HDR known-pattern check under [DECISIONS.md](./DECISIONS.md) D-015 — the greys `0/32/64/96/128/160/192/255` must round-trip exactly — so the bounded acquire is confirmed not to have altered pixels.

20. On a setup with a **rotated display**, confirm it is captured natively and correctly. The `CAPTURO_TIMING=1` log should show a helper line for the rotated display (not a `desktopCapturer` fallback), reporting the rotated (portrait) dimensions. The captured image of that display must be upright and not mirrored — text reads left to right, window controls stay top-right. Running the helper standalone against the display's physical origin (`capturo-capture.exe --output test.png --origin-x <x> --origin-y <y>`) and opening the PNG is the quickest check. Only the 90/270 orientation matching the test hardware is exercised; 180 follows by symmetry.

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
