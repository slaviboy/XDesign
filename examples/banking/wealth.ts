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
 * Investing: the portfolio and watchlist, one stock, and crypto. Every
 * ticker and coin is invented; the coins are plain discs with a geometric
 * glyph, so none resembles a real one.
 */

import type { NodeId } from '@/document/types'
import { random, solid, type Screen, type TextOptions } from '../kit'
import { homeIndicator, statusBar } from '../components'
import { C, CW, DISPLAY, M, W, money } from './theme'
import { I } from './icons'
import {
  areaChart, badge, bigAmount, button, chip, divider, navBar, pageTitle, panel, pill, plot, sectionTitle, segmented, smooth, tabBar,
  textAt, walk,
} from './ui'

interface Stock {
  ticker: string
  name: string
  price: number
  change: number
  color: string
  seed: number
}

const STOCKS: Stock[] = [
  { ticker: 'LMNT', name: 'Lumen Tech', price: 182.4, change: 1.8, color: C.accent, seed: 3 },
  { ticker: 'HLIO', name: 'Helio Energy', price: 46.12, change: -0.62, color: C.orange, seed: 8 },
  { ticker: 'NWND', name: 'Northwind Air', price: 23.87, change: 3.21, color: C.sky, seed: 14 },
  { ticker: 'QNTB', name: 'Quanta Bio', price: 91.05, change: 0.94, color: C.teal, seed: 21 },
  { ticker: 'ARBF', name: 'Arbor Foods', price: 58.3, change: -1.13, color: C.rose, seed: 27 },
]

function pct(n: number): string {
  return `${n > 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}%`
}

/** A sparkline: `n` steps from a little below or above to where it closed. */
function sparkline(s: Screen, name: string, seed: number, up: boolean, x: number, y: number, w: number, h: number): NodeId {
  const values = walk(random(seed), 18, up ? 0 : 1, up ? 1 : 0, 0.9)
  return s.path(name, smooth(plot(values, x, y, w, h)), { stroke: up ? C.green : C.red, width: 1.8 })
}

/** Horizontal gridlines with their values at the right edge. */
function grid(s: Screen, values: number[], lo: number, hi: number, x: number, y: number, w: number, h: number, label: (v: number) => string): NodeId {
  const ids: NodeId[] = []
  for (const v of values) {
    const gy = y + h - ((v - lo) / (hi - lo)) * h
    ids.push(s.path(`Grid / ${label(v)}`, `M${x} ${gy} H${x + w}`, { stroke: C.line, width: 1 }))
    ids.push(textAt(s, `Axis / ${label(v)}`, label(v), x + w + 6, gy, { size: 10.5, color: C.faint }))
  }
  return s.group('Grid', ids)
}

export function invest(s: Screen): void {
  statusBar(s, C.ink)
  pageTitle(s, 'Invest', { right: [['Search', I.search]] })
  const value = 12486.2
  const change = 212.64
  s.group('Portfolio', [
    s.text('Label', 'Portfolio value', M, 112, { size: 14, color: C.grey }),
    bigAmount(s, 'Value', value, M, 132, { size: 40 }),
    pill(s, 'Change', `+${money(change)} (1.73%) past day`, M, 186, { fill: C.greenSoft, color: C.green, h: 26, icon: I.arrowUp }).id,
  ])

  // One month, 11 Aug to 11 Sep.
  const py = 228
  const gx = M + 16
  const gw = CW - 64
  const gy = py + 20
  const gh = 120
  const lo = 11400
  const hi = 12600
  const series = walk(random(41), 32, 11640, value, 180)
  const pts = plot(series, gx, gy, gw, gh, lo, hi)
  const last = pts[pts.length - 1]!
  s.group('Portfolio Chart', [
    panel(s, 'Background', M, py, CW, 204),
    grid(s, [11600, 12000, 12400], lo, hi, gx, gy, gw, gh, (v) => `€${(v / 1000).toFixed(1)}k`),
    areaChart(s, 'Series', pts, gy + gh, C.accent),
    s.circle('Now', last[0], last[1], 5, { fill: C.accent, stroke: { color: C.white, width: 2 } }),
    segmented(s, 'Range', ['1D', '1W', '1M', '3M', '1Y', 'All'], 2, M + 12, py + 152, CW - 24, { h: 36, size: 12 }),
  ])

  sectionTitle(s, 'Watchlist', 452, { action: 'Edit' })
  const ly = 486
  s.group('Watchlist', [
    panel(s, 'Background', M, ly, CW, STOCKS.length * 64 + 8),
    ...STOCKS.map((st, i) => {
      const y = ly + 4 + i * 64
      const up = st.change > 0
      return s.group(`Stock / ${st.ticker}`, [
        ...(i > 0 ? [divider(s, M + 72, y, CW - 88)] : []),
        badge(s, 'Logo', { kind: 'mono', letters: st.ticker.slice(0, 2), color: st.color }, M + 38, y + 32, 22),
        s.text('Name', st.name, M + 72, y + 13, { size: 15, weight: 600 }),
        s.text('Ticker', st.ticker, M + 72, y + 34, { size: 13, color: C.grey }),
        sparkline(s, 'Sparkline', st.seed, up, M + 182, y + 20, 56, 24),
        s.text('Price', money(st.price, '$'), W - M - 16, y + 12, { size: 15, weight: 600, anchor: 'right' }),
        s.text('Change', pct(st.change), W - M - 16, y + 34, { size: 13, weight: 600, color: up ? C.green : C.red, anchor: 'right' }),
      ])
    }),
  ])
  tabBar(s, 'Invest')
  homeIndicator(s, C.ink)
}

export function stockDetail(s: Screen): void {
  statusBar(s, C.ink)
  navBar(s, '', { buttonFill: C.surface, right: [['Share', I.share], ['On Watchlist', I.star]] })
  const st = STOCKS[0]!
  s.group('Stock Header', [
    badge(s, 'Logo', { kind: 'mono', letters: 'LM', color: st.color }, M + 24, 132, 24),
    s.text('Name', st.name, M + 60, 112, { size: 20, weight: 700, family: DISPLAY }),
    s.text('Ticker', 'LMNT · US stock · Technology', M + 60, 139, { size: 13, color: C.grey }),
  ])
  bigAmount(s, 'Price', st.price, M, 172, { size: 40, symbol: '$' })
  const changeText: TextOptions = { size: 14, weight: 600, color: C.green }
  const changeLabel = `+$3.22 (${pct(st.change).slice(1)})`
  s.group('Change', [
    s.text('Value', changeLabel, M, 226, changeText),
    s.text('When', '  At close, Thu 10 Sep', M + s.measure(changeLabel, changeText).width, 226, { size: 14, color: C.grey }),
  ])

  // The last session, with yesterday's close dashed across it.
  const gx = M
  const gw = CW - 36
  const gy = 268
  const gh = 148
  const lo = 177
  const hi = 185
  const session = walk(random(77), 40, 179.62, st.price, 1.1)
  const pts = plot(session, gx, gy, gw, gh, lo, hi)
  const prevY = gy + gh - ((179.18 - lo) / (hi - lo)) * gh
  const last = pts[pts.length - 1]!
  const times = ['09:30', '11:30', '13:30', '16:00']
  s.group('Price Chart', [
    grid(s, [178, 180, 182, 184], lo, hi, gx, gy, gw, gh, (v) => v.toFixed(0)),
    s.group('Previous Close', Array.from({ length: Math.floor(gw / 8) }, (_, i) =>
      s.rect(`Dash ${i + 1}`, gx + i * 8, prevY - 0.75, 4, 1.5, { fill: C.faint, radius: 0.75 }))),
    areaChart(s, 'Series', pts, gy + gh, C.green, { alpha: 0.18 }),
    s.circle('Now Halo', last[0], last[1], 9, { fill: solid(C.green, 0.18) }),
    s.circle('Now', last[0], last[1], 4.5, { fill: C.green, stroke: { color: C.white, width: 2 } }),
    s.group('Times', times.map((t, i) => s.text(`Time / ${t}`, t, gx + (gw * i) / (times.length - 1), gy + gh + 8, {
      size: 10.5, color: C.faint, anchor: i === 0 ? 'left' : i === times.length - 1 ? 'right' : 'center',
    }))),
    s.text('Previous Close Label', 'Prev. close 179.18', gx + 4, prevY + 4, { size: 10.5, weight: 500, color: C.grey }),
  ])

  let x = M
  const chips: NodeId[] = []
  for (const [i, label] of ['1D', '1W', '1M', '3M', '1Y', 'All'].entries()) {
    const c = chip(s, label, x, 450, i === 0, { h: 32 })
    chips.push(c.id)
    x += c.width + 6
  }
  s.group('Range', chips)

  s.group('Position', [
    s.rect('Background', M, 498, CW, 72, { fill: C.surface, radius: 18 }),
    s.text('Label', 'Your position', M + 16, 512, { size: 12.5, color: C.grey }),
    s.text('Value', `12 shares · ${money(12 * st.price, '$')}`, M + 16, 532, { size: 16, weight: 700, family: DISPLAY }),
    s.text('Return Label', 'Total return', W - M - 16, 512, { size: 12.5, color: C.grey, anchor: 'right' }),
    s.text('Return', '+$342.60 (18.56%)', W - M - 16, 533, { size: 14, weight: 600, color: C.green, anchor: 'right' }),
  ])

  const stats: Array<[string, string]> = [
    ['Open', '179.62'], ['High', '183.05'], ['Low', '178.91'], ['Prev. close', '179.18'],
    ['Volume', '12.6M'], ['Market cap', '$48.2B'], ['P/E ratio', '31.4'], ['Div. yield', '0.42%'],
  ]
  const cw = CW / 4
  s.group('Stats', stats.map(([label, value], i) => {
    const x0 = M + (i % 4) * cw
    const y0 = 590 + Math.floor(i / 4) * 52
    return s.group(`Stat / ${label}`, [
      s.text('Label', label, x0, y0, { size: 12, color: C.grey }),
      s.text('Value', value, x0, y0 + 18, { size: 15, weight: 600 }),
    ])
  }))
  pill(s, 'Earnings', 'Next earnings report · Thu 29 Oct', M, 700, { fill: C.accentSoft, color: C.accent, h: 32, icon: I.calendar })
  const bw = (CW - 12) / 2
  button(s, 'Sell', M, 752, bw, { variant: 'light' })
  button(s, 'Buy', M + bw + 12, 752, bw)
  homeIndicator(s, C.ink)
}

const COINS: Array<{ name: string; symbol: string; amount: string; value: number; change: number; color: string; glyph: string }> = [
  { name: 'Aurum', symbol: 'AUR', amount: '0.0352', value: 1842.3, change: 3.12, color: '#E2A93B', glyph: 'M12 6.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11z M12 10v4' },
  { name: 'Nimbus', symbol: 'NMB', amount: '0.3150', value: 768.4, change: 2.05, color: '#3B82F6', glyph: 'M12 6.5l6 10.5H6z' },
  { name: 'Solace', symbol: 'SLC', amount: '2.40', value: 356.2, change: -1.34, color: '#14B8A6', glyph: 'M12 5.5l5.6 3.25v6.5L12 18.5l-5.6-3.25v-6.5z' },
  { name: 'Tidal', symbol: 'TDL', amount: '1,250', value: 171.9, change: 4.8, color: '#8B5CF6', glyph: 'M5.5 10c2.2-2 4.3-2 6.5 0s4.3 2 6.5 0 M5.5 14.5c2.2-2 4.3-2 6.5 0s4.3 2 6.5 0' },
  { name: 'Ember', symbol: 'EMB', amount: '310', value: 75.8, change: -0.62, color: '#F97316', glyph: 'M12 5.5l6 6.5-6 6.5-6-6.5z' },
]

function coin(s: Screen, c: (typeof COINS)[number], cx: number, cy: number, r: number): NodeId {
  return s.group(`Coin / ${c.symbol}`, [
    s.circle('Disc', cx, cy, r, { fill: c.color }),
    s.circle('Rim', cx, cy, r - 3, { fill: solid(C.white, 0), stroke: { color: C.white, width: 1.2, alpha: 0.35 } }),
    s.icon('Glyph', c.glyph, cx - r * 0.55, cy - r * 0.55, r * 1.1, C.white, { width: 2 }),
  ])
}

export function crypto(s: Screen): void {
  statusBar(s, C.ink)
  pageTitle(s, 'Crypto', { right: [['Search', I.search]] })
  const total = COINS.reduce((sum, c) => sum + c.value, 0)
  s.group('Balance', [
    s.text('Label', 'Crypto balance', M, 112, { size: 14, color: C.grey }),
    bigAmount(s, 'Value', total, M, 132, { size: 40 }),
    pill(s, 'Change', `+${money(86.4)} (2.76%) 24h`, M, 186, { fill: C.greenSoft, color: C.green, h: 26, icon: I.arrowUp }).id,
  ])

  const py = 228
  const gx = M + 16
  const gw = CW - 64
  const gy = py + 20
  const gh = 104
  const series = walk(random(9), 30, total - 86.4, total, 70)
  const lo = 3040
  const hi = 3280
  const pts = plot(series, gx, gy, gw, gh, lo, hi)
  const last = pts[pts.length - 1]!
  s.group('Balance Chart', [
    panel(s, 'Background', M, py, CW, 188),
    grid(s, [3100, 3200], lo, hi, gx, gy, gw, gh, (v) => `€${(v / 1000).toFixed(1)}k`),
    areaChart(s, 'Series', pts, gy + gh, C.violet),
    s.circle('Now', last[0], last[1], 5, { fill: C.violet, stroke: { color: C.white, width: 2 } }),
    segmented(s, 'Range', ['24H', '1W', '1M', '1Y', 'All'], 0, M + 12, py + 138, CW - 24, { h: 36, size: 12 }),
  ])

  // Allocation: one bar split by value, and a legend under it.
  const ay = 432
  const card = panel(s, 'Background', M, ay, CW, 92)
  const bar: NodeId[] = []
  let x = M + 16
  const bw = CW - 32
  COINS.forEach((c, i) => {
    const w = (c.value / total) * bw
    bar.push(s.rect(`Share / ${c.symbol}`, x, ay + 44, Math.max(2, w - (i < COINS.length - 1 ? 2 : 0)), 10, {
      fill: c.color, radius: i === 0 ? [5, 0, 0, 5] : i === COINS.length - 1 ? [0, 5, 5, 0] : 0,
    }))
    x += w
  })
  // The legend, justified across the bar's width.
  const legendText: TextOptions = { size: 11, weight: 500, color: C.ink2 }
  // Whole percentages that still add up to 100: round down, then hand the
  // missing points to the largest remainders.
  const exact = COINS.map((c) => (c.value / total) * 100)
  const shares = exact.map(Math.floor)
  const order = exact.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0])
  const missing = 100 - shares.reduce((a, b) => a + b, 0)
  for (let k = 0; k < missing; k++) shares[order[k]![1]]! += 1
  const labels = COINS.map((c, i) => `${c.symbol} ${shares[i]}%`)
  const widths = labels.map((l) => 12 + s.measure(l, legendText).width)
  const spare = (bw - widths.reduce((a, b) => a + b, 0)) / (COINS.length - 1)
  let lx = M + 16
  const legend = COINS.map((c, i) => {
    const id = s.group(`Legend / ${c.symbol}`, [
      s.circle('Dot', lx + 4, ay + 73, 4, { fill: c.color }),
      textAt(s, 'Label', labels[i]!, lx + 12, ay + 73, legendText),
    ])
    lx += widths[i]! + spare
    return id
  })
  s.group('Allocation', [
    card,
    s.text('Title', 'Allocation', M + 16, ay + 14, { size: 14, weight: 700, family: DISPLAY }),
    s.text('Count', '5 assets', W - M - 16, ay + 15, { size: 13, color: C.grey, anchor: 'right' }),
    s.group('Bar', bar),
    s.group('Legend', legend),
  ])

  sectionTitle(s, 'Your assets', 544, { action: 'Buy' })
  const ly = 578
  s.group('Assets', [
    panel(s, 'Background', M, ly, CW, COINS.length * 64 + 8),
    ...COINS.map((c, i) => {
      const y = ly + 4 + i * 64
      return s.group(`Asset / ${c.name}`, [
        ...(i > 0 ? [divider(s, M + 72, y, CW - 88)] : []),
        coin(s, c, M + 38, y + 32, 22),
        s.text('Name', c.name, M + 72, y + 13, { size: 15, weight: 600 }),
        s.text('Holding', `${c.amount} ${c.symbol}`, M + 72, y + 34, { size: 13, color: C.grey }),
        s.text('Value', money(c.value), W - M - 16, y + 12, { size: 15, weight: 600, anchor: 'right' }),
        s.text('Change', pct(c.change), W - M - 16, y + 34, { size: 13, weight: 600, color: c.change > 0 ? C.green : C.red, anchor: 'right' }),
      ])
    }),
  ])
  tabBar(s, 'Crypto')
  homeIndicator(s, C.ink)
}
