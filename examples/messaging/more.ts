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
 * Everything around the chats: contact and group info, the shared media,
 * calls (the list, an incoming call, a video call), updates and a status,
 * starting a new chat, and settings.
 */

import type { ImageAsset, NodeId, Paint } from '@/document/types'
import { linear, shadow, solid } from '../kit'
import type { Assets } from './assets'
import { I } from './icons'
import { Board, C, H, W } from './theme'
import {
  avatar, chips, homeIndicator, iconCircle, largeHeader, navBar, rowCard, searchField, sectionLabel, segmented, statusBar,
  statusRing, tabBar,
} from './ui'

/** The row of big tinted buttons under a profile: audio, video, search… */
function actions(s: Board, y: number, items: Array<[string, string]>): NodeId {
  const gap = 8
  const w = (W - 32 - gap * (items.length - 1)) / items.length
  return s.group('Actions', items.map(([label, icon], i) => {
    const x = 16 + i * (w + gap)
    return s.group(`Action / ${label}`, [
      s.rect('Background', x, y, w, 64, { fill: C.white, radius: 12 }),
      s.icon('Icon', icon, x + w / 2 - 12, y + 11, 24, C.brandInk, { width: 1.9 }),
      s.text('Label', label, x + w / 2, y + 41, { size: 13, weight: 500, color: C.brandInk, anchor: 'center' }),
    ])
  }))
}

/** A big centred face, a name and a line under it. */
function profileTop(s: Board, picture: ImageAsset, name: string, line: string): void {
  s.group('Profile', [
    avatar(s, 'Photo', picture, W / 2 - 48, 100, 96),
    s.text('Name', name, W / 2, 208, { size: 24, weight: 700, color: C.ink, anchor: 'center', letterSpacing: -0.01 }),
    s.text('Detail', line, W / 2, 242, { size: 16, color: C.grey, anchor: 'center' }),
  ])
}

// ---------------------------------------------------------------------------
// 10 Contact info
// ---------------------------------------------------------------------------

export function contactInfo(s: Board, a: Assets): void {
  navBar(s, 'Contact info', { back: '', action: 'Edit', bg: C.surface })
  profileTop(s, a.face.Maya!, 'Maya Chen', '+46 73 482 19 05')
  actions(s, 276, [['Audio', I.phone], ['Video', I.video], ['Search', I.search]])

  const media: NodeId[] = [
    s.rect('Card', 16, 356, W - 32, 128, { fill: C.white, radius: 12 }),
    s.text('Label', 'Media, links and docs', 32, 370, { size: 16.5, color: C.ink }),
    s.text('Count', '148', W - 50, 371, { size: 16, color: C.grey, anchor: 'right' }),
    s.icon('Chevron', I.chevronRight, W - 46, 372, 16, '#B5BFC1', { width: 2.4 }),
  ]
  const thumbs = [a.cabin, a.media[0]!, a.media[1]!, a.media[2]!]
  thumbs.forEach((pic, i) => media.push(s.photo(`Thumbnail ${i + 1}`, pic, 32 + i * 83, 402, 77, 68, 8)))
  s.group('Shared Media', media)

  rowCard(s, 'Chat Settings', 16, 496, W - 32, [
    { label: 'Starred messages', icon: I.star, iconColor: C.brandInk, value: '3' },
    { label: 'Mute', icon: I.muted, iconColor: C.brandInk, value: 'Off' },
    { label: 'Disappearing messages', icon: I.timer, iconColor: C.brandInk, value: 'Off' },
  ], 46)
  rowCard(s, 'Encryption', 16, 646, W - 32, [
    { label: 'Encryption', icon: I.lock, iconColor: C.brandInk, sub: 'Messages and calls are end-to-end encrypted. Tap to verify.' },
  ], 70)
  rowCard(s, 'Danger Zone', 16, 728, W - 32, [
    { label: 'Block Maya Chen', icon: I.block, iconColor: C.red, color: C.red },
    { label: 'Report Maya Chen', icon: I.flag, iconColor: C.red, color: C.red },
  ], 44)
  homeIndicator(s, C.ink)
}

// ---------------------------------------------------------------------------
// 11 Group info
// ---------------------------------------------------------------------------

export function groupInfo(s: Board, a: Assets): void {
  const f = a.face
  navBar(s, 'Group info', { back: '', action: 'Edit', bg: C.surface })
  profileTop(s, a.lisbon, 'Lisbon Trip', 'Group · 5 members')
  actions(s, 276, [['Audio', I.phone], ['Video', I.video], ['Add', I.personAdd], ['Search', I.search]])
  s.group('Description', [
    s.rect('Card', 16, 356, W - 32, 68, { fill: C.white, radius: 12 }),
    s.text('Text', '2–5 October · flights, stays and the plan', 32, 368, { size: 15.5, color: C.ink }),
    s.text('Created', 'Created by Sofia Rossi, 28 Aug 2026', 32, 394, { size: 13, color: C.grey }),
  ])
  s.group('Members Header', [
    sectionLabel(s, '5 members', 32, 440),
    s.icon('Search', I.search, W - 50, 436, 20, C.grey, { width: 2 }),
  ])
  const top = 462
  const rowH = 50
  const ids: NodeId[] = [s.rect('Card', 16, top, W - 32, rowH * 7, { fill: C.white, radius: 12 })]
  const line = (y: number) => s.rect('Hairline', 76, y + rowH - 0.5, W - 16 - 76, 0.5, { fill: C.line })
  const special: Array<[string, string]> = [['Add members', I.personAdd], ['Invite via link', I.link]]
  special.forEach(([label, icon], i) => {
    const y = top + i * rowH
    ids.push(s.group(`Row / ${label}`, [
      iconCircle(s, 'Icon', icon, 52, y + rowH / 2, 20, { iconSize: 20 }),
      s.text('Label', label, 84, y + 14, { size: 16.5, weight: 500, color: C.brandInk }),
      line(y),
    ]))
  })
  const members: Array<[string, string, ImageAsset, boolean]> = [
    ['You', 'Out on the water', f.Jonas!, true],
    ['Sofia Rossi', 'Pena Palace or bust', f.Sofia!, true],
    ['Kenji Tanaka', 'Available', f.Kenji!, false],
    ['Lucas Silva', 'Busy until 18:00', f.Lucas!, false],
    ['Maya Chen', 'Always up for a hike', f.Maya!, false],
  ]
  members.forEach(([name, about, face, admin], i) => {
    const y = top + (i + 2) * rowH
    const parts: NodeId[] = [
      avatar(s, 'Avatar', face, 32, y + 6, 38),
      s.text('Name', name, 84, y + 6, { size: 16, weight: 500, color: C.ink }),
      s.text('About', about, 84, y + 27, { size: 13, color: C.grey }),
    ]
    if (admin) {
      parts.push(s.group('Admin', [
        s.rect('Background', W - 32 - 58, y + 14, 58, 22, { fill: C.brandTint, radius: 11 }),
        s.centeredText('Label', 'Admin', { x: W - 32 - 58, y: y + 14, w: 58, h: 22 }, { size: 12, weight: 600, color: C.brandInk }),
      ]))
    }
    if (i < members.length - 1) parts.push(line(y))
    ids.push(s.group(`Member / ${name}`, parts))
  })
  s.group('Members', ids)
  homeIndicator(s, C.ink)
}

// ---------------------------------------------------------------------------
// 12 Media, links and docs
// ---------------------------------------------------------------------------

export function mediaGrid(s: Board, a: Assets): void {
  statusBar(s, C.ink)
  s.group('Navigation Bar', [
    s.icon('Back', I.back, 6, 56, 24, C.brandInk, { width: 2.2 }),
    segmented(s, ['Media', 'Links', 'Docs'], 'Media', 56, 52, 236),
    s.text('Select', 'Select', W - 16, 57, { size: 17, weight: 500, color: C.brandInk, anchor: 'right' }),
  ])
  s.rect('Hairline', 0, 97.5, W, 0.5, { fill: C.line })
  const photos = [a.cabin, ...a.media]
  const videos: Record<number, string> = { 2: '0:32', 9: '1:05' }
  const months: Array<[string, number]> = [['September', 6], ['August', 6], ['July', 3]]
  let y = 98
  let n = 0
  const cols = [0, 131, 261]
  const widths = [129, 128, 129]
  for (const [month, count] of months) {
    const ids: NodeId[] = [
      s.rect('Header', 0, y, W, 36, { fill: C.surface }),
      s.text('Month', month, 16, y + 9, { size: 15, weight: 600, color: C.ink }),
    ]
    y += 36
    for (let i = 0; i < count; i++) {
      const col = i % 3
      const top = y + Math.floor(i / 3) * 131
      const h = Math.min(129, H - top)
      const parts: NodeId[] = [s.photo('Photo', photos[n]!, cols[col]!, top, widths[col]!, h)]
      const duration = videos[n]
      if (duration) {
        parts.push(s.rect('Shade', cols[col]!, top + h - 36, widths[col]!, 36, { fill: linear([['#000000', 0, 0], ['#000000', 1, 0.5]]) }))
        parts.push(s.icon('Video Icon', I.video, cols[col]! + 8, top + h - 24, 16, C.white, { width: 2 }))
        parts.push(s.text('Duration', duration, cols[col]! + 30, top + h - 23, { size: 12.5, weight: 600, color: C.white }))
      }
      ids.push(s.group(duration ? `Video ${n + 1}` : `Photo ${n + 1}`, parts))
      n++
    }
    y += Math.ceil(count / 3) * 131
    s.group(`Month / ${month}`, ids)
  }
  homeIndicator(s, C.white)
}

// ---------------------------------------------------------------------------
// 13 Calls
// ---------------------------------------------------------------------------

interface CallRow {
  name: string
  picture: ImageAsset
  kind: 'audio' | 'video'
  direction: 'Incoming' | 'Outgoing' | 'Missed'
  count?: number
  when: string
}

export function calls(s: Board, a: Assets): void {
  const f = a.face
  largeHeader(s, 'Calls', { left: 'edit', right: [['New Call', I.newCall]], search: 'Search' })
  chips(s, ['All', 'Missed', 'Video'], 'All', 16, 190)
  s.group('Create Call Link', [
    iconCircle(s, 'Icon', I.link, 38, 262, 22, { iconSize: 22 }),
    s.text('Title', 'Create call link', 72, 243, { size: 16.5, weight: 600, color: C.ink }),
    s.text('Detail', 'Share a link for your Relay call', 72, 265, { size: 14, color: C.grey }),
    s.rect('Hairline', 72, 293.5, W - 72, 0.5, { fill: C.line }),
  ])
  s.text('Recent', 'Recent', 16, 310, { size: 20, weight: 700, color: C.ink })
  const rows: CallRow[] = [
    { name: 'Daniel Kim', picture: f.Daniel!, kind: 'audio', direction: 'Missed', when: '8:47' },
    { name: 'Lisbon Trip', picture: a.lisbon, kind: 'video', direction: 'Incoming', when: 'Yesterday' },
    { name: 'Maya Chen', picture: f.Maya!, kind: 'video', direction: 'Outgoing', when: 'Yesterday' },
    { name: 'Grace Okafor', picture: f.Grace!, kind: 'audio', direction: 'Incoming', count: 2, when: 'Yesterday' },
    { name: 'Kenji Tanaka', picture: f.Kenji!, kind: 'video', direction: 'Missed', when: 'Wednesday' },
    { name: 'Priya Patel', picture: f.Priya!, kind: 'audio', direction: 'Outgoing', when: 'Tuesday' },
    { name: 'Omar Haddad', picture: f.Omar!, kind: 'audio', direction: 'Incoming', when: '06/09/2026' },
  ]
  s.group('Call List', rows.map((r, i) => {
    const y = 344 + i * 64
    const missed = r.direction === 'Missed'
    const label = `${r.direction}${r.count ? ` (${r.count})` : ''}`
    return s.group(`Call / ${r.name}`, [
      avatar(s, 'Avatar', r.picture, 16, y + 10, 44),
      s.text('Name', r.name, 72, y + 10, { size: 16.5, weight: 600, color: missed ? C.red : C.ink }),
      s.icon('Direction', r.direction === 'Outgoing' ? I.outgoing : I.incoming, 72, y + 35, 14, missed ? C.red : C.grey, { width: 2.2 }),
      s.icon('Kind', r.kind === 'video' ? I.video : I.phone, 90, y + 35, 14, C.grey, { width: 2 }),
      s.text('Direction Label', label, 110, y + 33, { size: 14, color: C.grey }),
      s.text('When', r.when, W - 50, y + 22, { size: 14, color: C.grey, anchor: 'right' }),
      s.icon('Info', I.info, W - 40, y + 20, 24, C.brandInk, { width: 1.7 }),
      s.rect('Hairline', 72, y + 63.5, W - 72, 0.5, { fill: C.line }),
    ])
  }))
  tabBar(s, 'Calls', { Chats: '4', Updates: '•' })
}

// ---------------------------------------------------------------------------
// 14 Incoming call
// ---------------------------------------------------------------------------

export function incomingCall(s: Board, a: Assets): void {
  s.photo('Backdrop', a.backdrop, 0, 0, W, H)
  statusBar(s, C.white)
  const lock = { size: 13, color: C.white, opacity: 0.72 }
  const lw = s.measure('End-to-end encrypted', lock).width + 20
  s.group('Encryption', [
    s.icon('Lock', I.lock, (W - lw) / 2, 64, 14, C.white, { width: 2 }),
    s.text('Label', 'End-to-end encrypted', (W - lw) / 2 + 20, 63, lock),
  ])
  s.group('Caller', [
    s.circle('Pulse Outer', W / 2, 222, 104, { fill: solid(C.white, 0.05) }),
    s.circle('Pulse Inner', W / 2, 222, 82, { fill: solid(C.white, 0.08) }),
    avatar(s, 'Photo', a.face.Lucas!, W / 2 - 62, 160, 124),
    s.text('Name', 'Lucas Silva', W / 2, 348, { size: 32, weight: 600, color: C.white, anchor: 'center', letterSpacing: -0.01 }),
    s.text('State', 'Relay audio call…', W / 2, 392, { size: 17, color: C.white, opacity: 0.75, anchor: 'center' }),
  ])
  const quick: Array<[string, string, number]> = [['Remind me', I.clock, 110], ['Message', I.bubble, 280]]
  s.group('Quick Actions', quick.map(([label, icon, cx]) => s.group(`Action / ${label}`, [
    s.circle('Background', cx, 560, 24, { fill: solid(C.white, 0.14) }),
    s.icon('Icon', icon, cx - 12, 548, 24, C.white, { width: 1.8 }),
    s.text('Label', label, cx, 592, { size: 13, color: C.white, opacity: 0.8, anchor: 'center' }),
  ])))
  const hint = (cx: number) => s.group('Slide Hint', [0.3, 0.55, 0.9].map((o, i) =>
    s.fade(s.icon(`Chevron ${i + 1}`, I.chevronUp, cx - 11, 630 + i * 14, 22, C.white, { width: 2.4 }), o),
  ))
  s.group('Button / Decline', [
    hint(110),
    s.circle('Background', 110, 716, 36, { fill: C.red, shadow: shadow(8, 20, 0.35, 0, C.red) }),
    s.icon('Icon', I.hangUp, 92, 698, 36, C.white, { fill: C.white, width: 1 }),
    s.text('Label', 'Decline', 110, 762, { size: 14, weight: 500, color: C.white, anchor: 'center' }),
  ])
  s.group('Button / Accept', [
    hint(280),
    s.circle('Background', 280, 716, 36, { fill: C.green, shadow: shadow(8, 20, 0.35, 0, C.green) }),
    s.icon('Icon', I.phone, 264, 700, 32, C.white, { fill: C.white, width: 1 }),
    s.text('Label', 'Accept', 280, 762, { size: 14, weight: 500, color: C.white, anchor: 'center' }),
  ])
  s.text('Hint', 'Slide up to answer or decline', W / 2, 796, { size: 12.5, color: C.white, opacity: 0.6, anchor: 'center' })
  homeIndicator(s, C.white)
}

// ---------------------------------------------------------------------------
// 15 Video call
// ---------------------------------------------------------------------------

export function videoCall(s: Board, a: Assets): void {
  s.photo('Remote Video', a.remote, 0, 0, W, H)
  s.rect('Top Shade', 0, 0, W, 170, { fill: linear([['#000000', 0, 0.5], ['#000000', 1, 0]]) })
  s.rect('Bottom Shade', 0, 620, W, 224, { fill: linear([['#000000', 0, 0], ['#000000', 1, 0.55]]) })
  statusBar(s, C.white)
  s.group('Minimise', [
    s.circle('Background', 34, 76, 18, { fill: solid('#FFFFFF', 0.16) }),
    s.icon('Icon', I.chevronDown, 24, 66, 20, C.white, { width: 2.2 }),
  ])
  s.group('Call Info', [
    s.text('Name', 'Maya Chen', W / 2, 60, { size: 20, weight: 600, color: C.white, anchor: 'center' }),
    s.icon('Lock', I.lock, W / 2 - 30, 90, 12, C.white, { width: 2 }),
    s.text('Duration', '04:12', W / 2 - 14, 88, { size: 14, color: C.white, opacity: 0.85 }),
  ])
  s.group('Self View', [
    s.photo('Camera', a.self, W - 16 - 112, 120, 112, 168, 16),
    s.rect('Border', W - 16 - 112, 120, 112, 168, { fill: solid(C.white, 0), radius: 16, stroke: { color: C.white, width: 1.5, alpha: 0.5 }, shadow: shadow(8, 20, 0.3) }),
  ])
  const glass = solid('#FFFFFF', 0.16)
  const buttons: Array<[string, string, Paint | string, string]> = [
    ['More', I.more, glass, C.white],
    ['Camera', I.video, glass, C.white],
    ['Mute', I.micOff, C.white, C.ink],
    ['Flip Camera', I.flip, glass, C.white],
    ['End Call', I.hangUp, C.red, C.white],
  ]
  const ids: NodeId[] = [s.rect('Background', 16, 732, W - 32, 76, { fill: solid('#16211F', 0.72), radius: 38 })]
  buttons.forEach(([label, icon, fill, colour], i) => {
    const cx = 16 + 40 + i * 69.5
    const filled = label === 'End Call'
    ids.push(s.group(`Button / ${label}`, [
      s.circle('Background', cx, 770, 26, { fill }),
      s.icon('Icon', icon, cx - 13, 757, 26, colour, filled ? { fill: C.white, width: 1 } : { width: label === 'More' ? 3 : 1.9 }),
    ]))
  })
  s.group('Controls', ids)
  homeIndicator(s, C.white)
}

// ---------------------------------------------------------------------------
// 16 Updates
// ---------------------------------------------------------------------------

export function updates(s: Board, a: Assets): void {
  const f = a.face
  largeHeader(s, 'Updates', { right: [['New Status', I.plus, true], ['Camera', I.camera]], search: 'Search' })
  s.text('Status', 'Status', 16, 196, { size: 20, weight: 700, color: C.ink })
  s.group('My Status', [
    avatar(s, 'Avatar', f.Jonas!, 16, 232, 54),
    s.circle('Add Badge', 62, 276, 11, { fill: C.brand, stroke: { color: C.white, width: 2.5 } }),
    s.icon('Plus', I.plus, 54, 268, 16, C.white, { width: 2.6 }),
    s.text('Title', 'My status', 84, 237, { size: 16.5, weight: 600, color: C.ink }),
    s.text('Detail', 'Tap to add status update', 84, 261, { size: 14, color: C.grey }),
  ])
  sectionLabel(s, 'Recent updates', 16, 310)
  const recent: Array<[string, ImageAsset, number, number, string]> = [
    ['Maya Chen', f.Maya!, 3, 1, '12 minutes ago'],
    ['Lucas Silva', f.Lucas!, 1, 0, '34 minutes ago'],
    ['Grace Okafor', f.Grace!, 2, 0, 'Today, 7:48'],
  ]
  s.group('Recent Updates', recent.map(([name, face, total, seen, when], i) => {
    const y = 334 + i * 68
    return s.group(`Update / ${name}`, [
      statusRing(s, 44, y + 34, 28, total, seen),
      avatar(s, 'Avatar', face, 22, y + 12, 44),
      s.text('Name', name, 84, y + 14, { size: 16.5, weight: 600, color: C.ink }),
      s.text('When', when, 84, y + 38, { size: 14, color: C.grey }),
      s.rect('Hairline', 84, y + 67.5, W - 84, 0.5, { fill: C.line }),
    ])
  }))
  s.group('Channels Header', [
    s.text('Title', 'Channels', 16, 546, { size: 20, weight: 700, color: C.ink }),
    s.text('Explore', 'Explore', W - 16, 550, { size: 15, weight: 600, color: C.brandInk, anchor: 'right' }),
    s.text('Detail', 'Stay updated on topics that matter to you.', 16, 576, { size: 14, color: C.grey }),
  ])
  const channels: Array<[string, string]> = [['Nordic Trails', '118K followers'], ['City Bites', '86K followers'], ['Pixel & Pine', '42K followers']]
  const cw = (W - 32 - 16) / 3
  s.group('Channels To Follow', channels.map(([name, followers], i) => {
    const x = 16 + i * (cw + 8)
    const y = 604
    return s.group(`Channel / ${name}`, [
      s.rect('Card', x, y, cw, 142, { fill: C.white, radius: 14, stroke: { color: C.line, width: 1 } }),
      avatar(s, 'Picture', a.channels[i]!, x + cw / 2 - 26, y + 12, 52),
      s.text('Name', name, x + cw / 2, y + 70, { size: 14, weight: 600, color: C.ink, anchor: 'center' }),
      s.text('Followers', followers, x + cw / 2, y + 90, { size: 12, color: C.grey, anchor: 'center' }),
      s.group('Button / Follow', [
        s.rect('Background', x + 12, y + 106, cw - 24, 26, { fill: C.brandTint, radius: 13 }),
        s.centeredText('Label', 'Follow', { x: x + 12, y: y + 106, w: cw - 24, h: 26 }, { size: 13, weight: 600, color: C.brandInk }),
      ]),
    ])
  }))
  tabBar(s, 'Updates', { Chats: '4', Calls: '1' })
}

// ---------------------------------------------------------------------------
// 17 Status viewer
// ---------------------------------------------------------------------------

export function statusViewer(s: Board, a: Assets): void {
  s.photo('Status Photo', a.story, 0, 0, W, H)
  s.rect('Top Shade', 0, 0, W, 150, { fill: linear([['#000000', 0, 0.45], ['#000000', 1, 0]]) })
  s.rect('Bottom Shade', 0, 560, W, 284, { fill: linear([['#000000', 0, 0], ['#000000', 1, 0.6]]) })
  statusBar(s, C.white)
  const seg = (W - 24 - 8) / 3
  s.group('Progress', [0, 1, 2].flatMap((i) => {
    const x = 12 + i * (seg + 4)
    const ids = [s.rect(`Track ${i + 1}`, x, 52, seg, 3, { fill: solid(C.white, 0.35), radius: 1.5 })]
    if (i === 0) ids.push(s.rect('Watched', x, 52, seg, 3, { fill: C.white, radius: 1.5 }))
    if (i === 1) ids.push(s.rect('Playing', x, 52, seg * 0.45, 3, { fill: C.white, radius: 1.5 }))
    return ids
  }))
  s.group('Header', [
    s.icon('Back', I.back, 6, 72, 24, C.white, { width: 2.2 }),
    avatar(s, 'Avatar', a.face.Maya!, 36, 68, 36),
    s.text('Name', 'Maya Chen', 82, 68, { size: 15.5, weight: 600, color: C.white }),
    s.text('When', '12m ago', 82, 88, { size: 13, color: C.white, opacity: 0.78 }),
    s.icon('More', I.moreVertical, W - 44, 74, 24, C.white, { width: 3 }),
  ])
  s.text('Caption', 'Two weeks until cabin season. The lake is already waiting', W / 2, 640, {
    size: 18, weight: 500, color: C.white, width: 300, align: 'center', lineHeight: 1.4, anchor: 'center',
  })
  s.group('Reply', [
    s.icon('Chevron', I.chevronUp, W / 2 - 11, 700, 22, C.white, { width: 2.2 }),
    s.text('Label', 'Reply', W / 2, 720, { size: 13, weight: 500, color: C.white, opacity: 0.85, anchor: 'center' }),
  ])
  s.group('Reply Field', [
    s.rect('Field', 16, 752, W - 88, 46, { fill: solid(C.white, 0.14), radius: 23, stroke: { color: C.white, width: 1, alpha: 0.45 } }),
    s.text('Placeholder', 'Reply to Maya…', 36, 765, { size: 15.5, color: C.white, opacity: 0.85 }),
    s.icon('Emoji', I.emoji, W - 72 - 36, 763, 24, C.white, { width: 1.7 }),
    s.circle('Like Background', W - 40, 775, 23, { fill: solid(C.white, 0.14) }),
    s.icon('Like', I.heart, W - 52, 763, 24, C.white, { width: 1.8 }),
  ])
  homeIndicator(s, C.white)
}

// ---------------------------------------------------------------------------
// 18 New chat
// ---------------------------------------------------------------------------

export function newChat(s: Board, a: Assets): void {
  const f = a.face
  statusBar(s, C.white)
  s.rect('Screen Behind', 16, 48, W - 32, 40, { fill: solid('#FFFFFF', 0.28), radius: 12 })
  s.rect('Sheet', 0, 58, W, H - 58, { fill: C.surface, radius: [14, 14, 0, 0] })
  s.group('Sheet Header', [
    s.text('Title', 'New chat', W / 2, 76, { size: 17, weight: 600, color: C.ink, anchor: 'center' }),
    s.circle('Close Background', W - 32, 87, 15, { fill: '#E1E7E8' }),
    s.icon('Close', I.close, W - 41, 78, 18, C.grey, { width: 2.4 }),
  ])
  searchField(s, 16, 116, W - 40, 'Search name or number', '#E4E9EA')
  const top = 170
  const rows: Array<[string, string, boolean]> = [['New group', I.people, false], ['New contact', I.personAdd, true], ['New community', I.community, false]]
  s.group('Shortcuts', [
    s.rect('Card', 16, top, W - 40, 156, { fill: C.white, radius: 12 }),
    ...rows.map(([label, icon, qr], i) => {
      const y = top + i * 52
      const parts: NodeId[] = [
        iconCircle(s, 'Icon', icon, 48, y + 26, 18, { iconSize: 20 }),
        s.text('Label', label, 78, y + 15, { size: 16.5, color: C.ink }),
      ]
      if (qr) parts.push(s.icon('QR Code', I.qr, W - 60, y + 14, 24, C.brandInk, { width: 1.7 }))
      if (i < rows.length - 1) parts.push(s.rect('Hairline', 78, y + 51.5, W - 24 - 78, 0.5, { fill: C.line }))
      return s.group(`Row / ${label}`, parts)
    }),
  ])
  sectionLabel(s, 'Contacts on Relay', 32, 344)
  const contacts: Array<[string, string, ImageAsset, string]> = [
    ['A', 'Aisha Khan', f.Aisha!, 'At the studio till 6'],
    ['C', 'Chloe Martin', f.Chloe!, 'Available'],
    ['D', 'Daniel Kim', f.Daniel!, 'Coffee first, then code'],
    ['E', 'Emma Novak', f.Emma!, 'Plant mum, tent lender'],
    ['E', 'Ethan Moore', f.Ethan!, 'Busy'],
    ['G', 'Grace Okafor', f.Grace!, 'Sunday choir, weekday code'],
  ]
  const ids: NodeId[] = [s.rect('Card', 16, 366, W - 40, H - 366, { fill: C.white, radius: [12, 12, 0, 0] })]
  let y = 366
  let letter = ''
  contacts.forEach(([initial, name, face, about], i) => {
    if (initial !== letter) {
      letter = initial
      ids.push(s.text(`Letter / ${initial}`, initial, 32, y + 7, { size: 13, weight: 700, color: C.brandInk }))
      y += 24
    }
    const next = contacts[i + 1]
    ids.push(s.group(`Contact / ${name}`, [
      avatar(s, 'Avatar', face, 32, y + 7, 40),
      s.text('Name', name, 84, y + 7, { size: 16.5, weight: 600, color: C.ink }),
      s.text('About', about, 84, y + 29, { size: 13, color: C.grey }),
      ...(next && next[0] === initial ? [s.rect('Hairline', 84, y + 53.5, W - 24 - 84, 0.5, { fill: C.line })] : []),
    ]))
    y += 54
  })
  s.group('Contacts', ids)
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('')
  s.group('Alphabet Index', letters.map((l, i) =>
    s.text(`Index / ${l}`, l, W - 11, 176 + i * 20.5, { size: 11, weight: 600, color: C.brandInk, anchor: 'center' }),
  ))
  homeIndicator(s, C.ink)
}

// ---------------------------------------------------------------------------
// 19 Settings
// ---------------------------------------------------------------------------

export function settings(s: Board, a: Assets): void {
  s.rect('Grouped Background', 0, 0, W, H, { fill: C.surface })
  largeHeader(s, 'Settings', { search: 'Search', searchFill: '#E6EBEC' })
  s.group('Profile', [
    s.rect('Card', 16, 196, W - 32, 88, { fill: C.white, radius: 12 }),
    avatar(s, 'Avatar', a.face.Jonas!, 30, 210, 60),
    s.text('Name', 'Jonas Berg', 104, 216, { size: 20, weight: 600, color: C.ink }),
    s.text('About', 'Out on the water', 104, 245, { size: 14.5, color: C.grey }),
    s.circle('QR Background', W - 50, 240, 20, { fill: C.brandTint }),
    s.icon('QR Code', I.qr, W - 61, 229, 22, C.brandInk, { width: 1.7 }),
  ])
  const first = rowCard(s, 'Settings / Main', 16, 300, W - 32, [
    { label: 'Account', icon: I.key, tile: '#3B82F6' },
    { label: 'Privacy', icon: I.lock, tile: C.brand },
    { label: 'Chats', icon: I.bubble, tile: '#22B061' },
    { label: 'Notifications', icon: I.bell, tile: '#EF4056' },
    { label: 'Storage and data', icon: I.storage, tile: '#14A38B', value: '2.4 GB' },
  ], 50)
  rowCard(s, 'Settings / Support', 16, first.bottom + 16, W - 32, [
    { label: 'Help', icon: I.help, tile: '#4C8DF6' },
    { label: 'Invite a friend', icon: I.heart, tile: '#EE5A8F' },
  ], 50)
  s.text('Footer', 'Relay 3.2 · Private by design', W / 2, first.bottom + 16 + 100 + 20, { size: 12.5, color: C.faint, anchor: 'center' })
  tabBar(s, 'Settings', { Chats: '4', Updates: '•', Calls: '1' })
}

