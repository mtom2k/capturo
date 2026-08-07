import sharp from 'sharp'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = path.dirname(fileURLToPath(import.meta.url))
const sourcePath = path.join(directory, '..', 'build', 'icon.svg')
const outputPath = path.join(directory, '..', 'build', 'icon.png')

await sharp(sourcePath).resize(512, 512).png().toFile(outputPath)

const trayDirectory = path.join(directory, '..', 'build', 'tray')
await Promise.all([
  sharp(path.join(trayDirectory, 'tray-win.svg')).resize(16, 16).png().toFile(path.join(trayDirectory, 'tray-win-16.png')),
  sharp(path.join(trayDirectory, 'tray-win.svg')).resize(32, 32).png().toFile(path.join(trayDirectory, 'tray-win-32.png')),
  sharp(path.join(trayDirectory, 'tray-template.svg')).resize(16, 16).png().toFile(path.join(trayDirectory, 'trayTemplate.png')),
  sharp(path.join(trayDirectory, 'tray-template.svg')).resize(32, 32).png().toFile(path.join(trayDirectory, 'trayTemplate@2x.png'))
])
