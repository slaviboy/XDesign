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
  compose,
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
  NEAR_W,
  applyMat3,
  homographyW,
  invertMat3,
  isAffineMat3,
  mapPoint,
  type Mat3,
} from '../geometry/Perspective'
import {
  localContentBox,
  frameBounds,
  geometryBounds,
  localMatrix,
  worldMatrix,
  createMatrixCache,
  isEffectivelyLocked,
} from '../document/SceneGraph'
import { frameMatrix, is3dAffected, nodeMapping, patchDocument } from '../document/Scene3D'
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
  /**
   * The box actually being dragged, in the node's local space. Equal to
   * (0,0,width,height) for everything with a size of its own; for a group it is
   * where its contents really are, which its stored box stops describing the
   * moment a child moves.
   */
  content: Bounds
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
  /** Set for a node drawn in perspective; see PerspectiveSnapshot. */
  persp?: PerspectiveSnapshot
}

/**
 * What a gesture needs to move something that is drawn in perspective.
 *
 * Its matrices are still 2D — that is what the drag edits and commits — but
 * the pointer is on the PROJECTED object, so the pointer has to be run back
 * through the projection before it can say anything about those matrices.
 */
interface PerspectiveSnapshot {
  /** World -> the parent's local space, through the parent's own projection. */
  parentFromWorld: Mat3 | null
  /** False when the parent is flat and the plain inverse matrix already says it all. */
  projectiveParent: boolean
  /** World -> this node's local space, through its projection. */
  fromWorld: Mat3 | null
  /** Where the press landed, in this node's local space. */
  startLocal: Vec2 | null
  /** The projection's w at a local point: below NEAR_W it is behind the camera. */
  horizon: (p: Vec2) => number
  /**
   * Set for a 3D object that resizes through its matrix — a group — sitting
   * on a flat parent: the bounds of its PROJECTED contents in its own space.
   *
   * Its matrix is applied after its camera, so scaling it scales the picture
   * on screen, not the flat artwork behind it. Resizing that picture's box is
   * then exact — the handle stays under the pointer and the opposite side
   * does not move — with no projection to run backwards at all.
   */
  frameBox: Bounds | null
  /** The frame the selection box is drawn in, at the press. */
  frame0: Mat2D
}

export interface DragSessionState {
  mode: DragMode
  handle: ResizeHandle | null
  startDoc: Vec2
  /**
   * The document the gesture began on. Only read for things drawn in
   * perspective, whose projection depends on a size and a pivot the drag is
   * changing — never written, like everything else here.
   */
  doc: DesignDocument
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
  /**
   * The size the last frame of a perspective resize settled on — where the
   * next frame's solve starts. See fitPerspectiveResize.
   */
  lastFit: { width: number; height: number } | null
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

/**
 * Every in-flight world matrix. A new map per update, so its identity doubles
 * as a version number for anything that memoises on the gesture.
 */
export function getLiveMatrices(): ReadonlyMap<NodeId, Mat2D> {
  return liveMatrices
}

export function getLiveSize(id: NodeId): { width: number; height: number } | undefined {
  return session?.liveSizes.get(id)
}

/**
 * The in-flight box of a node being resized, in its local space.
 *
 * The SIZE alone is not enough to draw a frame from: a path whose points have
 * been dragged above or left of where it started keeps geometry that begins at
 * a negative offset, and the resize pins that corner where it is. Framing
 * `(0, 0, width, height)` instead put the handles a whole offset away from the
 * shape until the pointer came up and the document was measured again.
 */
export function getLiveBox(id: NodeId): Bounds | undefined {
  const size = session?.liveSizes.get(id)
  const snap = size && session!.nodes.find((n) => n.id === id)
  if (!size || !snap) return undefined
  return { x: snap.content.x, y: snap.content.y, width: size.width, height: size.height }
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
      content: localContentBox(doc, node),
      vertexRadius: node.type === 'polygon' ? node.cornerRadius : undefined,
      effectMargin: hasStyle(node) ? effectMargin(node.style) : 0,
      text: node.type === 'text' ? { text: node.text, style: node.textStyle, runs: node.runs } : undefined,
      persp: is3dAffected(doc, id) ? perspectiveSnapshot(doc, node, startDoc) : undefined,
    }
  })

  session = {
    mode,
    handle,
    startDoc,
    doc,
    frame: unionAll(usable.map((id) => geometryBounds(doc, id, cache))),
    nodes,
    singleAxisResize: usable.length === 1,
    scalesContent: usable.length === 1 && scalesContentOnResize(doc.nodes[usable[0]!]),
    liveSizes: new Map(),
    liveSizing: new Map(),
    moved: false,
    lastFit: null,
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

function perspectiveSnapshot(doc: DesignDocument, node: DesignNode, startDoc: Vec2): PerspectiveSnapshot {
  const parentMap = node.parentId && doc.nodes[node.parentId]
    ? nodeMapping(doc, node.parentId).toWorld
    : null
  const mapping = nodeMapping(doc, node.id)
  const toWorld = mapping.toWorld
  const fromWorld = invertMat3(toWorld)
  const projectiveParent = !!parentMap && !isAffineMat3(parentMap)
  const ownCamera = mapping.space?.rootId === node.id
  return {
    frame0: frameMatrix(doc, node.id),
    parentFromWorld: parentMap ? invertMat3(parentMap) : null,
    projectiveParent,
    fromWorld,
    startLocal: fromWorld ? finitePoint(applyMat3(fromWorld, startDoc.x, startDoc.y)) : null,
    horizon: (p) => homographyW(toWorld, p.x, p.y),
    frameBox:
      ownCamera && !projectiveParent && scalesContentOnResize(node)
        ? frameBounds(doc, node.id, worldMatrix(doc, node.id))
        : null,
  }
}

function finitePoint(p: { x: number; y: number }): Vec2 | null {
  return Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : null
}

/** A world point in the parent's local space, through the parent's projection. */
function inParent(snap: NodeSnapshot, p: Vec2): Vec2 | null {
  const m = snap.persp?.parentFromWorld
  return m ? finitePoint(applyMat3(m, p.x, p.y)) : null
}

/**
 * A world matrix that applies a parent-space matrix to the node's local one.
 *
 * Moving or turning something on a tilted plane has to happen IN that plane —
 * a drag across the screen is a shorter, foreshortened move across the card —
 * so the change is worked out in the parent's own space and then re-expressed
 * as the world matrix the rest of the session speaks.
 */
function inParentSpace(snap: NodeSnapshot, m: Mat2D): Mat2D {
  const local = multiply(invert(snap.parentWorld), snap.world)
  return multiply(snap.parentWorld, multiply(m, local))
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
  const s = session!
  for (const snap of s.nodes) {
    let world = multiply(m, snap.world)
    if (snap.persp?.projectiveParent) {
      // On a tilted parent the same screen distance is a longer or shorter
      // move across it, depending on where on it you are: run both ends of the
      // drag back into the parent's plane and move by the difference there.
      const from = inParent(snap, s.startDoc)
      const to = inParent(snap, { x: s.startDoc.x + mx, y: s.startDoc.y + my })
      if (from && to) world = inParentSpace(snap, translation(to.x - from.x, to.y - from.y))
    }
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
    let world = multiply(m, snap.world)
    if (snap.persp?.projectiveParent) {
      // Turned in the parent's plane, about the point of it under the frame's
      // centre — a turn on a tilted card, not a turn of the screen.
      const c = inParent(snap, { x: cx, y: cy })
      if (c) world = inParentSpace(snap, rotationAbout(deg, c.x, c.y))
    }
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
    // A group is measured by its contents, which need not start at its local
    // origin: its stored box is written once and never refitted. Resizing
    // against the stored box scaled the artwork about a corner that was not on
    // it, so the contents slid sideways as they grew — worst from the handles
    // furthest from that corner. `content` is the box actually being dragged.
    // A tilted group resizes its projected picture, exactly; anything else in
    // perspective resizes its flat box, through the projection. See
    // PerspectiveSnapshot.frameBox.
    const projected = snap.persp?.frameBox ?? null
    const content = projected ?? snap.content
    const local = snap.persp && !projected
      ? perspectivePointer(snap, handle, currentDoc)
      : applyToPoint(invert(snap.world), currentDoc)
    const box = resizeLocalBox(
      content.width,
      content.height,
      handle,
      { x: local.x - content.x, y: local.y - content.y },
      options,
    )
    // Something in perspective cannot be mirrored (Adobe does not flip 3D
    // objects either), so a handle dragged past the far edge collapses the box
    // against the pinned side rather than turning it inside out.
    if (snap.persp) collapseMirror(box, content, handle, options.fromCenter)
    // Re-anchor: the new local origin sits at (x0,y0) of the OLD local space,
    // and a negative signed extent mirrors the shape rather than inverting it.
    // For a group the extent goes into the scale as well, which is the only
    // thing that moves its children.
    const kx = s.scalesContent && content.width > 0 ? box.width / content.width : 1
    const ky = s.scalesContent && content.height > 0 ? box.height / content.height : 1
    // Into the content box's frame, resize there, and back out again.
    const reanchor = compose(
      translation(-content.x, -content.y),
      scaling(box.sx * kx, box.sy * ky),
      translation(box.x0, box.y0),
      translation(content.x, content.y),
    )
    let world = multiply(snap.world, reanchor)
    if (s.scalesContent) {
      if (snap.persp && !projected) {
        world = pinAnchor(s, snap, world, reanchor, handle, options, snap.transform.width, snap.transform.height)
      }
      out.set(snap.id, world)
      pushLiveTransform(snap, world)
      return
    }
    let size = liveTextSize(snap, box)
    if (snap.persp) {
      // Text derives its height from its width, so it keeps the estimate; a
      // shape is solved until its projected frame's edge is under the pointer.
      const fitted = snap.text ? null : fitPerspectiveResize(s, snap, handle, options, currentDoc, size)
      if (fitted) {
        world = fitted.world
        size = fitted.size
      } else {
        world = pinAnchor(s, snap, world, reanchor, handle, options, size.width, size.height)
      }
    }
    s.liveSizes.set(snap.id, size)
    out.set(snap.id, world)
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

/** See the call site: a mirrored extent becomes the thinnest box at the pinned side. */
function collapseMirror(
  box: LocalResizeBox,
  content: Bounds,
  handle: ResizeHandle,
  fromCenter: boolean,
): void {
  const MIN = 0.5
  if (box.sx < 0) {
    box.sx = 1
    box.width = MIN
    box.x0 = fromCenter ? (content.width - MIN) / 2 : handle.includes('w') ? content.width - MIN : 0
  }
  if (box.sy < 0) {
    box.sy = 1
    box.height = MIN
    box.y0 = fromCenter ? (content.height - MIN) / 2 : handle.includes('n') ? content.height - MIN : 0
  }
}

/**
 * Where a resize handle has been dragged to, in the node's own local space,
 * for a node drawn in perspective.
 *
 * The handle is on the frame round the PROJECTED object, which is not on the
 * object at all where the near side bulges past the far one, so the pointer
 * itself cannot be run back through the projection — it would land beyond the
 * edge and the box would jump on the first move. The motion can: the pointer's
 * travel since the press, measured in the object's own plane, is added to
 * where the grabbed handle nominally sits on the box.
 */
function perspectivePointer(snap: NodeSnapshot, handle: ResizeHandle, currentDoc: Vec2): Vec2 {
  const c = snap.content
  const grip = {
    x: c.x + (handle.includes('w') ? 0 : handle.includes('e') ? c.width : c.width / 2),
    y: c.y + (handle.includes('n') ? 0 : handle.includes('s') ? c.height : c.height / 2),
  }
  const p = snap.persp!
  if (!p.fromWorld || !p.startLocal) return grip
  const now = finitePoint(applyMat3(p.fromWorld, currentDoc.x, currentDoc.y))
  // A point past the object's horizon has a preimage behind the camera, which
  // means nothing for a drag; hold the last sensible answer instead.
  if (!now || p.horizon(now) < NEAR_W) return grip
  return { x: grip.x + now.x - p.startLocal.x, y: grip.y + now.y - p.startLocal.y }
}

/**
 * Put the side opposite the handle back where it was on screen.
 *
 * A flat resize keeps that side still by construction. In perspective it does
 * not: the camera looks at the box's centre, a new size moves the centre, and
 * with it the whole projection shifts. So the resized node is projected once,
 * the pinned point measured, and the node moved — in its parent's own plane —
 * by however far that point strayed.
 */
function pinAnchor(
  s: DragSessionState,
  snap: NodeSnapshot,
  world: Mat2D,
  reanchor: Mat2D,
  handle: ResizeHandle,
  options: DragUpdateOptions,
  width: number,
  height: number,
): Mat2D {
  const node = s.doc.nodes[snap.id]
  const p = snap.persp
  if (!node || !p) return world
  const c = snap.content
  const fx = options.fromCenter ? 0.5 : handle.includes('w') ? 1 : handle.includes('e') ? 0 : 0.5
  const fy = options.fromCenter ? 0.5 : handle.includes('n') ? 1 : handle.includes('s') ? 0 : 0.5
  const pinned = { x: c.x + fx * c.width, y: c.y + fy * c.height }
  const target = mapPoint(nodeMapping(s.doc, snap.id).toWorld, pinned.x, pinned.y)
  if (!target) return world

  // The same point in the resized node's own space: world = old · reanchor.
  const inNew = applyToPoint(invert(reanchor), pinned)
  const local = multiply(invert(snap.parentWorld), world)
  const resized = {
    ...node,
    transform: transformFromMatrix(local, width, height, snap.transform.originX, snap.transform.originY),
  } as DesignNode
  const moved = patchDocument(s.doc, new Map([[snap.id, resized]]))
  const landed = mapPoint(nodeMapping(moved, snap.id).toWorld, inNew.x, inNew.y)
  if (!landed) return world
  const a = inParent(snap, target)
  const b = inParent(snap, landed)
  if (!a || !b) return world
  return multiply(snap.parentWorld, multiply(translation(a.x - b.x, a.y - b.y), local))
}

/**
 * The size that keeps the grabbed point of a tilted shape under the pointer.
 *
 * Growing the flat box by the pointer's travel is not quite enough, because
 * growing it moves the centre the camera looks at and the whole projection
 * breathes. So the size is solved for: find the width and height at which the
 * point of the box that was grabbed — the corner, or the middle of the edge,
 * that the handle stands for — lands where the pointer has taken it, with the
 * opposite side pinned where it was.
 *
 * Three things keep that steady, and each one was a visible bug without it.
 * The target is that point on the SHAPE, not the edge of the frame round it:
 * the frame is the bounds of the projected corners, which corner makes each
 * edge changes as the shape grows, and a kinked target sent the solve
 * overshooting — the box leapt, shrank back and leapt again. Width and height
 * are solved TOGETHER, with the full two-by-two slope, since in perspective
 * each moves both coordinates of the point. And every frame starts from where
 * the last one finished, so the size can only move as continuously as the
 * pointer does; a step that does not bring the point closer is halved until
 * it does.
 */
function fitPerspectiveResize(
  s: DragSessionState,
  snap: NodeSnapshot,
  handle: ResizeHandle,
  options: DragUpdateOptions,
  currentDoc: Vec2,
  estimate: { width: number; height: number },
): { world: Mat2D; size: { width: number; height: number } } | null {
  const p = snap.persp
  const node = s.doc.nodes[snap.id]
  if (!p || !node) return null
  const c = snap.content
  // The point that stays put, and the point that was grabbed, as fractions
  // of the box.
  const fx = options.fromCenter ? 0.5 : handle.includes('w') ? 1 : handle.includes('e') ? 0 : 0.5
  const fy = options.fromCenter ? 0.5 : handle.includes('n') ? 1 : handle.includes('s') ? 0 : 0.5
  const gx = handle.includes('e') ? 1 : handle.includes('w') ? 0 : 0.5
  const gy = handle.includes('s') ? 1 : handle.includes('n') ? 0 : 0.5
  const freeW = handle.includes('e') || handle.includes('w')
  const freeH = handle.includes('n') || handle.includes('s')

  const grabbed = mapPoint(nodeMapping(s.doc, snap.id).toWorld, c.x + gx * c.width, c.y + gy * c.height)
  if (!grabbed) return null
  // Measured in the frame's own axes, so an edge handle follows only the
  // pointer's motion across that edge, however the object is turned.
  const toFrame = invert(p.frame0)
  const target = applyToPoint(toFrame, {
    x: grabbed.x + currentDoc.x - s.startDoc.x,
    y: grabbed.y + currentDoc.y - s.startDoc.y,
  })
  // Shift keeps the proportions: one unknown, a scale of the whole box.
  const proportional = options.constrain && freeW && freeH

  const build = (width: number, height: number) => {
    const reanchor = compose(
      translation(-c.x, -c.y),
      translation(fx * (c.width - width), fy * (c.height - height)),
      translation(c.x, c.y),
    )
    const world = pinAnchor(s, snap, multiply(snap.world, reanchor), reanchor, handle, options, width, height)
    const local = multiply(invert(snap.parentWorld), world)
    const resized = {
      ...node,
      transform: transformFromMatrix(local, width, height, snap.transform.originX, snap.transform.originY),
    } as DesignNode
    const moved = patchDocument(s.doc, new Map([[snap.id, resized]]))
    // The resized box keeps its corner at (c.x, c.y) in its own space.
    const at = mapPoint(nodeMapping(moved, snap.id).toWorld, c.x + gx * width, c.y + gy * height)
    if (!at) return null
    const q = applyToPoint(toFrame, at)
    return { world, rx: freeW ? q.x - target.x : 0, ry: freeH ? q.y - target.y : 0 }
  }
  const norm = (r: { rx: number; ry: number }) => Math.hypot(r.rx, r.ry)

  // Continue from the last frame; the first frame starts from the estimate.
  let width = s.lastFit?.width ?? estimate.width
  let height = s.lastFit?.height ?? estimate.height
  if (proportional) height = width * (c.height / Math.max(1e-6, c.width))
  let cur = build(width, height)
  if (!cur) return null

  for (let iter = 0; iter < 8 && norm(cur) > 0.01; iter++) {
    const e = Math.max(0.25, 1e-3 * Math.max(width, height))
    let dw = 0
    let dh = 0
    if (proportional) {
      // One unknown, the scale; follow whichever way the pointer moved more.
      const k = c.height / Math.max(1e-6, c.width)
      const probe = build(width + e, (width + e) * k)
      if (!probe) break
      const useX = Math.abs(cur.rx) >= Math.abs(cur.ry)
      const slope = useX ? (probe.rx - cur.rx) / e : (probe.ry - cur.ry) / e
      if (Math.abs(slope) < 1e-9) break
      dw = -(useX ? cur.rx : cur.ry) / slope
      dh = dw * k
    } else {
      // The slope of the grabbed point in the frame's x and y, per unit of
      // width and of height.
      const pw = freeW ? build(width + e, height) : null
      const ph = freeH ? build(width, height + e) : null
      if ((freeW && !pw) || (freeH && !ph)) break
      const a = pw ? (pw.rx - cur.rx) / e : 0
      const cc = pw ? (pw.ry - cur.ry) / e : 0
      const b = ph ? (ph.rx - cur.rx) / e : 0
      const d = ph ? (ph.ry - cur.ry) / e : 0
      if (freeW && freeH) {
        const det = a * d - b * cc
        if (Math.abs(det) < 1e-12) break
        dw = (-cur.rx * d + cur.ry * b) / det
        dh = (cur.rx * cc - cur.ry * a) / det
      } else if (freeW) {
        if (Math.abs(a) < 1e-9) break
        dw = -cur.rx / a
      } else {
        if (Math.abs(d) < 1e-9) break
        dh = -cur.ry / d
      }
    }
    // Damped: only a step that brings the point closer is taken.
    let step = 1
    let next = null
    while (step > 1 / 64) {
      const w = Math.max(0.5, width + dw * step)
      const h = Math.max(0.5, height + dh * step)
      const trial = build(w, h)
      if (trial && norm(trial) < norm(cur)) {
        next = { w, h, trial }
        break
      }
      step /= 2
    }
    if (!next) break
    width = next.w
    height = next.h
    cur = next.trial
  }
  s.lastFit = { width, height }
  return { world: cur.world, size: { width, height } }
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
      return transformPath(snap.d, geometryScale(snap, width, height))
    case 'image':
      // The clip the picture is drawn through, which is what gives it its
      // corner rounding.
      return rectPath(width, height, snap.cornerRadius ?? 0)
    case 'line': {
      if (!snap.line) return null
      const line = scaledLine(snap.line, geometryScale(snap, width, height))
      return linePath(line.x1, line.y1, line.x2, line.y2)
    }
    default:
      return null
  }
}

/**
 * A resize as applied to a path's or a line's own coordinates: about the corner
 * of the geometry, and by how far the geometry's box — the box the handles are
 * on — has grown.
 *
 * About the corner because that is what applyResize's re-anchor assumes: it
 * moves the content box's corner, not the local origin. The two only coincide
 * for geometry that starts at (0, 0), and a path stops doing so the moment a
 * point is dragged above or left of it. Scaling about the origin instead slid
 * the "pinned" corner by the offset times the growth, so the shape crept away
 * from the pointer while it was being dragged.
 *
 * By the content box rather than transform.width/height, because the handle
 * that was grabbed sits on the content box; when the stored size disagreed with
 * the geometry, the shape moved at a different rate from the pointer.
 */
function geometryScale(snap: NodeSnapshot, width: number, height: number): Mat2D {
  const c = snap.content
  return compose(
    translation(-c.x, -c.y),
    scaling(c.width > 0 ? width / c.width : 1, c.height > 0 ? height / c.height : 1),
    translation(c.x, c.y),
  )
}

function scaledLine(
  line: NonNullable<NodeSnapshot['line']>,
  m: Mat2D,
): { x1: number; y1: number; x2: number; y2: number } {
  const a = applyToPoint(m, { x: line.x1, y: line.y1 })
  const b = applyToPoint(m, { x: line.x2, y: line.y2 })
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y }
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

        // Paths and lines have no parametric size to preserve, so the scale is
        // baked into their geometry (losslessly — svgpath keeps arcs as arcs).
        // The same scale the preview drew, so letting go changes nothing.
        if (node.type === 'path' && snap.d) {
          node.d = transformPath(snap.d, geometryScale(snap, size.width, size.height))
        }
        if (node.type === 'line' && snap.line) {
          Object.assign(node, scaledLine(snap.line, geometryScale(snap, size.width, size.height)))
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
