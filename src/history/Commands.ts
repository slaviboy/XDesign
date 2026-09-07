/**
 * High-level editor commands.
 *
 * Every user-visible action funnels through here so that the keyboard, the menus,
 * the context menu and the inspector all produce identical, undoable results.
 * Each command opens exactly one transaction, which is what makes undo behave the
 * way a designer expects (one Cmd+Z per action, not per internal mutation).
 */

import { transaction, getDoc } from '../state/DocumentStore'
import {
  clearSelection,
  editorStore,
  notify,
  setSelection,
  type ToolId,
} from '../state/EditorStore'
import {
  addNode,
  alignNodes,
  applyMatrixToNode,
  bringForward,
  bringToFront,
  distributeNodes,
  duplicateNodes,
  flipNodes,
  groupNodes,
  removeNodes,
  reparentNode,
  sendBackward,
  sendToBack,
  setWorldMatrix,
  transformFromMatrix,
  ungroupNode,
  type AlignMode,
  type DistributeMode,
} from '../document/DocumentModel'
import {
  artboardIds,
  boundsOfNodes,
  geometryBounds,
  isEffectivelyLocked,
  worldMatrix,
} from '../document/SceneGraph'
import { createArtboard, createGroup } from '../document/NodeFactory'
import { current, isDraft } from 'immer'
import { invert, multiply, rotationAbout, type Mat2D } from '../geometry/Matrix'
import { center, containsPoint, type Bounds } from '../geometry/Bounds'
import type {
  DesignDocument,
  DesignNode,
  NodeId,
  Paint,
  Stroke,
  Style,
  TextStyle,
  Transform,
} from '../document/types'
import {
  cornerIndex,
  hasScalarCornerRadius,
  hasStyle,
  isContainer,
  type BoxCorner,
} from '../document/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Selection filtered to nodes that can actually be edited. */
export function editableSelection(): NodeId[] {
  const doc = getDoc()
  return editorStore
    .getState()
    .selection.filter((id) => doc.nodes[id] && !isEffectivelyLocked(doc, id))
}

/**
 * Which container a new node should land in.
 *
 * Drawing inside an artboard should parent to that artboard so the shape moves,
 * clips and exports with it. Drawing on bare pasteboard parents to the root.
 */
export function containerAtPoint(doc: DesignDocument, point: { x: number; y: number }): NodeId {
  const editing = editorStore.getState().editingContext
  if (editing && isContainer(doc.nodes[editing])) return editing

  // Topmost artboard wins, matching paint order.
  const boards = artboardIds(doc)
  for (let i = boards.length - 1; i >= 0; i--) {
    const id = boards[i]!
    if (containsPoint(geometryBounds(doc, id), point)) return id
  }
  return doc.rootId
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

/** Insert a fully-built node, choosing its parent from where it was drawn. */
export function insertNode(node: DesignNode, parentId?: NodeId, select = true): NodeId {
  const doc = getDoc()
  const parent =
    parentId ??
    containerAtPoint(doc, { x: node.transform.x, y: node.transform.y })

  transaction(`Create ${node.type}`, (draft) => {
    const world: Mat2D = [1, 0, 0, 1, node.transform.x, node.transform.y]
    addNode(draft, node, parent)
    // node.transform.x/y were computed in world space by the drawing tool, so
    // re-express them relative to whichever container we just dropped into.
    if (parent !== draft.rootId) {
      const parentWorld = worldMatrix(draft, parent)
      const local = multiply(invert(parentWorld), world)
      const t = node.transform
      draft.nodes[node.id]!.transform = {
        ...t,
        x: local[4],
        y: local[5],
      }
    }
  })
  if (select) setSelection([node.id])
  return node.id
}

export function createArtboardCommand(
  name: string,
  bounds: Bounds,
  select = true,
): NodeId | null {
  const artboard = createArtboard(name, {
    x: bounds.x,
    y: bounds.y,
    width: Math.max(1, bounds.width),
    height: Math.max(1, bounds.height),
  })
  const ok = transaction('Create artboard', (draft) => {
    addNode(draft, artboard, draft.rootId)
  })
  if (!ok) return null
  if (select) setSelection([artboard.id])
  return artboard.id
}

// ---------------------------------------------------------------------------
// Delete / duplicate
// ---------------------------------------------------------------------------

export function deleteSelection(): boolean {
  const ids = editableSelection()
  if (ids.length === 0) return false
  const ok = transaction(ids.length > 1 ? `Delete ${ids.length} objects` : 'Delete', (draft) => {
    removeNodes(draft, ids)
  })
  if (ok) clearSelection()
  return ok
}

export function duplicateSelection(dx = 10, dy = 10): NodeId[] {
  const ids = editableSelection()
  if (ids.length === 0) return []
  let created: NodeId[] = []
  transaction('Duplicate', (draft) => {
    created = duplicateNodes(draft, ids, dx, dy)
  })
  if (created.length) setSelection(created)
  return created
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

export function groupSelection(): NodeId | null {
  const ids = editableSelection()
  if (ids.length < 2) return null
  let groupId: NodeId | null = null
  transaction('Group', (draft) => {
    groupId = groupNodes(draft, ids)
    if (!groupId) return false
    return undefined
  })
  if (groupId) setSelection([groupId])
  return groupId
}

export function ungroupSelection(): NodeId[] {
  const doc = getDoc()
  const ids = editableSelection().filter((id) => doc.nodes[id]?.type === 'group')
  if (ids.length === 0) return []
  let released: NodeId[] = []
  transaction('Ungroup', (draft) => {
    released = ids.flatMap((id) => ungroupNode(draft, id))
    if (released.length === 0) return false
    return undefined
  })
  if (released.length) setSelection(released)
  return released
}

/** Wrap the selection in a group without dissolving anything — used by Paste. */
export function wrapInGroup(ids: readonly NodeId[], name = 'Group'): NodeId | null {
  let groupId: NodeId | null = null
  transaction('Group', (draft) => {
    const g = createGroup()
    g.name = name
    addNode(draft, g, draft.rootId)
    for (const id of ids) reparentNode(draft, id, g.id)
    groupId = g.id
  })
  return groupId
}

// ---------------------------------------------------------------------------
// Z-order
// ---------------------------------------------------------------------------

export function orderCommand(kind: 'front' | 'forward' | 'backward' | 'back'): boolean {
  const ids = editableSelection()
  if (ids.length === 0) return false
  const labels = {
    front: 'Bring to Front',
    forward: 'Bring Forward',
    backward: 'Send Backward',
    back: 'Send to Back',
  }
  return transaction(labels[kind], (draft) => {
    if (kind === 'front') bringToFront(draft, ids)
    else if (kind === 'forward') bringForward(draft, ids)
    else if (kind === 'backward') sendBackward(draft, ids)
    else sendToBack(draft, ids)
  })
}

// ---------------------------------------------------------------------------
// Align / distribute
// ---------------------------------------------------------------------------

export function alignSelection(mode: AlignMode): boolean {
  const ids = editableSelection()
  if (ids.length === 0) return false

  const doc = getDoc()
  // Aligning a single object aligns it to its artboard — aligning it to itself
  // would be a no-op, which is not what the button appears to promise.
  let frame: Bounds | undefined
  if (ids.length === 1) {
    const node = doc.nodes[ids[0]!]
    const parent = node?.parentId
    if (parent && doc.nodes[parent]?.type === 'artboard') {
      frame = geometryBounds(doc, parent)
    } else {
      return false
    }
  }

  return transaction('Align', (draft) => {
    alignNodes(draft, ids, mode, frame)
  })
}

export type MatchDimension = 'width' | 'height' | 'both'

/**
 * Size every selected object to match the largest one.
 *
 * Measured as EFFECTIVE size (width x |scaleX|), the same number the inspector
 * shows — not the world AABB, which for a rotated object is bigger than the
 * object and would grow it on every press.
 *
 * Matching to the largest rather than to "the first selected" makes the result
 * independent of click order, so pressing it twice is a no-op.
 */
export function matchSize(dimension: MatchDimension): boolean {
  const ids = editableSelection()
  if (ids.length < 2) return false
  const doc = getDoc()

  let maxWidth = 0
  let maxHeight = 0
  for (const id of ids) {
    const t = doc.nodes[id]!.transform
    maxWidth = Math.max(maxWidth, t.width * Math.abs(t.scaleX))
    maxHeight = Math.max(maxHeight, t.height * Math.abs(t.scaleY))
  }
  if (maxWidth <= 0 && maxHeight <= 0) return false

  const label =
    dimension === 'width' ? 'Match width' : dimension === 'height' ? 'Match height' : 'Match size'

  return transaction(label, (draft) => {
    for (const id of ids) {
      const node = draft.nodes[id]
      if (!node) continue
      const sx = Math.abs(node.transform.scaleX) || 1
      const sy = Math.abs(node.transform.scaleY) || 1
      node.transform = {
        ...node.transform,
        width: dimension === 'height' ? node.transform.width : Math.max(0.5, maxWidth / sx),
        height: dimension === 'width' ? node.transform.height : Math.max(0.5, maxHeight / sy),
      }
    }
  })
}

export function distributeSelection(mode: DistributeMode): boolean {
  const ids = editableSelection()
  if (ids.length < 3) return false
  return transaction('Distribute', (draft) => {
    distributeNodes(draft, ids, mode)
  })
}

// ---------------------------------------------------------------------------
// Transform
// ---------------------------------------------------------------------------

export function moveSelection(dx: number, dy: number, coalesceKey?: string): boolean {
  const ids = editableSelection()
  if (ids.length === 0 || (dx === 0 && dy === 0)) return false
  return transaction(
    'Move',
    (draft) => {
      for (const id of ids) applyMatrixToNode(draft, id, [1, 0, 0, 1, dx, dy])
    },
    { coalesceKey },
  )
}

export function rotateSelection(degrees: number): boolean {
  const ids = editableSelection()
  if (ids.length === 0) return false
  const doc = getDoc()
  const box = boundsOfNodes(doc, ids)
  const c = center(box)
  return transaction('Rotate', (draft) => {
    const m = rotationAbout(degrees, c.x, c.y)
    for (const id of ids) applyMatrixToNode(draft, id, m)
  })
}

export function flipSelection(axis: 'h' | 'v'): boolean {
  const ids = editableSelection()
  if (ids.length === 0) return false
  return transaction(axis === 'h' ? 'Flip Horizontal' : 'Flip Vertical', (draft) => {
    flipNodes(draft, ids, axis)
  })
}

/** Write transform fields directly — how the inspector's X/Y/W/H/rotation work. */
export function setNodeTransform(
  id: NodeId,
  patch: Partial<Transform>,
  coalesceKey?: string,
): boolean {
  return transaction(
    'Transform',
    (draft) => {
      const node = draft.nodes[id]
      if (!node) return false
      const t = node.transform
      node.transform = {
        ...t,
        ...patch,
        width: patch.width !== undefined ? Math.max(0.01, patch.width) : t.width,
        height: patch.height !== undefined ? Math.max(0.01, patch.height) : t.height,
      }
      return undefined
    },
    { coalesceKey },
  )
}

/** Apply a world-space matrix to every selected node — the commit path for drags. */
export function applyWorldMatrixToSelection(m: Mat2D, label = 'Transform'): boolean {
  const ids = editableSelection()
  if (ids.length === 0) return false
  return transaction(label, (draft) => {
    for (const id of ids) applyMatrixToNode(draft, id, m)
  })
}

/** Commit a map of final world matrices — how a drag ends. */
export function commitWorldMatrices(
  matrices: ReadonlyMap<NodeId, Mat2D>,
  label = 'Transform',
): boolean {
  if (matrices.size === 0) return false
  return transaction(label, (draft) => {
    for (const [id, m] of matrices) {
      if (draft.nodes[id]) setWorldMatrix(draft, id, m)
    }
  })
}

/** Commit final transforms directly (resize writes width/height, not just a matrix). */
export function commitTransforms(
  transforms: ReadonlyMap<NodeId, Transform>,
  label = 'Transform',
): boolean {
  if (transforms.size === 0) return false
  return transaction(label, (draft) => {
    for (const [id, t] of transforms) {
      const node = draft.nodes[id]
      if (node) node.transform = { ...t }
    }
  })
}

// ---------------------------------------------------------------------------
// Style
// ---------------------------------------------------------------------------

/** structuredClone throws on immer drafts, so unwrap before copying. */
function clonePlain<T>(value: T): T {
  return structuredClone(isDraft(value) ? (current(value as never) as T) : value)
}

function eachStyled(
  ids: readonly NodeId[],
  draft: DesignDocument,
  fn: (style: Style, node: DesignNode) => void,
): boolean {
  let touched = false
  for (const id of ids) {
    const node = draft.nodes[id]
    if (!node || !hasStyle(node)) continue
    fn(node.style, node)
    touched = true
  }
  return touched
}

export function setFill(paint: Paint, coalesceKey?: string): boolean {
  const ids = editableSelection()
  if (ids.length === 0) return false
  return transaction(
    'Change fill',
    (draft) => {
      if (!eachStyled(ids, draft, (style) => { style.fill = clonePlain(paint) })) return false
      return undefined
    },
    { coalesceKey },
  )
}

export function setStroke(patch: Partial<Stroke>, coalesceKey?: string): boolean {
  const ids = editableSelection()
  if (ids.length === 0) return false
  return transaction(
    'Change stroke',
    (draft) => {
      if (
        !eachStyled(ids, draft, (style) => {
          style.stroke = {
            ...style.stroke,
            ...clonePlain(patch),
            dashArray: patch.dashArray ? [...patch.dashArray] : style.stroke.dashArray,
          }
        })
      )
        return false
      return undefined
    },
    { coalesceKey },
  )
}

export function setStyleProperty<K extends keyof Style>(
  key: K,
  value: Style[K],
  coalesceKey?: string,
): boolean {
  const ids = editableSelection()
  if (ids.length === 0) return false
  return transaction(
    'Change appearance',
    (draft) => {
      if (!eachStyled(ids, draft, (style) => { (style[key] as Style[K]) = value })) return false
      return undefined
    },
    { coalesceKey },
  )
}

export function setOpacity(value: number, coalesceKey = 'opacity'): boolean {
  return setStyleProperty('opacity', Math.min(1, Math.max(0, value)), coalesceKey)
}

export function setCornerRadius(radius: number, coalesceKey = 'radius'): boolean {
  const ids = editableSelection()
  if (ids.length === 0) return false
  const r = Math.max(0, radius)
  return transaction(
    'Corner radius',
    (draft) => {
      let touched = false
      for (const id of ids) {
        const node = draft.nodes[id]
        if (!node) continue
        // Boxes carry four corners; the parametric polygons carry one scalar,
        // because their vertices are generated rather than addressable.
        if (node.type === 'rect' || node.type === 'image') {
          node.cornerRadius = [r, r, r, r]
          touched = true
        } else if (hasScalarCornerRadius(node)) {
          node.cornerRadius = r
          touched = true
        }
      }
      return touched ? undefined : false
    },
    { coalesceKey },
  )
}

/**
 * Set ONE corner of a box, leaving the other three alone.
 * Only rect and image have addressable corners; the parametric polygons carry a
 * single scalar and are unaffected.
 */
export function setCornerRadiusAt(
  corner: BoxCorner,
  radius: number,
  coalesceKey?: string,
): boolean {
  const ids = editableSelection()
  if (ids.length === 0) return false
  const r = Math.max(0, radius)
  const index = cornerIndex(corner)

  return transaction(
    'Corner radius',
    (draft) => {
      let touched = false
      for (const id of ids) {
        const node = draft.nodes[id]
        if (!node || (node.type !== 'rect' && node.type !== 'image')) continue
        const current = node.cornerRadius ?? [0, 0, 0, 0]
        node.cornerRadius = [0, 1, 2, 3].map((i) =>
          i === index ? r : current[i] ?? 0,
        ) as unknown as typeof node.cornerRadius
        touched = true
      }
      return touched ? undefined : false
    },
    { coalesceKey },
  )
}

export function setShapeParam(
  patch: { sides?: number; points?: number; innerRatio?: number },
  coalesceKey = 'shape-param',
): boolean {
  const ids = editableSelection()
  if (ids.length === 0) return false
  return transaction(
    'Shape',
    (draft) => {
      let touched = false
      for (const id of ids) {
        const node = draft.nodes[id]
        if (!node) continue
        if (node.type === 'polygon' && patch.sides !== undefined) {
          node.sides = Math.max(3, Math.round(patch.sides))
          touched = true
        }
        if (node.type === 'star') {
          if (patch.points !== undefined) {
            node.points = Math.max(3, Math.round(patch.points))
            touched = true
          }
          if (patch.innerRatio !== undefined) {
            node.innerRatio = Math.min(1, Math.max(0.01, patch.innerRatio))
            touched = true
          }
        }
      }
      return touched ? undefined : false
    },
    { coalesceKey },
  )
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export function setText(id: NodeId, text: string): boolean {
  return transaction(
    'Edit text',
    (draft) => {
      const node = draft.nodes[id]
      if (!node || node.type !== 'text') return false
      node.text = text
      if (!node.name || node.name === 'Text' || node.name.startsWith(node.text.slice(0, 8))) {
        node.name = text.split('\n')[0]!.slice(0, 40) || 'Text'
      }
      return undefined
    },
    { coalesceKey: `text:${id}` },
  )
}

export function setTextStyle(patch: Partial<TextStyle>, coalesceKey?: string): boolean {
  const ids = editableSelection()
  if (ids.length === 0) return false
  return transaction(
    'Text style',
    (draft) => {
      let touched = false
      for (const id of ids) {
        const node = draft.nodes[id]
        if (node?.type === 'text') {
          node.textStyle = { ...node.textStyle, ...patch }
          touched = true
        }
      }
      return touched ? undefined : false
    },
    { coalesceKey },
  )
}

// ---------------------------------------------------------------------------
// Layer properties
// ---------------------------------------------------------------------------

export function renameNode(id: NodeId, name: string): boolean {
  const trimmed = name.trim()
  if (!trimmed) return false
  return transaction('Rename', (draft) => {
    const node = draft.nodes[id]
    if (!node || node.name === trimmed) return false
    node.name = trimmed
    return undefined
  })
}

export function setVisibility(ids: readonly NodeId[], visible: boolean): boolean {
  if (ids.length === 0) return false
  return transaction(visible ? 'Show' : 'Hide', (draft) => {
    for (const id of ids) {
      const node = draft.nodes[id]
      if (node) node.visible = visible
    }
  })
}

export function toggleVisibility(id: NodeId): boolean {
  const node = getDoc().nodes[id]
  return node ? setVisibility([id], !node.visible) : false
}

export function setLocked(ids: readonly NodeId[], locked: boolean): boolean {
  if (ids.length === 0) return false
  return transaction(locked ? 'Lock' : 'Unlock', (draft) => {
    for (const id of ids) {
      const node = draft.nodes[id]
      if (node) node.locked = locked
    }
  })
}

export function toggleLock(id: NodeId): boolean {
  const node = getDoc().nodes[id]
  return node ? setLocked([id], !node.locked) : false
}

export function setMarkedForExport(ids: readonly NodeId[], marked: boolean): boolean {
  if (ids.length === 0) return false
  return transaction('Mark for Export', (draft) => {
    for (const id of ids) {
      const node = draft.nodes[id]
      if (node) node.markedForExport = marked
    }
  })
}

export function markedForExportIds(doc: DesignDocument = getDoc()): NodeId[] {
  return Object.values(doc.nodes)
    .filter((n) => n.markedForExport && n.id !== doc.rootId)
    .map((n) => n.id)
}

// ---------------------------------------------------------------------------
// Layer tree reordering (drag/drop in the Layers panel)
// ---------------------------------------------------------------------------

export function moveNodeInTree(id: NodeId, newParentId: NodeId, index: number): boolean {
  return transaction('Reorder', (draft) => {
    const node = draft.nodes[id]
    if (!node) return false
    reparentNode(draft, id, newParentId, index)
    return undefined
  })
}

// ---------------------------------------------------------------------------
// Document settings
// ---------------------------------------------------------------------------

export function updateSettings(patch: Partial<DesignDocument['settings']>): boolean {
  return transaction('Settings', (draft) => {
    draft.settings = { ...draft.settings, ...patch }
  })
}

export function renameDocument(name: string): boolean {
  const trimmed = name.trim()
  if (!trimmed) return false
  return transaction('Rename document', (draft) => {
    if (draft.name === trimmed) return false
    draft.name = trimmed
    return undefined
  })
}

export function addGuide(axis: 'x' | 'y', position: number, id: string): boolean {
  return transaction('Add guide', (draft) => {
    draft.guides.push({ id, axis, position })
  })
}

export function moveGuide(id: string, position: number): boolean {
  return transaction(
    'Move guide',
    (draft) => {
      const g = draft.guides.find((x) => x.id === id)
      if (!g) return false
      g.position = position
      return undefined
    },
    { coalesceKey: `guide:${id}` },
  )
}

export function removeGuide(id: string): boolean {
  return transaction('Remove guide', (draft) => {
    const i = draft.guides.findIndex((g) => g.id === id)
    if (i < 0) return false
    draft.guides.splice(i, 1)
    return undefined
  })
}

export function clearGuides(): boolean {
  return transaction('Clear guides', (draft) => {
    if (draft.guides.length === 0) return false
    draft.guides = []
    return undefined
  })
}

// ---------------------------------------------------------------------------
// Convenience re-exports for the shortcut layer
// ---------------------------------------------------------------------------

/**
 * Select every editable object.
 *
 * Not simply the root's children: at the top level those are the artboards, and
 * selecting the artboard instead of the artwork on it is never what the user
 * meant. So artboards are descended into and their contents selected, alongside
 * anything sitting loose on the pasteboard. Inside an entered group, the scope
 * narrows to that group's own children.
 */
export function selectAll(): void {
  const doc = getDoc()
  const context = editorStore.getState().editingContext
  if (context) {
    const container = doc.nodes[context]
    if (!isContainer(container)) return
    setSelection(container.children.filter((id) => !isEffectivelyLocked(doc, id)))
    return
  }

  const root = doc.nodes[doc.rootId]
  if (!isContainer(root)) return

  const ids: NodeId[] = []
  for (const id of root.children) {
    const node = doc.nodes[id]
    if (!node || isEffectivelyLocked(doc, id)) continue
    if (node.type === 'artboard') {
      ids.push(...node.children.filter((c) => !isEffectivelyLocked(doc, c)))
    } else {
      ids.push(id)
    }
  }
  setSelection(ids)
}

export function selectNone(): void {
  clearSelection()
}

export function reportUnsupported(what: string, tool?: ToolId): void {
  notify('warn', `${what} is not available`, tool ? `Tool: ${tool}` : undefined)
}

export { transformFromMatrix }
