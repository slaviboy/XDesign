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
 * Boolean operations as document commands.
 *
 * Operands are transformed into a common world space before clipping, then the
 * result is rebased so the new node's local origin is at its own bounding box —
 * the same convention every other node follows.
 *
 * The result keeps the appearance of the bottom-most operand, matching how every
 * vector tool behaves, and the operand path data is recorded on the result so
 * the operation stays inspectable after the fact.
 */

import { booleanOp, type BooleanOperation } from '../geometry/BooleanOps'
import { pathBounds, transformPath } from '../geometry/PathUtils'
import { translation } from '../geometry/Matrix'
import { nodePathData, worldMatrix, createMatrixCache, isEffectivelyLocked } from '../document/SceneGraph'
import { addNode, removeNodes, transformFromMatrix } from '../document/DocumentModel'
import { createPath } from '../document/NodeFactory'
import { transaction, getDoc } from '../state/DocumentStore'
import { editorStore, notify, setSelection } from '../state/EditorStore'
import { isShape, type NodeId } from '../document/types'

const LABELS: Record<BooleanOperation, string> = {
  union: 'Union',
  subtract: 'Subtract',
  intersect: 'Intersect',
  exclude: 'Exclude',
}

export function canRunBoolean(): boolean {
  const doc = getDoc()
  const ids = editorStore.getState().selection.filter((id) => isShape(doc.nodes[id]))
  return ids.length >= 2
}

export async function runBooleanOperation(op: BooleanOperation): Promise<NodeId | null> {
  const doc = getDoc()
  const cache = createMatrixCache()

  // Operate in paint order so "bottom shape wins" is well defined.
  const root = doc.nodes[doc.rootId]
  const order = new Map<NodeId, number>()
  let counter = 0
  const walkOrder = (id: NodeId) => {
    const node = doc.nodes[id]
    if (!node) return
    order.set(id, counter++)
    if ('children' in node) for (const c of node.children) walkOrder(c)
  }
  if (root && 'children' in root) for (const c of root.children) walkOrder(c)

  const ids = editorStore
    .getState()
    .selection.filter((id) => isShape(doc.nodes[id]) && !isEffectivelyLocked(doc, id))
    .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))

  if (ids.length < 2) {
    notify('warn', 'Select at least two shapes to combine.')
    return null
  }

  // Everything must be in one coordinate space before clipping.
  const worldPaths: string[] = []
  for (const id of ids) {
    const node = doc.nodes[id]!
    const d = nodePathData(node)
    if (!d) continue
    worldPaths.push(transformPath(d, cache.world(doc, id)))
  }
  if (worldPaths.length < 2) {
    notify('warn', 'Those shapes cannot be combined.')
    return null
  }

  const bottom = doc.nodes[ids[0]!]!
  const fillRule = 'style' in bottom ? bottom.style.fillRule : 'nonzero'

  const result = await booleanOp(op, worldPaths, fillRule)
  if (!result || !result.d.trim()) {
    notify('warn', `${LABELS[op]} produced an empty result.`)
    return null
  }

  if (result.approximated) {
    notify(
      'warn',
      'Curves were flattened to line segments for this operation.',
      'The precise path engine was unavailable, so the result is an approximation.',
      8000,
    )
  }

  const bounds = pathBounds(result.d)
  if (bounds.width <= 0 && bounds.height <= 0) {
    notify('warn', `${LABELS[op]} produced an empty result.`)
    return null
  }

  const localD = transformPath(result.d, translation(-bounds.x, -bounds.y))
  // `bottom` comes from getDoc(), which is already a plain snapshot.
  const style = 'style' in bottom ? structuredClone(bottom.style) : undefined

  const node = createPath(
    localD,
    transformFromMatrix(
      translation(bounds.x, bounds.y),
      Math.max(0.5, bounds.width),
      Math.max(0.5, bounds.height),
      0.5,
      0.5,
    ),
    style,
    true,
  )
  node.name = LABELS[op]
  node.booleanOp = op
  node.booleanSources = worldPaths

  const parentId = bottom.parentId ?? doc.rootId

  const ok = transaction(LABELS[op], (draft) => {
    // The bottom operand's index keeps the result in the same stacking position.
    const parent = draft.nodes[parentId]
    const index =
      parent && 'children' in parent ? parent.children.indexOf(bottom.id) : -1
    removeNodes(draft, ids)
    addNode(draft, node, parentId, index)
  })

  if (!ok) return null
  setSelection([node.id])
  return node.id
}

export { worldMatrix }
