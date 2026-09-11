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
 * Around the instruments: My Songs, the instrument browser, the sampler and
 * the audio recorder.
 */

import type { ImageAsset, NodeId } from '@/document/types'
import { linear, shadow } from '../kit'
import {
  arc, C, chrome, glow, I, instrumentTile, knob, LABEL, led, MONO, panelButton, polar, radialAt, ring, screw, segmented,
  ticks, toggle, waveform, type Studio,
} from './base'
import { cymbal, drum, keyboard } from './instruments'

const f = (n: number) => Number(n.toFixed(2))

// ---------------------------------------------------------------------------
// 01 My Songs
// ---------------------------------------------------------------------------

export interface Song {
  title: string
  length: string
  date: string
  art: ImageAsset
  tracks: number
}

export function mySongs(s: Studio, songs: Song[]): void {
  chrome(s, { bar: 1, beat: 1, tempo: 112, key: 'C maj', active: 'songs' })
  s.group('Header', [
    s.text('Title', 'My Songs', 32, 118, { size: 30, weight: 700, color: C.text, letterSpacing: -0.01 }),
    s.text('Subtitle', `${songs.length} songs  ·  last edited today`, 32, 158, { size: 13, color: C.dim }),
    segmented(s, 'Location', 430, 122, ['Recents', 'Browse', 'Shared'], 0, { h: 40 }).id,
    panelButton(s, 'Sort', 1000, 122, 44, 40, { icon: I.sort, label: '' }),
    panelButton(s, 'Select', 1052, 122, 72, 40, { label: 'Select' }),
    panelButton(s, 'New Song', 1132, 122, 46, 40, { icon: I.plus, label: '', on: true }),
  ])
  const cw = 206
  const gap = (1162 - 32 - cw * 5) / 4
  const cards: NodeId[] = [
    s.group('Card / Create Song', [
      s.rect('Tile', 32, 196, cw, cw, { fill: '#202026', radius: 14, stroke: { color: C.faint, width: 1.5, dash: [8, 6] } }),
      s.circle('Plus Disc', 32 + cw / 2, 196 + cw / 2 - 10, 30, { fill: C.amber, shadow: glow(C.amber, 16, 0.35) }),
      s.icon('Plus', I.plus, 32 + cw / 2 - 14, 196 + cw / 2 - 24, 28, '#1A1A1E', { width: 3 }),
      s.text('Label', 'Create Song', 32 + cw / 2, 196 + cw / 2 + 32, { size: 14, weight: 600, color: C.text, anchor: 'center' }),
      s.text('Title', 'New project', 32, 196 + cw + 12, { size: 14, weight: 600, color: C.dim }),
      s.text('Meta', 'Start from an instrument', 32, 196 + cw + 32, { size: 12, color: C.faint }),
    ]),
  ]
  songs.forEach((song, i) => {
    const k = i + 1
    const x = 32 + (k % 5) * (cw + gap)
    const y = 196 + Math.floor(k / 5) * (cw + 80)
    const parts: NodeId[] = [
      s.rect('Shadow', x, y, cw, cw, { fill: '#000000', radius: 14, shadow: shadow(8, 20, 0.5, 0, '#000000') }),
      s.image('Artwork', song.art, x, y, cw, cw, 14),
      s.rect('Shade', x, y + cw - 64, cw, 64, { fill: linear([['#000000', 0, 0], ['#000000', 1, 0.55]]), radius: [0, 0, 14, 14] }),
      s.icon('Tracks Icon', I.tracks, x + 12, y + cw - 30, 16, '#FFFFFF', { width: 1.8 }),
      s.text('Tracks', `${song.tracks} tracks`, x + 34, y + cw - 30, { size: 12, weight: 600, color: '#FFFFFF' }),
      s.text('Title', song.title, x, y + cw + 12, { size: 14, weight: 600, color: C.text }),
      s.text('Meta', `${song.length}  ·  ${song.date}`, x, y + cw + 32, { size: 12, color: C.dim }),
      s.icon('More', I.more, x + cw - 24, y + cw + 12, 22, C.dim, { width: 3 }),
    ]
    if (i === 0) {
      parts.push(s.group('Badge / Open', [
        s.rect('Background', x + 10, y + 10, 68, 22, { fill: C.amber, radius: 11 }),
        s.centeredText('Label', 'OPEN', { x: x + 10, y: y + 10, w: 68, h: 22 }, { size: 10, weight: 700, color: '#1A1A1E', letterSpacing: 0.12 }),
      ]))
    }
    cards.push(s.group(`Card / ${song.title}`, parts))
  })
  s.group('Songs', cards)
  s.group('Storage', [
    s.rect('Divider', 32, 772, 1130, 1, { fill: '#FFFFFF', opacity: 0.07 }),
    s.icon('Folder', I.folder, 32, 790, 20, C.dim, { width: 1.8 }),
    s.text('On Device', 'On My iPad  ·  1.4 GB of songs', 60, 791, { size: 13, weight: 500, color: C.dim }),
    s.rect('Usage Track', 950, 797, 212, 6, { fill: '#2E2E35', radius: 3 }),
    s.rect('Usage', 950, 797, 74, 6, { fill: C.amber, radius: 3 }),
    s.text('Usage Label', '35% of Riff storage', 938, 791, { size: 12, color: C.faint, anchor: 'right' }),
  ])
}

// ---------------------------------------------------------------------------
// 02 Instrument Browser
// ---------------------------------------------------------------------------

/** An acoustic guitar body, upright, body `b` tall centred on cx, cy. */
function guitarArt(s: Studio, name: string, cx: number, cy: number, b: number, o: { burst?: [string, string, string]; bass?: boolean } = {}): NodeId {
  const p = (x: number, y: number) => `${f(cx + x * b)} ${f(cy + y * b)}`
  const body = o.bass
    ? `M${p(0.1, -0.5)}C${p(0.26, -0.62)} ${p(0.4, -0.52)} ${p(0.34, -0.32)}C${p(0.3, -0.2)} ${p(0.26, -0.1)} ${p(0.3, 0.04)}`
      + `C${p(0.36, 0.2)} ${p(0.44, 0.3)} ${p(0.38, 0.42)}C${p(0.3, 0.54)} ${p(0.12, 0.52)} ${p(0, 0.5)}C${p(-0.14, 0.52)} ${p(-0.34, 0.54)} ${p(-0.4, 0.4)}`
      + `C${p(-0.46, 0.28)} ${p(-0.36, 0.16)} ${p(-0.3, 0.04)}C${p(-0.26, -0.06)} ${p(-0.34, -0.16)} ${p(-0.38, -0.3)}C${p(-0.42, -0.46)} ${p(-0.26, -0.56)} ${p(-0.1, -0.5)}Z`
    : `M${p(0.12, -0.5)}C${p(0.3, -0.5)} ${p(0.36, -0.38)} ${p(0.33, -0.22)}C${p(0.31, -0.12)} ${p(0.26, -0.07)} ${p(0.28, 0.03)}`
      + `C${p(0.3, 0.14)} ${p(0.44, 0.2)} ${p(0.44, 0.34)}C${p(0.44, 0.46)} ${p(0.28, 0.5)} ${p(0, 0.5)}C${p(-0.28, 0.5)} ${p(-0.44, 0.46)} ${p(-0.44, 0.34)}`
      + `C${p(-0.44, 0.2)} ${p(-0.3, 0.14)} ${p(-0.28, 0.03)}C${p(-0.26, -0.07)} ${p(-0.31, -0.12)} ${p(-0.33, -0.22)}C${p(-0.36, -0.38)} ${p(-0.3, -0.5)} ${p(-0.12, -0.5)}Z`
  const burst = o.burst ?? ['#F6C46A', '#C8702A', '#3A1A0A']
  const neckTop = o.bass ? -1.55 : -1.2
  const ids: NodeId[] = [
    s.path('Neck', `M${p(-0.05, -0.45)}L${p(-0.045, neckTop)}L${p(0.045, neckTop)}L${p(0.05, -0.45)}Z`, { fill: linear([['#C98A4A', 0], ['#7A4A22', 1]], 0, 0, 1, 0), closed: true }),
    s.path('Fretboard', `M${p(-0.04, -0.3)}L${p(-0.035, neckTop)}L${p(0.035, neckTop)}L${p(0.04, -0.3)}Z`, { fill: '#2A1A10', closed: true }),
    s.path('Frets', Array.from({ length: 12 }, (_, i) => `M${p(-0.04, neckTop + 0.06 + i * 0.07)}L${p(0.04, neckTop + 0.06 + i * 0.07)}`).join(''), { stroke: '#D9DADF', width: 1, alpha: 0.7 }),
    s.path('Headstock', `M${p(-0.08, neckTop)}L${p(-0.1, neckTop - 0.24)}Q${p(0, neckTop - 0.3)} ${p(0.1, neckTop - 0.24)}L${p(0.08, neckTop)}Z`, { fill: linear([['#3A2014', 0], ['#1A0C06', 1]]), closed: true }),
    s.path('Tuners', Array.from({ length: o.bass ? 4 : 6 }, (_, i) => ring(cx + (i % 2 ? 0.13 : -0.13) * b, cy + (neckTop - 0.05 - Math.floor(i / 2) * 0.07) * b, b * 0.025)).join(''), { fill: '#D9DADF', closed: true }),
    s.path('Body', body, { fill: radialAt([[burst[0], 0], [burst[1], 0.62], [burst[2], 1]], 0.5, 0.58, 0.62), closed: true }),
    s.path('Binding', body, { stroke: '#F4EAD0', width: Math.max(1, b * 0.012), alpha: 0.8 }),
  ]
  if (o.bass) {
    ids.push(
      s.path('Pickguard', `M${p(-0.2, -0.3)}C${p(0.1, -0.36)} ${p(0.28, -0.1)} ${p(0.16, 0.1)}L${p(-0.12, 0.2)}C${p(-0.3, 0.1)} ${p(-0.32, -0.2)} ${p(-0.2, -0.3)}Z`, { fill: '#F4EFE4', closed: true, opacity: 0.9 }),
      s.rect('Pickup', cx - b * 0.1, cy - b * 0.04, b * 0.2, b * 0.07, { fill: '#141414', radius: 3 }),
      s.rect('Bridge', cx - b * 0.08, cy + b * 0.28, b * 0.16, b * 0.05, { fill: linear([['#FFFFFF', 0], ['#8E8F96', 1]]), radius: 2 }),
    )
  } else {
    ids.push(
      s.circle('Sound Hole', cx, cy - b * 0.12, b * 0.12, { fill: '#120A06', stroke: { color: '#2A1A0A', width: b * 0.02 } }),
      s.rect('Bridge', cx - b * 0.14, cy + b * 0.24, b * 0.28, b * 0.05, { fill: '#1A0E08', radius: 3 }),
    )
  }
  ids.push(s.path('Strings', Array.from({ length: o.bass ? 4 : 6 }, (_, i) => {
    const dx = (i - (o.bass ? 1.5 : 2.5)) * 0.014
    return `M${p(dx, neckTop)}L${p(dx * 1.4, o.bass ? 0.3 : 0.26)}`
  }).join(''), { stroke: '#F4F0E6', width: 0.8, alpha: 0.8 }))
  return s.group(`Illustration / ${name}`, ids)
}

function microphone(s: Studio, cx: number, cy: number, k: number): NodeId {
  let mesh = ''
  for (let i = -5; i <= 5; i++) mesh += `M${f(cx - 34 * k)} ${f(cy - 50 * k + i * 9 * k)}h${f(68 * k)}`
  for (let i = -3; i <= 3; i++) mesh += `M${f(cx + i * 9 * k)} ${f(cy - 100 * k)}v${f(100 * k)}`
  return s.group('Illustration / Microphone', [
    s.rect('Stand', cx - 4 * k, cy + 40 * k, 8 * k, 120 * k, { fill: linear([['#FFFFFF', 0], ['#6E7078', 1]], 0, 0, 1, 0) }),
    s.path('Yoke', `M${f(cx - 48 * k)} ${f(cy - 30 * k)}V${f(cy + 10 * k)}A${48 * k} ${48 * k} 0 0 0 ${f(cx + 48 * k)} ${f(cy + 10 * k)}V${f(cy - 30 * k)}`, { stroke: '#9A9BA2', width: 6 * k }),
    s.rect('Body', cx - 36 * k, cy - 20 * k, 72 * k, 70 * k, { fill: linear([['#3A3A40', 0], ['#8E8F96', 0.4], ['#2A2A2E', 1]], 0, 0, 1, 0), radius: [6 * k, 6 * k, 22 * k, 22 * k] }),
    s.rect('Grille', cx - 38 * k, cy - 108 * k, 76 * k, 96 * k, { fill: linear([['#C9CAD0', 0], ['#FFFFFF', 0.35], ['#8E8F96', 1]], 0, 0, 1, 0), radius: 38 * k }),
    s.path('Mesh', mesh, { stroke: '#3A3A40', width: 1, alpha: 0.35 }),
    s.rect('Band', cx - 38 * k, cy - 22 * k, 76 * k, 8 * k, { fill: linear([['#FFD27A', 0], ['#B8862B', 1]]) }),
  ])
}

export function instrumentBrowser(s: Studio): void {
  chrome(s, { bar: 1, beat: 1, tempo: 112, key: 'C maj', active: 'browser' })
  s.rect('Backdrop', 0, 96, 1194, 738, { fill: radialAt([['#2E2A3A', 0], ['#1A1A1E', 0.7]], 0.5, 0.5, 0.7) })
  s.group('Header', [
    segmented(s, 'View', 477, 112, ['Tracks', 'Live Loops'], 0, { w: 118, h: 36 }).id,
    s.text('Title', 'Choose an instrument', 597, 164, { size: 14, weight: 500, color: C.dim, anchor: 'center' }),
    panelButton(s, 'Sound Library', 1010, 112, 168, 36, { icon: I.folder, label: 'Sound Library' }),
  ])

  const card = (name: string, x: number, y: number, w: number, h: number, tint: string, dim: number, art: () => NodeId[], sub: string, options: string[] = [], centre = x + w / 2) => {
    const ids: NodeId[] = [
      s.rect('Card', x, y, w, h, {
        fill: linear([['#34323E', 0], ['#26252E', 0.55], ['#1E1D24', 1]]), radius: 24,
        stroke: { color: '#FFFFFF', width: 1, alpha: 0.08 }, shadow: shadow(18, 40, 0.6, 0, '#000000'),
      }),
      s.rect('Tint', x, y, w, h * 0.6, { fill: radialAt([[tint, 0, 0.35], [tint, 1, 0]], 0.5, 0.45, 0.6), radius: [24, 24, 0, 0] }),
      ...art(),
      s.text('Name', name, centre, y + h - (options.length ? 132 : 84), { size: w > 300 ? 28 : w > 250 ? 20 : 16, weight: 700, color: C.text, anchor: 'center' }),
      s.text('Sub', sub, centre, y + h - (options.length ? 92 : 56), { size: w > 300 ? 14 : 12, color: C.dim, anchor: 'center' }),
    ]
    options.forEach((label, i) => {
      const bw = (w - 64 - 12) / 2
      const bx = x + 32 + i * (bw + 12)
      ids.push(s.group(`Option / ${label}`, [
        s.rect('Background', bx, y + h - 64, bw, 40, { fill: i === 0 ? tint : '#3A3A44', radius: 20, ...(i === 0 ? { shadow: glow(tint, 14, 0.4) } : {}) }),
        s.centeredText('Label', label, { x: bx, y: y + h - 64, w: bw, h: 40 }, { size: 14, weight: 600, color: i === 0 ? '#0E1A2A' : C.text }),
      ]))
    })
    if (dim) ids.push(s.rect('Dim', x, y, w, h, { fill: '#000000', opacity: dim, radius: 24 }))
    return s.group(`Instrument Card / ${name}`, ids)
  }

  card('Audio Recorder', 16, 300, 200, 320, C.vocal, 0.55, () => [microphone(s, 93, 432, 0.7)], 'Any sound', [], 93)
  card('Bass', 978, 300, 200, 320, C.bass, 0.55, () => [guitarArt(s, 'Bass', 1101, 470, 96, { bass: true, burst: ['#FF8A5A', '#B8321E', '#3A0A06'] })], 'Electric, upright', [], 1101)
  card('Drums', 170, 240, 290, 440, C.drums, 0.3, () => [
    cymbal(s, 'Crash', 350, 360, 72),
    drum(s, 'Snare', 290, 420, 64, { lugs: 8 }),
  ], 'Acoustic and electronic', [], 286)
  card('Guitar', 734, 240, 290, 440, C.guitar, 0.3, () => [guitarArt(s, 'Acoustic Guitar', 900, 430, 150)], 'Acoustic and electric', [], 908)
  card('Keyboard', 402, 196, 390, 528, C.keys, 0, () => [
    s.group('Illustration / Keyboard', [
      s.rect('Body', 432, 300, 330, 186, { fill: linear([['#3A3A40', 0], ['#0C0C0E', 0.3], ['#16161A', 1]]), radius: 12, shadow: shadow(14, 24, 0.6, 0, '#000000') }),
      s.text('Plate', 'Concert Grand', 597, 318, { size: 13, weight: 500, family: 'Playfair Display', color: '#D9B56A', anchor: 'center' }),
      s.rect('Felt', 444, 346, 306, 4, { fill: '#8E1B22' }),
      keyboard(s, 444, 350, 306, 124, { whites: 14, octave: 3, pressed: [4, 7, 12], press: C.keys }),
    ]),
  ], 'Pianos, organs and synths', ['Keyboard', 'Smart Piano'])

  const dots: NodeId[] = []
  let px = 597 - (7 * 8 + 22 + 7 * 8) / 2
  for (let i = 0; i < 8; i++) {
    const on = i === 3
    dots.push(s.rect(`Dot ${i + 1}`, px, 752, on ? 22 : 8, 8, { fill: on ? C.text : C.faint, radius: 4 }))
    px += (on ? 22 : 8) + 8
  }
  s.group('Pager', dots)
  s.group('Also', [
    s.text('Prompt', 'Swipe for Strings, Sampler, World and more', 597, 780, { size: 13, color: C.dim, anchor: 'center' }),
  ])
}

// ---------------------------------------------------------------------------
// 19 Sampler
// ---------------------------------------------------------------------------

export function sampler(s: Studio): void {
  chrome(s, { bar: 22, beat: 1, tempo: 94, key: 'F min', active: 'browser' })
  s.rect('Toolbar', 0, 96, 1194, 72, { fill: linear([['#232329', 0], ['#1D1D22', 1]]) })
  s.group('Sample', [
    instrumentTile(s, 'Sampler', I.sampler, 16, 108, 48, C.sampler),
    s.text('Name', 'Vocal Chop — “Hey”', 76, 110, { size: 17, weight: 700, color: C.text }),
    s.text('Meta', '0.84 s  ·  44.1 kHz  ·  Mono  ·  Root C3', 76, 136, { size: 12, color: C.dim }),
  ])
  s.group('Sample Actions', [
    panelButton(s, 'Record Sample', 604, 112, 120, 40, { icon: I.mic, label: 'Record' }),
    panelButton(s, 'Library', 732, 112, 112, 40, { icon: I.folder, label: 'Library' }),
    panelButton(s, 'Reverse', 852, 112, 112, 40, { icon: I.reverse, label: 'Reverse' }),
    panelButton(s, 'Loop', 972, 112, 96, 40, { icon: I.cycle, label: 'Loop', on: true, accent: C.sampler }),
    panelButton(s, 'Zoom', 1076, 112, 102, 40, { icon: I.zoom, label: 'Zoom' }),
  ])

  const X = 16
  const Y = 184
  const EW = 1162
  const EH = 300
  const trimA = X + 128
  const trimB = X + 948
  const loopA = X + 520
  let rulerTicks = ''
  const labels: NodeId[] = []
  for (let i = 0; i <= 42; i++) {
    const x = X + 12 + (i * (EW - 24)) / 42
    rulerTicks += `M${f(x)} ${Y + 30 - (i % 5 === 0 ? 10 : 5)}V${Y + 30}`
    if (i % 5 === 0) labels.push(s.text(`Time ${i}`, `${(i * 0.02).toFixed(1)}s`, x + 3, Y + 8, { size: 9, weight: 500, family: MONO, color: C.faint }))
  }
  const wave = waveform(X + 12, Y + 44, EW - 24, EH - 64, 88, 2, (t) => (t < 0.08 ? t / 0.08 : Math.exp(-(t - 0.08) * 1.6)) * (0.6 + 0.4 * Math.sin(t * 22) ** 2))
  s.group('Waveform Editor', [
    s.fx(s.rect('Screen', X, Y, EW, EH, { fill: linear([['#141418', 0], ['#0E0E11', 1]]), radius: 14, stroke: { color: '#FFFFFF', width: 1, alpha: 0.06 } }), { inner: shadow(1, 8, 0.7, 0, '#000000') }),
    s.path('Ruler', rulerTicks, { stroke: C.faint, width: 1 }),
    s.group('Ruler Labels', labels),
    s.path('Centre Line', `M${X + 12} ${Y + 44 + (EH - 64) / 2}H${X + EW - 12}`, { stroke: '#FFFFFF', width: 1, alpha: 0.08 }),
    s.path('Waveform', wave, { fill: linear([['#FF8FC0', 0], [C.sampler, 0.5], ['#FF8FC0', 1]]), closed: true }),
    s.rect('Trimmed Start', X + 1, Y + 34, trimA - X - 1, EH - 35, { fill: '#000000', opacity: 0.6 }),
    s.rect('Trimmed End', trimB, Y + 34, X + EW - trimB - 1, EH - 35, { fill: '#000000', opacity: 0.6, radius: [0, 0, 13, 0] }),
    s.fx(s.rect('Loop Region', loopA, Y + 34, trimB - loopA, 6, { fill: C.drums, radius: 3 }), { shadow: glow(C.drums, 6, 0.6) }),
    s.text('Loop Label', 'LOOP', loopA + 6, Y + 44, { ...LABEL, size: 9, color: C.drums }),
    s.line('Playhead', X + 404, Y + 34, X + 404, Y + EH - 4, '#FFFFFF', 1.5),
  ])
  const handle = (name: string, x: number, flip: boolean) => s.group(`Trim Handle / ${name}`, [
    s.fx(s.rect('Bar', x - 2, Y + 34, 4, EH - 34, { fill: C.drums }), { shadow: glow(C.drums, 8, 0.7) }),
    s.rect('Grip', flip ? x - 22 : x - 2, Y + EH / 2 - 26, 24, 52, { fill: linear([['#FFE07A', 0], [C.drums, 1]]), radius: flip ? [10, 0, 0, 10] : [0, 10, 10, 0], shadow: shadow(3, 6, 0.5, 0, '#000000') }),
    s.path('Grip Lines', `M${flip ? x - 14 : x + 6} ${Y + EH / 2 - 12}v24M${flip ? x - 8 : x + 12} ${Y + EH / 2 - 12}v24`, { stroke: '#7A5A10', width: 1.5 }),
    s.text('Time', name === 'Start' ? '0.05s' : '0.74s', flip ? x - 28 : x + 28, Y + EH - 26, { size: 11, weight: 600, family: MONO, color: C.drums, anchor: flip ? 'right' : 'left' }),
  ])
  handle('Start', trimA, false)
  handle('End', trimB, true)

  // Envelope and tone.
  s.rect('Control Panel', 0, 500, 1194, 116, { fill: linear([['#1F1F24', 0], ['#1A1A1E', 1]]) })
  const env: Array<[string, number, string]> = [['Attack', 0.12, '4 ms'], ['Decay', 0.4, '220 ms'], ['Sustain', 0.7, '70%'], ['Release', 0.34, '380 ms']]
  s.group('Envelope', env.map(([name, v, value], i) => knob(s, name, 64 + i * 96, 540, 20, v, { color: C.sampler, label: name, value })))
  const ex = 424
  const envPath = `M${ex} 596L${ex + 16} 528L${ex + 60} 548L${ex + 140} 548L${ex + 190} 596`
  s.group('Envelope Shape', [
    s.fx(s.rect('Screen', ex - 8, 516, 206, 88, { fill: '#0E0E11', radius: 8 }), { inner: shadow(1, 4, 0.7, 0, '#000000') }),
    s.path('Fill', `${envPath}Z`, { fill: linear([[C.sampler, 0, 0.35], [C.sampler, 1, 0]]), closed: true }),
    s.fx(s.path('Line', envPath, { stroke: C.sampler, width: 2 }), { shadow: glow(C.sampler, 6, 0.6) }),
  ])
  s.group('Tone', [
    knob(s, 'Tone', 700, 540, 20, 0.62, { color: C.sampler, label: 'Tone', value: '6.2 kHz' }),
    knob(s, 'Pitch', 796, 540, 20, 0.5, { color: C.sampler, label: 'Pitch', value: '0 st' }),
    knob(s, 'Fine', 892, 540, 20, 0.54, { color: C.sampler, label: 'Fine', value: '+4c' }),
  ])
  s.group('Playback', [
    s.label('Caption', 'playback', 972, 516),
    segmented(s, 'Playback Mode', 972, 536, ['One Shot', 'Classic'], 1, { h: 36, accent: C.sampler }).id,
    s.text('Glide', 'Legato glide  ·  60 ms', 972, 584, { size: 11, color: C.faint }),
  ])
  keyboard(s, 0, 616, 1194, 218, { whites: 15, octave: 3, pressed: [0, 7], press: C.sampler, labels: true })
}

// ---------------------------------------------------------------------------
// 20 Audio Recorder
// ---------------------------------------------------------------------------

function vuMeter(s: Studio, x: number, y: number, w: number, h: number, level: number): NodeId {
  const cx = x + w / 2
  const cy = y + h * 0.95
  const r = w * 0.42
  const scale = [-20, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3]
  const angle = (db: number) => -50 + ((db + 20) / 23) * 100
  const nums = () => scale.map((db) => {
    const [lx, ly] = polar(cx, cy, r + 24, angle(db))
    return s.text(`dB ${db}`, db > 0 ? `+${db}` : String(Math.abs(db)), lx, ly - 8, { size: 12, weight: 600, color: db > 0 ? '#C8201A' : '#2A2016', anchor: 'center' })
  })
  let major = ''
  for (const db of scale) {
    const [x0, y0] = polar(cx, cy, r - 2, angle(db))
    const [x1, y1] = polar(cx, cy, r + 12, angle(db))
    major += `M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}`
  }
  const needle = angle(level)
  const [nx, ny] = polar(cx, cy, r + 14, needle)
  return s.group('VU Meter', [
    s.rect('Bezel', x - 14, y - 14, w + 28, h + 28, { fill: linear([['#3A3A40', 0], ['#111114', 1]]), radius: 18, shadow: shadow(10, 24, 0.6, 0, '#000000') }),
    s.fx(s.rect('Face', x, y, w, h, { fill: radialAt([['#FFF6D8', 0], ['#F2E2B0', 0.6], ['#D9C48A', 1]], 0.5, 0.9, 0.9), radius: 8 }), { inner: shadow(3, 12, 0.5, 0, '#000000') }),
    s.path('Scale Arc', arc(cx, cy, r, -50, angle(0)), { stroke: '#2A2016', width: 2 }),
    s.path('Red Zone', arc(cx, cy, r + 4, angle(0), 50), { stroke: '#C8201A', width: 8 }),
    s.path('Major Ticks', major, { stroke: '#2A2016', width: 2 }),
    s.path('Minor Ticks', ticks(cx, cy, r, r + 6, 24, -50, 50), { stroke: '#2A2016', width: 1, alpha: 0.6 }),
    s.group('Numbers', nums()),
    s.text('VU', 'VU', cx, cy - r * 0.46, { size: 30, weight: 700, family: 'Playfair Display', color: '#2A2016', anchor: 'center' }),
    s.fx(s.line('Needle', cx, cy, nx, ny, '#1A1410', 2.5), { shadow: shadow(3, 3, 0.3, 2, '#000000') }),
    s.circle('Pivot Cover', cx, cy + 4, 38, { fill: linear([['#2A2A2E', 0], ['#0C0C0E', 1]]) }),
    s.rect('Glass Glare', x + 8, y + 6, w - 16, h * 0.34, { fill: linear([['#FFFFFF', 0, 0.35], ['#FFFFFF', 1, 0]]), radius: [6, 6, 30, 30] }),
    screw(s, x - 2, y - 2, 4, 20), screw(s, x + w + 2, y - 2, 4, 70), screw(s, x - 2, y + h + 2, 4, 110), screw(s, x + w + 2, y + h + 2, 4, 160),
  ])
}

const EFFECTS: Array<[string, string, string]> = [
  ['Clean', I.mic, '#9AA0AA'], ['Telephone', I.phone, '#4DA3FF'], ['Robot', I.robot, '#3DD6D0'], ['Chipmunk', I.chipmunk, '#FFC83D'],
  ['Monster', I.monster, '#A77BFF'], ['Arena', I.arena, '#FF8A3D'], ['Megaphone', I.megaphone, '#FF5FA2'], ['Cosmic', I.cosmic, '#6FE6FF'],
]

export function audioRecorder(s: Studio): void {
  chrome(s, { bar: 5, beat: 3, tempo: 90, key: 'A min', active: 'browser', recording: true, playing: true })
  s.rect('Room', 0, 96, 1194, 738, { fill: linear([['#1E1E23', 0], ['#17171B', 1]]) })
  vuMeter(s, 44, 130, 520, 260, -2.4)

  s.group('Input', [
    s.rect('Panel', 24, 424, 560, 124, { fill: '#222228', radius: 14, stroke: { color: '#FFFFFF', width: 1, alpha: 0.05 } }),
    s.label('Caption', 'input', 44, 440),
    s.text('Source', 'Built-in Microphone', 44, 460, { size: 15, weight: 600, color: C.text }),
    s.icon('Mic', I.mic, 548, 452, 20, C.dim, { width: 1.8 }),
    s.label('Gain Label', 'level', 44, 500),
    s.fx(s.rect('Gain Track', 104, 504, 380, 8, { fill: '#0E0E11', radius: 4 }), { inner: shadow(1, 2, 0.8, 0, '#000000') }),
    s.rect('Gain Level', 104, 504, 250, 8, { fill: linear([[C.guitar, 0], [C.drums, 0.8], [C.red, 1]], 0, 0, 1, 0), radius: 4 }),
    s.circle('Gain Thumb', 354, 508, 12, { fill: linear([['#FFFFFF', 0], ['#DEDEE4', 1]]), shadow: shadow(2, 4, 0.5, 0, '#000000') }),
    s.text('Gain Value', '−6 dB', 564, 500, { size: 12, weight: 600, family: MONO, color: C.text, anchor: 'right' }),
    s.text('Auto', 'Automatic level', 44, 526, { size: 11, color: C.faint }),
  ])
  s.group('Takes', [
    s.label('Caption', 'takes', 24, 572),
    ...['Verse Vocal · Take 3', 'Verse Vocal · Take 2', 'Room Tone'].map((name, i) => {
      const y = 596 + i * 76
      const on = i === 0
      return s.group(`Take / ${name}`, [
        s.rect('Row', 24, y, 560, 64, { fill: on ? '#2A2A32' : '#202026', radius: 12, stroke: { color: on ? C.red : '#FFFFFF', width: 1, alpha: on ? 0.5 : 0.05 } }),
        s.circle('Play Disc', 58, y + 32, 18, { fill: on ? C.red : '#34343C' }),
        s.icon('Play', on ? I.stop : I.play, 49, y + 23, 18, '#FFFFFF', { fill: '#FFFFFF', width: 1.2 }),
        s.text('Name', name, 88, y + 14, { size: 14, weight: 600, color: C.text }),
        s.text('Meta', ['0:12 · Recording…', '0:24 · Robot', '0:08 · Clean'][i]!, 88, y + 36, { size: 11, color: on ? C.red : C.dim }),
        s.path('Waveform', waveform(290, y + 14, 270, 36, 40 + i, 2), { fill: on ? C.red : C.faint, opacity: on ? 0.9 : 0.6 }),
      ])
    }),
  ])

  // The big record button.
  s.group('Record', [
    s.rect('Panel', 608, 112, 570, 424, { fill: radialAt([['#3A1A1C', 0], ['#222228', 0.7]], 0.5, 0.45, 0.7), radius: 18, stroke: { color: '#FFFFFF', width: 1, alpha: 0.05 } }),
    s.path('Progress Track', ring(893, 290, 118), { stroke: '#FFFFFF', width: 6, alpha: 0.08 }),
    s.fx(s.path('Progress', arc(893, 290, 118, 0, 150), { stroke: C.red, width: 6 }), { shadow: glow(C.red, 10, 0.8) }),
    s.circle('Ring', 893, 290, 104, { fill: linear([['#4A4A52', 0], ['#1A1A1E', 1]]), shadow: shadow(12, 28, 0.7, 0, '#000000') }),
    s.fx(s.circle('Button', 893, 290, 86, { fill: radialAt([['#FF7A70', 0], [C.red, 0.55], ['#A8140C', 1]], 0.42, 0.35, 0.7) }), { shadow: glow(C.red, 30, 0.7) }),
    s.circle('Gloss', 893, 262, 58, { fill: radialAt([['#FFFFFF', 0, 0.35], ['#FFFFFF', 1, 0]]) }),
    s.fx(s.rect('Stop Square', 871, 268, 44, 44, { fill: '#FFFFFF', radius: 8 }), { shadow: shadow(2, 6, 0.3, 0, '#000000') }),
    led(s, 'Recording', 700, 144, C.red, true, 5),
    s.text('State', 'RECORDING', 716, 137, { ...LABEL, size: 11, color: C.red }),
    s.lit('Time', '00:12.4', 893, 432, { size: 34, weight: 500, family: MONO, color: C.text, anchor: 'center' }, 4),
    s.text('Hint', 'Tap to stop  ·  bar 5 of 8', 893, 480, { size: 13, color: C.dim, anchor: 'center' }),
    s.text('Monitor', 'Monitor', 1080, 138, { size: 13, weight: 600, color: C.text, anchor: 'right' }),
    toggle(s, 'Monitor', 1112, 134, true, C.red),
  ])

  s.group('Effects', [
    s.label('Caption', 'effect', 608, 560),
    ...EFFECTS.map(([name, icon, colour], i) => {
      const x = 608 + (i % 4) * 146
      const y = 584 + Math.floor(i / 4) * 120
      const on = name === 'Robot'
      return s.group(`Effect / ${name}`, [
        s.rect('Tile', x, y, 132, 108, {
          fill: on ? linear([[colour, 0, 0.35], [colour, 1, 0.15]]) : linear([['#2C2C33', 0], ['#232328', 1]]),
          radius: 14, stroke: { color: on ? colour : '#FFFFFF', width: on ? 2 : 1, alpha: on ? 1 : 0.05 },
          ...(on ? { shadow: glow(colour, 16, 0.4) } : { shadow: shadow(4, 8, 0.4, 0, '#000000') }),
        }),
        s.circle('Disc', x + 66, y + 42, 26, { fill: linear([[colour, 0], [colour, 1, 0.7]]), shadow: shadow(3, 6, 0.4, 0, '#000000') }),
        s.icon('Icon', icon, x + 52, y + 28, 28, '#FFFFFF', { width: 2 }),
        s.text('Name', name, x + 66, y + 80, { size: 13, weight: 600, color: on ? '#FFFFFF' : C.text, anchor: 'center' }),
      ])
    }),
  ])
}
