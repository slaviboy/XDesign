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
 * The string instruments: acoustic and Smart Guitar, an electric guitar
 * through an amp and pedals, bass, the string ensemble and Smart Strings,
 * and a koto-style zither.
 */

import type { NodeId } from '@/document/types'
import { linear, random, shadow } from '../kit'
import {
  C, chrome, glow, I, knob, LABEL, led, MONO, panelButton, polar, radialAt, ring, segmented, smooth, toggle, wood,
  type Studio,
} from './base'
import { fingerDot, neck } from './instruments'
import { dropdown, tolex } from './keys'

const f = (n: number) => Number(n.toFixed(2))

const NOTE = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']

/** The strip of controls under the control bar. */
function strip(s: Studio, h = 96): NodeId {
  return s.rect('Control Strip', 0, 96, 1194, h, { fill: linear([['#232329', 0], ['#1B1B20', 1]]) })
}

/** Autoplay: a knob with its stops printed around it. */
function autoplay(s: Studio, cx: number, cy: number, stop: number, accent: string, stops = ['Off', '1', '2', '3', '4']): NodeId {
  const span = 200 / (stops.length - 1)
  return s.group('Autoplay', [
    ...stops.map((label, i) => {
      const a = -100 + i * span
      const [lx, ly] = polar(cx, cy, 34, a)
      const anchor = a < -20 ? 'right' : a > 20 ? 'left' : 'center'
      return s.text(`Position ${label}`, label.toUpperCase(), lx, ly - 6, { size: 9, weight: 700, color: i === stop ? accent : C.dim, anchor })
    }),
    knob(s, 'Autoplay', cx, cy, 20, (-100 + stop * span + 135) / 270, { style: 'metal', arc: false }),
  ])
}

/** A guitar headstock to the left of the nut, tuners and the strings' run to them. */
function headstock(s: Studio, nx: number, stringY: number[], y: number, h: number, o: { face?: string; shade?: string } = {}): NodeId {
  const n = stringY.length
  const perSide = Math.ceil(n / 2)
  const top = y - 44
  const bottom = y + h + 44
  const ids: NodeId[] = [
    s.path('Headstock', `M${nx} ${y - 4}C${nx - 30} ${top + 10} ${nx - 60} ${top} ${nx - 90} ${top}L-10 ${top}L-10 ${bottom}L${nx - 90} ${bottom}C${nx - 60} ${bottom} ${nx - 30} ${bottom - 10} ${nx} ${y + h + 4}Z`, {
      fill: linear([[o.face ?? '#3A2014', 0], [o.shade ?? '#24120A', 0.5], [o.face ?? '#3A2014', 1]]), closed: true,
    }),
  ]
  const posts: Array<[number, number]> = []
  for (let i = 0; i < n; i++) {
    const upper = i < perSide
    const k = upper ? i : n - 1 - i
    posts.push([nx - 30 - (perSide - 1 - k) * 30, upper ? y + 16 : y + h - 16])
  }
  let run = ''
  stringY.forEach((sy, i) => { run += `M${nx} ${f(sy)}L${f(posts[i]![0])} ${f(posts[i]![1])}` })
  ids.push(s.path('String Run', run, { stroke: '#D9D5CA', width: 1.6, alpha: 0.85 }))
  ids.push(s.group('Tuners', posts.map(([px, py], i) => s.group(`Tuner ${i + 1}`, [
    s.circle('Bushing', px, py, 11, { fill: linear([['#FFFFFF', 0], ['#8E8F96', 0.6], ['#55565C', 1]]), shadow: shadow(2, 4, 0.6, 0, '#000000') }),
    s.circle('Post', px, py, 5, { fill: radialAt([['#FFFFFF', 0], ['#9A9BA2', 1]], 0.4, 0.35, 0.7) }),
  ]))))
  return s.group('Headstock', ids)
}

// ---------------------------------------------------------------------------
// 13 Acoustic Guitar
// ---------------------------------------------------------------------------

export function acousticGuitar(s: Studio): void {
  chrome(s, { bar: 6, beat: 1, tempo: 88, key: 'E min', active: 'browser', playing: true })
  strip(s)
  s.group('Mode', [s.label('Caption', 'play', 24, 108), segmented(s, 'Chords or Notes', 24, 128, ['Chords', 'Notes'], 1, { h: 40, accent: C.guitar }).id])
  dropdown(s, 'Scale', 'Minor Pentatonic', 220, 128, 200)
  dropdown(s, 'Guitar', 'Steel String Acoustic', 440, 128, 220)
  s.group('Note Names', [
    s.label('Caption', 'note names', 684, 108),
    toggle(s, 'Note Names', 684, 135, true, C.guitar),
  ])
  s.group('Fret Position', [
    s.label('Caption', 'position', 780, 108),
    s.text('Value', 'Frets 0 – 12', 780, 138, { size: 14, weight: 600, color: C.text }),
  ])
  s.group('Sustain', [s.label('Caption', 'sustain', 1062, 108), panelButton(s, 'Sustain', 1062, 128, 116, 40, { label: 'Let Ring', on: true, accent: C.guitar })])

  // The body beyond the twelfth fret: spruce top, rosette, sound hole.
  const bx = 1068
  s.group('Body', [
    s.path('Top', `M${bx} 196C${bx + 60} 190 1194 200 1194 200L1194 834L${bx} 834Z`, { fill: linear([['#E9C98C', 0], ['#D8B06A', 0.5], ['#C89A52', 1]], 0, 0, 1, 0), closed: true }),
    s.path('Grain', Array.from({ length: 16 }, (_, i) => `M${bx + 6 + i * 8} 200v634`).join(''), { stroke: '#8A5A20', width: 1, alpha: 0.18 }),
    s.path('Rosette', `${ring(1260, 474, 214)}${ring(1260, 474, 198)}${ring(1260, 474, 190)}`, { stroke: '#2A1A0A', width: 3, alpha: 0.7 }),
    s.circle('Sound Hole', 1260, 474, 182, { fill: radialAt([['#000000', 0], ['#0A0604', 0.8], ['#2A1A0A', 1]]) }),
  ])
  const nx = 110
  const y = 244
  const h = 470
  const n = neck(s, nx, y, bx - nx + 30, h, { strings: 6, frets: 12, nut: true })
  // The strings carry on over the sound hole to the bridge.
  s.group('Strings Over Body', n.stringY.map((sy, i) => s.rect(`String ${6 - i} Run`, bx + 30, sy - [1.6, 2, 2.6, 3.4, 4.2, 5][i]! / 2, 1194 - bx - 30, [1.6, 2, 2.6, 3.4, 4.2, 5][i]!, {
    fill: linear(i >= 3 ? [['#FFF0C8', 0], ['#D4A55C', 0.4], ['#8A6428', 0.8], ['#4E3610', 1]] : [['#FFFFFF', 0], ['#D8D8DE', 0.4], ['#8A8A92', 0.8], ['#4A4A50', 1]]),
    shadow: shadow(6, 4, 0.5, 2, '#000000'),
  })))
  headstock(s, nx, n.stringY, y, h)

  // E minor pentatonic, first position, with the note names.
  const open = [4, 11, 7, 2, 9, 4] // high E at the top
  const scale = new Set([4, 7, 9, 11, 2])
  const lick: Array<[number, number]> = [[0, 3], [1, 3], [2, 2], [3, 2], [4, 2], [5, 3], [2, 4], [4, 5]]
  s.group('Scale Notes', lick.map(([str, fret]) => {
    const note = (open[str]! + fret) % 12
    const x = (n.fretX[fret - 1]! + n.fretX[fret]!) / 2
    const root = note === 4
    return fingerDot(s, `${NOTE[note]} fret ${fret}`, x, n.stringY[str]!, 22, root ? C.guitar : '#9FF0BD', scale.has(note) ? NOTE[note] : undefined)
  }))
  s.group('Fret Numbers', Array.from({ length: 12 }, (_, i) => {
    const x = (n.fretX[i]! + n.fretX[i + 1]!) / 2
    return s.text(`Fret ${i + 1}`, String(i + 1), x, 752, { size: 12, weight: 600, family: MONO, color: [3, 5, 7, 9, 12].includes(i + 1) ? C.text : C.faint, anchor: 'center' })
  }))
  s.text('Hint', 'Tap a string to pluck it  ·  slide for a bend', 597, 790, { size: 12, color: C.dim, anchor: 'center' })
}

// ---------------------------------------------------------------------------
// 14 Smart Guitar
// ---------------------------------------------------------------------------

export function smartGuitar(s: Studio): void {
  chrome(s, { bar: 14, beat: 2, tempo: 104, key: 'C maj', active: 'browser', playing: true })
  strip(s, 112)
  s.group('Mode', [s.label('Caption', 'play', 24, 112), segmented(s, 'Chords or Notes', 24, 132, ['Chords', 'Notes'], 0, { h: 40, accent: C.guitar }).id])
  s.group('Autoplay Control', [s.label('Caption', 'autoplay', 290, 188, { anchor: 'center' }), autoplay(s, 290, 150, 3, C.guitar)])
  dropdown(s, 'Guitar', 'Classic Clean', 380, 132, 200)
  s.group('Strum', [
    s.label('Caption', 'strum', 604, 112),
    segmented(s, 'Strum Direction', 604, 132, ['Down', 'Up', 'Both'], 2, { h: 40 }).id,
  ])
  s.group('Chord Editor', [s.label('Caption', 'chords', 1062, 112), panelButton(s, 'Edit Chords', 1062, 132, 116, 40, { icon: I.grid, label: 'Edit' })])

  const chords = ['Em', 'Am', 'Dm', 'G', 'C', 'F', 'B♭', 'Bdim']
  const y = 268
  const h = 520
  const n = neck(s, 0, y, 1194, h, { strings: 6, frets: 8, board: [['#241610', 0], ['#1A0F0A', 0.5], ['#120A06', 1]], real: false })
  s.group('Chord Headers', chords.map((name, i) => {
    const x0 = n.fretX[i]!
    const x1 = n.fretX[i + 1]!
    const on = name === 'G'
    return s.group(`Chord / ${name}`, [
      s.rect('Chip', x0 + 8, 216, x1 - x0 - 16, 40, {
        fill: on ? linear([[C.guitar, 0], ['#2FAE5B', 1]]) : linear([['#34343C', 0], ['#27272D', 1]]),
        radius: 10, stroke: { color: '#000000', width: 1, alpha: 0.4 }, ...(on ? { shadow: glow(C.guitar, 14, 0.6) } : {}),
      }),
      s.centeredText('Name', name, { x: x0 + 8, y: 216, w: x1 - x0 - 16, h: 40 }, { size: 17, weight: 700, color: on ? '#0E2A18' : C.text }),
    ])
  }))
  // The pressed chord: its column lights up and its strings shimmer.
  const g0 = n.fretX[3]!
  const g1 = n.fretX[4]!
  s.group('Strum Highlight', [
    s.rect('Column', g0 + 3, y, g1 - g0 - 6, h, { fill: linear([[C.guitar, 0, 0.3], [C.guitar, 0.5, 0.12], [C.guitar, 1, 0.3]]) }),
    ...n.stringY.map((sy, i) => s.fx(s.path(`Vibration ${6 - i}`, smooth(Array.from({ length: 9 }, (_, k) => [g0 + 4 + (k * (g1 - g0 - 8)) / 8, sy + (k % 2 ? 1 : -1) * (k === 0 || k === 8 ? 0 : 3.5 - Math.abs(4 - k) * 0.6)] as [number, number])), {
      stroke: '#CFFFE0', width: 2.2,
    }), { shadow: glow(C.guitar, 8, 0.9) })),
  ])
  s.text('Hint', 'Tap a chord to strum it, or tap single strings within it to pick', 597, 802, { size: 12, color: C.dim, anchor: 'center' })
}

// ---------------------------------------------------------------------------
// 15 Electric Guitar and Amp
// ---------------------------------------------------------------------------

function stompbox(s: Studio, name: string, x: number, y: number, colours: [string, string], knobs: string[], on: boolean, ink = '#FFFFFF'): NodeId {
  const w = 190
  const h = 168
  const ids: NodeId[] = [
    s.rect('Enclosure', x, y, w, h, { fill: linear([[colours[0], 0], [colours[1], 1]]), radius: 12, shadow: shadow(8, 14, 0.7, 0, '#000000'), stroke: { color: '#000000', width: 1, alpha: 0.4 } }),
    s.rect('Bevel', x + 3, y + 3, w - 6, 10, { fill: linear([['#FFFFFF', 0, 0.35], ['#FFFFFF', 1, 0]]), radius: [9, 9, 0, 0] }),
  ]
  knobs.forEach((label, i) => {
    const cx = x + (w / (knobs.length + 1)) * (i + 1)
    ids.push(knob(s, label, cx, y + 38, 15, [0.62, 0.4, 0.75][i]!, { style: 'black', color: '#FFFFFF', arc: false, label, labelColor: ink, labelBelow: 22 }))
  })
  ids.push(led(s, name, x + w / 2, y + 88, '#FF3B30', on, 4))
  ids.push(s.text('Name', name.toUpperCase(), x + w / 2, y + 100, { size: 14, weight: 600, family: 'Oswald', color: ink, anchor: 'center', letterSpacing: 0.12 }))
  ids.push(s.circle('Footswitch Base', x + w / 2, y + 144, 16, { fill: linear([['#55565C', 0], ['#1A1A1E', 1]]) }))
  ids.push(s.circle('Footswitch', x + w / 2, y + 142, 12, { fill: radialAt([['#FFFFFF', 0], ['#B9BAC1', 0.55], ['#6E7078', 1]], 0.4, 0.3, 0.7), shadow: shadow(3, 4, 0.6, 0, '#000000') }))
  return s.group(`Pedal / ${name}`, ids)
}

export function electricGuitar(s: Studio): void {
  chrome(s, { bar: 25, beat: 1, tempo: 132, key: 'A min', active: 'browser', playing: true })
  s.rect('Room', 0, 96, 1194, 738, { fill: linear([['#1E1E22', 0], ['#141417', 1]]) })

  // The combo amp.
  const ax = 40
  const ay = 110
  const aw = 1114
  const ah = 356
  s.group('Amp', [
    s.rect('Cabinet Shadow', ax, ay + 10, aw, ah, { fill: '#000000', opacity: 0.6, radius: 20 }),
    tolex(s, 'Tolex', ax, ay, aw, ah, ['#26262A', '#141416'], '#FFFFFF'),
    s.rect('Piping', ax + 10, ay + 10, aw - 20, ah - 20, { fill: { type: 'none' }, radius: 12, stroke: { color: '#E8E1CF', width: 2, alpha: 0.8 } }),
  ])
  const px = ax + 24
  const py = ay + 24
  const pw = aw - 48
  s.group('Control Panel', [
    s.rect('Plate', px, py, pw, 108, { fill: linear([['#E9D9A8', 0], ['#C9B06A', 0.5], ['#B39A55', 1]]), radius: 6, shadow: shadow(2, 4, 0.5, 0, '#000000') }),
    s.path('Brushing', Array.from({ length: 26 }, (_, i) => `M${px} ${py + 4 + i * 4}h${pw}`).join(''), { stroke: '#FFFFFF', width: 1, alpha: 0.1 }),
    s.group('Input', [
      s.circle('Jack', px + 40, py + 52, 12, { fill: linear([['#FFFFFF', 0], ['#7B7C82', 1]]) }),
      s.circle('Socket', px + 40, py + 52, 6, { fill: '#0A0A0C' }),
      s.text('Label', 'INPUT', px + 40, py + 74, { ...LABEL, color: '#3A2A10', anchor: 'center' }),
    ]),
  ])
  const ampKnobs: Array<[string, number]> = [['Gain', 0.78], ['Bass', 0.55], ['Mid', 0.42], ['Treble', 0.66], ['Presence', 0.5], ['Master', 0.35]]
  s.group('Amp Knobs', ampKnobs.map(([name, v], i) =>
    knob(s, name, px + 150 + i * 118, py + 44, 22, v, { style: 'amp', arc: false, scale: 11, label: name, labelColor: '#3A2A10', labelBelow: 38 }),
  ))
  s.group('Power', [
    s.circle('Jewel Bezel', px + pw - 110, py + 44, 16, { fill: linear([['#FFFFFF', 0], ['#7B7C82', 1]]) }),
    s.fx(s.circle('Jewel', px + pw - 110, py + 44, 11, { fill: radialAt([['#FFD0C8', 0], ['#FF3B30', 0.5], ['#8A0A04', 1]], 0.4, 0.35, 0.7) }), { shadow: glow('#FF3B30', 16, 0.9) }),
    s.text('Standby Label', 'STANDBY', px + pw - 44, py + 74, { ...LABEL, color: '#3A2A10', anchor: 'center' }),
    s.rect('Toggle Plate', px + pw - 54, py + 30, 20, 28, { fill: linear([['#FFFFFF', 0], ['#8E8F96', 1]]), radius: 3 }),
    s.rect('Toggle Bat', px + pw - 47, py + 18, 6, 24, { fill: linear([['#FFFFFF', 0], ['#6E7078', 1]], 0, 0, 1, 0), radius: 3 }),
  ])
  // Grille cloth with the speakers showing through.
  const gy = py + 124
  const gh = ah - 24 - 124 - 24
  let weave = ''
  for (let i = -gh; i < pw; i += 6) weave += `M${px + Math.max(0, i)} ${f(gy + Math.max(0, -i))}L${f(px + Math.min(pw, i + gh))} ${f(gy + Math.min(gh, pw - i))}`
  s.group('Grille', [
    s.rect('Cloth', px, gy, pw, gh, { fill: linear([['#5A4632', 0], ['#46362A', 1]]), radius: 4 }),
    s.circle('Speaker Left', px + pw * 0.3, gy + gh / 2, 84, { fill: radialAt([['#000000', 0, 0.5], ['#000000', 0.7, 0.35], ['#000000', 1, 0]]) }),
    s.circle('Speaker Right', px + pw * 0.7, gy + gh / 2, 84, { fill: radialAt([['#000000', 0, 0.5], ['#000000', 0.7, 0.35], ['#000000', 1, 0]]) }),
    s.path('Weave', weave, { stroke: '#D9C49A', width: 1.2, alpha: 0.22 }),
    s.rect('Logo Plate', px + 28, gy + 20, 150, 40, { fill: linear([['#F4F4F6', 0], ['#A9AAB1', 0.5], ['#E4E5E9', 1]]), radius: 6, shadow: shadow(3, 6, 0.6, 0, '#000000') }),
    s.centeredText('Logo', 'HALDEN', { x: px + 28, y: gy + 20, w: 150, h: 40 }, { size: 20, weight: 600, family: 'Oswald', color: '#1A1A1E', letterSpacing: 0.3 }),
  ])

  // Pedalboard
  s.group('Pedalboard', [
    s.rect('Board', 40, 486, 1114, 196, { fill: linear([['#1A1A1C', 0], ['#0E0E10', 1]]), radius: 14, stroke: { color: '#FFFFFF', width: 1, alpha: 0.05 } }),
    s.path('Cables', [
      smooth([[250, 530], [270, 510], [300, 510], [314, 530]]),
      smooth([[504, 530], [520, 510], [552, 510], [568, 530]]),
      smooth([[758, 530], [774, 510], [806, 510], [822, 530]]),
    ].join(''), { stroke: '#111114', width: 7 }),
  ])
  stompbox(s, 'Overdrive', 64, 500, ['#3FAE5A', '#1F7A38'], ['Drive', 'Tone', 'Level'], true, '#0E2A16')
  stompbox(s, 'Chorus', 318, 500, ['#6FA8FF', '#2E5FC9'], ['Rate', 'Depth'], false)
  stompbox(s, 'Delay', 572, 500, ['#B7C2CC', '#7E8994'], ['Time', 'Repeats', 'Mix'], true, '#1A1E24')
  stompbox(s, 'Fuzz', 826, 500, ['#FF9A3D', '#D0561A'], ['Fuzz', 'Volume'], false, '#2A1406')
  s.group('Tuner', [
    s.rect('Body', 1040, 500, 98, 168, { fill: linear([['#2E2E34', 0], ['#1A1A1E', 1]]), radius: 12, shadow: shadow(8, 14, 0.7, 0, '#000000') }),
    s.fx(s.rect('Screen', 1052, 516, 74, 56, { fill: '#050507', radius: 6 }), { inner: shadow(1, 4, 0.8, 0, '#000000') }),
    s.lit('Note', 'A', 1089, 522, { size: 30, weight: 700, family: MONO, color: C.guitar, anchor: 'center' }, 8),
    s.text('Cents', '+2¢', 1089, 580, { size: 11, weight: 600, family: MONO, color: C.guitar, anchor: 'center' }),
    s.text('Label', 'TUNER', 1089, 604, { ...LABEL, anchor: 'center' }),
    s.circle('Footswitch', 1089, 642, 12, { fill: radialAt([['#FFFFFF', 0], ['#B9BAC1', 0.55], ['#6E7078', 1]], 0.4, 0.3, 0.7), shadow: shadow(3, 4, 0.6, 0, '#000000') }),
  ])

  // A short neck to play on.
  const n = neck(s, 0, 702, 1194, 132, { strings: 6, frets: 12, gauges: [1.2, 1.5, 2, 2.6, 3.2, 3.8], board: [['#3A2214', 0], ['#2C180D', 1]] })
  s.group('Chord Shape', [
    fingerDot(s, 'A5 root', (n.fretX[4]! + n.fretX[5]!) / 2, n.stringY[5]!, 10, C.guitar),
    fingerDot(s, 'A5 fifth', (n.fretX[6]! + n.fretX[7]!) / 2, n.stringY[4]!, 10, C.guitar),
    fingerDot(s, 'A5 octave', (n.fretX[6]! + n.fretX[7]!) / 2, n.stringY[3]!, 10, C.guitar),
  ])
}

// ---------------------------------------------------------------------------
// 16 Bass
// ---------------------------------------------------------------------------

export function bass(s: Studio): void {
  chrome(s, { bar: 9, beat: 4, tempo: 98, key: 'E min', active: 'browser', playing: true })
  strip(s)
  s.group('Mode', [s.label('Caption', 'play', 24, 108), segmented(s, 'Chords or Notes', 24, 128, ['Chords', 'Notes'], 1, { h: 40, accent: C.bass }).id])
  dropdown(s, 'Scale', 'E Minor Pentatonic', 220, 128, 210)
  dropdown(s, 'Bass', 'Warm Fingered', 450, 128, 190)
  s.group('Amp', [
    knob(s, 'Tone', 700, 148, 16, 0.55, { color: C.bass }),
    s.label('Tone Label', 'tone', 724, 136),
    knob(s, 'Drive', 800, 148, 16, 0.25, { color: C.bass }),
    s.label('Drive Label', 'drive', 824, 136),
    knob(s, 'Comp', 900, 148, 16, 0.6, { color: C.bass }),
    s.label('Comp Label', 'comp', 924, 136),
  ])
  s.group('Sustain', [s.label('Caption', 'slide', 1062, 108), panelButton(s, 'Slide', 1062, 128, 116, 40, { label: 'Glide', on: true, accent: C.bass })])

  const nx = 110
  const y = 244
  const h = 460
  const n = neck(s, nx, y, 1194 - nx, h, {
    strings: 4, frets: 12, nut: true, gauges: [4.2, 5.4, 6.6, 8], wound: 4,
    board: [['#E9C88E', 0], ['#DDB676', 0.5], ['#CFA25E', 1]], grain: '#8A5A20', inlay: 'dot',
    inlayFill: radialAt([['#3A3A40', 0], ['#0A0A0C', 1]]),
  })
  headstock(s, nx, n.stringY, y, h, { face: '#D9B070', shade: '#B88A48' })
  // E minor pentatonic across the neck: G, D, A, E strings, top to bottom.
  const open = [7, 2, 9, 4]
  const scale = new Set([4, 7, 9, 11, 2])
  const dots: NodeId[] = []
  n.stringY.forEach((sy, str) => {
    for (let fret = 1; fret <= 12; fret++) {
      const note = (open[str]! + fret) % 12
      if (!scale.has(note)) continue
      const x = (n.fretX[fret - 1]! + n.fretX[fret]!) / 2
      const root = note === 4
      dots.push(fingerDot(s, `${NOTE[note]} fret ${fret}`, x, sy, root ? 24 : 20, root ? C.bass : '#FFC9A0', NOTE[note]))
    }
  })
  s.group('Scale Notes', dots)
  s.group('Open Strings', n.stringY.map((sy, i) => s.text(`Open ${NOTE[open[i]!]}`, NOTE[open[i]!]!, nx + 12, sy - 26, { size: 11, weight: 700, color: '#3A2A10', anchor: 'center' })))
  s.group('Fret Numbers', Array.from({ length: 12 }, (_, i) => {
    const x = (n.fretX[i]! + n.fretX[i + 1]!) / 2
    return s.text(`Fret ${i + 1}`, String(i + 1), x, 742, { size: 12, weight: 600, family: MONO, color: [3, 5, 7, 9, 12].includes(i + 1) ? C.text : C.faint, anchor: 'center' })
  }))
  s.group('Legend', [
    s.circle('Root Swatch', 440, 792, 7, { fill: C.bass }),
    s.text('Root', 'Root (E)', 454, 784, { size: 12, weight: 500, color: C.dim }),
    s.circle('Scale Swatch', 560, 792, 7, { fill: '#FFC9A0' }),
    s.text('Scale', 'In scale', 574, 784, { size: 12, weight: 500, color: C.dim }),
    s.text('Tip', 'Out-of-scale notes are hidden', 680, 784, { size: 12, color: C.faint }),
  ])
}

// ---------------------------------------------------------------------------
// Violin-family silhouettes
// ---------------------------------------------------------------------------

/** A violin-family instrument, upright, body `b` tall with its centre at cx, cy. */
export function fiddle(s: Studio, name: string, cx: number, cy: number, b: number, o: { varnish?: [string, string]; lit?: string } = {}): NodeId {
  const p = (x: number, y: number) => `${f(cx + x * b)} ${f(cy + y * b)}`
  const body = `M${p(0, -0.5)}C${p(0.12, -0.5)} ${p(0.25, -0.44)} ${p(0.25, -0.3)}C${p(0.25, -0.2)} ${p(0.2, -0.14)} ${p(0.19, -0.12)}`
    + `C${p(0.14, -0.08)} ${p(0.13, 0.04)} ${p(0.19, 0.1)}C${p(0.22, 0.13)} ${p(0.3, 0.18)} ${p(0.3, 0.28)}C${p(0.3, 0.42)} ${p(0.16, 0.5)} ${p(0, 0.5)}`
    + `C${p(-0.16, 0.5)} ${p(-0.3, 0.42)} ${p(-0.3, 0.28)}C${p(-0.3, 0.18)} ${p(-0.22, 0.13)} ${p(-0.19, 0.1)}`
    + `C${p(-0.13, 0.04)} ${p(-0.14, -0.08)} ${p(-0.19, -0.12)}C${p(-0.2, -0.14)} ${p(-0.25, -0.2)} ${p(-0.25, -0.3)}C${p(-0.25, -0.44)} ${p(-0.12, -0.5)} ${p(0, -0.5)}Z`
  const fhole = (side: number) => `M${p(side * 0.1, -0.08)}C${p(side * 0.16, -0.06)} ${p(side * 0.08, 0.06)} ${p(side * 0.13, 0.14)}`
  const varnish = o.varnish ?? ['#D9822B', '#7A3510']
  const ids: NodeId[] = []
  if (o.lit) ids.push(s.circle('Glow', cx, cy, b * 0.62, { fill: radialAt([[o.lit, 0, 0.45], [o.lit, 1, 0]]) }))
  ids.push(
    s.path('Neck', `M${p(-0.035, -0.5)}L${p(-0.03, -1.04)}L${p(0.03, -1.04)}L${p(0.035, -0.5)}Z`, { fill: linear([['#C98A4A', 0], ['#8A5226', 1]], 0, 0, 1, 0), closed: true }),
    s.path('Scroll', `${ring(cx, cy - b * 1.1, b * 0.06)}`, { fill: radialAt([['#D9924E', 0], ['#7A4018', 1]]), closed: true }),
    s.path('Body', body, { fill: radialAt([[varnish[0], 0], [varnish[1], 1]], 0.4, 0.35, 0.75), closed: true }),
    s.path('Purfling', body, { stroke: '#2A1206', width: 1, alpha: 0.5 }),
    s.path('Fingerboard', `M${p(-0.04, -1.0)}L${p(-0.055, 0.02)}L${p(0.055, 0.02)}L${p(0.04, -1.0)}Z`, { fill: '#141010', closed: true }),
    s.path('F-Holes', `${fhole(-1)}${fhole(1)}`, { stroke: '#1A0A04', width: Math.max(1.2, b * 0.02) }),
    s.rect('Bridge', cx - b * 0.08, cy + b * 0.1, b * 0.16, b * 0.025, { fill: '#E9D2A8', radius: 1 }),
    s.path('Tailpiece', `M${p(-0.05, 0.16)}L${p(-0.035, 0.42)}L${p(0.035, 0.42)}L${p(0.05, 0.16)}Z`, { fill: '#141010', closed: true }),
    s.path('Strings', `M${p(-0.02, -1.0)}L${p(-0.03, 0.16)}M${p(-0.007, -1.0)}L${p(-0.01, 0.16)}M${p(0.007, -1.0)}L${p(0.01, 0.16)}M${p(0.02, -1.0)}L${p(0.03, 0.16)}`, { stroke: '#E8E4DA', width: 0.6, alpha: 0.8 }),
  )
  return s.group(`Instrument / ${name}`, ids)
}

// ---------------------------------------------------------------------------
// 17 Strings Ensemble
// ---------------------------------------------------------------------------

const SECTIONS: Array<[string, string, number, [string, string], string[]]> = [
  ['Violins', 'First and second', 62, ['#E0943A', '#8A3F12'], ['G', 'D', 'A', 'E']],
  ['Violas', 'Alto voice', 68, ['#D07A2C', '#7A3510'], ['C', 'G', 'D', 'A']],
  ['Cellos', 'Tenor and bass', 74, ['#B8621E', '#5E2A0A'], ['C', 'G', 'D', 'A']],
  ['Basses', 'Contrabass', 78, ['#A0521A', '#4A2008'], ['E', 'A', 'D', 'G']],
]

/** Every other semitone up each section's lowest string, for the lane labels. */
const LANE_NOTES = [
  ['G♯', 'A♯', 'C', 'D', 'E', 'F♯', 'G♯', 'A♯', 'C', 'D', 'E', 'F♯'],
  ['C♯', 'D♯', 'F', 'G', 'A', 'B', 'C♯', 'D♯', 'F', 'G', 'A', 'B'],
  ['C♯', 'D♯', 'F', 'G', 'A', 'B', 'C♯', 'D♯', 'F', 'G', 'A', 'B'],
  ['F', 'G', 'A', 'B', 'C♯', 'D♯', 'F', 'G', 'A', 'B', 'C♯', 'D♯'],
]

export function stringsEnsemble(s: Studio): void {
  chrome(s, { bar: 41, beat: 1, tempo: 72, key: 'D maj', active: 'browser', playing: true })
  strip(s)
  s.group('Articulation', [
    s.label('Caption', 'articulation', 24, 108),
    segmented(s, 'Articulation', 24, 128, ['Legato', 'Staccato', 'Pizzicato', 'Tremolo'], 0, { h: 40, accent: C.strings }).id,
  ])
  s.group('Ensemble Size', [
    s.label('Caption', 'ensemble', 440, 108),
    segmented(s, 'Ensemble', 440, 128, ['Chamber', 'Orchestra'], 1, { h: 40 }).id,
  ])
  s.group('Vibrato', [
    s.label('Caption', 'vibrato', 682, 108),
    knob(s, 'Vibrato', 700, 150, 16, 0.58, { color: C.strings }),
    s.text('Value', '58%', 724, 142, { size: 13, weight: 600, family: MONO, color: C.strings }),
  ])
  s.group('Expression', [
    s.label('Caption', 'expression', 790, 108),
    s.fx(s.rect('Track', 790, 144, 200, 8, { fill: '#0E0E11', radius: 4 }), { inner: shadow(1, 2, 0.8, 0, '#000000') }),
    s.fx(s.rect('Level', 790, 144, 136, 8, { fill: C.strings, radius: 4 }), { shadow: glow(C.strings, 6, 0.5) }),
    s.circle('Thumb', 926, 148, 11, { fill: linear([['#FFFFFF', 0], ['#DEDEE4', 1]]), shadow: shadow(2, 4, 0.5, 0, '#000000') }),
  ])
  s.group('Chords Toggle', [s.label('Caption', 'play', 1062, 108), panelButton(s, 'Chords', 1062, 128, 116, 40, { label: 'Notes', on: true, accent: C.strings })])

  const top = 204
  const laneH = 148
  SECTIONS.forEach(([name, sub, b, varnish, open], i) => {
    const y = top + i * (laneH + 8)
    const active = i === 0 || i === 2
    const board = 212
    const bw = 1178 - board
    let strings = ''
    const sy = (k: number) => y + 26 + (k * (laneH - 52)) / 3
    for (let k = 0; k < 4; k++) strings += `M${board} ${f(sy(k))}h${bw}`
    let marks = ''
    for (let n = 1; n < 24; n++) marks += `M${f(board + (bw * n) / 24)} ${y + 10}v${laneH - 20}`
    const parts: NodeId[] = [
      s.rect('Card', 16, y, 184, laneH, { fill: linear([['#2A2A31', 0], ['#222228', 1]]), radius: 12, stroke: { color: active ? C.strings : '#FFFFFF', width: 1, alpha: active ? 0.6 : 0.05 } }),
      fiddle(s, name, 62, y + 8 + 1.16 * b + (132 - 1.66 * b) / 2, b, { varnish, ...(active ? { lit: C.strings } : {}) }),
      s.text('Name', name, 108, y + 44, { size: 15, weight: 600, color: C.text }),
      s.text('Sub', sub, 108, y + 66, { size: 11, color: C.dim }),
      s.text('Tuning', open.join(' · '), 108, y + 96, { size: 11, weight: 600, family: MONO, color: active ? C.strings : C.faint }),
      s.rect('Fingerboard', board, y, bw, laneH, { fill: linear([['#1A1210', 0], ['#0E0A08', 0.5], ['#1A1210', 1]]), radius: 12 }),
      s.path('Positions', marks, { stroke: '#FFFFFF', width: 1, alpha: 0.04 }),
      s.path('Strings', strings, { stroke: '#D8D2C4', width: 1.6 + i * 0.5, alpha: 0.85 }),
      s.group('Note Names', LANE_NOTES[i]!.map((note, k) => s.text(`Note ${note}`, note, board + (bw * (k * 2 + 1)) / 24, y + laneH - 20, {
        size: 10, weight: 600, family: MONO, color: '#FFFFFF', opacity: 0.28, anchor: 'center',
      }))),
    ]
    if (active) {
      const k = i === 0 ? 2 : 1
      const x0 = board + bw * (i === 0 ? 0.42 : 0.18)
      const x1 = x0 + bw * 0.26
      const wave: Array<[number, number]> = []
      for (let t = 0; t <= 24; t++) wave.push([x0 + ((x1 - x0) * t) / 24, sy(k) + Math.sin(t * 1.3) * 5])
      parts.push(
        s.rect('Bowing Strip', x0, sy(k) - 22, x1 - x0, 44, { fill: linear([[C.strings, 0, 0], [C.strings, 0.5, 0.28], [C.strings, 1, 0]], 0, 0, 1, 0), radius: 22 }),
        s.fx(s.path('Vibrato', smooth(wave), { stroke: '#D8FFFC', width: 2.5 }), { shadow: glow(C.strings, 10, 1) }),
        fingerDot(s, i === 0 ? 'F♯5' : 'D3', x0, sy(k), 16, C.strings),
        s.text('Bow Direction', i === 0 ? 'down-bow  →' : '←  up-bow', x1 + 12, sy(k) - 8, { size: 11, weight: 600, color: C.strings }),
      )
    }
    s.group(`Section / ${name}`, parts)
  })
}

// ---------------------------------------------------------------------------
// 18 Smart Strings
// ---------------------------------------------------------------------------

export function smartStrings(s: Studio): void {
  chrome(s, { bar: 18, beat: 3, tempo: 76, key: 'G maj', active: 'browser', playing: true })
  strip(s, 144)
  s.group('Arrangement', [
    s.label('Caption', 'arrangement', 118, 224, { anchor: 'center' }),
    autoplay(s, 118, 166, 2, C.strings, ['Off', 'Modern', 'Cinema', 'Pop', 'Romantic']),
  ])
  s.group('Style', [
    s.text('Title', 'Cinematic', 214, 124, { size: 20, weight: 700, color: C.text }),
    s.text('Description', 'Long sustained lines with swelling dynamics, low strings doubling the bass.', 214, 154, { size: 12, color: C.dim, width: 330, lineHeight: 1.45 }),
  ])
  const parts: Array<[string, number, boolean]> = [['Violin I', 36, true], ['Violin II', 36, true], ['Viola', 40, false], ['Cello', 44, true], ['Bass', 48, true]]
  s.group('Sections', parts.map(([name, b, on], i) => {
    const x = 604 + i * 116
    return s.group(`Section Toggle / ${name}`, [
      s.rect('Button', x, 108, 104, 120, {
        fill: on ? linear([['#1F4A4A', 0], ['#173636', 1]]) : linear([['#2C2C33', 0], ['#232328', 1]]),
        radius: 12, stroke: { color: on ? C.strings : '#000000', width: 1, alpha: on ? 0.8 : 0.4 },
        ...(on ? { shadow: glow(C.strings, 12, 0.35) } : {}),
      }),
      fiddle(s, name, x + 52, 108 + 50 + b * 0.25 - 4, b * 0.8, { varnish: on ? ['#E0943A', '#8A3F12'] : ['#6A5A4A', '#3A2E24'] }),
      s.text('Name', name, x + 52, 204, { size: 12, weight: 600, color: on ? '#D8FFFC' : C.dim, anchor: 'center' }),
    ])
  }))

  const chords = ['G', 'Am', 'Bm', 'C', 'D', 'Em', 'F', 'Dsus4']
  const sw = 138
  const gap = (1194 - 32 - sw * 8) / 7
  s.group('Chord Strips', chords.map((name, i) => {
    const x = 16 + i * (sw + gap)
    const on = name === 'Em'
    const y = 256
    const h = 562
    let lines = ''
    for (let k = 0; k < 4; k++) lines += `M${f(x + 30 + k * 26)} ${y + 64}V${y + h - 12}`
    const ids: NodeId[] = [
      s.group('Wood', [wood(s, 'Wood', x, y, sw, h, {
        base: on ? [['#3A7070', 0], ['#1E4A4A', 1]] : [['#3A2418', 0], ['#24160E', 1]], vertical: true, seed: i + 40, radius: 12, alpha: on ? 0.12 : 0.22,
      })]),
      s.rect('Header', x, y, sw, 56, { fill: '#000000', opacity: on ? 0.1 : 0.3, radius: [12, 12, 0, 0] }),
      s.centeredText('Name', name, { x, y, w: sw, h: 56 }, { size: 22, weight: 700, color: on ? '#FFFFFF' : C.text }),
      s.path('Strings', lines, { stroke: on ? '#D8FFFC' : '#D8D2C4', width: 1.5, alpha: on ? 0.9 : 0.5 }),
    ]
    if (on) {
      ids.push(
        s.fx(s.rect('Outline', x, y, sw, h, { fill: { type: 'none' }, radius: 12, stroke: { color: C.strings, width: 2 } }), { shadow: glow(C.strings, 20, 0.7) }),
        s.fx(s.rect('Bow', x + 12, y + 300, sw - 24, 10, { fill: '#D8FFFC', radius: 5 }), { shadow: glow(C.strings, 12, 1) }),
        s.icon('Bow Up', 'M12 19V5 M7 10l5-5 5 5', x + sw / 2 - 12, y + 250, 24, '#D8FFFC', { width: 2 }),
        s.icon('Bow Down', 'M12 5v14 M7 14l5 5 5-5', x + sw / 2 - 12, y + 322, 24, '#D8FFFC', { width: 2 }),
      )
    }
    return s.group(`Strip / ${name}`, ids)
  }))
}

// ---------------------------------------------------------------------------
// 21 World: a koto-style zither
// ---------------------------------------------------------------------------

export function zither(s: Studio): void {
  chrome(s, { bar: 13, beat: 2, tempo: 80, key: 'A min', active: 'browser', playing: true })
  strip(s)
  dropdown(s, 'Instrument', 'Thirteen-String Zither', 24, 128, 240)
  dropdown(s, 'Scale', 'Hirajoshi', 284, 128, 170)
  s.group('Mode', [s.label('Caption', 'play', 474, 108), segmented(s, 'Chords or Notes', 474, 128, ['Chords', 'Notes'], 1, { h: 40, accent: C.world }).id])
  s.group('Autoplay Control', [s.label('Caption', 'autoplay', 740, 176, { anchor: 'center' }), autoplay(s, 740, 144, 0, C.world)])
  s.group('Tremolo', [s.label('Caption', 'tremolo pick', 830, 108), toggle(s, 'Tremolo', 830, 135, true, C.world)])
  s.group('Bend', [s.label('Caption', 'press to bend', 960, 108), toggle(s, 'Bend', 960, 135, true, C.world)])

  const top = 212
  const bottom = 812
  s.group('Body', [
    s.path('Shadow', `M-10 ${top + 14}Q597 ${top - 6} 1204 ${top + 14}L1204 ${bottom + 10}Q597 ${bottom + 30} -10 ${bottom + 10}Z`, { fill: '#000000', opacity: 0.6, closed: true }),
    s.path('Soundboard', `M-10 ${top}Q597 ${top - 20} 1204 ${top}L1204 ${bottom}Q597 ${bottom + 20} -10 ${bottom}Z`, {
      fill: linear([['#E0B27A', 0], ['#C8925A', 0.3], ['#B07A44', 0.7], ['#8E5A2C', 1]]), closed: true,
    }),
  ])
  const rnd = random(77)
  let grain = ''
  for (let gy = top + 10; gy < bottom - 4; gy += 5 + rnd() * 6) {
    grain += `M0 ${f(gy)}`
    for (let gx = 120; gx <= 1194; gx += 120) grain += `Q${gx - 60} ${f(gy + (rnd() - 0.5) * 8)} ${gx} ${f(gy + (rnd() - 0.5) * 3)}`
  }
  s.path('Grain', grain, { stroke: '#5A3212', width: 1, alpha: 0.2 })
  s.group('Tail Brocade', [
    s.rect('Cloth', 0, top + 20, 64, bottom - top - 40, { fill: linear([['#9A1C24', 0], ['#5E0E14', 1]], 0, 0, 1, 0) }),
    s.path('Pattern', Array.from({ length: 13 }, (_, i) => ring(32, top + 60 + i * 42, 10)).join(''), { stroke: '#E8C06A', width: 2, alpha: 0.7 }),
  ])
  s.group('Head', [
    s.rect('Fixed Bridge', 1070, top + 10, 20, bottom - top - 20, { fill: linear([['#3A2014', 0], ['#6A3E24', 0.5], ['#2A140A', 1]], 0, 0, 1, 0), radius: 4, shadow: shadow(0, 8, 0.6, 4, '#000000') }),
    s.rect('End Cap', 1110, top + 6, 84, bottom - top - 12, { fill: linear([['#2A1408', 0], ['#4A2814', 1]], 0, 0, 1, 0) }),
    s.path('Inlay', Array.from({ length: 6 }, (_, i) => `M1156 ${top + 50 + i * 90}l20 30l-20 30l-20-30z`).join(''), { fill: '#E8C06A', opacity: 0.5, closed: true }),
  ])

  const count = 13
  const sy = (i: number) => top + 36 + (i * (bottom - top - 72)) / (count - 1)
  const scaleNotes = ['D', 'G', 'A', 'B♭', 'D', 'E♭', 'G', 'A', 'B♭', 'D', 'E♭', 'G', 'A']
  const bridges: NodeId[] = []
  const strings: NodeId[] = []
  for (let i = 0; i < count; i++) {
    const y = sy(i)
    const bx = 250 + i * 52
    const plucked = i === 6
    strings.push(plucked
      ? s.fx(s.path(`String ${i + 1}`, smooth(Array.from({ length: 21 }, (_, k) => [bx + ((1070 - bx) * k) / 20, y + Math.sin((k / 20) * Math.PI) * Math.sin(k * 2.1) * 4] as [number, number])), { stroke: '#FFF4DA', width: 2.2 }), { shadow: glow(C.world, 10, 0.9) })
      : s.rect(`String ${i + 1}`, 64, y - 1, 1026, 2, { fill: linear([['#FFFDF4', 0], ['#D9CFB8', 1]]), shadow: shadow(3, 2, 0.45, 0, '#3A1C08') }))
    if (plucked) strings.push(s.rect(`String ${i + 1} Tail`, 64, y - 1, bx - 64, 2, { fill: '#FFFDF4', shadow: shadow(3, 2, 0.45, 0, '#3A1C08') }))
    bridges.push(s.group(`Bridge ${i + 1}`, [
      s.path('Bridge', `M${bx - 16} ${f(y + 16)}L${bx - 5} ${f(y - 2)}L${bx + 5} ${f(y - 2)}L${bx + 16} ${f(y + 16)}Z`, {
        fill: linear([['#FFFFFF', 0], ['#F2EBDA', 0.5], ['#CFC3A6', 1]]), closed: true,
      }),
      s.rect('Shadow', bx - 18, y + 15, 36, 5, { fill: '#3A1C08', opacity: 0.35, radius: 2.5 }),
    ]))
  }
  s.group('Strings', strings)
  s.group('Bridges', bridges)
  s.group('Note Names', Array.from({ length: count }, (_, i) => s.text(`Note ${i + 1}`, scaleNotes[i]!, 1048, sy(i) - 20, { size: 12, weight: 700, color: i === 6 ? '#8A3A00' : '#4A2A10', anchor: 'center' })))
  s.group('Pluck Ripple', [
    s.fx(s.circle('Touch', 880, sy(6), 18, { fill: radialAt([['#FFFFFF', 0, 0.9], [C.world, 0.6, 0.6], [C.world, 1, 0]]) }), { shadow: glow(C.world, 20, 0.9) }),
  ])
}
