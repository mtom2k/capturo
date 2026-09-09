// Desktop smoke harness: the real built editor/preload with a generated blank image.
// npm run build, then electron tests/fixtures/annotation-app.cjs --remote-debugging-port=9235
// This profile and its exports stay inside the ignored tmp-annotation-smoke directory.
const { app, BrowserWindow, ipcMain, nativeImage } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const root = path.resolve(__dirname, '../..')
// Point at release/win-unpacked/resources/app.asar to verify the packaged renderer/preload.
const appRoot = process.env.CAPTURO_ANNOTATION_APP_ROOT || root
const output = path.join(root, 'tmp-annotation-smoke')
fs.mkdirSync(output, { recursive: true })
app.setPath('userData', path.join(output, 'profile'))
let editor
const frame = { width: 1000, height: 620 }
let payload
ipcMain.handle('capture:request-initialization', () => payload)
ipcMain.handle('capture:ready', () => true)
ipcMain.handle('capture:claim', () => true)
ipcMain.handle('capture:cancel', () => editor.close())
ipcMain.handle('capture:failed', () => { throw new Error('Editor initialization failed') })
ipcMain.on('capture:scene', (_event, _id, scene) => { globalThis.annotationSmokeScene = scene })
for (const action of ['save', 'copy']) {
  ipcMain.handle(`capture:${action}`, (_event, _id, dataUrl) => {
    fs.writeFileSync(path.join(output, `${action}.png`), nativeImage.createFromDataURL(dataUrl).toPNG())
    return action === 'copy' ? true : { saved: true }
  })
}
app.whenReady().then(() => {
  const image = nativeImage.createFromBitmap(Buffer.alloc(frame.width * frame.height * 4, 255), frame)
  payload = {
    sessionId: 'annotation-smoke', displayId: 'fixture', role: 'detached',
    imageBytes: image.toPNG(), imageWidth: frame.width, imageHeight: frame.height,
    imageOrigin: { x: 0, y: 0 }, captureSize: frame, cursor: null,
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 }
  }
  editor = new BrowserWindow({
    width: 1100, height: 800, title: 'Capturo annotation smoke',
    webPreferences: { preload: path.join(appRoot, 'out/preload/index.js'), sandbox: true, contextIsolation: true }
  })
  editor.loadFile(path.join(appRoot, 'out/renderer/index.html'))
  editor.once('ready-to-show', () => editor.show())
})
app.on('window-all-closed', () => app.quit())
