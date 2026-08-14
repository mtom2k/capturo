import { describe, expect, it } from 'vitest'
import { normalizeRecognizedText } from '../src/shared/ocr'

describe('recognized text normalization', () => {
  it('normalizes Windows line endings and trims outer whitespace', () => {
    expect(normalizeRecognizedText('\uFEFF  First line  \r\nSecond line\r\n')).toBe('First line\nSecond line')
  })

  it('preserves internal spacing and blank lines', () => {
    expect(normalizeRecognizedText('A  B\r\n\r\nC')).toBe('A  B\n\nC')
  })

  it('rejects non-text values and whitespace-only results', () => {
    expect(normalizeRecognizedText(null)).toBe('')
    expect(normalizeRecognizedText(' \r\n\t ')).toBe('')
  })
})
