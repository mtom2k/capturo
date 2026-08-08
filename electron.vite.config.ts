import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    build: {
      rollupOptions: {
        // Renderer pages share one preload: the capture overlay, the settings window, the GIF
        // selection overlay, and the GIF recording control bar. All emit into out/renderer.
        input: {
          index: resolve('src/renderer/index.html'),
          settings: resolve('src/renderer/settings.html'),
          gif: resolve('src/renderer/gif.html'),
          'gif-record': resolve('src/renderer/gif-record.html')
        }
      }
    }
  }
})
