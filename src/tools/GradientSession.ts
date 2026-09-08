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
 * Dragging the on-canvas gradient editor.
 *
 * Adobe lists this widget as a component of the gradient colour picker: a
 * segment with draggable endpoints for a linear gradient, a centre and a radius
 * handle for a radial one, and a centre and an angle handle for an angular one.
 * Stops ride the same widget and can be dragged along it.
 *
 * UNLIKE RadiusSession and StarRatioSession, this streams through setFill /
 * setStroke with a coalesce key rather than through LiveTransform, and that is
 * deliberate:
 *
 *  - An angular gradient's live geometry is a whole <pattern> subtree of wedges.
 *    A LiveTransform override is `Record<string, string>` applied with
 *    setAttribute, so it cannot express that at all — and one mechanism has to
 *    serve all three gradient types.
 *  - It is already how every other paint edit behaves: the picker's own stop
 *    drag and each X1/Y1/R field stream through setFill with a coalesce key, so
 *    the whole gesture still collapses into one undo entry.
 *  - It keeps the picker's numeric fields, the ramp preview and the canvas in
 *    step for free, which a DOM-only override could not.
 *
 * The no-store-writes rule exists for the O(document) move/resize path. This is
 * one node's paint during a short, deliberate gesture.
 */

import { applyToPoint, invert, type Mat2D, type Vec2 } from '../geometry/Matrix'
import { meanScale } from '../geometry/Matrix'
import { isEffectivelyLocked, worldMatrix } from '../document/SceneGraph'
import { setFill, setStroke } from '../history/Commands'
import { sampleGradientAt } from '../canvas/paint'
import { createStop } from '../document/NodeFactory'
import { breakHistoryCoalescing } from '../state/DocumentStore'
import { editorStore } from '../state/EditorStore'
import { snapAngle } from './snapHelpers'
import type {
  DesignDocument,
  GradientPaint,
  GradientStop,
  NodeId,
  Paint,
} from '../document/types'

/** Which part of the widget is being dragged. */
export type GradientHandle = 'start' | 'end' | 'segment' | 'center' | 'radius' | 'angle' | 'stop'

export type PaintTarget = 'fill' | 'stroke'

interface GradientState {
  id: NodeId
  target: PaintTarget
  handle: GradientHandle
  /** Which stop, when `handle` is 'stop'. */
  stopId: string | null
  world: Mat2D
  width: number
  height: number
  start: GradientPaint
  /** Pointer position in UNIT space when the drag began, for delta dragging. */
  grabUnit: Vec2
  /** Screen pixels per unit, so "dragged away" is a constant distance on screen. */
  pxPerUnit: number
  /** True once a stop drag has pulled far enough off the axis to drop it. */
  dropping: boolean
  changed: boolean
}

let session: GradientState | null = null

/** Movement below this (in unit space) is a click, not a drag. */
const DRAG_THRESHOLD = 0.002

/**
 * Pending write, flushed once per frame.
 *
 * Pointermove fires well above 60Hz on a high-rate mouse, and HistoryManager
 * appends every write's patches to the coalescing entry — so an unthrottled
 * two-second drag piles thousands of patches into one undo step. One write per
 * animation frame is all the screen can show anyway.
 */
let pendingPaint: GradientPaint | null = null
let rafHandle = 0

function scheduleWrite(s: GradientState, paint: GradientPaint): void {
  pendingPaint = paint
  if (rafHandle) return
  rafHandle = requestAnimationFrame(() => {
    rafHandle = 0
    const next = pendingPaint
    pendingPaint = null
    if (next) write(s, next, false)
  })
}

function flushPending(): void {
  if (rafHandle) {
    cancelAnimationFrame(rafHandle)
    rafHandle = 0
  }
  pendingPaint = null
}

export function isGradientDragging(): boolean {
  return session !== null
}

// ---------------------------------------------------------------------------
// Unit space <-> local space
// ---------------------------------------------------------------------------

/**
 * Gradient coordinates are objectBoundingBox units, so the unit square is
 * scaled by the node's box. Every handle position and every drag has to cross
 * that scale, or the widget drifts off what is actually painted on any node
 * that is not square.
 */
export function unitToLocal(u: Vec2, width: number, height: number): Vec2 {
  return { x: u.x * width, y: u.y * height }
}

export function localToUnit(p: Vec2, width: number, height: number): Vec2 {
  return { x: width > 0 ? p.x / width : 0, y: height > 0 ? p.y / height : 0 }
}

/** The paint currently on a node's fill or stroke. */
export function paintOf(doc: DesignDocument, id: NodeId, target: PaintTarget): Paint | null {
  const node = doc.nodes[id]
  if (!node || !('style' in node)) return null
  return target === 'stroke' ? node.style.stroke.paint : node.style.fill
}

// ---------------------------------------------------------------------------
// Gesture
// ---------------------------------------------------------------------------

export function beginGradientDrag(
  doc: DesignDocument,
  id: NodeId,
  target: PaintTarget,
  handle: GradientHandle,
  stopId: string | null,
  startDoc: Vec2,
): boolean {
  const node = doc.nodes[id]
  if (!node) return false
  // Honours a locked ANCESTOR, matching every other edit path.
  if (isEffectivelyLocked(doc, id)) return false

  const paint = paintOf(doc, id, target)
  if (!paint || (paint.type !== 'linear' && paint.type !== 'radial' && paint.type !== 'angular')) {
    return false
  }

  const world = worldMatrix(doc, id)
  const { width, height } = node.transform
  const local = applyToPoint(invert(world), startDoc)

  session = {
    id,
    target,
    handle,
    stopId,
    world,
    width,
    height,
    start: paint,
    grabUnit: localToUnit(local, width, height),
    pxPerUnit:
      meanScale(world) * editorStore.getState().viewport.zoom * ((width + height) / 2),
    dropping: false,
    changed: false,
  }
  editorStore.setState({ isDragging: true })
  return true
}

/** @returns the paint as it now stands, so a caller can drive a readout. */
export function updateGradientDrag(currentDoc: Vec2, shiftKey = false): GradientPaint | null {
  if (!session) return null
  const s = session

  const local = applyToPoint(invert(s.world), currentDoc)
  const at = localToUnit(local, s.width, s.height)
  const dx = at.x - s.grabUnit.x
  const dy = at.y - s.grabUnit.y

  if (!s.changed && Math.hypot(dx, dy) < DRAG_THRESHOLD) return s.start
  s.changed = true

  const next = applyHandle(s, at, dx, dy, shiftKey)
  scheduleWrite(s, next)
  return next
}

/** @returns the handle that was dragged, or null when nothing moved. */
export function commitGradientDrag(): GradientHandle | null {
  if (!session) return null
  const s = session
  session = null

  // Flush whatever the last frame owed, THEN close the coalescing run.
  const last = pendingPaint
  flushPending()
  if (last) write(s, last, false)

  editorStore.setState({ isDragging: false })
  if (!s.changed) return null

  // NOT a final keyless write: re-writing the identical paint still emits a
  // replace patch, which would cost the user a second Cmd+Z for one drag.
  // Breaking the run is what makes the gesture exactly one undo entry, and it
  // also stops the next gesture merging into this one.
  breakHistoryCoalescing()
  return s.handle
}

export function cancelGradientDrag(): void {
  if (!session) return
  const s = session
  session = null
  flushPending()
  editorStore.setState({ isDragging: false })
  // Restore under the SAME key so it merges into the run rather than becoming a
  // third entry, then close the run.
  if (s.changed) {
    write(s, s.start, false)
    breakHistoryCoalescing()
  }
}

function write(s: GradientState, paint: GradientPaint, committing: boolean): void {
  const key = committing ? undefined : `paint:${s.target}`
  if (s.target === 'fill') setFill(paint, key)
  else setStroke({ paint }, key)
}

// ---------------------------------------------------------------------------
// What each handle does
// ---------------------------------------------------------------------------

function applyHandle(
  s: GradientState,
  at: Vec2,
  dx: number,
  dy: number,
  shiftKey: boolean,
): GradientPaint {
  const p = s.start

  if (s.handle === 'stop') {
    // Adobe: a stop is deleted "by dragging it away from the gradient editor".
    // Off the axis by enough, and it goes — but it comes back if the pointer
    // returns, so an overshoot mid-drag is recoverable.
    const away = Math.abs(perpendicular(p, at)) * s.pxPerUnit
    s.dropping = away > DRAG_AWAY_PX && p.stops.length > 2
    if (s.dropping) {
      return { ...p, stops: p.stops.filter((stop) => stop.id !== s.stopId) } as GradientPaint
    }
    return { ...p, stops: moveStop(p, s, at) } as GradientPaint
  }

  if (p.type === 'linear') {
    switch (s.handle) {
      case 'start': {
        const to = shiftKey ? snapAngle({ x: p.x2, y: p.y2 }, at, 45) : at
        return { ...p, x1: to.x, y1: to.y }
      }
      case 'end': {
        const to = shiftKey ? snapAngle({ x: p.x1, y: p.y1 }, at, 45) : at
        return { ...p, x2: to.x, y2: to.y }
      }
      default:
        // Dragging the segment itself moves the whole gradient.
        return { ...p, x1: p.x1 + dx, y1: p.y1 + dy, x2: p.x2 + dx, y2: p.y2 + dy }
    }
  }

  if (p.type === 'radial') {
    if (s.handle === 'radius') {
      // Applied as a DELTA from where the handle was grabbed, so picking it up
      // a few pixels off centre does not snap the radius on the first frame —
      // the same reason RadiusSession carries a grab offset.
      const now = Math.hypot(at.x - p.cx, at.y - p.cy)
      const then = Math.hypot(s.grabUnit.x - p.cx, s.grabUnit.y - p.cy)
      return { ...p, r: Math.max(0.01, p.r + (now - then)) }
    }
    return { ...p, cx: p.cx + dx, cy: p.cy + dy }
  }

  // angular
  if (s.handle === 'angle') {
    const now = (Math.atan2(at.y - p.cy, at.x - p.cx) * 180) / Math.PI
    const then = (Math.atan2(s.grabUnit.y - p.cy, s.grabUnit.x - p.cx) * 180) / Math.PI
    const next = p.rotation + (now - then)
    return { ...p, rotation: shiftKey ? Math.round(next / 15) * 15 : Math.round(next) }
  }
  return { ...p, cx: p.cx + dx, cy: p.cy + dy }
}

/** How far a pointer is off the gradient's axis, in unit space. */
function perpendicular(paint: GradientPaint, at: Vec2): number {
  if (paint.type === 'linear') {
    const ax = paint.x2 - paint.x1
    const ay = paint.y2 - paint.y1
    const len = Math.hypot(ax, ay)
    if (len <= 0) return 0
    return ((at.x - paint.x1) * ay - (at.y - paint.y1) * ax) / len
  }
  // Radial and angular measure off their own ring rather than off a line.
  const ring = paint.type === 'radial' ? paint.r : ANGULAR_RING
  return Math.hypot(at.x - paint.cx, at.y - paint.cy) - ring
}

/** How far off the axis a stop must be dragged to be dropped, in screen pixels. */
const DRAG_AWAY_PX = 26

/** Project the pointer onto the gradient's axis to get a stop's new offset. */
function moveStop(p: GradientPaint, s: GradientState, at: Vec2): GradientStop[] {
  const t = offsetAlongAxis(p, at)
  return p.stops.map((stop) => (stop.id === s.stopId ? { ...stop, offset: t } : stop))
}

/**
 * Where a unit-space point falls along the gradient's own axis, 0..1.
 *
 * Linear projects onto the segment; radial and angular measure outward from the
 * centre, which is the axis their stops actually run along.
 */
export function offsetAlongAxis(paint: GradientPaint, at: Vec2): number {
  if (paint.type === 'linear') {
    const ax = paint.x2 - paint.x1
    const ay = paint.y2 - paint.y1
    const len2 = ax * ax + ay * ay
    if (len2 <= 0) return 0
    return clamp01(((at.x - paint.x1) * ax + (at.y - paint.y1) * ay) / len2)
  }
  if (paint.type === 'angular') {
    // An angular gradient's stops run AROUND the sweep, not outward from the
    // centre — measuring a radius here put every stop at the wrong place.
    const deg = (Math.atan2(at.y - paint.cy, at.x - paint.cx) * 180) / Math.PI
    return (((deg - paint.rotation) / 360) % 1 + 1) % 1
  }
  if (paint.r <= 0) return 0
  return clamp01(Math.hypot(at.x - paint.cx, at.y - paint.cy) / paint.r)
}

/** Where a stop sits on the widget, in unit space. */
export function stopPointOnAxis(paint: GradientPaint, t: number): Vec2 {
  if (paint.type === 'linear') {
    return {
      x: paint.x1 + (paint.x2 - paint.x1) * t,
      y: paint.y1 + (paint.y2 - paint.y1) * t,
    }
  }
  if (paint.type === 'angular') {
    // On the ring, at the angle the stop actually paints.
    const rad = ((paint.rotation + t * 360) * Math.PI) / 180
    return { x: paint.cx + Math.cos(rad) * ANGULAR_RING, y: paint.cy + Math.sin(rad) * ANGULAR_RING }
  }
  return { x: paint.cx + paint.r * t, y: paint.cy }
}

/** Radius of the angular widget's ring, in unit space. */
export const ANGULAR_RING = 0.42

/** Add a stop where the widget was clicked, sampling the ramp there. */
export function addStopAt(
  doc: DesignDocument,
  id: NodeId,
  target: PaintTarget,
  atDoc: Vec2,
): string | null {
  const node = doc.nodes[id]
  const paint = paintOf(doc, id, target)
  if (!node || !paint) return null
  if (paint.type !== 'linear' && paint.type !== 'radial' && paint.type !== 'angular') return null

  const world = worldMatrix(doc, id)
  const local = applyToPoint(invert(world), atDoc)
  const at = localToUnit(local, node.transform.width, node.transform.height)
  const offset = offsetAlongAxis(paint, at)

  const stop = createStop(offset, sampleGradientAt(paint.stops, offset))
  const next: GradientPaint = { ...paint, stops: [...paint.stops, stop] }
  if (target === 'fill') setFill(next)
  else setStroke({ paint: next })
  return stop.id
}

/** Remove a stop, keeping the two-stop floor a gradient needs. */
export function removeStop(
  doc: DesignDocument,
  id: NodeId,
  target: PaintTarget,
  stopId: string,
): boolean {
  const paint = paintOf(doc, id, target)
  if (!paint) return false
  if (paint.type !== 'linear' && paint.type !== 'radial' && paint.type !== 'angular') return false
  if (paint.stops.length <= 2) return false

  const next: GradientPaint = { ...paint, stops: paint.stops.filter((s) => s.id !== stopId) }
  if (target === 'fill') setFill(next)
  else setStroke({ paint: next })
  return true
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t
}

/**
 * The next stop in offset order, for Tab cycling on the canvas widget.
 * Shift walks backwards. Returns null when there is nothing to cycle.
 */
export function nextGradientStop(
  doc: DesignDocument,
  id: NodeId,
  target: PaintTarget,
  current: string | null,
  backwards = false,
): string | null {
  const paint = paintOf(doc, id, target)
  if (!paint) return null
  if (paint.type !== 'linear' && paint.type !== 'radial' && paint.type !== 'angular') return null
  const ordered = [...paint.stops].sort((a, b) => a.offset - b.offset)
  if (ordered.length === 0) return null
  const at = ordered.findIndex((s) => s.id === current)
  const step = backwards ? -1 : 1
  const next = at < 0 ? 0 : (at + step + ordered.length) % ordered.length
  return ordered[next]!.id
}

/** Move a stop along the ramp by a fraction, for arrow-key nudging. */
export function nudgeGradientStop(
  doc: DesignDocument,
  id: NodeId,
  target: PaintTarget,
  stopId: string,
  delta: number,
): boolean {
  const paint = paintOf(doc, id, target)
  if (!paint) return false
  if (paint.type !== 'linear' && paint.type !== 'radial' && paint.type !== 'angular') return false
  const stop = paint.stops.find((s) => s.id === stopId)
  if (!stop) return false

  const next: GradientPaint = {
    ...paint,
    stops: paint.stops.map((s) =>
      s.id === stopId ? { ...s, offset: clamp01(s.offset + delta) } : s,
    ),
  }
  // Coalesced, so holding an arrow key is one undo entry rather than dozens.
  if (target === 'fill') setFill(next, 'gradient-nudge')
  else setStroke({ paint: next }, 'gradient-nudge')
  return true
}

/** The stop at one end of the ramp, for selecting what an end handle covers. */
export function endStop(
  doc: DesignDocument,
  id: NodeId,
  target: PaintTarget,
  which: 'first' | 'last',
): string | null {
  const paint = paintOf(doc, id, target)
  if (!paint) return null
  if (paint.type !== 'linear' && paint.type !== 'radial' && paint.type !== 'angular') return null
  const ordered = [...paint.stops].sort((a, b) => a.offset - b.offset)
  const stop = which === 'first' ? ordered[0] : ordered[ordered.length - 1]
  return stop?.id ?? null
}
