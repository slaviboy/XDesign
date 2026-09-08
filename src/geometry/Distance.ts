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
 * The gap between two boxes, per axis.
 *
 * Pure geometry so the measurement can be tested without a canvas, and so the
 * overlay and any future "distribute by distance" command cannot disagree about
 * what a distance is.
 *
 * A gap exists on an axis only when the boxes are SEPARATED on it. Two boxes
 * that overlap horizontally have no horizontal distance to report — the number
 * would be negative, and a negative distance drawn as a line between them is
 * a picture of nothing.
 */

import { bottom, right, type Bounds } from './Bounds'

export interface AxisDistance {
  /** The gap itself, always positive. */
  distance: number
  /** Where the measuring line runs, along the measured axis. */
  from: number
  to: number
  /** Where it sits on the other axis: the middle of the shared span. */
  at: number
}

export interface BoxDistance {
  horizontal: AxisDistance | null
  vertical: AxisDistance | null
}

/**
 * @param a the box measured FROM — the selection.
 * @param b the box measured TO — whatever is hovered.
 */
export function measureBetween(a: Bounds, b: Bounds): BoxDistance {
  // The two fallbacks differ on purpose. When the boxes share no span on the
  // perpendicular axis, both lines would otherwise be drawn through the same
  // point and their labels would sit on top of each other. Running the
  // horizontal one across the SELECTION and the vertical one down the TARGET
  // makes the pair an L from one box to the other, which is both readable and
  // the path the eye already traces between them.
  return {
    horizontal: axisGap(
      a.x, right(a), b.x, right(b),
      a.y, bottom(a), b.y, bottom(b),
      (a.y + bottom(a)) / 2,
    ),
    vertical: axisGap(
      a.y, bottom(a), b.y, bottom(b),
      a.x, right(a), b.x, right(b),
      (b.x + right(b)) / 2,
    ),
  }
}

/**
 * One axis: the gap along it, positioned across it.
 *
 * `otherLo`/`otherHi` are the two boxes' extents on the PERPENDICULAR axis, and
 * decide where the line is drawn. Where they overlap the line goes through the
 * middle of the overlap, which is where the eye expects to see it; where they
 * do not, it goes between the two facing edges, which is the shortest honest
 * place to put it.
 */
function axisGap(
  aLo: number,
  aHi: number,
  bLo: number,
  bHi: number,
  aOtherLo: number,
  aOtherHi: number,
  bOtherLo: number,
  bOtherHi: number,
  fallbackAt: number,
): AxisDistance | null {
  let from: number
  let to: number
  if (bLo >= aHi) {
    from = aHi
    to = bLo
  } else if (aLo >= bHi) {
    from = bHi
    to = aLo
  } else {
    // Overlapping on this axis: no gap to measure.
    return null
  }

  const overlapLo = Math.max(aOtherLo, bOtherLo)
  const overlapHi = Math.min(aOtherHi, bOtherHi)
  const at = overlapHi > overlapLo ? (overlapLo + overlapHi) / 2 : fallbackAt

  return { distance: to - from, from, to, at }
}
