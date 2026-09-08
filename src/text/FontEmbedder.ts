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
 * Embedding bundled fonts into exported SVG.
 *
 * Why this exists: an SVG loaded through <img> for rasterization runs in secure
 * static mode. It cannot fetch anything, and it does not inherit the page's
 * document.fonts — so a PNG export of styled text would silently render in a
 * substitute face.
 *
 * A base64 `data:` URL is not a fetch, so an @font-face embedded directly in the
 * exported SVG *does* resolve inside that sandbox. This was verified
 * empirically against real Chromium: the same string rendered through <img>
 * produces markedly more glyph coverage with the embedded face than with the
 * fallback, i.e. the real font is being used.
 *
 * This replaced an earlier plan to convert text to outlines with opentype.js.
 * Embedding turned out to be strictly better: the exported text stays real
 * <text> — selectable, searchable and still editable — and it removed ~1.4MB of
 * dependencies, including wawoff2, which cannot run in a browser at all (it is
 * CommonJS and throws "exports is not defined" the moment it is imported).
 *
 * Only bundled fonts can be embedded. A system font's bytes are not readable by
 * the page, so it can only be referenced by name; the export dialog says so.
 */

import { isBundledFont } from './FontRegistry'

/** True when we ship this font's bytes and can therefore embed it. */
export function canEmbed(family: string): boolean {
  return isBundledFont(family)
}

const cssCache = new Map<string, string | null>()

/**
 * Locate a face's file by reading our own @font-face rules.
 *
 * Cross-origin stylesheets throw on cssRules access; ours are same-origin, and
 * the try/catch keeps a third-party sheet from breaking the scan.
 */
function findFontUrl(family: string, weight: number, italic: boolean): string | null {
  if (typeof document === 'undefined') return null
  const wanted = family.toLowerCase()
  let best: { url: string; distance: number } | null = null

  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSFontFaceRule)) continue
      const style = rule.style
      const ruleFamily = style.getPropertyValue('font-family').replace(/["']/g, '').trim().toLowerCase()
      if (ruleFamily !== wanted) continue
      if ((style.getPropertyValue('font-style').trim() === 'italic') !== italic) continue

      const ruleWeight = Number.parseInt(style.getPropertyValue('font-weight'), 10) || 400
      const match = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(style.getPropertyValue('src'))
      if (!match) continue

      // Nearest available weight, so asking for 600 in a family that only ships
      // 400/700 embeds the closer of the two rather than nothing.
      const distance = Math.abs(ruleWeight - weight)
      if (!best || distance < best.distance) best = { url: match[1]!, distance }
    }
  }
  return best?.url ?? null
}

/**
 * A base64 `@font-face` rule for one face, ready to drop into an exported SVG's
 * `<style>` block.
 *
 * @returns null when the font's bytes are not ours to embed, so the caller can
 *          fall back to referencing it by name.
 */
export async function embedFontCss(
  family: string,
  weight: number,
  italic: boolean,
): Promise<string | null> {
  const key = `${family.toLowerCase()}|${weight}|${italic ? 'i' : 'n'}`
  const cached = cssCache.get(key)
  if (cached !== undefined) return cached

  const url = findFontUrl(family, weight, italic)
  if (!url) {
    cssCache.set(key, null)
    return null
  }

  try {
    // Same-origin bundled asset; served from the service worker cache offline.
    const response = await fetch(url)
    if (!response.ok) throw new Error(`font fetch failed: ${response.status}`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    const dataUrl = `data:font/${url.endsWith('.woff2') ? 'woff2' : 'woff'};base64,${toBase64(bytes)}`
    const format = url.endsWith('.woff2') ? 'woff2' : 'woff'

    const css =
      `@font-face{font-family:'${escapeCss(family)}';` +
      `font-style:${italic ? 'italic' : 'normal'};` +
      `font-weight:${weight};` +
      `src:url(${dataUrl}) format('${format}');}`
    cssCache.set(key, css)
    return css
  } catch {
    // Embedding is an improvement over name-reference, never a hard requirement.
    cssCache.set(key, null)
    return null
  }
}

/** Chunked, so a large font does not blow the argument limit. */
function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

function escapeCss(value: string): string {
  return value.replace(/['\\]/g, '\\$&')
}

export function clearFontCache(): void {
  cssCache.clear()
}
