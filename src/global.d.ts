import type { CapturoApi } from './shared/types'

declare global {
  interface Window {
    capturo: CapturoApi
  }
}

export {}
