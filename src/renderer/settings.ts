import './settings.css'
import {
  DEFAULT_CAPTURE_SHORTCUT,
  DEFAULT_GIF_SHORTCUT,
  type CaptureFormat,
  type Settings,
  type SettingsUpdate
} from '../shared/settings'
import { acceleratorFromKeyEvent, formatAccelerator } from '../shared/shortcut'

const tabs = document.querySelectorAll<HTMLButtonElement>('.tab')
const panels = document.querySelectorAll<HTMLElement>('.panel')

// Capture tab
const formatButtons = document.querySelectorAll<HTMLButtonElement>('[data-format]')
const qualityRow = document.querySelector<HTMLElement>('#quality-row')!
const qualitySlider = document.querySelector<HTMLInputElement>('#quality')!
const qualityValue = document.querySelector<HTMLElement>('#quality-value')!
const notifySwitch = document.querySelector<HTMLButtonElement>('#notify')!

// GIF tab
const gifFps = document.querySelector<HTMLSelectElement>('#gif-fps')!
const gifQuality = document.querySelector<HTMLInputElement>('#gif-quality')!
const gifQualityValue = document.querySelector<HTMLElement>('#gif-quality-value')!

const isMac = navigator.userAgent.includes('Mac')
const DEFAULT_HINT = 'Click, then press the keys.'

async function apply(update: SettingsUpdate): Promise<Awaited<ReturnType<typeof window.capturoSettings.update>>> {
  const result = await window.capturoSettings.update(update)
  render(result.settings)
  return result
}

function setTab(name: string): void {
  for (const tab of tabs) {
    const selected = tab.dataset.tab === name
    tab.classList.toggle('selected', selected)
    tab.setAttribute('aria-selected', String(selected))
  }
  for (const panel of panels) panel.hidden = panel.dataset.panel !== name
}

function renderFormat(format: CaptureFormat): void {
  for (const button of formatButtons) {
    const selected = button.dataset.format === format
    button.classList.toggle('selected', selected)
    button.setAttribute('aria-pressed', String(selected))
  }
  // JPEG quality only means anything for JPEG; dim and disable it otherwise.
  const jpeg = format === 'jpeg'
  qualityRow.classList.toggle('disabled', !jpeg)
  qualitySlider.disabled = !jpeg
}

// --- Shortcut recorders ------------------------------------------------------------------
// Both the capture and GIF shortcut rows share this logic. Each row is a `.shortcut-field`
// with its own recorder button, reset, and hint; only one records at a time.

type ShortcutField = {
  kind: 'capture' | 'gif'
  recorder: HTMLButtonElement
  reset: HTMLButtonElement
  hint: HTMLElement
  defaultAccelerator: string
  currentOf: (settings: Settings) => string
  updateFor: (accelerator: string) => SettingsUpdate
}

function makeField(
  kind: ShortcutField['kind'],
  defaultAccelerator: string,
  currentOf: ShortcutField['currentOf'],
  updateFor: ShortcutField['updateFor']
): ShortcutField {
  const el = document.querySelector<HTMLElement>(`.shortcut-field[data-shortcut="${kind}"]`)!
  return {
    kind,
    defaultAccelerator,
    currentOf,
    updateFor,
    recorder: el.querySelector<HTMLButtonElement>('.recorder')!,
    reset: el.querySelector<HTMLButtonElement>('.reset')!,
    hint: el.querySelector<HTMLElement>('.shortcut-hint')!
  }
}

const fields: ShortcutField[] = [
  makeField(
    'capture',
    DEFAULT_CAPTURE_SHORTCUT,
    (settings) => settings.capture.captureShortcut,
    (accelerator) => ({ capture: { captureShortcut: accelerator } })
  ),
  makeField(
    'gif',
    DEFAULT_GIF_SHORTCUT,
    (settings) => settings.gif.shortcut,
    (accelerator) => ({ gif: { shortcut: accelerator } })
  )
]

let recordingField: ShortcutField | null = null

function setHint(field: ShortcutField, message: string, error = false): void {
  field.hint.classList.toggle('error', error)
  field.hint.textContent = message
}

function render(settings: Settings): void {
  renderFormat(settings.capture.format)
  qualitySlider.value = String(settings.capture.jpegQuality)
  qualityValue.textContent = `${settings.capture.jpegQuality}%`
  notifySwitch.classList.toggle('on', settings.capture.showNotification)
  notifySwitch.setAttribute('aria-checked', String(settings.capture.showNotification))

  gifFps.value = String(settings.gif.fps)
  gifQuality.value = String(settings.gif.quality)
  gifQualityValue.textContent = `${settings.gif.quality}%`

  for (const field of fields) field.recorder.textContent = formatAccelerator(field.currentOf(settings), isMac)
}

function startRecording(field: ShortcutField): void {
  recordingField = field
  field.recorder.classList.add('recording')
  field.recorder.textContent = 'Press keys…'
  setHint(field, 'Use Ctrl or Alt with a key, or a function key. Esc to cancel.')
}

async function cancelRecording(): Promise<void> {
  const field = recordingField
  recordingField = null
  if (field) field.recorder.classList.remove('recording')
  render(await window.capturoSettings.get())
  if (field) setHint(field, DEFAULT_HINT)
}

async function onKeyDown(event: KeyboardEvent): Promise<void> {
  const field = recordingField
  if (!field) return
  event.preventDefault()
  event.stopPropagation()
  if (event.key === 'Escape') {
    await cancelRecording()
    return
  }
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return
  const accelerator = acceleratorFromKeyEvent({
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    code: event.code
  })
  if (!accelerator) {
    setHint(field, 'Add Ctrl or Alt, or use a function key.', true)
    return
  }
  recordingField = null
  field.recorder.classList.remove('recording')
  const result = await apply(field.updateFor(accelerator))
  setHint(field, result.shortcutError ?? DEFAULT_HINT, Boolean(result.shortcutError))
}

// --- Wiring ------------------------------------------------------------------------------

for (const tab of tabs) tab.addEventListener('click', () => setTab(tab.dataset.tab ?? 'capture'))

for (const button of formatButtons) {
  button.addEventListener('click', () => void apply({ capture: { format: button.dataset.format as CaptureFormat } }))
}

qualitySlider.addEventListener('input', () => {
  qualityValue.textContent = `${qualitySlider.value}%`
})
qualitySlider.addEventListener('change', () => void apply({ capture: { jpegQuality: Number(qualitySlider.value) } }))

notifySwitch.addEventListener('click', () => {
  void apply({ capture: { showNotification: !notifySwitch.classList.contains('on') } })
})

gifFps.addEventListener('change', () => void apply({ gif: { fps: Number(gifFps.value) } }))
gifQuality.addEventListener('input', () => {
  gifQualityValue.textContent = `${gifQuality.value}%`
})
gifQuality.addEventListener('change', () => void apply({ gif: { quality: Number(gifQuality.value) } }))

for (const field of fields) {
  field.recorder.addEventListener('click', () => {
    if (recordingField === field) void cancelRecording()
    else startRecording(field)
  })
  field.reset.addEventListener('click', () => {
    if (recordingField) void cancelRecording()
    void apply(field.updateFor(field.defaultAccelerator)).then((result) =>
      setHint(field, result.shortcutError ?? DEFAULT_HINT, Boolean(result.shortcutError))
    )
  })
}
window.addEventListener('keydown', (event) => void onKeyDown(event), true)

void window.capturoSettings.get().then(render)
