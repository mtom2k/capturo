import { describe, expect, it, vi } from 'vitest'
import {
  displaySourceForId,
  isMainFrameSender,
  isOnlyConnectedDisplay,
  lockAppNavigation,
  ownsDisplayMediaRequest,
  ownsWindow,
  permittedDisplayMediaSource
} from '../src/main/window-security'

function windowFixture() {
  const frame = { url: 'file:///capturo/settings.html' }
  const webContents = { mainFrame: frame, setWindowOpenHandler: vi.fn(), on: vi.fn() }
  const window = { webContents, isDestroyed: vi.fn(() => false) }
  return { frame, webContents, window }
}

describe('window ownership', () => {
  it('accepts only the owning main frame for IPC', () => {
    const { frame, webContents, window } = windowFixture()
    const event = { sender: webContents, senderFrame: frame }
    expect(isMainFrameSender(event as never)).toBe(true)
    expect(ownsWindow(event as never, window as never)).toBe(true)
    expect(ownsWindow({ sender: webContents, senderFrame: {} } as never, window as never)).toBe(false)
    expect(ownsWindow({ sender: {}, senderFrame: frame } as never, window as never)).toBe(false)
    expect(ownsWindow({ sender: webContents, senderFrame: null } as never, window as never)).toBe(false)
    window.isDestroyed.mockReturnValue(true)
    expect(ownsWindow(event as never, window as never)).toBe(false)
  })

  it('grants display media only to the active video-only main frame', () => {
    const { frame, window } = windowFixture()
    const request = { frame, videoRequested: true, audioRequested: false }
    expect(ownsDisplayMediaRequest(request as never, window as never)).toBe(true)
    expect(ownsDisplayMediaRequest({ ...request, frame: {} } as never, window as never)).toBe(false)
    expect(ownsDisplayMediaRequest({ ...request, audioRequested: true } as never, window as never)).toBe(false)
    expect(ownsDisplayMediaRequest({ ...request, videoRequested: false } as never, window as never)).toBe(false)
    expect(ownsDisplayMediaRequest({ ...request, frame: null } as never, window as never)).toBe(false)
    window.isDestroyed.mockReturnValue(true)
    expect(ownsDisplayMediaRequest(request as never, window as never)).toBe(false)
  })

  it('never substitutes another monitor for a missing target', () => {
    const sources = [{ display_id: 'first' }, { display_id: 'target' }]
    expect(displaySourceForId(sources, 'target')).toBe(sources[1])
    expect(displaySourceForId(sources, 'missing')).toBeNull()
    expect(displaySourceForId(sources, 'missing', true)).toBeNull()
    expect(displaySourceForId([{ display_id: '' }], 'target', true)).toEqual({ display_id: '' })
    expect(displaySourceForId([{ display_id: 'other' }], 'target', true)).toBeNull()
    expect(isOnlyConnectedDisplay([{ id: 'target' }], 'target')).toBe(true)
    expect(isOnlyConnectedDisplay([{ id: 'remaining' }], 'target')).toBe(false)
    expect(isOnlyConnectedDisplay([{ id: 'target' }, { id: 'other' }], 'target')).toBe(false)
  })

  it('denies media before enumeration for another renderer', async () => {
    const { window } = windowFixture()
    const getSources = vi.fn(async () => [{ display_id: 'target' }])
    const source = await permittedDisplayMediaSource(
      { frame: {}, videoRequested: true, audioRequested: false } as never,
      window as never, 'target', getSources, () => true
    )
    expect(source).toBeNull()
    expect(getSources).not.toHaveBeenCalled()
  })

  it('denies media if the recording closes while screens are enumerated', async () => {
    const { frame, window } = windowFixture()
    let resolve!: (sources: { display_id: string }[]) => void
    const getSources = () => new Promise<{ display_id: string }[]>((done) => { resolve = done })
    let current = true
    const selected = permittedDisplayMediaSource(
      { frame, videoRequested: true, audioRequested: false } as never,
      window as never, 'target', getSources, () => current
    )
    current = false
    resolve([{ display_id: 'target' }])
    expect(await selected).toBeNull()
  })

  it('blocks page navigation and renderer-created windows', () => {
    const { webContents, window } = windowFixture()
    lockAppNavigation(window as never)
    expect(webContents.setWindowOpenHandler.mock.calls[0][0]()).toEqual({ action: 'deny' })
    const preventDefault = vi.fn()
    expect(webContents.on.mock.calls[0][0]).toBe('will-navigate')
    webContents.on.mock.calls[0][1]({ preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
  })
})
