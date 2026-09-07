/**
 * Point-level path editing.
 *
 * The interesting cases are all multi-subpath: a boolean-subtract donut is two
 * rings in one node, and a selected point used to be stored as a bare index with
 * no ring attached — so Delete removed that index from EVERY ring at once.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  beginPathEditing, endPathEditing, getEditingSubpaths, pathEditDoubleClick,
  pathEditExtendAt, pathEditKeyDown, pathEditPointerDown,
} from '@/tools/PathEditing'
import { createDocument, createPath } from '@/document/NodeFactory'
import { addNode } from '@/document/DocumentModel'
import { replaceDocument, getDoc } from '@/state/DocumentStore'
import { setEditor, editorStore } from '@/state/EditorStore'
import { isSmooth } from '@/geometry/PathPoints'
import type { CanvasPointerEvent, ToolContext } from '@/tools/types'
import type { PathNode } from '@/document/types'

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
    screen: { x, y }, doc: { x, y }, deltaDoc: { x: 0, y: 0 },
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
  const doc = createDocument('P', false)
  const node = createPath(d, { x: 0, y: 0, width: 100, height: 100 })
  addNode(doc, node, doc.rootId)
  replaceDocument(doc)
  setEditor({ nodeEditingId: node.id, selectedPoints: [] })
  beginPathEditing(node.id)
  return node
}

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

  it('double-clicking an anchor converts it corner <-> smooth', () => {
    openPath('M0 0 L100 0 L100 100 Z')
    const sub = () => getEditingSubpaths()!.subs[0]!
    expect(isSmooth(sub().points[1]!)).toBe(false)

    expect(pathEditDoubleClick(ev(100, 0), ctx)).toBe(true)
    expect(isSmooth(sub().points[1]!)).toBe(true)

    expect(pathEditDoubleClick(ev(100, 0), ctx)).toBe(true)
    expect(isSmooth(sub().points[1]!)).toBe(false)
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

  it('clicking the outline inserts a point that drags in the same gesture', () => {
    openPath('M0 0 L100 0 L100 100')
    expect(pathEditPointerDown(ev(50, 0), ctx)).toBe(true)
    expect(getEditingSubpaths()!.subs[0]!.points).toHaveLength(4)
    // Armed for the drag that follows, rather than needing a second gesture.
    expect(editorStore.getState().selectedPoints[0]!.kind).toBe('anchor')
  })
})
