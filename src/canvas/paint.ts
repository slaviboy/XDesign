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
 * Paint -> SVG attribute values.
 *
 * Gradient coordinates are stored in objectBoundingBox units (0..1), which is
 * also SVG's default gradientUnits — so a gradient rescales with its shape for
 * free and survives a resize with no recomputation and no drift.
 *
 * Shared by the live renderer and the SVG exporter so that what is on screen and
 * what lands in the file are produced by the same code, not two implementations
 * that slowly diverge.
 */

import { mixRgba, toHex } from '../document/color'
import type { GradientStop, Paint, RGBA, Style } from '../document/types'

export interface PaintAttrs {
  /** Value for `fill` or `stroke`. */
  value: string
  /** Value for `fill-opacity` / `stroke-opacity`. */
  opacity: number
}

export function gradientId(nodeId: string, target: 'fill' | 'stroke'): string {
  return `grad-${nodeId}-${target}`
}

export function paintToAttrs(
  paint: Paint,
  nodeId: string,
  target: 'fill' | 'stroke',
): PaintAttrs {
  switch (paint.type) {
    case 'none':
      return { value: 'none', opacity: 1 }
    case 'solid':
      return { value: toHex(paint.color), opacity: paint.color.a }
    case 'linear':
    case 'radial':
    case 'angular':
      // Angular resolves to a <pattern> rather than a gradient, but a pattern is
      // a paint server too, so the reference looks the same from out here.
      return { value: `url(#${gradientId(nodeId, target)})`, opacity: 1 }
    case 'ref':
      // A paint server inside a preserved SVG subtree — pass the reference through.
      return { value: paint.ref, opacity: 1 }
    default:
      return { value: 'none', opacity: 1 }
  }
}

export function isGradient(paint: Paint): paint is Extract<Paint, { stops: GradientStop[] }> {
  return paint.type === 'linear' || paint.type === 'radial' || paint.type === 'angular'
}

export function sortedStops(stops: readonly GradientStop[]): GradientStop[] {
  return [...stops].sort((a, b) => a.offset - b.offset)
}

/**
 * The colour a gradient shows at `offset`.
 *
 * Needed in two places that both used to fake it: the picker's click-to-add,
 * which copied the nearest stop's colour, and the angular renderer, which has to
 * sample the ramp at every wedge boundary.
 */
export function sampleGradientAt(stops: readonly GradientStop[], offset: number): RGBA {
  const sorted = sortedStops(stops)
  if (sorted.length === 0) return { r: 0, g: 0, b: 0, a: 1 }
  const first = sorted[0]!
  const last = sorted[sorted.length - 1]!
  if (offset <= first.offset) return { ...first.color }
  if (offset >= last.offset) return { ...last.color }

  // The LAST stop at or before the offset, so when two share one offset — a
  // deliberate hard edge — the one taking over from there wins.
  let at = 0
  for (let i = 0; i < sorted.length && sorted[i]!.offset <= offset; i++) at = i

  const lo = sorted[at]!
  if (lo.offset >= offset) return { ...lo.color }
  const hi = sorted[at + 1] ?? last
  const span = hi.offset - lo.offset
  return span <= 0 ? { ...hi.color } : mixRgba(lo.color, hi.color, (offset - lo.offset) / span)
}

/**
 * How many slices approximate an angular gradient.
 *
 * SVG has no conic paint server, so the sweep is drawn as a fan of flat-coloured
 * wedges. Flat, not gradient-filled: a linear gradient's iso-lines are parallel,
 * a conic's are rays, so no linear fill can agree with its neighbour all the way
 * down the shared edge — chord-filled wedges leave visible spokes. Enough thin
 * flat wedges have no seams at all, only banding, and at two degrees apiece the
 * step between neighbours is under one 8-bit level across a full-range ramp.
 */
export const ANGULAR_WEDGES = 180

/** The pattern tile, in objectBoundingBox units: twice the box, centred on it. */
export const ANGULAR_TILE = { x: -0.5, y: -0.5, width: 2, height: 2 }

export interface AngularWedge {
  /** Path data in objectBoundingBox units, so it rescales with the shape. */
  d: string
  color: RGBA
}

/**
 * The fan that stands in for a conic gradient.
 *
 * Everything is in objectBoundingBox units — the same space the real gradients
 * use — so the pattern needs no knowledge of the node's size and rescales for
 * free. The radius overscans past the unit square so the fan always covers the
 * shape, whatever the aspect and wherever the centre is.
 */
export function angularWedges(
  cx: number,
  cy: number,
  rotationDeg: number,
  stops: readonly GradientStop[],
): AngularWedge[] {
  // The tile is twice the bounding box and offset half a box up and left, so an
  // angular STROKE — which paints outside the fill's box — is covered instead of
  // showing the fan tiled. `reach` has to clear that tile from any centre.
  const reach = Math.hypot(Math.max(cx + 0.5, 1.5 - cx), Math.max(cy + 0.5, 1.5 - cy)) + 0.5
  const start = (rotationDeg * Math.PI) / 180

  // Boundaries are the uniform fan PLUS every stop offset, so a deliberate hard
  // edge — two stops a hundredth apart — lands on a wedge edge instead of being
  // smeared across the two-degree slice it happens to fall in.
  const cuts = new Set<number>()
  for (let i = 0; i <= ANGULAR_WEDGES; i++) cuts.add(i / ANGULAR_WEDGES)
  for (const stop of stops) {
    if (stop.offset > 0 && stop.offset < 1) cuts.add(stop.offset)
  }
  const bounds = [...cuts].sort((a, b) => a - b)

  const wedges: AngularWedge[] = []
  for (let i = 1; i < bounds.length; i++) {
    const t0 = bounds[i - 1]!
    const t1 = bounds[i]!
    if (t1 - t0 <= 0) continue
    const a0 = start + t0 * Math.PI * 2
    // Overlap the next wedge so the later one paints over this one's
    // antialiased trailing edge. Butt-jointed wedges leave a lattice of
    // half-covered pixels that reads as moire.
    const a1 = start + Math.min(1, t1 + 1 / ANGULAR_WEDGES) * Math.PI * 2
    wedges.push({
      // A straight chord, not an arc: the wedge overscans the shape anyway, so
      // its outer edge is never visible and an arc would only add path data.
      d:
        `M${r4(cx)} ${r4(cy)} ` +
        `L${r4(cx + Math.cos(a0) * reach)} ${r4(cy + Math.sin(a0) * reach)} ` +
        `L${r4(cx + Math.cos(a1) * reach)} ${r4(cy + Math.sin(a1) * reach)} Z`,
      // Sampled just inside the span, so a hard edge takes the colour that
      // actually belongs to this side of it.
      color: sampleGradientAt(stops, t0 + (t1 - t0) * 0.5),
    })
  }
  return wedges
}

function r4(n: number): number {
  return Math.round(n * 10000) / 10000
}

/** Combined alpha for a node's fill: node opacity is applied on the group. */
export function fillOpacity(style: Style, paintAlpha: number): number {
  return Math.max(0, Math.min(1, style.fillOpacity * paintAlpha))
}

export function strokeOpacity(style: Style, paintAlpha: number): number {
  return Math.max(0, Math.min(1, style.strokeOpacity * paintAlpha))
}

/**
 * Stroke alignment.
 *
 * SVG only draws centered strokes. Inner and outer are emulated by drawing at
 * double width and clipping to the shape (inner) or masking the shape out
 * (outer) — the same trick design tools use. The renderer consults this to
 * decide whether it needs the extra clip/mask machinery for a node.
 */
export function needsStrokeAlignmentTrick(style: Style): boolean {
  return (
    style.stroke.align !== 'center' &&
    style.stroke.paint.type !== 'none' &&
    style.stroke.width > 0
  )
}

export function effectiveStrokeWidth(style: Style): number {
  // Inner/outer are drawn at 2x and half of it is clipped away.
  return style.stroke.align === 'center' ? style.stroke.width : style.stroke.width * 2
}

export function dashArrayValue(dashArray: readonly number[]): string | undefined {
  const cleaned = dashArray.filter((n) => Number.isFinite(n) && n >= 0)
  return cleaned.length ? cleaned.join(' ') : undefined
}
