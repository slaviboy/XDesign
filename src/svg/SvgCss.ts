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
 * The CSS half of an SVG's styling.
 *
 * Illustrator and Figma do not write `fill="#ff0000"` on each shape — they emit
 * a `<style>` block of `.cls-1 { fill: #ff0000 }` and put `class="cls-1"` on the
 * elements. Ignoring that does not lose a detail; it loses every colour in the
 * file, and the artwork arrives uniformly black, because black is SVG's initial
 * fill.
 *
 * Matching is delegated to the browser. The importer already mounts the tree
 * off-screen to measure it, so `el.matches(selector)` is available and gives
 * real selector support — descendant combinators, `:nth-child`, attribute
 * selectors, everything — for the cost of a call. Only the cascade is ours:
 * parse the rules, work out specificity, and sort.
 */

/** One declaration block from one selector. */
export interface CssRule {
  selector: string
  declarations: Record<string, string>
  /** Properties inside this rule that carried !important. */
  important: Set<string>
  /** a*1e6 + b*1e3 + c, per the CSS specificity rules. */
  specificity: number
  /** Document order, breaking ties between equal specificity. */
  order: number
}

/** Looks up the CSS-declared value of one property for one element. */
export interface CssLookup {
  /** The winning declared value, or null when no rule sets it. */
  value(el: Element, property: string): string | null
  /** Whether that winning value was marked !important, so it beats inline style. */
  isImportant(el: Element, property: string): boolean
  /** True when the document had no usable rules, so callers can skip the work. */
  readonly empty: boolean
}

/**
 * Read every `<style>` block in the tree.
 *
 * At-rules are skipped rather than half-applied: `@media print` styles must not
 * be baked into artwork, and pretending to understand `@supports` would be
 * worse than declining to. Their content is left alone so nothing crashes.
 */
export function parseStyleSheets(root: Element): CssRule[] {
  const rules: CssRule[] = []
  let order = 0
  for (const styleEl of Array.from(root.querySelectorAll('style'))) {
    order = parseCss(styleEl.textContent ?? '', rules, order)
  }
  return rules
}

function parseCss(source: string, out: CssRule[], startOrder: number): number {
  let order = startOrder
  // Comments first, so a selector or value cannot be split across one.
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '')

  let i = 0
  while (i < css.length) {
    const braceAt = css.indexOf('{', i)
    if (braceAt === -1) break
    const prelude = css.slice(i, braceAt).trim()
    const close = matchingBrace(css, braceAt)
    if (close === -1) break
    const body = css.slice(braceAt + 1, close)

    if (prelude.startsWith('@')) {
      // Nested rules inside a grouping at-rule are deliberately not applied.
      i = close + 1
      continue
    }

    const declarations = parseDeclarations(body)
    const important = new Set<string>()
    for (const [prop, value] of Object.entries(declarations)) {
      if (/!\s*important\s*$/i.test(value)) {
        important.add(prop)
        declarations[prop] = value.replace(/!\s*important\s*$/i, '').trim()
      }
    }

    if (Object.keys(declarations).length > 0) {
      for (const selector of prelude.split(',')) {
        const trimmed = selector.trim()
        if (!trimmed) continue
        out.push({
          selector: trimmed,
          declarations,
          important,
          specificity: specificityOf(trimmed),
          order: order++,
        })
      }
    }
    i = close + 1
  }
  return order
}

/** The index of the `}` closing the `{` at `open`, honouring nesting. */
function matchingBrace(css: string, open: number): number {
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function parseDeclarations(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  // Only top-level declarations; a nested block belongs to an at-rule we skip.
  if (body.includes('{')) return out
  for (const part of body.split(';')) {
    const colon = part.indexOf(':')
    if (colon === -1) continue
    const prop = part.slice(0, colon).trim().toLowerCase()
    const value = part.slice(colon + 1).trim()
    if (prop && value) out[prop] = value
  }
  return out
}

/**
 * CSS specificity: ids, then classes/attributes/pseudo-classes, then types.
 *
 * Counted from the selector text rather than a parse tree, which is enough for
 * what design tools emit and cannot throw on a selector we do not recognise.
 */
export function specificityOf(selector: string): number {
  const s = selector.replace(/\\./g, '')
  const ids = (s.match(/#[\w-]+/g) ?? []).length
  const classes =
    (s.match(/\.[\w-]+/g) ?? []).length +
    (s.match(/\[[^\]]*\]/g) ?? []).length +
    (s.match(/:(?!:)[\w-]+/g) ?? []).length
  const types =
    (s.match(/(?:^|[\s>+~])([a-zA-Z][\w-]*)/g) ?? []).length + (s.match(/::[\w-]+/g) ?? []).length
  return ids * 1_000_000 + classes * 1_000 + types
}

/**
 * Build the lookup.
 *
 * Rules are sorted once, weakest first, so the last match wins and the per
 * element work is a single pass. Results are memoized per element because
 * `resolveStyle` asks for a dozen properties on the same element in a row.
 */
export function createCssLookup(rules: readonly CssRule[]): CssLookup {
  const sorted = [...rules].sort((a, b) =>
    a.specificity !== b.specificity ? a.specificity - b.specificity : a.order - b.order,
  )
  const cache = new WeakMap<Element, { values: Record<string, string>; important: Set<string> }>()

  const resolve = (el: Element) => {
    const hit = cache.get(el)
    if (hit) return hit
    const values: Record<string, string> = {}
    const important = new Set<string>()
    for (const rule of sorted) {
      // An unsupported or malformed selector matches nothing rather than
      // aborting the import of the whole file.
      let matches: boolean
      try {
        matches = el.matches(rule.selector)
      } catch {
        matches = false
      }
      if (!matches) continue
      for (const [prop, value] of Object.entries(rule.declarations)) {
        // A later rule of equal-or-higher specificity wins, except that an
        // !important declaration is never overridden by a normal one.
        if (important.has(prop) && !rule.important.has(prop)) continue
        values[prop] = value
        if (rule.important.has(prop)) important.add(prop)
      }
    }
    const entry = { values, important }
    cache.set(el, entry)
    return entry
  }

  return {
    empty: sorted.length === 0,
    value(el, property) {
      if (sorted.length === 0) return null
      return resolve(el).values[property] ?? null
    },
    isImportant(el, property) {
      if (sorted.length === 0) return false
      return resolve(el).important.has(property)
    },
  }
}
