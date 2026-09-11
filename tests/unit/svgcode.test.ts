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
 * A shape's SVG code, both ways.
 *
 * What has to hold: code nobody touched changes nothing; an edit changes only
 * what was edited, so a star stays a star and an inside border stays inside;
 * code that is not one shape is refused whole; and a burst of typing is one
 * undo step.
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createArtboard, createDocument, createPolygon, createRect,
} from '@/document/NodeFactory'
import { addNode } from '@/document/DocumentModel'
import { worldMatrix } from '@/document/SceneGraph'
import { formatSvg, tokenizeSvg } from '@/svg/SvgFormat'
import { svgCodeFor } from '@/svg/SvgCode'
import { applySvgCode } from '@/history/SvgCodeCommands'
import { breakHistoryCoalescing, getDoc, replaceDocument, transaction, undo } from '@/state/DocumentStore'
import type { NodeId } from '@/document/types'

describe('reading markup as text', () => {
  const samples = [
    '<svg viewBox="0 0 10 10"><rect width="4" height="4" fill="#fff"/></svg>',
    '<svg><g><path d="M0 0L5 5"/></g></svg>',
    // What is in the box halfway through typing.
    '<svg width="10" height=',
    '<rect fill="#f00" x=5 / <circle',
    '<!-- note --><text x="1">Hi &amp; bye</text>',
  ]

  it('splits it into tokens that give the text back exactly, however broken', () => {
    for (const s of samples) expect(tokenizeSvg(s).map((t) => t.text).join('')).toBe(s)
  })

  it('names the parts a code view colours', () => {
    const kinds = tokenizeSvg('<rect fill="#fff"/>').map((t) => `${t.kind}:${t.text}`)
    expect(kinds).toEqual(['punct:<', 'tag:rect', 'space: ', 'attr:fill', 'punct:=', 'value:"#fff"', 'punct:/>'])
  })

  it('lays it out one element per line, children indented', () => {
    const out = formatSvg(
      '<svg viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0"/></linearGradient></defs>' +
        '<rect fill="url(#g)"/><text x="1">Hi</text><g></g></svg>',
    )
    expect(out).toBe(
      [
        '<svg viewBox="0 0 10 10">',
        '  <defs>',
        '    <linearGradient id="g">',
        '      <stop offset="0"/>',
        '    </linearGradient>',
        '  </defs>',
        '  <rect fill="url(#g)"/>',
        '  <text x="1">Hi</text>',
        '  <g></g>',
        '</svg>',
      ].join('\n'),
    )
  })
})

describe('editing a shape through its code', () => {
  let rect: NodeId
  let star: NodeId

  beforeEach(() => {
    replaceDocument(createDocument('Code', false))
    const board = createArtboard('A', { x: 100, y: 50, width: 800, height: 600 })
    const r = createRect({ x: 40, y: 30, width: 120, height: 80, rotation: 15 })
    r.style.stroke = { ...r.style.stroke, paint: { type: 'solid', color: { r: 0, g: 0, b: 0, a: 1 } }, width: 4, align: 'inner' }
    r.style.shadow = { x: 0, y: 4, blur: 8, color: { r: 0, g: 0, b: 0, a: 0.25 }, visible: true }
    const s = createPolygon({ x: 300, y: 200, width: 100, height: 100 }, {}, 5, 0.5)
    transaction('seed', (draft) => {
      addNode(draft, board, draft.rootId)
      addNode(draft, r, board.id)
      addNode(draft, s, board.id)
    })
    rect = r.id
    star = s.id
    breakHistoryCoalescing()
  })

  it('changes nothing when the code is left as it is', async () => {
    const code = await svgCodeFor(getDoc(), rect)
    const before = getDoc()
    expect(applySvgCode(rect, code, code)).toEqual({ ok: true, changed: false })
    expect(getDoc()).toBe(before)
  })

  it('changes only the fill when only the fill is edited', async () => {
    const code = await svgCodeFor(getDoc(), rect)
    const before = getDoc().nodes[rect]!
    const result = applySvgCode(rect, code.replace('fill="#d9d9d9"', 'fill="#e53935"'), code)
    expect(result).toEqual({ ok: true, changed: true })

    const after = getDoc().nodes[rect]!
    expect(after.type === 'rect' && after.style.fill).toEqual({ type: 'solid', color: { r: 229, g: 57, b: 53, a: 1 } })
    // Untouched, to the bit: the placement, the inside border, the shadow.
    expect(after.transform).toEqual(before.transform)
    expect(after.type === 'rect' && after.style.stroke.align).toBe('inner')
    expect(after.type === 'rect' && after.style.shadow).toEqual(before.type === 'rect' && before.style.shadow)
  })

  it('keeps a star a star when its colour changes, though its code is a path', async () => {
    const code = await svgCodeFor(getDoc(), star)
    expect(code).toContain('<path')
    applySvgCode(star, code.replace('fill="#d9d9d9"', 'fill="#1e88e5"'), code)
    const after = getDoc().nodes[star]!
    expect(after.type).toBe('polygon')
    expect(after.type === 'polygon' && [after.sides, after.starRatio]).toEqual([5, 0.5])
    expect(after.type === 'polygon' && after.style.fill).toMatchObject({ color: { r: 30, g: 136, b: 229 } })
  })

  it('moves the shape when its transform is edited, in the document, not the viewBox', async () => {
    const code = await svgCodeFor(getDoc(), rect)
    const before = worldMatrix(getDoc(), rect)
    const moved = code.replace(/transform="matrix\(([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^)]+)\)"/, (_, a, b, c, d, e, f) =>
      `transform="matrix(${a} ${b} ${c} ${d} ${Number(e) + 25} ${f})"`)
    applySvgCode(rect, moved, code)
    const after = worldMatrix(getDoc(), rect)
    expect(after[4] - before[4]).toBeCloseTo(25, 2)
    expect(after[5]).toBeCloseTo(before[5], 2)
    expect(getDoc().nodes[rect]!.parentId).toBe(getDoc().nodes[star]!.parentId)
  })

  it('replaces the shape, keeping who it is, when retyped as another kind', async () => {
    const code = await svgCodeFor(getDoc(), rect)
    const circle = code.replace(/<rect [^>]*\/>/, '<circle cx="200" cy="120" r="30" fill="#43a047"/>')
    const parent = getDoc().nodes[rect]!.parentId!
    const indexBefore = (getDoc().nodes[parent] as { children: NodeId[] }).children.indexOf(rect)

    expect(applySvgCode(rect, circle, code)).toEqual({ ok: true, changed: true })
    const after = getDoc().nodes[rect]!
    expect(after.type).toBe('ellipse')
    expect(after.name).toBe('Rectangle')
    expect((getDoc().nodes[parent] as { children: NodeId[] }).children.indexOf(rect)).toBe(indexBefore)
    expect([after.transform.width, after.transform.height]).toEqual([60, 60])
  })

  it('refuses code that is not one shape, and changes nothing', async () => {
    const code = await svgCodeFor(getDoc(), rect)
    const before = getDoc()
    for (const bad of [
      '<svg><rect',
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5"/><circle r="4"/></svg>',
    ]) {
      const result = applySvgCode(rect, bad, code)
      expect(result.ok).toBe(false)
    }
    expect(getDoc()).toBe(before)
  })

  it('is one undo step for a burst of typing', async () => {
    const original = getDoc().nodes[rect]!
    const code = await svgCodeFor(getDoc(), rect)
    const first = code.replace('fill="#d9d9d9"', 'fill="#ff0000"')
    applySvgCode(rect, first, code, `svg-code:${rect}`)
    const shownAfterFirst = await svgCodeFor(getDoc(), rect)
    applySvgCode(rect, first.replace('stroke-width="4"', 'stroke-width="9"'), shownAfterFirst, `svg-code:${rect}`)
    const after = getDoc().nodes[rect]!
    expect(after.type === 'rect' && after.style.stroke.width).toBe(9)

    undo()
    expect(getDoc().nodes[rect]).toEqual(original)
  })
})
