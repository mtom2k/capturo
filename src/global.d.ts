import type { CapturoApi } from './shared/types'
import type { CapturoSettingsApi } from './shared/settings'
import type { CapturoGifApi } from './shared/gif'
import type { CapturoUpdatesApi } from './shared/updates'
import type { CapturoPermissionsApi } from './shared/permissions'
import type { CapturoColorApi } from './shared/color'
import type { CapturoScrollApi } from './shared/scroll'

declare global {
  interface Window {
    capturo: CapturoApi
    capturoPin: import('./shared/pin').CapturoPinApi
    capturoSettings: CapturoSettingsApi
    capturoGif: CapturoGifApi
    capturoUpdates: CapturoUpdatesApi
    capturoPermissions: CapturoPermissionsApi
    capturoColor: CapturoColorApi
    capturoScroll: CapturoScrollApi
  }
}

export {}
