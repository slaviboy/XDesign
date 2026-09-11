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
 * The instruments themselves, as reusable parts: a keyboard of any length and
 * finish, drums and cymbals seen from above, and a fretted neck. Each part is
 * placed by its box, so the same keyboard serves the grand piano full-size and
 * the instrument browser's card in miniature.
 */

import type { NodeId, Paint } from '@/document/types'
import { linear, random, shadow, type Stop } from '../kit'
import { C, conic, glow, polar, radialAt, ring, type Studio } from './base'

const f = (n: number) => Number(n.toFixed(2))

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

export type KeyStyle = 'grand' | 'ep' | 'organ' | 'synth'

export interface KeyboardOptions {
  /** How many white keys, starting from a C. */
  whites: number
  /** The octave number of the first C, for the C labels. */
  octave?: number
  /** Semitones from the first C that are held down. */
  pressed?: number[]
  style?: KeyStyle
  /** Black keys' length as a share of the white keys'. */
  blackRatio?: number
  labels?: boolean
  press?: string
  name?: string
}

const WHITE_STEPS = [0, 2, 4, 5, 7, 9, 11]
const NOTE_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
/** Black keys after these white keys, and how far off the gap each sits. */
const BLACK_AFTER: Array<[white: number, semitone: number, shift: number]> = [
  [0, 1, -0.08], [1, 3, 0.08], [3, 6, -0.1], [4, 8, 0], [5, 10, 0.1],
]

export function keyboard(s: Studio, x: number, y: number, w: number, h: number, o: KeyboardOptions): NodeId {
  const style = o.style ?? 'grand'
  const kw = w / o.whites
  const bh = h * (o.blackRatio ?? 0.63)
  const bw = kw * 0.58
  const pressed = new Set(o.pressed ?? [])
  const press = o.press ?? C.keys
  const lip = style === 'organ' ? 0 : Math.max(6, h * 0.035)
  const ivory: Stop[] = style === 'ep'
    ? [['#E9E2D0', 0], ['#FFFCF2', 0.06], ['#FBF6EA', 0.7], ['#EDE4CF', 1]]
    : style === 'organ'
      ? [['#DEDCD6', 0], ['#FFFFFF', 0.05], ['#F7F6F2', 0.8], ['#E6E3DC', 1]]
      : [['#E4E1DA', 0], ['#FFFFFF', 0.06], ['#FAF9F6', 0.75], ['#ECE9E2', 1]]

  const ids: NodeId[] = [s.rect('Key Bed', x, y, w, h, { fill: '#08080A' })]
  const whites: NodeId[] = []
  for (let i = 0; i < o.whites; i++) {
    const oct = Math.floor(i / 7)
    const semi = oct * 12 + WHITE_STEPS[i % 7]!
    const down = pressed.has(semi)
    const kx = x + i * kw
    const parts: NodeId[] = [
      s.rect('Key', kx + 1, y, kw - 2, h - 1, {
        fill: linear(down ? [['#B4B9C1', 0], ['#DADEE4', 0.1], ['#D2D6DD', 0.85], ['#C2C7CF', 1]] : ivory),
        radius: [0, 0, Math.min(6, kw * 0.1), Math.min(6, kw * 0.1)],
      }),
    ]
    if (down) {
      parts.push(s.fx(s.rect('Pressed Light', kx + kw * 0.2, y + h - lip - (o.labels ? 46 : Math.max(8, h * 0.035)), kw * 0.6, Math.max(3, h * 0.008), {
        fill: press, radius: 2,
      }), { shadow: glow(press, 10, 0.9) }))
    }
    if (lip) {
      const lh = down ? lip * 0.5 : lip
      parts.push(s.rect('Front', kx + 1, y + h - 1 - lh, kw - 2, lh, {
        fill: linear(down ? [['#C6CBD2', 0], ['#8E959F', 1]] : [['#F2EFE8', 0], ['#C9C4B8', 1]]),
        radius: [0, 0, Math.min(6, kw * 0.1), Math.min(6, kw * 0.1)],
      }))
    }
    if (o.labels && i % 7 === 0) {
      parts.push(s.text('Note', `C${(o.octave ?? 3) + oct}`, kx + kw / 2, y + h - lip - 26, {
        size: Math.max(9, Math.min(13, kw * 0.18)), weight: 600, color: down ? '#2A4A7A' : '#9A968C', anchor: 'center',
      }))
    }
    whites.push(s.group(`White Key / ${NOTE_NAMES[i % 7]}${(o.octave ?? 3) + oct}`, parts))
  }
  ids.push(s.group('White Keys', whites))

  const blacks: NodeId[] = []
  for (let i = 0; i < o.whites - 1; i++) {
    const hit = BLACK_AFTER.find(([wi]) => wi === i % 7)
    if (!hit) continue
    const oct = Math.floor(i / 7)
    const semi = oct * 12 + hit[1]
    const down = pressed.has(semi)
    const cx = x + (i + 1) * kw + hit[2] * kw
    const bx = cx - bw / 2
    const face = down ? 16 : 11
    const name = ['C♯', 'D♯', 'F♯', 'G♯', 'A♯'][BLACK_AFTER.indexOf(hit)]
    blacks.push(s.group(`Black Key / ${name}${(o.octave ?? 3) + oct}`, [
      s.rect('Key', bx, y, bw, bh, {
        fill: linear(down ? [['#1C1C20', 0], ['#0A0A0C', 1]] : [['#2A2A2E', 0], ['#050506', 1]]),
        radius: [0, 0, 3, 3], shadow: shadow(style === 'organ' ? 3 : 6, 8, 0.55, 2, '#000000'),
      }),
      s.rect('Top', bx + bw * 0.1, y, bw * 0.8, bh - face, {
        fill: linear(down
          ? [['#202024', 0], ['#2A2A30', 0.8], [press, 1, 0.9]]
          : [['#1F1F23', 0], ['#141417', 0.8], ['#3A3A40', 0.97], ['#5A5A62', 1]]),
        radius: [0, 0, 2, 2],
      }),
      s.rect('Sheen', bx + bw * 0.22, y + 4, bw * 0.12, bh - face - 14, { fill: '#FFFFFF', opacity: down ? 0.05 : 0.09, radius: 2 }),
    ]))
  }
  ids.push(s.group('Black Keys', blacks))
  ids.push(s.rect('Key Slip Shadow', x, y, w, Math.max(10, h * 0.05), { fill: linear([['#000000', 0, 0.55], ['#000000', 1, 0]]) }))
  return s.group(o.name ?? 'Keyboard', ids)
}

// ---------------------------------------------------------------------------
// Drums, from above
// ---------------------------------------------------------------------------

export interface DrumOptions {
  /** Lacquer of the shell. */
  shell?: Stop[]
  head?: 'coated' | 'clear' | 'black' | 'mesh'
  lugs?: number
  /** Show a soft ripple where the drum was just struck. */
  hit?: string
}

export const LACQUER: Stop[] = [['#C8323A', 0], ['#7A1218', 0.5], ['#3E070B', 1]]

export function drum(s: Studio, name: string, cx: number, cy: number, r: number, o: DrumOptions = {}): NodeId {
  const lugs = o.lugs ?? 8
  const shellR = r + r * 0.12
  // Angular sweeps export to SVG as fans of wedges: only the big drums get them.
  const hero = r >= 95
  const ids: NodeId[] = [
    s.circle('Floor Shadow', cx + r * 0.06, cy + r * 0.12, shellR * 1.02, { fill: radialAt([['#000000', 0, 0.55], ['#000000', 0.8, 0.35], ['#000000', 1, 0]]) }),
    s.circle('Shell', cx, cy, shellR, { fill: shellPaint(o.shell ?? LACQUER, hero) }),
  ]
  // Lugs and tension rods around the rim, each its own small chrome piece.
  let lugPath = ''
  let rodPath = ''
  for (let i = 0; i < lugs; i++) {
    const a = (360 / lugs) * i + 360 / lugs / 2
    const [lx, ly] = polar(cx, cy, shellR - r * 0.055, a)
    lugPath += ring(lx, ly, r * 0.05)
    const [tx, ty] = polar(cx, cy, r * 1.0, a)
    rodPath += ring(tx, ty, r * 0.035)
  }
  ids.push(s.path('Lugs', lugPath, { fill: linear([['#FFFFFF', 0], ['#B9BAC1', 0.5], ['#6E7078', 1]]), stroke: '#2A2A2E', width: 0.8, closed: true }))
  ids.push(s.circle('Hoop', cx, cy, r, {
    fill: hero
      ? conic([['#FFFFFF', 0], ['#8C8D94', 0.15], ['#E4E5E9', 0.32], ['#6B6C72', 0.5], ['#F4F4F6', 0.66], ['#7E7F86', 0.83], ['#FFFFFF', 1]], 20)
      : linear([['#FFFFFF', 0], ['#8C8D94', 0.3], ['#E4E5E9', 0.55], ['#6B6C72', 0.8], ['#F4F4F6', 1]], 0, 0, 1, 1),
    shadow: shadow(2, 4, 0.5, 0, '#000000'),
  }))
  ids.push(s.path('Tension Rods', rodPath, { fill: '#2A2A2E', closed: true }))
  const head: Paint = o.head === 'black'
    ? radialAt([['#3A3A40', 0], ['#1A1A1E', 0.7], ['#0C0C0E', 1]], 0.45, 0.4, 0.6)
    : o.head === 'clear'
      ? radialAt([['#E8E4DA', 0, 0.9], ['#B9B2A2', 0.75], ['#8A8272', 1]], 0.45, 0.4, 0.6)
      : o.head === 'mesh'
        ? radialAt([['#4A4A52', 0], ['#2A2A30', 1]])
        : radialAt([['#FFFFFF', 0], ['#F4F1EA', 0.55], ['#E2DDD0', 0.9], ['#C9C3B4', 1]], 0.42, 0.38, 0.62)
  ids.push(s.circle('Head', cx, cy, r * 0.9, { fill: head, stroke: { color: '#000000', width: 1, alpha: 0.18 } }))
  if (o.head !== 'black' && o.head !== 'mesh') {
    ids.push(s.circle('Wear', cx - r * 0.08, cy + r * 0.06, r * 0.34, { fill: radialAt([['#8C8474', 0, 0.28], ['#8C8474', 1, 0]]) }))
  }
  if (o.hit) {
    ids.push(s.fx(s.circle('Hit Ripple', cx - r * 0.05, cy + r * 0.05, r * 0.5, {
      fill: radialAt([[o.hit, 0, 0], [o.hit, 0.7, 0.18], [o.hit, 1, 0]]), stroke: { color: o.hit, width: 2, alpha: 0.7 },
    }), { shadow: shadow(0, 14, 0.7, 0, o.hit) }))
  }
  return s.group(`Drum / ${name}`, ids)
}

function shellPaint(stops: Stop[], hero: boolean): Paint {
  const [a, b, c] = [stops[0]![0], stops[1]![0], stops[2]![0]]
  return hero
    ? conic([[a, 0], [c, 0.25], [a, 0.5], [b, 0.75], [a, 1]], 30)
    : linear([[a, 0], [b, 0.5], [c, 1]], 0, 0, 1, 1)
}

export function cymbal(s: Studio, name: string, cx: number, cy: number, r: number, o: { tone?: 'gold' | 'dark'; hit?: string; label?: string } = {}): NodeId {
  const gold = o.tone !== 'dark'
  const light = gold ? '#F6DB8C' : '#C9A56A'
  const mid = gold ? '#C9953A' : '#8A6532'
  const dark = gold ? '#9A6B22' : '#5E4220'
  let lathe = ''
  const rnd = random(Math.round(r))
  for (let rr = r * 0.26; rr < r * 0.98; rr += r * (0.022 + rnd() * 0.02)) lathe += ring(cx, cy, rr)
  const ids: NodeId[] = [
    s.circle('Floor Shadow', cx + r * 0.1, cy + r * 0.14, r, { fill: radialAt([['#000000', 0, 0.5], ['#000000', 0.85, 0.3], ['#000000', 1, 0]]) }),
    s.circle('Bronze', cx, cy, r, {
      fill: r >= 120
        ? conic([[light, 0], [mid, 0.1], [dark, 0.2], [light, 0.33], [mid, 0.45], [light, 0.55], [dark, 0.7], [mid, 0.82], [light, 1]], 15)
        : linear([[light, 0], [mid, 0.25], [light, 0.5], [dark, 0.75], [mid, 1]], 0, 0, 1, 1),
      stroke: { color: dark, width: 1.5 },
    }),
    s.path('Lathing', lathe, { stroke: '#3A2408', width: 0.8, alpha: 0.22 }),
    s.circle('Sheen', cx, cy, r, { fill: radialAt([['#FFFFFF', 0, 0.35], ['#FFFFFF', 0.4, 0.08], ['#FFFFFF', 1, 0]], 0.38, 0.3, 0.7) }),
    s.circle('Bell', cx, cy, r * 0.24, {
      fill: radialAt([[light, 0], [mid, 0.7], [dark, 1]], 0.4, 0.35, 0.65), shadow: shadow(2, 6, 0.35, 0, '#2A1A04'),
    }),
    s.circle('Felt', cx, cy, r * 0.075, { fill: radialAt([['#8A2A2A', 0], ['#4A1212', 1]]) }),
    s.circle('Wing Nut', cx, cy, r * 0.04, { fill: linear([['#FFFFFF', 0], ['#7B7C82', 1]]) }),
  ]
  if (o.label) {
    const [lx, ly] = polar(cx, cy, r * 0.72, 200)
    ids.push(s.text('Stamp', o.label, lx, ly, { size: Math.max(8, r * 0.07), weight: 700, color: '#3A2408', opacity: 0.4, anchor: 'center', letterSpacing: 0.1 }))
  }
  if (o.hit) {
    ids.push(s.fx(s.circle('Hit Ripple', cx, cy, r * 0.75, { fill: solid0(), stroke: { color: o.hit, width: 2, alpha: 0.6 } }), { shadow: shadow(0, 16, 0.6, 0, o.hit) }))
  }
  return s.group(`Cymbal / ${name}`, ids)
}

function solid0(): Paint {
  return { type: 'none' }
}

// ---------------------------------------------------------------------------
// Fretted necks
// ---------------------------------------------------------------------------

export interface NeckOptions {
  strings: number
  /** Frets drawn after the nut (0 = nut at the left edge). */
  frets: number
  /** Show the nut at the left end. */
  nut?: boolean
  board?: Stop[]
  grain?: string
  inlay?: 'dot' | 'block'
  inlayFill?: Paint
  /** Heavier strings first, as on a real neck seen with the low string at the bottom. */
  gauges?: number[]
  wound?: number
  /** Real, narrowing fret spacing across the width. */
  real?: boolean
}

export interface Neck {
  id: NodeId
  /** x of each fret line, index 0 = nut. */
  fretX: number[]
  /** y of each string, index 0 = top (the thinnest). */
  stringY: number[]
}

export function neck(s: Studio, x: number, y: number, w: number, h: number, o: NeckOptions): Neck {
  const board = o.board ?? [['#4A2E1C', 0], ['#3A2214', 0.5], ['#2C180D', 1]]
  const ids: NodeId[] = [
    s.rect('Board Shadow', x, y - 6, w, h + 12, { fill: '#000000', opacity: 0.5 }),
    s.rect('Fingerboard', x, y, w, h, { fill: linear(board) }),
  ]
  // Grain along the neck.
  const rnd = random(o.strings * 31 + o.frets)
  let grain = ''
  for (let gy = y + 2; gy < y + h; gy += 3 + rnd() * 4) {
    grain += `M${x} ${f(gy)}`
    for (let gx = x + 80; gx <= x + w; gx += 80) grain += `L${gx} ${f(gy + (rnd() - 0.5) * 2.5)}`
  }
  ids.push(s.path('Grain', grain, { stroke: o.grain ?? '#120804', width: 1, alpha: 0.35 }))
  ids.push(s.rect('Binding Top', x, y - 3, w, 3, { fill: linear([['#F4EAD0', 0], ['#C8B994', 1]]) }))
  ids.push(s.rect('Binding Bottom', x, y + h, w, 3, { fill: linear([['#F4EAD0', 0], ['#C8B994', 1]]) }))

  // Fret positions: equal-tempered spacing, rescaled to the width.
  const fretX: number[] = []
  const start = o.nut ? 24 : 0
  const span = w - start
  const total = 1 - Math.pow(2, -(o.frets + 0.6) / 12)
  for (let n = 0; n <= o.frets; n++) {
    const t = o.real === false ? n / o.frets : (1 - Math.pow(2, -n / 12)) / total
    fretX.push(x + start + t * span)
  }

  const gauges = o.gauges ?? [1.6, 2, 2.6, 3.4, 4.2, 5]
  const wound = o.wound ?? 3
  const pad = h / (o.strings * 2)
  const stringY = Array.from({ length: o.strings }, (_, i) => y + pad + (i * (h - 2 * pad)) / (o.strings - 1))
  // Double inlays sit between string pairs, clear of the notes on the strings.
  const pairs: Array<[number, number]> = o.strings === 4 ? [[0, 1], [2, 3]] : [[1, 2], [o.strings - 3, o.strings - 2]]
  const between = pairs.map(([a, b]) => (stringY[a]! + stringY[b]!) / 2)

  // Inlays between frets.
  const inlays: NodeId[] = []
  const mid = y + h / 2
  for (const n of [3, 5, 7, 9, 12, 15, 17]) {
    if (n > o.frets) continue
    const cx = (fretX[n - 1]! + fretX[n]!) / 2
    const pearl = o.inlayFill ?? radialAt([['#FFFFFF', 0], ['#EDE7F2', 0.5], ['#C9D8DA', 0.8], ['#B9AFC6', 1]], 0.4, 0.35, 0.65)
    if (o.inlay === 'block') {
      const bw = (fretX[n]! - fretX[n - 1]!) * 0.5
      inlays.push(s.rect(`Inlay ${n}`, cx - bw / 2, y + h * 0.18, bw, h * 0.64, { fill: pearl, radius: 2 }))
    } else if (n === 12) {
      inlays.push(s.circle('Inlay 12 Upper', cx, between[0]!, h * 0.045, { fill: pearl }))
      inlays.push(s.circle('Inlay 12 Lower', cx, between[1]!, h * 0.045, { fill: pearl }))
    } else {
      inlays.push(s.circle(`Inlay ${n}`, cx, mid, h * 0.045, { fill: pearl }))
    }
  }
  if (inlays.length) ids.push(s.group('Inlays', inlays))

  const frets: NodeId[] = []
  for (let n = 1; n <= (o.real === false ? o.frets - 1 : o.frets); n++) {
    frets.push(s.rect(`Fret ${n}`, fretX[n]! - 2.5, y - 1, 5, h + 2, {
      fill: linear([['#5E5F66', 0], ['#F2F2F5', 0.45], ['#B8B9C0', 0.6], ['#55565C', 1]], 0, 0, 1, 0),
      shadow: shadow(0, 3, 0.6, 2, '#000000'),
    }))
  }
  ids.push(s.group('Frets', frets))
  if (o.nut) {
    ids.push(s.rect('Nut', x, y - 3, 24, h + 6, { fill: linear([['#FFFDF4', 0], ['#E6DCC4', 0.6], ['#BFB293', 1]], 0, 0, 1, 0), shadow: shadow(0, 6, 0.5, 3, '#000000') }))
  }

  // Strings: thin at the top, heavy at the bottom; wound strings in bronze.
  const strings: NodeId[] = []
  for (let i = 0; i < o.strings; i++) {
    const sy = stringY[i]!
    const g = gauges[i] ?? 3
    const isWound = i >= o.strings - wound
    strings.push(s.rect(`String ${o.strings - i}`, x, sy - g / 2, w, g, {
      fill: linear(isWound
        ? [['#FFF0C8', 0], ['#D4A55C', 0.4], ['#8A6428', 0.8], ['#4E3610', 1]]
        : [['#FFFFFF', 0], ['#D8D8DE', 0.4], ['#8A8A92', 0.8], ['#4A4A50', 1]]),
      shadow: shadow(3, 3, 0.55, 1, '#000000'),
    }))
  }
  ids.push(s.group('Strings', strings))
  return { id: s.group('Neck', ids), fretX, stringY }
}

/** A glowing fingertip marker on a neck or strip. */
export function fingerDot(s: Studio, name: string, cx: number, cy: number, r: number, colour: string, label?: string): NodeId {
  const ids = [
    s.circle('Glow', cx, cy, r, {
      fill: radialAt([['#FFFFFF', 0, 0.9], [colour, 0.55], [colour, 1, 0.85]], 0.4, 0.35, 0.7),
      shadow: shadow(0, r * 1.2, 0.8, 0, colour),
      stroke: { color: '#FFFFFF', width: 1.5, alpha: 0.7 },
    }),
  ]
  if (label) ids.push(s.centeredText('Note', label, { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r }, { size: Math.max(10, r * 0.75), weight: 700, color: '#10141C' }))
  return s.group(`Note / ${name}`, ids)
}
