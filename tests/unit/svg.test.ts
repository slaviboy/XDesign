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

// @vitest-environment happy-dom
/**
 * SVG import and ID namespacing.
 *
 * IMPORTANT: the sanitizer's security behaviour is NOT tested here. DOMPurify
 * reports isSupported === false under happy-dom and returns its input
 * unmodified, so an assertion like "the script tag was stripped" would pass for
 * the wrong reason and give false confidence about a security boundary. Those
 * assertions live in tests/e2e/sanitizer.spec.ts, against real Chromium.
 *
 * What IS meaningful here is the DOM walking: parsing, element mapping, style
 * inheritance and reference rewriting, none of which depend on fabricated
 * geometry APIs.
 */
import { describe, it, expect } from 'vitest'
import { looksLikeSvg } from '@/svg/SvgSanitizer'
import { namespaceIds, rewriteUrlRefs } from '@/svg/IdNamespacer'
import { importSvg } from '@/svg/SvgImporter'

const wrap = (inner: string, attrs = 'width="200" height="120" viewBox="0 0 200 120"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}</svg>`

function parseSvg(markup: string): Element {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml')
  return doc.documentElement
}

describe('looksLikeSvg', () => {
  it('recognises svg markup', () => {
    expect(looksLikeSvg('<svg viewBox="0 0 1 1"></svg>')).toBe(true)
    expect(looksLikeSvg('  <svg>')).toBe(true)
    expect(looksLikeSvg('{"a":1}')).toBe(false)
    expect(looksLikeSvg('<svgnot>')).toBe(false)
  })
})

describe('namespaceIds', () => {
  it('renames ids and rewrites every reference to them', () => {
    const root = parseSvg(
      wrap('<defs><linearGradient id="title"><stop offset="0" stop-color="#f00"/></linearGradient></defs><rect width="10" height="10" fill="url(#title)"/>'),
    )
    const { idMap } = namespaceIds(root, 'svgtest')
    // id="title" collides with a property name on `document`, which is exactly
    // the case DOMPurify's SANITIZE_DOM deletes — orphaning the gradient.
    // Namespacing first sidesteps the whole class of problem.
    expect(idMap.get('title')).toBe('svgtest-title')
    expect(root.querySelector('linearGradient')!.getAttribute('id')).toBe('svgtest-title')
    expect(root.querySelector('rect')!.getAttribute('fill')).toBe('url(#svgtest-title)')
  })

  it('rewrites href fragments on use', () => {
    const root = parseSvg(wrap('<defs><symbol id="s"><rect width="4" height="4"/></symbol></defs><use href="#s"/>'))
    namespaceIds(root, 'ns')
    expect(root.querySelector('use')!.getAttribute('href')).toBe('#ns-s')
  })

  it('rewrites url() inside inline styles', () => {
    const root = parseSvg(wrap('<defs><linearGradient id="g"/></defs><rect style="fill:url(#g)" width="4" height="4"/>'))
    namespaceIds(root, 'ns')
    expect(root.querySelector('rect')!.getAttribute('style')).toBe('fill:url(#ns-g)')
  })

  it('prefixes ids that would not be valid NCNames', () => {
    const root = parseSvg(wrap('<rect id="123bad" width="4" height="4"/>'))
    const { idMap } = namespaceIds(root, 'ns')
    expect(idMap.get('123bad')).toMatch(/^ns-x?/)
    expect(root.querySelector('rect')!.getAttribute('id')).toMatch(/^ns-/)
  })

  it('leaves unknown references alone', () => {
    expect(rewriteUrlRefs('url(#missing)', new Map())).toBe('url(#missing)')
  })
})

describe('importSvg', () => {
  it('maps a path to a real path node, never an image', () => {
    const result = importSvg(wrap('<path d="M10 90 C 40 60, 80 120, 120 90" stroke="#333" fill="none"/>'))
    const types = Object.values(result.nodes).map((n) => n.type)
    expect(types).toContain('path')
    expect(types).not.toContain('image')
  })

  it('maps rect, circle and path together', () => {
    const result = importSvg(
      wrap('<rect x="1" y="1" width="10" height="10"/><circle cx="20" cy="20" r="5"/><path d="M0 0 L10 10"/>'),
    )
    const types = Object.values(result.nodes).map((n) => n.type)
    expect(types).toContain('rect')
    expect(types).toContain('ellipse')
    expect(types).toContain('path')
  })

  it('carries rect geometry through, including corner radius', () => {
    const result = importSvg(wrap('<rect x="5" y="7" width="30" height="20" rx="4"/>'))
    const rect = Object.values(result.nodes).find((n) => n.type === 'rect')
    expect(rect).toBeTruthy()
    expect(rect!.transform.width).toBeCloseTo(30, 5)
    expect(rect!.transform.height).toBeCloseTo(20, 5)
    expect(rect!.transform.x).toBeCloseTo(5, 5)
    if (rect && rect.type === 'rect') expect(rect.cornerRadius[0]).toBeCloseTo(4, 5)
  })

  it('converts a circle to an ellipse node with the right box', () => {
    const result = importSvg(wrap('<circle cx="20" cy="30" r="8"/>'))
    const node = Object.values(result.nodes).find((n) => n.type === 'ellipse')!
    expect(node.transform.x).toBeCloseTo(12, 5)
    expect(node.transform.y).toBeCloseTo(22, 5)
    expect(node.transform.width).toBeCloseTo(16, 5)
  })

  it('converts polygon points to path data', () => {
    const result = importSvg(wrap('<polygon points="0,0 10,0 10,10"/>'))
    const node = Object.values(result.nodes).find((n) => n.type === 'path')
    expect(node && node.type === 'path' && node.d).toMatch(/Z$/)
  })

  it('preserves gradients as gradient paints, not flat colours', () => {
    const result = importSvg(
      wrap('<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient></defs><rect width="50" height="50" fill="url(#g)"/>'),
    )
    const rect = Object.values(result.nodes).find((n) => n.type === 'rect')!
    expect('style' in rect && rect.style.fill.type).toBe('linear')
    if ('style' in rect && rect.style.fill.type === 'linear') {
      expect(rect.style.fill.stops).toHaveLength(2)
      expect(rect.style.fill.stops[0]!.color).toMatchObject({ r: 255, g: 0, b: 0 })
      expect(rect.style.fill.stops[1]!.color).toMatchObject({ r: 0, g: 0, b: 255 })
    }
  })

  it('inherits presentation attributes from ancestors', () => {
    const result = importSvg(wrap('<g fill="#00ff00" stroke-width="4"><rect width="10" height="10"/></g>'))
    const rect = Object.values(result.nodes).find((n) => n.type === 'rect')!
    expect('style' in rect && rect.style.fill.type).toBe('solid')
    if ('style' in rect && rect.style.fill.type === 'solid') {
      expect(rect.style.fill.color).toMatchObject({ r: 0, g: 255, b: 0 })
    }
    expect('style' in rect && rect.style.stroke.width).toBe(4)
  })

  it('decomposes a transform attribute onto the node', () => {
    const result = importSvg(wrap('<rect width="10" height="10" transform="translate(30 40) rotate(90)"/>'))
    const rect = Object.values(result.nodes).find((n) => n.type === 'rect')!
    expect(rect.transform.rotation).toBeCloseTo(90, 4)
    expect(rect.transform.x).toBeCloseTo(30, 4)
    expect(rect.transform.y).toBeCloseTo(40, 4)
  })

  it('reads the viewBox for intrinsic size', () => {
    const result = importSvg(wrap('<rect width="10" height="10"/>', 'viewBox="0 0 400 300"'))
    expect(result.size).toEqual({ width: 400, height: 300 })
  })

  it('converts absolute CSS lengths on the root', () => {
    const result = importSvg(wrap('<rect width="10" height="10"/>', 'width="1in" height="72pt"'))
    expect(result.size.width).toBeCloseTo(96, 3)
    expect(result.size.height).toBeCloseTo(96, 3)
  })

  it('reports rather than throws on unparseable input', () => {
    const result = importSvg('totally not svg')
    expect(result.rootId).toBeNull()
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('skips display:none content', () => {
    const result = importSvg(wrap('<rect width="10" height="10" display="none"/><circle cx="1" cy="1" r="1"/>'))
    const types = Object.values(result.nodes).map((n) => n.type)
    expect(types).not.toContain('rect')
    expect(types).toContain('ellipse')
  })
})
