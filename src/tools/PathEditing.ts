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
import { ancestorIds, nodePathData, worldMatrix } from '../document/SceneGraph'
import { convertNodeToPath } from '../document/DocumentModel'
import { liveTransform } from '../canvas/LiveTransform'
import { geomKey } from '../canvas/liveKeys'
import { transaction, getDoc } from '../state/DocumentStore'
import { editorStore, refreshOverlay, setEditor } from '../state/EditorStore'
import type { PointRef } from '../state/EditorStore'
import type { DesignNode, NodeId } from '../document/types'
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
  /** True while a LiveTransform override is open, so it is closed exactly once. */
  live: boolean
}

const edit: EditState = {
  nodeId: null,
  subs: [],
  world: [1, 0, 0, 1, 0, 0],
  dragging: null,
  lastLocal: null,
  changed: false,
  live: false,
}

/**
 * Start pushing the edited geometry straight to the mounted SVG element.
 *
 * Point editing used to repaint through refreshOverlay(), which bumps
 * `overlayTick` — and the only subscriber to that is ToolOverlay, which draws
 * previews and rubber bands but not path points. So neither the shape nor the
 * anchor dots moved until the mouse came up. This is the same LiveTransform
 * channel DragSession and RadiusSession use, and it needs no coordinate
 * conversion: `edit.subs` and the element's `d` are both in local space.
 */
function beginLive(): void {
  if (edit.live) return
  edit.live = true
  liveTransform.begin()
  editorStore.setState({ isDragging: true })
}

/** Push the current points to the DOM. Also wakes the overlay, via the flush. */
function pushLive(): void {
  if (!edit.nodeId || !edit.live) return
  liveTransform.set(geomKey(edit.nodeId), { attrs: { d: subpathsToPath(edit.subs) } })
}

function endLive(commit: boolean): void {
  if (!edit.live) return
  edit.live = false
  if (commit) liveTransform.end()
  else liveTransform.cancel()
  editorStore.setState({ isDragging: false })
}

/** Screen-pixel radius for grabbing a point or handle. */
const GRAB_PX = 7

/**
 * The outline to edit, or null for a node that has no editable points.
 *
 * An explicit allow-list rather than a bare `nodePathData` call, because that
 * falls back to a box for text, svg, artboards and repeat grids — editing one
 * would turn a text node into a rectangle-shaped path and throw the text away.
 * Images are out for the same reason: converting one would drop its asset.
 */
export function editableOutline(node: DesignNode | undefined): string | null {
  if (!node) return null
  switch (node.type) {
    case 'path':
      return node.d
    case 'rect':
    case 'ellipse':
    case 'polygon':
    case 'line':
      return nodePathData(node)
    default:
      return null
  }
}

/** Whether this node's points can be edited — the gate both pointer tools use. */
export function isPointEditable(node: DesignNode | undefined): boolean {
  return editableOutline(node) !== null
}

export function getEditingSubpaths(): { nodeId: NodeId; subs: PenSubpath[]; world: Mat2D } | null {
  if (!edit.nodeId) return null
  return { nodeId: edit.nodeId, subs: edit.subs, world: edit.world }
}

/**
 * Load a node's outline into the editable point model.
 *
 * Any shape can be opened — a line shows its two ends, a rectangle its four
 * corners — and NOTHING is written to the document here. The node only becomes
 * a real path when the user first moves something; see commitPath.
 */
export function beginPathEditing(nodeId: NodeId): boolean {
  const doc = getDoc()
  const node = doc.nodes[nodeId]
  const outline = editableOutline(node)
  if (!outline) return false
  // Inside a repeat grid only the first cell registers with LiveTransform, so a
  // live preview would show on one cell while committing to all of them.
  if (ancestorIds(doc, nodeId).some((a) => doc.nodes[a]?.type === 'repeat-grid')) return false
  edit.nodeId = nodeId
  edit.subs = pathToSubpaths(outline)
  edit.world = worldMatrix(doc, nodeId)
  edit.dragging = null
  edit.changed = false
  refreshOverlay()
  return true
}

export function endPathEditing(): void {
  if (!edit.nodeId) return
  endLive(false)
  edit.nodeId = null
  edit.subs = []
  edit.dragging = null
  edit.lastLocal = null
  edit.changed = false
}

/** Keep the point model in step with the document (undo, inspector edits). */
export function syncPathEditing(): void {
  if (!edit.nodeId) return
  const doc = getDoc()
  const node = doc.nodes[edit.nodeId]
  const outline = editableOutline(node)
  if (!outline) {
    endPathEditing()
    return
  }
  // Reloading from the OUTLINE, not from node.d, is what lets undo take a
  // converted path back to being a rectangle without evicting the editor.
  if (!edit.dragging) {
    edit.subs = pathToSubpaths(outline)
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
    beginLive()
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
        beginLive()
        setEditor({ selectedPoints: [{ subpath: near.subpath, index: inserted, kind: 'anchor' }] })
      }
    }
    return true
  }

  return false
}

export function pathEditPointerMove(e: CanvasPointerEvent, _ctx: ToolContext): boolean {
  if (!edit.nodeId || !edit.dragging || !edit.lastLocal) return false

  // Self-healing: a tool switch mid-gesture can deliver the pointerup elsewhere,
  // and a button-less move here would otherwise keep deforming the shape.
  if (e.buttons === 0) {
    edit.dragging = null
    edit.lastLocal = null
    edit.changed = false
    endLive(false)
    syncPathEditing()
    refreshOverlay()
    return true
  }

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
  pushLive()
  return true
}

export function pathEditPointerUp(): boolean {
  if (!edit.nodeId || !edit.dragging) return false
  // Commit FIRST, while `dragging` is still set. Any store write notifies the
  // Canvas subscriber, and syncPathEditing reloads edit.subs from the document
  // unless a drag is in progress — so clearing `dragging` before committing
  // threw the whole edit away and wrote back the pre-drag geometry.
  if (edit.changed) commitPath('Edit path')
  edit.dragging = null
  edit.lastLocal = null
  // Released after the commit: end() drops the override without restoring, and
  // by now React has the same geometry from the document, so nothing flashes.
  endLive(true)
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
  const closed = edit.subs.length > 0 && edit.subs.every((sub) => sub.closed)
  transaction(
    label,
    (draft) => {
      const node = draft.nodes[nodeId]
      if (!node) return false
      // First real edit of a parametric shape turns it into a path, in place.
      // Opening the editor alone converts nothing, so looking costs nothing.
      if (node.type !== 'path' && !convertNodeToPath(node, d, closed)) return false
      if (node.type !== 'path') return false
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
