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
 * The chats: the list, the one-to-one conversation with Maya (light and
 * dark), the Lisbon Trip group, and a reply to Emma being typed.
 *
 * It is 9:41 on Friday 11 September. Maya found the cabin free for the 26th,
 * the Lisbon group is settling its plans, and Emma is lending her tent — every
 * time, tick and unread count below agrees with the list.
 */

import type { ImageAsset, NodeId } from '@/document/types'
import type { Assets } from './assets'
import { Chat } from './chat'
import { I } from './icons'
import { Board, C, DARK, H, LIGHT, SENDER, W, type ChatTheme } from './theme'
import {
  avatar, badge, CHAT_TOP, chatHeader, chips, INPUT_TOP, inputBar, largeHeader, qwerty, tabBar, ticks,
} from './ui'

// ---------------------------------------------------------------------------
// 05 Chats
// ---------------------------------------------------------------------------

type Piece = string | { icon: string; color?: string } | { ticks: 'read' | 'delivered' } | { strong: string }

interface ChatRow {
  name: string
  picture: ImageAsset
  time: string
  preview: Piece[]
  unread?: number
  pinned?: boolean
  muted?: boolean
  typing?: boolean
}

/** Cut text to fit `max` px, with an ellipsis, the way a list row does. */
function fit(s: Board, text: string, o: { size: number; weight?: number }, max: number): string {
  if (s.measure(text, o).width <= max) return text
  let cut = text
  while (cut.length > 1 && s.measure(`${cut}…`, o).width > max) cut = cut.slice(0, -1)
  return `${cut.trimEnd()}…`
}

function chatRow(s: Board, r: ChatRow, y: number): NodeId {
  const h = 76
  const ids: NodeId[] = [avatar(s, 'Avatar', r.picture, 16, y + 11, 54)]
  const active = (r.unread ?? 0) > 0
  ids.push(s.text('Name', r.name, 82, y + 12, { size: 16.5, weight: 600, color: C.ink }))
  ids.push(s.text('Time', r.time, W - 16, y + 14, { size: 13.5, weight: active ? 600 : 400, color: active && !r.muted ? C.brandInk : C.grey, anchor: 'right' }))

  // The right-hand column, right to left: the count, the muted mark, the pin.
  let right = W - 16
  const status: NodeId[] = []
  if (active) {
    const text = String(r.unread)
    const w = Math.max(20, s.measure(text, { size: 12, weight: 600 }).width + 12)
    status.push(badge(s, text, right - w / 2, y + 48, r.muted ? '#A5B0B3' : C.brand))
    right -= w + 6
  }
  if (r.muted) {
    status.push(s.icon('Muted', I.muted, right - 18, y + 39, 18, '#A5B0B3', { width: 1.8 }))
    right -= 22
  }
  if (r.pinned) {
    status.push(s.icon('Pinned', I.pin, right - 18, y + 39, 18, '#A5B0B3', { width: 1.8 }))
    right -= 22
  }
  if (status.length) ids.push(s.group('Status', status))

  // The preview line, piece by piece.
  const line = { size: 15, color: C.grey }
  let x = 82
  const max = right - 8
  const parts: NodeId[] = []
  for (const p of r.preview) {
    if (typeof p === 'string') {
      parts.push(s.text('Text', fit(s, p, line, max - x), x, y + 40, { ...line, color: r.typing ? C.brandInk : C.grey, weight: r.typing ? 500 : 400 }))
      x += s.measure(p, line).width
    } else if ('strong' in p) {
      parts.push(s.text('Sender', p.strong, x, y + 40, { ...line, weight: 500, color: C.body }))
      x += s.measure(p.strong, { ...line, weight: 500 }).width
    } else if ('ticks' in p) {
      parts.push(ticks(s, x - 1, y + 40, p.ticks, '#9AA6A9', 18))
      x += 20
    } else {
      parts.push(s.icon('Icon', p.icon, x, y + 41, 17, p.color ?? C.grey, { width: 1.8 }))
      x += 21
    }
  }
  ids.push(s.group('Preview', parts))
  ids.push(s.rect('Hairline', 82, y + h - 0.5, W - 82, 0.5, { fill: C.line }))
  return s.group(`Chat Row / ${r.name}`, ids)
}

export function chatsList(s: Board, a: Assets): void {
  const f = a.face
  largeHeader(s, 'Chats', { left: 'more', right: [['New Chat', I.plus, true], ['Camera', I.camera]], search: 'Search' })
  chips(s, ['All', 'Unread', 'Groups', 'Favourites'], 'All', 16, 190)
  s.group('Archived', [
    s.icon('Icon', I.archive, 31, 240, 22, C.grey, { width: 1.8 }),
    s.text('Label', 'Archived', 82, 241, { size: 16, weight: 500, color: C.ink }),
    s.text('Count', '6', W - 16, 242, { size: 14, color: C.grey, anchor: 'right' }),
    s.rect('Hairline', 82, 273.5, W - 82, 0.5, { fill: C.line }),
  ])
  const rows: ChatRow[] = [
    { name: 'Maya Chen', picture: f.Maya!, time: '9:38', preview: ['typing…'], typing: true, unread: 2, pinned: true },
    { name: 'Lisbon Trip', picture: a.lisbon, time: '9:31', preview: [{ strong: 'Maya: ' }, { icon: I.location }, 'Location'], unread: 5, pinned: true },
    { name: 'Family', picture: a.family, time: '8:15', preview: [{ strong: 'Dad: ' }, 'Dinner at ours on Sunday, 6 pm?'], unread: 3, pinned: true, muted: true },
    { name: 'Emma Novak', picture: f.Emma!, time: '9:06', preview: ['Oh lovely! Bring me back some cinnamon buns'] },
    { name: 'Daniel Kim', picture: f.Daniel!, time: '8:49', preview: [{ icon: I.mic, color: C.brandInk }, '0:42'], unread: 1 },
    { name: 'Design Team', picture: a.design, time: '8:30', preview: [{ strong: 'Aisha: ' }, { icon: I.camera }, 'Photo'], unread: 12 },
    { name: 'Sofia Rossi', picture: f.Sofia!, time: 'Yesterday', preview: [{ ticks: 'read' }, 'Boarding passes are in the group'] },
  ]
  s.group('Chat List', rows.map((r, i) => chatRow(s, r, 274 + i * 76)))
  tabBar(s, 'Chats', { Chats: '4', Updates: '•', Calls: '1' })
}

// ---------------------------------------------------------------------------
// 06 / 07 Chat with Maya
// ---------------------------------------------------------------------------

export function mayaChat(s: Board, a: Assets, t: ChatTheme): void {
  s.photo('Wallpaper', t.dark ? a.wallDark : a.wallLight, 0, 0, W, H)
  const maya = { name: 'Maya Chen', color: SENDER.Maya! }
  new Chat(s, t)
    .date('Today')
    .text(maya, 'Morning! The cabin at Lake Siljan is free the weekend of the 26th', '9:02')
    .photo(maya, a.cabin, 'The view from the deck last year', '9:03')
    .reply('me', { name: 'Maya Chen', color: t.dark ? '#6FA8F5' : SENDER.Maya!, text: 'The view from the deck…', picture: a.cabin }, 'No way. Book it before someone else does!', '9:07', { reaction: 'heart' })
    .unread('2 unread messages')
    .voice(maya, '0:24', '9:37', { face: a.face.Maya!, seed: 11 })
    .text(maya, 'Should we ask Lucas and Sofia too?', '9:38')
    .layout(CHAT_TOP + 8, INPUT_TOP - 10)
  chatHeader(s, t, {
    title: 'Maya Chen',
    subtitle: 'online',
    accentSubtitle: true,
    backCount: '3',
    picture: (x, y) => avatar(s, 'Avatar', a.face.Maya!, x, y, 40),
  })
  inputBar(s, t)
}

export const mayaLight = (s: Board, a: Assets) => mayaChat(s, a, LIGHT)
export const mayaDark = (s: Board, a: Assets) => mayaChat(s, a, DARK)

// ---------------------------------------------------------------------------
// 08 Group chat — Lisbon Trip
// ---------------------------------------------------------------------------

export function lisbonChat(s: Board, a: Assets): void {
  const f = a.face
  s.photo('Wallpaper', a.wallLight, 0, 0, W, H)
  const kenji = { name: 'Kenji Tanaka', color: SENDER.Kenji!, avatar: f.Kenji! }
  const lucas = { name: 'Lucas Silva', color: SENDER.Lucas!, avatar: f.Lucas! }
  const sofia = { name: 'Sofia Rossi', color: SENDER.Sofia!, avatar: f.Sofia! }
  const maya = { name: 'Maya Chen', color: SENDER.Maya!, avatar: f.Maya! }
  new Chat(s, LIGHT, { group: true })
    .doc(kenji, { name: 'Lisbon-itinerary.pdf', details: '4 pages · PDF · 1.2 MB' }, 'Draft plan, add anything I missed', '8:40')
    .poll(lucas, 'Day trip on Saturday?', [
      { label: 'Sintra palaces', votes: 3, voters: [f.Jonas!, f.Sofia!, f.Kenji!], mine: true },
      { label: 'Cascais & the coast', votes: 1, voters: [f.Maya!] },
      { label: 'Stay in the city', votes: 0, voters: [] },
    ], '8:55')
    .text(sofia, 'Pena Palace, finally!', '9:02')
    .location(maya, { name: 'Casa Alfama', address: 'Rua dos Remédios 42, Lisbon' }, '9:31')
    .layout(CHAT_TOP + 4, INPUT_TOP - 6)
  chatHeader(s, LIGHT, {
    title: 'Lisbon Trip',
    subtitle: 'Kenji, Lucas, Maya, Sofia, You',
    backCount: '3',
    picture: (x, y) => s.group('Members', [
      s.circle('Ring 1', x + 13, y + 13, 14, { fill: LIGHT.header }),
      avatar(s, 'Member / Sofia', f.Sofia!, x, y, 26),
      s.circle('Ring 2', x + 27, y + 27, 14.5, { fill: LIGHT.header }),
      avatar(s, 'Member / Kenji', f.Kenji!, x + 14, y + 14, 26),
    ]),
  })
  inputBar(s, LIGHT)
}

// ---------------------------------------------------------------------------
// 09 Chat with the keyboard up — Emma
// ---------------------------------------------------------------------------

export function emmaChat(s: Board, a: Assets): void {
  s.photo('Wallpaper', a.wallLight, 0, 0, W, H)
  const emma = { name: 'Emma Novak' }
  const keyboardTop = H - 309
  new Chat(s, LIGHT)
    .date('Today')
    .text('me', 'Hey! Could I borrow your tent for the weekend of the 26th?', '8:58')
    .text(emma, 'Of course! It’s in the garage, grab it whenever you like', '9:03')
    .text(emma, 'Going somewhere nice?', '9:03')
    .text('me', 'The cabin at Lake Siljan with Maya', '9:05')
    .text(emma, 'Oh lovely! Bring me back some cinnamon buns', '9:06', { reaction: 'joy' })
    .layout(CHAT_TOP + 8, keyboardTop - 54 - 10)
  chatHeader(s, LIGHT, {
    title: 'Emma Novak',
    subtitle: 'last seen today at 9:12',
    backCount: '3',
    picture: (x, y) => avatar(s, 'Avatar', a.face.Emma!, x, y, 40),
  })
  inputBar(s, LIGHT, keyboardTop - 54, 'Deal! I’ll swing by Thursday')
  qwerty(s, keyboardTop, ['thumbs', 'smile', 'joy', 'heart', 'love', 'fire', 'wow'])
}

