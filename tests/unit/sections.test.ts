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
 * The arrangement of the right-hand column.
 *
 * The order is stored whole — every section, shown or not — and comes back
 * complete from anything: a build that has added a section since, a value
 * somebody edited, nothing at all.
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  cleanSectionOrder, editorStore, moveSection, PANEL_SECTIONS, resetSectionOrder,
} from '@/state/EditorStore'

describe('the section order', () => {
  beforeEach(() => {
    localStorage.clear()
    resetSectionOrder()
  })

  it('starts as the column has always stood', () => {
    expect(editorStore.getState().sectionOrder).toEqual([...PANEL_SECTIONS])
  })

  it('moves a section to just before another, or to the end', () => {
    moveSection('export', 'transform')
    let order = editorStore.getState().sectionOrder
    expect(order.indexOf('export')).toBe(order.indexOf('transform') - 1)

    moveSection('transform', null)
    order = editorStore.getState().sectionOrder
    expect(order.at(-1)).toBe('transform')
    expect(order).toHaveLength(PANEL_SECTIONS.length)
  })

  it('is remembered', () => {
    moveSection('fill', 'align')
    expect(JSON.parse(localStorage.getItem('xdesign.sectionOrder')!)).toEqual(editorStore.getState().sectionOrder)
  })

  it('puts a section a saved order does not mention back after the one it follows by default', () => {
    // As if saved before Inner Shadow existed, with Drop Shadow moved to the top.
    const saved = PANEL_SECTIONS.filter((id) => id !== 'innerShadow' && id !== 'dropShadow')
    const order = cleanSectionOrder(['dropShadow', ...saved])
    expect(order[0]).toBe('dropShadow')
    // Beside Drop Shadow, which it follows by default — wherever that went.
    expect(order[1]).toBe('innerShadow')
    expect(order).toHaveLength(PANEL_SECTIONS.length)
  })

  it('makes a whole order out of anything', () => {
    for (const junk of [null, 'order', 42, [1, 2], ['fill', 'fill', 'unknown']]) {
      const order = cleanSectionOrder(junk)
      expect([...order].sort()).toEqual([...PANEL_SECTIONS].sort())
    }
  })
})
