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
 * Getting started: Welcome, the phone number, the code that verifies it, and
 * the profile — Jonas Berg, in Stockholm, signing up.
 */

import type { NodeId } from '@/document/types'
import { shadow, solid } from '../kit'
import type { Assets } from './assets'
import { bubblePath } from './chat'
import { I } from './icons'
import { Board, C, W } from './theme'
import {
  avatar, emoji, homeIndicator, iconCircle, keypad, KEYPAD_TOP, logoMark, primaryButton, rowCard, sectionLabel, statusBar,
} from './ui'

const TITLE = { size: 26, weight: 700, letterSpacing: -0.01 }
const LEAD = { size: 15, color: C.grey, lineHeight: 1.45, align: 'center' as const, anchor: 'center' as const }

/** A screen's heading and the line under it, centred. Returns where the lead ends. */
function heading(s: Board, title: string, lead: string, top = 84): number {
  s.text('Title', title, W / 2, top, { ...TITLE, anchor: 'center' })
  const size = s.measure(lead, { ...LEAD, width: 316 })
  s.text('Lead', lead, W / 2, top + 44, { ...LEAD, width: 316 })
  return top + 44 + size.height
}

// ---------------------------------------------------------------------------
// 01 Welcome
// ---------------------------------------------------------------------------

function line(s: Board, name: string, x: number, y: number, w: number, fill: string): NodeId {
  return s.rect(name, x, y, w, 9, { fill, radius: 4.5 })
}

function welcomeArt(s: Board, a: Assets): NodeId {
  const ids: NodeId[] = [
    s.circle('Backdrop', 195, 316, 150, { fill: C.brandSoft }),
    s.circle('Ring', 195, 316, 118, { fill: solid(C.white, 0), stroke: { color: '#CBEFE8', width: 1.5 } }),
    s.circle('Dot 1', 58, 206, 5, { fill: '#9FE3D9' }),
    s.circle('Dot 2', 342, 432, 7, { fill: '#BDEBE4' }),
    s.circle('Dot 3', 320, 158, 3.5, { fill: C.brand }),
    s.star('Sparkle 1', 290, 372, 16, '#FFC94D'),
    s.star('Sparkle 2', 26, 318, 11, C.brand),
  ]
  // The bubble goes down first and its contents after, so they sit on top.
  const bubble = (name: string, x: number, y: number, w: number, h: number, mine: boolean, parts: () => NodeId[]) => {
    const b = s.shadowOn(s.path('Bubble', bubblePath(x, y, w, h, mine ? 'out' : 'in', true), { fill: mine ? '#D5F3ED' : C.white, closed: true }), shadow(10, 26, 0.1))
    return s.group(name, [b, ...parts()])
  }
  ids.push(bubble('Bubble / Maya', 40, 196, 214, 70, false, () => [
    avatar(s, 'Avatar', a.face.Maya!, 52, 209, 44),
    line(s, 'Line 1', 108, 218, 124, '#E0E7E8'),
    line(s, 'Line 2', 108, 236, 84, '#E0E7E8'),
  ]))
  ids.push(bubble('Bubble / Me', 138, 286, 214, 64, true, () => [
    line(s, 'Line 1', 152, 302, 140, '#A6DFD5'),
    line(s, 'Line 2', 152, 320, 96, '#A6DFD5'),
    s.icon('Ticks', I.ticks, 318, 324, 18, C.read, { width: 1.6 }),
  ]))
  ids.push(s.group('Reaction', [
    s.rect('Chip', 150, 338, 36, 26, { fill: C.white, radius: 13, shadow: shadow(3, 8, 0.12) }),
    emoji(s, 'heart', 158, 342, 20),
  ]))
  let wave = ''
  const heights = [6, 12, 18, 10, 22, 14, 8, 16, 20, 12, 6, 14, 18, 8, 12, 6]
  heights.forEach((h, i) => {
    const x = 96 + i * 5.5
    wave += `M${x} ${402 - h / 2}V${402 + h / 2}`
  })
  ids.push(bubble('Bubble / Lucas', 52, 376, 206, 54, false, () => [
    s.icon('Play', I.play, 64, 390, 24, '#5F6E71', { fill: '#5F6E71', width: 1 }),
    s.path('Waveform', wave, { stroke: '#B4C0C2', width: 2.6 }),
    avatar(s, 'Avatar', a.face.Lucas!, 212, 385, 36),
  ]))
  ids.push(s.group('Encryption Badge', [
    s.circle('Background', 318, 214, 28, { fill: C.brand, shadow: shadow(8, 18, 0.28, 0, C.brand) }),
    s.icon('Lock', I.lock, 304, 199, 28, C.white, { width: 2 }),
  ]))
  return s.group('Illustration', ids)
}

export function welcome(s: Board, a: Assets): void {
  statusBar(s, C.ink)
  const word = { size: 28, weight: 700, family: 'DM Sans', letterSpacing: -0.02 }
  const ww = s.measure('Relay', word).width
  const left = (W - (40 + 10 + ww)) / 2
  s.group('Logo', [logoMark(s, left, 70, 40), s.text('Wordmark', 'Relay', left + 50, 72, { ...word, color: C.ink })])
  welcomeArt(s, a)
  s.text('Title', 'Welcome to Relay', W / 2, 500, { size: 30, weight: 700, family: 'DM Sans', letterSpacing: -0.02, anchor: 'center' })
  s.text('Lead', 'Simple, private messaging with the people who matter. Every message and call is end-to-end encrypted.', W / 2, 548, {
    ...LEAD, size: 15.5, width: 318,
  })
  s.group('Legal', [
    s.text('Prompt', 'Tap “Agree & continue” to accept the', W / 2, 636, { size: 13.5, color: C.grey, anchor: 'center' }),
    s.text('Links', 'Privacy Policy  ·  Terms of Service', W / 2, 656, { size: 13.5, weight: 600, color: C.brandInk, anchor: 'center' }),
  ])
  const lang = { size: 14.5, weight: 500, color: C.ink }
  const lw = s.measure('English', lang).width + 72
  s.group('Language Picker', [
    s.rect('Background', (W - lw) / 2, 690, lw, 36, { fill: C.surface, radius: 18 }),
    s.icon('Globe', I.globe, (W - lw) / 2 + 12, 698, 20, C.brandInk, { width: 1.7 }),
    s.text('Language', 'English', (W - lw) / 2 + 38, 698, lang),
    s.icon('Chevron', I.chevronDown, (W + lw) / 2 - 28, 700, 16, C.grey, { width: 2.2 }),
  ])
  primaryButton(s, 'Agree & continue', 24, 750, W - 48, 52)
  homeIndicator(s, C.ink)
}

// ---------------------------------------------------------------------------
// 02 Phone number
// ---------------------------------------------------------------------------

function swedishFlag(s: Board, x: number, y: number): NodeId {
  return s.group('Flag / Sweden', [
    s.rect('Field', x, y, 30, 21, { fill: '#1F6FC5', radius: 3 }),
    s.rect('Cross Vertical', x + 9, y, 4.5, 21, { fill: '#F7C942' }),
    s.rect('Cross Horizontal', x, y + 8.25, 30, 4.5, { fill: '#F7C942' }),
  ])
}

export function phoneNumber(s: Board): void {
  statusBar(s, C.ink)
  const end = heading(s, 'Enter your phone number', 'We’ll text you a code to confirm your number. Carrier charges may apply.')
  const top = end + 32
  s.group('Phone Field', [
    s.rect('Card', 16, top, W - 32, 112, { fill: C.surface, radius: 14 }),
    s.group('Country', [
      swedishFlag(s, 32, top + 17.5),
      s.text('Name', 'Sweden', 76, top + 17, { size: 17, color: C.ink }),
      s.icon('Chevron', I.chevronRight, W - 50, top + 20, 16, '#9AA6A9', { width: 2.4 }),
    ]),
    s.rect('Hairline', 32, top + 56, W - 64, 1, { fill: '#DEE4E5' }),
    s.text('Country Code', '+46', 32, top + 73, { size: 18, weight: 500, color: C.ink }),
    s.rect('Divider', 80, top + 70, 1, 28, { fill: '#D2DADB' }),
    s.text('Number', '70 318 42 96', 96, top + 71, { size: 20, weight: 500, color: C.ink, letterSpacing: 0.02 }),
    s.rect('Caret', 96 + s.measure('70 318 42 96', { size: 20, weight: 500, letterSpacing: 0.02 }).width + 2, top + 70, 2, 26, { fill: C.brand, radius: 1 }),
  ])
  s.text('Help', 'What’s my number?', W / 2, top + 132, { size: 14.5, weight: 600, color: C.brandInk, anchor: 'center' })
  primaryButton(s, 'Next', 24, KEYPAD_TOP - 74, W - 48)
  keypad(s)
}

// ---------------------------------------------------------------------------
// 03 Verification code
// ---------------------------------------------------------------------------

export function verify(s: Board): void {
  statusBar(s, C.ink)
  s.icon('Back', I.back, 10, 52, 26, C.brandInk, { width: 2.2 })
  const end = heading(s, 'Verify your number', 'Enter the 6-digit code we sent to\n+46 70 318 42 96')
  s.text('Wrong Number', 'Wrong number?', W / 2, end + 8, { size: 14.5, weight: 600, color: C.brandInk, anchor: 'center' })
  const top = end + 52
  const digits = ['4', '8', '2', '7', '', '']
  const boxW = 46
  const x0 = (W - (6 * boxW + 4 * 8 + 20)) / 2
  const boxes = digits.map((d, i) => {
    const x = x0 + i * (boxW + 8) + (i >= 3 ? 12 : 0)
    const active = i === 4
    const parts = [s.rect('Box', x, top, boxW, 58, active
      ? { fill: C.white, radius: 12, stroke: { color: C.brand, width: 2 }, shadow: shadow(4, 12, 0.14, 0, C.brand) }
      : { fill: C.surface, radius: 12 })]
    if (d) parts.push(s.centeredText('Digit', d, { x, y: top, w: boxW, h: 58 }, { size: 26, weight: 600, color: C.ink }))
    if (active) parts.push(s.rect('Caret', x + boxW / 2 - 1, top + 17, 2, 24, { fill: C.brand, radius: 1 }))
    return s.group(`Digit ${i + 1}`, parts)
  })
  s.group('Code', boxes)
  s.text('Timer Hint', 'Didn’t get a code?', W / 2, top + 84, { size: 14, color: C.grey, anchor: 'center' })
  rowCard(s, 'Resend Options', 16, top + 114, W - 32, [
    { label: 'Resend SMS', icon: I.bubble, iconColor: C.faint, value: 'in 0:48', color: C.faint },
    { label: 'Call me', icon: I.phone, iconColor: C.faint, value: 'in 1:48', color: C.faint },
  ], 50)
  keypad(s)
}

// ---------------------------------------------------------------------------
// 04 Profile setup
// ---------------------------------------------------------------------------

export function profile(s: Board, a: Assets): void {
  statusBar(s, C.ink)
  const end = heading(s, 'Profile info', 'Add your name and an optional photo. Your contacts see these, not your number.')
  const top = end + 28
  s.group('Avatar Picker', [
    s.circle('Ring', W / 2, top + 66, 70, { fill: solid(C.white, 0), stroke: { color: C.brandTint, width: 4 } }),
    avatar(s, 'Photo', a.face.Jonas!, W / 2 - 64, top + 2, 128),
    s.circle('Camera Badge', W / 2 + 46, top + 112, 20, { fill: C.brand, stroke: { color: C.white, width: 3 } }),
    s.icon('Camera', I.camera, W / 2 + 36, top + 102, 20, C.white, { width: 1.8 }),
  ])
  const pick = top + 158
  const options: Array<[string, string]> = [['Camera', I.camera], ['Photos', I.gallery], ['Remove', I.close]]
  s.group('Photo Options', options.map(([label, icon], i) => {
    const cx = W / 2 + (i - 1) * 88
    return s.group(`Option / ${label}`, [
      iconCircle(s, 'Icon', icon, cx, pick + 22, 22, { iconSize: 22, ...(label === 'Remove' ? { fill: '#FDE8EB', color: C.red } : {}) }),
      s.text('Label', label, cx, pick + 52, { size: 12.5, weight: 500, color: label === 'Remove' ? C.red : C.body, anchor: 'center' }),
    ])
  }))
  const field = pick + 102
  sectionLabel(s, 'Your name', 32, field)
  s.group('Name Field', [
    s.rect('Field', 16, field + 22, W - 32, 52, { fill: C.surface, radius: 12, stroke: { color: C.brand, width: 1.5 } }),
    s.text('Value', 'Jonas Berg', 32, field + 37, { size: 17, color: C.ink }),
    s.rect('Caret', 32 + s.measure('Jonas Berg', { size: 17 }).width + 2, field + 36, 2, 24, { fill: C.brand, radius: 1 }),
    s.icon('Emoji', I.emoji, W - 54, field + 36, 24, C.grey, { width: 1.7 }),
  ])
  s.text('Name Hint', 'This is not your username or PIN. It’s the name your Relay contacts will see.', 32, field + 84, {
    size: 13, color: C.grey, width: W - 64, lineHeight: 1.4,
  })
  sectionLabel(s, 'About', 32, field + 138)
  s.group('About Field', [
    s.rect('Field', 16, field + 160, W - 32, 52, { fill: C.surface, radius: 12 }),
    s.text('Value', 'Out on the water', 32, field + 175, { size: 17, color: C.ink }),
    s.icon('Chevron', I.chevronRight, W - 50, field + 178, 16, '#9AA6A9', { width: 2.4 }),
  ])
  primaryButton(s, 'Next', 24, 750, W - 48, 52)
  homeIndicator(s, C.ink)
}
