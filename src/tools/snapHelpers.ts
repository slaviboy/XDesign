/**
 * Gathers snap candidates from the live document for an in-flight drag.
 *
 * Kept separate from the pure Snapping math so that module stays testable
 * without a store, and so tools share one definition of "what can I snap to".
 */

import {
  candidatesFromBounds,
  candidatesFromGuides,
  computeSnap,
  snapToGrid,
  type SnapCandidate,
  type SnapResult,
} from '../geometry/Snapping'
import { createMatrixCache, geometryBounds } from '../document/SceneGraph'
import { isContainer } from '../document/types'
import { visibleDocBounds } from '../canvas/Viewport'
import type { Bounds } from '../geometry/Bounds'
import type { Vec2 } from '../geometry/Matrix'
import type { DesignDocument, NodeId } from '../document/types'
import type { Viewport } from '../state/EditorStore'

/** Screen-pixel snap radius; converted to document units by the caller. */
export const SNAP_THRESHOLD_PX = 6

/**
 * Snap `to` onto the nearest ray of `stepDeg` degrees around `from`.
 *
 * Shared because the shape tools and the pen constrain the same way and must
 * agree: 45 degrees for a line or a new anchor, 15 for a Bezier handle, both
 * matching XD.
 */
export function snapAngle(from: Vec2, to: Vec2, stepDeg: number): Vec2 {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const step = (stepDeg * Math.PI) / 180
  const angle = Math.round(Math.atan2(dy, dx) / step) * step
  const len = Math.hypot(dx, dy)
  return { x: from.x + Math.cos(angle) * len, y: from.y + Math.sin(angle) * len }
}

/**
 * Everything the dragged selection may align to: artboard edges and centers,
 * the edges and centers of other objects, and user guides.
 *
 * Nodes being dragged are excluded — an object must not snap to where it used
 * to be. Only what is on screen is considered, which keeps this O(visible)
 * rather than O(document) on a large file.
 */
export function collectSnapCandidates(
  doc: DesignDocument,
  exclude: ReadonlySet<NodeId>,
  viewport: Viewport,
  canvasSize: { width: number; height: number },
): SnapCandidate[] {
  const view = visibleDocBounds(viewport, canvasSize, 100)
  const cache = createMatrixCache()
  const out: SnapCandidate[] = []

  const visit = (id: NodeId, depth: number): void => {
    if (exclude.has(id)) return
    const node = doc.nodes[id]
    if (!node || !node.visible) return

    const b = geometryBounds(doc, id, cache)
    if (b.width <= 0 && b.height <= 0) return
    // Cheap viewport reject.
    if (b.x > view.x + view.width || b.x + b.width < view.x) return
    if (b.y > view.y + view.height || b.y + b.height < view.y) return

    out.push(...candidatesFromBounds(b, 'edge'))

    // Descend into artboards so their contents are snap targets, but do not
    // walk deep into every group — snapping to a group is what users expect.
    if (node.type === 'artboard' && depth < 2) {
      for (const child of node.children) visit(child, depth + 1)
    }

  }

  const root = doc.nodes[doc.rootId]
  if (isContainer(root)) for (const child of root.children) visit(child, 0)

  out.push(...candidatesFromGuides(doc.guides, view))
  return out
}

export interface SnapContext {
  candidates: SnapCandidate[]
  thresholdDoc: number
  gridSize: number
  snapToGridEnabled: boolean
  snapToObjectsEnabled: boolean
}

export function buildSnapContext(
  doc: DesignDocument,
  exclude: ReadonlySet<NodeId>,
  viewport: Viewport,
  canvasSize: { width: number; height: number },
  enabled: boolean,
): SnapContext {
  const thresholdDoc = SNAP_THRESHOLD_PX / (viewport.zoom || 1)
  return {
    candidates: enabled && doc.settings.snapToObjects
      ? collectSnapCandidates(doc, exclude, viewport, canvasSize)
      : [],
    thresholdDoc,
    gridSize: doc.settings.gridSize,
    snapToGridEnabled: enabled && doc.settings.snapToGrid,
    snapToObjectsEnabled: enabled && doc.settings.snapToObjects,
  }
}

/** Resolve the correction for a moving box. Grid wins only when objects miss. */
export function resolveSnap(moving: Bounds, ctx: SnapContext): SnapResult {
  if (ctx.snapToObjectsEnabled) {
    const objectSnap = computeSnap(moving, ctx.candidates, ctx.thresholdDoc)
    if (objectSnap.dx !== 0 || objectSnap.dy !== 0) return objectSnap
  }
  if (ctx.snapToGridEnabled) return snapToGrid(moving, ctx.gridSize, ctx.thresholdDoc)
  return { dx: 0, dy: 0, lines: [] }
}
