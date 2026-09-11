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
 * Relay's shared components: navigation, the tab bar, list rows, buttons,
 * badges, the drawn emoji, the logo, the chat header and input bar, and the
 * two on-screen keyboards. Every one comes out as a named group.
 */

import type { ImageAsset, NodeId } from '@/document/types'
import { transformPath } from '@/geometry/PathUtils'
import { linear, shadow, type TextOptions } from '../kit'
import { homeIndicator, statusBar } from '../components'
import { arc, I } from './icons'
import { Board, C, H, W, type ChatTheme } from './theme'

export { homeIndicator, statusBar }

/** Path data from a 24-unit grid, scaled to `size` and moved to x, y. */
export function place(d: string, x: number, y: number, size: number): string {
  const k = size / 24
  return transformPath(d, [k, 0, 0, k, x, y])
}

export function avatar(s: Board, name: string, asset: ImageAsset, x: number, y: number, size: number): NodeId {
  return s.photo(name, asset, x, y, size, size, size / 2)
}

/** A count in a pill — unread messages, missed calls. */
export function badge(s: Board, count: string, cx: number, cy: number, fill: string = C.brand): NodeId {
  const text = { size: 12, weight: 600, color: C.white }
  const w = Math.max(20, s.measure(count, text).width + 12)
  return s.group(`Badge / ${count}`, [
    s.rect('Background', cx - w / 2, cy - 10, w, 20, { fill, radius: 10 }),
    s.centeredText('Count', count, { x: cx - w / 2, y: cy - 10, w, h: 20 }, text),
  ])
}

/** Delivery ticks: one grey for sent, two grey delivered, two blue read. */
export function ticks(s: Board, x: number, y: number, state: 'sent' | 'delivered' | 'read', grey: string, size = 16): NodeId {
  const name = state === 'read' ? 'Ticks / Read' : state === 'delivered' ? 'Ticks / Delivered' : 'Tick / Sent'
  return s.icon(name, state === 'sent' ? I.tick : I.ticks, x, y, size, state === 'read' ? C.read : grey, { width: 1.5 })
}

export function primaryButton(s: Board, label: string, x: number, y: number, w: number, h = 50): NodeId {
  return s.group(`Button / ${label}`, [
    s.rect('Background', x, y, w, h, { fill: C.brand, radius: h / 2, shadow: shadow(6, 16, 0.22, 0, C.brand) }),
    s.centeredText('Label', label, { x, y, w, h }, { size: 16, weight: 600, color: C.white }),
  ])
}

/** A round icon button: tinted background, brand icon. */
export function iconCircle(s: Board, name: string, icon: string, cx: number, cy: number, r: number, o: { fill?: string; color?: string; iconSize?: number; iconFill?: string } = {}): NodeId {
  const size = o.iconSize ?? r * 1.1
  return s.group(name, [
    s.circle('Background', cx, cy, r, { fill: o.fill ?? C.brandTint }),
    s.icon('Icon', icon, cx - size / 2, cy - size / 2, size, o.color ?? C.brandInk, o.iconFill ? { fill: o.iconFill } : {}),
  ])
}

// ---------------------------------------------------------------------------
// Tab-level navigation
// ---------------------------------------------------------------------------

export type Tab = 'Chats' | 'Updates' | 'Calls' | 'Settings'

export const TAB_TOP = H - 83

export function tabBar(s: Board, active: Tab, badges: Partial<Record<Tab, string>> = {}): NodeId {
  const tabs: Array<[Tab, string]> = [['Chats', I.chats], ['Updates', I.updates], ['Calls', I.phone], ['Settings', I.settings]]
  const ids = [
    s.rect('Background', 0, TAB_TOP, W, H - TAB_TOP, { fill: '#F8FAFA' }),
    s.rect('Hairline', 0, TAB_TOP, W, 0.5, { fill: '#D3DADB' }),
  ]
  const slot = W / tabs.length
  tabs.forEach(([label, d], i) => {
    const cx = slot * i + slot / 2
    const on = label === active
    const colour = on ? C.brandInk : '#7D8A8D'
    const parts: NodeId[] = [
      s.icon('Icon', d, cx - 13, TAB_TOP + 7, 26, colour, { width: on ? 2 : 1.8, ...(on && label === 'Chats' ? { fill: C.brandTint } : {}) }),
      s.text('Label', label, cx, TAB_TOP + 36, { size: 10.5, weight: on ? 600 : 500, color: colour, anchor: 'center' }),
    ]
    const count = badges[label]
    if (count === '•') {
      parts.push(s.circle('Dot', cx + 13, TAB_TOP + 9, 5, { fill: C.brand, stroke: { color: '#F8FAFA', width: 2 } }))
    } else if (count) {
      parts.push(badge(s, count, cx + 16, TAB_TOP + 10))
    }
    ids.push(s.group(`Tab / ${label}`, parts))
  })
  ids.push(homeIndicator(s, C.ink))
  return s.group('Tab Bar', ids)
}

/** The top of a tab screen: controls, a large title and the search field. */
export function largeHeader(
  s: Board,
  title: string,
  o: { left?: 'more' | 'edit'; right?: Array<[string, string, boolean?]>; search?: string; searchFill?: string } = {},
): NodeId {
  const ids: NodeId[] = [statusBar(s, C.ink)]
  if (o.left === 'more') {
    ids.push(s.group('Button / More', [
      s.circle('Background', 32, 70, 15, { fill: C.field }),
      s.icon('Icon', I.more, 22, 60, 20, C.ink, { width: 2.6 }),
    ]))
  } else if (o.left === 'edit') {
    ids.push(s.text('Button / Edit', 'Edit', 16, 60, { size: 17, weight: 500, color: C.brandInk }))
  }
  let x = W - 16
  for (const [name, icon, filled] of o.right ?? []) {
    if (filled) {
      ids.push(s.group(`Button / ${name}`, [
        s.circle('Background', x - 15, 70, 15, { fill: C.brand }),
        s.icon('Icon', icon, x - 25, 60, 20, C.white, { width: 2.2 }),
      ]))
      x -= 46
    } else {
      ids.push(s.icon(`Button / ${name}`, icon, x - 26, 57, 26, C.brandInk))
      x -= 44
    }
  }
  ids.push(s.text('Title', title, 16, 92, { size: 32, weight: 700, letterSpacing: -0.01 }))
  if (o.search) ids.push(searchField(s, 16, 140, W - 32, o.search, o.searchFill))
  return s.group('Header', ids)
}

export function searchField(s: Board, x: number, y: number, w: number, placeholder: string, fill: string = C.field): NodeId {
  return s.group('Search Field', [
    s.rect('Field', x, y, w, 38, { fill, radius: 11 }),
    s.icon('Search Icon', I.search, x + 10, y + 9, 20, '#7C8A8D'),
    s.text('Placeholder', placeholder, x + 38, y + 9, { size: 16, color: '#7C8A8D' }),
  ])
}

/** A plain navigation bar: back chevron, centred title, an optional action. */
export function navBar(s: Board, title: string, o: { back?: string; action?: string; top?: number; bg?: string } = {}): NodeId {
  const top = o.top ?? 47
  const ids: NodeId[] = []
  if (o.bg) ids.push(s.rect('Background', 0, 0, W, top + 48, { fill: o.bg }))
  ids.push(statusBar(s, C.ink))
  if (o.back !== undefined) {
    ids.push(s.icon('Back', I.back, 6, top + 12, 24, C.brandInk, { width: 2.2 }))
    if (o.back) ids.push(s.text('Back Label', o.back, 30, top + 13, { size: 17, color: C.brandInk }))
  }
  ids.push(s.text('Title', title, W / 2, top + 13, { size: 17, weight: 600, anchor: 'center' }))
  if (o.action) ids.push(s.text('Action', o.action, W - 16, top + 13, { size: 17, weight: 500, color: C.brandInk, anchor: 'right' }))
  return s.group('Navigation Bar', ids)
}

// ---------------------------------------------------------------------------
// Grouped lists
// ---------------------------------------------------------------------------

export interface Row {
  label: string
  icon?: string
  /** An iOS-settings style coloured tile behind the icon. */
  tile?: string
  /** A plain icon in this colour, no tile. */
  iconColor?: string
  value?: string
  color?: string
  chevron?: boolean
  sub?: string
}

/** A white card of rows with hairlines between them, on the grouped grey. */
export function rowCard(s: Board, name: string, x: number, y: number, w: number, rows: Row[], rowH = 48): { id: NodeId; bottom: number } {
  const ids: NodeId[] = [s.rect('Card', x, y, w, rows.length * rowH, { fill: C.white, radius: 12 })]
  rows.forEach((r, i) => {
    const top = y + i * rowH
    const parts: NodeId[] = []
    let textX = x + 16
    if (r.icon && r.tile) {
      parts.push(s.rect('Tile', x + 14, top + (rowH - 30) / 2, 30, 30, { fill: r.tile, radius: 8 }))
      parts.push(s.icon('Icon', r.icon, x + 18, top + (rowH - 22) / 2, 22, C.white, { width: 1.8 }))
      textX = x + 58
    } else if (r.icon) {
      parts.push(s.icon('Icon', r.icon, x + 16, top + (rowH - 24) / 2, 24, r.iconColor ?? C.ink, { width: 1.8 }))
      textX = x + 56
    }
    const label = { size: 16.5, color: r.color ?? C.ink, weight: r.color ? 500 : 400 }
    if (r.sub) {
      parts.push(s.text('Label', r.label, textX, top + 9, label))
      parts.push(s.text('Detail', r.sub, textX, top + 32, { size: 13, color: C.grey, width: x + w - 40 - textX, lineHeight: 1.35 }))
    } else {
      parts.push(s.text('Label', r.label, textX, top + (rowH - s.measure(r.label, label).height) / 2, label))
    }
    let right = x + w - 14
    if (r.chevron !== false && !r.color) {
      parts.push(s.icon('Chevron', I.chevronRight, right - 16, top + (rowH - 16) / 2, 16, '#B5BFC1', { width: 2.4 }))
      right -= 22
    }
    if (r.value) {
      const vo = { size: 16, color: C.grey }
      parts.push(s.text('Value', r.value, right, top + (rowH - s.measure(r.value, vo).height) / 2, { ...vo, anchor: 'right' }))
    }
    if (i < rows.length - 1) parts.push(s.rect('Hairline', textX, top + rowH - 0.5, x + w - textX, 0.5, { fill: C.line }))
    ids.push(s.group(`Row / ${r.label}`, parts))
  })
  return { id: s.group(name, ids), bottom: y + rows.length * rowH }
}

export function sectionLabel(s: Board, label: string, x: number, y: number): NodeId {
  return s.text(`Section / ${label}`, label.toUpperCase(), x, y, { size: 13, weight: 500, color: C.grey, letterSpacing: 0.03 })
}

/** The filter chips over a list. */
export function chips(s: Board, labels: string[], active: string, x: number, y: number): NodeId {
  const ids: NodeId[] = []
  for (const label of labels) {
    const on = label === active
    const text: TextOptions = { size: 14.5, weight: on ? 600 : 500, color: on ? C.brandInk : '#55666A' }
    const w = s.measure(label, text).width + 28
    ids.push(s.group(`Chip / ${label}`, [
      s.rect('Background', x, y, w, 32, { fill: on ? C.brandTint : C.field, radius: 16 }),
      s.centeredText('Label', label, { x, y, w, h: 32 }, text),
    ]))
    x += w + 8
  }
  return s.group('Filter Chips', ids)
}

/** A segmented control, one segment selected. */
export function segmented(s: Board, labels: string[], active: string, x: number, y: number, w: number, h = 32): NodeId {
  const seg = w / labels.length
  const ids: NodeId[] = [s.rect('Track', x, y, w, h, { fill: '#E6EAEB', radius: 9 })]
  labels.forEach((label, i) => {
    const on = label === active
    const sx = x + i * seg
    const parts: NodeId[] = []
    if (on) parts.push(s.rect('Thumb', sx + 2, y + 2, seg - 4, h - 4, { fill: C.white, radius: 7, shadow: shadow(2, 6, 0.12) }))
    parts.push(s.centeredText('Label', label, { x: sx, y, w: seg, h }, { size: 14, weight: on ? 600 : 500, color: C.ink }))
    ids.push(s.group(`Segment / ${label}`, parts))
  })
  return s.group('Segmented Control', ids)
}

// ---------------------------------------------------------------------------
// The logo
// ---------------------------------------------------------------------------

const MARK_BUBBLE = 'M12 4.6c4.4 0 8 3.1 8 6.9s-3.6 6.9-8 6.9c-1 0-2-.2-2.9-.4l-4.4 1.6 1.2-3.5a6.5 6.5 0 0 1-1.9-4.6c0-3.8 3.6-6.9 8-6.9z'

/** Relay's mark: a speech bubble passing a message along, on a teal tile. */
export function logoMark(s: Board, x: number, y: number, size: number): NodeId {
  const k = size / 24
  return s.group('Logo Mark', [
    s.rect('Tile', x, y, size, size, { fill: linear([['#22CDBD', 0], ['#0A9C90', 1]], 0, 0, 1, 1), radius: size * 0.28, shadow: shadow(size * 0.12, size * 0.3, 0.25, 0, C.brand) }),
    s.path('Bubble', place(MARK_BUBBLE, x, y + k * 0.4, size), { fill: C.white, closed: true }),
    s.path('Relay Arrows', place('M8.8 9l2.6 2.5-2.6 2.5 M12.6 9l2.6 2.5-2.6 2.5', x, y + k * 0.4, size), { stroke: C.brand, width: 1.9 * k }),
  ])
}

// ---------------------------------------------------------------------------
// Emoji, drawn
// ---------------------------------------------------------------------------

export type Emoji = 'heart' | 'joy' | 'love' | 'thumbs' | 'fire' | 'wow' | 'smile'

const FACE_INK = '#6B3A1E'
const HEART = 'M12 20.6s-8.4-5.1-8.4-11A4.7 4.7 0 0 1 12 6.7a4.7 4.7 0 0 1 8.4 2.9c0 5.9-8.4 11-8.4 11z'

/** An emoji, drawn from shapes so it looks the same wherever the file opens. */
export function emoji(s: Board, kind: Emoji, x: number, y: number, size: number): NodeId {
  const k = size / 24
  const at = (d: string) => place(d, x, y, size)
  const face = () => s.circle('Face', x + size / 2, y + size / 2, size * 0.46, { fill: linear([['#FFDD55', 0], ['#FFB42E', 1]]) })
  const ink = (name: string, d: string, w = 1.6) => s.path(name, at(d), { stroke: FACE_INK, width: w * k })
  const fill = (name: string, d: string, colour: string) => s.path(name, at(d), { fill: colour, closed: true })
  let ids: NodeId[]
  switch (kind) {
    case 'heart':
      ids = [fill('Heart', HEART, '#F0344E'), s.path('Shine', at('M7.4 9.2a2.6 2.6 0 0 1 2.2-1.6'), { stroke: C.white, width: 1.5 * k, alpha: 0.6 })]
      break
    case 'joy':
      ids = [
        face(),
        ink('Eyes', 'M6.6 10.4l2.1-1.7 2.1 1.7 M13.2 10.4l2.1-1.7 2.1 1.7'),
        fill('Mouth', 'M6.4 13.2h11.2a5.6 5.6 0 0 1-11.2 0z', FACE_INK),
        fill('Tongue', 'M9.4 17.3a4 4 0 0 1 5.2 0a5.6 5.6 0 0 1-5.2 0z', '#F06A6A'),
        fill('Tears', 'M3.4 11.2c-1.5 1.7-2.1 2.9-2.1 3.8a2.1 2.1 0 0 0 4.2 0c0-.9-.6-2.1-2.1-3.8z M20.6 11.2c-1.5 1.7-2.1 2.9-2.1 3.8a2.1 2.1 0 0 0 4.2 0c0-.9-.6-2.1-2.1-3.8z', '#4FB2F4'),
      ]
      break
    case 'love':
      ids = [
        face(),
        fill('Heart Eyes', `${place(HEART, 4.2, 5.6, 7.4)} ${place(HEART, 12.4, 5.6, 7.4)}`, '#F0344E'),
        fill('Smile', 'M7.2 14.2h9.6a4.8 4.8 0 0 1-9.6 0z', FACE_INK),
      ]
      break
    case 'wow':
      ids = [
        face(),
        s.circle('Eye L', x + 8.8 * k, y + 10 * k, 1.5 * k, { fill: FACE_INK }),
        s.circle('Eye R', x + 15.2 * k, y + 10 * k, 1.5 * k, { fill: FACE_INK }),
        ink('Brows', 'M7 7.2c.8-.8 2-1 3-.6 M17 7.2c-.8-.8-2-1-3-.6', 1.3),
        s.circle('Mouth', x + 12 * k, y + 16 * k, 2.6 * k, { fill: FACE_INK }),
      ]
      break
    case 'smile':
      ids = [
        face(),
        ink('Eyes', 'M6.9 10.8a2 2 0 0 1 3.6 0 M13.5 10.8a2 2 0 0 1 3.6 0'),
        ink('Smile', 'M7.6 14.2a5 5 0 0 0 8.8 0'),
        s.circle('Cheek L', x + 6.2 * k, y + 14 * k, 1.8 * k, { fill: '#FF8A7A', opacity: 0.55 }),
        s.circle('Cheek R', x + 17.8 * k, y + 14 * k, 1.8 * k, { fill: '#FF8A7A', opacity: 0.55 }),
      ]
      break
    case 'thumbs':
      ids = [
        fill('Cuff', 'M3 10.6h4.4v9.8H3z', '#F2A93B'),
        s.path('Hand', at('M7.4 10.6l3.3-6.3c1.6 0 2.6 1.2 2.3 2.7l-.6 3.2h5.4a2 2 0 0 1 2 2.4l-1.3 6.2a2.3 2.3 0 0 1-2.2 1.8H7.4z'), {
          fill: linear([['#FFD84D', 0], ['#FFB42E', 1]]), stroke: '#D4921A', width: 1.1 * k, closed: true,
        }),
      ]
      break
    case 'fire':
      ids = [
        fill('Flame', 'M12 21.6c-4.4 0-7.5-3-7.5-7.2 0-3.6 2.4-5.7 3.6-8.6.4 1.8 1.4 3 2.6 3.6.3-3.6 2.3-5.9 4.8-7.4-.3 2.8.8 4.8 2.4 6.6 1.3 1.5 2.1 3.3 2.1 5.8 0 4.2-3.1 7.2-8 7.2z', '#FF7417'),
        fill('Core', 'M12 21.6c-2.3 0-3.8-1.5-3.8-3.6 0-2 1.4-3.1 2.2-4.8.6 1 1.3 1.6 2 1.8-.2-1.8.4-3.2 1.6-4.3.2 1.6 1 2.7 1.8 3.7.7.9 1 1.8 1 2.9 0 2.4-1.6 4.3-4.8 4.3z', '#FFD23F'),
      ]
      break
  }
  return s.group(`Emoji / ${kind[0]!.toUpperCase()}${kind.slice(1)}`, ids)
}

/** A status ring: one arc per update, brand for new ones, grey once seen. */
export function statusRing(s: Board, cx: number, cy: number, r: number, total: number, seen: number): NodeId {
  const gap = total > 1 ? 14 : 0
  const span = 360 / total
  const ids: NodeId[] = []
  for (let i = 0; i < total; i++) {
    const from = i * span + gap / 2
    const to = (i + 1) * span - gap / 2
    const d = total === 1 ? `${arc(cx, cy, r, 0, 180)} ${arc(cx, cy, r, 180, 359.99)}` : arc(cx, cy, r, from, to)
    ids.push(s.path(`Segment ${i + 1}`, d, { stroke: i < seen ? '#C2CBCD' : C.brand, width: 2.4 }))
  }
  return s.group('Status Ring', ids)
}

// ---------------------------------------------------------------------------
// Chat chrome
// ---------------------------------------------------------------------------

export const CHAT_TOP = 100
export const INPUT_TOP = 770

export function chatHeader(
  s: Board,
  t: ChatTheme,
  o: { title: string; subtitle: string; accentSubtitle?: boolean; backCount?: string; picture: (x: number, y: number) => NodeId; icons?: boolean },
): NodeId {
  const ids: NodeId[] = [
    s.rect('Background', 0, 0, W, CHAT_TOP, { fill: t.header }),
    s.rect('Hairline', 0, CHAT_TOP - 0.5, W, 0.5, { fill: t.headerLine }),
    statusBar(s, t.dark ? '#FFFFFF' : C.ink),
    s.icon('Back', I.back, 4, 61, 24, t.icon, { width: 2.2 }),
  ]
  let x = 28
  if (o.backCount) {
    ids.push(s.text('Unread Elsewhere', o.backCount, 28, 62, { size: 16, weight: 500, color: t.icon }))
    x += s.measure(o.backCount, { size: 16, weight: 500 }).width + 6
  }
  ids.push(o.picture(x + 2, 54))
  const textX = x + 50
  ids.push(s.text('Name', o.title, textX, 55, { size: 16.5, weight: 600, color: t.text }))
  ids.push(s.text('Subtitle', o.subtitle, textX, 77, { size: 12.5, color: o.accentSubtitle ? t.accent : t.sub, width: 200 }))
  if (o.icons !== false) {
    ids.push(s.icon('Video Call', I.video, 296, 60, 27, t.icon, { width: 1.9 }))
    ids.push(s.icon('Audio Call', I.phone, 346, 61, 24, t.icon, { width: 1.9 }))
  }
  return s.group('Chat Header', ids)
}

/** The bar under a chat: attach, the message field, camera and voice. */
export function inputBar(s: Board, t: ChatTheme, top = INPUT_TOP, typed?: string): NodeId {
  const bottom = typed ? top + 54 : H
  const ids: NodeId[] = [
    s.rect('Background', 0, top, W, bottom - top, { fill: t.inputBar }),
    s.rect('Hairline', 0, top, W, 0.5, { fill: t.headerLine }),
    s.icon('Attach', I.plus, 10, top + 14, 28, t.icon, { width: 1.9 }),
  ]
  const fieldW = typed ? 284 : 238
  ids.push(s.rect('Field', 48, top + 9, fieldW, 36, { fill: t.field, radius: 18, stroke: { color: t.fieldLine, width: 1 } }))
  ids.push(s.icon('Sticker', I.sticker, 48 + fieldW - 30, top + 17, 20, t.dark ? t.sub : '#8C999C', { width: 1.7 }))
  if (typed) {
    const text = s.text('Message', typed, 62, top + 18, { size: 15.5, color: t.text })
    const w = s.measure(typed, { size: 15.5 }).width
    ids.push(text, s.rect('Caret', 62 + w + 1.5, top + 17, 2, 21, { fill: C.brand, radius: 1 }))
    ids.push(s.group('Button / Send', [
      s.circle('Background', 360, top + 27, 18, { fill: C.brand }),
      s.icon('Icon', I.send, 350, top + 17, 20, C.white, { width: 2 }),
    ]))
  } else {
    ids.push(s.icon('Camera', I.camera, 298, top + 14, 26, t.icon, { width: 1.8 }))
    ids.push(s.icon('Voice Message', I.mic, 346, top + 14, 26, t.icon, { width: 1.8 }))
    ids.push(homeIndicator(s, t.dark ? '#FFFFFF' : C.ink))
  }
  return s.group('Input Bar', ids)
}

// ---------------------------------------------------------------------------
// Keyboards
// ---------------------------------------------------------------------------

function key(s: Board, label: string, x: number, y: number, w: number, h: number, o: { dark?: boolean; icon?: string; size?: number } = {}): NodeId {
  const parts = [s.rect('Key', x, y, w, h, { fill: o.dark ? C.keyDark : C.white, radius: 6, shadow: shadow(1, 0, 0.28, 0, '#6F767F') })]
  if (o.icon) {
    parts.push(s.icon('Glyph', o.icon, x + (w - 24) / 2, y + (h - 24) / 2, 24, C.ink, { width: 1.7 }))
  } else {
    parts.push(s.centeredText('Label', label, { x, y: y - 1, w, h }, { size: o.size ?? 23, color: C.ink }))
  }
  return s.group(`Key / ${label}`, parts)
}

/** The letter keyboard, with a row of emoji suggestions over the keys. */
export function qwerty(s: Board, top: number, suggestions: Emoji[]): NodeId {
  const ids: NodeId[] = [s.rect('Background', 0, top, W, H - top, { fill: C.keyboard })]
  const slot = (W - 16) / suggestions.length
  ids.push(s.group('Emoji Suggestions', suggestions.map((e, i) => emoji(s, e, 8 + slot * i + (slot - 28) / 2, top + 9, 28))))
  const rowY = (r: number) => top + 50 + r * 53
  const kw = 33
  const rows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']
  const keys: NodeId[] = []
  rows.forEach((row, r) => {
    const total = row.length * kw + (row.length - 1) * 6
    const x0 = (W - total) / 2
    for (const [i, ch] of [...row].entries()) keys.push(key(s, ch, x0 + i * (kw + 6), rowY(r), kw, 42))
  })
  keys.push(key(s, 'Shift', 3, rowY(2), 43, 42, { dark: true, icon: I.shift }))
  keys.push(key(s, 'Delete', W - 46, rowY(2), 43, 42, { dark: true, icon: I.backspace }))
  keys.push(key(s, '123', 3, rowY(3), 43, 42, { dark: true, size: 16 }))
  keys.push(key(s, 'Emoji', 52, rowY(3), 43, 42, { dark: true, icon: I.emoji }))
  keys.push(key(s, 'space', 101, rowY(3), 192, 42, { size: 16 }))
  keys.push(key(s, 'return', 299, rowY(3), 88, 42, { dark: true, size: 16 }))
  ids.push(s.group('Keys', keys))
  ids.push(s.icon('Globe', I.globe, 22, rowY(3) + 56, 26, '#50595F', { width: 1.6 }))
  ids.push(s.icon('Dictation', I.mic, W - 48, rowY(3) + 56, 26, '#50595F', { width: 1.6 }))
  ids.push(homeIndicator(s, C.ink))
  return s.group('Keyboard', ids)
}

export const KEYPAD_TOP = H - 250

/** The phone keypad, digits with their letters. */
export function keypad(s: Board): NodeId {
  const top = KEYPAD_TOP
  const ids: NodeId[] = [s.rect('Background', 0, top, W, H - top, { fill: C.keyboard })]
  const letters = ['', 'ABC', 'DEF', 'GHI', 'JKL', 'MNO', 'PQRS', 'TUV', 'WXYZ']
  const kw = (W - 12 - 12) / 3
  const keys: NodeId[] = []
  for (let i = 0; i < 12; i++) {
    const x = 6 + (i % 3) * (kw + 6)
    const y = top + 7 + Math.floor(i / 3) * 53
    if (i === 9) continue
    if (i === 11) {
      keys.push(s.group('Key / Delete', [s.icon('Glyph', I.backspace, x + (kw - 28) / 2, y + 9, 28, C.ink, { width: 1.7 })]))
      continue
    }
    const digit = i === 10 ? '0' : String(i + 1)
    const sub = i === 10 ? '+' : letters[i]!
    const parts = [
      s.rect('Key', x, y, kw, 46, { fill: C.white, radius: 6, shadow: shadow(1, 0, 0.28, 0, '#6F767F') }),
      s.text('Digit', digit, x + kw / 2, y + (sub ? 2 : 7), { size: 25, color: C.ink, anchor: 'center' }),
    ]
    if (sub) parts.push(s.text('Letters', sub, x + kw / 2, y + 31, { size: 9.5, weight: 600, color: C.ink, letterSpacing: 0.18, anchor: 'center' }))
    keys.push(s.group(`Key / ${digit}`, parts))
  }
  ids.push(s.group('Keys', keys))
  ids.push(homeIndicator(s, C.ink))
  return s.group('Keypad', ids)
}
