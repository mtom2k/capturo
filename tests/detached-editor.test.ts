import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const main = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
const editor = readFileSync(new URL('../src/renderer/editor.ts', import.meta.url), 'utf8')
const preload = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8')

describe('detached editor startup', () => {
  it('lets the ready renderer pull initialization instead of racing a page-load push', () => {
    expect(preload).toMatch(/requestInitialization: \(\) => ipcRenderer\.invoke\('capture:request-initialization'\)/)
    expect(editor).toMatch(/requestInitialization\(\)\.then/)
    expect(main).toMatch(/ipcMain\.handle\('capture:request-initialization'/)
    expect(main).not.toMatch(/webContents\.on\('did-finish-load'[\s\S]{0,240}capture:initialize/)
  })

  it('reports success only after capture:ready reveals the editor', () => {
    expect(main).toMatch(/return await state\.readyPromise/)
    expect(main).toMatch(/settleDetachedEditorReady\(editor, true\)/)
    expect(main).toMatch(/DETACHED_EDITOR_READY_TIMEOUT_MS = 10_000/)
  })

  it('does not let an unrevealed stale editor block the next attempt', () => {
    expect(main).toMatch(/if \(!existing\.revealed\) \{[\s\S]*?closeDetachedEditor\(existing\)/)
  })
})
