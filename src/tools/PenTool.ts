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

import { pathBounds } from '../geometry/PathUtils'
import {
  clearHandle,
  corner,
  cornerPoint,
  moveHandle,
  subpathToPath,
  type PenPoint,
  type PenSubpath,
} from '../geometry/PathPoints'
import { createPath } from '../document/NodeFactory'
import { hitTest } from '../document/SceneGraph'
import { insertNode } from '../history/Commands'
import { transaction } from '../state/DocumentStore'
import {
  editorStore,
  refreshOverlay,
  setEditor,
  setSelection,
  setTool,
} from '../state/EditorStore'
import {
  beginPathEditing,
  endPathEditing,
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
}

const pen: PenState = {
  building: null,
  hover: null,
  draggingHandle: false,
  dragStart: null,
  closing: false,
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
      if (hit && ctx.doc().nodes[hit]?.type === 'path') {
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
