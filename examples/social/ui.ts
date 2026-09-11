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
 * Glimpse's shared components: the palette, the signature gradient, avatars
 * with story rings, buttons, the tab bar, and rich text — one text object
 * whose usernames are bold, the way every caption and notification reads.
 */

import {
  DEFAULT_TEXT_STYLE,
  type DesignDocument, type ImageAsset, type ImageNode, type NodeId, type Paint, type ShadowEffect, type TextNode, type TextRun, type TextStyle,
} from '@/document/types'
import { intrinsicTextSize } from '@/text/TextLayout'
import { linear, solid, type Screen, type TextOptions } from '../kit'
import { I } from './icons'

export const W = 390
export const H = 844

export const C = {
  ink: '#111114',
  grey: '#737380',
  faint: '#A5A5B0',
  line: '#EBEBEF',
  surface: '#F1F1F4',
  field: '#F7F7F9',
  white: '#FFFFFF',
  black: '#000000',
  amber: '#FFB23E',
  pink: '#F2336F',
  violet: '#7B3FF2',
  link: '#4A35D6',
  like: '#F0304F',
  online: '#2BC46A',
  darkLine: '#2A2A2E',
}

/** The signature gradient: amber, pink, violet — corner to corner by default. */
export function brand(x1 = 0, y1 = 1, x2 = 1, y2 = 0): Paint {
  return linear([[C.amber, 0], [C.pink, 0.55], [C.violet, 1]], x1, y1, x2, y2)
}

// ---------------------------------------------------------------------------
// The document the helpers reach into, for the few things Screen leaves out
// ---------------------------------------------------------------------------

let current: DesignDocument | null = null

export function useDocument(doc: DesignDocument): void {
  current = doc
}

function doc(): DesignDocument {
  if (!current) throw new Error('useDocument() first.')
  return current
}

/** Tilt a layer about its own centre. */
export function rotate(id: NodeId, degrees: number): NodeId {
  doc().nodes[id]!.transform.rotation = degrees
  return id
}

/** Give a layer a drop shadow — a white icon over a light photo needs one. */
export function lift(id: NodeId, effect: ShadowEffect): NodeId {
  const node = doc().nodes[id]!
  if ('style' in node && node.type !== 'text') node.style.shadow = effect
  return id
}

/** Show only part of a picture: fractions of the whole, 0..1. */
export function crop(id: NodeId, x: number, y: number, w: number, h: number): NodeId {
  const node = doc().nodes[id] as ImageNode
  node.crop = { x, y, width: w, height: h }
  return id
}

/** Fill a box that is not the picture's shape, trimming what overflows. */
export function cover(id: NodeId): NodeId {
  ;(doc().nodes[id] as ImageNode).fit = 'cover'
  return id
}

// ---------------------------------------------------------------------------
// Rich text
// ---------------------------------------------------------------------------

/** A piece of a rich text: plain, or with its own weight and colour. */
export type Seg = string | [string, { weight?: number; color?: string }]

function styleFor(o: TextOptions): TextStyle {
  return {
    ...DEFAULT_TEXT_STYLE,
    fontFamily: o.family ?? 'Inter',
    fontSize: o.size,
    fontWeight: o.weight ?? 400,
    lineHeight: o.lineHeight ?? 1.3,
    letterSpacing: o.letterSpacing ?? 0,
    align: o.align ?? 'left',
    sizing: o.width ? 'auto-height' : 'auto-width',
  }
}

function runsOf(segs: readonly Seg[]): { content: string; runs: TextRun[] } {
  let content = ''
  const runs: TextRun[] = []
  for (const seg of segs) {
    const [text, style] = typeof seg === 'string' ? [seg, undefined] : seg
    if (style) {
      runs.push({
        start: content.length,
        end: content.length + text.length,
        ...(style.weight ? { style: { fontWeight: style.weight } } : {}),
        ...(style.color ? { fill: solid(style.color) } : {}),
      })
    }
    content += text
  }
  return { content, runs }
}

/** How big a rich text comes out. */
export function measureRich(segs: readonly Seg[], o: TextOptions): { width: number; height: number } {
  const { content, runs } = runsOf(segs)
  return intrinsicTextSize(content, styleFor(o), o.width, runs)
}

/** One text object with differently styled stretches — bold usernames, a grey time. */
export function rich(s: Screen, name: string, segs: readonly Seg[], x: number, y: number, o: TextOptions): NodeId {
  const { content, runs } = runsOf(segs)
  const id = s.text(name, content, x, y, o)
  if (!runs.length) return id
  const node = doc().nodes[id] as TextNode
  node.runs = runs
  const size = intrinsicTextSize(content, node.textStyle, o.width, runs)
  node.transform.height = size.height
  if (!o.width) {
    node.transform.width = size.width
    if (o.anchor === 'center') node.transform.x = x - size.width / 2
    if (o.anchor === 'right') node.transform.x = x - size.width
  }
  return id
}

/** Bold, for the usernames inside a rich text. */
export const b = (text: string): Seg => [text, { weight: 600 }]
/** Grey, for the times at the end of a line. */
export const g = (text: string): Seg => [text, { color: C.grey }]

// ---------------------------------------------------------------------------
// Icons and avatars
// ---------------------------------------------------------------------------

/** An icon from the set, thin-stroked in proportion to its size. */
export function icon(
  s: Screen,
  name: string,
  d: string,
  x: number,
  y: number,
  size = 24,
  color: string = C.ink,
  o: { width?: number; fill?: string } = {},
): NodeId {
  return s.icon(name, d, x, y, size, color, { width: o.width ?? size * 0.075, ...(o.fill ? { fill: o.fill } : {}) })
}

export type Ring = 'none' | 'story' | 'seen'

/**
 * A round profile picture. 'story' wraps it in the gradient ring of an unseen
 * story, 'seen' in the thin grey one of a watched story or a highlight; the gap
 * between ring and face is `ground`, the colour of whatever is behind.
 */
export function avatar(
  s: Screen,
  name: string,
  asset: ImageAsset,
  cx: number,
  cy: number,
  r: number,
  ring: Ring = 'none',
  o: { gap?: number; width?: number; ground?: string } = {},
): NodeId {
  const gap = o.gap ?? Math.max(2, Math.round(r * 0.09 * 2) / 2)
  const width = o.width ?? Math.max(2, Math.round(r * 0.08 * 2) / 2)
  const ground = o.ground ?? C.white
  const ids: NodeId[] = []
  if (ring === 'story') {
    ids.push(s.circle('Story Ring', cx, cy, r + gap + width, { fill: brand() }))
    ids.push(s.circle('Gap', cx, cy, r + gap, { fill: ground }))
  } else if (ring === 'seen') {
    ids.push(s.circle('Seen Ring', cx, cy, r + gap + 1, { fill: '#D6D6DD' }))
    ids.push(s.circle('Gap', cx, cy, r + gap, { fill: ground }))
  }
  ids.push(s.image('Photo', asset, cx - r, cy - r, r * 2, r * 2, r))
  return s.group(`Avatar / ${name}`, ids)
}

/** Two faces overlapping, for "liked by" rows and group chats. */
export function avatarPair(
  s: Screen,
  name: string,
  back: ImageAsset,
  front: ImageAsset,
  x: number,
  y: number,
  size: number,
  ground: string = C.white,
): NodeId {
  const r = size * 0.36
  return s.group(`Avatars / ${name}`, [
    s.image('Back', back, x + size - r * 2, y, r * 2, r * 2, r),
    s.circle('Outline', x + r, y + size - r, r + 2, { fill: ground }),
    s.image('Front', front, x, y + size - r * 2, r * 2, r * 2, r),
  ])
}

/** A row of small overlapping faces, left to right. */
export function avatarStack(s: Screen, name: string, faces: readonly ImageAsset[], x: number, cy: number, r: number): NodeId {
  const ids: NodeId[] = []
  faces.forEach((face, i) => {
    const cx = x + r + i * r * 1.3
    ids.push(s.circle(`Outline ${i + 1}`, cx, cy, r + 1.5, { fill: C.white }))
    ids.push(s.image(`Face ${i + 1}`, face, cx - r, cy - r, r * 2, r * 2, r))
  })
  return s.group(`Avatars / ${name}`, ids)
}

/** Where a row of `count` overlapping faces of radius r ends. */
export function stackWidth(count: number, r: number): number {
  return r * 2 + (count - 1) * r * 1.3
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

export type ButtonKind = 'primary' | 'secondary' | 'gradient' | 'outline' | 'ghostLight'

export function button(
  s: Screen,
  label: string,
  x: number,
  y: number,
  w: number,
  h: number,
  kind: ButtonKind,
  o: { size?: number; radius?: number; name?: string } = {},
): NodeId {
  const radius = o.radius ?? 10
  const fills: Record<ButtonKind, Parameters<Screen['rect']>[5]> = {
    primary: { fill: C.ink, radius },
    secondary: { fill: C.surface, radius },
    gradient: { fill: brand(0, 0, 1, 1), radius },
    outline: { fill: solid(C.white, 0), radius, stroke: { color: '#D9D9E0', width: 1 } },
    ghostLight: { fill: solid(C.white, 0), radius, stroke: { color: C.white, width: 1.2, alpha: 0.9 } },
  }
  const light = kind === 'primary' || kind === 'gradient' || kind === 'ghostLight'
  return s.group(o.name ?? `Button / ${label}`, [
    s.rect('Background', x, y, w, h, fills[kind]),
    s.centeredText('Label', label, { x, y, w, h }, { size: o.size ?? 14, weight: 600, color: light ? C.white : C.ink }),
  ])
}

/** The small square beside a profile's buttons, for suggested people. */
export function iconButton(s: Screen, name: string, d: string, x: number, y: number, size: number): NodeId {
  return s.group(name, [
    s.rect('Background', x, y, size, size, { fill: C.surface, radius: 10 }),
    icon(s, 'Icon', d, x + (size - 18) / 2, y + (size - 18) / 2, 18, C.ink),
  ])
}

// ---------------------------------------------------------------------------
// Bars
// ---------------------------------------------------------------------------

export type Tab = 'home' | 'search' | 'reels' | 'profile' | 'none'

/** The five-tab bar: home, search, new post, reels and your own face. */
export function tabBar(s: Screen, active: Tab, me: ImageAsset, dark = false): NodeId {
  const top = H - 83
  const ink = dark ? C.white : C.ink
  const ids: NodeId[] = [
    s.rect('Background', 0, top, W, 83, { fill: dark ? C.black : C.white }),
    s.rect('Divider', 0, top, W, 1, { fill: dark ? C.darkLine : C.line }),
  ]
  const slot = W / 5
  const cx = (i: number) => slot * i + slot / 2
  const iy = top + 12
  const tab = (i: number, label: string, d: string, on: boolean, filled = false) =>
    s.group(`Tab / ${label}`, [
      icon(s, 'Icon', d, cx(i) - 13, iy, 26, ink, {
        width: on ? 2.5 : 1.9,
        ...(on && filled ? { fill: ink } : {}),
      }),
    ])
  ids.push(tab(0, 'Home', I.home, active === 'home', true))
  ids.push(tab(1, 'Search', I.search, active === 'search'))
  ids.push(tab(2, 'New Post', I.add, false))
  ids.push(tab(3, 'Reels', I.reels, active === 'reels'))
  const on = active === 'profile'
  const profile: NodeId[] = []
  if (on) profile.push(s.circle('Active Ring', cx(4), iy + 13, 15, { fill: ink }), s.circle('Gap', cx(4), iy + 13, 13.5, { fill: dark ? C.black : C.white }))
  profile.push(s.image('Photo', me, cx(4) - 12.5, iy + 0.5, 25, 25, 12.5))
  ids.push(s.group('Tab / Profile', profile))
  return s.group('Tab Bar', ids)
}

/** A centred title with a back chevron — the bar every pushed screen has. */
export function navBar(
  s: Screen,
  title: string,
  o: { left?: 'back' | 'close' | 'none'; right?: NodeId[]; dark?: boolean } = {},
): NodeId {
  const colour = o.dark ? C.white : C.ink
  const ids: NodeId[] = []
  const left = o.left ?? 'back'
  if (left === 'back') ids.push(icon(s, 'Back', I.back, 10, 56, 26, colour, { width: 2 }))
  if (left === 'close') ids.push(icon(s, 'Close', I.close, 14, 57, 24, colour, { width: 2 }))
  ids.push(s.text('Title', title, W / 2, 57, { size: 17, weight: 700, color: colour, anchor: 'center' }))
  ids.push(...(o.right ?? []))
  return s.group('Navigation Bar', ids)
}

/** A search field: grey pill, magnifier, placeholder or query. */
export function searchField(
  s: Screen,
  x: number,
  y: number,
  w: number,
  o: { query?: string; placeholder?: string } = {},
): NodeId {
  const h = 38
  const ids = [
    s.rect('Field', x, y, w, h, { fill: C.surface, radius: 12 }),
    icon(s, 'Search Icon', I.search, x + 12, y + 10, 18, o.query ? C.ink : C.grey),
  ]
  if (o.query) {
    ids.push(s.text('Query', o.query, x + 38, y + 10, { size: 15, color: C.ink }))
    ids.push(s.group('Clear', [
      s.circle('Background', x + w - 20, y + h / 2, 8, { fill: '#C4C4CC' }),
      icon(s, 'Icon', I.close, x + w - 25, y + h / 2 - 5, 10, C.white, { width: 1.8 }),
    ]))
  } else {
    ids.push(s.text('Placeholder', o.placeholder ?? 'Search', x + 38, y + 10, { size: 15, color: C.grey }))
  }
  return s.group('Search Field', ids)
}

/** A full-width hairline. */
export function divider(s: Screen, y: number, x = 0, w = W, dark = false): NodeId {
  return s.rect('Divider', x, y, w, 1, { fill: dark ? C.darkLine : C.line })
}

/** An on/off switch. */
export function toggle(s: Screen, x: number, y: number, on: boolean): NodeId {
  return s.group(`Switch / ${on ? 'On' : 'Off'}`, [
    s.rect('Track', x, y, 50, 30, { fill: on ? C.ink : '#E3E3E8', radius: 15 }),
    s.circle('Knob', on ? x + 35 : x + 15, y + 15, 13, { fill: C.white }),
  ])
}
