/**
 * Dragging a guide out of an artboard's edge, and moving one already there.
 *
 * Adobe: "hover the pointer over the left border of the artboard until the icon
 * appears. Click and hold the icon and then drag it to the desired position."
 *
 * Like the artboard-label drag, this owns the pointer from pointerdown to
 * release and never reaches the tool pipeline — so pulling out a guide works
 * whichever instrument happens to be selected, and no tool needs a branch for
 * it. Guides are chrome; routing them through the tools would mean teaching
 * every tool about them.
 *
 * The modifiers are Adobe's: hold the primary modifier to suspend snapping,
 * hold Shift to move in increments of 10.
 */

import { addGuide, moveGuide, removeGuide } from '../history/Commands'
import { snapValue } from '../geometry/Snapping'
import { screenToDoc } from '../canvas/Viewport'
import { geometryBounds, createMatrixCache, worldMatrix } from '../document/SceneGraph'
import { invert, applyToPoint, type Vec2 } from '../geometry/Matrix'
import { getDoc } from '../state/DocumentStore'
import { editorStore, refreshOverlay } from '../state/EditorStore'
import type { DesignDocument, NodeId } from '../document/types'

/** Screen pixels, matching the object-snapping threshold used everywhere else. */
const SNAP_THRESHOLD_PX = 6

/** Adobe: "To position the guide in increments of 10 px on the canvas, press Shift." */
const SHIFT_STEP = 10

interface GuideDragSession {
  artboardId: NodeId
  axis: 'x' | 'y'
  /** Null until the guide exists — a press that never moves creates nothing. */
  guideId: string | null
  /** Set when moving an existing guide, so Escape can put it back. */
  origin: number | null
  pointerId: number
  element: Element
  container: Element
  /** Snap targets in the artboard's LOCAL space, on this axis. */
  targets: number[]
  extent: number
  moved: boolean
  /**
   * Where the guide is RIGHT NOW, held here rather than written to the
   * document each frame.
   *
   * A store write runs every subscribed component's selector — the inspector
   * and the whole layer tree re-render, the document goes dirty, autosave
   * wakes up — which is the cost the LiveTransform channel exists to avoid for
   * node drags. A guide is one small thing, but it is the same cost, and
   * deferring also makes creating a guide a single undo entry instead of an
   * "Add" followed by a run of moves.
   */
  livePosition: number | null
}

let session: GuideDragSession | null = null

export function isGuideDragging(): boolean {
  return session !== null
}

/**
 * The guide being dragged and where it currently is.
 *
 * The overlay draws from this instead of from the document while a gesture is
 * running — including a guide that does not exist yet, which is what a pull out
 * of the edge strip looks like until it is released.
 */
export function liveGuide(): {
  artboardId: NodeId
  axis: 'x' | 'y'
  guideId: string | null
  position: number
} | null {
  if (!session || session.livePosition === null) return null
  return {
    artboardId: session.artboardId,
    axis: session.axis,
    guideId: session.guideId,
    position: session.livePosition,
  }
}

/**
 * @param guideId null to pull a NEW guide out of the artboard's edge.
 * @param element the strip or guide line; it captures the pointer.
 * @param container the canvas box client coordinates are measured against.
 */
export function beginGuideDrag(
  artboardId: NodeId,
  axis: 'x' | 'y',
  guideId: string | null,
  native: PointerEvent,
  element: Element,
  container: Element,
): void {
  if (session || native.button !== 0) return
  const doc = getDoc()
  const board = doc.nodes[artboardId]
  if (!board || board.type !== 'artboard') return
  // Adobe's Lock All Guides: still drawn, not draggable. A new guide cannot be
  // pulled onto a locked artboard either.
  if (board.guidesLocked) return

  const existing = guideId ? board.guides?.find((g) => g.id === guideId) : undefined
  session = {
    artboardId,
    axis,
    guideId,
    origin: existing ? existing.position : null,
    pointerId: native.pointerId,
    element,
    container,
    targets: snapTargets(doc, artboardId, axis, guideId),
    extent: axis === 'x' ? board.transform.width : board.transform.height,
    moved: false,
    livePosition: null,
  }

  try {
    element.setPointerCapture(native.pointerId)
  } catch {
    // Capture is a nicety; the window listeners below do the real work.
  }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerCancel)
  window.addEventListener('keydown', onKeyDown, true)
}

/**
 * Everything a guide may land on, in artboard-local units.
 *
 * Adobe: "Guides snap to selected objects or top-level objects drawn on the
 * canvas", and the artboard's own halves — the docs call out snapping "to the
 * horizontal and vertical centers".
 */
function snapTargets(
  doc: DesignDocument,
  artboardId: NodeId,
  axis: 'x' | 'y',
  skipGuideId: string | null,
): number[] {
  const board = doc.nodes[artboardId]
  if (!board || board.type !== 'artboard') return []
  const size = axis === 'x' ? board.transform.width : board.transform.height
  const out = [0, size / 2, size]

  const cache = createMatrixCache()
  const toLocal = invert(worldMatrix(doc, artboardId))
  for (const childId of board.children) {
    const child = doc.nodes[childId]
    if (!child || !child.visible) continue
    const b = geometryBounds(doc, childId, cache)
    const lo = applyToPoint(toLocal, { x: b.x, y: b.y })
    const hi = applyToPoint(toLocal, { x: b.x + b.width, y: b.y + b.height })
    const a = axis === 'x' ? lo.x : lo.y
    const z = axis === 'x' ? hi.x : hi.y
    out.push(a, (a + z) / 2, z)
  }

  // The other guides on this artboard, minus the one being moved.
  for (const g of board.guides ?? []) {
    if (g.axis !== axis || g.id === skipGuideId) continue
    out.push(g.position)
  }
  return out
}

/** Pointer position in the dragged artboard's local space. */
function toLocalPosition(s: GuideDragSession, clientX: number, clientY: number): number {
  const rect = s.container.getBoundingClientRect()
  const viewport = editorStore.getState().viewport
  const world = screenToDoc(viewport, { x: clientX - rect.left, y: clientY - rect.top })
  const doc = getDoc()
  const local: Vec2 = applyToPoint(invert(worldMatrix(doc, s.artboardId)), world)
  return s.axis === 'x' ? local.x : local.y
}

function onPointerMove(e: PointerEvent): void {
  const s = session
  if (!s || e.pointerId !== s.pointerId) return
  // Self-healing, as the other self-driven gestures do: a pointerup lost to a
  // window switch would otherwise leave the guide following a released cursor.
  if (e.buttons === 0) {
    end(true)
    return
  }

  const viewport = editorStore.getState().viewport
  let position = toLocalPosition(s, e.clientX, e.clientY)

  if (e.shiftKey) {
    position = Math.round(position / SHIFT_STEP) * SHIFT_STEP
  } else if (!(e.metaKey || e.ctrlKey)) {
    // Adobe: "To disable the snapping behavior, press Cmd (macOS) or Ctrl."
    position = snapValue(position, s.targets, SNAP_THRESHOLD_PX / (viewport.zoom || 1))
  }
  position = Math.round(position * 100) / 100

  s.livePosition = position
  s.moved = true
  // The only per-frame cost: a counter bump the overlay listens to. Nothing is
  // written to the document until the pointer comes up.
  refreshOverlay()
}

function onPointerUp(e: PointerEvent): void {
  if (!session || e.pointerId !== session.pointerId) return
  const s = session
  // Dragged clear of the artboard: the universal "let go to remove" gesture,
  // and Adobe's own way of removing one.
  end(true, s.moved && isOutside(s))
}

function isOutside(s: GuideDragSession): boolean {
  const position = s.livePosition
  return position === null || position < 0 || position > s.extent
}

function onPointerCancel(e: PointerEvent): void {
  if (!session || e.pointerId !== session.pointerId) return
  end(false)
}

function onKeyDown(e: KeyboardEvent): void {
  if (!session || e.key !== 'Escape') return
  e.preventDefault()
  e.stopPropagation()
  end(false)
}

/** Ends the gesture, putting the guide back if it was abandoned. */
export function cancelGuideDrag(): void {
  if (session) end(false)
}

function end(commit: boolean, remove = false): void {
  const s = session
  if (!s) return
  session = null

  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerCancel)
  window.removeEventListener('keydown', onKeyDown, true)
  try {
    s.element.releasePointerCapture(s.pointerId)
  } catch {
    // Already released, or never captured.
  }

  // One transaction for the whole gesture, or none at all.
  if (commit && s.moved && s.livePosition !== null) {
    if (remove) {
      // A guide pulled out and dropped outside was never committed, so there is
      // nothing to remove; an existing one dragged clear is deleted.
      if (s.guideId) removeGuide(s.artboardId, s.guideId)
    } else if (s.guideId) {
      moveGuide(s.artboardId, s.guideId, s.livePosition)
    } else {
      addGuide(s.artboardId, s.axis, s.livePosition)
    }
  }
  refreshOverlay()
}
