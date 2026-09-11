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

/** Emma's profile, and the plans — Metal on black. */

import type { NodeId } from '@/document/types'
import { linear, radial, type Screen } from '../kit'
import { homeIndicator, statusBar } from '../components'
import { C, CW, DISPLAY, M, W } from './theme'
import { I } from './icons'
import { avatar, button, cardFace, divider, listRow, navBar, panel, roundButton, segmented, tabBar, textAt } from './ui'
import { USER, type People } from './data'

/** The dark "Metal" badge. */
function metalBadge(s: Screen, cx: number, y: number): NodeId {
  const label = 'Metal'
  const w = s.measure(label, { size: 13, weight: 600 }).width + 44
  const x = cx - w / 2
  return s.group('Plan Badge / Metal', [
    s.rect('Background', x, y, w, 28, { fill: linear([['#3A3C4B', 0], ['#0F1019', 1]], 0, 0, 1, 1), radius: 14 }),
    s.icon('Crown', I.crown, x + 12, y + 7, 14, '#F3D58B', { width: 1.8 }),
    textAt(s, 'Label', label, x + 32, y + 14, { size: 13, weight: 600, color: C.white }),
  ])
}

export function profile(s: Screen, people: People): void {
  statusBar(s, C.ink)
  roundButton(s, 'Share Profile', I.qr, M + 20, 76, { iconSize: 20 })
  roundButton(s, 'Settings', I.gear, W - M - 20, 76, { iconSize: 20 })
  s.group('Identity', [
    s.circle('Ring', W / 2, 124, 44, { fill: C.white, shadow: { x: 0, y: 8, blur: 24, color: { r: 13, g: 14, b: 26, a: 0.1 }, visible: true } }),
    avatar(s, 'Avatar', people.Emma!, W / 2, 124, 40),
    s.circle('Edit Badge', W / 2 + 31, 155, 14, { fill: C.accent, stroke: { color: C.surface, width: 3 } }),
    s.icon('Edit Icon', I.edit, W / 2 + 24, 148, 14, C.white, { width: 2 }),
    s.text('Name', USER.name, W / 2, 180, { size: 24, weight: 700, family: DISPLAY, anchor: 'center', letterSpacing: -0.01 }),
    s.text('Handle', `${USER.handle} · Lisbon`, W / 2, 212, { size: 14, color: C.grey, anchor: 'center' }),
    metalBadge(s, W / 2, 240),
  ])

  const stats: Array<[string, string]> = [['Member since', '2021'], ['Cashback', '€48.20'], ['Friends invited', '4']]
  const sw = CW / 3
  s.group('Stats', [
    panel(s, 'Background', M, 288, CW, 72),
    ...stats.map(([label, value], i) => s.group(`Stat / ${label}`, [
      ...(i > 0 ? [s.rect('Separator', M + sw * i, 302, 1, 44, { fill: C.line })] : []),
      s.text('Value', value, M + sw * i + sw / 2, 302, { size: 18, weight: 700, family: DISPLAY, anchor: 'center' }),
      s.text('Label', label, M + sw * i + sw / 2, 328, { size: 12, color: C.grey, anchor: 'center' }),
    ])),
  ])

  const section = (title: string, y: number, rows: Array<{ icon: string; title: string; value?: string; color?: string; bg?: string }>): number => {
    const top = y
    const ids: NodeId[] = [
      s.text('Title', title.toUpperCase(), M + 4, top, { size: 12, weight: 600, color: C.grey, letterSpacing: 0.06 }),
      panel(s, 'Background', M, top + 24, CW, rows.length * 48 + 8),
    ]
    rows.forEach((r, i) => {
      if (i > 0) ids.push(divider(s, M + 68, top + 28 + i * 48, CW - 84))
      ids.push(listRow(s, {
        x: M + 16, y: top + 28 + i * 48, w: CW - 32, h: 48, icon: r.icon, title: r.title, value: r.value, chevron: true,
        iconColor: r.color, iconBg: r.bg,
      }))
    })
    s.group(`Section / ${title}`, ids)
    return top + 24 + rows.length * 48 + 8
  }
  const y = section('Account', 380, [
    { icon: I.user, title: 'Personal details', color: C.accent, bg: C.accentSoft },
    { icon: I.crown, title: 'Your plan', value: 'Metal', color: C.gold, bg: C.yellowSoft },
    { icon: I.document, title: 'Documents & statements', color: C.teal, bg: C.tealSoft },
  ])
  section('Security & help', y + 20, [
    { icon: I.lock, title: 'Passcode & Face unlock', color: C.purple, bg: C.purpleSoft },
    { icon: I.bell, title: 'Notifications', value: 'On', color: C.orange, bg: C.orangeSoft },
    { icon: I.gift, title: 'Invite friends', value: 'Get €50', color: C.pink, bg: C.pinkSoft },
  ])
  tabBar(s, 'Hub')
  homeIndicator(s, C.ink)
}

export function plans(s: Screen): void {
  statusBar(s, C.white)
  navBar(s, 'Plans', { dark: true, left: 'close' })
  segmented(s, 'Billing', ['Monthly', 'Yearly · save 20%'], 0, M + 36, 112, CW - 72, { h: 40, dark: true })

  // The metal card, lit from behind.
  s.circle('Glow', W / 2, 262, 170, { fill: radial([[C.accent, 0, 0.42], [C.accent, 0.55, 0.12], [C.accent, 1, 0]]) })
  cardFace(s, 'metal', M + 24, 172, CW - 48, { last4: '4821', holder: 'EMMA NOVAK', expiry: '08/29' })

  s.group('Plan Title', [
    s.text('Name', 'Metal', M, 386, { size: 30, weight: 700, family: DISPLAY, color: C.white, letterSpacing: -0.02 }),
    s.text('Price', '€13.99', W - M, 384, { size: 24, weight: 700, family: DISPLAY, color: C.white, anchor: 'right' }),
    s.text('Tagline', 'A stainless steel card and our best perks', M, 426, { size: 14, color: C.nightGrey }),
    s.text('Period', 'per month', W - M, 414, { size: 12.5, color: C.nightGrey, anchor: 'right' }),
  ])

  const features: Array<[string, string]> = [
    [I.percent, '1% cashback on every card payment'],
    [I.cash, 'Free ATM withdrawals up to €800 a month'],
    [I.exchange, 'Exchange with no fees, any day of the week'],
    [I.vault, '3.25% AER on savings vaults'],
    [I.suitcase, 'Travel insurance and airport lounge passes'],
    [I.help, 'Priority support, 24/7'],
  ]
  s.group('Features', features.map(([icon, text], i) => {
    const y = 460 + i * 36
    return s.group(`Feature / ${text}`, [
      s.circle('Badge', M + 14, y + 12, 14, { fill: C.nightCard }),
      s.icon('Icon', icon, M + 5, y + 3, 18, '#8FA2FF', { width: 1.8 }),
      textAt(s, 'Text', text, M + 40, y + 12, { size: 14, color: C.white }),
    ])
  }))

  // Every plan, Metal chosen.
  const tiers: Array<[string, string]> = [['Standard', 'Free'], ['Plus', '€3.99'], ['Premium', '€7.99'], ['Metal', '€13.99']]
  const tw = (CW - 24) / 4
  s.group('Plan Picker', tiers.map(([name, price], i) => {
    const x = M + i * (tw + 8)
    const on = name === 'Metal'
    return s.group(`Plan / ${name}`, [
      s.rect('Background', x, 684, tw, 56, on
        ? { fill: C.nightCard, radius: 16, stroke: { color: C.accent, width: 2 } }
        : { fill: C.nightCard, radius: 16 }),
      s.text('Name', name, x + tw / 2, 694, { size: 13, weight: 600, color: C.white, anchor: 'center' }),
      s.text('Price', price, x + tw / 2, 714, { size: 12, color: on ? '#8FA2FF' : C.nightGrey, anchor: 'center' }),
    ])
  }))
  button(s, 'Your current plan', M, 760, CW, { variant: 'white', h: 52, icon: I.check })
  homeIndicator(s, C.white)
}
