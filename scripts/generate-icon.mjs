// Regenerates every Capturo brand surface from the one canonical logo in build/icon-source.png.
//
// The supplied artwork is kept exactly as delivered, including its opaque background, so the
// canonical file always matches what the designer handed over. Everything platforms actually see
// is derived here, and only in ways recorded in D-009:
//
//   1. the delivered background is keyed out, because an app icon with a baked-in backdrop looks
//      like a coloured tile in the macOS Dock and the Windows notification area;
//   2. sizes are produced by resampling;
//   3. macOS additionally gets a monochrome menu bar template, which cannot be a resize of a
//      colour logo.
//
// Hand-editing any generated PNG defeats all of this. Change the canonical source instead.

import sharp from 'sharp'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const build = path.join(root, 'build')
const trayDirectory = path.join(build, 'tray')
const sourcePath = path.join(build, 'icon-source.png')

// The delivered logo is a mark on a filled backdrop. Only the backdrop connected to the outside
// edges is removed: the focus brackets are as dark as the background but sit inside the card, so
// a connected fill can never reach them. This is the reasoning behind Capturo's own transparency
// tool applied to its own artwork (D-022).
const REACH = 70   // colour distance that still counts as background while spreading inwards
const EDGE = 110   // colour distance at which a pixel is fully artwork

async function transparentMaster() {
  const { data, info } = await sharp(sourcePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: w, height: h } = info
  const corners = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + w - 1) * 4]
  // A source that already ships with transparent corners needs no keying at all.
  if (corners.every((i) => data[i + 3] === 0)) return { data, w, h, cleared: 0 }

  const bg = [data[0], data[1], data[2]]
  const dist = (i) => Math.hypot(data[i] - bg[0], data[i + 1] - bg[1], data[i + 2] - bg[2])
  const outside = new Uint8Array(w * h)
  const stack = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]
  while (stack.length > 0) {
    const [x, y] = stack.pop()
    if (x < 0 || y < 0 || x >= w || y >= h) continue
    const p = y * w + x
    if (outside[p] === 1) continue
    if (dist((y * w + x) * 4) > REACH) continue
    outside[p] = 1
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1])
  }

  let cleared = 0
  for (let p = 0; p < w * h; p++) {
    if (outside[p] === 0) continue
    const i = p * 4
    const a = Math.min(1, dist(i) / EDGE)
    if (a <= 0.004) {
      data[i + 3] = 0
      cleared++
      continue
    }
    // Un-blend the anti-aliased rim. Those pixels are artwork mixed over the delivered backdrop,
    // so recovering the artwork colour is what stops the cutout carrying a dark halo.
    for (let k = 0; k < 3; k++) {
      data[i + k] = Math.max(0, Math.min(255, Math.round((data[i + k] - (1 - a) * bg[k]) / a)))
    }
    data[i + 3] = Math.round(a * 255)
  }
  return { data, w, h, cleared }
}

// macOS renders a menu bar icon as a template: it takes the alpha and paints it itself, light or
// dark, active or inactive. So the mark is reduced to a silhouette and the card it sits on is
// dropped, because a filled rounded square would read as a solid blob between the system glyphs.
const MARK = 200  // luminance below which a pixel belongs to the mark rather than the card
const RAMP = 40

function templateSilhouette({ data, w, h }) {
  const out = Buffer.alloc(w * h * 4, 0)
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 250) continue
    const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
    const a = Math.min(1, (MARK - lum) / RAMP)
    if (a <= 0) continue
    out[i + 3] = Math.round(a * 255)  // black already, only alpha carries the shape
  }
  return out
}

const master = await transparentMaster()
const masterPng = await sharp(master.data, { raw: { width: master.w, height: master.h, channels: 4 } })
  .png()
  .toBuffer()

const resize = (size) => ({ width: size, height: size, fit: 'contain', kernel: sharp.kernel.lanczos3,
  background: { r: 0, g: 0, b: 0, alpha: 0 } })

await Promise.all([
  // electron-builder derives the .icns and .ico from this one.
  sharp(masterPng).resize(resize(1024)).png().toFile(path.join(build, 'icon.png')),
  // Settings window, GIF preview window, and notifications.
  sharp(masterPng).resize(resize(256)).png().toFile(path.join(build, 'taskbar-icon.png')),
  // Windows notification area keeps the colour mark.
  sharp(masterPng).resize(resize(16)).png().toFile(path.join(trayDirectory, 'tray-icon.png')),
  sharp(masterPng).resize(resize(32)).png().toFile(path.join(trayDirectory, 'tray-icon@2x.png'))
])

// Trim to the mark, square it, then leave a little room so the glyph does not touch the edges of
// the menu bar slot the way a system glyph never does.
const silhouette = await sharp(templateSilhouette(master), {
  raw: { width: master.w, height: master.h, channels: 4 }
}).png().toBuffer()
const trimmed = await sharp(silhouette).trim({ threshold: 1 }).toBuffer({ resolveWithObject: true })
const side = Math.max(trimmed.info.width, trimmed.info.height)
const pad = Math.round(side * 0.06)
const squared = await sharp(trimmed.data)
  .extend({
    top: Math.floor((side - trimmed.info.height) / 2) + pad,
    bottom: Math.ceil((side - trimmed.info.height) / 2) + pad,
    left: Math.floor((side - trimmed.info.width) / 2) + pad,
    right: Math.ceil((side - trimmed.info.width) / 2) + pad,
    background: { r: 0, g: 0, b: 0, alpha: 0 }
  })
  .png()
  .toBuffer()

await Promise.all([
  sharp(squared).resize(resize(16)).png().toFile(path.join(trayDirectory, 'tray-iconTemplate.png')),
  sharp(squared).resize(resize(32)).png().toFile(path.join(trayDirectory, 'tray-iconTemplate@2x.png'))
])

const meta = await sharp(sourcePath).metadata()
console.log(`  • icons  source=${meta.width}x${meta.height} backgroundCleared=${master.cleared}px mark=${trimmed.info.width}x${trimmed.info.height}`)
if (meta.width < 1024) {
  console.log(`    note: the package icon is upscaled from a ${meta.width}px source; supply >=1024px for a crisp macOS icns`)
}
