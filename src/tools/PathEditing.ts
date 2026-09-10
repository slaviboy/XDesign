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
import { convertNodeToPath, resizeBoxInPlace } from '../document/DocumentModel'
import { liveTransform } from '../canvas/LiveTransform'
import { geomKey } from '../canvas/liveKeys'
import { breakHistoryCoalescing, transaction, getDoc } from '../state/DocumentStore'
import { buildAnchorSnapContext, snapPoint, type SnapContext } from './snapHelpers'
import { hasStyle } from '../document/types'
import { editorStore, refreshOverlay, setEditor } from '../state/EditorStore'
import type { PointRef, SnapGuide } from '../state/EditorStore'
import type { Bounds } from '../geometry/Bounds'
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
  /** Anchors the dragged point can line up with; built once per gesture. */
  snap: SnapContext | null
  /**
   * Where the dragged anchor and the pointer were when the drag began.
   *
   * Snapping has to be judged against where the pointer ACTUALLY is, not
   * against where the last frame left the point. Accumulating deltas from a
   * snapped position makes the snap sticky: each frame's delta is small, the
   * point lands back inside the snap radius, and it is pulled to the same guide
   * again — so the anchor never escapes the first thing it touches.
   */
  dragOrigin: Vec2 | null
  dragStart: Vec2 | null
}

const edit: EditState = {
  nodeId: null,
  subs: [],
  world: [1, 0, 0, 1, 0, 0],
  dragging: null,
  lastLocal: null,
  changed: false,
  live: false,
  snap: null,
  dragOrigin: null,
  dragStart: null,
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

/** Document units an arrow key moves a selected point; Shift takes the larger. */
const NUDGE_SMALL = 1
const NUDGE_LARGE = 10

/**
 * Collect what a dragged anchor may line up with.
 *
 * The edited node is skipped by the world collector and re-added here WITHOUT
 * the points that are about to move: a moving anchor whose own old position is
 * a candidate snaps straight back to where it started and refuses to leave.
 */
function buildEditSnap(ctx: ToolContext): void {
  const editor = editorStore.getState()
  const enabled = editor.snapEnabled
  const context = buildAnchorSnapContext(
    getDoc(),
    ctx.viewport(),
    editor.canvasSize,
    enabled,
    edit.nodeId ?? undefined,
  )
  if (enabled) {
    const moving = movingPoints()
    edit.subs.forEach((sub, si) => {
      const skip = moving.get(si)
      sub.points.forEach((p, i) => {
        if (skip?.has(i)) return
        const w = applyToPoint(edit.world, { x: p.x, y: p.y })
        context.candidates.push({ axis: 'x', position: w.x, kind: 'edge', from: w.y, to: w.y })
        context.candidates.push({ axis: 'y', position: w.y, kind: 'edge', from: w.x, to: w.x })
      })
    })
  }
  edit.snap = context
}

/** Publish the guide lines, skipping the write when nothing would change. */
function showSnapGuides(lines: SnapGuide[]): void {
  const current = editorStore.getState().snapGuides
  if (current.length === 0 && lines.length === 0) return
  setEditor({ snapGuides: lines })
}

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
  // Below the guard, deliberately. The Canvas calls this on every editor-store
  // change with no node being edited, so clearing above it would wipe the pen's
  // snap guides the instant it published them.
  if (!edit.nodeId) return
  edit.snap = null
  showSnapGuides([])
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
    if (grab.kind === 'anchor') {
      const p = edit.subs[grab.subpath]?.points[grab.index]
      edit.dragOrigin = p ? { x: p.x, y: p.y } : null
      edit.dragStart = local
      buildEditSnap(ctx)
    }
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
          edit.dragOrigin = null
          edit.dragStart = null
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
    {
      const p = edit.subs[segment.subpath]?.points[segment.index]
      edit.dragOrigin = p ? { x: p.x, y: p.y } : null
      edit.dragStart = local
    }
    buildEditSnap(ctx)
    beginLive()
    refreshOverlay()
    return true
  }

  // Empty space inside the shape: drop the point selection rather than keeping
  // a highlight the next drag would move. Shift is exempt — it means "add to
  // what I have", and a Shift-marquee that began by clearing the selection it
  // was about to extend would have nothing to extend.
  if (!e.shiftKey && (editor.selectedPoints.length || editor.selectedSegments.length)) {
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

  let dx = local.x - edit.lastLocal.x
  let dy = local.y - edit.lastLocal.y

  if (edit.dragging.kind === 'anchor') {
    // Adobe: "While placing a new anchor point or dragging an existing anchor
    // point, snap lines appear when an anchor is vertically or horizontally
    // near another anchor point. Hold down the Cmd/Ctrl key to disable anchor
    // point snapping." Snapping is decided in WORLD space and brought back
    // through the node's matrix, so it stays true on a rotated or scaled node.
    const dragged = sub.points[edit.dragging.index]
    if (dragged && edit.snap && edit.dragOrigin && edit.dragStart && !e.primaryModifier) {
      // Measured from where the drag STARTED, so a snap that catches early does
      // not hold the anchor for the rest of the gesture.
      const raw = {
        x: edit.dragOrigin.x + (local.x - edit.dragStart.x),
        y: edit.dragOrigin.y + (local.y - edit.dragStart.y),
      }
      const world = applyToPoint(edit.world, raw)
      const snap = snapPoint(world, edit.snap)
      const target =
        snap.dx !== 0 || snap.dy !== 0
          ? applyToPoint(invert(edit.world), { x: world.x + snap.dx, y: world.y + snap.dy })
          : raw
      dx = target.x - dragged.x
      dy = target.y - dragged.y
      showSnapGuides(snap.lines)
    } else {
      showSnapGuides([])
    }

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
    // Alt breaks the joint so the two handles move independently. Without it
    // the far one swings round to stay opposite but keeps its own length: it
    // was set deliberately at some point, and dragging this one is not a
    // request to resize it.
    moveHandle(sub, edit.dragging.index, edit.dragging.kind, local, e.altKey ? 'none' : 'keep')
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
  edit.snap = null
  edit.dragOrigin = null
  edit.dragStart = null
  showSnapGuides([])
  // One gesture, one undo step. The coalesce key exists so that the insert and
  // the drag that follows it in the SAME press merge; without this break the
  // next drag merges into them too, and three separate moves come back in one.
  breakHistoryCoalescing()
  // Released after the commit: end() drops the override without restoring, and
  // by now React has the same geometry from the document, so nothing flashes.
  endLive(true)
  return true
}

const NUDGE_KEYS: Record<string, Vec2> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
}

export function pathEditKeyDown(e: KeyboardEvent): boolean {
  if (!edit.nodeId) return false

  // Adobe: "Nudge the selected anchor points using your keyboard." Taken before
  // the global handler sees it, which would otherwise move the whole object —
  // the points are what is selected, so the points are what should move.
  const step = NUDGE_KEYS[e.key]
  if (step) {
    const moving = movingPoints()
    if (moving.size === 0) return false
    // Document units into the node's own, so a nudge is the same distance on
    // screen however the node is scaled.
    const scale = localScale()
    const size = (e.shiftKey ? NUDGE_LARGE : NUDGE_SMALL) * scale
    for (const [subpath, indices] of moving) {
      const target = edit.subs[subpath]
      if (!target) continue
      for (const index of indices) movePoint(target, index, step.x * size, step.y * size)
    }
    edit.changed = true
    commitPath('Nudge point')
    return true
  }

  if (e.key === 'Escape') {
    setEditor({ nodeEditingId: null, selectedPoints: [], selectedSegments: [] })
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
      setEditor({ selectedPoints: [], selectedSegments: [] })
    }
    return true
  }
  return false
}

/**
 * Select every anchor inside a rubber band.
 *
 * Adobe: "To select multiple anchor points, hold Shift and select the anchor
 * points, or marquee select the anchor points." Enclose-versus-touch is
 * deliberately not consulted the way it is for objects: a point has no area,
 * so the two modes cannot tell it apart.
 *
 * @param additive keep what was already selected, as Shift does elsewhere.
 */
export function pathEditSelectInBox(box: Bounds, additive: boolean): void {
  if (!edit.nodeId) return
  const toLocalBox = invert(edit.world)
  const corners = [
    applyToPoint(toLocalBox, { x: box.x, y: box.y }),
    applyToPoint(toLocalBox, { x: box.x + box.width, y: box.y }),
    applyToPoint(toLocalBox, { x: box.x, y: box.y + box.height }),
    applyToPoint(toLocalBox, { x: box.x + box.width, y: box.y + box.height }),
  ]
  // The box is axis-aligned in DOCUMENT space; under a rotated node its local
  // image is not, so the local test uses the bounding box of the four mapped
  // corners rather than pretending the rectangle survived the transform.
  const xs = corners.map((p) => p.x)
  const ys = corners.map((p) => p.y)
  const left = Math.min(...xs)
  const right = Math.max(...xs)
  const top = Math.min(...ys)
  const bottom = Math.max(...ys)

  const found: PointRef[] = []
  edit.subs.forEach((sub, si) => {
    sub.points.forEach((p, i) => {
      if (p.x >= left && p.x <= right && p.y >= top && p.y <= bottom) {
        found.push({ subpath: si, index: i, kind: 'anchor' })
      }
    })
  })

  const merged = additive ? [...editorStore.getState().selectedPoints] : []
  for (const ref of found) {
    if (!merged.some((p) => samePoint(p, ref))) merged.push(ref)
  }
  // A fresh marquee replaces the segment selection too; an additive one leaves
  // it alone, because Shift is asking to ADD rather than to start again.
  setEditor(additive ? { selectedPoints: merged } : { selectedPoints: merged, selectedSegments: [] })
  refreshOverlay()
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
    if (sub.points.length < 2) continue
    // A ring has no ends, but "extending a closed path reopens the path", and
    // the point it reopens at is the one the pen is over — its start.
    const last = sub.closed ? 0 : sub.points.length - 1
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
 * the selection frame and the inspector's W/H keep matching what is drawn — and
 * the position with them, so that the matrix does not change. The box's middle
 * is what the node turns about; refitting it without that moved a rotated path
 * as a whole the moment an edit was saved, every point and not just the one
 * that was dragged. It also keeps `edit.world` true across the commit, which a
 * press that inserts a point and then drags it relies on.
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
      node.transform = resizeBoxInPlace(
        node.transform,
        Math.max(0.5, b.width || node.transform.width),
        Math.max(0.5, b.height || node.transform.height),
      )
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
