/**
 * Snapping and smart guides.
 *
 * Pure geometry: takes the box being dragged plus a set of candidate edges and
 * returns the correction to apply and the guide lines to draw. Keeping it free
 * of store access makes the alignment behaviour directly testable and lets the
 * drag loop call it every frame without touching React.
 *
 * The threshold is supplied in DOCUMENT units by the caller (screen pixels
 * divided by zoom), so snapping feels equally sticky at 25% and at 400%.
 */

import { bottom, centerX, centerY, right, type Bounds } from './Bounds'

export type SnapKind = 'edge' | 'center' | 'guide' | 'grid' | 'spacing'

export interface SnapCandidate {
  axis: 'x' | 'y'
  position: number
  kind: SnapKind
  /** Extent of the source object along the other axis, for drawing the guide. */
  from: number
  to: number
}

export interface SnapLine {
  axis: 'x' | 'y'
  position: number
  start: number
  end: number
  kind: SnapKind
}

export interface SnapResult {
  dx: number
  dy: number
  lines: SnapLine[]
}

export const NO_SNAP: SnapResult = { dx: 0, dy: 0, lines: [] }

/** The three interesting positions of a box on each axis. */
function edgesOf(b: Bounds): { xs: number[]; ys: number[] } {
  return {
    xs: [b.x, centerX(b), right(b)],
    ys: [b.y, centerY(b), bottom(b)],
  }
}

/**
 * Find the best correction that aligns `moving` to any candidate.
 *
 * Each axis is solved independently and only the single closest match on each is
 * applied, so a box never gets yanked by two competing candidates at once.
 */
export function computeSnap(
  moving: Bounds,
  candidates: readonly SnapCandidate[],
  threshold: number,
): SnapResult {
  if (threshold <= 0 || candidates.length === 0) return NO_SNAP

  const { xs, ys } = edgesOf(moving)

  let bestX: { delta: number; cand: SnapCandidate; edge: number } | null = null
  let bestY: { delta: number; cand: SnapCandidate; edge: number } | null = null

  for (const c of candidates) {
    const edges = c.axis === 'x' ? xs : ys
    for (const e of edges) {
      const delta = c.position - e
      const dist = Math.abs(delta)
      if (dist > threshold) continue
      if (c.axis === 'x') {
        if (!bestX || dist < Math.abs(bestX.delta)) bestX = { delta, cand: c, edge: e }
      } else if (!bestY || dist < Math.abs(bestY.delta)) {
        bestY = { delta, cand: c, edge: e }
      }
    }
  }

  const lines: SnapLine[] = []
  const dx = bestX?.delta ?? 0
  const dy = bestY?.delta ?? 0

  // Guides span the union of the moving box and the object it snapped to, which
  // is what makes the relationship legible at a glance.
  if (bestX) {
    lines.push({
      axis: 'x',
      position: bestX.cand.position,
      start: Math.min(bestX.cand.from, moving.y + dy),
      end: Math.max(bestX.cand.to, bottom(moving) + dy),
      kind: bestX.cand.kind,
    })
  }
  if (bestY) {
    lines.push({
      axis: 'y',
      position: bestY.cand.position,
      start: Math.min(bestY.cand.from, moving.x + dx),
      end: Math.max(bestY.cand.to, right(moving) + dx),
      kind: bestY.cand.kind,
    })
  }

  return { dx, dy, lines }
}

/** Candidate edges and centers contributed by one static object. */
export function candidatesFromBounds(b: Bounds, kind: SnapKind = 'edge'): SnapCandidate[] {
  return [
    { axis: 'x', position: b.x, kind, from: b.y, to: bottom(b) },
    { axis: 'x', position: centerX(b), kind: kind === 'edge' ? 'center' : kind, from: b.y, to: bottom(b) },
    { axis: 'x', position: right(b), kind, from: b.y, to: bottom(b) },
    { axis: 'y', position: b.y, kind, from: b.x, to: right(b) },
    { axis: 'y', position: centerY(b), kind: kind === 'edge' ? 'center' : kind, from: b.x, to: right(b) },
    { axis: 'y', position: bottom(b), kind, from: b.x, to: right(b) },
  ]
}

/**
 * @param frame the extent the drawn line should span — the guide's own
 *   artboard, not the viewport. A guide belongs to an artboard, so a line
 *   stretching across the whole screen would claim a reach it does not have.
 */
export function candidatesFromGuides(
  guides: readonly { axis: 'x' | 'y'; position: number }[],
  frame: Bounds,
): SnapCandidate[] {
  return guides.map((g) => ({
    axis: g.axis,
    position: g.position,
    kind: 'guide' as SnapKind,
    from: g.axis === 'x' ? frame.y : frame.x,
    to: g.axis === 'x' ? bottom(frame) : right(frame),
  }))
}

/**
 * Grid snapping is handled separately from object snapping: it applies to the
 * box's top-left only and does not draw a guide line, matching how grids behave
 * in every tool that has one.
 */
export function snapToGrid(moving: Bounds, gridSize: number, threshold: number): SnapResult {
  if (gridSize <= 0) return NO_SNAP
  const nearest = (v: number) => Math.round(v / gridSize) * gridSize
  const dx = nearest(moving.x) - moving.x
  const dy = nearest(moving.y) - moving.y
  return {
    dx: Math.abs(dx) <= threshold ? dx : 0,
    dy: Math.abs(dy) <= threshold ? dy : 0,
    lines: [],
  }
}

/** Snap a single scalar (used by guide dragging and by resize handles). */
export function snapValue(
  value: number,
  candidates: readonly number[],
  threshold: number,
): number {
  let best = value
  let bestDist = threshold
  for (const c of candidates) {
    const d = Math.abs(c - value)
    if (d < bestDist) {
      bestDist = d
      best = c
    }
  }
  return best
}
