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

/** Home, the EUR account, Transactions and one transaction's detail. */

import type { NodeId } from '@/document/types'
import { linear, solid, type Screen } from '../kit'
import { homeIndicator, statusBar } from '../components'
import { C, CARD_SHADOW, CW, DISPLAY, M, W, money } from './theme'
import { I } from './icons'
import {
  avatar, badge, bigAmount, button, chip, divider, flag, listRow, navBar, panel, pill, roundButton, sectionTitle, tabBar, textAt, txRow,
  type FlagCode,
} from './ui'
import { ACCOUNTS, MERCHANT, TOTAL_EUR, USER, recent, type People } from './data'

/** A row of round actions with labels under them. */
export function actionRow(
  s: Screen,
  items: Array<[label: string, icon: string]>,
  cy: number,
  o: { first?: 'accent' | 'white'; dark?: boolean; r?: number } = {},
): NodeId {
  const r = o.r ?? 26
  const slot = CW / items.length
  return s.group('Quick Actions', items.map(([label, icon], i) => {
    const cx = M + slot * i + slot / 2
    const lead = i === 0 && o.first === 'accent'
    return s.group(`Action / ${label}`, [
      s.circle('Background', cx, cy, r, {
        fill: lead ? C.accent : o.dark ? C.nightCard : C.white,
        ...(lead || o.dark ? {} : { shadow: CARD_SHADOW }),
      }),
      s.icon('Icon', icon, cx - 11, cy - 11, 22, lead || o.dark ? C.white : C.ink),
      s.text('Label', label, cx, cy + r + 10, { size: 12.5, weight: 500, color: o.dark ? C.nightGrey : C.ink2, anchor: 'center' }),
    ])
  }))
}

function accountCard(s: Screen, code: FlagCode, name: string, amount: string, last4: string, x: number, y: number, on: boolean): NodeId {
  const w = 150
  const h = 112
  const ink = on ? C.white : C.ink
  return s.group(`Account Card / ${name}`, [
    s.rect('Background', x, y, w, h, on
      ? { fill: linear([['#5B74FF', 0], [C.accentDeep, 1]], 0, 0, 1, 1), radius: 20, shadow: { x: 0, y: 10, blur: 24, color: { r: 61, g: 90, b: 254, a: 0.3 }, visible: true } }
      : { fill: C.white, radius: 20, shadow: CARD_SHADOW }),
    flag(s, code, x + 32, y + 32, 16),
    s.text('Number', `•• ${last4}`, x + w - 16, y + 24, { size: 12, weight: 500, color: on ? C.white : C.grey, opacity: on ? 0.7 : 1, anchor: 'right' }),
    s.text('Name', name, x + 16, y + 60, { size: 13, color: on ? C.white : C.grey, opacity: on ? 0.8 : 1 }),
    s.text('Balance', amount, x + 16, y + 78, { size: 18, weight: 700, family: DISPLAY, color: ink, letterSpacing: -0.01 }),
  ])
}

export function home(s: Screen, people: People): void {
  statusBar(s, C.ink)
  s.group('Header', [
    avatar(s, 'Avatar', people.Emma!, M + 20, 76, 20),
    s.text('Greeting', 'Good morning', M + 52, 58, { size: 13, color: C.grey }),
    s.text('Name', USER.first, M + 52, 74, { size: 18, weight: 700, family: DISPLAY }),
    roundButton(s, 'Search', I.search, W - M - 68, 76, { iconSize: 20 }),
    roundButton(s, 'Notifications', I.bell, W - M - 20, 76, { iconSize: 20 }),
    s.circle('Unread', W - M - 11, 66, 4.5, { fill: C.red, stroke: { color: C.white, width: 1.5 } }),
  ])

  s.group('Balance', [
    s.text('Label', 'Total balance', M, 124, { size: 14, color: C.grey }),
    s.icon('Hide', I.eye, M + s.measure('Total balance', { size: 14 }).width + 8, 125, 16, C.faint, { width: 1.6 }),
    bigAmount(s, 'Amount', TOTAL_EUR, M, 144, { size: 44 }),
    s.group('Currency', [
      s.rect('Background', W - M - 94, 154, 94, 36, { fill: C.white, radius: 18, shadow: CARD_SHADOW }),
      flag(s, 'EU', W - M - 74, 172, 10),
      textAt(s, 'Code', 'EUR', W - M - 58, 172, { size: 14, weight: 600 }),
      s.icon('Chevron', I.chevronDown, W - M - 28, 164, 16, C.ink),
    ]),
    s.group('Accounts Hint', [
      ...(['GB', 'US', 'EU'] as const).map((code, i) => s.group(`Stacked / ${code}`, [
        s.circle('Ring', M + 41 - i * 16, 219, 11, { fill: C.surface }),
        flag(s, code, M + 41 - i * 16, 219, 9),
      ])),
      s.text('Label', 'Across 3 currency accounts', M + 58, 210, { size: 13, color: C.grey }),
    ]),
  ])

  actionRow(s, [['Add money', I.plus], ['Move', I.move], ['Details', I.details], ['More', I.more]], 272, { first: 'accent' })

  sectionTitle(s, 'Accounts', 340, { action: 'See all' })
  s.group('Accounts Carousel', [
    accountCard(s, 'EU', 'Euro', money(ACCOUNTS.eur.balance), ACCOUNTS.eur.last4, M, 374, true),
    accountCard(s, 'US', 'US Dollar', money(ACCOUNTS.usd.balance, '$'), ACCOUNTS.usd.last4, M + 162, 374, false),
    accountCard(s, 'GB', 'British Pound', money(ACCOUNTS.gbp.balance, '£'), ACCOUNTS.gbp.last4, M + 324, 374, false),
  ])

  sectionTitle(s, 'Transactions', 512, { action: 'See all' })
  const days = recent(people)
  const rows = [...days[0]!.rows.map((r) => ({ ...r, subtitle: `Today, ${r.subtitle.split(' · ')[1]}` })),
    ...days[1]!.rows.map((r) => ({ ...r, subtitle: `Yesterday, ${r.subtitle.split(' · ')[1]}` }))].slice(0, 4)
  const top = 546
  s.group('Recent Transactions', [
    panel(s, 'Background', M, top, CW, rows.length * 64 + 16),
    ...rows.map((tx, i) => txRow(s, tx, M + 16, top + 8 + i * 64, CW - 32)),
  ])
  tabBar(s, 'Home')
  homeIndicator(s, C.ink)
}

export function account(s: Screen): void {
  statusBar(s, C.ink)
  navBar(s, 'Euro account', { right: [['More', I.more]] })
  flag(s, 'EU', W / 2, 136, 24)
  s.text('Currency', 'Euro · EUR · Main', W / 2, 168, { size: 14, color: C.grey, anchor: 'center' })
  bigAmount(s, 'Balance', ACCOUNTS.eur.balance, W / 2, 190, { size: 40, anchor: 'center' })

  // Compact actions under the balance.
  const acts: Array<[string, string, boolean]> = [['Top up', I.plus, true], ['Exchange', I.exchange, false], ['Send', I.send, false]]
  const gap = 8
  const aw = (CW - gap * 2) / 3
  s.group('Actions', acts.map(([label, icon, on], i) => button(s, label, M + i * (aw + gap), 256, aw, { h: 44, icon, variant: on ? 'primary' : 'white' })))

  // Account details
  const dy = 320
  const rows: Array<[string, string, boolean]> = [
    ['Beneficiary', USER.name, false],
    ['IBAN', ACCOUNTS.eur.iban, true],
    ['BIC / SWIFT', 'NOVAXXL1', true],
  ]
  const details: NodeId[] = [
    panel(s, 'Background', M, dy, CW, 52 + rows.length * 56 + 8),
    s.text('Title', 'Account details', M + 20, dy + 18, { size: 16, weight: 700, family: DISPLAY }),
    s.group('Share', [
      s.icon('Icon', I.share, W - M - 20 - s.measure('Share', { size: 14, weight: 600 }).width - 24, dy + 18, 18, C.accent),
      s.text('Label', 'Share', W - M - 20, dy + 19, { size: 14, weight: 600, color: C.accent, anchor: 'right' }),
    ]),
  ]
  rows.forEach(([label, value, copy], i) => {
    const y = dy + 52 + i * 56
    const parts: NodeId[] = [
      divider(s, M + 20, y, CW - 40),
      s.text('Label', label, M + 20, y + 9, { size: 12, color: C.grey }),
      s.text('Value', value, M + 20, y + 27, { size: 15, weight: 500, family: label === 'Beneficiary' ? 'Inter' : 'Roboto Mono' }),
    ]
    if (copy) parts.push(s.icon('Copy', I.copy, W - M - 40, y + 18, 20, C.faint))
    details.push(s.group(`Detail / ${label}`, parts))
  })
  s.group('Account Details', details)

  // Statements
  const sy = dy + 52 + rows.length * 56 + 8 + 16
  const statements: Array<[string, string]> = [
    ['August 2026', 'PDF · 1–31 Aug · 38 transactions'],
    ['July 2026', 'PDF · 1–31 Jul · 44 transactions'],
    ['June 2026', 'PDF · 1–30 Jun · 41 transactions'],
  ]
  const st: NodeId[] = [
    panel(s, 'Background', M, sy, CW, 52 + statements.length * 60 + 4),
    s.text('Title', 'Statements', M + 20, sy + 18, { size: 16, weight: 700, family: DISPLAY }),
    s.text('Custom', 'Custom range', W - M - 20, sy + 19, { size: 14, weight: 600, color: C.accent, anchor: 'right' }),
  ]
  statements.forEach(([month, detail], i) => {
    const y = sy + 52 + i * 60
    st.push(s.group(`Statement / ${month}`, [
      divider(s, M + 20, y, CW - 40),
      s.rect('Tile', M + 20, y + 12, 36, 36, { fill: C.accentSoft, radius: 12 }),
      s.icon('Icon', I.document, M + 28, y + 20, 20, C.accent),
      s.text('Month', month, M + 70, y + 12, { size: 15, weight: 500 }),
      s.text('Detail', detail, M + 70, y + 32, { size: 12.5, color: C.grey }),
      s.icon('Download', I.download, W - M - 40, y + 20, 20, C.ink),
    ]))
  })
  s.group('Statements', st)
  homeIndicator(s, C.ink)
}

export function transactions(s: Screen, people: People): void {
  statusBar(s, C.ink)
  navBar(s, 'Transactions', { right: [['Export', I.download]] })
  s.group('Search Bar', [
    s.rect('Field', M, 112, CW - 56, 48, { fill: C.white, radius: 24, shadow: CARD_SHADOW }),
    s.icon('Icon', I.search, M + 16, 124, 22, C.faint),
    textAt(s, 'Placeholder', 'Search merchants or people', M + 48, 136, { size: 15, color: C.faint }),
    roundButton(s, 'Filters', I.sliders, W - M - 24, 136, { r: 24, fill: C.ink, color: C.white, iconSize: 20 }),
  ])
  let x = M
  const chips: NodeId[] = []
  for (const [i, label] of ['All', 'Spending', 'Income', 'Transfers', 'Metal •• 4821'].entries()) {
    const c = chip(s, label, x, 176, i === 0)
    chips.push(c.id)
    x += c.width + 8
  }
  s.group('Filters', chips)

  // The month so far, in and out.
  const my = 228
  const half = (CW - 12) / 2
  const stat = (label: string, value: string, icon: string, color: string, bg: string, x0: number) =>
    s.group(`Summary / ${label}`, [
      panel(s, 'Background', x0, my, half, 72),
      s.circle('Badge', x0 + 34, my + 36, 18, { fill: bg }),
      s.icon('Icon', icon, x0 + 25, my + 27, 18, color),
      s.text('Label', label, x0 + 62, my + 16, { size: 12, color: C.grey }),
      s.text('Value', value, x0 + 62, my + 34, { size: 16, weight: 700, family: DISPLAY }),
    ])
  s.group('September Summary', [
    stat('Money in · Sep', '+€2,845.00', I.arrowDown, C.green, C.greenSoft, M),
    stat('Money out · Sep', '−€1,486.30', I.arrowUp, C.ink, '#EEEFF4', M + half + 12),
  ])

  let y = my + 72 + 24
  const labels = ['Today', 'Yesterday', 'Wednesday, 9 Sep']
  recent(people).forEach((day, d) => {
    const rows = day.rows
    s.group(`Day / ${labels[d]}`, [
      s.text('Date', labels[d]!, M + 4, y, { size: 13, weight: 600, color: C.grey }),
      s.text('Total', money(day.total, '€', { sign: true }), W - M - 4, y, { size: 13, weight: 600, color: C.grey, anchor: 'right' }),
      panel(s, 'Background', M, y + 26, CW, rows.length * 64 + 8),
      ...rows.map((tx, i) => txRow(s, tx, M + 16, y + 30 + i * 64, CW - 32)),
    ])
    y += 26 + rows.length * 64 + 8 + 20
  })
  homeIndicator(s, C.ink)
}

/** A street map around the shop, in flat shapes kept inside their frame. */
function mapTile(s: Screen, x: number, y: number, w: number, h: number): NodeId {
  const street = (n: string, x0: number, y0: number, ww: number, hh: number) => s.rect(n, x0, y0, ww, hh, { fill: C.white })
  const pinX = x + w * 0.52
  const pinY = y + h * 0.5
  return s.group('Map', [
    s.rect('Land', x, y, w, h, { fill: '#EDF0F4', radius: 14 }),
    s.rect('Park', x + w * 0.7, y + 8, w * 0.26, h * 0.26, { fill: '#D9EFDC', radius: 8 }),
    s.rect('Park', x + 10, y + h * 0.42, w * 0.2, h * 0.24, { fill: '#D9EFDC', radius: 8 }),
    s.rect('River', x, y + h - 16, w, 16, { fill: '#D4E6FA', radius: [0, 0, 14, 14] }),
    street('Street / Avenida', x, y + h * 0.36, w, 8),
    street('Street / Rua da Estrela', x, y + h * 0.7, w, 5),
    street('Street / Travessa', x + w * 0.26, y, 6, h - 16),
    street('Street / Calçada', x + w * 0.64, y, 8, h - 16),
    s.path('Street / Diagonal', `M${x + w * 0.36} ${y} L${x + w * 0.42} ${y} L${x + w * 0.58} ${y + h - 16} L${x + w * 0.52} ${y + h - 16} Z`, { fill: C.white, closed: true }),
    s.circle('Pulse', pinX, pinY, 26, { fill: solid(C.accent, 0.14) }),
    s.circle('Pin', pinX, pinY, 15, { fill: '#16A34A', stroke: { color: C.white, width: 3 }, shadow: { x: 0, y: 4, blur: 10, color: { r: 13, g: 14, b: 26, a: 0.25 }, visible: true } }),
    s.icon('Pin Icon', I.cart, pinX - 8, pinY - 8, 16, C.white, { width: 2 }),
  ])
}

export function transactionDetail(s: Screen): void {
  statusBar(s, C.ink)
  navBar(s, '', { right: [['More', I.more], ['Share', I.share]] })
  badge(s, 'Merchant Logo', MERCHANT.grocer!, W / 2, 124, 28)
  s.text('Merchant', 'Grocer & Co', W / 2, 162, { size: 17, weight: 600, anchor: 'center' })
  bigAmount(s, 'Amount', -34.8, W / 2, 186, { size: 40, anchor: 'center' })
  s.text('Date', 'Friday, 11 Sep 2026 at 08:42', W / 2, 238, { size: 14, color: C.grey, anchor: 'center' })
  pill(s, 'Status', 'Completed', W / 2, 264, { fill: C.greenSoft, color: C.green, h: 28, icon: I.check, anchor: 'center' })

  // Status timeline
  const ty = 310
  const stepsX = [M + 56, W / 2, W - M - 56]
  const stepData: Array<[string, string]> = [['Authorised', '08:42'], ['Pending', '08:42'], ['Completed', '08:43']]
  const tl: NodeId[] = [panel(s, 'Background', M, ty, CW, 88)]
  tl.push(s.rect('Track', stepsX[0]!, ty + 25, stepsX[2]! - stepsX[0]!, 3, { fill: C.green, radius: 1.5 }))
  stepData.forEach(([label, time], i) => {
    const cx = stepsX[i]!
    tl.push(s.group(`Step / ${label}`, [
      s.circle('Dot', cx, ty + 26, 9, { fill: C.green, stroke: { color: C.white, width: 2.5 } }),
      s.icon('Tick', I.check, cx - 5, ty + 21, 10, C.white, { width: 2.4 }),
      s.text('Label', label, cx, ty + 44, { size: 13, weight: 600, anchor: 'center' }),
      s.text('Time', time, cx, ty + 62, { size: 12, color: C.grey, anchor: 'center' }),
    ]))
  })
  s.group('Status Timeline', tl)

  // Where
  const my = ty + 88 + 12
  s.group('Location', [
    panel(s, 'Background', M, my, CW, 148),
    mapTile(s, M + 8, my + 8, CW - 16, 92),
    s.icon('Pin', I.mapPin, M + 18, my + 112, 20, C.grey),
    s.text('Address', 'Rua da Estrela 28, Lisbon', M + 46, my + 106, { size: 14, weight: 600 }),
    s.text('Distance', 'Contactless · 0.4 km from home', M + 46, my + 124, { size: 12.5, color: C.grey }),
    s.icon('Chevron', I.chevronRight, W - M - 36, my + 114, 18, C.faint),
  ])

  // Details
  const dy = my + 148 + 12
  s.group('Details', [
    panel(s, 'Background', M, dy, CW, 3 * 52 + 12),
    listRow(s, { x: M + 16, y: dy + 6, w: CW - 32, h: 52, icon: I.cart, iconColor: '#16A34A', iconBg: '#E3F6EA', title: 'Category', value: 'Groceries', chevron: true }),
    divider(s, M + 68, dy + 58, CW - 84),
    listRow(s, { x: M + 16, y: dy + 58, w: CW - 32, h: 52, icon: I.card, iconColor: C.ink, title: 'Paid with', value: 'Metal •• 4821' }),
    divider(s, M + 68, dy + 110, CW - 84),
    listRow(s, { x: M + 16, y: dy + 110, w: CW - 32, h: 52, icon: I.repeat, iconColor: C.accent, iconBg: C.accentSoft, title: 'This month', value: '6 visits · €182.40' }),
  ])
  button(s, 'Split this bill', M, 752, CW, { icon: I.split, variant: 'soft' })
  homeIndicator(s, C.ink)
}

