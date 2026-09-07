/**
 * The square grid.
 *
 * Purely visual: drawn inside the viewport group but never part of the document,
 * so it cannot be selected and never appears in an export.
 *
 * Lines are generated only for the visible document range and the spacing is
 * stepped up as you zoom out, so a 8px grid at 5% zoom does not try to render
 * fifty thousand lines.
 */

import { memo, useMemo } from 'react'
import { visibleDocBounds } from './Viewport'
import { useDocumentStore, useEditorStore } from '../state/hooks'

/** Below this on-screen spacing the grid is stepped up to the next multiple. */
const MIN_SCREEN_SPACING = 6

export const GridOverlay = memo(function GridOverlay() {
  const visible = useDocumentStore((s) => s.doc.settings.gridVisible)
  const gridSize = useDocumentStore((s) => s.doc.settings.gridSize)
  const viewport = useEditorStore((s) => s.viewport)
  const canvasSize = useEditorStore((s) => s.canvasSize)

  const lines = useMemo(() => {
    if (!visible || gridSize <= 0) return null
    let step = gridSize
    while (step * viewport.zoom < MIN_SCREEN_SPACING) step *= 2
    // Guard against a pathological zoom producing an unbounded loop of lines.
    const view = visibleDocBounds(viewport, canvasSize, 0)
    const cols = Math.ceil(view.width / step)
    const rows = Math.ceil(view.height / step)
    if (cols > 4000 || rows > 4000) return null

    const x0 = Math.floor(view.x / step) * step
    const y0 = Math.floor(view.y / step) * step
    const xs: number[] = []
    const ys: number[] = []
    for (let i = 0; i <= cols; i++) xs.push(x0 + i * step)
    for (let i = 0; i <= rows; i++) ys.push(y0 + i * step)
    return { xs, ys, view, step }
  }, [visible, gridSize, viewport, canvasSize])

  if (!lines) return null

  return (
    <g className="grid-overlay" pointerEvents="none">
      {lines.xs.map((x) => (
        <line
          key={`x${x}`}
          x1={x}
          y1={lines.view.y}
          x2={x}
          y2={lines.view.y + lines.view.height}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {lines.ys.map((y) => (
        <line
          key={`y${y}`}
          x1={lines.view.x}
          y1={y}
          x2={lines.view.x + lines.view.width}
          y2={y}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  )
})
