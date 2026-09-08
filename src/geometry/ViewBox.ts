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
 * viewBox and preserveAspectRatio, as the SVG specification defines them.
 *
 * Ignoring preserveAspectRatio is not a rounding error: a 100x100 viewBox drawn
 * into a 200x100 box stretches to twice its width, where every browser would
 * letterbox it and leave the artwork circular. The default is "xMidYMid meet",
 * so getting this wrong distorts the common case rather than an exotic one.
 *
 * Pure matrix maths, DOM-free, so it can be tested in plain node.
 */

import { compose, scaling, translation, type Mat2D } from './Matrix'

export interface ViewBox {
  x: number
  y: number
  width: number
  height: number
}

export interface PreserveAspectRatio {
  /** 0 = min, 0.5 = mid, 1 = max. Null means align="none". */
  alignX: number | null
  alignY: number | null
  /** meet fits inside the box; slice fills it and overflows. */
  slice: boolean
}

const ALIGN_FACTOR: Record<string, number> = { min: 0, mid: 0.5, max: 1 }

export const DEFAULT_PRESERVE: PreserveAspectRatio = { alignX: 0.5, alignY: 0.5, slice: false }

/** Parse `preserveAspectRatio`; anything unreadable falls back to the default. */
export function parsePreserveAspectRatio(value: string | null | undefined): PreserveAspectRatio {
  if (!value) return DEFAULT_PRESERVE
  const parts = value.trim().split(/\s+/)
  // "defer" is only meaningful on <image> and is ignored either way.
  const tokens = parts[0]?.toLowerCase() === 'defer' ? parts.slice(1) : parts
  const align = tokens[0] ?? 'xMidYMid'
  const slice = tokens[1] === 'slice'

  if (align === 'none') return { alignX: null, alignY: null, slice }
  const m = /^x(Min|Mid|Max)Y(Min|Mid|Max)$/.exec(align)
  if (!m) return { ...DEFAULT_PRESERVE, slice }
  return {
    alignX: ALIGN_FACTOR[m[1]!.toLowerCase()]!,
    alignY: ALIGN_FACTOR[m[2]!.toLowerCase()]!,
    slice,
  }
}

/**
 * The matrix mapping a viewBox onto a `width` x `height` box.
 *
 * With align="none" the two axes scale independently, which is the only case
 * that stretches. Otherwise one scale is used for both — the smaller to fit
 * inside the box (meet), the larger to cover it (slice) — and the remainder is
 * distributed by the alignment.
 */
export function viewBoxMatrix(
  viewBox: ViewBox,
  width: number,
  height: number,
  preserve: PreserveAspectRatio = DEFAULT_PRESERVE,
): Mat2D {
  const vbW = viewBox.width || 1
  const vbH = viewBox.height || 1
  let sx = width / vbW
  let sy = height / vbH

  let tx = 0
  let ty = 0
  if (preserve.alignX !== null && preserve.alignY !== null) {
    const s = preserve.slice ? Math.max(sx, sy) : Math.min(sx, sy)
    sx = s
    sy = s
    tx = (width - vbW * s) * preserve.alignX
    ty = (height - vbH * s) * preserve.alignY
  }

  // Shift the viewBox origin to zero first, then scale, then align.
  return compose(translation(-viewBox.x, -viewBox.y), scaling(sx, sy), translation(tx, ty))
}
