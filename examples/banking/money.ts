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

/** Money tools: Exchange, spending Analytics and Savings Vaults. */

import type { NodeId } from '@/document/types'
import { linear, random, solid, type Screen, type TextOptions } from '../kit'
import { homeIndicator, statusBar } from '../components'
import { C, CW, DISPLAY, M, W, money } from './theme'
import { I } from './icons'
import {
  areaChart, button, divider, donutSlice, flag, listRow, navBar, panel, pill, plot, progressBar, progressRing, roundButton,
  sectionTitle, segmented, textAt, walk, type FlagCode,
} from './ui'
import { ACCOUNTS, EUR_USD, SPENDING, SPENT } from './data'

function currencyPanel(
  s: Screen,
  name: string,
  y: number,
  o: { label: string; code: FlagCode; currency: string; amount: string; balance: string; active: boolean },
): NodeId {
  return s.group(name, [
    panel(s, 'Background', M, y, CW, 112, o.active ? { stroke: C.accent } : {}),
    s.text('Label', o.label, M + 20, y + 16, { size: 12.5, weight: 500, color: C.grey }),
    flag(s, o.code, M + 38, y + 58, 18),
    textAt(s, 'Currency', o.currency, M + 66, y + 58, { size: 18, weight: 700, family: DISPLAY }),
    s.icon('Chevron', I.chevronDown, M + 66 + s.measure(o.currency, { size: 18, weight: 700, family: DISPLAY }).width + 4, y + 50, 16, C.ink),
    textAt(s, 'Amount', o.amount, W - M - 20, y + 58, { size: 32, weight: 700, family: DISPLAY, anchor: 'right', letterSpacing: -0.02, color: o.active ? C.ink : C.ink }),
    s.text('Balance', o.balance, M + 20, y + 84, { size: 12.5, color: C.grey }),
  ])
}

export function exchange(s: Screen): void {
  statusBar(s, C.ink)
  navBar(s, 'Exchange', { right: [['Rate Alert', I.bellAlert]] })
  const sell = 500
  currencyPanel(s, 'From / EUR', 112, {
    label: 'You sell', code: 'EU', currency: 'EUR', amount: sell.toFixed(2), balance: `Balance ${money(ACCOUNTS.eur.balance)}`, active: true,
  })
  currencyPanel(s, 'To / USD', 236, {
    label: 'You get', code: 'US', currency: 'USD', amount: (sell * EUR_USD).toFixed(2), balance: `Balance ${money(ACCOUNTS.usd.balance, '$')}`, active: false,
  })
  roundButton(s, 'Swap', I.swapVertical, W / 2, 230, { r: 24, fill: C.accent, color: C.white, iconSize: 22 })
  s.circle('Swap Ring', W / 2, 230, 28, { fill: solid(C.white, 0), stroke: { color: C.surface, width: 4 } })

  s.group('Rate', [
    s.icon('Icon', I.trendUp, M + 4, 370, 20, C.green),
    textAt(s, 'Rate', `1 EUR = ${EUR_USD.toFixed(4)} USD`, M + 32, 380, { size: 15, weight: 600 }),
    textAt(s, 'Change', '+0.42% this week', W - M - 4, 380, { size: 13, weight: 600, color: C.green, anchor: 'right' }),
  ])

  // A week of EUR/USD.
  const cy = 412
  const ch = 268
  const values = walk(random(18), 29, 1.0805, EUR_USD, 0.0016)
  const lo = 1.077
  const hi = 1.089
  const gx = M + 16
  const gw = CW - 64
  const gy = cy + 76
  const gh = 144
  const pts = plot(values, gx, gy, gw, gh, lo, hi)
  const card = panel(s, 'Background', M, cy, CW, ch)
  const grid: NodeId[] = []
  for (const v of [1.08, 1.083, 1.086, 1.089]) {
    const y = gy + gh - ((v - lo) / (hi - lo)) * gh
    grid.push(s.line(`Grid / ${v.toFixed(3)}`, gx, y, gx + gw, y, C.line, 1))
    grid.push(textAt(s, `Axis / ${v.toFixed(3)}`, v.toFixed(3), W - M - 12, y, { size: 11, color: C.faint, anchor: 'right' }))
  }
  const days = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  const dayLabels = days.map((d, i) => s.text(`Day / ${d}`, d, gx + (gw * i) / (days.length - 1), gy + gh + 10, {
    size: 11, color: i === days.length - 1 ? C.ink : C.faint, weight: i === days.length - 1 ? 600 : 400, anchor: 'center',
  }))
  const last = pts[pts.length - 1]!
  s.group('Rate Chart', [
    card,
    s.text('Title', 'EUR to USD', M + 16, cy + 18, { size: 15, weight: 700, family: DISPLAY }),
    segmented(s, 'Range', ['1D', '1W', '1M', '1Y'], 1, W - M - 16 - 164, cy + 12, 164, { h: 32, size: 12 }),
    s.group('Grid', grid),
    areaChart(s, 'Series', pts, gy + gh, C.accent),
    s.group('Days', dayLabels),
    s.circle('Now Halo', last[0], last[1], 9, { fill: solid(C.accent, 0.18) }),
    s.circle('Now', last[0], last[1], 5, { fill: C.accent, stroke: { color: C.white, width: 2 } }),
  ])

  s.group('Fee Note', [
    s.icon('Icon', I.clock, M + 4, 698, 18, C.grey),
    s.text('Text', 'Rate locked for 0:28 · No exchange fees on Metal', M + 30, 698, { size: 13, color: C.grey }),
  ])
  button(s, `Exchange ${money(sell)}`, M, 752, CW)
  homeIndicator(s, C.ink)
}

export function analytics(s: Screen): void {
  statusBar(s, C.ink)
  navBar(s, 'Spending', { right: [['Calendar', I.calendar]] })
  segmented(s, 'Period', ['Week', 'Month', 'Year'], 1, M, 112, CW)
  s.group('Month Switcher', [
    s.icon('Previous', I.chevronLeft, M + 4, 170, 20, C.ink),
    s.text('Month', 'September 2026', W / 2, 169, { size: 15, weight: 600, anchor: 'center' }),
    s.icon('Next', I.chevronRight, W - M - 24, 170, 20, C.faint),
  ])

  const cx = W / 2
  const cyy = 306
  const r1 = 92
  const r0 = 66
  const slices: NodeId[] = []
  let at = 0
  const gap = 0.006
  for (const c of SPENDING) {
    const f = c.amount / SPENT
    slices.push(s.path(`Slice / ${c.name}`, donutSlice(cx, cyy, r0, r1, at + gap / 2, at + f - gap / 2), { fill: c.color, closed: true }))
    at += f
  }
  s.group('Donut', [
    s.group('Slices', slices),
    s.text('Label', 'Spent so far', cx, cyy - 38, { size: 13, color: C.grey, anchor: 'center' }),
    textAt(s, 'Total', money(SPENT), cx, cyy - 2, { size: 26, weight: 700, family: DISPLAY, anchor: 'center', letterSpacing: -0.02 }),
    pill(s, 'Versus', '12% vs Aug', cx, cyy + 22, { fill: C.greenSoft, color: C.green, h: 22, size: 11, anchor: 'center', icon: I.arrowDown }).id,
  ])

  sectionTitle(s, 'Budgets', 422, { action: 'Edit' })
  const py = 456
  const rowH = 56
  const rows: NodeId[] = [panel(s, 'Background', M, py, CW, SPENDING.length * rowH + 12)]
  SPENDING.forEach((c, i) => {
    const y = py + 6 + i * rowH
    const over = c.budget !== undefined && c.amount > c.budget
    const x = M + 16
    const tx = x + 52
    const right = W - M - 16
    const name: TextOptions = { size: 15, weight: 600 }
    const parts: NodeId[] = []
    if (i > 0) parts.push(divider(s, tx, y, right - tx))
    parts.push(
      s.circle('Badge', x + 20, y + rowH / 2, 20, { fill: c.soft }),
      s.icon('Icon', c.icon, x + 10, y + rowH / 2 - 10, 20, c.color),
      s.text('Name', c.name, tx, y + 9, name),
    )
    const spent = money(c.amount)
    if (c.budget !== undefined) {
      const of = ` / ${money(c.budget, '€', { decimals: 0 })}`
      const ofW = s.measure(of, { size: 13, color: C.grey }).width
      parts.push(
        s.text('Budget', of, right, y + 11, { size: 13, color: C.grey, anchor: 'right' }),
        s.text('Spent', spent, right - ofW, y + 10, { size: 14, weight: 600, color: over ? C.red : C.ink, anchor: 'right' }),
        progressBar(s, 'Progress', tx, y + 36, right - tx, c.amount / c.budget, over ? C.red : c.color),
      )
    } else {
      parts.push(
        s.text('Spent', spent, right, y + 10, { size: 14, weight: 600, anchor: 'right' }),
        s.text('Note', 'No budget set', tx, y + 31, { size: 12.5, color: C.grey }),
      )
    }
    rows.push(s.group(`Budget / ${c.name}`, parts))
  })
  s.group('Budget List', rows)
  homeIndicator(s, C.ink)
}

export function vaults(s: Screen): void {
  statusBar(s, C.ink)
  navBar(s, 'Savings', { right: [['New Vault', I.plus]] })

  const total = 6840
  s.group('Vault Summary', [
    s.rect('Background', M, 112, CW, 164, {
      fill: linear([['#5B74FF', 0], [C.accentDeep, 1]], 0, 0, 1, 1), radius: 24,
      shadow: { x: 0, y: 12, blur: 28, color: { r: 61, g: 90, b: 254, a: 0.28 }, visible: true },
    }),
    s.circle('Ring Large', W - M - 56, 170, 44, { fill: solid(C.white, 0), stroke: { color: C.white, width: 10, alpha: 0.08 } }),
    s.circle('Ring Small', W - M - 56, 170, 22, { fill: solid(C.white, 0.08) }),
    s.icon('Icon', I.vault, W - M - 68, 158, 24, C.white),
    s.text('Label', 'Total in vaults', M + 20, 132, { size: 13, color: C.white, opacity: 0.8 }),
    s.text('Amount', money(total), M + 20, 152, { size: 34, weight: 700, family: DISPLAY, color: C.white, letterSpacing: -0.02 }),
    pill(s, 'Rate', '3.25% AER', M + 20, 206, { fill: solid(C.white, 0.18), color: C.white, h: 26 }).id,
    s.text('Interest', `+${money(6.7)} interest so far in September`, M + 20, 244, { size: 13, color: C.white, opacity: 0.85 }),
  ])

  sectionTitle(s, 'Your vaults', 300, { action: '3 active' })
  const list: Array<[string, number, number, string, string, string]> = [
    ['Japan trip', 2850, 4000, 'Mar 2027', C.accent, '+€150 every month'],
    ['New laptop', 1100, 2000, 'Dec 2026', C.purple, 'Round-ups on'],
    ['Emergency fund', 2890, 5000, 'No deadline', C.teal, '+€200 on payday'],
  ]
  list.forEach(([name, saved, goal, when, color, rule], i) => {
    const y = 336 + i * 100
    s.group(`Vault / ${name}`, [
      panel(s, 'Background', M, y, CW, 88),
      progressRing(s, 'Progress', M + 48, y + 44, 24, saved / goal, color, { width: 6 }),
      s.text('Name', name, M + 90, y + 16, { size: 16, weight: 600 }),
      s.text('Saved', `${money(saved, '€', { decimals: 0 })} of ${money(goal, '€', { decimals: 0 })}`, M + 90, y + 39, { size: 13, color: C.grey }),
      s.text('Rule', rule, M + 90, y + 58, { size: 12, weight: 500, color }),
      s.text('Target Label', 'Target', W - M - 16, y + 18, { size: 12, color: C.grey, anchor: 'right' }),
      s.text('Target', when, W - M - 16, y + 36, { size: 13, weight: 600, anchor: 'right' }),
    ])
  })
  s.group('Round-ups', [
    panel(s, 'Background', M, 640, CW, 76),
    listRow(s, {
      x: M + 16, y: 640, w: CW - 32, h: 76, icon: I.repeat, iconColor: C.purple, iconBg: C.purpleSoft,
      title: 'Round-ups', detail: 'Spare change from card payments goes to New laptop · €18.40 this month', toggle: true,
    }),
  ])
  button(s, 'Add money to a vault', M, 752, CW, { variant: 'soft', icon: I.plus })
  homeIndicator(s, C.ink)
}
