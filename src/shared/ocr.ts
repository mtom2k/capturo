// Windows OCR commonly returns CRLF and may leave trailing whitespace on recognized lines.
// Normalize only presentation noise: internal spacing and blank lines remain intact so copied
// text still resembles the source layout.
export function normalizeRecognizedText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim()
}
