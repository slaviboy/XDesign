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
 * Copy and paste across the boundary with the rest of the machine.
 *
 * The behaviour worth pinning down is not "does a node appear" but the three
 * judgements the feature rests on: where outside content lands, whether the app
 * recognises its own markup coming back, and whether a paste is one undo step.
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { createDocument, createArtboard, createRect } from '@/document/NodeFactory'
import { addNode } from '@/document/DocumentModel'
import { replaceDocument, getDoc, transaction, undo } from '@/state/DocumentStore'
import { editorStore, setSelection, setEditor, enterGroup } from '@/state/EditorStore'
import {
  clearClipboard, copySelection, currentClipId, externalPasteTarget, paste,
} from '@/state/Clipboard'
import { importClipboardPayload } from '@/images/ImageImporter'
import type { NodeId } from '@/document/types'

/** A 1×1 transparent PNG, small enough to inline. */
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function seed(): { boardA: NodeId; boardB: NodeId } {
  replaceDocument(createDocument('Clip', false))
  const boardA = createArtboard('A', { x: 0, y: 0, width: 400, height: 300 })
  const boardB = createArtboard('B', { x: 1000, y: 0, width: 200, height: 200 })
  transaction('seed', (draft) => {
    addNode(draft, boardA, draft.rootId)
    addNode(draft, boardB, draft.rootId)
  })
  setSelection([])
  setEditor({ editingContext: null })
  clearClipboard()
  return { boardA: boardA.id, boardB: boardB.id }
}

describe('externalPasteTarget', () => {
  let boards: { boardA: NodeId; boardB: NodeId }
  beforeEach(() => {
    boards = seed()
  })

  it('centres on the selected artboard', () => {
    setSelection([boards.boardB])
    expect(externalPasteTarget()).toEqual({ x: 1100, y: 100 })
  })

  it('centres on the artboard the selection lives in, not the child', () => {
    const rect = createRect({ x: 10, y: 10, width: 20, height: 20 })
    transaction('add', (draft) => { addNode(draft, rect, boards.boardA) })
    setSelection([rect.id])
    expect(externalPasteTarget()).toEqual({ x: 200, y: 150 })
  })

  it('prefers the container the user has entered', () => {
    setSelection([boards.boardA])
    enterGroup(boards.boardB)
    expect(externalPasteTarget()).toEqual({ x: 1100, y: 100 })
  })

  it('falls back to the artboard under the viewport centre', () => {
    setSelection([])
    // Scrolled so the middle of the canvas sits over artboard B.
    setEditor({ viewport: { x: -1050, y: 50, zoom: 1 }, canvasSize: { width: 100, height: 100 } })
    expect(externalPasteTarget()).toEqual({ x: 1100, y: 100 })
  })

  it('falls back to the viewport centre over bare pasteboard', () => {
    setSelection([])
    // Nothing under the middle of the canvas: doc (2000,2000) is past both.
    setEditor({ viewport: { x: -1950, y: -1950, zoom: 1 }, canvasSize: { width: 100, height: 100 } })
    expect(externalPasteTarget()).toEqual({ x: 2000, y: 2000 })
  })
})

describe('pasting outside content', () => {
  let boards: { boardA: NodeId; boardB: NodeId }
  beforeEach(() => {
    boards = seed()
  })

  it('makes a text object from plain text, in the selected artboard', async () => {
    setSelection([boards.boardB])
    const created = await importClipboardPayload(
      { files: [], text: 'Hello from somewhere else' },
      externalPasteTarget(),
    )
    expect(created).toHaveLength(1)

    const node = getDoc().nodes[created![0]!]!
    expect(node.type).toBe('text')
    expect(node.parentId).toBe(boards.boardB)
    expect('text' in node && node.text).toBe('Hello from somewhere else')
    expect('textStyle' in node && node.textStyle.sizing).toBe('auto-height')
  })

  it('centres the text box on the target rather than hanging off it', async () => {
    setSelection([boards.boardB])
    const created = await importClipboardPayload({ files: [], text: 'Centre me' }, externalPasteTarget())
    const node = getDoc().nodes[created![0]!]!
    // Artboard B spans (1000,0)–(1200,200); its centre is (1100,100), and the
    // box is parented to it so its transform is artboard-local.
    expect(node.transform.x + node.transform.width / 2).toBeCloseTo(100, 5)
    expect(node.transform.y + node.transform.height / 2).toBeCloseTo(100, 5)
  })

  it('trims a trailing newline instead of leaving an empty last line', async () => {
    const created = await importClipboardPayload({ files: [], text: 'One\r\nTwo\n\n' }, { x: 200, y: 150 })
    const node = getDoc().nodes[created![0]!]!
    expect('text' in node && node.text).toBe('One\nTwo')
  })

  it('makes an image from a data URL on the clipboard', async () => {
    setSelection([boards.boardA])
    const created = await importClipboardPayload({ files: [], text: PNG_DATA_URL }, externalPasteTarget())
    expect(created).toHaveLength(1)

    const doc = getDoc()
    const node = doc.nodes[created![0]!]!
    expect(node.type).toBe('image')
    expect(node.parentId).toBe(boards.boardA)
    expect('assetId' in node && doc.assets[node.assetId]?.dataUrl).toBe(PNG_DATA_URL)
  })

  it('makes real nodes from SVG markup, not an image', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40"/></svg>'
    const created = await importClipboardPayload({ files: [], text: svg }, { x: 200, y: 150 })
    expect(created).toHaveLength(1)
    expect(getDoc().nodes[created![0]!]!.type).not.toBe('image')
  })

  it('reports nothing usable rather than creating an empty object', async () => {
    expect(await importClipboardPayload({ files: [], text: '   ' }, { x: 0, y: 0 })).toBeNull()
    expect(await importClipboardPayload({ files: [], text: null }, { x: 0, y: 0 })).toBeNull()
  })

  it('undoes a pasted image in one step, asset and all', async () => {
    const before = Object.keys(getDoc().nodes).length
    const created = await importClipboardPayload({ files: [], text: PNG_DATA_URL }, { x: 200, y: 150 })
    expect(Object.keys(getDoc().assets)).toHaveLength(1)

    undo()
    expect(getDoc().nodes[created![0]!]).toBeUndefined()
    expect(Object.keys(getDoc().nodes)).toHaveLength(before)
    expect(Object.keys(getDoc().assets)).toHaveLength(0)
  })
})

describe('the internal clipboard keeps its own copies', () => {
  let boards: { boardA: NodeId; boardB: NodeId }
  beforeEach(() => {
    boards = seed()
  })

  it('stamps each copy with an id, so a paste can recognise our own markup', () => {
    expect(currentClipId()).toBeNull()

    const rect = createRect({ x: 10, y: 10, width: 20, height: 20 })
    transaction('add', (draft) => { addNode(draft, rect, boards.boardA) })
    setSelection([rect.id])
    expect(copySelection()).toBe(true)

    const first = currentClipId()
    expect(first).toMatch(/^clip[a-z0-9]+$/)

    copySelection()
    expect(currentClipId()).not.toBe(first)
  })

  it('centres a paste on the point it was given', () => {
    const rect = createRect({ x: 0, y: 0, width: 40, height: 40 })
    transaction('add', (draft) => { addNode(draft, rect, boards.boardA) })
    setSelection([rect.id])
    copySelection()

    const created = paste({ x: 200, y: 150 })
    expect(created).toHaveLength(1)
    const node = getDoc().nodes[created[0]!]!
    // Local to artboard A, whose origin is the document origin.
    expect(node.transform.x + node.transform.width / 2).toBeCloseTo(200, 5)
    expect(node.transform.y + node.transform.height / 2).toBeCloseTo(150, 5)
  })

  it('cascades a paste with no point, and keeps it in the source artboard', () => {
    const rect = createRect({ x: 100, y: 100, width: 40, height: 40 })
    transaction('add', (draft) => { addNode(draft, rect, boards.boardA) })
    setSelection([rect.id])
    copySelection()

    const created = paste()
    const node = getDoc().nodes[created[0]!]!
    expect(node.parentId).toBe(boards.boardA)
    expect(node.transform.x).toBeCloseTo(114, 5)
    expect(node.transform.y).toBeCloseTo(114, 5)
  })

  it('keeps a copy straddling an artboard edge on that artboard', () => {
    // Hanging off the left edge: the top-left corner is over bare pasteboard
    // but most of the object is not, so the artboard is the honest parent.
    const rect = createRect({ x: -30, y: 100, width: 80, height: 80 })
    transaction('add', (draft) => { addNode(draft, rect, boards.boardA) })
    setSelection([rect.id])
    copySelection()

    const created = paste()
    expect(created).toHaveLength(1)
    expect(getDoc().nodes[created[0]!]!.parentId).toBe(boards.boardA)
  })

  it('pastes nothing when nothing was copied', () => {
    expect(paste()).toEqual([])
    expect(editorStore.getState().selection).toEqual([])
  })
})

describe('pasting a copied artboard', () => {
  let first: NodeId
  let content: NodeId

  beforeEach(() => {
    replaceDocument(createDocument('Boards', false))
    const one = createArtboard('Artboard 1', { x: 0, y: 0, width: 400, height: 300 })
    const two = createArtboard('Artboard 2', { x: 480, y: 0, width: 200, height: 200 })
    const rect = createRect({ x: 10, y: 20, width: 30, height: 40 })
    transaction('seed', (draft) => {
      addNode(draft, one, draft.rootId)
      addNode(draft, two, draft.rootId)
      addNode(draft, rect, one.id)
    })
    first = one.id
    content = rect.id
    setEditor({ editingContext: null })
    clearClipboard()
    setSelection([first])
    copySelection()
  })

  const boardsNamed = (name: string) =>
    Object.values(getDoc().nodes).filter((n) => n.type === 'artboard' && n.name === name)

  it('lands on the root, never inside the artboard it was copied from', () => {
    const [id] = paste()
    const doc = getDoc()
    expect(doc.nodes[id!]!.parentId).toBe(doc.rootId)
    const original = doc.nodes[first]!
    expect(original.type === 'artboard' && original.children).toEqual([content])
    expect(editorStore.getState().selection).toEqual([id])
  })

  it('goes right of the original, past every artboard in the way', () => {
    // Artboard 1 is in the way at its own spot, Artboard 2 at 480 beside it.
    const [id] = paste()
    const t = getDoc().nodes[id!]!.transform
    expect(t.x).toBe(760)
    expect(t.y).toBe(0)
    expect([t.width, t.height]).toEqual([400, 300])
  })

  it('finds the next open spot on each paste', () => {
    const [a] = paste()
    const [b] = paste()
    expect(getDoc().nodes[a!]!.transform.x).toBe(760)
    expect(getDoc().nodes[b!]!.transform.x).toBe(1240)
  })

  it('ignores artboards in another row', () => {
    const below = createArtboard('Below', { x: 480, y: 400, width: 400, height: 300 })
    transaction('add', (draft) => { addNode(draft, below, draft.rootId) })
    // Only Artboard 2 is level with the copy; the one underneath is not in its way.
    const [id] = paste()
    expect(getDoc().nodes[id!]!.transform.x).toBe(760)
  })

  it('brings everything inside the artboard with it', () => {
    const [id] = paste()
    const doc = getDoc()
    const board = doc.nodes[id!]!
    expect(board.type).toBe('artboard')
    const children = board.type === 'artboard' ? board.children : []
    expect(children).toHaveLength(1)
    expect(children[0]).not.toBe(content)
    const child = doc.nodes[children[0]!]!
    expect(child.parentId).toBe(id)
    // Artboard-local, so it sits where it did on the original.
    expect([child.transform.x, child.transform.y]).toEqual([10, 20])
  })

  it('takes the first free artboard number', () => {
    const [a] = paste()
    const [b] = paste()
    expect(getDoc().nodes[a!]!.name).toBe('Artboard 3')
    expect(getDoc().nodes[b!]!.name).toBe('Artboard 4')
    expect(boardsNamed('Artboard 1')).toHaveLength(1)
  })

  it('fills a gap in the numbering', () => {
    transaction('rename', (draft) => { draft.nodes[first]!.name = 'Artboard 3' })
    setSelection([first])
    copySelection()
    // Artboard 2 and 3 exist; 1 is free.
    const [id] = paste()
    expect(getDoc().nodes[id!]!.name).toBe('Artboard 1')
  })

  it('is one undo step', () => {
    const before = Object.keys(getDoc().nodes).length
    paste()
    undo()
    expect(Object.keys(getDoc().nodes)).toHaveLength(before)
  })

  it('stays on the root while a group is entered', () => {
    enterGroup(first)
    const [id] = paste()
    expect(getDoc().nodes[id!]!.parentId).toBe(getDoc().rootId)
  })
})
