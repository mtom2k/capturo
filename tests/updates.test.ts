import { describe, expect, it } from 'vitest'
import {
  compareStableVersions,
  evaluateLatestGithubRelease,
  nextAutomaticUpdateDelay,
  parseStableVersion
} from '../src/shared/updates'

describe('stable update versions', () => {
  it('accepts stable semantic versions with an optional v prefix', () => {
    expect(parseStableVersion('v0.16.0')).toEqual([0, 16, 0])
    expect(parseStableVersion('2.4.10')).toEqual([2, 4, 10])
  })

  it('rejects prereleases, incomplete versions, leading zeroes, and unsafe integers', () => {
    expect(parseStableVersion('v0.17.0-beta.1')).toBeNull()
    expect(parseStableVersion('0.17')).toBeNull()
    expect(parseStableVersion('00.17.0')).toBeNull()
    expect(parseStableVersion('9007199254740992.0.0')).toBeNull()
  })

  it('compares major, minor, and patch components numerically', () => {
    expect(compareStableVersions('0.16.0', '0.16.1')).toBe(-1)
    expect(compareStableVersions('0.17.0', '0.16.99')).toBe(1)
    expect(compareStableVersions('v1.0.0', '1.0.0')).toBe(0)
  })
})

describe('automatic update schedule', () => {
  const day = 24 * 60 * 60 * 1000

  it('uses the startup delay before the first check', () => {
    expect(nextAutomaticUpdateDelay(0, 10_000, 15_000, day)).toBe(15_000)
  })

  it('preserves the daily interval across restarts', () => {
    expect(nextAutomaticUpdateDelay(1_000, 1_000 + 60_000, 15_000, day)).toBe(day - 60_000)
    expect(nextAutomaticUpdateDelay(1_000, 1_000 + day, 15_000, day)).toBe(15_000)
  })

  it('bounds a future timestamp to one normal interval', () => {
    expect(nextAutomaticUpdateDelay(10 * day, day, 15_000, day)).toBe(day)
  })
})

describe('GitHub release evaluation', () => {
  it('reports a newer stable release', () => {
    expect(evaluateLatestGithubRelease({ tag_name: 'v0.17.0', draft: false, prerelease: false }, '0.16.0')).toEqual({
      status: 'available',
      currentVersion: '0.16.0',
      latestVersion: '0.17.0'
    })
  })

  it('treats the same or an older published release as up to date', () => {
    expect(evaluateLatestGithubRelease({ tag_name: 'v0.16.0', draft: false, prerelease: false }, '0.16.0').status).toBe('up-to-date')
    expect(evaluateLatestGithubRelease({ tag_name: 'v0.15.2', draft: false, prerelease: false }, '0.16.0').status).toBe('up-to-date')
  })

  it('rejects draft, prerelease, malformed, and invalid-tag responses', () => {
    expect(evaluateLatestGithubRelease({ tag_name: 'v0.17.0', draft: true }, '0.16.0').status).toBe('error')
    expect(evaluateLatestGithubRelease({ tag_name: 'v0.17.0', prerelease: true }, '0.16.0').status).toBe('error')
    expect(evaluateLatestGithubRelease({ tag_name: 'next' }, '0.16.0').status).toBe('error')
    expect(evaluateLatestGithubRelease({ tag_name: 'v0.17.0' }, '0.16.0').status).toBe('error')
    expect(evaluateLatestGithubRelease(null, '0.16.0').status).toBe('error')
  })
})
