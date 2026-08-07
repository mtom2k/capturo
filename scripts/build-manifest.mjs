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

lines.push('win-unpacked/ is the unpackaged app used to produce the artifacts above.')
lines.push('It is a build intermediate, not something to distribute.')
lines.push('')
lines.push(`The running app reports its version in the tray tooltip and tray menu.`)

writeFileSync(path.join(releaseDirectory, 'BUILD-INFO.txt'), `${lines.join('\n')}\n`, 'utf8')
console.log(`  • build manifest  file=release/BUILD-INFO.txt version=${version} artifacts=${installers.length}`)
