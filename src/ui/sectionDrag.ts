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
 * Rearranging the column by dragging a section's title.
 *
 * The press becomes a drag only past a few pixels, so a click on a title does
 * nothing it did not do before. While dragging, the section under the pointer
 * shows a line where the dragged one would land — above whichever section's
 * middle the pointer is above — and the column scrolls when the pointer nears
 * its top or bottom. Letting go moves the section; Escape puts everything back.
 *
 * The sections are found in the DOM in the order they are DRAWN, which is the
 * CSS order the saved arrangement gives them, not the order they sit in the
 * markup — that is what makes "above this one" mean what it looks like.
 */

import { editorStore, moveSection, type PanelSection } from '../state/EditorStore'

/** Movement before a press on a title counts as a drag, in screen pixels. */
const DRAG_THRESHOLD_PX = 4
/** How near the column's edge the pointer has to be to scroll it. */
const EDGE_PX = 28
const SCROLL_STEP_PX = 12

export function beginSectionDrag(e: React.PointerEvent<HTMLElement>, id: PanelSection): void {
  if (e.button !== 0) return
  // The title's own buttons — the 3D cube, the code's copy button — keep
  // their clicks.
  if ((e.target as Element).closest('button, input, select, textarea, label, a')) return
  const column = e.currentTarget.closest<HTMLElement>('.inspector-scroll')
  if (!column) return
  // No text selection sweeping across the panel while the title is dragged.
  e.preventDefault()

  const startY = e.clientY
  let started = false

  const targetAt = (y: number): PanelSection | null => {
    const sections = Array.from(column.querySelectorAll<HTMLElement>(':scope > .section[data-section]'))
      .map((el) => ({ el, rect: el.getBoundingClientRect() }))
      .sort((a, b) => a.rect.top - b.rect.top)
    for (const { el, rect } of sections) {
      if (y < rect.top + rect.height / 2) return el.dataset.section as PanelSection
    }
    return null
  }

  const onMove = (ev: PointerEvent) => {
    if (!started) {
      if (Math.abs(ev.clientY - startY) < DRAG_THRESHOLD_PX) return
      started = true
      document.body.classList.add('section-reordering')
    }
    const box = column.getBoundingClientRect()
    if (ev.clientY < box.top + EDGE_PX) column.scrollTop -= SCROLL_STEP_PX
    else if (ev.clientY > box.bottom - EDGE_PX) column.scrollTop += SCROLL_STEP_PX
    const over = targetAt(ev.clientY)
    const current = editorStore.getState().sectionDrag
    if (current?.id !== id || current.over !== over) editorStore.setState({ sectionDrag: { id, over } })
  }

  const finish = (commit: boolean) => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
    window.removeEventListener('keydown', onKey, true)
    document.body.classList.remove('section-reordering')
    const drag = editorStore.getState().sectionDrag
    editorStore.setState({ sectionDrag: null })
    if (commit && started && drag) moveSection(drag.id, drag.over)
  }
  const onUp = () => finish(true)
  const onCancel = () => finish(false)
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return
    ev.preventDefault()
    ev.stopPropagation()
    finish(false)
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onCancel)
  window.addEventListener('keydown', onKey, true)
}
