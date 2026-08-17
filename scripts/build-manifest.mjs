// Writes release/BUILD-INFO.txt so a directory of installers can be identified
// without launching them or guessing from timestamps.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const releaseDirectory = path.join(root, 'release')
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const version = manifest.version
const productName = manifest.build?.productName ?? 'Capturo'

const installers = readdirSync(releaseDirectory)
  .filter((name) => name.endsWith('.exe') || name.endsWith('.dmg') || name.endsWith('.zip'))
  .filter((name) => !name.includes('__uninstaller'))
  .sort()

// electron-builder names the unpacked directory after the target platform: win-unpacked on
// Windows, mac-arm64/mac/mac-universal on macOS. Naming it is only useful if the name is the
// real one, so it is read from the directory rather than assumed to be the Windows build.
const unpackedDirectories = readdirSync(releaseDirectory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
  .map((entry) => entry.name)
  .sort()

const lines = [
  `${productName} ${version}`,
  `built ${new Date().toISOString()}`,
  `on ${process.platform}-${process.arch} with Node ${process.version}`,
  '',
  'Artifacts in this directory:',
  ''
]

for (const name of installers) {
  const file = path.join(releaseDirectory, name)
  const bytes = statSync(file).size
  const sha256 = createHash('sha256').update(readFileSync(file)).digest('hex')
  const kind = name.includes('Setup') ? 'installer' : name.includes('Portable') ? 'portable, no install' : 'package'
  lines.push(`  ${name}`)
  lines.push(`    ${kind}, ${(bytes / 1024 / 1024).toFixed(1)} MB`)
  lines.push(`    sha256 ${sha256}`)
  lines.push('')
}

if (unpackedDirectories.length > 0) {
  const named = unpackedDirectories.map((name) => `${name}/`).join(', ')
  const verb = unpackedDirectories.length === 1 ? 'is the unpackaged app' : 'are the unpackaged apps'
  lines.push(`${named} ${verb} used to produce the artifacts above.`)
  lines.push('A build intermediate, not something to distribute.')
  lines.push('')
}
lines.push(`The running app reports its version in the tray tooltip and tray menu.`)

writeFileSync(path.join(releaseDirectory, 'BUILD-INFO.txt'), `${lines.join('\n')}\n`, 'utf8')
console.log(`  • build manifest  file=release/BUILD-INFO.txt version=${version} artifacts=${installers.length}`)
