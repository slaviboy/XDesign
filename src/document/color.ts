/**
 * Color conversion. sRGB throughout — no color-management surprises between the
 * picker, the canvas, and the exported PNG.
 */

import type { RGBA } from './types'

export const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 1 }
export const WHITE: RGBA = { r: 255, g: 255, b: 255, a: 1 }
export const TRANSPARENT: RGBA = { r: 0, g: 0, b: 0, a: 0 }

const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n)
const clamp255 = (n: number) => clamp(Math.round(n), 0, 255)
const clamp01 = (n: number) => clamp(n, 0, 1)

export function rgba(r: number, g: number, b: number, a = 1): RGBA {
  return { r: clamp255(r), g: clamp255(g), b: clamp255(b), a: clamp01(a) }
}

export function rgbaEquals(a: RGBA, b: RGBA): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b && Math.abs(a.a - b.a) < 1e-4
}

// ---------------------------------------------------------------------------
// Hex
// ---------------------------------------------------------------------------

export function toHex(c: RGBA, includeAlpha = false): string {
  const h = (n: number) => clamp255(n).toString(16).padStart(2, '0')
  const base = `#${h(c.r)}${h(c.g)}${h(c.b)}`
  return includeAlpha && c.a < 1 ? `${base}${h(c.a * 255)}` : base
}

/** Accepts #rgb, #rgba, #rrggbb, #rrggbbaa, with or without the hash. */
export function parseHex(input: string): RGBA | null {
  const s = input.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]+$/.test(s)) return null
  const dup = (h: string) => Number.parseInt(h + h, 16)
  if (s.length === 3) return rgba(dup(s[0]!), dup(s[1]!), dup(s[2]!), 1)
  if (s.length === 4) return rgba(dup(s[0]!), dup(s[1]!), dup(s[2]!), dup(s[3]!) / 255)
  if (s.length === 6) {
    return rgba(
      Number.parseInt(s.slice(0, 2), 16),
      Number.parseInt(s.slice(2, 4), 16),
      Number.parseInt(s.slice(4, 6), 16),
      1,
    )
  }
  if (s.length === 8) {
    return rgba(
      Number.parseInt(s.slice(0, 2), 16),
      Number.parseInt(s.slice(2, 4), 16),
      Number.parseInt(s.slice(4, 6), 16),
      Number.parseInt(s.slice(6, 8), 16) / 255,
    )
  }
  return null
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

export function toCss(c: RGBA): string {
  return c.a >= 1
    ? `rgb(${c.r} ${c.g} ${c.b})`
    : `rgba(${c.r}, ${c.g}, ${c.b}, ${Number(c.a.toFixed(4))})`
}

/** The color as an SVG `fill`/`stroke` value, with alpha reported separately. */
export function toSvgColor(c: RGBA): { color: string; opacity: number } {
  return { color: toHex(c), opacity: c.a }
}

const NAMED: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff',
  yellow: '#ffff00', cyan: '#00ffff', aqua: '#00ffff', magenta: '#ff00ff', fuchsia: '#ff00ff',
  gray: '#808080', grey: '#808080', silver: '#c0c0c0', maroon: '#800000', olive: '#808000',
  lime: '#00ff00', teal: '#008080', navy: '#000080', purple: '#800080', orange: '#ffa500',
  pink: '#ffc0cb', brown: '#a52a2a', gold: '#ffd700', indigo: '#4b0082', violet: '#ee82ee',
  transparent: '#00000000',
}

/**
 * Parse any CSS color an SVG file might carry: hex, rgb()/rgba(), hsl()/hsla(),
 * a common keyword, or `none`/`transparent`. Returns null when unparseable so
 * the importer can fall back rather than silently painting something black.
 */
export function parseCssColor(input: string): RGBA | null {
  const s = input.trim().toLowerCase()
  if (!s || s === 'none') return null
  if (s in NAMED) return parseHex(NAMED[s]!)
  if (s.startsWith('#')) return parseHex(s)

  const fn = /^(rgba?|hsla?)\s*\(([^)]+)\)$/.exec(s)
  if (!fn) return parseHex(s)

  const name = fn[1]!
  const parts = fn[2]!.split(/[\s,/]+/).filter(Boolean)
  const num = (t: string | undefined, scale = 1): number => {
    if (!t) return 0
    const v = Number.parseFloat(t)
    if (!Number.isFinite(v)) return 0
    return t.endsWith('%') ? (v / 100) * scale : v
  }

  if (name.startsWith('rgb')) {
    const alphaTok = parts[3]
    return rgba(
      num(parts[0], 255),
      num(parts[1], 255),
      num(parts[2], 255),
      alphaTok === undefined ? 1 : alphaTok.endsWith('%') ? num(alphaTok, 1) : Number.parseFloat(alphaTok),
    )
  }

  const h = Number.parseFloat(parts[0] ?? '0')
  const sat = num(parts[1], 1)
  const light = num(parts[2], 1)
  const alphaTok = parts[3]
  const alpha = alphaTok === undefined ? 1 : alphaTok.endsWith('%') ? num(alphaTok, 1) : Number.parseFloat(alphaTok)
  const c = hslToRgb(h, sat > 1 ? sat / 100 : sat, light > 1 ? light / 100 : light)
  return { ...c, a: clamp01(alpha) }
}

// ---------------------------------------------------------------------------
// HSL / HSV
// ---------------------------------------------------------------------------

export interface HSL {
  /** 0..360 */ h: number
  /** 0..1 */ s: number
  /** 0..1 */ l: number
}

export interface HSV {
  /** 0..360 */ h: number
  /** 0..1 */ s: number
  /** 0..1 */ v: number
}

export function hslToRgb(h: number, s: number, l: number): RGBA {
  const hh = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1))
  const m = l - c / 2
  let r: number, g: number, b: number
  if (hh < 60) [r, g, b] = [c, x, 0]
  else if (hh < 120) [r, g, b] = [x, c, 0]
  else if (hh < 180) [r, g, b] = [0, c, x]
  else if (hh < 240) [r, g, b] = [0, x, c]
  else if (hh < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return rgba((r + m) * 255, (g + m) * 255, (b + m) * 255, 1)
}

export function rgbToHsl(c: RGBA): HSL {
  const r = c.r / 255, g = c.g / 255, b = c.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
  else if (max === g) h = ((b - r) / d + 2) * 60
  else h = ((r - g) / d + 4) * 60
  return { h, s, l }
}

/** HSV is what the saturation/value square in the picker actually manipulates. */
export function rgbToHsv(c: RGBA): HSV {
  const r = c.r / 255, g = c.g / 255, b = c.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  const v = max
  const s = max === 0 ? 0 : d / max
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
    else if (max === g) h = ((b - r) / d + 2) * 60
    else h = ((r - g) / d + 4) * 60
  }
  return { h, s, v }
}

export function hsvToRgb(h: number, s: number, v: number, a = 1): RGBA {
  const hh = ((h % 360) + 360) % 360
  const c = v * s
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1))
  const m = v - c
  let r: number, g: number, b: number
  if (hh < 60) [r, g, b] = [c, x, 0]
  else if (hh < 120) [r, g, b] = [x, c, 0]
  else if (hh < 180) [r, g, b] = [0, c, x]
  else if (hh < 240) [r, g, b] = [0, x, c]
  else if (hh < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return rgba((r + m) * 255, (g + m) * 255, (b + m) * 255, a)
}

/** Relative luminance, used to pick readable text over a swatch. */
/**
 * HSV -> HSL and back, without going through RGB.
 *
 * Routing between the two models through 8-bit RGB quantises every value and
 * collapses the hue at the extremes, which makes the hue slider jump while you
 * drag lightness to zero. These are exact.
 */
export function hsvToHsl(h: number, s: number, v: number): HSL {
  const l = v * (1 - s / 2)
  const d = Math.min(l, 1 - l)
  return { h, s: d === 0 ? 0 : (v - l) / d, l }
}

export function hslToHsv(h: number, s: number, l: number): HSV {
  const v = l + s * Math.min(l, 1 - l)
  return { h, s: v === 0 ? 0 : 2 * (1 - l / v), v }
}

export function luminance(c: RGBA): number {
  const f = (n: number) => {
    const v = n / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
}

export function isLight(c: RGBA): boolean {
  return luminance(c) > 0.5
}

export function mixRgba(a: RGBA, b: RGBA, t: number): RGBA {
  const k = clamp01(t)
  return rgba(
    a.r + (b.r - a.r) * k,
    a.g + (b.g - a.g) * k,
    a.b + (b.b - a.b) * k,
    a.a + (b.a - a.a) * k,
  )
}
