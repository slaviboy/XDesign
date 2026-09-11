/*
 * Copyright (C) 2026 Stanislav Georgiev
 * https://github.com/slaviboy
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Riff Studio's shared parts: the palette, the studio screen, the top control
 * bar every screen carries, and the materials the instruments are made of —
 * brushed-metal knobs, piano keys, wood, LEDs, faders, chrome screws.
 *
 * Everything draws through the example kit, so it stays ordinary editable
 * artwork: rectangles, ellipses and paths with gradients, named and grouped.
 */

import { createStop } from '@/document/NodeFactory'
import type {
  BlendMode, DesignDocument, NodeId, Paint, ShadowEffect, StyledNode,
} from '@/document/types'
import { linear, random, rgba, Screen, shadow, solid, type Stop, type TextOptions } from '../kit'
import { statusBar } from '../components'

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

export const W = 1194
export const H = 834

export const C = {
  bg: '#1A1A1E',
  bg2: '#202026',
  panel: '#26262C',
  panel2: '#2E2E35',
  raised: '#36363F',
  line: '#3A3A44',
  hair: '#2A2A31',
  deep: '#111114',
  text: '#F2F2F5',
  dim: '#A3A3AF',
  faint: '#6C6C78',
  amber: '#FFB23F',
  red: '#FF3B30',
  lcd: '#8CF5B0',
  // Track colours, one per instrument family.
  keys: '#4DA3FF',
  drums: '#FFC83D',
  guitar: '#4CD97B',
  bass: '#FF8A3D',
  synth: '#A77BFF',
  strings: '#3DD6D0',
  sampler: '#FF5FA2',
  vocal: '#FF6B6B',
  world: '#E7B25C',
}

/** Panel labels: Inter, small, upper case and letter-spaced. */
export const LABEL: TextOptions = { size: 10, weight: 600, letterSpacing: 0.12, color: C.dim }
export const MONO = 'JetBrains Mono'

// ---------------------------------------------------------------------------
// Paint helpers the kit does not have
// ---------------------------------------------------------------------------

/** A radial gradient with its centre, radius and focal point placed (0..1 of the box). */
export function radialAt(stops: Stop[], cx = 0.5, cy = 0.5, r = 0.5, fx?: number, fy?: number): Paint {
  return {
    type: 'radial',
    cx, cy, r,
    ...(fx !== undefined ? { fx } : {}),
    ...(fy !== undefined ? { fy } : {}),
    stops: stops.map(([hex, offset, a]) => createStop(offset, rgba(hex, a ?? 1))),
  }
}

/** A sweep around the centre — brushed metal and cymbal lathing. */
export function conic(stops: Stop[], rotation = 0): Paint {
  return {
    type: 'angular',
    cx: 0.5,
    cy: 0.5,
    rotation,
    stops: stops.map(([hex, offset, a]) => createStop(offset, rgba(hex, a ?? 1))),
  }
}

/** A coloured glow: a drop shadow in the light's own colour with no offset. */
export function glow(hex: string, blur = 16, alpha = 0.8): ShadowEffect {
  return shadow(0, blur, alpha, 0, hex)
}

/**
 * Brushed metal as bands of a diagonal linear gradient. (An angular sweep
 * looks a touch better but exports to SVG as a fan of wedges, and there are
 * a lot of knobs.)
 */
export const BRUSHED = linear([
  ['#F4F4F6', 0], ['#A2A2A9', 0.2], ['#E9E9EC', 0.42], ['#8E8E95', 0.62], ['#F0F0F2', 0.82], ['#A9A9B0', 1],
], 0, 0, 1, 1)

export const CHROME = linear([['#FAFAFC', 0], ['#B9BAC1', 0.35], ['#6E7078', 0.55], ['#D8D9DE', 0.8], ['#8B8D94', 1]])

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** A point on a circle, angle in degrees clockwise from twelve o'clock. */
export function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)]
}

const f = (n: number) => Number(n.toFixed(2))

/** An arc from a0 to a1 degrees, clockwise from twelve o'clock. */
export function arc(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const [x0, y0] = polar(cx, cy, r, a0)
  const [x1, y1] = polar(cx, cy, r, a1)
  const large = a1 - a0 > 180 ? 1 : 0
  return `M${f(x0)} ${f(y0)} A${r} ${r} 0 ${large} 1 ${f(x1)} ${f(y1)}`
}

/** A ring of short ticks, as one compound path. */
export function ticks(cx: number, cy: number, r0: number, r1: number, count: number, a0 = -135, a1 = 135): string {
  let d = ''
  for (let i = 0; i < count; i++) {
    const a = count === 1 ? a0 : a0 + ((a1 - a0) * i) / (count - 1)
    const [x0, y0] = polar(cx, cy, r0, a)
    const [x1, y1] = polar(cx, cy, r1, a)
    d += `M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}`
  }
  return d
}

/** A circle as a path, so many can share one compound node. */
export function ring(cx: number, cy: number, r: number): string {
  return `M${f(cx - r)} ${f(cy)}a${r} ${r} 0 1 0 ${f(2 * r)} 0a${r} ${r} 0 1 0 ${f(-2 * r)} 0`
}

/** A smooth line through points, as cubic Béziers (Catmull-Rom). */
export function smooth(points: Array<[number, number]>): string {
  if (points.length < 2) return ''
  let d = `M${f(points[0]![0])} ${f(points[0]![1])}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!
    const p1 = points[i]!
    const p2 = points[i + 1]!
    const p3 = points[Math.min(points.length - 1, i + 2)]!
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += `C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2[0])} ${f(p2[1])}`
  }
  return d
}

/**
 * A recorded waveform, mirrored about its centre line, as one closed path.
 * `energy` shapes the loudness over time (0..1 in, 0..1 out).
 */
export function waveform(
  x: number, y: number, w: number, h: number, seed: number, step = 2,
  energy: (t: number) => number = () => 1,
): string {
  const r = random(seed)
  const mid = y + h / 2
  const top: Array<[number, number]> = []
  let v = 0.4
  for (let px = 0; px <= w; px += step) {
    v = Math.min(1, Math.max(0.05, v + (r() - 0.5) * 0.55))
    const beat = 0.55 + 0.45 * Math.abs(Math.sin((px / w) * Math.PI * 8 + seed))
    const a = Math.max(0.04, v * beat * energy(px / w)) * (h / 2)
    top.push([x + px, mid - a])
  }
  let d = `M${f(x)} ${f(mid)}`
  for (const [px, py] of top) d += `L${f(px)} ${f(py)}`
  for (let i = top.length - 1; i >= 0; i--) {
    const [px, py] = top[i]!
    d += `L${f(px)} ${f(2 * mid - py)}`
  }
  return `${d}Z`
}

// ---------------------------------------------------------------------------
// The studio screen
// ---------------------------------------------------------------------------

export interface Transport {
  bar: number
  beat: number
  tempo: number
  key: string
  sig?: string
  /** Which control-bar button is lit. */
  active?: 'songs' | 'browser' | 'tracks' | 'mixer' | 'loops' | 'settings' | 'none'
  playing?: boolean
  recording?: boolean
  cycle?: boolean
}

export class Studio extends Screen {
  constructor(readonly d: DesignDocument, name: string, x: number, y: number, background: string | Paint = C.bg) {
    super(d, name, x, W, H, background, y)
  }

  /** Effects the kit's shape options do not reach: inner shadow, blur, blend. */
  fx(id: NodeId, o: { inner?: ShadowEffect; shadow?: ShadowEffect; blur?: number; blend?: BlendMode }): NodeId {
    const n = this.d.nodes[id] as StyledNode
    if (o.inner) n.style.innerShadow = o.inner
    if (o.shadow) n.style.shadow = o.shadow
    if (o.blur) n.style.blur = { kind: 'object', amount: o.blur, brightness: 0, fillOpacity: 1, visible: true }
    if (o.blend) n.style.blendMode = o.blend
    return id
  }

  /** Text that glows in its own colour — LCD digits, lit labels. */
  lit(name: string, content: string, x: number, y: number, o: TextOptions, blur = 8): NodeId {
    return this.fx(this.text(name, content, x, y, o), { shadow: glow(o.color ?? C.lcd, blur, 0.7) })
  }

  label(name: string, content: string, x: number, y: number, o: Partial<TextOptions> = {}): NodeId {
    return this.text(name, content.toUpperCase(), x, y, { ...LABEL, ...o })
  }
}

// ---------------------------------------------------------------------------
// Icons, on a 24-unit grid
// ---------------------------------------------------------------------------

export const I = {
  songs: 'M4 4.5h6.5v6.5H4z M13.5 4.5H20v6.5h-6.5z M4 13.5h6.5V20H4z M13.5 13.5H20V20h-6.5z',
  browser: 'M3 6h18v12H3z M7.5 6v6.5 M12 6v6.5 M16.5 6v6.5 M5.25 18v-5.5 M9.75 18v-5.5 M14.25 18v-5.5 M18.75 18v-5.5',
  tracks: 'M3 6.5h3 M9 6.5h12 M3 12h3 M9 12h8 M3 17.5h3 M9 17.5h10',
  mixer: 'M6 4v16 M12 4v16 M18 4v16 M3.5 14h5 M9.5 8h5 M15.5 16h5',
  undo: 'M9 5L4.5 9.5 9 14 M4.5 9.5H14a5.5 5.5 0 0 1 0 11h-3',
  rewind: 'M5.5 5.5v13 M19 5.5l-10 6.5 10 6.5z',
  play: 'M7.5 4.5v15L19.5 12z',
  stop: 'M6 6h12v12H6z',
  cycle: 'M4 10V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2 M20 14v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2 M16.5 3.5L19 6l-2.5 2.5 M7.5 15.5L5 18l2.5 2.5',
  metronome: 'M9.2 3.5h5.6L19 20.5H5z M7.3 16.5h9.4 M12 16.5l5.2-11',
  loops: 'M12 12c-2.2-3.2-4-4.8-6-4.8a4.8 4.8 0 0 0 0 9.6c2 0 3.8-1.6 6-4.8s4-4.8 6-4.8a4.8 4.8 0 0 1 0 9.6c-2 0-3.8-1.6-6-4.8z',
  settings: 'M14.7 3.8a4.6 4.6 0 0 0-4.4 6.2L3.8 16.5a1.9 1.9 0 0 0 2.7 2.7L13 12.7a4.6 4.6 0 0 0 6.2-4.4l-2.8 2.8-2.6-.7-.7-2.6z',
  speaker: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4z M15.5 9a4 4 0 0 1 0 6 M18 6.5a7.5 7.5 0 0 1 0 11',
  plus: 'M12 5v14 M5 12h14',
  minus: 'M5 12h14',
  chevronLeft: 'M14.5 6l-6 6 6 6',
  chevronRight: 'M9.5 6l6 6-6 6',
  chevronDown: 'M6 9.5l6 6 6-6',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13z M20 20l-4.8-4.8',
  star: 'M12 3.8l2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z',
  heart: 'M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20z',
  more: 'M5.5 12h.01 M12 12h.01 M18.5 12h.01',
  dice: 'M5 5h14v14H5z M9 9h.01 M15 9h.01 M12 12h.01 M9 15h.01 M15 15h.01',
  trash: 'M4 7h16 M9.5 7V5h5v2 M6.5 7l1 13h9l1-13',
  sort: 'M7 4v16 M3.5 16.5L7 20l3.5-3.5 M17 20V4 M13.5 7.5L17 4l3.5 3.5',
  select: 'M4 12.5l5 5L20 6.5',
  folder: 'M3 6.5a1.5 1.5 0 0 1 1.5-1.5h5l2 2.5h8a1.5 1.5 0 0 1 1.5 1.5v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z',
  share: 'M12 15V3.5 M7.5 8L12 3.5 16.5 8 M5 12v7.5h14V12',
  close: 'M6 6l12 12 M18 6L6 18',
  mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z M5.5 11a6.5 6.5 0 0 0 13 0 M12 17.5V21 M8.5 21h7',
  keyboard: 'M3 6h18v12H3z M7.5 6v6.5 M12 6v6.5 M16.5 6v6.5 M5.25 18v-5.5 M9.75 18v-5.5 M14.25 18v-5.5 M18.75 18v-5.5',
  drum: 'M4 9c0-1.9 3.6-3.4 8-3.4s8 1.5 8 3.4v7c0 1.9-3.6 3.4-8 3.4s-8-1.5-8-3.4z M4 9c0 1.9 3.6 3.4 8 3.4s8-1.5 8-3.4 M7 12.2v6.6 M12 12.4v7 M17 12.2v6.6',
  guitar: 'M13.8 10.2L20.5 3.5 M18.5 2.5l3 3 M10.6 9.2c-1.3-1.1-3.5-1.1-4.7.1-.8.8-1 1.8-.8 2.7-1.2.2-2.3.8-2.8 2-1 2.4 1.2 5.6 4.1 6.1 1.7.3 3-.5 3.5-1.9.8-.2 1.5-.7 1.9-1.4.9.5 2.3.3 3.2-.6 1.2-1.2 1.2-3.4.1-4.7z M8 16l2.2-2.2',
  bass: 'M14 10L20.5 3.5 M18.2 2.2l3.6 3.6 M10.4 9.5c-1.6-1-3.6-.8-4.8.4-.7.7-.9 1.6-.8 2.5-1.3.3-2.4 1-2.8 2.2-.9 2.4 1.4 5.5 4.3 5.9 1.6.2 2.9-.6 3.3-2 .9-.3 1.6-.9 1.9-1.8.9.3 2 0 2.8-.8 1.2-1.2 1.4-3.2.4-4.8z M7.6 16.4l2.6-2.6',
  violin: 'M12 2.5v4 M10.5 6.5h3 M9 7.5c-1.5 0-2.5 1.2-2.5 2.6 0 .9.5 1.6 1.2 2-1 .6-1.7 1.7-1.7 3 0 2.4 2.3 4.4 6 4.4s6-2 6-4.4c0-1.3-.7-2.4-1.7-3 .7-.4 1.2-1.1 1.2-2 0-1.4-1-2.6-2.5-2.6z M12 9.5v8 M10.2 14.5h3.6',
  wave: 'M2.5 12h2l1.5-4 2.5 9 2.5-12 2.5 14 2.5-10 2 5 1.5-2h2.5',
  synth: 'M3 12c1.5-5 3-7 4.5-7S10.5 19 12 19s3-7 4.5-14S19.5 12 21 12',
  sampler: 'M4 4h16v16H4z M4 9.5h16 M9.5 9.5V20 M15 9.5V20 M7 6.8h.01 M10 6.8h7',
  zither: 'M3 16.5L17.5 4 M5.5 19L20 6.5 M3 16.5l2.5 2.5 M17.5 4L20 6.5 M8 13.5l1.5 1.5 M12 10l1.5 1.5 M15.5 7l1.5 1.5',
  pad: 'M4 4h16v16H4z M12 4v16 M4 12h16 M16 8h.01',
  headphones: 'M4 15.5v-3a8 8 0 0 1 16 0v3 M4 15h3.5v5H5a1 1 0 0 1-1-1z M20 15h-3.5v5H19a1 1 0 0 0 1-1z',
  lock: 'M6 10.5h12v9.5H6z M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5',
  hand: 'M8 12V5.5a1.5 1.5 0 0 1 3 0V11 M11 10V4a1.5 1.5 0 0 1 3 0v6 M14 10V5.5a1.5 1.5 0 0 1 3 0V13 M8 11.5l-1.2-1.3a1.6 1.6 0 0 0-2.4 2.1L8 17.5c1.2 2 2.8 3 5 3 3 0 4-2.2 4-5V11',
  shuffle: 'M3.5 7h3c3.5 0 5.5 10 9 10h4 M17.5 14.5L20 17l-2.5 2.5 M3.5 17h3c1.5 0 2.5-1.8 3.5-4 M13.5 9c1-1.2 1.8-2 3-2h3 M17.5 4.5L20 7l-2.5 2.5',
  bolt: 'M13 3L5.5 13.5h6L10.5 21 18.5 10.5h-6z',
  grid: 'M4 4h16v16H4z M4 9.3h16 M4 14.7h16 M9.3 4v16 M14.7 4v16',
  scissors: 'M6 7.5a2.5 2.5 0 1 0 .01 0 M6 16.5a2.5 2.5 0 1 0 .01 0 M8.2 8.7L20 17 M8.2 15.3L20 7',
  reverse: 'M20 12H5 M10 6.5L4.5 12l5.5 5.5',
  zoom: 'M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13z M20 20l-4.8-4.8 M10.5 8v5 M8 10.5h5',
  tap: 'M12 8.5a3.5 3.5 0 1 0 .01 0 M12 4a8 8 0 1 0 .01 0',
  clock: 'M12 3.5a8.5 8.5 0 1 0 .01 0 M12 7.5V12l3 2',
  note: 'M9 18.5a2.5 2.5 0 1 1-2.5-2.5H9V5l10-2v12.5 M19 15.5a2.5 2.5 0 1 1-2.5-2.5H19',
  robot: 'M6 8.5h12v10H6z M12 5v3.5 M12 4.5h.01 M9.5 12.5h.01 M14.5 12.5h.01 M9.5 15.5h5 M3.5 12v3 M20.5 12v3',
  phone: 'M7 3.5h3l1.5 4.5-2 1.3a10 10 0 0 0 5.2 5.2l1.3-2 4.5 1.5v3a2.5 2.5 0 0 1-2.5 2.5A15 15 0 0 1 4.5 6 2.5 2.5 0 0 1 7 3.5z',
  megaphone: 'M4 10v4h3l8 4.5v-13L7 10z M18 9.5a3.5 3.5 0 0 1 0 5 M7 14l1.5 5.5h2.5L10 15.3',
  sparkle: 'M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8z M18.5 16l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z',
  wave3: 'M3 12h3 M8 7v10 M12 4v16 M16 8v8 M20 11v2',
  arena: 'M3 18c2-6 5.5-9 9-9s7 3 9 9 M6.5 18c1.4-3.6 3.3-5.5 5.5-5.5s4.1 1.9 5.5 5.5 M12 4v2.5 M5.5 6.5l1.5 2 M18.5 6.5l-1.5 2',
  monster: 'M5 20V10a7 7 0 0 1 14 0v10l-2.5-2-2.3 2-2.2-2-2.2 2-2.3-2z M9.5 11h.01 M14.5 11h.01',
  chipmunk: 'M7 9.5a5 5 0 0 1 10 0c2 .5 3 2.3 3 4.5 0 3.5-3.5 6-8 6s-8-2.5-8-6c0-2.2 1-4 3-4.5z M7.5 5.5L6 3 M16.5 5.5L18 3 M9.5 12.5h.01 M14.5 12.5h.01 M11 16h2',
  cosmic: 'M12 7a5 5 0 1 0 .01 0 M3 15c3-.5 7-2 10.5-4.5S19.5 6 21 5',
  echo: 'M4 12a8 8 0 0 1 8-8 M7 12a5 5 0 0 1 5-5 M10 12a2 2 0 0 1 2-2 M20 12a8 8 0 0 1-8 8 M17 12a5 5 0 0 1-5 5 M14 12a2 2 0 0 1-2 2',
}

// ---------------------------------------------------------------------------
// The control bar
// ---------------------------------------------------------------------------

const BAR_Y = 40
const BAR_H = 56

function barButton(s: Studio, name: string, icon: string, x: number, on: boolean, o: { fill?: Paint | string; iconColor?: string; iconFill?: string; w?: number } = {}): NodeId {
  const w = o.w ?? 44
  const y = BAR_Y + 10
  const bg = on ? linear([['#4A4A55', 0], ['#3A3A44', 1]]) : linear([['#35353D', 0], ['#2C2C33', 1]])
  const colour = o.iconColor ?? (on ? C.amber : '#E6E6EC')
  return s.group(`Button / ${name}`, [
    s.rect('Background', x, y, w, 36, {
      fill: o.fill ?? bg, radius: 8, stroke: { color: '#000000', width: 1, alpha: 0.35 }, shadow: shadow(1, 0, 0.25, 0, '#000000'),
    }),
    s.icon('Icon', icon, x + (w - 20) / 2, y + 8, 20, colour, o.iconFill ? { fill: o.iconFill, width: 1.6 } : { width: 1.8 }),
  ])
}

/** The LCD: position, tempo, time signature and key, backlit green. */
function lcd(s: Studio, t: Transport, x: number, y: number, w: number, h: number): NodeId {
  const digits = { size: 22, weight: 500, family: MONO, color: C.lcd }
  const small = { size: 8, weight: 600, family: 'Inter', letterSpacing: 0.14, color: C.lcd, opacity: 0.55 }
  const ghost = { ...digits, color: C.lcd, opacity: 0.05 }
  const pos = `${String(t.bar).padStart(3, ' ')}.${t.beat}`
  const ids = [
    s.fx(s.rect('Glass', x, y, w, h, {
      fill: linear([['#14301F', 0], ['#0B1C12', 0.55], ['#0E2418', 1]]), radius: 7, stroke: { color: '#000000', width: 1.5, alpha: 0.8 },
    }), { inner: shadow(2, 6, 0.7, 0, '#000000') }),
    s.rect('Glare', x + 3, y + 2, w - 6, h / 2 - 2, { fill: linear([['#FFFFFF', 0, 0.07], ['#FFFFFF', 1, 0]]), radius: [5, 5, 0, 0] }),
    s.text('Position Ghost', '888.8', x + 12, y + 3, ghost),
    s.lit('Position', pos, x + 12, y + 3, digits),
    s.label('Position Label', 'bar      beat', x + 14, y + 31, small),
    s.rect('Divider 1', x + 110, y + 8, 1, h - 16, { fill: C.lcd, opacity: 0.18 }),
    s.text('Tempo Ghost', '888', x + 124, y + 3, ghost),
    s.lit('Tempo', String(t.tempo).padStart(3, ' '), x + 124, y + 3, digits),
    s.label('Tempo Label', 'tempo', x + 126, y + 31, small),
    s.rect('Divider 2', x + 180, y + 8, 1, h - 16, { fill: C.lcd, opacity: 0.18 }),
    s.lit('Signature', t.sig ?? '4/4', x + 194, y + 5, { size: 13, weight: 500, family: MONO, color: C.lcd }),
    s.lit('Key', t.key, x + 194, y + 22, { size: 13, weight: 500, family: MONO, color: C.lcd }),
  ]
  return s.group('LCD', ids)
}

export function controlBar(s: Studio, t: Transport): NodeId {
  const a = t.active ?? 'none'
  const ids: NodeId[] = [
    s.rect('Background', 0, BAR_Y, W, BAR_H, { fill: linear([['#303037', 0], ['#232328', 1]]) }),
    s.rect('Top Highlight', 0, BAR_Y, W, 1, { fill: '#FFFFFF', opacity: 0.06 }),
    s.rect('Bottom Edge', 0, BAR_Y + BAR_H - 1, W, 1, { fill: '#000000', opacity: 0.7 }),
    s.group('Navigation', [
      barButton(s, 'My Songs', I.songs, 16, a === 'songs'),
      barButton(s, 'Instruments', I.browser, 68, a === 'browser'),
      barButton(s, 'Tracks', I.tracks, 120, a === 'tracks'),
      barButton(s, 'Mixer', I.mixer, 172, a === 'mixer'),
      barButton(s, 'Undo', I.undo, 236, false),
    ]),
  ]
  const tx = 365
  const playOn = !!t.playing
  ids.push(s.group('Transport', [
    barButton(s, 'Go to Beginning', I.rewind, tx, false, { iconFill: '#E6E6EC' }),
    barButton(s, 'Play', playOn ? I.stop : I.play, tx + 52, playOn, {
      iconColor: playOn ? '#FFFFFF' : '#E6E6EC', iconFill: playOn ? '#FFFFFF' : '#E6E6EC',
      ...(playOn ? { fill: linear([['#34C26A', 0], ['#20954D', 1]]) } : {}),
    }),
    s.group('Button / Record', [
      s.rect('Background', tx + 104, BAR_Y + 10, 44, 36, {
        fill: t.recording ? linear([['#FF5147', 0], ['#D9241B', 1]]) : linear([['#35353D', 0], ['#2C2C33', 1]]),
        radius: 8, stroke: { color: '#000000', width: 1, alpha: 0.35 },
        ...(t.recording ? { shadow: glow(C.red, 14, 0.6) } : {}),
      }),
      s.circle('Dot', tx + 126, BAR_Y + 28, 8, { fill: t.recording ? '#FFFFFF' : radialAt([['#FF6B61', 0], [C.red, 0.6], ['#C0180F', 1]], 0.4, 0.35, 0.7) }),
    ]),
  ]))
  ids.push(lcd(s, t, tx + 164, BAR_Y + 6, 300, 44))
  const vx = 846
  ids.push(s.group('Master Volume', [
    s.icon('Speaker', I.speaker, vx, BAR_Y + 18, 20, C.dim, { width: 1.8 }),
    s.rect('Track', vx + 28, BAR_Y + 26, 92, 4, { fill: '#121215', radius: 2 }),
    s.rect('Level', vx + 28, BAR_Y + 26, 64, 4, { fill: '#E6E6EC', radius: 2 }),
    s.circle('Thumb', vx + 92, BAR_Y + 28, 9, { fill: linear([['#FFFFFF', 0], ['#CFCFD6', 1]]), shadow: shadow(2, 4, 0.5, 0, '#000000') }),
  ]))
  ids.push(s.group('Options', [
    barButton(s, 'Cycle', I.cycle, 978, !!t.cycle),
    barButton(s, 'Metronome', I.metronome, 1030, true),
    barButton(s, 'Loop Browser', I.loops, 1082, a === 'loops'),
    barButton(s, 'Song Settings', I.settings, 1134, a === 'settings'),
  ]))
  return s.group('Control Bar', ids)
}

/** Status bar, control bar — what every screen starts with. */
export function chrome(s: Studio, t: Transport): void {
  statusBar(s, '#FFFFFF', { wide: true })
  controlBar(s, t)
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

export type KnobStyle = 'metal' | 'black' | 'cream' | 'chicken' | 'amp'

export interface KnobOptions {
  label?: string
  value?: string
  color?: string
  style?: KnobStyle
  /** Draw the value arc around the knob. */
  arc?: boolean
  /** Tick marks around the knob, like a printed scale. */
  scale?: number
  labelColor?: string
  labelBelow?: number
}

/**
 * A knob: a printed scale, a value arc in the knob's colour, a skirt, a cap
 * of brushed metal (or plastic) and an indicator line at `v` of its travel.
 */
export function knob(s: Studio, name: string, cx: number, cy: number, r: number, v: number, o: KnobOptions = {}): NodeId {
  const style = o.style ?? 'metal'
  const colour = o.color ?? C.amber
  const angle = -135 + 270 * v
  const ids: NodeId[] = []
  if (o.scale) ids.push(s.path('Scale', ticks(cx, cy, r + 5, r + 9, o.scale), { stroke: o.labelColor ?? C.faint, width: 1.2 }))
  if (o.arc ?? style !== 'amp') {
    const ar = r + (o.scale ? 13 : 7)
    ids.push(s.path('Track', arc(cx, cy, ar, -135, 135), { stroke: '#0C0C0F', width: 3.5 }))
    if (v > 0.01) ids.push(s.fx(s.path('Value', arc(cx, cy, ar, -135, angle), { stroke: colour, width: 3.5 }), { shadow: glow(colour, 6, 0.5) }))
  }
  if (style === 'metal') {
    ids.push(
      s.circle('Skirt', cx, cy, r, {
        fill: linear([['#9A9AA2', 0], ['#4A4A52', 0.45], ['#1A1A1E', 1]]),
        shadow: shadow(r * 0.18, r * 0.45, 0.7, 0, '#000000'),
      }),
      s.path('Knurling', ticks(cx, cy, r * 0.84, r * 0.98, 36, 0, 350), { stroke: '#000000', width: 1, alpha: 0.45 }),
      s.circle('Cap', cx, cy, r * 0.78, { fill: BRUSHED, stroke: { color: '#FFFFFF', width: 1, alpha: 0.4 } }),
      s.circle('Sheen', cx, cy, r * 0.78, { fill: radialAt([['#FFFFFF', 0, 0.45], ['#FFFFFF', 1, 0]], 0.35, 0.25, 0.6) }),
    )
    const [x0, y0] = polar(cx, cy, r * 0.2, angle)
    const [x1, y1] = polar(cx, cy, r * 0.72, angle)
    ids.push(s.line('Indicator', x0, y0, x1, y1, '#18181C', Math.max(2, r * 0.1)))
  } else if (style === 'black') {
    ids.push(
      s.circle('Skirt', cx, cy, r, {
        fill: linear([['#3E3E45', 0], ['#141417', 1]]), shadow: shadow(r * 0.2, r * 0.5, 0.75, 0, '#000000'),
      }),
      s.circle('Cap', cx, cy, r * 0.8, { fill: linear([['#2F2F35', 0], ['#1A1A1E', 1]]), stroke: { color: '#FFFFFF', width: 1, alpha: 0.12 } }),
      s.circle('Sheen', cx, cy, r * 0.8, { fill: radialAt([['#FFFFFF', 0, 0.16], ['#FFFFFF', 1, 0]], 0.4, 0.2, 0.55) }),
    )
    const [x0, y0] = polar(cx, cy, r * 0.35, angle)
    const [x1, y1] = polar(cx, cy, r * 0.9, angle)
    ids.push(s.line('Indicator', x0, y0, x1, y1, colour, Math.max(2, r * 0.1)))
  } else if (style === 'cream' || style === 'amp') {
    const amp = style === 'amp'
    ids.push(
      s.circle('Skirt', cx, cy, r, {
        fill: amp ? linear([['#3A3A3A', 0], ['#0E0E0E', 1]]) : linear([['#F3E9D2', 0], ['#B9A887', 1]]),
        shadow: shadow(r * 0.2, r * 0.5, 0.7, 0, '#000000'),
      }),
      s.path('Knurling', ticks(cx, cy, r * 0.8, r * 0.98, 28, 0, 347), { stroke: amp ? '#FFFFFF' : '#6E5E40', width: 1.2, alpha: amp ? 0.12 : 0.5 }),
      s.circle('Cap', cx, cy, r * 0.72, {
        fill: amp ? BRUSHED : linear([['#FFF8E8', 0], ['#DCCFB2', 1]]),
      }),
      s.circle('Sheen', cx, cy, r * 0.72, { fill: radialAt([['#FFFFFF', 0, 0.5], ['#FFFFFF', 1, 0]], 0.35, 0.25, 0.6) }),
    )
    const [x0, y0] = polar(cx, cy, r * 0.25, angle)
    const [x1, y1] = polar(cx, cy, r * 0.95, angle)
    ids.push(s.line('Indicator', x0, y0, x1, y1, amp ? '#1A1A1A' : '#2A2016', Math.max(2, r * 0.1)))
  } else {
    // Chicken-head pointer on a round base.
    ids.push(s.circle('Base', cx, cy, r * 0.8, {
      fill: linear([['#2E2E30', 0], ['#0D0D0E', 1]]), shadow: shadow(r * 0.2, r * 0.5, 0.7, 0, '#000000'),
    }))
    const [tx, ty] = polar(cx, cy, r * 1.05, angle)
    const [lx, ly] = polar(cx, cy, r * 0.42, angle - 90)
    const [rx, ry] = polar(cx, cy, r * 0.42, angle + 90)
    const [bx, by] = polar(cx, cy, r * 0.6, angle + 180)
    ids.push(s.path('Pointer', `M${f(tx)} ${f(ty)}L${f(lx)} ${f(ly)}Q${f(bx)} ${f(by)} ${f(rx)} ${f(ry)}Z`, {
      fill: linear([['#F6EEDC', 0], ['#C9B994', 1]]), closed: true,
    }))
    ids.push(s.line('Indicator', cx, cy, ...polar(cx, cy, r * 0.95, angle), '#1A1A1A', 1.5))
  }
  if (o.label) {
    const below = o.labelBelow ?? r + 12
    ids.push(s.text('Label', o.label.toUpperCase(), cx, cy + below, { ...LABEL, color: o.labelColor ?? C.dim, anchor: 'center' }))
  }
  if (o.value) {
    const below = (o.labelBelow ?? r + 12) + 15
    ids.push(s.text('Value', o.value, cx, cy + below, { size: 11, weight: 500, family: MONO, color: C.text, anchor: 'center' }))
  }
  return s.group(`Knob / ${name}`, ids)
}

/** An LED in a chrome bezel. */
export function led(s: Studio, name: string, cx: number, cy: number, colour: string, on: boolean, r = 4): NodeId {
  return s.group(`LED / ${name}`, [
    s.circle('Bezel', cx, cy, r + 1.5, { fill: linear([['#0A0A0C', 0], ['#4A4A52', 1]]) }),
    s.circle('Lens', cx, cy, r, {
      fill: on ? radialAt([['#FFFFFF', 0], [colour, 0.45], [colour, 1, 0.9]], 0.4, 0.35, 0.65) : radialAt([[colour, 0, 0.35], ['#101012', 1]], 0.4, 0.35, 0.7),
      ...(on ? { shadow: glow(colour, r * 3, 0.9) } : {}),
    }),
  ])
}

/** A chrome screw head. */
export function screw(s: Studio, cx: number, cy: number, r = 5, angle = 30): NodeId {
  const [x0, y0] = polar(cx, cy, r * 0.7, angle)
  const [x1, y1] = polar(cx, cy, r * 0.7, angle + 180)
  return s.group('Screw', [
    s.circle('Head', cx, cy, r, { fill: linear([['#F0F0F3', 0], ['#8E8F96', 0.6], ['#5A5B61', 1]]), shadow: shadow(1, 2, 0.6, 0, '#000000') }),
    s.line('Slot', x0, y0, x1, y1, '#3A3B40', 1.4),
  ])
}

/**
 * Wood: a base gradient and grain as one compound path of long, slightly
 * wavering strokes, so a whole panel's grain is one editable layer.
 */
export function wood(
  s: Studio, name: string, x: number, y: number, w: number, h: number,
  o: { base?: Stop[]; grain?: string; seed?: number; radius?: number; vertical?: boolean; alpha?: number } = {},
): NodeId {
  const base = o.base ?? [['#8A5530', 0], ['#6E3F20', 0.5], ['#5A321A', 1]]
  const r = random(o.seed ?? 7)
  let d = ''
  const lines = Math.round((o.vertical ? w : h) / 6)
  const len = o.vertical ? h : w
  for (let i = 0; i < lines; i++) {
    const off = ((i + r() * 0.8) / lines) * (o.vertical ? w : h)
    const amp = 1 + r() * 3
    const seg = 90 + r() * 110
    // Each grain line wavers by quadratic curves: few points, smooth result.
    let path = ''
    for (let t = 0; t <= len + seg; t += seg) {
      const tt = Math.min(t, len)
      const wob = (Math.floor(t / seg) % 2 ? 1 : -1) * amp
      const pt = (a: number, b: number) => (o.vertical ? `${f(x + off + b)} ${f(y + a)}` : `${f(x + a)} ${f(y + off + b)}`)
      path += path ? `Q${pt(tt - seg / 2, wob * 1.6)} ${pt(tt, 0)}` : `M${pt(0, 0)}`
      if (tt >= len) break
    }
    d += path
  }
  const ids = [
    s.rect('Wood', x, y, w, h, { fill: linear(base, 0, 0, o.vertical ? 1 : 0, o.vertical ? 0 : 1), radius: o.radius ?? 0 }),
    s.path('Grain', d, { stroke: o.grain ?? '#2A1408', width: 1, alpha: o.alpha ?? 0.22 }),
  ]
  return s.group(name, ids)
}

/** A pill-shaped segmented control. */
export function segmented(
  s: Studio, name: string, x: number, y: number, labels: string[], active: number,
  o: { w?: number; h?: number; accent?: string; size?: number } = {},
): { id: NodeId; width: number } {
  const h = o.h ?? 32
  const size = o.size ?? 12
  const widths = labels.map((l) => o.w ?? s.measure(l, { size, weight: 600 }).width + 28)
  const total = widths.reduce((a, b) => a + b, 0) + 4
  const ids: NodeId[] = [
    s.fx(s.rect('Track', x, y, total, h, { fill: '#141417', radius: h / 2, stroke: { color: '#000000', width: 1, alpha: 0.5 } }), {
      inner: shadow(1, 3, 0.6, 0, '#000000'),
    }),
  ]
  let cx = x + 2
  labels.forEach((l, i) => {
    const on = i === active
    const parts: NodeId[] = []
    if (on) {
      parts.push(s.rect('Thumb', cx, y + 2, widths[i]!, h - 4, {
        fill: linear([['#4E4E59', 0], ['#3C3C45', 1]]), radius: (h - 4) / 2, shadow: shadow(1, 3, 0.5, 0, '#000000'),
      }))
    }
    parts.push(s.centeredText('Label', l, { x: cx, y: y + 1, w: widths[i]!, h: h - 2 }, {
      size, weight: 600, color: on ? (o.accent ?? '#FFFFFF') : C.dim,
    }))
    ids.push(s.group(`Segment / ${l}`, parts))
    cx += widths[i]!
  })
  return { id: s.group(name, ids), width: total }
}

/** An on/off switch. */
export function toggle(s: Studio, name: string, x: number, y: number, on: boolean, accent = C.guitar): NodeId {
  return s.group(`Toggle / ${name}`, [
    s.fx(s.rect('Track', x, y, 46, 26, { fill: on ? accent : '#141417', radius: 13 }), { inner: shadow(1, 3, 0.4, 0, '#000000') }),
    s.circle('Thumb', on ? x + 33 : x + 13, y + 13, 11, { fill: linear([['#FFFFFF', 0], ['#DEDEE4', 1]]), shadow: shadow(2, 4, 0.4, 0, '#000000') }),
  ])
}

/** A rounded, raised panel button with a label (and optional LED). */
export function panelButton(
  s: Studio, name: string, x: number, y: number, w: number, h: number,
  o: { on?: boolean; accent?: string; icon?: string; size?: number; label?: string } = {},
): NodeId {
  const on = !!o.on
  const accent = o.accent ?? C.amber
  const ids: NodeId[] = [
    s.rect('Background', x, y, w, h, {
      fill: on ? linear([['#4A4A55', 0], ['#383841', 1]]) : linear([['#34343C', 0], ['#27272D', 1]]),
      radius: 8, stroke: { color: on ? accent : '#000000', width: 1, alpha: on ? 0.9 : 0.4 },
      shadow: shadow(2, 3, 0.45, 0, '#000000'),
    }),
  ]
  const label = o.label ?? name
  const text = { size: o.size ?? 12, weight: 600, color: on ? accent : C.text }
  if (o.icon) {
    const tw = label ? s.measure(label, text).width : 0
    const total = 18 + (label ? 8 + tw : 0)
    const left = x + (w - total) / 2
    ids.push(s.icon('Icon', o.icon, left, y + (h - 18) / 2, 18, on ? accent : C.text, { width: 1.8 }))
    if (label) ids.push(s.text('Label', label, left + 26, y + (h - s.measure(label, text).height) / 2, text))
  } else {
    ids.push(s.centeredText('Label', label, { x, y, w, h }, text))
  }
  return s.group(`Button / ${name}`, ids)
}

/** A vertical fader with a slot, a scale and a ribbed cap. */
export function fader(s: Studio, name: string, x: number, y: number, h: number, v: number, o: { cap?: string; scale?: boolean } = {}): NodeId {
  const capY = y + (1 - v) * (h - 28)
  const ids: NodeId[] = []
  if (o.scale !== false) {
    let d = ''
    for (let i = 0; i <= 10; i++) {
      const ty = y + 14 + ((h - 28) * i) / 10
      const len = i % 5 === 0 ? 8 : 5
      d += `M${x - 14 - len} ${ty}h${len}M${x + 14} ${ty}h${len}`
    }
    ids.push(s.path('Scale', d, { stroke: C.faint, width: 1 }))
  }
  ids.push(s.fx(s.rect('Slot', x - 3, y, 6, h, { fill: '#050507', radius: 3 }), { inner: shadow(1, 2, 0.8, 0, '#000000') }))
  ids.push(s.rect('Cap', x - 13, capY, 26, 28, {
    fill: linear(o.cap === 'white'
      ? [['#FFFFFF', 0], ['#D4D4DA', 0.45], ['#9A9AA2', 0.5], ['#E4E4E8', 0.55], ['#BEBEC6', 1]]
      : [['#56565F', 0], ['#2E2E35', 0.45], ['#111114', 0.5], ['#3A3A42', 0.55], ['#26262C', 1]]),
    radius: 3, shadow: shadow(4, 6, 0.7, 0, '#000000'),
  }))
  ids.push(s.rect('Cap Line', x - 11, capY + 13, 22, 2, { fill: o.cap === 'white' ? '#1A1A1E' : '#FFFFFF', opacity: o.cap === 'white' ? 0.7 : 0.85 }))
  return s.group(`Fader / ${name}`, ids)
}

/** A rounded instrument tile with an icon — track headers, mixer strips, filters. */
export function instrumentTile(s: Studio, name: string, icon: string, x: number, y: number, size: number, colour: string): NodeId {
  return s.group(`Instrument Icon / ${name}`, [
    s.rect('Tile', x, y, size, size, {
      fill: linear([[colour, 0], [colour, 1, 0.75]]), radius: size * 0.24, shadow: shadow(2, 5, 0.4, 0, '#000000'),
    }),
    s.rect('Gloss', x + 1, y + 1, size - 2, size / 2, { fill: linear([['#FFFFFF', 0, 0.28], ['#FFFFFF', 1, 0]]), radius: [size * 0.24, size * 0.24, 0, 0] }),
    s.icon('Icon', icon, x + size * 0.2, y + size * 0.2, size * 0.6, '#FFFFFF', { width: Math.max(1.5, size * 0.06) }),
  ])
}

export { solid }
