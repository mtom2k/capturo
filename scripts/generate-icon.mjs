import sharp from 'sharp'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = path.dirname(fileURLToPath(import.meta.url))
const sourcePath = path.join(directory, '..', 'build', 'icon-source.png')
const outputPath = path.join(directory, '..', 'build', 'icon.png')
const taskbarOutputPath = path.join(directory, '..', 'build', 'taskbar-icon.png')
const trayDirectory = path.join(directory, '..', 'build', 'tray')

await sharp(sourcePath)
  .resize(512, 512, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
  .png()
  .toFile(outputPath)

// Every brand surface derives from the same supplied logo. Keep these transformations to
// resizing only: there is no secondary tray mark, platform-specific redraw, crop, or mask.
await Promise.all([
  sharp(sourcePath)
    .resize(256, 256, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
    .png()
    .toFile(taskbarOutputPath),
  sharp(sourcePath)
    .resize(16, 16, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
    .png()
    .toFile(path.join(trayDirectory, 'tray-icon.png')),
  sharp(sourcePath)
    .resize(32, 32, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
    .png()
    .toFile(path.join(trayDirectory, 'tray-icon@2x.png'))
])
