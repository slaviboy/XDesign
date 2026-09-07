/**
 * Repeat Grid, match-size and the rotation-cursor maths. Plain node — none of
 * this touches the DOM.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { repeatGridSize, repeatGridOffsets, isContainer, usesOwnBox } from '@/document/types'
import { createDocument, createRect, createRepeatGrid } from '@/document/NodeFactory'
import { addNode } from '@/document/DocumentModel'
import { geometryBounds } from '@/document/SceneGraph'
import { replaceDocument, getDoc, transaction } from '@/state/DocumentStore'
import { setSelection } from '@/state/EditorStore'
import {
  createRepeatGridFromSelection,
  expandRepeatGrid,
  setRepeatGridParams,
} from '@/history/RepeatGridCommands'
import { matchSize } from '@/history/Commands'
import { serializeDocument, deserializeDocument } from '@/persistence/FileFormat'

describe('repeat grid geometry', () => {
  const grid = createRepeatGrid([], { width: 100, height: 50 })

  it('sizes from rows, columns and gutters', () => {
    expect(repeatGridSize({ ...grid, columns: 3, rows: 2, gutterX: 10, gutterY: 20 }))
      .toEqual({ width: 3 * 100 + 2 * 10, height: 2 * 50 + 1 * 20 })
  })

  it('a single cell has no gutter contribution', () => {
    expect(repeatGridSize({ ...grid, columns: 1, rows: 1, gutterX: 99, gutterY: 99 }))
      .toEqual({ width: 100, height: 50 })
  })

  it('lays out offsets in row-major order', () => {
    const offsets = repeatGridOffsets({ ...grid, columns: 3, rows: 2, gutterX: 10, gutterY: 20 })
    expect(offsets).toHaveLength(6)
    expect(offsets[0]).toEqual({ x: 0, y: 0 })
    expect(offsets[1]).toEqual({ x: 110, y: 0 })
    expect(offsets[2]).toEqual({ x: 220, y: 0 })
    expect(offsets[3]).toEqual({ x: 0, y: 70 })
  })

  it('allows negative gutters, so repeats can overlap', () => {
    const offsets = repeatGridOffsets({ ...grid, columns: 2, rows: 1, gutterX: -20, gutterY: 0 })
    expect(offsets[1]!.x).toBe(80)
  })

  it('clamps degenerate counts rather than producing nothing', () => {
    expect(repeatGridOffsets({ ...grid, columns: 0, rows: -3, gutterX: 0, gutterY: 0 })).toHaveLength(1)
  })

  it('is a container that sizes from its own box, not its children', () => {
    expect(isContainer(grid)).toBe(true)
    expect(usesOwnBox(grid)).toBe(true)
  })
})

describe('repeat grid commands', () => {
  beforeEach(() => replaceDocument(createDocument('RG', false)))

  function withRect() {
    const rect = createRect({ x: 40, y: 60, width: 100, height: 50 })
    transaction('add', (d) => { addNode(d, rect, d.rootId) })
    setSelection([rect.id])
    return rect
  }

  it('wraps the selection without moving it', () => {
    const rect = withRect()
    const before = geometryBounds(getDoc(), rect.id)

    const gridId = createRepeatGridFromSelection()!
    expect(gridId).toBeTruthy()

    const after = geometryBounds(getDoc(), rect.id)
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
    // The grid sits exactly where the content was.
    const gridBounds = geometryBounds(getDoc(), gridId)
    expect(gridBounds.x).toBeCloseTo(before.x, 6)
    expect(gridBounds.width).toBeCloseTo(before.width, 6)
  })

  it('holds exactly one source cell regardless of repeat count', () => {
    withRect()
    const gridId = createRepeatGridFromSelection()!
    setRepeatGridParams(gridId, { rows: 5, columns: 6 })

    const grid = getDoc().nodes[gridId]!
    expect(grid.type).toBe('repeat-grid')
    // 30 visible cells, one stored child — that is the whole point of the model.
    if (grid.type === 'repeat-grid') {
      expect(grid.children).toHaveLength(1)
      expect(repeatGridOffsets(grid)).toHaveLength(30)
    }
  })

  it('grows its own box as repeats are added', () => {
    withRect()
    const gridId = createRepeatGridFromSelection()!
    const before = getDoc().nodes[gridId]!.transform.width
    setRepeatGridParams(gridId, { columns: 3, gutterX: 10 })
    const after = getDoc().nodes[gridId]!.transform.width
    expect(after).toBeCloseTo(before * 3 + 20, 4)
  })

  it('refuses to nest a grid inside itself', () => {
    withRect()
    const gridId = createRepeatGridFromSelection()!
    setSelection([gridId])
    expect(createRepeatGridFromSelection()).toBeNull()
  })

  it('expands into one independent object per cell', () => {
    withRect()
    const gridId = createRepeatGridFromSelection()!
    setRepeatGridParams(gridId, { rows: 2, columns: 3 })

    const groupId = expandRepeatGrid(gridId)!
    expect(groupId).toBeTruthy()
    const doc = getDoc()
    expect(doc.nodes[gridId]).toBeUndefined()

    const group = doc.nodes[groupId]!
    expect(group.type).toBe('group')
    if ('children' in group) {
      expect(group.children).toHaveLength(6)
      // Independent: each copy is its own node, so they can now diverge.
      expect(new Set(group.children).size).toBe(6)
    }
  })

  it('places expanded copies at the cell offsets', () => {
    withRect()
    const gridId = createRepeatGridFromSelection()!
    setRepeatGridParams(gridId, { columns: 2, gutterX: 10 })
    const groupId = expandRepeatGrid(gridId)!

    const doc = getDoc()
    const group = doc.nodes[groupId]!
    if ('children' in group) {
      const xs = group.children.map((id) => geometryBounds(doc, id).x).sort((a, b) => a - b)
      expect(xs[1]! - xs[0]!).toBeCloseTo(110, 4)
    }
  })

  it('survives save and reload with its parameters intact', () => {
    withRect()
    const gridId = createRepeatGridFromSelection()!
    setRepeatGridParams(gridId, { rows: 3, columns: 4, gutterX: 7, gutterY: 9 })

    const back = deserializeDocument(serializeDocument(getDoc()))
    const grid = back.nodes[gridId]!
    expect(grid.type).toBe('repeat-grid')
    if (grid.type === 'repeat-grid') {
      expect(grid.rows).toBe(3)
      expect(grid.columns).toBe(4)
      expect(grid.gutterX).toBe(7)
      expect(grid.gutterY).toBe(9)
      expect(grid.children).toHaveLength(1)
    }
  })
})

describe('matchSize', () => {
  beforeEach(() => replaceDocument(createDocument('M', false)))

  function three() {
    const a = createRect({ x: 0, y: 0, width: 40, height: 20 })
    const b = createRect({ x: 100, y: 0, width: 90, height: 60 })
    const c = createRect({ x: 300, y: 0, width: 10, height: 35 })
    transaction('add', (d) => {
      addNode(d, a, d.rootId); addNode(d, b, d.rootId); addNode(d, c, d.rootId)
    })
    setSelection([a.id, b.id, c.id])
    return [a, b, c]
  }

  it('matches every object to the widest', () => {
    const [a, b, c] = three()
    expect(matchSize('width')).toBe(true)
    const doc = getDoc()
    for (const n of [a, b, c]) expect(doc.nodes[n!.id]!.transform.width).toBeCloseTo(90, 4)
    // Height untouched.
    expect(doc.nodes[a!.id]!.transform.height).toBeCloseTo(20, 4)
  })

  it('matches height independently', () => {
    const [a, , c] = three()
    matchSize('height')
    const doc = getDoc()
    expect(doc.nodes[a!.id]!.transform.height).toBeCloseTo(60, 4)
    expect(doc.nodes[c!.id]!.transform.width).toBeCloseTo(10, 4)
  })

  it('is idempotent — pressing twice changes nothing', () => {
    three()
    matchSize('both')
    const first = Object.values(getDoc().nodes).map((n) => `${n.transform.width}x${n.transform.height}`)
    matchSize('both')
    const second = Object.values(getDoc().nodes).map((n) => `${n.transform.width}x${n.transform.height}`)
    expect(second).toEqual(first)
  })

  it('needs at least two objects', () => {
    const [a] = three()
    setSelection([a!.id])
    expect(matchSize('both')).toBe(false)
  })

  it('measures effective size, so a rotated object does not grow itself', () => {
    const a = createRect({ x: 0, y: 0, width: 100, height: 40, rotation: 45 })
    const b = createRect({ x: 300, y: 0, width: 50, height: 40 })
    transaction('add', (d) => { addNode(d, a, d.rootId); addNode(d, b, d.rootId) })
    setSelection([a.id, b.id])
    matchSize('width')
    // The rotated node's world AABB is ~99 wide, but its OWN width is 100 —
    // using the AABB here would inflate it on every press.
    expect(getDoc().nodes[a.id]!.transform.width).toBeCloseTo(100, 4)
    expect(getDoc().nodes[b.id]!.transform.width).toBeCloseTo(100, 4)
  })
})
