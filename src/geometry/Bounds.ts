/**
 * Axis-aligned bounding boxes. DOM-free (see Matrix.ts for why).
 *
 * A note that matters for every consumer of this file: there are three different
 * bounding boxes in a vector editor and conflating them produces a whole family
 * of "the export is clipped" bugs.
 *
 *   geometryBounds  — the exact fill outline. What align/distribute snap to.
 *   renderBounds    — geometry inflated by stroke, markers and filter region.
 *                     What export must crop to, or strokes get sliced in half.
 *   selectionBounds — what the transform handles wrap. Matches geometry, as XD does.
 *
 * See PathUtils.strokeInflate for why renderBounds is not simply
 * `geometry + strokeWidth/2`: miter joins on a sharp corner extend up to
 * `miterlimit * strokeWidth / 2`.
 */

import { applyToXY, type Mat2D, type Vec2 } from './Matrix'

export interface Bounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export const EMPTY_BOUNDS: Bounds = { x: 0, y: 0, width: 0, height: 0 }

export function bounds(x: number, y: number, width: number, height: number): Bounds {
  return width < 0 || height < 0
    ? { x: width < 0 ? x + width : x, y: height < 0 ? y + height : y, width: Math.abs(width), height: Math.abs(height) }
    : { x, y, width, height }
}

export function boundsFromCorners(x0: number, y0: number, x1: number, y1: number): Bounds {
  return {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    width: Math.abs(x1 - x0),
    height: Math.abs(y1 - y0),
  }
}

export function boundsFromPoints(pts: readonly Vec2[]): Bounds {
  if (pts.length === 0) return EMPTY_BOUNDS
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export function isEmptyBounds(b: Bounds | null | undefined): boolean {
  return !b || !Number.isFinite(b.width) || !Number.isFinite(b.height) || (b.width <= 0 && b.height <= 0)
}

export const left = (b: Bounds) => b.x
export const top = (b: Bounds) => b.y
export const right = (b: Bounds) => b.x + b.width
export const bottom = (b: Bounds) => b.y + b.height
export const centerX = (b: Bounds) => b.x + b.width / 2
export const centerY = (b: Bounds) => b.y + b.height / 2

export function center(b: Bounds): Vec2 {
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

export function area(b: Bounds): number {
  return Math.max(0, b.width) * Math.max(0, b.height)
}

/** Corners in TL, TR, BR, BL order. */
export function corners(b: Bounds): Vec2[] {
  return [
    { x: b.x, y: b.y },
    { x: b.x + b.width, y: b.y },
    { x: b.x + b.width, y: b.y + b.height },
    { x: b.x, y: b.y + b.height },
  ]
}

export function union(a: Bounds | null, b: Bounds | null): Bounds {
  if (!a) return b ?? EMPTY_BOUNDS
  if (!b) return a
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, width: Math.max(right(a), right(b)) - x, height: Math.max(bottom(a), bottom(b)) - y }
}

export function unionAll(list: readonly (Bounds | null)[]): Bounds {
  let out: Bounds | null = null
  for (const b of list) {
    if (!b) continue
    out = out ? union(out, b) : b
  }
  return out ?? EMPTY_BOUNDS
}

export function intersects(a: Bounds, b: Bounds): boolean {
  return !(right(a) < b.x || right(b) < a.x || bottom(a) < b.y || bottom(b) < a.y)
}

export function intersection(a: Bounds, b: Bounds): Bounds | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const r = Math.min(right(a), right(b))
  const bo = Math.min(bottom(a), bottom(b))
  if (r < x || bo < y) return null
  return { x, y, width: r - x, height: bo - y }
}

/** True when `outer` fully encloses `inner` — used by marquee "fully contained" selection. */
export function contains(outer: Bounds, inner: Bounds): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    right(inner) <= right(outer) &&
    bottom(inner) <= bottom(outer)
  )
}

export function containsPoint(b: Bounds, p: Vec2, tolerance = 0): boolean {
  return (
    p.x >= b.x - tolerance &&
    p.x <= right(b) + tolerance &&
    p.y >= b.y - tolerance &&
    p.y <= bottom(b) + tolerance
  )
}

export function inflate(b: Bounds, dx: number, dy: number = dx): Bounds {
  return { x: b.x - dx, y: b.y - dy, width: b.width + dx * 2, height: b.height + dy * 2 }
}

export function translateBounds(b: Bounds, dx: number, dy: number): Bounds {
  return { x: b.x + dx, y: b.y + dy, width: b.width, height: b.height }
}

/**
 * Transform a box and take the AABB of the result.
 *
 * This is deliberately "transform the corners, then bound" and not "bound, then
 * transform": under rotation `AABB(M·box) != M·AABB(box)`, and getting that
 * backwards is what makes rotated selections drift.
 */
export function transformBounds(b: Bounds, m: Mat2D): Bounds {
  const p0 = applyToXY(m, b.x, b.y)
  const p1 = applyToXY(m, b.x + b.width, b.y)
  const p2 = applyToXY(m, b.x + b.width, b.y + b.height)
  const p3 = applyToXY(m, b.x, b.y + b.height)
  const minX = Math.min(p0.x, p1.x, p2.x, p3.x)
  const minY = Math.min(p0.y, p1.y, p2.y, p3.y)
  const maxX = Math.max(p0.x, p1.x, p2.x, p3.x)
  const maxY = Math.max(p0.y, p1.y, p2.y, p3.y)
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/** Uniformly fit `content` inside `frame`, returning the scale and centering offset. */
export function fitInto(
  content: Bounds,
  frame: Bounds,
  padding = 0,
): { scale: number; x: number; y: number } {
  const availW = Math.max(1, frame.width - padding * 2)
  const availH = Math.max(1, frame.height - padding * 2)
  const scale =
    content.width <= 0 || content.height <= 0
      ? 1
      : Math.min(availW / content.width, availH / content.height)
  return {
    scale,
    x: frame.x + padding + (availW - content.width * scale) / 2 - content.x * scale,
    y: frame.y + padding + (availH - content.height * scale) / 2 - content.y * scale,
  }
}

/** Snap a box outward to whole pixels — used when sizing an export canvas. */
export function roundOut(b: Bounds): Bounds {
  const x = Math.floor(b.x)
  const y = Math.floor(b.y)
  return { x, y, width: Math.ceil(right(b)) - x, height: Math.ceil(bottom(b)) - y }
}
