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
import { createMatrixCache, geometryBounds, nodePathData, worldGuides } from '../document/SceneGraph'
import { pathToSubpaths } from '../geometry/PathPoints'
import { applyToPoint } from '../geometry/Matrix'
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

  return out
}

/**
 * Guide candidates, in world space.
 *
 * Separate from the object candidates because guides are separately gated: a
 * guide is not an object, and turning off "snap to objects" used to silently
 * take guide snapping with it.
 */
export function collectGuideCandidates(doc: DesignDocument): SnapCandidate[] {
  const cache = createMatrixCache()
  const byBoard = new Map<NodeId, Array<{ axis: 'x' | 'y'; position: number }>>()
  for (const g of worldGuides(doc, cache)) {
    const list = byBoard.get(g.artboardId)
    const entry = { axis: g.guide.axis, position: g.position }
    if (list) list.push(entry)
    else byBoard.set(g.artboardId, [entry])
  }

  const out: SnapCandidate[] = []
  for (const [artboardId, guides] of byBoard) {
    out.push(...candidatesFromGuides(guides, geometryBounds(doc, artboardId, cache)))
  }
  return out
}

/**
 * Node kinds whose anchor points can be snapped to.
 *
 * The same allow-list PathEditing.editableOutline uses, spelled out again
 * rather than imported: PathEditing will import THIS module for anchor
 * snapping, and the cycle would be real.
 */
const POINT_EDITABLE = new Set(['path', 'rect', 'ellipse', 'polygon', 'line'])

/** Never collect more than this; a traced image can carry thousands of anchors. */
const MAX_ANCHOR_CANDIDATES = 4000

/**
 * Every anchor point on screen, as snap candidates in world space.
 *
 * Adobe: "snap lines appear when an anchor is vertically or horizontally near
 * another anchor point." That is a POINT-to-POINT relationship, which is why
 * this exists alongside collectSnapCandidates — that one emits the edges and
 * centres of bounding BOXES, and an anchor lining up with the middle of a
 * neighbour's box is not what the pen is being asked about.
 *
 * Viewport-culled and capped, and collected once per gesture rather than per
 * pointer move, so the path parsing here is paid for once.
 */
export function collectAnchorCandidates(
  doc: DesignDocument,
  viewport: Viewport,
  canvasSize: { width: number; height: number },
  skip?: NodeId,
): SnapCandidate[] {
  const view = visibleDocBounds(viewport, canvasSize, 100)
  const cache = createMatrixCache()
  const out: SnapCandidate[] = []

  const visit = (id: NodeId, depth: number): void => {
    if (out.length >= MAX_ANCHOR_CANDIDATES) return
    const node = doc.nodes[id]
    if (!node || !node.visible) return
    // The node being edited supplies its own candidates, minus the points that
    // are moving — otherwise a dragged anchor snaps to where it just was.
    if (id === skip) return

    const b = geometryBounds(doc, id, cache)
    if (b.x > view.x + view.width || b.x + b.width < view.x) return
    if (b.y > view.y + view.height || b.y + b.height < view.y) return

    if (POINT_EDITABLE.has(node.type)) {
      const d = nodePathData(node)
      if (d) {
        const world = cache.world(doc, id)
        for (const sub of pathToSubpaths(d)) {
          for (const p of sub.points) {
            if (out.length >= MAX_ANCHOR_CANDIDATES) return
            const w = applyToPoint(world, { x: p.x, y: p.y })
            // `from`/`to` collapse to the anchor itself: a point has no extent,
            // and computeSnap spans the guide line between it and the mover.
            out.push({ axis: 'x', position: w.x, kind: 'edge', from: w.y, to: w.y })
            out.push({ axis: 'y', position: w.y, kind: 'edge', from: w.x, to: w.x })
          }
        }
      }
    }

    if (isContainer(node) && depth < 3) for (const child of node.children) visit(child, depth + 1)
  }

  const root = doc.nodes[doc.rootId]
  if (isContainer(root)) for (const child of root.children) visit(child, 0)
  return out
}

/**
 * Snap a single POINT rather than a box.
 *
 * computeSnap already does the right thing with a zero-size box — its edge
 * scan collapses to three copies of the same coordinate per axis — so this is
 * only about the call sites reading as what they are.
 */
export function snapPoint(p: Vec2, ctx: SnapContext): SnapResult {
  return resolveSnap({ x: p.x, y: p.y, width: 0, height: 0 }, ctx)
}

/** A context that snaps to anchor points alone, for the pen and point editing. */
export function buildAnchorSnapContext(
  doc: DesignDocument,
  viewport: Viewport,
  canvasSize: { width: number; height: number },
  enabled: boolean,
  skip?: NodeId,
): SnapContext {
  return {
    candidates: enabled ? collectAnchorCandidates(doc, viewport, canvasSize, skip) : [],
    thresholdDoc: SNAP_THRESHOLD_PX / (viewport.zoom || 1),
    // Grid snapping is deliberately not folded in: the section this implements
    // describes anchors lining up with anchors, and nothing else.
    gridSize: doc.settings.gridSize,
    snapToGridEnabled: false,
    useCandidates: enabled,
  }
}

export interface SnapContext {
  candidates: SnapCandidate[]
  thresholdDoc: number
  gridSize: number
  snapToGridEnabled: boolean
  /**
   * Whether to consult `candidates` at all.
   *
   * Not "snapToObjects": the list holds guides too, and they are gated
   * separately — a guide is not an object, and turning off object snapping used
   * to take guide snapping silently with it.
   */
  useCandidates: boolean
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
    candidates: [
      ...(enabled && doc.settings.snapToObjects
        ? collectSnapCandidates(doc, exclude, viewport, canvasSize)
        : []),
      // Gated on the guides being shown rather than on "snap to objects": a
      // hidden guide should not pull, and an object setting should not govern
      // something that is not an object.
      ...(enabled && doc.settings.guidesVisible ? collectGuideCandidates(doc) : []),
    ],
    thresholdDoc,
    gridSize: doc.settings.gridSize,
    snapToGridEnabled: enabled && doc.settings.snapToGrid,
    useCandidates: enabled && (doc.settings.snapToObjects || doc.settings.guidesVisible),
  }
}

/** Resolve the correction for a moving box. Grid wins only when objects miss. */
export function resolveSnap(moving: Bounds, ctx: SnapContext): SnapResult {
  if (ctx.useCandidates) {
    const objectSnap = computeSnap(moving, ctx.candidates, ctx.thresholdDoc)
    if (objectSnap.dx !== 0 || objectSnap.dy !== 0) return objectSnap
  }
  if (ctx.snapToGridEnabled) return snapToGrid(moving, ctx.gridSize, ctx.thresholdDoc)
  return { dx: 0, dy: 0, lines: [] }
}
