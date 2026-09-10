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
 * The caret and selection for text that carries style runs.
 *
 * Ordinary text is edited in a real `<textarea>`, which draws its own caret and
 * highlight and is better at it than anything drawn by hand — that path is
 * untouched. But a textarea has one font, so a text object with runs is laid
 * out inside it as though every character were the same size: the caret ends up
 * where the plain version WOULD have put it, drifting a little further with
 * every word drawn larger or bolder.
 *
 * So for rich text the textarea stops drawing entirely and becomes an input
 * sink — it still owns the selection, the keyboard and the clipboard — while
 * the caret and highlight are drawn here, from the same layout that draws the
 * glyphs. They cannot disagree, because there is only one layout.
 */

import { memo } from 'react'
import { worldMatrix } from '../document/SceneGraph'
import { is3dAffected, nodeMapping } from '../document/Scene3D'
import { toSvgMatrix } from '../geometry/Matrix'
import { projectBox } from '../geometry/Perspective'
import { caretRect, selectionRects } from '../text/TextGeometry'
import { useDocument, useEditorStore } from '../state/hooks'

export const TextEditOverlay = memo(function TextEditOverlay() {
  const doc = useDocument()
  const editingId = useEditorStore((s) => s.editingTextId)
  const selection = useEditorStore((s) => s.textSelection)
  const focused = useEditorStore((s) => s.textEditingFocused)

  if (!editingId) return null
  const node = doc.nodes[editingId]
  // Uniform text keeps its native caret; there is nothing to improve on.
  if (node?.type !== 'text' || !node.runs?.length) return null
  if (!selection || selection.nodeId !== editingId) return null

  const collapsed = selection.end === selection.start
  const rects = collapsed ? [] : selectionRects(node, selection.start, selection.end)
  // The caret sits at the moving end of the selection, which is where a
  // textarea puts it and where the next keystroke will land.
  const caret = collapsed ? caretRect(node, selection.start) : null

  // Text in perspective: every rectangle is projected, as the glyphs are, so
  // the highlight lies on the tilted line rather than floating flat above it.
  if (is3dAffected(doc, editingId)) {
    const map = nodeMapping(doc, editingId).toWorld
    const quad = (r: { x: number; y: number; width: number; height: number }) =>
      (projectBox(map, r) ?? []).map((p) => `${p.x},${p.y}`).join(' ')
    return (
      <g className="text-edit-overlay" pointerEvents="none">
        {rects.map((r, i) => (
          <polygon key={i} className="text-selection-rect" points={quad(r)} />
        ))}
        {caret && focused && (
          <polygon className="text-caret" points={quad({ ...caret, width: Math.max(caret.width, 1) })} />
        )}
      </g>
    )
  }

  const matrix = toSvgMatrix(worldMatrix(doc, editingId))
  return (
    <g className="text-edit-overlay" transform={matrix} pointerEvents="none">
      {rects.map((r, i) => (
        <rect key={i} className="text-selection-rect" x={r.x} y={r.y} width={r.width} height={r.height} />
      ))}
      {caret && focused && (
        <rect
          className="text-caret"
          x={caret.x}
          y={caret.y}
          width={Math.max(caret.width, 1)}
          height={caret.height}
        />
      )}
    </g>
  )
})
