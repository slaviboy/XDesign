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
  subpathToPath,
  type PenPoint,
  type PenSubpath,
} from '../geometry/PathPoints'
import { createPath } from '../document/NodeFactory'
import { hitTest, worldMatrix } from '../document/SceneGraph'
import { convertNodeToPath } from '../document/DocumentModel'
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
  editableOutline,
  endPathEditing,
  isPointEditable,
  pathEditDoubleClick,
  pathEditExtendAt,
  pathEditKeyDown,
  pathEditPointerDown,
  pathEditPointerMove,
  pathEditPointerUp,
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
}

const pen: PenState = {
  building: null,
  hover: null,
  draggingHandle: false,
  dragStart: null,
  closing: false,
  resumeId: null,
}

/** Screen-pixel radius for "clicked the first point to close". */
const CLOSE_PX = 9
/** Below this screen distance a handle drag is still a click. */
const HANDLE_DEAD_PX = 2

export function getPenPreview(): { sub: PenSubpath; hover: Vec2 | null } | null {
  return pen.building ? { sub: pen.building, hover: pen.hover } : null
}

function resetPen(): void {
  pen.building = null
  pen.hover = null
  pen.draggingHandle = false
  pen.dragStart = null
  pen.closing = false
  pen.resumeId = null
}

/**
 * Try to pick up an existing open path at the point clicked.
 *
 * Points are carried into DOCUMENT space, because that is what the pen builds
 * in; finishPath maps them back through the node's own matrix, so a resumed
 * path keeps its transform, its style and its id.
 */
function resumeAt(doc: DesignDocument, id: NodeId, at: Vec2, zoom: number): boolean {
  const node = doc.nodes[id]
  const outline = editableOutline(node)
  if (!outline) return false

  const world = worldMatrix(doc, id)
  const subs = pathToSubpaths(outline)
  for (const sub of subs) {
    if (sub.closed || sub.points.length < 2) continue
    const toDoc = (p: PenPoint): PenPoint => ({
      x: applyToPoint(world, { x: p.x, y: p.y }).x,
      y: applyToPoint(world, { x: p.x, y: p.y }).y,
      inX: p.inX === null || p.inY === null ? null : applyToPoint(world, { x: p.inX, y: p.inY }).x,
      inY: p.inX === null || p.inY === null ? null : applyToPoint(world, { x: p.inX, y: p.inY }).y,
      outX: p.outX === null || p.outY === null ? null : applyToPoint(world, { x: p.outX, y: p.outY }).x,
      outY: p.outX === null || p.outY === null ? null : applyToPoint(world, { x: p.outX, y: p.outY }).y,
    })
    const points = sub.points.map(toDoc)
    const head = points[0]!
    const tail = points[points.length - 1]!

    const atTail = Math.hypot(tail.x - at.x, tail.y - at.y) * zoom <= CLOSE_PX
    const atHead = !atTail && Math.hypot(head.x - at.x, head.y - at.y) * zoom <= CLOSE_PX
    if (!atTail && !atHead) continue

    // Appending always happens at the END, so a head grab reverses the path —
    // which swaps each point's two handles with it.
    if (atHead) {
      points.reverse()
      for (const pt of points) {
        const [ix, iy] = [pt.inX, pt.inY]
        pt.inX = pt.outX
        pt.inY = pt.outY
        pt.outX = ix
        pt.outY = iy
      }
    }

    pen.building = { points, closed: false }
    pen.resumeId = id
    return true
  }
  return false
}

/** The anchor a new segment would start from. */
function lastAnchor(): PenPoint | null {
  const pts = pen.building?.points
  return pts && pts.length > 0 ? pts[pts.length - 1]! : null
}

/**
 * Commit the in-progress path.
 *
 * Points are authored in document space; they are rebased into the node's local
 * space so the node's transform starts clean at identity rather than carrying an
 * arbitrary offset.
 */
function finishPath(closed: boolean): void {
  const sub = pen.building
  if (!sub || sub.points.length < 2) {
    resetPen()
    refreshOverlay()
    return
  }

  sub.closed = closed

  // Resuming an existing node: map the points back through ITS matrix and write
  // them in, so the path keeps its id, its style and its place in the tree.
  if (pen.resumeId) {
    const nodeId = pen.resumeId
    const doc = getDoc()
    if (doc.nodes[nodeId]) {
      const toLocal = invert(worldMatrix(doc, nodeId))
      const localPoints = sub.points.map((p) => {
        const a = applyToPoint(toLocal, { x: p.x, y: p.y })
        const i = p.inX === null || p.inY === null ? null : applyToPoint(toLocal, { x: p.inX, y: p.inY })
        const o = p.outX === null || p.outY === null ? null : applyToPoint(toLocal, { x: p.outX, y: p.outY })
        return {
          x: a.x, y: a.y,
          inX: i?.x ?? null, inY: i?.y ?? null,
          outX: o?.x ?? null, outY: o?.y ?? null,
        }
      })
      const d = subpathToPath({ closed, points: localPoints })
      const bounds = pathBounds(d)
      resetPen()
      transaction('Extend path', (draft) => {
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
        return undefined
      })
      setSelection([nodeId])
      refreshOverlay()
      return
    }
  }

  const worldD = subpathToPath(sub)
  const b = pathBounds(worldD)

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

  resetPen()
  insertNode(node)
  refreshOverlay()
}

export const penTool: Tool = {
  id: 'pen',
  cursor: 'crosshair',
  label: 'Pen',
  shortcut: 'P',

  onPointerDown(e: CanvasPointerEvent, ctx: ToolContext): void {
    // Editing an existing path takes priority over starting a new one, and an
    // open end continues the path rather than beginning a second one.
    if (editorStore.getState().nodeEditingId) {
      if (pathEditExtendAt(e, ctx)) return
      if (pathEditPointerDown(e, ctx)) return
    }

    if (!pen.building) {
      // Clicking an existing path with the pen enters point editing on it, or
      // extends it when the click lands on an open end.
      const hit = hitTest(ctx.doc(), e.doc, { tolerance: ctx.tolerance() })
      // An open end picks the path back up, so the next click carries on
      // drawing it instead of starting an unrelated object beside it.
      if (hit && resumeAt(ctx.doc(), hit, e.doc, ctx.viewport().zoom)) {
        if (editorStore.getState().nodeEditingId) {
          setEditor({ nodeEditingId: null, selectedPoints: [] })
          endPathEditing()
        }
        pen.draggingHandle = true
        pen.dragStart = e.doc
        refreshOverlay()
        return
      }
      // Otherwise clicking a shape opens its points for editing.
      if (hit && isPointEditable(ctx.doc().nodes[hit])) {
        setSelection([hit])
        setEditor({ nodeEditingId: hit })
        beginPathEditing(hit)
        // Only the extend case carries this press over: clicking an open end
        // continues the path in one gesture. A press on the body just opens the
        // editor — inserting a point there as well would add an anchor nobody
        // asked for, and XD only inserts once you are already editing.
        pathEditExtendAt(e, ctx)
        return
      }
      // Editing was live but the press missed everything: leave that path alone
      // rather than starting a second one with both overlays on screen.
      if (editorStore.getState().nodeEditingId) {
        setEditor({ nodeEditingId: null, selectedPoints: [] })
        endPathEditing()
      }
      pen.building = { points: [corner(e.doc.x, e.doc.y)], closed: false }
      pen.draggingHandle = true
      pen.dragStart = e.doc
      refreshOverlay()
      return
    }

    const zoom = ctx.viewport().zoom
    const points = pen.building.points
    const first = points[0]!
    const last = points[points.length - 1]!

    // Alt on the LAST anchor retracts its outgoing handle, so the next segment
    // leaves as a straight line — XD's "draw curves followed by straight lines".
    // Checked before the close test because on a two-point path both can match.
    if (e.altKey && Math.hypot(e.doc.x - last.x, e.doc.y - last.y) * zoom <= CLOSE_PX) {
      clearHandle(pen.building, points.length - 1, 'out')
      pen.draggingHandle = false
      pen.dragStart = null
      refreshOverlay()
      return
    }

    // Closing: press near the first point. Committed on pointerup, so a drag in
    // between can shape the closing curve.
    if (points.length >= 2 && Math.hypot(e.doc.x - first.x, e.doc.y - first.y) * zoom <= CLOSE_PX) {
      pen.closing = true
      pen.draggingHandle = true
      pen.dragStart = e.doc
      return
    }

    const at = e.shiftKey ? snapAngle(last, e.doc, 45) : e.doc
    points.push(corner(at.x, at.y))
    pen.draggingHandle = true
    pen.dragStart = at
    refreshOverlay()
  },

  onPointerMove(e: CanvasPointerEvent, ctx: ToolContext): void {
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
        } else if (!pen.closing) {
          // Dragged out and back again: leave a corner rather than a smooth
          // point wearing stale handles.
          cornerPoint(pen.building, index)
        }
      }
    }
    refreshOverlay()
  },

  onPointerUp(e: CanvasPointerEvent, ctx: ToolContext): void {
    void e
    void ctx
    if (editorStore.getState().nodeEditingId && pathEditPointerUp()) return
    pen.draggingHandle = false
    pen.dragStart = null
    if (pen.closing) {
      pen.closing = false
      finishPath(true)
    }
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
        refreshOverlay()
        return true
      }
    }
    return false
  },

  onDeactivate(): void {
    // Leaving the tool mid-path commits what has been drawn rather than losing it.
    if (pen.building && pen.building.points.length >= 2) finishPath(false)
    else resetPen()
    endPathEditing()
  },
}

/** Append a point programmatically — used by tests and by paste-into-path. */
export function appendPenPoint(p: PenPoint): void {
  if (!pen.building) pen.building = { points: [p], closed: false }
  else pen.building.points.push(p)
}

export { transaction }
