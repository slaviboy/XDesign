/**
 * 2D affine transform math.
 *
 * Deliberately DOM-free: no DOMMatrix, no getCTM, no getScreenCTM. jsdom does not
 * implement DOMMatrix at all, and happy-dom's getCTM() returns a fresh identity
 * matrix regardless of the element, so any geometry built on those would be
 * "verified" against fabricated values. Keeping this pure means the unit suite
 * runs in plain node and actually proves something. Enforced by eslint.config.js.
 *
 * Matrix layout follows the SVG convention `matrix(a b c d e f)`:
 *
 *     | a  c  e |        x' = a*x + c*y + e
 *     | b  d  f |        y' = b*x + d*y + f
 *     | 0  0  1 |
 */

export type Mat2D = readonly [a: number, b: number, c: number, d: number, e: number, f: number]

export interface Vec2 {
  readonly x: number
  readonly y: number
}

/** A transform decomposed into the parts a designer actually manipulates. */
export interface DecomposedTransform {
  x: number
  y: number
  /** degrees */
  rotation: number
  scaleX: number
  scaleY: number
  /** degrees */
  skewX: number
  skewY: number
}

export const IDENTITY: Mat2D = [1, 0, 0, 1, 0, 0]

export const DEG = Math.PI / 180
export const RAD = 180 / Math.PI

export const EPSILON = 1e-9

export function isIdentity(m: Mat2D): boolean {
  return (
    Math.abs(m[0] - 1) < EPSILON &&
    Math.abs(m[1]) < EPSILON &&
    Math.abs(m[2]) < EPSILON &&
    Math.abs(m[3] - 1) < EPSILON &&
    Math.abs(m[4]) < EPSILON &&
    Math.abs(m[5]) < EPSILON
  )
}

export function matEquals(a: Mat2D, b: Mat2D, eps = 1e-6): boolean {
  for (let i = 0; i < 6; i++) if (Math.abs(a[i] - b[i]) > eps) return false
  return true
}

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

export function translation(tx: number, ty: number): Mat2D {
  return [1, 0, 0, 1, tx, ty]
}

export function scaling(sx: number, sy: number = sx): Mat2D {
  return [sx, 0, 0, sy, 0, 0]
}

/** @param deg rotation in degrees, positive = clockwise in SVG's y-down space. */
export function rotation(deg: number): Mat2D {
  const r = deg * DEG
  const c = Math.cos(r)
  const s = Math.sin(r)
  return [c, s, -s, c, 0, 0]
}

/** @param degX,degY skew angles in degrees. */
export function skewing(degX: number, degY: number): Mat2D {
  return [1, Math.tan(degY * DEG), Math.tan(degX * DEG), 1, 0, 0]
}

/** Rotate `deg` degrees about the point (cx, cy). */
export function rotationAbout(deg: number, cx: number, cy: number): Mat2D {
  return multiply(multiply(translation(cx, cy), rotation(deg)), translation(-cx, -cy))
}

/** Scale by (sx, sy) about the point (cx, cy). */
export function scalingAbout(sx: number, sy: number, cx: number, cy: number): Mat2D {
  return multiply(multiply(translation(cx, cy), scaling(sx, sy)), translation(-cx, -cy))
}

// ---------------------------------------------------------------------------
// Core operations
// ---------------------------------------------------------------------------

/**
 * `m1 · m2` — the combined transform that applies m2 first, then m1.
 * Order matters: R·S rotates a scaled shape, S·R scales a rotated one (and shears it).
 */
export function multiply(m1: Mat2D, m2: Mat2D): Mat2D {
  const [a1, b1, c1, d1, e1, f1] = m1
  const [a2, b2, c2, d2, e2, f2] = m2
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ]
}

/** Left-to-right composition: `compose(a, b, c)` applies a, then b, then c. */
export function compose(...mats: Mat2D[]): Mat2D {
  let out: Mat2D = IDENTITY
  for (let i = mats.length - 1; i >= 0; i--) out = multiply(out, mats[i]!)
  return out
}

export function determinant(m: Mat2D): number {
  return m[0] * m[3] - m[1] * m[2]
}

/**
 * Inverse of an affine matrix. Returns IDENTITY for a singular matrix rather than
 * throwing — a degenerate transform (a shape scaled to zero) must not take down
 * hit-testing or the render loop.
 */
export function invert(m: Mat2D): Mat2D {
  const [a, b, c, d, e, f] = m
  const det = a * d - b * c
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return IDENTITY
  const id = 1 / det
  return [d * id, -b * id, -c * id, a * id, (c * f - d * e) * id, (b * e - a * f) * id]
}

export function applyToPoint(m: Mat2D, p: Vec2): Vec2 {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] }
}

export function applyToXY(m: Mat2D, x: number, y: number): Vec2 {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }
}

/** Transform a direction (ignores translation). */
export function applyToVector(m: Mat2D, p: Vec2): Vec2 {
  return { x: m[0] * p.x + m[2] * p.y, y: m[1] * p.x + m[3] * p.y }
}

export function applyToPoints(m: Mat2D, pts: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = new Array(pts.length)
  for (let i = 0; i < pts.length; i++) out[i] = applyToPoint(m, pts[i]!)
  return out
}

/**
 * Average absolute scale factor, used to convert screen-space tolerances
 * (a 6px hit radius) into local units.
 */
export function meanScale(m: Mat2D): number {
  const sx = Math.hypot(m[0], m[1])
  const sy = Math.hypot(m[2], m[3])
  return (sx + sy) / 2 || 1
}

export function maxScale(m: Mat2D): number {
  return Math.max(Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3])) || 1
}

// ---------------------------------------------------------------------------
// Decomposition
// ---------------------------------------------------------------------------

/**
 * Split a matrix into translate · rotate · skewX · scale.
 *
 * Derivation — with R(t)·K(p)·S(sx,sy) expanded, the columns are:
 *   a = sx*cos t                  c = sy*(tan p*cos t - sin t)
 *   b = sx*sin t                  d = sy*(tan p*sin t + cos t)
 * so sx and t fall straight out of the first column, and rotating the second
 * column back by -t leaves exactly (sy*tan p, sy).
 *
 * A vertical flip surfaces as a negative scaleY. A horizontal flip is
 * mathematically indistinguishable from "rotate 180 and flip vertically", so it
 * comes back in that form; nodes keep their own scaleX/scaleY signs, so authored
 * flips survive round-trips regardless of what decomposition reports here.
 */
export function decompose(m: Mat2D): DecomposedTransform {
  const [a, b, c, d, e, f] = m

  const scaleX = Math.hypot(a, b)
  const rot = scaleX < EPSILON ? 0 : Math.atan2(b, a)

  const cos = Math.cos(rot)
  const sin = Math.sin(rot)

  // Undo the rotation on the second column.
  const c1 = c * cos + d * sin
  const d1 = -c * sin + d * cos

  const scaleY = d1
  const skewX = Math.abs(d1) < EPSILON ? 0 : Math.atan2(c1, d1)

  return {
    x: e,
    y: f,
    rotation: rot * RAD,
    scaleX: scaleX || 1,
    scaleY: scaleY || 1,
    skewX: skewX * RAD,
    skewY: 0,
  }
}

/** Rebuild a matrix from decompose()'s output. `recompose(decompose(m)) === m`. */
export function recompose(t: DecomposedTransform): Mat2D {
  return compose(
    scaling(t.scaleX, t.scaleY),
    skewing(t.skewX, t.skewY),
    rotation(t.rotation),
    translation(t.x, t.y),
  )
}

/** True when the matrix has no shear — its axes are still perpendicular. */
export function isOrthogonal(m: Mat2D, eps = 1e-6): boolean {
  return Math.abs(m[0] * m[2] + m[1] * m[3]) < eps
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

function num(n: number): string {
  if (!Number.isFinite(n)) return '0'
  const r = Math.round(n * 1e6) / 1e6
  return Object.is(r, -0) ? '0' : String(r)
}

export function toSvgMatrix(m: Mat2D): string {
  return `matrix(${num(m[0])} ${num(m[1])} ${num(m[2])} ${num(m[3])} ${num(m[4])} ${num(m[5])})`
}

/**
 * Parse an SVG `transform` attribute into a single matrix.
 * Handles matrix/translate/scale/rotate/skewX/skewY, whitespace- or comma-separated,
 * in any combination. Unknown functions are skipped rather than throwing — a bad
 * transform in one imported file must not abort the whole import.
 */
export function parseSvgTransform(input: string | null | undefined): Mat2D {
  if (!input) return IDENTITY
  let out: Mat2D = IDENTITY
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(input)) !== null) {
    const name = match[1]!.toLowerCase()
    const args = match[2]!
      .split(/[\s,]+/)
      .map((s) => Number.parseFloat(s))
      .filter((n) => Number.isFinite(n))
    let next: Mat2D | null = null
    switch (name) {
      case 'matrix':
        if (args.length >= 6) {
          next = [args[0]!, args[1]!, args[2]!, args[3]!, args[4]!, args[5]!]
        }
        break
      case 'translate':
        if (args.length >= 1) next = translation(args[0]!, args[1] ?? 0)
        break
      case 'scale':
        if (args.length >= 1) next = scaling(args[0]!, args[1] ?? args[0]!)
        break
      case 'rotate':
        if (args.length >= 3) next = rotationAbout(args[0]!, args[1]!, args[2]!)
        else if (args.length >= 1) next = rotation(args[0]!)
        break
      case 'skewx':
        if (args.length >= 1) next = skewing(args[0]!, 0)
        break
      case 'skewy':
        if (args.length >= 1) next = skewing(0, args[0]!)
        break
      default:
        break
    }
    if (next) out = multiply(out, next)
  }
  return out
}
