/**
 * User guides.
 *
 * Stored in the document (so they are saved and restored) but never exported —
 * the exporter walks the scene graph, and guides are not nodes.
 *
 * Dragging one is handled here rather than through a tool: guides are chrome,
 * and routing them through the tool system would mean every tool had to know
 * about them.
 */

import { memo, useCallback, useRef } from 'react'
import { moveGuide, removeGuide } from '../history/Commands'
import { visibleDocBounds } from './Viewport'
import { useDocumentStore, useEditorStore } from '../state/hooks'

export const GuidesOverlay = memo(function GuidesOverlay() {
  const guides = useDocumentStore((s) => s.doc.guides)
  const visible = useDocumentStore((s) => s.doc.settings.guidesVisible)
  const viewport = useEditorStore((s) => s.viewport)
  const canvasSize = useEditorStore((s) => s.canvasSize)
  const draggingRef = useRef<string | null>(null)

  const onPointerDown = useCallback((e: React.PointerEvent<SVGLineElement>, id: string) => {
    e.stopPropagation()
    // Alt-click removes a guide, matching the usual convention.
    if (e.altKey) {
      removeGuide(id)
      return
    }
    draggingRef.current = id
    ;(e.currentTarget as SVGLineElement).setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGLineElement>, axis: 'x' | 'y') => {
      const id = draggingRef.current
      if (!id) return
      const svg = (e.currentTarget as SVGLineElement).ownerSVGElement
      const rect = svg?.getBoundingClientRect()
      const sx = e.clientX - (rect?.left ?? 0)
      const sy = e.clientY - (rect?.top ?? 0)
      const pos = axis === 'x' ? (sx - viewport.x) / viewport.zoom : (sy - viewport.y) / viewport.zoom
      moveGuide(id, Math.round(pos))
    },
    [viewport],
  )

  const onPointerUp = useCallback((e: React.PointerEvent<SVGLineElement>) => {
    draggingRef.current = null
    try {
      ;(e.currentTarget as SVGLineElement).releasePointerCapture(e.pointerId)
    } catch {
      // capture may already be released
    }
  }, [])

  if (!visible || guides.length === 0) return null
  const view = visibleDocBounds(viewport, canvasSize, 0)

  return (
    <g className="guides-overlay">
      {guides.map((g) =>
        g.axis === 'x' ? (
          <line
            key={g.id}
            className="guide"
            x1={g.position}
            y1={view.y}
            x2={g.position}
            y2={view.y + view.height}
            vectorEffect="non-scaling-stroke"
            pointerEvents="stroke"
            style={{ cursor: 'ew-resize' }}
            strokeWidth={7 / viewport.zoom}
            onPointerDown={(e) => onPointerDown(e, g.id)}
            onPointerMove={(e) => onPointerMove(e, 'x')}
            onPointerUp={onPointerUp}
          />
        ) : (
          <line
            key={g.id}
            className="guide"
            x1={view.x}
            y1={g.position}
            x2={view.x + view.width}
            y2={g.position}
            vectorEffect="non-scaling-stroke"
            pointerEvents="stroke"
            style={{ cursor: 'ns-resize' }}
            strokeWidth={7 / viewport.zoom}
            onPointerDown={(e) => onPointerDown(e, g.id)}
            onPointerMove={(e) => onPointerMove(e, 'y')}
            onPointerUp={onPointerUp}
          />
        ),
      )}
    </g>
  )
})
