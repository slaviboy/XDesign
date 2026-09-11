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
 * Photograph-like scenes, for feeds, stories, chat pictures and banners.
 *
 * Each kind is drawn to any size — a square post, a 9:16 story, a wide
 * banner — and a seed varies it, so twelve mountain posts are twelve
 * different mountains and a rebuild draws the same twelve again. They are
 * illustrations, not photographs, but soft light, depth and haze take them a
 * long way toward reading as pictures in a feed. Rasterise with kit.rasterize,
 * as JPEG: none of them has anything to see through.
 */

import { random } from '../kit'

export type SceneKind =
  | 'mountains' | 'lake' | 'beach' | 'sunset' | 'city' | 'forest' | 'desert' | 'aurora'
  | 'food' | 'coffee' | 'flowers' | 'abstract'

export const SCENE_KINDS: readonly SceneKind[] = [
  'mountains', 'lake', 'beach', 'sunset', 'city', 'forest', 'desert', 'aurora', 'food', 'coffee', 'flowers', 'abstract',
]

type Rand = () => number

const pick = <T>(r: Rand, list: readonly T[]): T => list[Math.floor(r() * list.length)]!

const SKIES: Array<[string, string, string]> = [
  ['#FFB88C', '#FF8E7F', '#6A5ACD'],
  ['#9AD0F5', '#C9E6FF', '#FFF4E0'],
  ['#FAD0C4', '#FFD1FF', '#A18CD1'],
  ['#2B5876', '#4E4376', '#F7A07A'],
  ['#FFE29F', '#FFA99F', '#FF719A'],
  ['#A1C4FD', '#C2E9FB', '#E0F7FF'],
]

/** A ridge line across the frame, from a random walk. */
function ridge(r: Rand, w: number, h: number, base: number, rough: number, step: number): string {
  let d = `M0 ${h} L0 ${base}`
  let y = base
  for (let x = 0; x <= w + step; x += step) {
    y = Math.min(h, Math.max(base - rough * 1.6, y + (r() - 0.5) * rough))
    d += ` L${x.toFixed(0)} ${y.toFixed(0)}`
  }
  return `${d} L${w} ${h} Z`
}

function sky(id: string, colours: [string, string, string]): string {
  return `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${colours[2]}"/><stop offset=".6" stop-color="${colours[1]}"/><stop offset="1" stop-color="${colours[0]}"/></linearGradient>`
}

function mountains(r: Rand, w: number, h: number, p: string, withLake = false): string {
  const colours = pick(r, SKIES)
  const sunX = w * (0.25 + r() * 0.5)
  const horizon = withLake ? h * 0.58 : h * 0.72
  const layers = [0, 1, 2, 3].map((i) => {
    const base = horizon - h * (0.3 - i * 0.07)
    const alpha = 0.35 + i * 0.2
    return `<path d="${ridge(r, w, withLake ? horizon : h, base, h * (0.1 - i * 0.015), w / (18 + i * 6))}" fill="#2E2A4F" fill-opacity="${alpha.toFixed(2)}"/>`
  })
  const land = layers.join('')
  const lake = withLake
    ? `<rect y="${horizon}" width="${w}" height="${h - horizon}" fill="url(#${p}water)"/>` +
      `<g transform="translate(0 ${horizon * 2}) scale(1 -1)" opacity=".35">${land}</g>` +
      [0, 1, 2, 3, 4, 5].map((i) => `<rect x="${(r() * w * 0.8).toFixed(0)}" y="${(horizon + 20 + i * (h - horizon) / 7).toFixed(0)}" width="${(w * (0.1 + r() * 0.2)).toFixed(0)}" height="3" rx="1.5" fill="#FFFFFF" fill-opacity=".25"/>`).join('')
    : ''
  return `<defs>${sky(`${p}sky`, colours)}
    <linearGradient id="${p}water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${colours[0]}"/><stop offset="1" stop-color="#2E2A4F"/></linearGradient>
    <radialGradient id="${p}sun"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".35" stop-color="#FFF6D8"/><stop offset="1" stop-color="#FFF6D8" stop-opacity="0"/></radialGradient>
    <linearGradient id="${p}mist" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0"/><stop offset="1" stop-color="#FFFFFF" stop-opacity=".45"/></linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#${p}sky)"/>
    <circle cx="${sunX}" cy="${horizon - h * 0.28}" r="${w * 0.22}" fill="url(#${p}sun)"/>
    ${land}
    <rect y="${horizon - h * 0.12}" width="${w}" height="${h * 0.14}" fill="url(#${p}mist)"/>
    ${lake}`
}

function beach(r: Rand, w: number, h: number, p: string, sunset = false): string {
  const colours = sunset ? pick(r, [SKIES[0]!, SKIES[3]!, SKIES[4]!]) : pick(r, [SKIES[1]!, SKIES[5]!])
  const horizon = h * (0.5 + r() * 0.1)
  const shore = h * 0.78
  const palm = !sunset || r() > 0.4
  const palmX = r() > 0.5 ? w * 0.82 : w * 0.16
  const palmTree = palm
    ? `<g fill="#1F1B2E" opacity="${sunset ? 0.95 : 0.8}">
        <path d="M${palmX} ${h} C${palmX + 8} ${h * 0.7} ${palmX + 30} ${h * 0.5} ${palmX + 44} ${h * 0.38} L${palmX + 54} ${h * 0.4} C${palmX + 42} ${h * 0.52} ${palmX + 24} ${h * 0.72} ${palmX + 20} ${h} Z"/>
        ${[-60, -20, 20, 60, 110, 160].map((a) => `<ellipse cx="${palmX + 48}" cy="${h * 0.38}" rx="${w * 0.14}" ry="${w * 0.025}" transform="rotate(${a} ${palmX + 48} ${h * 0.38}) translate(${w * 0.12} 0)"/>`).join('')}
      </g>`
    : ''
  return `<defs>${sky(`${p}sky`, colours)}
    <linearGradient id="${p}sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sunset ? '#5B4B8A' : '#2E9CCA'}"/><stop offset="1" stop-color="${sunset ? '#E89A7A' : '#7FD8E8'}"/></linearGradient>
    <linearGradient id="${p}sand" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sunset ? '#C98B6B' : '#F3DDB3'}"/><stop offset="1" stop-color="${sunset ? '#8F5B4B' : '#E2C08D'}"/></linearGradient>
    <radialGradient id="${p}sun"><stop offset="0" stop-color="#FFF8E7"/><stop offset=".5" stop-color="#FFD58A" stop-opacity=".9"/><stop offset="1" stop-color="#FFD58A" stop-opacity="0"/></radialGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#${p}sky)"/>
    <circle cx="${w * 0.5}" cy="${horizon - (sunset ? h * 0.02 : h * 0.26)}" r="${w * (sunset ? 0.2 : 0.14)}" fill="url(#${p}sun)"/>
    <rect y="${horizon}" width="${w}" height="${h - horizon}" fill="url(#${p}sea)"/>
    ${[0, 1, 2, 3, 4].map((i) => `<path d="M0 ${horizon + (i + 1) * (shore - horizon) / 6} Q${w * 0.25} ${horizon + (i + 1) * (shore - horizon) / 6 - 6} ${w * 0.5} ${horizon + (i + 1) * (shore - horizon) / 6} T${w} ${horizon + (i + 1) * (shore - horizon) / 6}" stroke="#FFFFFF" stroke-opacity=".3" stroke-width="3" fill="none"/>`).join('')}
    <path d="M0 ${shore} C${w * 0.3} ${shore - 18} ${w * 0.6} ${shore + 14} ${w} ${shore - 8} L${w} ${h} L0 ${h} Z" fill="url(#${p}sand)"/>
    <path d="M0 ${shore + 2} C${w * 0.3} ${shore - 14} ${w * 0.6} ${shore + 18} ${w} ${shore - 4}" stroke="#FFFFFF" stroke-opacity=".75" stroke-width="6" fill="none"/>
    ${palmTree}`
}

function city(r: Rand, w: number, h: number, p: string): string {
  const base = h * 0.8
  let buildings = ''
  let windows = ''
  for (let layer = 0; layer < 2; layer++) {
    let x = -10
    while (x < w) {
      const bw = w * (0.05 + r() * 0.08)
      const bh = h * (0.18 + r() * (layer ? 0.42 : 0.3))
      const top = base - bh
      const colour = layer ? '#141432' : '#2A2856'
      buildings += `<rect x="${x.toFixed(0)}" y="${top.toFixed(0)}" width="${bw.toFixed(0)}" height="${bh.toFixed(0)}" fill="${colour}"/>`
      if (layer) {
        for (let wy = top + 10; wy < base - 10; wy += 16) {
          for (let wx = x + 6; wx < x + bw - 8; wx += 12) {
            if (r() > 0.55) windows += `<rect x="${wx.toFixed(0)}" y="${wy.toFixed(0)}" width="6" height="8" fill="${pick(r, ['#FFD66B', '#FFE7A8', '#FFB86B'])}" opacity="${(0.6 + r() * 0.4).toFixed(2)}"/>`
          }
        }
      }
      x += bw + (layer ? 2 : 6)
    }
  }
  return `<defs><linearGradient id="${p}sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0B0B2B"/><stop offset=".65" stop-color="#3A2A6B"/><stop offset="1" stop-color="#E0679A"/></linearGradient>
    <linearGradient id="${p}water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1E1A45"/><stop offset="1" stop-color="#0B0B24"/></linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#${p}sky)"/>
    ${Array.from({ length: 40 }, () => `<circle cx="${(r() * w).toFixed(0)}" cy="${(r() * h * 0.4).toFixed(0)}" r="${(0.6 + r() * 1.4).toFixed(1)}" fill="#FFFFFF" opacity="${(0.4 + r() * 0.6).toFixed(2)}"/>`).join('')}
    <circle cx="${w * 0.78}" cy="${h * 0.18}" r="${w * 0.05}" fill="#FFF4D6"/>
    ${buildings}${windows}
    <rect y="${base}" width="${w}" height="${h - base}" fill="url(#${p}water)"/>
    <g transform="translate(0 ${base * 2}) scale(1 -1)" opacity=".22">${windows}</g>`
}

function forest(r: Rand, w: number, h: number, p: string): string {
  const greens = [['#CFE8D5', '#9CC9A8'], ['#7FB38F', '#5C9A70'], ['#3E7A55', '#2B5E40'], ['#1F4630', '#153322']]
  const rows = greens.map(([light, dark], i) => {
    const y = h * (0.42 + i * 0.13)
    const size = w * (0.05 + i * 0.03)
    let trees = ''
    for (let x = -size; x < w + size; x += size * (0.7 + r() * 0.5)) {
      const th = size * (2.2 + r() * 1.2)
      trees += `<path d="M${x.toFixed(0)} ${(y - th).toFixed(0)} L${(x + size * 0.7).toFixed(0)} ${y.toFixed(0)} L${(x - size * 0.7).toFixed(0)} ${y.toFixed(0)} Z" fill="${r() > 0.5 ? light : dark}"/>`
    }
    return `${trees}<rect y="${y.toFixed(0)}" width="${w}" height="${(h - y).toFixed(0)}" fill="${dark}"/>` +
      `<rect y="${(y - h * 0.06).toFixed(0)}" width="${w}" height="${(h * 0.08).toFixed(0)}" fill="url(#${p}fog)"/>`
  })
  return `<defs><linearGradient id="${p}sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F4F1E8"/><stop offset="1" stop-color="#D7E6D9"/></linearGradient>
    <linearGradient id="${p}fog" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0"/><stop offset="1" stop-color="#FFFFFF" stop-opacity=".3"/></linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#${p}sky)"/>
    <circle cx="${w * (0.3 + r() * 0.4)}" cy="${h * 0.22}" r="${w * 0.09}" fill="#FFF7E0"/>
    ${rows.join('')}`
}

function desert(r: Rand, w: number, h: number, p: string): string {
  const dunes = [0, 1, 2].map((i) => {
    const y = h * (0.55 + i * 0.13)
    const a = y - h * (0.06 + r() * 0.06)
    return `<path d="M0 ${y} C${w * 0.3} ${a} ${w * 0.55} ${a + h * 0.1} ${w} ${y - h * 0.04} L${w} ${h} L0 ${h} Z" fill="${['#F2B880', '#E39A5F', '#C9743F'][i]}"/>` +
      `<path d="M0 ${y} C${w * 0.3} ${a} ${w * 0.55} ${a + h * 0.1} ${w} ${y - h * 0.04}" stroke="#FFE3C2" stroke-opacity=".5" stroke-width="3" fill="none"/>`
  })
  return `<defs><linearGradient id="${p}sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8EC5FC"/><stop offset="1" stop-color="#FDE3C4"/></linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#${p}sky)"/>
    <circle cx="${w * (0.2 + r() * 0.6)}" cy="${h * 0.3}" r="${w * 0.08}" fill="#FFF3D1"/>
    ${dunes.join('')}`
}

function aurora(r: Rand, w: number, h: number, p: string): string {
  const bands = [0, 1, 2].map((i) => {
    const y = h * (0.25 + i * 0.1)
    return `<path d="M${-w * 0.1} ${y} C${w * 0.3} ${y - h * 0.2} ${w * 0.6} ${y + h * 0.15} ${w * 1.1} ${y - h * 0.1}" stroke="${['#5CFFB0', '#39D5FF', '#B06CFF'][i]}" stroke-width="${w * 0.09}" fill="none" stroke-linecap="round" opacity=".55" filter="url(#${p}blur)"/>`
  })
  return `<defs><linearGradient id="${p}sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050716"/><stop offset="1" stop-color="#132A4A"/></linearGradient>
    <filter id="${p}blur" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="${w * 0.03}"/></filter></defs>
    <rect width="${w}" height="${h}" fill="url(#${p}sky)"/>
    ${Array.from({ length: 70 }, () => `<circle cx="${(r() * w).toFixed(0)}" cy="${(r() * h * 0.7).toFixed(0)}" r="${(0.6 + r() * 1.6).toFixed(1)}" fill="#FFFFFF" opacity="${(0.3 + r() * 0.7).toFixed(2)}"/>`).join('')}
    ${bands.join('')}
    <path d="${ridge(r, w, h, h * 0.8, h * 0.06, w / 14)}" fill="#070A14"/>`
}

function food(r: Rand, w: number, h: number): string {
  const cx = w / 2
  const cy = h / 2
  const R = Math.min(w, h) * 0.36
  const table = pick(r, ['#E9DCC9', '#D9C3A5', '#F2E6D8', '#C8D5C0'])
  const items = Array.from({ length: 16 }, () => {
    const a = r() * Math.PI * 2
    const d = r() * R * 0.62
    const colour = pick(r, ['#E63946', '#F4A261', '#2A9D8F', '#8AB17D', '#F1FAEE', '#E9C46A', '#6D597A'])
    const size = R * (0.12 + r() * 0.12)
    return `<circle cx="${(cx + Math.cos(a) * d).toFixed(0)}" cy="${(cy + Math.sin(a) * d).toFixed(0)}" r="${size.toFixed(0)}" fill="${colour}"/>`
  })
  return `<rect width="${w}" height="${h}" fill="${table}"/>
    <ellipse cx="${cx + R * 0.06}" cy="${cy + R * 0.08}" rx="${R * 1.12}" ry="${R * 1.12}" fill="#000000" opacity=".12"/>
    <circle cx="${cx}" cy="${cy}" r="${R * 1.08}" fill="#FAFAFA"/>
    <circle cx="${cx}" cy="${cy}" r="${R * 0.88}" fill="#F3EDE4"/>
    <circle cx="${cx}" cy="${cy}" r="${R * 0.78}" fill="${pick(r, ['#F6E7C1', '#EAD7B7', '#F1D9A8'])}"/>
    ${items.join('')}
    ${Array.from({ length: 10 }, () => `<ellipse cx="${(cx + (r() - 0.5) * R * 1.2).toFixed(0)}" cy="${(cy + (r() - 0.5) * R * 1.2).toFixed(0)}" rx="${R * 0.07}" ry="${R * 0.03}" fill="#3A7D44" transform="rotate(${(r() * 180).toFixed(0)} ${cx} ${cy})"/>`).join('')}
    <rect x="${cx + R * 1.25}" y="${cy - R * 0.9}" width="${R * 0.12}" height="${R * 1.8}" rx="${R * 0.06}" fill="#B9B9C3"/>`
}

function coffee(r: Rand, w: number, h: number, p: string): string {
  const cx = w * (0.45 + r() * 0.1)
  const cy = h * 0.5
  const R = Math.min(w, h) * 0.28
  return `<defs><radialGradient id="${p}crema"><stop offset="0" stop-color="#E7C29A"/><stop offset=".7" stop-color="#B07A4F"/><stop offset="1" stop-color="#6E4428"/></radialGradient></defs>
    <rect width="${w}" height="${h}" fill="${pick(r, ['#3B2F2A', '#4A3B33', '#D8CFC4', '#2F3A3A'])}"/>
    <rect x="${w * 0.08}" y="${h * 0.12}" width="${w * 0.22}" height="${h * 0.16}" rx="8" fill="#FFFFFF" opacity=".08" transform="rotate(-8 ${w * 0.2} ${h * 0.2})"/>
    <circle cx="${cx + R * 0.1}" cy="${cy + R * 0.12}" r="${R * 1.55}" fill="#000000" opacity=".18"/>
    <circle cx="${cx}" cy="${cy}" r="${R * 1.5}" fill="#F7F5F2"/>
    <circle cx="${cx}" cy="${cy}" r="${R * 1.05}" fill="#FFFFFF"/>
    <circle cx="${cx}" cy="${cy}" r="${R * 0.92}" fill="url(#${p}crema)"/>
    <path d="M${cx} ${cy + R * 0.45} C${cx - R * 0.7} ${cy - R * 0.05} ${cx - R * 0.35} ${cy - R * 0.6} ${cx} ${cy - R * 0.25} C${cx + R * 0.35} ${cy - R * 0.6} ${cx + R * 0.7} ${cy - R * 0.05} ${cx} ${cy + R * 0.45} Z" fill="#F4E4CF" opacity=".92"/>
    <path d="M${cx + R * 1.05} ${cy - R * 0.2} C${cx + R * 1.5} ${cy - R * 0.25} ${cx + R * 1.5} ${cy + R * 0.3} ${cx + R * 1.05} ${cy + R * 0.25}" stroke="#FFFFFF" stroke-width="${R * 0.14}" fill="none"/>
    <ellipse cx="${w * 0.84}" cy="${h * 0.8}" rx="${R * 0.28}" ry="${R * 0.16}" fill="#8B5A2B" transform="rotate(30 ${w * 0.84} ${h * 0.8})"/>
    <ellipse cx="${w * 0.14}" cy="${h * 0.82}" rx="${R * 0.24}" ry="${R * 0.14}" fill="#8B5A2B" transform="rotate(-20 ${w * 0.14} ${h * 0.82})"/>`
}

function flowers(r: Rand, w: number, h: number): string {
  const petals = pick(r, [['#FF8FAB', '#FFB3C6'], ['#FFD166', '#FFE29A'], ['#CDB4DB', '#E4D1F0'], ['#FF9F80', '#FFC2A8']])
  const bloom = (x: number, y: number, s: number) =>
    [0, 60, 120, 180, 240, 300].map((a) => `<ellipse cx="${x}" cy="${y - s * 0.55}" rx="${s * 0.34}" ry="${s * 0.55}" fill="${petals[a % 120 === 0 ? 0 : 1]}" transform="rotate(${a} ${x} ${y})"/>`).join('') +
    `<circle cx="${x}" cy="${y}" r="${s * 0.25}" fill="#F4A259"/>`
  const heads = Array.from({ length: 9 }, () => bloom(r() * w, h * 0.15 + r() * h * 0.75, Math.min(w, h) * (0.07 + r() * 0.08)))
  const leaves = Array.from({ length: 12 }, () => `<ellipse cx="${(r() * w).toFixed(0)}" cy="${(r() * h).toFixed(0)}" rx="${w * 0.08}" ry="${w * 0.025}" fill="${pick(r, ['#6A994E', '#8AB17D', '#386641'])}" transform="rotate(${(r() * 180).toFixed(0)} ${w / 2} ${h / 2})"/>`)
  return `<rect width="${w}" height="${h}" fill="${pick(r, ['#F7EDE2', '#EAF4E6', '#FDF0F4'])}"/>${leaves.join('')}${heads.join('')}`
}

function abstract(r: Rand, w: number, h: number, p: string): string {
  const palette = pick(r, [['#FF6B6B', '#FFD93D', '#6BCB77', '#4D96FF'], ['#7B5CFA', '#FF4F7B', '#FFB86B', '#39D5FF'], ['#0F2027', '#2C5364', '#F7B267', '#F25F5C']])
  const blobs = Array.from({ length: 6 }, (_, i) => `<circle cx="${(r() * w).toFixed(0)}" cy="${(r() * h).toFixed(0)}" r="${(Math.min(w, h) * (0.2 + r() * 0.25)).toFixed(0)}" fill="${palette[i % palette.length]}" opacity=".85"/>`)
  return `<defs><filter id="${p}soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${Math.min(w, h) * 0.08}"/></filter></defs>
    <rect width="${w}" height="${h}" fill="${palette[0]}"/>
    <g filter="url(#${p}soft)">${blobs.join('')}</g>`
}

/** A scene of `kind`, varied by `seed`, as SVG markup on a w × h stage. */
export function scene(kind: SceneKind, seed: number, w: number, h: number): string {
  const r = random(seed * 7919 + kind.length)
  const p = `sc${kind}${seed}`
  switch (kind) {
    case 'mountains': return mountains(r, w, h, p)
    case 'lake': return mountains(r, w, h, p, true)
    case 'beach': return beach(r, w, h, p)
    case 'sunset': return beach(r, w, h, p, true)
    case 'city': return city(r, w, h, p)
    case 'forest': return forest(r, w, h, p)
    case 'desert': return desert(r, w, h, p)
    case 'aurora': return aurora(r, w, h, p)
    case 'food': return food(r, w, h)
    case 'coffee': return coffee(r, w, h, p)
    case 'flowers': return flowers(r, w, h)
    case 'abstract': return abstract(r, w, h, p)
  }
}

/** A scene as a standalone SVG document, ready for kit.rasterize. */
export function sceneSvg(kind: SceneKind, seed: number, w: number, h: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${scene(kind, seed, w, h)}</svg>`
}
