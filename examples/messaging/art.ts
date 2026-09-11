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
 * The pictures Relay rasterises: the doodle wallpaper behind every chat, the
 * blurred backdrop of an incoming call, and the two video frames of a call —
 * a person from the shared cast standing in front of one of the shared scenes.
 */

import { avatar, type Person } from '../art/people'
import { scene, type SceneKind } from '../art/scenes'
import { I } from './icons'

const svg = (w: number, h: number, body: string, vw = w, vh = h) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${vw} ${vh}">${body}</svg>`

/** A person's portrait, as a standalone SVG for the rasteriser. */
export function portraitSvg(p: Person, size: number): string {
  return svg(size, size, avatar(p, `av${p.handle.replace(/[^a-z]/g, '')}`), 480, 480)
}

/** A scene cropped to a square, for group pictures and channel icons. */
export function sceneTileSvg(kind: SceneKind, seed: number, size: number): string {
  return svg(size, size, scene(kind, seed, size, size))
}

// ---------------------------------------------------------------------------
// Chat wallpaper
// ---------------------------------------------------------------------------

const DOODLES: Record<string, string> = {
  heart: I.heart,
  star: I.star,
  bubble: I.bubble,
  camera: I.camera,
  send: I.send,
  smile: I.emoji,
  music: 'M9 17.5V6l10-2v11.5 M9 17.5a2.5 2.5 0 1 1-5 0a2.5 2.5 0 1 1 5 0z M19 15.5a2.5 2.5 0 1 1-5 0a2.5 2.5 0 1 1 5 0z',
  cloud: 'M7 17.5h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.3A3.4 3.4 0 0 0 7 17.5z',
  coffee: 'M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z M16 10.5h1.5a2.5 2.5 0 0 1 0 5H16 M8.5 3.5c-.8 1 .8 2 0 3 M12 3.5c-.8 1 .8 2 0 3',
  leaf: 'M5 19C5 10 10 5 19 5c0 9-5 14-14 14z M5 19l8-8',
  moon: 'M19 14.5A7.5 7.5 0 1 1 9.5 5a6 6 0 0 0 9.5 9.5z',
  sun: 'M12 8.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7z M12 3v2 M12 19v2 M3 12h2 M19 12h2 M5.6 5.6l1.4 1.4 M17 17l1.4 1.4 M5.6 18.4L7 17 M17 7l1.4-1.4',
  plane: 'M3 13.5l7-1.5 4-7.5 2 .5-1.5 7 5 1.5.5 2-6-.5-2.5 5.5-1.5-.5.5-5.5-6.5-.5z',
  gift: 'M4.5 10h15v10h-15z M3.5 7h17v3h-17z M12 7v13 M12 7c-1.5-3.5-5.5-3.5-5-1 .3 1 2.5 1 5 1 M12 7c1.5-3.5 5.5-3.5 5-1-.3 1-2.5 1-5 1',
  pin: I.location,
  bell: I.bell,
}

/** Where each doodle sits on one 200-unit tile, how big, and how far turned. */
const TILE: Array<[keyof typeof DOODLES, number, number, number, number]> = [
  ['heart', 14, 12, 1.1, -12],
  ['cloud', 78, 6, 1.2, 0],
  ['music', 144, 18, 1.05, 10],
  ['smile', 40, 58, 1.1, 8],
  ['send', 108, 60, 1.1, -18],
  ['leaf', 168, 76, 1, 20],
  ['camera', 8, 108, 1.05, -6],
  ['coffee', 70, 118, 1.1, 6],
  ['star', 130, 116, 1, 14],
  ['moon', 30, 160, 1, -10],
  ['gift', 92, 170, 1.05, 4],
  ['bubble', 156, 156, 1.1, -8],
  ['sun', 190, 124, 0.9, 0],
  ['plane', 184, 190, 1, -24],
  ['pin', 118, 8, 0.9, 0],
  ['bell', 6, 196, 0.95, 12],
]

/**
 * Relay's chat wallpaper: a quiet ground with small line doodles repeated at
 * low contrast, so bubbles sit on something without competing with it.
 */
export function wallpaperSvg(w: number, h: number, dark: boolean, scale: number): string {
  const ground = dark ? '#0B1215' : '#E8EEEA'
  const ink = dark ? '#9CC4BD' : '#6E978D'
  const alpha = dark ? 0.09 : 0.22
  const tile = TILE.map(([name, x, y, k, turn]) =>
    `<g transform="translate(${x} ${y}) rotate(${turn} 12 12) scale(${k})"><path d="${DOODLES[name]}"/></g>`,
  ).join('')
  const pattern = `<pattern id="doodles" width="212" height="212" patternUnits="userSpaceOnUse">` +
    `<g fill="none" stroke="${ink}" stroke-opacity="${alpha}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${tile}</g></pattern>`
  return svg(w * scale, h * scale, `<defs>${pattern}</defs><rect width="${w}" height="${h}" fill="${ground}"/>` +
    `<rect width="${w}" height="${h}" fill="url(#doodles)"/>`, w, h)
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

/** A scene thrown out of focus and darkened, for the incoming-call screen. */
export function callBackdropSvg(kind: SceneKind, seed: number, w: number, h: number): string {
  return svg(w, h, `<defs>
      <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${w * 0.06}"/></filter>
      <linearGradient id="dim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#061012" stop-opacity=".55"/>
        <stop offset=".45" stop-color="#061012" stop-opacity=".35"/>
        <stop offset="1" stop-color="#061012" stop-opacity=".85"/>
      </linearGradient></defs>
    <g filter="url(#soft)" transform="translate(${-w * 0.15} ${-h * 0.15}) scale(1.3)">${scene(kind, seed, w, h)}</g>
    <rect width="${w}" height="${h}" fill="url(#dim)"/>`)
}

/**
 * One frame of a video call: a scene, a little out of focus as a phone camera
 * leaves a background, and a person from the cast in front of it.
 */
export function videoFrameSvg(
  p: Person,
  kind: SceneKind,
  seed: number,
  w: number,
  h: number,
  o: { size: number; top: number; blur: number; scale: number },
): string {
  const id = `vf${p.handle.replace(/[^a-z]/g, '')}`
  const portrait = avatar(p, id).replace(/<rect width="480" height="480" fill="url\(#[^)]+\)"\/>/, '')
  const k = o.size / 480
  const left = (w - o.size) / 2
  return svg(w * o.scale, h * o.scale, `<defs>
      <filter id="${id}soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${o.blur}"/></filter>
      <radialGradient id="${id}vig" cx=".5" cy=".45" r=".75"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></radialGradient></defs>
    <g filter="url(#${id}soft)" transform="translate(${-w * 0.08} ${-h * 0.08}) scale(1.16)">${scene(kind, seed, w, h)}</g>
    <g transform="translate(${left} ${o.top}) scale(${k})">${portrait}</g>
    <rect width="${w}" height="${h}" fill="url(#${id}vig)"/>`, w, h)
}
