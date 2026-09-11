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
 * "Aura" — a five-screen shopping app, built as an XDesign document.
 *
 * Welcome, Home, Product, Cart and Order Confirmed, each a 390 × 844 artboard
 * (an iPhone 14's screen). Everything is ordinary, editable artwork: named
 * groups for every component — status bar, search bar, product card, tab bar
 * — real text objects, rectangles and ellipses with corner radii and shadows,
 * icons as paths, and product photographs as image layers on embedded PNGs.
 *
 * Built in the browser by scripts/build-examples.mjs, because text has to be
 * measured with the real fonts to get its boxes right, and the photographs are
 * rasterised on a canvas.
 */

import '@/styles/fonts'
import { createDocument, createLinearGradient, createStop } from '@/document/NodeFactory'
import { createSwatchId } from '@/document/ids'
import { ensureFontLoaded } from '@/text/FontRegistry'
import type { DesignDocument, ImageAsset, NodeId } from '@/document/types'
import { addAsset, rasterize, rgba, Screen, shadow, solid } from '../kit'
import * as art from './illustrations'
import { exampleFiles } from '../output'

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------

const C = {
  coral: '#FF6B3D',
  pink: '#FF3D7F',
  ink: '#1C1B2E',
  grey: '#8A8AA0',
  faint: '#B4B4C6',
  line: '#E6E6EE',
  surface: '#F6F6F9',
  white: '#FFFFFF',
  mint: '#22C55E',
  mintSoft: '#DDF6E7',
  sky: '#5B8DEF',
  sun: '#FFB020',
}

const W = 390
const H = 844
const GAP = 100

const CARD_SHADOW = shadow(10, 28, 0.07)

// ---------------------------------------------------------------------------
// Icons, on a 24-unit grid
// ---------------------------------------------------------------------------

const I = {
  search: 'M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14z M20.5 20.5L16 16',
  bell: 'M18 16V11a6 6 0 0 0-12 0v5l-2 2h16z M10 21a2 2 0 0 0 4 0',
  sliders: 'M4 7h9 M17 7h3 M15 4.5v5 M4 17h3 M11 17h9 M9 14.5v5',
  heart: 'M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20z',
  plus: 'M12 5v14 M5 12h14',
  minus: 'M5 12h14',
  home: 'M3.5 11L12 4l8.5 7 M5.5 9.5V20h4.5v-5.5h4V20h4.5V9.5',
  explore: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M15.5 8.5l-2 5-5 2 2-5z',
  bag: 'M5 8h14l-1.2 12.5H6.2z M9 8V6.5a3 3 0 0 1 6 0V8',
  user: 'M12 4a4 4 0 1 0 0 8a4 4 0 1 0 0-8z M4.5 20.5c1.4-3.8 4.2-5.8 7.5-5.8s6.1 2 7.5 5.8',
  back: 'M15 5l-7 7 7 7',
  arrow: 'M5 12h14 M13 6l6 6-6 6',
  trash: 'M4 7h16 M9.5 7V5h5v2 M6.5 7l1 13h9l1-13',
  tag: 'M3.5 12.5V4.5h8l9 9-8 8z M8 8.5h.01',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  truck: 'M2.5 6h11v9.5h-11z M13.5 9.5h4l3 3.5v2.5h-7 M8.8 18.3a1.8 1.8 0 1 0-3.6 0a1.8 1.8 0 1 0 3.6 0z M18.8 18.3a1.8 1.8 0 1 0-3.6 0a1.8 1.8 0 1 0 3.6 0z',
  wifi: 'M2.5 9a14 14 0 0 1 19 0 M5.5 12.5a9.5 9.5 0 0 1 13 0 M9 16a4.5 4.5 0 0 1 6 0 M12 19.5h.01',
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

interface Product {
  name: string
  category: string
  price: number
  tint: string
  image: ImageAsset
}

function money(n: number): string {
  return `$${n.toFixed(2)}`
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function statusBar(s: Screen, colour = C.ink): NodeId {
  const ids = [
    s.text('Time', '9:41', 30, 14, { size: 15, weight: 600, family: 'Poppins', color: colour }),
    ...[4, 6.5, 9, 11.5].map((h, i) =>
      s.rect(`Signal ${i + 1}`, 294 + i * 5, 29 - h, 3, h, { fill: colour, radius: 1 }),
    ),
    s.icon('Wi-Fi', I.wifi, 314, 14, 17, colour, { width: 1.8 }),
    s.rect('Battery', 336, 17, 24, 12, { fill: solid(colour, 0), radius: 3.5, stroke: { color: colour, width: 1, alpha: 0.4 } }),
    s.rect('Battery Level', 338, 19, 18, 8, { fill: colour, radius: 2 }),
    s.rect('Battery Cap', 361, 21, 2, 4, { fill: colour, radius: 1, opacity: 0.4 }),
  ]
  return s.group('Status Bar', ids)
}

function homeIndicator(s: Screen): NodeId {
  return s.rect('Home Indicator', (W - 134) / 2, H - 13, 134, 5, { fill: C.ink, radius: 3 })
}

function primaryButton(s: Screen, label: string, x: number, y: number, w: number, icon?: string): NodeId {
  const h = 56
  const ids = [s.rect('Background', x, y, w, h, { fill: C.coral, radius: 16, shadow: shadow(10, 22, 0.28, 0, C.coral) })]
  const text = { size: 16, weight: 600, family: 'Poppins' as const, color: C.white }
  const size = s.measure(label, text)
  const iconSize = icon ? 20 : 0
  const gap = icon ? 10 : 0
  const left = x + (w - size.width - iconSize - gap) / 2
  ids.push(s.text('Label', label, left, y + (h - size.height) / 2, text))
  if (icon) ids.push(s.icon('Icon', icon, left + size.width + gap, y + (h - iconSize) / 2, iconSize, C.white))
  return s.group(`Button / ${label}`, ids)
}

function roundButton(s: Screen, name: string, icon: string, cx: number, cy: number, o: { filled?: boolean; size?: number } = {}): NodeId {
  const r = (o.size ?? 44) / 2
  return s.group(name, [
    s.circle('Background', cx, cy, r, { fill: C.white, shadow: shadow(6, 18, 0.08) }),
    o.filled
      ? s.icon('Icon', icon, cx - 10, cy - 10, 20, C.coral, { fill: C.coral })
      : s.icon('Icon', icon, cx - 10, cy - 10, 20, C.ink),
  ])
}

function tabBar(s: Screen, active: number, cartCount: number): NodeId {
  const tabs: Array<[string, string]> = [['Home', I.home], ['Explore', I.explore], ['Cart', I.bag], ['Profile', I.user]]
  const top = H - 84
  const ids = [
    s.rect('Background', 0, top, W, 84, { fill: C.white, radius: [28, 28, 0, 0], shadow: shadow(-6, 30, 0.08) }),
  ]
  const slot = W / tabs.length
  tabs.forEach(([label, d], i) => {
    const cx = slot * i + slot / 2
    const on = i === active
    const colour = on ? C.coral : C.faint
    const parts = [
      s.icon('Icon', d, cx - 12, top + 14, 24, colour, { width: on ? 2.2 : 2 }),
      s.text('Label', label, cx, top + 42, { size: 11, weight: on ? 600 : 500, color: on ? C.coral : C.grey, anchor: 'center' }),
    ]
    if (label === 'Cart' && cartCount > 0) {
      parts.push(
        s.circle('Badge', cx + 12, top + 15, 8, { fill: C.coral, stroke: { color: C.white, width: 2 } }),
        s.centeredText('Count', String(cartCount), { x: cx + 4, y: top + 7, w: 16, h: 16 }, { size: 9, weight: 700, color: C.white }),
      )
    }
    ids.push(s.group(`Tab / ${label}`, parts))
  })
  return s.group('Tab Bar', ids)
}

function chip(s: Screen, label: string, x: number, y: number, on: boolean): { id: NodeId; width: number } {
  const text = { size: 14, weight: on ? 600 : 500, color: on ? C.white : C.ink }
  const w = s.measure(label, text).width + 36
  const id = s.group(`Chip / ${label}`, [
    s.rect('Background', x, y, w, 40, on ? { fill: C.ink, radius: 20 } : { fill: C.white, radius: 20, stroke: { color: C.line, width: 1 } }),
    s.centeredText('Label', label, { x, y, w, h: 40 }, text),
  ])
  return { id, width: w }
}

function productCard(s: Screen, p: Product, x: number, y: number, favourite: boolean): NodeId {
  const w = 163
  const ids = [
    s.rect('Card', x, y, w, 236, { fill: C.white, radius: 22, shadow: CARD_SHADOW }),
    s.rect('Photo Background', x + 8, y + 8, w - 16, 142, { fill: p.tint, radius: 16 }),
    s.image('Photo', p.image, x + 20, y + 16, 124, 124),
    roundButton(s, 'Favourite', I.heart, x + w - 30, y + 30, { filled: favourite, size: 32 }),
    s.text('Name', p.name, x + 14, y + 160, { size: 14, weight: 600, family: 'Poppins', width: w - 28 }),
    s.text('Category', p.category, x + 14, y + 181, { size: 12, color: C.grey }),
    s.text('Price', money(p.price), x + 14, y + 202, { size: 16, weight: 700, family: 'Poppins' }),
    s.group('Add', [
      s.circle('Background', x + w - 30, y + 212, 16, { fill: C.ink }),
      s.icon('Icon', I.plus, x + w - 39, y + 203, 18, C.white),
    ]),
  ]
  return s.group(`Product Card / ${p.name}`, ids)
}

function stepper(s: Screen, x: number, y: number, count: number, compact = false): NodeId {
  if (compact) {
    return s.group('Quantity', [
      s.circle('Minus', x + 14, y + 14, 14, { fill: C.surface }),
      s.icon('Minus Icon', I.minus, x + 7, y + 7, 14, C.ink),
      s.centeredText('Count', String(count), { x: x + 28, y, w: 30, h: 28 }, { size: 15, weight: 600, family: 'Poppins' }),
      s.circle('Plus', x + 72, y + 14, 14, { fill: C.coral }),
      s.icon('Plus Icon', I.plus, x + 65, y + 7, 14, C.white),
    ])
  }
  return s.group('Quantity', [
    s.rect('Background', x, y, 120, 56, { fill: C.surface, radius: 16 }),
    s.icon('Minus', I.minus, x + 16, y + 17, 22, C.ink),
    s.centeredText('Count', String(count), { x: x + 40, y, w: 40, h: 56 }, { size: 17, weight: 600, family: 'Poppins' }),
    s.icon('Plus', I.plus, x + 82, y + 17, 22, C.ink),
  ])
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

function welcome(s: Screen, hero: ImageAsset): void {
  s.image('Hero', hero, 0, 0, W, 520, [0, 0, 36, 36])
  statusBar(s)
  s.group('Logo', [
    s.rect('Background', 24, 60, 96, 38, { fill: C.white, radius: 19, shadow: shadow(6, 16, 0.08) }),
    s.circle('Mark', 44, 79, 9, { fill: C.coral }),
    s.text('Name', 'aura', 60, 66, { size: 18, weight: 700, family: 'Poppins', letterSpacing: -0.02 }),
  ])
  s.group('Pager', [
    s.rect('Current', 24, 552, 24, 8, { fill: C.coral, radius: 4 }),
    s.rect('Next', 56, 552, 8, 8, { fill: C.ink, radius: 4, opacity: 0.18 }),
    s.rect('Last', 72, 552, 8, 8, { fill: C.ink, radius: 4, opacity: 0.18 }),
  ])
  s.text('Title', 'Find your\nperfect style', 24, 576, {
    size: 34, weight: 700, family: 'Poppins', width: W - 48, lineHeight: 1.2, letterSpacing: -0.01,
  })
  s.text('Subtitle', 'Sneakers, audio and everyday gear from the brands you love — delivered in two days.', 24, 670, {
    size: 15, color: C.grey, width: W - 60, lineHeight: 1.5,
  })
  primaryButton(s, 'Get Started', 24, 734, W - 48, I.arrow)
  const sign = { size: 13, color: C.grey }
  const lead = 'Already have an account? '
  const total = s.measure(lead, sign).width + s.measure('Sign in', { ...sign, weight: 600 }).width
  const left = (W - total) / 2
  s.group('Sign In', [
    s.text('Prompt', lead, left, 800, sign),
    s.text('Link', 'Sign in', left + s.measure(lead, sign).width, 800, { ...sign, weight: 600, color: C.coral }),
  ])
  homeIndicator(s)
}

function home(s: Screen, products: Product[], avatar: ImageAsset, banner: ImageAsset): void {
  statusBar(s)
  s.group('Header', [
    s.text('Greeting', 'Hello, Alex', 24, 62, { size: 14, color: C.grey }),
    s.text('Title', 'Discover', 24, 82, { size: 28, weight: 700, family: 'Poppins', letterSpacing: -0.01 }),
    roundButton(s, 'Notifications', I.bell, 290, 86),
    s.circle('Notification Dot', 300, 76, 4.5, { fill: C.coral, stroke: { color: C.white, width: 1.5 } }),
    s.image('Avatar', avatar, 322, 64, 44, 44, 22),
  ])
  s.group('Search Bar', [
    s.rect('Field', 24, 140, 282, 52, { fill: C.white, radius: 16, shadow: CARD_SHADOW }),
    s.icon('Search Icon', I.search, 40, 155, 22, C.faint),
    s.text('Placeholder', 'Search products', 72, 156, { size: 15, color: C.faint }),
    s.group('Filter', [
      s.rect('Background', 314, 140, 52, 52, { fill: C.coral, radius: 16, shadow: shadow(8, 18, 0.25, 0, C.coral) }),
      s.icon('Icon', I.sliders, 328, 154, 24, C.white),
    ]),
  ])
  let x = 24
  const chips: NodeId[] = []
  for (const [i, label] of ['All', 'Sneakers', 'Audio', 'Watches', 'Bags'].entries()) {
    const c = chip(s, label, x, 212, i === 0)
    chips.push(c.id)
    x += c.width + 10
  }
  s.group('Categories', chips)

  const gradient = createLinearGradient([createStop(0, rgba(C.coral)), createStop(1, rgba(C.pink))])
  Object.assign(gradient, { x1: 0, y1: 0, x2: 1, y2: 1 })
  s.group('Promo Banner', [
    s.rect('Background', 24, 272, 342, 150, { fill: gradient, radius: 24, shadow: shadow(12, 26, 0.25, 0, C.coral) }),
    s.circle('Glow Large', 330, 300, 90, { fill: solid(C.white, 0.1) }),
    s.circle('Glow Small', 250, 430, 46, { fill: solid(C.white, 0.08) }),
    s.text('Eyebrow', 'SUMMER SALE', 46, 294, { size: 11, weight: 600, color: C.white, opacity: 0.85, letterSpacing: 0.12 }),
    s.text('Headline', 'Up to 40% off audio', 46, 314, {
      size: 22, weight: 700, family: 'Poppins', color: C.white, width: 170, lineHeight: 1.2,
    }),
    s.group('Button / Shop now', [
      s.rect('Background', 46, 374, 102, 32, { fill: C.white, radius: 16 }),
      s.centeredText('Label', 'Shop now', { x: 46, y: 374, w: 102, h: 32 }, { size: 13, weight: 600, family: 'Poppins', color: C.coral }),
    ]),
    s.image('Product', banner, 196, 262, 176, 176),
  ])

  s.group('Section Header', [
    s.text('Title', 'Popular', 24, 446, { size: 18, weight: 600, family: 'Poppins' }),
    s.text('See All', 'See all', W - 24, 450, { size: 14, weight: 500, color: C.coral, anchor: 'right' }),
  ])
  const grid = products.slice(0, 4).map((p, i) => productCard(s, p, 24 + (i % 2) * 179, 486 + Math.floor(i / 2) * 252, i === 0))
  s.group('Products', grid)
  tabBar(s, 0, 3)
  homeIndicator(s)
}

function product(s: Screen, p: Product): void {
  s.rect('Photo Background', 0, 0, W, 500, { fill: p.tint })
  s.circle('Photo Glow', 195, 270, 150, { fill: solid(C.white, 0.55) })
  s.image('Photo', p.image, 28, 108, 334, 334)
  statusBar(s)
  roundButton(s, 'Back', I.back, 46, 78)
  roundButton(s, 'Favourite', I.heart, W - 46, 78, { filled: true })
  s.group('Pager', [
    s.rect('Current', 171, 456, 24, 8, { fill: C.coral, radius: 4 }),
    s.rect('Next', 203, 456, 8, 8, { fill: C.ink, radius: 4, opacity: 0.18 }),
    s.rect('Last', 219, 456, 8, 8, { fill: C.ink, radius: 4, opacity: 0.18 }),
  ])

  s.rect('Sheet', 0, 484, W, H - 484, { fill: C.white, radius: [32, 32, 0, 0], shadow: shadow(-8, 30, 0.06) })
  s.group('Title', [
    s.text('Name', p.name, 24, 508, { size: 24, weight: 700, family: 'Poppins', letterSpacing: -0.01 }),
    s.text('Price', money(p.price), W - 24, 510, { size: 22, weight: 700, family: 'Poppins', color: C.coral, anchor: 'right' }),
    s.text('Category', "Men's running shoe", 24, 544, { size: 14, color: C.grey }),
  ])
  const rating = { size: 14, weight: 600 }
  s.group('Rating', [
    ...[0, 1, 2, 3, 4].map((i) => s.star(`Star ${i + 1}`, 24 + i * 19, 574, 16, i < 4 ? C.sun : C.line)),
    s.text('Score', '4.8', 124, 571, rating),
    s.text('Reviews', '(312 reviews)', 124 + s.measure('4.8', rating).width + 6, 571, { size: 14, color: C.grey }),
  ])

  s.text('Colour Label', 'Colour', 24, 612, { size: 15, weight: 600, family: 'Poppins' })
  const colours = [C.coral, C.ink, C.sky, '#E4E4EC']
  s.group('Colours', [
    s.circle('Selected Ring', 42, 656, 18, { fill: solid(C.white, 0), stroke: { color: C.coral, width: 2 } }),
    ...colours.map((c, i) => s.circle(`Colour ${i + 1}`, 42 + i * 46, 656, 13, { fill: c })),
  ])

  s.text('Size Label', 'Size', 222, 612, { size: 15, weight: 600, family: 'Poppins' })
  s.text('Size Guide', 'Size guide', W - 24, 614, { size: 13, color: C.coral, anchor: 'right' })
  const sizes = ['40', '41', '42', '43', '44']
  s.group('Sizes', sizes.map((size, i) => {
    const x = 24 + i * 70
    const on = size === '42'
    return s.group(`Size / ${size}`, [
      s.rect('Background', x, 696, 62, 44, on ? { fill: C.ink, radius: 14 } : { fill: C.surface, radius: 14 }),
      s.centeredText('Label', size, { x, y: 696, w: 62, h: 44 }, { size: 15, weight: 600, family: 'Poppins', color: on ? C.white : C.ink }),
    ])
  }))

  s.group('Buy Bar', [stepper(s, 24, 764, 1), primaryButton(s, 'Add to Cart', 156, 764, W - 180, I.bag)])
  homeIndicator(s)
}

function cart(s: Screen, lines: Array<{ product: Product; variant: string; count: number }>): void {
  statusBar(s)
  s.group('Header', [
    roundButton(s, 'Back', I.back, 46, 78),
    s.text('Title', 'My Cart', W / 2, 64, { size: 20, weight: 600, family: 'Poppins', anchor: 'center' }),
    s.text('Edit', 'Edit', W - 24, 68, { size: 15, weight: 500, color: C.coral, anchor: 'right' }),
  ])

  const rows = lines.map(({ product: p, variant, count }, i) => {
    const y = 124 + i * 116
    return s.group(`Cart Item / ${p.name}`, [
      s.rect('Card', 24, y, W - 48, 104, { fill: C.white, radius: 20, shadow: CARD_SHADOW }),
      s.rect('Photo Background', 36, y + 12, 80, 80, { fill: p.tint, radius: 16 }),
      s.image('Photo', p.image, 44, y + 20, 64, 64),
      s.text('Name', p.name, 130, y + 16, { size: 15, weight: 600, family: 'Poppins' }),
      s.text('Variant', variant, 130, y + 40, { size: 13, color: C.grey }),
      s.text('Price', money(p.price), 130, y + 64, { size: 16, weight: 700, family: 'Poppins' }),
      s.icon('Remove', I.trash, W - 56, y + 16, 18, C.faint),
      stepper(s, W - 124, y + 62, count, true),
    ])
  })
  s.group('Cart Items', rows)

  s.group('Promo Code', [
    s.rect('Field', 24, 480, W - 48, 56, { fill: C.white, radius: 16, stroke: { color: C.faint, width: 1.5, dash: [6, 5] } }),
    s.icon('Tag', I.tag, 42, 497, 22, C.coral),
    s.text('Placeholder', 'Promo code', 74, 497, { size: 15, color: C.faint }),
    s.group('Button / Apply', [
      s.rect('Background', W - 108, 488, 76, 40, { fill: C.ink, radius: 12 }),
      s.centeredText('Label', 'Apply', { x: W - 108, y: 488, w: 76, h: 40 }, { size: 14, weight: 600, family: 'Poppins', color: C.white }),
    ]),
  ])

  const subtotal = lines.reduce((sum, l) => sum + l.product.price * l.count, 0)
  const shipping = 8
  const discount = 20
  const rows2: Array<[string, string, string]> = [
    ['Subtotal', money(subtotal), C.ink],
    ['Shipping', money(shipping), C.ink],
    ['Discount', `-${money(discount)}`, C.mint],
  ]
  const summary: NodeId[] = []
  rows2.forEach(([label, value, colour], i) => {
    const y = 562 + i * 32
    summary.push(s.group(`Row / ${label}`, [
      s.text('Label', label, 24, y, { size: 15, color: C.grey }),
      s.text('Value', value, W - 24, y, { size: 15, weight: 600, color: colour, anchor: 'right' }),
    ]))
  })
  summary.push(s.rect('Divider', 24, 664, W - 48, 1, { fill: C.line }))
  summary.push(s.group('Row / Total', [
    s.text('Label', 'Total', 24, 682, { size: 18, weight: 600, family: 'Poppins' }),
    s.text('Value', money(subtotal + shipping - discount), W - 24, 678, { size: 22, weight: 700, family: 'Poppins', anchor: 'right' }),
  ]))
  s.group('Summary', summary)
  primaryButton(s, 'Checkout', 24, 752, W - 48, I.arrow)
  homeIndicator(s)
}

function confirmed(s: Screen, items: Product[]): void {
  statusBar(s)
  // Confetti, drawn with the same few shapes the rest of the app uses.
  const confetti: NodeId[] = [
    s.rect('Piece 1', 92, 120, 12, 6, { fill: C.coral, radius: 2 }),
    s.rect('Piece 2', 290, 104, 6, 14, { fill: C.sky, radius: 2 }),
    s.circle('Piece 3', 318, 210, 5, { fill: C.sun }),
    s.circle('Piece 4', 70, 238, 4, { fill: C.mint }),
    s.star('Piece 5', 300, 262, 16, C.sun),
    s.star('Piece 6', 74, 150, 12, C.pink),
    s.rect('Piece 7', 116, 290, 10, 5, { fill: C.sky, radius: 2 }),
    s.circle('Piece 8', 266, 128, 3.5, { fill: C.coral }),
  ]
  s.group('Confetti', confetti)
  s.group('Success', [
    s.circle('Halo', W / 2, 196, 78, { fill: C.mintSoft }),
    s.circle('Badge', W / 2, 196, 52, { fill: C.mint, shadow: shadow(12, 26, 0.35, 0, C.mint) }),
    s.icon('Check', I.check, W / 2 - 24, 172, 48, C.white, { width: 4 }),
  ])
  s.text('Title', 'Order confirmed!', W / 2, 300, { size: 26, weight: 700, family: 'Poppins', anchor: 'center' })
  s.text('Message', "Thanks, Alex! Your order is on its way — we'll let you know the moment it ships.", W / 2, 342, {
    size: 15, color: C.grey, width: 300, align: 'center', lineHeight: 1.5, anchor: 'center',
  })

  const card: NodeId[] = [
    s.rect('Background', 24, 430, W - 48, 204, { fill: C.surface, radius: 22 }),
    s.text('Order', 'Order #A-2048', 44, 450, { size: 16, weight: 600, family: 'Poppins' }),
    s.text('Date', 'Placed Sep 11, 2026', 44, 474, { size: 13, color: C.grey }),
    s.group('Status', [
      s.rect('Background', W - 138, 452, 94, 30, { fill: C.mintSoft, radius: 15 }),
      s.centeredText('Label', 'Processing', { x: W - 138, y: 452, w: 94, h: 30 }, { size: 12, weight: 600, color: '#15803D' }),
    ]),
  ]
  items.forEach((p, i) => {
    const x = 44 + i * 76
    card.push(s.group(`Item / ${p.name}`, [
      s.rect('Background', x, 508, 64, 64, { fill: p.tint, radius: 16 }),
      s.image('Photo', p.image, x + 8, 516, 48, 48),
    ]))
  })
  card.push(
    s.rect('Divider', 44, 588, W - 88, 1, { fill: C.line }),
    s.icon('Delivery Icon', I.truck, 44, 600, 22, C.ink),
    s.text('Delivery Label', 'Estimated delivery', 76, 602, { size: 13, color: C.grey }),
    s.text('Delivery Date', 'Sep 15 – 17', W - 44, 601, { size: 14, weight: 600, anchor: 'right' }),
  )
  s.group('Order Card', card)
  primaryButton(s, 'Track Order', 24, 700, W - 48)
  s.text('Continue Shopping', 'Continue shopping', W / 2, 776, { size: 15, weight: 600, family: 'Poppins', anchor: 'center' })
  homeIndicator(s)
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

async function product$(doc: DesignDocument, name: string, markup: string): Promise<ImageAsset> {
  const size = 480
  const png = await rasterize(art.asSvg(markup, '0 0 480 480', size, size), size, size)
  return addAsset(doc, name, png, size, size)
}

export async function buildShopApp(): Promise<DesignDocument> {
  await Promise.all([
    ...[400, 500, 600, 700].map((w) => ensureFontLoaded('Poppins', w)),
    ...[400, 500, 600, 700].map((w) => ensureFontLoaded('Inter', w)),
  ])

  const doc = createDocument('Aura — Shopping App', false)
  doc.swatches = [C.coral, C.pink, C.ink, C.grey, C.surface, C.mint, C.sky, C.sun].map((hex) => ({
    id: createSwatchId(),
    color: rgba(hex),
  }))

  const [sneaker, headphones, watch, backpack, sunglasses] = await Promise.all([
    product$(doc, 'Air Runner Pro', art.sneaker()),
    product$(doc, 'Pulse Headphones', art.headphones()),
    product$(doc, 'Orbit Watch S2', art.watch()),
    product$(doc, 'Trail Backpack', art.backpack()),
    product$(doc, 'Sunset Shades', art.sunglasses()),
  ])
  const avatar = addAsset(doc, 'Avatar', await rasterize(art.asSvg(art.avatar(), '0 0 480 480', 176, 176), 176, 176), 176, 176)
  const hero = addAsset(doc, 'Hero', await rasterize(art.asSvg(art.hero(), '0 0 390 520', 780, 1040), 780, 1040, 'image/jpeg'), 780, 1040)

  const products: Product[] = [
    { name: 'Air Runner Pro', category: 'Sneakers', price: 129, tint: '#FFE8DF', image: sneaker! },
    { name: 'Pulse Headphones', category: 'Audio', price: 199, tint: '#ECEAFF', image: headphones! },
    { name: 'Orbit Watch S2', category: 'Watches', price: 249, tint: '#E4F0FF', image: watch! },
    { name: 'Trail Backpack', category: 'Bags', price: 89, tint: '#DDF6F2', image: backpack! },
    { name: 'Sunset Shades', category: 'Eyewear', price: 59, tint: '#FFF1D6', image: sunglasses! },
  ]
  const [runner, pulse, , trail] = products as [Product, Product, Product, Product]

  const screens: Array<[string, string, (s: Screen) => void]> = [
    ['01 Welcome', C.white, (s) => welcome(s, hero)],
    ['02 Home', C.surface, (s) => home(s, products, avatar, headphones!)],
    ['03 Product', C.white, (s) => product(s, runner)],
    ['04 Cart', C.surface, (s) =>
      cart(s, [
        { product: runner, variant: 'Size 42 · Coral', count: 2 },
        { product: pulse, variant: 'Midnight', count: 1 },
        { product: trail, variant: 'Teal · 20 L', count: 1 },
      ])],
    ['05 Order Confirmed', C.white, (s) => confirmed(s, [runner, pulse, trail])],
  ]
  screens.forEach(([name, background, draw], i) => draw(new Screen(doc, name, i * (W + GAP), W, H, background)))
  return doc
}

// ---------------------------------------------------------------------------
// What the build script writes
// ---------------------------------------------------------------------------

export async function buildFiles(): Promise<Record<string, string>> {
  return exampleFiles(await buildShopApp(), 'Aura Shopping App')
}
