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
 * The studio views: Tracks, Live Loops, the Mixer, Song Settings and the
 * Loop Browser — where the instruments' parts come together into a song.
 */

import type { NodeId } from '@/document/types'
import { linear, random, shadow } from '../kit'
import {
  arc, C, chrome, fader, glow, I, instrumentTile, knob, LABEL, MONO, panelButton, segmented, toggle, waveform,
  type Studio,
} from './base'

const f = (n: number) => Number(n.toFixed(2))

interface Track {
  name: string
  instrument: string
  icon: string
  colour: string
  kind: 'midi' | 'drums' | 'audio'
  regions: Array<[from: number, to: number, label: string]>
}

const TRACKS: Track[] = [
  { name: 'Grand Piano', instrument: 'Concert Grand', icon: I.keyboard, colour: C.keys, kind: 'midi', regions: [[1, 9, 'Piano Intro'], [9, 17, 'Piano Chorus']] },
  { name: 'Drums', instrument: 'Studio Kit', icon: I.drum, colour: C.drums, kind: 'drums', regions: [[1, 5, 'Beat A'], [5, 9, 'Beat A'], [9, 13, 'Beat B'], [13, 17, 'Beat B · Fill']] },
  { name: 'Bass', instrument: 'Warm Fingered', icon: I.bass, colour: C.bass, kind: 'midi', regions: [[5, 17, 'Bass Line']] },
  { name: 'Acoustic', instrument: 'Steel String', icon: I.guitar, colour: C.guitar, kind: 'audio', regions: [[1, 9, 'Guitar Take 2'], [9, 13, 'Guitar Take 4']] },
  { name: 'Lead Vocal', instrument: 'Audio Recorder', icon: I.mic, colour: C.vocal, kind: 'audio', regions: [[5, 9, 'Verse Vocal'], [9, 17, 'Chorus Vocal']] },
  { name: 'Strings', instrument: 'Orchestra', icon: I.violin, colour: C.strings, kind: 'midi', regions: [[9, 17, 'Strings Swell']] },
  { name: 'Nova Synth', instrument: 'Neon Bass', icon: I.synth, colour: C.synth, kind: 'midi', regions: [[1, 5, 'Arp'], [13, 17, 'Arp Outro']] },
]

/** What a region shows inside: MIDI notes, drum hits or a waveform — one compound path. */
function regionContent(kind: Track['kind'], x: number, y: number, w: number, h: number, seed: number): string {
  const r = random(seed)
  let d = ''
  if (kind === 'midi') {
    let px = x + 4
    let note = 0.5
    while (px < x + w - 8) {
      const len = 6 + Math.floor(r() * 3) * 7
      note = Math.min(0.9, Math.max(0.1, note + (r() - 0.5) * 0.4))
      const ny = y + note * (h - 4)
      d += `M${f(px)} ${f(ny)}h${f(Math.min(len, x + w - 4 - px))}v3h${f(-Math.min(len, x + w - 4 - px))}Z`
      if (r() > 0.55) d += `M${f(px)} ${f(ny - 8)}h${f(Math.min(len, x + w - 4 - px))}v3h${f(-Math.min(len, x + w - 4 - px))}Z`
      px += len + 2
    }
  } else if (kind === 'drums') {
    const step = w / 32
    for (let i = 0; i < 32; i++) {
      const px = x + 3 + i * step
      if (i % 8 === 0 || i % 8 === 5) d += `M${f(px)} ${f(y + h - 12)}h2v10h-2Z`
      if (i % 8 === 4) d += `M${f(px)} ${f(y + h / 2 - 5)}h2v10h-2Z`
      d += `M${f(px)} ${f(y + 2)}h2v${i % 2 ? 5 : 9}h-2Z`
    }
  } else {
    d = waveform(x + 2, y, w - 4, h, seed, 2)
  }
  return d
}

// ---------------------------------------------------------------------------
// 22 Tracks
// ---------------------------------------------------------------------------

const TX = 248
const BW = 58
const barX = (bar: number) => TX + (bar - 1) * BW

function ruler(s: Studio, y: number, cycle: [number, number] | null, playhead: number): NodeId {
  const ids: NodeId[] = [s.rect('Background', TX - 8, y, 1194 - TX + 8, 40, { fill: linear([['#26262C', 0], ['#1F1F24', 1]]) })]
  if (cycle) {
    ids.push(s.fx(s.rect('Cycle Region', barX(cycle[0]), y + 4, (cycle[1] - cycle[0]) * BW, 12, { fill: C.drums, radius: 3, opacity: 0.9 }), { shadow: glow(C.drums, 6, 0.4) }))
  }
  let d = ''
  for (let b = 1; b <= 16; b++) {
    const x = barX(b)
    d += `M${x} ${y + 22}V${y + 40}`
    for (let q = 1; q < 4; q++) d += `M${f(x + (q * BW) / 4)} ${y + 34}V${y + 40}`
  }
  ids.push(s.path('Ticks', d, { stroke: C.faint, width: 1 }))
  for (let b = 1; b <= 16; b++) ids.push(s.text(`Bar ${b}`, String(b), barX(b) + 4, y + 20, { size: 10, weight: 600, family: MONO, color: C.dim }))
  const px = barX(playhead)
  ids.push(s.path('Playhead Head', `M${f(px - 8)} ${y + 22}h16v8l-8 8l-8-8z`, { fill: '#FFFFFF', closed: true }))
  return s.group('Ruler', ids)
}

export function tracksView(s: Studio): void {
  chrome(s, { bar: 6, beat: 3, tempo: 112, key: 'C maj', active: 'tracks', playing: true, cycle: true })
  const top = 136
  const rowH = 96
  const playhead = 6.55
  s.rect('Lane Background', TX - 8, top, 1194 - TX + 8, 698, { fill: '#18181C' })
  s.rect('Header Background', 0, 96, TX - 8, 738, { fill: '#1F1F24' })
  s.group('Header Tools', [
    panelButton(s, 'Add Track', 12, 100, 100, 32, { icon: I.plus, label: 'Track', size: 12 }),
    panelButton(s, 'Automation', 120, 100, 108, 32, { icon: I.wave3, label: 'Curves', size: 12 }),
  ])
  let grid = ''
  for (let b = 1; b <= 17; b++) grid += `M${barX(b)} ${top}V834`
  let beats = ''
  for (let b = 1; b <= 16; b++) for (let q = 1; q < 4; q++) beats += `M${f(barX(b) + (q * BW) / 4)} ${top}V834`
  s.group('Grid', [
    s.path('Beats', beats, { stroke: '#FFFFFF', width: 1, alpha: 0.025 }),
    s.path('Bars', grid, { stroke: '#FFFFFF', width: 1, alpha: 0.07 }),
  ])
  ruler(s, 96, [5, 9], playhead)

  TRACKS.forEach((t, i) => {
    const y = top + i * rowH
    const selected = i === 0
    const regions = t.regions.map(([from, to, label], k) => {
      const x = barX(from) + 1
      const w = (to - from) * BW - 2
      const muted = i === 5
      return s.group(`Region / ${label}`, [
        s.rect('Body', x, y + 6, w, rowH - 12, {
          fill: linear([[t.colour, 0, muted ? 0.4 : 0.92], [t.colour, 1, muted ? 0.3 : 0.7]]), radius: 6,
          stroke: { color: selected ? '#FFFFFF' : '#000000', width: selected ? 1.5 : 1, alpha: selected ? 0.9 : 0.3 },
        }),
        s.rect('Title Bar', x, y + 6, w, 18, { fill: '#000000', opacity: 0.18, radius: [6, 6, 0, 0] }),
        s.text('Name', label, x + 6, y + 8, { size: 10, weight: 700, color: '#101014' }),
        s.path('Content', regionContent(t.kind, x + 2, y + 28, w - 4, rowH - 40, i * 7 + k), { fill: '#101014', opacity: 0.5, closed: true }),
      ])
    })
    s.group(`Track / ${t.name}`, [
      s.group('Header', [
        s.rect('Background', 0, y, TX - 8, rowH, { fill: selected ? '#2C2C34' : i % 2 ? '#1F1F24' : '#222228' }),
        s.rect('Divider', 0, y + rowH - 1, 1194, 1, { fill: '#000000', opacity: 0.5 }),
        ...(selected ? [s.rect('Selected', 0, y, 4, rowH, { fill: t.colour })] : []),
        instrumentTile(s, t.name, t.icon, 14, y + 18, 56, t.colour),
        s.text('Name', t.name, 82, y + 16, { size: 14, weight: 600, color: C.text }),
        s.text('Instrument', t.instrument, 82, y + 36, { size: 11, color: C.dim }),
        s.group('Mute', [s.rect('Button', 82, y + 60, 26, 22, { fill: i === 5 ? C.keys : '#34343C', radius: 5 }), s.centeredText('Label', 'M', { x: 82, y: y + 60, w: 26, h: 22 }, { size: 11, weight: 700, color: i === 5 ? '#0E1A2A' : C.dim })]),
        s.group('Solo', [s.rect('Button', 112, y + 60, 26, 22, { fill: '#34343C', radius: 5 }), s.centeredText('Label', 'S', { x: 112, y: y + 60, w: 26, h: 22 }, { size: 11, weight: 700, color: C.dim })]),
        s.rect('Volume Track', 148, y + 69, 76, 4, { fill: '#121215', radius: 2 }),
        s.rect('Volume Level', 148, y + 69, [52, 60, 44, 38, 66, 30, 40][i]!, 4, { fill: C.dim, radius: 2 }),
        s.circle('Volume Thumb', 148 + [52, 60, 44, 38, 66, 30, 40][i]!, y + 71, 7, { fill: '#FFFFFF', shadow: shadow(1, 3, 0.5, 0, '#000000') }),
      ]),
      s.group('Regions', regions),
    ])
  })
  s.group('Playhead', [s.line('Line', barX(playhead), 132, barX(playhead), 834, '#FFFFFF', 1.5)])
}

// ---------------------------------------------------------------------------
// 23 Live Loops
// ---------------------------------------------------------------------------

const LOOP_ROWS: Array<[string, string, string, Array<string | null>, Track['kind']]> = [
  ['Drums', I.drum, C.drums, ['Boom Bap 1', 'Boom Bap 2', 'Half Time', null, 'Break Fill', 'Brush Groove'], 'drums'],
  ['Bass', I.bass, C.bass, ['Walking C', 'Octave Pump', 'Sub Hold', 'Slide Riff', null, null], 'midi'],
  ['Keys', I.keyboard, C.keys, ['Rhodes Vamp', 'Piano Stabs', null, 'Soft Chords', 'Chord Swell', null], 'midi'],
  ['Guitar', I.guitar, C.guitar, [null, 'Clean Strum', 'Muted Chug', 'Lead Lick', null, 'Ambient Swell'], 'audio'],
  ['Synth', I.synth, C.synth, ['Neon Arp', 'Pulse Pad', 'Glass Rise', null, 'Arp Outro', null], 'midi'],
  ['Vocals', I.mic, C.vocal, [null, 'Hook “Hey”', null, 'Verse Ad-lib', 'Choir Oohs', null], 'audio'],
]

export function liveLoops(s: Studio): void {
  chrome(s, { bar: 18, beat: 2, tempo: 118, key: 'C min', active: 'tracks', playing: true })
  s.group('Toolbar', [
    s.text('Title', 'Live Loops', 16, 110, { size: 22, weight: 700, color: C.text }),
    s.text('Status', 'Scene 2 playing  ·  next change at bar 19', 16, 140, { size: 12, color: C.dim }),
    panelButton(s, 'Quantize', 748, 116, 144, 36, { icon: I.clock, label: 'Quantize 1 Bar', size: 12 }),
    panelButton(s, 'Edit', 900, 116, 80, 36, { label: 'Edit' }),
    panelButton(s, 'Remix FX', 988, 116, 110, 36, { icon: I.sparkle, label: 'Remix' }),
    panelButton(s, 'Record Loop', 1106, 116, 72, 36, { icon: I.plus, label: '' }),
  ])
  const cx0 = 212
  const cw = 128
  const gap = 10
  const top = 196
  const cellH = 84
  const rowGap = 10
  s.group('Scene Numbers', Array.from({ length: 6 }, (_, j) => s.text(`Scene ${j + 1}`, String(j + 1), cx0 + j * (cw + gap) + cw / 2, 172, {
    size: 12, weight: 700, family: MONO, color: j === 1 ? C.amber : C.faint, anchor: 'center',
  })))
  s.text('Stop Title', 'STOP', 1112, 172, { ...LABEL, anchor: 'center' })
  LOOP_ROWS.forEach(([name, icon, colour, cells, kind], i) => {
    const y = top + i * (cellH + rowGap)
    const row: NodeId[] = [
      s.group('Header', [
        s.rect('Background', 16, y, 184, cellH, { fill: '#26262C', radius: 12 }),
        instrumentTile(s, name, icon, 28, y + 16, 52, colour),
        s.text('Name', name, 92, y + 22, { size: 15, weight: 600, color: C.text }),
        s.text('Count', `${cells.filter(Boolean).length} loops`, 92, y + 44, { size: 11, color: C.dim }),
      ]),
    ]
    cells.forEach((loop, j) => {
      const x = cx0 + j * (cw + gap)
      const playing = j === 1 && loop !== null
      const queued = i === 3 && j === 2
      if (!loop) {
        row.push(s.group(`Cell ${j + 1} / Empty`, [
          s.rect('Slot', x, y, cw, cellH, { fill: '#1E1E23', radius: 12, stroke: { color: '#FFFFFF', width: 1, alpha: 0.04 } }),
          s.icon('Add', I.plus, x + cw / 2 - 8, y + cellH / 2 - 8, 16, '#3A3A44', { width: 2 }),
        ]))
        return
      }
      const parts: NodeId[] = [
        s.rect('Cell', x, y, cw, cellH, {
          fill: playing ? linear([[colour, 0], [colour, 1, 0.78]]) : linear([[colour, 0, 0.42], [colour, 1, 0.28]]),
          radius: 12,
          ...(queued
            ? { stroke: { color: colour, width: 2, dash: [6, 4] } }
            : { stroke: { color: '#FFFFFF', width: 1, alpha: playing ? 0.4 : 0.06 } }),
          ...(playing ? { shadow: glow(colour, 18, 0.45) } : {}),
        }),
        s.path('Pattern', regionContent(kind, x + 10, y + 40, cw - 20, 32, i * 11 + j), { fill: playing ? '#101014' : colour, opacity: playing ? 0.45 : 0.7, closed: true }),
        s.text('Name', loop, x + 10, y + 10, { size: 12, weight: 600, color: playing ? '#101014' : C.text }),
      ]
      if (playing) {
        const pcx = x + cw - 20
        const pcy = y + 18
        parts.push(
          s.circle('Ring Track', pcx, pcy, 10, { fill: '#101014', opacity: 0.25 }),
          s.path('Progress Ring', arc(pcx, pcy, 10, 0, 90 + i * 40), { stroke: '#101014', width: 3 }),
          s.icon('Playing', I.play, pcx - 5, pcy - 5, 10, '#101014', { fill: '#101014', width: 1 }),
        )
      }
      if (queued) parts.push(s.icon('Queued', I.play, x + cw - 26, y + 10, 16, colour, { width: 2 }))
      row.push(s.group(`Cell ${j + 1} / ${loop}${playing ? ' (playing)' : queued ? ' (queued)' : ''}`, parts))
    })
    row.push(s.group('Stop', [
      s.rect('Button', 1056, y, 112, cellH, { fill: '#26262C', radius: 12 }),
      s.rect('Stop Icon', 1101, y + cellH / 2 - 11, 22, 22, { fill: i === 5 ? C.faint : C.dim, radius: 4 }),
    ]))
    s.group(`Row / ${name}`, row)
  })
  const ty = top + 6 * (cellH + rowGap) + 6
  s.group('Scene Triggers', [
    ...Array.from({ length: 6 }, (_, j) => {
      const x = cx0 + j * (cw + gap)
      const on = j === 1
      return s.group(`Trigger / Scene ${j + 1}`, [
        s.rect('Button', x, ty, cw, 48, { fill: on ? linear([['#4A4A55', 0], ['#383841', 1]]) : '#26262C', radius: 12, stroke: { color: on ? C.amber : '#FFFFFF', width: 1, alpha: on ? 0.8 : 0.05 } }),
        s.icon('Arrow', 'M9 5.5l7 6.5-7 6.5', x + cw / 2 - 11, ty + 13, 22, on ? C.amber : C.dim, { width: 2.4 }),
      ])
    }),
    s.group('Stop All', [
      s.rect('Button', 1056, ty, 112, 48, { fill: '#3A2226', radius: 12, stroke: { color: C.red, width: 1, alpha: 0.5 } }),
      s.centeredText('Label', 'Stop All', { x: 1056, y: ty, w: 112, h: 48 }, { size: 13, weight: 700, color: '#FF8A80' }),
    ]),
  ])
}

// ---------------------------------------------------------------------------
// 24 Mixer
// ---------------------------------------------------------------------------

function meter(s: Studio, name: string, x: number, y: number, h: number, level: number, w = 8): NodeId {
  const segs = Math.floor(h / 6)
  const lit = Math.round(segs * level)
  let green = ''
  let yellow = ''
  let red = ''
  let off = ''
  for (let i = 0; i < segs; i++) {
    const sy = y + h - (i + 1) * 6
    const seg = `M${x} ${sy}h${w}v4h${-w}Z`
    if (i >= lit) off += seg
    else if (i > segs * 0.88) red += seg
    else if (i > segs * 0.7) yellow += seg
    else green += seg
  }
  const ids = [s.path('Off', off, { fill: '#2A2A30', closed: true })]
  if (green) ids.push(s.fx(s.path('Green', green, { fill: C.guitar, closed: true }), { shadow: glow(C.guitar, 4, 0.5) }))
  if (yellow) ids.push(s.fx(s.path('Yellow', yellow, { fill: C.drums, closed: true }), { shadow: glow(C.drums, 4, 0.5) }))
  if (red) ids.push(s.fx(s.path('Red', red, { fill: C.red, closed: true }), { shadow: glow(C.red, 4, 0.5) }))
  return s.group(`Meter / ${name}`, ids)
}

export function mixer(s: Studio): void {
  chrome(s, { bar: 11, beat: 1, tempo: 112, key: 'C maj', active: 'mixer', playing: true })
  s.rect('Console', 0, 96, 1194, 738, { fill: linear([['#1C1C21', 0], ['#141417', 1]]) })
  const strips = [...TRACKS, { name: 'Room Mic', instrument: 'Audio Recorder', icon: I.mic, colour: C.world, kind: 'audio' as const, regions: [] }]
  const levels = [0.62, 0.78, 0.55, 0.48, 0.7, 0.4, 0.52, 0.2]
  const faders = [0.72, 0.8, 0.66, 0.6, 0.76, 0.5, 0.58, 0.45]
  const pans = [0.42, 0.5, 0.5, 0.3, 0.5, 0.68, 0.6, 0.5]
  const sw = 118
  strips.slice(0, 8).forEach((t, i) => {
    const x = 16 + i * (sw + 8)
    const cx = x + sw / 2
    const muted = i === 5
    const solo = i === 4
    s.group(`Channel / ${t.name}`, [
      s.rect('Strip', x, 108, sw, 714, { fill: linear([['#26262C', 0], ['#202026', 1]]), radius: 12, stroke: { color: '#FFFFFF', width: 1, alpha: 0.05 } }),
      instrumentTile(s, t.name, t.icon, cx - 22, 120, 44, t.colour),
      s.text('Name', t.name, cx, 172, { size: 12, weight: 600, color: C.text, anchor: 'center' }),
      s.group('Inserts', ['Comp', i % 3 === 0 ? 'EQ' : i % 3 === 1 ? 'Drive' : 'Chorus'].map((fx, k) => s.group(`Insert / ${fx}`, [
        s.rect('Slot', x + 10, 198 + k * 28, sw - 20, 22, { fill: '#18181C', radius: 5, stroke: { color: t.colour, width: 1, alpha: 0.35 } }),
        s.text('Name', fx, x + 18, 202 + k * 28, { size: 10, weight: 600, color: C.dim }),
        s.circle('On', x + sw - 20, 209 + k * 28, 3, { fill: t.colour }),
      ]))),
      knob(s, 'Reverb Send', x + 32, 286, 13, [0.3, 0.2, 0.1, 0.4, 0.55, 0.6, 0.35, 0.25][i]!, { color: C.strings, label: 'Rev' }),
      knob(s, 'Echo Send', x + sw - 32, 286, 13, [0.15, 0, 0.05, 0.25, 0.4, 0.2, 0.5, 0.1][i]!, { color: C.synth, label: 'Echo' }),
      knob(s, 'Pan', cx, 354, 18, pans[i]!, { color: C.amber, label: pans[i] === 0.5 ? 'Pan C' : pans[i]! < 0.5 ? `Pan L${Math.round((0.5 - pans[i]!) * 128)}` : `Pan R${Math.round((pans[i]! - 0.5) * 128)}` }),
      s.group('Mute', [
        s.rect('Button', x + 12, 408, 44, 28, { fill: muted ? C.keys : '#34343C', radius: 6 }),
        s.centeredText('Label', 'M', { x: x + 12, y: 408, w: 44, h: 28 }, { size: 12, weight: 700, color: muted ? '#0E1A2A' : C.dim }),
      ]),
      s.group('Solo', [
        s.rect('Button', x + sw - 56, 408, 44, 28, { fill: solo ? C.drums : '#34343C', radius: 6 }),
        s.centeredText('Label', 'S', { x: x + sw - 56, y: 408, w: 44, h: 28 }, { size: 12, weight: 700, color: solo ? '#2A1E00' : C.dim }),
      ]),
      fader(s, t.name, x + 46, 452, 300, faders[i]!, { cap: 'white' }),
      meter(s, t.name, x + 82, 452, 300, muted ? 0 : levels[i]!),
      s.fx(s.rect('Readout', x + 14, 766, sw - 28, 24, { fill: '#0E0E11', radius: 6 }), { inner: shadow(1, 2, 0.7, 0, '#000000') }),
      s.centeredText('dB', `${(faders[i]! * 12 - 9).toFixed(1)} dB`, { x: x + 14, y: 766, w: sw - 28, h: 24 }, { size: 11, weight: 500, family: MONO, color: C.lcd }),
      s.rect('Colour', x + 12, 802, sw - 24, 4, { fill: t.colour, radius: 2 }),
    ])
  })

  const mx = 16 + 8 * (sw + 8)
  const mw = 1178 - mx
  const mcx = mx + mw / 2
  s.group('Channel / Master', [
    s.rect('Strip', mx, 108, mw, 714, { fill: linear([['#2E2A24', 0], ['#221F1A', 1]]), radius: 12, stroke: { color: C.amber, width: 1, alpha: 0.3 } }),
    s.text('Name', 'MASTER', mcx, 126, { ...LABEL, size: 12, color: C.amber, anchor: 'center' }),
    s.text('Output', 'Stereo Out', mcx, 146, { size: 11, color: C.dim, anchor: 'center' }),
    s.group('Master Effects', ['Echo', 'Reverb', 'Limiter'].map((fx, k) => s.group(`Effect / ${fx}`, [
      s.rect('Slot', mx + 12, 180 + k * 30, mw - 24, 24, { fill: '#18181C', radius: 5, stroke: { color: C.amber, width: 1, alpha: 0.3 } }),
      s.text('Name', fx, mx + 20, 185 + k * 30, { size: 10, weight: 600, color: C.dim }),
      s.circle('On', mx + mw - 22, 192 + k * 30, 3, { fill: C.amber }),
    ]))),
    knob(s, 'Master EQ', mcx, 318, 20, 0.5, { color: C.amber, label: 'Tone', value: 'Flat' }),
    fader(s, 'Master', mcx - 16, 452, 300, 0.74, { cap: 'white' }),
    meter(s, 'Master Left', mcx + 18, 452, 300, 0.74, 6),
    meter(s, 'Master Right', mcx + 28, 452, 300, 0.7, 6),
    s.fx(s.rect('Readout', mx + 14, 766, mw - 28, 24, { fill: '#0E0E11', radius: 6 }), { inner: shadow(1, 2, 0.7, 0, '#000000') }),
    s.centeredText('dB', '−1.2 dB', { x: mx + 14, y: 766, w: mw - 28, h: 24 }, { size: 11, weight: 500, family: MONO, color: C.lcd }),
    s.rect('Colour', mx + 12, 802, mw - 24, 4, { fill: C.amber, radius: 2 }),
  ])
}

// ---------------------------------------------------------------------------
// 25 Song Settings
// ---------------------------------------------------------------------------

export function songSettings(s: Studio): void {
  chrome(s, { bar: 1, beat: 1, tempo: 112, key: 'C maj', active: 'settings' })
  // The tracks behind, dimmed.
  s.rect('Lanes', 0, 96, 1194, 738, { fill: '#18181C' })
  TRACKS.forEach((t, i) => {
    const y = 136 + i * 96
    s.group(`Background Track / ${t.name}`, [
      s.rect('Header', 0, y, 240, 96, { fill: i % 2 ? '#1F1F24' : '#222228' }),
      instrumentTile(s, t.name, t.icon, 14, y + 18, 56, t.colour),
      s.text('Name', t.name, 82, y + 16, { size: 14, weight: 600, color: C.text }),
      ...t.regions.map(([from, to], k) => s.rect(`Region ${k + 1}`, barX(from) + 1, y + 6, (to - from) * BW - 2, 84, { fill: t.colour, radius: 6, opacity: 0.8 })),
    ])
  })
  s.rect('Dim', 0, 96, 1194, 738, { fill: '#000000', opacity: 0.6 })

  const px = 574
  const pw = 604
  const pad = 28
  s.group('Popover', [
    s.path('Arrow', 'M1148 104l10-10 10 10z', { fill: '#2A2A31', closed: true }),
    s.rect('Panel', px, 104, pw, 714, { fill: '#2A2A31', radius: 20, stroke: { color: '#FFFFFF', width: 1, alpha: 0.08 }, shadow: shadow(24, 60, 0.7, 0, '#000000') }),
    s.text('Title', 'Song Settings', px + pad, 124, { size: 20, weight: 700, color: C.text }),
    s.text('Song', 'Neon Harbor', px + pad, 152, { size: 13, color: C.dim }),
    panelButton(s, 'Done', px + pw - pad - 80, 122, 80, 36, { label: 'Done', on: true }),
    s.rect('Divider 1', px + pad, 180, pw - 2 * pad, 1, { fill: '#FFFFFF', opacity: 0.07 }),
  ])

  // Tempo: a big ribbed wheel under the number.
  const wx = px + pad
  const wy = 268
  const ww = pw - 2 * pad
  let ribs = ''
  for (let i = 0; i <= 60; i++) {
    const t = i / 60
    const x = wx + (1 - Math.cos(t * Math.PI)) / 2 * ww
    ribs += `M${f(x)} ${wy + 4}V${wy + 52}`
  }
  s.group('Tempo', [
    s.label('Caption', 'tempo', px + pad, 196),
    s.text('BPM', '112', px + pad, 212, { size: 40, weight: 700, family: MONO, color: C.text }),
    s.text('Unit', 'BPM', px + pad + 96, 234, { size: 13, weight: 600, color: C.dim }),
    panelButton(s, 'Tap Tempo', px + pw - pad - 140, 206, 140, 44, { icon: I.tap, label: 'Tap Tempo' }),
    s.fx(s.rect('Wheel Well', wx, wy, ww, 56, { fill: '#0E0E11', radius: 12 }), { inner: shadow(2, 6, 0.8, 0, '#000000') }),
    s.rect('Wheel', wx + 6, wy + 4, ww - 12, 48, { fill: linear([['#0A0A0C', 0], ['#3A3A40', 0.3], ['#5A5A62', 0.5], ['#3A3A40', 0.7], ['#0A0A0C', 1]], 0, 0, 1, 0), radius: 8 }),
    s.path('Ribs', ribs, { stroke: '#000000', width: 2, alpha: 0.45 }),
    s.fx(s.rect('Index', wx + ww / 2 - 2, wy - 2, 4, 60, { fill: C.amber, radius: 2 }), { shadow: glow(C.amber, 8, 0.8) }),
    s.text('Slower', '− slower', wx, wy + 64, { size: 11, color: C.faint }),
    s.text('Faster', 'faster +', wx + ww, wy + 64, { size: 11, color: C.faint, anchor: 'right' }),
  ])

  s.group('Time Signature', [
    s.label('Caption', 'time signature', px + pad, 360),
    segmented(s, 'Signature', px + pad, 380, ['2/4', '3/4', '4/4', '5/4', '6/8', '7/8'], 2, { w: 78, h: 38, accent: C.amber }).id,
  ])

  const keys = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']
  const kw = (ww - 5 * 8) / 6
  s.group('Key', [
    s.label('Caption', 'key', px + pad, 440),
    segmented(s, 'Scale', px + pw - pad - 180, 432, ['Major', 'Minor'], 0, { w: 88, h: 30 }).id,
    ...keys.map((k, i) => {
      const x = px + pad + (i % 6) * (kw + 8)
      const y = 472 + Math.floor(i / 6) * 50
      const on = k === 'C'
      return s.group(`Key / ${k}`, [
        s.rect('Button', x, y, kw, 42, { fill: on ? C.amber : '#34343C', radius: 10, ...(on ? { shadow: glow(C.amber, 12, 0.4) } : {}) }),
        s.centeredText('Label', k, { x, y, w: kw, h: 42 }, { size: 15, weight: 700, color: on ? '#2A1E00' : C.text }),
      ])
    }),
  ])

  const rows: Array<[string, string, () => NodeId]> = [
    ['Metronome', 'Clicks on every beat while recording', () => toggle(s, 'Metronome', px + pw - pad - 46, 598, true, C.amber)],
    ['Count-in', 'One bar before recording starts', () => toggle(s, 'Count-in', px + pw - pad - 46, 650, true, C.amber)],
    ['Sound', 'Classic click', () => s.group('Sound Value', [
      s.text('Value', 'Woodblock', px + pw - pad - 24, 704, { size: 14, weight: 600, color: C.dim, anchor: 'right' }),
      s.icon('Chevron', I.chevronRight, px + pw - pad - 18, 703, 18, C.dim),
    ])],
    ['Click Volume', 'Level of the click in your headphones', () => s.group('Volume Slider', [
      s.rect('Track', px + pw - pad - 200, 756, 200, 6, { fill: '#121215', radius: 3 }),
      s.rect('Level', px + pw - pad - 200, 756, 128, 6, { fill: C.amber, radius: 3 }),
      s.circle('Thumb', px + pw - pad - 72, 759, 10, { fill: '#FFFFFF', shadow: shadow(2, 4, 0.5, 0, '#000000') }),
    ])],
  ]
  s.group('Metronome', [
    s.rect('Divider 2', px + pad, 580, pw - 2 * pad, 1, { fill: '#FFFFFF', opacity: 0.07 }),
    ...rows.map(([label, hint, control], i) => {
      const y = 594 + i * 52
      return s.group(`Row / ${label}`, [
        s.text('Label', label, px + pad, y, { size: 14, weight: 600, color: C.text }),
        s.text('Hint', hint, px + pad, y + 20, { size: 11, color: C.dim }),
        control(),
      ])
    }),
  ])
}

// ---------------------------------------------------------------------------
// 26 Loop Browser
// ---------------------------------------------------------------------------

const LOOPS: Array<[string, string, string, number, string, number, boolean]> = [
  ['Dusty Boom Bap Beat', I.drum, C.drums, 8, '—', 90, true],
  ['Warm Rhodes Chords', I.keyboard, C.keys, 8, 'Am', 90, false],
  ['Round Bass Walk', I.bass, C.bass, 4, 'Am', 92, false],
  ['Nylon Pluck Melody', I.guitar, C.guitar, 8, 'C', 88, true],
  ['Tape Choir Swell', I.mic, C.vocal, 16, 'Am', 90, false],
  ['Late Night Arp', I.synth, C.synth, 8, 'Em', 96, false],
  ['Brushed Snare Shuffle', I.drum, C.drums, 4, '—', 86, false],
  ['Pizzicato Steps', I.violin, C.strings, 8, 'G', 94, false],
  ['Vinyl Crackle Bed', I.wave, C.sampler, 16, '—', 90, true],
  ['Muted Funk Guitar', I.guitar, C.guitar, 4, 'Dm', 98, false],
]

export function loopBrowser(s: Studio): void {
  chrome(s, { bar: 9, beat: 1, tempo: 90, key: 'A min', active: 'loops', playing: true })
  s.group('Search', [
    s.rect('Field', 16, 108, 320, 40, { fill: '#26262C', radius: 10, stroke: { color: '#FFFFFF', width: 1, alpha: 0.06 } }),
    s.icon('Icon', I.search, 28, 117, 22, C.dim, { width: 1.8 }),
    s.text('Query', 'lo-fi', 58, 118, { size: 14, weight: 500, color: C.text }),
    s.rect('Cursor', 86, 118, 1.5, 20, { fill: C.amber }),
  ])
  segmented(s, 'Library', 352, 108, ['Loops', 'One-shots', 'Favorites'], 0, { h: 40 })
  s.group('Song Key', [
    s.text('Label', 'Match song key', 1058, 118, { size: 13, weight: 600, color: C.text, anchor: 'right' }),
    toggle(s, 'Match Key', 1072, 115, true, C.amber),
    s.icon('Close', I.close, 1146, 116, 24, C.dim, { width: 2 }),
  ])

  // Filters
  const filters = ['All Drums', 'Beats', 'Bass', 'Guitars', 'Keys', 'Synths', 'Strings', 'Vocals', 'Textures', 'FX']
  const genres = ['Lo-fi', 'Hip Hop', 'House', 'Cinematic', 'Indie', 'Jazz']
  const moods = [['Relaxed', 'Intense'], ['Clean', 'Distorted'], ['Acoustic', 'Electric']]
  s.rect('Filter Panel', 16, 164, 320, 654, { fill: '#202026', radius: 14, stroke: { color: '#FFFFFF', width: 1, alpha: 0.05 } })
  s.group('Instrument Filters', [
    s.label('Caption', 'instrument', 32, 182),
    ...filters.map((name, i) => {
      const x = 32 + (i % 2) * 148
      const y = 204 + Math.floor(i / 2) * 46
      const on = name === 'Keys' || name === 'Beats'
      return s.group(`Filter / ${name}`, [
        s.rect('Chip', x, y, 140, 38, { fill: on ? linear([['#4A4A55', 0], ['#3C3C45', 1]]) : '#2A2A31', radius: 10, stroke: { color: on ? C.amber : '#FFFFFF', width: 1, alpha: on ? 0.8 : 0.04 } }),
        s.centeredText('Label', name, { x, y, w: 140, h: 38 }, { size: 13, weight: 600, color: on ? C.amber : C.text }),
      ])
    }),
  ])
  s.group('Genre Filters', [
    s.label('Caption', 'genre', 32, 446),
    ...genres.map((name, i) => {
      const x = 32 + (i % 3) * 98
      const y = 468 + Math.floor(i / 3) * 44
      const on = name === 'Lo-fi'
      return s.group(`Genre / ${name}`, [
        s.rect('Chip', x, y, 90, 36, { fill: on ? C.amber : '#2A2A31', radius: 18 }),
        s.centeredText('Label', name, { x, y, w: 90, h: 36 }, { size: 12, weight: 600, color: on ? '#2A1E00' : C.text }),
      ])
    }),
  ])
  s.group('Descriptors', [
    s.label('Caption', 'descriptors', 32, 574),
    ...moods.map(([a, b], i) => {
      const y = 596 + i * 46
      return s.group(`Descriptor / ${a} or ${b}`, [
        segmented(s, `${a} or ${b}`, 32, y, [a!, b!], i === 0 ? 0 : -1, { w: 142, h: 36 }).id,
      ])
    }),
    s.text('Reset', 'Reset filters', 176, 748, { size: 13, weight: 600, color: C.amber, anchor: 'center' }),
    s.text('Found', '248 loops match', 176, 776, { size: 12, color: C.faint, anchor: 'center' }),
  ])

  // The list.
  const lx = 352
  const lw = 1178 - lx
  const col = { fav: lx + 16, name: lx + 96, wave: lx + 380, beats: lx + 640, key: lx + 706, bpm: lx + lw - 20 }
  s.group('Column Headers', [
    s.rect('Background', lx, 164, lw, 36, { fill: '#202026', radius: [14, 14, 0, 0] }),
    s.label('Name', 'name', col.name, 176),
    s.label('Preview', 'preview', col.wave, 176),
    s.label('Beats', 'beats', col.beats, 176),
    s.label('Key', 'key', col.key, 176),
    s.label('Tempo', 'bpm', col.bpm, 176, { anchor: 'right' }),
  ])
  LOOPS.forEach(([name, icon, colour, beats, key, bpm, fav], i) => {
    const y = 200 + i * 56
    const playing = i === 1
    const parts: NodeId[] = [
      s.rect('Row', lx, y, lw, 56, { fill: playing ? '#2C2C34' : i % 2 ? '#1E1E23' : '#222228', ...(i === LOOPS.length - 1 ? { radius: [0, 0, 14, 14] } : {}) }),
    ]
    if (playing) parts.push(s.rect('Accent', lx, y, 4, 56, { fill: C.amber }))
    parts.push(
      s.icon('Favorite', I.star, col.fav, y + 17, 20, fav ? C.amber : '#4A4A54', fav ? { fill: C.amber, width: 1.4 } : { width: 1.6 }),
      instrumentTile(s, name, icon, lx + 48, y + 10, 36, colour),
      s.text('Name', name, col.name, y + 11, { size: 14, weight: 600, color: playing ? '#FFFFFF' : C.text }),
      s.text('Genre', ['Lo-fi · Hip Hop', 'Lo-fi · Jazz', 'Lo-fi', 'Indie', 'Cinematic', 'House', 'Jazz', 'Cinematic', 'Lo-fi · Texture', 'Indie · Funk'][i]!, col.name, y + 31, { size: 11, color: C.dim }),
      s.path('Waveform', waveform(col.wave, y + 14, 220, 28, 60 + i, 2), { fill: playing ? C.amber : colour, opacity: playing ? 1 : 0.55 }),
      s.text('Beats', String(beats), col.beats + 12, y + 19, { size: 13, weight: 500, family: MONO, color: C.text, anchor: 'center' }),
      s.text('Key', key, col.key + 10, y + 19, { size: 13, weight: 600, color: key === '—' ? C.faint : C.text, anchor: 'center' }),
      s.text('BPM', String(bpm), col.bpm, y + 19, { size: 13, weight: 500, family: MONO, color: C.text, anchor: 'right' }),
    )
    if (playing) {
      parts.push(
        s.rect('Progress', col.wave, y + 14, 88, 28, { fill: '#000000', opacity: 0.35 }),
        s.line('Playhead', col.wave + 88, y + 10, col.wave + 88, y + 46, '#FFFFFF', 1.5),
        s.circle('Speaker Disc', col.wave - 24, y + 28, 12, { fill: C.amber }),
        s.icon('Speaker', I.speaker, col.wave - 32, y + 20, 16, '#2A1E00', { width: 1.8 }),
      )
    }
    s.group(`Loop / ${name}`, parts)
  })
  s.group('Preview Bar', [
    s.icon('Speaker', I.speaker, lx + 8, 776, 20, C.dim, { width: 1.8 }),
    s.rect('Volume Track', lx + 36, 784, 160, 4, { fill: '#2E2E35', radius: 2 }),
    s.rect('Volume Level', lx + 36, 784, 110, 4, { fill: C.dim, radius: 2 }),
    s.circle('Volume Thumb', lx + 146, 786, 8, { fill: '#FFFFFF' }),
    s.text('Hint', 'Drag a loop onto the Tracks view to add it at the playhead', lx + lw, 777, { size: 12, color: C.faint, anchor: 'right' }),
  ])
}
