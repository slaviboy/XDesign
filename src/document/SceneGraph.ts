/**
 * Scene graph queries: transforms, bounds, traversal and hit testing.
 *
 * All pure functions over a DesignDocument. DOM-free, so every one of these is
 * directly testable in node — which matters most for hit testing, where the
 * browser's own answer (elementFromPoint) is not available to the geometry layer
 * and would not agree with a rotated group anyway.
 */

import {
  compose,
  invert,
  applyToPoint,
  multiply,
  rotation,
  scaling,
  skewing,
  translation,
  IDENTITY,
  type Mat2D,
  type Vec2,
} from '../geometry/Matrix'
import {
  EMPTY_BOUNDS,
  transformBounds,
  union,
  unionAll,
  containsPoint,
  intersects,
  type Bounds,
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
  isContainer,
  hasStyle,
  isMaskGroup,
  usesOwnBox,
  type DesignDocument,
  type DesignNode,
  type Guide,
  type NodeId,
  type Transform,
} from './types'

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

/**
 * A node's local -> parent matrix.
 *
 * Composed as T(x,y) · T(c) · R · K · S · T(-c), where c is the transform origin
 * in local units. Rotation and scale therefore happen about the origin point and
 * the node's `x,y` still means "where the local (0,0) corner lands", which keeps
 * the inspector's X/Y readouts stable under rotation.
 */
export function localMatrix(t: Transform): Mat2D {
  const cx = t.originX * t.width
  const cy = t.originY * t.height
  return compose(
    translation(-cx, -cy),
    scaling(t.scaleX, t.scaleY),
    skewing(t.skewX, t.skewY),
    rotation(t.rotation),
    translation(cx, cy),
    translation(t.x, t.y),
  )
}

export function nodeLocalMatrix(node: DesignNode): Mat2D {
  return localMatrix(node.transform)
}

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
  const m = cache ? cache.world(doc, id) : worldMatrix(doc, id)

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
    return kids.length ? unionAll(kids) : transformBounds(localBox(node), m)
  }
  return transformBounds(localGeometryBounds(node), m)
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
  const m = cache ? cache.world(doc, id) : worldMatrix(doc, id)

  if (isContainer(node) && !usesOwnBox(node)) {
    const kids = node.children
      .map((k) => renderBounds(doc, k, cache))
      .filter((b) => b.width > 0 || b.height > 0)
    return kids.length ? unionAll(kids) : transformBounds(localBox(node), m)
  }

  const local = localGeometryBounds(node)
  const pad = strokePadding(node)
  const inflated =
    pad > 0
      ? { x: local.x - pad, y: local.y - pad, width: local.width + pad * 2, height: local.height + pad * 2 }
      : local
  return transformBounds(inflated, m)
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
  const m = cache ? cache.world(doc, id) : worldMatrix(doc, id)
  const local = applyToPoint(invert(m), worldPoint)
  const tolerance = options.tolerance ?? 0

  const d = nodePathData(node)
  if (!d) return containsPoint(localBox(node), local, tolerance)

  const styled = hasStyle(node) ? node : null
  const hasFill = !!styled && styled.style.fill.type !== 'none' && !options.strokeOnly
  const strokeW =
    styled && styled.style.stroke.paint.type !== 'none' ? styled.style.stroke.width : 0

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
  if (pointOnStroke(d, local, strokeW, Math.max(tolerance, 2))) return true

  // An unfilled, unstroked shape would otherwise be impossible to click.
  if (!hasFill && strokeW === 0) return pointInPath(d, local, 'nonzero')
  return false
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
        if (node.type === 'artboard') return null
        return topLevelAncestor ?? child
      }
      for (const child of node.children) {
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
    for (const child of root.children) visit(child, options.deep ? null : child)
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
    const inv = invert(mc.world(doc, id))
    const localBoxPts = [
      applyToPoint(inv, { x: box.x, y: box.y }),
      applyToPoint(inv, { x: box.x + box.width, y: box.y }),
      applyToPoint(inv, { x: box.x + box.width, y: box.y + box.height }),
      applyToPoint(inv, { x: box.x, y: box.y + box.height }),
    ]
    const lx = Math.min(...localBoxPts.map((p) => p.x))
    const ly = Math.min(...localBoxPts.map((p) => p.y))
    const lw = Math.max(...localBoxPts.map((p) => p.x)) - lx
    const lh = Math.max(...localBoxPts.map((p) => p.y)) - ly
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
