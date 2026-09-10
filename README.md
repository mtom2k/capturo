<p align="center">
  <img src="./build/icon.png" alt="Capturo logo" width="160">
</p>

# 📸 Capturo

Capturo is a fast, local screenshot and GIF tool. It lives in the notification area or menu bar, opens straight into region selection, and gets out of the way when you finish. There is no dashboard, account, cloud storage, telemetry, or history database.

![version](https://img.shields.io/badge/version-0.41.0-blue)
![platform](https://img.shields.io/badge/Windows-supported-brightgreen)
![macOS](https://img.shields.io/badge/macOS-preview-orange)
![license](https://img.shields.io/badge/license-MIT-green)

> 🪟 **Windows 11 is the supported platform.** Windows packages are the supported downloads.
>
> 🍎 **macOS runs but is unsupported.** Capture, the menu-bar flow, settings, permissions, and
> start-at-login all work on Apple Silicon (verified on macOS 26.2), and an Apple Silicon build is
> attached to v0.22.3 as an unsupported preview — but Capturo has no Apple Developer ID certificate,
> so it cannot be
> notarized and Gatekeeper refuses it after download. Running it takes a manual quarantine removal,
> and the Screen Recording grant lapses on every upgrade. See [macOS](#-macos) below.

![Selecting a region](./docs/selection.png)

## ⬇️ Download

Download the current packages from [GitHub Releases](https://github.com/mtom2k/capturo/releases/latest).

| Artifact | Purpose |
| --- | --- |
| `Capturo-Setup-<version>-x64.exe` | Interactive Windows installer, published with each release |
| `Capturo-Portable-<version>-x64.exe` | Portable build, no install, published alongside the installer |
| `Capturo-<version>-arm64.dmg` | Unsupported Apple Silicon macOS preview disk image |
| `Capturo-<version>-arm64-mac.zip` | Unsupported Apple Silicon macOS preview archive |

The 0.22.3 release publishes all four artifacts. Local copies are kept in `release/`, and
`BUILD-INFO.txt` records their sizes and SHA-256 hashes. A local rebuild will not reproduce a
release's checksums: electron-builder embeds build timestamps, so packaging is not byte-reproducible
and a differing digest is not evidence of a source difference.

Source is **0.41.0**, prepared as a new Windows x64 Setup and Portable release draft with Pin to desktop.
The older 0.40.0 GitHub release draft is separate; local packages and drafts are not offered by the
in-app update checker. No 0.41.0 macOS package was produced by this Windows build. Windows x64 remains the only supported
platform — see [macOS](#-macos) before downloading an older preview.

Windows may show an unknown-publisher warning because current builds are not Authenticode-signed. Choose **More info**, then **Run anyway** if you trust the downloaded checksum.

Version 0.41.0 adds independent pinned screenshots with always-on-top, move/resize, adjustable
opacity, and original-resolution Copy. Version 0.40.0 adds persistent, automatically wrapping text boxes with directional resize handles,
separates numbered-step sizing from shape stroke width, and renders editable text and shapes at
display resolution in Full Tab. Tools and formatting stay in a fixed top dock above the capture
when resizing or zooming. It also includes the local 0.31.1 improvement that makes the live
**Color Picker** responsive under high-rate mouse input by bounding
preview sampling work and drawing each sampled grid as a single bitmap. Exact click sampling remains
uncapped. Version 0.31.0 adds direction-free **Panoramic Scrolling** on Windows and macOS, a live captured-area
miniature with unique-coverage tracking, an outline marking the viewport being followed, and
zoom/pan controls in Full Tab. Your mouse pointer stays visible throughout and is kept out of the
stitched image rather than hidden from you. It also hardens HDR capture: the SDR white level the
whole frame is divided by is retried and falls back to the last measured value rather than a
guess, and a capture that cannot use the HDR-aware path now says so instead of quietly producing a
washed, over-saturated image. Version 0.22.3 makes
Color Picker a live, transparent tool: invoking it no longer freezes,
tints, blurs, or blacks out the screen—including paused and playing browser video—and its Windows
samples retain Capturo's HDR-aware color conversion. It also fixes Color Picker startup in local
macOS builds, where an Electron screen-conversion API available in the type definitions was absent
at runtime. Version
0.22.2 adds a normal full editor window that frees the desktop after region selection, and includes
the 0.22.1 HDR correction that preserves RGB channel ratios when bright FP16 pixels are mapped into
an SDR image. Version 0.22.0 adds local macOS Copy text and the screen color picker introduced in
0.21.0.

## 🍎 macOS

macOS support is real but unfinished, and the gap is a certificate rather than code.

**Working**, verified on macOS 26.2 (Apple Silicon): menu-bar icon opens capture on a single click,
the overlay covers the whole display including the menu bar and the Dock, `Esc` cancels immediately,
region selection and annotation, save, clipboard copy, GIF recording and preview, GIF copy as an
animated file, the live Color Picker and its clipboard/result flow, Screen Recording permission
handling in Settings, and Open on startup. Panoramic Scrolling is now available on macOS too; it
shares the display-media path GIF recording already uses there, and has not yet had the same amount
of real-hardware testing it has had on Windows.

**Copy text** works on both platforms, through each system's own local recognizer: Windows OCR on
Windows and Apple's Vision framework on macOS. Neither uploads the image or downloads a model.

**Not available on macOS:** HDR-correct capture, which depends on the Windows helper's FP16
pipeline; macOS falls back to Electron's `desktopCapturer`.

**Permissions.** Only one is required — **Screen Recording**, which covers screenshots and GIF alike.
Notifications and Login Items are optional and only appear if you use those features. Capturo
declares no camera, microphone, or Bluetooth usage and cannot capture audio.

macOS applies a new Screen Recording grant only to a newly launched app, so Capturo offers a
**Reopen Capturo** button wherever it asks for the permission. Settings also keeps a **Manage
Permissions** button on the Screen recording row in every state, granted included, so the Screen
Recording pane is always one click away when you want to review or revoke the grant.

**About the macOS download.** An Apple Silicon `.dmg` and `.zip` are attached to the
[v0.22.3 release](https://github.com/mtom2k/capturo/releases/tag/v0.22.3), but macOS is **not a
supported platform** and these builds are ad-hoc signed rather than notarized. Distribution properly
needs an Apple Developer ID certificate, and without one there are two consequences: Gatekeeper
refuses the app after download with *"Capturo is damaged and can't be opened"* — its response to an
un-notarized download, not a corrupted file — and macOS ties the Screen Recording grant to the
build's own code hash, so the permission has to be granted again after every upgrade. Local
development can avoid the second one with a self-signed certificate; see
[RELEASING.md](./RELEASING.md).

Build it yourself with `npm run dist:mac`. Arm64 only unless you ask for `--x64` or `--universal`.

## ✨ What Capturo can do

- Select, move, and resize a precise screen region on scaled or multi-display desktops.
- Build long two-dimensional screenshots on Windows with **Panoramic Scrolling**, moving up, down,
  left, or right while Capturo maps only newly revealed pixels.
- Draw with Pen, Highlighter, Line, Arrow, Rectangle, Ellipse, numbered Step, and Text tools.
- Pin a screenshot above other windows as a movable, resizable reference with adjustable opacity
  and original-resolution Copy.
- Highlight with a vivid translucent marker stroke that remains visible on both light and dark
  captures while the marked content stays readable. Hold **Shift** or **Ctrl** to run it straight
  along a line of text.
- Add Blur and Pixelate regions with independent 1 to 100 percent intensity.
- Remove a connected background color with tolerance, feathering, live Before/After/Split preview, and Undo.
- Extract visible text with local OCR and copy it as plain text — Windows OCR on Windows, Apple's Vision framework on macOS.
- Pick a live color from anywhere on screen without freezing or tinting the desktop; the magnifier
  replaces the cursor, copies on the spot, and opens HEX, RGB, and HSL controls.
- Record a GIF with a configurable pre-timer, frame rate, quality, pause/resume, and protected recording controls.
- Review GIFs before export, then Copy, Save, Open folder, Retake, or Discard.
- Capture HDR displays through a native Windows helper without washed-out SDR content or discolored HDR highlights (Windows only).
- Save PNG or JPEG files, copy a lossless image, and bind screenshot, GIF, and color picker to any
  Electron-supported non-modifier key or key combination—including bare **Print Screen**.
- Start at login on Windows or macOS, and check GitHub Releases for updates when you choose.

## 🖼️ Screenshot workflow

1. Click the Capturo tray or menu-bar icon, or press `Ctrl/Cmd + Shift + 7`.
2. Drag a region. Move it from inside, or resize it from an edge or corner.
3. Annotate or apply privacy and transparency tools.
4. Copy the image, copy its visible text, save it, or choose **Open in full tab** to move it into a
   normal editor window and return the rest of the screen to your work.

![Annotating a capture](./docs/annotate.png)

The primary toolbar stays close to the selection. A second row appears only when the active tool needs options such as color, stroke width, text style, or effect intensity.

**Open in full tab** is the cyan action between **Copy text** and **Save**. It checkpoints the
current visible selection, including annotations and transparency, closes the full-screen overlay,
and opens a resizable, minimizable window with the same editing and export tools. That window stays
available if you start another capture. Capturo keeps one full editor at a time and focuses it
rather than replacing unsaved work. The overlay closes only after the full editor has decoded and
become visible; a failed hidden startup is discarded instead of blocking the next attempt.
The Full Tab toolbar includes zoom-out, percentage/Fit, and zoom-in controls. `Ctrl/Cmd++`,
`Ctrl/Cmd+-`, and `Ctrl/Cmd+0` provide the same actions; Ctrl/Cmd-wheel zooms around the pointer and
an ordinary wheel pans when the image is larger than the editor workspace.

Full Tab keeps the toolbar and format row in a fixed top dock with space reserved below for the
image. Resizing, maximizing, zooming, and panning do not move the tools beside or below the capture.
Editable annotations render at the display's pixel density for sharp text and shapes while zooming.
The screenshot itself (including edits already flattened before opening Full Tab) retains its
original bitmap detail. Copy and Save keep the original image dimensions.

### Pin to desktop

Choose the **Pin** button beside Open in full tab to keep the selected, annotated image above
other windows. Pinning from the capture overlay returns you to the desktop; pinning from Full Tab
leaves the editor open. Each pin is a separate snapshot, so later edits do not change it.

Drag the image or header to move the pin and drag a window edge/corner to resize it. The image
keeps its proportions. Use **Opacity** (25–100%) to see through it. **Copy** or `Ctrl/Cmd+C`
copies the original-resolution image regardless of the window's size or opacity. **×** or `Esc`
closes the focused pin. Several pins can stay open while you start another capture.

Pins are temporary and stay in memory; closing them or quitting Capturo discards them. They are
ordinary visible desktop content and can appear in later screenshots. Up to eight pins are allowed,
subject to image-memory limits. Pinning is included in 0.41.0.

### Panoramic Scrolling

On Windows, select the visible viewport you want to extend and choose the amber **Panoramic
Scrolling** action. Capturo returns immediately to the live application, and a thin cyan outline
stays around the selected viewport so you can see exactly what is being captured; it sits just
outside those pixels and never appears in the image. Move through the content
at a moderate pace in any cardinal direction—up, down, left, or right—and
change direction whenever needed. The compact bar outside the captured pixels shows a miniature
mosaic of everything captured so far; its cyan rectangle marks the current viewport. Choose
**Finish** to open the PNG in Full Tab. Leave at least 66 screen pixels above or below the viewport
so Capturo can keep the bar and preview outside the image.

Panoramic Scrolling is user-driven so it works with browsers, document viewers, remote desktops, and
custom applications rather than only controls that expose an automation scroll API. It matches
overlapping pixels, checks candidate movement against the captured mosaic, and subtracts every
already-captured rectangle before retaining new pixels. Retracing therefore moves the preview
viewport without duplicating content. Short-lived content along an edge is provisional until a
later clean frame confirms it. Your mouse pointer stays visible the whole time and keeps working
normally; Capturo tracks its footprint and fills those pixels from another observation rather than
baking a cursor into the image. Move one cardinal direction at a time: diagonal motion, animated
content, large sticky regions, or moving too far between samples may not provide a safe match;
Capturo asks you to pause or retrace the missed area instead of guessing. Two-dimensional routes can leave transparent uncaptured space inside the
final bounds, so panoramic output remains PNG. Existing frozen annotations are not included.
Output is capped at 30,000 pixels on either axis and 120 million pixels. Panoramic Scrolling runs on
Windows and on macOS; it uses the same live display-media stream and out-of-crop control bar that GIF
recording already uses on both. On macOS the bar is placed inside the work area rather than over the
menu bar or the Dock, because AppKit would otherwise slide it back into the visible frame — and a
capturable bar that moves into the selected viewport would be stitched into the image. Where a region
leaves no room outside it, Capturo declines to start rather than record its own chrome.

Text wraps automatically to its box width, including after placement and in the exported image.
Click away or press `Ctrl/Cmd+Enter` to place it; `Esc` discards the edit, and a second `Esc`
cancels the capture. Drag any of the eight edge/corner handles to resize the box. An edge moves
only that side; resizing reflows text without changing its font size. Use the font-size menu to
change lettering size. With Select, resize placed text directly or double-click to edit its contents
in the same box. Text outside a box made too short is clipped; enlarge its height to reveal it.

Numbered steps keep their own Size setting. Their white border and selection bounds are independent
of the Pen, Rectangle, and Ellipse stroke widths.

### Copy text

**Copy text** sits beside regular Copy. It recognizes the final visible selection, including its crop, annotations, Blur or Pixelate regions, and any pending transparency preview. Successful recognition copies plain text and closes the editor. Empty or failed recognition leaves the editor open with a useful message.

Recognition runs locally on both platforms and never leaves the machine: Capturo does not upload the image, download a model, or create a temporary screenshot. On Windows it uses the OCR language packs installed for the current user, so a missing language is something you may need to add. On macOS it uses Apple's Vision framework, whose recognition languages ship with the operating system, so there is nothing to install. Either way OCR can confuse small, stylized, rotated, low-contrast, or obscured characters, so review important results.

### Transparent backgrounds

Choose **Transparent background** or press `K`, then sample the background inside the selection. Capturo removes only matching pixels connected to that point, which protects separated foreground areas that happen to share the same color.

Tolerance includes nearby tones, and Edge feather smooths the cutout from 0 to 10 pixels. You can also enter hex or RGB values and compare Before, After, or Split views. Copy and Save automatically apply a pending preview. Any transparency operation forces PNG because JPEG cannot store alpha.

## 🎬 GIF recording

Choose **New GIF** from the tray or menu bar, or press `Ctrl/Cmd + Shift + 8`. Select a region, then press **Start Recording**. Capturo prepares the live stream and shows a protected countdown, 3 seconds by default, before active capture begins.

The recording bar supports Pause, Resume, Stop, a timer, and optional frame totals. Its red border, dimmed surroundings, and controls are excluded from the finished GIF. Playback timing follows real elapsed recording time, and encoder backpressure keeps memory bounded when a large region cannot sustain the requested frame rate.

![Finished GIF preview](./docs/gif-preview.png)

The preview lets you Copy, Save, Open folder, Retake, or Discard. Copy places the animated `.gif` *file* on the clipboard rather than flattening it to a still image, on Windows through `CF_HDROP` and on macOS through a `public.file-url` pasteboard entry, so the animation survives the paste. An unsaved GIF is written to Capturo's temporary clipboard folder only after you explicitly choose Copy, and expired copies are cleaned during a later launch.

## 🖍️ Highlighter

The Highlighter sits directly right of the Pen (`H`) and lays a bright translucent marker colour
over the image. It is deliberately much stronger than the former dark-only blend, so red, amber,
green, blue, violet, white, and black remain visibly distinct on dark interfaces as well as light
pages while the content underneath remains readable.

Every annotation color works, **Shift** or **Ctrl** locks the stroke straight for running along a
line of text, and it carries its own Size range separate from the Pen's, wide enough to cover a
line of text. A stroke that crosses itself stays one even tone rather than building up at the
crossing.

## 🎨 Color picker

**Color picker** in the tray menu, or `Ctrl/Cmd+Shift+9`, opens immediately without freezing or
tinting the desktop and replaces your mouse cursor with a magnifier centred on the live pixel it is
reading: a wide surrounding-pixel view by default, the sampled one
outlined in the middle of the aperture, and its hex value below. The arrow keys nudge exactly one
pixel. Click, `Enter`,
or `Space` picks; `Esc` cancels. No instruction popup covers the screen when the picker opens, and
the magnifier remains visible through long precision sweeps.

Use the **mouse wheel** over the picker for five-step magnification. It starts at the widest view;
scroll up to magnify and down to zoom out. Tighter views automatically slow the owned selector, so
precise picking is controlled entirely by the selected zoom level. Shift does not change picker
movement. The tightest level is also velocity-limited, so a fast physical sweep cannot make the
sample race across the screen; on Windows the system cursor remains hidden even if it briefly
outruns the compact picker surface. Capturo keeps zoom state out of the readout so only the hex is
shown.

**Picking copies the color straight to your clipboard**, in whichever format you choose under
Settings → Color picker, where the shortcut is rebindable and automatic copying can be turned off
entirely. The color window then shows the value as HEX, RGB, or HSL with live hue, saturation, lightness and
alpha sliders, a row of related colors, and the nearest color name. Type a hex value to jump to one
directly, copy again in another format with `Ctrl/Cmd+C`, or use **Pick again** to go back to the
screen without losing the color you already have. The window gets out of the way while you pick, so
you can sample the pixels it was covering.

The screen stays live while the picker is open, so video, animation, and changing application UI
can be sampled directly. On Windows the same HDR-aware conversion used for screenshots supplies the
magnifier without painting a screenshot over the desktop.

## ⌨️ Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl/Cmd + Shift + 7` | Start screenshot capture |
| `Ctrl/Cmd + Shift + 8` | Start GIF capture |
| `Ctrl/Cmd + Shift + 9` | Pick a color from the screen |
| `Ctrl/Cmd + C` | Copy image |
| `Ctrl/Cmd + Shift + C` | Extract and copy visible text |
| `Ctrl/Cmd + S` | Save |
| `Ctrl/Cmd + Z` | Undo |
| `Delete` | Delete selected annotation |
| `Ctrl/Cmd + Enter` | Place the text being typed |
| `Esc` | Discard the text being typed, otherwise cancel capture or close GIF preview |

Tool keys: `V` Select, `P` Pen, `H` Highlight, `L` Line, `A` Arrow, `R` Rectangle, `E` Ellipse, `N` Step, `T` Text, `B` Blur, `X` Pixelate, and `K` Transparent background.

## ⚙️ Settings

Right-click the tray icon and choose **Settings**.

- **Global:** Open on startup, optional daily update checks, and manual Check for updates.
- **Capture:** PNG or JPEG, JPEG quality, copy/save notifications, and capture shortcut.
- **GIF:** 10 to 30 fps, quality, 0 to 10 second pre-timer, frame-count visibility, and GIF shortcut.
- **Color picker:** the picker shortcut, whether picking copies to the clipboard on its own, and which format it copies.

All three shortcut recorders accept a key by itself as well as a modified chord. Letters, digits,
punctuation, arrows, lock/media/numpad keys, Escape, function keys, and **Print Screen** are valid
choices. A bare key is global and can therefore replace that key's normal behavior while Capturo is
running. Capturo attempts the exact binding; if the operating system exclusively owns it or another
application already registered it, the OS can still refuse it and Capturo keeps the previous
working shortcut instead of displaying a binding that does nothing.

Preferences live in `settings.json` under Capturo's user-data folder. The file contains options and the last update-check time, never captured pixels.

![Global settings](./docs/global-settings.png)

## 🔒 Privacy

- No account, login, telemetry, analytics, or crash reporting.
- Captures and OCR pixels stay local.
- The only optional network request checks Capturo's public GitHub Release version. It sends no account token, device identifier, capture, or settings data, and never downloads an update.
- Screenshot pixels reach disk only when you Save. The one exception is an unsaved GIF that you explicitly Copy, because the Windows clipboard carries its file path.
- Renderers use sandboxing, context isolation, and no Node.js access. Native actions pass through narrow IPC handlers owned by the main process.

## ⚠️ Current limits

- A selection stays on one physical display and cannot span monitors.
- A drag must start in the work area, although it can continue over the taskbar.
- OCR quality depends on the source image, and on Windows also on the installed language packs. Recognized text is plain text, not document layout, and the two platforms group lines slightly differently.
- Windows packages are unsigned and may trigger SmartScreen.
- macOS is unsupported. Capture itself works — it was verified end to end on macOS 26.2 — but the
  builds are ad-hoc signed rather than notarized, so Gatekeeper refuses them after download and the
  Screen Recording grant lapses on every upgrade. Support needs an Apple Developer ID certificate,
  not more code. See [RELEASING.md](./RELEASING.md).
## 🛠️ Build from source

Capturo needs Node.js 20 or newer.

```powershell
git clone https://github.com/mtom2k/capturo.git
cd capturo
npm install
npm run dev
```

Useful commands:

```powershell
npm run icons      # regenerate every brand asset from build/icon-source.png
npm run build      # typecheck, run tests, and build the production app
npm run dist:win   # build Windows Setup and Portable artifacts into release/
npm run dist:mac   # build macOS DMG and ZIP into release/ (run on macOS)
```

Each platform has a small native helper for the things Electron cannot reach itself.

HDR capture, local OCR, GIF file copy, and recording-window styling use `native/capturo-capture` on
Windows. Build it with the Visual Studio **Desktop development with C++** workload and Windows SDK:

```powershell
native\capturo-capture\build.cmd
```

macOS needs a helper for text recognition alone, since its captures come from `desktopCapturer` and
its clipboard from Electron. `npm run dist:mac` builds it automatically; to build it on its own:

```bash
npm run ocr:mac
```

It needs only the Xcode Command Line Tools (`xcode-select --install`) and links against Vision,
which ships with macOS. Each helper is scoped to its own target, so neither build carries the
other's binary, and a macOS build simply goes without HDR-correct capture.

Capturo is one codebase, not a fork per platform. Platform differences are decided in the main
process and handed to the renderers as data, and platform-varying logic is written as pure
functions with a platform flag so both branches are unit-tested on any machine. See
[ARCHITECTURE.md](./ARCHITECTURE.md).

## 📚 Developer documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) explains process boundaries and data flow.
- [DECISIONS.md](./DECISIONS.md) records durable design choices.
- [PROJECT_STATE.md](./PROJECT_STATE.md) tracks verified behavior and remaining work.
- [HANDOFF.md](./HANDOFF.md) is the shortest path for the next developer or LLM.
- [TESTING.md](./TESTING.md) contains automated and desktop test matrices.
- [CONTRIBUTING.md](./CONTRIBUTING.md), [RELEASING.md](./RELEASING.md), and [CHANGELOG.md](./CHANGELOG.md) cover maintenance and releases.

## 📄 License

MIT. See [LICENSE](./LICENSE).
