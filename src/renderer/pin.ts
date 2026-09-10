import './pin.css'

const image = document.querySelector<HTMLImageElement>('#image')!
const opacity = document.querySelector<HTMLInputElement>('#opacity')!
const value = document.querySelector<HTMLOutputElement>('#opacity-value')!
const status = document.querySelector<HTMLElement>('#status')!
let statusTimer: ReturnType<typeof setTimeout>

async function copy(): Promise<void> {
  try {
    status.textContent = await window.capturoPin.copy() ? 'Copied at original resolution' : 'Could not copy image'
  } catch { status.textContent = 'Could not copy image' }
  clearTimeout(statusTimer)
  statusTimer = setTimeout(() => { status.textContent = '' }, 2000)
}
document.querySelector('#copy')!.addEventListener('click', () => void copy())
document.querySelector('#close')!.addEventListener('click', () => void window.capturoPin.close())
opacity.addEventListener('input', () => {
  value.value = `${opacity.value}%`
  void window.capturoPin.opacity(Number(opacity.value) / 100)
})
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') void window.capturoPin.close()
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
    event.preventDefault()
    void copy()
  }
})

async function initialize(): Promise<void> {
  let url: string | undefined
  try {
    const payload = await window.capturoPin.initialize()
    if (!payload) throw new Error('Pin unavailable')
    url = URL.createObjectURL(new Blob([new Uint8Array(payload.png)], { type: 'image/png' }))
    image.src = url
    await image.decode()
    // Decode completes before reveal; no animation-frame wait in the hidden window.
    if (!await window.capturoPin.ready()) throw new Error('Pin closed')
  } catch {
    await window.capturoPin.close()
  } finally {
    if (url) URL.revokeObjectURL(url)
  }
}
void initialize()
