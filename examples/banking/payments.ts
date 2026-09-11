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
 * Payments: the hub, and one transfer from start to finish — €120.00 to
 * Sofia for concert tickets — then a dinner split four ways.
 */

import type { NodeId } from '@/document/types'
import { linear, solid, type Screen, type TextOptions } from '../kit'
import { homeIndicator, statusBar } from '../components'
import { C, CARD_SHADOW, CW, DISPLAY, M, W, money } from './theme'
import { I } from './icons'
import {
  avatar, badge, bigAmount, button, divider, flag, keypad, navBar, pageTitle, panel, pill, sectionTitle, segmented, tabBar, textAt,
} from './ui'
import { ACCOUNTS, MERCHANT, type People } from './data'

const AMOUNT = 120
const NOTE = 'Concert tickets'

export function paymentsHub(s: Screen, people: People): void {
  statusBar(s, C.ink)
  pageTitle(s, 'Payments', { right: [['Scan to Pay', I.qr]] })

  const tiles: Array<[string, string, string, boolean]> = [
    ['Send', 'To anyone, instantly', I.send, true],
    ['Request', 'Get paid back', I.request, false],
    ['Scheduled', '3 upcoming', I.calendar, false],
    ['Bills', '2 due in September', I.receipt, false],
  ]
  const tw = (CW - 12) / 2
  s.group('Payment Types', tiles.map(([title, detail, icon, on], i) => {
    const x = M + (i % 2) * (tw + 12)
    const y = 116 + Math.floor(i / 2) * 116
    return s.group(`Tile / ${title}`, [
      s.rect('Background', x, y, tw, 104, on
        ? { fill: linear([['#5B74FF', 0], [C.accentDeep, 1]], 0, 0, 1, 1), radius: 20, shadow: { x: 0, y: 10, blur: 24, color: { r: 61, g: 90, b: 254, a: 0.28 }, visible: true } }
        : { fill: C.white, radius: 20, shadow: CARD_SHADOW }),
      s.circle('Badge', x + 34, y + 34, 18, { fill: on ? solid(C.white, 0.18) : C.accentSoft }),
      s.icon('Icon', icon, x + 24, y + 24, 20, on ? C.white : C.accent),
      s.text('Title', title, x + 16, y + 60, { size: 16, weight: 700, family: DISPLAY, color: on ? C.white : C.ink }),
      s.text('Detail', detail, x + 16, y + 80, { size: 12, color: on ? C.white : C.grey, opacity: on ? 0.8 : 1 }),
    ])
  }))

  sectionTitle(s, 'Contacts', 360, { action: 'See all' })
  const contacts = ['Sofia', 'Maya', 'Liam', 'Kenji', 'Aisha']
  const slot = CW / 6
  s.group('Contacts Row', [
    s.group('Contact / New', [
      s.circle('Background', M + slot / 2, 422, 26, { fill: C.white, stroke: { color: C.faint, width: 1.5, dash: [4, 4] } }),
      s.icon('Icon', I.plus, M + slot / 2 - 11, 411, 22, C.accent),
      s.text('Name', 'New', M + slot / 2, 456, { size: 12.5, weight: 500, color: C.ink2, anchor: 'center' }),
    ]),
    ...contacts.map((first, i) => {
      const cx = M + slot * (i + 1) + slot / 2
      return s.group(`Contact / ${first}`, [
        avatar(s, 'Avatar', people[first]!, cx, 422, 26),
        s.text('Name', first, cx, 456, { size: 12.5, weight: 500, color: C.ink2, anchor: 'center' }),
      ])
    }),
  ])

  sectionTitle(s, 'Upcoming', 500, { action: 'Manage' })
  const upcoming: Array<[string, string, string, number, 'casa' | 'voltra' | 'pulse']> = [
    ['Voltra Energy', 'Bill · Tue 15 Sep', 'Direct debit', -64.2, 'voltra'],
    ['Pulse Fitness', 'Membership · Fri 18 Sep', 'Card', -39.0, 'pulse'],
    ['Rent · Casa Lume', 'Transfer · Thu 1 Oct', 'Monthly', -950.0, 'casa'],
  ]
  const uy = 534
  s.group('Upcoming Payments', [
    panel(s, 'Background', M, uy, CW, upcoming.length * 64 + 16),
    ...upcoming.map(([title, detail, how, amount, key], i) => {
      const y = uy + 8 + i * 64
      return s.group(`Upcoming / ${title}`, [
        badge(s, 'Logo', MERCHANT[key]!, M + 38, y + 32, 22),
        s.text('Name', title, M + 72, y + 12, { size: 15, weight: 600 }),
        s.text('Detail', detail, M + 72, y + 34, { size: 13, color: C.grey }),
        s.text('Amount', money(amount), W - M - 16, y + 12, { size: 15, weight: 600, anchor: 'right' }),
        s.text('Method', how, W - M - 16, y + 34, { size: 13, color: C.grey, anchor: 'right' }),
      ])
    }),
  ])
  tabBar(s, 'Payments')
  homeIndicator(s, C.ink)
}

export function sendRecipient(s: Screen, people: People): void {
  statusBar(s, C.ink)
  navBar(s, 'Send to', { left: 'close', buttonFill: C.surface })
  s.group('Search Bar', [
    s.rect('Field', M, 112, CW, 48, { fill: C.surface, radius: 24 }),
    s.icon('Icon', I.search, M + 16, 124, 22, C.faint),
    textAt(s, 'Placeholder', 'Name, @handle, phone or IBAN', M + 48, 136, { size: 15, color: C.faint }),
  ])
  s.group('New Recipient', [
    s.circle('Badge', M + 22, 202, 22, { fill: C.accentSoft }),
    s.icon('Icon', I.bank, M + 11, 191, 22, C.accent),
    s.text('Title', 'New bank transfer', M + 56, 184, { size: 15, weight: 600 }),
    s.text('Detail', 'To any IBAN in 36 countries', M + 56, 204, { size: 13, color: C.grey }),
    s.icon('Chevron', I.chevronRight, W - M - 18, 193, 18, C.faint),
  ])

  sectionTitle(s, 'Recent', 248, { size: 16 })
  const recentPeople = ['Sofia', 'Maya', 'Liam', 'Kenji', 'Aisha']
  const slot = CW / 5
  s.group('Recent Contacts', recentPeople.map((first, i) => {
    const cx = M + slot * i + slot / 2
    const on = first === 'Sofia'
    const ids = [avatar(s, 'Avatar', people[first]!, cx, 306, 28)]
    if (on) ids.unshift(s.circle('Selected', cx, 306, 32, { fill: solid(C.white, 0), stroke: { color: C.accent, width: 2 } }))
    ids.push(s.circle('Nova Badge', cx + 20, 326, 8, { fill: C.accent, stroke: { color: C.white, width: 2 } }))
    ids.push(s.icon('Nova Star', I.check, cx + 15.5, 321.5, 9, C.white, { width: 2.6 }))
    ids.push(s.text('Name', first, cx, 344, { size: 12.5, weight: on ? 600 : 500, color: on ? C.accent : C.ink2, anchor: 'center' }))
    return s.group(`Recent / ${first}`, ids)
  }))

  sectionTitle(s, 'All contacts', 388, { size: 16 })
  const book: Array<[string, Array<[string, string]>]> = [
    ['A', [['Aisha', 'Aisha Khan']]],
    ['C', [['Chloe', 'Chloe Martin']]],
    ['D', [['Daniel', 'Daniel Kim']]],
    ['E', [['Ethan', 'Ethan Moore']]],
    ['G', [['Grace', 'Grace Okafor']]],
    ['I', [['Isabella', 'Isabella Lopez']]],
    ['J', [['Jonas', 'Jonas Berg']]],
  ]
  const handles: Record<string, string> = {
    Aisha: '@aisha.k', Chloe: '+351 913 204 118', Daniel: '@dan.kim', Ethan: '@ethanmoore', Grace: '@grace.ok',
    Isabella: '+351 926 551 042', Jonas: '@jonas.berg',
  }
  let y = 420
  const list: NodeId[] = []
  for (const [letter, entries] of book) {
    list.push(s.text(`Letter / ${letter}`, letter, M, y + 2, { size: 13, weight: 700, color: C.accent }))
    for (const [first, name] of entries) {
      const nova = handles[first]!.startsWith('@')
      list.push(s.group(`Contact / ${name}`, [
        avatar(s, 'Avatar', people[first]!, M + 44, y + 26, 22),
        s.text('Name', name, M + 78, y + 7, { size: 15, weight: 600 }),
        s.text('Handle', nova ? `${handles[first]!} · on Nova` : handles[first]!, M + 78, y + 27, { size: 13, color: C.grey }),
      ]))
      y += 56
    }
  }
  s.group('Contact List', list)
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
  s.group('Alphabet Index', letters.map((l, i) =>
    s.text(`Index / ${l}`, l, W - 10, 408 + i * 15, { size: 10, weight: 600, color: 'AEGI'.includes(l) ? C.accent : C.faint, anchor: 'center' })))
  homeIndicator(s, C.ink)
}

export function sendAmount(s: Screen, people: People): void {
  statusBar(s, C.ink)
  navBar(s, '', { buttonFill: C.surface })
  s.group('To', [
    avatar(s, 'Avatar', people.Sofia!, W / 2, 76, 20),
    s.text('Name', 'Sofia Rossi', W / 2, 104, { size: 15, weight: 600, anchor: 'center' }),
    s.text('Handle', '@sofia.rossi', W / 2, 124, { size: 13, color: C.grey, anchor: 'center' }),
  ])

  s.group('Currency Switch', [
    s.rect('Background', W / 2 - 50, 164, 100, 36, { fill: C.surface, radius: 18 }),
    flag(s, 'EU', W / 2 - 28, 182, 10),
    textAt(s, 'Code', 'EUR', W / 2 - 12, 182, { size: 14, weight: 600 }),
    s.icon('Chevron', I.chevronDown, W / 2 + 22, 174, 16, C.ink),
  ])
  const big: TextOptions = { size: 72, weight: 700, family: DISPLAY, letterSpacing: -0.03 }
  const numW = s.measure('120', big).width
  const symW = s.measure('€', { ...big, size: 40 }).width
  const left = W / 2 - (numW + symW + 4) / 2
  s.group('Amount', [
    s.text('Symbol', '€', left, 232, { ...big, size: 40, color: C.grey }),
    s.text('Value', '120', left + symW + 4, 212, big),
    s.rect('Caret', left + symW + 4 + numW + 4, 228, 3, 60, { fill: C.accent, radius: 1.5 }),
  ])
  s.group('Balance', [
    s.text('Label', `Balance ${money(ACCOUNTS.eur.balance)}`, W / 2, 316, { size: 14, color: C.grey, anchor: 'center' }),
  ])
  s.group('Note Field', [
    s.rect('Background', M + 40, 356, CW - 80, 44, { fill: C.white, radius: 22, stroke: { color: C.line, width: 1.5 } }),
    s.icon('Icon', I.edit, M + 58, 368, 18, C.grey),
    textAt(s, 'Note', NOTE, M + 84, 378, { size: 15, weight: 500 }),
  ])
  s.group('Quick Amounts', [20, 50, 120, 200].map((v, i) => {
    const w = 72
    const x = W / 2 - (4 * w + 3 * 8) / 2 + i * (w + 8)
    const on = v === AMOUNT
    return s.group(`Amount / ${v}`, [
      s.rect('Background', x, 424, w, 36, on ? { fill: C.accentSoft, radius: 18 } : { fill: C.surface, radius: 18 }),
      s.centeredText('Label', `€${v}`, { x, y: 424, w, h: 36 }, { size: 14, weight: 600, color: on ? C.accent : C.ink }),
    ])
  }))
  keypad(s, 484, { left: 'dot', rowH: 64 })
  button(s, 'Continue', M, 752, CW)
  homeIndicator(s, C.ink)
}

export function sendReview(s: Screen, people: People): void {
  statusBar(s, C.ink)
  navBar(s, 'Review transfer')
  s.group('Recipient', [
    avatar(s, 'Avatar', people.Sofia!, W / 2, 152, 36),
    s.circle('Nova Badge', W / 2 + 26, 178, 11, { fill: C.accent, stroke: { color: C.surface, width: 3 } }),
    s.icon('Check', I.check, W / 2 + 19.5, 171.5, 13, C.white, { width: 2.6 }),
    s.text('To', 'You’re sending', W / 2, 202, { size: 14, color: C.grey, anchor: 'center' }),
  ])
  bigAmount(s, 'Amount', AMOUNT, W / 2, 222, { size: 44, anchor: 'center' })
  s.text('Recipient Name', 'to Sofia Rossi', W / 2, 282, { size: 16, weight: 600, anchor: 'center' })

  const rows: Array<[string, string, string?]> = [
    ['From', `Euro account •• ${ACCOUNTS.eur.last4}`],
    ['To', '@sofia.rossi · Nova'],
    ['Reference', NOTE],
    ['Transfer fee', 'Free', C.green],
    ['Arrives', 'In seconds'],
  ]
  const ry = 324
  const rowH = 48
  const ids: NodeId[] = [panel(s, 'Background', M, ry, CW, rows.length * rowH + 16 + 60)]
  rows.forEach(([label, value, color], i) => {
    const y = ry + 8 + i * rowH
    ids.push(s.group(`Row / ${label}`, [
      textAt(s, 'Label', label, M + 20, y + rowH / 2, { size: 14, color: C.grey }),
      textAt(s, 'Value', value, W - M - 20, y + rowH / 2, { size: 14, weight: 600, color: color ?? C.ink, anchor: 'right' }),
    ]))
  })
  const ty = ry + 8 + rows.length * rowH
  ids.push(divider(s, M + 20, ty + 4, CW - 40))
  ids.push(s.group('Row / Total', [
    textAt(s, 'Label', 'Total', M + 20, ty + 34, { size: 16, weight: 600 }),
    textAt(s, 'Value', money(AMOUNT), W - M - 20, ty + 34, { size: 20, weight: 700, family: DISPLAY, anchor: 'right' }),
  ]))
  s.group('Summary', ids)

  const ny = ry + rows.length * rowH + 16 + 60 + 16
  s.group('Notice', [
    s.rect('Background', M, ny, CW, 64, { fill: C.accentSoft, radius: 16 }),
    s.icon('Icon', I.shield, M + 16, ny + 20, 24, C.accent),
    s.text('Text', 'Sofia is a verified Nova user, so this transfer is free and protected.', M + 52, ny + 13, {
      size: 13, color: C.ink2, width: CW - 72, lineHeight: 1.45,
    }),
  ])

  // Slide to pay
  const sy = 740
  s.group('Slide to Send', [
    s.rect('Track', M, sy, CW, 64, { fill: C.ink, radius: 32 }),
    s.text('Label', `Slide to send ${money(AMOUNT)}`, W / 2 + 8, sy + 21, { size: 16, weight: 600, color: C.white, anchor: 'center' }),
    s.icon('Hint', I.chevronRight, W - M - 50, sy + 22, 20, C.white, { width: 2 }),
    s.icon('Hint', I.chevronRight, W - M - 38, sy + 22, 20, C.faint, { width: 2 }),
    s.circle('Knob', M + 32, sy + 32, 26, { fill: C.accent }),
    s.icon('Arrow', I.arrowRight, M + 20, sy + 20, 24, C.white),
  ])
  homeIndicator(s, C.ink)
}

export function sendSuccess(s: Screen): void {
  statusBar(s, C.ink)
  // The moment the check lands: rings spreading out behind it.
  s.group('Success', [
    s.circle('Ring Outer', W / 2, 200, 104, { fill: solid(C.green, 0.05) }),
    s.circle('Ring Middle', W / 2, 200, 80, { fill: solid(C.green, 0.09) }),
    s.circle('Halo', W / 2, 200, 58, { fill: solid(C.green, 0.16) }),
    s.circle('Badge', W / 2, 200, 40, { fill: C.green, shadow: { x: 0, y: 12, blur: 24, color: { r: 15, g: 169, b: 104, a: 0.35 }, visible: true } }),
    s.icon('Check', I.check, W / 2 - 20, 180, 40, C.white, { width: 3.4 }),
    s.circle('Spark', W / 2 - 112, 150, 4, { fill: C.accent }),
    s.circle('Spark', W / 2 + 118, 236, 5, { fill: C.yellow }),
    s.circle('Spark', W / 2 + 96, 118, 3, { fill: C.pink }),
    s.rect('Spark', W / 2 - 96, 262, 10, 4, { fill: C.teal, radius: 2 }),
  ])
  bigAmount(s, 'Amount', AMOUNT, W / 2, 326, { size: 44, anchor: 'center' })
  s.text('Title', 'sent to Sofia Rossi', W / 2, 384, { size: 18, weight: 600, anchor: 'center' })
  s.text('Message', 'It’s already in Sofia’s account. We’ve let her know it’s from you.', W / 2, 414, {
    size: 14, color: C.grey, width: 280, align: 'center', lineHeight: 1.5, anchor: 'center',
  })

  const ry = 484
  const rows: Array<[string, string]> = [
    ['Date', '11 Sep 2026, 09:41'],
    ['Reference', NOTE],
    ['Transaction ID', 'NV-7F3K-29QD'],
    ['From', `Euro •• ${ACCOUNTS.eur.last4}`],
    ['New balance', money(ACCOUNTS.eur.balance - AMOUNT)],
  ]
  const ids: NodeId[] = [s.rect('Background', M, ry, CW, rows.length * 40 + 24, { fill: C.surface, radius: 20 })]
  rows.forEach(([label, value], i) => {
    const y = ry + 12 + i * 40
    ids.push(s.group(`Row / ${label}`, [
      textAt(s, 'Label', label, M + 20, y + 20, { size: 14, color: C.grey }),
      textAt(s, 'Value', value, W - M - 20, y + 20, {
        size: 14, weight: 600, anchor: 'right', family: label === 'Transaction ID' ? 'Roboto Mono' : 'Inter',
      }),
    ]))
  })
  s.group('Receipt', ids)
  const bw = (CW - 12) / 2
  button(s, 'Share receipt', M, 752, bw, { variant: 'light', icon: I.share })
  button(s, 'Done', M + bw + 12, 752, bw)
  homeIndicator(s, C.ink)
}

export function splitBill(s: Screen, people: People): void {
  statusBar(s, C.ink)
  navBar(s, 'Split bill', { buttonFill: C.surface })
  s.group('Bill', [
    s.rect('Background', M, 112, CW, 76, { fill: C.surface, radius: 20 }),
    badge(s, 'Logo', MERCHANT.lumo!, M + 38, 150, 22),
    s.text('Merchant', 'Lumo Trattoria', M + 72, 132, { size: 15, weight: 600 }),
    s.text('When', 'Thu 10 Sep · 20:40', M + 72, 152, { size: 13, color: C.grey }),
    textAt(s, 'Total', money(184), W - M - 18, 150, { size: 20, weight: 700, family: DISPLAY, anchor: 'right' }),
  ])
  segmented(s, 'Split Mode', ['Equally', 'By amount', 'By shares'], 0, M, 208, CW, { h: 44 })

  s.text('People Title', 'Split between 4', M, 276, { size: 16, weight: 700, family: DISPLAY })
  s.text('Each', `${money(46)} each`, W - M, 278, { size: 14, weight: 600, color: C.accent, anchor: 'right' })
  const who: Array<[string, string, string, string]> = [
    ['Emma', 'You', 'Paid the bill', 'paid'],
    ['Maya', 'Maya Chen', '@maya.chen', 'request'],
    ['Liam', 'Liam Carter', '@liamcarter', 'request'],
    ['Kenji', 'Kenji Tanaka', '@kenji.t', 'request'],
  ]
  const py = 308
  const rowH = 64
  const rows: NodeId[] = [panel(s, 'Background', M, py, CW, who.length * rowH + 8 + 56, { shadow: false, stroke: C.line })]
  who.forEach(([first, name, sub, state], i) => {
    const y = py + 4 + i * rowH
    const parts: NodeId[] = []
    if (i > 0) parts.push(divider(s, M + 72, y, CW - 88))
    parts.push(
      avatar(s, 'Avatar', people[first]!, M + 38, y + rowH / 2, 22),
      s.text('Name', name, M + 72, y + 13, { size: 15, weight: 600 }),
      s.text('Detail', sub, M + 72, y + 34, { size: 13, color: C.grey }),
    )
    const amount: TextOptions = { size: 15, weight: 600 }
    parts.push(s.group('Share', [
      s.rect('Background', W - M - 100, y + 14, 84, 36, { fill: state === 'paid' ? C.greenSoft : C.surface, radius: 18 }),
      s.centeredText('Amount', money(46), { x: W - M - 100, y: y + 14, w: 84, h: 36 }, { ...amount, color: state === 'paid' ? C.green : C.ink }),
    ]))
    rows.push(s.group(`Participant / ${name}`, parts))
  })
  const ay = py + 4 + who.length * rowH
  rows.push(s.group('Add People', [
    divider(s, M + 16, ay, CW - 32),
    s.circle('Badge', M + 38, ay + 28, 18, { fill: solid(C.white, 0), stroke: { color: C.accent, width: 1.5, dash: [4, 3] } }),
    s.icon('Icon', I.plus, M + 29, ay + 19, 18, C.accent),
    textAt(s, 'Label', 'Add people', M + 72, ay + 28, { size: 15, weight: 600, color: C.accent }),
  ]))
  s.group('Participants', rows)

  const my = py + who.length * rowH + 8 + 56 + 16
  s.group('Message', [
    s.rect('Background', M, my, CW, 52, { fill: C.surface, radius: 16 }),
    s.icon('Icon', I.edit, M + 16, my + 16, 20, C.grey),
    textAt(s, 'Text', 'Thanks for a lovely evening!', M + 48, my + 26, { size: 15 }),
  ])
  pill(s, 'Total Check', `3 × ${money(46)} + your ${money(46)} = ${money(184)}`, W / 2, my + 68, {
    fill: C.white, color: C.grey, h: 26, weight: 500, anchor: 'center',
  })
  button(s, `Request ${money(138)}`, M, 752, CW)
  homeIndicator(s, C.ink)
}
