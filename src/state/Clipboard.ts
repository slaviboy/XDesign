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
 */

import { addNode, cloneSubtree } from '../document/DocumentModel'
import { exportNodesToSvg } from '../svg/SvgExporter'
import { renderBoundsOfNodes, createMatrixCache, worldMatrix } from '../document/SceneGraph'
import { transaction, getDoc } from '../state/DocumentStore'
import { containerAtPoint } from '../history/Commands'
import { editorStore, notify, setSelection } from './EditorStore'
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
}

let internal: ClipboardPayload | null = null
/** Successive pastes of the same clip cascade instead of stacking exactly. */
let pasteCount = 0

export function hasClipboardContent(): boolean {
  return internal !== null
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
  internal = { nodes, rootIds: [...ids], assets, origin: { x: bounds.x, y: bounds.y } }
  pasteCount = 0

  void writeSystemClipboard(ids)
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

  const offset = at
    ? { x: at.x - clip.origin.x, y: at.y - clip.origin.y }
    : { x: pasteCount * 14, y: pasteCount * 14 }

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

      const parentId = containerAtPoint(draft, { x: node.transform.x, y: node.transform.y })
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
 * Mirror the copy to the system clipboard as SVG, so it can be pasted into
 * another app. Best-effort: clipboard permissions vary, and a failure here must
 * not affect the internal copy that already succeeded.
 */
async function writeSystemClipboard(ids: readonly NodeId[]): Promise<void> {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return
    const doc = getDoc()
    const bounds = renderBoundsOfNodes(doc, ids, createMatrixCache())
    const { svg } = await exportNodesToSvg(doc, ids, {
      bounds,
      imageHandling: 'embed',
      textHandling: 'reference',
    })
    await navigator.clipboard.writeText(svg)
  } catch {
    // Clipboard access denied or unavailable; the internal clipboard still works.
  }
}

export function clearClipboard(): void {
  internal = null
  pasteCount = 0
}

export { notify }
