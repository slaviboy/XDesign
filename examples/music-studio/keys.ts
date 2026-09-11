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
 * The keyboard instruments: grand piano, tine electric piano, drawbar organ,
 * analog synth, the Transform pad and Smart Piano.
 */

import type { NodeId } from '@/document/types'
import { linear, shadow } from '../kit'
import {
  C, chrome, fader, glow, I, knob, LABEL, led, MONO, panelButton, radialAt, screw, segmented, smooth, toggle, wood,
  type Studio,
} from './base'
import { keyboard } from './instruments'

const f = (n: number) => Number(n.toFixed(2))

/** A small label above a control. */
function caption(s: Studio, text: string, x: number, y: number, anchor: 'left' | 'center' = 'left'): NodeId {
  return s.text('Caption', text.toUpperCase(), x, y, { ...LABEL, anchor })
}

/** − value + stepper, for octave shifts. */
export function octaveStepper(s: Studio, x: number, y: number, value: string): NodeId {
  return s.group('Octave', [
    caption(s, 'Octave', x, y - 20),
    panelButton(s, 'Octave Down', x, y, 44, 40, { icon: I.minus, label: '' }),
    s.fx(s.rect('Readout', x + 50, y, 60, 40, { fill: '#0E0E11', radius: 8 }), { inner: shadow(1, 3, 0.7, 0, '#000000') }),
    s.centeredText('Value', value, { x: x + 50, y, w: 60, h: 40 }, { size: 15, weight: 600, family: MONO, color: C.text }),
    panelButton(s, 'Octave Up', x + 116, y, 44, 40, { icon: I.plus, label: '' }),
  ])
}

/** The small full-range keyboard that shows which part of it is on screen. */
export function navigator(s: Studio, x: number, y: number, w: number, h: number, from: number, count: number, accent = C.amber): NodeId {
  const whites = 52
  const kw = w / whites
  let black = ''
  // A0, A#0, B0, then C1… — black keys after A, C, D, F, G.
  const pattern = [1, 0, 1, 1, 0, 1, 1] // from A: A#, -, C#, D#, -, F#, G#
  for (let i = 0; i < whites - 1; i++) {
    if (pattern[i % 7]) black += `M${f(x + (i + 1) * kw - kw * 0.3)} ${y}h${f(kw * 0.6)}v${f(h * 0.6)}h${f(-kw * 0.6)}Z`
  }
  let lines = ''
  for (let i = 1; i < whites; i++) lines += `M${f(x + i * kw)} ${y}v${h}`
  return s.group('Keyboard Navigator', [
    s.rect('Whites', x, y, w, h, { fill: linear([['#D8D8DC', 0], ['#FFFFFF', 0.3], ['#E8E8EC', 1]]), radius: 3 }),
    s.path('Gaps', lines, { stroke: '#7A7A84', width: 0.8 }),
    s.path('Blacks', black, { fill: '#18181C', closed: true }),
    s.rect('Dim Left', x, y, from * kw, h, { fill: '#000000', opacity: 0.45, radius: [3, 0, 0, 3] }),
    s.rect('Dim Right', x + (from + count) * kw, y, w - (from + count) * kw, h, { fill: '#000000', opacity: 0.45, radius: [0, 3, 3, 0] }),
    s.fx(s.rect('Window', x + from * kw, y - 2, count * kw, h + 4, { fill: { type: 'none' }, radius: 4, stroke: { color: accent, width: 2.5 } }), { shadow: glow(accent, 8, 0.6) }),
  ])
}

/** A caption and a dark dropdown field. */
export function dropdown(s: Studio, name: string, value: string, x: number, y: number, w: number, h = 40): NodeId {
  return s.group(`Dropdown / ${name}`, [
    caption(s, name, x, y - 20),
    s.rect('Field', x, y, w, h, { fill: linear([['#34343C', 0], ['#27272D', 1]]), radius: 8, stroke: { color: '#000000', width: 1, alpha: 0.4 }, shadow: shadow(2, 3, 0.45, 0, '#000000') }),
    s.text('Value', value, x + 14, y + (h - 17) / 2, { size: 13, weight: 600, color: C.text }),
    s.icon('Chevron', I.chevronDown, x + w - 30, y + (h - 18) / 2, 18, C.dim),
  ])
}

/** Black lacquer with a long soft reflection. */
function lacquer(s: Studio, name: string, x: number, y: number, w: number, h: number): NodeId {
  return s.group(name, [
    s.rect('Lacquer', x, y, w, h, { fill: linear([['#3A3A40', 0], ['#0C0C0E', 0.35], ['#111114', 0.8], ['#2C2C31', 1]]) }),
    s.rect('Reflection', x, y + h * 0.12, w, h * 0.22, { fill: linear([['#FFFFFF', 0, 0], ['#FFFFFF', 0.5, 0.07], ['#FFFFFF', 1, 0]]) }),
  ])
}

// ---------------------------------------------------------------------------
// 03 Grand Piano
// ---------------------------------------------------------------------------

export function grandPiano(s: Studio): void {
  chrome(s, { bar: 9, beat: 1, tempo: 92, key: 'C maj', active: 'browser', playing: true })
  s.rect('Control Panel', 0, 96, 1194, 144, { fill: linear([['#232329', 0], ['#1B1B20', 1]]) })
  navigator(s, 16, 108, 1162, 26, 16, 15)
  octaveStepper(s, 24, 176, 'C3')
  s.group('Sustain', [
    caption(s, 'Sustain', 208, 156),
    panelButton(s, 'Sustain', 208, 176, 104, 40, { on: true, label: 'Hold' }),
    led(s, 'Sustain', 226, 196, C.amber, true, 3.5),
  ])
  s.group('Keyboard Mode', [
    caption(s, 'Keyboard mode', 340, 156),
    segmented(s, 'Mode', 340, 176, ['Glissando', 'Scroll', 'Pitch'], 0, { h: 40 }).id,
  ])
  s.group('Arpeggiator', [
    caption(s, 'Arpeggiator', 646, 150, 'center'),
    knob(s, 'Arpeggiator', 646, 200, 18, 0.5, { style: 'metal' }),
    s.text('Rate', '1/8', 690, 192, { size: 12, weight: 600, family: MONO, color: C.amber }),
  ])
  s.group('Velocity', [
    caption(s, 'Velocity', 776, 150, 'center'),
    knob(s, 'Velocity', 776, 200, 18, 0.72, { style: 'metal', color: C.keys }),
    s.text('Amount', '96', 820, 192, { size: 12, weight: 600, family: MONO, color: C.keys }),
  ])
  dropdown(s, 'Scale', 'Off', 880, 176, 128)
  s.group('Keyboard Size', [
    caption(s, 'Keys', 1032, 156),
    s.fx(s.rect('Track', 1032, 176, 146, 40, { fill: '#141417', radius: 20 }), { inner: shadow(1, 3, 0.6, 0, '#000000') }),
    s.rect('Thumb', 1106, 178, 70, 36, { fill: linear([['#4E4E59', 0], ['#3C3C45', 1]]), radius: 18, shadow: shadow(1, 3, 0.5, 0, '#000000') }),
    s.group('Small Keys', [
      ...[0, 1, 2, 3, 4].map((i) => s.rect(`Key ${i + 1}`, 1052 + i * 6, 187, 5, 18, { fill: C.dim, radius: 1 })),
    ]),
    s.group('Large Keys', [
      ...[0, 1, 2].map((i) => s.rect(`Key ${i + 1}`, 1125 + i * 11, 185, 9, 22, { fill: '#FFFFFF', radius: 1.5 })),
    ]),
  ])

  lacquer(s, 'Fallboard', 0, 240, 1194, 64)
  const plate = { size: 22, weight: 500, family: 'Playfair Display', color: '#D9B56A', anchor: 'center' as const, letterSpacing: 0.06 }
  const pw = s.measure('Concert Grand', plate).width
  s.group('Nameplate', [
    s.rect('Rule Left', 597 - pw / 2 - 96, 272, 80, 1, { fill: '#C9A55A', opacity: 0.7 }),
    s.text('Maker', 'Concert Grand', 597, 256, plate),
    s.rect('Rule Right', 597 + pw / 2 + 16, 272, 80, 1, { fill: '#C9A55A', opacity: 0.7 }),
  ])
  s.rect('Felt', 0, 302, 1194, 8, { fill: linear([['#A3212B', 0], ['#5E0E14', 1]]) })
  keyboard(s, 0, 310, 1194, 524, { whites: 15, octave: 3, pressed: [4, 7, 12], labels: true, style: 'grand' })
}


/** Vinyl covering with a fine cross-hatched weave. */
export function tolex(s: Studio, name: string, x: number, y: number, w: number, h: number, base: [string, string], weave = '#000000'): NodeId {
  let d = ''
  for (let i = -h; i < w; i += 5) d += `M${x + i} ${y}l${h} ${h}`
  for (let i = 0; i < w + h; i += 5) d += `M${x + i} ${y}l${-h} ${h}`
  return s.group(name, [
    s.rect('Vinyl', x, y, w, h, { fill: linear([[base[0], 0], [base[1], 1]]) }),
    s.fx(s.path('Weave', d, { stroke: weave, width: 1, alpha: 0.12 }), {}),
  ])
}

// ---------------------------------------------------------------------------
// 04 Electric Piano
// ---------------------------------------------------------------------------

export function electricPiano(s: Studio): void {
  chrome(s, { bar: 17, beat: 3, tempo: 84, key: 'F maj', active: 'browser', playing: true })
  tolex(s, 'Lid', 0, 96, 1194, 164, ['#4A3024', '#2A1B13'])
  // A clip of the weave to the lid's box is not needed: it is drawn inside it.
  const px = 24
  const py = 112
  s.group('Control Plate', [
    s.rect('Plate', px, py, 1146, 128, {
      fill: linear([['#232327', 0], ['#141417', 1]]), radius: 6, stroke: { color: '#000000', width: 1.5, alpha: 0.8 },
      shadow: shadow(4, 10, 0.6, 0, '#000000'),
    }),
    s.rect('Bevel', px + 2, py + 2, 1142, 2, { fill: '#FFFFFF', opacity: 0.08, radius: 1 }),
    screw(s, px + 14, py + 14, 4.5, 20),
    screw(s, px + 1132, py + 14, 4.5, 60),
    screw(s, px + 14, py + 114, 4.5, 110),
    screw(s, px + 1132, py + 114, 4.5, 150),
  ])
  const cream = '#EFE4C8'
  s.group('Badge', [
    s.text('Maker', 'TINE', 56, 128, { size: 34, weight: 600, family: 'Oswald', color: cream, letterSpacing: 0.18 }),
    s.text('Model', 'SEVENTY-THREE  STAGE', 58, 178, { ...LABEL, color: cream, opacity: 0.7 }),
    led(s, 'Power', 64, 210, C.red, true, 3.5),
    s.text('Power Label', 'POWER', 76, 204, { ...LABEL, size: 9, color: cream, opacity: 0.6 }),
  ])
  const dividers = [276, 606, 846, 948]
  s.group('Dividers', dividers.map((x, i) => s.rect(`Divider ${i + 1}`, x, py + 18, 1, 92, { fill: cream, opacity: 0.18 })))
  const k = (name: string, cx: number, v: number, value: string) =>
    knob(s, name, cx, 166, 24, v, { style: 'cream', arc: false, scale: 11, label: name, value, labelColor: cream, labelBelow: 40 })
  s.group('Controls', [
    k('Volume', 334, 0.72, '7.2'),
    k('Bass', 434, 0.55, '+2'),
    k('Treble', 534, 0.4, '−1'),
    k('Trem Rate', 676, 0.62, '5.4 Hz'),
    k('Trem Depth', 776, 0.35, '35%'),
    k('Drive', 897, 0.28, '2.8'),
    k('Chorus', 1011, 0.45, '45%'),
    k('Reverb', 1107, 0.3, '30%'),
  ])
  s.group('Tremolo Light', [led(s, 'Tremolo', 726, 126, C.amber, true, 3.5)])

  s.group('Name Rail', [
    s.rect('Rail', 0, 260, 1194, 42, { fill: linear([['#F4F4F6', 0], ['#C4C5CB', 0.4], ['#8E8F96', 0.55], ['#D9DADF', 0.85], ['#9A9BA2', 1]]) }),
    s.rect('Inlay', 440, 268, 314, 26, { fill: linear([['#1A1A1C', 0], ['#2A2A2E', 1]]), radius: 3 }),
    s.centeredText('Name', 'TINE  ·  ELECTRIC PIANO', { x: 440, y: 268, w: 314, h: 26 }, { size: 12, weight: 600, family: 'Oswald', color: '#D9DADF', letterSpacing: 0.3 }),
  ])
  s.rect('Felt', 0, 302, 1194, 6, { fill: linear([['#6A1A1A', 0], ['#3A0C0C', 1]]) })
  keyboard(s, 0, 308, 1194, 526, { whites: 15, octave: 3, pressed: [5, 9, 12, 16], labels: true, style: 'ep', press: C.amber })
}

// ---------------------------------------------------------------------------
// 05 Vintage Organ
// ---------------------------------------------------------------------------

const FOOTAGES = ['16′', '5⅓′', '8′', '4′', '2⅔′', '2′', '1⅗′', '1⅓′', '1′']
const TIP = ['brown', 'brown', 'white', 'white', 'black', 'white', 'black', 'black', 'white'] as const

function drawbar(s: Studio, i: number, cx: number, top: number, value: number): NodeId {
  const step = 22
  const len = value * step
  const tip = TIP[i]!
  const tipFill = tip === 'brown'
    ? linear([['#8A4E2A', 0], ['#5A2E14', 1]], 0, 0, 1, 0)
    : tip === 'black'
      ? linear([['#3A3A3E', 0], ['#0E0E10', 1]], 0, 0, 1, 0)
      : linear([['#FFFFFF', 0], ['#E2DFD6', 0.6], ['#BDB8AC', 1]], 0, 0, 1, 0)
  const ids: NodeId[] = []
  if (len > 0) {
    ids.push(s.rect('Shaft', cx - 11, top, 22, len, { fill: linear([['#D9D5CA', 0], ['#FFFFFF', 0.4], ['#B3AEA2', 1]], 0, 0, 1, 0) }))
    let marks = ''
    for (let n = 1; n <= value; n++) marks += `M${cx - 11} ${top + n * step - 3}h22`
    ids.push(s.path('Markings', marks, { stroke: '#2A2620', width: 1, alpha: 0.5 }))
    ids.push(s.text('Numbers', Array.from({ length: value }, (_, n) => String(n + 1)).join('\n'), cx, top + 4, {
      size: 10, weight: 600, family: MONO, color: '#2A2620', lineHeight: step / 10, anchor: 'center', width: 20, align: 'center',
    }))
  }
  const ty = top + len
  ids.push(s.rect('Tip', cx - 20, ty, 40, 56, { fill: tipFill, radius: [4, 4, 12, 12], shadow: shadow(6, 8, 0.6, 0, '#000000') }))
  ids.push(s.rect('Tip Sheen', cx - 14, ty + 4, 6, 44, { fill: '#FFFFFF', opacity: tip === 'white' ? 0.5 : 0.14, radius: 3 }))
  ids.push(s.centeredText('Footage', FOOTAGES[i]!, { x: cx - 20, y: ty + 8, w: 40, h: 40 }, {
    size: 12, weight: 700, color: tip === 'white' ? '#1A1A1C' : '#F2EDE2',
  }))
  return s.group(`Drawbar / ${FOOTAGES[i]}`, ids)
}

function rocker(s: Studio, name: string, x: number, y: number, on: boolean): NodeId {
  const lines = name.split(' ')
  return s.group(`Tab / ${name}`, [
    s.rect('Well', x, y, 64, 92, { fill: '#0A0806', radius: 4 }),
    s.rect('Tab', x + 3, y + (on ? 3 : 10), 58, 79, {
      fill: linear(on ? [['#FFFFFF', 0], ['#EDE8DC', 0.6], ['#CFC8B6', 1]] : [['#D8D2C2', 0], ['#EDE8DC', 0.5], ['#FFFFFF', 1]]),
      radius: 3, shadow: shadow(on ? 5 : 2, 5, 0.6, 0, '#000000'),
    }),
    s.text('Label', lines.join('\n'), x + 32, y + (on ? 24 : 31), { size: 10, weight: 700, color: '#2A2620', anchor: 'center', align: 'center', width: 56, lineHeight: 1.3 }),
  ])
}

export function organ(s: Studio): void {
  chrome(s, { bar: 33, beat: 2, tempo: 118, key: 'B♭ maj', active: 'browser', playing: true })
  wood(s, 'Cabinet', 0, 96, 1194, 738, { base: [['#6A3A1C', 0], ['#4E2812', 0.5], ['#3A1C0C', 1]], seed: 11, alpha: 0.28 })

  // Drawbar panel.
  s.group('Drawbar Panel', [
    s.rect('Panel', 24, 112, 740, 292, { fill: linear([['#1C1712', 0], ['#0F0C09', 1]]), radius: 8, stroke: { color: '#000000', width: 2, alpha: 0.8 }, shadow: shadow(6, 14, 0.6, 0, '#000000') }),
    s.rect('Housing', 44, 128, 700, 18, { fill: linear([['#C9CAD0', 0], ['#F4F4F6', 0.35], ['#8A8B92', 1]]), radius: 3 }),
    s.label('Legend', 'upper manual  ·  drawbars', 744, 380, { color: '#D9C9A8', opacity: 0.6, anchor: 'right' }),
  ])
  const values = [8, 8, 6, 4, 0, 2, 0, 3, 5]
  s.group('Drawbars', values.map((v, i) => drawbar(s, i, 100 + i * 74, 146, v)))

  // Rotary, vibrato, percussion and drive.
  s.group('Voice Panel', [
    s.rect('Panel', 784, 112, 386, 292, { fill: linear([['#1C1712', 0], ['#0F0C09', 1]]), radius: 8, stroke: { color: '#000000', width: 2, alpha: 0.8 }, shadow: shadow(6, 14, 0.6, 0, '#000000') }),
  ])
  const hx = 880
  const hy = 214
  s.group('Rotary Switch', [
    s.label('Title', 'rotary', hx, 126, { anchor: 'center', color: '#D9C9A8' }),
    s.path('Half Moon', `M${hx - 64} ${hy}A64 64 0 0 1 ${hx + 64} ${hy}Z`, {
      fill: linear([['#3A3A3E', 0], ['#0C0C0E', 1]]), closed: true,
    }),
    s.path('Rim', `M${hx - 64} ${hy}A64 64 0 0 1 ${hx + 64} ${hy}`, { stroke: '#FFFFFF', width: 1, alpha: 0.15 }),
    s.line('Lever', hx, hy - 6, ...polar2(hx, hy - 6, 54, 50), '#D9DADF', 8),
    s.circle('Lever Knob', ...polar2(hx, hy - 6, 56, 50), 9, { fill: radialAt([['#FFFFFF', 0], ['#B9BAC1', 0.6], ['#6E7078', 1]], 0.4, 0.35, 0.7), shadow: shadow(3, 5, 0.6, 0, '#000000') }),
    s.text('Slow', 'SLOW', hx - 76, hy + 8, { ...LABEL, color: '#D9C9A8', anchor: 'center' }),
    s.text('Stop', 'STOP', hx, hy + 8, { ...LABEL, color: '#D9C9A8', anchor: 'center' }),
    s.text('Fast', 'FAST', hx + 76, hy + 8, { ...LABEL, color: C.amber, anchor: 'center' }),
    led(s, 'Rotor', hx + 76, hy - 18, C.amber, true, 3.5),
  ])
  const vx = 1070
  const vy = 206
  const vib = ['V1', 'V2', 'V3', 'C1', 'C2', 'C3']
  s.group('Vibrato Chorus', [
    s.label('Title', 'vibrato · chorus', vx, 126, { anchor: 'center', color: '#D9C9A8' }),
    ...vib.map((label, i) => {
      const [lx, ly] = polar2(vx, vy, 48, -100 + i * 40)
      return s.text(`Position ${label}`, label, lx, ly - 7, { size: 10, weight: 700, color: i === 4 ? C.amber : '#D9C9A8', anchor: 'center' })
    }),
    knob(s, 'Vibrato', vx, vy, 30, (60 + 135) / 270, { style: 'chicken', arc: false }),
  ])
  s.group('Percussion', [
    s.label('Title', 'percussion', 804, 272, { color: '#D9C9A8' }),
    rocker(s, 'PERC ON', 804, 292, true),
    rocker(s, 'VOL SOFT', 876, 292, false),
    rocker(s, 'DECAY FAST', 948, 292, true),
    rocker(s, 'HARM 3RD', 1020, 292, true),
  ])
  s.group('Drive', [
    s.label('Title', 'drive', 1128, 272, { anchor: 'center', color: '#D9C9A8' }),
    knob(s, 'Drive', 1128, 330, 18, 0.4, { style: 'chicken', arc: false }),
    s.text('Value', '4', 1128, 360, { size: 11, weight: 600, family: MONO, color: '#D9C9A8', anchor: 'center' }),
  ])

  // Two manuals between wooden cheek blocks.
  const cheek = (x: number, y: number, h: number, name: string) =>
    wood(s, name, x, y, 44, h, { base: [['#5A3016', 0], ['#7A4424', 0.5], ['#4A2610', 1]], vertical: true, seed: x + y, alpha: 0.3 })
  s.group('Upper Manual', [
    s.rect('Key Slip', 0, 424, 1194, 14, { fill: linear([['#2A160A', 0], ['#140A04', 1]]) }),
    keyboard(s, 44, 438, 1106, 176, { whites: 15, octave: 4, pressed: [0, 4, 7, 11], style: 'organ', blackRatio: 0.6, name: 'Upper Keys', press: C.amber }),
    cheek(0, 424, 190, 'Cheek Left'),
    cheek(1150, 424, 190, 'Cheek Right'),
  ])
  s.group('Lower Manual', [
    s.rect('Key Slip', 0, 626, 1194, 22, { fill: linear([['#6A3A1C', 0], ['#2A160A', 1]]) }),
    keyboard(s, 44, 648, 1106, 186, { whites: 15, octave: 3, pressed: [0, 7, 16], style: 'organ', blackRatio: 0.6, name: 'Lower Keys', press: C.amber }),
    cheek(0, 626, 208, 'Cheek Left'),
    cheek(1150, 626, 208, 'Cheek Right'),
  ])
}

function polar2(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)]
}

// ---------------------------------------------------------------------------
// 06 Analog Synth
// ---------------------------------------------------------------------------

const WAVES: Array<[string, string]> = [
  ['Saw', 'M3 17L11 7v10l8-10v10'],
  ['Square', 'M3 16h4V8h6v8h6V8h2'],
  ['Triangle', 'M3 15l4.5-7 4.5 8 4.5-8 4.5 7'],
  ['Sine', 'M3 12c2-6 5-6 6 0s4 6 6 0 4-6 6 0'],
]

function module(s: Studio, name: string, x: number, y: number, w: number, h: number): NodeId {
  return s.group(`Module / ${name}`, [
    s.rect('Outline', x, y, w, h, { fill: linear([['#1E1E23', 0], ['#17171B', 1]]), radius: 10, stroke: { color: '#FFFFFF', width: 1, alpha: 0.08 } }),
    s.rect('Header', x + 16, y + 16, 3, 12, { fill: C.synth, radius: 1.5 }),
    s.label('Title', name, x + 26, y + 16, { color: '#D6D6DE' }),
  ])
}

export function analogSynth(s: Studio): void {
  chrome(s, { bar: 5, beat: 1, tempo: 124, key: 'A min', active: 'browser', playing: true })
  const cheek = (x: number, name: string) =>
    wood(s, name, x, 96, 28, 738, { base: [['#6E3C1C', 0], ['#94552C', 0.5], ['#5A2E12', 1]], vertical: true, seed: x + 3, alpha: 0.3 })
  s.rect('Panel', 28, 96, 1138, 738, { fill: linear([['#1A1A1F', 0], ['#121215', 1]]) })
  cheek(0, 'Cheek Left')
  cheek(1166, 'Cheek Right')

  s.group('Header', [
    s.text('Maker', 'NOVA', 52, 108, { size: 28, weight: 600, family: 'Oswald', color: '#FFFFFF', letterSpacing: 0.2 }),
    s.text('Model', 'SIX-VOICE ANALOG', 140, 122, { ...LABEL, color: C.synth }),
    s.fx(s.rect('Display', 420, 110, 300, 40, { fill: '#05070A', radius: 6, stroke: { color: '#000000', width: 1 } }), { inner: shadow(1, 4, 0.8, 0, '#000000') }),
    s.lit('Patch Number', 'A-12', 436, 119, { size: 15, weight: 500, family: MONO, color: '#6FE6FF' }, 6),
    s.lit('Patch Name', 'NEON BASS', 496, 119, { size: 15, weight: 700, family: MONO, color: '#6FE6FF' }, 6),
    s.text('Voices', '6 VOICES', 704, 122, { size: 10, weight: 500, family: MONO, color: '#6FE6FF', opacity: 0.6, anchor: 'right' }),
    panelButton(s, 'Previous', 736, 110, 40, 40, { icon: I.chevronLeft, label: '' }),
    panelButton(s, 'Next', 782, 110, 40, 40, { icon: I.chevronRight, label: '' }),
    panelButton(s, 'Hold', 1010, 110, 64, 40, { on: true, accent: C.synth }),
    panelButton(s, 'Arp', 1082, 110, 64, 40),
  ])

  // Oscillator: waveform selector and three knobs.
  module(s, 'Oscillator', 44, 164, 272, 312)
  s.group('Waveform Selector', WAVES.map(([name, d], i) => {
    const x = 60 + i * 62
    const on = i === 0
    return s.group(`Wave / ${name}`, [
      led(s, name, x + 27, 216, C.synth, on, 3.5),
      s.rect('Button', x, 230, 54, 46, {
        fill: on ? linear([['#4A4A55', 0], ['#383841', 1]]) : linear([['#34343C', 0], ['#27272D', 1]]),
        radius: 8, stroke: { color: on ? C.synth : '#000000', width: 1, alpha: on ? 0.9 : 0.4 }, shadow: shadow(2, 3, 0.45, 0, '#000000'),
      }),
      s.icon('Shape', d, x + 13, 239, 28, on ? C.synth : C.text, { width: 2 }),
    ])
  }))
  s.group('Oscillator Knobs', [
    knob(s, 'Octave', 104, 350, 24, 0.5, { style: 'black', color: C.synth, label: 'Octave', value: "8'" }),
    knob(s, 'Detune', 180, 350, 24, 0.62, { style: 'black', color: C.synth, label: 'Detune', value: '+12c' }),
    knob(s, 'Sub', 256, 350, 24, 0.4, { style: 'black', color: C.synth, label: 'Sub Osc', value: '40%' }),
  ])
  s.text('Glide', 'GLIDE  ·  38 ms', 60, 440, { ...LABEL, color: C.faint })

  // Filter: the hero knob, resonance, envelope amount and a response curve.
  module(s, 'Filter', 332, 164, 288, 312)
  s.group('Filter Knobs', [
    knob(s, 'Cutoff', 420, 262, 44, 0.64, { style: 'metal', color: C.synth, scale: 21, label: 'Cutoff', value: '1.8 kHz' }),
    knob(s, 'Resonance', 556, 222, 22, 0.46, { style: 'black', color: C.synth, label: 'Reso', value: '46%' }),
    knob(s, 'Env Amount', 556, 328, 22, 0.7, { style: 'black', color: C.synth, label: 'Env Amt', value: '+70' }),
  ])
  const gx = 348
  const gy = 400
  const curve: Array<[number, number]> = []
  for (let i = 0; i <= 64; i++) {
    const t = i / 64
    const fc = 0.62
    const peak = Math.exp(-Math.pow((t - fc) / 0.05, 2)) * 22
    const roll = t < fc ? 0 : Math.pow((t - fc) / (1 - fc), 0.8) * 58
    curve.push([gx + 8 + t * 240, gy + 40 - 18 - peak + roll])
  }
  const curveD = curve.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(Math.min(gy + 58, y))}`).join('')
  s.group('Filter Response', [
    s.fx(s.rect('Screen', gx, gy, 256, 62, { fill: '#08080B', radius: 6 }), { inner: shadow(1, 4, 0.8, 0, '#000000') }),
    s.path('Grid', `M${gx + 64} ${gy + 6}v50M${gx + 128} ${gy + 6}v50M${gx + 192} ${gy + 6}v50M${gx + 6} ${gy + 31}h244`, { stroke: '#FFFFFF', width: 1, alpha: 0.06 }),
    s.path('Fill', `${curveD}L${gx + 248} ${gy + 58}L${gx + 8} ${gy + 58}Z`, { fill: linear([[C.synth, 0, 0.35], [C.synth, 1, 0]]), closed: true }),
    s.fx(s.path('Curve', curveD, { stroke: C.synth, width: 2 }), { shadow: glow(C.synth, 6, 0.7) }),
  ])

  // Amp envelope: four sliders under the shape they draw.
  module(s, 'Amp Envelope', 636, 164, 228, 312)
  const ex = 652
  const ey = 196
  const env = `M${ex + 8} ${ey + 70}L${ex + 40} ${ey + 12}L${ex + 84} ${ey + 34}L${ex + 150} ${ey + 34}L${ex + 188} ${ey + 70}`
  s.group('Envelope Display', [
    s.fx(s.rect('Screen', ex, ey, 196, 80, { fill: '#08080B', radius: 6 }), { inner: shadow(1, 4, 0.8, 0, '#000000') }),
    s.path('Fill', `${env}Z`, { fill: linear([[C.synth, 0, 0.35], [C.synth, 1, 0]]), closed: true }),
    s.fx(s.path('Shape', env, { stroke: C.synth, width: 2 }), { shadow: glow(C.synth, 6, 0.7) }),
    ...[[ex + 40, ey + 12], [ex + 84, ey + 34], [ex + 150, ey + 34]].map(([x, y], i) => s.circle(`Point ${i + 1}`, x!, y!, 3.5, { fill: '#FFFFFF' })),
  ])
  const adsr: Array<[string, number, string]> = [['A', 0.25, '12ms'], ['D', 0.45, '340ms'], ['S', 0.62, '62%'], ['R', 0.38, '0.9s']]
  s.group('Envelope Sliders', adsr.map(([name, v, value], i) => {
    const x = 676 + i * 50
    return s.group(`Slider / ${name}`, [
      fader(s, name, x, 292, 136, v),
      s.text('Label', name, x, 434, { size: 12, weight: 700, color: C.text, anchor: 'center' }),
      s.text('Value', value, x, 452, { size: 9, weight: 500, family: MONO, color: C.dim, anchor: 'center' }),
    ])
  }))

  // XY pad.
  const X = 880
  const Y = 164
  const PW = 270
  const PH = 312
  let grid = ''
  for (let i = 1; i < 6; i++) grid += `M${X + (PW * i) / 6} ${Y + 8}v${PH - 16}M${X + 8} ${Y + (PH * i) / 6}h${PW - 16}`
  const dot: [number, number] = [X + PW * 0.64, Y + PH * 0.38]
  s.group('XY Pad', [
    s.fx(s.rect('Surface', X, Y, PW, PH, { fill: radialAt([['#3A1F6E', 0], ['#1C1236', 0.6], ['#0C0A16', 1]], 0.64, 0.38, 0.75), radius: 10, stroke: { color: C.synth, width: 1, alpha: 0.5 } }), { inner: shadow(0, 18, 0.6, 0, '#000000') }),
    s.path('Grid', grid, { stroke: C.synth, width: 1, alpha: 0.16 }),
    s.line('Crosshair X', X + 8, dot[1], X + PW - 8, dot[1], C.synth, 1, 0.5),
    s.line('Crosshair Y', dot[0], Y + 8, dot[0], Y + PH - 8, C.synth, 1, 0.5),
    s.circle('Halo', dot[0], dot[1], 36, { fill: radialAt([[C.synth, 0, 0.55], [C.synth, 1, 0]]) }),
    s.fx(s.circle('Touch', dot[0], dot[1], 12, { fill: radialAt([['#FFFFFF', 0], ['#E4D8FF', 0.5], [C.synth, 1]]) }), { shadow: glow(C.synth, 18, 1) }),
    s.label('Axis X', 'cutoff  →', X + PW - 12, Y + PH - 24, { anchor: 'right', color: '#CDBDFF' }),
    s.label('Axis Y', '↑  resonance', X + 12, Y + 12, { color: '#CDBDFF' }),
  ])

  // Wheels and keys.
  s.rect('Key Well', 28, 492, 1138, 342, { fill: linear([['#0E0E11', 0], ['#17171B', 1]]) })
  const wheel = (name: string, x: number, notch: number) => s.group(`Wheel / ${name}`, [
    s.fx(s.rect('Recess', x, 520, 44, 220, { fill: '#050507', radius: 8 }), { inner: shadow(2, 6, 0.9, 0, '#000000') }),
    s.rect('Wheel', x + 6, 530, 32, 200, { fill: linear([['#0A0A0C', 0], ['#3A3A40', 0.3], ['#55555C', 0.5], ['#2A2A2E', 0.75], ['#060607', 1]]), radius: 6 }),
    s.path('Grip', Array.from({ length: 19 }, (_, i) => `M${x + 8} ${538 + i * 10}h28`).join(''), { stroke: '#000000', width: 1.5, alpha: 0.5 }),
    s.rect('Notch', x + 6, notch, 32, 6, { fill: '#FFFFFF', opacity: 0.8, radius: 2 }),
    s.label('Label', name, x + 22, 752, { anchor: 'center' }),
  ])
  wheel('Pitch', 52, 627)
  wheel('Mod', 112, 588)
  keyboard(s, 176, 500, 974, 326, { whites: 15, octave: 2, pressed: [9, 16, 21], style: 'synth', press: C.synth, labels: true })
}

// ---------------------------------------------------------------------------
// 07 Transform Pad
// ---------------------------------------------------------------------------

const PRESETS: Array<[string, string, string]> = [
  ['Glass Rain', '#6FE6FF', '#3A5BFF'],
  ['Night Drive', '#FF5FD2', '#6A3BFF'],
  ['Dust Orbit', '#FFB23F', '#FF4F6A'],
  ['Tidal Chords', '#3DD6D0', '#2A6BFF'],
  ['Neon Choir', '#C77BFF', '#FF5FA2'],
  ['Low Tide Bass', '#4CD97B', '#1F8A9A'],
  ['Satellite', '#9AB8FF', '#5B3DF5'],
  ['Warm Static', '#FF8A3D', '#B8325A'],
]

export function transformPad(s: Studio): void {
  chrome(s, { bar: 21, beat: 4, tempo: 96, key: 'D min', active: 'browser', playing: true })

  s.group('Presets', [
    s.rect('Panel', 16, 112, 284, 706, { fill: linear([['#222228', 0], ['#1C1C21', 1]]), radius: 14, stroke: { color: '#FFFFFF', width: 1, alpha: 0.05 } }),
    s.label('Title', 'sounds', 36, 132),
    s.text('Count', '24 presets', 280, 130, { size: 11, weight: 500, color: C.faint, anchor: 'right' }),
    ...PRESETS.map(([name, a, b], i) => {
      const y = 158 + i * 66
      const on = i === 1
      const parts: NodeId[] = []
      if (on) parts.push(s.rect('Selection', 24, y, 268, 58, { fill: linear([['#FFFFFF', 0, 0.1], ['#FFFFFF', 1, 0.05]]), radius: 10, stroke: { color: a, width: 1, alpha: 0.6 } }))
      parts.push(
        s.fx(s.rect('Swatch', 36, y + 9, 40, 40, { fill: linear([[a, 0], [b, 1]], 0, 0, 1, 1), radius: 10 }), on ? { shadow: glow(a, 12, 0.7) } : {}),
        s.path('Swatch Wave', `M42 ${y + 32}c5-10 9-10 14 0s9 10 14 0`, { stroke: '#FFFFFF', width: 2, alpha: 0.85 }),
        s.text('Name', name, 90, y + 11, { size: 14, weight: 600, color: on ? '#FFFFFF' : C.text }),
        s.text('Kind', ['Evolving pad', 'Pulsing synth', 'Textured pad', 'Chord pad', 'Vocal pad', 'Bass pad', 'Sparkle pad', 'Lo-fi pad'][i]!, 90, y + 31, { size: 11, color: C.dim }),
      )
      if (on) parts.push(s.icon('Playing', I.wave3, 262, y + 20, 18, a, { width: 2 }))
      return s.group(`Preset / ${name}`, parts)
    }),
    s.rect('Divider', 36, 700, 244, 1, { fill: '#FFFFFF', opacity: 0.07 }),
    s.text('Hold Label', 'Hold', 36, 724, { size: 14, weight: 600, color: C.text }),
    s.text('Hold Hint', 'Keep sounding after release', 36, 744, { size: 11, color: C.dim }),
    toggle(s, 'Hold', 234, 726, true, '#FF5FD2'),
    s.text('Snap Label', 'Snap to grid', 36, 780, { size: 14, weight: 600, color: C.text }),
    toggle(s, 'Snap', 234, 776, false),
  ])

  const X = 316
  const Y = 112
  const PW = 862
  const PH = 536
  let grid = ''
  for (let i = 1; i < 16; i++) grid += `M${f(X + (PW * i) / 16)} ${Y}v${PH}`
  for (let i = 1; i < 10; i++) grid += `M${X} ${f(Y + (PH * i) / 10)}h${PW}`
  const touch: [number, number] = [X + PW * 0.66, Y + PH * 0.36]
  const trail: Array<[number, number]> = [
    [X + PW * 0.18, Y + PH * 0.78], [X + PW * 0.3, Y + PH * 0.62], [X + PW * 0.36, Y + PH * 0.7],
    [X + PW * 0.46, Y + PH * 0.5], [X + PW * 0.56, Y + PH * 0.52], [X + PW * 0.6, Y + PH * 0.4], touch,
  ]
  s.group('Transform Pad', [
    s.fx(s.rect('Surface', X, Y, PW, PH, {
      fill: radialAt([['#8A2BD6', 0], ['#4A1C9A', 0.35], ['#1E1150', 0.7], ['#0A0820', 1]], 0.66, 0.36, 0.8),
      radius: 18, stroke: { color: '#FF5FD2', width: 1.5, alpha: 0.5 },
    }), { inner: shadow(0, 40, 0.7, 0, '#000000'), shadow: glow('#7A3BFF', 40, 0.35) }),
    s.circle('Bloom', X + PW * 0.3, Y + PH * 0.72, 170, { fill: radialAt([['#2A6BFF', 0, 0.35], ['#2A6BFF', 1, 0]]) }),
    s.path('Grid', grid, { stroke: '#FFFFFF', width: 1, alpha: 0.07 }),
    s.fx(s.path('Trail', smooth(trail), { stroke: '#FFB8F0', width: 4, alpha: 0.55 }), { shadow: glow('#FF5FD2', 14, 0.9) }),
    ...trail.slice(0, -1).map(([x, y], i) => s.circle(`Echo ${i + 1}`, x, y, 3 + i, { fill: '#FFFFFF', opacity: 0.12 + i * 0.07 })),
    s.circle('Halo Outer', touch[0], touch[1], 90, { fill: radialAt([['#FF5FD2', 0, 0.45], ['#FF5FD2', 0.5, 0.15], ['#FF5FD2', 1, 0]]) }),
    s.circle('Ring', touch[0], touch[1], 44, { fill: { type: 'none' }, stroke: { color: '#FFFFFF', width: 1.5, alpha: 0.45 } }),
    s.fx(s.circle('Touch', touch[0], touch[1], 22, { fill: radialAt([['#FFFFFF', 0], ['#FFD6F6', 0.55], ['#FF5FD2', 1]]) }), { shadow: glow('#FF5FD2', 30, 1) }),
    s.label('Corner Airy', 'airy', X + 20, Y + 20, { color: '#E8D6FF', opacity: 0.7 }),
    s.label('Corner Bright', 'bright', X + PW - 20, Y + 20, { color: '#E8D6FF', opacity: 0.7, anchor: 'right' }),
    s.label('Corner Deep', 'deep', X + 20, Y + PH - 32, { color: '#E8D6FF', opacity: 0.7 }),
    s.label('Corner Gritty', 'gritty', X + PW - 20, Y + PH - 32, { color: '#E8D6FF', opacity: 0.7, anchor: 'right' }),
    s.text('Readout', 'Filter 72%  ·  Motion 64%', X + PW / 2, Y + PH - 34, { size: 12, weight: 600, family: MONO, color: '#FFFFFF', opacity: 0.75, anchor: 'center' }),
  ])

  const chords = ['Dm', 'E°', 'F', 'Gm', 'Am', 'B♭', 'C', 'Dsus2']
  const cw = (PW - 7 * 10) / 8
  s.label('Chord Caption', 'chord', X, 666)
  s.group('Chords', chords.map((name, i) => {
    const x = X + i * (cw + 10)
    const on = i === 2
    return s.group(`Chord / ${name}`, [
      s.rect('Button', x, 688, cw, 130, {
        fill: on ? linear([['#FF5FD2', 0], ['#7A3BFF', 1]], 0, 0, 1, 1) : linear([['#2C2C34', 0], ['#222228', 1]]),
        radius: 12, stroke: { color: '#FFFFFF', width: 1, alpha: on ? 0.4 : 0.05 },
        shadow: on ? glow('#FF5FD2', 24, 0.6) : shadow(3, 6, 0.5, 0, '#000000'),
      }),
      s.centeredText('Name', name, { x, y: 688, w: cw, h: 110 }, { size: 22, weight: 700, color: on ? '#FFFFFF' : C.text }),
      s.centeredText('Degree', ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII', 'sus'][i]!, { x, y: 770, w: cw, h: 30 }, { size: 11, weight: 600, color: on ? '#FFE6F8' : C.faint }),
    ])
  }))
}

// ---------------------------------------------------------------------------
// 08 Smart Piano
// ---------------------------------------------------------------------------

export function smartPiano(s: Studio): void {
  chrome(s, { bar: 12, beat: 2, tempo: 100, key: 'C maj', active: 'browser', playing: true })
  s.rect('Control Panel', 0, 96, 1194, 152, { fill: linear([['#232329', 0], ['#1B1B20', 1]]) })

  const ax = 104
  const ay = 168
  const stops = ['Off', '1', '2', '3', '4']
  s.group('Autoplay', [
    s.label('Title', 'autoplay', ax, 210, { anchor: 'center' }),
    ...stops.map((label, i) => {
      const [lx, ly] = polar2(ax, ay, 50, -100 + i * 50)
      return s.text(`Position ${label}`, label.toUpperCase(), lx, ly - 7, { size: 10, weight: 700, color: i === 2 ? C.keys : C.dim, anchor: 'center' })
    }),
    knob(s, 'Autoplay', ax, ay, 26, (0 + 135) / 270, { style: 'metal', color: C.keys, arc: false }),
  ])
  s.group('Mode', [
    s.label('Caption', 'play', 212, 138),
    segmented(s, 'Chords or Keys', 212, 158, ['Chords', 'Keyboard'], 0, { h: 40 }).id,
  ])
  s.group('Sustain', [
    s.label('Caption', 'sustain', 432, 138),
    panelButton(s, 'Sustain', 432, 158, 96, 40, { on: true, label: 'Hold', accent: C.keys }),
  ])
  s.group('Chord Editor', [
    s.label('Caption', 'chords', 552, 138),
    panelButton(s, 'Edit Chords', 552, 158, 116, 40, { icon: I.grid, label: 'Edit' }),
  ])
  s.group('Voicing', [
    s.label('Caption', 'now playing  ·  F major, 1st inversion', 712, 118),
    keyboard(s, 712, 140, 466, 88, { whites: 21, octave: 3, pressed: [9, 12, 17, 21, 24], style: 'grand', press: C.keys, name: 'Voicing Keys' }),
  ])

  const chords = ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'B♭', 'Bdim']
  const sw = 138
  const gap = (1194 - 32 - sw * 8) / 7
  s.rect('Strip Bed', 0, 248, 1194, 586, { fill: linear([['#141417', 0], ['#0C0C0E', 1]]) })
  s.group('Chord Strips', chords.map((name, i) => {
    const x = 16 + i * (sw + gap)
    const active = name === 'F'
    const parts: NodeId[] = [
      s.rect('Header', x, 264, sw, 56, { fill: active ? linear([['#2E4A78', 0], ['#20355A', 1]]) : linear([['#2C2C33', 0], ['#232328', 1]]), radius: [10, 10, 4, 4], stroke: { color: active ? C.keys : '#000000', width: 1, alpha: active ? 0.8 : 0.4 } }),
      s.centeredText('Name', name, { x, y: 264, w: sw, h: 56 }, { size: 22, weight: 700, color: active ? '#FFFFFF' : C.text }),
    ]
    for (let k = 0; k < 5; k++) {
      const y = 328 + k * 70
      const down = active && k === 2
      parts.push(s.group(`Chord Segment ${k + 1}`, [
        s.rect('Segment', x, y, sw, 64, {
          fill: linear(down
            ? [['#CFE3FF', 0], ['#8EC0FF', 1]]
            : [['#FFFFFF', 0], ['#F4F2EC', 0.7], ['#E2DED4', 1]]),
          radius: 6, shadow: down ? glow(C.keys, 22, 0.9) : shadow(3, 3, 0.5, 0, '#000000'),
        }),
        s.rect('Lip', x, y + 58, sw, 6, { fill: down ? '#6FA8F0' : '#CFCAC0', radius: [0, 0, 6, 6] }),
      ]))
    }
    for (let k = 0; k < 3; k++) {
      const y = 684 + k * 48
      const down = active && k === 0
      parts.push(s.rect(`Bass Segment ${k + 1}`, x, y, sw, 42, {
        fill: linear(down ? [['#2F4E80', 0], ['#1C3358', 1]] : [['#2E2E33', 0], ['#141416', 0.8], ['#3A3A40', 1]]),
        radius: 6, stroke: { color: down ? C.keys : '#FFFFFF', width: 1, alpha: down ? 0.9 : 0.06 },
        shadow: down ? glow(C.keys, 16, 0.7) : shadow(3, 3, 0.6, 0, '#000000'),
      }))
    }
    if (active) parts.push(s.text('Bass Note', 'F', x + sw / 2, 696, { size: 13, weight: 700, color: '#CFE3FF', anchor: 'center' }))
    return s.group(`Strip / ${name}`, parts)
  }))
}
