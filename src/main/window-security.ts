import type { BrowserWindow, DisplayMediaRequestHandlerHandlerRequest, IpcMainInvokeEvent } from 'electron'

type WindowOwner = Pick<BrowserWindow, 'isDestroyed' | 'webContents'>
type InvokeSender = Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>

export function isMainFrameSender(event: InvokeSender): boolean {
  return event.senderFrame !== null && event.senderFrame === event.sender.mainFrame
}

export function ownsWindow<T extends WindowOwner>(event: InvokeSender, window: T | null): window is T {
  return window !== null && !window.isDestroyed() &&
    event.sender === window.webContents && isMainFrameSender(event)
}

export function ownsDisplayMediaRequest(
  request: DisplayMediaRequestHandlerHandlerRequest,
  window: WindowOwner | null
): boolean {
  return window !== null && !window.isDestroyed() && request.videoRequested &&
    !request.audioRequested && request.frame !== null &&
    request.frame === window.webContents.mainFrame
}

export function displaySourceForId<T extends { display_id: string }>(
  sources: T[], displayId: string, onlyOneConnectedDisplay = false
): T | null {
  return sources.find((source) => source.display_id === displayId) ??
    (onlyOneConnectedDisplay && sources.length === 1 && sources[0].display_id === '' ? sources[0] : null)
}

export function isOnlyConnectedDisplay(displays: { id: number | string }[], displayId: string): boolean {
  return displays.length === 1 && String(displays[0].id) === displayId
}

export async function permittedDisplayMediaSource<T extends { display_id: string }>(
  request: DisplayMediaRequestHandlerHandlerRequest,
  window: WindowOwner | null,
  displayId: string | null,
  getSources: () => Promise<T[]>,
  isCurrent: () => boolean,
  onlyOneConnectedDisplay: () => boolean = () => false
): Promise<T | null> {
  if (!displayId || !ownsDisplayMediaRequest(request, window) || !isCurrent()) return null
  try {
    const sources = await getSources()
    if (!ownsDisplayMediaRequest(request, window) || !isCurrent()) return null
    return displaySourceForId(sources, displayId, onlyOneConnectedDisplay())
  } catch {
    return null
  }
}

// App pages are loaded by main; a link or injected page must not replace one of them or
// open a second window with Capturo's preload bridge.
export function lockAppNavigation(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
}
