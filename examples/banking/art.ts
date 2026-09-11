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
 * The example's pictures: the welcome hero — two tilted cards and a coin on
 * Nova's indigo — and the people, rasterised once each and shared by every
 * screen that shows them.
 */

import type { DesignDocument, ImageAsset } from '@/document/types'
import { addAsset, rasterize } from '../kit'
import { avatar, person } from '../art/people'

/** Nova's four-point star as SVG path data. */
function star(cx: number, cy: number, r: number): string {
  const k = r * 0.16
  return `M${cx} ${cy - r} C${cx + k} ${cy - k} ${cx + k} ${cy - k} ${cx + r} ${cy} ` +
    `C${cx + k} ${cy + k} ${cx + k} ${cy + k} ${cx} ${cy + r} C${cx - k} ${cy + k} ${cx - k} ${cy + k} ${cx - r} ${cy} ` +
    `C${cx - k} ${cy - k} ${cx - k} ${cy - k} ${cx} ${cy - r} Z`
}

/** One card, 300 × 189 around its own centre, for the hero to tilt. */
function card(id: string, from: string, to: string, ink: string, chip: boolean): string {
  const dots = (x: number) => [0, 1, 2, 3].map((i) => `<circle cx="${x + i * 9}" cy="52" r="3" fill="${ink}" opacity=".85"/>`).join('')
  return `
  <defs>
    <linearGradient id="${id}f" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>
    <linearGradient id="${id}c" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F6DC98"/><stop offset="1" stop-color="#C4953A"/></linearGradient>
  </defs>
  <rect x="-150" y="-94.5" width="300" height="189" rx="18" fill="url(#${id}f)"/>
  <path d="M10 -94.5 L62 -94.5 L-2 94.5 L-54 94.5 Z" fill="#FFFFFF" opacity=".08"/>
  <path d="M74 -94.5 L90 -94.5 L26 94.5 L10 94.5 Z" fill="#FFFFFF" opacity=".06"/>
  <path d="${star(-124, -66, 9)}" fill="${ink}"/>
  <rect x="-108" y="-72" width="42" height="12" rx="6" fill="${ink}" opacity=".9"/>
  ${chip ? `<rect x="-128" y="-22" width="40" height="30" rx="6" fill="url(#${id}c)"/>
  <path d="M-115 -22 V8 M-101 -22 V8 M-128 -7 H-115 M-101 -7 H-88" stroke="#9C7424" stroke-opacity=".6" stroke-width="1.2"/>` : ''}
  <g transform="translate(-128 0)">${dots(0)}${dots(44)}${dots(88)}</g>
  <rect x="-128" y="62" width="64" height="8" rx="4" fill="${ink}" opacity=".55"/>
  <circle cx="118" cy="62" r="12" fill="none" stroke="${ink}" stroke-width="2.6" opacity=".9"/>
  <circle cx="126.5" cy="53.5" r="4.3" fill="${ink}"/>
  <circle cx="118" cy="62" r="3.6" fill="${ink}"/>`
}

/** The welcome hero, on a 390 × 520 stage. */
export function heroSvg(w: number, h: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 390 520">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5570FF"/><stop offset=".55" stop-color="#3D5AFE"/><stop offset="1" stop-color="#2A22B8"/></linearGradient>
  <radialGradient id="glowA" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#A89BFF" stop-opacity=".75"/><stop offset="1" stop-color="#A89BFF" stop-opacity="0"/></radialGradient>
  <radialGradient id="glowB" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#3EE0F0" stop-opacity=".45"/><stop offset="1" stop-color="#3EE0F0" stop-opacity="0"/></radialGradient>
  <radialGradient id="coin" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#FFF1BF"/><stop offset=".45" stop-color="#F5C85A"/><stop offset="1" stop-color="#B9862A"/></radialGradient>
  <linearGradient id="coinEdge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#D9A441"/><stop offset="1" stop-color="#8E6218"/></linearGradient>
  <filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14"/></filter>
</defs>
<rect width="390" height="520" fill="url(#bg)"/>
<circle cx="320" cy="120" r="190" fill="url(#glowA)"/>
<circle cx="40" cy="470" r="200" fill="url(#glowB)"/>
<g fill="none" stroke="#FFFFFF" stroke-opacity=".10">
  <circle cx="195" cy="300" r="120"/><circle cx="195" cy="300" r="175"/><circle cx="195" cy="300" r="235"/>
</g>
<ellipse cx="200" cy="440" rx="150" ry="22" fill="#10106A" opacity=".45" filter="url(#blur)"/>
<g transform="translate(178 262) rotate(-17)">${card('back', '#43465A', '#101119', '#FFFFFF', true)}</g>
<g transform="translate(212 334) rotate(9)">${card('front', '#FFFFFF', '#DCE2FF', '#2A2FCF', false)}</g>
<ellipse cx="300" cy="226" rx="46" ry="10" fill="#10106A" opacity=".35" filter="url(#blur)"/>
<g transform="translate(298 138)">
  <circle cx="0" cy="8" r="50" fill="url(#coinEdge)"/>
  <circle cx="0" cy="0" r="50" fill="url(#coin)"/>
  <circle cx="0" cy="0" r="38" fill="none" stroke="#B9862A" stroke-opacity=".55" stroke-width="2.5"/>
  <path d="${star(0, 0, 24)}" fill="#B9862A" opacity=".75"/>
  <path d="${star(-1.5, -1.5, 24)}" fill="#FFF4D2"/>
  <path d="M-30 -30 A42 42 0 0 1 12 -42" fill="none" stroke="#FFFFFF" stroke-opacity=".7" stroke-width="4" stroke-linecap="round"/>
</g>
<g transform="translate(70 118) rotate(-24)">
  <ellipse cx="0" cy="5" rx="22" ry="22" fill="url(#coinEdge)"/>
  <circle cx="0" cy="0" r="22" fill="url(#coin)"/>
  <path d="${star(0, 0, 10)}" fill="#FFF4D2"/>
</g>
<path d="${star(338, 330, 10)}" fill="#FFFFFF" opacity=".9"/>
<path d="${star(56, 250, 7)}" fill="#FFFFFF" opacity=".8"/>
<path d="${star(236, 76, 6)}" fill="#FFFFFF" opacity=".7"/>
<circle cx="120" cy="420" r="3" fill="#FFFFFF" opacity=".6"/>
<circle cx="350" cy="420" r="2.5" fill="#FFFFFF" opacity=".5"/>
</svg>`
}

export async function heroAsset(doc: DesignDocument): Promise<ImageAsset> {
  const w = 780
  const h = 1040
  return addAsset(doc, 'Welcome Hero', await rasterize(heroSvg(w, h), w, h, 'image/jpeg'), w, h)
}

/** Everyone the app shows, by first name, rasterised once at 160 px. */
export async function peopleAssets(doc: DesignDocument, firstNames: string[]): Promise<Record<string, ImageAsset>> {
  const size = 160
  const out: Record<string, ImageAsset> = {}
  await Promise.all(firstNames.map(async (first) => {
    const p = person(first)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 480 480">${avatar(p, `av${first}`)}</svg>`
    out[first] = addAsset(doc, `Avatar / ${p.name}`, await rasterize(svg, size, size), size, size)
  }))
  return out
}
