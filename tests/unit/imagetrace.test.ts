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
 * Committing a trace to the document.
 *
 * The tracing itself is covered by the engine's own suites; what matters here
 * is the swap. A commit has to leave the artwork looking untouched — same
 * place, same size, same position in the stack — while turning one image into
 * editable paths, and it has to be exactly one undo step.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createDocument, createArtboard, createImage, createRect } from '@/document/NodeFactory'
import { addNode } from '@/document/DocumentModel'
import { replaceDocument, getDoc, transaction, undo } from '@/state/DocumentStore'
import { setSelection, setEditor } from '@/state/EditorStore'
import { canImageTrace, replaceImageWithTrace, traceableImage } from '@/history/TraceCommands'
import { pathBounds } from '@/geometry/PathUtils'
import type { NodeId, ImageAsset } from '@/document/types'
import type { TraceResult } from '@/trace/types'

const ASSET: ImageAsset = {
  id: 'asset1',
  name: 'Shot',
  mimeType: 'image/png',
  width: 100,
  height: 50,
  byteSize: 12,
  // 1x1 transparent PNG: nothing here decodes it, it only has to be present.
  dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
}

/** Two shapes over a 100x50 source: a filled square and a stroked line. */
const RESULT: TraceResult = {
  width: 100,
  height: 50,
  colorCount: 2,
  anchorCount: 6,
  paths: [
    {
      d: 'M10 10 L30 10 L30 30 L10 30 Z',
      fill: { r: 20, g: 40, b: 60, a: 1 },
      stroke: null,
      strokeWidth: 0,
      anchors: 4,
    },
    {
      d: 'M50 5 L90 45',
      fill: null,
      stroke: { r: 200, g: 0, b: 0, a: 1 },
      strokeWidth: 4,
      anchors: 2,
    },
  ],
}

function seed(): { board: NodeId; image: NodeId; over: NodeId } {
  replaceDocument(createDocument('Trace', false))
  const board = createArtboard('A', { x: 0, y: 0, width: 400, height: 300 })
  // The image is scaled to twice its pixel width and half its pixel height, so
  // a commit that forgot either axis would show up as a wrong bounding box.
  const image = createImage(ASSET.id, 'Shot', { x: 40, y: 20, width: 200, height: 25 })
  const over = createRect({ x: 0, y: 0, width: 10, height: 10 })
  transaction('seed', (draft) => {
    draft.assets[ASSET.id] = ASSET
    addNode(draft, board, draft.rootId)
    addNode(draft, image, board.id)
    addNode(draft, over, board.id)
  })
  setSelection([])
  setEditor({ editingContext: null })
  return { board: board.id, image: image.id, over: over.id }
}

describe('choosing what to trace', () => {
  let ids: ReturnType<typeof seed>
  beforeEach(() => {
    ids = seed()
  })

  it('offers an image, and only when it alone is selected', () => {
    expect(canImageTrace()).toBe(false)

    setSelection([ids.image])
    expect(traceableImage()?.id).toBe(ids.image)
    expect(canImageTrace()).toBe(true)

    setSelection([ids.image, ids.over])
    expect(canImageTrace()).toBe(false)

    setSelection([ids.over])
    expect(canImageTrace()).toBe(false)
  })

  it('refuses a locked image, which cannot be replaced anyway', () => {
    transaction('lock', (draft) => {
      draft.nodes[ids.image]!.locked = true
    })
    setSelection([ids.image])
    expect(canImageTrace()).toBe(false)
  })

  it('refuses an image whose pixels are missing', () => {
    transaction('drop asset', (draft) => {
      delete draft.assets[ASSET.id]
    })
    setSelection([ids.image])
    expect(canImageTrace()).toBe(false)
  })
})

describe('replacing the image with its trace', () => {
  let ids: ReturnType<typeof seed>
  beforeEach(() => {
    ids = seed()
  })

  it('leaves a group of paths where the image was', () => {
    const groupId = replaceImageWithTrace(ids.image, RESULT)
    expect(groupId).not.toBeNull()

    const doc = getDoc()
    expect(doc.nodes[ids.image]).toBeUndefined()

    const group = doc.nodes[groupId!]!
    expect(group.type).toBe('group')
    expect(group.parentId).toBe(ids.board)
    // The stack is unchanged: the rect that was above the image is still above.
    const board = doc.nodes[ids.board]!
    expect('children' in board && board.children).toEqual([groupId, ids.over])
    // And it stands exactly where the image stood.
    expect(group.transform.x).toBe(40)
    expect(group.transform.y).toBe(20)
    expect(group.transform.width).toBe(200)
    expect(group.transform.height).toBe(25)
  })

  it('scales the traced pixels into the image box on both axes', () => {
    const groupId = replaceImageWithTrace(ids.image, RESULT)
    const doc = getDoc()
    const group = doc.nodes[groupId!]!
    const first = doc.nodes[('children' in group ? group.children : [])[0]!]!

    // The square spans pixels 10..30 of a 100x50 source drawn into 200x25:
    // x scales by 2, y by 0.5.
    expect(first.transform.x).toBeCloseTo(20, 4)
    expect(first.transform.y).toBeCloseTo(5, 4)
    expect(first.transform.width).toBeCloseTo(40, 4)
    expect(first.transform.height).toBeCloseTo(10, 4)

    // Rebased to its own corner, like every other path in the document.
    const b = pathBounds('d' in first ? first.d : '')
    expect(b.x).toBeCloseTo(0, 4)
    expect(b.y).toBeCloseTo(0, 4)
  })

  it('carries fills and strokes across, and scales the stroke width', () => {
    const groupId = replaceImageWithTrace(ids.image, RESULT)
    const doc = getDoc()
    const group = doc.nodes[groupId!]!
    const children = ('children' in group ? group.children : []).map((id) => doc.nodes[id]!)

    const filled = children[0]!
    expect('style' in filled && filled.style.fill).toEqual({
      type: 'solid',
      color: { r: 20, g: 40, b: 60, a: 1 },
    })
    expect('style' in filled && filled.style.stroke.paint.type).toBe('none')

    const stroked = children[1]!
    expect('style' in stroked && stroked.style.fill.type).toBe('none')
    expect('style' in stroked && stroked.style.stroke.paint).toEqual({
      type: 'solid',
      color: { r: 200, g: 0, b: 0, a: 1 },
    })
    // 4 source pixels under a 2x horizontal and 0.5x vertical scale: the mean,
    // because a stroke has one width and the two axes disagree.
    expect('style' in stroked && stroked.style.stroke.width).toBeCloseTo(5, 4)
  })

  it('is one undo step, image and all', () => {
    const before = Object.keys(getDoc().nodes).length
    const groupId = replaceImageWithTrace(ids.image, RESULT)
    expect(Object.keys(getDoc().nodes).length).toBe(before + 2)

    undo()
    const doc = getDoc()
    expect(doc.nodes[groupId!]).toBeUndefined()
    expect(doc.nodes[ids.image]?.type).toBe('image')
    expect(Object.keys(doc.nodes).length).toBe(before)
  })

  it('refuses a result with nothing in it rather than leaving a hole', () => {
    const empty: TraceResult = { ...RESULT, paths: [] }
    expect(replaceImageWithTrace(ids.image, empty)).toBeNull()
    expect(getDoc().nodes[ids.image]?.type).toBe('image')
  })
})
