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
 * Point-level path editing.
 *
 * The interesting cases are all multi-subpath: a boolean-subtract donut is two
 * rings in one node, and a selected point used to be stored as a bare index with
 * no ring attached — so Delete removed that index from EVERY ring at once.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  beginPathEditing, endPathEditing, getEditingSubpaths, isPointEditable,
  pathEditDoubleClick, pathEditExtendAt, pathEditKeyDown, pathEditPointerDown,
  pathEditPointerMove, pathEditPointerUp, syncPathEditing,
} from '@/tools/PathEditing'
import {
  createDocument, createImage, createLine, createPath, createPolygon,
  createRect, createText,
} from '@/document/NodeFactory'
import { liveTransform } from '@/canvas/LiveTransform'
import { geomKey } from '@/canvas/NodeRenderer'
import { addNode } from '@/document/DocumentModel'
import { replaceDocument, getDoc, undo } from '@/state/DocumentStore'
import { setEditor, editorStore } from '@/state/EditorStore'
import { isSmooth } from '@/geometry/PathPoints'
import type { CanvasPointerEvent, ToolContext } from '@/tools/types'
import type { DesignNode, PathNode } from '@/document/types'

const ctx: ToolContext = {
  doc: () => getDoc(),
  editor: () => editorStore.getState(),
  viewport: () => ({ x: 0, y: 0, zoom: 1 }),
  screenToDoc: (p) => p,
  docToScreen: (p) => p,
  tolerance: () => 4,
  refreshOverlay: () => {},
}

function ev(x: number, y: number, mods: Partial<CanvasPointerEvent> = {}): CanvasPointerEvent {
  return {
    screen: { x, y }, doc: { x, y }, deltaScreen: { x: 0, y: 0 },
    shiftKey: false, altKey: false, metaKey: false, ctrlKey: false, primaryModifier: false,
    button: 0, buttons: 1, pointerId: 1,
    targetNodeId: null, targetHandle: null, targetCorner: null,
    native: {} as PointerEvent, ...mods,
  }
}

const key = (k: string) => ({ key: k }) as KeyboardEvent

/** A donut: an outer square with a square hole, as a boolean subtract produces. */
const DONUT = 'M0 0 L100 0 L100 100 L0 100 Z M25 25 L75 25 L75 75 L25 75 Z'

function openPath(d: string): PathNode {
  return openShape(createPath(d, { x: 0, y: 0, width: 100, height: 100 })) as PathNode
}

/** Put any node in a fresh document and open point editing on it. */
function openShape<T extends DesignNode>(node: T): T {
  const doc = createDocument('P', false)
  addNode(doc, node, doc.rootId)
  replaceDocument(doc)
  setEditor({ nodeEditingId: node.id, selectedPoints: [] })
  beginPathEditing(node.id)
  return node
}

/** Drag the point nearest `from` to `to`, through the real handlers. */
function dragPoint(from: {x: number, y: number}, to: {x: number, y: number}) {
  expect(pathEditPointerDown(ev(from.x, from.y), ctx)).toBe(true)
  pathEditPointerMove(ev(to.x, to.y), ctx)
  pathEditPointerUp()
}

const currentNode = () => getDoc().nodes[editorStore.getState().nodeEditingId!]!

beforeEach(() => {
  endPathEditing()
  setEditor({ nodeEditingId: null, selectedPoints: [] })
})

describe('path point editing', () => {
  it('deletes a point from only the ring it belongs to', () => {
    openPath(DONUT)
    const before = getEditingSubpaths()!.subs.map((s) => s.points.length)
    expect(before).toEqual([4, 4])

    // Grab a point on the OUTER ring and delete it.
    expect(pathEditPointerDown(ev(100, 0), ctx)).toBe(true)
    expect(editorStore.getState().selectedPoints[0]!.subpath).toBe(0)
    expect(pathEditKeyDown(key('Delete'))).toBe(true)

    const after = getEditingSubpaths()!.subs.map((s) => s.points.length)
    expect(after).toEqual([3, 4])
  })

  it('never deletes a ring down to nothing', () => {
    openPath('M0 0 L100 0 L100 100 Z')
    for (let i = 0; i < 5; i++) {
      pathEditPointerDown(ev(0, 0), ctx)
      pathEditKeyDown(key('Delete'))
      pathEditPointerDown(ev(100, 0), ctx)
      pathEditKeyDown(key('Delete'))
    }
    // Two points is the floor: an empty subpath would serialise to nothing.
    expect(getEditingSubpaths()!.subs[0]!.points.length).toBeGreaterThanOrEqual(2)
  })

  it('selects a handle, and Delete removes just that handle', () => {
    openPath('M0 0 C 20 40 60 40 80 0')
    const sub = () => getEditingSubpaths()!.subs[0]!
    expect(sub().points[1]!.inX).not.toBeNull()

    // The incoming handle of the second anchor sits at (60,40).
    expect(pathEditPointerDown(ev(60, 40), ctx)).toBe(true)
    expect(editorStore.getState().selectedPoints[0]!.kind).toBe('in')
    pathEditKeyDown(key('Delete'))
    expect(sub().points[1]!.inX).toBeNull()
    // The anchor itself survives.
    expect(sub().points).toHaveLength(2)
  })

  it('double-clicking a corner rounds it, and clicking it again straightens it', () => {
    // The pair every vector editor has: one gesture and its opposite, rather
    // than one gesture that does different things depending on what it lands on.
    openPath('M0 0 L100 0 L100 100 Z')
    const sub = () => getEditingSubpaths()!.subs[0]!
    expect(isSmooth(sub().points[1]!)).toBe(false)

    expect(pathEditDoubleClick(ev(100, 0), ctx)).toBe(true)
    expect(isSmooth(sub().points[1]!)).toBe(true)

    // A second double-click has nothing to do: it only ever rounds.
    expect(pathEditDoubleClick(ev(100, 0), ctx)).toBe(false)
    expect(isSmooth(sub().points[1]!)).toBe(true)

    // A press that goes nowhere straightens it again.
    pathEditPointerDown(ev(100, 0), ctx)
    pathEditPointerUp()
    expect(isSmooth(sub().points[1]!)).toBe(false)
  })

  it('does not straighten a point that was dragged', () => {
    openPath('M0 0 L100 0 L100 100 Z')
    const sub = () => getEditingSubpaths()!.subs[0]!
    pathEditDoubleClick(ev(100, 0), ctx)
    expect(isSmooth(sub().points[1]!)).toBe(true)

    // Picked up and moved: that is a move, not a click.
    pathEditPointerDown(ev(100, 0), ctx)
    pathEditPointerMove(ev(120, 10, { buttons: 1 }), ctx)
    pathEditPointerUp()
    expect(isSmooth(sub().points[1]!)).toBe(true)
  })

  it('Alt-click still converts, as it did before', () => {
    openPath('M0 0 L100 0 L100 100 Z')
    const sub = () => getEditingSubpaths()!.subs[0]!
    pathEditPointerDown(ev(100, 0, { altKey: true }), ctx)
    expect(isSmooth(sub().points[1]!)).toBe(true)
  })

  it('extends an open path from its end instead of starting a new one', () => {
    const node = openPath('M0 0 L100 0 L100 100')
    expect(pathEditExtendAt(ev(100, 100), ctx)).toBe(true)
    expect(getEditingSubpaths()!.subs[0]!.points).toHaveLength(4)
    // Same node — not a second path that happens to touch the first.
    expect(Object.values(getDoc().nodes).filter((n) => n.type === 'path')).toHaveLength(1)
    expect(getDoc().nodes[node.id]).toBeDefined()
  })

  it('extends from the head as well as the tail', () => {
    openPath('M20 20 L100 20 L100 100')
    expect(pathEditExtendAt(ev(20, 20), ctx)).toBe(true)
    const pts = getEditingSubpaths()!.subs[0]!.points
    expect(pts).toHaveLength(4)
    expect(pts[0]!.x).toBeCloseTo(20, 6)
  })

  it('does not extend a closed path', () => {
    openPath('M0 0 L100 0 L100 100 Z')
    expect(pathEditExtendAt(ev(0, 0), ctx)).toBe(false)
  })

  it('inserts a point on the outline only when the caller asks for it', () => {
    // The Pen asks; Direct Selection does not, because adding an anchor to
    // every attempt to move an edge is how the tool for adjusting a shape
    // became the one most likely to add to it by accident.
    openPath('M0 0 L100 0 L100 100')
    expect(pathEditPointerDown(ev(50, 0), ctx, { insertOnSegment: true })).toBe(true)
    expect(getEditingSubpaths()!.subs[0]!.points).toHaveLength(4)
    // Armed for the drag that follows, rather than needing a second gesture.
    expect(editorStore.getState().selectedPoints[0]!.kind).toBe('anchor')
  })

  it('selects the segment instead of adding to it', () => {
    openPath('M0 0 L100 0 L100 100')
    expect(pathEditPointerDown(ev(50, 0), ctx)).toBe(true)
    expect(getEditingSubpaths()!.subs[0]!.points).toHaveLength(3)
    expect(editorStore.getState().selectedSegments).toEqual([{ subpath: 0, index: 0 }])
  })
})

// ---------------------------------------------------------------------------
// Selecting more than one thing
// ---------------------------------------------------------------------------

describe('multiple points and segments', () => {
  it('adds and removes points with shift', () => {
    openPath('M0 0 L100 0 L100 100')
    pathEditPointerDown(ev(0, 0), ctx)
    pathEditPointerUp()
    pathEditPointerDown(ev(100, 0, { shiftKey: true }), ctx)
    expect(editorStore.getState().selectedPoints).toHaveLength(2)

    // Shift again takes it back out.
    pathEditPointerDown(ev(100, 0, { shiftKey: true }), ctx)
    expect(editorStore.getState().selectedPoints).toHaveLength(1)
  })

  it('moves every selected point by the same delta', () => {
    openPath('M0 0 L100 0 L100 100')
    const sub = () => getEditingSubpaths()!.subs[0]!
    pathEditPointerDown(ev(0, 0), ctx)
    pathEditPointerUp()
    pathEditPointerDown(ev(100, 0, { shiftKey: true }), ctx)

    // Drag from one of them; both follow.
    pathEditPointerDown(ev(100, 0), ctx)
    pathEditPointerMove(ev(110, 20, { buttons: 1 }), ctx)
    pathEditPointerUp()

    expect(sub().points[0]!.x).toBeCloseTo(10, 4)
    expect(sub().points[0]!.y).toBeCloseTo(20, 4)
    expect(sub().points[1]!.x).toBeCloseTo(110, 4)
    expect(sub().points[1]!.y).toBeCloseTo(20, 4)
    // The one nobody selected stayed where it was.
    expect(sub().points[2]!.x).toBeCloseTo(100, 4)
    expect(sub().points[2]!.y).toBeCloseTo(100, 4)
  })

  it('moves a whole segment, both ends together', () => {
    openPath('M0 0 L100 0 L100 100')
    const sub = () => getEditingSubpaths()!.subs[0]!
    pathEditPointerDown(ev(50, 0), ctx)
    pathEditPointerMove(ev(50, 30, { buttons: 1 }), ctx)
    pathEditPointerUp()

    expect(sub().points[0]!.y).toBeCloseTo(30, 4)
    expect(sub().points[1]!.y).toBeCloseTo(30, 4)
    // The far end of the other segment did not come along.
    expect(sub().points[2]!.y).toBeCloseTo(100, 4)
  })

  it('collects segments with shift and moves them together', () => {
    openPath('M0 0 L100 0 L100 100')
    const sub = () => getEditingSubpaths()!.subs[0]!
    pathEditPointerDown(ev(50, 0), ctx)
    pathEditPointerUp()
    pathEditPointerDown(ev(100, 50, { shiftKey: true }), ctx)
    expect(editorStore.getState().selectedSegments).toHaveLength(2)

    pathEditPointerDown(ev(50, 0), ctx)
    pathEditPointerMove(ev(60, 0, { buttons: 1 }), ctx)
    pathEditPointerUp()
    // Both segments share point 1, and every end moved once, not twice.
    expect(sub().points[0]!.x).toBeCloseTo(10, 4)
    expect(sub().points[1]!.x).toBeCloseTo(110, 4)
    expect(sub().points[2]!.x).toBeCloseTo(110, 4)
  })
})

// ---------------------------------------------------------------------------
// Live feedback while dragging
// ---------------------------------------------------------------------------

describe('live point dragging', () => {
  it('pushes the edited geometry to the DOM on every move', () => {
    const node = openPath('M0 0 L100 0 L100 100')
    // A fake element registered under the geometry key, exactly as NodeRenderer
    // registers the real fill/stroke/clip paths.
    const el = { setAttribute: (n: string, v: string) => { attrs[n] = v }, getAttribute: () => null, removeAttribute: () => {} }
    const attrs: Record<string, string> = {}
    liveTransform.register(geomKey(node.id), el as unknown as SVGElement)

    pathEditPointerDown(ev(0, 0), ctx)
    pathEditPointerMove(ev(40, 30), ctx)
    liveTransform.flush()

    // The shape follows the pointer BEFORE the mouse comes up. Without this the
    // path stayed frozen for the whole gesture and jumped on release.
    expect(attrs.d).toBeDefined()
    expect(attrs.d).toContain('M40 30')
    expect(getDoc().nodes[node.id]).toMatchObject({ d: 'M0 0 L100 0 L100 100' })

    pathEditPointerUp()
    expect((getDoc().nodes[node.id] as PathNode).d).toContain('M40 30')
    liveTransform.register(geomKey(node.id), null)
  })

  it('a button-less move abandons the drag instead of deforming the shape', () => {
    const node = openPath('M0 0 L100 0 L100 100')
    pathEditPointerDown(ev(0, 0), ctx)
    pathEditPointerMove(ev(40, 30), ctx)
    // A pointerup delivered elsewhere (a tool switch mid-gesture) leaves the
    // button up; every later move must be ignored, not applied.
    pathEditPointerMove({ ...ev(90, 90), buttons: 0 }, ctx)
    expect((getDoc().nodes[node.id] as PathNode).d).toBe('M0 0 L100 0 L100 100')
    expect(getEditingSubpaths()!.subs[0]!.points[0]).toMatchObject({ x: 0, y: 0 })
  })
})

// ---------------------------------------------------------------------------
// Any shape is point-editable; conversion happens on the first edit
// ---------------------------------------------------------------------------

describe('editing shapes that are not paths', () => {
  it('opens a line with two endpoints, a rect with four corners', () => {
    openShape(createLine({ x: 10, y: 10, width: 100, height: 60 }, {}, { x1: 0, y1: 0, x2: 100, y2: 60 }))
    let subs = getEditingSubpaths()!.subs
    expect(subs).toHaveLength(1)
    expect(subs[0]!.points).toHaveLength(2)
    expect(subs[0]!.closed).toBe(false)

    endPathEditing()
    openShape(createRect({ x: 0, y: 0, width: 100, height: 80 }))
    subs = getEditingSubpaths()!.subs
    expect(subs[0]!.points).toHaveLength(4)
    expect(subs[0]!.closed).toBe(true)

    endPathEditing()
    openShape(createPolygon({ x: 0, y: 0, width: 100, height: 100 }, {}, 6, 1))
    expect(getEditingSubpaths()!.subs[0]!.points).toHaveLength(6)
  })

  it('refuses text and images, which have no points to edit', () => {
    expect(isPointEditable(createText('hello'))).toBe(false)
    expect(isPointEditable(createImage('a1', 'Photo', { width: 10, height: 10 }))).toBe(false)
    expect(isPointEditable(createRect({ width: 10, height: 10 }))).toBe(true)
    expect(isPointEditable(createLine())).toBe(true)
  })

  it('opening a shape converts nothing', () => {
    const rect = openShape(createRect({ x: 0, y: 0, width: 100, height: 80 }))
    expect(getDoc().nodes[rect.id]!.type).toBe('rect')
    // Grab a corner and release without moving: still a rect.
    pathEditPointerDown(ev(0, 0), ctx)
    pathEditPointerUp()
    expect(getDoc().nodes[rect.id]!.type).toBe('rect')
  })

  it('the first point move converts a line to a path, keeping its identity', () => {
    const line = openShape(createLine({ x: 10, y: 10, width: 100, height: 60 }, {}, { x1: 0, y1: 0, x2: 100, y2: 60 }))
    const styleBefore = JSON.stringify(line.style)
    // Document coordinates: the line's transform puts local (0,0) at (10,10).
    dragPoint({ x: 10, y: 10 }, { x: 30, y: 50 })

    const node = currentNode()
    expect(node.type).toBe('path')
    expect(node.id).toBe(line.id)
    expect(node.name).toBe('Line')
    expect(node.parentId).toBe(line.parentId)
    expect(JSON.stringify((node as PathNode).style)).toBe(styleBefore)
    expect((node as PathNode).closed).toBe(false)
    expect('x1' in node).toBe(false)
    expect('y2' in node).toBe(false)
  })

  it('a converted rect closes its path and drops its corner radius', () => {
    const rect = openShape(createRect({ x: 0, y: 0, width: 100, height: 80 }))
    dragPoint({ x: 0, y: 0 }, { x: 25, y: 15 })
    const node = currentNode()
    expect(node.type).toBe('path')
    expect((node as PathNode).closed).toBe(true)
    expect('cornerRadius' in node).toBe(false)
    expect(node.id).toBe(rect.id)
  })

  it('a converted polygon drops its corner count and star ratio', () => {
    openShape(createPolygon({ x: 0, y: 0, width: 100, height: 100 }, {}, 5, 0.5))
    dragPoint(getEditingSubpaths()!.subs[0]!.points[0]!, { x: 60, y: 20 })
    const node = currentNode()
    expect(node.type).toBe('path')
    expect('sides' in node).toBe(false)
    expect('starRatio' in node).toBe(false)
  })

  it('undo takes the line back to being a line, and the editor follows', () => {
    const line = openShape(createLine({ x: 10, y: 10, width: 100, height: 60 }, {}, { x1: 0, y1: 0, x2: 100, y2: 60 }))
    dragPoint({ x: 10, y: 10 }, { x: 30, y: 50 })
    expect(currentNode().type).toBe('path')

    undo()
    const node = getDoc().nodes[line.id]!
    expect(node.type).toBe('line')
    expect(node).toMatchObject({ x1: 0, y1: 0, x2: 100, y2: 60 })
    // The point model reloads from the line rather than evicting the editor.
    syncPathEditing()
    expect(getEditingSubpaths()!.subs[0]!.points).toHaveLength(2)
  })

  it('extending a line from its end keeps it one node', () => {
    const line = openShape(createLine({ x: 0, y: 0, width: 100, height: 0 }, {}, { x1: 0, y1: 0, x2: 100, y2: 0 }))
    expect(pathEditExtendAt(ev(100, 0), ctx)).toBe(true)
    expect(getEditingSubpaths()!.subs[0]!.points).toHaveLength(3)
    expect(Object.values(getDoc().nodes).filter((n) => n.type === 'path')).toHaveLength(1)
    expect(getDoc().nodes[line.id]!.type).toBe('path')
  })
})
