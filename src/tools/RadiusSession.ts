/**
 * Corner-radius dragging.
 *
 * Follows the same three-phase contract as DragSession: snapshot on
 * pointerdown, write the regenerated path straight to the mounted SVG element
 * on every move, and commit ONE transaction on pointerup. No store writes
 * during the gesture, so a radius drag costs no React renders.
 *
 * Two shapes of radius exist and they are not interchangeable:
 *   - rect / image carry four independently addressable corners (CornerRadii),
 *     though dragging any handle sets all four, matching the inspector's single
 *     field and the way these are actually used.
 *   - triangle / polygon / star carry ONE scalar, because their vertices are
 *     generated from sides/points and there is nothing stable to key per-corner
 *     values to.
 */

import { applyToPoint, invert, type Mat2D, type Vec2 } from '../geometry/Matrix'
import {
  ellipsePath,
  maxPolygonRadius,
  polygonStarPath,
  polygonStarPoints,
  rectPath,
} from '../geometry/ShapeGeometry'
import { isEffectivelyLocked, worldMatrix } from '../document/SceneGraph'
import { transaction } from '../state/DocumentStore'
import { editorStore } from '../state/EditorStore'
import { liveTransform } from '../canvas/LiveTransform'
import { geomKey } from '../canvas/NodeRenderer'
import {
  cornerIndex,
  cornerRadiusOf,
  hasScalarCornerRadius,
  supportsCornerRadius,
  type BoxCorner,
  type CornerRadii,
  type DesignDocument,
  type DesignNode,
  type NodeId,
} from '../document/types'

export type RadiusCorner = 'nw' | 'ne' | 'se' | 'sw' | 'vertex'

interface RadiusState {
  id: NodeId
  corner: RadiusCorner
  world: Mat2D
  startRadius: number
  liveRadius: number
  /** Rebuilds the path for a candidate radius. */
  buildPath: (radius: number) => string
  maxRadius: number
  /**
   * Where along the bisector the pointer grabbed, so the radius tracks the
   * pointer from wherever it was picked up. Without it the radius snaps to the
   * handle's minimum stand-off distance on the first move, making every small
   * radius unreachable and letting a stray click commit a change.
   */
  grabAlong: number
  /** Only true once the pointer has moved far enough to be a drag, not a click. */
  changed: boolean
  /** All four corners at gesture start, for independent-corner editing. */
  startRadii: CornerRadii
  independent: boolean
}

let session: RadiusState | null = null

export function isRadiusDragging(): boolean {
  return session !== null
}

/**
 * Live radius while a drag is in flight, for the inspector readout.
 * @param corner when given, the radius of that specific corner.
 */
export function getLiveRadius(id: NodeId, corner?: BoxCorner): number | null {
  if (!session || session.id !== id || !session.changed) return null
  if (!corner || !session.independent) return session.liveRadius
  return session.corner === corner ? session.liveRadius : session.startRadii[cornerIndex(corner)]
}

/**
 * Geometry of the corner a handle belongs to, in the node's LOCAL space.
 *
 * For a box corner this is the corner point and the inward diagonal. For a
 * polygon vertex it is the vertex and its inward angle bisector, plus the half
 * angle — which is what converts a distance along the bisector into a radius,
 * since the arc's centre sits at r / sin(theta/2) from the vertex.
 */
export interface CornerGeometry {
  point: Vec2
  /** Unit vector pointing into the shape. */
  inward: Vec2
  /** sin(theta/2) at this vertex; 1 for an axis-aligned box corner's diagonal. */
  sinHalf: number
  maxRadius: number
}

export function cornerGeometry(node: DesignNode, corner: RadiusCorner): CornerGeometry | null {
  const { width: w, height: h } = node.transform

  if (corner !== 'vertex') {
    const point = {
      x: corner === 'nw' || corner === 'sw' ? 0 : w,
      y: corner === 'nw' || corner === 'ne' ? 0 : h,
    }
    const inward = {
      x: corner === 'nw' || corner === 'sw' ? 1 : -1,
      y: corner === 'nw' || corner === 'ne' ? 1 : -1,
    }
    // A 90-degree corner: the arc centre sits exactly r from each edge, so the
    // handle rides the diagonal at r along both axes.
    return {
      point,
      inward: { x: inward.x / Math.SQRT2, y: inward.y / Math.SQRT2 },
      sinHalf: Math.SQRT1_2,
      maxRadius: Math.min(w, h) / 2,
    }
  }

  const verts = polygonVertices(node)
  if (!verts || verts.length < 3) return null

  const cur = verts[0]!
  const prev = verts[verts.length - 1]!
  const next = verts[1]!
  const u1 = normalize({ x: prev.x - cur.x, y: prev.y - cur.y })
  const u2 = normalize({ x: next.x - cur.x, y: next.y - cur.y })
  const bisector = normalize({ x: u1.x + u2.x, y: u1.y + u2.y })
  const theta = Math.acos(Math.min(1, Math.max(-1, u1.x * u2.x + u1.y * u2.y)))

  return {
    point: cur,
    inward: bisector,
    sinHalf: Math.max(0.05, Math.sin(theta / 2)),
    maxRadius: maxPolygonRadius(verts),
  }
}

function polygonVertices(node: DesignNode): Vec2[] | null {
  const { width, height } = node.transform
  switch (node.type) {
    case 'polygon': return polygonStarPoints(width, height, node.sides, node.starRatio)
    default: return null
  }
}

function normalize(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y) || 1
  return { x: v.x / len, y: v.y / len }
}

/** Where a handle sits, in local space, for a given radius. */
export function radiusHandlePosition(
  node: DesignNode,
  corner: RadiusCorner,
  radius: number,
  minDistance: number,
): Vec2 | null {
  const geo = cornerGeometry(node, corner)
  if (!geo) return null
  // The handle rides the arc's centre, which is r / sin(theta/2) along the
  // bisector — so it visibly tracks the curve rather than drifting off it.
  const distance = Math.max(minDistance, radius / geo.sinHalf)
  return {
    x: geo.point.x + geo.inward.x * distance,
    y: geo.point.y + geo.inward.y * distance,
  }
}

// ---------------------------------------------------------------------------
// Gesture
// ---------------------------------------------------------------------------

export function beginRadiusDrag(
  doc: DesignDocument,
  id: NodeId,
  corner: RadiusCorner,
  startDoc: Vec2,
  independent = false,
): boolean {
  const node = doc.nodes[id]
  if (!node || !supportsCornerRadius(node)) return false
  // Honours a locked ANCESTOR, not just this node's own flag — a child of a
  // locked group is selectable from the Layers panel and must stay uneditable.
  if (isEffectivelyLocked(doc, id)) return false

  const geo = cornerGeometry(node, corner)
  if (!geo) return false

  const { width, height } = node.transform
  const boxRadii: CornerRadii =
    node.type === 'rect' || node.type === 'image'
      ? (node.cornerRadius ?? [0, 0, 0, 0])
      : [0, 0, 0, 0]
  const perCorner = independent && corner !== 'vertex'
  const index = corner === 'vertex' ? 0 : cornerIndex(corner as BoxCorner)

  const buildPath = (radius: number): string => {
    switch (node.type) {
      case 'rect':
      case 'image': {
        // Independent mode moves only the grabbed corner; uniform moves all four.
        const radii: CornerRadii = perCorner
          ? ([0, 1, 2, 3].map((i) => (i === index ? radius : boxRadii[i]!)) as unknown as CornerRadii)
          : [radius, radius, radius, radius]
        return rectPath(width, height, radii)
      }
      case 'polygon':
        return polygonStarPath(width, height, node.sides, node.starRatio, radius)
      default: return ellipsePath(width, height)
    }
  }

  const world = worldMatrix(doc, id)
  const localStart = applyToPoint(invert(world), startDoc)
  const grabAlong =
    (localStart.x - geo.point.x) * geo.inward.x + (localStart.y - geo.point.y) * geo.inward.y

  const startRadius = cornerRadiusOf(node, corner === 'vertex' ? undefined : (corner as BoxCorner))

  session = {
    id,
    corner,
    world,
    startRadius,
    liveRadius: startRadius,
    buildPath,
    maxRadius: Math.max(0, geo.maxRadius),
    grabAlong,
    changed: false,
    startRadii: boxRadii,
    independent: perCorner,
  }

  liveTransform.begin()
  editorStore.setState({ isDragging: true })
  return true
}

/**
 * @param doc the live document — the node is resolved from the SESSION's id,
 *   never from the current selection, which can change mid-drag (Cmd+A while
 *   the button is held) and would otherwise remap the pointer through a
 *   different shape's geometry while committing to the original.
 * @returns the live radius, so the caller can drive a readout.
 */
export function updateRadiusDrag(currentDoc: Vec2, doc: DesignDocument): number | null {
  if (!session) return null
  const node = doc.nodes[session.id]
  if (!node) return session.liveRadius
  const geo = cornerGeometry(node, session.corner)
  if (!geo) return session.liveRadius

  const local = applyToPoint(invert(session.world), currentDoc)
  // Project onto the inward bisector: sliding along an edge must not change the
  // radius, only moving inward should.
  const along =
    (local.x - geo.point.x) * geo.inward.x + (local.y - geo.point.y) * geo.inward.y

  // Relative to where the handle was grabbed, so the radius does not jump to
  // the handle's minimum stand-off on the first frame.
  const delta = (along - session.grabAlong) * geo.sinHalf
  const radius = Math.min(session.maxRadius, Math.max(0, session.startRadius + delta))

  if (!session.changed && Math.abs(radius - session.startRadius) < RADIUS_DRAG_THRESHOLD) {
    // Still within click tolerance — do not dirty the document for a stray click.
    return session.startRadius
  }

  session.liveRadius = radius
  session.changed = true
  liveTransform.set(geomKey(session.id), { attrs: { d: session.buildPath(radius) } })
  return radius
}

/** Movement below this (in local units) is a click, not a radius drag. */
const RADIUS_DRAG_THRESHOLD = 0.5

export function commitRadiusDrag(): boolean {
  if (!session) return false
  const s = session
  session = null
  liveTransform.end()
  editorStore.setState({ isDragging: false })

  if (!s.changed || Math.abs(s.liveRadius - s.startRadius) < 1e-6) return false

  const radius = Math.round(s.liveRadius * 100) / 100
  return transaction('Corner radius', (draft) => {
    const node = draft.nodes[s.id]
    if (!node) return false
    if (node.type === 'rect' || node.type === 'image') {
      node.cornerRadius = s.independent
        ? ([0, 1, 2, 3].map((i) =>
            i === cornerIndex(s.corner as BoxCorner) ? radius : s.startRadii[i]!,
          ) as unknown as CornerRadii)
        : [radius, radius, radius, radius]
      return undefined
    }
    if (hasScalarCornerRadius(node)) {
      node.cornerRadius = radius
      return undefined
    }
    return false
  })
}

export function cancelRadiusDrag(): void {
  if (!session) return
  session = null
  liveTransform.cancel()
  editorStore.setState({ isDragging: false })
}
