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
 * Move / resize / rotate gestures.
 *
 * The three-phase contract that keeps drags at 60fps:
 *
 *   pointerdown — snapshot every affected node's world matrix and geometry into
 *                 a plain object. Exactly one store write (interaction mode).
 *   pointermove — compute new matrices in pure TS and push them straight to the
 *                 mounted SVG elements via LiveTransform. ZERO store writes, so
 *                 zero React renders, regardless of document size.
 *   pointerup   — one transaction, one undo entry.
 *
 * RESIZE-WITH-ROTATION, the subtle part. Scaling a rotated object in world space
 * composes as R·S, and since R·S != S·R the shape *shears* — a bug that looks
 * like the object melting as you drag. The fix is to do the entire resize in the
 * node's own unrotated local space: transform the pointer by invert(M0), derive
 * the new local box from the fixed opposite corner, and re-anchor. The rotation
 * component is never touched, so it cannot leak into the scale.
 */

import {
  applyToPoint,
  invert,
  multiply,
  rotationAbout,
  scaling,
  translation,
  type Mat2D,
  type Vec2,
} from '../geometry/Matrix'
import { transformBounds, unionAll, type Bounds } from '../geometry/Bounds'
import {
  ellipsePath,
  linePath,
  polygonStarPath,
  rectPath,
} from '../geometry/ShapeGeometry'
import { transformPath } from '../geometry/PathUtils'
import {
  geometryBounds,
  localMatrix,
  worldMatrix,
  createMatrixCache,
  isEffectivelyLocked,
} from '../document/SceneGraph'
import { transformFromMatrix } from '../document/DocumentModel'
import { transaction } from '../state/DocumentStore'
import { adoptTextResize } from '../history/Commands'
import { editorStore } from '../state/EditorStore'
import { liveTransform } from '../canvas/LiveTransform'
import { fxKey, geomKey } from '../canvas/liveKeys'
import { effectMargin, filterRegion } from '../canvas/effects'
import { intrinsicTextSize } from '../text/TextLayout'
import { hasStyle, isContainer, sizingAfterResize, usesOwnBox } from '../document/types'
import type { DesignDocument, DesignNode, NodeId, TextSizing, TextStyle, Transform, TextRun } from '../document/types'
import type { SnapLine } from '../geometry/Snapping'

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
export type DragMode = 'move' | 'resize' | 'rotate'

export const RESIZE_HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

interface NodeSnapshot {
  id: NodeId
  world: Mat2D
  parentWorld: Mat2D
  transform: Transform
  type: DesignNode['type']
  /** Original path data, for path nodes whose geometry is baked on resize. */
  d?: string
  line?: { x1: number; y1: number; x2: number; y2: number }
  /** Shape parameters, so the live preview redraws the real shape, not a default. */
  sides?: number
  starRatio?: number
  cornerRadius?: readonly [number, number, number, number]
  /** Scalar vertex rounding for the parametric polygon. */
  vertexRadius?: number
  /**
   * How far this node's shadow and blur paint outside its box.
   *
   * Snapshotted because a resize does not change it — a blur radius is not
   * what a resize edits — but the region built from it has to follow the live
   * size. See fxKey in liveKeys.
   */
  effectMargin: number
  /**
   * Text and its style, so the in-flight height can be re-fitted without
   * reading the document — which a drag deliberately never does.
   */
  text?: { text: string; style: TextStyle; runs?: TextRun[] }
}

export interface DragSessionState {
  mode: DragMode
  handle: ResizeHandle | null
  startDoc: Vec2
  /** Selection bounds in world space at gesture start. */
  frame: Bounds
  nodes: NodeSnapshot[]
  /** True when a single node is being resized along its own rotated axes. */
  singleAxisResize: boolean
  /**
   * True when the resize must go into the MATRIX rather than into width/height.
   *
   * A group has no size of its own — its box is only a record of where its
   * children happened to be when it was formed — so writing a new width/height
   * changes nothing anyone can see. Scaling its matrix is what actually resizes
   * it, because the children inherit that matrix. Everything else keeps its size
   * in width/height so strokes, corner radii and text layout do not scale with
   * the box.
   */
  scalesContent: boolean
  /**
   * Intrinsic sizes produced by the in-flight resize. The single-node path keeps
   * size in width/height rather than in the matrix (so strokes and corner radii
   * do not scale), which means the matrix alone cannot tell commit what the new
   * size is — this carries it across.
   */
  liveSizes: Map<NodeId, { width: number; height: number }>
  /**
   * The resize option a text box takes on from this gesture, decided once while
   * it is in flight and applied unchanged at commit.
   *
   * Recomputing it at commit would compare the FINAL size against the start,
   * and that size already carries the height this code derived — so a side
   * handle would look like a height change and every drag would end in Fixed
   * Size. Deciding once is also what makes the preview and the result the same
   * thing rather than two computations that happen to agree.
   */
  liveSizing: Map<NodeId, TextSizing>
  moved: boolean
}

let session: DragSessionState | null = null

/**
 * Latest world matrices from the in-flight gesture.
 *
 * The selection overlay reads these so its frame and handles track the shapes
 * during a drag. It cannot read the document, because a drag deliberately makes
 * zero store writes until commit.
 */
let liveMatrices = new Map<NodeId, Mat2D>()

export function getLiveMatrix(id: NodeId): Mat2D | undefined {
  return liveMatrices.get(id)
}

export function getLiveSize(id: NodeId): { width: number; height: number } | undefined {
  return session?.liveSizes.get(id)
}

/**
 * The resize option a text node has taken on for the duration of this gesture.
 *
 * The renderer needs it as much as the size does: a box that is becoming Auto
 * Height has to start wrapping while the pointer is still down, and it cannot
 * learn that from the document, which a drag never writes to.
 */
export function getLiveSizing(id: NodeId): TextSizing | undefined {
  return session?.liveSizing.get(id)
}

/**
 * How far the current rotate gesture has turned, in degrees.
 *
 * The overlay needs this because a multi-selection's frame is axis-aligned, so
 * its own angle is always 0 — reading the frame would show "0°" for the whole
 * rotation. A single selection still reports its absolute angle from the frame;
 * this is the delta, which is the only meaningful figure for a group.
 */
let liveRotationDelta = 0

export function getLiveRotation(): number {
  return liveRotationDelta
}

export function isDragging(): boolean {
  return session !== null
}

export function getDragMode(): DragMode | null {
  return session?.mode ?? null
}

// ---------------------------------------------------------------------------
// Begin
// ---------------------------------------------------------------------------

export function beginDrag(
  doc: DesignDocument,
  ids: readonly NodeId[],
  mode: DragMode,
  startDoc: Vec2,
  handle: ResizeHandle | null = null,
): boolean {
  const usable = ids.filter((id) => doc.nodes[id] && !isEffectivelyLocked(doc, id))
  if (usable.length === 0) return false

  const cache = createMatrixCache()
  const nodes: NodeSnapshot[] = usable.map((id) => {
    const node = doc.nodes[id]!
    return {
      id,
      world: cache.world(doc, id),
      parentWorld: node.parentId ? cache.world(doc, node.parentId) : ([1, 0, 0, 1, 0, 0] as Mat2D),
      transform: { ...node.transform },
      type: node.type,
      d: node.type === 'path' ? node.d : undefined,
      line:
        node.type === 'line'
          ? { x1: node.x1, y1: node.y1, x2: node.x2, y2: node.y2 }
          : undefined,
      sides: node.type === 'polygon' ? node.sides : undefined,
      starRatio: node.type === 'polygon' ? node.starRatio : undefined,
      // Images carry corner rounding too, and it shapes the clip they are
      // drawn through — so a live resize has to rebuild that clip as well.
      cornerRadius: node.type === 'rect' || node.type === 'image' ? node.cornerRadius : undefined,
      vertexRadius: node.type === 'polygon' ? node.cornerRadius : undefined,
      effectMargin: hasStyle(node) ? effectMargin(node.style) : 0,
      text: node.type === 'text' ? { text: node.text, style: node.textStyle, runs: node.runs } : undefined,
    }
  })

  session = {
    mode,
    handle,
    startDoc,
    frame: unionAll(usable.map((id) => geometryBounds(doc, id, cache))),
    nodes,
    singleAxisResize: usable.length === 1,
    scalesContent: usable.length === 1 && scalesContentOnResize(doc.nodes[usable[0]!]),
    liveSizes: new Map(),
    liveSizing: new Map(),
    moved: false,
  }

  liveMatrices = new Map()
  liveRotationDelta = 0
  liveTransform.begin()
  editorStore.setState({ isDragging: true })
  return true
}

export function getDragFrame(): Bounds | null {
  return session?.frame ?? null
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export interface DragUpdateOptions {
  /** Constrain: proportional resize, axis-locked move, angle-snapped rotate. */
  constrain: boolean
  /** Resize/scale about the center instead of the opposite corner. */
  fromCenter: boolean
  /** Applied to the raw pointer delta before anything else. */
  snapDelta?: Vec2
  snapLines?: SnapLine[]
}

/** Returns the live world matrices so the caller can drive snapping and readouts. */
export function updateDrag(
  currentDoc: Vec2,
  options: DragUpdateOptions,
): Map<NodeId, Mat2D> | null {
  if (!session) return null
  const result = new Map<NodeId, Mat2D>()

  const dx = currentDoc.x - session.startDoc.x + (options.snapDelta?.x ?? 0)
  const dy = currentDoc.y - session.startDoc.y + (options.snapDelta?.y ?? 0)
  if (dx !== 0 || dy !== 0) session.moved = true

  switch (session.mode) {
    case 'move':
      applyMove(dx, dy, options, result)
      break
    case 'rotate':
      applyRotate(currentDoc, options, result)
      break
    case 'resize':
      applyResize(currentDoc, options, result)
      break
  }

  liveMatrices = result
  editorStore.setState({ snapGuides: options.snapLines ?? [] })
  return result
}

function applyMove(
  dx: number,
  dy: number,
  options: DragUpdateOptions,
  out: Map<NodeId, Mat2D>,
): void {
  let mx = dx
  let my = dy
  // Shift locks to the dominant axis.
  if (options.constrain) {
    if (Math.abs(dx) > Math.abs(dy)) my = 0
    else mx = 0
  }
  const m: Mat2D = [1, 0, 0, 1, mx, my]
  for (const snap of session!.nodes) {
    const world = multiply(m, snap.world)
    out.set(snap.id, world)
    pushLiveTransform(snap, world)
  }
}

function applyRotate(
  currentDoc: Vec2,
  options: DragUpdateOptions,
  out: Map<NodeId, Mat2D>,
): void {
  const s = session!
  const cx = s.frame.x + s.frame.width / 2
  const cy = s.frame.y + s.frame.height / 2

  const a0 = Math.atan2(s.startDoc.y - cy, s.startDoc.x - cx)
  const a1 = Math.atan2(currentDoc.y - cy, currentDoc.x - cx)
  let deg = ((a1 - a0) * 180) / Math.PI
  if (options.constrain) deg = Math.round(deg / 15) * 15
  liveRotationDelta = deg

  const m = rotationAbout(deg, cx, cy)
  for (const snap of s.nodes) {
    const world = multiply(m, snap.world)
    out.set(snap.id, world)
    pushLiveTransform(snap, world)
  }
}

/**
 * The resize path.
 *
 * Single selection: work in the node's own local space so the result has zero
 * shear regardless of rotation.
 * Multi selection: build one axis-aligned frame and apply the same world-space
 * scale to every member about the shared anchor.
 */
function applyResize(
  currentDoc: Vec2,
  options: DragUpdateOptions,
  out: Map<NodeId, Mat2D>,
): void {
  const s = session!
  const handle = s.handle
  if (!handle) return

  if (s.singleAxisResize) {
    const snap = s.nodes[0]!
    const local = applyToPoint(invert(snap.world), currentDoc)
    const box = resizeLocalBox(
      snap.transform.width,
      snap.transform.height,
      handle,
      local,
      options,
    )
    // Re-anchor: the new local origin sits at (x0,y0) of the OLD local space,
    // and a negative signed extent mirrors the shape rather than inverting it.
    // For a group the extent goes into the scale as well, which is the only
    // thing that moves its children.
    const kx = s.scalesContent && snap.transform.width > 0 ? box.width / snap.transform.width : 1
    const ky = s.scalesContent && snap.transform.height > 0 ? box.height / snap.transform.height : 1
    const reanchor = multiply(translation(box.x0, box.y0), scaling(box.sx * kx, box.sy * ky))
    const world = multiply(snap.world, reanchor)
    out.set(snap.id, world)
    if (s.scalesContent) {
      pushLiveTransform(snap, world)
      return
    }
    const size = liveTextSize(snap, box)
    s.liveSizes.set(snap.id, size)
    pushLiveTransform(snap, world, size.width, size.height)
    return
  }

  // Multi-selection: scale the whole frame.
  const frame = s.frame
  const anchor = frameAnchor(frame, handle, options.fromCenter)
  let sx = 1
  let sy = 1
  if (handle.includes('e')) sx = (currentDoc.x - anchor.x) / Math.max(1e-6, frame.x + frame.width - anchor.x)
  if (handle.includes('w')) sx = (currentDoc.x - anchor.x) / Math.min(-1e-6, frame.x - anchor.x)
  if (handle.includes('s')) sy = (currentDoc.y - anchor.y) / Math.max(1e-6, frame.y + frame.height - anchor.y)
  if (handle.includes('n')) sy = (currentDoc.y - anchor.y) / Math.min(-1e-6, frame.y - anchor.y)
  if (!handle.includes('e') && !handle.includes('w')) sx = 1
  if (!handle.includes('n') && !handle.includes('s')) sy = 1

  if (options.constrain) {
    const k = Math.max(Math.abs(sx), Math.abs(sy))
    sx = sx === 1 ? 1 : Math.sign(sx) * k
    sy = sy === 1 ? 1 : Math.sign(sy) * k
  }

  const m = multiply(
    multiply(translation(anchor.x, anchor.y), scaling(sx, sy)),
    translation(-anchor.x, -anchor.y),
  )
  for (const snap of s.nodes) {
    const world = multiply(m, snap.world)
    out.set(snap.id, world)
    pushLiveTransform(snap, world)
  }
}

/**
 * The size to publish for an in-flight resize.
 *
 * Everything but text keeps what the handle says. A text box whose height is
 * DERIVED does not: narrowing it adds lines, and the frame has to grow with
 * them while the pointer is still down. Computing it only at commit is what
 * made the box jump a whole paragraph the moment you let go.
 *
 * Which dimensions the box owns after the drag is decided here exactly as
 * adoptTextResize decides it at commit — a height from the handle means Fixed
 * Size, and then the handle's height is the answer — so the preview and the
 * result cannot disagree.
 */
function liveTextSize(
  snap: NodeSnapshot,
  box: LocalResizeBox,
): { width: number; height: number } {
  if (!snap.text) return { width: box.width, height: box.height }

  // What the HANDLE changed, before anything is derived from it.
  const sizing = sizingAfterResize(snap.text.style.sizing, {
    width: Math.abs(box.width - snap.transform.width) > 0.5,
    height: Math.abs(box.height - snap.transform.height) > 0.5,
  })
  session!.liveSizing.set(snap.id, sizing)

  // Fixed Size owns its height, so the handle's answer is the answer.
  if (sizing === 'fixed') return { width: box.width, height: box.height }
  // Otherwise the height is derived, and from the mode the box is TAKING ON —
  // an Auto Width style does not wrap, so asking it for a height at this width
  // would give one line however narrow the box gets.
  const style = sizing === snap.text.style.sizing ? snap.text.style : { ...snap.text.style, sizing }
  return { width: box.width, height: intrinsicTextSize(snap.text.text, style, box.width, snap.text.runs).height }
}

interface LocalResizeBox {
  x0: number
  y0: number
  width: number
  height: number
  sx: number
  sy: number
}

/**
 * New local box from a handle drag, in the node's own unrotated space.
 * `sx`/`sy` carry the mirror sign so dragging a handle past the opposite edge
 * flips the shape instead of collapsing it.
 */
function resizeLocalBox(
  w0: number,
  h0: number,
  handle: ResizeHandle,
  local: Vec2,
  options: DragUpdateOptions,
): LocalResizeBox {
  let x0 = 0
  let y0 = 0
  let x1 = w0
  let y1 = h0

  if (handle.includes('w')) x0 = local.x
  if (handle.includes('e')) x1 = local.x
  if (handle.includes('n')) y0 = local.y
  if (handle.includes('s')) y1 = local.y

  if (options.fromCenter) {
    // Grow symmetrically about the center: mirror whichever edge moved.
    const cx = w0 / 2
    const cy = h0 / 2
    if (handle.includes('w')) x1 = 2 * cx - x0
    if (handle.includes('e')) x0 = 2 * cx - x1
    if (handle.includes('n')) y1 = 2 * cy - y0
    if (handle.includes('s')) y0 = 2 * cy - y1
  }

  let sw = x1 - x0
  let sh = y1 - y0

  if (options.constrain && w0 > 0 && h0 > 0) {
    const aspect = w0 / h0
    // Corner handles preserve aspect; edge handles derive the other dimension.
    if (handle.length === 2) {
      const byWidth = Math.abs(sw) / w0 >= Math.abs(sh) / h0
      if (byWidth) sh = Math.sign(sh || 1) * (Math.abs(sw) / aspect)
      else sw = Math.sign(sw || 1) * (Math.abs(sh) * aspect)
      // Only the origin corner feeds the result, so the opposite edge needs no
      // update — it is already where the fixed anchor put it.
      if (handle.includes('n')) y0 = y1 - sh
      if (handle.includes('w')) x0 = x1 - sw
    }
  }

  const sx = sw < 0 ? -1 : 1
  const sy = sh < 0 ? -1 : 1
  return {
    x0,
    y0,
    width: Math.max(0.5, Math.abs(sw)),
    height: Math.max(0.5, Math.abs(sh)),
    sx,
    sy,
  }
}

function frameAnchor(frame: Bounds, handle: ResizeHandle, fromCenter: boolean): Vec2 {
  if (fromCenter) return { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 }
  return {
    x: handle.includes('w') ? frame.x + frame.width : handle.includes('e') ? frame.x : frame.x + frame.width / 2,
    y: handle.includes('n') ? frame.y + frame.height : handle.includes('s') ? frame.y : frame.y + frame.height / 2,
  }
}

/**
 * Push one node's live state to the DOM.
 *
 * Writes the local matrix (world re-expressed in the parent's space) onto the
 * node's <g>, and regenerates the geometry element's `d` when the resize changed
 * the node's own width/height — otherwise a resized rect would visibly scale its
 * stroke and corner radii, then snap on commit.
 */
function pushLiveTransform(
  snap: NodeSnapshot,
  world: Mat2D,
  width?: number,
  height?: number,
): void {
  const local = multiply(invert(snap.parentWorld), world)
  const override: { transform: Mat2D; attrs?: Record<string, string> } = { transform: local }

  if (width !== undefined && height !== undefined && usesIntrinsicSize(snap.type)) {
    const attrs: Record<string, string> = {}
    const d = livePathData(snap, width, height)
    if (d !== null) attrs.d = d
    if (snap.type === 'image') {
      // An <image> is sized by attributes, not by a path. Without these the
      // picture keeps its old size inside a clip that has already grown, and
      // the whole resize appears to do nothing until the mouse comes up.
      attrs.width = String(Math.max(0, width))
      attrs.height = String(Math.max(0, height))
    }
    if (Object.keys(attrs).length > 0) liveTransform.set(geomKey(snap.id), { attrs })

    // The filter region is sized from the box, and this is the one kind of
    // resize that changes the box without changing the matrix — so the region
    // does not scale with it and has to be rewritten. Leaving it stale clips
    // the SHAPE, not just its shadow, to whatever size it was when React last
    // rendered: the artefact reads as the effect switching off mid-gesture.
    if (snap.effectMargin > 0) {
      const region = filterRegion(snap.effectMargin, { width, height })
      liveTransform.set(fxKey(snap.id), {
        attrs: {
          x: String(region.x),
          y: String(region.y),
          width: String(region.width),
          height: String(region.height),
        },
      })
    }
  }
  liveTransform.set(snap.id, override)
}

/**
 * Whether resizing this node should scale its contents instead of its box.
 *
 * True only for containers with no box of their own. An artboard and a repeat
 * grid both draw their own transform.width/height, so they resize like a shape.
 */
function scalesContentOnResize(node: DesignNode | undefined): boolean {
  return !!node && isContainer(node) && !usesOwnBox(node)
}

/**
 * Types whose drawn geometry is derived from transform.width/height.
 *
 * Exported because the inspector needs the same answer: it may only scale its
 * readout by an in-flight resize for nodes whose geometry actually follows that
 * resize on screen. A group's children do not, so scaling its readout would
 * report a size nothing on the canvas has.
 */
export function usesIntrinsicSize(type: DesignNode['type']): boolean {
  return (
    type === 'rect' ||
    type === 'ellipse' ||
    type === 'polygon' ||
    type === 'path' ||
    type === 'line' ||
    type === 'image'
  )
}

function livePathData(snap: NodeSnapshot, width: number, height: number): string | null {
  const t = snap.transform
  switch (snap.type) {
    case 'rect':
      return rectPath(width, height, snap.cornerRadius ?? 0)
    case 'ellipse':
      return ellipsePath(width, height)
    case 'polygon':
      return polygonStarPath(
        width,
        height,
        snap.sides ?? 3,
        snap.starRatio ?? 1,
        snap.vertexRadius ?? 0,
      )
    case 'path':
      if (!snap.d) return null
      return transformPath(
        snap.d,
        scaling(t.width > 0 ? width / t.width : 1, t.height > 0 ? height / t.height : 1),
      )
    case 'image':
      // The clip the picture is drawn through, which is what gives it its
      // corner rounding.
      return rectPath(width, height, snap.cornerRadius ?? 0)
    case 'line': {
      if (!snap.line) return null
      const kx = t.width > 0 ? width / t.width : 1
      const ky = t.height > 0 ? height / t.height : 1
      return linePath(snap.line.x1 * kx, snap.line.y1 * ky, snap.line.x2 * kx, snap.line.y2 * ky)
    }
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Commit / cancel
// ---------------------------------------------------------------------------

/**
 * Close the gesture with a single transaction.
 *
 * Resize writes width/height for nodes with intrinsic geometry (so strokes and
 * corner radii stay the size the user set) and bakes the scale into path data
 * for path/line nodes, which have no parametric size to preserve.
 */
export function commitDrag(finalMatrices: Map<NodeId, Mat2D> | null): boolean {
  if (!session) return false
  const s = session
  session = null
  liveMatrices = new Map()
  liveTransform.end()
  editorStore.setState({ isDragging: false, snapGuides: [] })

  if (!s.moved || !finalMatrices || finalMatrices.size === 0) return false

  const label = s.mode === 'move' ? 'Move' : s.mode === 'rotate' ? 'Rotate' : 'Resize'

  return transaction(label, (draft) => {
    for (const snap of s.nodes) {
      const node = draft.nodes[snap.id]
      const world = finalMatrices.get(snap.id)
      if (!node || !world) continue

      const parentWorld = node.parentId ? worldMatrix(draft, node.parentId) : ([1, 0, 0, 1, 0, 0] as Mat2D)
      const local = multiply(invert(parentWorld), world)

      const recorded = s.liveSizes.get(snap.id)
      if (s.mode === 'resize' && s.singleAxisResize && recorded) {
        // `local` already encodes the re-anchor and the mirror sign; the new size
        // lives in width/height, not in the matrix, so it comes from the gesture.
        // A group records no size — its scale is in `local` — and falls through
        // to the branch below, which keeps width/height as they were.
        const size = recorded
        const kx = snap.transform.width > 0 ? size.width / snap.transform.width : 1
        const ky = snap.transform.height > 0 ? size.height / snap.transform.height : 1

        // Paths and lines have no parametric size to preserve, so the scale is
        // baked into their geometry (losslessly — svgpath keeps arcs as arcs).
        if (node.type === 'path' && snap.d) {
          node.d = transformPath(snap.d, scaling(kx, ky))
        }
        if (node.type === 'line' && snap.line) {
          node.x1 = snap.line.x1 * kx
          node.y1 = snap.line.y1 * ky
          node.x2 = snap.line.x2 * kx
          node.y2 = snap.line.y2 * ky
        }
        node.transform = transformFromMatrix(
          local,
          size.width,
          size.height,
          snap.transform.originX,
          snap.transform.originY,
        )

        // A text box that does not own a dimension has to be told the handle
        // just gave it one, or it keeps a size its own text does not fit.
        // The mode was decided while the gesture was live; applying it here
        // rather than deciding again is what keeps the two identical.
        const sizing = s.liveSizing.get(snap.id)
        if (node.type === 'text' && sizing) adoptTextResize(node, sizing)
      } else {
        node.transform = transformFromMatrix(
          local,
          snap.transform.width,
          snap.transform.height,
          snap.transform.originX,
          snap.transform.originY,
        )
      }
    }
  })
}

export function cancelDrag(): void {
  if (!session) return
  session = null
  liveMatrices = new Map()
  liveTransform.cancel()
  editorStore.setState({ isDragging: false, snapGuides: [] })
}

/** Selection bounds in world space, honoring an in-flight gesture. */
export function selectionBounds(doc: DesignDocument, ids: readonly NodeId[]): Bounds {
  const cache = createMatrixCache()
  return unionAll(ids.map((id) => geometryBounds(doc, id, cache)))
}

export { transformBounds, localMatrix }
