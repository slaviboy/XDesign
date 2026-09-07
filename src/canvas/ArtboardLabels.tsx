/**
 * Artboard name labels.
 *
 * Drawn in screen space above each artboard so they stay legible at any zoom,
 * and are never part of the document — clicking one selects the artboard, but
 * nothing here can be exported.
 */

import { memo } from 'react'
import { docToScreen } from './Viewport'
import { geometryBounds, artboardIds } from '../document/SceneGraph'
import { setSelection } from '../state/EditorStore'
import { useDocument, useEditorStore } from '../state/hooks'

export const ArtboardLabels = memo(function ArtboardLabels() {
  const doc = useDocument()
  const viewport = useEditorStore((s) => s.viewport)
  const selection = useEditorStore((s) => s.selection)
  const boards = artboardIds(doc)
  if (boards.length === 0) return null

  return (
    <g className="artboard-labels">
      {boards.map((id) => {
        const node = doc.nodes[id]
        if (!node || !node.visible) return null
        const bounds = geometryBounds(doc, id)
        const p = docToScreen(viewport, { x: bounds.x, y: bounds.y })
        // Skip labels that have scrolled out of view.
        if (p.y < -40 || p.y > 4000) return null
        return (
          <text
            key={id}
            className={`artboard-label${selection.includes(id) ? ' selected' : ''}`}
            x={p.x}
            y={p.y - 7}
            pointerEvents="all"
            onPointerDown={(e) => {
              e.stopPropagation()
              setSelection([id])
            }}
          >
            {node.name}
          </text>
        )
      })}
    </g>
  )
})
