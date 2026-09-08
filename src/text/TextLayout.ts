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
 * Text measurement and line layout.
 *
 * Measurement uses a 2D canvas context rather than a hidden SVG <text> element:
 * measureText is faster, needs no layout flush, and gives real ascent/descent
 * metrics. The renderer emits one <tspan> per line using exactly the positions
 * computed here, so what is measured and what is drawn cannot drift.
 *
 * Callers must await ensureFontLoaded() first. Measuring an unloaded face
 * silently returns metrics for the *fallback* font, which is the classic reason
 * text boxes come out the wrong size until the user nudges them.
 */

import { fontStack } from './FontRegistry'
import { applyTextTransform } from '../document/types'
import type { Paint, TextRun, TextStyle } from '../document/types'

export interface TextLine {
  text: string
  width: number
  /** Baseline offset from the top of the text box. */
  baseline: number
  /**
   * The differently-styled pieces of this line, left to right.
   *
   * Absent for uniform text, which is the overwhelmingly common case and which
   * takes a code path unchanged from before rich text existed — so nothing
   * about ordinary text can regress through this.
   */
  segments?: TextSegment[]
}

/** One stretch of a line drawn in a single style. */
export interface TextSegment {
  text: string
  /** Fully resolved style: the node's textStyle with the run's overrides on top. */
  style: TextStyle
  width: number
  /** Offset from the start of the line. */
  x: number
  /** The run's fill override, when it had one. */
  fill?: Paint
}

export interface TextLayoutResult {
  lines: TextLine[]
  width: number
  height: number
  lineHeightPx: number
  ascent: number
}

let ctx: CanvasRenderingContext2D | null | undefined

function getContext(): CanvasRenderingContext2D | null {
  if (ctx !== undefined) return ctx
  try {
    if (typeof document === 'undefined') {
      ctx = null
    } else {
      ctx = document.createElement('canvas').getContext('2d')
    }
  } catch {
    ctx = null
  }
  return ctx
}

export function cssFont(style: TextStyle): string {
  const italic = style.fontStyle === 'italic' ? 'italic ' : ''
  return `${italic}${style.fontWeight} ${style.fontSize}px ${fontStack(style.fontFamily)}`
}

/**
 * Width of a single run of text.
 *
 * Falls back to a proportional estimate when no canvas is available (node tests),
 * so layout code stays exercisable without a DOM. The estimate is never used in
 * the browser.
 */
export function measureText(text: string, style: TextStyle): number {
  if (text.length === 0) return 0
  const c = getContext()
  if (!c) return estimateWidth(text, style)

  c.font = cssFont(style)
  const spacingPx = style.letterSpacing * style.fontSize
  // Modern engines support ctx.letterSpacing; when present let the engine apply
  // it so measurement matches SVG rendering exactly instead of approximately.
  const supportsSpacing = 'letterSpacing' in c
  if (supportsSpacing) {
    ;(c as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${spacingPx}px`
  }
  const w = c.measureText(text).width
  if (supportsSpacing) {
    ;(c as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0px'
    return w
  }
  return w + Math.max(0, text.length - 1) * spacingPx
}

function estimateWidth(text: string, style: TextStyle): number {
  // Rough average advance for latin text; only used in DOM-less environments.
  const ratio = style.fontFamily.toLowerCase().includes('mono') ? 0.6 : 0.52
  return text.length * style.fontSize * ratio + Math.max(0, text.length - 1) * style.letterSpacing * style.fontSize
}

export interface FontMetrics {
  ascent: number
  descent: number
}

export function fontMetrics(style: TextStyle): FontMetrics {
  const c = getContext()
  if (!c) return { ascent: style.fontSize * 0.8, descent: style.fontSize * 0.2 }
  c.font = cssFont(style)
  const m = c.measureText('Hg')
  const ascent = m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent ?? style.fontSize * 0.8
  const descent = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent ?? style.fontSize * 0.2
  return { ascent, descent }
}

/**
 * Break text into laid-out lines.
 *
 * Explicit newlines always break. Wrapping happens for both sizing modes that
 * own their width — Auto Height and Fixed Size — and never for Auto Width,
 * whose whole purpose is to grow sideways instead of wrapping.
 *
 * Paragraph spacing is added AFTER each paragraph but the last, so a single
 * paragraph is unaffected and a trailing gap never appears below the text.
 * The transformation is applied here rather than to the stored text, which is
 * what lets None give back exactly what was typed.
 */
export function layoutText(
  text: string,
  style: TextStyle,
  maxWidth?: number,
  runs?: readonly TextRun[],
): TextLayoutResult {
  if (runs?.length) return layoutRich(text, style, maxWidth, runs)
  const lineHeightPx = style.fontSize * style.lineHeight
  const { ascent } = fontMetrics(style)
  // Center the text within its line box rather than sitting on the em baseline.
  const baselineOffset = (lineHeightPx - style.fontSize) / 2 + ascent

  const paragraphs = applyTextTransform(text, style.transform).split('\n')
  const wrapping = style.sizing !== 'auto-width' && !!maxWidth && maxWidth > 0
  const paragraphGap = Math.max(0, style.paragraphSpacing)

  const out: TextLine[] = []
  // Extra space accumulated from the paragraph breaks passed so far.
  const offsets: number[] = []
  let accumulated = 0
  paragraphs.forEach((paragraph, i) => {
    const lines = wrapping
      ? wrapParagraph(paragraph, style, maxWidth!)
      : [{ text: paragraph, width: measureText(paragraph, style), baseline: 0 }]
    for (const line of lines) {
      out.push(line)
      offsets.push(accumulated)
    }
    if (i < paragraphs.length - 1) accumulated += paragraphGap
  })

  let widest = 0
  out.forEach((line, i) => {
    line.baseline = baselineOffset + i * lineHeightPx + offsets[i]!
    if (line.width > widest) widest = line.width
  })

  return {
    lines: out,
    width: widest,
    height: Math.max(lineHeightPx, out.length * lineHeightPx + accumulated),
    lineHeightPx,
    ascent,
  }
}

// ---------------------------------------------------------------------------
// Rich text
// ---------------------------------------------------------------------------

/**
 * Layout for text whose characters do not all share one style.
 *
 * Kept as a separate path rather than generalizing the uniform one. Mixed
 * styling changes three things at once — measurement is per piece, a line's
 * height and baseline come from the tallest piece on it rather than from the
 * node, and wrapping has to split tokens at run boundaries — and folding all of
 * that into the common path would put the cost and the risk on every text
 * object in every document to serve the few that need it.
 *
 * Character indices are tracked through wrapping so a line can be mapped back
 * to the runs it covers. Text transforms are applied per character, so a
 * transform that changes a string's length (ß to SS) would shift the mapping;
 * that is noted rather than handled, because the alternative is to lay out
 * transformed text against untransformed indices, which is worse.
 */
function layoutRich(
  text: string,
  base: TextStyle,
  maxWidth: number | undefined,
  runs: readonly TextRun[],
): TextLayoutResult {
  const transformed = applyTextTransform(text, base.transform)
  const styleAt = buildStyleIndex(transformed.length, base, runs)

  const wrapping = base.sizing !== 'auto-width' && !!maxWidth && maxWidth > 0
  const paragraphGap = Math.max(0, base.paragraphSpacing)

  const lines: TextLine[] = []
  const gaps: number[] = []
  let accumulated = 0

  let cursor = 0
  const paragraphs = transformed.split('\n')
  paragraphs.forEach((paragraph, i) => {
    const start = cursor
    cursor += paragraph.length + 1 // the newline itself
    const ranges = wrapping
      ? wrapRangesRich(paragraph, start, styleAt, maxWidth!)
      : [{ from: start, to: start + paragraph.length }]
    for (const range of ranges) {
      lines.push(buildRichLine(transformed, range.from, range.to, styleAt))
      gaps.push(accumulated)
    }
    if (i < paragraphs.length - 1) accumulated += paragraphGap
  })

  // Each line is as tall as its tallest piece, so a larger run pushes the lines
  // after it down rather than overlapping them.
  let y = 0
  let widest = 0
  let firstAscent = 0
  let lastLineHeight = base.fontSize * base.lineHeight
  lines.forEach((line, i) => {
    const metrics = lineMetrics(line, base)
    if (i === 0) firstAscent = metrics.ascent
    lastLineHeight = metrics.lineHeightPx
    line.baseline =
      y + gaps[i]! + (metrics.lineHeightPx - metrics.fontSize) / 2 + metrics.ascent
    y += metrics.lineHeightPx
    if (line.width > widest) widest = line.width
  })

  return {
    lines,
    width: widest,
    height: Math.max(lastLineHeight, y + accumulated),
    lineHeightPx: base.fontSize * base.lineHeight,
    ascent: firstAscent || fontMetrics(base).ascent,
  }
}

/** The resolved style for every character index, shared where runs agree. */
function buildStyleIndex(
  length: number,
  base: TextStyle,
  runs: readonly TextRun[],
): Array<{ style: TextStyle; fill?: Paint }> {
  const out = new Array<{ style: TextStyle; fill?: Paint }>(length)
  const plain = { style: base }
  for (let i = 0; i < length; i++) out[i] = plain
  for (const run of runs) {
    // One resolved object per run, so segment building can compare by identity.
    const resolved = { style: { ...base, ...run.style }, ...(run.fill ? { fill: run.fill } : {}) }
    const from = Math.max(0, run.start)
    const to = Math.min(length, run.end)
    for (let i = from; i < to; i++) out[i] = resolved
  }
  return out
}

/** Split [from, to) at style boundaries, measuring and positioning each piece. */
function buildRichLine(
  text: string,
  from: number,
  to: number,
  styleAt: ReadonlyArray<{ style: TextStyle; fill?: Paint }>,
): TextLine {
  const segments: TextSegment[] = []
  let x = 0
  let i = from
  while (i < to) {
    const entry = styleAt[i] ?? { style: styleAt[from]!.style }
    let j = i + 1
    while (j < to && styleAt[j] === entry) j++
    const piece = text.slice(i, j)
    const width = measureText(piece, entry.style)
    segments.push({ text: piece, style: entry.style, width, x, ...(entry.fill ? { fill: entry.fill } : {}) })
    x += width
    i = j
  }
  return { text: text.slice(from, to), width: x, baseline: 0, segments }
}

/** The tallest piece on a line decides its metrics. */
function lineMetrics(
  line: TextLine,
  base: TextStyle,
): { lineHeightPx: number; ascent: number; fontSize: number } {
  let lineHeightPx = 0
  let ascent = 0
  let fontSize = 0
  for (const seg of line.segments ?? []) {
    lineHeightPx = Math.max(lineHeightPx, seg.style.fontSize * seg.style.lineHeight)
    ascent = Math.max(ascent, fontMetrics(seg.style).ascent)
    fontSize = Math.max(fontSize, seg.style.fontSize)
  }
  if (lineHeightPx === 0) {
    lineHeightPx = base.fontSize * base.lineHeight
    ascent = fontMetrics(base).ascent
    fontSize = base.fontSize
  }
  return { lineHeightPx, ascent, fontSize }
}

/** Wrap one paragraph, returning character ranges rather than strings. */
function wrapRangesRich(
  paragraph: string,
  offset: number,
  styleAt: ReadonlyArray<{ style: TextStyle; fill?: Paint }>,
  maxWidth: number,
): Array<{ from: number; to: number }> {
  if (paragraph.length === 0) return [{ from: offset, to: offset }]

  const widthOf = (from: number, to: number) => {
    let w = 0
    let i = from
    while (i < to) {
      const entry = styleAt[i]!
      let j = i + 1
      while (j < to && styleAt[j] === entry) j++
      w += measureText(paragraph.slice(i - offset, j - offset), entry.style)
      i = j
    }
    return w
  }

  const out: Array<{ from: number; to: number }> = []
  let lineStart = offset
  let lastBreak = -1
  let i = offset
  const end = offset + paragraph.length

  while (i < end) {
    const ch = paragraph[i - offset]!
    if (/\s/.test(ch)) lastBreak = i

    if (widthOf(lineStart, i + 1) > maxWidth && i > lineStart) {
      if (lastBreak > lineStart) {
        // Break at the space, and swallow it rather than starting a line with it.
        out.push({ from: lineStart, to: lastBreak })
        lineStart = lastBreak + 1
        i = lineStart
        lastBreak = -1
        continue
      }
      // A single word wider than the box has to be broken mid-word.
      out.push({ from: lineStart, to: i })
      lineStart = i
      lastBreak = -1
      continue
    }
    i++
  }
  out.push({ from: lineStart, to: end })
  return out
}

function wrapParagraph(paragraph: string, style: TextStyle, maxWidth: number): TextLine[] {
  if (paragraph.length === 0) return [{ text: '', width: 0, baseline: 0 }]

  const words = paragraph.split(/(\s+)/)
  const lines: TextLine[] = []
  let current = ''

  const push = () => {
    lines.push({ text: current, width: measureText(current, style), baseline: 0 })
    current = ''
  }

  for (const token of words) {
    const candidate = current + token
    if (measureText(candidate, style) <= maxWidth || current === '') {
      current = candidate
      // A single token wider than the box must be broken, or it overflows.
      if (current !== '' && measureText(current, style) > maxWidth && !/\s/.test(token)) {
        const broken = breakLongWord(current, style, maxWidth)
        for (let i = 0; i < broken.length - 1; i++) {
          current = broken[i]!
          push()
        }
        current = broken[broken.length - 1] ?? ''
      }
    } else {
      const trimmed = current.replace(/\s+$/, '')
      current = trimmed
      push()
      current = token.replace(/^\s+/, '')
    }
  }
  if (current !== '' || lines.length === 0) push()
  return lines
}

function breakLongWord(word: string, style: TextStyle, maxWidth: number): string[] {
  const parts: string[] = []
  let chunk = ''
  for (const ch of word) {
    if (chunk && measureText(chunk + ch, style) > maxWidth) {
      parts.push(chunk)
      chunk = ch
    } else {
      chunk += ch
    }
  }
  if (chunk) parts.push(chunk)
  return parts.length ? parts : [word]
}

/** X offset of a line within the box, per alignment. */
export function lineOffsetX(lineWidth: number, boxWidth: number, align: TextStyle['align']): number {
  switch (align) {
    case 'center': return (boxWidth - lineWidth) / 2
    case 'right': return boxWidth - lineWidth
    default: return 0
  }
}

/** Natural size of a text node, used to auto-grow its box while typing. */
export function intrinsicTextSize(
  text: string,
  style: TextStyle,
  maxWidth?: number,
  runs?: readonly TextRun[],
): { width: number; height: number } {
  const layout = layoutText(text, style, maxWidth, runs)
  return {
    width: Math.max(1, Math.ceil(layout.width)),
    height: Math.max(1, Math.ceil(layout.height)),
  }
}


/**
 * Where the misspelled words sit on a laid-out line.
 *
 * Offsets are measured by re-measuring each prefix, which is the only way to
 * place an underline under a word inside a <tspan>: SVG gives no per-character
 * geometry until it has laid the text out, and by then the answer is needed.
 *
 * Returns nothing at all when spell check is off or its dictionaries have not
 * arrived, so the caller pays nothing for a feature that is not running.
 */
export function misspelledRuns(
  line: string,
  style: TextStyle,
  check: (word: string) => boolean,
): Array<{ x: number; width: number }> {
  if (!line) return []
  const runs: Array<{ x: number; width: number }> = []
  // Split keeping the separators, so prefix widths stay exact.
  const parts = line.split(/(\s+)/)
  let offset = 0
  for (const part of parts) {
    const width = measureText(part, style)
    if (part.trim() && check(part)) runs.push({ x: offset, width })
    offset += width
  }
  return runs
}
