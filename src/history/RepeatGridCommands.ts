/**
 * Repeat Grid commands.
 *
 * A repeat grid holds ONE source cell and the renderer tiles it. That single
 * decision is what gives the feature its defining behaviour — edit any cell and
 * every cell changes, because there is only one copy of the content — and it
 * keeps a 10x10 grid the same size in the saved file as a single cell.
 *
 * "Expand" is the escape hatch: it materialises the tiling into real,
 * independent objects, which is the only way to make cells differ.
 */

import { invert, multiply, translation, type Mat2D } from '../geometry/Matrix'
import { unionAll } from '../geometry/Bounds'
import {
  addNode,
  cloneSubtree,
  removeNode,
  reparentNode,
  transformFromMatrix,
} from '../document/DocumentModel'
import { createGroup, createRepeatGrid } from '../document/NodeFactory'
import { geometryBounds, worldMatrix } from '../document/SceneGraph'
import { repeatGridOffsets, repeatGridSize, type NodeId, type RepeatGridNode } from '../document/types'
import { transaction, getDoc } from '../state/DocumentStore'
import { editorStore, notify, setSelection } from '../state/EditorStore'
import { editableSelection } from './Commands'

/** Keep the node's box in step with its rows, columns, cell size and gutters. */
function syncGridSize(grid: RepeatGridNode): void {
  const size = repeatGridSize(grid)
  grid.transform = {
    ...grid.transform,
    width: Math.max(1, size.width),
    height: Math.max(1, size.height),
  }
}

export function canCreateRepeatGrid(): boolean {
  const doc = getDoc()
  return editorStore
    .getState()
    .selection.some((id) => doc.nodes[id] && doc.nodes[id]!.type !== 'repeat-grid')
}

export function selectedRepeatGrid(): RepeatGridNode | null {
  const doc = getDoc()
  const ids = editorStore.getState().selection
  if (ids.length !== 1) return null
  const node = doc.nodes[ids[0]!]
  return node && node.type === 'repeat-grid' ? node : null
}

/**
 * Wrap the selection in a 1x1 repeat grid sized to its bounds.
 *
 * Starting at 1x1 rather than guessing a count matches how the feature is used:
 * you make the grid, then drag or type to add repeats.
 */
export function createRepeatGridFromSelection(): NodeId | null {
  const ids = editableSelection()
  if (ids.length === 0) {
    notify('warn', 'Select something to repeat first.')
    return null
  }

  const doc = getDoc()
  if (ids.length === 1 && doc.nodes[ids[0]!]?.type === 'repeat-grid') {
    notify('info', 'That is already a repeat grid.')
    return null
  }

  const bounds = unionAll(ids.map((id) => geometryBounds(doc, id)))
  if (bounds.width <= 0 || bounds.height <= 0) return null

  const parentId = doc.nodes[ids[0]!]?.parentId ?? doc.rootId
  const grid = createRepeatGrid([], { width: bounds.width, height: bounds.height })

  const ok = transaction('Repeat Grid', (draft) => {
    addNode(draft, grid, parentId)

    // Place the grid at the selection's world position, expressed in whatever
    // container it landed in.
    const parentWorld: Mat2D =
      parentId === draft.rootId ? [1, 0, 0, 1, 0, 0] : worldMatrix(draft, parentId)
    const local = multiply(invert(parentWorld), translation(bounds.x, bounds.y))
    const node = draft.nodes[grid.id]!
    node.transform = transformFromMatrix(local, bounds.width, bounds.height, 0, 0)

    // reparentNode preserves each child's world position, so the contents do
    // not shift when the grid appears around them.
    for (const id of ids) reparentNode(draft, id, grid.id)

    syncGridSize(draft.nodes[grid.id] as RepeatGridNode)
  })

  if (!ok) return null
  setSelection([grid.id])
  return grid.id
}

export interface RepeatGridPatch {
  rows?: number
  columns?: number
  gutterX?: number
  gutterY?: number
}

export function setRepeatGridParams(
  id: NodeId,
  patch: RepeatGridPatch,
  coalesceKey?: string,
): boolean {
  return transaction(
    'Repeat Grid',
    (draft) => {
      const node = draft.nodes[id]
      if (!node || node.type !== 'repeat-grid') return false
      if (patch.rows !== undefined) node.rows = Math.max(1, Math.round(patch.rows))
      if (patch.columns !== undefined) node.columns = Math.max(1, Math.round(patch.columns))
      // Gutters may be negative — overlapping repeats are a legitimate design.
      if (patch.gutterX !== undefined) node.gutterX = patch.gutterX
      if (patch.gutterY !== undefined) node.gutterY = patch.gutterY
      syncGridSize(node)
      return undefined
    },
    { coalesceKey },
  )
}

/**
 * Turn a repeat grid into ordinary objects: one independent copy per cell,
 * wrapped in a group. This is how you make cells differ from each other.
 */
export function expandRepeatGrid(id: NodeId): NodeId | null {
  const doc = getDoc()
  const grid = doc.nodes[id]
  if (!grid || grid.type !== 'repeat-grid') return null
  if (grid.children.length === 0) return null

  const offsets = repeatGridOffsets(grid)
  let groupId: NodeId | null = null

  const ok = transaction('Expand Repeat Grid', (draft) => {
    const source = draft.nodes[id]
    if (!source || source.type !== 'repeat-grid') return false

    const parentId = source.parentId ?? draft.rootId
    const parent = draft.nodes[parentId]
    const index = parent && 'children' in parent ? parent.children.indexOf(id) : -1

    const group = createGroup([], { ...source.transform })
    group.name = source.name
    addNode(draft, group, parentId, index < 0 ? undefined : index)

    for (const offset of offsets) {
      for (const childId of source.children) {
        const copyId = cloneSubtree(draft, childId)
        if (!copyId) continue
        const copy = draft.nodes[copyId]!
        copy.parentId = group.id
        group.children.push(copyId)
        copy.transform = {
          ...copy.transform,
          x: copy.transform.x + offset.x,
          y: copy.transform.y + offset.y,
        }
      }
    }

    removeNode(draft, id)
    groupId = group.id
  })

  if (!ok || !groupId) return null
  setSelection([groupId])
  notify('success', `Expanded into ${offsets.length} independent copies.`, undefined, 2500)
  return groupId
}
