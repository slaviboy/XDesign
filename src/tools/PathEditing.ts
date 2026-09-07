/**
 * Direct Bezier point editing for an existing path node.
 *
 * Active whenever `editorStore.nodeEditingId` is set — reached by double-clicking
 * a selected path, or by clicking one with the pen tool. Both the selection tool
 * and the pen tool delegate here first, so point editing behaves identically
 * however the user got into it.
 *
 * Points live in the node's LOCAL space; the pointer is converted once per event
 * so dragging a handle on a rotated path tracks the cursor exactly.
 */

import { applyToPoint, invert, type Mat2D, type Vec2 } from '../geometry/Matrix'
import { pathBounds } from '../geometry/PathUtils'
import {
  clearHandle,
  closestSegment,
  corner,
  deletePoint,
  insertPointAt,
  moveHandle,
  movePoint,
  pathToSubpaths,
  subpathsToPath,
  togglePointType,
  type PenSubpath,
} from '../geometry/PathPoints'
import { worldMatrix } from '../document/SceneGraph'
import { transaction, getDoc } from '../state/DocumentStore'
import { editorStore, refreshOverlay, setEditor } from '../state/EditorStore'
import type { PointRef } from '../state/EditorStore'
import type { NodeId } from '../document/types'
import type { CanvasPointerEvent, ToolContext } from './types'

/** Alias, so a grab result drops straight into the store with no conversion. */
export type PointHandleRef = PointRef

interface EditState {
  nodeId: NodeId | null
  subs: PenSubpath[]
  world: Mat2D
  dragging: PointHandleRef | null
  lastLocal: Vec2 | null
  changed: boolean
}

const edit: EditState = {
  nodeId: null,
  subs: [],
  world: [1, 0, 0, 1, 0, 0],
  dragging: null,
  lastLocal: null,
  changed: false,
}

/** Screen-pixel radius for grabbing a point or handle. */
const GRAB_PX = 7

export function getEditingSubpaths(): { nodeId: NodeId; subs: PenSubpath[]; world: Mat2D } | null {
  if (!edit.nodeId) return null
  return { nodeId: edit.nodeId, subs: edit.subs, world: edit.world }
}

/** Load a node's path into the editable point model. */
export function beginPathEditing(nodeId: NodeId): boolean {
  const doc = getDoc()
  const node = doc.nodes[nodeId]
  if (!node || node.type !== 'path') return false
  edit.nodeId = nodeId
  edit.subs = pathToSubpaths(node.d)
  edit.world = worldMatrix(doc, nodeId)
  edit.dragging = null
  edit.changed = false
  refreshOverlay()
  return true
}

export function endPathEditing(): void {
  edit.nodeId = null
  edit.subs = []
  edit.dragging = null
  edit.changed = false
}

/** Keep the point model in step with the document (undo, inspector edits). */
export function syncPathEditing(): void {
  if (!edit.nodeId) return
  const doc = getDoc()
  const node = doc.nodes[edit.nodeId]
  if (!node || node.type !== 'path') {
    endPathEditing()
    return
  }
  if (!edit.dragging) {
    edit.subs = pathToSubpaths(node.d)
    edit.world = worldMatrix(doc, edit.nodeId)
  }
}

function toLocal(p: Vec2): Vec2 {
  return applyToPoint(invert(edit.world), p)
}

function findGrab(local: Vec2, toleranceLocal: number): PointHandleRef | null {
  let best: { ref: PointHandleRef; dist: number } | null = null
  edit.subs.forEach((sub, si) => {
    sub.points.forEach((p, i) => {
      // Handles are checked first so an overlapping handle stays grabbable.
      if (p.outX !== null && p.outY !== null) {
        const d = Math.hypot(p.outX - local.x, p.outY - local.y)
        if (d <= toleranceLocal && (!best || d < best.dist)) {
          best = { ref: { subpath: si, index: i, kind: 'out' }, dist: d }
        }
      }
      if (p.inX !== null && p.inY !== null) {
        const d = Math.hypot(p.inX - local.x, p.inY - local.y)
        if (d <= toleranceLocal && (!best || d < best.dist)) {
          best = { ref: { subpath: si, index: i, kind: 'in' }, dist: d }
        }
      }
      const da = Math.hypot(p.x - local.x, p.y - local.y)
      if (da <= toleranceLocal && (!best || da <= best.dist)) {
        best = { ref: { subpath: si, index: i, kind: 'anchor' }, dist: da }
      }
    })
  })
  return best ? (best as { ref: PointHandleRef }).ref : null
}

/** @returns true when the event was consumed by point editing. */
export function pathEditPointerDown(e: CanvasPointerEvent, ctx: ToolContext): boolean {
  if (!edit.nodeId) return false
  const tolLocal = (GRAB_PX / ctx.viewport().zoom) * localScale()
  const local = toLocal(e.doc)

  const grab = findGrab(local, tolLocal)
  if (grab) {
    // Alt-click toggles corner <-> smooth instead of starting a drag.
    if (e.altKey && grab.kind === 'anchor') {
      const sub = edit.subs[grab.subpath]
      if (sub) {
        togglePointType(sub, grab.index)
        edit.changed = true
        commitPath('Convert point')
      }
      return true
    }
    edit.dragging = grab
    edit.lastLocal = local
    setEditor({ selectedPoints: [grab] })
    refreshOverlay()
    return true
  }

  // Clicking on the outline inserts a point there.
  const near = closestSegment(edit.subs, local)
  if (near && near.distance <= tolLocal) {
    const sub = edit.subs[near.subpath]
    if (sub) {
      const inserted = insertPointAt(sub, near.index, near.t)
      if (inserted !== null) {
        edit.changed = true
        // Armed before the commit so the point can be dragged in the SAME
        // gesture: commitPath can reload edit.subs, which would drop the ref.
        edit.dragging = { subpath: near.subpath, index: inserted, kind: 'anchor' }
        edit.lastLocal = local
        commitPath('Insert point')
        setEditor({ selectedPoints: [{ subpath: near.subpath, index: inserted, kind: 'anchor' }] })
      }
    }
    return true
  }

  return false
}

export function pathEditPointerMove(e: CanvasPointerEvent, _ctx: ToolContext): boolean {
  if (!edit.nodeId || !edit.dragging || !edit.lastLocal) return false
  const local = toLocal(e.doc)
  const sub = edit.subs[edit.dragging.subpath]
  if (!sub) return false

  if (edit.dragging.kind === 'anchor') {
    movePoint(sub, edit.dragging.index, local.x - edit.lastLocal.x, local.y - edit.lastLocal.y)
  } else {
    // Alt breaks the joint so the two handles move independently.
    moveHandle(sub, edit.dragging.index, edit.dragging.kind, local, !e.altKey)
  }
  edit.lastLocal = local
  edit.changed = true
  refreshOverlay()
  return true
}

export function pathEditPointerUp(): boolean {
  if (!edit.nodeId || !edit.dragging) return false
  edit.dragging = null
  edit.lastLocal = null
  if (edit.changed) commitPath('Edit path')
  return true
}

export function pathEditKeyDown(e: KeyboardEvent): boolean {
  if (!edit.nodeId) return false

  if (e.key === 'Escape') {
    setEditor({ nodeEditingId: null, selectedPoints: [] })
    endPathEditing()
    return true
  }

  if (e.key === 'Delete' || e.key === 'Backspace') {
    const refs = editorStore.getState().selectedPoints
    if (refs.length === 0) return false

    // Grouped BY SUBPATH, and deleted from the end within each, so indices stay
    // valid and one ring's edit cannot reach into another's.
    const bySubpath = new Map<number, PointRef[]>()
    for (const ref of refs) {
      const list = bySubpath.get(ref.subpath)
      if (list) list.push(ref)
      else bySubpath.set(ref.subpath, [ref])
    }

    let removed = false
    for (const [si, list] of bySubpath) {
      const sub = edit.subs[si]
      if (!sub) continue
      for (const ref of [...list].sort((a, b) => b.index - a.index)) {
        if (ref.kind !== 'anchor') {
          // Selecting the end of a direction line and pressing Delete removes
          // that handle, exactly as XD does — the anchor stays put.
          clearHandle(sub, ref.index, ref.kind)
          removed = true
          continue
        }
        // Never let a path be deleted down to nothing: subpathsToPath would emit
        // an empty string and pathBounds would have no geometry to measure.
        if (sub.points.length <= 2) continue
        if (deletePoint(sub, ref.index)) removed = true
      }
    }

    if (removed) {
      edit.changed = true
      commitPath('Delete point')
      setEditor({ selectedPoints: [] })
    }
    return true
  }
  return false
}

/**
 * Double-click an anchor to convert it corner <-> smooth.
 *
 * XD's binding. The existing Alt-click does the same thing and is kept: this
 * only fires once point editing is already open, so it cannot collide with the
 * double-click that ENTERS point editing from the selection tool.
 */
export function pathEditDoubleClick(e: CanvasPointerEvent, ctx: ToolContext): boolean {
  if (!edit.nodeId) return false
  const tolLocal = (GRAB_PX / ctx.viewport().zoom) * localScale()
  const grab = findGrab(toLocal(e.doc), tolLocal)
  if (!grab || grab.kind !== 'anchor') return false
  const sub = edit.subs[grab.subpath]
  if (!sub) return false
  togglePointType(sub, grab.index)
  edit.changed = true
  commitPath('Convert point')
  return true
}

/**
 * Continue an open path from one of its ends.
 *
 * Reuses the whole editing commit path, so the node keeps its id, its style and
 * its place in the layer tree — the alternative, starting a fresh path that
 * happens to touch the old one, leaves the user with two objects where they
 * drew one.
 */
export function pathEditExtendAt(e: CanvasPointerEvent, ctx: ToolContext): boolean {
  if (!edit.nodeId) return false
  const tolLocal = (GRAB_PX / ctx.viewport().zoom) * localScale()
  const local = toLocal(e.doc)

  for (let si = 0; si < edit.subs.length; si++) {
    const sub = edit.subs[si]!
    if (sub.closed || sub.points.length === 0) continue
    const head = sub.points[0]!
    const tail = sub.points[sub.points.length - 1]!

    const atTail = Math.hypot(tail.x - local.x, tail.y - local.y) <= tolLocal
    const atHead = !atTail && Math.hypot(head.x - local.x, head.y - local.y) <= tolLocal
    if (!atTail && !atHead) continue

    const point = corner(local.x, local.y)
    const index = atTail ? sub.points.length : 0
    if (atTail) sub.points.push(point)
    else sub.points.unshift(point)

    // Armed so the same press can pull handles out of the new anchor.
    edit.dragging = { subpath: si, index, kind: 'anchor' }
    edit.lastLocal = local
    edit.changed = true
    commitPath('Extend path')
    setEditor({ selectedPoints: [{ subpath: si, index, kind: 'anchor' }] })
    return true
  }
  return false
}

/**
 * Write the edited points back as path data.
 *
 * The node's transform.width/height are refreshed from the new geometry bounds so
 * the selection frame and the inspector's W/H keep matching what is drawn.
 */
function commitPath(label: string): void {
  const nodeId = edit.nodeId
  if (!nodeId) return
  const d = subpathsToPath(edit.subs)
  transaction(
    label,
    (draft) => {
      const node = draft.nodes[nodeId]
      if (!node || node.type !== 'path') return false
      node.d = d
      const b = pathBounds(d)
      node.transform = {
        ...node.transform,
        width: Math.max(0.5, b.width || node.transform.width),
        height: Math.max(0.5, b.height || node.transform.height),
      }
      return undefined
    },
    { coalesceKey: `path:${nodeId}` },
  )
  edit.changed = false
  refreshOverlay()
}

/** Local-space size of one document unit, so grab radii feel constant on screen. */
function localScale(): number {
  const sx = Math.hypot(edit.world[0], edit.world[1]) || 1
  const sy = Math.hypot(edit.world[2], edit.world[3]) || 1
  return 1 / ((sx + sy) / 2)
}
