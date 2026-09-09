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
 * Document model, persistence and history. Runs in plain node — everything under
 * test here is deliberately DOM-free.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { serializeDocument, deserializeDocument, DocumentFormatError, dataUrlToBytes, bytesToDataUrl } from '@/persistence/FileFormat'
import { createDocument, createRect, createEllipse, createPolygon, createImage, createText, createLinearGradient, createStop, createGroup, createLine } from '@/document/NodeFactory'
import {
  addNode, bringForward, bringToFront, cloneSubtree, duplicateNodes, groupNodes, removeNode,
  sendBackward, sendToBack, alignNodes, distributeNodes, reparentNode,
} from '@/document/DocumentModel'
import { geometryBounds, isEffectivelyLocked, isEffectivelyVisible, hitTest, hitTestNode, nodesInBounds, descendantIds, artboardOf } from '@/document/SceneGraph'
import { getDoc, replaceDocument, transaction, undo, redo, documentStore } from '@/state/DocumentStore'
import type { DesignDocument } from '@/document/types'

const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAEUlEQVR4nGO4o6GBFTEMpAQAngY4QZX0zKMAAAAASUVORK5CYII='

function docWith(build: (d: DesignDocument) => void): DesignDocument {
  const doc = createDocument('Test', false)
  build(doc)
  return doc
}

describe('file format round trip', () => {
  it('produces a zip container, not base64-in-json', () => {
    const bytes = serializeDocument(createDocument('Doc'))
    expect(bytes[0]).toBe(0x50) // 'P'
    expect(bytes[1]).toBe(0x4b) // 'K'
  })

  it('round-trips nodes, transforms and styles', () => {
    const doc = docWith((d) => {
      const rect = createRect({ x: 12, y: 34, width: 200, height: 100, rotation: 22, scaleX: -1 })
      rect.style.fill = { type: 'solid', color: { r: 10, g: 20, b: 30, a: 0.5 } }
      rect.style.stroke = { ...rect.style.stroke, width: 3.5, cap: 'round', dashArray: [4, 2] }
      rect.cornerRadius = [1, 2, 3, 4]
      addNode(d, rect, d.rootId)
    })
    const back = deserializeDocument(serializeDocument(doc))
    const rect = Object.values(back.nodes).find((n) => n.type === 'rect')!
    expect(rect.transform).toMatchObject({ x: 12, y: 34, width: 200, height: 100, rotation: 22, scaleX: -1 })
    expect(rect.type === 'rect' && rect.cornerRadius).toEqual([1, 2, 3, 4])
    if ('style' in rect) {
      expect(rect.style.fill).toEqual({ type: 'solid', color: { r: 10, g: 20, b: 30, a: 0.5 } })
      expect(rect.style.stroke.dashArray).toEqual([4, 2])
      expect(rect.style.stroke.cap).toBe('round')
    }
  })

  it('round-trips an angular gradient exactly, stop ids and order included', () => {
    const angular = {
      type: 'angular' as const,
      cx: 0.4,
      cy: 0.6,
      rotation: 135,
      stops: [
        createStop(0, { r: 255, g: 0, b: 0, a: 1 }),
        createStop(0.5, { r: 0, g: 255, b: 0, a: 0.25 }),
        createStop(1, { r: 0, g: 0, b: 255, a: 1 }),
      ],
    }
    const doc = docWith((d) => {
      const rect = createRect({ width: 50, height: 50 })
      rect.style.fill = angular
      addNode(d, rect, d.rootId)
    })
    const back = deserializeDocument(serializeDocument(doc))
    const rect = Object.values(back.nodes).find((n) => n.type === 'rect')!
    expect('style' in rect && rect.style.fill).toEqual(angular)
  })

  it('round-trips gradients exactly', () => {
    const gradient = createLinearGradient([
      createStop(0, { r: 255, g: 0, b: 0, a: 1 }),
      createStop(0.35, { r: 0, g: 255, b: 0, a: 0.5 }),
      createStop(1, { r: 0, g: 0, b: 255, a: 1 }),
    ])
    const doc = docWith((d) => {
      const rect = createRect({ width: 50, height: 50 })
      rect.style.fill = gradient
      addNode(d, rect, d.rootId)
    })
    const back = deserializeDocument(serializeDocument(doc))
    const rect = Object.values(back.nodes).find((n) => n.type === 'rect')!
    expect('style' in rect && rect.style.fill).toEqual(gradient)
  })

  it('round-trips image assets as real bytes', () => {
    const doc = docWith((d) => {
      d.assets.a1 = { id: 'a1', name: 'pic', mimeType: 'image/png', width: 8, height: 6, byteSize: 74, dataUrl: PNG_DATA_URL }
      addNode(d, createImage('a1', 'pic', { width: 8, height: 6 }), d.rootId)
    })
    const back = deserializeDocument(serializeDocument(doc))
    // The pixels travel inside the file, so the document survives the original
    // file being deleted or moved to another machine.
    expect(back.assets.a1!.dataUrl).toBe(PNG_DATA_URL)
    expect(back.assets.a1!.mimeType).toBe('image/png')
  })

  it('reads flat JSON as well as zip', () => {
    const doc = docWith((d) => { addNode(d, createRect({ width: 10, height: 10 }), d.rootId) })
    const json = serializeDocument(doc, { plainJson: true })
    expect(json[0]).not.toBe(0x50)
    const back = deserializeDocument(json)
    expect(Object.values(back.nodes).some((n) => n.type === 'rect')).toBe(true)
  })

  it('round-trips settings', () => {
    const doc = docWith((d) => {
      d.settings = { ...d.settings, gridSize: 16, gridVisible: true, snapToGrid: true }
    })
    const back = deserializeDocument(serializeDocument(doc))
    expect(back.settings.gridSize).toBe(16)
    expect(back.settings.snapToGrid).toBe(true)
  })

  it('rejects foreign and corrupt files with a clear message', () => {
    expect(() => deserializeDocument(new TextEncoder().encode('{"format":"Other"}'))).toThrow(DocumentFormatError)
    expect(() => deserializeDocument(new TextEncoder().encode('not json'))).toThrow(DocumentFormatError)
  })

  it('repairs a dangling parent rather than failing to open', () => {
    const doc = docWith((d) => { addNode(d, createRect({ width: 10, height: 10 }), d.rootId) })
    const rect = Object.values(doc.nodes).find((n) => n.type === 'rect')!
    rect.parentId = 'does-not-exist'
    const root = doc.nodes[doc.rootId]!
    if ('children' in root) root.children = []
    // Losing an afternoon's work to one bad reference is not acceptable.
    const back = deserializeDocument(serializeDocument(doc))
    expect(Object.values(back.nodes).some((n) => n.type === 'rect')).toBe(true)
    const backRoot = back.nodes[back.rootId]!
    expect('children' in backRoot && backRoot.children).toContain(rect.id)
  })

  it('converts data URLs to bytes and back', () => {
    const bytes = dataUrlToBytes(PNG_DATA_URL)!
    expect(bytes.length).toBeGreaterThan(50)
    expect(bytesToDataUrl(bytes, 'image/png')).toBe(PNG_DATA_URL)
  })
})

describe('history', () => {
  beforeEach(() => replaceDocument(createDocument('H', false)))

  it('undoes and redoes a change', () => {
    const rect = createRect({ width: 10, height: 10 })
    transaction('add', (d) => { addNode(d, rect, d.rootId) })
    expect(getDoc().nodes[rect.id]).toBeTruthy()
    expect(undo()).toBe(true)
    expect(getDoc().nodes[rect.id]).toBeUndefined()
    expect(redo()).toBe(true)
    expect(getDoc().nodes[rect.id]).toBeTruthy()
  })

  it('collapses a coalesced run into one undo step', () => {
    const rect = createRect({ width: 10, height: 10 })
    transaction('add', (d) => { addNode(d, rect, d.rootId) })
    // A drag or a held arrow key produces many mutations under one key.
    for (let i = 1; i <= 20; i++) {
      transaction('move', (d) => { d.nodes[rect.id]!.transform.x = i }, { coalesceKey: 'nudge' })
    }
    expect(getDoc().nodes[rect.id]!.transform.x).toBe(20)
    undo()
    expect(getDoc().nodes[rect.id]!.transform.x).toBe(0)
    expect(getDoc().nodes[rect.id]).toBeTruthy()
  })

  it('reports nothing to undo on an empty stack', () => {
    expect(undo()).toBe(false)
    expect(documentStore.getState().history.canUndo).toBe(false)
  })

  it('drops the redo stack after a new change', () => {
    const rect = createRect({ width: 10, height: 10 })
    transaction('add', (d) => { addNode(d, rect, d.rootId) })
    undo()
    expect(documentStore.getState().history.canRedo).toBe(true)
    transaction('other', (d) => { addNode(d, createEllipse({ width: 5, height: 5 }), d.rootId) })
    expect(documentStore.getState().history.canRedo).toBe(false)
  })

  it('aborts a transaction that reports no work', () => {
    const before = documentStore.getState().version
    expect(transaction('noop', () => false)).toBe(false)
    expect(documentStore.getState().version).toBe(before)
  })
})

describe('layer ordering', () => {
  it('moves nodes through the stack', () => {
    const doc = createDocument('Z', false)
    const a = createRect({ width: 10, height: 10 })
    const b = createRect({ width: 10, height: 10 })
    const c = createRect({ width: 10, height: 10 })
    addNode(doc, a, doc.rootId); addNode(doc, b, doc.rootId); addNode(doc, c, doc.rootId)
    const order = () => (doc.nodes[doc.rootId] as { children: string[] }).children

    expect(order()).toEqual([a.id, b.id, c.id])
    bringToFront(doc, [a.id]); expect(order()).toEqual([b.id, c.id, a.id])
    sendToBack(doc, [a.id]); expect(order()).toEqual([a.id, b.id, c.id])
    bringForward(doc, [a.id]); expect(order()).toEqual([b.id, a.id, c.id])
    sendBackward(doc, [a.id]); expect(order()).toEqual([a.id, b.id, c.id])
  })

  it('does not move a node already at the end', () => {
    const doc = createDocument('Z', false)
    const a = createRect({ width: 10, height: 10 })
    addNode(doc, a, doc.rootId)
    bringForward(doc, [a.id])
    expect((doc.nodes[doc.rootId] as { children: string[] }).children).toEqual([a.id])
  })
})

describe('grouping and hierarchy', () => {
  it('deletes a whole subtree', () => {
    const doc = createDocument('G', false)
    const a = createRect({ width: 10, height: 10 })
    const b = createRect({ width: 10, height: 10 })
    addNode(doc, a, doc.rootId); addNode(doc, b, doc.rootId)
    const groupId = groupNodes(doc, [a.id, b.id])!
    expect(descendantIds(doc, groupId)).toHaveLength(2)
    removeNode(doc, groupId)
    expect(doc.nodes[a.id]).toBeUndefined()
    expect(doc.nodes[b.id]).toBeUndefined()
  })

  it('refuses to reparent a node into its own subtree', () => {
    const doc = createDocument('G', false)
    const a = createRect({ width: 10, height: 10 })
    addNode(doc, a, doc.rootId)
    const groupId = groupNodes(doc, [a.id])!
    reparentNode(doc, groupId, a.id)
    expect(doc.nodes[groupId]!.parentId).toBe(doc.rootId)
  })

  it('duplicates a subtree with fresh ids', () => {
    const doc = createDocument('G', false)
    const a = createRect({ width: 10, height: 10 })
    addNode(doc, a, doc.rootId)
    const groupId = groupNodes(doc, [a.id])!
    const [copy] = duplicateNodes(doc, [groupId])
    expect(copy).toBeTruthy()
    expect(copy).not.toBe(groupId)
    expect(descendantIds(doc, copy!)).toHaveLength(1)
    expect(descendantIds(doc, copy!)[0]).not.toBe(a.id)
  })

  it('reports effective visibility and lock through ancestors', () => {
    const doc = createDocument('G', false)
    const a = createRect({ width: 10, height: 10 })
    addNode(doc, a, doc.rootId)
    const groupId = groupNodes(doc, [a.id])!
    doc.nodes[groupId]!.visible = false
    expect(isEffectivelyVisible(doc, a.id)).toBe(false)
    doc.nodes[groupId]!.visible = true
    doc.nodes[groupId]!.locked = true
    expect(isEffectivelyLocked(doc, a.id)).toBe(true)
  })

  it('finds the artboard an object belongs to', () => {
    const doc = createDocument('A', true)
    const boardId = Object.values(doc.nodes).find((n) => n.type === 'artboard')!.id
    const rect = createRect({ width: 10, height: 10 })
    addNode(doc, rect, boardId)
    expect(artboardOf(doc, rect.id)).toBe(boardId)
  })
})

describe('alignment and distribution', () => {
  it('aligns left edges exactly', () => {
    const doc = createDocument('A', false)
    const a = createRect({ x: 10, y: 0, width: 50, height: 20 })
    const b = createRect({ x: 100, y: 40, width: 30, height: 20 })
    addNode(doc, a, doc.rootId); addNode(doc, b, doc.rootId)
    alignNodes(doc, [a.id, b.id], 'left')
    expect(geometryBounds(doc, a.id).x).toBeCloseTo(10, 6)
    expect(geometryBounds(doc, b.id).x).toBeCloseTo(10, 6)
  })

  it('distributes by equal gaps, not equal centers', () => {
    const doc = createDocument('D', false)
    // Different widths: equal centers and equal gaps give different answers.
    const a = createRect({ x: 0, y: 0, width: 10, height: 10 })
    const b = createRect({ x: 40, y: 0, width: 50, height: 10 })
    const c = createRect({ x: 200, y: 0, width: 20, height: 10 })
    addNode(doc, a, doc.rootId); addNode(doc, b, doc.rootId); addNode(doc, c, doc.rootId)
    distributeNodes(doc, [a.id, b.id, c.id], 'horizontal')

    const ba = geometryBounds(doc, a.id)
    const bb = geometryBounds(doc, b.id)
    const bc = geometryBounds(doc, c.id)
    const gap1 = bb.x - (ba.x + ba.width)
    const gap2 = bc.x - (bb.x + bb.width)
    expect(gap1).toBeCloseTo(gap2, 6)
    // Outermost items never move.
    expect(ba.x).toBeCloseTo(0, 6)
    expect(bc.x + bc.width).toBeCloseTo(220, 6)
  })
})

describe('hit testing', () => {
  it('picks the topmost node under a point', () => {
    const doc = createDocument('H', false)
    const under = createRect({ x: 0, y: 0, width: 100, height: 100 })
    const over = createRect({ x: 20, y: 20, width: 40, height: 40 })
    addNode(doc, under, doc.rootId); addNode(doc, over, doc.rootId)
    expect(hitTest(doc, { x: 30, y: 30 })).toBe(over.id)
    expect(hitTest(doc, { x: 5, y: 5 })).toBe(under.id)
    expect(hitTest(doc, { x: 500, y: 500 })).toBeNull()
  })

  it('respects rotation when hit testing', () => {
    const doc = createDocument('H', false)
    const rect = createRect({ x: 0, y: 0, width: 100, height: 20, rotation: 90 })
    addNode(doc, rect, doc.rootId)
    // Rotated 90 about its centre: the bar now runs vertically through it.
    const centre = geometryBounds(doc, rect.id)
    const cx = centre.x + centre.width / 2
    const cy = centre.y + centre.height / 2
    expect(hitTest(doc, { x: cx, y: cy })).toBe(rect.id)
    expect(hitTest(doc, { x: cx + 200, y: cy })).toBeNull()
  })

  it('ignores hidden nodes', () => {
    const doc = createDocument('H', false)
    const rect = createRect({ x: 0, y: 0, width: 100, height: 100 })
    addNode(doc, rect, doc.rootId)
    rect.visible = false
    expect(hitTest(doc, { x: 50, y: 50 })).toBeNull()
  })

  it('marquee requires full containment unless crossing', () => {
    const doc = createDocument('H', false)
    const inside = createRect({ x: 10, y: 10, width: 20, height: 20 })
    const straddling = createRect({ x: 90, y: 10, width: 60, height: 20 })
    addNode(doc, inside, doc.rootId); addNode(doc, straddling, doc.rootId)
    const box = { x: 0, y: 0, width: 100, height: 100 }
    expect(nodesInBounds(doc, box)).toEqual([inside.id])
    expect(nodesInBounds(doc, box, { crossing: true })).toContain(straddling.id)
  })
})

describe('node factory', () => {
  it('creates fully populated nodes', () => {
    const star = createPolygon({ width: 10, height: 10 }, {}, 7, 0.4)
    expect(star.sides).toBe(7)
    expect(star.starRatio).toBe(0.4)
    expect(star.name).toBe('Star')
    expect(star.style.fill.type).toBe('solid')
    expect(star.transform.originX).toBe(0.5)
    expect(star.visible).toBe(true)
    expect(star.markedForExport).toBe(false)
  })

  it('gives text a sensible default style', () => {
    const text = createText('Hello')
    expect(text.text).toBe('Hello')
    expect(text.textStyle.fontSize).toBeGreaterThan(0)
    expect(text.style.fill.type).toBe('solid')
  })
})

describe('cloning a mask group', () => {
  it('re-points maskId at the copy, not the original', () => {
    const doc = createDocument('Clone', false)
    const shape = createRect({ x: 0, y: 0, width: 10, height: 10 })
    const mask = createRect({ x: 0, y: 0, width: 8, height: 8 })
    const group = createGroup([shape.id, mask.id], { x: 0, y: 0, width: 10, height: 10 })
    group.maskId = mask.id
    for (const n of [shape, mask]) n.parentId = group.id
    group.parentId = doc.rootId
    doc.nodes[shape.id] = shape
    doc.nodes[mask.id] = mask
    doc.nodes[group.id] = group
    ;(doc.nodes[doc.rootId] as { children: string[] }).children.push(group.id)

    const copyId = cloneSubtree(doc, group.id)!
    const copy = doc.nodes[copyId] as typeof group

    expect(copy.maskId).toBeTruthy()
    // Sharing the original's mask meant deleting one group broke the other.
    expect(copy.maskId).not.toBe(mask.id)
    expect(copy.children).toContain(copy.maskId)
  })
})

describe('how big a click target is', () => {
  /**
   * The tolerance a caller passes is in WORLD units — screen pixels divided by
   * the zoom — but every distance it is compared against is in the node's own
   * local space. Under a scaled node those are different distances, so the
   * conversion is what keeps a click target the same size on screen wherever
   * the object sits and however far in the view is zoomed.
   */
  function scaledLine(scale: number) {
    replaceDocument(createDocument('Hit', false))
    const group = createGroup([], { x: 0, y: 0, width: 100, height: 100 })
    group.transform = { ...group.transform, scaleX: scale, scaleY: scale }
    const line = createLine({ x: 0, y: 0, width: 100, height: 0 })
    transaction('seed', (draft) => {
      addNode(draft, group, draft.rootId)
      addNode(draft, line, group.id)
    })
    return { line: line.id }
  }

  it('keeps the target the same world size however the node is scaled', () => {
    for (const scale of [0.2, 1, 5]) {
      const { line } = scaledLine(scale)
      const doc = getDoc()
      // Where the line actually ended up: a group scales about its own centre,
      // so its children do not simply multiply out from the origin.
      const box = geometryBounds(doc, line)
      const mid = { x: box.x + box.width / 2, y: box.y + box.height / 2 }

      // Four world units off the line, with five world units of slack: a hit at
      // every scale, because five world units is five world units.
      expect(hitTestNode(doc, line, { x: mid.x, y: mid.y + 4 }, { tolerance: 5 }), `scale ${scale}`)
        .toBe(true)

      // Forty world units off is a miss at every scale. Compared in local units
      // instead, a scale of 5 would have made this eight local units away
      // against five local of slack — which is how a line came to be selectable
      // from an inch away once anything above it was scaled up.
      expect(hitTestNode(doc, line, { x: mid.x, y: mid.y + 40 }, { tolerance: 5 }), `scale ${scale}`)
        .toBe(false)
    }
  })

  it('still finds a hairline when the caller asks for no slack at all', () => {
    const { line } = scaledLine(1)
    const box = geometryBounds(getDoc(), line)
    expect(hitTestNode(getDoc(), line, { x: box.x + box.width / 2, y: box.y }, {})).toBe(true)
  })
})
