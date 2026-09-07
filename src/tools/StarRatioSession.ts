/**
 * The on-canvas Star Ratio handle.
 *
 * Adobe XD turns a polygon into a star by dragging a single handle inward from
 * an edge midpoint; this is that gesture. It follows the same three-phase
 * contract as DragSession and RadiusSession — snapshot on pointerdown, write the
 * regenerated path straight to the mounted SVG element every frame, and commit
 * ONE transaction on pointerup — so dragging it costs no store writes and no
 * React renders of the document.
 *
 * The one readout that does update live is the inspector's Star field, which
 * subscribes to the same LiveTransform channel the overlay uses.
 */

import { applyToPoint, invert, type Mat2D, type Vec2 } from '../geometry/Matrix'
import { polygonStarPath, starRatioFromPoint } from '../geometry/ShapeGeometry'
import { isEffectivelyLocked, worldMatrix } from '../document/SceneGraph'
import { transaction } from '../state/DocumentStore'
import { editorStore } from '../state/EditorStore'
import { liveTransform } from '../canvas/LiveTransform'
import { geomKey } from '../canvas/NodeRenderer'
import type { DesignDocument, NodeId } from '../document/types'

interface StarRatioState {
  id: NodeId
  world: Mat2D
  sides: number
  width: number
  height: number
  cornerRadius: number
  startRatio: number
  liveRatio: number
  /**
   * Ratio implied by the point where the handle was grabbed. The drag is applied
   * as a DELTA from this, so the shape does not jump on the first frame when the
   * pointer lands slightly off the handle's centre.
   */
  grabRatio: number
  changed: boolean
}

let session: StarRatioState | null = null

/** Movement below this (as a fraction) is a click, not a drag. */
const RATIO_DRAG_THRESHOLD = 0.005

/** Shift snaps to 10% steps, matching XD. */
const SHIFT_STEP = 0.1

export function isStarRatioDragging(): boolean {
  return session !== null
}

/** Live ratio for the node under an in-flight drag, for the inspector readout. */
export function getLiveStarRatio(id: NodeId): number | null {
  return session && session.id === id ? session.liveRatio : null
}

export function beginStarRatioDrag(
  doc: DesignDocument,
  id: NodeId,
  startDoc: Vec2,
): boolean {
  const node = doc.nodes[id]
  if (!node || node.type !== 'polygon') return false
  // Honours a locked ANCESTOR, not just this node's own flag — the same rule
  // every other edit path enforces.
  if (isEffectivelyLocked(doc, id)) return false

  const world = worldMatrix(doc, id)
  const { width, height } = node.transform
  const local = applyToPoint(invert(world), startDoc)

  session = {
    id,
    world,
    sides: node.sides,
    width,
    height,
    cornerRadius: node.cornerRadius,
    startRatio: node.starRatio,
    liveRatio: node.starRatio,
    grabRatio: starRatioFromPoint(width, height, node.sides, local),
    changed: false,
  }

  liveTransform.begin()
  editorStore.setState({ isDragging: true })
  return true
}

/** @returns the live ratio, so the caller can drive a readout. */
export function updateStarRatioDrag(currentDoc: Vec2, shiftKey = false): number | null {
  if (!session) return null
  const s = session

  const local = applyToPoint(invert(s.world), currentDoc)
  const at = starRatioFromPoint(s.width, s.height, s.sides, local)
  let ratio = Math.min(1, Math.max(0.01, s.startRatio + (at - s.grabRatio)))
  if (shiftKey) ratio = Math.min(1, Math.max(0.01, Math.round(ratio / SHIFT_STEP) * SHIFT_STEP))

  if (!s.changed && Math.abs(ratio - s.startRatio) < RATIO_DRAG_THRESHOLD) {
    // Still within click tolerance — do not dirty the document for a stray click.
    return s.startRatio
  }

  s.liveRatio = ratio
  s.changed = true
  liveTransform.set(geomKey(s.id), {
    attrs: { d: polygonStarPath(s.width, s.height, s.sides, ratio, s.cornerRadius) },
  })
  return ratio
}

export function commitStarRatioDrag(): boolean {
  if (!session) return false
  const s = session
  session = null
  liveTransform.end()
  editorStore.setState({ isDragging: false })

  if (!s.changed || Math.abs(s.liveRatio - s.startRatio) < 1e-6) return false

  const ratio = Math.round(s.liveRatio * 1000) / 1000
  return transaction('Star ratio', (draft) => {
    const node = draft.nodes[s.id]
    if (!node || node.type !== 'polygon') return false
    node.starRatio = ratio
    return undefined
  })
}

export function cancelStarRatioDrag(): void {
  if (!session) return
  session = null
  liveTransform.cancel()
  editorStore.setState({ isDragging: false })
}
