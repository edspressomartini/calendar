import { deflateSync } from 'node:zlib'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Generates the Up Next application icon (docs/spec.md §6).
 *
 * The geometry and colours below were measured off icons/lockup.png, the
 * designed artwork, which only exists at 512px. Redrawing it from shapes gives
 * a clean edge at every size iconutil asks for, and keeps an image toolchain
 * out of the dependency list (§8.9).
 */

/** Apple's macOS template: the rounded square fills 824 of a 1024 canvas. */
const SQUARE_FRACTION = 824 / 1024
/** Of the square's side. Measured: a plain circular corner, not a squircle. */
const CORNER_RADIUS = 0.2246

interface Rgb {
  readonly r: number
  readonly g: number
  readonly b: number
}

const SNOW: Rgb = { r: 239, g: 249, b: 254 }
const AMBER: Rgb = { r: 251, g: 191, b: 36 }
const WHITE: Rgb = { r: 255, g: 255, b: 255 }

/**
 * Sampled from the artwork at nine even steps. The designed gradient runs on a
 * shallow diagonal, so the position is a weighted blend of the two axes rather
 * than a corner-to-corner sweep.
 */
const GRADIENT_X_WEIGHT = 0.37
const GRADIENT_STOPS: readonly Rgb[] = [
  { r: 88, g: 198, b: 248 },
  { r: 77, g: 193, b: 245 },
  { r: 61, g: 185, b: 241 },
  { r: 45, g: 176, b: 235 },
  { r: 23, g: 163, b: 227 },
  { r: 12, g: 151, b: 216 },
  { r: 9, g: 136, b: 199 },
  { r: 6, g: 121, b: 180 },
  { r: 4, g: 113, b: 170 },
]

/** All fractions of the square's side, origin at its top-left corner. */
const CONTENT_LEFT = 0.164
const BAR_HEIGHT = 0.0957

interface Bar {
  readonly top: number
  readonly width: number
  readonly colour: Rgb
}

const BARS: readonly Bar[] = [
  { top: 0.2207, width: 0.4395, colour: SNOW },
  { top: 0.5, width: 0.5352, colour: AMBER },
  { top: 0.6816, width: 0.3399, colour: SNOW },
]

/** The timeline the marker sits on, between the first and second bars. */
const RULE_CENTRE_Y = 0.4395
const RULE_LENGTH = 0.672
const RULE_THICKNESS = 0.0195
const RULE_ALPHA = 0.55
const MARKER_CENTRE_X = 0.208
const MARKER_RADIUS = 0.042

const ICONSET_SIZES: readonly number[] = [16, 32, 64, 128, 256, 512, 1024]
/** iconutil matches on these names exactly. */
const ICONSET_NAMES: ReadonlyMap<string, number> = new Map([
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
])

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/** Coverage from a signed distance, filtered over roughly one pixel. */
function coverage(distance: number): number {
  return clamp(0.5 - distance, 0, 1)
}

function roundedRectDistance(
  x: number,
  y: number,
  left: number,
  top: number,
  width: number,
  height: number,
  radius: number,
): number {
  const dx = Math.max(left + radius - x, x - (left + width - radius), 0)
  const dy = Math.max(top + radius - y, y - (top + height - radius), 0)
  return Math.hypot(dx, dy) - radius
}

function circleDistance(
  x: number,
  y: number,
  centreX: number,
  centreY: number,
  radius: number,
): number {
  return Math.hypot(x - centreX, y - centreY) - radius
}

function gradientAt(fx: number, fy: number): Rgb {
  const position = clamp(GRADIENT_X_WEIGHT * fx + (1 - GRADIENT_X_WEIGHT) * fy, 0, 1)
  const scaled = position * (GRADIENT_STOPS.length - 1)
  const index = Math.min(GRADIENT_STOPS.length - 2, Math.floor(scaled))
  const blend = scaled - index
  const from = GRADIENT_STOPS[index] as Rgb
  const to = GRADIENT_STOPS[index + 1] as Rgb
  return {
    r: from.r + (to.r - from.r) * blend,
    g: from.g + (to.g - from.g) * blend,
    b: from.b + (to.b - from.b) * blend,
  }
}

function blend(base: Rgb, over: Rgb, alpha: number): Rgb {
  return {
    r: base.r + (over.r - base.r) * alpha,
    g: base.g + (over.g - base.g) * alpha,
    b: base.b + (over.b - base.b) * alpha,
  }
}

/** Draws the mark over the square, in square-relative coordinates. */
function markAt(fx: number, fy: number, side: number): Rgb {
  let colour = gradientAt(fx, fy)

  const ruleTop = RULE_CENTRE_Y - RULE_THICKNESS / 2
  const ruleDistance = roundedRectDistance(
    fx * side,
    fy * side,
    CONTENT_LEFT * side,
    ruleTop * side,
    RULE_LENGTH * side,
    RULE_THICKNESS * side,
    (RULE_THICKNESS / 2) * side,
  )
  colour = blend(colour, WHITE, coverage(ruleDistance) * RULE_ALPHA)

  for (const bar of BARS) {
    const distance = roundedRectDistance(
      fx * side,
      fy * side,
      CONTENT_LEFT * side,
      bar.top * side,
      bar.width * side,
      BAR_HEIGHT * side,
      (BAR_HEIGHT / 2) * side,
    )
    colour = blend(colour, bar.colour, coverage(distance))
  }

  const markerDistance = circleDistance(
    fx * side,
    fy * side,
    MARKER_CENTRE_X * side,
    RULE_CENTRE_Y * side,
    MARKER_RADIUS * side,
  )
  return blend(colour, WHITE, coverage(markerDistance))
}

/** Straight (unpremultiplied) RGBA, as PNG stores it. */
function renderIcon(size: number): Buffer {
  const side = size * SQUARE_FRACTION
  const offset = (size - side) / 2
  const radius = CORNER_RADIUS * side
  const pixels = Buffer.alloc(size * size * 4)

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5
      const py = y + 0.5
      const alpha = coverage(roundedRectDistance(px, py, offset, offset, side, side, radius))
      const index = (y * size + x) * 4
      if (alpha <= 0) {
        continue
      }
      const colour = markAt((px - offset) / side, (py - offset) / side, side)
      pixels[index] = Math.round(clamp(colour.r, 0, 255))
      pixels[index + 1] = Math.round(clamp(colour.g, 0, 255))
      pixels[index + 2] = Math.round(clamp(colour.b, 0, 255))
      pixels[index + 3] = Math.round(alpha * 255)
    }
  }

  return pixels
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData), 0)
  return Buffer.concat([length, typeAndData, crc])
}

/** 8-bit truecolour with alpha (colour type 6). */
function encodePng(pixels: Buffer, size: number): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header.writeUInt8(8, 8)
  header.writeUInt8(6, 9)

  const stride = size * 4
  const raw = Buffer.alloc(size * (1 + stride))
  for (let y = 0; y < size; y += 1) {
    raw.writeUInt8(0, y * (1 + stride))
    pixels.copy(raw, y * (1 + stride) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function main(): void {
  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
  const iconsetDir = join(projectRoot, 'build', 'icon.iconset')
  const iconsDir = join(projectRoot, 'icons')

  rmSync(iconsetDir, { recursive: true, force: true })
  mkdirSync(iconsetDir, { recursive: true })
  mkdirSync(iconsDir, { recursive: true })

  const encoded = new Map<number, Buffer>()
  for (const size of ICONSET_SIZES) {
    encoded.set(size, encodePng(renderIcon(size), size))
  }

  for (const [name, size] of ICONSET_NAMES) {
    writeFileSync(join(iconsetDir, name), encoded.get(size) as Buffer)
  }

  // The master the site, the README card and Google's consent screen crop from.
  writeFileSync(join(iconsDir, 'icon-1024.png'), encoded.get(1024) as Buffer)

  process.stdout.write(`wrote ${ICONSET_NAMES.size} icons to ${iconsetDir}\n`)
}

main()
