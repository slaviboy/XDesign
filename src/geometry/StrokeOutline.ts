/**
 * Stroke -> filled path. The geometry behind Outline Stroke.
 *
 * Adobe: "convert your path and border-based elements, like icons, into solid
 * vector shapes". What comes back is the region the stroke covers, as a path
 * that can be filled — so it scales, joins booleans, and takes a gradient like
 * any other shape.
 *
 * The method is the classic one: flatten to polylines, walk each side offset by
 * half the width, and insert a join at every vertex and a cap at every end. The
 * result is a single ring per open subpath, and an outer plus a REVERSED inner
 * ring per closed one — reversed so the nonzero rule reads it as a hole rather
 * than as solid.
 *
 * Where it is approximate, and why that is the right trade: offsetting a curve
 * exactly produces a curve of higher degree that cubics cannot represent, so
 * every tool flattens first. The tolerance is PathUtils' own, so an outlined
 * stroke is as smooth as everything else the editor draws.
 *
 * DOM-free, like the rest of geometry/.
 */

import { pathToPolylines, type LineCap, type LineJoin } from './PathUtils'
import type { Vec2 } from './Matrix'

export interface OutlineStrokeOptions {
  width: number
  cap: LineCap
  join: LineJoin
  miterLimit: number
  /** Where the stroke sits relative to the path, as in the Stroke section. */
  align: 'center' | 'inner' | 'outer'
}

/**
 * Segments a round join or cap is drawn with, per radian.
 *
 * Eight puts a vertex every ~7°, whose deviation from the true arc is 0.2% of
 * the radius — below what any zoom shows — and, being even over a half turn,
 * lands a vertex exactly on the far point of a cap so a round end reaches its
 * full width instead of falling a little short.
 */
const ARC_STEPS_PER_RADIAN = 8

/**
 * The area covered by stroking `d`, as a fillable path.
 *
 * Returns an empty string when there is nothing to outline — a zero width, or a
 * path with no length — so callers can treat "" as "nothing to do".
 */
export function outlineStroke(d: string, options: OutlineStrokeOptions): string {
  const width = Math.max(0, options.width)
  if (width <= 0) return ''

  // Alignment decides how the width straddles the path. Center is the SVG
  // default and the only one that is symmetric; inner and outer push the whole
  // width to one side, which is how the Stroke section already draws them.
  const half = width / 2
  const outer = options.align === 'inner' ? 0 : options.align === 'outer' ? width : half
  const inner = options.align === 'inner' ? width : options.align === 'outer' ? 0 : half

  const rings: string[] = []
  for (const poly of pathToPolylines(d)) {
    const points = dedupe(poly.points, poly.closed)
    if (points.length < 2) {
      // A degenerate subpath is a dot: it still paints under a round or square
      // cap, and painting nothing there would silently drop it.
      if (points.length === 1 && options.cap !== 'butt') {
        rings.push(dotRing(points[0]!, half, options.cap))
      }
      continue
    }

    if (poly.closed) {
      // Which way "outward" lies depends on how the subpath is wound: the left
      // normal points out of a counter-clockwise ring and into a clockwise one.
      // Without this, Inside and Outside swap over on half the shapes — and
      // which half is decided by how the path happened to be authored.
      const sign = signedArea(points) > 0 ? -1 : 1
      // Two rings of opposite winding: the outside of the stroke, and the
      // inside, which the nonzero rule then reads as a hole.
      rings.push(closedSide(points, outer * sign, options))
      rings.push(closedSide([...points].reverse(), inner * sign, options))
    } else {
      rings.push(openRing(points, outer, inner, options))
    }
  }

  return rings.filter(Boolean).join(' ')
}

// ---------------------------------------------------------------------------
// Rings
// ---------------------------------------------------------------------------

/** One side of a closed subpath, offset along its left normal by `distance`. */
function closedSide(points: Vec2[], distance: number, options: OutlineStrokeOptions): string {
  if (Math.abs(distance) < 1e-9) return ''
  const out: Vec2[] = []
  const n = points.length
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n]!
    const cur = points[i]!
    const next = points[(i + 1) % n]!
    pushJoin(out, prev, cur, next, distance, options)
  }
  return ringPath(out)
}

/**
 * An open subpath: down one side, round the end cap, back the other side, and
 * round the start cap. One closed ring.
 */
function openRing(
  points: Vec2[],
  outer: number,
  inner: number,
  options: OutlineStrokeOptions,
): string {
  const out: Vec2[] = []
  const forward = points
  const backward = [...points].reverse()

  side(out, forward, outer, options)
  cap(out, forward[forward.length - 2]!, forward[forward.length - 1]!, outer, inner, options)
  side(out, backward, inner, options)
  cap(out, backward[backward.length - 2]!, backward[backward.length - 1]!, inner, outer, options)

  return ringPath(out)
}

/** Offset points along one side of an open polyline, with joins at the middle. */
function side(out: Vec2[], points: Vec2[], distance: number, options: OutlineStrokeOptions): void {
  const n = points.length
  out.push(offsetPoint(points[0]!, normal(points[0]!, points[1]!), distance))
  for (let i = 1; i < n - 1; i++) {
    pushJoin(out, points[i - 1]!, points[i]!, points[i + 1]!, distance, options)
  }
  out.push(offsetPoint(points[n - 1]!, normal(points[n - 2]!, points[n - 1]!), distance))
}

/**
 * The join at `cur`, between the segments arriving from `prev` and leaving to
 * `next`.
 *
 * On the OUTSIDE of the turn the two offset points are apart and the gap has to
 * be bridged — that is what miter, round and bevel name. On the inside they
 * cross; the crossing is left in place, because the nonzero rule fills it
 * correctly and trimming it is what makes naive outliners produce spikes.
 */
function pushJoin(
  out: Vec2[],
  prev: Vec2,
  cur: Vec2,
  next: Vec2,
  distance: number,
  options: OutlineStrokeOptions,
): void {
  if (Math.abs(distance) < 1e-9) {
    // A zero offset is the path itself — the case an Inside or Outside stroke
    // leaves on one side.
    out.push(cur)
    return
  }
  const n1 = normal(prev, cur)
  const n2 = normal(cur, next)
  const a = offsetPoint(cur, n1, distance)
  const b = offsetPoint(cur, n2, distance)

  // Cross product of the two directions: positive means the offset side is the
  // outside of the turn, which is the only side that needs a join at all.
  const d1 = direction(prev, cur)
  const d2 = direction(cur, next)
  const cross = d1.x * d2.y - d1.y * d2.x
  const convex = cross * distance < 0

  out.push(a)
  if (!convex || nearlyEqual(a, b)) {
    out.push(b)
    return
  }

  switch (options.join) {
    case 'round':
      pushArc(out, cur, a, b, Math.abs(distance))
      break
    case 'miter': {
      const point = miterPoint(a, d1, b, d2)
      // Adobe and SVG both fall back to a bevel past the miter limit, which is
      // what stops a near-180° turn growing a spike the length of the page.
      const ratio = point ? dist(point, cur) / Math.abs(distance) : Infinity
      if (point && ratio <= Math.max(1, options.miterLimit)) out.push(point)
      break
    }
    default:
      break
  }
  out.push(b)
}

/** The cap that closes one end, from the offset point on one side to the other. */
function cap(
  out: Vec2[],
  from: Vec2,
  end: Vec2,
  distance: number,
  otherDistance: number,
  options: OutlineStrokeOptions,
): void {
  const d = direction(from, end)
  const n = { x: -d.y, y: d.x }
  const a = offsetPoint(end, n, distance)
  const b = offsetPoint(end, n, -otherDistance)

  switch (options.cap) {
    case 'square': {
      const extent = Math.max(distance, otherDistance)
      out.push({ x: a.x + d.x * extent, y: a.y + d.y * extent })
      out.push({ x: b.x + d.x * extent, y: b.y + d.y * extent })
      break
    }
    case 'round':
      pushCapArc(out, a, b, d)
      break
    default:
      // Butt: straight across, which the next point already provides.
      break
  }
}

/** A round or square cap on a subpath with no length — a single click of a pen. */
function dotRing(at: Vec2, radius: number, capKind: LineCap): string {
  if (capKind === 'square') {
    return ringPath([
      { x: at.x - radius, y: at.y - radius },
      { x: at.x + radius, y: at.y - radius },
      { x: at.x + radius, y: at.y + radius },
      { x: at.x - radius, y: at.y + radius },
    ])
  }
  const points: Vec2[] = []
  const steps = Math.max(8, Math.ceil(2 * Math.PI * ARC_STEPS_PER_RADIAN))
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2
    points.push({ x: at.x + Math.cos(t) * radius, y: at.y + Math.sin(t) * radius })
  }
  return ringPath(points)
}

// ---------------------------------------------------------------------------
// Vector helpers
// ---------------------------------------------------------------------------

function direction(a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  return { x: dx / len, y: dy / len }
}

/** Left-hand normal of a -> b. */
function normal(a: Vec2, b: Vec2): Vec2 {
  const d = direction(a, b)
  return { x: -d.y, y: d.x }
}

function offsetPoint(p: Vec2, n: Vec2, distance: number): Vec2 {
  return { x: p.x + n.x * distance, y: p.y + n.y * distance }
}

/** Shoelace area. Positive is clockwise, because y runs down the screen. */
function signedArea(points: readonly Vec2[]): number {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    sum += a.x * b.y - b.x * a.y
  }
  return sum / 2
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function nearlyEqual(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9
}

/** Where the two offset edges would meet if extended — the miter tip. */
function miterPoint(a: Vec2, d1: Vec2, b: Vec2, d2: Vec2): Vec2 | null {
  const denom = d1.x * d2.y - d1.y * d2.x
  if (Math.abs(denom) < 1e-9) return null
  const t = ((b.x - a.x) * d2.y - (b.y - a.y) * d2.x) / denom
  const point = { x: a.x + d1.x * t, y: a.y + d1.y * t }
  return Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null
}

/**
 * The half turn that rounds off an end.
 *
 * Not `pushArc`: `a` and `b` are diametrically opposite, so the two ways round
 * are the same length and "the shorter one" does not pick between them. The cap
 * has to bulge FORWARD, past the end of the path — the other choice carves the
 * same half-disc out of the stroke instead of adding it.
 */
function pushCapArc(out: Vec2[], a: Vec2, b: Vec2, forward: Vec2): void {
  const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const radius = dist(a, b) / 2
  if (radius < 1e-9) return

  const start = Math.atan2(a.y - center.y, a.x - center.x)
  // Halfway round is start ± π/2; take whichever points the way the path was
  // heading.
  const sign = Math.cos(start + Math.PI / 2) * forward.x + Math.sin(start + Math.PI / 2) * forward.y > 0 ? 1 : -1
  const sweep = sign * Math.PI

  const steps = Math.max(2, Math.ceil(Math.PI * ARC_STEPS_PER_RADIAN))
  for (let i = 1; i < steps; i++) {
    const t = start + (sweep * i) / steps
    out.push({ x: center.x + Math.cos(t) * radius, y: center.y + Math.sin(t) * radius })
  }
}

/** Arc from `a` to `b` about `center`, the short way round. */
function pushArc(out: Vec2[], center: Vec2, a: Vec2, b: Vec2, radius: number): void {
  const start = Math.atan2(a.y - center.y, a.x - center.x)
  const end = Math.atan2(b.y - center.y, b.x - center.x)
  let sweep = end - start
  while (sweep > Math.PI) sweep -= Math.PI * 2
  while (sweep < -Math.PI) sweep += Math.PI * 2

  const steps = Math.max(1, Math.ceil(Math.abs(sweep) * ARC_STEPS_PER_RADIAN))
  for (let i = 1; i < steps; i++) {
    const t = start + (sweep * i) / steps
    out.push({ x: center.x + Math.cos(t) * radius, y: center.y + Math.sin(t) * radius })
  }
}

function dedupe(points: readonly Vec2[], closed: boolean): Vec2[] {
  const out: Vec2[] = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (!last || !nearlyEqual(last, p)) out.push(p)
  }
  // A closed polyline repeats its first point at the end; the walk wraps round
  // on its own, so leaving it in would put a zero-length segment in every ring.
  if (closed && out.length > 1 && nearlyEqual(out[0]!, out[out.length - 1]!)) out.pop()
  return out
}

function ringPath(points: readonly Vec2[]): string {
  if (points.length < 3) return ''
  const r = (n: number) => Math.round(n * 1000) / 1000
  let out = `M${r(points[0]!.x)} ${r(points[0]!.y)}`
  for (let i = 1; i < points.length; i++) out += `L${r(points[i]!.x)} ${r(points[i]!.y)}`
  return `${out}Z`
}
