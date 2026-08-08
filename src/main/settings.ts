// Filesystem-backed settings store. The pure validation lives in src/shared/settings.ts;
// this module is only the side-effecting wrapper: it reads the preferences JSON once at
// startup, keeps the validated result in memory as the source of truth, and rewrites the
// file on every change.
//
// This is the one file Capturo writes without an explicit Save, and it holds no captured
// pixels: only the four preferences in CaptureSettings. See D-016.

import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  normalizeSettings,
  type CaptureSettings,
  type Settings
} from '../shared/settings'

let cache: Settings = DEFAULT_SETTINGS

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

// Reads and validates the settings file into the cache. A missing or corrupt file is not an
// error: normalizeSettings turns anything into a complete, valid object, so the app always
// starts with usable settings.
export function loadSettings(): Settings {
  try {
    const raw = readFileSync(settingsPath(), 'utf8')
    cache = normalizeSettings(JSON.parse(raw))
  } catch {
    cache = DEFAULT_SETTINGS
  }
  return cache
}

export function getSettings(): Settings {
  return cache
}

function persist(next: Settings): void {
  cache = next
  try {
    writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf8')
  } catch (error) {
    // A failed write leaves the in-memory settings applied for this run; it just will not
    // survive a restart. Not worth interrupting the user over.
    console.error('Could not write settings', error)
  }
}

// Applies a partial capture update over the current settings and saves the result.
export function updateSettings(update: Partial<CaptureSettings>): Settings {
  persist(mergeSettings(cache, update))
  return cache
}
