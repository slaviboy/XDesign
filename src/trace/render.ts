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
 * Image Trace, final stage: smoothed curves to SVG path data.
 *
 * This is the only place the tracer builds a `d` string, so every formatting
 * decision lives here rather than being repeated by the orchestrator for fills
 * and again for strokes.
 *
 * Commands are absolute (M / L / C / Z), never relative. Relative commands are
 * a little shorter but every rounded delta drifts the pen by up to half a unit,
 * and over a photograph trace with tens of thousands of anchors that drift is
 * visible. Absolute coordinates keep the error at each point independent and
 * bounded by the precision. It is also the form the rest of the editor
 * normalises to (see toAbsoluteSegments in geometry/PathUtils), so nothing
 * downstream has to convert.
 *
 * A potrace corner is emitted as two L commands — one to the corner point, one
 * to the segment end — because the corner point is a real anchor the user can
 * grab in the pen tool. That matches how smooth.ts counts anchors: a corner is
 * two, a curve or line is one.
 *
 * Numbers are written to a fixed number of decimals, two by default, and then
 * stripped of padding. Two decimals is a hundredth of a source pixel, far
 * below the half-pixel fidelity the polygon stage promises, and it roughly
 * halves the output against a naive `String(n)`. Path data is most of the bytes
 * in a traced document, so this matters. The stripping is done on the string
 * rather than by round-tripping through Number, which would reintroduce
 * exponent notation for very small values — `1e-7` is a valid number but not a
 * valid path coordinate in every SVG reader.
 *
 * The optional `transform` maps curve coordinates into whatever space the
 * caller wants before rounding. The orchestrator uses it to scale a trace made
 * on a downsampled image back to source pixels; doing that here, before the
 * rounding, means the scale never amplifies rounding error. A plain function
 * rather than a Mat2D keeps this module free of the geometry layer and lets the
 * caller compose whatever it likes.
 */

import type { Curve, Vec2 } from './types'

const DEFAULT_PRECISION = 2

const identity = (p: Vec2): Vec2 => p

/**
 * A single closed or open curve as path data: `M x y`, one or two `L`s per
 * corner, a `C` per curve, an `L` per line, and `Z` unless the curve is
 * explicitly open. Coordinates pass through `transform` before rounding.
 */
export function curveToPathData(
  curve: Curve,
  transform: (p: Vec2) => Vec2 = identity,
  precision: number = DEFAULT_PRECISION,
): string {
  const point = (p: Vec2): string => {
    const t = transform(p)
    return `${formatNumber(t.x, precision)} ${formatNumber(t.y, precision)}`
  }

  const out: string[] = [`M ${point(curve.start)}`]
  for (const seg of curve.segments) {
    switch (seg.kind) {
      case 'corner':
        out.push(`L ${point(seg.c)}`, `L ${point(seg.end)}`)
        break
      case 'curve':
        out.push(`C ${point(seg.c1)} ${point(seg.c2)} ${point(seg.end)}`)
        break
      case 'line':
        out.push(`L ${point(seg.end)}`)
        break
    }
  }
  // Absent means closed: region outlines are the common case and only the
  // centreline extractor ever sets the flag.
  if (curve.closed !== false) out.push('Z')
  return out.join(' ')
}

/**
 * Several curves as one path: each becomes a subpath (its own `M`), joined by
 * single spaces. This is how a region with holes is emitted — the outer
 * boundary and each hole are separate curves wound in opposite directions,
 * and the nonzero fill rule does the rest.
 */
export function curvesToPathData(
  curves: readonly Curve[],
  transform: (p: Vec2) => Vec2 = identity,
  precision: number = DEFAULT_PRECISION,
): string {
  return curves.map((c) => curveToPathData(c, transform, precision)).join(' ')
}

// ---------------------------------------------------------------------------
// Number formatting
// ---------------------------------------------------------------------------

/**
 * `toFixed(precision)` with the padding removed: `1.50` → `1.5`, `2.00` → `2`,
 * `-0.00` → `0`. Integers are left alone — with precision 0 there is no point
 * to strip after and `100` must stay `100`.
 *
 * Non-finite input becomes `0`, the same choice Matrix.toSvgMatrix and the SVG
 * exporter make: a NaN in the string would make the whole path invalid and the
 * region vanish, where a single misplaced point is at least visible.
 */
function formatNumber(n: number, precision: number): string {
  if (!Number.isFinite(n)) return '0'
  let s = n.toFixed(precision)
  if (s.indexOf('.') !== -1) s = s.replace(/\.?0+$/, '')
  return s === '-0' ? '0' : s
}
