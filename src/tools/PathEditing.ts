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
  deletePoint,
  insertPointAt,
  moveHandle,
  movePoint,
  pathToSubpaths,
  segmentPoint,
  subpathsToPath,
  togglePointType,
  type PenSubpath,
} from '../geometry/PathPoints'
import { ancestorIds, nodePathData, worldMatrix } from '../document/SceneGraph'
import { convertNodeToPath } from '../document/DocumentModel'
import { liveTransform } from '../canvas/LiveTransform'
import { geomKey } from '../canvas/liveKeys'
import { breakHistoryCoalescing, transaction, getDoc } from '../state/DocumentStore'
import { hasStyle } from '../document/types'
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
  insertPreview = null
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
/** What a click on the outline should do, which differs by tool. */
export interface PathEditOptions {
  /**
   * Insert a point where the outline was clicked.
   *
   * The Pen's job, and only the Pen's. Direct Selection used to do it too, so
   * every attempt to pick up an edge and move it left a new anchor behind
   * instead — the tool for adjusting a shape was the tool most likely to add
   * to it by accident.
   */
  insertOnSegment?: boolean
}

/** The points a drag should move: the selected anchors, plus both ends of every selected segment. */
function movingPoints(): Map<number, Set<number>> {
  const { selectedPoints, selectedSegments } = editorStore.getState()
  const out = new Map<number, Set<number>>()
  const add = (subpath: number, index: number) => {
    const set = out.get(subpath) ?? new Set<number>()
    set.add(index)
    out.set(subpath, set)
  }
  for (const point of selectedPoints) {
    if (point.kind === 'anchor') add(point.subpath, point.index)
  }
  for (const segment of selectedSegments) {
    const sub = edit.subs[segment.subpath]
    if (!sub) continue
    add(segment.subpath, segment.index)
    // The far end wraps on a closed ring: its last segment ends at point 0.
    const next = segment.index + 1
    add(segment.subpath, next < sub.points.length ? next : sub.closed ? 0 : segment.index)
  }
  return out
}

function sameSegment(a: { subpath: number; index: number }, b: { subpath: number; index: number }): boolean {
  return a.subpath === b.subpath && a.index === b.index
}

function samePoint(a: PointHandleRef, b: PointHandleRef): boolean {
  return a.subpath === b.subpath && a.index === b.index && a.kind === b.kind
}

/**
 * Half the stroke's width, in local units.
 *
 * A click on a line has to count anywhere the line is VISIBLE, and what is
 * visible is the stroke — not the zero-width curve down its middle. Hit-testing
 * whole objects has always included this; the segment test did not, so between
 * the two radii lay a band where clicking a line opened its points and selected
 * nothing. On a thick stroke, or at a zoom that makes a thin one thick, that
 * band is most of the line: you click what you can see, the anchors appear, and
 * nothing moves.
 */
function strokeSlack(): number {
  const node = edit.nodeId ? getDoc().nodes[edit.nodeId] : undefined
  if (!node || !hasStyle(node)) return 0
  const { stroke } = node.style
  if (stroke.paint.type === 'none' || stroke.width <= 0) return 0
  return stroke.width / 2
}

export function pathEditPointerDown(
  e: CanvasPointerEvent,
  ctx: ToolContext,
  options: PathEditOptions = {},
): boolean {
  if (!edit.nodeId) return false
  const tolLocal = (GRAB_PX / ctx.viewport().zoom) * localScale()
  const local = toLocal(e.doc)
  const editor = editorStore.getState()

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

    if (e.shiftKey && grab.kind === 'anchor') {
      // Add or remove one point, and start nothing: a shift-click is about
      // building a selection, and dragging from it would move the object the
      // user is still choosing.
      const already = editor.selectedPoints.some((p) => samePoint(p, grab))
      setEditor({
        selectedPoints: already
          ? editor.selectedPoints.filter((p) => !samePoint(p, grab))
          : [...editor.selectedPoints, grab],
      })
      refreshOverlay()
      return true
    }

    // Pressing an already-selected point keeps the whole selection, so a
    // multiple selection can be picked up by any one of its members.
    const inSelection =
      grab.kind === 'anchor' && editor.selectedPoints.some((p) => samePoint(p, grab))
    if (!inSelection) {
      setEditor({ selectedPoints: [grab], selectedSegments: [] })
    }

    edit.dragging = grab
    edit.lastLocal = local
    beginLive()
    refreshOverlay()
    return true
  }

  // The stroke counts: see strokeSlack. Anchors do not get it, because an
  // anchor is a handle drawn at a fixed size on screen rather than something
  // the artwork draws.
  const near = closestSegment(edit.subs, local)
  if (near && near.distance <= tolLocal + strokeSlack()) {
    if (options.insertOnSegment) {
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
          setEditor({
            selectedPoints: [{ subpath: near.subpath, index: inserted, kind: 'anchor' }],
            selectedSegments: [],
          })
        }
      }
      return true
    }

    // Direct Selection: the segment itself is what was clicked, so select it
    // and let it be dragged. Both of its ends move, which is what moving a
    // line means.
    const segment = { subpath: near.subpath, index: near.index }
    const already = editor.selectedSegments.some((sg) => sameSegment(sg, segment))
    if (e.shiftKey) {
      setEditor({
        selectedSegments: already
          ? editor.selectedSegments.filter((sg) => !sameSegment(sg, segment))
          : [...editor.selectedSegments, segment],
      })
      refreshOverlay()
      return true
    }
    if (!already) setEditor({ selectedPoints: [], selectedSegments: [segment] })

    // Dragged by its first point, whose delta every moving point follows.
    edit.dragging = { subpath: segment.subpath, index: segment.index, kind: 'anchor' }
    edit.lastLocal = local
    beginLive()
    refreshOverlay()
    return true
  }

  // Empty space inside the shape: drop the point selection rather than keeping
  // a highlight the next drag would move.
  if (editor.selectedPoints.length || editor.selectedSegments.length) {
    setEditor({ selectedPoints: [], selectedSegments: [] })
    refreshOverlay()
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

  const dx = local.x - edit.lastLocal.x
  const dy = local.y - edit.lastLocal.y

  if (edit.dragging.kind === 'anchor') {
    // Everything selected moves by the same delta, so several points or
    // several edges keep their shape relative to one another. The dragged
    // point is included by construction: pressing it selected it.
    const moving = movingPoints()
    if (moving.size === 0) {
      movePoint(sub, edit.dragging.index, dx, dy)
    } else {
      for (const [subpath, indices] of moving) {
        const target = edit.subs[subpath]
        if (!target) continue
        for (const index of indices) movePoint(target, index, dx, dy)
      }
    }
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
  // One gesture, one undo step. The coalesce key exists so that the insert and
  // the drag that follows it in the SAME press merge; without this break the
  // next drag merges into them too, and three separate moves come back in one.
  breakHistoryCoalescing()
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
 * Double-click an anchor to convert it corner <-> smooth, in both directions.
 *
 * ONE gesture for the whole conversion. Straightening used to be a single
 * click, which made the pair asymmetric — and worse, it fired on the way out of
 * every press that happened to land on a rounded point and go nowhere, so
 * selecting a point to look at it flattened the curve through it.
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
  if (!sub?.points[grab.index]) return false
  togglePointType(sub, grab.index)
  edit.changed = true
  commitPath('Convert point')
  return true
}

/**
 * The open end under the pointer, if there is one.
 *
 * Only reports it — deciding what a press on an end MEANS belongs to the tool,
 * because with the pen it means two different things: a click carries on
 * drawing the path from there, a drag moves the point. Neither can be committed
 * on the way down, so the press arms and the release chooses.
 */
export function pathEditOpenEndAt(e: CanvasPointerEvent, ctx: ToolContext): PointHandleRef | null {
  if (!edit.nodeId) return null
  const tolLocal = (GRAB_PX / ctx.viewport().zoom) * localScale()
  const local = toLocal(e.doc)

  for (let si = 0; si < edit.subs.length; si++) {
    const sub = edit.subs[si]!
    if (sub.closed || sub.points.length < 2) continue
    const last = sub.points.length - 1
    for (const index of [last, 0]) {
      const p = sub.points[index]!
      if (Math.hypot(p.x - local.x, p.y - local.y) <= tolLocal) {
        return { subpath: si, index, kind: 'anchor' }
      }
    }
  }
  return null
}

/** The anchor or handle under the pointer, if a press there would grab one. */
export function pathEditGrabAt(e: CanvasPointerEvent, ctx: ToolContext): PointHandleRef | null {
  if (!edit.nodeId) return null
  const tolLocal = (GRAB_PX / ctx.viewport().zoom) * localScale()
  return findGrab(toLocal(e.doc), tolLocal)
}

/**
 * Where clicking the outline would drop an anchor, in DOCUMENT space.
 *
 * The pen inserts a point wherever the outline is clicked, and until this
 * existed the only way to find out where was to click and look. It is a preview
 * of one specific press, so it is suppressed wherever that press would do
 * something else: on an anchor or a handle, which get grabbed, and off the
 * outline entirely, which starts a new path.
 */
let insertPreview: Vec2 | null = null

export function getInsertPreview(): Vec2 | null {
  return insertPreview
}

export function clearInsertPreview(): void {
  if (!insertPreview) return
  insertPreview = null
  refreshOverlay()
}

export function updateInsertPreview(e: CanvasPointerEvent, ctx: ToolContext): void {
  if (!edit.nodeId || edit.dragging) return clearInsertPreview()
  const tolLocal = (GRAB_PX / ctx.viewport().zoom) * localScale()
  const local = toLocal(e.doc)
  if (findGrab(local, tolLocal)) return clearInsertPreview()

  const near = closestSegment(edit.subs, local)
  if (!near || near.distance > tolLocal + strokeSlack()) return clearInsertPreview()
  const sub = edit.subs[near.subpath]
  const at = sub ? segmentPoint(sub, near.index, near.t) : null
  if (!at) return clearInsertPreview()

  const world = applyToPoint(edit.world, at)
  // Repainting only on a real move: the pointer produces a move event per
  // sample and the overlay tick drives a React render.
  if (insertPreview && Math.abs(insertPreview.x - world.x) < 1e-6 && Math.abs(insertPreview.y - world.y) < 1e-6) {
    return
  }
  insertPreview = world
  refreshOverlay()
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
