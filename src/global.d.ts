import type { CapturoApi } from './shared/types'
import type { CapturoSettingsApi } from './shared/settings'

declare global {
  interface Window {
    capturo: CapturoApi
    capturoSettings: CapturoSettingsApi
  }
}

export {}
