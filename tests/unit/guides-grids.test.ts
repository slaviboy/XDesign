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
 * Per-artboard guides and grids, below the DOM.
 *
 * The layout-grid tests assert the property that matters — the columns land
 * exactly inside the artboard — rather than snapshotting the numbers, so a
 * future "fix" that trims the last column to make it fit fails here.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  DEFAULT_LAYOUT_GRID,
  DEFAULT_SQUARE_GRID,
  gutterForColumnWidth,
  layoutColumns,
  type LayoutGrid,
} from '../../src/document/types'
import { gridStepForZoom } from '../../src/canvas/gridMath'
import { addNode } from '../../src/document/DocumentModel'
import { createArtboard, createDocument } from '../../src/document/NodeFactory'
import { deserializeDocument, serializeDocument } from '../../src/persistence/FileFormat'
import { replaceDocument, getDoc, undo } from '../../src/state/DocumentStore'
import {
  addGuide,
  clearGuides,
  copyGuides,
  moveGuide,
  pasteGuides,
  removeGuide,
  setArtboardGrid,
  setGuidesLocked,
} from '../../src/history/Commands'

const layout = (patch: Partial<LayoutGrid> = {}): LayoutGrid => ({ ...DEFAULT_LAYOUT_GRID, ...patch })

// ------------------------------------------------------------ layout maths --

describe('layout grid geometry', () => {
  it('fills the artboard exactly, whatever the parameters', () => {
    const cases: Array<[number, Partial<LayoutGrid>]> = [
      [1440, { columns: 12, gutter: 20, marginLeft: 16, marginRight: 16 }],
      [375, { columns: 4, gutter: 16, marginLeft: 20, marginRight: 20 }],
      [1000, { columns: 1, gutter: 99, marginLeft: 0, marginRight: 0 }],
      [800, { columns: 3, gutter: 0, marginLeft: 0, marginRight: 0 }],
    ]
    for (const [width, patch] of cases) {
      const grid = layout(patch)
      const cols = layoutColumns(width, grid)
      expect(cols, JSON.stringify(patch)).toHaveLength(grid.columns)
      expect(cols[0]!.x).toBeCloseTo(grid.marginLeft, 9)
      // The right edge lands on the margin, never past it. This is the whole of
      // "the grid is kept within the bounds of artboard".
      const last = cols[cols.length - 1]!
      expect(last.x + last.width, JSON.stringify(patch)).toBeCloseTo(width - grid.marginRight, 9)
      for (const c of cols) expect(c.width).toBeGreaterThanOrEqual(1)
    }
  })

  it('a single column has no gutter to spend', () => {
    const cols = layoutColumns(500, layout({ columns: 1, gutter: 40, marginLeft: 10, marginRight: 10 }))
    expect(cols).toHaveLength(1)
    expect(cols[0]!.width).toBe(480)
  })

  it('draws nothing at all when it cannot fit', () => {
    // Twelve columns and a 500px gutter on a phone: there is no honest answer,
    // and a negative width drawn as a mirrored rect is the dishonest one.
    expect(layoutColumns(320, layout({ columns: 12, gutter: 500 }))).toEqual([])
    expect(layoutColumns(320, layout({ marginLeft: 200, marginRight: 200 }))).toEqual([])
  })

  it('column width is adjustable through the gutter', () => {
    const grid = layout({ columns: 6, gutter: 20, marginLeft: 0, marginRight: 0 })
    const gutter = gutterForColumnWidth(1200, grid, 150)!
    const cols = layoutColumns(1200, { ...grid, gutter })
    expect(cols[0]!.width).toBeCloseTo(150, 9)
    // And it still ends exactly on the edge.
    expect(cols[5]!.x + cols[5]!.width).toBeCloseTo(1200, 9)
  })

  it('there is no gutter to solve for below two columns', () => {
    expect(gutterForColumnWidth(500, layout({ columns: 1 }), 100)).toBeNull()
  })
})

describe('gridStepForZoom', () => {
  it('steps up until a cell is visible, in multiples of the real size', () => {
    const step = gridStepForZoom(8, 0.05)
    expect(step * 0.05).toBeGreaterThanOrEqual(6)
    // A multiple, so every line drawn is a line the grid actually has.
    expect(step % 8).toBe(0)
  })

  it('leaves a comfortable grid alone', () => {
    expect(gridStepForZoom(8, 1)).toBe(8)
  })
})

// ---------------------------------------------------------------- commands --

function docWithArtboards(count = 2) {
  const doc = createDocument('T', false)
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    const ab = createArtboard(`A${i}`, { x: i * 500, y: 0, width: 400, height: 300 })
    addNode(doc, ab, doc.rootId)
    ids.push(ab.id)
  }
  replaceDocument(doc)
  return ids
}

describe('guide commands', () => {
  let boards: string[]
  beforeEach(() => {
    boards = docWithArtboards()
  })

  const guidesOf = (id: string) => {
    const n = getDoc().nodes[id]
    return n?.type === 'artboard' ? (n.guides ?? []) : []
  }

  it('adds a guide to one artboard and mints its id', () => {
    const id = addGuide(boards[0]!, 'x', 120)
    expect(id).toBeTruthy()
    expect(guidesOf(boards[0]!)).toEqual([{ id, axis: 'x', position: 120 }])
    // Its neighbour is untouched: guides belong to an artboard, not a document.
    expect(guidesOf(boards[1]!)).toEqual([])
  })

  it('refuses every edit while the guides are locked', () => {
    const id = addGuide(boards[0]!, 'x', 120)!
    setGuidesLocked([boards[0]!], true)

    expect(addGuide(boards[0]!, 'y', 50)).toBeNull()
    expect(moveGuide(boards[0]!, id, 300)).toBe(false)
    expect(removeGuide(boards[0]!, id)).toBe(false)
    expect(clearGuides([boards[0]!])).toBe(false)
    expect(guidesOf(boards[0]!)).toEqual([{ id, axis: 'x', position: 120 }])

    // And unlocking gives them back, rather than having discarded anything.
    setGuidesLocked([boards[0]!], false)
    expect(moveGuide(boards[0]!, id, 300)).toBe(true)
    expect(guidesOf(boards[0]!)[0]!.position).toBe(300)
  })

  it('copies a set of guides across artboards, in one entry', () => {
    addGuide(boards[0]!, 'x', 100)
    addGuide(boards[0]!, 'y', 40)
    expect(copyGuides(boards[0]!)).toBe(2)

    expect(pasteGuides([boards[1]!])).toBe(true)
    // Same LOCAL positions, so the set lands the same way on every screen —
    // which is the point of the feature.
    expect(guidesOf(boards[1]!).map((g) => `${g.axis}${g.position}`)).toEqual(['x100', 'y40'])
    // Fresh ids: two artboards must not share a guide.
    expect(guidesOf(boards[1]!)[0]!.id).not.toBe(guidesOf(boards[0]!)[0]!.id)

    undo()
    expect(guidesOf(boards[1]!)).toEqual([])
  })

  it('removes every guide on the artboards it is given, and only those', () => {
    addGuide(boards[0]!, 'x', 100)
    addGuide(boards[1]!, 'x', 100)
    clearGuides([boards[0]!])
    expect(guidesOf(boards[0]!)).toEqual([])
    expect(guidesOf(boards[1]!)).toHaveLength(1)
  })
})

describe('grid commands', () => {
  it('sets one grid across a multi-artboard selection, undone as one', () => {
    const boards = docWithArtboards()
    setArtboardGrid(boards, { type: 'layout', columns: 8 })
    for (const id of boards) {
      const n = getDoc().nodes[id]
      expect(n?.type === 'artboard' && n.grid).toMatchObject({ type: 'layout', columns: 8 })
    }
    undo()
    expect(getDoc().nodes[boards[0]!]).toMatchObject({ type: 'artboard' })
    expect((getDoc().nodes[boards[0]!] as { grid?: unknown }).grid).toBeUndefined()
  })

  it('switching kind starts from that kind of default, not a mangled merge', () => {
    const boards = docWithArtboards(1)
    setArtboardGrid(boards, { type: 'square', size: 32 })
    setArtboardGrid(boards, { type: 'layout' })
    const grid = (getDoc().nodes[boards[0]!] as { grid?: LayoutGrid }).grid!
    // A square's `size` has no meaning as a column count; the layout default wins.
    expect(grid.columns).toBe(DEFAULT_LAYOUT_GRID.columns)
    expect(grid).not.toHaveProperty('size')
  })

  it('clamps values the UI would not have offered', () => {
    const boards = docWithArtboards(1)
    setArtboardGrid(boards, { type: 'layout', columns: 0, gutter: -5, marginLeft: -10 })
    const grid = (getDoc().nodes[boards[0]!] as { grid?: LayoutGrid }).grid!
    expect(grid.columns).toBe(1)
    expect(grid.gutter).toBe(0)
    expect(grid.marginLeft).toBe(0)
  })
})

// ------------------------------------------------------------- persistence --

describe('guides and grids on disk', () => {
  it('round-trip exactly, alpha included', () => {
    const doc = createDocument('T', false)
    const ab = createArtboard('A', { x: 0, y: 0, width: 400, height: 300 })
    ab.guides = [{ id: 'g1', axis: 'x', position: 120 }]
    ab.guidesLocked = true
    ab.grid = { ...DEFAULT_SQUARE_GRID, size: 16, color: { r: 1, g: 2, b: 3, a: 0.2 } }
    addNode(doc, ab, doc.rootId)

    const back = deserializeDocument(serializeDocument(doc))
    const loaded = back.nodes[ab.id]!
    expect(loaded.type === 'artboard' && loaded.guides).toEqual(ab.guides)
    expect(loaded.type === 'artboard' && loaded.guidesLocked).toBe(true)
    // toEqual, not toMatchObject: a grid that loads at a different alpha is a
    // silent corruption of someone's document.
    expect(loaded.type === 'artboard' && loaded.grid).toEqual(ab.grid)
    expect(back).not.toHaveProperty('guides')
  })

  it('an artboard with nothing set costs nothing in the file', () => {
    const doc = createDocument('T', true)
    const json = new TextDecoder().decode(serializeDocument(doc, { plainJson: true }))
    expect(json).not.toContain('"guides"')
    expect(json).not.toContain('"grid"')
    expect(json).not.toContain('"guidesLocked"')
  })
})
