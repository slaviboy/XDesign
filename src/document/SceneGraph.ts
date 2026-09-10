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
 * Scene graph queries: transforms, bounds, traversal and hit testing.
 *
 * All pure functions over a DesignDocument. DOM-free, so every one of these is
 * directly testable in node — which matters most for hit testing, where the
 * browser's own answer (elementFromPoint) is not available to the geometry layer
 * and would not agree with a rotated group anyway.
 */

import {
  invert,
  applyToPoint,
  multiply,
  IDENTITY,
  type Mat2D,
  type Vec2,
  meanScale,
} from '../geometry/Matrix'
import { localMatrix, nodeLocalMatrix } from './Transforms'
import {
  EMPTY_BOUNDS,
  transformBounds,
  union,
  unionAll,
  containsPoint,
  intersects,
  type Bounds,
  intersection,
} from '../geometry/Bounds'
import {
  ellipsePath,
  linePath,
  polygonStarPath,
  rectPath,
} from '../geometry/ShapeGeometry'
import {
  pathBounds,
  pointInPath,
  pointOnStroke,
  strokeInflate,
  pathOverlapsBounds,
} from '../geometry/PathUtils'
import {
  NEAR_W,
  applyMat3,
  homographyW,
  invertMat3,
  mat3FromMat2D,
  mat3Multiply,
  mat3ScaleAt,
  projectedBounds,
} from '../geometry/Perspective'
import {
  is3dAffected,
  isPreserve3d,
  nodeMapping,
  paintOrder,
  planeHomography,
} from './Scene3D'
import {
  isContainer,
  hasStyle,
  isMaskGroup,
  transform3dOf,
  usesOwnBox,
  type DesignDocument,
  type DesignNode,
  type Guide,
  type NodeId,
  type Style,
} from './types'

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

// Composed in Transforms.ts so Scene3D can use it without importing this file.
export { localMatrix, nodeLocalMatrix }

/**
 * Per-pass memo for world matrices.
 *
 * A world matrix depends on every ancestor, so it cannot be cached on the node
 * itself. Callers create one cache per render or hit-test pass; walking 1000
 * nodes then costs one multiply each instead of one per level of depth.
 */
export interface MatrixCache {
  world(doc: DesignDocument, id: NodeId): Mat2D
  clear(): void
}

export function createMatrixCache(): MatrixCache {
  const cache = new Map<NodeId, Mat2D>()
  return {
    world(doc, id) {
      const hit = cache.get(id)
      if (hit) return hit
      const node = doc.nodes[id]
      if (!node) return IDENTITY
      const local = nodeLocalMatrix(node)
      const m =
        node.parentId && doc.nodes[node.parentId]
          ? multiply(this.world(doc, node.parentId), local)
          : local
      cache.set(id, m)
      return m
    },
    clear() {
      cache.clear()
    },
  }
}

/** World matrix without a cache. Fine for one-off queries. */
export function worldMatrix(doc: DesignDocument, id: NodeId): Mat2D {
  const node = doc.nodes[id]
  if (!node) return IDENTITY
  const local = nodeLocalMatrix(node)
  if (!node.parentId || !doc.nodes[node.parentId]) return local
  return multiply(worldMatrix(doc, node.parentId), local)
}

/** Matrix of the node's parent, i.e. the space its x/y are expressed in. */
export function parentMatrix(doc: DesignDocument, id: NodeId): Mat2D {
  const node = doc.nodes[id]
  if (!node?.parentId) return IDENTITY
  return worldMatrix(doc, node.parentId)
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * A node's outline as SVG path data in LOCAL space.
 * Returns null for nodes with no path representation (text, and containers),
 * which fall back to box-based bounds and hit testing.
 */
export function nodePathData(node: DesignNode): string | null {
  const { width, height } = node.transform
  switch (node.type) {
    case 'rect':
      return rectPath(width, height, node.cornerRadius)
    case 'ellipse':
      return ellipsePath(width, height)
    case 'polygon':
      return polygonStarPath(width, height, node.sides, node.starRatio, node.cornerRadius)
    case 'line':
      return linePath(node.x1, node.y1, node.x2, node.y2)
    case 'path':
      return node.d
    case 'image':
      return rectPath(width, height, node.cornerRadius)
    case 'svg':
    case 'text':
    case 'artboard':
    case 'repeat-grid':
      return rectPath(width, height, 0)
    default:
      return null
  }
}

/**
 * Every outline a mask contributes, in the masked group's coordinate space.
 *
 * A mask that is itself a group clips as the UNION of everything inside it —
 * SVG's <clipPath> may hold several shapes. Asking `nodePathData` for a group
 * returns its bounding box, so a two-shape clip would silently become a
 * rectangle covering both; this walks to the leaves instead.
 */
export function maskOutlines(
  doc: DesignDocument,
  maskId: NodeId,
  base: Mat2D = IDENTITY,
): Array<{ d: string; m: Mat2D }> {
  const node = doc.nodes[maskId]
  if (!node || !node.visible) return []
  const m = multiply(base, localMatrix(node.transform))

  if (isContainer(node)) {
    return node.children.flatMap((child) => maskOutlines(doc, child, m))
  }
  const d = nodePathData(node)
  return d ? [{ d, m }] : []
}

/** The node's own box in local space. */
export function localBox(node: DesignNode): Bounds {
  return { x: 0, y: 0, width: node.transform.width, height: node.transform.height }
}

/**
 * Exact fill outline in local space. For paths this solves the cubic extrema
 * rather than using the control-point hull, so a shallow curve is not
 * over-reported.
 */
export function localGeometryBounds(node: DesignNode): Bounds {
  if (node.type === 'path') return pathBounds(node.d)
  if (node.type === 'line') {
    const x = Math.min(node.x1, node.x2)
    const y = Math.min(node.y1, node.y2)
    return { x, y, width: Math.abs(node.x2 - node.x1), height: Math.abs(node.y2 - node.y1) }
  }
  return localBox(node)
}

/**
 * A node's own box in its LOCAL space, with a group measured by its contents.
 *
 * A group's stored width and height are written once, when it is formed, and
 * never refitted — move a child afterwards and the box no longer describes the
 * artwork. Everything that reasons about where a group actually is already goes
 * through geometryBounds, which unions the children; this is the same answer in
 * the group's own space, for the two callers that need it there: the selection
 * frame, and the resize that divides by it.
 *
 * A mask group is measured by its mask, as geometryBounds measures it: only
 * what the mask reveals is on screen. Measured by its contents, a group holding
 * a masked photograph was framed — and resized — by the whole photograph,
 * cropped part and all.
 */
export function localContentBox(doc: DesignDocument, node: DesignNode): Bounds {
  if (isContainer(node) && !usesOwnBox(node)) {
    const mask = isMaskGroup(node) ? doc.nodes[node.maskId] : undefined
    if (mask) return transformBounds(localContentBox(doc, mask), nodeLocalMatrix(mask))
    const kids: Bounds[] = []
    for (const id of node.children) {
      const child = doc.nodes[id]
      if (!child) continue
      const b = transformBounds(localContentBox(doc, child), nodeLocalMatrix(child))
      if (b.width > 0 || b.height > 0) kids.push(b)
    }
    return kids.length ? unionAll(kids) : localBox(node)
  }
  return localGeometryBounds(node)
}

/** How far the stroke reaches past the fill, honoring miter limit and cap. */
export function strokePadding(node: DesignNode): number {
  if (!hasStyle(node)) return 0
  const s = node.style.stroke
  if (s.paint.type === 'none' || s.width <= 0) return 0
  // An inner-aligned stroke never leaves the fill outline.
  if (s.align === 'inner') return 0
  const full = strokeInflate(s.width, s.join, s.cap, s.miterLimit)
  return s.align === 'outer' ? full * 2 : full
}

/**
 * Geometry bounds in world space — the fill outline only.
 * This is what align/distribute and the selection frame use, matching XD.
 */
export function geometryBounds(
  doc: DesignDocument,
  id: NodeId,
  cache?: MatrixCache,
): Bounds {
  const node = doc.nodes[id]
  if (!node) return EMPTY_BOUNDS

  if (isContainer(node) && !usesOwnBox(node)) {
    // A mask group only shows what its mask lets through, so its bounds are the
    // mask's. The union of the content would frame artwork that is hidden, and
    // the selection rectangle would not match anything visible on screen.
    if (isMaskGroup(node) && doc.nodes[node.maskId]) {
      return geometryBounds(doc, node.maskId, cache)
    }
    // A group's bounds are its children's, not its own nominal box. An artboard
    // or repeat grid uses its own box instead — see usesOwnBox.
    const kids = node.children
      .map((k) => geometryBounds(doc, k, cache))
      .filter((b) => b.width > 0 || b.height > 0)
    return kids.length ? unionAll(kids) : boxInWorld(doc, id, localBox(node), cache)
  }
  return boxInWorld(doc, id, localGeometryBounds(node), cache)
}

/**
 * The world bounds of a box in a node's local space.
 *
 * Through the camera for anything drawn in perspective: a tilted card's frame
 * is the bounds of the trapezoid on screen, not of the rectangle it would be
 * flat. Lines project to lines, so a box's four projected corners are exact.
 */
function boxInWorld(doc: DesignDocument, id: NodeId, box: Bounds, cache?: MatrixCache): Bounds {
  if (is3dAffected(doc, id)) {
    return projectedBounds(nodeMapping(doc, id).toWorld, box) ?? EMPTY_BOUNDS
  }
  return transformBounds(box, cache ? cache.world(doc, id) : worldMatrix(doc, id))
}

/**
 * A node's projected geometry, bounded in a given frame rather than the world.
 *
 * What a 3D object's selection box is drawn from: the frame is the space of
 * the object that owns the camera (Scene3D.frameMatrix), so the box turns with
 * that object's 2D rotation exactly as a flat object's does, while still
 * enclosing the trapezoid on screen. `liveBox` supplies a resize's in-flight
 * box, which the document has not been told about.
 */
export function frameBounds(
  doc: DesignDocument,
  id: NodeId,
  frame: Mat2D,
  liveBox?: (id: NodeId) => Bounds | undefined,
): Bounds | null {
  const toFrame = mat3FromMat2D(invert(frame))
  const boxes: Bounds[] = []
  const visit = (nid: NodeId) => {
    const node = doc.nodes[nid]
    if (!node || !node.visible) return
    if (isContainer(node) && !usesOwnBox(node)) {
      // A mask group only shows what its mask lets through.
      if (isMaskGroup(node) && doc.nodes[node.maskId]) return visit(node.maskId)
      const before = boxes.length
      for (const c of node.children) visit(c)
      if (boxes.length > before) return
    }
    const box = liveBox?.(nid) ?? localGeometryBounds(node)
    const b = projectedBounds(mat3Multiply(toFrame, nodeMapping(doc, nid).toWorld), box)
    if (b) boxes.push(b)
  }
  visit(id)
  return boxes.length ? unionAll(boxes) : null
}

/**
 * Render bounds in world space — geometry inflated by stroke.
 *
 * Export crops to this. Using geometry bounds instead is what slices strokes in
 * half at the edge of an exported PNG. Note the order: inflate in local space,
 * then transform, because AABB(M·box) != M·AABB(box) under rotation.
 */
export function renderBounds(doc: DesignDocument, id: NodeId, cache?: MatrixCache): Bounds {
  const node = doc.nodes[id]
  if (!node) return EMPTY_BOUNDS

  if (isContainer(node) && !usesOwnBox(node)) {
    const kids = node.children
      // A mask is not painted, so it contributes nothing of its own here.
      .filter((k) => !isMaskGroup(node) || k !== node.maskId)
      .map((k) => renderBounds(doc, k, cache))
      .filter((b) => b.width > 0 || b.height > 0)
    const box = kids.length ? unionAll(kids) : boxInWorld(doc, id, localBox(node), cache)

    // Nothing outside the mask is drawn, so nothing outside it counts. Without
    // this the box covers artwork the clip hides — and since this is what the
    // exporter crops to and what zoom-to-fit frames, a masked drawing exported
    // wider than itself, scaling everything down to fit a margin of nothing.
    if (isMaskGroup(node) && doc.nodes[node.maskId]) {
      const clip = renderBounds(doc, node.maskId, cache)
      if (clip.width > 0 || clip.height > 0) return intersection(box, clip) ?? EMPTY_BOUNDS
    }
    return box
  }

  const local = localGeometryBounds(node)
  const pad = strokePadding(node)
  const inflated =
    pad > 0
      ? { x: local.x - pad, y: local.y - pad, width: local.width + pad * 2, height: local.height + pad * 2 }
      : local
  return boxInWorld(doc, id, inflated, cache)
}

/**
 * How far a node's own drop shadow and object blur can paint past its box.
 *
 * The same generous reach canvas/effects.ts gives a filter region, restated
 * here because the document layer may not import the canvas: a mesh that
 * stopped short of a shadow would crop it. The inner shadow is left out: the
 * filter needs room to work it out, but it paints nothing past the shape.
 */
function effectReach(style: Style): number {
  const shadow = style.shadow?.visible ? style.shadow : null
  const blur = style.blur?.visible && style.blur.kind === 'object' && style.blur.amount > 0 ? style.blur : null
  if (!shadow && !blur) return 0
  return (blur ? blur.amount : 0) +
    (shadow ? shadow.blur + Math.abs(shadow.x) + Math.abs(shadow.y) : 0) +
    style.stroke.width + 8
}

function inflateBy(b: Bounds, pad: number): Bounds {
  return pad > 0 ? { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 } : b
}

/**
 * Everything a node draws, in its local space, as it would be drawn FLAT.
 *
 * Geometry, stroke, and every descendant's effects; the node's own effects
 * only when asked, because a 3D object's own shadow is applied to its
 * projected picture rather than inside it. This is the region a tilted
 * object's mesh has to cover — anything outside it is not drawn.
 *
 * A 3D object inside the node is measured through its own camera, since that
 * is how it is drawn into the flat picture.
 */
export function flatRenderBox(
  doc: DesignDocument,
  node: DesignNode,
  includeOwnEffects = true,
): Bounds {
  const own = includeOwnEffects && hasStyle(node) ? effectReach(node.style) : 0

  if (isContainer(node) && !usesOwnBox(node)) {
    const kids: Bounds[] = []
    for (const id of node.children) {
      const child = doc.nodes[id]
      if (!child || !child.visible) continue
      if (isMaskGroup(node) && id === node.maskId) continue
      const b = transformBounds(drawnBox(doc, child), nodeLocalMatrix(child))
      if (b.width > 0 || b.height > 0) kids.push(b)
    }
    let box = kids.length ? unionAll(kids) : localBox(node)
    // Nothing outside a mask is drawn.
    const mask = isMaskGroup(node) ? doc.nodes[node.maskId] : undefined
    if (mask) {
      const clip = transformBounds(localContentBox(doc, mask), nodeLocalMatrix(mask))
      box = intersection(box, clip) ?? box
    }
    return inflateBy(box, own)
  }
  return inflateBy(inflateBy(localGeometryBounds(node), strokePadding(node)), own)
}

/**
 * What a node draws in its local space, through its own camera if it has one:
 * the bounds of its projected picture, which is what its parent sees.
 */
function drawnBox(doc: DesignDocument, node: DesignNode): Bounds {
  if (!transform3dOf(node)) return flatRenderBox(doc, node)
  if (isPreserve3d(doc, node.id)) {
    // A shared space is a set of planes, each projected by the one camera.
    const planes: Bounds[] = []
    const visit = (id: NodeId) => {
      const n = doc.nodes[id]
      if (!n || !n.visible) return
      if (isPreserve3d(doc, id) && isContainer(n)) {
        for (const c of n.children) visit(c)
        return
      }
      const h = planeHomography(doc, id)
      const b = h ? projectedBounds(h, flatRenderBox(doc, n)) : null
      // The plane homography lands in the ROOT's local space already.
      if (b) planes.push(b)
    }
    if (isContainer(node)) for (const c of node.children) visit(c)
    return planes.length ? unionAll(planes) : localBox(node)
  }
  const h = planeHomography(doc, node.id)
  return (h && projectedBounds(h, flatRenderBox(doc, node))) ?? localBox(node)
}

/** Union of geometry bounds across several nodes. */
export function boundsOfNodes(
  doc: DesignDocument,
  ids: readonly NodeId[],
  cache?: MatrixCache,
): Bounds {
  return unionAll(ids.map((id) => geometryBounds(doc, id, cache)))
}

export function renderBoundsOfNodes(
  doc: DesignDocument,
  ids: readonly NodeId[],
  cache?: MatrixCache,
): Bounds {
  return unionAll(ids.map((id) => renderBounds(doc, id, cache)))
}

// ---------------------------------------------------------------------------
// Traversal
// ---------------------------------------------------------------------------

export function getNode(doc: DesignDocument, id: NodeId | null | undefined): DesignNode | undefined {
  return id ? doc.nodes[id] : undefined
}

export function childrenOf(doc: DesignDocument, id: NodeId): DesignNode[] {
  const node = doc.nodes[id]
  if (!isContainer(node)) return []
  return node.children.map((c) => doc.nodes[c]).filter((n): n is DesignNode => !!n)
}

/** Ancestor ids from immediate parent up to the root. */
export function ancestorIds(doc: DesignDocument, id: NodeId): NodeId[] {
  const out: NodeId[] = []
  let cur = doc.nodes[id]?.parentId
  const seen = new Set<NodeId>()
  while (cur && doc.nodes[cur] && !seen.has(cur)) {
    seen.add(cur)
    out.push(cur)
    cur = doc.nodes[cur]!.parentId
  }
  return out
}

/** All descendant ids, depth-first, excluding the node itself. */
export function descendantIds(doc: DesignDocument, id: NodeId): NodeId[] {
  const out: NodeId[] = []
  const stack = [...(isContainer(doc.nodes[id]) ? (doc.nodes[id] as { children: NodeId[] }).children : [])]
  while (stack.length) {
    const cur = stack.pop()!
    const node = doc.nodes[cur]
    if (!node) continue
    out.push(cur)
    if (isContainer(node)) stack.push(...node.children)
  }
  return out
}

export function isAncestorOf(doc: DesignDocument, ancestor: NodeId, node: NodeId): boolean {
  return ancestorIds(doc, node).includes(ancestor)
}

/** The artboard a node belongs to, if any. */
export function artboardOf(doc: DesignDocument, id: NodeId): NodeId | null {
  if (doc.nodes[id]?.type === 'artboard') return id
  for (const a of ancestorIds(doc, id)) {
    if (doc.nodes[a]?.type === 'artboard') return a
  }
  return null
}

export function artboardIds(doc: DesignDocument): NodeId[] {
  const root = doc.nodes[doc.rootId]
  if (!isContainer(root)) return []
  return root.children.filter((c) => doc.nodes[c]?.type === 'artboard')
}

/** Depth-first walk in document order (back to front). */
export function walk(
  doc: DesignDocument,
  id: NodeId,
  visit: (node: DesignNode, depth: number) => void | false,
  depth = 0,
): void {
  const node = doc.nodes[id]
  if (!node) return
  if (visit(node, depth) === false) return
  if (isContainer(node)) {
    for (const child of node.children) walk(doc, child, visit, depth + 1)
  }
}

/**
 * Effective visibility — a node inside a hidden group is itself not rendered.
 * Hidden nodes must also be unselectable on canvas, so hit testing consults this.
 */
export function isEffectivelyVisible(doc: DesignDocument, id: NodeId): boolean {
  if (!doc.nodes[id]?.visible) return false
  return ancestorIds(doc, id).every((a) => doc.nodes[a]?.visible !== false)
}

/**
 * Effective lock state — locking a group locks everything inside it.
 * Locked nodes still render and can be picked in the Layers panel, but the
 * canvas refuses to transform them.
 */
export function isEffectivelyLocked(doc: DesignDocument, id: NodeId): boolean {
  if (doc.nodes[id]?.locked) return true
  return ancestorIds(doc, id).some((a) => doc.nodes[a]?.locked === true)
}

export function indexInParent(doc: DesignDocument, id: NodeId): number {
  const parent = doc.nodes[id]?.parentId
  if (!parent) return -1
  const p = doc.nodes[parent]
  return isContainer(p) ? p.children.indexOf(id) : -1
}

/**
 * Depth-first index used to compare paint order between arbitrary nodes.
 * Later in document order = painted on top.
 */
export function paintOrderIndex(doc: DesignDocument, id: NodeId): number {
  let counter = 0
  let found = -1
  walk(doc, doc.rootId, (node) => {
    if (node.id === id) found = counter
    counter++
    return undefined
  })
  return found
}

/**
 * Every guide in the document, in WORLD space, with the artboard it came from.
 *
 * Guides are authored in an artboard's local space so they travel with it, but
 * snapping and hit-testing both work in world space — so the conversion lives
 * here rather than being repeated at each call site.
 */
export function worldGuides(
  doc: DesignDocument,
  cache?: MatrixCache,
): Array<{ artboardId: NodeId; guide: Guide; position: number }> {
  const mc = cache ?? createMatrixCache()
  const out: Array<{ artboardId: NodeId; guide: Guide; position: number }> = []
  for (const id of artboardIds(doc)) {
    const node = doc.nodes[id]
    if (!node || node.type !== 'artboard' || !node.guides?.length) continue
    const m = mc.world(doc, id)
    for (const guide of node.guides) {
      // Only the guide's own axis matters: the other coordinate is arbitrary,
      // since the line spans the artboard.
      const p = applyToPoint(m, {
        x: guide.axis === 'x' ? guide.position : 0,
        y: guide.axis === 'y' ? guide.position : 0,
      })
      out.push({ artboardId: id, guide, position: guide.axis === 'x' ? p.x : p.y })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

export interface HitTestOptions {
  /** Extra slack in world units, normally screen tolerance / zoom. */
  tolerance?: number
  /**
   * Let an artboard's own background register as a hit. Off by default: a
   * canvas drag starting on empty artboard space must rubber-band select, not
   * pick up and move the whole artboard. Artboards are selected by their label
   * or in the Layers panel, which is how every tool with artboards behaves.
   */
  includeArtboards?: boolean
  /** Ignore fill and only hit strokes — matches clicking an unfilled shape. */
  strokeOnly?: boolean
  /** Return the deepest node rather than the outermost group. */
  deep?: boolean
  /** Nodes to skip entirely. */
  skip?: ReadonlySet<NodeId>
  /** When set, only nodes inside this container are considered. */
  within?: NodeId
}

/** Does the point fall on this specific node (ignoring children)? */
export function hitTestNode(
  doc: DesignDocument,
  id: NodeId,
  worldPoint: Vec2,
  options: HitTestOptions = {},
  cache?: MatrixCache,
): boolean {
  const node = doc.nodes[id]
  if (!node) return false
  const where = pointInLocal(doc, id, worldPoint, cache)
  if (!where) return false
  const local = where.point
  // The tolerance arrives in WORLD units and everything below compares it
  // against LOCAL geometry, which is a different distance the moment a node —
  // or any group above it — is scaled. Converting it here is what makes a
  // click target the same size on screen wherever the object sits and whatever
  // the zoom, rather than growing with both.
  const tolerance = (options.tolerance ?? 0) / (where.scale || 1)

  const d = nodePathData(node)
  if (!d) return containsPoint(localBox(node), local, tolerance)

  const styled = hasStyle(node) ? node : null
  const hasFill = !!styled && styled.style.fill.type !== 'none' && !options.strokeOnly
  // How far the stroke reaches from the path, which is not always half its
  // width: an inner or outer stroke is drawn at double width against a clip or
  // a mask, so the paint lands a FULL width to one side. Taking half of it
  // there leaves the outer half of a visible line unclickable — you click what
  // you can see and nothing happens, which is worse the wider the stroke and so
  // worse the further in the view is zoomed.
  const strokeW =
    styled && styled.style.stroke.paint.type !== 'none'
      ? styled.style.stroke.width * (styled.style.stroke.align === 'center' ? 1 : 2)
      : 0

  // Text and images are solid targets regardless of fill.
  if (
    node.type === 'text' ||
    node.type === 'image' ||
    node.type === 'svg' ||
    node.type === 'repeat-grid'
  ) {
    return containsPoint(localGeometryBounds(node), local, tolerance)
  }

  if (hasFill && pointInPath(d, local, styled!.style.fillRule)) return true
  // A floor, so a caller that asks for no tolerance can still hit a hairline —
  // but a small one, in the same local units as everything else. The 2 world
  // units this used to be made a line at 800% selectable from sixteen pixels
  // away, and one at 25% from barely two.
  if (pointOnStroke(d, local, strokeW, Math.max(tolerance, 0.5))) return true

  // An unfilled, unstroked shape would otherwise be impossible to click.
  if (!hasFill && strokeW === 0) return pointInPath(d, local, 'nonzero')
  return false
}

/**
 * A world point in a node's local space, with how many world units one local
 * unit spans there — or null when the point is not on anything the node can
 * draw.
 *
 * For a node in perspective this runs the projection backwards, which is what
 * makes a click land on the tilted card rather than on the rectangle it would
 * be flat: a point inside that rectangle but outside the trapezoid on screen
 * maps outside the card, and misses. A point that maps from behind the camera
 * is not on the object at all, whatever the algebra says.
 */
export function pointInLocal(
  doc: DesignDocument,
  id: NodeId,
  worldPoint: Vec2,
  cache?: MatrixCache,
): { point: Vec2; scale: number } | null {
  if (is3dAffected(doc, id)) {
    const h = nodeMapping(doc, id).toWorld
    const inv = invertMat3(h)
    if (!inv) return null
    const q = applyMat3(inv, worldPoint.x, worldPoint.y)
    if (!Number.isFinite(q.x) || !Number.isFinite(q.y)) return null
    if (homographyW(h, q.x, q.y) < NEAR_W) return null
    return { point: { x: q.x, y: q.y }, scale: mat3ScaleAt(h, q.x, q.y) }
  }
  const m = cache ? cache.world(doc, id) : worldMatrix(doc, id)
  return { point: applyToPoint(invert(m), worldPoint), scale: meanScale(m) || 1 }
}

interface HitCandidate {
  id: NodeId
  order: number
}

/**
 * Topmost visible, unlocked node under the point.
 *
 * Walks in document order collecting every hit, then returns the last one — the
 * one painted on top. `deep` controls whether a hit inside a group resolves to
 * the group (normal click) or the child itself (click while inside the group).
 */
export function hitTest(
  doc: DesignDocument,
  worldPoint: Vec2,
  options: HitTestOptions = {},
  cache?: MatrixCache,
): NodeId | null {
  const hits = hitTestAll(doc, worldPoint, options, cache)
  return hits.length ? hits[hits.length - 1]! : null
}

/**
 * The topmost artboard containing a point, or null for bare pasteboard.
 *
 * One definition, shared by everything that has to answer "which artboard is
 * here": where a drawn or dropped object is parented, which artboard a
 * right-click acts on, and what a file drag highlights. Topmost, matching paint
 * order — the same one a click would have resolved to.
 */
export function artboardAtPoint(doc: DesignDocument, point: Vec2): NodeId | null {
  const cache = createMatrixCache()
  const boards = artboardIds(doc)
  for (let i = boards.length - 1; i >= 0; i--) {
    const id = boards[i]!
    if (doc.nodes[id]?.visible === false) continue
    if (containsPoint(geometryBounds(doc, id, cache), point)) return id
  }
  return null
}

/**
 * Locked or hidden nodes under a point, topmost first.
 *
 * Deliberately the one hit test that ignores both filters, because it exists to
 * answer the question those filters make unanswerable: a locked object takes no
 * pointer events and a hidden one is not drawn at all, so right-clicking either
 * finds bare canvas and there is no way back to it except the Layers panel.
 *
 * What comes back is the OUTERMOST node actually carrying the flag — locking a
 * group locks its children by inheritance, and offering to unlock a child that
 * is not itself locked would do nothing visible.
 */
export function blockedNodesAt(
  doc: DesignDocument,
  worldPoint: Vec2,
  options: { tolerance?: number } = {},
): Array<{ id: NodeId; locked: boolean; hidden: boolean }> {
  const cache = createMatrixCache()
  const out: Array<{ id: NodeId; locked: boolean; hidden: boolean }> = []
  const seen = new Set<NodeId>()

  const visit = (id: NodeId): void => {
    const node = doc.nodes[id]
    if (!node) return

    if (isContainer(node) && node.type !== 'repeat-grid') {
      for (const child of paintOrder(doc, id)) visit(child)
      // A container is a candidate in its own right when the point is inside
      // it: a hidden group has no children on screen to hit.
      if (node.type === 'artboard') return
    }

    const hit =
      isContainer(node) && node.type !== 'repeat-grid'
        ? containsPoint(geometryBounds(doc, id, cache), worldPoint, options.tolerance ?? 0)
        : hitTestNode(doc, id, worldPoint, { ...options, includeArtboards: true }, cache)
    if (!hit) return

    // Walk out to whatever is actually carrying the flag.
    const chain = [id, ...ancestorIds(doc, id)]
    const lockedAt = chain.find((a) => doc.nodes[a]?.locked)
    const hiddenAt = chain.find((a) => doc.nodes[a]?.visible === false)
    for (const [owner, locked] of [
      [lockedAt, true],
      [hiddenAt, false],
    ] as const) {
      if (!owner || doc.nodes[owner]?.type === 'document') continue
      const key = `${owner}:${locked}`
      if (seen.has(key)) continue
      seen.add(key)
      const existing = out.find((o) => o.id === owner)
      if (existing) {
        if (locked) existing.locked = true
        else existing.hidden = true
      } else {
        out.push({ id: owner, locked, hidden: !locked })
      }
    }
  }

  const root = doc.nodes[doc.rootId]
  if (isContainer(root)) for (const child of paintOrder(doc, root.id)) visit(child)
  // Topmost first: paint order, reversed.
  return out.reverse()
}

/** Every node under the point, bottom-to-top. Backs alt-click cycling. */
export function hitTestAll(
  doc: DesignDocument,
  worldPoint: Vec2,
  options: HitTestOptions = {},
  cache?: MatrixCache,
): NodeId[] {
  const mc = cache ?? createMatrixCache()
  const out: HitCandidate[] = []
  let order = 0
  const rootId = options.within ?? doc.rootId

  const visit = (id: NodeId, topLevelAncestor: NodeId | null): void => {
    const node = doc.nodes[id]
    if (!node) return
    if (!node.visible) return
    if (options.skip?.has(id)) return

    if (node.type === 'repeat-grid') {
      // The grid is a single object on canvas: clicking a cell selects the
      // grid, not the source child inside it.
      if (hitTestNode(doc, id, worldPoint, options, mc)) {
        const resolved = options.deep ? id : (topLevelAncestor ?? id)
        if (!isEffectivelyLocked(doc, resolved)) out.push({ id: resolved, order: order++ })
      }
      return
    }

    if (isContainer(node)) {
      const before = out.length
      // Nothing outside a mask is on screen, so nothing outside it is
      // clickable either — otherwise a shape would still be pickable in the
      // region the mask hides it.
      if (isMaskGroup(node) && !hitTestNode(doc, node.maskId, worldPoint, options, mc)) return
      // Clicking a shape should select the outermost GROUP that contains it —
      // that is what makes a group behave like one object. An artboard is not a
      // group though: it is a frame, and clicking artwork on it must select the
      // artwork. So descending into an artboard resets the ancestor chain.
      const childAncestor = (child: NodeId): NodeId | null => {
        if (options.deep) return null
        // An artboard is a frame, not a group, so the chain restarts at its
        // child rather than continuing through it — but it does restart.
        // Returning null instead left the artboard's own children unseeded, so
        // a click resolved one level too deep: the leaf for a single group, and
        // the INNER group for nested ones, which is the opposite of treating a
        // group as one object.
        if (node.type === 'artboard') return child
        return topLevelAncestor ?? child
      }
      // In PAINT order, which a 3D depth can reorder: the card drawn in front
      // is the one a click lands on, whatever the layer order says.
      for (const child of paintOrder(doc, id)) {
        // The mask itself is not painted, so it is not a target: clicking
        // inside a mask group selects what it reveals, not the mask.
        if (isMaskGroup(node) && child === node.maskId) continue
        visit(child, childAncestor(child))
      }
      // An artboard is only a hit when nothing inside it was hit. Adding it
      // unconditionally would make it the topmost candidate over its own
      // children, so every click on a shape would select the whole artboard.
      if (
        node.type === 'artboard' &&
        options.includeArtboards === true &&
        out.length === before &&
        hitTestNode(doc, id, worldPoint, options, mc)
      ) {
        out.push({ id, order: order++ })
      }
      return
    }

    if (hitTestNode(doc, id, worldPoint, options, mc)) {
      const resolved = options.deep ? id : (topLevelAncestor ?? id)
      if (!isEffectivelyLocked(doc, resolved)) out.push({ id: resolved, order: order++ })
    }
  }

  const root = doc.nodes[rootId]
  if (isContainer(root)) {
    for (const child of paintOrder(doc, rootId)) visit(child, options.deep ? null : child)
  } else if (root) {
    visit(rootId, null)
  }

  // De-dupe while keeping paint order.
  const seen = new Set<NodeId>()
  const result: NodeId[] = []
  for (const h of out) {
    if (seen.has(h.id)) continue
    seen.add(h.id)
    result.push(h.id)
  }
  return result
}

/**
 * Marquee selection.
 * @param crossing true selects anything touching the box; false requires full containment.
 */
export function nodesInBounds(
  doc: DesignDocument,
  box: Bounds,
  options: { crossing?: boolean; deep?: boolean; within?: NodeId } = {},
  cache?: MatrixCache,
): NodeId[] {
  const mc = cache ?? createMatrixCache()
  const out: NodeId[] = []
  const rootId = options.within ?? doc.rootId

  const test = (id: NodeId): boolean => {
    const b = geometryBounds(doc, id, mc)
    if (b.width === 0 && b.height === 0) return false
    if (!options.crossing) {
      return (
        b.x >= box.x &&
        b.y >= box.y &&
        b.x + b.width <= box.x + box.width &&
        b.y + b.height <= box.y + box.height
      )
    }
    if (!intersects(b, box)) return false
    // Crossing mode: a rotated shape's AABB can overlap while the shape does not.
    const node = doc.nodes[id]
    const d = node ? nodePathData(node) : null
    if (!d || !node) return true
    const worldCorners = [
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y },
      { x: box.x + box.width, y: box.y + box.height },
      { x: box.x, y: box.y + box.height },
    ]
    // Through the projection, backwards, for a node in perspective. A corner
    // that has no preimage leaves the answer at "the boxes overlap", which is
    // the conservative one.
    const localBoxPts = worldCorners.map((c) => pointInLocal(doc, id, c, mc)?.point ?? null)
    if (localBoxPts.some((p) => p === null)) return true
    const pts = localBoxPts as Vec2[]
    const lx = Math.min(...pts.map((p) => p.x))
    const ly = Math.min(...pts.map((p) => p.y))
    const lw = Math.max(...pts.map((p) => p.x)) - lx
    const lh = Math.max(...pts.map((p) => p.y)) - ly
    return pathOverlapsBounds(
      d,
      { x: lx, y: ly, width: lw, height: lh },
      hasStyle(node) ? node.style.fillRule : 'nonzero',
    )
  }

  const visit = (id: NodeId): void => {
    const node = doc.nodes[id]
    if (!node || !node.visible || isEffectivelyLocked(doc, id)) return
    if (node.type === 'artboard') {
      for (const child of node.children) visit(child)
      return
    }
    if (options.deep && isContainer(node)) {
      for (const child of node.children) visit(child)
      return
    }
    if (test(id)) out.push(id)
  }

  const root = doc.nodes[rootId]
  if (isContainer(root)) for (const child of root.children) visit(child)
  return out
}

/** Combined bounds of everything in the document — backs "zoom to fit". */
export function documentBounds(doc: DesignDocument): Bounds {
  const root = doc.nodes[doc.rootId]
  if (!isContainer(root) || root.children.length === 0) return EMPTY_BOUNDS
  const cache = createMatrixCache()
  let out: Bounds | null = null
  for (const child of root.children) {
    const b = renderBounds(doc, child, cache)
    if (b.width === 0 && b.height === 0) continue
    out = out ? union(out, b) : b
  }
  return out ?? EMPTY_BOUNDS
}
