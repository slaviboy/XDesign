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
 * Illustrated people, for avatars, contacts and profile pictures.
 *
 * One parametric portrait — skin, hair style and colour, clothing, a beard,
 * glasses — on a 480 × 480 stage, and a cast of named people built from it so
 * every example that needs a face draws from the same, varied crowd. Rasterise
 * with kit.rasterize and show it through a round image layer.
 */

export type HairStyle = 'short' | 'long' | 'bun' | 'curly' | 'buzz' | 'bald' | 'side' | 'bob'

export interface Person {
  name: string
  /** A handle, for apps that show one. */
  handle: string
  skin: string
  hair: HairStyle
  hairColor: string
  shirt: string
  background: [string, string]
  beard?: boolean
  glasses?: boolean
}

const SKIN = {
  light: '#FFDBC4',
  fair: '#F5D0B5',
  medium: '#EDB98A',
  tan: '#D08B5B',
  brown: '#AE5D29',
  deep: '#8D5524',
  dark: '#614335',
}

export const PEOPLE: Person[] = [
  { name: 'Maya Chen', handle: 'maya.chen', skin: SKIN.fair, hair: 'long', hairColor: '#1F1A24', shirt: '#E4572E', background: ['#FFE0D1', '#FFB59A'] },
  { name: 'Liam Carter', handle: 'liamcarter', skin: SKIN.light, hair: 'short', hairColor: '#6B4226', shirt: '#2E4A7D', background: ['#DCE8FF', '#A9C3F7'], beard: true },
  { name: 'Sofia Rossi', handle: 'sofia.rossi', skin: SKIN.medium, hair: 'bun', hairColor: '#3B2417', shirt: '#F2C14E', background: ['#FFF1C9', '#F9D67A'] },
  { name: 'Noah Williams', handle: 'noahw', skin: SKIN.deep, hair: 'buzz', hairColor: '#17120F', shirt: '#1C1B2E', background: ['#D9F2E6', '#8FD6B4'] },
  { name: 'Aisha Khan', handle: 'aisha.k', skin: SKIN.tan, hair: 'long', hairColor: '#120E0C', shirt: '#7B5CFA', background: ['#EAE3FF', '#C3B2FF'], glasses: true },
  { name: 'Lucas Silva', handle: 'lucas.silva', skin: SKIN.brown, hair: 'curly', hairColor: '#1A1210', shirt: '#E4F0FF', background: ['#FFE3EC', '#FFB3C8'] },
  { name: 'Emma Novak', handle: 'emmanovak', skin: SKIN.light, hair: 'bob', hairColor: '#E3B35C', shirt: '#2EC4B6', background: ['#DDF6F2', '#9EE3D9'] },
  { name: 'Kenji Tanaka', handle: 'kenji.t', skin: SKIN.fair, hair: 'side', hairColor: '#141218', shirt: '#F25F5C', background: ['#FFE4D6', '#FFC0A0'], glasses: true },
  { name: 'Zara Ahmed', handle: 'zara.ahmed', skin: SKIN.medium, hair: 'curly', hairColor: '#2B1B14', shirt: '#FFB020', background: ['#E3F0FF', '#B7D4FF'] },
  { name: 'Daniel Kim', handle: 'dan.kim', skin: SKIN.fair, hair: 'short', hairColor: '#17151C', shirt: '#6A994E', background: ['#EEF5E1', '#C9E1A8'] },
  { name: 'Olivia Brown', handle: 'liv.brown', skin: SKIN.light, hair: 'long', hairColor: '#A0522D', shirt: '#264653', background: ['#FDE2E4', '#F7B6BD'] },
  { name: 'Mateo Garcia', handle: 'mateo.g', skin: SKIN.tan, hair: 'side', hairColor: '#2A1C14', shirt: '#E76F51', background: ['#FFF0D6', '#FFD08A'], beard: true },
  { name: 'Priya Patel', handle: 'priya.p', skin: SKIN.brown, hair: 'bun', hairColor: '#120D0B', shirt: '#D62D6E', background: ['#FFE0EE', '#FFA9CC'] },
  { name: 'Ethan Moore', handle: 'ethanmoore', skin: SKIN.light, hair: 'buzz', hairColor: '#C8A26B', shirt: '#3D5A80', background: ['#E0F2FE', '#9BD1F7'] },
  { name: 'Chloe Martin', handle: 'chloe.m', skin: SKIN.fair, hair: 'bob', hairColor: '#2D2226', shirt: '#F4A261', background: ['#F1E8FF', '#D2B8FF'] },
  { name: 'Omar Haddad', handle: 'omar.haddad', skin: SKIN.medium, hair: 'short', hairColor: '#1C140F', shirt: '#FFFFFF', background: ['#FFE8D6', '#F8B88B'], beard: true, glasses: true },
  { name: 'Grace Okafor', handle: 'grace.ok', skin: SKIN.dark, hair: 'curly', hairColor: '#0F0B09', shirt: '#2A9D8F', background: ['#FFF3C4', '#FFD96A'] },
  { name: 'Leo Fischer', handle: 'leofischer', skin: SKIN.light, hair: 'bald', hairColor: '#000000', shirt: '#1D3557', background: ['#E6F4EA', '#A8DAB5'], beard: true },
  { name: 'Isabella Lopez', handle: 'bella.lopez', skin: SKIN.tan, hair: 'long', hairColor: '#3A2215', shirt: '#9B5DE5', background: ['#E4F6FF', '#A6E1FF'] },
  { name: 'Jonas Berg', handle: 'jonas.berg', skin: SKIN.fair, hair: 'side', hairColor: '#D9B77E', shirt: '#43AA8B', background: ['#FFEFE5', '#FFC9A8'] },
]

/** The same person, found by first name — the cast is small enough to name. */
export function person(firstName: string): Person {
  const found = PEOPLE.find((p) => p.name.split(' ')[0] === firstName)
  if (!found) throw new Error(`No one called ${firstName} in the cast.`)
  return found
}

function shade(hex: string, amount: number): string {
  const n = Number.parseInt(hex.slice(1), 16)
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c * (1 + amount))))
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => f(c).toString(16).padStart(2, '0')).join('')}`
}

function hairBack(p: Person): string {
  const c = p.hairColor
  switch (p.hair) {
    case 'long':
      return `<path d="M136 214 C128 120 190 98 240 98 C300 98 356 128 346 226 C352 300 352 360 340 420 L140 420 C126 360 128 300 136 214 Z" fill="${c}"/>`
    case 'bob':
      return `<path d="M138 222 C130 128 188 100 240 100 C296 100 352 130 344 222 C348 262 344 300 330 322 L150 322 C136 300 132 262 138 222 Z" fill="${c}"/>`
    case 'curly':
      return [[160, 170, 52], [210, 128, 56], [272, 126, 56], [324, 170, 52], [150, 232, 44], [334, 232, 44]]
        .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>`).join('')
    default:
      return ''
  }
}

function hairFront(p: Person): string {
  const c = p.hairColor
  switch (p.hair) {
    case 'short':
      return `<path d="M144 206 C136 128 190 100 244 100 C306 102 346 138 338 206 C324 170 300 154 266 152 C230 150 196 164 176 190 C164 204 152 208 144 206 Z" fill="${c}"/>`
    case 'side':
      return `<path d="M144 214 C134 122 196 96 252 100 C312 104 346 146 336 204 C318 170 286 150 248 158 C214 164 196 150 186 140 C170 168 158 196 144 214 Z" fill="${c}"/>`
    case 'buzz':
      return `<path d="M148 196 C150 132 196 110 240 110 C286 110 330 132 332 196 C312 164 280 150 240 150 C200 150 168 164 148 196 Z" fill="${c}" opacity=".92"/>`
    case 'bun':
      return `<circle cx="240" cy="92" r="42" fill="${c}"/>` +
        `<path d="M146 204 C140 132 192 104 240 104 C290 104 342 132 336 204 C322 168 290 146 240 146 C192 146 160 168 146 204 Z" fill="${c}"/>`
    case 'long':
    case 'bob':
      return `<path d="M146 210 C140 130 194 104 242 104 C292 104 340 132 336 206 C312 170 290 150 258 146 C250 176 208 192 160 196 C154 200 150 206 146 210 Z" fill="${c}"/>`
    case 'curly':
      return [[190, 138, 34], [236, 124, 36], [284, 136, 34], [322, 168, 28], [160, 168, 28]]
        .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>`).join('')
    default:
      return ''
  }
}

/** A person's portrait as SVG markup on a 480 × 480 stage, clipped to a circle's square. */
export function avatar(p: Person, id = 'av'): string {
  const skinShade = shade(p.skin, -0.12)
  const beard = p.beard
    ? `<path d="M156 236 C160 318 200 336 240 336 C280 336 320 318 324 236 C314 282 290 300 240 300 C190 300 166 282 156 236 Z" fill="${p.hairColor}" opacity=".92"/>`
    : ''
  const glasses = p.glasses
    ? `<g fill="none" stroke="#1C1B2E" stroke-width="7"><rect x="168" y="208" width="60" height="44" rx="18"/>` +
      `<rect x="252" y="208" width="60" height="44" rx="18"/><path d="M228 228 H252"/></g>`
    : ''
  return `
<defs>
  <linearGradient id="${id}bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${p.background[0]}"/><stop offset="1" stop-color="${p.background[1]}"/>
  </linearGradient>
</defs>
<rect width="480" height="480" fill="url(#${id}bg)"/>
${hairBack(p)}
<path d="M58 480 C68 386 148 334 240 334 C332 334 412 386 422 480 Z" fill="${p.shirt}"/>
<path d="M190 334 C206 356 274 356 290 334" fill="none" stroke="${shade(p.shirt, -0.2)}" stroke-width="8" stroke-linecap="round"/>
<path d="M204 290 L276 290 L272 346 C258 360 222 360 208 346 Z" fill="${skinShade}"/>
<ellipse cx="146" cy="232" rx="16" ry="24" fill="${skinShade}"/>
<ellipse cx="334" cy="232" rx="16" ry="24" fill="${skinShade}"/>
<ellipse cx="240" cy="222" rx="94" ry="104" fill="${p.skin}"/>
${beard}
${hairFront(p)}
<path d="M196 200 Q210 190 224 198 M256 198 Q270 190 284 200" stroke="${shade(p.hairColor, 0.1)}" stroke-width="7" fill="none" stroke-linecap="round"/>
<circle cx="210" cy="228" r="8" fill="#2B2A40"/><circle cx="270" cy="228" r="8" fill="#2B2A40"/>
<path d="M234 240 Q240 262 248 254" stroke="${skinShade}" stroke-width="6" fill="none" stroke-linecap="round"/>
<path d="M216 276 C230 290 250 290 264 276" stroke="#A8543C" stroke-width="7" fill="none" stroke-linecap="round"/>
${glasses}`
}
