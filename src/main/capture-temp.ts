import { randomUUID } from 'node:crypto'
import { promises as fs, type Dirent } from 'node:fs'
import path from 'node:path'

export const CAPTURE_TEMP_MAX_AGE_MS = 60 * 60 * 1000
const CAPTURE_TEMP_NAME = /^capturo-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/i

export function captureTempPath(directory: string): string {
  return path.join(directory, `capturo-${randomUUID()}.png`)
}

export function isAbandonedCaptureTemp(name: string, modifiedMs: number, nowMs = Date.now()): boolean {
  return CAPTURE_TEMP_NAME.test(name) && Number.isFinite(modifiedMs) &&
    nowMs - modifiedMs > CAPTURE_TEMP_MAX_AGE_MS
}

// A crash can leave a screenshot that the normal post-capture cleanup never reached.
// Only our UUID-named PNGs older than an hour are eligible; other temp files and an active
// capture from another Capturo process are left alone.
export async function cleanupAbandonedCaptureTemps(directory: string): Promise<void> {
  let entries: Dirent[]
  try {
    entries = await fs.readdir(directory, { withFileTypes: true })
  } catch {
    return
  }
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile() || !CAPTURE_TEMP_NAME.test(entry.name)) return
    const filePath = path.join(directory, entry.name)
    try {
      const stats = await fs.lstat(filePath)
      if (stats.isFile() && isAbandonedCaptureTemp(entry.name, stats.mtimeMs)) await fs.unlink(filePath)
    } catch {
      // Another process may remove the file before the scan reaches it.
    }
  }))
}
