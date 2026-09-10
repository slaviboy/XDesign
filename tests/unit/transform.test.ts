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

import { describe, it, expect, beforeEach } from 'vitest'
import { applyToPoint, invert, multiply, isOrthogonal, type Mat2D } from '@/geometry/Matrix'
import { transformBounds } from '@/geometry/Bounds'
import { localContentBox, localMatrix, worldMatrix, geometryBounds } from '@/document/SceneGraph'
import { resizeBoxInPlace, transformFromMatrix } from '@/document/DocumentModel'
import { createDocument, createRect, createEllipse, createPath } from '@/document/NodeFactory'
import { addNode, groupNodes, ungroupNode } from '@/document/DocumentModel'
import { replaceDocument, getDoc, transaction } from '@/state/DocumentStore'
import { setSelection } from '@/state/EditorStore'
import { maskWithShape } from '@/history/Commands'
import { beginDrag, updateDrag, commitDrag, getLiveBox, getLiveMatrix } from '@/tools/DragSession'
import { pathBounds } from '@/geometry/PathUtils'
import type { DesignDocument, DesignNode } from '@/document/types'

function freshDoc(): DesignDocument {
  const doc = createDocument('Test', false)
  return doc
}

describe('transformFromMatrix', () => {
  it('round-trips through localMatrix for a rotated, scaled node', () => {
    const t = {
      x: 40, y: 25, width: 200, height: 100, rotation: 37,
      scaleX: 1.5, scaleY: 0.8, skewX: 0, skewY: 0, originX: 0.5, originY: 0.5,
    }
    const m = localMatrix(t)
    const back = transformFromMatrix(m, t.width, t.height, t.originX, t.originY)
    expect(back.x).toBeCloseTo(t.x, 6)
    expect(back.y).toBeCloseTo(t.y, 6)
    expect(back.rotation).toBeCloseTo(t.rotation, 6)
    expect(back.scaleX).toBeCloseTo(t.scaleX, 6)
    expect(back.scaleY).toBeCloseTo(t.scaleY, 6)
  })

  it('resizes a box without moving anything drawn in it, however it is turned', () => {
    // The pivot is a fraction of the box, so a new size is a new pivot — and a
    // bare new size moved every point of a rotated path when an edit was saved.
    for (let i = 0; i < 200; i++) {
      const t = {
        x: Math.random() * 400 - 200, y: Math.random() * 400 - 200,
        width: 10 + Math.random() * 300, height: 10 + Math.random() * 300,
        rotation: Math.random() * 720 - 360,
        scaleX: 0.2 + Math.random() * 2, scaleY: 0.2 + Math.random() * 2,
        skewX: Math.random() * 40 - 20, skewY: 0, originX: Math.random(), originY: Math.random(),
      }
      const resized = resizeBoxInPlace(t, 10 + Math.random() * 300, 10 + Math.random() * 300)
      const before = localMatrix(t)
      const after = localMatrix(resized)
      for (let k = 0; k < 6; k++) expect(after[k]).toBeCloseTo(before[k]!, 6)
      // Nothing but the box and where it sits: the turn itself is untouched.
      expect(resized.rotation).toBe(t.rotation)
      expect(resized.scaleX).toBe(t.scaleX)
      expect(resized.skewX).toBe(t.skewX)
    }
  })

  it('round-trips for many random transforms', () => {
    for (let i = 0; i < 200; i++) {
      const t = {
        x: Math.random() * 400 - 200, y: Math.random() * 400 - 200,
        width: 10 + Math.random() * 300, height: 10 + Math.random() * 300,
        rotation: Math.random() * 720 - 360,
        scaleX: 0.2 + Math.random() * 2, scaleY: 0.2 + Math.random() * 2,
        skewX: 0, skewY: 0, originX: Math.random(), originY: Math.random(),
      }
      const m = localMatrix(t)
      const back = transformFromMatrix(m, t.width, t.height, t.originX, t.originY)
      const m2 = localMatrix(back)
      for (let k = 0; k < 6; k++) expect(m2[k]).toBeCloseTo(m[k], 6)
    }
  })
})

describe('resize with rotation', () => {
  beforeEach(() => {
    const doc = freshDoc()
    replaceDocument(doc)
  })

  it('does not shear a rotated rectangle (R*S != S*R regression)', () => {
    const rect = createRect({ x: 100, y: 100, width: 200, height: 100, rotation: 30 })
    transaction('add', (d) => { addNode(d, rect, d.rootId) })
    setSelection([rect.id])

    const doc = getDoc()
    const M0 = worldMatrix(doc, rect.id)
    // Grab the east handle, at local (200, 50), and drag it to local x = 320.
    const startWorld = applyToPoint(M0, { x: 200, y: 50 })
    const endWorld = applyToPoint(M0, { x: 320, y: 50 })

    expect(beginDrag(doc, [rect.id], 'resize', startWorld, 'e')).toBe(true)
    const mats = updateDrag(endWorld, { constrain: false, fromCenter: false })
    commitDrag(mats)

    const after = getDoc().nodes[rect.id]!
    // The whole point: rotation preserved, no shear introduced, width grew.
    expect(after.transform.rotation).toBeCloseTo(30, 4)
    expect(after.transform.skewX).toBeCloseTo(0, 4)
    expect(after.transform.width).toBeCloseTo(320, 3)
    expect(after.transform.height).toBeCloseTo(100, 3)
    expect(isOrthogonal(worldMatrix(getDoc(), rect.id))).toBe(true)
  })

  it('stays shear-free across many rotations and handle drags', () => {
    for (const angle of [0, 15, 30, 45, 90, 137, 210, -75]) {
      const doc0 = freshDoc()
      replaceDocument(doc0)
      const rect = createRect({ x: 0, y: 0, width: 120, height: 80, rotation: angle })
      transaction('add', (d) => { addNode(d, rect, d.rootId) })

      const doc = getDoc()
      const M0 = worldMatrix(doc, rect.id)
      const start = applyToPoint(M0, { x: 120, y: 80 })
      const end = applyToPoint(M0, { x: 200, y: 150 })

      beginDrag(doc, [rect.id], 'resize', start, 'se')
      commitDrag(updateDrag(end, { constrain: false, fromCenter: false }))

      const after = getDoc().nodes[rect.id]!
      const norm = ((after.transform.rotation % 360) + 360) % 360
      const expected = ((angle % 360) + 360) % 360
      expect(norm).toBeCloseTo(expected, 3)
      expect(Math.abs(after.transform.skewX)).toBeLessThan(1e-4)
      expect(after.transform.width).toBeCloseTo(200, 2)
      expect(after.transform.height).toBeCloseTo(150, 2)
    }
  })

  it('keeps the opposite corner pinned while resizing', () => {
    const rect = createRect({ x: 50, y: 60, width: 100, height: 100, rotation: 25 })
    transaction('add', (d) => { addNode(d, rect, d.rootId) })
    const doc = getDoc()
    const M0 = worldMatrix(doc, rect.id)
    const anchorBefore = applyToPoint(M0, { x: 0, y: 0 })

    beginDrag(doc, [rect.id], 'resize', applyToPoint(M0, { x: 100, y: 100 }), 'se')
    commitDrag(updateDrag(applyToPoint(M0, { x: 180, y: 40 }), { constrain: false, fromCenter: false }))

    const anchorAfter = applyToPoint(worldMatrix(getDoc(), rect.id), { x: 0, y: 0 })
    expect(anchorAfter.x).toBeCloseTo(anchorBefore.x, 4)
    expect(anchorAfter.y).toBeCloseTo(anchorBefore.y, 4)
  })

  it('frames a path whose geometry starts off its origin where the path is, mid-drag and after', () => {
    // A rectangle whose top-left point was dragged up and to the left, so its
    // data begins at a negative offset. The frame used to be drawn from (0,0)
    // for the whole drag, and the path was scaled about (0,0) — so the frame sat
    // a whole offset away and the pinned corner crept, until the pointer came up.
    const d = 'M-53.9714-26.111355L94.2773 0 94.2773 155.709535 0 155.709535-53.9714-26.111355Z'
    const b = pathBounds(d)
    const path = createPath(d, { x: 300, y: 200, width: b.width, height: b.height, rotation: 45.4 })
    transaction('add', (draft) => { addNode(draft, path, draft.rootId) })

    const doc = getDoc()
    const M0 = worldMatrix(doc, path.id)
    const corner = (m: typeof M0, box: typeof b, fx: number, fy: number) =>
      applyToPoint(m, { x: box.x + box.width * fx, y: box.y + box.height * fy })
    const pinned = corner(M0, b, 0, 0)
    const pointer = corner(M0, b, 1.3, 1.2)

    beginDrag(doc, [path.id], 'resize', corner(M0, b, 1, 1), 'se')
    const mats = updateDrag(pointer, { constrain: false, fromCenter: false })

    // Mid-drag: the frame's box, through the live matrix.
    const live = getLiveMatrix(path.id)!
    const box = getLiveBox(path.id)!
    expect(corner(live, box, 0, 0).x).toBeCloseTo(pinned.x, 4)
    expect(corner(live, box, 0, 0).y).toBeCloseTo(pinned.y, 4)
    expect(corner(live, box, 1, 1).x).toBeCloseTo(pointer.x, 4)
    expect(corner(live, box, 1, 1).y).toBeCloseTo(pointer.y, 4)

    // After: the path's own geometry, which is what the frame measures at rest.
    commitDrag(mats)
    const M1 = worldMatrix(getDoc(), path.id)
    const after = getDoc().nodes[path.id]!
    const drawn = after.type === 'path' ? pathBounds(after.d) : b
    expect(corner(M1, drawn, 0, 0).x).toBeCloseTo(pinned.x, 4)
    expect(corner(M1, drawn, 0, 0).y).toBeCloseTo(pinned.y, 4)
    expect(corner(M1, drawn, 1, 1).x).toBeCloseTo(pointer.x, 4)
    expect(corner(M1, drawn, 1, 1).y).toBeCloseTo(pointer.y, 4)
  })
})

describe('resizing a mask group', () => {
  const noMods = { constrain: false, fromCenter: false }
  /** A large photograph-sized rectangle, masked by `mask` placed over it. */
  function maskOver(mask: DesignNode): { group: string; photo: string } {
    replaceDocument(freshDoc())
    const photo = createRect({ x: 0, y: 0, width: 400, height: 300 })
    transaction('add', (d) => { addNode(d, photo, d.rootId); addNode(d, mask, d.rootId) })
    setSelection([photo.id, mask.id])
    return { group: maskWithShape()!, photo: photo.id }
  }
  /** A point of the mask's own box, in the world, through the group's matrix `g`. */
  const onMask = (g: Mat2D, maskId: string, fx: number, fy: number) => {
    const mask = getDoc().nodes[maskId]!
    const local = { x: mask.transform.width * fx, y: mask.transform.height * fy }
    return applyToPoint(multiply(g, localMatrix(mask.transform)), local)
  }

  it('grows from the handle under the pointer, not from the photograph the mask hides', () => {
    // The mask sits in the middle of a picture four times its width. The resize
    // used to divide by the picture: the mask's corner, grabbed, read as the
    // picture's corner arriving at the pointer, and the group leapt away.
    const mask = createEllipse({ x: 150, y: 110, width: 100, height: 80 })
    const { group, photo } = maskOver(mask)
    const g0 = worldMatrix(getDoc(), group)
    const pinned = onMask(g0, mask.id, 0, 0)
    const grabbed = onMask(g0, mask.id, 1, 1)
    const pointer = { x: grabbed.x + 60, y: grabbed.y + 40 }

    expect(beginDrag(getDoc(), [group], 'resize', grabbed, 'se')).toBe(true)
    const mats = updateDrag(pointer, noMods)
    // Mid-drag, the frame — the mask's box under the live matrix — is on the pointer.
    const live = getLiveMatrix(group)!
    expect(onMask(live, mask.id, 1, 1).x).toBeCloseTo(pointer.x, 6)
    expect(onMask(live, mask.id, 1, 1).y).toBeCloseTo(pointer.y, 6)
    expect(onMask(live, mask.id, 0, 0).x).toBeCloseTo(pinned.x, 6)
    expect(onMask(live, mask.id, 0, 0).y).toBeCloseTo(pinned.y, 6)

    commitDrag(mats)
    const g1 = worldMatrix(getDoc(), group)
    expect(onMask(g1, mask.id, 1, 1).x).toBeCloseTo(pointer.x, 6)
    expect(onMask(g1, mask.id, 1, 1).y).toBeCloseTo(pointer.y, 6)
    expect(onMask(g1, mask.id, 0, 0).x).toBeCloseTo(pinned.x, 6)
    expect(onMask(g1, mask.id, 0, 0).y).toBeCloseTo(pinned.y, 6)
    // And what it holds scaled with it, by the mask's own growth.
    expect(geometryBounds(getDoc(), photo).width).toBeCloseTo(400 * 1.6, 4)
    expect(geometryBounds(getDoc(), photo).height).toBeCloseTo(300 * 1.5, 4)
  })

  it('resizes along the sides of a mask turned inside its group', () => {
    // The frame is drawn on the mask's own box, turned with it, so its handles
    // are there — a resize measured square to the group missed them.
    const mask = createRect({ x: 120, y: 90, width: 100, height: 60, rotation: 30 })
    const { group } = maskOver(mask)
    const g0 = worldMatrix(getDoc(), group)
    const pinned = onMask(g0, mask.id, 0, 0)
    const pointer = onMask(g0, mask.id, 1.3, 1.5)

    beginDrag(getDoc(), [group], 'resize', onMask(g0, mask.id, 1, 1), 'se')
    commitDrag(updateDrag(pointer, noMods))

    const g1 = worldMatrix(getDoc(), group)
    expect(onMask(g1, mask.id, 1, 1).x).toBeCloseTo(pointer.x, 6)
    expect(onMask(g1, mask.id, 1, 1).y).toBeCloseTo(pointer.y, 6)
    expect(onMask(g1, mask.id, 0, 0).x).toBeCloseTo(pinned.x, 6)
    expect(onMask(g1, mask.id, 0, 0).y).toBeCloseTo(pinned.y, 6)
    // Still a rectangle: scaled along its own sides, it cannot shear.
    expect(isOrthogonal(worldMatrix(getDoc(), mask.id))).toBe(true)
  })

  it('a group holding a mask group is framed by what the mask shows', () => {
    const mask = createEllipse({ x: 150, y: 110, width: 100, height: 80 })
    const { group } = maskOver(mask)
    const other = createRect({ x: 300, y: 120, width: 20, height: 20 })
    transaction('add', (d) => { addNode(d, other, d.rootId) })
    let outer = ''
    transaction('group', (d) => { outer = groupNodes(d, [group, other.id])! })

    const doc = getDoc()
    const framed = transformBounds(localContentBox(doc, doc.nodes[outer]!), worldMatrix(doc, outer))
    // The mask (150..250) and the square (300..320), not the 400-wide picture —
    // the same box every world-space measure of the group already gave.
    expect(framed.x).toBeCloseTo(150, 6)
    expect(framed.width).toBeCloseTo(170, 6)
    const world = geometryBounds(doc, outer)
    for (const k of ['x', 'y', 'width', 'height'] as const) expect(framed[k]).toBeCloseTo(world[k], 6)
  })
})

describe('grouping preserves world position', () => {
  it('group then ungroup is a visual no-op, even when rotated', () => {
    replaceDocument(freshDoc())
    const a = createRect({ x: 0, y: 0, width: 100, height: 50, rotation: 20 })
    const b = createEllipse({ x: 150, y: 80, width: 60, height: 60, rotation: -35 })
    transaction('add', (d) => { addNode(d, a, d.rootId); addNode(d, b, d.rootId) })

    const beforeA = geometryBounds(getDoc(), a.id)
    const beforeB = geometryBounds(getDoc(), b.id)

    let groupId = ''
    transaction('group', (d) => { groupId = groupNodes(d, [a.id, b.id])! })
    const groupedA = geometryBounds(getDoc(), a.id)
    expect(groupedA.x).toBeCloseTo(beforeA.x, 4)
    expect(groupedA.y).toBeCloseTo(beforeA.y, 4)

    transaction('ungroup', (d) => { ungroupNode(d, groupId) })
    const afterA = geometryBounds(getDoc(), a.id)
    const afterB = geometryBounds(getDoc(), b.id)
    expect(afterA.x).toBeCloseTo(beforeA.x, 4)
    expect(afterA.y).toBeCloseTo(beforeA.y, 4)
    expect(afterA.width).toBeCloseTo(beforeA.width, 4)
    expect(afterB.x).toBeCloseTo(beforeB.x, 4)
    expect(afterB.height).toBeCloseTo(beforeB.height, 4)
  })

  it('rotating a group moves its children', () => {
    replaceDocument(freshDoc())
    const a = createRect({ x: 0, y: 0, width: 100, height: 50 })
    const b = createRect({ x: 200, y: 0, width: 100, height: 50 })
    transaction('add', (d) => { addNode(d, a, d.rootId); addNode(d, b, d.rootId) })
    let groupId = ''
    transaction('group', (d) => { groupId = groupNodes(d, [a.id, b.id])! })

    const beforeB = geometryBounds(getDoc(), b.id)
    transaction('rotate', (d) => {
      d.nodes[groupId]!.transform = { ...d.nodes[groupId]!.transform, rotation: 90 }
    })
    const afterB = geometryBounds(getDoc(), b.id)
    // A 90-degree turn must actually move the far child.
    expect(Math.abs(afterB.x - beforeB.x) + Math.abs(afterB.y - beforeB.y)).toBeGreaterThan(50)
  })
})

describe('nested transforms compose', () => {
  it('world matrix equals the product of local matrices', () => {
    replaceDocument(freshDoc())
    const child = createRect({ x: 10, y: 20, width: 40, height: 40, rotation: 15 })
    transaction('build', (d) => {
      const g = { ...createRect({ x: 5, y: 5, width: 10, height: 10 }) }
      void g
      addNode(d, child, d.rootId)
    })
    let groupId = ''
    transaction('group', (d) => { groupId = groupNodes(d, [child.id])! })
    transaction('rot', (d) => {
      d.nodes[groupId]!.transform = { ...d.nodes[groupId]!.transform, rotation: 40 }
    })

    const doc = getDoc()
    const expected = multiply(localMatrix(doc.nodes[groupId]!.transform), localMatrix(doc.nodes[child.id]!.transform))
    const actual = worldMatrix(doc, child.id)
    for (let i = 0; i < 6; i++) expect(actual[i]).toBeCloseTo(expected[i], 9)
  })

  it('inverse world matrix round-trips a point', () => {
    replaceDocument(freshDoc())
    const rect = createRect({ x: 33, y: 77, width: 90, height: 40, rotation: 63 })
    transaction('add', (d) => { addNode(d, rect, d.rootId) })
    const m = worldMatrix(getDoc(), rect.id)
    const p = { x: 12.5, y: 31.25 }
    const back = applyToPoint(invert(m), applyToPoint(m, p))
    expect(back.x).toBeCloseTo(p.x, 9)
    expect(back.y).toBeCloseTo(p.y, 9)
  })
})
