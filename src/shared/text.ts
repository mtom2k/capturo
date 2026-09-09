import type { AnnotationStyle } from './types'

export const TEXT_LINE_HEIGHT = 1.25

export function textFont(style: AnnotationStyle): string {
  return `${style.fontStyle} ${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`
}

/** Wrap without changing the stored text; explicit newlines and empty lines survive reflow. */
export function wrapText(text: string, width: number, measure: (text: string) => number): string[] {
  const lines: string[] = []
  const limit = Math.max(1, width)
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line = ''
    for (const token of paragraph.match(/\S+|[^\S\n]+/gu) ?? []) {
      if (/^\s+$/u.test(token)) {
        line += token
        continue
      }
      if (line && measure(line + token) > limit) {
        lines.push(line.trimEnd())
        line = ''
      }
      for (const { segment } of segmenter.segment(token)) {
        if (line && measure(line + segment) > limit) {
          lines.push(line)
          line = ''
        }
        line += segment
      }
    }
    lines.push(line.trimEnd())
  }
  return lines
}
