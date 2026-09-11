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
 * The drums: an acoustic kit seen from above, a 4 × 4 pad drum machine, the
 * step sequencer and Smart Drums' placement grid.
 */

import type { NodeId } from '@/document/types'
import { linear, random, shadow } from '../kit'
import {
  C, chrome, glow, I, instrumentTile, knob, LABEL, led, MONO, panelButton, radialAt, ring, segmented, waveform, wood,
  type Studio,
} from './base'
import { cymbal, drum, LACQUER } from './instruments'
import { dropdown } from './keys'

const f = (n: number) => Number(n.toFixed(2))

/** A floating dark pill over an instrument: kit name, a toggle, a hint. */
function pill(s: Studio, name: string, x: number, y: number, label: string, icon: string, o: { w?: number; accent?: string } = {}): NodeId {
  const text = { size: 13, weight: 600, color: C.text }
  const w = o.w ?? s.measure(label, text).width + 76
  return s.group(`Pill / ${name}`, [
    s.fx(s.rect('Background', x, y, w, 40, { fill: '#1C1C21', radius: 20, stroke: { color: '#FFFFFF', width: 1, alpha: 0.08 }, opacity: 0.94 }), { shadow: shadow(6, 16, 0.5, 0, '#000000') }),
    s.icon('Icon', icon, x + 14, y + 10, 20, o.accent ?? C.drums, { width: 1.8 }),
    s.text('Label', label, x + 44, y + 11, text),
    s.icon('Chevron', I.chevronDown, x + w - 28, y + 11, 18, C.dim),
  ])
}

// ---------------------------------------------------------------------------
// 09 Acoustic Drum Kit
// ---------------------------------------------------------------------------

function rug(s: Studio, x: number, y: number, w: number, h: number): NodeId {
  // A diamond chain around the border band, as one path.
  let chain = ''
  const band = 30
  const step = 28
  const diamond = (cx: number, cy: number) => `M${f(cx)} ${f(cy - 9)}L${f(cx + 9)} ${f(cy)}L${f(cx)} ${f(cy + 9)}L${f(cx - 9)} ${f(cy)}Z`
  for (let px = x + band + step; px < x + w - band; px += step) {
    chain += diamond(px, y + band) + diamond(px, y + h - band)
  }
  for (let py = y + band + step; py < y + h - band; py += step) {
    chain += diamond(x + band, py) + diamond(x + w - band, py)
  }
  let medallion = ''
  const cx = x + w / 2
  const cy = y + h / 2
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    medallion += `M${f(cx)} ${f(cy)}L${f(cx + Math.cos(a) * 180)} ${f(cy + Math.sin(a) * 120)}`
  }
  return s.group('Rug', [
    s.rect('Weave', x, y, w, h, { fill: radialAt([['#7A1E22', 0], ['#5A1418', 0.6], ['#3A0C10', 1]]), radius: 20, shadow: shadow(10, 30, 0.6, 0, '#000000') }),
    s.rect('Border Outer', x + 12, y + 12, w - 24, h - 24, { fill: { type: 'none' }, radius: 12, stroke: { color: '#D9A85A', width: 2, alpha: 0.45 } }),
    s.rect('Border Inner', x + 48, y + 48, w - 96, h - 96, { fill: { type: 'none' }, radius: 8, stroke: { color: '#D9A85A', width: 2, alpha: 0.45 } }),
    s.path('Border Pattern', chain, { fill: '#1E3A5A', stroke: '#D9A85A', width: 1, alpha: 0.5, closed: true, opacity: 0.8 }),
    s.path('Medallion Rays', medallion, { stroke: '#D9A85A', width: 1.5, alpha: 0.18 }),
    s.path('Medallion', `${ring(cx, cy, 120)}${ring(cx, cy, 80)}`, { stroke: '#D9A85A', width: 2, alpha: 0.25 }),
  ])
}

function kick(s: Studio, x: number, y: number, w: number, h: number): NodeId {
  const claws: NodeId[] = []
  for (let i = 0; i < 5; i++) {
    const cx = x + 30 + (i * (w - 60)) / 4
    claws.push(s.rect(`Claw Front ${i + 1}`, cx - 7, y - 4, 14, 22, { fill: linear([['#FFFFFF', 0], ['#8E8F96', 1]]), radius: 3 }))
    claws.push(s.rect(`Claw Back ${i + 1}`, cx - 7, y + h - 18, 14, 22, { fill: linear([['#FFFFFF', 0], ['#8E8F96', 1]]), radius: 3 }))
  }
  return s.group('Drum / Kick', [
    s.rect('Floor Shadow', x - 10, y + 12, w + 20, h + 10, { fill: '#000000', opacity: 0.45, radius: 30 }),
    s.rect('Shell', x, y, w, h, { fill: linear([['#2A0406', 0], ['#8A1820', 0.18], ['#D2404A', 0.32], ['#9A1C24', 0.5], ['#6A1016', 0.8], ['#2A0406', 1]], 0, 0, 1, 0), radius: 10 }),
    s.rect('Sparkle', x + w * 0.24, y + 14, w * 0.12, h - 28, { fill: '#FFFFFF', opacity: 0.1, radius: 6 }),
    s.rect('Hoop Front', x - 4, y, w + 8, 16, { fill: linear([['#1A0A06', 0], ['#5A2E1A', 0.4], ['#2A140A', 1]], 0, 0, 1, 0), radius: 6 }),
    s.rect('Hoop Back', x - 4, y + h - 16, w + 8, 16, { fill: linear([['#1A0A06', 0], ['#5A2E1A', 0.4], ['#2A140A', 1]], 0, 0, 1, 0), radius: 6 }),
    s.group('Claws', claws),
    s.rect('Badge', x + w / 2 - 22, y + 30, 44, 14, { fill: linear([['#F4F4F6', 0], ['#9A9BA2', 1]]), radius: 3 }),
  ])
}

function pedal(s: Studio, name: string, x: number, y: number, w: number, h: number): NodeId {
  return s.group(`Pedal / ${name}`, [
    s.rect('Base', x - 6, y + h - 26, w + 12, 26, { fill: linear([['#3A3A40', 0], ['#141417', 1]]), radius: 6, shadow: shadow(4, 8, 0.6, 0, '#000000') }),
    s.rect('Footboard', x, y, w, h - 12, { fill: linear([['#D9DADF', 0], ['#8A8B92', 0.5], ['#C9CAD0', 1]], 0, 0, 1, 0), radius: [14, 14, 6, 6], shadow: shadow(4, 8, 0.6, 0, '#000000') }),
    s.path('Tread', Array.from({ length: 7 }, (_, i) => `M${x + 8} ${y + 20 + i * ((h - 50) / 6)}h${w - 16}`).join(''), { stroke: '#2A2A2E', width: 2, alpha: 0.5 }),
  ])
}

export function drumKit(s: Studio): void {
  chrome(s, { bar: 3, beat: 2, tempo: 128, key: 'E min', active: 'browser', playing: true })
  wood(s, 'Stage Floor', 0, 96, 1194, 738, { base: [['#3E2616', 0], ['#4E301C', 0.5], ['#35200F', 1]], vertical: true, seed: 5, alpha: 0.35 })
  let seams = ''
  for (let x = 0; x < 1194; x += 120) seams += `M${x} 96v738`
  s.path('Plank Seams', seams, { stroke: '#120904', width: 2, alpha: 0.6 })
  rug(s, 110, 124, 974, 740)

  kick(s, 452, 326, 290, 240)
  pedal(s, 'Kick', 572, 566, 50, 150)
  pedal(s, 'Hi-Hat', 170, 640, 46, 140)
  s.group('Tom Mount', [
    s.rect('Arm', 560, 372, 74, 10, { fill: linear([['#FFFFFF', 0], ['#7B7C82', 1]]), radius: 5 }),
    s.circle('Clamp', 597, 377, 12, { fill: radialAt([['#FFFFFF', 0], ['#8E8F96', 0.7], ['#4A4B50', 1]], 0.4, 0.35, 0.7) }),
  ])
  drum(s, 'Floor Tom', 836, 640, 112, { lugs: 8 })
  drum(s, 'Rack Tom 1', 520, 368, 70, { lugs: 6 })
  drum(s, 'Rack Tom 2', 676, 372, 78, { lugs: 6 })
  drum(s, 'Snare', 408, 600, 98, { lugs: 10, hit: C.drums })
  s.group('Snare Strainer', [
    s.rect('Throw-off', 300, 588, 14, 30, { fill: linear([['#FFFFFF', 0], ['#8E8F96', 1]], 0, 0, 1, 0), radius: 3, shadow: shadow(2, 3, 0.5, 0, '#000000') }),
  ])
  s.group('Throne', [
    s.circle('Shadow', 604, 848, 104, { fill: radialAt([['#000000', 0, 0.5], ['#000000', 1, 0]]) }),
    s.circle('Seat', 597, 842, 92, { fill: radialAt([['#3A3A40', 0], ['#1A1A1E', 0.7], ['#0A0A0C', 1]], 0.45, 0.35, 0.65) }),
    s.path('Stitching', ring(597, 842, 78), { stroke: '#5A5A62', width: 1.5, alpha: 0.6 }),
  ])
  s.group('Stands', [
    s.line('Crash Boom', 300, 250, 120, 190, '#C9CAD0', 6),
    s.line('Ride Boom', 916, 318, 1088, 250, '#C9CAD0', 6),
  ])
  s.group('Hi-Hat', [
    cymbal(s, 'Hi-Hat Bottom', 222, 506, 92),
    cymbal(s, 'Hi-Hat Top', 216, 498, 92, { label: '14 HATS' }),
    s.circle('Clutch', 216, 498, 11, { fill: radialAt([['#FFFFFF', 0], ['#A9AAB1', 0.6], ['#55565C', 1]], 0.4, 0.35, 0.7), shadow: shadow(2, 4, 0.5, 0, '#000000') }),
    s.circle('Rod', 216, 498, 3.5, { fill: '#2A2A2E' }),
  ])
  cymbal(s, 'Crash', 300, 252, 138, { label: '18 CRASH' })
  cymbal(s, 'Ride', 916, 318, 164, { tone: 'dark', label: '21 RIDE', hit: C.drums })

  s.rect('Vignette', 0, 96, 1194, 738, { fill: radialAt([['#000000', 0, 0], ['#000000', 0.65, 0.1], ['#000000', 1, 0.6]], 0.5, 0.45, 0.75) })
  pill(s, 'Kit', 16, 112, 'Studio Kit', I.drum)
  s.group('Kit Options', [
    s.fx(s.rect('Background', 1018, 112, 160, 40, { fill: '#1C1C21', radius: 20, stroke: { color: '#FFFFFF', width: 1, alpha: 0.08 }, opacity: 0.94 }), { shadow: shadow(6, 16, 0.5, 0, '#000000') }),
    s.text('Label', 'Hi-hat', 1036, 123, { size: 13, weight: 600, color: C.text }),
    s.text('Value', 'Closed', 1162, 123, { size: 13, weight: 600, color: C.drums, anchor: 'right' }),
  ])
}

// ---------------------------------------------------------------------------
// 10 Drum Machine
// ---------------------------------------------------------------------------

const PADS: Array<[string, string, number]> = [
  // Bottom row first, like the hardware: [name, colour, velocity 0..1 (0 = unlit)]
  ['Kick', '#FF8A3D', 0.95], ['Kick 2', '#FF8A3D', 0], ['Snare', '#FFC83D', 0.7], ['Clap', '#FFC83D', 0],
  ['Hat Closed', '#3DD6D0', 0.45], ['Hat Open', '#3DD6D0', 0], ['Rim', '#FFC83D', 0], ['Snap', '#FF5FA2', 0.3],
  ['Tom High', '#4CD97B', 0], ['Tom Mid', '#4CD97B', 0], ['Tom Low', '#4CD97B', 0.6], ['Shaker', '#FF5FA2', 0],
  ['Crash', '#A77BFF', 0], ['Ride', '#A77BFF', 0], ['Conga', '#FF5FA2', 0], ['Vinyl FX', '#4DA3FF', 0],
]

export function drumMachine(s: Studio): void {
  chrome(s, { bar: 7, beat: 3, tempo: 90, key: 'G min', active: 'browser', playing: true })
  s.rect('Chassis', 0, 96, 1194, 738, { fill: linear([['#2A2A2F', 0], ['#1E1E22', 1]]) })

  // Display
  const dx = 24
  const dy = 112
  s.group('Display', [
    s.rect('Bezel', dx, dy, 404, 204, { fill: '#0A0A0C', radius: 12, stroke: { color: '#000000', width: 2 } }),
    s.fx(s.rect('Screen', dx + 10, dy + 10, 384, 184, { fill: linear([['#0E1A24', 0], ['#081018', 1]]), radius: 6 }), { inner: shadow(1, 8, 0.8, 0, '#000000') }),
    s.lit('Kit', 'DUSTY TAPE 90', dx + 26, dy + 24, { size: 16, weight: 700, family: MONO, color: '#7FD8FF' }, 6),
    s.text('Program', 'PGM 04', dx + 378, dy + 27, { size: 12, weight: 500, family: MONO, color: '#7FD8FF', opacity: 0.6, anchor: 'right' }),
    s.lit('Pad', 'PAD 01  ·  KICK — WARM 808', dx + 26, dy + 52, { size: 12, weight: 500, family: MONO, color: '#7FD8FF' }, 4),
    s.path('Sample', waveform(dx + 26, dy + 80, 352, 64, 21, 2, (t) => Math.exp(-t * 3.2)), { fill: '#7FD8FF', opacity: 0.75 }),
    s.line('Sample Start', dx + 30, dy + 78, dx + 30, dy + 146, '#FFC83D', 1.5),
    s.text('Velocity Label', 'VEL', dx + 26, dy + 160, { size: 11, weight: 500, family: MONO, color: '#7FD8FF', opacity: 0.6 }),
    s.rect('Velocity Track', dx + 58, dy + 164, 240, 8, { fill: '#7FD8FF', opacity: 0.15, radius: 4 }),
    s.fx(s.rect('Velocity', dx + 58, dy + 164, 228, 8, { fill: linear([['#4DA3FF', 0], ['#7FD8FF', 1]], 0, 0, 1, 0), radius: 4 }), { shadow: glow('#7FD8FF', 6, 0.6) }),
    s.lit('Velocity Value', '121', dx + 378, dy + 159, { size: 12, weight: 700, family: MONO, color: '#7FD8FF', anchor: 'right' }, 4),
  ])

  // Kit list
  const kits = ['Boom Bap Classic', 'Dusty Tape 90', 'Neon 808', 'Garage Shuffle', 'Brush Jazz']
  s.group('Kit Selector', [
    s.label('Title', 'kits', dx, 336),
    s.text('Count', '32 kits', dx + 404, 334, { size: 11, weight: 500, color: C.faint, anchor: 'right' }),
    s.rect('List', dx, 356, 404, 220, { fill: '#18181C', radius: 12, stroke: { color: '#000000', width: 1, alpha: 0.5 } }),
    ...kits.map((name, i) => {
      const y = 356 + i * 44
      const on = i === 1
      const parts: NodeId[] = []
      if (on) parts.push(s.rect('Selection', dx + 4, y + 4, 396, 36, { fill: '#FFC83D', opacity: 0.14, radius: 8 }))
      else if (i > 0) parts.push(s.rect('Divider', dx + 16, y, 372, 1, { fill: '#FFFFFF', opacity: 0.05 }))
      parts.push(
        s.text('Name', name, dx + 18, y + 13, { size: 14, weight: on ? 600 : 500, color: on ? C.drums : C.text }),
        s.text('Style', ['Hip hop', 'Lo-fi', 'Trap', 'UK garage', 'Jazz'][i]!, dx + 386, y + 14, { size: 12, color: C.dim, anchor: 'right' }),
      )
      return s.group(`Kit / ${name}`, parts)
    }),
  ])
  s.group('Pad Modes', [
    panelButton(s, 'Note Repeat', dx, 596, 128, 44, { on: true, accent: C.drums, size: 12 }),
    panelButton(s, 'Full Velocity', dx + 138, 596, 128, 44, { size: 12 }),
    panelButton(s, '16 Levels', dx + 276, 596, 128, 44, { size: 12 }),
  ])
  s.group('Pad Knobs', [
    knob(s, 'Tune', 74, 706, 26, 0.5, { label: 'Tune', value: '0 st', color: C.drums }),
    knob(s, 'Decay', 174, 706, 26, 0.68, { label: 'Decay', value: '680 ms', color: C.drums }),
    knob(s, 'Swing', 274, 706, 26, 0.36, { label: 'Swing', value: '58%', color: C.drums }),
    knob(s, 'Filter', 374, 706, 26, 0.8, { label: 'Filter', value: '12 kHz', color: C.drums }),
  ])

  // Pads
  const px = 452
  const py = 108
  const size = 164
  const gap = 12
  s.group('Pad Grid', [
    s.fx(s.rect('Well', px, py, 726, 718, { fill: '#131316', radius: 16 }), { inner: shadow(2, 10, 0.8, 0, '#000000') }),
    ...PADS.map(([name, colour, vel], i) => {
      const col = i % 4
      const row = 3 - Math.floor(i / 4)
      const x = px + 19 + col * (size + gap)
      const y = py + 17 + row * (size + gap)
      const lit = vel > 0
      const parts: NodeId[] = [
        s.rect('Rubber', x, y, size, size, {
          fill: lit
            ? radialAt([['#FFFFFF', 0, 0.9 * vel], [colour, 0.35], [colour, 1, 0.35 + vel * 0.4]], 0.5, 0.5, 0.75)
            : linear([['#3A3A40', 0], ['#2A2A2F', 0.6], ['#222226', 1]]),
          radius: 14,
          stroke: { color: lit ? colour : '#000000', width: 1.5, alpha: lit ? 0.9 : 0.6 },
          shadow: lit ? glow(colour, 12 + vel * 22, 0.4 + vel * 0.5) : shadow(4, 6, 0.6, 0, '#000000'),
        }),
        s.rect('Texture', x + 8, y + 8, size - 16, size - 16, { fill: { type: 'none' }, radius: 10, stroke: { color: '#FFFFFF', width: 1, alpha: lit ? 0.25 : 0.05 } }),
        s.text('Name', name.toUpperCase(), x + 16, y + 16, { ...LABEL, size: 11, color: lit ? '#1A1A1E' : C.dim }),
        s.text('Number', String(i + 1).padStart(2, '0'), x + size - 16, y + size - 30, { size: 12, weight: 600, family: MONO, color: lit ? '#1A1A1E' : C.faint, anchor: 'right' }),
      ]
      if (lit) parts.push(s.rect('Velocity', x + 16, y + size - 22, (size - 64) * vel, 4, { fill: '#1A1A1E', opacity: 0.5, radius: 2 }))
      return s.group(`Pad / ${String(i + 1).padStart(2, '0')} ${name}`, parts)
    }),
  ])
}

// ---------------------------------------------------------------------------
// 11 Beat Sequencer
// ---------------------------------------------------------------------------

const ROWS: Array<[string, string, string, string]> = [
  ['Kick', 'Warm 808', '#FF8A3D', 'x.....x.x.......'],
  ['Snare', 'Tape Snare', '#FFC83D', '....x.......x...'],
  ['Clap', 'Room Clap', '#FFC83D', '....x.......x..x'],
  ['Closed Hat', 'Tight Hat', '#3DD6D0', 'x.x.x.x.x.x.x.xx'],
  ['Open Hat', 'Air Hat', '#3DD6D0', '.......x......x.'],
  ['Low Tom', 'Floor Tom', '#4CD97B', '.............xx.'],
  ['Rim', 'Side Stick', '#FF5FA2', '..x.......x.....'],
  ['Shaker', 'Egg Shaker', '#A77BFF', '.x.x.x.x.x.x.x.x'],
]

export function beatSequencer(s: Studio): void {
  chrome(s, { bar: 2, beat: 3, tempo: 96, key: 'G min', active: 'browser', playing: true, cycle: true })
  s.rect('Toolbar', 0, 96, 1194, 72, { fill: linear([['#232329', 0], ['#1D1D22', 1]]) })
  const pat = segmented(s, 'Pattern', 16, 112, ['A', 'B', 'C', 'D'], 0, { w: 44, h: 40, accent: C.drums })
  const modes = segmented(s, 'Edit Mode', 16 + pat.width + 16, 112, ['Steps', 'Velocity', 'Note Repeat', 'Chance'], 0, { h: 40 })
  const mx = 16 + pat.width + 16 + modes.width + 16
  s.group('Pattern Length', [
    s.rect('Field', mx, 112, 150, 40, { fill: linear([['#34343C', 0], ['#27272D', 1]]), radius: 8, stroke: { color: '#000000', width: 1, alpha: 0.4 } }),
    s.text('Label', 'Length', mx + 14, 124, { size: 12, weight: 500, color: C.dim }),
    s.text('Value', '16 steps', mx + 136, 123, { size: 13, weight: 600, color: C.text, anchor: 'right' }),
  ])
  s.group('Swing', [
    knob(s, 'Swing', mx + 190, 132, 14, 0.3, { color: C.drums }),
    s.text('Label', 'SWING', mx + 216, 118, { ...LABEL }),
    s.text('Value', '56%', mx + 216, 132, { size: 12, weight: 600, family: MONO, color: C.drums }),
  ])
  s.group('Pattern Actions', [
    panelButton(s, 'Randomize', 1034, 112, 44, 40, { icon: I.dice, label: '' }),
    panelButton(s, 'Clear', 1086, 112, 44, 40, { icon: I.trash, label: '' }),
    panelButton(s, 'Close', 1138, 112, 40, 40, { icon: I.close, label: '' }),
  ])

  const gx = 212
  const gy = 212
  const rowH = 76
  const cellH = 64
  const groupGap = 10
  const gapX = 5
  const stepW = (1178 - gx - 3 * groupGap - 12 * gapX) / 16
  const stepX = (i: number) => gx + i * (stepW + gapX) + Math.floor(i / 4) * (groupGap - gapX)
  const current = 6

  s.group('Step Ruler', Array.from({ length: 16 }, (_, i) => {
    const on = i === current
    return s.group(`Step ${i + 1}`, [
      s.rect('Light', stepX(i) + stepW / 2 - 12, 180, 24, 6, { fill: on ? C.drums : '#34343C', radius: 3, ...(on ? { shadow: glow(C.drums, 8, 0.8) } : {}) }),
      s.text('Number', String(i + 1), stepX(i) + stepW / 2, 190, { size: 10, weight: 600, family: MONO, color: on ? C.drums : C.faint, anchor: 'center' }),
    ])
  }))

  ROWS.forEach(([name, sound, colour, pattern], r) => {
    const y = gy + r * rowH
    const rnd = random(r * 13 + 5)
    const cells: NodeId[] = []
    for (let i = 0; i < 16; i++) {
      const on = pattern[i] === 'x'
      const vel = on ? 0.55 + rnd() * 0.45 : 0
      const shade = Math.floor(i / 4) % 2 === 0 ? '#2C2C33' : '#26262C'
      const x = stepX(i)
      const parts = [
        s.rect('Cell', x, y, stepW, cellH, {
          fill: on ? linear([[colour, 0], [colour, 1, 0.7]]) : linear([[shade, 0], ['#1F1F24', 1]]),
          radius: 8, stroke: { color: on ? '#FFFFFF' : '#000000', width: 1, alpha: on ? 0.35 : 0.5 },
          ...(on ? { shadow: glow(colour, 10 + vel * 8, 0.35 + vel * 0.3) } : {}),
        }),
      ]
      if (on) {
        parts.push(s.rect('Gloss', x + 3, y + 3, stepW - 6, cellH / 2 - 4, { fill: linear([['#FFFFFF', 0, 0.35], ['#FFFFFF', 1, 0]]), radius: [6, 6, 2, 2] }))
        parts.push(s.rect('Velocity', x + 6, y + cellH - 10, (stepW - 12) * vel, 4, { fill: '#1A1A1E', opacity: 0.45, radius: 2 }))
      }
      cells.push(s.group(`Step ${i + 1}${on ? ' / On' : ''}`, parts))
    }
    s.group(`Row / ${name}`, [
      s.group('Header', [
        s.rect('Background', 16, y, 184, cellH, { fill: linear([['#2E2E35', 0], ['#26262C', 1]]), radius: 10, stroke: { color: '#000000', width: 1, alpha: 0.5 } }),
        s.rect('Colour', 16, y + 12, 4, cellH - 24, { fill: colour, radius: 2 }),
        s.text('Name', name, 32, y + 13, { size: 14, weight: 600, color: C.text }),
        s.text('Sound', sound, 32, y + 34, { size: 11, color: C.dim }),
        s.icon('Mute', I.speaker, 166, y + 21, 20, r === 5 ? C.faint : C.dim, { width: 1.6 }),
      ]),
      s.group('Steps', cells),
    ])
  })

  s.group('Playhead', [
    s.fx(s.rect('Column', stepX(current) - 3, gy - 6, stepW + 6, 8 * rowH, { fill: '#FFFFFF', opacity: 0.06, radius: 10, stroke: { color: '#FFFFFF', width: 1.5, alpha: 0.7 } }), {}),
  ])
}

// ---------------------------------------------------------------------------
// 12 Smart Drums
// ---------------------------------------------------------------------------

type Piece = 'kick' | 'snare' | 'hat' | 'crash' | 'ride' | 'clap' | 'tom' | 'floor' | 'shaker' | 'tambourine' | 'cowbell' | 'conga'

/** A drum piece as a round token: a dark puck with the instrument on it. */
function token(s: Studio, name: string, kind: Piece, cx: number, cy: number, r: number, o: { active?: boolean; dim?: boolean } = {}): NodeId {
  const ids: NodeId[] = [
    s.circle('Puck', cx, cy, r, {
      fill: radialAt([['#3A3A42', 0], ['#222227', 1]], 0.45, 0.35, 0.7), stroke: { color: o.active ? C.drums : '#FFFFFF', width: o.active ? 2.5 : 1, alpha: o.active ? 1 : 0.1 },
      shadow: o.active ? glow(C.drums, 18, 0.6) : shadow(6, 12, 0.6, 0, '#000000'),
    }),
  ]
  const ir = r * 0.66
  if (kind === 'kick') ids.push(drum(s, name, cx, cy, ir, { head: 'black', lugs: 8, shell: LACQUER }), s.circle('Port', cx + ir * 0.35, cy + ir * 0.3, ir * 0.2, { fill: '#050506', stroke: { color: '#8E8F96', width: 1.5 } }))
  else if (kind === 'snare') ids.push(drum(s, name, cx, cy, ir, { lugs: 8, shell: [['#D9DADF', 0], ['#8A8B92', 0.5], ['#5A5B61', 1]] }))
  else if (kind === 'tom') ids.push(drum(s, name, cx, cy, ir, { lugs: 6, head: 'clear' }))
  else if (kind === 'floor') ids.push(drum(s, name, cx, cy, ir, { lugs: 8 }))
  else if (kind === 'conga') ids.push(drum(s, name, cx, cy, ir, { lugs: 5, head: 'clear', shell: [['#B7773C', 0], ['#6A3A18', 0.5], ['#3A1C08', 1]] }))
  else if (kind === 'hat') ids.push(cymbal(s, `${name} Bottom`, cx + 2, cy + 3, ir), cymbal(s, name, cx, cy, ir))
  else if (kind === 'crash') ids.push(cymbal(s, name, cx, cy, ir * 1.05))
  else if (kind === 'ride') ids.push(cymbal(s, name, cx, cy, ir * 1.1, { tone: 'dark' }))
  else if (kind === 'clap') ids.push(s.icon('Hands', I.hand, cx - ir * 0.8, cy - ir * 0.8, ir * 1.6, '#F2D9B8', { width: 2.2 }))
  else if (kind === 'shaker') {
    ids.push(s.rect('Egg', cx - ir * 0.42, cy - ir * 0.62, ir * 0.84, ir * 1.24, {
      fill: radialAt([['#FFE27A', 0], ['#E8A62C', 0.7], ['#A86A12', 1]], 0.4, 0.3, 0.7), radius: ir * 0.42,
    }))
  } else if (kind === 'tambourine') {
    let jingles = ''
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      jingles += ring(cx + Math.cos(a) * ir * 0.82, cy + Math.sin(a) * ir * 0.82, ir * 0.14)
    }
    ids.push(
      s.circle('Frame', cx, cy, ir, { fill: radialAt([['#F2E6CC', 0], ['#D9C49A', 0.8], ['#8A6A3A', 1]]) }),
      s.path('Jingles', jingles, { fill: linear([['#FFFFFF', 0], ['#8E8F96', 1]]), closed: true }),
    )
  } else {
    ids.push(s.path('Bell', `M${f(cx - ir * 0.38)} ${f(cy - ir * 0.7)}h${f(ir * 0.76)}l${f(ir * 0.28)} ${f(ir * 1.4)}h${f(-ir * 1.32)}Z`, {
      fill: linear([['#6E7078', 0], ['#E4E5E9', 0.4], ['#8E8F96', 0.7], ['#4A4B50', 1]], 0, 0, 1, 0), closed: true,
    }))
  }
  ids.push(s.text('Label', name, cx, cy + r + 8, { size: 12, weight: 600, color: o.dim ? C.dim : C.text, anchor: 'center' }))
  return s.group(`Piece / ${name}`, ids)
}

export function smartDrums(s: Studio): void {
  chrome(s, { bar: 4, beat: 1, tempo: 104, key: 'D maj', active: 'browser', playing: true })
  const X = 24
  const Y = 112
  const G = 706
  let lines = ''
  for (let i = 1; i < 8; i++) lines += `M${f(X + (G * i) / 8)} ${Y}v${G}M${X} ${f(Y + (G * i) / 8)}h${G}`
  s.group('Placement Grid', [
    s.rect('Board', X, Y, G, G, { fill: linear([['#2C2A33', 0], ['#1F1D24', 1]], 0, 0, 1, 1), radius: 18, stroke: { color: '#FFFFFF', width: 1, alpha: 0.06 } }),
    s.rect('Warmth', X, Y, G, G, { fill: radialAt([['#FFC83D', 0, 0.12], ['#FFC83D', 1, 0]], 1, 0, 1), radius: 18 }),
    s.path('Cells', lines, { stroke: '#FFFFFF', width: 1, alpha: 0.06 }),
    s.path('Axes', `M${X + G / 2} ${Y + 16}v${G - 32}M${X + 16} ${Y + G / 2}h${G - 32}`, { stroke: '#FFFFFF', width: 1.5, alpha: 0.16 }),
    s.label('Loud', 'loud', X + G / 2, Y + 18, { anchor: 'center', color: C.text }),
    s.label('Soft', 'soft', X + G / 2, Y + G - 30, { anchor: 'center', color: C.text }),
    s.label('Simple', 'simple', X + 18, Y + G / 2 - 22, { color: C.text }),
    s.label('Complex', 'complex', X + G - 18, Y + G / 2 - 22, { anchor: 'right', color: C.text }),
  ])
  s.group('Placed Pieces', [
    token(s, 'Kick', 'kick', X + 150, Y + 190, 50, { active: true }),
    token(s, 'Snare', 'snare', X + 250, Y + 300, 50, { active: true }),
    token(s, 'Hi-Hat', 'hat', X + 540, Y + 170, 50, { active: true }),
    token(s, 'Clap', 'clap', X + 470, Y + 470, 44, { active: true }),
    token(s, 'Shaker', 'shaker', X + 610, Y + 560, 40, { active: true }),
    token(s, 'Crash', 'crash', X + 120, Y + 560, 46, { active: true }),
  ])

  const px = 754
  s.group('Tray', [
    s.rect('Panel', px, 112, 424, 706, { fill: linear([['#222228', 0], ['#1C1C21', 1]]), radius: 18, stroke: { color: '#FFFFFF', width: 1, alpha: 0.05 } }),
    s.text('Title', 'Drag pieces onto the grid', px + 24, 132, { size: 15, weight: 600, color: C.text }),
    s.text('Hint', 'Up is louder, right plays busier patterns.', px + 24, 156, { size: 12, color: C.dim }),
  ])
  const tray: Array<[string, Piece]> = [
    ['Rack Tom', 'tom'], ['Floor Tom', 'floor'], ['Ride', 'ride'],
    ['Cowbell', 'cowbell'], ['Tambourine', 'tambourine'], ['Conga', 'conga'],
  ]
  s.group('Available Pieces', tray.map(([name, kind], i) => token(s, name, kind, px + 82 + (i % 3) * 130, 250 + Math.floor(i / 3) * 150, 44, { dim: true })))
  dropdown(s, 'Kit', 'SoCal Studio Kit', px + 24, 540, 376)
  s.group('Actions', [
    panelButton(s, 'Randomize', px + 24, 612, 184, 48, { icon: I.dice, label: 'Randomize' }),
    panelButton(s, 'Clear', px + 216, 612, 184, 48, { icon: I.trash, label: 'Clear' }),
  ])
  s.group('Fills', [
    s.rect('Divider', px + 24, 684, 376, 1, { fill: '#FFFFFF', opacity: 0.07 }),
    instrumentTile(s, 'Fills', I.drum, px + 24, 708, 40, C.drums),
    s.text('Label', 'Fills every 4 bars', px + 80, 712, { size: 14, weight: 600, color: C.text }),
    s.text('Hint', 'A short fill leads into the next section', px + 80, 732, { size: 12, color: C.dim }),
    s.fx(s.rect('Toggle Track', px + 354, 716, 46, 26, { fill: C.drums, radius: 13 }), {}),
    s.circle('Toggle Thumb', px + 387, 729, 11, { fill: '#FFFFFF', shadow: shadow(2, 4, 0.4, 0, '#000000') }),
    s.text('Kit Note', '6 of 12 pieces placed', px + 24, 780, { size: 12, weight: 500, family: MONO, color: C.faint }),
    led(s, 'Playing', px + 386, 787, C.guitar, true, 4),
  ])
}
