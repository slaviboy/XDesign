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
import { gridStepForZoom } from './gridMath'
import { useDocumentStore, useEditorStore } from '../state/hooks'

export const GridOverlay = memo(function GridOverlay() {
  const visible = useDocumentStore((s) => s.doc.settings.gridVisible)
  const gridSize = useDocumentStore((s) => s.doc.settings.gridSize)
  const viewport = useEditorStore((s) => s.viewport)
  const canvasSize = useEditorStore((s) => s.canvasSize)

  const lines = useMemo(() => {
    if (!visible || gridSize <= 0) return null
    const step = gridStepForZoom(gridSize, viewport.zoom)
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
