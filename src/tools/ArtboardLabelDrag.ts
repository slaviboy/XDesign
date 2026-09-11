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
 * Dragging an artboard by its name label.
 *
 * The label is chrome, not artwork: it is drawn in the screen-space overlay and
 * sits outside the artboard it names. XD moves the artboard when you drag that
 * name whatever tool is selected, and so does this — which is why the gesture
 * runs itself rather than going through the tool pipeline. It takes the pointer
 * at the label's pointerdown and holds it to release, so no tool ever sees the
 * press and none of them need a branch for it.
 *
 * The transform work is DragSession's, unchanged: one snapshot on press, DOM
 * writes through LiveTransform while moving, one undo entry on release.
 */

import { beginDrag, cancelDrag, commitDrag, getDragFrame, updateDrag } from './DragSession'
import { buildSnapContext, resolveSnap, type SnapContext } from './snapHelpers'
import { screenToDoc } from '../canvas/Viewport'
import { getDoc } from '../state/DocumentStore'
import { addToSelection, editorStore, removeFromSelection, setSelection } from '../state/EditorStore'
import { isEffectivelyLocked } from '../document/SceneGraph'
import { translateBounds, type Bounds } from '../geometry/Bounds'
import type { Mat2D, Vec2 } from '../geometry/Matrix'
import type { NodeId } from '../document/types'

/** The selection tool's threshold, so a click on a label reads as a click. */
const DRAG_THRESHOLD_PX = 3

interface LabelDragSession {
  pointerId: number
  element: Element
  /** The canvas box, for turning client coordinates into canvas-relative ones. */
  container: Element
  start: Vec2
  startFrame: Bounds | null
  snap: SnapContext | null
  latest: Map<NodeId, Mat2D> | null
  moved: boolean
  /**
   * The selection change a click settles on release, when pressing an
   * artboard already selected: dropping it out on press would leave nothing
   * under the cursor to drag, and narrowing to it on press would stop a drag
   * from moving the rest. Null when the press already decided.
   */
  onClick: 'remove' | 'only' | null
  nodeId: NodeId
}

let session: LabelDragSession | null = null

export function isArtboardLabelDragging(): boolean {
  return session !== null
}

/**
 * @param element the label itself, which captures the pointer.
 * @param container the canvas box client coordinates are measured against.
 */
export function beginArtboardLabelDrag(
  nodeId: NodeId,
  native: PointerEvent,
  element: Element,
  container: Element,
): void {
  if (session || native.button !== 0) return

  const doc = getDoc()
  const editor = editorStore.getState()
  const start = toDoc(container, native.clientX, native.clientY)

  // Shift works as it does on the artwork: it adds an artboard, or takes one
  // out, and whatever is selected moves together.
  const already = editor.selection.includes(nodeId)
  let onClick: LabelDragSession['onClick'] = null
  if (native.shiftKey) {
    if (already) onClick = 'remove'
    else addToSelection([nodeId])
  } else if (already) {
    onClick = editor.selection.length > 1 ? 'only' : null
  } else {
    setSelection([nodeId])
  }

  // Locked artboards have nothing to drag; beginDrag says so and the press
  // stays a plain selection.
  const ids = editorStore.getState().selection.filter((id) => !isEffectivelyLocked(doc, id))
  if (ids.length === 0 || !beginDrag(doc, ids, 'move', start)) {
    settleClick(onClick, nodeId)
    return
  }

  session = {
    pointerId: native.pointerId,
    element,
    container,
    start,
    startFrame: getDragFrame(),
    snap: buildSnapContext(
      doc,
      new Set(ids),
      editor.viewport,
      editor.canvasSize,
      editor.snapEnabled,
    ),
    latest: null,
    moved: false,
    onClick,
    nodeId,
  }

  try {
    element.setPointerCapture(native.pointerId)
  } catch {
    // Capture is a nicety here — the window listeners below do the real work.
  }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerCancel)
  window.addEventListener('keydown', onKeyDown, true)
}

function toDoc(container: Element, clientX: number, clientY: number): Vec2 {
  const rect = container.getBoundingClientRect()
  return screenToDoc(editorStore.getState().viewport, {
    x: clientX - rect.left,
    y: clientY - rect.top,
  })
}

function onPointerMove(e: PointerEvent): void {
  const s = session
  if (!s || e.pointerId !== s.pointerId) return
  // Self-healing, as the tools do: a pointerup lost to a window switch would
  // otherwise leave the artboard following a cursor with no button held.
  if (e.buttons === 0) {
    end(true)
    return
  }

  const viewport = editorStore.getState().viewport
  const at = toDoc(s.container, e.clientX, e.clientY)
  if (!s.moved) {
    const px = Math.hypot(at.x - s.start.x, at.y - s.start.y) * viewport.zoom
    if (px < DRAG_THRESHOLD_PX) return
    s.moved = true
  }

  // Snapping runs against the moving box, not the pointer, so an artboard's
  // edge lands exactly on its neighbour's.
  let snapDelta: Vec2 | undefined
  let snapLines
  if (s.snap && s.startFrame && !(e.metaKey || e.ctrlKey)) {
    const raw = { x: at.x - s.start.x, y: at.y - s.start.y }
    const snap = resolveSnap(translateBounds(s.startFrame, raw.x, raw.y), s.snap)
    snapDelta = { x: snap.dx, y: snap.dy }
    snapLines = snap.lines
  }

  s.latest = updateDrag(at, {
    constrain: e.shiftKey,
    fromCenter: e.altKey,
    snapDelta,
    snapLines,
  })
}

function onPointerUp(e: PointerEvent): void {
  if (!session || e.pointerId !== session.pointerId) return
  end(true)
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

/** Ends the gesture in progress, committing it or putting the artboard back. */
export function cancelArtboardLabelDrag(): void {
  if (session) end(false)
}

function end(commit: boolean): void {
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

  // A press that never passed the threshold has nothing to commit, and
  // commitDrag says so itself: no movement, no undo entry.
  if (commit) commitDrag(s.latest)
  else cancelDrag()
  if (commit && !s.moved) settleClick(s.onClick, s.nodeId)
}

function settleClick(onClick: LabelDragSession['onClick'], nodeId: NodeId): void {
  if (onClick === 'remove') removeFromSelection([nodeId])
  else if (onClick === 'only') setSelection([nodeId])
}
