// Publishes the overlay's system-owned edges to CSS.
//
// A macOS overlay spans the whole display (D-029), so its top edge sits behind the menu bar area
// — which on a MacBook Pro is where the camera housing is — and its bottom edge sits over the
// Dock. Capturo's own floating UI has to stay clear of both. The frozen desktop deliberately does
// not: those pixels must remain selectable, which is the entire reason the overlay covers them.
//
// This lives in its own module because the screenshot overlay and the GIF overlay are separate
// entry points with separate initialize() functions that both draw the same `.hint` from
// styles.css. Fixing one and forgetting the other is exactly how the GIF overlay kept drawing its
// hint through the notch after the screenshot overlay was corrected.

import type { CapturePayload } from '../shared/types'

export function applySafeArea(safeArea: CapturePayload['safeArea']): void {
  const root = document.documentElement.style
  root.setProperty('--safe-area-top', `${safeArea.top}px`)
  root.setProperty('--safe-area-bottom', `${safeArea.bottom}px`)
}
