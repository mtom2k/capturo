import { describe, expect, it } from 'vitest'
import {
  normalizeRecognizedText,
  recognitionFailureMessage,
  textRecognitionUnavailableMessage
} from '../src/shared/ocr'

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

describe('text recognition availability messages', () => {
  it('names the component that is actually missing on each platform', () => {
    expect(textRecognitionUnavailableMessage('win32')).toContain('Windows OCR')
    expect(textRecognitionUnavailableMessage('darwin')).toContain('macOS text recognition')
  })

  it('does not promise a component on a platform that has none', () => {
    expect(textRecognitionUnavailableMessage('linux')).toBe('Copy text is not available on this platform.')
  })
})

describe('recognition failure guidance', () => {
  it('offers the language pack fix only on Windows, which is the only platform that has one', () => {
    expect(recognitionFailureMessage('language', 'win32')).toBe(
      'Install a Windows OCR language pack, then try Copy text again.'
    )
  })

  // macOS ships Vision's recognition models with the OS, so there is nothing to install. Telling
  // a Mac user to install a Windows language pack would send them looking for something that does
  // not exist, which is worse than the generic message.
  it('never sends a macOS user after a Windows language pack', () => {
    expect(recognitionFailureMessage('language', 'darwin')).toBe(
      'Capturo could not extract text from this selection.'
    )
    expect(recognitionFailureMessage('language', 'darwin')).not.toContain('Windows')
  })

  it('falls back to the generic message for every other stage', () => {
    for (const stage of ['image', 'ocr', 'helper', 'parse', 'request', 'encode']) {
      expect(recognitionFailureMessage(stage, 'win32')).toBe('Capturo could not extract text from this selection.')
      expect(recognitionFailureMessage(stage, 'darwin')).toBe('Capturo could not extract text from this selection.')
    }
  })
})
