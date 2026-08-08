import type { CapturoApi } from './shared/types'
import type { CapturoSettingsApi } from './shared/settings'
import type { CapturoGifApi } from './shared/gif'

declare global {
  interface Window {
    capturo: CapturoApi
    capturoSettings: CapturoSettingsApi
    capturoGif: CapturoGifApi
  }
}

export {}
