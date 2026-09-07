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

import { toHex } from '../document/color'
import type { GradientStop, Paint, Style } from '../document/types'

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
      return { value: `url(#${gradientId(nodeId, target)})`, opacity: 1 }
    case 'ref':
      // A paint server inside a preserved SVG subtree — pass the reference through.
      return { value: paint.ref, opacity: 1 }
    default:
      return { value: 'none', opacity: 1 }
  }
}

export function isGradient(paint: Paint): paint is Extract<Paint, { stops: GradientStop[] }> {
  return paint.type === 'linear' || paint.type === 'radial'
}

export function sortedStops(stops: readonly GradientStop[]): GradientStop[] {
  return [...stops].sort((a, b) => a.offset - b.offset)
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
