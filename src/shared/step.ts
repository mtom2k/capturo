import type { AnnotationStyle } from './types'

/** Step geometry depends only on its own size and capture scale, never another tool's stroke. */
export function stepMetrics(style: AnnotationStyle): { radius: number; border: number } {
  const scale = style.effectScale ?? 1
  return {
    radius: Math.max(13 * scale, style.fontSize * 0.78),
    border: Math.max(2.5 * scale, style.fontSize * (2.8 / 18))
  }
}
