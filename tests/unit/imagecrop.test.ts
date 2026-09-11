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
 * Cropping an image.
 *
 * The judgements worth pinning down: cropping never moves what stays, however
 * the image is turned, flipped or skewed; the box becomes the kept part, so
 * everything reading the box sees the crop as the image; a crop can always be
 * widened again or undone entirely; and a damaged crop in a file cannot break
 * the picture.
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { createArtboard, createDocument, createImage } from '@/document/NodeFactory'
import { addNode } from '@/document/DocumentModel'
import {
  cropToRect, fullImageFrame, isCropped, sanitizeCrop, uncropped,
} from '@/document/ImageCrop'
import { localMatrix } from '@/document/SceneGraph'
import { applyToPoint } from '@/geometry/Matrix'
import { cropImage, resetImageCrop } from '@/history/Commands'
import { replaceDocument, getDoc, transaction, undo } from '@/state/DocumentStore'
import { editorStore, setEditor, setSelection } from '@/state/EditorStore'
import {
  beginCropDrag, cancelCropMode, commitCropMode, endCropDrag, enterCropMode, updateCropDrag,
} from '@/tools/CropSession'
import { exportNodesToSvg } from '@/svg/SvgExporter'
import { deserializeDocument, serializeDocument } from '@/persistence/FileFormat'
import type { ImageAsset, ImageNode, Transform } from '@/document/types'

const ASSET: ImageAsset = {
  id: 'asset-crop',
  name: 'Photo',
  mimeType: 'image/png',
  width: 400,
  height: 200,
  byteSize: 12,
  dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
}

function image(transform: Partial<Transform> = {}): ImageNode {
  return createImage(ASSET.id, 'Photo', { x: 50, y: 40, width: 200, height: 100, ...transform })
}

/** Where a point of a box lands in its parent, for a given transform. */
function place(t: Transform, x: number, y: number) {
  return applyToPoint(localMatrix(t), { x, y })
}

function expectClose(a: { x: number; y: number }, b: { x: number; y: number }) {
  expect(a.x).toBeCloseTo(b.x, 6)
  expect(a.y).toBeCloseTo(b.y, 6)
}

describe('cropping keeps what stays exactly where it was', () => {
  const shapes: Array<[string, Partial<Transform>]> = [
    ['upright', {}],
    ['turned', { rotation: 30 }],
    ['flipped and scaled', { scaleX: -1.5, scaleY: 0.75, rotation: -12 }],
    ['skewed', { skewX: 14, rotation: 70 }],
    ['pivoting on a corner', { originX: 0, originY: 1, rotation: 45 }],
  ]

  for (const [name, t] of shapes) {
    it(`when ${name}`, () => {
      const node = image(t)
      const rect = { x: 30, y: 20, width: 90, height: 45 }
      const { transform } = cropToRect(node, rect)

      // Every corner of the kept part, and its middle, is where it was.
      for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5]] as const) {
        const before = place(node.transform, rect.x + rect.width * u, rect.y + rect.height * v)
        const after = place(transform, transform.width * u, transform.height * v)
        expectClose(after, before)
      }
      // Turn, scale and skew are carried over as they were, not re-derived.
      expect(transform.rotation).toBe(node.transform.rotation)
      expect(transform.scaleX).toBe(node.transform.scaleX)
      expect(transform.skewX).toBe(node.transform.skewX)
    })
  }
})

describe('the crop itself', () => {
  it('makes the box the kept part, and records it as fractions of the picture', () => {
    const { crop, transform } = cropToRect(image(), { x: 50, y: 25, width: 100, height: 50 })
    expect([transform.width, transform.height]).toEqual([100, 50])
    expect(crop).toEqual({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 })
  })

  it('knows where the rest of the picture is, so the crop can grow again', () => {
    const node = image()
    const next = { ...node, ...cropToRect(node, { x: 50, y: 25, width: 100, height: 50 }) } as ImageNode
    expect(fullImageFrame(next)).toEqual({ x: -50, y: -25, width: 200, height: 100 })

    // Widening to the whole picture is no crop at all.
    const widened = cropToRect(next, fullImageFrame(next))
    expect(widened.crop).toBeUndefined()
    expect([widened.transform.width, widened.transform.height]).toEqual([200, 100])
    expect(widened.transform.x).toBeCloseTo(node.transform.x, 6)
    expect(widened.transform.y).toBeCloseTo(node.transform.y, 6)
  })

  it('composes: a crop of a crop is still measured against the whole picture', () => {
    let node = image({ rotation: 20 })
    const original = node.transform
    node = { ...node, ...cropToRect(node, { x: 40, y: 10, width: 120, height: 80 }) } as ImageNode
    node = { ...node, ...cropToRect(node, { x: 20, y: 20, width: 60, height: 40 }) } as ImageNode
    expect(node.crop!.x).toBeCloseTo(0.3, 9)
    expect(node.crop!.width).toBeCloseTo(0.3, 9)

    const back = uncropped(node).transform
    expect(back.width).toBeCloseTo(original.width, 6)
    expect(back.height).toBeCloseTo(original.height, 6)
    expect(back.x).toBeCloseTo(original.x, 6)
    expect(back.y).toBeCloseTo(original.y, 6)
  })

  it('never keeps more than the picture has, or nothing at all', () => {
    const { crop, transform } = cropToRect(image(), { x: -80, y: -80, width: 1000, height: 1000 })
    expect(crop).toBeUndefined()
    expect([transform.width, transform.height]).toEqual([200, 100])

    const tiny = cropToRect(image(), { x: 10, y: 10, width: 0, height: -5 })
    expect(tiny.transform.width).toBeGreaterThan(0)
    expect(tiny.transform.height).toBeGreaterThan(0)
  })
})

describe('a crop read from a file', () => {
  it('keeps a good one and clamps one that runs off the picture', () => {
    expect(sanitizeCrop({ x: 0.1, y: 0.2, width: 0.5, height: 0.5 })).toEqual({ x: 0.1, y: 0.2, width: 0.5, height: 0.5 })
    const clamped = sanitizeCrop({ x: 0.8, y: 0, width: 0.5, height: 1 })!
    expect(clamped.x).toBe(0.8)
    expect(clamped.width).toBeCloseTo(0.2, 12)
  })

  it('drops what cannot be a crop, so the whole picture shows', () => {
    for (const bad of [null, 'crop', { x: 0, y: 0, width: 0, height: 1 }, { x: NaN, y: 0, width: 1, height: 1 },
      { x: 0, y: 0, width: '1', height: 1 }, { x: 0, y: 0, width: 1, height: 1 }]) {
      expect(sanitizeCrop(bad)).toBeNull()
    }
  })

  it('round-trips through the file format, and a broken one does not survive loading', () => {
    const doc = createDocument('Crop', false)
    doc.assets[ASSET.id] = ASSET
    const good = image()
    good.crop = { x: 0.25, y: 0, width: 0.5, height: 1 }
    const broken = image()
    broken.crop = { x: 0, y: 0, width: -1, height: Infinity } as never
    addNode(doc, good, doc.rootId)
    addNode(doc, broken, doc.rootId)

    const back = deserializeDocument(serializeDocument(doc))
    expect((back.nodes[good.id] as ImageNode).crop).toEqual(good.crop)
    expect(back.nodes[broken.id]).not.toHaveProperty('crop')
  })
})

describe('cropping in the document', () => {
  let id: string

  beforeEach(() => {
    replaceDocument(createDocument('Crop', false))
    const board = createArtboard('A', { x: 0, y: 0, width: 800, height: 600 })
    const node = image()
    transaction('seed', (draft) => {
      draft.assets[ASSET.id] = ASSET
      addNode(draft, board, draft.rootId)
      addNode(draft, node, board.id)
    })
    id = node.id
    setEditor({ cropEditing: null, tool: 'select' })
    setSelection([])
  })

  const node = () => getDoc().nodes[id] as ImageNode

  it('crops and resets in one undoable step each', () => {
    const before = node().transform
    expect(cropImage(id, { x: 50, y: 25, width: 100, height: 50 })).toBe(true)
    expect(isCropped(node())).toBe(true)
    expect(node().transform.width).toBe(100)

    expect(resetImageCrop(id)).toBe(true)
    expect(node().crop).toBeUndefined()
    expect(node().transform.width).toBeCloseTo(before.width, 6)
    expect(node().transform.x).toBeCloseTo(before.x, 6)

    undo()
    expect(node().transform.width).toBe(100)
    undo()
    expect(node().crop).toBeUndefined()
    expect(node().transform).toEqual(before)
  })

  it('crop mode writes nothing until it is applied, and Cancel leaves no trace', () => {
    const before = getDoc()
    expect(enterCropMode(id)).toBe(true)
    expect(editorStore.getState().selection).toEqual([id])

    // Drag the left edge in by 40 of the image's own units (it is unscaled
    // and sits at 50,40 on an artboard at the origin).
    expect(beginCropDrag('w', { x: 50, y: 60 })).toBe(true)
    updateCropDrag({ x: 90, y: 60 }, false)
    endCropDrag()
    expect(editorStore.getState().cropEditing!.rect).toEqual({ x: 40, y: 0, width: 160, height: 100 })
    expect(getDoc()).toBe(before)

    cancelCropMode()
    expect(getDoc()).toBe(before)
    expect(editorStore.getState().cropEditing).toBeNull()
  })

  it('applies the crop, in place, when committed', () => {
    enterCropMode(id)
    beginCropDrag('se', { x: 250, y: 140 })
    updateCropDrag({ x: 200, y: 115 }, false)
    endCropDrag()
    expect(commitCropMode()).toBe(true)

    expect(editorStore.getState().cropEditing).toBeNull()
    expect([node().transform.x, node().transform.y]).toEqual([50, 40])
    expect([node().transform.width, node().transform.height]).toEqual([150, 75])
    expect(node().crop).toEqual({ x: 0, y: 0, width: 0.75, height: 0.75 })
  })

  it('moves the kept part without letting it leave the picture', () => {
    cropImage(id, { x: 0, y: 0, width: 100, height: 50 })
    enterCropMode(id)
    beginCropDrag('move', { x: 60, y: 50 })
    updateCropDrag({ x: 1000, y: 1000 }, false)
    endCropDrag()
    // The picture is 200 × 100 and the kept part 100 × 50: it stops at the corner.
    expect(editorStore.getState().cropEditing!.rect).toEqual({ x: 100, y: 50, width: 100, height: 50 })
  })

  it('exports only the kept part, and the border around it', async () => {
    cropImage(id, { x: 50, y: 25, width: 100, height: 50 })
    transaction('border', (draft) => {
      const n = draft.nodes[id] as ImageNode
      n.style.stroke = { ...n.style.stroke, paint: { type: 'solid', color: { r: 255, g: 0, b: 0, a: 1 } }, width: 2 }
    })
    const { svg } = await exportNodesToSvg(getDoc(), [id], { bounds: { x: 0, y: 0, width: 800, height: 600 } })
    // The picture is laid out at its pixel size, 400 × 200; the kept middle
    // half is 100..300 × 50..150 of that.
    expect(svg).toContain('viewBox="100 50 200 100"')
    expect(svg).toContain('width="100" height="50"')
    expect(svg).toMatch(/<path d="[^"]+" fill="none" stroke="#ff0000" stroke-width="2"\/>/)
  })
})
