// Signs the packaged macOS app, as an electron-builder `afterPack` hook.
//
// electron-builder signs only when it finds a Developer ID Application certificate. With none on
// the host it leaves the bundle exactly as Electron shipped it: linker-signed, carrying the
// identifier "Electron" rather than Capturo's, and with no sealed resources. macOS reports that
// bundle as broken -- `spctl` says "code has no resources but signature indicates they must be
// present" -- so something has to sign it.
//
// Which identity signs it decides whether macOS remembers Capturo's Screen Recording permission.
// TCC stores the app's *designated requirement* when the user grants a permission, and the two
// kinds of signature produce very different requirements:
//
//   ad-hoc          designated => cdhash H"7c7f1a44..."
//   certificate     designated => identifier "com.capturo.app" and certificate leaf H"..."
//
// An ad-hoc requirement is the hash of the app's own code, so every build that changes a single
// byte is a different app as far as TCC is concerned: the Screen Recording toggle stays visibly
// on while the new build is silently denied and prompts again. A certificate-based requirement
// names the certificate instead, which is why Chrome and other signed apps keep their permission
// across updates. Preferring any stable certificate over ad-hoc is therefore the difference
// between a permission granted once and a permission re-granted after every rebuild. See D-028.
//
// Order of preference:
//   1. A Developer ID Application certificate -> stand aside and let electron-builder sign, which
//      is the only path that also allows notarization and distribution.
//   2. A stable local certificate -> sign with it. Grants survive rebuilds, but Gatekeeper still
//      refuses the app on any machine that downloads it. Local development only.
//   3. Nothing -> ad-hoc sign so the bundle at least works, and warn that macOS will keep asking
//      for Screen Recording.
//
// Set CAPTURO_MAC_SIGN_IDENTITY to a certificate name or SHA-1 hash to choose (2) explicitly;
// otherwise a certificate named by LOCAL_IDENTITY_NAME is used when one exists. RELEASING.md
// documents how to create one.

import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import path from 'node:path'

const LOCAL_IDENTITY_NAME = 'Capturo Local Signing'

function security(args) {
  try {
    return execFileSync('security', args, { encoding: 'utf8' })
  } catch {
    // No security tool, or no keychain to read. Treated the same as finding nothing.
    return ''
  }
}

function hasDeveloperIdCertificate() {
  return security(['find-identity', '-v', '-p', 'codesigning']).includes('Developer ID Application')
}

// Resolves the local development certificate to its SHA-1 hash. The unfiltered listing is used on
// purpose: a self-signed certificate is not trusted by the system, so `find-identity -v` hides it
// even though codesign can sign with it perfectly well.
function localSigningIdentity() {
  const explicit = process.env.CAPTURO_MAC_SIGN_IDENTITY?.trim()
  if (explicit) return explicit
  const line = security(['find-identity', '-p', 'codesigning'])
    .split('\n')
    .find((candidate) => candidate.includes(`"${LOCAL_IDENTITY_NAME}"`))
  return line?.match(/\b[0-9A-F]{40}\b/)?.[0] ?? null
}

// Electron ships its Info.plist template with placeholder usage descriptions for the camera,
// microphone, Bluetooth and audio capture, and electron-builder passes them through. Capturo uses
// none of those: screenshots go through desktopCapturer and GIF recording through getDisplayMedia
// with `audio: false`, so Screen Recording is the only permission it can ever trigger. Shipping
// the placeholders tells anyone inspecting the app -- and any future notarization review -- that
// Capturo wants access to hardware it never touches.
//
// macOS terminates an app that triggers a permission with no usage description, so removing one
// is only safe while the matching API is unused. Adding audio to GIF recording would require
// NSMicrophoneUsageDescription and NSAudioCaptureUsageDescription to come back with real text.
const UNUSED_USAGE_DESCRIPTIONS = [
  'NSCameraUsageDescription',
  'NSMicrophoneUsageDescription',
  'NSAudioCaptureUsageDescription',
  'NSBluetoothAlwaysUsageDescription',
  'NSBluetoothPeripheralUsageDescription'
]

function stripUnusedUsageDescriptions(appPath) {
  const plist = path.join(appPath, 'Contents', 'Info.plist')
  const removed = []
  for (const key of UNUSED_USAGE_DESCRIPTIONS) {
    try {
      execFileSync('plutil', ['-remove', key, plist], { stdio: 'ignore' })
      removed.push(key)
    } catch {
      // plutil exits non-zero when the key is already absent, which is the desired end state.
    }
  }
  return removed
}

export default async function signMac(context) {
  if (context.electronPlatformName !== 'darwin') return

  // A universal build packs x64 and arm64 separately into `*-temp` directories and then merges
  // them, and @electron/universal requires every non-binary file to be byte-identical across the
  // two. A code signature never is, so signing the halves fails the merge with "Expected all
  // non-binary files to have identical SHAs ... _CodeSignature/CodeResources did not". Leave the
  // halves alone; electron-builder runs this hook again on the merged bundle, which is the only
  // one that should be signed anyway.
  if (context.appOutDir.endsWith('-temp')) {
    console.log('  • signing deferred  reason=universal build half, the merged bundle is signed instead')
    return
  }

  const bundle = readdirSync(context.appOutDir).find((name) => name.endsWith('.app'))
  if (!bundle) throw new Error(`macOS signing found no .app bundle in ${context.appOutDir}`)
  const appPath = path.join(context.appOutDir, bundle)

  // Before anything signs the bundle, because editing Info.plist afterwards breaks the signature.
  // This runs whoever ends up signing, so a Developer ID build is corrected too.
  const removed = stripUnusedUsageDescriptions(appPath)
  if (removed.length > 0) console.log(`  • removed unused usage descriptions  count=${removed.length}`)

  if (hasDeveloperIdCertificate()) {
    console.log('  • signing delegated  reason=Developer ID Application certificate is present')
    return
  }

  const identity = localSigningIdentity()

  // --deep is the right tool for a pass over an already-assembled bundle. Apple steers
  // distribution signing towards explicit inside-out signing, which is Developer ID's concern.
  execFileSync('codesign', ['--force', '--deep', '--sign', identity ?? '-', appPath], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' })

  if (identity) {
    console.log(`  • signed locally  app=${bundle} identity=${identity}`)
  } else {
    console.log(`  • ad-hoc signed  app=${bundle} reason=no signing certificate`)
    console.log('    macOS will ask for Screen Recording again after every code change, because an')
    console.log('    ad-hoc designated requirement is the app\'s own code hash. See RELEASING.md.')
  }

  // The requirement is the thing that decides whether permissions survive, so print it rather
  // than leaving the build's most consequential property invisible.
  try {
    const requirement = execFileSync('codesign', ['-d', '-r-', appPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const designated = requirement.split('\n').find((line) => line.includes('designated =>'))
    if (designated) console.log(`    ${designated.replace(/^#\s*/, '').trim()}`)
  } catch {
    // Reporting the requirement is diagnostic only; never fail a build over it.
  }
}
