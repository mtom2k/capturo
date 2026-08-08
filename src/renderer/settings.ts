import './settings.css'
import { DEFAULT_CAPTURE_SHORTCUT, type CaptureFormat, type Settings } from '../shared/settings'
import { acceleratorFromKeyEvent, formatAccelerator } from '../shared/shortcut'

const tabs = document.querySelectorAll<HTMLButtonElement>('.tab')
const panels = document.querySelectorAll<HTMLElement>('.panel')
const formatButtons = document.querySelectorAll<HTMLButtonElement>('[data-format]')
const qualityRow = document.querySelector<HTMLElement>('#quality-row')!
const qualitySlider = document.querySelector<HTMLInputElement>('#quality')!
const qualityValue = document.querySelector<HTMLElement>('#quality-value')!
const notifySwitch = document.querySelector<HTMLButtonElement>('#notify')!
const recorder = document.querySelector<HTMLButtonElement>('#recorder')!
const resetButton = document.querySelector<HTMLButtonElement>('#reset')!
const shortcutHint = document.querySelector<HTMLElement>('#shortcut-hint')!

const isMac = navigator.userAgent.includes('Mac')
const DEFAULT_HINT = 'Click, then press the keys.'

let recording = false

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

function renderQuality(value: number): void {
  qualitySlider.value = String(value)
  qualityValue.textContent = `${value}%`
}

function renderNotification(on: boolean): void {
  notifySwitch.classList.toggle('on', on)
  notifySwitch.setAttribute('aria-checked', String(on))
}

function renderShortcut(accelerator: string): void {
  recorder.textContent = formatAccelerator(accelerator, isMac)
}

function render(settings: Settings): void {
  renderFormat(settings.capture.format)
  renderQuality(settings.capture.jpegQuality)
  renderNotification(settings.capture.showNotification)
  renderShortcut(settings.capture.captureShortcut)
}

async function apply(update: Parameters<typeof window.capturoSettings.update>[0]): Promise<Settings> {
  const result = await window.capturoSettings.update(update)
  render(result.settings)
  shortcutHint.classList.toggle('error', Boolean(result.shortcutError))
  shortcutHint.textContent = result.shortcutError ?? DEFAULT_HINT
  return result.settings
}

// Shortcut recording. While armed, the whole window listens in capture phase so key presses
// go to the recorder rather than any focused control. A lone modifier is ignored until a
// real key arrives; Escape cancels without changing anything.
function startRecording(): void {
  recording = true
  recorder.classList.add('recording')
  recorder.textContent = 'Press keys…'
  shortcutHint.classList.remove('error')
  shortcutHint.textContent = 'Use Ctrl or Alt with a key, or a function key. Esc to cancel.'
}

function stopRecording(): void {
  recording = false
  recorder.classList.remove('recording')
}

// Leaves recording without changing anything and restores the label to the saved shortcut.
async function cancelRecording(): Promise<void> {
  stopRecording()
  render(await window.capturoSettings.get())
  shortcutHint.classList.remove('error')
  shortcutHint.textContent = DEFAULT_HINT
}

async function onKeyDown(event: KeyboardEvent): Promise<void> {
  if (!recording) return
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
    shortcutHint.classList.add('error')
    shortcutHint.textContent = 'Add Ctrl or Alt, or use a function key.'
    return
  }
  stopRecording()
  await apply({ captureShortcut: accelerator })
}

for (const tab of tabs) tab.addEventListener('click', () => setTab(tab.dataset.tab ?? 'capture'))

for (const button of formatButtons) {
  button.addEventListener('click', () => {
    void apply({ format: button.dataset.format as CaptureFormat })
  })
}

qualitySlider.addEventListener('input', () => {
  const value = Number(qualitySlider.value)
  qualityValue.textContent = `${value}%`
})
qualitySlider.addEventListener('change', () => {
  void apply({ jpegQuality: Number(qualitySlider.value) })
})

notifySwitch.addEventListener('click', () => {
  void apply({ showNotification: !notifySwitch.classList.contains('on') })
})

recorder.addEventListener('click', () => {
  if (recording) void cancelRecording()
  else startRecording()
})
resetButton.addEventListener('click', () => {
  stopRecording()
  void apply({ captureShortcut: DEFAULT_CAPTURE_SHORTCUT })
})
window.addEventListener('keydown', (event) => void onKeyDown(event), true)

void window.capturoSettings.get().then(render)
