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

  it('imports display:none content hidden rather than discarding it', () => {
    const result = importSvg(wrap('<rect width="10" height="10" display="none"/><circle cx="1" cy="1" r="1"/>'))
    const rect = Object.values(result.nodes).find((n) => n.type === 'rect')
    // Kept, so the artwork is not silently lost and the user can unhide it.
    expect(rect).toBeTruthy()
    expect(rect!.visible).toBe(false)
    expect(Object.values(result.nodes).find((n) => n.type === 'ellipse')?.visible).toBe(true)
  })

  it('treats visibility:hidden the same way', () => {
    const result = importSvg(wrap('<rect width="10" height="10" visibility="hidden"/>'))
    expect(Object.values(result.nodes).find((n) => n.type === 'rect')?.visible).toBe(false)
  })
})

/**
 * Clipping.
 *
 * The reference SVG this was built against wraps every one of its ~700 elements
 * in a single `<g clip-path="url(#…)">`. That one attribute used to collapse the
 * whole file into one opaque preserved-markup node — no groups, no layers,
 * nothing editable. These tests are the guard on that.
 */
describe('clip paths become real, editable structure', () => {
  const CLIPPED = wrap(
    `<defs><clipPath id="c"><rect width="200" height="120"/></clipPath></defs>
     <g id="Root" data-name="Root Layer" clip-path="url(#c)">
       <rect id="a" data-name="Box A" width="40" height="40" fill="#ff0000"/>
       <g id="inner" data-name="Inner"><circle cx="100" cy="60" r="20" fill="#00ff00"/></g>
     </g>`,
  )

  it('keeps the clipped group as a group instead of one opaque blob', () => {
    const r = importSvg(CLIPPED)
    const types = Object.values(r.nodes).map((n) => n.type)
    expect(types).not.toContain('svg')
    expect(types).toContain('group')
    expect(types).toContain('rect')
    expect(types).toContain('ellipse')
  })

  it('preserves the nesting rather than flattening it', () => {
    const r = importSvg(CLIPPED)
    const inner = Object.values(r.nodes).find((n) => n.name === 'Inner')
    expect(inner?.type).toBe('group')
    const circle = Object.values(r.nodes).find((n) => n.type === 'ellipse')
    expect(circle?.parentId).toBe(inner?.id)
  })

  it('attaches the clip outline as the group mask', () => {
    const r = importSvg(CLIPPED)
    const root = Object.values(r.nodes).find((n) => n.name === 'Root Layer')
    expect(root?.type).toBe('group')
    const maskId = root && 'maskId' in root ? root.maskId : undefined
    expect(maskId).toBeTruthy()
    // The clip rect is a real node, and it is the last child so it is on top.
    expect(r.nodes[maskId!]?.type).toBe('rect')
    expect((root as { children: string[] }).children.at(-1)).toBe(maskId)
  })

  it('takes layer names from data-name, not the mangled id', () => {
    const r = importSvg(CLIPPED)
    const names = Object.values(r.nodes).map((n) => n.name)
    expect(names).toContain('Root Layer')
    expect(names).toContain('Box A')
  })

  it('clips a bare shape by wrapping it, rather than dropping the clip', () => {
    const r = importSvg(
      wrap(`<defs><clipPath id="c"><rect width="20" height="20"/></clipPath></defs>
            <rect id="r" width="80" height="80" fill="#000" clip-path="url(#c)"/>`),
    )
    const group = Object.values(r.nodes).find((n) => n.type === 'group')
    expect(group).toBeTruthy()
    expect(group && 'maskId' in group ? group.maskId : null).toBeTruthy()
    expect(Object.values(r.nodes).filter((n) => n.type === 'rect')).toHaveLength(2)
  })

  it('unions a multi-shape clip into one grouped outline', () => {
    const r = importSvg(
      wrap(`<defs><clipPath id="c"><rect width="20" height="20"/><rect x="40" width="20" height="20"/></clipPath></defs>
            <g clip-path="url(#c)"><rect width="80" height="80"/></g>`),
    )
    const clipGroup = Object.values(r.nodes).find((n) => n.name === 'Clip')
    expect(clipGroup?.type).toBe('group')
    expect((clipGroup as { children: string[] }).children).toHaveLength(2)
  })

  it('records a <mask> as a luminance mask, not a hard clip', () => {
    const r = importSvg(
      wrap(`<defs><mask id="m"><rect width="50" height="50" fill="#fff"/></mask></defs>
            <g mask="url(#m)"><rect width="80" height="80"/></g>`),
    )
    const masked = Object.values(r.nodes).find((n) => n.type === 'group' && 'maskId' in n && n.maskId)
    expect(masked && 'maskMode' in masked ? masked.maskMode : null).toBe('luminance')
  })

  it('keeps the artwork when a clip reference is dangling, and says so', () => {
    const r = importSvg(wrap(`<g clip-path="url(#nope)"><rect width="80" height="80"/></g>`))
    expect(Object.values(r.nodes).some((n) => n.type === 'rect')).toBe(true)
    expect(r.warnings.join(' ')).toMatch(/does not define/)
  })

  it('collects identified defs so a url(#…) paint can still resolve', () => {
    const r = importSvg(
      wrap(`<defs><pattern id="p" width="4" height="4"><rect width="2" height="2"/></pattern></defs>
            <rect width="40" height="40" fill="url(#p)"/>`),
    )
    expect(Object.keys(r.svgDefs).length).toBeGreaterThan(0)
    const rect = Object.values(r.nodes).find((n) => n.type === 'rect')
    expect(rect && 'style' in rect ? rect.style.fill.type : null).toBe('ref')
  })
})

/**
 * Number-list parsing.
 *
 * Both of these corrupted artwork silently: splitting an SVG number list on
 * whitespace mis-reads a leading separator (Number('') is a finite 0) and
 * mis-reads the minus sign, which SVG allows as its own separator.
 */
describe('SVG number lists are scanned, not split', () => {
  it('survives a leading space in viewBox instead of scaling by the width', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"
      viewBox=" 0 0 200 120"><rect width="100" height="60" fill="#000"/></svg>`
    const r = importSvg(svg)
    expect(r.size).toEqual({ width: 200, height: 120 })
    // A viewBox read as width 0 made the root matrix scale by ~200x.
    const rect = Object.values(r.nodes).find((n) => n.type === 'rect')!
    expect(rect.transform.width).toBeCloseTo(100, 3)
  })

  it('reads sign-packed polygon points as separate numbers', () => {
    // "30-5" is (30, -5): SVG allows the minus sign as its own separator, and
    // splitting on whitespace turned it into a NaN that was filtered away,
    // silently dropping the middle point — and with it the whole polygon.
    const r = importSvg(wrap(`<polygon points="10,20 30-5 40,50"/>`))
    const path = Object.values(r.nodes).find((n) => n.type === 'path')
    const d = path && 'd' in path ? path.d : ''
    // Three points survive; svgpath compacts consecutive L commands, so count
    // coordinates rather than command letters.
    expect(d.match(/-?[\d.]+/g)).toHaveLength(6)
    // Rebased onto its own bounding box: (10,20) (30,-5) (40,50) -> origin (10,-5).
    expect(d).toBe('M0 25L20 0 30 55Z')
  })
})

describe('nothing is dropped without saying so', () => {
  it('names the construct it preserved rather than a vague catch-all', () => {
    const r = importSvg(
      wrap(`<use href="#nothing" x="0" y="0" width="10" height="10"/><rect width="10" height="10"/>`),
    )
    // Either it was preserved or it could not be measured — either way it is named.
    expect(r.warnings.join(' ')).toMatch(/<use>/)
  })
})
