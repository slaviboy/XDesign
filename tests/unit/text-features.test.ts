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
 * Text layout, distance measurement and the spell checker's search.
 *
 * These are the parts that can be wrong in ways a screenshot will not show: an
 * off-by-one in a binary search reports real words as misspelled, and a
 * paragraph gap counted once too often drifts further down every paragraph.
 */

import { describe, it, expect } from 'vitest'
import { DEFAULT_TEXT_STYLE, applyTextTransform, type TextStyle } from '../../src/document/types'
import { layoutText } from '../../src/text/TextLayout'
import { buildDictionary, contains, normalise } from '../../src/text/spellcheck'
import { measureBetween } from '../../src/geometry/Distance'

const style = (patch: Partial<TextStyle> = {}): TextStyle => ({ ...DEFAULT_TEXT_STYLE, ...patch })

// ----------------------------------------------------------- resize modes --

describe('text resize options', () => {
  const text = 'one two three four five six seven eight'

  it('Auto Width never wraps, whatever width it is given', () => {
    // The mode exists to grow sideways; wrapping would defeat it.
    const laid = layoutText(text, style({ sizing: 'auto-width' }), 40)
    expect(laid.lines).toHaveLength(1)
  })

  it('Auto Height and Fixed Size both wrap to the width they are given', () => {
    for (const sizing of ['auto-height', 'fixed'] as const) {
      const laid = layoutText(text, style({ sizing }), 80)
      expect(laid.lines.length, sizing).toBeGreaterThan(1)
    }
  })

  it('a narrower box is a taller one', () => {
    const wide = layoutText(text, style({ sizing: 'auto-height' }), 300)
    const narrow = layoutText(text, style({ sizing: 'auto-height' }), 80)
    expect(narrow.height).toBeGreaterThan(wide.height)
  })
})

// ------------------------------------------------------ paragraph spacing --

describe('paragraph spacing', () => {
  it('goes between paragraphs and not after the last one', () => {
    const plain = layoutText('a\nb\nc', style({ paragraphSpacing: 0 }))
    const spaced = layoutText('a\nb\nc', style({ paragraphSpacing: 20 }))
    // Two gaps for three paragraphs, so the box grows by exactly 40 — not 60,
    // which is what a trailing gap would give.
    expect(spaced.height - plain.height).toBeCloseTo(40, 5)
  })

  it('pushes each paragraph down by the gaps above it, not by one gap', () => {
    const laid = layoutText('a\nb\nc', style({ paragraphSpacing: 20 }))
    const [first, second, third] = laid.lines
    expect(second!.baseline - first!.baseline).toBeCloseTo(laid.lineHeightPx + 20, 5)
    expect(third!.baseline - second!.baseline).toBeCloseTo(laid.lineHeightPx + 20, 5)
  })

  it('leaves a single paragraph alone', () => {
    expect(layoutText('only', style({ paragraphSpacing: 50 })).height).toBeCloseTo(
      layoutText('only', style({ paragraphSpacing: 0 })).height,
      5,
    )
  })
})

// ----------------------------------------------------------- transformations --

describe('text transformations', () => {
  it('changes what is drawn, per Adobe\'s three', () => {
    expect(applyTextTransform('hello World', 'uppercase')).toBe('HELLO WORLD')
    expect(applyTextTransform('hello World', 'lowercase')).toBe('hello world')
    expect(applyTextTransform('hello world', 'titlecase')).toBe('Hello World')
    expect(applyTextTransform('hello World', 'none')).toBe('hello World')
  })

  it('is reversible, because the stored text is never touched', () => {
    // Round-tripping through a transform and back to None must give the
    // original — which is only true because None reads the source, not the
    // last thing that was drawn.
    const original = 'iPhone and MacBook'
    expect(applyTextTransform(original, 'none')).toBe(original)
  })

  it('title case leaves the rest of a word lower', () => {
    expect(applyTextTransform('mcDONALD', 'titlecase')).toBe('Mcdonald')
  })
})

// -------------------------------------------------------------- spellcheck --

describe('dictionary search', () => {
  // Sorted the same way the build script sorts: UTF-16 code units.
  const words = ['apple', 'banana', 'cherry', 'date', 'elderberry', 'fig', 'grape']
  const dictionary = buildDictionary(words.join('\n'))

  it('finds every word in the list, including the ends', () => {
    for (const word of words) expect(contains(dictionary, word), word).toBe(true)
  })

  it('rejects words that are not there, including either side of the range', () => {
    for (const word of ['aardvark', 'blueberry', 'zzz', 'appl', 'apples']) {
      expect(contains(dictionary, word), word).toBe(false)
    }
  })

  it('handles a one-word and an empty dictionary', () => {
    expect(contains(buildDictionary('solo'), 'solo')).toBe(true)
    expect(contains(buildDictionary('solo'), 'duo')).toBe(false)
    expect(contains(buildDictionary(''), 'anything')).toBe(false)
  })

  it('normalises away what is not a word', () => {
    expect(normalise('Hello,')).toBe('hello')
    expect(normalise('“quoted”')).toBe('quoted')
    expect(normalise("don't")).toBe("don't")
    // Never flagged: a measurement, a single letter, a symbol.
    expect(normalise('3.5')).toBe('')
    expect(normalise('h1')).toBe('')
    expect(normalise('a')).toBe('')
    expect(normalise('—')).toBe('')
  })
})

// ---------------------------------------------------------------- distance --

describe('measureBetween', () => {
  const a = { x: 0, y: 0, width: 100, height: 100 }

  it('reports the gap on an axis the boxes are separated on', () => {
    const gaps = measureBetween(a, { x: 180, y: 300, width: 50, height: 50 })
    expect(gaps.horizontal?.distance).toBe(80)
    expect(gaps.vertical?.distance).toBe(200)
  })

  it('reports nothing on an axis they overlap on', () => {
    // Side by side: there is a horizontal gap and no vertical one, because a
    // negative distance drawn between them would be a picture of nothing.
    const gaps = measureBetween(a, { x: 200, y: 20, width: 50, height: 50 })
    expect(gaps.horizontal?.distance).toBe(100)
    expect(gaps.vertical).toBeNull()
  })

  it('measures in either direction', () => {
    expect(measureBetween(a, { x: -80, y: 0, width: 30, height: 100 }).horizontal?.distance).toBe(50)
  })

  it('runs the line through the shared span when there is one', () => {
    const gaps = measureBetween(a, { x: 200, y: 40, width: 50, height: 20 })
    // Overlap on Y is 40..60, so the line sits at 50.
    expect(gaps.horizontal?.at).toBe(50)
  })

  it('two boxes that overlap on both axes have no distance at all', () => {
    const gaps = measureBetween(a, { x: 50, y: 50, width: 100, height: 100 })
    expect(gaps.horizontal).toBeNull()
    expect(gaps.vertical).toBeNull()
  })
})
