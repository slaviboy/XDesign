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
 * Structural mutations over a document draft.
 *
 * Every function here mutates in place and is meant to be called inside an
 * immer producer (see state/DocumentStore.ts), which turns the mutation into
 * patches + inverse patches for undo. Nothing here touches React or the DOM.
 *
 * The subtle part of this file is preserving world position across reparenting.
 * Grouping must not move anything on screen, so a child's local transform is
 * re-expressed relative to its new parent rather than left alone.
 */

import { current, isDraft } from 'immer'
import {
  applyToVector,
  compose,
  decompose,
  invert,
  multiply,
  rotation as rotationMat,
  scaling,
  skewing,
  type Mat2D,
} from '../geometry/Matrix'
import { unionAll, type Bounds } from '../geometry/Bounds'
import { transformPath } from '../geometry/PathUtils'
import { createNodeId } from './ids'
import { geometryBounds, localMatrix, worldMatrix } from './SceneGraph'
import { createGroup } from './NodeFactory'
import {
  isContainer,
  type ContainerNode,
  type DesignDocument,
  type DesignNode,
  type NodeId,
  type Transform,
} from './types'

// ---------------------------------------------------------------------------
// Transform <-> matrix
// ---------------------------------------------------------------------------

/** The linear (non-translating) part of a Transform. */
export function linearPart(t: Pick<Transform, 'rotation' | 'scaleX' | 'scaleY' | 'skewX' | 'skewY'>): Mat2D {
  return compose(scaling(t.scaleX, t.scaleY), skewing(t.skewX, t.skewY), rotationMat(t.rotation))
}

/**
 * Solve for the Transform whose localMatrix() equals `m`.
 *
 * localMatrix expands to `T(x+c) · L · T(-c)`, so its translation column is
 * `x + c - L·c`. Inverting that for x gives the expression below. Getting this
 * wrong makes grouped objects jump by the origin offset the moment they are
 * grouped — subtle, and very visible.
 */
export function transformFromMatrix(
  m: Mat2D,
  width: number,
  height: number,
  originX = 0.5,
  originY = 0.5,
): Transform {
  const dec = decompose(m)
  const cx = originX * width
  const cy = originY * height
  const L = linearPart(dec)
  const Lc = applyToVector(L, { x: cx, y: cy })
  return {
    x: m[4] - cx + Lc.x,
    y: m[5] - cy + Lc.y,
    width,
    height,
    rotation: dec.rotation,
    scaleX: dec.scaleX,
    scaleY: dec.scaleY,
    skewX: dec.skewX,
    skewY: dec.skewY,
    originX,
    originY,
  }
}

/**
 * The same transform on a box of a different size, with nothing drawn in it
 * moved.
 *
 * A node turns and scales about a point of its box — originX/originY of its
 * width and height — so its matrix depends on the size: a new width moves the
 * pivot, and for a node that is turned or scaled, a moved pivot is a moved
 * node. Writing the size on its own is what made a rotated path jump the moment
 * a point edit was saved, by however far refitting the box moved its middle.
 *
 * Solved for x and y directly, from the same `x + c − L·c` expansion as
 * transformFromMatrix, rather than by decomposing a matrix: rotation, scale and
 * skew stay exactly the numbers they were, so nothing drifts however many edits
 * go through here.
 */
export function resizeBoxInPlace(t: Transform, width: number, height: number): Transform {
  // Holding x + c − L·c fixed while c becomes c′ gives x′ = x + d − L·d, where
  // d = c − c′ is how far the pivot moved in the node's own units.
  const d = { x: t.originX * (t.width - width), y: t.originY * (t.height - height) }
  const Ld = applyToVector(linearPart(t), d)
  return { ...t, width, height, x: t.x + d.x - Ld.x, y: t.y + d.y - Ld.y }
}

/** Rewrite a node's transform so its world matrix becomes `world`. */
export function setWorldMatrix(doc: DesignDocument, id: NodeId, world: Mat2D): void {
  const node = doc.nodes[id]
  if (!node) return
  const parentWorld = node.parentId ? worldMatrix(doc, node.parentId) : ([1, 0, 0, 1, 0, 0] as Mat2D)
  const local = multiply(invert(parentWorld), world)
  node.transform = transformFromMatrix(
    local,
    node.transform.width,
    node.transform.height,
    node.transform.originX,
    node.transform.originY,
  )
}

/** Left-multiply a node's world matrix by `m` — the primitive behind move/rotate/scale. */
export function applyMatrixToNode(doc: DesignDocument, id: NodeId, m: Mat2D): void {
  const current = worldMatrix(doc, id)
  setWorldMatrix(doc, id, multiply(m, current))
}

// ---------------------------------------------------------------------------
// Insertion / removal
// ---------------------------------------------------------------------------

export function getContainer(doc: DesignDocument, id: NodeId | null): ContainerNode | null {
  if (!id) return null
  const n = doc.nodes[id]
  return isContainer(n) ? n : null
}

export function addNode(
  doc: DesignDocument,
  node: DesignNode,
  parentId: NodeId = doc.rootId,
  index = -1,
): NodeId {
  const parent = getContainer(doc, parentId) ?? getContainer(doc, doc.rootId)
  if (!parent) return node.id
  node.parentId = parent.id
  doc.nodes[node.id] = node
  if (index < 0 || index >= parent.children.length) parent.children.push(node.id)
  else parent.children.splice(index, 0, node.id)
  return node.id
}

/** Remove a node and its whole subtree. */
export function removeNode(doc: DesignDocument, id: NodeId): void {
  const node = doc.nodes[id]
  if (!node || id === doc.rootId) return

  if (isContainer(node)) {
    for (const child of [...node.children]) removeNode(doc, child)
  }
  const parent = getContainer(doc, node.parentId)
  if (parent) {
    const i = parent.children.indexOf(id)
    if (i >= 0) parent.children.splice(i, 1)
  }
  delete doc.nodes[id]
}

export function removeNodes(doc: DesignDocument, ids: readonly NodeId[]): void {
  for (const id of ids) removeNode(doc, id)
}

/**
 * Move a node to a new parent while keeping it visually still.
 * The world matrix is captured before the move and restored after.
 */
export function reparentNode(
  doc: DesignDocument,
  id: NodeId,
  newParentId: NodeId,
  index = -1,
): void {
  const node = doc.nodes[id]
  const parent = getContainer(doc, newParentId)
  if (!node || !parent || id === doc.rootId) return
  // Refuse to move a node inside its own subtree.
  if (id === newParentId || isDescendant(doc, newParentId, id)) return

  const world = worldMatrix(doc, id)

  const old = getContainer(doc, node.parentId)
  if (old) {
    const i = old.children.indexOf(id)
    if (i >= 0) old.children.splice(i, 1)
  }
  node.parentId = parent.id
  if (index < 0 || index >= parent.children.length) parent.children.push(id)
  else parent.children.splice(index, 0, id)

  setWorldMatrix(doc, id, world)
}

export function isDescendant(doc: DesignDocument, candidate: NodeId, ancestor: NodeId): boolean {
  let cur: NodeId | null | undefined = doc.nodes[candidate]?.parentId
  const seen = new Set<NodeId>()
  while (cur && !seen.has(cur)) {
    if (cur === ancestor) return true
    seen.add(cur)
    cur = doc.nodes[cur]?.parentId
  }
  return false
}

// ---------------------------------------------------------------------------
// Z-order
// ---------------------------------------------------------------------------

export function moveToIndex(doc: DesignDocument, id: NodeId, index: number): void {
  const node = doc.nodes[id]
  const parent = getContainer(doc, node?.parentId ?? null)
  if (!parent) return
  const from = parent.children.indexOf(id)
  if (from < 0) return
  parent.children.splice(from, 1)
  const to = Math.max(0, Math.min(index, parent.children.length))
  parent.children.splice(to, 0, id)
}

/** Last in `children` paints on top, so "front" is the end of the array. */
export function bringToFront(doc: DesignDocument, ids: readonly NodeId[]): void {
  for (const id of orderedByDepth(doc, ids)) {
    const parent = getContainer(doc, doc.nodes[id]?.parentId ?? null)
    if (parent) moveToIndex(doc, id, parent.children.length)
  }
}

export function sendToBack(doc: DesignDocument, ids: readonly NodeId[]): void {
  for (const id of [...orderedByDepth(doc, ids)].reverse()) moveToIndex(doc, id, 0)
}

export function bringForward(doc: DesignDocument, ids: readonly NodeId[]): void {
  for (const id of [...orderedByDepth(doc, ids)].reverse()) {
    const parent = getContainer(doc, doc.nodes[id]?.parentId ?? null)
    if (!parent) continue
    const i = parent.children.indexOf(id)
    if (i >= 0 && i < parent.children.length - 1) moveToIndex(doc, id, i + 1)
  }
}

export function sendBackward(doc: DesignDocument, ids: readonly NodeId[]): void {
  for (const id of orderedByDepth(doc, ids)) {
    const parent = getContainer(doc, doc.nodes[id]?.parentId ?? null)
    if (!parent) continue
    const i = parent.children.indexOf(id)
    if (i > 0) moveToIndex(doc, id, i - 1)
  }
}

/** Sort ids by their position in their parent, so batch reordering is stable. */
function orderedByDepth(doc: DesignDocument, ids: readonly NodeId[]): NodeId[] {
  return [...ids].sort((a, b) => {
    const pa = getContainer(doc, doc.nodes[a]?.parentId ?? null)
    const pb = getContainer(doc, doc.nodes[b]?.parentId ?? null)
    if (pa && pb && pa.id === pb.id) return pa.children.indexOf(a) - pb.children.indexOf(b)
    return 0
  })
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

/**
 * Wrap nodes in a new group without moving them on screen.
 *
 * The group is created at the selection's world bounds and each child's local
 * transform is recomputed as `invert(groupWorld) · childWorld`, so grouping is
 * visually a no-op — which is what makes "group, rotate, ungroup" round-trip.
 */
export function groupNodes(doc: DesignDocument, ids: readonly NodeId[]): NodeId | null {
  const valid = ids.filter((id) => doc.nodes[id] && id !== doc.rootId)
  if (valid.length < 1) return null

  // Group inside the shallowest common parent, and at the topmost sibling's index.
  const firstParent = doc.nodes[valid[0]!]!.parentId ?? doc.rootId
  const sameParent = valid.every((id) => (doc.nodes[id]!.parentId ?? doc.rootId) === firstParent)
  const parentId = sameParent ? firstParent : doc.rootId
  const parent = getContainer(doc, parentId)
  if (!parent) return null

  const worlds = new Map<NodeId, Mat2D>()
  for (const id of valid) worlds.set(id, worldMatrix(doc, id))

  const bounds = unionAll(valid.map((id) => geometryBounds(doc, id)))

  let insertAt = parent.children.length
  for (const id of valid) {
    const i = parent.children.indexOf(id)
    if (i >= 0) insertAt = Math.min(insertAt, i)
  }

  const group = createGroup([], {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width || 1,
    height: bounds.height || 1,
  })
  // The group's x/y are in the parent's space, but bounds are in world space.
  addNode(doc, group, parentId, insertAt)
  const parentWorld = parentId === doc.rootId ? ([1, 0, 0, 1, 0, 0] as Mat2D) : worldMatrix(doc, parentId)
  group.transform = transformFromMatrix(
    multiply(invert(parentWorld), [1, 0, 0, 1, bounds.x, bounds.y]),
    bounds.width || 1,
    bounds.height || 1,
    0.5,
    0.5,
  )

  // Preserve paint order inside the group.
  const ordered = [...valid].sort((a, b) => {
    const pa = getContainer(doc, doc.nodes[a]!.parentId)
    const pb = getContainer(doc, doc.nodes[b]!.parentId)
    if (pa && pb && pa.id === pb.id) return pa.children.indexOf(a) - pb.children.indexOf(b)
    return 0
  })

  for (const id of ordered) {
    const node = doc.nodes[id]!
    const old = getContainer(doc, node.parentId)
    if (old) {
      const i = old.children.indexOf(id)
      if (i >= 0) old.children.splice(i, 1)
    }
    node.parentId = group.id
    group.children.push(id)
    setWorldMatrix(doc, id, worlds.get(id)!)
  }

  return group.id
}

/** Dissolve a group, lifting its children into the grandparent in place. */
export function ungroupNode(doc: DesignDocument, groupId: NodeId): NodeId[] {
  const group = doc.nodes[groupId]
  if (!group || !isContainer(group) || group.type === 'document') return []

  const parentId = group.parentId ?? doc.rootId
  const parent = getContainer(doc, parentId)
  if (!parent) return []

  const insertAt = Math.max(0, parent.children.indexOf(groupId))
  const kids = [...group.children]
  const worlds = new Map<NodeId, Mat2D>()
  for (const id of kids) worlds.set(id, worldMatrix(doc, id))

  // Remove the group from its parent but keep its children alive.
  const gi = parent.children.indexOf(groupId)
  if (gi >= 0) parent.children.splice(gi, 1)

  kids.forEach((id, i) => {
    const node = doc.nodes[id]
    if (!node) return
    node.parentId = parentId
    parent.children.splice(insertAt + i, 0, id)
  })

  group.children = []
  delete doc.nodes[groupId]

  for (const id of kids) setWorldMatrix(doc, id, worlds.get(id)!)
  return kids
}

// ---------------------------------------------------------------------------
// Duplication
// ---------------------------------------------------------------------------

/**
 * Deep-clone a node.
 *
 * structuredClone cannot be used here: inside a transaction these are immer
 * drafts (Proxy objects), and structuredClone throws DataCloneError on them —
 * silently breaking Duplicate and Paste. Unwrapping the draft first gives a
 * plain object that clones normally.
 */
function cloneNode(node: DesignNode): DesignNode {
  const plain = isDraft(node) ? (current(node as never) as DesignNode) : node
  return structuredClone(plain)
}

/** Deep-clone a subtree with fresh ids. Returns the new root id. */
export function cloneSubtree(
  doc: DesignDocument,
  id: NodeId,
  into: Record<NodeId, DesignNode> = doc.nodes,
): NodeId | null {
  const node = doc.nodes[id]
  if (!node) return null

  const copy: DesignNode = cloneNode(node)
  copy.id = createNodeId()

  if (isContainer(copy)) {
    const newChildren: NodeId[] = []
    // Old id -> new id, so a reference into the subtree can be re-pointed at
    // the copy rather than left aimed at the original.
    const remapped = new Map<NodeId, NodeId>()
    const originals = (node as ContainerNode).children
    for (const child of originals) {
      const cloned = cloneSubtree(doc, child, into)
      if (cloned) {
        into[cloned]!.parentId = copy.id
        remapped.set(child, cloned)
        newChildren.push(cloned)
      }
    }
    copy.children = newChildren

    // A mask group names one of its own children. Without this the copy points
    // at the ORIGINAL's mask, so duplicating a masked or clipped group gave two
    // groups sharing one mask — and deleting the first broke the second.
    if (copy.type === 'group' && copy.maskId) {
      const next = remapped.get(copy.maskId)
      if (next) copy.maskId = next
      else delete copy.maskId
    }
  }
  into[copy.id] = copy
  return copy.id
}

/** Duplicate nodes in place, offset by (dx, dy) in their parent's space. */
export function duplicateNodes(
  doc: DesignDocument,
  ids: readonly NodeId[],
  dx = 10,
  dy = 10,
): NodeId[] {
  const out: NodeId[] = []
  for (const id of ids) {
    const node = doc.nodes[id]
    if (!node) continue
    const cloneId = cloneSubtree(doc, id)
    if (!cloneId) continue
    const clone = doc.nodes[cloneId]!
    clone.parentId = node.parentId
    clone.name = nextCopyName(doc, node.name)
    clone.transform = { ...clone.transform, x: clone.transform.x + dx, y: clone.transform.y + dy }
    const parent = getContainer(doc, node.parentId)
    if (parent) {
      const i = parent.children.indexOf(id)
      parent.children.splice(i < 0 ? parent.children.length : i + 1, 0, cloneId)
    }
    out.push(cloneId)
  }
  return out
}

function nextCopyName(doc: DesignDocument, base: string): string {
  const stem = base.replace(/\s+\d+$/, '')
  let n = 1
  const taken = new Set(Object.values(doc.nodes).map((x) => x.name))
  let candidate = `${stem} ${n}`
  while (taken.has(candidate)) candidate = `${stem} ${++n}`
  return candidate
}

// ---------------------------------------------------------------------------
// Alignment and distribution
// ---------------------------------------------------------------------------

export type AlignMode = 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom'
export type DistributeMode = 'horizontal' | 'vertical'

/**
 * Align nodes to the union of their bounds, or to an artboard when a single node
 * is selected inside one (matching XD, where aligning one object aligns it to
 * its artboard rather than to itself, which would be a no-op).
 */
export function alignNodes(
  doc: DesignDocument,
  ids: readonly NodeId[],
  mode: AlignMode,
  frame?: Bounds,
): void {
  if (ids.length === 0) return
  const boxes = new Map<NodeId, Bounds>()
  for (const id of ids) boxes.set(id, geometryBounds(doc, id))
  const target = frame ?? unionAll([...boxes.values()])

  for (const id of ids) {
    const b = boxes.get(id)!
    let dx = 0
    let dy = 0
    switch (mode) {
      case 'left': dx = target.x - b.x; break
      case 'right': dx = target.x + target.width - (b.x + b.width); break
      case 'center-h': dx = target.x + target.width / 2 - (b.x + b.width / 2); break
      case 'top': dy = target.y - b.y; break
      case 'bottom': dy = target.y + target.height - (b.y + b.height); break
      case 'center-v': dy = target.y + target.height / 2 - (b.y + b.height / 2); break
    }
    if (dx !== 0 || dy !== 0) applyMatrixToNode(doc, id, [1, 0, 0, 1, dx, dy])
  }
}

/**
 * Even spacing between the outermost two items.
 *
 * Distributes by *gap*, not by center, so items of different sizes end up with
 * equal visual space between them — the behaviour designers actually expect.
 * The first and last items never move.
 */
export function distributeNodes(
  doc: DesignDocument,
  ids: readonly NodeId[],
  mode: DistributeMode,
): void {
  if (ids.length < 3) return

  const items = ids
    .map((id) => ({ id, b: geometryBounds(doc, id) }))
    .sort((p, q) => (mode === 'horizontal' ? p.b.x - q.b.x : p.b.y - q.b.y))

  const first = items[0]!
  const last = items[items.length - 1]!
  const span =
    mode === 'horizontal'
      ? last.b.x + last.b.width - first.b.x
      : last.b.y + last.b.height - first.b.y
  const totalSize = items.reduce(
    (sum, it) => sum + (mode === 'horizontal' ? it.b.width : it.b.height),
    0,
  )
  const gap = (span - totalSize) / (items.length - 1)

  let cursor = mode === 'horizontal' ? first.b.x + first.b.width + gap : first.b.y + first.b.height + gap
  for (let i = 1; i < items.length - 1; i++) {
    const it = items[i]!
    if (mode === 'horizontal') {
      applyMatrixToNode(doc, it.id, [1, 0, 0, 1, cursor - it.b.x, 0])
      cursor += it.b.width + gap
    } else {
      applyMatrixToNode(doc, it.id, [1, 0, 0, 1, 0, cursor - it.b.y])
      cursor += it.b.height + gap
    }
  }
}

// ---------------------------------------------------------------------------
// Flips
// ---------------------------------------------------------------------------

/**
 * Flip about the center of the combined selection.
 *
 * A single node flips in place by negating its own scale; a multi-selection
 * mirrors positions about the shared center as well, which is what makes
 * flipping a group of objects behave like flipping one object.
 */
export function flipNodes(doc: DesignDocument, ids: readonly NodeId[], axis: 'h' | 'v'): void {
  if (ids.length === 0) return
  const box = unionAll(ids.map((id) => geometryBounds(doc, id)))
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const m: Mat2D =
    axis === 'h' ? [-1, 0, 0, 1, 2 * cx, 0] : [1, 0, 0, -1, 0, 2 * cy]

  for (const id of ids) {
    const node = doc.nodes[id]
    if (!node) continue
    if (node.type === 'path') {
      // Flipping a path's matrix would leave a negative scale that fights later
      // edits, so bake the mirror into the geometry instead. Everything else
      // keeps a clean non-destructive transform.
      const world = worldMatrix(doc, id)
      const local = compose(invert(world), m, world)
      node.d = transformPath(node.d, local)
      continue
    }
    applyMatrixToNode(doc, id, m)
  }
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

/**
 * Turn a parametric shape into a real path, IN PLACE.
 *
 * The node keeps its id, and that is the whole point: `createPath` mints a fresh
 * one, which would orphan the selection, `nodeEditingId`, `selectedPoints`, the
 * Layers panel's state and any boolean-op back-reference. Deleting the
 * type-specific fields on an immer draft emits `remove` patches, so undo puts
 * the rectangle back exactly as it was.
 *
 * The layer name is deliberately kept — silently renaming someone's "Rectangle"
 * to "Path" is the same mistake the legacy-shape migration avoids.
 *
 * @returns false for a node that has no outline to convert.
 */
export function convertNodeToPath(node: DesignNode, d: string, closed: boolean): boolean {
  const shape = node as DesignNode & Record<string, unknown>
  switch (node.type) {
    case 'path':
      return true
    case 'rect':
      delete shape.cornerRadius
      break
    case 'polygon':
      delete shape.sides
      delete shape.starRatio
      delete shape.cornerRadius
      break
    case 'line':
      delete shape.x1
      delete shape.y1
      delete shape.x2
      delete shape.y2
      break
    case 'ellipse':
      break
    default:
      return false
  }
  shape.type = 'path'
  shape.d = d
  shape.closed = closed
  return true
}

export function setNodeName(doc: DesignDocument, id: NodeId, name: string): void {
  const node = doc.nodes[id]
  if (node) node.name = name.trim() || node.name
}

export function touch(doc: DesignDocument): void {
  doc.modifiedAt = Date.now()
}

export { localMatrix }
