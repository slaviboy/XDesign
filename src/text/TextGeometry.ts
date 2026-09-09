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
 * Where a character is, and which character is where.
 *
 * The two questions an editor asks of a layout. A `<textarea>` answers them for
 * itself, which is why ordinary text can lean on one — but a textarea has a
 * single font, so the moment a text object carries style runs its answers are
 * about a layout nobody is looking at: the caret lands where the plain text
 * WOULD have put it, drifting further with every word drawn at another size.
 *
 * So for text with runs the caret and the selection are drawn from the same
 * layout that draws the glyphs, and these two functions are the bridge. Both
 * work in the node's own local space, which is where the text is drawn, so the
 * caller applies no transform of its own.
 */

import { layoutText, lineOffsetX, measureText, type TextLayoutResult } from './TextLayout'
import type { TextNode } from '../document/types'

export interface CaretRect {
  x: number
  y: number
  width: number
  height: number
}

/** The layout the node is actually drawn with, box width and all. */
export function layoutOf(node: TextNode): TextLayoutResult {
  const boxWidth = node.textStyle.sizing === 'auto-width' ? undefined : node.transform.width
  return layoutText(node.text, node.textStyle, boxWidth, node.runs)
}

function boxWidthOf(node: TextNode, layout: TextLayoutResult): number {
  return node.textStyle.sizing === 'auto-width' ? layout.width : node.transform.width
}

/**
 * The line an index belongs to.
 *
 * A wrapped line's end and the next line's start are the same character, and a
 * caret there is drawn at the START of the second line — which is where it
 * looks right, and where pressing Home would put it.
 */
function lineIndexAt(layout: TextLayoutResult, index: number): number {
  const lines = layout.lines
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const start = line.start ?? 0
    const end = line.end ?? start + line.text.length
    if (index < end) return i
    // The last line owns everything past its end, including the caret sitting
    // one character past the final glyph.
    if (i === lines.length - 1) return i
    const nextStart = lines[i + 1]!.start ?? end
    // Between two lines: the discarded space a wrap broke at.
    if (index < nextStart) return i + 1
  }
  return 0
}

/** How far into a line, in pixels, a character index sits. */
function offsetInLine(layout: TextLayoutResult, lineIndex: number, index: number): number {
  const line = layout.lines[lineIndex]!
  const start = line.start ?? 0
  const within = Math.max(0, Math.min(line.text.length, index - start))

  if (!line.segments) return measureText(line.text.slice(0, within), styleOfLine(layout, lineIndex))

  // Rich: walk the pieces until the one holding the index, then measure into it
  // with that piece's own style. Measuring the whole prefix in one style is
  // what a textarea does, and what puts the caret in the wrong place.
  let consumed = 0
  for (const segment of line.segments) {
    const length = segment.text.length
    if (within <= consumed + length) {
      return segment.x + measureText(segment.text.slice(0, within - consumed), segment.style)
    }
    consumed += length
  }
  const last = line.segments[line.segments.length - 1]
  return last ? last.x + last.width : 0
}

/** The style a uniform line is drawn in. Rich lines answer per segment instead. */
function styleOfLine(layout: TextLayoutResult, lineIndex: number) {
  const line = layout.lines[lineIndex]!
  return line.segments?.[0]?.style ?? UNIFORM_STYLE!
}

/**
 * Set for the duration of a call, so the uniform path can measure without
 * threading the node's style through every helper. Not reentrant, and does not
 * need to be: these are synchronous and single-threaded.
 */
let UNIFORM_STYLE: TextNode['textStyle'] | null = null

/** Height and top of the caret on a line, from the tallest thing on it. */
function lineBox(node: TextNode, layout: TextLayoutResult, lineIndex: number) {
  const line = layout.lines[lineIndex]!
  const sizes = line.segments?.length
    ? line.segments.map((s) => s.style.fontSize * s.style.lineHeight)
    : [node.textStyle.fontSize * node.textStyle.lineHeight]
  const height = Math.max(...sizes)
  return { top: line.baseline - height * 0.8, height }
}

/** The caret for a character index, in the node's local space. */
export function caretRect(node: TextNode, index: number): CaretRect {
  UNIFORM_STYLE = node.textStyle
  try {
    const layout = layoutOf(node)
    const boxWidth = boxWidthOf(node, layout)
    const lineIndex = lineIndexAt(layout, index)
    const line = layout.lines[lineIndex]!
    const originX = lineOffsetX(line.width, boxWidth, node.textStyle.align)
    const { top, height } = lineBox(node, layout, lineIndex)
    return {
      x: originX + offsetInLine(layout, lineIndex, index),
      y: top,
      width: 1,
      height,
    }
  } finally {
    UNIFORM_STYLE = null
  }
}

/**
 * The rectangles covering a character range — one per line it spans.
 *
 * Separate rectangles rather than one box, because a selection across a wrap is
 * not rectangular: it runs to the end of one line and starts at the beginning
 * of the next.
 */
export function selectionRects(node: TextNode, from: number, to: number): CaretRect[] {
  const lo = Math.min(from, to)
  const hi = Math.max(from, to)
  if (hi <= lo) return []

  UNIFORM_STYLE = node.textStyle
  try {
    const layout = layoutOf(node)
    const boxWidth = boxWidthOf(node, layout)
    const rects: CaretRect[] = []
    layout.lines.forEach((line, i) => {
      const start = line.start ?? 0
      const end = line.end ?? start + line.text.length
      const a = Math.max(lo, start)
      const b = Math.min(hi, end)
      if (b < a) return
      // An empty line inside the selection still shows, as a thin sliver, so a
      // selected blank line is visible rather than a gap in the highlight.
      if (b === a && !(lo <= start && hi > end)) return

      const originX = lineOffsetX(line.width, boxWidth, node.textStyle.align)
      const { top, height } = lineBox(node, layout, i)
      const x1 = originX + offsetInLine(layout, i, a)
      const x2 = originX + offsetInLine(layout, i, b)
      rects.push({ x: x1, y: top, width: Math.max(x2 - x1, b === a ? 3 : 0), height })
    })
    return rects
  } finally {
    UNIFORM_STYLE = null
  }
}

/**
 * The character index nearest a point in the node's local space.
 *
 * "Nearest" rather than "inside": a click past the end of a line belongs to the
 * end of that line, and a click below the last line belongs to the end of the
 * text, which is what makes dragging a selection off the bottom behave.
 */
export function indexAtPoint(node: TextNode, x: number, y: number): number {
  UNIFORM_STYLE = node.textStyle
  try {
    const layout = layoutOf(node)
    const boxWidth = boxWidthOf(node, layout)
    if (layout.lines.length === 0) return 0

    // The line whose box contains y, or the nearest one vertically.
    let lineIndex = layout.lines.length - 1
    for (let i = 0; i < layout.lines.length; i++) {
      const { top, height } = lineBox(node, layout, i)
      if (y < top + height) {
        lineIndex = i
        break
      }
    }

    const line = layout.lines[lineIndex]!
    const start = line.start ?? 0
    const originX = lineOffsetX(line.width, boxWidth, node.textStyle.align)
    const local = x - originX

    // Walk the characters and take the boundary the point is closest to, so
    // clicking the left half of a glyph puts the caret before it.
    let best = start
    let bestDistance = Infinity
    for (let i = 0; i <= line.text.length; i++) {
      const at = originX + offsetInLine(layout, lineIndex, start + i) - originX
      const distance = Math.abs(at - local)
      if (distance < bestDistance) {
        bestDistance = distance
        best = start + i
      }
    }
    return best
  } finally {
    UNIFORM_STYLE = null
  }
}
