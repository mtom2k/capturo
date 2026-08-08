import { contextBridge, ipcRenderer } from 'electron'
import type { CapturePayload, CapturoApi, SceneUpdate } from '../shared/types'
import type { CaptureSettings, CapturoSettingsApi } from '../shared/settings'

const api: CapturoApi = {
  onInitialize(listener) {
    const handler = (_event: Electron.IpcRendererEvent, payload: CapturePayload): void => listener(payload)
    ipcRenderer.on('capture:initialize', handler)
    return () => ipcRenderer.removeListener('capture:initialize', handler)
  },
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
  saveImage: (sessionId, dataUrl) => ipcRenderer.invoke('capture:save', sessionId, dataUrl),
  cancelSession: (sessionId) => ipcRenderer.invoke('capture:cancel', sessionId)
}

// Exposed to the settings window (and harmless to the capture overlays, which ignore it).
const settingsApi: CapturoSettingsApi = {
  get: () => ipcRenderer.invoke('settings:get'),
  update: (update: Partial<CaptureSettings>) => ipcRenderer.invoke('settings:update', update)
}

contextBridge.exposeInMainWorld('capturo', api)
contextBridge.exposeInMainWorld('capturoSettings', settingsApi)
