# 📸 Capturo

A small screenshot tool for Windows and macOS that lives in your tray and opens straight into region selection. No dashboard, no account, no cloud, no telemetry. Press the shortcut, drag a box, annotate it, copy it, done.

![version](https://img.shields.io/badge/version-0.6.0-blue)
![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-lightgrey)
![license](https://img.shields.io/badge/license-MIT-green)

## ⬇️ Download

Grab the latest Windows build from the [Releases page](../../releases):

| File | What it is |
| --- | --- |
| `Capturo-Setup-0.6.0-x64.exe` | Normal installer. Lets you pick the install folder. |
| `Capturo-Portable-0.6.0-x64.exe` | Single executable. Run it from anywhere, nothing is installed. |

Every release ships a `BUILD-INFO.txt` with SHA-256 hashes so you can check what you downloaded.

Windows will warn you that the publisher is unknown. That is expected: the builds are not code-signed, because a signing certificate costs money and this is a free tool. Click **More info** then **Run anyway** if you are comfortable with that. If you would rather not, build it yourself from source with the steps below.

macOS builds are not published yet. See [Known issues](#-known-issues).

## ✨ Using it

1. Click the Capturo tray icon, or press `Ctrl + Shift + 2` (`Cmd + Shift + 2` on macOS).
2. The screen freezes. Drag to select a region. Drag inside it to move it, or grab an edge or corner to resize.
3. Annotate with pen, line, arrow, rectangle, ellipse, numbered step, text, blur, or pixelate.
4. Pick the Select tool to click any existing annotation and move, resize, recolour, or restyle it. Double-click text to edit it. `Delete` removes what is selected.
5. `Ctrl + C` copies to the clipboard, `Ctrl + S` saves a PNG, `Esc` cancels.

### ⌨️ Shortcuts

| Key | Tool | | Key | Action |
| --- | --- | --- | --- | --- |
| `V` | Select | | `Ctrl + C` | Copy |
| `P` | Pen | | `Ctrl + S` | Save as PNG |
| `L` | Line | | `Ctrl + Z` | Undo |
| `A` | Arrow | | `Delete` | Delete selected object |
| `R` | Rectangle | | `Esc` | Cancel capture |
| `E` | Ellipse | | | |
| `N` | Numbered step | | | |
| `T` | Text | | | |
| `B` | Blur | | | |
| `X` | Pixelate | | | |

### 🎚️ Sizing

Stroke width and numbered-step size are pixel sliders, 1 to 24px and 10 to 48px, and they update as you drag so you can judge the size against the screenshot underneath. Text keeps a list of preset sizes from 12px to 48px. Pick an existing annotation with the Select tool and the slider jumps to that object's size, so you can adjust something you already drew.

## 🔒 Privacy

Capturo handles your screen pixels, so it keeps them local:

- No network requests at all. Nothing is uploaded, ever.
- No telemetry, no analytics, no crash reporting.
- No account and no login.
- Nothing is written to disk unless you choose **Save**.

The renderer runs sandboxed with context isolation and no Node.js access. Every OS level action goes through a small set of explicit IPC handlers.

## ⚠️ Known issues

Worth knowing before you rely on it:

- **A selection cannot span two monitors.** Every display gets an overlay, but the first one you click owns the capture. Displays with different scale factors need a proper virtual desktop compositor to do this correctly.
- **A drag has to start outside the taskbar.** Once a selection is under way it extends over the taskbar normally, so you can capture the taskbar by starting just above it and dragging down. You just cannot begin the drag by pressing on the taskbar itself.
- **macOS is untested.** The code paths exist and the app is built for it, but nobody has run it on real macOS hardware yet, and the builds are not signed or notarized. Treat macOS as unsupported for now.
- **Windows builds are unsigned**, so SmartScreen will complain. See [Download](#️-download).
- **`npm run dist:win` can exit non-zero on the first run after deleting `release/`.** A file lock during Electron's extraction step. The artifacts are still built correctly and running the command again succeeds.

## 🛠️ Building from source

Needs Node.js 20 or newer.

```bash
git clone https://github.com/mtom2k/capturo.git
cd capturo
npm install
npm run dev
```

Checks and packaging:

```bash
npm run typecheck   # strict TypeScript across main, preload, and renderer
npm test            # geometry and annotation model tests
npm run build       # typecheck, tests, then a production build
npm run dist:win    # Windows installer and portable exe into release/
npm run dist:mac    # macOS DMG and ZIP, must be run on macOS
```

## 🧭 How it works

One Electron main process owns the tray, the global shortcut, screen capture, the clipboard, and the save dialog. Capture overlays are temporary windows created for a single screenshot and destroyed afterwards.

Two details are less obvious than they look, and both are easy to break by accident:

**Overlays are revealed by opacity, not by showing them.** Windows animates any window that goes from hidden to shown, which made the desktop appear to zoom into place instead of freezing. Each overlay is shown transparent before it loads, so the animation happens while there is nothing to see, then opacity is raised once the frozen desktop has painted.

**A display is covered by several tiled windows, never one.** Windows treats a single window covering a monitor as a full-screen app and switches on Do Not Disturb. It does not add windows together, so Capturo uses an editor window over the work area plus a filler window for each leftover strip. Same pixels covered, no Do Not Disturb.

Annotations are stored as replayable vector commands in source-image pixels rather than being painted into the bitmap, which is what makes undo, reselection, and crisp output on scaled displays work.

More detail lives in [ARCHITECTURE.md](./ARCHITECTURE.md) and [DECISIONS.md](./DECISIONS.md).

## 📚 Project docs

| File | Contents |
| --- | --- |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Process boundaries and data flow |
| [DECISIONS.md](./DECISIONS.md) | Design decisions and why they were made |
| [PROJECT_STATE.md](./PROJECT_STATE.md) | What works, what is verified, what is left |
| [HANDOFF.md](./HANDOFF.md) | Shortest path for the next contributor |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Development rules and definition of done |
| [TESTING.md](./TESTING.md) | Automated checks and the desktop test matrix |
| [RELEASING.md](./RELEASING.md) | Packaging, signing, and release checks |
| [CHANGELOG.md](./CHANGELOG.md) | What changed in each version |

## 📄 License

MIT. See [LICENSE](./LICENSE).
