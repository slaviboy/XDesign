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
 * Formatting part of a text object.
 *
 * A text object's style is the fallback and its runs are the exceptions, so
 * these tests are mostly about the boundaries: a run that ends where another
 * begins, a range that cuts one in half, a range that swallows three whole.
 * The rule every one of them has to agree with is the layout engine's — the
 * LAST run covering a character wins outright, rather than merging with what
 * came before it.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { applyRunStyle, runsIn, normalizeRuns } from '@/document/types'
import { createDocument, createText } from '@/document/NodeFactory'
import { addNode } from '@/document/DocumentModel'
import { replaceDocument, getDoc, transaction, undo } from '@/state/DocumentStore'
import { clearTextRunStyle, setTextRunStyle, isCharacterStyle } from '@/history/Commands'
import { caretRect, indexAtPoint, layoutOf, selectionRects } from '@/text/TextGeometry'
import type { NodeId, TextNode, TextRun } from '@/document/types'

const TEXT = 'You can adjust the text'
//            0123456789...

function seed(runs?: TextRun[]): NodeId {
  replaceDocument(createDocument('Format', false))
  const text = createText(TEXT, { x: 0, y: 0, width: 400, height: 40 })
  if (runs) text.runs = runs
  transaction('seed', (draft) => { addNode(draft, text, draft.rootId) })
  return text.id
}

const node = (id: NodeId): TextNode => getDoc().nodes[id] as TextNode

describe('applyRunStyle', () => {
  it('styles a range of plain text', () => {
    const runs = applyRunStyle(undefined, TEXT.length, 0, 3, { style: { fontWeight: 700 } })
    expect(runs).toEqual([{ start: 0, end: 3, style: { fontWeight: 700 } }])
  })

  it('does nothing for an empty range', () => {
    expect(applyRunStyle(undefined, TEXT.length, 4, 4, { style: { fontWeight: 700 } })).toBeUndefined()
  })

  it('cuts an existing run rather than replacing it', () => {
    const existing: TextRun[] = [{ start: 0, end: 10, style: { fontWeight: 700 } }]
    const runs = applyRunStyle(existing, TEXT.length, 4, 8, { style: { fontStyle: 'italic' } })
    expect(runs).toEqual([
      { start: 0, end: 4, style: { fontWeight: 700 } },
      { start: 4, end: 8, style: { fontWeight: 700, fontStyle: 'italic' } },
      { start: 8, end: 10, style: { fontWeight: 700 } },
    ])
  })

  it('merges into what is already there rather than clobbering it', () => {
    const existing: TextRun[] = [{ start: 0, end: 5, style: { fontWeight: 700 } }]
    const runs = applyRunStyle(existing, TEXT.length, 0, 5, { style: { fontSize: 24 } })
    expect(runs).toEqual([{ start: 0, end: 5, style: { fontWeight: 700, fontSize: 24 } }])
  })

  it('joins neighbours that end up saying the same thing', () => {
    const existing: TextRun[] = [
      { start: 0, end: 4, style: { fontWeight: 700 } },
      { start: 8, end: 12, style: { fontWeight: 700 } },
    ]
    const runs = applyRunStyle(existing, TEXT.length, 0, 12, { style: { fontWeight: 700 } })
    expect(runs).toEqual([{ start: 0, end: 12, style: { fontWeight: 700 } }])
  })

  it('never produces overlapping runs', () => {
    let runs = applyRunStyle(undefined, TEXT.length, 0, 12, { style: { fontWeight: 700 } })
    runs = applyRunStyle(runs, TEXT.length, 6, 20, { style: { fontSize: 30 } })
    runs = applyRunStyle(runs, TEXT.length, 3, 9, { style: { fontStyle: 'italic' } })
    for (let i = 1; i < runs!.length; i++) {
      expect(runs![i]!.start).toBeGreaterThanOrEqual(runs![i - 1]!.end)
    }
  })

  it('clamps a range that runs past the end of the text', () => {
    const runs = applyRunStyle(undefined, TEXT.length, 20, 9999, { style: { fontWeight: 700 } })
    expect(runs).toEqual([{ start: 20, end: TEXT.length, style: { fontWeight: 700 } }])
  })

  it('takes the ends in either order', () => {
    expect(applyRunStyle(undefined, TEXT.length, 8, 3, { style: { fontWeight: 700 } }))
      .toEqual([{ start: 3, end: 8, style: { fontWeight: 700 } }])
  })

  it('carries a fill, and gives it up on request', () => {
    const red = { type: 'solid' as const, color: { r: 255, g: 0, b: 0, a: 1 } }
    const withFill = applyRunStyle(undefined, TEXT.length, 0, 3, { fill: red })
    expect(withFill).toEqual([{ start: 0, end: 3, fill: red }])

    const cleared = applyRunStyle(withFill, TEXT.length, 0, 3, { fill: null })
    expect(cleared).toBeUndefined()
  })
})

describe('runsIn', () => {
  it('reports one segment for uniform text', () => {
    const id = seed()
    const segments = runsIn(node(id), 0, 10)
    expect(segments).toHaveLength(1)
    expect(segments[0]!.style.fontWeight).toBe(node(id).textStyle.fontWeight)
  })

  it('reports each distinct stretch a range covers', () => {
    const id = seed([{ start: 4, end: 8, style: { fontWeight: 700 } }])
    const segments = runsIn(node(id), 0, 12)
    expect(segments.map((s) => [s.start, s.end])).toEqual([[0, 4], [4, 8], [8, 12]])
    expect(segments.map((s) => s.style.fontWeight)).toEqual([400, 700, 400])
  })

  it('resolves a run against the object style rather than against nothing', () => {
    const id = seed([{ start: 0, end: 3, style: { fontWeight: 700 } }])
    const [first] = runsIn(node(id), 0, 3)
    // The run said nothing about the family, so the object's answer stands.
    expect(first!.style.fontFamily).toBe(node(id).textStyle.fontFamily)
    expect(first!.style.fontWeight).toBe(700)
  })

  it('lets a later run win outright, as the layout engine does', () => {
    const id = seed([
      { start: 0, end: 10, style: { fontWeight: 700, fontSize: 30 } },
      { start: 4, end: 8, style: { fontStyle: 'italic' } },
    ])
    const segments = runsIn(node(id), 4, 8)
    expect(segments[0]!.style.fontStyle).toBe('italic')
    // Not 700: the later run replaced the earlier one for these characters.
    expect(segments[0]!.style.fontWeight).toBe(400)
  })

  it('answers for a caret with what typing there would look like', () => {
    const id = seed([{ start: 0, end: 5, style: { fontWeight: 700 } }])
    // Inside the bold word.
    expect(runsIn(node(id), 3, 3)[0]!.style.fontWeight).toBe(700)
    // Right after it, still continuing the word you are in.
    expect(runsIn(node(id), 5, 5)[0]!.style.fontWeight).toBe(700)
    // Well past it.
    expect(runsIn(node(id), 9, 9)[0]!.style.fontWeight).toBe(400)
  })
})

describe('formatting through the command', () => {
  let id: NodeId
  beforeEach(() => { id = seed() })

  it('styles only the characters asked for', () => {
    expect(setTextRunStyle(id, 0, 3, { style: { fontWeight: 700 } })).toBe(true)
    expect(node(id).runs).toEqual([{ start: 0, end: 3, style: { fontWeight: 700 } }])
    // The object's own style is untouched: it is the fallback, not the value.
    expect(node(id).textStyle.fontWeight).toBe(400)
  })

  it('refuses an empty range instead of writing an empty run', () => {
    expect(setTextRunStyle(id, 4, 4, { style: { fontWeight: 700 } })).toBe(false)
    expect(node(id).runs).toBeUndefined()
  })

  it('is one undo step', () => {
    setTextRunStyle(id, 0, 3, { style: { fontWeight: 700 } })
    undo()
    expect(node(id).runs).toBeUndefined()
  })

  it('clears a range back to the object style', () => {
    setTextRunStyle(id, 0, 10, { style: { fontWeight: 700 } })
    expect(clearTextRunStyle(id, 4, 8)).toBe(true)
    expect(node(id).runs).toEqual([
      { start: 0, end: 4, style: { fontWeight: 700 } },
      { start: 8, end: 10, style: { fontWeight: 700 } },
    ])
  })

  it('leaves no runs key at all once the last one goes', () => {
    setTextRunStyle(id, 0, 5, { style: { fontWeight: 700 } })
    clearTextRunStyle(id, 0, 5)
    expect('runs' in node(id)).toBe(false)
  })

  it('knows which properties a range can carry', () => {
    expect(isCharacterStyle({ fontWeight: 700 })).toBe(true)
    expect(isCharacterStyle({ fontSize: 20 })).toBe(true)
    expect(isCharacterStyle({ underline: true })).toBe(true)
    // Block properties: "these three words are centred" is not a thing.
    expect(isCharacterStyle({ align: 'center' })).toBe(false)
    expect(isCharacterStyle({ lineHeight: 2 })).toBe(false)
    expect(isCharacterStyle({ paragraphSpacing: 8 })).toBe(false)
    expect(isCharacterStyle({ sizing: 'fixed' })).toBe(false)
  })

  it('keeps styling attached to its word when the text around it is edited', () => {
    setTextRunStyle(id, 4, 7, { style: { fontWeight: 700 } })
    // "You " becomes "You really " — the bold "can" moves with the insertion.
    transaction('type', (draft) => {
      const n = draft.nodes[id] as TextNode
      const before = n.text
      n.text = 'You really can adjust the text'
      n.runs = normalizeRuns(
        n.runs?.map((r) => ({ ...r, start: r.start + 7, end: r.end + 7 })),
        n.text.length,
      )
      expect(before).toBe(TEXT)
    })
    const segments = runsIn(node(id), 11, 14)
    expect(segments[0]!.style.fontWeight).toBe(700)
    expect(node(id).text.slice(11, 14)).toBe('can')
  })
})

describe('where the characters are', () => {
  it('gives every line the slice of the string it drew', () => {
    const id = seed()
    const layout = layoutOf(node(id))
    for (const line of layout.lines) {
      expect(node(id).text.slice(line.start, line.end)).toBe(line.text)
    }
  })

  it('walks the caret rightwards, one character at a time', () => {
    const id = seed()
    let last = -1
    for (let i = 0; i <= TEXT.length; i++) {
      const rect = caretRect(node(id), i)
      expect(Number.isFinite(rect.x)).toBe(true)
      expect(rect.x).toBeGreaterThan(last)
      last = rect.x
    }
  })

  it('measures a run in its own style, not the object\u2019s', () => {
    const plain = seed()
    const plainAt = caretRect(node(plain), 10).x

    // The same index, with the characters before it drawn much larger.
    const big = seed([{ start: 0, end: 5, style: { fontSize: 48 } }])
    const bigAt = caretRect(node(big), 10).x

    // This is the whole point: a textarea would put both carets in the same
    // place, because it lays every character out at one size.
    expect(bigAt).toBeGreaterThan(plainAt + 20)
  })

  it('covers a selection with one rectangle per line', () => {
    const id = seed()
    const rects = selectionRects(node(id), 0, 7)
    expect(rects).toHaveLength(1)
    expect(rects[0]!.width).toBeGreaterThan(0)
    expect(rects[0]!.height).toBeGreaterThan(0)
  })

  it('has nothing to draw for an empty selection', () => {
    const id = seed()
    expect(selectionRects(node(id), 4, 4)).toEqual([])
  })

  it('makes a selection wider the more it covers', () => {
    const id = seed()
    const short = selectionRects(node(id), 0, 3)[0]!.width
    const long = selectionRects(node(id), 0, 10)[0]!.width
    expect(long).toBeGreaterThan(short)
  })

  it('finds the character a point lands on, and comes back to it', () => {
    const id = seed([{ start: 0, end: 5, style: { fontSize: 40 } }])
    for (const index of [0, 3, 7, 12, TEXT.length]) {
      const rect = caretRect(node(id), index)
      expect(indexAtPoint(node(id), rect.x, rect.y + rect.height / 2)).toBe(index)
    }
  })

  it('clamps a point outside the text to the nearest end', () => {
    const id = seed()
    expect(indexAtPoint(node(id), -500, 0)).toBe(0)
    const far = indexAtPoint(node(id), 99999, 99999)
    expect(far).toBe(TEXT.length)
  })
})
