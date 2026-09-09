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
 * The pen tool — real Bezier construction, with XD's full modifier set.
 *
 * The six procedures Adobe documents all map onto three gestures:
 *
 *   click                  corner point            -> straight segments
 *   click-drag             mirrored handles        -> smooth curve
 *   Alt while dragging     independent handles     -> two curves meeting at a cusp
 *   Alt-click last anchor  retract the out handle  -> a curve followed by a line
 *
 * Shift constrains: 45 degrees when placing an anchor, 15 while pulling a handle.
 * Clicking the first point closes the path, and dragging from it shapes the
 * closing curve, which is why the close is deferred to pointerup. Enter, Escape
 * and double-click all end an open path.
 *
 * The path is only written to the document once, on finish, so a five-point path
 * is one undo step rather than five. Clicking an existing path with this tool
 * hands off to PathEditing for point-level work.
 */

import { applyToPoint, invert } from '../geometry/Matrix'
import { pathBounds } from '../geometry/PathUtils'
import {
  clearHandle,
  corner,
  pathToSubpaths,
  cornerPoint,
  moveHandle,
  reversePoints,
  smoothPoint,
  subpathToPath,
  subpathsToPath,
  type PenPoint,
  type PenSubpath,
} from '../geometry/PathPoints'
import { createPath } from '../document/NodeFactory'
import { isEffectivelyLocked, hitTest, hitTestAll, worldMatrix } from '../document/SceneGraph'
import { convertNodeToPath, removeNodes } from '../document/DocumentModel'
import { insertNode } from '../history/Commands'
import { getDoc, transaction } from '../state/DocumentStore'
import {
  editorStore,
  refreshOverlay,
  setEditor,
  setSelection,
  setTool,
} from '../state/EditorStore'
import {
  beginPathEditing,
  clearInsertPreview,
  pathEditGrabAt,
  editableOutline,
  endPathEditing,
  isPointEditable,
  pathEditDoubleClick,
  pathEditKeyDown,
  pathEditOpenEndAt,
  pathEditPointerDown,
  pathEditPointerMove,
  pathEditPointerUp,
  updateInsertPreview,
} from './PathEditing'
import { snapAngle } from './snapHelpers'
import { DEFAULT_STROKE } from '../document/types'
import type { Vec2 } from '../geometry/Matrix'
import type { DesignDocument, NodeId } from '../document/types'
import type { CanvasPointerEvent, Tool, ToolContext } from './types'

interface PenState {
  building: PenSubpath | null
  /** Pointer position, for the rubber-band preview of the pending segment. */
  hover: Vec2 | null
  /** True while dragging out handles on the point just placed. */
  draggingHandle: boolean
  dragStart: Vec2 | null
  /**
   * True between pressing on the first anchor and releasing, so the gesture can
   * shape the closing curve before the path is committed.
   */
  closing: boolean
  /**
   * The existing node this path is continuing, if any.
   *
   * Clicking an open end with the pen RESUMES that path rather than extending it
   * once: the points come into the pen's own model, so every further click
   * appends as normal and Enter or Escape finishes it. Without this you could
   * add exactly one point and the next click started an unrelated object.
   */
  resumeId: NodeId | null
  /**
   * Other nodes folded into the path being drawn, deleted when it is committed.
   *
   * Clicking a second path's open end JOINS the two: its points come into the
   * pen's model and the node they came from goes away, so what was two objects
   * ends as one. Kept until the commit so the whole join is a single undo step.
   */
  mergeIds: NodeId[]
  /**
   * An open end pressed, with nothing decided yet.
   *
   * A press on an end is two gestures wearing the same clothes: released where
   * it started it carries on drawing the path, and dragged it moves that point.
   * Committing either on the way down gets the other one wrong, so the press
   * only arms and the release chooses.
   */
  endArm: { id: NodeId; at: Vec2; press: CanvasPointerEvent } | null
  /** True once an armed press has moved far enough to be a point drag. */
  armDragging: boolean
  /** Whether the model differs from what is in the document. */
  dirty: boolean
  /**
   * The node's OTHER subpaths, in document space.
   *
   * The pen works on exactly one open subpath, and a node can hold more than
   * one. They are carried along so that writing the node back does not throw
   * the rest of it away.
   */
  otherSubs: PenSubpath[]
  /** The first anchor of a fresh path, which no undo step can restore. */
  origin: PenPoint | null
  /** True while writing the document, so the reload does not fight the write. */
  committing: boolean
  /** Bumped per gesture, so consecutive gestures cannot coalesce into one step. */
  step: number
  /** What the gesture in progress will be called in the undo history. */
  pendingLabel: string
  /**
   * Handles computed from the anchors instead of pulled by hand.
   *
   * Adobe's Curvature tool as a mode of the pen. See applyCurvature.
   */
  curvature: boolean
}

const pen: PenState = {
  building: null,
  hover: null,
  draggingHandle: false,
  dragStart: null,
  closing: false,
  resumeId: null,
  mergeIds: [],
  endArm: null,
  armDragging: false,
  dirty: false,
  otherSubs: [],
  origin: null,
  committing: false,
  step: 0,
  pendingLabel: 'Draw path',
  curvature: false,
}

/** Screen-pixel radius for "clicked the first point to close". */
const CLOSE_PX = 9
/** Below this screen distance a handle drag is still a click. */
const HANDLE_DEAD_PX = 2
/**
 * How far a curvature handle reaches, as a fraction of the span between the
 * neighbouring anchors. 1/3 is the classic Catmull-Rom-to-Bezier figure and is
 * what makes evenly spaced clicks trace a circle almost exactly.
 */
const CURVATURE_STRENGTH = 1 / 3

export function getPenPreview(): { sub: PenSubpath; rubber: PenSubpath | null } | null {
  if (!pen.building) return null
  // The pending segment is drawn as the path it would BECOME, which in
  // curvature mode is not a segment at all: placing the next anchor re-fairs
  // the one before it, so the preview has to be of the whole curve.
  const rubber =
    pen.hover && pen.building.points.length > 0
      ? pen.curvature
        ? withHover(pen.hover)
        : {
            closed: false,
            points: [pen.building.points[pen.building.points.length - 1]!, corner(pen.hover.x, pen.hover.y)],
          }
      : null
  return { sub: pen.building, rubber }
}

/** True while the pen computes handles from the anchors rather than by hand. */
export function isPenCurvature(): boolean {
  return pen.curvature
}

/**
 * Switch between pulling handles by hand and computing them from the anchors.
 *
 * @returns the mode now in force.
 */
export function togglePenCurvature(): boolean {
  pen.curvature = !pen.curvature
  // The points already placed follow the mode, so the switch is visible on the
  // path being drawn rather than only on whatever is placed after it.
  if (pen.building && pen.curvature) {
    applyCurvature(pen.building)
    pen.dirty = true
    pen.step++
    commitBuilding('Curvature', pen.building.closed)
  }
  refreshOverlay()
  return pen.curvature
}

function resetPen(): void {
  pen.building = null
  pen.hover = null
  pen.draggingHandle = false
  pen.dragStart = null
  pen.closing = false
  pen.resumeId = null
  pen.mergeIds = []
  pen.endArm = null
  pen.armDragging = false
  pen.dirty = false
  pen.otherSubs = []
  pen.origin = null
  pen.committing = false
  // `curvature` deliberately survives: it is a mode the user chose, not state
  // belonging to one path.
}

/**
 * An open end of `id` within reach of `at`, with the whole subpath in DOCUMENT
 * space.
 *
 * Document space, because that is what the pen builds in; finishPath maps the
 * points back through the target node's own matrix, so a path picked up here
 * keeps its transform, its style and its id.
 */
function openEndAt(
  doc: DesignDocument,
  id: NodeId,
  at: Vec2,
  zoom: number,
): { points: PenPoint[]; atHead: boolean } | null {
  const node = doc.nodes[id]
  const outline = editableOutline(node)
  if (!outline) return null

  const world = worldMatrix(doc, id)
  for (const sub of pathToSubpaths(outline)) {
    if (sub.closed || sub.points.length < 2) continue
    const toDoc = (p: PenPoint): PenPoint => {
      const a = applyToPoint(world, { x: p.x, y: p.y })
      const i = p.inX === null || p.inY === null ? null : applyToPoint(world, { x: p.inX, y: p.inY })
      const o = p.outX === null || p.outY === null ? null : applyToPoint(world, { x: p.outX, y: p.outY })
      return {
        x: a.x, y: a.y,
        inX: i?.x ?? null, inY: i?.y ?? null,
        outX: o?.x ?? null, outY: o?.y ?? null,
      }
    }
    const points = sub.points.map(toDoc)
    const head = points[0]!
    const tail = points[points.length - 1]!

    const atTail = Math.hypot(tail.x - at.x, tail.y - at.y) * zoom <= CLOSE_PX
    const atHead = !atTail && Math.hypot(head.x - at.x, head.y - at.y) * zoom <= CLOSE_PX
    if (!atTail && !atHead) continue
    return { points, atHead }
  }
  return null
}

/**
 * Pick up an existing open path and carry on drawing it.
 *
 * The points come into the pen's own model, so every further click appends as
 * normal and Enter or Escape finishes it. Without this you could add exactly one
 * point and the next click started an unrelated object.
 */
function resumeAt(doc: DesignDocument, id: NodeId, at: Vec2, zoom: number): boolean {
  const end = openEndAt(doc, id, at, zoom)
  if (!end) return false
  // Appending always happens at the END, so a head grab reverses the path.
  pen.building = { points: end.atHead ? reversePoints(end.points) : end.points, closed: false }
  pen.resumeId = id
  pen.dirty = false
  return true
}

/**
 * Another open path whose end is under the pointer, ready to be joined on.
 *
 * Its points arrive with the clicked end FIRST, so appending them runs the path
 * on from where the pen already is — the segment between the two ends is the
 * join, exactly as if it had been drawn by hand.
 */
function joinTargetAt(ctx: ToolContext, at: Vec2): { id: NodeId; points: PenPoint[] } | null {
  const doc = ctx.doc()
  const zoom = ctx.viewport().zoom
  const reach = Math.max(ctx.tolerance(), CLOSE_PX / zoom)
  const taken = new Set<NodeId>(pen.mergeIds)
  if (pen.resumeId) taken.add(pen.resumeId)

  // Topmost first, matching what a click would otherwise have selected.
  const candidates = hitTestAll(doc, at, { tolerance: reach })
  for (let i = candidates.length - 1; i >= 0; i--) {
    const id = candidates[i]!
    if (taken.has(id) || isEffectivelyLocked(doc, id)) continue
    const end = openEndAt(doc, id, at, zoom)
    if (end) return { id, points: end.atHead ? end.points : reversePoints(end.points) }
  }
  return null
}

/** Set the pointer's cursor, only when it actually changes. */
function setHoverCursor(cursor: string | null): void {
  if (editorStore.getState().hoverCursor !== cursor) setEditor({ hoverCursor: cursor })
}

/**
 * Hand the object over from point editing to drawing.
 *
 * The transform frame belongs to a selected object, and a path being drawn is
 * not one — leaving the selection in place drew a resize box with handles
 * around the very path the pen was extending.
 */
function enterDrawing(): void {
  setHoverCursor(null)
  if (editorStore.getState().nodeEditingId) {
    setEditor({ nodeEditingId: null, selectedPoints: [], selectedSegments: [] })
    endPathEditing()
  }
  clearInsertPreview()
  setSelection([])
}

/** The anchor a new segment would start from. */
function lastAnchor(): PenPoint | null {
  const pts = pen.building?.points
  return pts && pts.length > 0 ? pts[pts.length - 1]! : null
}

/**
 * Write the path being drawn into the document.
 *
 * Called after every gesture that changes it, so each anchor placed, each
 * handle pulled and each point removed is its own undo step — Cmd+Z steps back
 * through a path being drawn the way it steps back through anything else,
 * rather than throwing away the whole path at once. The first call on a fresh
 * path creates the node; every call after it rewrites the same one.
 *
 * Points are authored in DOCUMENT space and are mapped back through the node's
 * own matrix, so a path being extended keeps its transform, its style and its
 * id. A fresh path is rebased against its own bounds instead, so its transform
 * starts clean rather than carrying an arbitrary offset.
 */
function commitBuilding(label: string, closed: boolean): void {
  const sub = pen.building
  if (!sub || sub.points.length < 2 || !pen.dirty) return
  sub.closed = closed

  const doc = getDoc()
  const nodeId = pen.resumeId && doc.nodes[pen.resumeId] ? pen.resumeId : null

  // Reentrancy guard: writing the node notifies the document subscriber, which
  // would reload the very model being written from.
  pen.committing = true
  try {
    if (nodeId) {
      const toLocal = invert(worldMatrix(doc, nodeId))
      const toLocalPoint = (p: PenPoint): PenPoint => {
        const a = applyToPoint(toLocal, { x: p.x, y: p.y })
        const i = p.inX === null || p.inY === null ? null : applyToPoint(toLocal, { x: p.inX, y: p.inY })
        const o = p.outX === null || p.outY === null ? null : applyToPoint(toLocal, { x: p.outX, y: p.outY })
        return {
          x: a.x, y: a.y,
          inX: i?.x ?? null, inY: i?.y ?? null,
          outX: o?.x ?? null, outY: o?.y ?? null,
        }
      }
      // The pen's own subpath goes FIRST and the node's others follow, so
      // reading the node back finds the pen's work at index 0. Writing only the
      // pen's subpath, as this used to, threw the rest of the node away.
      const subs: PenSubpath[] = [
        { closed, points: sub.points.map(toLocalPoint) },
        ...pen.otherSubs.map((other) => ({
          closed: other.closed,
          points: other.points.map(toLocalPoint),
        })),
      ]
      const d = subpathsToPath(subs)
      const bounds = pathBounds(d)
      const merged = pen.mergeIds.filter((id) => id !== nodeId && doc.nodes[id])
      pen.mergeIds = []
      transaction(
        label,
        (draft) => {
          const target = draft.nodes[nodeId]
          if (!target) return false
          if (target.type !== 'path' && !convertNodeToPath(target, d, closed)) return false
          if (target.type !== 'path') return false
          target.d = d
          target.closed = closed
          target.transform = {
            ...target.transform,
            width: Math.max(0.5, bounds.width || target.transform.width),
            height: Math.max(0.5, bounds.height || target.transform.height),
          }
          // The joined-on paths go in the SAME transaction, so one undo puts
          // both objects back rather than leaving a merged path and a ghost.
          if (merged.length) removeNodes(draft, merged)
          return undefined
        },
        { coalesceKey: `pen:${nodeId}:${pen.step}` },
      )
      pen.dirty = false
      return
    }

    const b = pathBounds(subpathToPath(sub))
    const localSub: PenSubpath = {
      closed: sub.closed,
      points: sub.points.map((p) => ({
        x: p.x - b.x,
        y: p.y - b.y,
        inX: p.inX === null ? null : p.inX - b.x,
        inY: p.inY === null ? null : p.inY - b.y,
        outX: p.outX === null ? null : p.outX - b.x,
        outY: p.outY === null ? null : p.outY - b.y,
      })),
    }
    const node = createPath(
      subpathToPath(localSub),
      { x: b.x, y: b.y, width: Math.max(1, b.width), height: Math.max(1, b.height) },
      {
        fill: closed ? { type: 'solid', color: { r: 217, g: 217, b: 217, a: 1 } } : { type: 'none' },
        stroke: { ...DEFAULT_STROKE, paint: { type: 'solid', color: { r: 0, g: 0, b: 0, a: 1 } }, width: 1 },
      },
      closed,
    )
    // Not selected: a transform frame around a path still being drawn is not
    // what the pen is doing, and finishPath selects it when the path is done.
    pen.resumeId = insertNode(node, undefined, false)
    pen.dirty = false
  } finally {
    pen.committing = false
  }
}

/**
 * Reload the path being drawn from the document.
 *
 * Undo and redo change the node under the pen while it is still drawing, and
 * the pen's model has to follow or the next click writes the pre-undo geometry
 * straight back. The node is a faithful image of the model — the pen wrote it —
 * so reading it back is exact, and the pen's subpath is the one at index 0.
 */
export function syncPen(): void {
  if (!pen.building || pen.committing) return
  const id = pen.resumeId
  if (!id) return

  const doc = getDoc()
  const outline = editableOutline(doc.nodes[id])
  if (!outline) {
    // Undone past the node's creation. The first anchor was never in the
    // document, so it is restored from the pen rather than read back.
    pen.resumeId = null
    pen.otherSubs = []
    pen.mergeIds = []
    pen.dirty = true
    pen.building = pen.origin ? { points: [{ ...pen.origin }], closed: false } : null
    refreshOverlay()
    return
  }

  const world = worldMatrix(doc, id)
  const toDoc = (p: PenPoint): PenPoint => {
    const a = applyToPoint(world, { x: p.x, y: p.y })
    const i = p.inX === null || p.inY === null ? null : applyToPoint(world, { x: p.inX, y: p.inY })
    const o = p.outX === null || p.outY === null ? null : applyToPoint(world, { x: p.outX, y: p.outY })
    return {
      x: a.x, y: a.y,
      inX: i?.x ?? null, inY: i?.y ?? null,
      outX: o?.x ?? null, outY: o?.y ?? null,
    }
  }
  const subs = pathToSubpaths(outline)
  const own = subs[0]
  if (!own) return
  pen.building = { closed: own.closed, points: own.points.map(toDoc) }
  pen.otherSubs = subs.slice(1).map((other) => ({
    closed: other.closed,
    points: other.points.map(toDoc),
  }))
  pen.dirty = false
  refreshOverlay()
}

/**
 * Commit the path and put the pen down.
 *
 * Everything drawn is already in the document by now; this writes whatever the
 * last gesture left and hands the object back to the pointer tools.
 */
function finishPath(closed: boolean): void {
  const sub = pen.building
  if (!sub || sub.points.length < 2) {
    const id = pen.resumeId
    resetPen()
    if (id && getDoc().nodes[id]) setSelection([id])
    refreshOverlay()
    return
  }
  pen.step++
  commitBuilding(closed ? 'Close path' : 'Draw path', closed)
  const id = pen.resumeId
  resetPen()
  if (id && getDoc().nodes[id]) setSelection([id])
  refreshOverlay()
}

/**
 * Curvature mode: the anchors alone describe the path, and the handles are
 * computed from them.
 *
 * Adobe's Curvature tool, and the reason it exists — tracing a shape with the
 * pen means judging a handle length and direction at every anchor, and getting
 * one wrong bends the two segments either side of it. Here each anchor's
 * handles are a fraction of the vector between its NEIGHBOURS, which is the
 * Catmull-Rom construction: the curve passes through every point placed, and
 * placing the next one re-fairs the one before it. So a shape is traced by
 * clicking along it, and it stays smooth the whole way.
 *
 * The ends keep their corners. A handle there would have nothing on the far
 * side to balance against, and would send the curve past the last point.
 */
function applyCurvature(sub: PenSubpath): void {
  for (let i = 0; i < sub.points.length; i++) {
    if (!sub.closed && (i === 0 || i === sub.points.length - 1)) cornerPoint(sub, i)
    else smoothPoint(sub, i, CURVATURE_STRENGTH)
  }
}

/** The path as it would be with one more anchor where the pointer is. */
function withHover(hover: Vec2): PenSubpath | null {
  if (!pen.building) return null
  const sub: PenSubpath = {
    closed: false,
    points: [...pen.building.points.map((p) => ({ ...p })), corner(hover.x, hover.y)],
  }
  applyCurvature(sub)
  return sub
}

export const penTool: Tool = {
  id: 'pen',
  cursor: 'crosshair',
  label: 'Pen',
  shortcut: 'P',

  onPointerDown(e: CanvasPointerEvent, ctx: ToolContext): void {
    if (!pen.building) {
      const doc = ctx.doc()
      const hit = hitTest(doc, e.doc, { tolerance: ctx.tolerance() })
      const wasEditing = editorStore.getState().nodeEditingId

      // Pressing a path the pen is not already editing opens its points.
      if (hit && hit !== wasEditing && isPointEditable(doc.nodes[hit]) && !isEffectivelyLocked(doc, hit)) {
        setSelection([hit])
        setEditor({ nodeEditingId: hit, selectedPoints: [], selectedSegments: [] })
        beginPathEditing(hit)
      }

      const editingId = editorStore.getState().nodeEditingId
      if (editingId) {
        // An open end: arm, and let the release say whether this was a click
        // carrying the path on or a drag moving that point. Alt and Shift keep
        // their point-editing meanings, so they go straight through.
        const end = e.altKey || e.shiftKey ? null : pathEditOpenEndAt(e, ctx)
        if (end) {
          pen.endArm = { id: editingId, at: e.doc, press: e }
          pen.armDragging = false
          setEditor({ selectedPoints: [end], selectedSegments: [] })
          clearInsertPreview()
          refreshOverlay()
          return
        }
        // Only a path that was ALREADY open takes point work from this press.
        // The press that opened it does none: the anchors have only just
        // appeared, and dropping one under the pointer is not what a first
        // click on an object means.
        if (editingId === wasEditing && pathEditPointerDown(e, ctx, { insertOnSegment: true })) return
        // Pressed the object itself, just not on anything grabbable. Starting a
        // new path on top of it is never what that means.
        if (editingId !== wasEditing || hit === editingId) return
      }

      // The press missed everything: leave any open path alone rather than
      // drawing a second one with both overlays on screen.
      enterDrawing()
      pen.step++
      pen.origin = corner(e.doc.x, e.doc.y)
      pen.building = { points: [{ ...pen.origin }], closed: false }
      pen.pendingLabel = 'Draw path'
      pen.draggingHandle = !pen.curvature
      pen.dragStart = e.doc
      refreshOverlay()
      return
    }

    const zoom = ctx.viewport().zoom
    const points = pen.building.points
    const first = points[0]!
    const last = points[points.length - 1]!
    pen.step++

    // Alt on the LAST anchor retracts its outgoing handle, so the next segment
    // leaves as a straight line — XD's "draw curves followed by straight lines".
    // Checked before the close test because on a two-point path both can match.
    if (e.altKey && Math.hypot(e.doc.x - last.x, e.doc.y - last.y) * zoom <= CLOSE_PX) {
      clearHandle(pen.building, points.length - 1, 'out')
      pen.draggingHandle = false
      pen.dragStart = null
      pen.dirty = true
      pen.pendingLabel = 'Retract handle'
      refreshOverlay()
      return
    }

    // Closing: press near the first point. Committed on pointerup, so a drag in
    // between can shape the closing curve.
    if (points.length >= 2 && Math.hypot(e.doc.x - first.x, e.doc.y - first.y) * zoom <= CLOSE_PX) {
      pen.closing = true
      pen.draggingHandle = !pen.curvature
      pen.dragStart = e.doc
      return
    }

    // A different path's open end: join the two into one object. Checked before
    // placing a point, so the click lands on the path that is there rather than
    // dropping an anchor on top of it and leaving two objects touching.
    const join = joinTargetAt(ctx, e.doc)
    if (join) {
      points.push(...join.points)
      // Adopting the joined path as the target keeps ITS id and style when the
      // pen had none of its own; otherwise it is absorbed and removed.
      if (pen.resumeId === null) {
        pen.resumeId = join.id
        pen.otherSubs = []
      } else {
        pen.mergeIds.push(join.id)
      }
      pen.draggingHandle = false
      pen.dragStart = null
      pen.dirty = true
      pen.pendingLabel = 'Join paths'
      if (pen.curvature) applyCurvature(pen.building)
      refreshOverlay()
      return
    }

    const at = e.shiftKey ? snapAngle(last, e.doc, 45) : e.doc
    points.push(corner(at.x, at.y))
    // In curvature mode the anchors alone describe the path, so there are no
    // handles to pull and a drag from here would only fight the fairing.
    if (pen.curvature) applyCurvature(pen.building)
    pen.draggingHandle = !pen.curvature
    pen.dragStart = at
    pen.dirty = true
    pen.pendingLabel = 'Add point'
    refreshOverlay()
  },

  onPointerMove(e: CanvasPointerEvent, ctx: ToolContext): void {
    // An armed end that has travelled far enough is a point drag after all, so
    // the grab happens now — from where the press was, not from here, or the
    // point would jump to the pointer.
    if (pen.endArm && !pen.armDragging) {
      const arm = pen.endArm
      const moved = Math.hypot(e.doc.x - arm.at.x, e.doc.y - arm.at.y) * ctx.viewport().zoom
      if (moved > HANDLE_DEAD_PX) {
        pen.armDragging = true
        pathEditPointerDown(arm.press, ctx)
      }
    }

    if (editorStore.getState().nodeEditingId && pathEditPointerMove(e, ctx)) return

    const anchor = lastAnchor()
    pen.hover = e.shiftKey && anchor && !pen.draggingHandle ? snapAngle(anchor, e.doc, 45) : e.doc

    if (pen.draggingHandle && pen.building && pen.dragStart) {
      // While closing, the handle being pulled belongs to the FIRST point.
      const index = pen.closing ? 0 : pen.building.points.length - 1
      const point = pen.building.points[index]
      if (point) {
        const to = e.shiftKey ? snapAngle(pen.dragStart, e.doc, 15) : e.doc
        const moved = Math.hypot(to.x - pen.dragStart.x, to.y - pen.dragStart.y)
        if (moved * ctx.viewport().zoom > HANDLE_DEAD_PX) {
          if (pen.closing) {
            // Only the incoming side: mirroring would rotate the first point's
            // outgoing handle and rewrite the segment already drawn from it.
            moveHandle(pen.building, 0, 'in', to, false)
          } else {
            // Alt splits the handles, which is how two curves meet at a cusp.
            // Without it they mirror, making the joint smooth.
            moveHandle(pen.building, index, 'out', to, !e.altKey)
          }
          pen.dirty = true
        } else if (!pen.closing) {
          // Dragged out and back again: leave a corner rather than a smooth
          // point wearing stale handles.
          cornerPoint(pen.building, index)
        }
      }
    } else if (!pen.building && !pen.endArm) {
      // Idle over a path being edited: show where a click would drop an anchor,
      // and say which of the two things a press would do.
      updateInsertPreview(e, ctx)
      setHoverCursor(pathEditGrabAt(e, ctx) ? 'move' : null)
    }
    refreshOverlay()
  },

  onPointerUp(e: CanvasPointerEvent, ctx: ToolContext): void {
    void e
    const arm = pen.endArm
    pen.endArm = null
    if (arm && !pen.armDragging) {
      // Released where it went down: carry on drawing that path from here.
      if (resumeAt(ctx.doc(), arm.id, arm.at, ctx.viewport().zoom)) {
        enterDrawing()
        refreshOverlay()
        return
      }
    }
    pen.armDragging = false

    if (editorStore.getState().nodeEditingId && pathEditPointerUp()) return
    pen.draggingHandle = false
    pen.dragStart = null
    if (pen.closing) {
      pen.closing = false
      pen.dirty = true
      // Closing joins the last point to the first, so in curvature mode the
      // fairing has to be redone with the ring closed — otherwise the one
      // anchor the curve comes back to is the one left as a corner.
      if (pen.curvature && pen.building) {
        pen.building.closed = true
        applyCurvature(pen.building)
      }
      finishPath(true)
      return
    }
    // One press, one undo step: the anchor and any handle pulled out of it in
    // the same gesture go in together.
    commitBuilding(pen.pendingLabel, false)
  },

  onDoubleClick(e: CanvasPointerEvent, ctx: ToolContext): void {
    if (editorStore.getState().nodeEditingId && pathEditDoubleClick(e, ctx)) return
    if (pen.building) finishPath(false)
  },

  onKeyDown(e: KeyboardEvent): boolean {
    if (editorStore.getState().nodeEditingId && pathEditKeyDown(e)) return true

    if (e.key === 'Enter') {
      if (pen.building) {
        finishPath(false)
        return true
      }
    }
    if (e.key === 'Escape') {
      if (pen.building) {
        // XD ends the open path and returns to Select. Nothing is lost — the
        // whole path is one transaction, so Cmd+Z removes it in a single step.
        finishPath(false)
        setTool('select')
        return true
      }
      setTool('select')
      return true
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      if (pen.building && pen.building.points.length > 1) {
        pen.building.points.pop()
        if (pen.curvature) applyCurvature(pen.building)
        pen.dirty = true
        pen.step++
        commitBuilding('Remove point', false)
        refreshOverlay()
        return true
      }
    }
    return false
  },

  /**
   * Pick up whatever is already selected, as the two pointers do.
   *
   * Choosing the Pen with a path selected should put you straight into that
   * path: its points on screen, ready for a click on an end to carry on drawing
   * it. Needing to click the object first was a step that existed only because
   * nothing was listening for the tool change — and it was worse here than
   * elsewhere, because a click on the canvas with the Pen is how you START A NEW
   * PATH, so the "wake it up" click was ambiguous with drawing.
   */
  onActivate(ctx: ToolContext): void {
    const editor = editorStore.getState()
    if (editor.nodeEditingId || pen.building) return
    if (editor.selection.length !== 1) return
    const id = editor.selection[0]!
    const doc = ctx.doc()
    if (isEffectivelyLocked(doc, id) || !isPointEditable(doc.nodes[id])) return
    setEditor({ nodeEditingId: id, selectedPoints: [], selectedSegments: [] })
    beginPathEditing(id)
  },

  onDeactivate(): void {
    clearInsertPreview()
    setHoverCursor(null)
    // Leaving the tool mid-path commits what has been drawn rather than losing it.
    if (pen.building && pen.building.points.length >= 2) finishPath(false)
    else resetPen()
    // Point editing is NOT ended here: `nodeEditingId` owns its lifetime and the
    // Canvas subscriber closes it when setTool clears that. Ending it here would
    // stop the Pen and the two pointers handing the points back and forth.
    resetPen()
  },
}

/** Append a point programmatically — used by tests and by paste-into-path. */
export function appendPenPoint(p: PenPoint): void {
  if (!pen.building) pen.building = { points: [p], closed: false }
  else pen.building.points.push(p)
}

export { transaction }
