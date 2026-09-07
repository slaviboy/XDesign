/**
 * The pen tool — real Bezier construction.
 *
 * Click places a corner point; click-and-drag pulls out mirrored handles and
 * makes it smooth. Clicking the first point closes the path. Enter or Escape
 * finishes an open one. While drawing, the next segment is rubber-banded in the
 * overlay so the curve is visible before it is committed.
 *
 * The path is only written to the document once, on finish, so a five-point path
 * is one undo step rather than five. Clicking an existing path with this tool
 * hands off to PathEditing for point-level work.
 */

import { pathBounds } from '../geometry/PathUtils'
import { subpathToPath, corner, type PenPoint, type PenSubpath } from '../geometry/PathPoints'
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
  pathEditKeyDown,
  pathEditPointerDown,
  pathEditPointerMove,
  pathEditPointerUp,
} from './PathEditing'
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
}

const pen: PenState = {
  building: null,
  hover: null,
  draggingHandle: false,
  dragStart: null,
}

/** Screen-pixel radius for "clicked the first point to close". */
const CLOSE_PX = 9

export function getPenPreview(): { sub: PenSubpath; hover: Vec2 | null } | null {
  return pen.building ? { sub: pen.building, hover: pen.hover } : null
}

function resetPen(): void {
  pen.building = null
  pen.hover = null
  pen.draggingHandle = false
  pen.dragStart = null
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
    // Editing an existing path takes priority over starting a new one.
    if (editorStore.getState().nodeEditingId) {
      if (pathEditPointerDown(e, ctx)) return
    }

    if (!pen.building) {
      // Clicking an existing path with the pen enters point editing on it.
      const hit = hitTest(ctx.doc(), e.doc, { tolerance: ctx.tolerance() })
      if (hit && ctx.doc().nodes[hit]?.type === 'path') {
        setSelection([hit])
        setEditor({ nodeEditingId: hit })
        beginPathEditing(hit)
        return
      }
      pen.building = { points: [corner(e.doc.x, e.doc.y)], closed: false }
      pen.draggingHandle = true
      pen.dragStart = e.doc
      refreshOverlay()
      return
    }

    // Closing: click near the first point.
    const first = pen.building.points[0]!
    const closeDist = Math.hypot(e.doc.x - first.x, e.doc.y - first.y) * ctx.viewport().zoom
    if (pen.building.points.length >= 2 && closeDist <= CLOSE_PX) {
      finishPath(true)
      return
    }

    pen.building.points.push(corner(e.doc.x, e.doc.y))
    pen.draggingHandle = true
    pen.dragStart = e.doc
    refreshOverlay()
  },

  onPointerMove(e: CanvasPointerEvent, ctx: ToolContext): void {
    if (editorStore.getState().nodeEditingId && pathEditPointerMove(e, ctx)) return

    pen.hover = e.doc

    if (pen.draggingHandle && pen.building && pen.dragStart) {
      const point = pen.building.points[pen.building.points.length - 1]
      if (point) {
        const dx = e.doc.x - pen.dragStart.x
        const dy = e.doc.y - pen.dragStart.y
        if (Math.hypot(dx, dy) * ctx.viewport().zoom > 2) {
          // Symmetric handles: dragging forward pulls the outgoing tangent and
          // mirrors it backwards, which is what makes a smooth joint.
          point.outX = pen.dragStart.x + dx
          point.outY = pen.dragStart.y + dy
          point.inX = pen.dragStart.x - dx
          point.inY = pen.dragStart.y - dy
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
  },

  onDoubleClick(): void {
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
        // First Escape drops the in-progress path; a second leaves the tool.
        resetPen()
        refreshOverlay()
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
