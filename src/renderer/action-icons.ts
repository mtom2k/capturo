import './action-icons.css'

export type ActionIcon =
  | 'copy' | 'save' | 'cancel' | 'edit' | 'record' | 'pause' | 'resume'
  | 'stop' | 'finish' | 'folder' | 'retake' | 'pick' | 'pin' | 'scroll' | 'copy-text'

// One source for action glyphs used by the screenshot, GIF, color, and pin windows.
const icons: Record<ActionIcon, string> = {
  copy: '<rect x="7" y="6" width="9" height="10" rx="1"/><path d="M5 13H4V4h9v1"/>',
  save: '<path d="M4 4h10l2 2v10H4zM7 4v5h6V4M7 16v-4h6v4"/>',
  cancel: '<path d="M5 5l10 10M15 5L5 15"/>',
  edit: '<rect x="3" y="4" width="14" height="12" rx="1.5"/><path d="M3 8h14M7 6h.01M5 6h.01"/><path d="M10 11h4v3M14 11l-5 5"/>',
  record: '<circle cx="10" cy="10" r="5" fill="currentColor" stroke="none"/>',
  pause: '<path d="M7 4v12M13 4v12"/>',
  resume: '<path d="M6 4l10 6-10 6z"/>',
  stop: '<rect x="5" y="5" width="10" height="10" rx="1"/>',
  finish: '<path d="M4 10l4 4 8-8"/>',
  folder: '<path d="M3 6h5l2 2h7v8H3z"/>',
  retake: '<path d="M4 8a6 6 0 1 1 1 6M4 4v4h4"/>',
  pick: '<path d="M13.5 3.2a1.8 1.8 0 0 1 2.5 2.5l-1.2 1.2-2.5-2.5zM11.4 5.3l3.3 3.3-6.6 6.6-3.9.6.6-3.9z"/>',
  pin: '<path d="m7 3 6 0-1 5 3 3v2H5v-2l3-3-1-5zM10 13v5"/>',
  scroll: '<rect x="4" y="4" width="12" height="12" rx="1.5"/><path d="M10 2v16M2 10h16"/><path d="m8 4 2-2 2 2M8 16l2 2 2-2M4 8l-2 2 2 2M16 8l2 2-2 2"/>',
  'copy-text': '<rect x="2.4" y="4.4" width="15.2" height="13" rx="1.4"/><path d="M7.6 4.4V3.1h4.8v1.3"/><path d="M4.6 14.6 7 8.4 9.4 14.6"/><path d="M5.5 12.6h3"/><path d="M15 11v3.6"/><circle cx="13.4" cy="13.1" r="1.5"/>'
}

export function setActionIcon(button: HTMLButtonElement, icon: ActionIcon): void {
  button.dataset.actionIcon = icon
  button.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">${icons[icon]}</svg>`
}

for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-action-icon]')) {
  const icon = button.dataset.actionIcon
  if (icon && Object.hasOwn(icons, icon)) setActionIcon(button, icon as ActionIcon)
}
