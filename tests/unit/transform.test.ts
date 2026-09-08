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
import { applyToPoint, invert, multiply, isOrthogonal } from '@/geometry/Matrix'
import { localMatrix, worldMatrix, geometryBounds } from '@/document/SceneGraph'
import { transformFromMatrix } from '@/document/DocumentModel'
import { createDocument, createRect, createEllipse } from '@/document/NodeFactory'
import { addNode, groupNodes, ungroupNode } from '@/document/DocumentModel'
import { replaceDocument, getDoc, transaction } from '@/state/DocumentStore'
import { setSelection } from '@/state/EditorStore'
import { beginDrag, updateDrag, commitDrag } from '@/tools/DragSession'
import type { DesignDocument } from '@/document/types'

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
