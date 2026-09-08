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
 * The document's colour palette.
 *
 * Swatches are document data, like guides — the palette travels with the
 * artwork rather than living in one browser's storage — so the things worth
 * pinning are the round trip and the absent-means-empty default.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { addSwatch, moveSwatch, removeSwatch } from '@/history/Commands'
import { createDocument } from '@/document/NodeFactory'
import { replaceDocument, getDoc, undo } from '@/state/DocumentStore'
import { deserializeDocument, serializeDocument, FORMAT_NAME } from '@/persistence/FileFormat'

const ORANGE = { r: 232, g: 163, b: 61, a: 1 }
const BLUE = { r: 43, g: 138, b: 198, a: 1 }
const HALF_RED = { r: 220, g: 40, b: 40, a: 0.5 }

beforeEach(() => {
  replaceDocument(createDocument('Swatches', false))
})

describe('document swatches', () => {
  it('a new document has none', () => {
    expect(getDoc().swatches).toEqual([])
  })

  it('adds, keeps order, and refuses an exact duplicate', () => {
    expect(addSwatch(ORANGE)).toBe(true)
    expect(addSwatch(BLUE)).toBe(true)
    expect(getDoc().swatches.map((s) => s.color)).toEqual([ORANGE, BLUE])

    // Saving the colour you already saved is a no-op, not a second chip.
    expect(addSwatch({ ...ORANGE })).toBe(false)
    expect(getDoc().swatches).toHaveLength(2)
  })

  it('keeps opacity, so a translucent swatch stays translucent', () => {
    addSwatch(HALF_RED)
    expect(getDoc().swatches[0]!.color.a).toBe(0.5)
    // ...and the same colour at a different opacity is a different swatch.
    expect(addSwatch({ ...HALF_RED, a: 1 })).toBe(true)
    expect(getDoc().swatches).toHaveLength(2)
  })

  it('removes and reorders', () => {
    addSwatch(ORANGE)
    addSwatch(BLUE)
    const [first, second] = getDoc().swatches
    expect(moveSwatch(second!.id, 0)).toBe(true)
    expect(getDoc().swatches.map((s) => s.id)).toEqual([second!.id, first!.id])

    expect(removeSwatch(first!.id)).toBe(true)
    expect(getDoc().swatches.map((s) => s.id)).toEqual([second!.id])
    expect(removeSwatch('nope')).toBe(false)
  })

  it('is an ordinary undoable edit', () => {
    addSwatch(ORANGE)
    expect(getDoc().swatches).toHaveLength(1)
    undo()
    expect(getDoc().swatches).toHaveLength(0)
  })

  it('round-trips through the file format, opacity and order intact', () => {
    addSwatch(ORANGE)
    addSwatch(HALF_RED)
    const back = deserializeDocument(serializeDocument(getDoc()))
    expect(back.swatches.map((s) => s.color)).toEqual([ORANGE, HALF_RED])
    expect(back.swatches[0]!.id).toBe(getDoc().swatches[0]!.id)
  })

  it('a document written before swatches existed loads with an empty palette', () => {
    // Purely additive, so no version bump: an older build simply ignores the key
    // and a file without it is not a migration, just an empty palette.
    const doc = getDoc()
    const payload = JSON.parse(new TextDecoder().decode(serializeDocument(doc, { plainJson: true })))
    delete payload.document.swatches
    expect(payload.format).toBe(FORMAT_NAME)
    const back = deserializeDocument(new TextEncoder().encode(JSON.stringify(payload)))
    expect(back.swatches).toEqual([])
  })

  it('drops a malformed swatch rather than failing the whole load', () => {
    addSwatch(ORANGE)
    const payload = JSON.parse(new TextDecoder().decode(serializeDocument(getDoc(), { plainJson: true })))
    payload.document.swatches.push({ id: 'broken' }, { color: { r: 1, g: 2, b: 3, a: 1 } })
    const back = deserializeDocument(new TextEncoder().encode(JSON.stringify(payload)))
    expect(back.swatches).toHaveLength(1)
    expect(back.swatches[0]!.color).toEqual(ORANGE)
  })
})
