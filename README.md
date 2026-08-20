<p align="center">
  <img src="./build/icon.png" alt="Capturo logo" width="160">
</p>

# 📸 Capturo

Capturo is a fast, local screenshot and GIF tool. It lives in the notification area or menu bar, opens straight into region selection, and gets out of the way when you finish. There is no dashboard, account, cloud storage, telemetry, or history database.

![version](https://img.shields.io/badge/version-0.20.0-blue)
![platform](https://img.shields.io/badge/Windows-supported-brightgreen)
![macOS](https://img.shields.io/badge/macOS-preview-orange)
![license](https://img.shields.io/badge/license-MIT-green)

> 🪟 **Windows 11 is the supported platform.** It is the only one with published packages.
>
> 🍎 **macOS runs but is unsupported.** Capture, the menu-bar flow, settings, permissions, and
> start-at-login all work on Apple Silicon (verified on macOS 26.2), and a universal build is
> attached to v0.20.0 — but Capturo has no Apple Developer ID certificate, so it cannot be
> notarized and Gatekeeper refuses it after download. Running it takes a manual quarantine removal,
> and the Screen Recording grant lapses on every upgrade. See [macOS](#-macos) below.

![Selecting a region](./docs/selection.png)

## ⬇️ Download

Download the Windows installer from [GitHub Releases](https://github.com/mtom2k/capturo/releases/latest).

| Artifact | Purpose |
| --- | --- |
| `Capturo-Setup-<version>-x64.exe` | Interactive Windows installer, published with each release |
| `Capturo-Portable-<version>-x64.exe` | Portable build, no install, published alongside the installer |

Releases publish both artifacts. Local copies are kept in `release/`, and `BUILD-INFO.txt` records their sizes and SHA-256 hashes. A local rebuild will not reproduce a release's checksums: electron-builder embeds build timestamps, so packaging is not byte-reproducible and a differing digest is not evidence of a source difference.

Source is at **0.21.0**, prepared as a draft; the newest *published* release is **0.20.0**, since a stable release is cut only after its Windows installer passes acceptance. A universal macOS build is attached to 0.20.0 but macOS is not supported — see [macOS](#-macos).

Windows may show an unknown-publisher warning because current builds are not Authenticode-signed. Choose **More info**, then **Run anyway** if you trust the downloaded checksum.

Version 0.21.0 adds the Highlighter and the screen color picker. Version 0.20.0 introduced the rounded-card "C" logo shown above, applied across the installer, executable, Settings window, taskbar, notification area, and notifications. Its delivered backdrop is keyed out so the icon has transparent corners, and the macOS menu bar gets a monochrome version that follows the system bar. Version 0.19.0 made macOS a working preview.

## 🍎 macOS

macOS support is real but unfinished, and the gap is a certificate rather than code.

**Working**, verified on macOS 26.2 (Apple Silicon): menu-bar icon opens capture on a single click,
the overlay covers the whole display including the menu bar and the Dock, `Esc` cancels immediately,
region selection and annotation, save, clipboard copy, GIF recording and preview, GIF copy as an
animated file, Screen Recording permission flow in Settings, and Open on startup.

**Copy text** works on both platforms, through each system's own local recognizer: Windows OCR on
Windows and Apple's Vision framework on macOS. Neither uploads the image or downloads a model.

**Not available on macOS:** HDR-correct capture, which depends on the Windows helper's FP16
pipeline; macOS falls back to Electron's `desktopCapturer`.

**Permissions.** Only one is required — **Screen Recording**, which covers screenshots and GIF alike.
Notifications and Login Items are optional and only appear if you use those features. Capturo
declares no camera, microphone, or Bluetooth usage and cannot capture audio.

macOS applies a new Screen Recording grant only to a newly launched app, so Capturo offers a
**Reopen Capturo** button wherever it asks for the permission.

**About the macOS download.** A universal `.dmg` and `.zip` are attached to the
[v0.20.0 release](https://github.com/mtom2k/capturo/releases/tag/v0.20.0), but macOS is **not a
supported platform** and those builds are ad-hoc signed rather than notarized. Distribution properly
needs an Apple Developer ID certificate, and without one there are two consequences: Gatekeeper
refuses the app after download with *"Capturo is damaged and can't be opened"* — its response to an
un-notarized download, not a corrupted file — and macOS ties the Screen Recording grant to the
build's own code hash, so the permission has to be granted again after every upgrade. Local
development can avoid the second one with a self-signed certificate; see
[RELEASING.md](./RELEASING.md).

Build it yourself with `npm run dist:mac`. Arm64 only unless you ask for `--x64` or `--universal`.

## ✨ What Capturo can do

- Select, move, and resize a precise screen region on scaled or multi-display desktops.
- Draw with Pen, Highlighter, Line, Arrow, Rectangle, Ellipse, numbered Step, and Text tools.
- Highlight without covering: the stroke multiplies into the image, so text underneath stays
  readable. Hold **Shift** or **Ctrl** to run it straight along a line of text.
- Add Blur and Pixelate regions with independent 1 to 100 percent intensity.
- Remove a connected background color with tolerance, feathering, live Before/After/Split preview, and Undo.
- Extract visible text with local OCR and copy it as plain text — Windows OCR on Windows, Apple's Vision framework on macOS.
- Pick a color from anywhere on screen with a magnifier that replaces the cursor, copied to the clipboard on the spot, then adjust it as HEX, RGB, or HSL.
- Record a GIF with a configurable pre-timer, frame rate, quality, pause/resume, and protected recording controls.
- Review GIFs before export, then Copy, Save, Open folder, Retake, or Discard.
- Capture HDR displays through a native Windows helper without washed-out SDR content (Windows only).
- Save PNG or JPEG files, copy a lossless image, and rebind the screenshot, GIF, and color picker shortcuts.
- Start at login on Windows or macOS, and check GitHub Releases for updates when you choose.

## 🖼️ Screenshot workflow

1. Click the Capturo tray or menu-bar icon, or press `Ctrl/Cmd + Shift + 2`.
2. Drag a region. Move it from inside, or resize it from an edge or corner.
3. Annotate or apply privacy and transparency tools.
4. Copy the image, copy its visible text, or save it.

![Annotating a capture](./docs/annotate.png)

The primary toolbar stays close to the selection. A second row appears only when the active tool needs options such as color, stroke width, text style, or effect intensity.

Text is placed by clicking away from the box or pressing `Ctrl/Cmd+Enter`; `Esc` discards it, and a second `Esc` cancels the capture. Drag the box's bottom-right corner to resize it, and double-click placed text with Select to edit it again.

### Copy text

**Copy text** sits beside regular Copy. It recognizes the final visible selection, including its crop, annotations, Blur or Pixelate regions, and any pending transparency preview. Successful recognition copies plain text and closes the editor. Empty or failed recognition leaves the editor open with a useful message.

Recognition runs locally on both platforms and never leaves the machine: Capturo does not upload the image, download a model, or create a temporary screenshot. On Windows it uses the OCR language packs installed for the current user, so a missing language is something you may need to add. On macOS it uses Apple's Vision framework, whose recognition languages ship with the operating system, so there is nothing to install. Either way OCR can confuse small, stylized, rotated, low-contrast, or obscured characters, so review important results.

### Transparent backgrounds

Choose **Transparent background** or press `K`, then sample the background inside the selection. Capturo removes only matching pixels connected to that point, which protects separated foreground areas that happen to share the same color.

Tolerance includes nearby tones, and Edge feather smooths the cutout from 0 to 10 pixels. You can also enter hex or RGB values and compare Before, After, or Split views. Copy and Save automatically apply a pending preview. Any transparency operation forces PNG because JPEG cannot store alpha.

## 🎬 GIF recording

Choose **New GIF** from the tray or menu bar, or press `Ctrl/Cmd + Shift + 3`. Select a region, then press **Start Recording**. Capturo prepares the live stream and shows a protected countdown, 3 seconds by default, before active capture begins.

The recording bar supports Pause, Resume, Stop, a timer, and optional frame totals. Its red border, dimmed surroundings, and controls are excluded from the finished GIF. Playback timing follows real elapsed recording time, and encoder backpressure keeps memory bounded when a large region cannot sustain the requested frame rate.

![Finished GIF preview](./docs/gif-preview.png)

The preview lets you Copy, Save, Open folder, Retake, or Discard. Copy places the animated `.gif` *file* on the clipboard rather than flattening it to a still image, on Windows through `CF_HDROP` and on macOS through a `public.file-url` pasteboard entry, so the animation survives the paste. An unsaved GIF is written to Capturo's temporary clipboard folder only after you explicitly choose Copy, and expired copies are cleaned during a later launch.

## 🖍️ Highlighter

The Highlighter sits directly right of the Pen (`H`) and **marks without covering**. Its stroke
multiplies into the image, so text underneath keeps its contrast and stays readable — unlike the
Pen, which paints over what it crosses.

Every annotation color works, **Shift** or **Ctrl** locks the stroke straight for running along a
line of text, and it carries its own Size range separate from the Pen's, wide enough to cover a
line of text. A stroke that crosses itself stays one even tone rather than darkening at the
crossing.

Because it can only darken, the effect is deliberately subtle on very dark backgrounds — there it
tints the text rather than the background behind it.

## 🎨 Color picker

**Color picker** in the tray menu, or `Ctrl/Cmd+Shift+9`, freezes the desktop and replaces your mouse cursor with a
magnifier, centred on the pixel it is reading: the surrounding pixels at 17x, the sampled one
outlined in the middle of the aperture, and its hex value below. Hold **Shift** to slow sampling to an eighth speed, which is what makes a one-pixel
border or an anti-aliased edge pickable; the arrow keys nudge exactly one pixel. Click, `Enter`,
or `Space` picks; `Esc` cancels.

**Picking copies the color straight to your clipboard**, in whichever format you choose under
Settings → Color picker, where the shortcut is rebindable and automatic copying can be turned off
entirely. The color window then shows the value as HEX, RGB, or HSL with live hue, saturation, lightness and
alpha sliders, a row of related colors, and the nearest color name. Type a hex value to jump to one
directly, copy again in another format with `Ctrl/Cmd+C`, or use **Pick again** to go back to the
screen without losing the color you already have. The window gets out of the way while you pick, so
you can sample the pixels it was covering.

Because the desktop is frozen when the picker opens, a color cannot be picked out of a playing
video or animation; reopen the picker to sample the current frame.

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
- The highlighter is deliberately subtle on very dark backgrounds. It multiplies into the image so
  it can never hide what it marks, and multiplying a near-black pixel by any color leaves it
  near-black. Rectangle and Blur are the tools for emphasis that does not depend on the background.

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
