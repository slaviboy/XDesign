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
 * A conversation, laid out the way a chat app lays one out: messages stack
 * up from the input bar, a run of messages from one sender sits close with a
 * tail on its first bubble, and a bubble is only as wide as its words — the
 * time tucks in after the last line when it fits and drops below when not.
 *
 * Each message is measured first and drawn second, so the whole thread can
 * be anchored to the bottom of the screen like a real one.
 */

import type { ImageAsset, NodeId } from '@/document/types'
import { random, shadow, solid } from '../kit'
import { I } from './icons'
import { Board, C, W, type ChatTheme } from './theme'
import { avatar, emoji, place as placeOnGrid, ticks, type Emoji } from './ui'

export type State = 'sent' | 'delivered' | 'read'

export interface Sender {
  name: string
  color?: string
  avatar?: ImageAsset
}

export type From = 'me' | Sender

interface Item {
  key: string
  h: number
  draw: (y: number, first: boolean, last: boolean) => NodeId
}

/** The widest a line of message text runs. */
const MAX_TEXT = 266
const PX = 10
const PY = 7
const RADIUS = 11
const TEXT = { size: 15.5, lineHeight: 1.33 }
const META = { size: 11 }
const NAME = { size: 13, weight: 600 }
const TICKS_W = 18

interface Block {
  /** Inner width of the bubble. */
  w: number
  textW: number
  textH: number
  oneLine: boolean
  /** Extra height when the time has to drop under the last line. */
  below: number
}

/** A bubble with a tail on its top outer corner, or a plain rounded one. */
export function bubblePath(x: number, y: number, w: number, h: number, side: 'in' | 'out', tail: boolean): string {
  const r = RADIUS
  const R = x + w
  const B = y + h
  const arcTo = (tx: number, ty: number) => `A${r} ${r} 0 0 1 ${tx} ${ty}`
  if (!tail) {
    return `M${x + r} ${y}H${R - r}${arcTo(R, y + r)}V${B - r}${arcTo(R - r, B)}H${x + r}${arcTo(x, B - r)}V${y + r}${arcTo(x + r, y)}Z`
  }
  if (side === 'out') {
    return `M${x + r} ${y}H${R + 6.5}Q${R + 9} ${y} ${R + 7.6} ${y + 2.2}Q${R + 1.6} ${y + 7.6} ${R} ${y + 13}` +
      `V${B - r}${arcTo(R - r, B)}H${x + r}${arcTo(x, B - r)}V${y + r}${arcTo(x + r, y)}Z`
  }
  return `M${x - 6.5} ${y}H${R - r}${arcTo(R, y + r)}V${B - r}${arcTo(R - r, B)}H${x + r}${arcTo(x, B - r)}` +
    `V${y + 13}Q${x - 1.6} ${y + 7.6} ${x - 7.6} ${y + 2.2}Q${x - 9} ${y} ${x - 6.5} ${y}Z`
}

export class Chat {
  private readonly items: Item[] = []
  private readonly group: boolean
  private readonly wall: string

  constructor(private readonly s: Board, private readonly t: ChatTheme, o: { group?: boolean } = {}) {
    this.group = o.group ?? false
    this.wall = t.dark ? '#0B1215' : '#E8EEEA'
  }

  // -------------------------------------------------------------------------
  // Measuring
  // -------------------------------------------------------------------------

  private metaWidth(time: string, mine: boolean): number {
    return this.s.measure(time, META).width + (mine ? TICKS_W + 3 : 0)
  }

  /** The narrowest width that keeps `text` on as many lines as `max` does. */
  private tighten(text: string, max: number, height: number): number {
    let lo = max * 0.45
    let hi = max
    while (hi - lo > 1) {
      const mid = (lo + hi) / 2
      if (this.s.measure(text, { ...TEXT, width: mid }).height <= height) hi = mid
      else lo = mid
    }
    return Math.ceil(hi)
  }

  private block(text: string, metaW: number, max = MAX_TEXT): Block {
    const one = this.s.measure(text, TEXT)
    if (one.width + 8 + metaW <= max) {
      return { w: one.width + 8 + metaW, textW: one.width, textH: one.height, oneLine: true, below: 0 }
    }
    const narrow = max - 8 - metaW
    const hNarrow = this.s.measure(text, { ...TEXT, width: narrow }).height
    const hWide = this.s.measure(text, { ...TEXT, width: max }).height
    if (hNarrow === hWide) {
      const tw = this.tighten(text, narrow, hNarrow)
      return { w: tw + 8 + metaW, textW: tw, textH: hNarrow, oneLine: false, below: 0 }
    }
    const tw = this.tighten(text, max, hWide)
    return { w: Math.max(tw, metaW), textW: tw, textH: hWide, oneLine: false, below: 16 }
  }

  // -------------------------------------------------------------------------
  // Drawing pieces
  // -------------------------------------------------------------------------

  private bubble(x: number, y: number, w: number, h: number, mine: boolean, tail: boolean): NodeId {
    const id = this.s.path('Bubble', bubblePath(x, y, w, h, mine ? 'out' : 'in', tail), {
      fill: mine ? this.t.bubbleOut : this.t.bubbleIn,
      closed: true,
    })
    return this.s.shadowOn(id, shadow(1, 1, this.t.dark ? 0.25 : 0.12))
  }

  /** The time, and ticks on my own messages, right-aligned to `right`. */
  private meta(right: number, y: number, time: string, mine: boolean, state: State, onPhoto = false): NodeId {
    const colour = onPhoto ? C.white : mine ? this.t.metaOut : this.t.metaIn
    const ids: NodeId[] = []
    let x = right
    if (mine) {
      ids.push(ticks(this.s, x - TICKS_W, y - 2, state, colour, TICKS_W))
      x -= TICKS_W + 3
    }
    ids.push(this.s.text('Time', time, x, y, { ...META, color: colour, anchor: 'right' }))
    return this.s.group('Meta', ids)
  }

  private textInBubble(text: string, x: number, y: number, b: Block): NodeId {
    return this.s.text('Text', text, x, y, { ...TEXT, color: this.t.text, ...(b.oneLine ? {} : { width: b.textW }) })
  }

  private senderName(from: From, x: number, y: number): NodeId | undefined {
    if (from === 'me' || !this.group) return undefined
    return this.s.text('Sender', from.name, x, y, { ...NAME, color: from.color ?? C.brandInk })
  }

  private x(mine: boolean, w: number): number {
    return mine ? W - 16 - w : this.group ? 46 : 16
  }

  /** Whether a message from `from` would open a new run — and take a tail. */
  private isFirst(from: From): boolean {
    const prev = this.items[this.items.length - 1]
    return !prev || prev.key !== (from === 'me' ? 'me' : from.name)
  }

  private push(from: From, h: number, draw: Item['draw']): void {
    this.items.push({ key: from === 'me' ? 'me' : from.name, h, draw })
  }

  private reaction(kind: Emoji, x: number, bottom: number): NodeId {
    return this.s.group('Reaction', [
      this.s.rect('Chip', x, bottom - 5, 34, 24, { fill: this.t.chip, radius: 12, stroke: { color: this.wall, width: 2 }, shadow: shadow(1, 2, 0.12) }),
      emoji(this.s, kind, x + 8, bottom - 2, 18),
    ])
  }

  /** In a group, the sender's face beside the last bubble of their run. */
  private withAvatar(from: From, last: boolean, bottom: number, ids: NodeId[]): void {
    if (!this.group || from === 'me' || !last || !from.avatar) return
    ids.push(avatar(this.s, 'Avatar', from.avatar, 10, bottom - 28, 28))
  }

  // -------------------------------------------------------------------------
  // Message kinds
  // -------------------------------------------------------------------------

  date(label: string): this {
    const text = { size: 12.5, weight: 500, color: this.t.chipText }
    const w = this.s.measure(label, text).width + 24
    this.items.push({
      key: '#date',
      h: 26,
      draw: (y) => this.s.group(`Date / ${label}`, [
        this.s.rect('Background', (W - w) / 2, y, w, 26, { fill: this.t.chip, radius: 8, shadow: shadow(1, 1, 0.08) }),
        this.s.centeredText('Label', label, { x: (W - w) / 2, y, w, h: 26 }, text),
      ]),
    })
    return this
  }

  unread(label: string): this {
    this.items.push({
      key: '#unread',
      h: 28,
      draw: (y) => this.s.group('Unread Divider', [
        this.s.rect('Band', 0, y, W, 28, { fill: this.t.dark ? solid('#1A2528', 0.9) : solid(C.white, 0.72) }),
        this.s.centeredText('Label', label.toUpperCase(), { x: 0, y, w: W, h: 28 }, { size: 11.5, weight: 600, color: this.t.chipText, letterSpacing: 0.06 }),
      ]),
    })
    return this
  }

  text(from: From, text: string, time: string, o: { state?: State; reaction?: Emoji } = {}): this {
    const mine = from === 'me'
    const metaW = this.metaWidth(time, mine)
    const b = this.block(text, metaW)
    const nameW = !mine && this.group ? this.s.measure(from.name, NAME).width : 0
    const react = o.reaction ? 18 : 0
    const measure = (first: boolean) => {
      const head = !mine && this.group && first ? 19 : 0
      return { head, w: Math.max(b.w, nameW) + PX * 2, h: head + b.textH + PY * 2 + b.below }
    }
    this.push(from, measure(this.isFirst(from)).h + react, (y, first, last) => {
      const m = measure(first)
      const x = this.x(mine, m.w)
      const ids: NodeId[] = [this.bubble(x, y, m.w, m.h, mine, first)]
      const name = first ? this.senderName(from, x + PX, y + 6) : undefined
      if (name) ids.push(name)
      ids.push(this.textInBubble(text, x + PX, y + PY + m.head, b))
      ids.push(this.meta(x + m.w - PX + (mine ? 2 : 0), y + m.h - 19, time, mine, o.state ?? 'read'))
      if (o.reaction) ids.push(this.reaction(o.reaction, x + 10, y + m.h))
      this.withAvatar(from, last, y + m.h, ids)
      return this.s.group(`Message / ${mine ? 'Me' : (from as Sender).name} / ${time}`, ids)
    })
    // A run ending here with a shorter first bubble keeps its measured height.
    return this
  }

  photo(from: From, picture: ImageAsset, caption: string, time: string, o: { state?: State; reaction?: Emoji } = {}): this {
    const mine = from === 'me'
    const bw = 262
    const imgH = 166
    const metaW = this.metaWidth(time, mine)
    const b = this.block(caption, metaW, bw - PX * 2)
    const h = 3 + imgH + b.textH + PY * 2 - 2 + b.below
    this.push(from, h + (o.reaction ? 18 : 0), (y, first, last) => {
      const x = this.x(mine, bw)
      const ids: NodeId[] = [
        this.bubble(x, y, bw, h, mine, first),
        this.s.photo('Photo', picture, x + 3, y + 3, bw - 6, imgH, [9, 9, 5, 5]),
        this.textInBubble(caption, x + PX, y + 3 + imgH + PY - 2, b),
        this.meta(x + bw - PX + (mine ? 2 : 0), y + h - 19, time, mine, o.state ?? 'read'),
      ]
      if (o.reaction) ids.push(this.reaction(o.reaction, x + 10, y + h))
      this.withAvatar(from, last, y + h, ids)
      return this.s.group(`Message / Photo / ${time}`, ids)
    })
    return this
  }

  /** A reply: the quoted message in a tinted box, then the answer. */
  reply(
    from: From,
    quote: { name: string; color: string; text: string; picture?: ImageAsset },
    text: string,
    time: string,
    o: { state?: State; reaction?: Emoji } = {},
  ): this {
    const mine = from === 'me'
    const metaW = this.metaWidth(time, mine)
    const b = this.block(text, metaW)
    const bw = Math.max(b.w + PX * 2, 262)
    const quoteH = 56
    const h = 4 + quoteH + 4 + b.textH + PY * 2 - 4 + b.below
    this.push(from, h + (o.reaction ? 18 : 0), (y, first, last) => {
      const x = this.x(mine, bw)
      const qx = x + 4
      const qw = bw - 8
      const thumb = quote.picture ? quoteH : 0
      const ids: NodeId[] = [this.bubble(x, y, bw, h, mine, first)]
      const qIds: NodeId[] = [
        this.s.rect('Background', qx, y + 4, qw, quoteH, { fill: mine ? this.t.quoteOut : this.t.quoteIn, radius: 7 }),
        this.s.rect('Bar', qx, y + 4, 4, quoteH, { fill: quote.color, radius: [7, 0, 0, 7] }),
        this.s.text('Name', quote.name, qx + 13, y + 11, { ...NAME, color: quote.color }),
      ]
      let lineX = qx + 13
      if (quote.picture) {
        qIds.push(this.s.icon('Photo Icon', I.image, lineX, y + 33, 15, this.t.sub, { width: 1.8 }))
        lineX += 20
      }
      qIds.push(this.s.text('Quoted', quote.text, lineX, y + 32, { size: 13.5, color: this.t.sub }))
      if (quote.picture) qIds.push(this.s.photo('Thumbnail', quote.picture, qx + qw - thumb, y + 4, thumb, quoteH, [0, 7, 7, 0]))
      ids.push(this.s.group('Quote', qIds))
      ids.push(this.textInBubble(text, x + PX, y + 4 + quoteH + PY, b))
      ids.push(this.meta(x + bw - PX + (mine ? 2 : 0), y + h - 19, time, mine, o.state ?? 'read'))
      if (o.reaction) ids.push(this.reaction(o.reaction, x + 10, y + h))
      this.withAvatar(from, last, y + h, ids)
      return this.s.group(`Message / Reply / ${time}`, ids)
    })
    return this
  }

  /** A voice note: play, a waveform, how long it runs, and who recorded it. */
  voice(from: From, duration: string, time: string, o: { face?: ImageAsset; state?: State; seed?: number } = {}): this {
    const mine = from === 'me'
    const bw = 276
    const h = 64
    this.push(from, h, (y, first, last) => {
      const x = this.x(mine, bw)
      const wave = this.t.dark ? '#546A6E' : '#B4C0C2'
      const left = x + 50
      const right = x + bw - 66
      const mid = y + 25
      const r = random(o.seed ?? 7)
      let d = ''
      for (let bx = left + 6, i = 0; bx <= right; bx += 4.2, i++) {
        const envelope = 0.35 + 0.65 * Math.sin((i / 34) * Math.PI) ** 0.6
        const hh = Math.max(3, (4 + r() * 16) * envelope)
        d += `M${bx.toFixed(1)} ${(mid - hh / 2).toFixed(1)}V${(mid + hh / 2).toFixed(1)}`
      }
      const ids: NodeId[] = [
        this.bubble(x, y, bw, h, mine, first),
        this.s.icon('Play', I.play, x + 14, y + 13, 26, this.t.dark ? '#C9D6D4' : '#5F6E71', { fill: this.t.dark ? '#C9D6D4' : '#5F6E71', width: 1 }),
        this.s.path('Waveform', d, { stroke: wave, width: 2.4 }),
        this.s.circle('Playhead', left + 2, mid, 6.5, { fill: C.brand }),
        this.s.text('Duration', duration, left, y + 42, { ...META, color: mine ? this.t.metaOut : this.t.metaIn }),
        this.meta(right, y + 42, time, mine, o.state ?? 'read'),
      ]
      if (o.face) {
        ids.push(avatar(this.s, 'Recorded By', o.face, x + bw - 56, y + 9, 46))
        ids.push(this.s.group('Mic Badge', [
          this.s.circle('Badge', x + bw - 54, y + 47, 9, { fill: C.brand, stroke: { color: mine ? this.t.bubbleOut : this.t.bubbleIn, width: 2 } }),
          this.s.icon('Mic', I.mic, x + bw - 60, y + 41, 12, C.white, { width: 1.6 }),
        ]))
      }
      this.withAvatar(from, last, y + h, ids)
      return this.s.group(`Message / Voice Note / ${time}`, ids)
    })
    return this
  }

  /** A document: its icon, name and size, with an optional caption under it. */
  doc(from: From, file: { name: string; details: string }, caption: string, time: string): this {
    const mine = from === 'me'
    const bw = 272
    const metaW = this.metaWidth(time, mine)
    const b = this.block(caption, metaW, bw - PX * 2)
    const cardH = 58
    const measure = (first: boolean) => {
      const head = !mine && this.group && first ? 22 : 4
      return { head, h: head + cardH + b.textH + PY * 2 - 2 + b.below }
    }
    this.push(from, measure(this.isFirst(from)).h, (y, first, last) => {
      const m = measure(first)
      const x = this.x(mine, bw)
      const top = y + m.head
      const ids: NodeId[] = [this.bubble(x, y, bw, m.h, mine, first)]
      const name = first ? this.senderName(from, x + PX, y + 6) : undefined
      if (name) ids.push(name)
      ids.push(this.s.group('File', [
        this.s.rect('Background', x + 4, top, bw - 8, cardH, { fill: mine ? this.t.quoteOut : this.t.quoteIn, radius: 8 }),
        this.s.group('PDF Icon', [
          this.s.path('Sheet', `M${x + 16} ${top + 9}h20l8 8v32h-28z`, { fill: '#E5484D', closed: true }),
          this.s.path('Fold', `M${x + 36} ${top + 9}v8h8z`, { fill: '#F59A9D', closed: true }),
          this.s.text('Label', 'PDF', x + 30, top + 32, { size: 8.5, weight: 700, color: C.white, anchor: 'center' }),
        ]),
        this.s.text('File Name', file.name, x + 54, top + 11, { size: 14.5, weight: 500, color: this.t.text }),
        this.s.text('Details', file.details, x + 54, top + 32, { size: 12.5, color: this.t.sub }),
      ]))
      ids.push(this.textInBubble(caption, x + PX, top + cardH + PY - 2, b))
      ids.push(this.meta(x + bw - PX + (mine ? 2 : 0), y + m.h - 19, time, mine, 'read'))
      this.withAvatar(from, last, y + m.h, ids)
      return this.s.group(`Message / Document / ${time}`, ids)
    })
    return this
  }

  /** A poll: the question, each option with its bar and count, and "View votes". */
  poll(
    from: From,
    question: string,
    options: Array<{ label: string; votes: number; voters: ImageAsset[]; mine?: boolean }>,
    time: string,
  ): this {
    const mine = from === 'me'
    const bw = 280
    const total = Math.max(...options.map((o) => o.votes), 1)
    const measure = (first: boolean) => {
      const head = !mine && this.group && first ? 22 : 6
      return { head, h: head + 26 + 24 + options.length * 46 + 16 + 42 }
    }
    this.push(from, measure(this.isFirst(from)).h, (y, first, last) => {
      const m = measure(first)
      const x = this.x(mine, bw)
      const ids: NodeId[] = [this.bubble(x, y, bw, m.h, mine, first)]
      const name = first ? this.senderName(from, x + PX + 2, y + 6) : undefined
      if (name) ids.push(name)
      let top = y + m.head
      ids.push(this.s.text('Question', question, x + 12, top, { size: 16, weight: 600, color: this.t.text }))
      top += 26
      ids.push(this.s.group('Hint', [
        this.s.icon('Icon', I.tick, x + 12, top - 1, 15, this.t.sub, { width: 1.8 }),
        this.s.text('Label', 'Select one', x + 30, top, { size: 12.5, color: this.t.sub }),
      ]))
      top += 24
      options.forEach((opt, i) => {
        const oy = top + i * 46
        const parts: NodeId[] = []
        if (opt.mine) {
          parts.push(this.s.circle('Choice', x + 22, oy + 10, 10, { fill: C.brand }))
          parts.push(this.s.icon('Check', I.check, x + 15, oy + 3, 14, C.white, { width: 2.6 }))
        } else {
          parts.push(this.s.circle('Choice', x + 22, oy + 10, 9.5, { fill: solid(C.white, 0), stroke: { color: this.t.track, width: 1.6 } }))
        }
        parts.push(this.s.text('Option', opt.label, x + 42, oy + 1, { size: 15, color: this.t.text }))
        parts.push(this.s.text('Votes', String(opt.votes), x + bw - 14, oy + 1, { size: 14, weight: 500, color: this.t.sub, anchor: 'right' }))
        opt.voters.forEach((face, j) => {
          const cx = x + bw - 34 - j * 12
          parts.push(this.s.circle(`Voter Ring ${j + 1}`, cx - 9 + 9, oy + 10, 10, { fill: mine ? this.t.bubbleOut : this.t.bubbleIn }))
          parts.push(avatar(this.s, `Voter ${j + 1}`, face, cx - 9, oy + 1, 18))
        })
        const barW = bw - 42 - 14
        parts.push(this.s.rect('Track', x + 42, oy + 28, barW, 6, { fill: this.t.dark ? '#2C3A3D' : '#E4EAEA', radius: 3 }))
        if (opt.votes) parts.push(this.s.rect('Share', x + 42, oy + 28, (barW * opt.votes) / total, 6, { fill: C.brand, radius: 3 }))
        ids.push(this.s.group(`Option / ${opt.label}`, parts))
      })
      top += options.length * 46
      ids.push(this.meta(x + bw - PX, top - 2, time, mine, 'read'))
      top += 16
      ids.push(this.s.rect('Divider', x, top, bw, 0.5, { fill: this.t.dark ? '#2C3A3D' : '#E1E7E7' }))
      ids.push(this.s.centeredText('View Votes', 'View votes', { x, y: top, w: bw, h: 42 }, { size: 15, weight: 600, color: this.t.accent }))
      this.withAvatar(from, last, y + m.h, ids)
      return this.s.group(`Message / Poll / ${time}`, ids)
    })
    return this
  }

  /** A shared location: a small street map with a pin, and the address. */
  location(from: From, place: { name: string; address: string }, time: string): this {
    const mine = from === 'me'
    const bw = 262
    const mapH = 100
    const measure = (first: boolean) => {
      const head = !mine && this.group && first ? 22 : 3
      return { head, h: head + mapH + 56 }
    }
    this.push(from, measure(this.isFirst(from)).h, (y, first, last) => {
      const m = measure(first)
      const x = this.x(mine, bw)
      const ids: NodeId[] = [this.bubble(x, y, bw, m.h, mine, first)]
      const name = first ? this.senderName(from, x + PX, y + 6) : undefined
      if (name) ids.push(name)
      ids.push(this.map(x + 3, y + m.head, bw - 6, mapH, m.head > 3 ? [5, 5, 0, 0] : [9, 9, 0, 0]))
      const ty = y + m.head + mapH
      ids.push(this.s.text('Place', place.name, x + PX + 2, ty + 8, { size: 15, weight: 600, color: this.t.text }))
      ids.push(this.s.text('Address', place.address, x + PX + 2, ty + 28, { size: 13, color: this.t.sub }))
      ids.push(this.meta(x + bw - PX, y + m.h - 19, time, mine, 'read'))
      this.withAvatar(from, last, y + m.h, ids)
      return this.s.group(`Message / Location / ${time}`, ids)
    })
    return this
  }

  /** A street map drawn in shapes: blocks, a park, the river, streets, a pin. */
  private map(x: number, y: number, w: number, h: number, radius: [number, number, number, number]): NodeId {
    const s = this.s
    const R = x + w
    const B = y + h
    const street = (name: string, d: string, width: number, colour = '#FFFFFF') => s.buttCap(s.path(name, d, { stroke: colour, width }))
    const ids: NodeId[] = [
      s.rect('Land', x, y, w, h, { fill: '#EFEAE0', radius }),
      s.rect('Park', x + 22, y + 18, 58, 38, { fill: '#CFE5C6', radius: 6 }),
      s.rect('Square', x + 176, y + 16, 40, 30, { fill: '#E2DCCF', radius: 4 }),
      s.path('River', `M${x} ${B - 34}C${x + 70} ${B - 44} ${x + 150} ${B - 22} ${R} ${B - 38}V${B}H${x}Z`, { fill: '#A8D3EC', closed: true }),
      street('Avenue', `M${x} ${y + 70}C${x + 80} ${y + 62} ${x + 160} ${y + 80} ${R} ${y + 66}`, 7, '#F6D98E'),
      street('Street 1', `M${x + 100} ${y}L${x + 118} ${B - 30}`, 4.5),
      street('Street 2', `M${x + 160} ${y}L${x + 150} ${B - 26}`, 4.5),
      street('Street 3', `M${x} ${y + 36}H${x + 18} M${x + 84} ${y + 36}L${R} ${y + 44}`, 4),
      street('Street 4', `M${x + 210} ${y + 50}L${R - 26} ${B - 34}`, 3.5),
      street('Street 5', `M${x + 40} ${y + 70}L${x + 56} ${B - 36}`, 3.5),
      street('Lane', `M${x + 120} ${y + 22}H${x + 158} M${x + 60} ${y + 94}H${x + 112}`, 2.5),
    ]
    const px = x + w / 2 + 8
    const py = y + h / 2 + 6
    ids.push(s.group('Pin', [
      s.rect('Pin Shadow', px - 6, py - 2, 12, 4, { fill: solid('#000000', 0.2), radius: 2 }),
      s.shadowOn(s.path('Pin', placeOnGrid(PIN, px - 17, py - 29.75, 34), { fill: C.brand, closed: true }), shadow(2, 4, 0.25)),
      s.circle('Pin Dot', px, py - 15.6, 4.5, { fill: C.white }),
    ]))
    return s.group('Map', ids)
  }

  // -------------------------------------------------------------------------
  // Layout
  // -------------------------------------------------------------------------

  /** Stack every message up from `bottom`, and group them as the thread. */
  layout(top: number, bottom: number): NodeId {
    const gaps = this.items.map((item, i) => {
      if (i === 0) return 0
      const prev = this.items[i - 1]!
      if (item.key.startsWith('#') || prev.key.startsWith('#')) return 12
      return item.key === prev.key ? 3 : 10
    })
    const total = this.items.reduce((sum, item, i) => sum + item.h + gaps[i]!, 0)
    let y = bottom - total
    if (y < top) throw new Error(`The thread is ${Math.ceil(top - y)} px taller than the space it has.`)
    const ids = this.items.map((item, i) => {
      y += gaps[i]!
      const prev = this.items[i - 1]
      const next = this.items[i + 1]
      const id = item.draw(y, prev?.key !== item.key, next?.key !== item.key)
      y += item.h
      return id
    })
    return this.s.group('Messages', ids)
  }
}

/** The location icon's outer teardrop alone, to fill as a map pin. */
const PIN = I.location.split(' M')[0]!
