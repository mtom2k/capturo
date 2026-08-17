export type Point = { x: number; y: number }

export type Rect = { x: number; y: number; width: number; height: number }

export type ResizeHandle =
  | 'north-west'
  | 'north'
  | 'north-east'
  | 'east'
  | 'south-east'
  | 'south'
  | 'south-west'
  | 'west'

export type Tool =
  | 'select'
  | 'pen'
  | 'line'
  | 'arrow'
  | 'rectangle'
  | 'ellipse'
  | 'step'
  | 'text'
  | 'blur'
  | 'pixelate'
  | 'transparent'

export type Smoothing = 'low' | 'medium' | 'high'

export type AnnotationStyle = {
  color: string
  lineWidth: number
  // Blur and pixelate strength as a user-facing percentage, independent of stroke size.
  effectIntensity: number
  // Source-pixel multiplier captured when the effect is created, for consistent DPI strength.
  effectScale: number
  fontFamily: string
  fontSize: number
  fontWeight: 'normal' | 'bold'
  fontStyle: 'normal' | 'italic'
  smoothing: Smoothing
}

type AnnotationBase = {
  id: string
  style: AnnotationStyle
}

export type PenAnnotation = AnnotationBase & {
  type: 'pen'
  points: Point[]
}

export type SegmentAnnotation = AnnotationBase & {
  type: 'line' | 'arrow'
  start: Point
  end: Point
}

export type ShapeAnnotation = AnnotationBase & {
  type: 'rectangle' | 'ellipse' | 'blur' | 'pixelate'
  rect: Rect
}

export type StepAnnotation = AnnotationBase & {
  type: 'step'
  center: Point
  number: number
}

export type TextAnnotation = AnnotationBase & {
  type: 'text'
  origin: Point
  text: string
}

export type RgbColor = { r: number; g: number; b: number }

// Transparency is stored as a non-destructive edit command. The renderer applies it to
// source pixels before drawing visible annotations, so later labels and arrows stay opaque.
export type TransparencyAnnotation = AnnotationBase & {
  type: 'transparent'
  seed: Point
  region: Rect
  target: RgbColor
  tolerance: number
  feather: number
}

export type Annotation =
  | PenAnnotation
  | SegmentAnnotation
  | ShapeAnnotation
  | StepAnnotation
  | TextAnnotation
  | TransparencyAnnotation

// A display is covered by one editor window over the work area plus a filler window for
// each strip the work area leaves uncovered, typically the taskbar. Windows classifies a
// single window that covers a monitor as a full-screen application and switches on Do Not
// Disturb; tiled windows cover the same pixels without triggering it. See D-013.
export type OverlayRole = 'editor' | 'filler'

export type CapturePayload = {
  sessionId: string
  displayId: string
  role: OverlayRole
  // The frozen desktop as PNG bytes. On Windows these come from the native helper, which
  // captures in FP16 and tone maps correctly on HDR displays; elsewhere they come from
  // desktopCapturer. See D-014.
  imageBytes: Uint8Array
  imageWidth: number
  imageHeight: number
  // Where this window sits inside the captured region, in CSS pixels. Every overlay of a
  // display receives the whole frozen desktop and shows its own slice of it.
  imageOrigin: Point
  // Size of the captured region in CSS pixels. Selection maths divides the image by this
  // rather than by the window's viewport, so a window covering part of a display still
  // maps pointer positions to the correct source pixels.
  captureSize: { width: number; height: number }
  // Edges of this overlay that the system owns, in CSS pixels. Capturo's own floating UI keeps
  // out of them; the frozen desktop still fills them, so those pixels remain selectable. On
  // macOS the overlay spans the whole display (D-029), which puts the top edge behind the menu
  // bar area — and on a notched Mac that is exactly where the camera housing sits, which clipped
  // the selection hint. The bottom edge is the Dock. Zero on Windows, where overlays are tiled
  // inside the work area already.
  safeArea: { top: number; bottom: number }
}

// The editor owns all interaction; fillers are passive and repaint from these updates so
// the strips they cover shade and highlight in step with the selection.
export type SceneUpdate = {
  annotations: Annotation[]
  draft: Annotation | null
  selection: Rect | null
}

export type SaveResult = {
  saved: boolean
  canceled: boolean
  filePath?: string
}

export type CopyTextResult =
  | { copied: true }
  | { copied: false; empty?: boolean; error: string }

export type CapturoApi = {
  onInitialize: (listener: (payload: CapturePayload) => void) => () => void
  onSessionClosed: (listener: () => void) => () => void
  onScene: (listener: (scene: SceneUpdate) => void) => () => void
  publishScene: (sessionId: string, scene: SceneUpdate) => void
  captureReady: (sessionId: string) => Promise<boolean>
  captureFailed: (sessionId: string) => Promise<void>
  claimSession: (sessionId: string) => Promise<boolean>
  copyImage: (sessionId: string, dataUrl: string) => Promise<boolean>
  copyText: (sessionId: string, dataUrl: string) => Promise<CopyTextResult>
  saveImage: (sessionId: string, dataUrl: string, forcePng?: boolean) => Promise<SaveResult>
  cancelSession: (sessionId: string) => Promise<void>
}
