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
 * Crop mode: choosing which part of an image's picture to keep.
 *
 * While it is on, the canvas shows the whole picture, dimmed outside the part
 * that would be kept, with a frame and eight handles around that part
 * (SelectionOverlay's CropFrame). Dragging a handle moves that edge or corner;
 * dragging inside moves the kept part over the picture. The rectangle lives in
 * the editor store, in the image's own units, and the document is only written
 * when the crop is applied — so a crop, however many drags it took, is one
 * undo step, and cancelling costs nothing.
 *
 * Applied by Enter, the inspector's Done, or clicking anywhere else; left
 * without a trace by Escape or Cancel. If the image changes underneath — an
 * undo, a delete — the mode simply ends, since the rectangle was measured
 * against an image that is no longer there.
 */

import { cropImage } from '../history/Commands'
import { clampToFrame, fullImageFrame } from '../document/ImageCrop'
import { isEffectivelyLocked, worldMatrix } from '../document/SceneGraph'
import { is3dAffected } from '../document/Scene3D'
import { applyToPoint, invert, type Vec2 } from '../geometry/Matrix'
import { documentStore, getDoc } from '../state/DocumentStore'
import { editorStore, setEditor, setSelection, setTool } from '../state/EditorStore'
import type { Bounds } from '../geometry/Bounds'
import type { ImageNode, NodeId } from '../document/types'

/** The eight handles, plus the inside of the frame, which moves the crop. */
export type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move'

/** The smallest crop, in the image's own units. */
const MIN_CROP = 1

interface CropDrag {
  handle: CropHandle
  /** Pointer at the press, in the image's own units. */
  start: Vec2
  /** The kept rectangle at the press. */
  startRect: Bounds
  /** Document point → image units, fixed for the gesture. */
  toLocal: (p: Vec2) => Vec2
}

let drag: CropDrag | null = null

function editedImage(): ImageNode | null {
  const editing = editorStore.getState().cropEditing
  const node = editing ? getDoc().nodes[editing.nodeId] : undefined
  return node?.type === 'image' ? node : null
}

export function isCropping(): boolean {
  return editorStore.getState().cropEditing !== null
}

/**
 * Whether an image can be cropped at all — it must exist and be editable, and
 * be flat: a tilted image is drawn in perspective, and the crop frame, like
 * the corner-radius handles, would sit on the flat box rather than the picture.
 */
export function canCrop(id: NodeId): boolean {
  const doc = getDoc()
  const node = doc.nodes[id]
  return node?.type === 'image' && !isEffectivelyLocked(doc, id) && !is3dAffected(doc, id)
}

/**
 * Start cropping `id`, showing the crop it already has. Crop mode is the
 * arrow's, so it takes the arrow; other on-canvas editors are closed, as they
 * would compete for the same handles.
 */
export function enterCropMode(id: NodeId): boolean {
  if (!canCrop(id)) return false
  const node = getDoc().nodes[id] as ImageNode
  if (editorStore.getState().tool !== 'select') setTool('select')
  setSelection([id])
  setEditor({
    cropEditing: { nodeId: id, rect: { x: 0, y: 0, width: node.transform.width, height: node.transform.height } },
    nodeEditingId: null,
    gradientEditing: null,
    activeGradientStop: null,
    hoverId: null,
  })
  return true
}

/** Apply the crop being edited. False when there was nothing to apply. */
export function commitCropMode(): boolean {
  const editing = editorStore.getState().cropEditing
  drag = null
  if (!editing) return false
  // Out of the mode first: applying changes the image, and a changed image is
  // otherwise read as one that changed underneath the mode.
  setEditor({ cropEditing: null })
  return cropImage(editing.nodeId, editing.rect)
}

export function cancelCropMode(): void {
  drag = null
  if (editorStore.getState().cropEditing) setEditor({ cropEditing: null })
}

/** Keep the whole picture — Reset while cropping. Applied like any other crop. */
export function resetCropRect(): void {
  const node = editedImage()
  if (!node) return
  setRect(fullImageFrame(node))
}

function setRect(rect: Bounds): void {
  const editing = editorStore.getState().cropEditing
  if (editing) setEditor({ cropEditing: { ...editing, rect } })
}

// ---------------------------------------------------------------------------
// Dragging
// ---------------------------------------------------------------------------

export function beginCropDrag(handle: CropHandle, at: Vec2): boolean {
  const editing = editorStore.getState().cropEditing
  if (!editing || !editedImage()) return false
  const inverse = invert(worldMatrix(getDoc(), editing.nodeId))
  const toLocal = (p: Vec2) => applyToPoint(inverse, p)
  drag = { handle, start: toLocal(at), startRect: editing.rect, toLocal }
  editorStore.setState({ isDragging: true })
  return true
}

export function isCropDragging(): boolean {
  return drag !== null
}

/**
 * @param keepRatio Shift on a corner: the kept part keeps its proportions, as
 *        Shift does for every other corner drag in the app.
 */
export function updateCropDrag(at: Vec2, keepRatio: boolean): void {
  const node = editedImage()
  if (!drag || !node) return
  const frame = fullImageFrame(node)
  const p = drag.toLocal(at)
  const dx = p.x - drag.start.x
  const dy = p.y - drag.start.y
  const r = drag.startRect

  if (drag.handle === 'move') {
    setRect(clampToFrame({ ...r, x: r.x + dx, y: r.y + dy }, frame, MIN_CROP))
    return
  }

  // Each edge the handle names follows the pointer, held inside the picture
  // and short of crossing the opposite edge.
  const h = drag.handle
  let left = r.x
  let top = r.y
  let right = r.x + r.width
  let bottom = r.y + r.height
  if (h.includes('w')) left = Math.min(right - MIN_CROP, Math.max(frame.x, r.x + dx))
  if (h.includes('e')) right = Math.max(left + MIN_CROP, Math.min(frame.x + frame.width, right + dx))
  if (h.includes('n')) top = Math.min(bottom - MIN_CROP, Math.max(frame.y, r.y + dy))
  if (h.includes('s')) bottom = Math.max(top + MIN_CROP, Math.min(frame.y + frame.height, bottom + dy))

  if (keepRatio && h.length === 2 && r.width > 0 && r.height > 0) {
    // The larger change wins, and the other edge follows it from the corner
    // opposite the one held — then the whole is held inside the picture.
    const ratio = r.width / r.height
    let width = right - left
    let height = bottom - top
    if (width / ratio > height) height = width / ratio
    else width = height * ratio
    const anchorX = h.includes('w') ? r.x + r.width : r.x
    const anchorY = h.includes('n') ? r.y + r.height : r.y
    const maxW = h.includes('w') ? anchorX - frame.x : frame.x + frame.width - anchorX
    const maxH = h.includes('n') ? anchorY - frame.y : frame.y + frame.height - anchorY
    const scale = Math.min(1, maxW / width, maxH / height)
    width *= scale
    height *= scale
    left = h.includes('w') ? anchorX - width : anchorX
    top = h.includes('n') ? anchorY - height : anchorY
    right = left + width
    bottom = top + height
  }

  setRect({ x: left, y: top, width: right - left, height: bottom - top })
}

export function endCropDrag(): void {
  drag = null
  editorStore.setState({ isDragging: false })
}

/** Escape during a drag puts the rectangle back where the drag found it. */
export function cancelCropDrag(): void {
  if (drag) setRect(drag.startRect)
  endCropDrag()
}

/** Arrow keys move the kept part over the picture, in the image's own units. */
export function nudgeCrop(dx: number, dy: number): void {
  const editing = editorStore.getState().cropEditing
  const node = editedImage()
  if (!editing || !node) return
  const r = editing.rect
  setRect(clampToFrame({ ...r, x: r.x + dx, y: r.y + dy }, fullImageFrame(node), MIN_CROP))
}

// ---------------------------------------------------------------------------
// Staying honest
// ---------------------------------------------------------------------------

/**
 * Ends crop mode when what it was cropping is no longer what is on screen.
 *
 * Choosing something else applies the crop, as clicking away does. The image
 * itself changing — an undo, a delete, a nudge from a panel — cancels it: the
 * rectangle was measured against the image as it was.
 */
export function installCropReconciler(): () => void {
  const offSelection = editorStore.subscribe(
    (s) => s.selection,
    (selection) => {
      const editing = editorStore.getState().cropEditing
      if (!editing) return
      if (selection.length === 1 && selection[0] === editing.nodeId) return
      // Deferred: this runs inside whatever changed the selection, and
      // applying is itself a document write.
      queueMicrotask(() => {
        if (editorStore.getState().cropEditing === editing) commitCropMode()
      })
    },
  )
  // Reaching for another tool is moving on, which applies the crop as a click
  // away would. Not the Hand borrowed while Space is held: that is a pan, and
  // the arrow comes back when the key does.
  const offTool = editorStore.subscribe(
    (s) => [s.tool, s.toolBeforeTemporary] as const,
    ([tool, before]) => {
      if (!editorStore.getState().cropEditing || tool === 'select' || before === 'select') return
      queueMicrotask(() => commitCropMode())
    },
    { equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1] },
  )
  let watched: unknown = null
  const offDocument = documentStore.subscribe((state) => {
    const editing = editorStore.getState().cropEditing
    if (!editing) {
      watched = null
      return
    }
    const node = state.doc.nodes[editing.nodeId]
    if (watched === null) {
      watched = node
      return
    }
    if (node !== watched) cancelCropMode()
  })
  const offMode = editorStore.subscribe(
    (s) => s.cropEditing?.nodeId ?? null,
    (id) => {
      // A fresh mode starts watching the image as it is now.
      watched = id ? getDoc().nodes[id] ?? null : null
    },
  )
  return () => {
    offSelection()
    offTool()
    offDocument()
    offMode()
  }
}
