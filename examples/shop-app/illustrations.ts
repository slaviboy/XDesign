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
 * The example's product photography, drawn rather than shot.
 *
 * Each product is SVG markup on a 480 × 480 stage with a transparent ground,
 * rasterised to PNG when the example is built — so in the finished document
 * they are real bitmap image layers, as photographs would be, and can be
 * cropped, traced and exported like any other. Every id is prefixed per use,
 * because the hero draws the sneaker again inside its own scene.
 */

const SHADOW = (p: string, cx: number, cy: number, rx: number, ry: number) =>
  `<radialGradient id="${p}sh"><stop offset="0" stop-color="#1C1B2E" stop-opacity=".30"/>` +
  `<stop offset="1" stop-color="#1C1B2E" stop-opacity="0"/></radialGradient>` +
  `§<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#${p}sh)"/>`

/** Split a SHADOW() result into its defs and its drawing. */
function shadow(p: string, cx: number, cy: number, rx: number, ry: number): [string, string] {
  const [defs, body] = SHADOW(p, cx, cy, rx, ry).split('§')
  return [defs!, body!]
}

export function sneaker(p = 'sn'): string {
  const [shDefs, sh] = shadow(p, 244, 352, 196, 20)
  return `
<defs>
  ${shDefs}
  <linearGradient id="${p}up" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#FF8D63"/><stop offset="1" stop-color="#EE4F27"/>
  </linearGradient>
  <linearGradient id="${p}sole" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#DCDCE6"/>
  </linearGradient>
  <linearGradient id="${p}toe" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#F1F1F6"/>
  </linearGradient>
</defs>
${sh}
<path d="M66 302 C62 258 84 222 124 210 C156 201 172 176 184 152 C192 136 212 131 226 142
  L268 178 C296 200 334 213 372 222 C408 231 428 254 428 284 L428 302 Z" fill="url(#${p}up)"/>
<path d="M340 216 C392 224 428 250 428 288 L428 302 L352 302 C354 266 350 238 340 216 Z" fill="url(#${p}toe)"/>
<path d="M112 290 C168 250 244 236 336 258 C258 262 196 278 156 304 Z" fill="#1C1B2E"/>
<path d="M66 302 C62 272 70 242 92 224 L106 242 C94 258 90 280 94 302 Z" fill="#1C1B2E" opacity=".9"/>
<path d="M126 208 C148 202 170 186 182 160" stroke="#1C1B2E" stroke-opacity=".22" stroke-width="10"
  fill="none" stroke-linecap="round"/>
<g stroke="#FFFFFF" stroke-width="7" stroke-linecap="round">
  <path d="M206 160 l22 -9"/><path d="M224 178 l24 -9"/><path d="M243 195 l24 -8"/><path d="M263 210 l24 -6"/>
</g>
<path d="M54 302 L438 302 C444 302 446 308 444 314 C438 332 422 342 400 342 L92 342 C70 342 54 330 54 312 Z"
  fill="url(#${p}sole)"/>
<path d="M58 322 L440 322" stroke="#CFCFDB" stroke-width="4"/>
<path d="M90 342 L400 342" stroke="#1C1B2E" stroke-opacity=".08" stroke-width="3"/>`
}

export function headphones(p = 'hp'): string {
  const [shDefs, sh] = shadow(p, 240, 404, 150, 16)
  return `
<defs>
  ${shDefs}
  <linearGradient id="${p}cup" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#3B3A56"/><stop offset="1" stop-color="#17162A"/>
  </linearGradient>
  <linearGradient id="${p}pad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#FF8D63"/><stop offset="1" stop-color="#EE4F27"/>
  </linearGradient>
</defs>
${sh}
<path d="M118 276 C118 150 176 84 240 84 C304 84 362 150 362 276" fill="none" stroke="#24233A"
  stroke-width="28" stroke-linecap="round"/>
<path d="M130 250 C134 150 184 100 240 100" fill="none" stroke="#FFFFFF" stroke-opacity=".14"
  stroke-width="8" stroke-linecap="round"/>
<rect x="146" y="250" width="44" height="124" rx="20" fill="url(#${p}pad)"/>
<rect x="290" y="250" width="44" height="124" rx="20" fill="url(#${p}pad)"/>
<rect x="80" y="234" width="92" height="156" rx="42" fill="url(#${p}cup)"/>
<rect x="308" y="234" width="92" height="156" rx="42" fill="url(#${p}cup)"/>
<rect x="96" y="254" width="16" height="70" rx="8" fill="#FFFFFF" fill-opacity=".16"/>
<rect x="324" y="254" width="16" height="70" rx="8" fill="#FFFFFF" fill-opacity=".16"/>
<circle cx="126" cy="354" r="7" fill="#FF6B3D"/>`
}

export function watch(p = 'wa'): string {
  const [shDefs, sh] = shadow(p, 240, 424, 110, 14)
  const ring = (r: number, share: number, colour: string, width: number) => {
    const c = 2 * Math.PI * r
    return (
      `<circle cx="240" cy="240" r="${r}" fill="none" stroke="${colour}" stroke-opacity=".22" stroke-width="${width}"/>` +
      `<circle cx="240" cy="240" r="${r}" fill="none" stroke="${colour}" stroke-width="${width}" stroke-linecap="round"` +
      ` stroke-dasharray="${(c * share).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 240 240)"/>`
    )
  }
  return `
<defs>
  ${shDefs}
  <linearGradient id="${p}case" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#F4F4F8"/><stop offset="1" stop-color="#A9A9BC"/>
  </linearGradient>
  <linearGradient id="${p}strap" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#5B8DEF"/><stop offset="1" stop-color="#3563C9"/>
  </linearGradient>
</defs>
${sh}
<rect x="190" y="40" width="100" height="140" rx="26" fill="url(#${p}strap)"/>
<rect x="190" y="300" width="100" height="120" rx="26" fill="url(#${p}strap)"/>
<g fill="#FFFFFF" fill-opacity=".35"><circle cx="240" cy="380" r="6"/><circle cx="240" cy="352" r="6"/></g>
<rect x="136" y="128" width="208" height="224" rx="60" fill="url(#${p}case)"/>
<rect x="344" y="206" width="14" height="44" rx="6" fill="#B9B9C9"/>
<rect x="152" y="144" width="176" height="192" rx="46" fill="#0F0E1A"/>
${ring(62, 0.72, '#FF6B3D', 14)}
${ring(42, 0.55, '#22C55E', 14)}
${ring(22, 0.84, '#5B8DEF', 14)}
<rect x="164" y="150" width="60" height="120" rx="30" fill="#FFFFFF" fill-opacity=".05"/>`
}

export function backpack(p = 'bp'): string {
  const [shDefs, sh] = shadow(p, 240, 408, 140, 16)
  return `
<defs>
  ${shDefs}
  <linearGradient id="${p}body" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#3ED3C4"/><stop offset="1" stop-color="#159488"/>
  </linearGradient>
</defs>
${sh}
<path d="M206 118 C206 70 274 70 274 118" fill="none" stroke="#11776E" stroke-width="16" stroke-linecap="round"/>
<rect x="124" y="176" width="22" height="170" rx="11" fill="#11776E"/>
<rect x="334" y="176" width="22" height="170" rx="11" fill="#11776E"/>
<rect x="138" y="106" width="204" height="290" rx="72" fill="url(#${p}body)"/>
<path d="M162 176 C204 146 276 146 318 176" fill="none" stroke="#0E6A62" stroke-width="7" stroke-linecap="round"/>
<rect x="166" y="248" width="148" height="124" rx="34" fill="#23B7A9"/>
<path d="M186 280 L294 280" stroke="#0E6A62" stroke-width="7" stroke-linecap="round"/>
<rect x="270" y="272" width="12" height="30" rx="5" fill="#FF6B3D"/>
<rect x="160" y="124" width="30" height="110" rx="15" fill="#FFFFFF" fill-opacity=".14"/>`
}

export function sunglasses(p = 'sg'): string {
  const [shDefs, sh] = shadow(p, 240, 336, 180, 14)
  const lens = (x: number) =>
    `<rect x="${x}" y="190" width="142" height="108" rx="50" fill="#1C1B2E"/>` +
    `<rect x="${x + 11}" y="201" width="120" height="86" rx="40" fill="url(#${p}lens)"/>` +
    `<path d="M${x + 28} ${226} C${x + 44} 212 ${x + 70} 208 ${x + 92} 212" stroke="#FFFFFF" stroke-opacity=".55"` +
    ` stroke-width="9" fill="none" stroke-linecap="round"/>`
  return `
<defs>
  ${shDefs}
  <linearGradient id="${p}lens" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#FF9A62"/><stop offset=".55" stop-color="#FF4F7B"/><stop offset="1" stop-color="#7B5CFA"/>
  </linearGradient>
</defs>
${sh}
<path d="M86 212 L40 196" stroke="#1C1B2E" stroke-width="12" stroke-linecap="round"/>
<path d="M394 212 L440 196" stroke="#1C1B2E" stroke-width="12" stroke-linecap="round"/>
<path d="M216 222 C228 206 252 206 264 222" stroke="#1C1B2E" stroke-width="13" fill="none" stroke-linecap="round"/>
${lens(80)}
${lens(258)}`
}

export function avatar(p = 'av'): string {
  return `
<defs>
  <linearGradient id="${p}bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#FFD9C9"/><stop offset="1" stop-color="#FFB59A"/>
  </linearGradient>
  <clipPath id="${p}clip"><circle cx="240" cy="240" r="240"/></clipPath>
</defs>
<g clip-path="url(#${p}clip)">
  <rect width="480" height="480" fill="url(#${p}bg)"/>
  <path d="M60 480 C70 380 150 330 240 330 C330 330 410 380 420 480 Z" fill="#1C1B2E"/>
  <path d="M200 300 L280 300 L276 350 C260 364 220 364 204 350 Z" fill="#E2A07C"/>
  <circle cx="240" cy="220" r="96" fill="#F2B28C"/>
  <path d="M142 214 C132 130 190 96 246 98 C310 100 350 140 340 214 C326 176 300 158 266 156
    C230 154 196 170 176 196 C164 210 150 214 142 214 Z" fill="#2B2A40"/>
  <circle cx="206" cy="232" r="9" fill="#2B2A40"/><circle cx="274" cy="232" r="9" fill="#2B2A40"/>
  <path d="M214 272 C230 286 250 286 266 272" stroke="#B86A4A" stroke-width="8" fill="none" stroke-linecap="round"/>
</g>`
}

/**
 * The Welcome screen's hero: a warm stage with the sneaker leaping across it
 * and the other products floating behind. Drawn on its own 390 × 520 stage —
 * the size it is shown at.
 */
export function hero(): string {
  const place = (markup: string, x: number, y: number, scale: number, turn: number) =>
    `<g transform="translate(${x} ${y}) rotate(${turn}) scale(${scale}) translate(-240 -240)">${markup}</g>`
  return `
<defs>
  <linearGradient id="hebg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#FFE9DF"/><stop offset="1" stop-color="#FFC4AC"/>
  </linearGradient>
  <radialGradient id="heglow"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".9"/>
    <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient>
</defs>
<rect width="390" height="520" fill="url(#hebg)"/>
<circle cx="200" cy="300" r="170" fill="url(#heglow)"/>
<circle cx="200" cy="300" r="128" fill="#FF6B3D" fill-opacity=".14"/>
<circle cx="200" cy="300" r="128" fill="none" stroke="#FF6B3D" stroke-opacity=".35" stroke-width="2" stroke-dasharray="4 10"/>
<circle cx="330" cy="140" r="10" fill="#FF6B3D"/>
<circle cx="56" cy="220" r="6" fill="#1C1B2E" fill-opacity=".5"/>
<rect x="300" y="420" width="18" height="18" rx="4" fill="#5B8DEF" transform="rotate(20 309 429)"/>
<path d="M60 430 l10 -18 l10 18 z" fill="#22C55E"/>
${place(headphones('heh'), 304, 214, 0.34, 14)}
${place(watch('hew'), 84, 178, 0.3, -14)}
${place(sneaker('hes'), 198, 330, 0.78, -16)}`
}

/** A stage's markup as a standalone SVG document of the given size. */
export function asSvg(markup: string, viewBox: string, width: number, height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}">${markup}</svg>`
}
