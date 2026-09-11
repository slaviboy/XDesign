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
 * Copy / cut / paste.
 *
 * An internal clipboard holds a full-fidelity subtree — transforms, gradients,
 * groups, image assets, everything — because a round trip through the system
 * clipboard would flatten all of that to markup. The system clipboard is written
 * in parallel as SVG text so a copy can also be pasted into another application.
 *
 * Pasted assets are re-added to the target document, so pasting an image into a
 * different document carries the pixels with it rather than leaving a dangling
 * reference.
 *
 * Every copy carries a `clipId`, which SystemClipboard stamps into the SVG it
 * writes to the OS clipboard. That stamp is what lets a paste tell our own
 * markup apart from a foreign application's: reading back our own SVG instead of
 * the payload below would flatten exactly the fidelity this module exists to
 * keep.
 */

import { addNode, cloneSubtree, nextCopyName } from '../document/DocumentModel'
import {
  artboardAtPoint, artboardIds, artboardOf, createMatrixCache, geometryBounds, renderBoundsOfNodes,
  worldMatrix,
} from '../document/SceneGraph'
import { unionAll, type Bounds } from '../geometry/Bounds'
import { transaction, getDoc } from '../state/DocumentStore'
import { containerAtPoint } from '../history/Commands'
import { editorStore, notify, setSelection } from './EditorStore'
import { screenToDoc } from '../canvas/Viewport'
import { createId } from '../document/ids'
import { isContainer } from '../document/types'
import { invert, multiply, type Mat2D } from '../geometry/Matrix'
import { transformFromMatrix } from '../document/DocumentModel'
import type { DesignNode, ImageAsset, NodeId } from '../document/types'
import type { Vec2 } from '../geometry/Matrix'

interface ClipboardPayload {
  nodes: Record<NodeId, DesignNode>
  rootIds: NodeId[]
  assets: ImageAsset[]
  /** World-space top-left of the copied set, so paste can offset predictably. */
  origin: Vec2
  /** World-space size of the copied set, so a paste at a point can centre on it. */
  size: { width: number; height: number }
  /** Identifies this copy in the SVG written to the OS clipboard. */
  clipId: string
}

let internal: ClipboardPayload | null = null
/** Successive pastes of the same clip cascade instead of stacking exactly. */
let pasteCount = 0

/**
 * Set by copySelection, cleared by SystemClipboard when a native `copy` event
 * takes over the write. Without this the two would race to write the clipboard
 * and the plain writeText could land last, clobbering the richer flavours.
 */
let pendingSystemWrite: readonly NodeId[] | null = null

export function hasClipboardContent(): boolean {
  return internal !== null
}

/** The id stamped into the SVG of the copy currently on the clipboard. */
export function currentClipId(): string | null {
  return internal?.clipId ?? null
}

/**
 * Called by SystemClipboard when a native `copy`/`cut` event is writing the
 * flavours itself, so the deferred fallback below stays out of its way.
 */
export function claimSystemWrite(): readonly NodeId[] | null {
  const ids = pendingSystemWrite
  pendingSystemWrite = null
  return ids
}

/**
 * Writes the OS clipboard. Registered by SystemClipboard at startup rather than
 * imported, because that module imports this one and a cycle between them would
 * be a real one — both have module-level state that has to initialise.
 */
type SystemWriter = (ids: readonly NodeId[]) => void
let systemWriter: SystemWriter | null = null

export function setSystemClipboardWriter(writer: SystemWriter | null): void {
  systemWriter = writer
}

export function copySelection(): boolean {
  const doc = getDoc()
  const ids = editorStore.getState().selection.filter((id) => doc.nodes[id])
  if (ids.length === 0) return false

  const nodes: Record<NodeId, DesignNode> = {}
  const assets: ImageAsset[] = []
  const seenAssets = new Set<string>()

  const collect = (id: NodeId) => {
    const node = doc.nodes[id]
    if (!node) return
    nodes[id] = structuredClone(node)
    if (node.type === 'image' && !seenAssets.has(node.assetId)) {
      const asset = doc.assets[node.assetId]
      if (asset) {
        assets.push(structuredClone(asset))
        seenAssets.add(node.assetId)
      }
    }
    if ('children' in node) for (const c of node.children) collect(c)
  }
  for (const id of ids) collect(id)

  // Copied roots keep their world position so paste can place them relative to
  // one another regardless of what they were nested inside.
  for (const id of ids) {
    const world = worldMatrix(doc, id)
    const node = nodes[id]!
    node.parentId = null
    node.transform = transformFromMatrix(
      world,
      node.transform.width,
      node.transform.height,
      node.transform.originX,
      node.transform.originY,
    )
  }

  const bounds = renderBoundsOfNodes(doc, ids, createMatrixCache())
  internal = {
    nodes,
    rootIds: [...ids],
    assets,
    origin: { x: bounds.x, y: bounds.y },
    size: { width: bounds.width, height: bounds.height },
    clipId: createId('clip'),
  }
  pasteCount = 0

  // Deferred rather than immediate: a keyboard copy is followed a tick later by
  // the native `copy` event, which writes the flavours itself and claims the
  // write. Only a copy with no native event behind it — the menu entries — gets
  // as far as the timer.
  pendingSystemWrite = internal.rootIds
  setTimeout(() => {
    const pending = claimSystemWrite()
    if (pending) systemWriter?.(pending)
  }, 0)
  return true
}

export function cutSelection(): boolean {
  if (!copySelection()) return false
  const ids = editorStore.getState().selection
  const ok = transaction('Cut', (draft) => {
    for (const id of ids) {
      const node = draft.nodes[id]
      if (!node) continue
      const parent = node.parentId ? draft.nodes[node.parentId] : null
      if (parent && 'children' in parent) {
        const i = parent.children.indexOf(id)
        if (i >= 0) parent.children.splice(i, 1)
      }
      const remove = (target: NodeId) => {
        const n = draft.nodes[target]
        if (!n) return
        if ('children' in n) for (const c of [...n.children]) remove(c)
        delete draft.nodes[target]
      }
      remove(id)
    }
  })
  if (ok) setSelection([])
  return ok
}

/**
 * Paste the internal clipboard.
 * @param at world point to center on; without it, the paste cascades from the
 *           original position so repeated pastes do not land on top of each other.
 */
export function paste(at?: Vec2): NodeId[] {
  if (!internal) return []
  const clip = internal
  pasteCount++

  const boardRoots = clip.rootIds.filter((id) => clip.nodes[id]?.type === 'artboard')

  // `at` is the centre of where the clip should land — the point under the
  // pointer for a right-click paste. Putting the clip's top-left there instead
  // would drop it down and to the right of where it was asked for. Artboards
  // never cascade: they look for open canvas instead, below.
  const offset = at
    ? {
        x: at.x - (clip.origin.x + clip.size.width / 2),
        y: at.y - (clip.origin.y + clip.size.height / 2),
      }
    : boardRoots.length > 0
      ? { x: 0, y: 0 }
      : { x: pasteCount * 14, y: pasteCount * 14 }

  if (boardRoots.length > 0) {
    // Artboards may not overlap, so the copy slides right past any in its way.
    // Everything else in the clip moves with it and keeps its arrangement.
    const cache = createMatrixCache()
    const clipDoc = { ...getDoc(), nodes: clip.nodes }
    const rect = unionAll(boardRoots.map((id) => geometryBounds(clipDoc, id, cache)))
    const wanted = { ...rect, x: rect.x + offset.x, y: rect.y + offset.y }
    offset.x += clearOfArtboards(wanted) - wanted.x
  }

  const created: NodeId[] = []

  transaction('Paste', (draft) => {
    for (const asset of clip.assets) {
      if (!draft.assets[asset.id]) draft.assets[asset.id] = structuredClone(asset)
    }

    // A scratch document containing just the clipboard subtree, so cloneSubtree
    // can renumber ids without touching the live document.
    const scratch = {
      ...draft,
      nodes: { ...clip.nodes },
    }

    for (const rootId of clip.rootIds) {
      const newId = cloneSubtree(scratch as typeof draft, rootId, scratch.nodes)
      if (!newId) continue
      const isBoard = scratch.nodes[newId]!.type === 'artboard'

      // Two artboards sharing a name are two export files fighting over one
      // filename. Named before moving in, so the copy does not count as its
      // own rival and push a paste into another document off its number.
      if (isBoard) scratch.nodes[newId]!.name = nextCopyName(draft, scratch.nodes[newId]!.name)

      // Move the whole cloned subtree into the real document.
      const moveIn = (id: NodeId) => {
        const node = scratch.nodes[id]
        if (!node) return
        draft.nodes[id] = node
        if ('children' in node) for (const c of node.children) moveIn(c)
      }
      moveIn(newId)

      const node = draft.nodes[newId]!
      node.transform = {
        ...node.transform,
        x: node.transform.x + offset.x,
        y: node.transform.y + offset.y,
      }

      // The centre, not the top-left: a copy cascaded past an artboard's right
      // or bottom edge would otherwise be parented to the pasteboard even though
      // almost all of it is still over the artboard. An artboard only ever sits
      // on the root — nested in another it is listed in Layers but never drawn.
      const parentId = isBoard
        ? draft.rootId
        : containerAtPoint(draft, {
            x: node.transform.x + node.transform.width / 2,
            y: node.transform.y + node.transform.height / 2,
          })
      addNode(draft, node, parentId)

      if (parentId !== draft.rootId) {
        const parentWorld: Mat2D = worldMatrix(draft, parentId)
        const world: Mat2D = [1, 0, 0, 1, node.transform.x, node.transform.y]
        const local = multiply(invert(parentWorld), world)
        node.transform = { ...node.transform, x: local[4], y: local[5] }
      }
      created.push(newId)
    }
  })

  if (created.length) setSelection(created)
  return created
}

/** Space kept between a pasted artboard and its neighbours, as New Artboard leaves. */
const ARTBOARD_GAP = 80

/**
 * The left edge nearest `rect.x`, moving right, at which `rect` overlaps no
 * artboard and keeps ARTBOARD_GAP from those beside it. Its own spot when that
 * is free — a cut artboard pastes back where it was — else past whatever is in
 * the way, again and again, until the row opens up.
 */
function clearOfArtboards(rect: Bounds): number {
  const doc = getDoc()
  const cache = createMatrixCache()
  const boards = artboardIds(doc).map((id) => geometryBounds(doc, id, cache))
  let x = rect.x
  for (;;) {
    const blocking = boards.filter(
      (b) =>
        b.x < x + rect.width + ARTBOARD_GAP &&
        x < b.x + b.width + ARTBOARD_GAP &&
        b.y < rect.y + rect.height &&
        rect.y < b.y + b.height,
    )
    if (blocking.length === 0) return x
    x = Math.max(...blocking.map((b) => b.x + b.width)) + ARTBOARD_GAP
  }
}

/** Duplicate in place — Cmd+D, independent of the clipboard. */
export function duplicateInPlace(): NodeId[] {
  const ids = editorStore.getState().selection
  if (ids.length === 0) return []
  const created: NodeId[] = []
  transaction('Duplicate', (draft) => {
    for (const id of ids) {
      const source = draft.nodes[id]
      if (!source) continue
      const cloneId = cloneSubtree(draft, id)
      if (!cloneId) continue
      const clone = draft.nodes[cloneId]!
      clone.parentId = source.parentId
      clone.transform = { ...clone.transform, x: clone.transform.x + 10, y: clone.transform.y + 10 }
      const parent = source.parentId ? draft.nodes[source.parentId] : null
      if (parent && 'children' in parent) {
        const i = parent.children.indexOf(id)
        parent.children.splice(i < 0 ? parent.children.length : i + 1, 0, cloneId)
      }
      created.push(cloneId)
    }
  })
  if (created.length) setSelection(created)
  return created
}

/**
 * Where content arriving from another application should land.
 *
 * "The artboard I am working in" is not a field anywhere — this derives it the
 * way the rest of the app does, from the selection first and the viewport
 * second. The returned point is the centre to place on; because it lies inside
 * the artboard, `containerAtPoint` then parents the new nodes to it without
 * needing to be told.
 */
export function externalPasteTarget(): Vec2 {
  const doc = getDoc()
  const editor = editorStore.getState()
  const cache = createMatrixCache()
  const centreOf = (id: NodeId): Vec2 => {
    const b = geometryBounds(doc, id, cache)
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  }

  // Inside a group or artboard the user has entered, that is the context.
  const editing = editor.editingContext
  if (editing && isContainer(doc.nodes[editing])) return centreOf(editing)

  // Otherwise the artboard the selection lives in.
  for (const id of editor.selection) {
    const board = doc.nodes[id] ? artboardOf(doc, id) : null
    if (board) return centreOf(board)
  }

  const viewCentre = screenToDoc(editor.viewport, {
    x: editor.canvasSize.width / 2,
    y: editor.canvasSize.height / 2,
  })

  // Nothing selected: the artboard the user is looking at, else the pasteboard.
  const under = artboardAtPoint(doc, viewCentre)
  return under ? centreOf(under) : viewCentre
}

export function clearClipboard(): void {
  internal = null
  pasteCount = 0
  pendingSystemWrite = null
}

export { notify }
