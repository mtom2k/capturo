import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CAPTURE_TEMP_MAX_AGE_MS,
  captureTempPath,
  cleanupAbandonedCaptureTemps,
  isAbandonedCaptureTemp
} from '../src/main/capture-temp'

describe('abandoned native screenshot files', () => {
  it('recognizes only stale UUID-named Capturo PNGs', () => {
    const name = path.basename(captureTempPath(os.tmpdir()))
    const now = Date.now()
    expect(isAbandonedCaptureTemp(name, now - CAPTURE_TEMP_MAX_AGE_MS - 1, now)).toBe(true)
    expect(isAbandonedCaptureTemp(name, now, now)).toBe(false)
    expect(isAbandonedCaptureTemp('capturo-manual.png', 0, now)).toBe(false)
    expect(isAbandonedCaptureTemp('capturo-1234.png', 0, now)).toBe(false)
  })

  it('removes old captures and preserves active and unrelated files', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'capturo-temp-test-'))
    const old = captureTempPath(directory)
    const recent = captureTempPath(directory)
    const unrelated = path.join(directory, 'capturo-manual.png')
    try {
      await Promise.all([old, recent, unrelated].map((file) => fs.writeFile(file, 'test')))
      const oldTime = new Date(Date.now() - CAPTURE_TEMP_MAX_AGE_MS - 60_000)
      await fs.utimes(old, oldTime, oldTime)
      await cleanupAbandonedCaptureTemps(directory)
      await expect(fs.access(old)).rejects.toThrow()
      await expect(fs.access(recent)).resolves.toBeUndefined()
      await expect(fs.access(unrelated)).resolves.toBeUndefined()
    } finally {
      await Promise.all([old, recent, unrelated].map((file) => fs.rm(file, { force: true })))
      await fs.rmdir(directory)
    }
  })
})
