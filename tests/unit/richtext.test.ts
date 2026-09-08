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
 * Rich text: ranges over one string, rather than a tree of spans.
 *
 * The invariant these guard is that `runs` absent behaves exactly as text
 * behaved before rich text existed — that path is untouched, and every document
 * already saved is on it.
 */
import { describe, it, expect } from 'vitest'
import { layoutText } from '@/text/TextLayout'
import { DEFAULT_TEXT_STYLE, normalizeRuns, shiftRuns } from '@/document/types'
import type { TextRun } from '@/document/types'

const base = { ...DEFAULT_TEXT_STYLE, sizing: 'auto-width' as const }

describe('layout without runs is untouched', () => {
  it('produces no segments at all', () => {
    const r = layoutText('Hello world', base)
    expect(r.lines).toHaveLength(1)
    expect(r.lines[0]!.segments).toBeUndefined()
  })

  it('matches whether runs is undefined or an empty array', () => {
    expect(layoutText('Hello', base, undefined, [])).toEqual(layoutText('Hello', base))
  })
})

describe('layout with runs', () => {
  it('splits a line into segments at the run boundaries', () => {
    const runs: TextRun[] = [{ start: 6, end: 11, style: { fontWeight: 700 } }]
    const line = layoutText('Hello world', base, undefined, runs).lines[0]!
    expect(line.segments?.map((s) => s.text)).toEqual(['Hello ', 'world'])
    expect(line.segments![0]!.style.fontWeight).toBe(DEFAULT_TEXT_STYLE.fontWeight)
    expect(line.segments![1]!.style.fontWeight).toBe(700)
  })

  it('positions each segment after the one before it', () => {
    const runs: TextRun[] = [{ start: 6, end: 11, style: { fontWeight: 700 } }]
    const line = layoutText('Hello world', base, undefined, runs).lines[0]!
    const [a, b] = line.segments!
    expect(a!.x).toBe(0)
    expect(b!.x).toBeCloseTo(a!.width, 6)
    expect(line.width).toBeCloseTo(a!.width + b!.width, 6)
  })

  it('carries a run fill onto its segment', () => {
    const fill = { type: 'solid' as const, color: { r: 255, g: 0, b: 0, a: 1 } }
    const runs: TextRun[] = [{ start: 0, end: 5, fill }]
    const line = layoutText('Hello world', base, undefined, runs).lines[0]!
    expect(line.segments![0]!.fill).toEqual(fill)
    expect(line.segments![1]!.fill).toBeUndefined()
  })

  it('takes a line’s height from its tallest run', () => {
    const big: TextRun[] = [{ start: 0, end: 5, style: { fontSize: 48 } }]
    const tall = layoutText('Hello', base, undefined, big)
    const plain = layoutText('Hello', base)
    expect(tall.lines[0]!.baseline).toBeGreaterThan(plain.lines[0]!.baseline)
    expect(tall.height).toBeGreaterThan(plain.height)
  })

  it('keeps paragraphs on separate lines', () => {
    const runs: TextRun[] = [{ start: 0, end: 3, style: { fontWeight: 700 } }]
    const r = layoutText('one\ntwo', base, undefined, runs)
    expect(r.lines.map((l) => l.text)).toEqual(['one', 'two'])
  })

  it('wraps at spaces and does not start a line with the space', () => {
    const runs: TextRun[] = [{ start: 0, end: 3, style: { fontWeight: 700 } }]
    const r = layoutText('aaa bbb ccc', { ...base, sizing: 'auto-height' }, 40, runs)
    expect(r.lines.length).toBeGreaterThan(1)
    for (const line of r.lines) expect(line.text.startsWith(' ')).toBe(false)
  })

  it('reassembles to the original text across every line', () => {
    const runs: TextRun[] = [{ start: 4, end: 9, style: { fontSize: 20 } }]
    // Wide enough that every word fits, so wrapping only breaks at spaces.
    const r = layoutText('some styled words here', { ...base, sizing: 'auto-height' }, 200, runs)
    expect(r.lines.length).toBeGreaterThan(1)
    // Wrapping swallows the break spaces, so compare without them.
    expect(r.lines.map((l) => l.text).join(' ')).toBe('some styled words here')
  })

  it('breaks mid-word only when a single word is wider than the box', () => {
    const runs: TextRun[] = [{ start: 0, end: 4, style: { fontWeight: 700 } }]
    const r = layoutText('supercalifragilistic', { ...base, sizing: 'auto-height' }, 50, runs)
    expect(r.lines.length).toBeGreaterThan(1)
    expect(r.lines.map((l) => l.text).join('')).toBe('supercalifragilistic')
  })
})

describe('normalizeRuns', () => {
  it('drops empty, styleless and out-of-range runs', () => {
    expect(normalizeRuns([{ start: 3, end: 3, style: { fontSize: 9 } }], 10)).toBeUndefined()
    expect(normalizeRuns([{ start: 0, end: 4 }], 10)).toBeUndefined()
    expect(normalizeRuns([], 10)).toBeUndefined()
  })

  it('clamps to the text length', () => {
    expect(normalizeRuns([{ start: 2, end: 99, style: { fontSize: 9 } }], 5))
      .toEqual([{ start: 2, end: 5, style: { fontSize: 9 } }])
  })

  it('merges touching runs that say the same thing', () => {
    const merged = normalizeRuns(
      [
        { start: 0, end: 2, style: { fontSize: 9 } },
        { start: 2, end: 4, style: { fontSize: 9 } },
      ],
      10,
    )
    expect(merged).toEqual([{ start: 0, end: 4, style: { fontSize: 9 } }])
  })

  it('keeps touching runs that differ', () => {
    expect(
      normalizeRuns(
        [
          { start: 0, end: 2, style: { fontSize: 9 } },
          { start: 2, end: 4, style: { fontSize: 12 } },
        ],
        10,
      ),
    ).toHaveLength(2)
  })
})

describe('shiftRuns follows an edit', () => {
  const runs: TextRun[] = [{ start: 6, end: 11, style: { fontWeight: 700 } }]

  it('moves a run right when text is inserted before it', () => {
    // "Hello world" -> "Say Hello world": 4 chars inserted at 0.
    expect(shiftRuns(runs, 0, 0, 4, 15)).toEqual([{ start: 10, end: 15, style: { fontWeight: 700 } }])
  })

  it('moves a run left when text before it is deleted', () => {
    // Delete "Hello " (0..6).
    expect(shiftRuns(runs, 0, 6, 0, 5)).toEqual([{ start: 0, end: 5, style: { fontWeight: 700 } }])
  })

  it('drops a run whose characters were all deleted', () => {
    expect(shiftRuns(runs, 0, 11, 0, 0)).toBeUndefined()
  })

  it('leaves a run alone when the edit is after it', () => {
    expect(shiftRuns(runs, 11, 11, 3, 14)).toEqual(runs)
  })
})
