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
  polygonPath,
  polygonPoints,
  rectPath,
  starPath,
  starPoints,
  trianglePath,
  trianglePoints,
} from '../geometry/ShapeGeometry'
import { worldMatrix } from '../document/SceneGraph'
import { transaction } from '../state/DocumentStore'
import { editorStore } from '../state/EditorStore'
import { liveTransform } from '../canvas/LiveTransform'
import { geomKey } from '../canvas/NodeRenderer'
import {
  cornerRadiusOf,
  hasScalarCornerRadius,
  supportsCornerRadius,
  type DesignDocument,
  type DesignNode,
  type NodeId,
} from '../document/types'

export type RadiusCorner = 'nw' | 'ne' | 'se' | 'sw' | 'vertex'

interface RadiusState {
  id: NodeId
  corner: RadiusCorner
  world: Mat2D
  width: number
  height: number
  startRadius: number
  liveRadius: number
  /** Rebuilds the path for a candidate radius. */
  buildPath: (radius: number) => string
  maxRadius: number
  changed: boolean
}

let session: RadiusState | null = null

export function isRadiusDragging(): boolean {
  return session !== null
}

/** Live radius while a drag is in flight, for the inspector readout. */
export function getLiveRadius(id: NodeId): number | null {
  return session && session.id === id ? session.liveRadius : null
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
    case 'triangle': return trianglePoints(width, height)
    case 'polygon': return polygonPoints(width, height, node.sides)
    case 'star': return starPoints(width, height, node.points, node.innerRatio)
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
): boolean {
  const node = doc.nodes[id]
  if (!node || !supportsCornerRadius(node)) return false
  const geo = cornerGeometry(node, corner)
  if (!geo) return false

  const { width, height } = node.transform
  const buildPath = (radius: number): string => {
    switch (node.type) {
      case 'rect': return rectPath(width, height, [radius, radius, radius, radius])
      case 'image': return rectPath(width, height, [radius, radius, radius, radius])
      case 'triangle': return trianglePath(width, height, radius)
      case 'polygon': return polygonPath(width, height, node.sides, radius)
      case 'star': return starPath(width, height, node.points, node.innerRatio, radius)
      default: return ellipsePath(width, height)
    }
  }

  session = {
    id,
    corner,
    world: worldMatrix(doc, id),
    width,
    height,
    startRadius: cornerRadiusOf(node),
    liveRadius: cornerRadiusOf(node),
    buildPath,
    maxRadius: Math.max(0, geo.maxRadius),
    changed: false,
  }

  liveTransform.begin()
  editorStore.setState({ isDragging: true })
  return true
}

/** @returns the live radius, so the caller can drive a readout. */
export function updateRadiusDrag(currentDoc: Vec2, node: DesignNode): number | null {
  if (!session) return null
  const geo = cornerGeometry(node, session.corner)
  if (!geo) return null

  const local = applyToPoint(invert(session.world), currentDoc)
  // Project the pointer onto the inward bisector: dragging sideways along an
  // edge should not change the radius, only dragging inward should.
  const along =
    (local.x - geo.point.x) * geo.inward.x + (local.y - geo.point.y) * geo.inward.y
  const radius = Math.min(session.maxRadius, Math.max(0, along * geo.sinHalf))

  session.liveRadius = radius
  session.changed = true
  liveTransform.set(geomKey(session.id), { attrs: { d: session.buildPath(radius) } })
  return radius
}

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
      node.cornerRadius = [radius, radius, radius, radius]
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
