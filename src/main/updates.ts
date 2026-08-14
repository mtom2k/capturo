import { net } from 'electron'
import { evaluateLatestGithubRelease, type UpdateCheckResult } from '../shared/updates'

const LATEST_RELEASE_API = 'https://api.github.com/repos/mtom2k/capturo/releases/latest'
const REQUEST_TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 256 * 1024

// The request is made only from the main process. It carries no capture data, settings, token,
// or device identifier; only the normal HTTPS request metadata and installed version in the
// User-Agent. Automatic calls are opt-in and scheduled by main/index.ts. See D-025.
export async function checkGithubForUpdate(currentVersion: string): Promise<UpdateCheckResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await net.fetch(LATEST_RELEASE_API, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `Capturo/${currentVersion}`,
        'X-GitHub-Api-Version': '2022-11-28'
      },
      signal: controller.signal
    })
    if (response.status === 403 || response.status === 429) {
      return {
        status: 'error',
        currentVersion,
        message: 'GitHub is temporarily limiting update checks. Try again later.'
      }
    }
    if (response.status === 404) {
      return {
        status: 'error',
        currentVersion,
        message: 'No public Capturo release is available. Private GitHub releases cannot be checked anonymously.'
      }
    }
    if (!response.ok) {
      return {
        status: 'error',
        currentVersion,
        message: `GitHub could not complete the update check (HTTP ${response.status}).`
      }
    }
    const declaredLength = Number(response.headers.get('content-length') ?? 0)
    if (declaredLength > MAX_RESPONSE_BYTES) {
      return { status: 'error', currentVersion, message: 'GitHub returned an unexpectedly large response.' }
    }
    const text = await response.text()
    if (text.length > MAX_RESPONSE_BYTES) {
      return { status: 'error', currentVersion, message: 'GitHub returned an unexpectedly large response.' }
    }
    try {
      return evaluateLatestGithubRelease(JSON.parse(text), currentVersion)
    } catch {
      return { status: 'error', currentVersion, message: 'GitHub returned an unreadable release response.' }
    }
  } catch {
    return {
      status: 'error',
      currentVersion,
      message: 'Could not reach GitHub. Check your internet connection and try again.'
    }
  } finally {
    clearTimeout(timeout)
  }
}
