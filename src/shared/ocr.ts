// Windows OCR commonly returns CRLF and may leave trailing whitespace on recognized lines;
// macOS Vision returns neither, but joins its observations with the same newline. Normalize
// only presentation noise: internal spacing and blank lines remain intact so copied text
// still resembles the source layout.
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

// Copy text runs on a different local recognizer per platform -- Windows.Media.Ocr behind the
// native capture helper, Vision behind the macOS helper -- so a failure has different guidance
// on each. Keeping the wording here rather than in the main process means the platform mapping
// is covered by tests instead of only being observable by running the app on each OS.
// See D-026 and D-036.

// Shown when the platform's recognizer is missing entirely, which for a user means a broken or
// incomplete installation rather than anything they did.
export function textRecognitionUnavailableMessage(platform: string): string {
  if (platform === 'win32') return 'Copy text requires Capturo\u2019s Windows OCR component.'
  if (platform === 'darwin') return 'Copy text requires Capturo\u2019s macOS text recognition component.'
  return 'Copy text is not available on this platform.'
}

// Maps a helper failure stage to what the user should do about it. Only Windows has an
// actionable one: its recognizer needs a language pack the user may not have installed.
// macOS ships its recognition models with the OS, so the 'language' stage cannot occur there
// and must never produce advice to install something that does not exist.
export function recognitionFailureMessage(stage: string, platform: string): string {
  if (stage === 'language' && platform === 'win32') {
    return 'Install a Windows OCR language pack, then try Copy text again.'
  }
  return 'Capturo could not extract text from this selection.'
}
