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
 * Rewrites element ids inside an imported SVG, and every reference to them.
 *
 * Two reasons this is not optional:
 *
 *  - Collisions. Two imported files that both define `id="gradient1"` would end
 *    up sharing one definition, and the second import would silently repaint
 *    the first.
 *  - DOMPurify's SANITIZE_DOM deletes ids that collide with names on `document`
 *    (`title`, `body`, `location`, `images`, …). Anything referencing such an id
 *    through url(#…) would render as nothing. Namespacing sidesteps the whole
 *    class of problem.
 *
 * References live in more places than people expect: url(#…) in a dozen
 * presentation attributes, href/xlink:href on <use>, and url(#…) inside inline
 * style declarations. All three are rewritten here.
 */

import { createSvgScopeId } from '../document/ids'

/** Attributes whose value may be a `url(#id)` reference. */
const URL_REF_ATTRS = [
  'fill', 'stroke', 'clip-path', 'mask', 'filter', 'marker-start', 'marker-mid',
  'marker-end', 'marker', 'stop-color', 'flood-color', 'lighting-color',
  'fill-opacity', 'mask-type',
]

/** Attributes that hold a bare `#id` fragment. */
const FRAGMENT_ATTRS = ['href', 'xlink:href']

/**
 * Namespace ids in raw markup, BEFORE it reaches the sanitizer.
 *
 * Ordering is the whole point. DOMPurify's SANITIZE_DOM deletes any id whose
 * value is also a property name on `document` — `title`, `body`, `location`,
 * `images` — which silently orphans every `url(#…)` gradient, clip and mask that
 * referenced it. Renaming first means the sanitizer only ever sees ids like
 * `svgab12cd-title`, which collide with nothing.
 *
 * Parsing here is safe: DOMParser is inert (it never executes script), and the
 * result is re-serialized and handed to the sanitizer before anything touches
 * the live document.
 *
 * @returns the rewritten markup, or the original string when it cannot be parsed
 *          — the sanitizer will reject unparseable input anyway.
 */
export function namespaceRawSvg(source: string, scope = createSvgScopeId()): string {
  if (typeof DOMParser === 'undefined') return source
  try {
    const parsed = new DOMParser().parseFromString(source, 'image/svg+xml')
    const root = parsed.documentElement
    if (!root || root.getElementsByTagName('parsererror').length > 0) return source
    if (root.nodeName.toLowerCase() === 'parsererror') return source

    namespaceIds(root, scope)
    return new XMLSerializer().serializeToString(root)
  } catch {
    return source
  }
}

export interface NamespaceResult {
  /** Map of original id -> namespaced id. */
  idMap: Map<string, string>
  scope: string
}

/**
 * Rewrite all ids in `root` (in place) with a unique per-import prefix.
 * Safe to call on a sanitized tree; it only touches ids and references.
 */
export function namespaceIds(root: Element, scope = createSvgScopeId()): NamespaceResult {
  const idMap = new Map<string, string>()

  // Pass 1: collect and rename every id.
  const all = [root, ...Array.from(root.querySelectorAll('*'))]
  for (const el of all) {
    const id = el.getAttribute('id')
    if (!id) continue
    const next = `${scope}-${sanitizeIdPart(id)}`
    idMap.set(id, next)
    el.setAttribute('id', next)
  }

  if (idMap.size === 0) return { idMap, scope }

  // Pass 2: rewrite every reference to a renamed id.
  for (const el of all) {
    for (const attr of URL_REF_ATTRS) {
      const value = el.getAttribute(attr)
      if (value && value.includes('url(')) {
        const next = rewriteUrlRefs(value, idMap)
        if (next !== value) el.setAttribute(attr, next)
      }
    }

    for (const attr of FRAGMENT_ATTRS) {
      const value = el.getAttribute(attr)
      if (value && value.startsWith('#')) {
        const mapped = idMap.get(value.slice(1))
        if (mapped) el.setAttribute(attr, `#${mapped}`)
      }
    }

    const style = el.getAttribute('style')
    if (style && style.includes('url(')) {
      const next = rewriteUrlRefs(style, idMap)
      if (next !== style) el.setAttribute('style', next)
    }
  }

  return { idMap, scope }
}

export function rewriteUrlRefs(value: string, idMap: ReadonlyMap<string, string>): string {
  return value.replace(/url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)/g, (whole, id: string) => {
    const mapped = idMap.get(id)
    return mapped ? `url(#${mapped})` : whole
  })
}

/** Keep ids valid NCNames — no leading digit, no characters that break selectors. */
function sanitizeIdPart(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9_-]/g, '_')
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `x${cleaned}`
}
