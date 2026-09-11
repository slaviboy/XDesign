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
 * Glimpse's own artwork: the sparkle mark and wordmark, the little vector
 * emoji of the comment composer, the photo filters, and the rasteriser that
 * turns the shared scenes into JPEG "photographs" at a chosen quality.
 */

import type { NodeId, TextNode } from '@/document/types'
import type { DesignDocument } from '@/document/types'
import { intrinsicTextSize } from '@/text/TextLayout'
import { solid, type Screen } from '../kit'
import { scene, type SceneKind } from '../art/scenes'
import { brand, C } from './ui'

// ---------------------------------------------------------------------------
// The mark
// ---------------------------------------------------------------------------

/** A four-pointed sparkle — the glint of something seen for a moment. */
export function sparklePath(cx: number, cy: number, r: number, pinch = 0.16): string {
  const k = r * pinch
  return `M${cx} ${cy - r} Q${cx + k} ${cy - k} ${cx + r} ${cy} Q${cx + k} ${cy + k} ${cx} ${cy + r} ` +
    `Q${cx - k} ${cy + k} ${cx - r} ${cy} Q${cx - k} ${cy - k} ${cx} ${cy - r} Z`
}

/** The app icon: a gradient squircle with a large and a small sparkle. */
export function logoMark(s: Screen, x: number, y: number, size: number): NodeId {
  const cx = x + size * 0.46
  const cy = y + size * 0.54
  return s.group('Logo Mark', [
    s.rect('Tile', x, y, size, size, { fill: brand(0, 1, 1, 0), radius: size * 0.28 }),
    s.path('Sparkle', sparklePath(cx, cy, size * 0.3), { fill: C.white, closed: true }),
    s.path('Glint', sparklePath(x + size * 0.73, y + size * 0.27, size * 0.1, 0.2), { fill: solid(C.white, 0.9), closed: true }),
  ])
}

/**
 * The wordmark: "Glimpse" in Playfair Display bold italic, with a gradient
 * glint over the end of the word. Returns its width so a bar can lay out
 * around it.
 */
export function wordmark(
  s: Screen,
  doc: DesignDocument,
  x: number,
  y: number,
  size: number,
  o: { anchor?: 'left' | 'center'; color?: string } = {},
): { id: NodeId; width: number; height: number } {
  const id = s.text('Name', 'Glimpse', x, y, { size, weight: 700, family: 'Playfair Display', color: o.color ?? C.ink, lineHeight: 1.2 })
  const node = doc.nodes[id] as TextNode
  node.textStyle = { ...node.textStyle, fontStyle: 'italic' }
  const measured = intrinsicTextSize(node.text, node.textStyle)
  node.transform.width = measured.width
  node.transform.height = measured.height
  const left = o.anchor === 'center' ? x - measured.width / 2 : x
  node.transform.x = left
  const glint = s.path('Glint', sparklePath(left + measured.width + size * 0.01, y + size * 0.3, size * 0.17), { fill: brand(0, 1, 1, 0), closed: true })
  return { id: s.group('Wordmark', [id, glint]), width: measured.width + size * 0.22, height: measured.height }
}

// ---------------------------------------------------------------------------
// Emoji, drawn — the bundled fonts carry no colour glyphs
// ---------------------------------------------------------------------------

const FACE = '#FFC53D'
const FACE_DARK = '#6B3D12'

function face(s: Screen, cx: number, cy: number, r: number): NodeId {
  return s.circle('Face', cx, cy, r, { fill: FACE })
}

function heartPath(cx: number, cy: number, r: number): string {
  const k = r / 10
  return `M${cx} ${cy + 8 * k}C${cx - 1 * k} ${cy + 7 * k} ${cx - 9 * k} ${cy + 2 * k} ${cx - 9 * k} ${cy - 3 * k}` +
    `C${cx - 9 * k} ${cy - 6.5 * k} ${cx - 6.5 * k} ${cy - 8.5 * k} ${cx - 4.5 * k} ${cy - 8.5 * k}` +
    `C${cx - 2.5 * k} ${cy - 8.5 * k} ${cx - 1 * k} ${cy - 7.3 * k} ${cx} ${cy - 5.6 * k}` +
    `C${cx + 1 * k} ${cy - 7.3 * k} ${cx + 2.5 * k} ${cy - 8.5 * k} ${cx + 4.5 * k} ${cy - 8.5 * k}` +
    `C${cx + 6.5 * k} ${cy - 8.5 * k} ${cx + 9 * k} ${cy - 6.5 * k} ${cx + 9 * k} ${cy - 3 * k}` +
    `C${cx + 9 * k} ${cy + 2 * k} ${cx + 1 * k} ${cy + 7 * k} ${cx} ${cy + 8 * k}Z`
}

export type Emoji = 'heart' | 'heart-eyes' | 'fire' | 'joy' | 'wow' | 'grin' | 'sparkles' | 'party'

/** One emoji, drawn in a size × size box centred on cx, cy. */
export function emoji(s: Screen, kind: Emoji, cx: number, cy: number, size: number): NodeId {
  const r = size / 2
  const k = size / 28
  const ids: NodeId[] = []
  const eyes = (dy = -2.5, rr = 2.1) => [
    s.circle('Left Eye', cx - 4.6 * k, cy + dy * k, rr * k, { fill: FACE_DARK }),
    s.circle('Right Eye', cx + 4.6 * k, cy + dy * k, rr * k, { fill: FACE_DARK }),
  ]
  switch (kind) {
    case 'heart':
      ids.push(s.path('Heart', heartPath(cx, cy + 0.5 * k, r * 1.05), { fill: C.like, closed: true }))
      ids.push(s.path('Shine', `M${cx - 6 * k} ${cy - 3.5 * k}Q${cx - 5.5 * k} ${cy - 6 * k} ${cx - 3 * k} ${cy - 6.2 * k}`, { stroke: '#FFFFFF', width: 1.6 * k, alpha: 0.55 }))
      break
    case 'heart-eyes':
      ids.push(face(s, cx, cy, r))
      ids.push(s.path('Left Eye', heartPath(cx - 5 * k, cy - 3 * k, 4.4 * k), { fill: C.like, closed: true }))
      ids.push(s.path('Right Eye', heartPath(cx + 5 * k, cy - 3 * k, 4.4 * k), { fill: C.like, closed: true }))
      ids.push(s.path('Mouth', `M${cx - 6 * k} ${cy + 3.5 * k}Q${cx} ${cy + 11 * k} ${cx + 6 * k} ${cy + 3.5 * k}Z`, { fill: FACE_DARK, closed: true }))
      break
    case 'fire':
      ids.push(s.path('Flame', `M${cx} ${cy - 13 * k}C${cx + 3 * k} ${cy - 7 * k} ${cx + 10 * k} ${cy - 4 * k} ${cx + 9 * k} ${cy + 4 * k}` +
        `C${cx + 8.5 * k} ${cy + 10 * k} ${cx + 4 * k} ${cy + 13 * k} ${cx} ${cy + 13 * k}C${cx - 5 * k} ${cy + 13 * k} ${cx - 9.5 * k} ${cy + 9.5 * k} ${cx - 9 * k} ${cy + 3 * k}` +
        `C${cx - 8.6 * k} ${cy - 2 * k} ${cx - 5 * k} ${cy - 4 * k} ${cx - 4 * k} ${cy - 8 * k}C${cx - 1.5 * k} ${cy - 6 * k} ${cx - 1 * k} ${cy - 9 * k} ${cx} ${cy - 13 * k}Z`,
      { fill: '#FF6A2B', closed: true }))
      ids.push(s.path('Core', `M${cx} ${cy - 2 * k}C${cx + 2 * k} ${cy + 1 * k} ${cx + 5 * k} ${cy + 3 * k} ${cx + 4.5 * k} ${cy + 7 * k}` +
        `C${cx + 4 * k} ${cy + 10.5 * k} ${cx + 2 * k} ${cy + 12 * k} ${cx} ${cy + 12 * k}C${cx - 2.5 * k} ${cy + 12 * k} ${cx - 4.8 * k} ${cy + 10 * k} ${cx - 4.5 * k} ${cy + 7 * k}` +
        `C${cx - 4.2 * k} ${cy + 4 * k} ${cx - 1.5 * k} ${cy + 2 * k} ${cx} ${cy - 2 * k}Z`, { fill: '#FFC93C', closed: true }))
      break
    case 'joy':
      ids.push(face(s, cx, cy, r))
      ids.push(s.path('Eyes', `M${cx - 7.5 * k} ${cy - 2 * k}Q${cx - 4.5 * k} ${cy - 6.5 * k} ${cx - 1.8 * k} ${cy - 2 * k} M${cx + 1.8 * k} ${cy - 2 * k}Q${cx + 4.5 * k} ${cy - 6.5 * k} ${cx + 7.5 * k} ${cy - 2 * k}`, { stroke: FACE_DARK, width: 1.8 * k }))
      ids.push(s.path('Mouth', `M${cx - 7 * k} ${cy + 2.5 * k}Q${cx} ${cy + 12 * k} ${cx + 7 * k} ${cy + 2.5 * k}Z`, { fill: FACE_DARK, closed: true }))
      ids.push(s.path('Left Tear', `M${cx - 10 * k} ${cy - 1 * k}Q${cx - 14.5 * k} ${cy + 4 * k} ${cx - 12 * k} ${cy + 6 * k}Q${cx - 9 * k} ${cy + 7 * k} ${cx - 10 * k} ${cy - 1 * k}Z`, { fill: '#5CC8FF', closed: true }))
      ids.push(s.path('Right Tear', `M${cx + 10 * k} ${cy - 1 * k}Q${cx + 14.5 * k} ${cy + 4 * k} ${cx + 12 * k} ${cy + 6 * k}Q${cx + 9 * k} ${cy + 7 * k} ${cx + 10 * k} ${cy - 1 * k}Z`, { fill: '#5CC8FF', closed: true }))
      break
    case 'wow':
      ids.push(face(s, cx, cy, r))
      ids.push(...eyes(-3.5, 2.2))
      ids.push(s.circle('Mouth', cx, cy + 5 * k, 3.4 * k, { fill: FACE_DARK }))
      break
    case 'grin':
      ids.push(face(s, cx, cy, r))
      ids.push(...eyes(-3, 2.1))
      ids.push(s.path('Mouth', `M${cx - 7 * k} ${cy + 2.5 * k}Q${cx} ${cy + 11 * k} ${cx + 7 * k} ${cy + 2.5 * k}`, { stroke: FACE_DARK, width: 2 * k }))
      break
    case 'sparkles':
      ids.push(s.path('Large', sparklePath(cx - 2 * k, cy + 2 * k, 10 * k, 0.18), { fill: '#FFC53D', closed: true }))
      ids.push(s.path('Small', sparklePath(cx + 8 * k, cy - 8 * k, 5 * k, 0.2), { fill: '#FFC53D', closed: true }))
      ids.push(s.path('Tiny', sparklePath(cx + 8.5 * k, cy + 8 * k, 3.4 * k, 0.2), { fill: '#FFD76E', closed: true }))
      break
    case 'party':
      ids.push(s.path('Cone', `M${cx - 12 * k} ${cy + 12 * k}L${cx - 5 * k} ${cy - 7 * k}L${cx + 7 * k} ${cy + 5 * k}Z`, { fill: '#F7A928', closed: true }))
      ids.push(s.path('Stripe', `M${cx - 9.5 * k} ${cy + 5 * k}L${cx - 3 * k} ${cy + 10 * k} M${cx - 7 * k} ${cy - 1.5 * k}L${cx + 2 * k} ${cy + 6 * k}`, { stroke: '#E4572E', width: 2 * k }))
      ids.push(s.path('Streamer', `M${cx - 2 * k} ${cy - 6 * k}C${cx} ${cy - 12 * k} ${cx + 5 * k} ${cy - 8 * k} ${cx + 6 * k} ${cy - 13 * k}`, { stroke: '#7B3FF2', width: 1.8 * k }))
      ids.push(s.circle('Confetti 1', cx + 9 * k, cy - 4 * k, 1.8 * k, { fill: '#F2336F' }))
      ids.push(s.circle('Confetti 2', cx + 3 * k, cy - 11 * k, 1.5 * k, { fill: '#2BC46A' }))
      ids.push(s.circle('Confetti 3', cx + 11 * k, cy + 3 * k, 1.5 * k, { fill: '#39A0FF' }))
      ids.push(s.rect('Confetti 4', cx + 8 * k, cy - 11 * k, 3 * k, 1.8 * k, { fill: '#FFC53D', radius: 0.9 * k }))
      break
  }
  return s.group(`Emoji / ${kind}`, ids)
}

// ---------------------------------------------------------------------------
// Photographs
// ---------------------------------------------------------------------------

/** The photo filters, as colour matrices — invented names, invented looks. */
export const FILTERS: Array<{ name: string; matrix: string | null }> = [
  { name: 'Normal', matrix: null },
  { name: 'Amber', matrix: '1.07 0.04 0 0 0.02  0.01 1.01 0 0 0.01  0 0 0.86 0 0  0 0 0 1 0' },
  { name: 'Coast', matrix: '0.95 0 0 0 0  0 1.0 0.02 0 0  0 0.02 1.06 0 0.02  0 0 0 1 0' },
  { name: 'Noir', matrix: '0.36 0.68 0.13 0 -0.08  0.36 0.68 0.13 0 -0.08  0.36 0.68 0.13 0 -0.08  0 0 0 1 0' },
  { name: 'Bloom', matrix: '1.08 0.06 0.06 0 0.05  0 0.94 0.06 0 0.03  0.06 0.04 1.02 0 0.06  0 0 0 1 0' },
  { name: 'Drift', matrix: '0.78 0.12 0.1 0 0.08  0.1 0.8 0.1 0 0.07  0.1 0.12 0.76 0 0.09  0 0 0 1 0' },
]

/** A scene as a standalone SVG, optionally seen through one of the filters. */
export function photoSvg(kind: SceneKind, seed: number, w: number, h: number, matrix: string | null = null): string {
  const body = scene(kind, seed, w, h)
  const filtered = matrix
    ? `<defs><filter id="gf" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">` +
      `<feColorMatrix type="matrix" values="${matrix}"/></filter></defs><g filter="url(#gf)">${body}</g>`
    : body
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${filtered}</svg>`
}

/**
 * Rasterise SVG markup to a JPEG data URL at a chosen quality — the kit's own
 * rasteriser is fixed at 0.9, which is more than a feed of illustrations needs.
 */
export async function jpeg(svg: string, width: number, height: number, quality = 0.84): Promise<string> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, width, height)
    return canvas.toDataURL('image/jpeg', quality)
  } finally {
    URL.revokeObjectURL(url)
  }
}
