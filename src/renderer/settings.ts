import './settings.css'
import {
  DEFAULT_CAPTURE_SHORTCUT,
  DEFAULT_COLOR_PICKER_SHORTCUT,
  DEFAULT_GIF_SHORTCUT,
  type CaptureFormat,
  type Settings,
  type SettingsUpdate
} from '../shared/settings'
import { acceleratorFromKeyEvent, formatAccelerator } from '../shared/shortcut'
import type { ColorFormat } from '../shared/color'
import { presentScreenAccess, type ScreenAccessState } from '../shared/permissions'

const tabs = document.querySelectorAll<HTMLButtonElement>('.tab')
const panels = document.querySelectorAll<HTMLElement>('.panel')

// Global tab
const openAtStartupSwitch = document.querySelector<HTMLButtonElement>('#open-at-startup')!
const startupError = document.querySelector<HTMLElement>('#startup-error')!
const automaticUpdateCheckSwitch = document.querySelector<HTMLButtonElement>('#automatic-update-check')!
const checkUpdatesButton = document.querySelector<HTMLButtonElement>('#check-updates')!
const viewUpdateButton = document.querySelector<HTMLButtonElement>('#view-update')!
const updateStatus = document.querySelector<HTMLElement>('#update-status')!
const screenAccessRow = document.querySelector<HTMLElement>('#screen-access-row')!
const screenAccessStatus = document.querySelector<HTMLElement>('#screen-access-status')!
const screenAccessSummary = document.querySelector<HTMLElement>('#screen-access-summary')!
const screenAccessRequest = document.querySelector<HTMLButtonElement>('#screen-access-request')!
const screenAccessOpen = document.querySelector<HTMLButtonElement>('#screen-access-open')!
const screenAccessRelaunch = document.querySelector<HTMLButtonElement>('#screen-access-relaunch')!

// Capture tab
const formatButtons = document.querySelectorAll<HTMLButtonElement>('[data-format]')
const qualityRow = document.querySelector<HTMLElement>('#quality-row')!
const qualitySlider = document.querySelector<HTMLInputElement>('#quality')!
const qualityValue = document.querySelector<HTMLElement>('#quality-value')!
const notifySwitch = document.querySelector<HTMLButtonElement>('#notify')!
const copyOnPickSwitch = document.querySelector<HTMLButtonElement>('#copy-on-pick')!
const copyFormatRow = document.querySelector<HTMLElement>('#copy-format-row')!
const copyFormatButtons = document.querySelectorAll<HTMLButtonElement>('[data-copy-format]')

// GIF tab
const gifFps = document.querySelector<HTMLSelectElement>('#gif-fps')!
const gifQuality = document.querySelector<HTMLInputElement>('#gif-quality')!
const gifQualityValue = document.querySelector<HTMLElement>('#gif-quality-value')!
const gifPreTimer = document.querySelector<HTMLInputElement>('#gif-pre-timer')!
const gifPreTimerValue = document.querySelector<HTMLElement>('#gif-pre-timer-value')!
const gifFrameCountSwitch = document.querySelector<HTMLButtonElement>('#gif-frame-count')!

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

function renderCopyFormat(format: ColorFormat, enabled: boolean): void {
  for (const button of copyFormatButtons) {
    const selected = button.dataset.copyFormat === format
    button.classList.toggle('selected', selected)
    button.setAttribute('aria-pressed', String(selected))
    button.disabled = !enabled
  }
  // The format only decides what copy-on-pick writes, so it means nothing while that is off.
  copyFormatRow.classList.toggle('disabled', !enabled)
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
// The capture, GIF and colour-picker shortcut rows all share this logic. Each row is a
// `.shortcut-field` with its own recorder button, reset, and hint; only one records at a time.
// Every panel that has one leads with it, so the binding is in the same place on each tab.

type ShortcutField = {
  kind: 'capture' | 'gif' | 'colorPicker'
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
  ),
  makeField(
    'colorPicker',
    DEFAULT_COLOR_PICKER_SHORTCUT,
    (settings) => settings.colorPicker.shortcut,
    (accelerator) => ({ colorPicker: { shortcut: accelerator } })
  )
]

let recordingField: ShortcutField | null = null

function setHint(field: ShortcutField, message: string, error = false): void {
  field.hint.classList.toggle('error', error)
  field.hint.textContent = message
}

function render(settings: Settings): void {
  openAtStartupSwitch.classList.toggle('on', settings.global.openAtStartup)
  openAtStartupSwitch.setAttribute('aria-checked', String(settings.global.openAtStartup))
  automaticUpdateCheckSwitch.classList.toggle('on', settings.global.automaticallyCheckForUpdates)
  automaticUpdateCheckSwitch.setAttribute('aria-checked', String(settings.global.automaticallyCheckForUpdates))

  renderFormat(settings.capture.format)
  qualitySlider.value = String(settings.capture.jpegQuality)
  qualityValue.textContent = `${settings.capture.jpegQuality}%`
  notifySwitch.classList.toggle('on', settings.capture.showNotification)
  notifySwitch.setAttribute('aria-checked', String(settings.capture.showNotification))

  gifFps.value = String(settings.gif.fps)
  gifQuality.value = String(settings.gif.quality)
  gifQualityValue.textContent = `${settings.gif.quality}%`
  gifPreTimer.value = String(settings.gif.preTimerSeconds)
  gifPreTimerValue.textContent = settings.gif.preTimerSeconds === 0 ? 'Off' : `${settings.gif.preTimerSeconds}s`
  gifFrameCountSwitch.classList.toggle('on', settings.gif.showFrameCount)
  gifFrameCountSwitch.setAttribute('aria-checked', String(settings.gif.showFrameCount))

  copyOnPickSwitch.classList.toggle('on', settings.colorPicker.copyOnPick)
  copyOnPickSwitch.setAttribute('aria-checked', String(settings.colorPicker.copyOnPick))
  renderCopyFormat(settings.colorPicker.copyFormat, settings.colorPicker.copyOnPick)

  for (const field of fields) field.recorder.textContent = formatAccelerator(field.currentOf(settings), isMac)
}

// --- Screen recording permission -----------------------------------------------------------
// macOS refuses screen capture until the user grants Screen Recording, and a refused Capturo
// simply captures nothing, so the state is surfaced here rather than only at capture time. The
// row removes itself where the platform has no such gate, leaving Windows Settings unchanged.

function renderScreenAccess(state: ScreenAccessState): void {
  screenAccessRow.hidden = !state.supported
  if (!state.supported) return
  const presentation = presentScreenAccess(state)

  screenAccessSummary.textContent = presentation.summary
  screenAccessStatus.textContent = presentation.detail
  for (const tone of ['ok', 'pending', 'error'] as const) {
    screenAccessSummary.classList.toggle(tone, presentation.tone === tone)
  }
  screenAccessStatus.classList.toggle('success', presentation.tone === 'ok')
  screenAccessStatus.classList.toggle('pending', presentation.tone === 'pending')
  screenAccessStatus.classList.toggle('error', presentation.tone === 'error')

  // A permission that needs nothing from the user is not worth a callout; one that blocks every
  // capture is, so the row only grows into one while there is something to do.
  screenAccessRow.classList.toggle('needs-action', presentation.actions.length > 0)
  screenAccessRow.classList.toggle('pending', presentation.tone === 'pending')

  const buttons = [
    ['request', screenAccessRequest],
    ['open-settings', screenAccessOpen],
    ['relaunch', screenAccessRelaunch]
  ] as const
  for (const [kind, button] of buttons) {
    const action = presentation.actions.find((candidate) => candidate.kind === kind)
    button.hidden = action === undefined
    if (action) button.textContent = action.label
  }
  // Present them in the order the user should work through, not the order of the markup.
  for (const action of presentation.actions) {
    const match = buttons.find(([kind]) => kind === action.kind)
    if (match) screenAccessRow.querySelector('.permission-actions')!.append(match[1])
  }
}

async function refreshScreenAccess(): Promise<void> {
  renderScreenAccess(await window.capturoPermissions.getScreenAccess())
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

for (const tab of tabs) tab.addEventListener('click', () => setTab(tab.dataset.tab ?? 'global'))

openAtStartupSwitch.addEventListener('click', () => {
  startupError.hidden = true
  void apply({ global: { openAtStartup: !openAtStartupSwitch.classList.contains('on') } }).then((result) => {
    if (!result.startupError) return
    startupError.textContent = result.startupError
    startupError.hidden = false
  })
})

automaticUpdateCheckSwitch.addEventListener('click', () => {
  void apply({
    global: {
      automaticallyCheckForUpdates: !automaticUpdateCheckSwitch.classList.contains('on')
    }
  })
})

checkUpdatesButton.addEventListener('click', () => {
  checkUpdatesButton.disabled = true
  checkUpdatesButton.textContent = 'Checking…'
  viewUpdateButton.hidden = true
  updateStatus.classList.remove('success', 'error')
  updateStatus.textContent = 'Contacting GitHub Releases…'
  void window.capturoUpdates.check().then((result) => {
    if (result.status === 'available') {
      updateStatus.textContent = `Version ${result.latestVersion} is available. You have ${result.currentVersion}.`
      updateStatus.classList.add('success')
      viewUpdateButton.hidden = false
    } else if (result.status === 'up-to-date') {
      updateStatus.textContent = `Capturo ${result.currentVersion} is up to date.`
      updateStatus.classList.add('success')
    } else {
      updateStatus.textContent = result.message
      if (result.status === 'error') updateStatus.classList.add('error')
    }
  }).catch(() => {
    updateStatus.textContent = 'The update check could not be completed.'
    updateStatus.classList.add('error')
  }).finally(() => {
    checkUpdatesButton.disabled = false
    checkUpdatesButton.textContent = 'Check for updates'
  })
})

viewUpdateButton.addEventListener('click', () => {
  void window.capturoUpdates.openReleasesPage()
})

screenAccessRequest.addEventListener('click', () => {
  screenAccessRequest.disabled = true
  void window.capturoPermissions
    .requestScreenAccess()
    .then(renderScreenAccess)
    .finally(() => {
      screenAccessRequest.disabled = false
    })
})

screenAccessOpen.addEventListener('click', () => {
  void window.capturoPermissions.openScreenSettings()
})

screenAccessRelaunch.addEventListener('click', () => {
  screenAccessRelaunch.disabled = true
  void window.capturoPermissions.relaunch()
})

// The permission is granted outside Capturo, in System Settings, so the answer can change while
// this window sits in the background. Re-read it on focus instead of leaving a stale message up.
window.addEventListener('focus', () => {
  if (!screenAccessRow.hidden) void refreshScreenAccess()
})

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

copyOnPickSwitch.addEventListener('click', () => {
  void apply({ colorPicker: { copyOnPick: !copyOnPickSwitch.classList.contains('on') } })
})

for (const button of copyFormatButtons) {
  button.addEventListener('click', () => {
    void apply({ colorPicker: { copyFormat: button.dataset.copyFormat as ColorFormat } })
  })
}

gifFps.addEventListener('change', () => void apply({ gif: { fps: Number(gifFps.value) } }))
gifQuality.addEventListener('input', () => {
  gifQualityValue.textContent = `${gifQuality.value}%`
})
gifQuality.addEventListener('change', () => void apply({ gif: { quality: Number(gifQuality.value) } }))
gifPreTimer.addEventListener('input', () => {
  const seconds = Number(gifPreTimer.value)
  gifPreTimerValue.textContent = seconds === 0 ? 'Off' : `${seconds}s`
})
gifPreTimer.addEventListener('change', () => void apply({ gif: { preTimerSeconds: Number(gifPreTimer.value) } }))
gifFrameCountSwitch.addEventListener('click', () => {
  void apply({ gif: { showFrameCount: !gifFrameCountSwitch.classList.contains('on') } })
})

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
void refreshScreenAccess()
