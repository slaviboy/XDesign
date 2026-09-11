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

/** Welcome, Sign Up and Verify: the way into Nova. */

import type { ImageAsset, NodeId } from '@/document/types'
import { solid, type Screen, type TextOptions } from '../kit'
import { homeIndicator, statusBar } from '../components'
import { C, CW, DISPLAY, LIFT_SHADOW, M, W } from './theme'
import { I } from './icons'
import { button, flag, keypad, logo, navBar, textAt, type FlagCode } from './ui'
import { USER } from './data'

/** Four short bars across the nav bar: how far through sign-up this is. */
function steps(s: Screen, done: number): NodeId {
  const w = 40
  const gap = 6
  const left = (W - (w * 4 + gap * 3)) / 2
  return s.group('Progress', [0, 1, 2, 3].map((i) =>
    s.rect(`Step ${i + 1}`, left + i * (w + gap), 74, w, 4, { fill: i < done ? C.accent : C.line, radius: 2 })))
}

function heading(s: Screen, title: string, y: number): number {
  const o: TextOptions = { size: 30, weight: 700, family: DISPLAY, width: CW, lineHeight: 1.15, letterSpacing: -0.02 }
  s.text('Title', title, M, y, o)
  return y + s.measure(title, o).height
}

export function welcome(s: Screen, hero: ImageAsset): void {
  s.image('Hero', hero, 0, 0, W, 520, [0, 0, 32, 32])
  statusBar(s, C.white)
  logo(s, M, 60, { size: 24, color: C.white, markFill: C.white, starColor: C.accent })
  s.group('Pager', [
    s.rect('Current', M, 552, 24, 6, { fill: C.accent, radius: 3 }),
    s.rect('Next', M + 30, 552, 6, 6, { fill: C.ink, radius: 3, opacity: 0.15 }),
    s.rect('Last', M + 42, 552, 6, 6, { fill: C.ink, radius: 3, opacity: 0.15 }),
  ])
  s.text('Title', 'Money that moves\nas fast as you do', M, 574, {
    size: 34, weight: 700, family: DISPLAY, width: CW, lineHeight: 1.12, letterSpacing: -0.025,
  })
  s.text('Subtitle', 'Spend, save and invest in 30+ currencies, with a card that works everywhere you go.', M, 662, {
    size: 15, color: C.grey, width: CW - 16, lineHeight: 1.5,
  })
  button(s, 'Create free account', M, 728, CW)
  const sign: TextOptions = { size: 14, color: C.grey }
  const lead = 'Already with Nova? '
  const leadW = s.measure(lead, sign).width
  const total = leadW + s.measure('Log in', { ...sign, weight: 600 }).width
  const left = (W - total) / 2
  s.group('Log In', [
    s.text('Prompt', lead, left, 798, sign),
    s.text('Link', 'Log in', left + leadW, 798, { ...sign, weight: 600, color: C.accent }),
  ])
  homeIndicator(s, C.ink)
}

export function signUp(s: Screen): void {
  statusBar(s, C.ink)
  navBar(s, '', { buttonFill: C.surface })
  steps(s, 1)
  const after = heading(s, "What's your phone number?", 116)
  s.text('Subtitle', "We'll text you a 6-digit code to make sure it's really you.", M, after + 10, {
    size: 15, color: C.grey, width: CW, lineHeight: 1.5,
  })

  const fy = 266
  s.group('Phone Field', [
    s.group('Country', [
      s.rect('Background', M, fy, 116, 60, { fill: C.white, radius: 16, stroke: { color: C.accent, width: 1.5 } }),
      flag(s, 'PT', M + 28, fy + 30, 12),
      textAt(s, 'Code', '+351', M + 48, fy + 30, { size: 16, weight: 600 }),
      s.icon('Chevron', I.chevronDown, M + 90, fy + 21, 18, C.ink),
    ]),
    s.group('Number', [
      s.rect('Background', M + 128, fy, CW - 128, 60, { fill: C.surface, radius: 16 }),
      s.text('Label', 'Mobile number', M + 146, fy + 10, { size: 11, weight: 500, color: C.grey }),
      s.text('Value', USER.phone.slice(5), M + 146, fy + 27, { size: 17, weight: 600 }),
      s.rect('Caret', M + 146 + s.measure(USER.phone.slice(5), { size: 17, weight: 600 }).width + 2, fy + 29, 2, 20, { fill: C.accent, radius: 1 }),
    ]),
  ])

  // The country picker, open under the field.
  const py = 338
  const countries: Array<[FlagCode, string, string]> = [
    ['PT', 'Portugal', '+351'],
    ['ES', 'Spain', '+34'],
    ['FR', 'France', '+33'],
    ['DE', 'Germany', '+49'],
    ['IT', 'Italy', '+39'],
  ]
  const rowH = 48
  const ph = 12 + 44 + 12 + 24 + countries.length * rowH + 8
  const picker: NodeId[] = [
    s.rect('Background', M, py, CW, ph, { fill: C.white, radius: 20, shadow: LIFT_SHADOW, stroke: { color: C.line, width: 1 } }),
    s.group('Search', [
      s.rect('Field', M + 12, py + 12, CW - 24, 44, { fill: C.surface, radius: 12 }),
      s.icon('Icon', I.search, M + 26, py + 24, 20, C.faint),
      textAt(s, 'Placeholder', 'Search countries', M + 56, py + 34, { size: 15, color: C.faint }),
    ]),
    s.text('Heading', 'SUGGESTED', M + 20, py + 72, { size: 11, weight: 600, color: C.grey, letterSpacing: 0.08 }),
  ]
  countries.forEach(([code, name, dial], i) => {
    const y = py + 92 + i * rowH
    const on = i === 0
    const parts: NodeId[] = []
    if (on) parts.push(s.rect('Highlight', M + 8, y + 2, CW - 16, rowH - 4, { fill: C.accentSoft, radius: 12 }))
    parts.push(
      flag(s, code, M + 32, y + rowH / 2, 12),
      textAt(s, 'Country', name, M + 56, y + rowH / 2, { size: 15, weight: on ? 600 : 500 }),
      textAt(s, 'Dial Code', dial, M + CW - (on ? 52 : 20), y + rowH / 2, { size: 15, color: C.grey, anchor: 'right' }),
    )
    if (on) parts.push(s.icon('Selected', I.check, M + CW - 42, y + rowH / 2 - 10, 20, C.accent, { width: 2.4 }))
    picker.push(s.group(`Country / ${name}`, parts))
  })
  s.group('Country Picker', picker)

  const legal: TextOptions = { size: 12.5, color: C.grey, width: CW, align: 'center', lineHeight: 1.5 }
  s.text('Legal', 'By continuing you agree to Nova’s Terms of Service and confirm you have read the Privacy Notice.', W / 2, 700, {
    ...legal, anchor: 'center',
  })
  button(s, 'Send code', M, 756, CW)
  homeIndicator(s, C.ink)
}

export function verify(s: Screen): void {
  statusBar(s, C.ink)
  navBar(s, '', { buttonFill: C.surface })
  steps(s, 2)
  const after = heading(s, 'Enter the code', 116)
  s.text('Subtitle', 'We sent a 6-digit code by SMS to', M, after + 10, { size: 15, color: C.grey })
  s.text('Phone', USER.phone, M, after + 32, { size: 15, weight: 600 })

  const digits = ['4', '8', '2', '9', '', '']
  const bw = 50
  const gap = (CW - bw * 6) / 5
  const by = 248
  s.group('Code', digits.map((d, i) => {
    const x = M + i * (bw + gap)
    const active = i === 4
    const parts: NodeId[] = [
      s.rect('Box', x, by, bw, 60, active
        ? { fill: C.white, radius: 14, stroke: { color: C.accent, width: 2 } }
        : { fill: C.surface, radius: 14 }),
    ]
    if (d) parts.push(s.centeredText('Digit', d, { x, y: by, w: bw, h: 60 }, { size: 26, weight: 700, family: DISPLAY }))
    if (active) parts.push(s.rect('Caret', x + bw / 2 - 1, by + 18, 2, 24, { fill: C.accent, radius: 1 }))
    return s.group(`Digit ${i + 1}`, parts)
  }))

  const hint: TextOptions = { size: 14, color: C.grey }
  const lead = 'Didn’t get it? Resend in '
  const leadW = s.measure(lead, hint).width
  s.group('Resend', [
    s.icon('Icon', I.clock, M, 332, 18, C.faint),
    s.text('Prompt', lead, M + 26, 331, hint),
    s.text('Countdown', '0:24', M + 26 + leadW, 331, { ...hint, weight: 600, color: C.ink }),
  ])
  s.group('Call Instead', [
    s.rect('Background', M, 372, 172, 40, { fill: solid(C.accent, 0), radius: 20, stroke: { color: C.line, width: 1.5 } }),
    s.icon('Icon', I.phone, M + 16, 382, 20, C.ink),
    textAt(s, 'Label', 'Call me instead', M + 44, 392, { size: 14, weight: 600 }),
  ])

  // The system keyboard, with the code it found in Messages.
  const trayTop = 520
  keypad(s, 574, { style: 'tiles', rowH: 48, trayTop })
  s.group('Suggestion', [
    s.text('Source', 'From Messages', W / 2, trayTop + 8, { size: 11, color: '#5B5E6E', anchor: 'center' }),
    s.text('Code', '482 915', W / 2, trayTop + 24, { size: 17, weight: 600, anchor: 'center', letterSpacing: 0.04 }),
  ])
  s.rect('Suggestion Divider', 0, trayTop + 50, W, 1, { fill: '#C2C5CE' })
  homeIndicator(s, C.ink)
}
