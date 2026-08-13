import './gif-preview.css'
import type { GifPreviewActionResult } from '../shared/gif'

const preview = document.querySelector<HTMLImageElement>('#preview')!
const size = document.querySelector<HTMLElement>('#size')!
const status = document.querySelector<HTMLElement>('#status')!
const location = document.querySelector<HTMLElement>('#location')!
const copyButton = document.querySelector<HTMLButtonElement>('#copy')!
const saveButton = document.querySelector<HTMLButtonElement>('#save')!
const openFolderButton = document.querySelector<HTMLButtonElement>('#open-folder')!
const retakeButton = document.querySelector<HTMLButtonElement>('#retake')!
const discardButton = document.querySelector<HTMLButtonElement>('#discard')!

const actionButtons = [copyButton, saveButton, openFolderButton, retakeButton, discardButton]
let objectUrl: string | null = null
let busy = false
let savedPath: string | null = null

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function setStatus(message: string, kind: 'normal' | 'success' | 'error' = 'normal'): void {
  status.textContent = message
  status.classList.toggle('success', kind === 'success')
  status.classList.toggle('error', kind === 'error')
}

function setBusy(value: boolean): void {
  busy = value
  for (const button of actionButtons) button.disabled = value
  if (!value) openFolderButton.disabled = savedPath === null
}

function showResult(result: GifPreviewActionResult, successMessage: string): void {
  if (result.canceled) {
    setStatus('Action canceled')
    return
  }
  if (!result.ok) {
    setStatus(result.error ?? 'The action could not be completed.', 'error')
    return
  }
  setStatus(successMessage, 'success')
}

async function copyGif(): Promise<void> {
  if (busy) return
  setBusy(true)
  setStatus('Copying animated GIF…')
  try {
    showResult(await window.capturoGif.copyPreview(), 'Animated GIF copied to the clipboard')
  } finally {
    setBusy(false)
  }
}

async function saveGif(): Promise<void> {
  if (busy) return
  setBusy(true)
  setStatus('Choose where to save the GIF…')
  try {
    const result = await window.capturoGif.savePreview()
    if (result.ok && result.filePath) {
      savedPath = result.filePath
      location.textContent = result.filePath
      location.title = result.filePath
      openFolderButton.title = `Show ${result.filePath} in its folder`
      discardButton.title = 'Close this preview; the saved GIF will be kept (Esc)'
      retakeButton.title = 'Close this preview and select a new GIF region; the saved GIF will be kept'
    }
    showResult(result, 'GIF saved')
  } finally {
    setBusy(false)
  }
}

async function openFolder(): Promise<void> {
  if (busy || !savedPath) return
  setBusy(true)
  try {
    showResult(await window.capturoGif.openPreviewFolder(), 'Opened the GIF location')
  } finally {
    setBusy(false)
  }
}

copyButton.addEventListener('click', () => void copyGif())
saveButton.addEventListener('click', () => void saveGif())
openFolderButton.addEventListener('click', () => void openFolder())
retakeButton.addEventListener('click', () => {
  if (!busy) void window.capturoGif.retakePreview()
})
discardButton.addEventListener('click', () => {
  if (!busy) void window.capturoGif.discardPreview()
})

window.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey) {
    if (event.key.toLowerCase() === 'c') {
      event.preventDefault()
      void copyGif()
    } else if (event.key.toLowerCase() === 's') {
      event.preventDefault()
      void saveGif()
    }
  } else if (event.key === 'Escape' && !busy) {
    event.preventDefault()
    void window.capturoGif.discardPreview()
  }
})

window.addEventListener('beforeunload', () => {
  if (objectUrl) URL.revokeObjectURL(objectUrl)
})

window.capturoGif.onPreviewInitialize((payload) => {
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  objectUrl = URL.createObjectURL(new Blob([payload.bytes], { type: 'image/gif' }))
  preview.src = objectUrl
  size.textContent = formatBytes(payload.byteLength)
  setStatus('Preview ready')
  copyButton.focus()
})
