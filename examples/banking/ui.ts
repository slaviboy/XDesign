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
 * Nova's components. Each draws into a Screen and returns the named group it
 * made, so the Layers panel reads like a component library: Nav Bar, Tab Bar,
 * Button / …, Transaction Row / …, Card / …, Flag / …, Keypad, Toggle.
 */

import type { ImageAsset, NodeId, Paint } from '@/document/types'
import { linear, solid, type Screen, type TextOptions } from '../kit'
import { C, CARD_SHADOW, CW, DISPLAY, H, M, W, money } from './theme'
import { I } from './icons'

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** Text whose box is centred vertically on `cy`. */
export function textAt(s: Screen, name: string, content: string, x: number, cy: number, o: TextOptions): NodeId {
  return s.text(name, content, x, cy - s.measure(content, o).height / 2, o)
}

/**
 * A figure with its cents set smaller, baseline to baseline: "€8,420" then
 * ".55". `x` is the left edge, the centre or the right edge by `anchor`.
 */
export function bigAmount(
  s: Screen,
  name: string,
  n: number,
  x: number,
  y: number,
  o: { size: number; symbol?: string; color?: string; anchor?: 'left' | 'center' | 'right'; cents?: boolean; sign?: boolean; family?: string },
): NodeId {
  const full = money(n, o.symbol ?? '€', { sign: o.sign })
  const dot = full.lastIndexOf('.')
  const whole = full.slice(0, dot)
  const cents = full.slice(dot)
  const big: TextOptions = { size: o.size, weight: 700, family: o.family ?? DISPLAY, color: o.color ?? C.ink, letterSpacing: -0.02 }
  const smallSize = Math.round(o.size * 0.6)
  const small: TextOptions = { ...big, size: smallSize, letterSpacing: -0.01 }
  const wWhole = s.measure(whole, big).width
  const wCents = o.cents === false ? 0 : s.measure(cents, small).width
  const total = wWhole + wCents
  const left = o.anchor === 'center' ? x - total / 2 : o.anchor === 'right' ? x - total : x
  const ids = [s.text('Whole', whole, left, y, big)]
  if (o.cents !== false) ids.push(s.text('Cents', cents, left + wWhole, y + (o.size - smallSize) * 0.98, small))
  return s.group(name, ids)
}

// ---------------------------------------------------------------------------
// Buttons and bars
// ---------------------------------------------------------------------------

export function roundButton(
  s: Screen,
  name: string,
  icon: string,
  cx: number,
  cy: number,
  o: { r?: number; fill?: string; color?: string; shadow?: boolean; iconSize?: number; stroke?: string } = {},
): NodeId {
  const r = o.r ?? 20
  const size = o.iconSize ?? Math.round(r * 0.95)
  return s.group(name, [
    s.circle('Background', cx, cy, r, {
      fill: o.fill ?? C.white,
      ...(o.shadow ? { shadow: CARD_SHADOW } : {}),
      ...(o.stroke ? { stroke: { color: o.stroke, width: 1 } } : {}),
    }),
    s.icon('Icon', icon, cx - size / 2, cy - size / 2, size, o.color ?? C.ink),
  ])
}

export type ButtonVariant = 'primary' | 'soft' | 'dark' | 'light' | 'outline' | 'white'

export function button(
  s: Screen,
  label: string,
  x: number,
  y: number,
  w: number,
  o: { variant?: ButtonVariant; h?: number; icon?: string; name?: string } = {},
): NodeId {
  const h = o.h ?? 56
  const v = o.variant ?? 'primary'
  const fills: Record<ButtonVariant, [string, string]> = {
    primary: [C.accent, C.white],
    soft: [C.accentSoft, C.accent],
    dark: [C.ink, C.white],
    light: [C.surface, C.ink],
    outline: [C.white, C.ink],
    white: [C.white, C.ink],
  }
  const [bg, fg] = fills[v]
  const text: TextOptions = { size: h >= 52 ? 16 : 14, weight: 600, color: fg }
  const size = s.measure(label, text)
  const iconSize = o.icon ? (h >= 52 ? 20 : 18) : 0
  const gap = o.icon ? (h >= 52 ? 8 : 6) : 0
  const left = x + (w - size.width - iconSize - gap) / 2
  const ids = [
    s.rect('Background', x, y, w, h, {
      fill: bg,
      radius: h / 2,
      ...(v === 'outline' ? { stroke: { color: C.line, width: 1.5 } } : {}),
    }),
  ]
  if (o.icon) ids.push(s.icon('Icon', o.icon, left, y + (h - iconSize) / 2, iconSize, fg))
  ids.push(s.text('Label', label, left + iconSize + gap, y + (h - size.height) / 2, text))
  return s.group(o.name ?? `Button / ${label}`, ids)
}

/**
 * The bar under the status bar: a round back or close button, a centred
 * title, and up to two round buttons on the right.
 */
export function navBar(
  s: Screen,
  title: string,
  o: {
    left?: 'back' | 'close' | 'none'
    right?: Array<[name: string, icon: string]>
    dark?: boolean
    buttonFill?: string
    subtitle?: string
  } = {},
): NodeId {
  const dark = o.dark ?? false
  const fill = o.buttonFill ?? (dark ? C.nightCard : C.white)
  const color = dark ? C.white : C.ink
  const cy = 76
  const ids: NodeId[] = []
  const left = o.left ?? 'back'
  if (left !== 'none') {
    ids.push(roundButton(s, left === 'back' ? 'Back' : 'Close', left === 'back' ? I.back : I.close, M + 20, cy, {
      fill, color, iconSize: 20,
    }))
  }
  if (title) {
    const t: TextOptions = { size: 17, weight: 600, color }
    if (o.subtitle) {
      ids.push(s.text('Title', title, W / 2, cy - 20, { ...t, anchor: 'center' }))
      ids.push(s.text('Subtitle', o.subtitle, W / 2, cy + 1, { size: 12, color: dark ? C.nightGrey : C.grey, anchor: 'center' }))
    } else {
      ids.push(textAt(s, 'Title', title, W / 2, cy, { ...t, anchor: 'center' }))
    }
  }
  ;(o.right ?? []).forEach(([name, icon], i) => {
    ids.push(roundButton(s, name, icon, W - M - 20 - i * 48, cy, { fill, color, iconSize: 20 }))
  })
  return s.group('Nav Bar', ids)
}

/** A large page title, for the screens the tab bar leads to. */
export function pageTitle(s: Screen, title: string, o: { right?: Array<[name: string, icon: string]>; dark?: boolean } = {}): NodeId {
  const ids = [s.text('Title', title, M, 58, { size: 32, weight: 700, family: DISPLAY, color: o.dark ? C.white : C.ink, letterSpacing: -0.02 })]
  ;(o.right ?? []).forEach(([name, icon], i) => {
    ids.push(roundButton(s, name, icon, W - M - 20 - i * 48, 80, { iconSize: 20 }))
  })
  return s.group('Page Title', ids)
}

export type Tab = 'Home' | 'Invest' | 'Payments' | 'Crypto' | 'Hub'

export function tabBar(s: Screen, active: Tab): NodeId {
  const tabs: Array<[Tab, string]> = [['Home', I.home], ['Invest', I.invest], ['Payments', I.payments], ['Crypto', I.crypto], ['Hub', I.hub]]
  const top = H - 84
  const ids = [
    s.rect('Background', 0, top, W, 84, { fill: C.white, shadow: { x: 0, y: -1, blur: 0, color: { r: 13, g: 14, b: 26, a: 0.06 }, visible: true } }),
  ]
  const slot = (W - 16) / tabs.length
  tabs.forEach(([label, d], i) => {
    const cx = 8 + slot * i + slot / 2
    const on = label === active
    const colour = on ? C.accent : C.faint
    ids.push(s.group(`Tab / ${label}`, [
      s.icon('Icon', d, cx - 12, top + 10, 24, colour, { width: on ? 2.2 : 1.9 }),
      s.text('Label', label, cx, top + 38, { size: 11, weight: on ? 600 : 500, color: on ? C.accent : C.grey, anchor: 'center' }),
    ]))
  })
  return s.group('Tab Bar', ids)
}

/** A section heading with an optional link on the right. */
export function sectionTitle(
  s: Screen,
  title: string,
  y: number,
  o: { action?: string; x?: number; w?: number; dark?: boolean; size?: number } = {},
): NodeId {
  const x = o.x ?? M
  const w = o.w ?? CW
  const size = o.size ?? 18
  const ids = [s.text('Title', title, x, y, { size, weight: 700, family: DISPLAY, color: o.dark ? C.white : C.ink, letterSpacing: -0.01 })]
  if (o.action) {
    const h = s.measure(title, { size, family: DISPLAY, weight: 700 }).height
    ids.push(textAt(s, 'Action', o.action, x + w, y + h / 2, { size: 14, weight: 600, color: C.accent, anchor: 'right' }))
  }
  return s.group(`Section / ${title}`, ids)
}

/** A white card with a soft shadow, the surface most content sits on. */
export function panel(
  s: Screen,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  o: { fill?: string; radius?: number; shadow?: boolean; stroke?: string } = {},
): NodeId {
  return s.rect(name, x, y, w, h, {
    fill: o.fill ?? C.white,
    radius: o.radius ?? 20,
    ...(o.shadow === false ? {} : { shadow: CARD_SHADOW }),
    ...(o.stroke ? { stroke: { color: o.stroke, width: 1 } } : {}),
  })
}

export function divider(s: Screen, x: number, y: number, w: number, color: string = C.line): NodeId {
  return s.rect('Divider', x, y, w, 1, { fill: color })
}

// ---------------------------------------------------------------------------
// Badges, avatars and rows
// ---------------------------------------------------------------------------

export type Badge =
  | { kind: 'solid'; icon: string; color: string }
  | { kind: 'soft'; icon: string; color: string; bg: string }
  | { kind: 'avatar'; asset: ImageAsset }
  | { kind: 'mono'; letters: string; color: string; text?: string }

export function avatar(s: Screen, name: string, asset: ImageAsset, cx: number, cy: number, r: number): NodeId {
  return s.image(name, asset, cx - r, cy - r, r * 2, r * 2, r)
}

/** A round merchant logo, category icon, person or monogram. */
export function badge(s: Screen, name: string, b: Badge, cx: number, cy: number, r: number): NodeId {
  const size = Math.round(r * 0.95)
  switch (b.kind) {
    case 'avatar':
      return avatar(s, name, b.asset, cx, cy, r)
    case 'solid':
      return s.group(name, [
        s.circle('Background', cx, cy, r, { fill: b.color }),
        s.icon('Icon', b.icon, cx - size / 2, cy - size / 2, size, C.white),
      ])
    case 'soft':
      return s.group(name, [
        s.circle('Background', cx, cy, r, { fill: b.bg }),
        s.icon('Icon', b.icon, cx - size / 2, cy - size / 2, size, b.color),
      ])
    case 'mono':
      return s.group(name, [
        s.circle('Background', cx, cy, r, { fill: b.color }),
        s.centeredText('Letters', b.letters, { x: cx - r, y: cy - r, w: r * 2, h: r * 2 }, {
          size: Math.round(r * (b.letters.length > 2 ? 0.52 : 0.62)), weight: 700, family: DISPLAY, color: b.text ?? C.white,
        }),
      ])
  }
}

export interface Tx {
  title: string
  subtitle: string
  amount: number
  badge: Badge
  symbol?: string
  /** A second line on the right, under the amount. */
  note?: string
}

/** One line of a transaction list: logo, merchant and time, amount. */
export function txRow(s: Screen, tx: Tx, x: number, y: number, w: number, o: { dark?: boolean; h?: number } = {}): NodeId {
  const h = o.h ?? 64
  const cy = y + h / 2
  const dark = o.dark ?? false
  const income = tx.amount > 0
  const ids = [badge(s, 'Logo', tx.badge, x + 22, cy, 22)]
  const title: TextOptions = { size: 15, weight: 600, color: dark ? C.white : C.ink }
  const sub: TextOptions = { size: 13, color: dark ? C.nightGrey : C.grey }
  ids.push(s.text('Name', tx.title, x + 56, cy - 20, title))
  ids.push(s.text('Detail', tx.subtitle, x + 56, cy + 2, sub))
  const amount = money(tx.amount, tx.symbol ?? '€', { sign: true })
  ids.push(s.text('Amount', amount, x + w, tx.note ? cy - 20 : cy - 10, {
    ...title, color: income ? C.green : dark ? C.white : C.ink, anchor: 'right',
  }))
  if (tx.note) ids.push(s.text('Note', tx.note, x + w, cy + 2, { ...sub, anchor: 'right' }))
  return s.group(`Transaction Row / ${tx.title}`, ids)
}

/** A settings-style row: icon tile, title and detail, and a value, chevron or toggle. */
export function listRow(
  s: Screen,
  o: {
    x: number
    y: number
    w: number
    h?: number
    icon?: string
    iconColor?: string
    iconBg?: string
    title: string
    detail?: string
    value?: string
    valueColor?: string
    chevron?: boolean
    toggle?: boolean
    dark?: boolean
    name?: string
  },
): NodeId {
  const h = o.h ?? 56
  const cy = o.y + h / 2
  const dark = o.dark ?? false
  const ids: NodeId[] = []
  let tx = o.x
  if (o.icon) {
    ids.push(s.group('Icon', [
      s.rect('Tile', o.x, cy - 18, 36, 36, { fill: o.iconBg ?? (dark ? C.nightLine : C.surface), radius: 12 }),
      s.icon('Glyph', o.icon, o.x + 8, cy - 10, 20, o.iconColor ?? (dark ? C.white : C.ink)),
    ]))
    tx = o.x + 52
  }
  const title: TextOptions = { size: 15, weight: 500, color: dark ? C.white : C.ink }
  const right = o.x + o.w - (o.chevron ? 24 : 0)
  if (o.detail) {
    const detail: TextOptions = { size: 12.5, color: dark ? C.nightGrey : C.grey, width: right - tx - (o.toggle ? 64 : 80), lineHeight: 1.35 }
    const th = s.measure(o.title, title).height
    const dh = s.measure(o.detail, detail).height
    const top = cy - (th + 2 + dh) / 2
    ids.push(s.text('Title', o.title, tx, top, title))
    ids.push(s.text('Detail', o.detail, tx, top + th + 2, detail))
  } else {
    ids.push(textAt(s, 'Title', o.title, tx, cy, title))
  }
  if (o.value) ids.push(textAt(s, 'Value', o.value, right, cy, { size: 15, color: o.valueColor ?? (dark ? C.nightGrey : C.grey), anchor: 'right' }))
  if (o.chevron) ids.push(s.icon('Chevron', I.chevronRight, o.x + o.w - 18, cy - 9, 18, dark ? C.nightGrey : C.faint))
  if (o.toggle !== undefined) ids.push(toggle(s, o.x + o.w - 52, cy - 16, o.toggle))
  return s.group(o.name ?? `Row / ${o.title}`, ids)
}

export function toggle(s: Screen, x: number, y: number, on: boolean): NodeId {
  return s.group(on ? 'Toggle / On' : 'Toggle / Off', [
    s.rect('Track', x, y, 52, 32, { fill: on ? C.accent : '#DCDEE6', radius: 16 }),
    s.circle('Knob', on ? x + 36 : x + 16, y + 16, 13, { fill: C.white, shadow: { x: 0, y: 2, blur: 6, color: { r: 13, g: 14, b: 26, a: 0.18 }, visible: true } }),
  ])
}

/** A pill-shaped segmented control. */
export function segmented(
  s: Screen,
  name: string,
  labels: string[],
  active: number,
  x: number,
  y: number,
  w: number,
  o: { h?: number; dark?: boolean; size?: number } = {},
): NodeId {
  const h = o.h ?? 40
  const dark = o.dark ?? false
  const seg = (w - 8) / labels.length
  const ids = [s.rect('Track', x, y, w, h, { fill: dark ? C.nightCard : '#E9EAF0', radius: h / 2 })]
  ids.push(s.rect('Selection', x + 4 + seg * active, y + 4, seg, h - 8, {
    fill: dark ? C.nightLine : C.white, radius: (h - 8) / 2,
    ...(dark ? {} : { shadow: { x: 0, y: 2, blur: 6, color: { r: 13, g: 14, b: 26, a: 0.08 }, visible: true } }),
  }))
  labels.forEach((label, i) => {
    const on = i === active
    ids.push(s.centeredText(`Label / ${label}`, label, { x: x + 4 + seg * i, y, w: seg, h }, {
      size: o.size ?? 13, weight: on ? 600 : 500, color: dark ? (on ? C.white : C.nightGrey) : on ? C.ink : C.grey,
    }))
  })
  return s.group(name, ids)
}

/** A filter chip; returns its width so a row of them can be laid out. */
export function chip(
  s: Screen,
  label: string,
  x: number,
  y: number,
  on: boolean,
  o: { h?: number; icon?: string; dark?: boolean } = {},
): { id: NodeId; width: number } {
  const h = o.h ?? 36
  const text: TextOptions = { size: 13, weight: on ? 600 : 500, color: on ? C.white : o.dark ? C.white : C.ink }
  const iconW = o.icon ? 22 : 0
  const w = s.measure(label, text).width + 32 + iconW
  const ids = [
    s.rect('Background', x, y, w, h, on
      ? { fill: o.dark ? C.accent : C.ink, radius: h / 2 }
      : { fill: o.dark ? C.nightCard : C.white, radius: h / 2, stroke: { color: o.dark ? C.nightLine : C.line, width: 1 } }),
  ]
  if (o.icon) ids.push(s.icon('Icon', o.icon, x + 14, y + (h - 16) / 2, 16, text.color!))
  ids.push(textAt(s, 'Label', label, x + 16 + iconW, y + h / 2, text))
  return { id: s.group(`Chip / ${label}`, ids), width: w }
}

/** A small rounded tag: "Completed", "+2.4%", "Metal". */
export function pill(
  s: Screen,
  name: string,
  label: string,
  x: number,
  y: number,
  o: { fill: Paint | string; color: string; h?: number; size?: number; anchor?: 'left' | 'right' | 'center'; icon?: string; weight?: number },
): { id: NodeId; width: number } {
  const h = o.h ?? 24
  const text: TextOptions = { size: o.size ?? 12, weight: o.weight ?? 600, color: o.color }
  const iconW = o.icon ? 14 : 0
  const w = s.measure(label, text).width + (h >= 28 ? 24 : 18) + iconW
  const left = o.anchor === 'right' ? x - w : o.anchor === 'center' ? x - w / 2 : x
  const pad = h >= 28 ? 12 : 9
  const ids = [s.rect('Background', left, y, w, h, { fill: o.fill, radius: h / 2 })]
  if (o.icon) ids.push(s.icon('Icon', o.icon, left + pad - 1, y + (h - 12) / 2, 12, o.color, { width: 1.8 }))
  ids.push(textAt(s, 'Label', label, left + pad + iconW, y + h / 2, text))
  return { id: s.group(name, ids), width: w }
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export function progressBar(
  s: Screen,
  name: string,
  x: number,
  y: number,
  w: number,
  pct: number,
  color: string,
  o: { h?: number; track?: string } = {},
): NodeId {
  const h = o.h ?? 6
  const p = Math.max(0, Math.min(1, pct))
  return s.group(name, [
    s.rect('Track', x, y, w, h, { fill: o.track ?? C.line, radius: h / 2 }),
    s.rect('Fill', x, y, Math.max(h, w * p), h, { fill: color, radius: h / 2 }),
  ])
}

/** An arc from 12 o'clock, clockwise, for `pct` of a turn. */
export function arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
  const a0 = from * Math.PI * 2 - Math.PI / 2
  const a1 = to * Math.PI * 2 - Math.PI / 2
  const large = to - from > 0.5 ? 1 : 0
  const x0 = cx + Math.cos(a0) * r
  const y0 = cy + Math.sin(a0) * r
  const x1 = cx + Math.cos(a1) * r
  const y1 = cy + Math.sin(a1) * r
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

/** A ring-shaped slice from `from` to `to` (fractions of a turn), filled. */
export function donutSlice(cx: number, cy: number, r0: number, r1: number, from: number, to: number): string {
  const a0 = from * Math.PI * 2 - Math.PI / 2
  const a1 = to * Math.PI * 2 - Math.PI / 2
  const large = to - from > 0.5 ? 1 : 0
  const p = (a: number, r: number) => `${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`
  return `M${p(a0, r1)} A${r1} ${r1} 0 ${large} 1 ${p(a1, r1)} L${p(a1, r0)} A${r0} ${r0} 0 ${large} 0 ${p(a0, r0)} Z`
}

export function progressRing(
  s: Screen,
  name: string,
  cx: number,
  cy: number,
  r: number,
  pct: number,
  color: string,
  o: { width?: number; track?: string; label?: boolean; labelColor?: string } = {},
): NodeId {
  const w = o.width ?? 6
  const ids = [
    s.circle('Track', cx, cy, r + w / 2, { fill: solid(C.white, 0), stroke: { color: o.track ?? C.line, width: w } }),
    s.path('Progress', arcPath(cx, cy, r, 0, Math.min(pct, 0.999)), { stroke: color, width: w }),
  ]
  if (o.label !== false) {
    ids.push(s.centeredText('Percent', `${Math.round(pct * 100)}%`, { x: cx - r, y: cy - r, w: r * 2, h: r * 2 }, {
      size: Math.round(r * 0.5), weight: 700, family: DISPLAY, color: o.labelColor ?? C.ink,
    }))
  }
  return s.group(name, ids)
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

export type Pt = [number, number]

/** A smooth curve through the points (Catmull–Rom as cubic Béziers). */
export function smooth(points: Pt[], tension = 0.18): string {
  if (points.length < 2) return ''
  let d = `M${points[0]![0].toFixed(2)} ${points[0]![1].toFixed(2)}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!
    const p1 = points[i]!
    const p2 = points[i + 1]!
    const p3 = points[Math.min(points.length - 1, i + 2)]!
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) * tension, p1[1] + (p2[1] - p0[1]) * tension]
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) * tension, p2[1] - (p3[1] - p1[1]) * tension]
    d += ` C${c1[0].toFixed(2)} ${c1[1].toFixed(2)} ${c2[0].toFixed(2)} ${c2[1].toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`
  }
  return d
}

/**
 * Map a series onto a box: the first value at the left edge, the last at the
 * right, lo..hi from the bottom to the top.
 */
export function plot(values: number[], x: number, y: number, w: number, h: number, lo?: number, hi?: number): Pt[] {
  const min = lo ?? Math.min(...values)
  const max = hi ?? Math.max(...values)
  return values.map((v, i) => [x + (w * i) / (values.length - 1), y + h - ((v - min) / (max - min || 1)) * h])
}

/** A seeded random walk from `start` to `end` in `n` steps. */
export function walk(rand: () => number, n: number, start: number, end: number, vol: number): number[] {
  const raw = [0]
  for (let i = 1; i < n; i++) raw.push(raw[i - 1]! + (rand() - 0.5) * vol)
  const drift = raw[n - 1]!
  return raw.map((v, i) => start + (end - start) * (i / (n - 1)) + v - drift * (i / (n - 1)))
}

/** A line with a gradient area under it, down to `floor`. */
export function areaChart(
  s: Screen,
  name: string,
  pts: Pt[],
  floor: number,
  color: string,
  o: { width?: number; alpha?: number } = {},
): NodeId {
  const line = smooth(pts)
  const last = pts[pts.length - 1]!
  const first = pts[0]!
  const area = `${line} L${last[0]} ${floor} L${first[0]} ${floor} Z`
  return s.group(name, [
    s.path('Area', area, { fill: linear([[color, 0, o.alpha ?? 0.22], [color, 1, 0]]), closed: true }),
    s.path('Line', line, { stroke: color, width: o.width ?? 2.5 }),
  ])
}

// ---------------------------------------------------------------------------
// Keypad
// ---------------------------------------------------------------------------

const LETTERS: Record<string, string> = {
  '2': 'ABC', '3': 'DEF', '4': 'GHI', '5': 'JKL', '6': 'MNO', '7': 'PQRS', '8': 'TUV', '9': 'WXYZ',
}

/**
 * A number pad. 'plain' is the in-app pad — digits on the screen itself;
 * 'tiles' is the system pad, keys as white tiles with their letters on a grey
 * tray.
 */
export function keypad(
  s: Screen,
  top: number,
  o: { style?: 'plain' | 'tiles'; left?: 'dot' | 'face' | 'none'; rowH?: number; x?: number; w?: number; trayTop?: number } = {},
): NodeId {
  const style = o.style ?? 'plain'
  const rowH = o.rowH ?? 56
  const x0 = o.x ?? (style === 'tiles' ? 6 : M)
  const w = o.w ?? (style === 'tiles' ? W - 12 : CW)
  const gap = style === 'tiles' ? 6 : 0
  const colW = (w - gap * 2) / 3
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', o.left ?? 'none', '0', 'del']
  const ids: NodeId[] = []
  if (style === 'tiles') ids.push(s.rect('Tray', 0, o.trayTop ?? top - 8, W, H - (o.trayTop ?? top - 8), { fill: '#D5D8E0' }))
  keys.forEach((k, i) => {
    const col = i % 3
    const row = Math.floor(i / 3)
    const x = x0 + col * (colW + gap)
    const y = top + row * (rowH + (style === 'tiles' ? 7 : 0))
    const box = { x, y, w: colW, h: rowH }
    const parts: NodeId[] = []
    if (k === 'none') return
    if (k === 'del') {
      parts.push(s.icon('Icon', I.backspace, x + colW / 2 - 13, y + rowH / 2 - 13, 26, C.ink, { width: 1.8 }))
      ids.push(s.group('Key / Delete', parts))
      return
    }
    if (k === 'face') {
      parts.push(s.icon('Icon', I.faceId, x + colW / 2 - 14, y + rowH / 2 - 14, 28, C.ink, { width: 1.8 }))
      ids.push(s.group('Key / Face Unlock', parts))
      return
    }
    if (style === 'tiles') {
      parts.push(s.rect('Background', x, y, colW, rowH, { fill: C.white, radius: 8, shadow: { x: 0, y: 1, blur: 0, color: { r: 0, g: 0, b: 0, a: 0.28 }, visible: true } }))
      const digit: TextOptions = { size: 25, weight: 400, color: C.ink }
      const letters = LETTERS[k]
      if (letters) {
        const dh = s.measure(k, digit).height
        const top2 = y + (rowH - dh - 12) / 2
        parts.push(s.text('Digit', k, x + colW / 2, top2, { ...digit, anchor: 'center' }))
        parts.push(s.text('Letters', letters, x + colW / 2, top2 + dh - 6, { size: 10, weight: 600, color: C.ink, letterSpacing: 0.16, anchor: 'center' }))
      } else {
        parts.push(s.centeredText('Digit', k, box, digit))
      }
    } else {
      parts.push(s.centeredText('Digit', k === 'dot' ? '.' : k, box, { size: 28, weight: 500, family: DISPLAY, color: C.ink }))
    }
    ids.push(s.group(`Key / ${k === 'dot' ? 'Decimal' : k}`, parts))
  })
  return s.group('Keypad', ids)
}

// ---------------------------------------------------------------------------
// Flags, drawn from shapes on a circle
// ---------------------------------------------------------------------------

export type FlagCode = 'EU' | 'US' | 'GB' | 'PT' | 'ES' | 'FR' | 'DE' | 'IT' | 'NL' | 'IE' | 'CH' | 'JP'

/** A horizontal band of the circle between y1 and y2. */
function hBand(cx: number, cy: number, r: number, y1: number, y2: number): string {
  const a = Math.max(y1, cy - r)
  const b = Math.min(y2, cy + r)
  const w1 = Math.sqrt(Math.max(0, r * r - (a - cy) ** 2))
  const w2 = Math.sqrt(Math.max(0, r * r - (b - cy) ** 2))
  const f = (n: number) => n.toFixed(2)
  return `M${f(cx - w1)} ${f(a)} L${f(cx + w1)} ${f(a)} A${r} ${r} 0 0 1 ${f(cx + w2)} ${f(b)} L${f(cx - w2)} ${f(b)} A${r} ${r} 0 0 1 ${f(cx - w1)} ${f(a)} Z`
}

/** A vertical band of the circle between x1 and x2. */
function vBand(cx: number, cy: number, r: number, x1: number, x2: number): string {
  const a = Math.max(x1, cx - r)
  const b = Math.min(x2, cx + r)
  const h1 = Math.sqrt(Math.max(0, r * r - (a - cx) ** 2))
  const h2 = Math.sqrt(Math.max(0, r * r - (b - cx) ** 2))
  const f = (n: number) => n.toFixed(2)
  return `M${f(a)} ${f(cy - h1)} A${r} ${r} 0 0 1 ${f(b)} ${f(cy - h2)} L${f(b)} ${f(cy + h2)} A${r} ${r} 0 0 1 ${f(a)} ${f(cy + h1)} Z`
}

export function flag(s: Screen, code: FlagCode, cx: number, cy: number, r: number): NodeId {
  const ids: NodeId[] = []
  const bandsH = (colors: string[]) => colors.forEach((c, i) => {
    const h = (r * 2) / colors.length
    ids.push(s.path(`Band ${i + 1}`, hBand(cx, cy, r, cy - r + h * i, cy - r + h * (i + 1)), { fill: c, closed: true }))
  })
  const bandsV = (colors: string[], widths?: number[]) => {
    const ws = widths ?? colors.map(() => 1 / colors.length)
    let x = cx - r
    colors.forEach((c, i) => {
      const w = ws[i]! * r * 2
      ids.push(s.path(`Band ${i + 1}`, vBand(cx, cy, r, x, x + w), { fill: c, closed: true }))
      x += w
    })
  }
  switch (code) {
    case 'EU': {
      ids.push(s.circle('Field', cx, cy, r, { fill: '#1F3FA6' }))
      const size = r * 0.3
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2
        ids.push(s.star(`Star ${i + 1}`, cx + Math.cos(a) * r * 0.6 - size / 2, cy + Math.sin(a) * r * 0.6 - size / 2, size, '#FFCC00'))
      }
      break
    }
    case 'US': {
      const colors = ['#C8102E', '#FFFFFF', '#C8102E', '#FFFFFF', '#C8102E', '#FFFFFF', '#C8102E']
      bandsH(colors)
      ids.push(s.path('Canton', `M${cx + r * 0.05} ${cy + r * 0.05} L${cx - r} ${cy + r * 0.05} A${r} ${r} 0 0 1 ${cx + r * 0.05} ${cy - r} Z`, { fill: '#1B2F6B', closed: true }))
      for (const [dx, dy] of [[-0.55, -0.25], [-0.25, -0.25], [-0.4, -0.5], [-0.1, -0.5], [-0.25, -0.75], [-0.1, -0.1]] as const) {
        ids.push(s.circle('Star', cx + dx * r, cy + dy * r, r * 0.06, { fill: C.white }))
      }
      break
    }
    case 'GB': {
      ids.push(s.circle('Field', cx, cy, r, { fill: '#1B2F6B' }))
      const d = r * 0.7071 - 0.6
      ids.push(s.line('Saltire', cx - d, cy - d, cx + d, cy + d, C.white, r * 0.36))
      ids.push(s.line('Saltire', cx - d, cy + d, cx + d, cy - d, C.white, r * 0.36))
      ids.push(s.line('Saltire Red', cx - d, cy - d, cx + d, cy + d, '#C8102E', r * 0.12))
      ids.push(s.line('Saltire Red', cx - d, cy + d, cx + d, cy - d, '#C8102E', r * 0.12))
      ids.push(s.path('Cross', hBand(cx, cy, r, cy - r * 0.26, cy + r * 0.26), { fill: C.white, closed: true }))
      ids.push(s.path('Cross', vBand(cx, cy, r, cx - r * 0.26, cx + r * 0.26), { fill: C.white, closed: true }))
      ids.push(s.path('Cross Red', hBand(cx, cy, r, cy - r * 0.15, cy + r * 0.15), { fill: '#C8102E', closed: true }))
      ids.push(s.path('Cross Red', vBand(cx, cy, r, cx - r * 0.15, cx + r * 0.15), { fill: '#C8102E', closed: true }))
      break
    }
    case 'PT':
      bandsV(['#046A38', '#DA291C'], [0.42, 0.58])
      ids.push(s.circle('Sphere', cx - r * 0.16, cy, r * 0.34, { fill: '#FFE000' }))
      ids.push(s.circle('Shield', cx - r * 0.16, cy, r * 0.18, { fill: '#DA291C', stroke: { color: C.white, width: Math.max(1, r * 0.06) } }))
      break
    case 'ES':
      bandsH(['#C60B1E', '#FFC400', '#FFC400', '#C60B1E'])
      break
    case 'FR':
      bandsV(['#0055A4', '#FFFFFF', '#EF4135'])
      break
    case 'DE':
      bandsH(['#1A1A1A', '#DD0000', '#FFCE00'])
      break
    case 'IT':
      bandsV(['#009246', '#FFFFFF', '#CE2B37'])
      break
    case 'NL':
      bandsH(['#AE1C28', '#FFFFFF', '#21468B'])
      break
    case 'IE':
      bandsV(['#169B62', '#FFFFFF', '#FF883E'])
      break
    case 'CH':
      ids.push(s.circle('Field', cx, cy, r, { fill: '#DA291C' }))
      ids.push(s.rect('Cross', cx - r * 0.15, cy - r * 0.5, r * 0.3, r, { fill: C.white }))
      ids.push(s.rect('Cross', cx - r * 0.5, cy - r * 0.15, r, r * 0.3, { fill: C.white }))
      break
    case 'JP':
      ids.push(s.circle('Field', cx, cy, r, { fill: C.white }))
      ids.push(s.circle('Sun', cx, cy, r * 0.42, { fill: '#BC002D' }))
      break
  }
  ids.push(s.circle('Rim', cx, cy, r, { fill: solid(C.white, 0), stroke: { color: '#0D0E1A', width: 1, alpha: 0.08 } }))
  return s.group(`Flag / ${code}`, ids)
}

// ---------------------------------------------------------------------------
// Payment cards
// ---------------------------------------------------------------------------

export type CardKind = 'metal' | 'indigo' | 'virtual' | 'disposable'

const CARD_ART: Record<CardKind, { stops: [string, string]; label: string; ink: string; sheen: number }> = {
  metal: { stops: ['#3A3C4B', '#0F1019'], label: 'METAL', ink: '#FFFFFF', sheen: 0.07 },
  indigo: { stops: ['#5B74FF', '#2A2FCF'], label: 'STANDARD', ink: '#FFFFFF', sheen: 0.09 },
  virtual: { stops: ['#34D3E6', '#3D5AFE'], label: 'VIRTUAL', ink: '#FFFFFF', sheen: 0.1 },
  disposable: { stops: ['#FFA24C', '#F43F7A'], label: 'DISPOSABLE', ink: '#FFFFFF', sheen: 0.1 },
}

/** The Nova logo: a four-point star in a disc, and the word. */
export function logo(
  s: Screen,
  x: number,
  y: number,
  o: { size?: number; color?: string; mark?: boolean; markFill?: string; starColor?: string } = {},
): NodeId {
  const size = o.size ?? 22
  const color = o.color ?? C.ink
  const ids: NodeId[] = []
  let tx = x
  if (o.mark !== false) {
    const r = size * 0.72
    ids.push(s.circle('Mark', x + r, y + size * 0.65, r, { fill: o.markFill ?? linear([['#6D83FF', 0], [C.accentDeep, 1]], 0, 0, 1, 1) }))
    ids.push(s.path('Star', sparkle(x + r, y + size * 0.65, r * 0.62), { fill: o.starColor ?? C.white, closed: true }))
    tx = x + r * 2 + size * 0.3
  }
  ids.push(s.text('Wordmark', 'nova', tx, y, { size, weight: 700, family: DISPLAY, color, letterSpacing: -0.03 }))
  return s.group('Logo', ids)
}

/** A four-point star, Nova's mark, as a closed path. */
export function sparkle(cx: number, cy: number, r: number): string {
  const k = r * 0.16
  const f = (n: number) => n.toFixed(2)
  return `M${f(cx)} ${f(cy - r)} C${f(cx + k)} ${f(cy - k)} ${f(cx + k)} ${f(cy - k)} ${f(cx + r)} ${f(cy)} ` +
    `C${f(cx + k)} ${f(cy + k)} ${f(cx + k)} ${f(cy + k)} ${f(cx)} ${f(cy + r)} ` +
    `C${f(cx - k)} ${f(cy + k)} ${f(cx - k)} ${f(cy + k)} ${f(cx - r)} ${f(cy)} ` +
    `C${f(cx - k)} ${f(cy - k)} ${f(cx - k)} ${f(cy - k)} ${f(cx)} ${f(cy - r)} Z`
}

/**
 * The card network's mark — Orbit, a fictional network: a ring with a moon on
 * it.
 */
function networkMark(s: Screen, cx: number, cy: number, r: number, color: string): NodeId {
  return s.group('Network / Orbit', [
    s.circle('Ring', cx, cy, r, { fill: solid(color, 0), stroke: { color, width: Math.max(1.5, r * 0.22), alpha: 0.9 } }),
    s.circle('Moon', cx + r * 0.72, cy - r * 0.72, r * 0.36, { fill: color }),
    s.circle('Core', cx, cy, r * 0.3, { fill: color, opacity: 0.9 }),
  ])
}

/**
 * A payment card face at width `w` (the height follows the ISO ratio).
 * Physical cards get a chip; every card gets the wordmark, the kind, the
 * masked number and the network mark. Nothing reaches past the rounded
 * corners, so the card needs no mask.
 */
export function cardFace(
  s: Screen,
  kind: CardKind,
  x: number,
  y: number,
  w: number,
  o: { last4: string; holder?: string; expiry?: string; full?: boolean; chip?: boolean; name?: string; frozen?: boolean } = { last4: '0000' },
): NodeId {
  const art = CARD_ART[kind]
  const h = Math.round(w / 1.586)
  const k = w / 342
  const r = Math.round(20 * k)
  const ink = art.ink
  const ids: NodeId[] = [
    s.rect('Face', x, y, w, h, {
      fill: linear([[art.stops[0], 0], [art.stops[1], 1]], 0, 0, 1, 1),
      radius: r,
      shadow: { x: 0, y: 12 * k, blur: 28 * k, color: { r: 13, g: 14, b: 26, a: 0.22 }, visible: true },
    }),
  ]
  // Two diagonal sheens, from the top edge to the bottom edge, clear of the corners.
  const band = (t0: number, t1: number, b0: number, b1: number, a: number, n: string) =>
    ids.push(s.path(n, `M${x + w * t0} ${y} L${x + w * t1} ${y} L${x + w * b1} ${y + h} L${x + w * b0} ${y + h} Z`, {
      fill: solid(C.white, a), closed: true,
    }))
  band(0.52, 0.7, 0.3, 0.48, art.sheen, 'Sheen')
  band(0.74, 0.8, 0.52, 0.58, art.sheen * 0.7, 'Sheen Thin')
  ids.push(logo(s, x + 20 * k, y + 16 * k, { size: 20 * k, color: ink, mark: false }))
  ids.push(s.text('Kind', art.label, x + w - 20 * k, y + 22 * k, { size: 10 * k, weight: 600, color: ink, opacity: 0.75, letterSpacing: 0.14, anchor: 'right' }))
  if (o.chip ?? (kind === 'metal' || kind === 'indigo')) {
    const cx = x + 22 * k
    const cy = y + h * 0.4
    ids.push(s.group('Chip', [
      s.rect('Plate', cx, cy, 40 * k, 30 * k, { fill: linear([['#F3D58B', 0], ['#C69A3E', 1]], 0, 0, 1, 1), radius: 6 * k }),
      s.line('Contact', cx + 13 * k, cy, cx + 13 * k, cy + 30 * k, '#9C7424', 1, 0.6),
      s.line('Contact', cx + 27 * k, cy, cx + 27 * k, cy + 30 * k, '#9C7424', 1, 0.6),
      s.line('Contact', cx, cy + 15 * k, cx + 13 * k, cy + 15 * k, '#9C7424', 1, 0.6),
      s.line('Contact', cx + 27 * k, cy + 15 * k, cx + 40 * k, cy + 15 * k, '#9C7424', 1, 0.6),
    ]))
    ids.push(s.icon('Contactless', I.contactless, cx + 50 * k, cy + 3 * k, 24 * k, ink, { width: 1.8 * k }))
  }
  const number = o.full ? `••••  ••••  ••••  ${o.last4}` : `•• ${o.last4}`
  const numStyle: TextOptions = { size: (o.full ? 17 : 15) * k, weight: 500, family: 'Roboto Mono', color: ink, letterSpacing: 0.04 }
  const numH = s.measure(number, numStyle).height
  const bottom = y + h - 18 * k
  if (o.holder) {
    ids.push(s.text('Holder', o.holder, x + 20 * k, bottom - numH - 18 * k, { size: 10.5 * k, weight: 600, color: ink, opacity: 0.8, letterSpacing: 0.12 }))
  }
  ids.push(s.text('Number', number, x + 20 * k, bottom - numH, numStyle))
  if (o.expiry) {
    ids.push(s.text('Expiry', o.expiry, x + w - 76 * k, bottom - numH - 18 * k, { size: 10.5 * k, weight: 600, color: ink, opacity: 0.8, letterSpacing: 0.08, anchor: 'right' }))
  }
  ids.push(networkMark(s, x + w - 36 * k, bottom - 13 * k, 11 * k, ink))
  if (o.frozen) {
    ids.push(s.rect('Frost', x, y, w, h, { fill: solid('#DDE6FF', 0.55), radius: r }))
    ids.push(s.icon('Frozen', I.snowflake, x + w / 2 - 18, y + h / 2 - 18, 36, C.accent))
  }
  return s.group(o.name ?? `Card / ${art.label[0]}${art.label.slice(1).toLowerCase()} •• ${o.last4}`, ids)
}


/** A card at thumbnail size: the face, the star and the network ring, no small print. */
export function miniCard(s: Screen, kind: CardKind, x: number, y: number, w: number, last4: string): NodeId {
  const art = CARD_ART[kind]
  const h = Math.round(w / 1.586)
  return s.group(`Card Thumbnail / ${last4}`, [
    s.rect('Face', x, y, w, h, { fill: linear([[art.stops[0], 0], [art.stops[1], 1]], 0, 0, 1, 1), radius: Math.max(6, w * 0.08) }),
    s.path('Star', sparkle(x + w * 0.16, y + h * 0.24, w * 0.07), { fill: art.ink, closed: true }),
    s.circle('Network', x + w * 0.82, y + h * 0.74, w * 0.07, { fill: solid(art.ink, 0), stroke: { color: art.ink, width: 1.4, alpha: 0.9 } }),
  ])
}
