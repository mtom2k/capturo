import type { CapturoApi } from './shared/types'
import type { CapturoSettingsApi } from './shared/settings'
import type { CapturoGifApi } from './shared/gif'
import type { CapturoUpdatesApi } from './shared/updates'
import type { CapturoPermissionsApi } from './shared/permissions'
import type { CapturoColorApi } from './shared/color'

declare global {
  interface Window {
    capturo: CapturoApi
    capturoSettings: CapturoSettingsApi
    capturoGif: CapturoGifApi
    capturoUpdates: CapturoUpdatesApi
    capturoPermissions: CapturoPermissionsApi
    capturoColor: CapturoColorApi
  }
}

export {}
