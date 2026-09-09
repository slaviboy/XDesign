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
 * Removing points that carry no information.
 *
 * potrace represents a corner as two straight legs meeting at the polygon
 * vertex, with the segment's endpoint at the MIDPOINT of the adjoining edge.
 * That is exactly right for the algorithm — the midpoints are what the corner
 * analysis works between — but it leaves a redundant point in the middle of
 * every straight run. A traced rectangle comes out as eight points where four
 * describe it exactly:
 *
 *   M 30 10 L 10 10 L 10 30 L 10 50 L 30 50 …    ← (10,30) is on the line
 *   M 10 10 L 10 50 L 50 50 L 50 10 Z            ← the same rectangle
 *
 * Nobody wants to drag the extra ones, and on a real trace they are a third of
 * the anchors. So this pass drops any point whose neighbours are both straight
 * and which lies on the line between them, to within a tolerance far below one
 * pixel — the geometry is unchanged, only the description of it.
 *
 * Curves are never touched, and a point between a curve and a line is never
 * dropped: it is where the tangent changes, which is information.
 *
 * This is kept out of `smooth.ts` on purpose. That module is potrace, faithful
 * to the paper; this is a presentation decision about what an editable path
 * should look like afterwards, and the two should not be able to drift into
 * each other.
 */

import type { Curve, Segment, Vec2 } from './types'

/**
 * How far off the line a point may be and still count as on it. A hundredth of
 * a pixel is far below anything the tracer can resolve — its input is a pixel
 * grid — so this only ever removes points that were already redundant.
 */
const COLLINEAR_EPSILON = 0.01

/** A path as a start point and a list of steps, which is easier to edit than segments. */
interface Step {
  /** Absent on both means a straight line to `to`. */
  c1?: Vec2
  c2?: Vec2
  to: Vec2
}

export function simplifyCurve(curve: Curve, epsilon: number = COLLINEAR_EPSILON): Curve {
  const closed = curve.closed !== false
  const steps = toSteps(curve)
  if (steps.length < 3) return curve

  let start = curve.start
  const kept: Step[] = []

  // Forward pass: a point is dropped when the straight run through it is
  // straight all the way, so `from` walks the last point actually kept.
  let from = start
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!
    const next = steps[i + 1]
    if (
      next &&
      isLine(step) &&
      isLine(next) &&
      onSegment(from, step.to, next.to, epsilon)
    ) {
      continue
    }
    kept.push(step)
    from = step.to
  }

  // On a closed path the start is a point like any other — and on a shape whose
  // first segment lands mid-edge, it is the likeliest one of all to be
  // redundant, because that is exactly where potrace begins. The last step is
  // the one that returns to it, so dropping the point means dropping that step
  // and beginning at its predecessor instead. The cycle is unchanged; only the
  // place it is cut open moves.
  if (closed && kept.length >= 3) {
    const last = kept[kept.length - 1]!
    const first = kept[0]!
    const before = kept[kept.length - 2]!.to
    if (isLine(last) && isLine(first) && onSegment(before, start, first.to, epsilon)) {
      kept.pop()
      start = kept[kept.length - 1]!.to
    }
  }

  if (kept.length === steps.length) return curve
  // An open path is allowed to become a single straight line — that is the
  // whole point on a long straight run. A closed one needs at least two
  // segments to enclose anything, and a shape with no area is worse than a
  // redundant point.
  if (kept.length < (closed ? 2 : 1)) return curve
  return fromSteps(start, kept, curve.closed)
}

// ---------------------------------------------------------------------------

function isLine(step: Step): boolean {
  return !step.c1 && !step.c2
}

/** Is `p` on the segment a→b, within `epsilon`, and between its ends? */
function onSegment(a: Vec2, p: Vec2, b: Vec2, epsilon: number): boolean {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  // A zero-length span has no line to be on; keeping the point is the safe answer.
  if (lengthSquared < 1e-12) return false

  // Perpendicular distance, via the cross product with the span.
  const cross = (p.x - a.x) * dy - (p.y - a.y) * dx
  if (Math.abs(cross) > epsilon * Math.sqrt(lengthSquared)) return false

  // And strictly between the ends, so a point that doubles back is kept.
  const dot = (p.x - a.x) * dx + (p.y - a.y) * dy
  return dot > 0 && dot < lengthSquared
}

/** Segments to steps: a corner is two straight legs. */
function toSteps(curve: Curve): Step[] {
  const steps: Step[] = []
  for (const segment of curve.segments) {
    if (segment.kind === 'corner') {
      steps.push({ to: segment.c })
      steps.push({ to: segment.end })
    } else if (segment.kind === 'curve') {
      steps.push({ c1: segment.c1, c2: segment.c2, to: segment.end })
    } else {
      steps.push({ to: segment.end })
    }
  }
  return steps
}

/**
 * Steps back to segments.
 *
 * Straight runs come back as `line` segments rather than being re-paired into
 * corners: a corner is a claim about two legs meeting at a vertex, and after
 * this pass the legs that survived no longer come in pairs.
 */
function fromSteps(start: Vec2, steps: readonly Step[], closed: boolean | undefined): Curve {
  const segments: Segment[] = steps.map((step) =>
    step.c1 && step.c2
      ? { kind: 'curve', c1: step.c1, c2: step.c2, end: step.to }
      : { kind: 'line', end: step.to },
  )
  return closed === undefined ? { start, segments } : { start, segments, closed }
}
