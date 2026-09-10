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
 * 3D Transforms in the scene graph: what is tilted, what shares a space, what
 * paints in front, what a click lands on, what the file keeps and what the
 * commands do — everything the canvas relies on, checked in plain node.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createArtboard, createDocument, createGroup, createRect } from '../../src/document/NodeFactory'
import { addNode } from '../../src/document/DocumentModel'
import {
  anyIn3d,
  depthSorted,
  is3dAffected,
  isPreserve3d,
  localToWorld,
  nodeMapping,
  paintOrder,
  planeHomography,
} from '../../src/document/Scene3D'
import { geometryBounds, hitTest, renderBounds } from '../../src/document/SceneGraph'
import { transform3dOf, type DesignDocument, type NodeId } from '../../src/document/types'
import { deserializeDocument, serializeDocument } from '../../src/persistence/FileFormat'
import { exportNodesToSvg } from '../../src/svg/SvgExporter'
import { getDoc, replaceDocument } from '../../src/state/DocumentStore'
import { setSelection } from '../../src/state/EditorStore'
import {
  canReset3d,
  flipSelection,
  normalizeTransform3d,
  reset3dTransforms,
  setTransform3d,
} from '../../src/history/Commands'
import { beginTransform3d, commitTransform3d, getLiveTransform3d, updateTransform3d } from '../../src/tools/Transform3dSession'
import { beginDrag, commitDrag, getLiveSize, updateDrag } from '../../src/tools/DragSession'
import { liveDocument } from '../../src/tools/liveDocument'

function docWith(...build: Array<(doc: DesignDocument) => void>): DesignDocument {
  const doc = createDocument('3D', false)
  for (const step of build) step(doc)
  return doc
}

/** A 200 x 100 rect at (100, 100), optionally tilted. */
function card(doc: DesignDocument, t3?: { rotateX?: number; rotateY?: number; z?: number }, parent?: NodeId): NodeId {
  const rect = createRect({ x: 100, y: 100, width: 200, height: 100 })
  if (t3) rect.transform3d = { rotateX: 0, rotateY: 0, z: 0, ...t3 }
  addNode(doc, rect, parent ?? doc.rootId)
  return rect.id
}

describe('what is in 3D', () => {
  it('a tilted object is, and so is everything inside it', () => {
    let group = ''
    let child = ''
    const doc = docWith((d) => {
      const g = createGroup([], { x: 0, y: 0, width: 400, height: 400 })
      g.transform3d = { rotateX: 0, rotateY: 30, z: 0 }
      addNode(d, g, d.rootId)
      group = g.id
      child = card(d, undefined, g.id)
    })
    expect(is3dAffected(doc, group)).toBe(true)
    expect(is3dAffected(doc, child)).toBe(true)
    // A flat group with nothing tilted in it shares no space: it is a plane.
    expect(isPreserve3d(doc, group)).toBe(false)
  })

  it('an all-zero or artboard transform is flat, whatever the field says', () => {
    const doc = docWith((d) => {
      const rect = createRect()
      rect.transform3d = { rotateX: 0, rotateY: 0, z: 0 }
      addNode(d, rect, d.rootId)
      const board = createArtboard('A', { width: 100, height: 100 })
      board.transform3d = { rotateX: 45, rotateY: 0, z: 0 }
      addNode(d, board, d.rootId)
    })
    for (const node of Object.values(doc.nodes)) expect(transform3dOf(node)).toBeUndefined()
  })

  it('a tilted group with tilted children shares its space, unless something flattens it', () => {
    let stack = ''
    const doc = docWith((d) => {
      const g = createGroup([], { width: 300, height: 300 })
      g.transform3d = { rotateX: 0, rotateY: 40, z: 0 }
      addNode(d, g, d.rootId)
      stack = g.id
      card(d, { z: 20 }, g.id)
      card(d, { z: -20 }, g.id)
    })
    expect(isPreserve3d(doc, stack)).toBe(true)
    // A shadow needs a flat picture to cast from, so the same group becomes one.
    const g = doc.nodes[stack]!
    if ('style' in g) g.style.shadow = { kind: 'drop', x: 0, y: 4, blur: 8, color: { r: 0, g: 0, b: 0, a: 0.3 }, visible: true }
    const shadowed = { ...doc, nodes: { ...doc.nodes } }
    expect(isPreserve3d(shadowed, stack)).toBe(false)
  })
})

describe('where it is', () => {
  it('bounds are the projected shape: a Y-turned card is narrower, and its near edge taller', () => {
    let flat = ''
    let turned = ''
    const doc = docWith((d) => {
      flat = card(d)
      turned = card(d, { rotateY: 40 })
    })
    const a = geometryBounds(doc, flat)
    const b = geometryBounds(doc, turned)
    expect(b.width).toBeLessThan(a.width)
    expect(b.height).toBeGreaterThan(a.height)
    // Turned about its own centre, the centre stays where it was — the BOX is
    // not centred on it, because the near half is magnified and the far half
    // shrunk.
    const pivot = localToWorld(doc, turned, { x: 100, y: 50 })!
    expect(pivot.x).toBeCloseTo(200, 9)
    expect(pivot.y).toBeCloseTo(150, 9)
    expect(b.x + b.width / 2).toBeLessThan(200)
    expect(renderBounds(doc, turned).width).toBeGreaterThanOrEqual(b.width)
  })

  it('a click lands on the trapezoid on screen, not on the rectangle it would be flat', () => {
    let id = ''
    const doc = docWith((d) => {
      id = card(d, { rotateY: 60 })
    })
    const b = geometryBounds(doc, id)
    // The middle of the card is on it.
    expect(hitTest(doc, { x: 200, y: 150 })).toBe(id)
    // Its flat right-hand end is well outside the turned card.
    expect(b.x + b.width).toBeLessThan(290)
    expect(hitTest(doc, { x: 290, y: 150 })).toBeNull()
  })

  it('nothing behind the camera is hit', () => {
    let id = ''
    const doc = docWith((d) => {
      const wide = createRect({ x: 0, y: 0, width: 3000, height: 100 })
      wide.transform3d = { rotateX: 0, rotateY: 85, z: 0 }
      addNode(d, wide, d.rootId)
      id = wide.id
    })
    const m = nodeMapping(doc, id).toWorld
    expect(m).toBeDefined()
    expect(hitTest(doc, { x: 1500, y: 50 })).toBe(id)
  })
})

describe('what paints in front', () => {
  it('siblings paint by depth, and a click takes the one in front', () => {
    let near = ''
    let far = ''
    const doc = docWith((d) => {
      near = card(d, { z: 60 })
      far = card(d, { z: -10 })
    })
    const order = paintOrder(doc, doc.rootId)
    expect(order.indexOf(near)).toBeGreaterThan(order.indexOf(far))
    expect(hitTest(doc, { x: 200, y: 150 })).toBe(near)
  })

  it('equal depths keep layer order, and a flat document is untouched', () => {
    const doc = docWith((d) => {
      card(d)
      card(d)
      card(d)
    })
    const root = doc.nodes[doc.rootId]!
    expect(paintOrder(doc, doc.rootId)).toBe((root as { children: NodeId[] }).children)
  })

  it('turning a stack round brings its back card to the front', () => {
    let front = ''
    let back = ''
    let stack = ''
    const doc = docWith((d) => {
      const g = createGroup([], { x: 100, y: 100, width: 200, height: 100 })
      g.transform3d = { rotateX: 0, rotateY: 10, z: 0 }
      addNode(d, g, d.rootId)
      stack = g.id
      back = card(d, { z: -20 }, g.id)
      front = card(d, { z: 20 }, g.id)
      // Children sit in the group's own space.
      for (const id of [back, front]) Object.assign(d.nodes[id]!.transform, { x: 0, y: 0 })
    })
    const facing = depthSorted(doc, stack, [front, back])
    expect(facing[facing.length - 1]).toBe(front)
    doc.nodes[stack]!.transform3d = { rotateX: 0, rotateY: 180, z: 0 }
    const turned = depthSorted({ ...doc, nodes: { ...doc.nodes } }, stack, [front, back])
    expect(turned[turned.length - 1]).toBe(back)
  })
})

describe('gestures on something in perspective', () => {
  const noMods = { constrain: false, fromCenter: false }

  it('a tilted group resizes its picture exactly: the edge follows the pointer, the other stays', () => {
    let group = ''
    replaceDocument(docWith((d) => {
      const g = createGroup([], { x: 100, y: 100, width: 200, height: 100 })
      g.transform3d = { rotateX: 15, rotateY: 35, z: 0 }
      addNode(d, g, d.rootId)
      group = g.id
      const inner = createRect({ x: 0, y: 0, width: 200, height: 100 })
      addNode(d, inner, g.id)
    }))
    const before = geometryBounds(getDoc(), group)
    const start = { x: before.x + before.width, y: before.y + before.height / 2 }
    expect(beginDrag(getDoc(), [group], 'resize', start, 'e')).toBe(true)
    commitDrag(updateDrag({ x: start.x + 60, y: start.y }, noMods))
    const after = geometryBounds(getDoc(), group)
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.x + after.width).toBeCloseTo(before.x + before.width + 60, 6)
    // Still tilted exactly as it was.
    expect(getDoc().nodes[group]!.transform3d).toEqual({ rotateX: 15, rotateY: 35, z: 0 })
  })

  it('a tilted shape resizes its own box, keeping the pinned side where it was on screen', () => {
    let id = ''
    replaceDocument(docWith((d) => {
      id = card(d, { rotateY: 35 })
    }))
    const doc = getDoc()
    const west = localToWorld(doc, id, { x: 0, y: 50 })!
    const east = localToWorld(doc, id, { x: 200, y: 50 })!
    expect(beginDrag(doc, [id], 'resize', east, 'e')).toBe(true)
    commitDrag(updateDrag({ x: east.x + 40, y: east.y }, noMods))
    const node = getDoc().nodes[id]!
    // The box itself grew — strokes and corners are not scaled, as for a flat rect.
    expect(node.transform.width).toBeGreaterThan(220)
    expect(node.transform.scaleX).toBeCloseTo(1, 9)
    const westAfter = localToWorld(getDoc(), id, { x: 0, y: 50 })!
    expect(westAfter.x).toBeCloseTo(west.x, 3)
    expect(westAfter.y).toBeCloseTo(west.y, 3)
    // And the far edge ends up where the pointer let go of it — solved for,
    // since growing the box moves the centre the camera looks at.
    const eastAfter = localToWorld(getDoc(), id, { x: node.transform.width, y: 50 })!
    expect(Math.abs(eastAfter.x - (east.x + 40))).toBeLessThan(0.05)
  })

  it('a tilted shape grows steadily under a steady drag — no leap and no shrinking back', () => {
    // The regression: the size used to be solved against the edge of the frame
    // round the projection, which kinks as a different corner becomes the
    // extreme one, and the solve overshot — the box leapt, shrank back and
    // leapt again while the pointer moved smoothly.
    // What a 1600 x 1000 photo imports as, dragged the way a hand drags: the
    // size at which the old solve first leapt.
    let id = ''
    replaceDocument(docWith((d) => {
      const image = createRect({ x: 100, y: 100, width: 900, height: 562 })
      image.transform3d = { rotateX: 10, rotateY: 25, z: 0 }
      addNode(d, image, d.rootId)
      id = image.id
    }))
    const doc = getDoc()
    const corner = localToWorld(doc, id, { x: 900, y: 562 })!
    expect(beginDrag(doc, [id], 'resize', corner, 'se')).toBe(true)
    let last = { width: 900, height: 562 }
    let mats = null
    const step = { x: 6.67, y: 4.17 }
    for (let i = 1; i <= 90; i++) {
      mats = updateDrag({ x: corner.x + i * step.x, y: corner.y + i * step.y }, noMods)
      const size = getLiveSize(id)!
      expect(size.width).toBeGreaterThanOrEqual(last.width - 1e-6)
      expect(size.height).toBeGreaterThanOrEqual(last.height - 1e-6)
      // No step grows the box by much more than the pointer moved.
      expect(size.width - last.width).toBeLessThan(step.x * 2)
      expect(size.height - last.height).toBeLessThan(step.y * 3)
      last = size
    }
    commitDrag(mats)
    // And the grabbed corner ended up under the pointer.
    const node = getDoc().nodes[id]!
    const landed = localToWorld(getDoc(), id, { x: node.transform.width, y: node.transform.height })!
    expect(landed.x).toBeCloseTo(corner.x + 90 * step.x, 1)
    expect(landed.y).toBeCloseTo(corner.y + 90 * step.y, 1)
  })

  it('a child moved across a tilted card follows the pointer on screen', () => {
    let child = ''
    replaceDocument(docWith((d) => {
      const g = createGroup([], { x: 100, y: 100, width: 400, height: 300 })
      g.transform3d = { rotateX: 0, rotateY: 50, z: 0 }
      addNode(d, g, d.rootId)
      const bg = createRect({ x: 0, y: 0, width: 400, height: 300 })
      addNode(d, bg, g.id)
      const label = createRect({ x: 40, y: 40, width: 60, height: 30 })
      addNode(d, label, g.id)
      child = label.id
    }))
    const doc = getDoc()
    const grab = localToWorld(doc, child, { x: 30, y: 15 })!
    expect(beginDrag(doc, [child], 'move', grab)).toBe(true)
    commitDrag(updateDrag({ x: grab.x + 50, y: grab.y + 10 }, noMods))
    const landed = localToWorld(getDoc(), child, { x: 30, y: 15 })!
    // On the card's own plane the move is exact: the grabbed point is under the pointer.
    expect(landed.x).toBeCloseTo(grab.x + 50, 6)
    expect(landed.y).toBeCloseTo(grab.y + 10, 6)
  })
})

describe('the file', () => {
  it('keeps a 3D transform through a save and a load', () => {
    let id = ''
    const doc = docWith((d) => {
      id = card(d, { rotateX: 12.5, rotateY: -33, z: 40 })
    })
    const back = deserializeDocument(serializeDocument(doc))
    expect(back.nodes[id]!.transform3d).toEqual({ rotateX: 12.5, rotateY: -33, z: 40 })
  })

  it('writes nothing for a flat document', () => {
    const doc = docWith((d) => {
      card(d)
    })
    const json = new TextDecoder().decode(serializeDocument(doc, { plainJson: true }))
    expect(json).not.toContain('transform3d')
  })

  it('repairs what it can and drops what it cannot', () => {
    const doc = docWith((d) => {
      card(d)
      card(d)
      card(d)
      const board = createArtboard('A', { width: 100, height: 100 })
      addNode(d, board, d.rootId)
    })
    const ids = Object.keys(doc.nodes).filter((id) => doc.nodes[id]!.type === 'rect')
    const board = Object.values(doc.nodes).find((n) => n.type === 'artboard')!
    const raw = JSON.parse(new TextDecoder().decode(serializeDocument(doc, { plainJson: true })))
    for (const layer of raw.layers) {
      if (layer.id === ids[0]) layer.transform3d = { rotateX: 'lots', rotateY: 0, z: 0 }
      if (layer.id === ids[1]) layer.transform3d = { rotateX: 370, rotateY: -190, z: 99999 }
      if (layer.id === ids[2]) layer.transform3d = { rotateX: 0, rotateY: 0, z: 0 }
      if (layer.id === board.id) layer.transform3d = { rotateX: 10, rotateY: 0, z: 0 }
    }
    const back = deserializeDocument(new TextEncoder().encode(JSON.stringify(raw)))
    expect(back.nodes[ids[0]!]!.transform3d).toBeUndefined()
    const wrapped = back.nodes[ids[1]!]!.transform3d!
    expect(wrapped.rotateX).toBeCloseTo(10, 9)
    expect(wrapped.rotateY).toBeCloseTo(170, 9)
    expect(wrapped.z).toBeLessThan(800)
    expect(back.nodes[ids[2]!]!.transform3d).toBeUndefined()
    expect(back.nodes[board.id]!.transform3d).toBeUndefined()
  })
})

describe('export', () => {
  it('draws a tilted object as a masked mesh, and a flat one as it always was', async () => {
    let tilted = ''
    let flat = ''
    const doc = docWith((d) => {
      tilted = card(d, { rotateY: 35 })
      flat = card(d)
    })
    const bounds = { x: 0, y: 0, width: 500, height: 400 }
    const a = (await exportNodesToSvg(doc, [tilted], { bounds })).svg
    expect(a).toContain('<mask id="p3d-')
    expect(a).toContain('shape-rendering="crispEdges"')
    expect(a).toContain('<use href="#p3d-')
    const b = (await exportNodesToSvg(doc, [flat], { bounds })).svg
    expect(b).not.toContain('p3d-')
  })

  it('draws depth alone with a single transform, no mesh', async () => {
    let id = ''
    const doc = docWith((d) => {
      id = card(d, { z: 50 })
    })
    const svg = (await exportNodesToSvg(doc, [id], { bounds: { x: 0, y: 0, width: 500, height: 400 } })).svg
    expect(svg).not.toContain('<mask')
    expect(planeHomography(doc, id)).not.toBeNull()
  })
})

describe('commands', () => {
  let a = ''
  let b = ''
  let board = ''
  beforeEach(() => {
    const doc = docWith((d) => {
      a = card(d)
      b = card(d, { rotateX: 10, rotateY: 0, z: 0 })
      const artboard = createArtboard('Board', { width: 100, height: 100 })
      addNode(d, artboard, d.rootId)
      board = artboard.id
    })
    replaceDocument(doc)
  })

  it('a field edit merges into what each object already has', () => {
    setSelection([a, b])
    expect(setTransform3d({ rotateY: 25 })).toBe(true)
    expect(getDoc().nodes[a]!.transform3d).toEqual({ rotateX: 0, rotateY: 25, z: 0 })
    expect(getDoc().nodes[b]!.transform3d).toEqual({ rotateX: 10, rotateY: 25, z: 0 })
  })

  it('zeroing every field removes the property', () => {
    setSelection([b])
    setTransform3d({ rotateX: 0 })
    expect('transform3d' in getDoc().nodes[b]!).toBe(false)
  })

  it('reset takes the selection back to flat, and says when there is nothing to reset', () => {
    setSelection([a, b])
    expect(canReset3d()).toBe(true)
    expect(reset3dTransforms()).toBe(true)
    expect(getDoc().nodes[b]!.transform3d).toBeUndefined()
    expect(canReset3d()).toBe(false)
    expect(reset3dTransforms()).toBe(false)
  })

  it('an artboard never takes a 3D transform', () => {
    setSelection([board])
    expect(setTransform3d({ rotateX: 30 })).toBe(false)
    expect(getDoc().nodes[board]!.transform3d).toBeUndefined()
  })

  it('flipping skips a tilted object and still flips the rest', () => {
    setSelection([a, b])
    expect(anyIn3d(getDoc(), [a, b])).toBe(true)
    const flatBefore = getDoc().nodes[a]!.transform
    const tiltedBefore = getDoc().nodes[b]!.transform
    flipSelection('h')
    // A mirror is stored as "rotate 180 and flip vertically" (see decompose),
    // so it is the transform as a whole that says it happened.
    expect(getDoc().nodes[a]!.transform).not.toEqual(flatBefore)
    expect(getDoc().nodes[b]!.transform).toEqual(tiltedBefore)
  })

  it('angles wrap and the depth stays in front of the eye', () => {
    expect(normalizeTransform3d({ rotateX: 540, rotateY: -181, z: 5000 })).toEqual({
      rotateX: 180,
      rotateY: 179,
      z: 600,
    })
    expect(normalizeTransform3d({ rotateX: 360, rotateY: 0, z: 0 })).toBeNull()
  })

  it('the gizmo turns live without writing, then commits once', () => {
    const before = getDoc()
    expect(beginTransform3d(getDoc(), [a], 'rotate', { x: 0, y: 0 }, 1)).toBe(true)
    updateTransform3d({ x: 60, y: -20 }, false)
    expect(getDoc()).toBe(before)
    expect(getLiveTransform3d(a)).toEqual({ rotateX: 10, rotateY: 30, z: 0 })
    // The live document is what the canvas draws from meanwhile.
    expect(transform3dOf(liveDocument(getDoc()).nodes[a])).toEqual({ rotateX: 10, rotateY: 30, z: 0 })
    expect(commitTransform3d()).toBe(true)
    expect(getDoc().nodes[a]!.transform3d).toEqual({ rotateX: 10, rotateY: 30, z: 0 })
    expect(getLiveTransform3d(a)).toBeUndefined()
  })

  it('the gizmo pushes depth by the pointer distance in document units', () => {
    beginTransform3d(getDoc(), [a], 'depth', { x: 0, y: 0 }, 2)
    updateTransform3d({ x: 0, y: -50 }, false)
    commitTransform3d()
    expect(getDoc().nodes[a]!.transform3d).toEqual({ rotateX: 0, rotateY: 0, z: 25 })
  })
})
