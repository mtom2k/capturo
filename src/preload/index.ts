import { contextBridge, ipcRenderer } from 'electron'
import type { CapturePayload, CapturoApi, Rect, SceneUpdate } from '../shared/types'
import type { CapturoSettingsApi, SettingsUpdate } from '../shared/settings'
import type { CapturoGifApi, GifPreviewPayload, GifRecordPayload } from '../shared/gif'
import type { CapturoUpdatesApi } from '../shared/updates'
import type { CapturoPermissionsApi } from '../shared/permissions'
import type { CapturoColorApi, ColorPickerPayload, PickedColor, Rgb } from '../shared/color'
import type { CapturoScrollApi } from '../shared/scroll'

const api: CapturoApi = {
  onInitialize(listener) {
    const handler = (_event: Electron.IpcRendererEvent, payload: CapturePayload): void => listener(payload)
    ipcRenderer.on('capture:initialize', handler)
    return () => ipcRenderer.removeListener('capture:initialize', handler)
  },
  requestInitialization: () => ipcRenderer.invoke('capture:request-initialization'),
  onScene(listener) {
    const handler = (_event: Electron.IpcRendererEvent, scene: SceneUpdate): void => listener(scene)
    ipcRenderer.on('capture:scene', handler)
    return () => ipcRenderer.removeListener('capture:scene', handler)
  },
  publishScene: (sessionId, scene) => ipcRenderer.send('capture:scene', sessionId, scene),
  onSessionClosed(listener) {
    const handler = (): void => listener()
    ipcRenderer.on('capture:session-closed', handler)
    return () => ipcRenderer.removeListener('capture:session-closed', handler)
  },
  captureReady: (sessionId) => ipcRenderer.invoke('capture:ready', sessionId),
  captureFailed: (sessionId) => ipcRenderer.invoke('capture:failed', sessionId),
  claimSession: (sessionId) => ipcRenderer.invoke('capture:claim', sessionId),
  copyImage: (sessionId, dataUrl) => ipcRenderer.invoke('capture:copy', sessionId, dataUrl),
  pinImage: (sessionId, dataUrl) => ipcRenderer.invoke('capture:pin', sessionId, dataUrl),
  copyText: (sessionId, dataUrl) => ipcRenderer.invoke('capture:copy-text', sessionId, dataUrl),
  openDetachedEditor: (sessionId, dataUrl, forcePng) =>
    ipcRenderer.invoke('capture:open-detached', sessionId, dataUrl, forcePng),
  saveImage: (sessionId, dataUrl, forcePng) => ipcRenderer.invoke('capture:save', sessionId, dataUrl, forcePng),
  cancelSession: (sessionId) => ipcRenderer.invoke('capture:cancel', sessionId)
}

// Exposed to the settings window (and harmless to the capture overlays, which ignore it).
const settingsApi: CapturoSettingsApi = {
  get: () => ipcRenderer.invoke('settings:get'),
  update: (update: SettingsUpdate) => ipcRenderer.invoke('settings:update', update)
}

// Exposed to the GIF selection overlay and recording window.
const gifApi: CapturoGifApi = {
  startRecording: (sessionId: string, region: Rect) => ipcRenderer.invoke('gif:start', sessionId, region),
  onRecordInitialize(listener) {
    const handler = (_event: Electron.IpcRendererEvent, payload: GifRecordPayload): void => listener(payload)
    ipcRenderer.on('gif:record-init', handler)
    return () => ipcRenderer.removeListener('gif:record-init', handler)
  },
  showPreview: (bytes: ArrayBuffer) => ipcRenderer.invoke('gif:show-preview', bytes),
  onPreviewInitialize(listener) {
    const handler = (_event: Electron.IpcRendererEvent, payload: GifPreviewPayload): void => listener(payload)
    ipcRenderer.on('gif:preview-init', handler)
    return () => ipcRenderer.removeListener('gif:preview-init', handler)
  },
  copyPreview: () => ipcRenderer.invoke('gif:preview-copy'),
  savePreview: () => ipcRenderer.invoke('gif:preview-save'),
  openPreviewFolder: () => ipcRenderer.invoke('gif:preview-open-folder'),
  retakePreview: () => ipcRenderer.invoke('gif:preview-retake'),
  discardPreview: () => ipcRenderer.invoke('gif:preview-discard'),
  cancelRecording: () => ipcRenderer.invoke('gif:cancel')
}

// Exposed to Settings only in normal use. The main process validates the sender before opening
// the release page, and the API never accepts an arbitrary URL from the renderer.
const updatesApi: CapturoUpdatesApi = {
  check: () => ipcRenderer.invoke('updates:check'),
  openReleasesPage: () => ipcRenderer.invoke('updates:open-releases')
}

// Exposed to Settings only in normal use. The renderer can read the screen-capture permission
// but cannot grant it: requesting and opening System Settings are main-process actions behind a
// sender check, and no code path here can name a different permission or a different pane.
const permissionsApi: CapturoPermissionsApi = {
  getScreenAccess: () => ipcRenderer.invoke('permissions:screen-get'),
  requestScreenAccess: () => ipcRenderer.invoke('permissions:screen-request'),
  openScreenSettings: () => ipcRenderer.invoke('permissions:screen-open-settings'),
  relaunch: () => ipcRenderer.invoke('permissions:relaunch')
}

// Exposed to the colour picker overlay and the colour window. The overlay may only report a
// colour for a session it belongs to; the main process validates the sender before opening
// anything, and nothing here can name a file or a URL.
const colorApi: CapturoColorApi = {
  onInitialize(listener) {
    const handler = (_event: Electron.IpcRendererEvent, picked: PickedColor): void => listener(picked)
    ipcRenderer.on('color:initialize', handler)
    return () => ipcRenderer.removeListener('color:initialize', handler)
  },
  onPickerInitialize(listener) {
    const handler = (_event: Electron.IpcRendererEvent, payload: ColorPickerPayload): void => listener(payload)
    ipcRenderer.on('color:picker-initialize', handler)
    return () => ipcRenderer.removeListener('color:picker-initialize', handler)
  },
  sample: (sessionId, point, size) => ipcRenderer.invoke('color:sample', sessionId, point, size),
  pickerReady: (sessionId) => ipcRenderer.invoke('color:picker-ready', sessionId),
  recenterPicker: (sessionId, point) => ipcRenderer.invoke('color:picker-recenter', sessionId, point),
  cancelPicker: (sessionId) => ipcRenderer.invoke('color:picker-cancel', sessionId),
  pick: (sessionId: string, color: Rgb) => ipcRenderer.invoke('color:pick', sessionId, color),
  copy: (text: string) => ipcRenderer.invoke('color:copy', text),
  pickAgain: () => ipcRenderer.invoke('color:pick-again')
}

// Exposed to the screenshot editor and the Panoramic Scrolling control window. Main
// validates both senders: only an active screenshot editor may start, and only the current
// validates both senders; only the active panoramic window may request its payload, finish, or cancel.
const scrollApi: CapturoScrollApi = {
  start: (sessionId, region) => ipcRenderer.invoke('scroll:start', sessionId, region),
  requestInitialization: () => ipcRenderer.invoke('scroll:request-initialization'),
  cursorPosition: () => ipcRenderer.invoke('scroll:cursor-position'),
  finish: (png) => ipcRenderer.invoke('scroll:finish', png),
  cancel: () => ipcRenderer.invoke('scroll:cancel')
}

contextBridge.exposeInMainWorld('capturo', api)
const pinApi: import('../shared/pin').CapturoPinApi = {
  initialize: () => ipcRenderer.invoke('pin:initialize'),
  ready: () => ipcRenderer.invoke('pin:ready'),
  opacity: (value) => ipcRenderer.invoke('pin:opacity', value),
  copy: () => ipcRenderer.invoke('pin:copy'),
  close: () => ipcRenderer.invoke('pin:close')
}
contextBridge.exposeInMainWorld('capturoPin', pinApi)
contextBridge.exposeInMainWorld('capturoSettings', settingsApi)
contextBridge.exposeInMainWorld('capturoGif', gifApi)
contextBridge.exposeInMainWorld('capturoUpdates', updatesApi)
contextBridge.exposeInMainWorld('capturoPermissions', permissionsApi)
contextBridge.exposeInMainWorld('capturoColor', colorApi)
contextBridge.exposeInMainWorld('capturoScroll', scrollApi)
