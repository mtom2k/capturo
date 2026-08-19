import './color.css'
import {
  clampAlpha,
  colorName,
  cssColor,
  formatColor,
  hexToRgb,
  hslToRgb,
  readableTextColor,
  relatedColors,
  rgbToHex,
  rgbToHsl
} from '../shared/color'
import type { ColorFormat, Hsl, Rgb } from '../shared/color'

// The window that opens once a pixel has been picked.
//
// It holds the colour twice on purpose. `rgb` is what the picker sampled and what every readout
// shows; `hsl` only positions the sliders. Deriving RGB from HSL instead would round the picked
// colour through integer degrees and percents - #9CAA33 comes back as #9BA932 - and a colour
// picker that cannot report the pixel it just sampled has failed at its only job. Deriving HSL
// from RGB on every render instead would break the sliders in the other direction: every hue
// maps to the same grey, so dragging hue across a grey would snap the thumb back to zero.

const preview = document.querySelector<HTMLElement>('#preview')!
const valueField = document.querySelector<HTMLInputElement>('#value')!
const formatSelect = document.querySelector<HTMLSelectElement>('#format')!
const copyButton = document.querySelector<HTMLButtonElement>('#copy')!
const pickAgainButton = document.querySelector<HTMLButtonElement>('#pick-again')!
const hueSlider = document.querySelector<HTMLInputElement>('#hue')!
const saturationSlider = document.querySelector<HTMLInputElement>('#saturation')!
const lightnessSlider = document.querySelector<HTMLInputElement>('#lightness')!
const alphaSlider = document.querySelector<HTMLInputElement>('#alpha')!
const hueValue = document.querySelector<HTMLOutputElement>('#hue-value')!
const saturationValue = document.querySelector<HTMLOutputElement>('#saturation-value')!
const lightnessValue = document.querySelector<HTMLOutputElement>('#lightness-value')!
const alphaValue = document.querySelector<HTMLOutputElement>('#alpha-value')!
const readoutHex = document.querySelector<HTMLElement>('#readout-hex')!
const readoutRgb = document.querySelector<HTMLElement>('#readout-rgb')!
const readoutHsl = document.querySelector<HTMLElement>('#readout-hsl')!
const paletteName = document.querySelector<HTMLElement>('#palette-name')!
const swatches = document.querySelector<HTMLElement>('#swatches')!
const status = document.querySelector<HTMLElement>('#status')!

let rgb: Rgb = { r: 0, g: 0, b: 0 }
let hsl: Hsl = { h: 0, s: 0, l: 0 }
let alpha = 100
let format: ColorFormat = 'hex'
// Set while the value field is being typed into, so re-rendering does not fight the caret.
let editingValue = false
let statusTimer: number | null = null

function currentRgb(): Rgb {
  return rgb
}

/** Slider moved: HSL is authoritative from here, so the displayed colour follows it. */
function applyHsl(next: Hsl): void {
  hsl = next
  rgb = hslToRgb(next)
}

/** A colour arrived whole - picked, typed, or chosen from the row - so keep it exactly. */
function applyRgb(next: Rgb): void {
  rgb = next
  hsl = rgbToHsl(next)
}

function setStatus(message: string): void {
  status.textContent = message
  if (statusTimer !== null) window.clearTimeout(statusTimer)
  statusTimer = window.setTimeout(() => {
    status.textContent = ''
    statusTimer = null
  }, 2400)
}

function renderSliderTracks(): void {
  const stops: string[] = []
  for (let step = 0; step <= 6; step++) {
    stops.push(cssColor(hslToRgb({ h: step * 60, s: Math.max(hsl.s, 5), l: 50 })))
  }
  hueSlider.style.setProperty('--track', `linear-gradient(90deg, ${stops.join(', ')})`)

  saturationSlider.style.setProperty(
    '--track',
    `linear-gradient(90deg, ${cssColor(hslToRgb({ ...hsl, s: 0 }))}, ${cssColor(hslToRgb({ ...hsl, s: 100 }))})`
  )
  // Lightness runs through the colour rather than straight from black to white, so the middle of
  // the track shows what the slider will actually produce.
  lightnessSlider.style.setProperty(
    '--track',
    `linear-gradient(90deg, #000000, ${cssColor(hslToRgb({ ...hsl, l: 50 }))}, #ffffff)`
  )
  alphaSlider.style.setProperty(
    '--track',
    `linear-gradient(90deg, ${cssColor(currentRgb(), 0)}, ${cssColor(currentRgb(), 100)})`
  )
}

function renderSwatches(): void {
  const rgb = currentRgb()
  const row = relatedColors(rgb, 5)
  swatches.replaceChildren()
  for (const color of row) {
    const hex = rgbToHex(color)
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'swatch'
    button.setAttribute('role', 'listitem')
    button.style.background = cssColor(color)
    button.style.color = readableTextColor(color)
    button.title = hex
    button.setAttribute('aria-label', `Use ${hex}`)
    if (hex === rgbToHex(rgb)) button.classList.add('current')
    button.addEventListener('click', () => {
      applyRgb(color)
      render()
      setStatus(`Switched to ${hex}`)
    })
    swatches.append(button)
  }
}

function render(): void {
  const rgb = currentRgb()

  preview.style.setProperty('--preview', cssColor(rgb, alpha))

  hueSlider.value = String(hsl.h)
  saturationSlider.value = String(hsl.s)
  lightnessSlider.value = String(hsl.l)
  alphaSlider.value = String(alpha)
  hueValue.textContent = String(hsl.h)
  saturationValue.textContent = String(hsl.s)
  lightnessValue.textContent = String(hsl.l)
  alphaValue.textContent = String(alpha)

  readoutHex.textContent = formatColor(rgb, 'hex', alpha)
  readoutRgb.textContent = `${rgb.r}, ${rgb.g}, ${rgb.b}`
  readoutHsl.textContent = `${hsl.h}, ${hsl.s}%, ${hsl.l}%`
  paletteName.textContent = colorName(rgb)

  if (!editingValue) {
    valueField.value = formatColor(rgb, format, alpha)
    valueField.classList.remove('invalid')
  }

  renderSliderTracks()
  renderSwatches()
}

function setColor(next: Rgb): void {
  applyRgb(next)
  render()
}

async function copyCurrent(): Promise<void> {
  const text = formatColor(currentRgb(), format, alpha)
  const copied = await window.capturoColor.copy(text)
  setStatus(copied ? `Copied ${text}` : 'Capturo could not write to the clipboard.')
}

for (const [slider, apply] of [
  [hueSlider, (value: number) => applyHsl({ ...hsl, h: value })],
  [saturationSlider, (value: number) => applyHsl({ ...hsl, s: value })],
  [lightnessSlider, (value: number) => applyHsl({ ...hsl, l: value })],
  [alphaSlider, (value: number) => { alpha = clampAlpha(value) }]
] as [HTMLInputElement, (value: number) => void][]) {
  // 'input' rather than 'change' so the preview, readouts, and swatch row follow the thumb while
  // it is being dragged instead of updating once on release.
  slider.addEventListener('input', () => {
    apply(Number(slider.value))
    render()
  })
}

formatSelect.addEventListener('change', () => {
  format = formatSelect.value as ColorFormat
  render()
})

// The value field accepts hex only. RGB and HSL are shown in their own formats for copying, but
// parsing free-form colour functions back is a different job from picking a colour off a screen.
valueField.addEventListener('focus', () => { editingValue = true })
valueField.addEventListener('blur', () => {
  editingValue = false
  render()
})
valueField.addEventListener('input', () => {
  const parsed = hexToRgb(valueField.value)
  if (!parsed) {
    valueField.classList.add('invalid')
    return
  }
  valueField.classList.remove('invalid')
  applyRgb(parsed)
  const keepCaret = valueField.selectionStart
  editingValue = true
  render()
  valueField.selectionStart = keepCaret
  valueField.selectionEnd = keepCaret
})

copyButton.addEventListener('click', () => void copyCurrent())
pickAgainButton.addEventListener('click', () => void window.capturoColor.pickAgain())

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault()
    window.close()
    return
  }
  // Copy from anywhere in the window, except while the value field has a selection the user is
  // plainly trying to copy themselves.
  const command = event.ctrlKey || event.metaKey
  if (command && event.key.toLowerCase() === 'c') {
    const selecting = document.activeElement === valueField && valueField.selectionStart !== valueField.selectionEnd
    if (selecting) return
    event.preventDefault()
    void copyCurrent()
  }
})

window.capturoColor.onInitialize((picked) => {
  alpha = 100
  format = 'hex'
  formatSelect.value = format
  setColor(picked)
})

render()
