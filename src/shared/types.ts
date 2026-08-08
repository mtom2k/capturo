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

export type Smoothing = 'low' | 'medium' | 'high'

export type AnnotationStyle = {
  color: string
  lineWidth: number
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

export type Annotation =
  | PenAnnotation
  | SegmentAnnotation
  | ShapeAnnotation
  | StepAnnotation
  | TextAnnotation

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
  displayBounds: Rect
  scaleFactor: number
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

export type CapturoApi = {
  onInitialize: (listener: (payload: CapturePayload) => void) => () => void
  onSessionClosed: (listener: () => void) => () => void
  onScene: (listener: (scene: SceneUpdate) => void) => () => void
  publishScene: (sessionId: string, scene: SceneUpdate) => void
  captureReady: (sessionId: string) => Promise<boolean>
  captureFailed: (sessionId: string) => Promise<void>
  claimSession: (sessionId: string) => Promise<boolean>
  copyImage: (sessionId: string, dataUrl: string) => Promise<boolean>
  saveImage: (sessionId: string, dataUrl: string) => Promise<SaveResult>
  cancelSession: (sessionId: string) => Promise<void>
}
