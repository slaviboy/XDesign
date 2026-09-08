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
  readDefaultGrid,
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
  artboardAtPoint,
  boundsOfNodes,
  geometryBounds,
  isEffectivelyLocked,
  nodePathData,
  paintOrderIndex,
  worldMatrix,
} from '../document/SceneGraph'
import { outlineStroke } from '../geometry/StrokeOutline'
import { rgbaEquals } from '../document/color'
import { createGuideId, createSwatchId } from '../document/ids'
import { MAX_SIDES, MIN_SIDES } from '../geometry/ShapeGeometry'
import { createArtboard, createGroup, createPath } from '../document/NodeFactory'
import { current, isDraft } from 'immer'
import { invert, multiply, rotationAbout, type Mat2D } from '../geometry/Matrix'
import { center, type Bounds } from '../geometry/Bounds'
import type {
  ArtboardGrid,
  BlurEffect,
  Guide,
  LayoutGrid,
  SquareGrid,
  DesignDocument,
  DesignNode,
  NodeId,
  Paint,
  ShadowEffect,
  Stroke,
  Style,
  TextStyle,
  Transform,
} from '../document/types'
import {
  BLUR_AMOUNT_MAX,
  BLUR_BRIGHTNESS_MAX,
  DEFAULT_BLUR,
  DEFAULT_LAYOUT_GRID,
  DEFAULT_SHADOW,
  DEFAULT_SQUARE_GRID,
  DEFAULT_STROKE,
  cornerIndex,
  hasScalarCornerRadius,
  hasStyle,
  isContainer,
  isMaskGroup,
  isShape,
  type BoxCorner,
  type RGBA,
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
  return artboardAtPoint(doc, point) ?? doc.rootId
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
  // Adobe's "Make Default" applies to artboards made from here on.
  const preset = readDefaultGrid()
  if (preset) artboard.grid = { ...preset }
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
// Masking
// ---------------------------------------------------------------------------

/**
 * Adobe: "Select all the objects that are to be masked in addition to the
 * topmost object, which is the mask, and choose Object > Mask with Shape."
 *
 * The mask stays a real child of the group, which is what makes the rest of
 * Adobe's description true: the masked area "is not deleted from your project",
 * double-clicking steps inside to readjust it, and Ungroup Mask hands both the
 * mask and the content back untouched.
 */
export function maskWithShape(): NodeId | null {
  const doc = getDoc()
  const ids = editableSelection()
  if (ids.length < 2) return null

  // Topmost in PAINT order, not in selection order — "the object on top of the
  // stack acts as a mask" regardless of the order it was clicked in.
  const maskId = [...ids].sort((a, b) => paintOrderIndex(doc, a) - paintOrderIndex(doc, b)).pop()!
  if (!canBeMask(doc.nodes[maskId])) return null

  let groupId: NodeId | null = null
  transaction('Mask With Shape', (draft) => {
    const created = groupNodes(draft, ids)
    if (!created) return false
    const group = draft.nodes[created]
    if (!group || group.type !== 'group') return false

    // Re-seated at the end so the mask is unambiguously the topmost child, even
    // if the selection spanned parents and grouping had to flatten the order.
    const at = group.children.indexOf(maskId)
    if (at >= 0) group.children.splice(at, 1)
    group.children.push(maskId)

    group.maskId = maskId
    group.name = 'Mask Group'
    groupId = created
    return undefined
  })

  if (groupId) setSelection([groupId])
  return groupId
}

/**
 * Adobe: "You cannot mask text on shapes, components, groups, or symbols."
 *
 * A line is excluded on top of that for a reason of its own: it encloses no
 * area, so masking with one would hide everything and look like a bug.
 */
export function canBeMask(node: DesignNode | undefined | null): boolean {
  return !!node && isShape(node) && node.type !== 'line'
}

/** Whether Mask With Shape would do anything for the current selection. */
export function canMaskSelection(): boolean {
  const doc = getDoc()
  const ids = editableSelection()
  if (ids.length < 2) return false
  const top = [...ids].sort((a, b) => paintOrderIndex(doc, a) - paintOrderIndex(doc, b)).pop()!
  return canBeMask(doc.nodes[top])
}

/**
 * Release a mask, keeping everything it held — Adobe's "Ungroup Mask".
 *
 * The same operation as Ungroup, and deliberately so: the mask group IS a
 * group, so releasing it is dissolving it. The separate name exists because
 * that is the command Adobe puts on the context menu.
 */
export function ungroupMask(): NodeId[] {
  const doc = getDoc()
  const ids = editableSelection().filter((id) => isMaskGroup(doc.nodes[id]))
  if (ids.length === 0) return []
  let released: NodeId[] = []
  transaction('Ungroup Mask', (draft) => {
    released = ids.flatMap((id) => ungroupNode(draft, id))
    if (released.length === 0) return false
    return undefined
  })
  if (released.length) setSelection(released)
  return released
}

// ---------------------------------------------------------------------------
// Outline Stroke
// ---------------------------------------------------------------------------

/**
 * Adobe: "convert your path and border-based elements, like icons, into solid
 * vector shapes", and "If any layer contains both a fill and a border, they'll
 * automatically be separated."
 *
 * So a stroked, filled shape becomes two objects: the original keeps the fill
 * and loses its border, and a new path — filled with what the border was
 * painted with — takes its place on top. A shape with no fill is replaced
 * outright, because there would be nothing left of it otherwise.
 */
export function outlineStrokeSelection(): NodeId[] {
  const doc = getDoc()
  const ids = editableSelection().filter((id) => hasOutlinableStroke(doc.nodes[id]))
  if (ids.length === 0) return []

  const created: NodeId[] = []
  const ok = transaction('Outline Stroke', (draft) => {
    for (const id of ids) {
      const node = draft.nodes[id]
      if (!node || !hasStyle(node)) continue
      const d = nodePathData(node)
      if (!d) continue

      const outlined = outlineStroke(d, {
        width: node.style.stroke.width,
        cap: node.style.stroke.cap,
        join: node.style.stroke.join,
        miterLimit: node.style.stroke.miterLimit,
        align: node.style.stroke.align,
      })
      if (!outlined) continue

      const keepsFill = node.style.fill.type !== 'none'
      const path = createPath(outlined, { ...node.transform }, {
        ...clonePlain(node.style),
        // The border's paint becomes the new shape's fill: that is what makes
        // the result look identical to what it replaced.
        fill: clonePlain(node.style.stroke.paint),
        fillRule: 'nonzero',
        stroke: { ...DEFAULT_STROKE },
        strokeOpacity: 1,
        fillOpacity: node.style.strokeOpacity,
      })
      path.name = keepsFill ? `${node.name} Outline` : node.name

      const parentId = node.parentId ?? draft.rootId
      const parent = draft.nodes[parentId]
      if (!parent || !isContainer(parent)) continue
      const at = parent.children.indexOf(id)
      addNode(draft, path, parentId, at < 0 ? parent.children.length : at + 1)
      created.push(path.id)

      if (keepsFill) {
        // Separated, as Adobe describes: the fill stays where it was, without
        // the border that is now its own object.
        node.style.stroke = { ...node.style.stroke, paint: { type: 'none' } }
        created.push(id)
      } else {
        removeNodes(draft, [id])
      }
    }
    if (created.length === 0) return false
    return undefined
  })

  if (ok && created.length) setSelection(created)
  return ok ? created : []
}

/** Whether Outline Stroke has anything to convert on this node. */
export function hasOutlinableStroke(node: DesignNode | undefined | null): boolean {
  if (!node || !hasStyle(node)) return false
  if (!isShape(node)) return false
  return node.style.stroke.paint.type !== 'none' && node.style.stroke.width > 0
}

/** Whether Outline Stroke would do anything for the current selection. */
export function canOutlineStrokeSelection(): boolean {
  const doc = getDoc()
  return editableSelection().some((id) => hasOutlinableStroke(doc.nodes[id]))
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

/**
 * Add, edit or remove the shadow on the selection.
 *
 * `null` removes it outright; a patch merges into whatever is there, starting
 * from Adobe's own default the first time. Turning the effect OFF is
 * `{ visible: false }`, not removal — that is the checkbox in the Properties
 * panel, and it has to keep the settings so ticking it again restores them.
 */
export function setShadow(
  patch: Partial<ShadowEffect> | null,
  coalesceKey?: string,
): boolean {
  const ids = editableSelection()
  if (ids.length === 0) return false
  return transaction(
    patch === null ? 'Remove shadow' : 'Change shadow',
    (draft) => {
      if (
        !eachStyled(ids, draft, (style) => {
          if (patch === null) {
            delete style.shadow
            return
          }
          const base = style.shadow ?? DEFAULT_SHADOW
          style.shadow = {
            ...base,
            ...clonePlain(patch),
            blur: Math.max(0, patch.blur ?? base.blur),
          }
        })
      )
        return false
      return undefined
    },
    { coalesceKey },
  )
}

/** The same, for the blur. Ranges are Adobe's, and are clamped here. */
export function setBlur(patch: Partial<BlurEffect> | null, coalesceKey?: string): boolean {
  const ids = editableSelection()
  if (ids.length === 0) return false
  return transaction(
    patch === null ? 'Remove blur' : 'Change blur',
    (draft) => {
      if (
        !eachStyled(ids, draft, (style) => {
          if (patch === null) {
            delete style.blur
            return
          }
          const base = style.blur ?? DEFAULT_BLUR
          const merged = { ...base, ...clonePlain(patch) }
          style.blur = {
            ...merged,
            amount: clamp(merged.amount, 0, BLUR_AMOUNT_MAX),
            brightness: clamp(merged.brightness, -BLUR_BRIGHTNESS_MAX, BLUR_BRIGHTNESS_MAX),
            fillOpacity: clamp(merged.fillOpacity, 0, 1),
          }
        })
      )
        return false
      return undefined
    },
    { coalesceKey },
  )
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(n) ? n : min))
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

/** Corner count and star ratio, the two parameters XD exposes for a polygon. */
export function setShapeParam(
  patch: { sides?: number; starRatio?: number },
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
        if (node.type !== 'polygon') continue
        if (patch.sides !== undefined) {
          node.sides = Math.min(MAX_SIDES, Math.max(MIN_SIDES, Math.round(patch.sides)))
          touched = true
        }
        if (patch.starRatio !== undefined) {
          node.starRatio = Math.min(1, Math.max(0.01, patch.starRatio))
          touched = true
        }
      }
      return touched ? undefined : false
    },
    { coalesceKey },
  )
}

// ---------------------------------------------------------------------------
// Swatches
// ---------------------------------------------------------------------------

/**
 * Save a colour, with its opacity, to the document's palette.
 *
 * Undoable like any other edit, which is the natural consequence of the palette
 * being document data rather than a browser preference.
 */
export function addSwatch(color: RGBA): boolean {
  return transaction('Add swatch', (draft) => {
    // Adding the colour you already saved should be a no-op, not a duplicate.
    if (draft.swatches.some((s) => rgbaEquals(s.color, color))) return false
    draft.swatches.push({ id: createSwatchId(), color: { ...color } })
    return undefined
  })
}

export function removeSwatch(id: string): boolean {
  return transaction('Remove swatch', (draft) => {
    const index = draft.swatches.findIndex((s) => s.id === id)
    if (index < 0) return false
    draft.swatches.splice(index, 1)
    return undefined
  })
}

/** Drag-to-reorder within the palette. */
export function moveSwatch(id: string, toIndex: number): boolean {
  return transaction('Reorder swatches', (draft) => {
    const from = draft.swatches.findIndex((s) => s.id === id)
    const to = Math.min(draft.swatches.length - 1, Math.max(0, toIndex))
    if (from < 0 || from === to) return false
    const [moved] = draft.swatches.splice(from, 1)
    draft.swatches.splice(to, 0, moved!)
    return undefined
  })
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

export function updateSettings(
  patch: Partial<DesignDocument['settings']>,
  coalesceKey?: string,
): boolean {
  return transaction(
    'Settings',
    (draft) => {
      draft.settings = { ...draft.settings, ...patch }
    },
    { coalesceKey },
  )
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

// ---------------------------------------------------------------------------
// Guides
// ---------------------------------------------------------------------------

/**
 * Guides belong to an artboard and are positioned in ITS local space.
 *
 * `addGuide` mints its own id. The previous signature took one from the caller,
 * which is part of why it had no callers at all: there was nothing convenient
 * to call.
 */
export function addGuide(artboardId: NodeId, axis: 'x' | 'y', position: number): string | null {
  const id = createGuideId()
  const ok = transaction('Add guide', (draft) => {
    const board = draft.nodes[artboardId]
    if (!board || board.type !== 'artboard') return false
    // A locked guide layer takes no new guides either: the edge strips are
    // hidden while it is locked, so allowing it here would only be reachable
    // by a command that the UI does not offer.
    if (board.guidesLocked) return false
    board.guides = [...(board.guides ?? []), { id, axis, position }]
    return undefined
  })
  return ok ? id : null
}

/**
 * The coalesce key is the CALLER's to choose, not a default.
 *
 * A default initializer fires on an explicit `undefined`, so a caller asking
 * for its own history entry would silently get the shared key and be merged
 * into whatever came before it.
 */
export function moveGuide(
  artboardId: NodeId,
  guideId: string,
  position: number,
  coalesceKey?: string,
): boolean {
  return transaction(
    'Move guide',
    (draft) => {
      const board = draft.nodes[artboardId]
      if (!board || board.type !== 'artboard' || board.guidesLocked) return false
      const g = board.guides?.find((x) => x.id === guideId)
      if (!g) return false
      g.position = position
      return undefined
    },
    { coalesceKey },
  )
}

export function removeGuide(artboardId: NodeId, guideId: string): boolean {
  return transaction('Remove guide', (draft) => {
    const board = draft.nodes[artboardId]
    if (!board || board.type !== 'artboard' || board.guidesLocked) return false
    const next = (board.guides ?? []).filter((g) => g.id !== guideId)
    if (next.length === (board.guides ?? []).length) return false
    board.guides = next
    return undefined
  })
}

/** Adobe's "Remove All Guides", over every artboard given. */
export function clearGuides(artboardIds: readonly NodeId[]): boolean {
  return transaction('Remove all guides', (draft) => {
    let touched = false
    for (const id of artboardIds) {
      const board = draft.nodes[id]
      if (!board || board.type !== 'artboard' || board.guidesLocked) continue
      if (!board.guides?.length) continue
      board.guides = []
      touched = true
    }
    return touched ? undefined : false
  })
}

/** Adobe's "Lock All Guides": still drawn, no longer draggable. */
export function setGuidesLocked(artboardIds: readonly NodeId[], locked: boolean): boolean {
  return transaction(locked ? 'Lock guides' : 'Unlock guides', (draft) => {
    let touched = false
    for (const id of artboardIds) {
      const board = draft.nodes[id]
      if (!board || board.type !== 'artboard') continue
      if (!!board.guidesLocked === locked) continue
      board.guidesLocked = locked
      touched = true
    }
    return touched ? undefined : false
  })
}

/**
 * The guide clipboard.
 *
 * Deliberately not the system clipboard: copying guides is an in-app operation
 * on chrome, and the real clipboard already carries nodes — putting guides
 * there would make Copy Guides and Copy fight over it.
 */
let copiedGuides: Guide[] | null = null

export function copyGuides(artboardId: NodeId): number {
  const board = getDoc().nodes[artboardId]
  if (!board || board.type !== 'artboard') return 0
  copiedGuides = (board.guides ?? []).map((g) => ({ ...g }))
  return copiedGuides.length
}

export function hasCopiedGuides(): boolean {
  return !!copiedGuides && copiedGuides.length > 0
}

/**
 * Paste onto every artboard given, REPLACING what is there.
 *
 * Positions are local, so the same set lands in the same place relative to each
 * artboard — which is the point of the feature: one set of guides applied
 * across a set of screens.
 */
export function pasteGuides(artboardIds: readonly NodeId[]): boolean {
  const source = copiedGuides
  if (!source || source.length === 0) return false
  return transaction('Paste guides', (draft) => {
    let touched = false
    for (const id of artboardIds) {
      const board = draft.nodes[id]
      if (!board || board.type !== 'artboard' || board.guidesLocked) continue
      board.guides = source.map((g) => ({ ...g, id: createGuideId() }))
      touched = true
    }
    return touched ? undefined : false
  })
}

// ---------------------------------------------------------------------------
// Artboard grids
// ---------------------------------------------------------------------------

export type ArtboardGridPatch =
  | ({ type: 'square' } & Partial<Omit<SquareGrid, 'type'>>)
  | ({ type: 'layout' } & Partial<Omit<LayoutGrid, 'type'>>)
  | (Partial<Omit<SquareGrid, 'type'>> & Partial<Omit<LayoutGrid, 'type'>> & { type?: undefined })

/**
 * Set or edit the grid on every artboard given.
 *
 * Switching `type` starts from that kind's defaults rather than trying to carry
 * a square's `size` across to a layout grid's `columns`, which share nothing.
 * A patch with no `type` edits whatever kind is already there.
 *
 * Takes a coalesce key, as setRepeatGridParams does — without one, every
 * keystroke in a column-count field is its own undo entry.
 */
export function setArtboardGrid(
  artboardIds: readonly NodeId[],
  patch: ArtboardGridPatch,
  coalesceKey?: string,
): boolean {
  return transaction(
    'Grid',
    (draft) => {
      let touched = false
      for (const id of artboardIds) {
        const board = draft.nodes[id]
        if (!board || board.type !== 'artboard') continue
        const base: ArtboardGrid =
          patch.type && patch.type !== board.grid?.type
            ? patch.type === 'square'
              ? { ...DEFAULT_SQUARE_GRID }
              : { ...DEFAULT_LAYOUT_GRID }
            : (board.grid ?? { ...DEFAULT_SQUARE_GRID })
        board.grid = clampGrid({ ...base, ...clonePlain(patch) } as ArtboardGrid)
        touched = true
      }
      return touched ? undefined : false
    },
    { coalesceKey },
  )
}

/** Remove the grid entirely, as opposed to hiding it. */
export function removeArtboardGrid(artboardIds: readonly NodeId[]): boolean {
  return transaction('Remove grid', (draft) => {
    let touched = false
    for (const id of artboardIds) {
      const board = draft.nodes[id]
      if (!board || board.type !== 'artboard' || !board.grid) continue
      delete board.grid
      touched = true
    }
    return touched ? undefined : false
  })
}

/** Exported so the file reader clamps by exactly the same rules as the editor. */
export function clampGrid(grid: ArtboardGrid): ArtboardGrid {
  if (grid.type === 'square') return { ...grid, size: Math.max(1, grid.size) }
  return {
    ...grid,
    columns: Math.max(1, Math.round(grid.columns)),
    gutter: Math.max(0, grid.gutter),
    marginLeft: Math.max(0, grid.marginLeft),
    marginRight: Math.max(0, grid.marginRight),
  }
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
