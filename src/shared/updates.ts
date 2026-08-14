// Update checks are deliberately release-based rather than commit-based. A repository commit
// may be unfinished and has no installable artifact; a published stable GitHub Release is the
// smallest trustworthy unit that can be compared with the packaged app version. See D-025.

export const CAPTURO_RELEASES_URL = 'https://github.com/mtom2k/capturo/releases/latest'

export type UpdateCheckResult =
  | { status: 'available'; currentVersion: string; latestVersion: string }
  | { status: 'up-to-date'; currentVersion: string; latestVersion: string }
  | { status: 'unavailable'; currentVersion: string; message: string }
  | { status: 'error'; currentVersion: string; message: string }

export type CapturoUpdatesApi = {
  check: () => Promise<UpdateCheckResult>
  openReleasesPage: () => Promise<boolean>
}

type StableVersion = readonly [major: number, minor: number, patch: number]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

// Capturo publishes stable vMAJOR.MINOR.PATCH tags. Pre-release/build suffixes are rejected so
// an accidental beta or arbitrary tag can never be offered on the stable channel.
export function parseStableVersion(value: string): StableVersion | null {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value.trim())
  if (!match) return null
  const version = [Number(match[1]), Number(match[2]), Number(match[3])] as const
  return version.every(Number.isSafeInteger) ? version : null
}

export function compareStableVersions(left: string, right: string): number | null {
  const a = parseStableVersion(left)
  const b = parseStableVersion(right)
  if (!a || !b) return null
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1
  }
  return 0
}

export function nextAutomaticUpdateDelay(
  lastCheckAt: number,
  now: number,
  minimumMs: number,
  intervalMs: number
): number {
  const last = Number.isFinite(lastCheckAt) && lastCheckAt > 0 ? lastCheckAt : 0
  const current = Number.isFinite(now) ? now : 0
  const interval = Math.max(0, intervalMs)
  const minimum = Math.max(0, minimumMs)
  if (last === 0) return minimum
  // A corrupt/future clock cannot postpone checks beyond one normal interval.
  const remaining = Math.min(interval, Math.max(0, last + interval - current))
  return Math.max(minimum, remaining)
}

export function evaluateLatestGithubRelease(payload: unknown, currentVersion: string): UpdateCheckResult {
  if (!parseStableVersion(currentVersion)) {
    return { status: 'error', currentVersion, message: 'This Capturo build has an invalid version.' }
  }
  if (!isRecord(payload) || payload.draft !== false || payload.prerelease !== false ||
      typeof payload.tag_name !== 'string') {
    return { status: 'error', currentVersion, message: 'GitHub returned an invalid stable release.' }
  }
  const latest = parseStableVersion(payload.tag_name)
  if (!latest) {
    return { status: 'error', currentVersion, message: 'The latest GitHub release has an invalid version tag.' }
  }
  const latestVersion = latest.join('.')
  const comparison = compareStableVersions(currentVersion, latestVersion)
  if (comparison === null) {
    return { status: 'error', currentVersion, message: 'Capturo could not compare the release versions.' }
  }
  return comparison < 0
    ? { status: 'available', currentVersion, latestVersion }
    : { status: 'up-to-date', currentVersion, latestVersion }
}
