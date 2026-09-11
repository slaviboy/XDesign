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
 * Relay's design tokens: one brand teal, the neutrals around it, the light
 * and dark chat themes, and a Screen that can reach its document — for the
 * few properties the kit does not set itself (an image's fit, a path's shadow).
 */

import type { CornerRadii, DesignDocument, ImageAsset, ImageFit, NodeId, Paint, ShadowEffect } from '@/document/types'
import { Screen, shadow } from '../kit'

export const W = 390
export const H = 844

export const C = {
  brand: '#0FB5A6',
  brandDeep: '#0A8F84',
  /** Brand text on white — the teal darkened until it reads as type. */
  brandInk: '#08857A',
  brandTint: '#D8F3EE',
  brandSoft: '#EAF8F5',
  ink: '#132224',
  body: '#3A4A4D',
  grey: '#6E7C80',
  faint: '#A2AEB1',
  line: '#E3E8E9',
  surface: '#F3F5F5',
  field: '#ECF0F0',
  white: '#FFFFFF',
  wall: '#E9EFEB',
  red: '#EF4056',
  green: '#22C06A',
  read: '#2F95F5',
  keyboard: '#D4D8DD',
  keyDark: '#AAB1BA',
}

/** The colours a chat is drawn in; the same chat is drawn light and dark. */
export interface ChatTheme {
  dark: boolean
  header: string
  headerLine: string
  text: string
  sub: string
  icon: string
  accent: string
  bubbleIn: string
  bubbleOut: string
  metaIn: string
  metaOut: string
  quoteOut: string
  quoteIn: string
  chip: string
  chipText: string
  inputBar: string
  field: string
  fieldLine: string
  placeholder: string
  track: string
}

export const LIGHT: ChatTheme = {
  dark: false,
  header: '#F7F9F9',
  headerLine: '#DDE3E4',
  text: C.ink,
  sub: C.grey,
  icon: C.brandInk,
  accent: C.brandInk,
  bubbleIn: C.white,
  bubbleOut: '#D5F3ED',
  metaIn: '#8A979A',
  metaOut: '#5B8580',
  quoteOut: '#BFE8E0',
  quoteIn: '#F0F3F3',
  chip: '#FFFFFF',
  chipText: '#5B6A6D',
  inputBar: '#F7F9F9',
  field: '#FFFFFF',
  fieldLine: '#DDE3E4',
  placeholder: C.faint,
  track: '#C9D2D4',
}

export const DARK: ChatTheme = {
  dark: true,
  header: '#131C1F',
  headerLine: '#223033',
  text: '#E5EEEC',
  sub: '#8FA2A0',
  icon: '#3FD3C3',
  accent: '#3FD3C3',
  bubbleIn: '#1D282B',
  bubbleOut: '#0C5B53',
  metaIn: '#8397A0',
  metaOut: '#8CC9C0',
  quoteOut: '#0A4943',
  quoteIn: '#253236',
  chip: '#1B2629',
  chipText: '#A3B4B2',
  inputBar: '#131C1F',
  field: '#1E292C',
  fieldLine: '#2A3639',
  placeholder: '#6F8284',
  track: '#44565A',
}

/** Sender colours in group chats: one per person, the same in every group. */
export const SENDER: Record<string, string> = {
  Maya: '#2F7BE0',
  Lucas: '#8155E8',
  Sofia: '#D93D78',
  Kenji: '#E0702E',
  Aisha: '#1D9A6C',
}

export const CARD_SHADOW = shadow(1, 2, 0.08)

/**
 * A Screen that remembers its document, so an image can be told to cover its
 * box and a path can take a shadow — properties the kit leaves at defaults.
 */
export class Board extends Screen {
  constructor(
    readonly design: DesignDocument,
    name: string,
    x: number,
    background: string | Paint,
    y: number,
  ) {
    super(design, name, x, W, H, background, y)
  }

  /** An image that fills its box and crops the overflow, like a photo in a chat. */
  photo(
    name: string,
    asset: ImageAsset,
    x: number,
    y: number,
    w: number,
    h: number,
    radius: number | CornerRadii = 0,
    fit: ImageFit = 'cover',
  ): NodeId {
    const id = this.image(name, asset, x, y, w, h, radius)
    const node = this.design.nodes[id]
    if (node && node.type === 'image') node.fit = fit
    return id
  }

  shadowOn(id: NodeId, effect: ShadowEffect): NodeId {
    const node = this.design.nodes[id]
    if (node && 'style' in node) node.style.shadow = effect
    return id
  }

  /** Set a layer's opacity — for shapes the kit draws without that option. */
  fade(id: NodeId, opacity: number): NodeId {
    const node = this.design.nodes[id]
    if (node && 'style' in node) node.style.opacity = opacity
    return id
  }

  /** Square ends on a stroke, for a line that has to stop flush at an edge. */
  buttCap(id: NodeId): NodeId {
    const node = this.design.nodes[id]
    if (node && 'style' in node) node.style.stroke = { ...node.style.stroke, cap: 'butt' }
    return id
  }
}
