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
 * SVG sanitization.
 *
 * Imported SVG is untrusted input: it can carry <script>, event-handler
 * attributes, javascript: URLs, and references to remote resources. This module
 * is the only way SVG enters the document.
 *
 * DOMPurify does the XSS work — a hand-rolled allowlist would not reproduce a
 * decade of mXSS and namespace-confusion hardening. But its defaults are tuned
 * for HTML documents, not for a vector editor, and three of them would silently
 * corrupt artwork:
 *
 *  1. `<use>` is on DOMPurify's svgDisallowed list and is stripped by default,
 *     which guts every <symbol>-based file. We add it back explicitly.
 *     <foreignObject> stays stripped on purpose: it is the top SVG-to-PNG
 *     rasterization failure mode and a genuine attack surface, and a vector
 *     editor has no use for it.
 *
 *  2. DOMPurify's URI check lets `url(http://evil/x)` through — the value
 *     matches its "bare word followed by a non-scheme character" branch — so
 *     fill/filter/mask can smuggle a remote reference straight past it. That
 *     would break the offline guarantee AND taint the export canvas. An
 *     afterSanitizeAttributes hook rejects any url() that is not a #fragment.
 *
 *  3. SANITIZE_DOM drops id="title", id="body", id="location" and friends
 *     because those names exist on `document` — killing every url(#…) gradient,
 *     clip and mask that referenced them. We turn its renaming off and namespace
 *     ids ourselves in IdNamespacer, which we need anyway so two imported files
 *     cannot collide.
 *
 * Sanitization is only the security stage. The importer then walks the result
 * with a fail-closed mapper, because DOMPurify is not a semantic validator: it
 * happily keeps url(#missing) and nonsense attribute values.
 */

import createDOMPurify from 'dompurify'

export interface SanitizeResult {
  root: SVGSVGElement | null
  /** Human-readable notes about what was removed, surfaced to the user. */
  removed: string[]
}

/**
 * Values permitted in a URI-bearing attribute: same-document fragments and
 * inline base64 images, nothing else. Enforced by our own hook rather than
 * through DOMPurify's ALLOWED_URI_REGEXP.
 *
 * That distinction is load-bearing. DOMPurify uses IS_ALLOWED_URI as a general
 * attribute-value gate, not just for href/src: its default pattern ends in a
 * catch-all branch that lets ordinary values through. Replacing the pattern with
 * a strict one therefore strips `d`, `width`, `height`, `viewBox` and `fill`
 * from every element — silently destroying the artwork while looking like it
 * worked. So the default regexp stays, and the offline policy is applied here.
 */
const ALLOWED_URI_VALUE = /^(?:#|data:image\/(?:png|jpeg|jpg|gif|webp|bmp|avif|x-icon);base64,)/i

/** Attributes whose value is a URI and must therefore be policed. */
const URI_ATTRS = new Set(['href', 'xlink:href', 'src', 'xlink:src', 'data', 'action', 'formaction'])

const SVG_TAGS_TO_ADD = ['use']

const FORBID_TAGS = [
  'script', 'foreignObject', 'foreignobject',
  'animate', 'animateMotion', 'animateTransform', 'animateColor', 'set', 'discard',
  'handler', 'listener', 'audio', 'video', 'iframe', 'object', 'embed',
]

const FORBID_ATTR = [
  'onload', 'onerror', 'onclick', 'onmouseover', 'onmouseout', 'onfocus', 'onblur',
  'onbegin', 'onend', 'onrepeat', 'onactivate', 'onmousedown', 'onmouseup',
  'requiredExtensions', 'externalResourcesRequired',
]

/**
 * Attributes a design tool needs that are not in DOMPurify's SVG profile.
 *
 * `data-name` and `aria-label` carry the layer name in every Illustrator, XD and
 * Figma export, and are what this app's own exporter writes. They are named
 * individually rather than by turning ALLOW_DATA_ATTR on, so no other data-*
 * attribute gets in. `class` is needed for the CSS cascade — without it a
 * <style> block has nothing to match against.
 */
const ADD_ATTR = [
  'data-name', 'aria-label', 'class',
  'd', 'href', 'xlink:href', 'clip-rule', 'mix-blend-mode', 'isolation', 'paint-order',
  'vector-effect', 'shape-rendering', 'style', 'transform-origin', 'stop-color',
  'stop-opacity', 'offset', 'gradientTransform', 'gradientUnits', 'spreadMethod',
  'patternUnits', 'patternContentUnits', 'patternTransform', 'maskUnits',
  'maskContentUnits', 'clipPathUnits', 'markerWidth', 'markerHeight', 'markerUnits',
  'refX', 'refY', 'orient', 'viewBox', 'preserveAspectRatio', 'filterUnits',
  'primitiveUnits', 'dominant-baseline', 'text-anchor', 'letter-spacing', 'word-spacing',
]

/** Matches a url(...) whose target is not a local #fragment. */
const REMOTE_URL_REF = /url\(\s*['"]?(?!#)/i
/**
 * Anything in an inline style that could fetch or execute.
 *
 * The url() branch excludes local `url(#id)` deliberately. It used to match any
 * url( at all, so `style="fill:url(#grad)"` — a perfectly ordinary local paint
 * reference, and one IdNamespacer goes to the trouble of rewriting — had its
 * whole style attribute deleted, leaving the shape unfilled with no warning.
 * A remote url() in any attribute, style included, is still caught by
 * REMOTE_URL_REF in the hook below.
 */
const DANGEROUS_STYLE = /url\(\s*['"]?(?!#)|expression\(|@import|behavior\s*:|javascript:/i

let purifier: ReturnType<typeof createDOMPurify> | null = null

function getPurifier(): ReturnType<typeof createDOMPurify> | null {
  if (purifier) return purifier
  if (typeof window === 'undefined') return null

  // A dedicated instance so our hooks cannot leak into any other DOMPurify use.
  const instance = createDOMPurify(window)

  instance.addHook('afterSanitizeAttributes', (node) => {
    const el = node as Element
    if (!el.attributes) return

    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      const value = attr.value

      // A URI attribute may only point at a local fragment or inline image data.
      // This is what makes a remote reference structurally impossible to import,
      // which in turn makes canvas tainting on raster export impossible.
      if (URI_ATTRS.has(name) && !ALLOWED_URI_VALUE.test(value.trim())) {
        el.removeAttribute(attr.name)
        continue
      }

      // `url(...)` slips past DOMPurify's own URI check entirely: the value
      // matches its "bare word followed by a non-scheme character" branch, so
      // fill/filter/mask can smuggle a remote reference straight through.
      if (REMOTE_URL_REF.test(value)) {
        el.removeAttribute(attr.name)
        continue
      }

      if (/^\s*(javascript|vbscript|data:text\/html)/i.test(value)) {
        el.removeAttribute(attr.name)
      }
    }

    const style = el.getAttribute?.('style')
    if (style && DANGEROUS_STYLE.test(style)) el.removeAttribute('style')
  })

  purifier = instance
  return instance
}

export interface SanitizeOptions {
  /** Keep <filter> and its primitives. On by default. */
  allowFilters?: boolean
}

/**
 * Sanitize an SVG document string.
 *
 * @returns the sanitized <svg> root, or null when the input is not parseable.
 */
export function sanitizeSvg(source: string, options: SanitizeOptions = {}): SanitizeResult {
  const removed: string[] = []
  const instance = getPurifier()

  if (!instance) {
    return { root: null, removed: ['SVG sanitization requires a browser environment.'] }
  }

  // Report what we are about to strip, so the user learns why their file changed.
  const lowered = source.toLowerCase()
  if (lowered.includes('<script')) removed.push('scripts')
  if (lowered.includes('foreignobject')) removed.push('foreignObject elements')
  if (/\son\w+\s*=/.test(lowered)) removed.push('event handlers')
  if (/(href|src)\s*=\s*['"]?\s*https?:/i.test(source)) removed.push('remote references')
  if (/<(animate|set)\b/i.test(source)) removed.push('animations')

  let clean: Node
  try {
    clean = instance.sanitize(source, {
      // DOMPurify's parser does not accept image/svg+xml; setting NAMESPACE makes
      // it build the document via implementation.createDocument instead.
      NAMESPACE: 'http://www.w3.org/2000/svg',
      WHOLE_DOCUMENT: true,
      RETURN_DOM: true,
      USE_PROFILES: { svg: true, svgFilters: options.allowFilters !== false },
      ADD_TAGS: SVG_TAGS_TO_ADD,
      ADD_ATTR,
      FORBID_TAGS,
      FORBID_ATTR,
      // ALLOWED_URI_REGEXP is deliberately NOT overridden — see ALLOWED_URI_VALUE.
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
      ALLOW_UNKNOWN_PROTOCOLS: false,
      SANITIZE_DOM: true,
      // We namespace ids ourselves; DOMPurify's renaming does not rewrite the
      // url(#…) references that point at them, which would break every gradient.
      SANITIZE_NAMED_PROPS: false,
      KEEP_CONTENT: false,
    }) as unknown as Node
  } catch {
    return { root: null, removed: [...removed, 'malformed SVG'] }
  }

  const root = findSvgRoot(clean)
  return { root, removed }
}

function findSvgRoot(node: Node | null): SVGSVGElement | null {
  if (!node) return null
  const el = node as Element
  if (el.nodeType === 1 && el.tagName?.toLowerCase() === 'svg') return el as SVGSVGElement
  const found = (el as Element).querySelector?.('svg')
  return (found as SVGSVGElement) ?? null
}

/**
 * Sanitize a fragment that will be inserted verbatim as a preservation node.
 * Same rules, but returns markup rather than a document root.
 */
export function sanitizeSvgFragment(markup: string): string {
  const result = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`)
  if (!result.root) return ''
  return result.root.innerHTML
}

/**
 * Whether sanitization can actually run here.
 *
 * Callers that re-clean already-stored markup need to tell "this was cleaned to
 * nothing" apart from "there was no sanitizer" — blanking artwork because the
 * code happened to run outside a browser would be a data-loss bug wearing a
 * security hat.
 */
export function isSanitizerAvailable(): boolean {
  return typeof window !== 'undefined' && getPurifier() !== null
}

/** Quick structural check before we bother parsing. */
export function looksLikeSvg(text: string): boolean {
  return /<svg[\s>]/i.test(text)
}
