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

/** The cards: the wallet stack, the metal card on black, and its settings. */

import type { NodeId } from '@/document/types'
import type { Screen } from '../kit'
import { homeIndicator, statusBar } from '../components'
import { C, CW, DISPLAY, M, W, money } from './theme'
import { I } from './icons'
import {
  cardFace, divider, listRow, miniCard, navBar, pageTitle, panel, pill, progressBar, sectionTitle, tabBar, textAt, txRow,
} from './ui'
import { MERCHANT } from './data'
import { actionRow } from './home'

const LIMIT = 3000
const SPENT_ON_CARD = 1240.6

/** The last seven days on the metal card, Saturday to Friday. */
const WEEK: Array<[string, number]> = [
  ['Sat', 62.1], ['Sun', 18.4], ['Mon', 44.9], ['Tue', 31.2], ['Wed', 100.99], ['Thu', 186.9], ['Fri', 39.0],
]

export function cards(s: Screen): void {
  statusBar(s, C.ink)
  pageTitle(s, 'Cards', { right: [['Add Card', I.plus]] })

  // The wallet: back cards narrower, so each shows a strip above the next.
  s.group('Card Stack', [
    cardFace(s, 'disposable', M + 24, 112, CW - 48, { last4: '1956' }),
    cardFace(s, 'virtual', M + 12, 150, CW - 24, { last4: '7730' }),
    cardFace(s, 'metal', M, 190, CW, { last4: '4821', holder: 'EMMA NOVAK', expiry: '08/29' }),
  ])

  s.group('Card Title', [
    s.text('Name', 'Metal card', M, 422, { size: 20, weight: 700, family: DISPLAY }),
    s.text('Detail', 'Physical · •• 4821 · Expires 08/29', M, 450, { size: 13, color: C.grey }),
    pill(s, 'Status', 'Active', W - M, 428, { fill: C.greenSoft, color: C.green, h: 28, anchor: 'right', icon: I.check }).id,
  ])

  actionRow(s, [['Freeze', I.snowflake], ['Show PIN', I.eye], ['Limits', I.gauge], ['Settings', I.gear]], 514, { r: 24 })

  // This month on the card, and the last seven days as bars.
  const py = 588
  const barTop = py + 100
  const barH = 36
  const max = Math.max(...WEEK.map(([, v]) => v))
  const bw = 28
  const step = (CW - 40 - bw) / (WEEK.length - 1)
  s.group('Monthly Spending', [
    panel(s, 'Background', M, py, CW, 156),
    s.text('Label', 'Spent this month', M + 20, py + 18, { size: 13, color: C.grey }),
    s.text('Amount', money(SPENT_ON_CARD), M + 20, py + 36, { size: 22, weight: 700, family: DISPLAY }),
    s.text('Limit', `of ${money(LIMIT, '€', { decimals: 0 })}`, M + 20 + s.measure(money(SPENT_ON_CARD), { size: 22, weight: 700, family: DISPLAY }).width + 6, py + 44, { size: 13, color: C.grey }),
    s.text('Left', `${money(LIMIT - SPENT_ON_CARD)} left`, W - M - 20, py + 44, { size: 13, weight: 600, color: C.accent, anchor: 'right' }),
    progressBar(s, 'Limit Used', M + 20, py + 74, CW - 40, SPENT_ON_CARD / LIMIT, C.accent),
    ...WEEK.map(([day, v], i) => {
      const h = Math.max(4, (v / max) * barH)
      const x = M + 20 + i * step
      const today = i === WEEK.length - 1
      return s.group(`Day / ${day}`, [
        s.rect('Bar', x, barTop + barH - h, bw, h, { fill: today ? C.accent : '#DCDFEA', radius: 6 }),
        s.text('Label', day, x + bw / 2, barTop + barH + 4, { size: 10.5, weight: today ? 600 : 500, color: today ? C.accent : C.grey, anchor: 'center' }),
      ])
    }),
  ])
  tabBar(s, 'Home')
  homeIndicator(s, C.ink)
}

export function cardDetail(s: Screen): void {
  statusBar(s, C.white)
  navBar(s, 'Metal card', { dark: true, right: [['More', I.more]] })
  cardFace(s, 'metal', M, 112, CW, { last4: '4821', holder: 'EMMA NOVAK', expiry: '08/29', full: true })
  s.group('Pager', [
    s.rect('Current', W / 2 - 22, 348, 20, 6, { fill: C.white, radius: 3 }),
    s.rect('Next', W / 2 + 4, 348, 6, 6, { fill: C.white, radius: 3, opacity: 0.25 }),
    s.rect('Last', W / 2 + 16, 348, 6, 6, { fill: C.white, radius: 3, opacity: 0.25 }),
  ])
  actionRow(s, [['Freeze', I.snowflake], ['Show PIN', I.eye], ['Limits', I.gauge], ['Settings', I.gear]], 410, { dark: true, r: 26 })

  // Card details, masked until asked for.
  const dy = 490
  const rows: Array<[string, string, string]> = [
    ['Card number', '•••• •••• •••• 4821', 'Show'],
    ['Expiry date', '08 / 29', ''],
    ['Security code', '•••', 'Show'],
  ]
  const details: NodeId[] = [panel(s, 'Background', M, dy, CW, rows.length * 56, { fill: C.nightCard, shadow: false })]
  rows.forEach(([label, value, action], i) => {
    const y = dy + i * 56
    const parts: NodeId[] = []
    if (i > 0) parts.push(divider(s, M + 20, y, CW - 40, C.nightLine))
    parts.push(
      s.text('Label', label, M + 20, y + 9, { size: 12, color: C.nightGrey }),
      s.text('Value', value, M + 20, y + 27, { size: 15, weight: 500, family: 'Roboto Mono', color: C.white }),
    )
    if (action) parts.push(textAt(s, 'Action', action, W - M - 20, y + 28, { size: 14, weight: 600, color: '#8FA2FF', anchor: 'right' }))
    else parts.push(s.icon('Copy', I.copy, W - M - 40, y + 18, 20, C.nightGrey))
    details.push(s.group(`Detail / ${label}`, parts))
  })
  s.group('Card Details', details)

  sectionTitle(s, 'Recent', 674, { dark: true, action: 'See all' })
  s.group('Recent on Card', [
    txRow(s, { title: 'Grocer & Co', subtitle: 'Today, 08:42', amount: -34.8, badge: MERCHANT.grocer! }, M, 706, CW, { dark: true }),
    txRow(s, { title: 'Bean There', subtitle: 'Today, 07:55', amount: -4.2, badge: MERCHANT.bean! }, M, 770, CW, { dark: true }),
  ])
  homeIndicator(s, C.white)
}

export function cardSettings(s: Screen): void {
  statusBar(s, C.ink)
  navBar(s, 'Card settings')
  s.group('Card Summary', [
    panel(s, 'Background', M, 112, CW, 72),
    miniCard(s, 'metal', M + 14, 126, 70, '4821'),
    s.text('Name', 'Metal •• 4821', M + 98, 128, { size: 16, weight: 600 }),
    s.text('Detail', 'Physical card · Expires 08/29', M + 98, 150, { size: 13, color: C.grey }),
    s.icon('Chevron', I.chevronRight, W - M - 34, 139, 18, C.faint),
  ])

  const section = (title: string, y: number, rows: Array<Parameters<typeof listRow>[1]>, rowH: number): number => {
    s.text(`Section / ${title}`, title.toUpperCase(), M + 4, y, { size: 12, weight: 600, color: C.grey, letterSpacing: 0.06 })
    const top = y + 24
    const ids: NodeId[] = [panel(s, 'Background', M, top, CW, rows.length * rowH + 8)]
    rows.forEach((r, i) => {
      if (i > 0) ids.push(divider(s, M + 68, top + 4 + i * rowH, CW - 84))
      ids.push(listRow(s, { ...r, x: M + 16, y: top + 4 + i * rowH, w: CW - 32, h: rowH }))
    })
    s.group(title, ids)
    return top + rows.length * rowH + 8
  }
  const base = { x: 0, y: 0, w: 0 }
  let y = section('Payments', 204, [
    { ...base, icon: I.contactless, title: 'Contactless', detail: 'Up to €50 without a PIN', toggle: true },
    { ...base, icon: I.globe, title: 'Online payments', detail: 'Web shops and subscriptions', toggle: true },
    { ...base, icon: I.cash, title: 'ATM withdrawals', detail: '€800 free a month · €540 left', toggle: true },
    { ...base, icon: I.magstripe, title: 'Magnetic stripe', detail: 'Only older terminals need it', toggle: false },
  ], 64)
  y = section('Security', y + 20, [
    { ...base, icon: I.mapPin, title: 'Location security', detail: 'When your phone is far away', toggle: true },
    { ...base, icon: I.shield, title: 'Block gambling', detail: 'Betting and casino payments', toggle: true },
  ], 64)
  section('Limits', y + 20, [
    { ...base, icon: I.gauge, title: 'Monthly spending limit', value: money(LIMIT, '€', { decimals: 0 }), chevron: true },
  ], 56)
  homeIndicator(s, C.ink)
}
