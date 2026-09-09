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
 * In-progress tool previews: the shape being dragged out, the pen's rubber band,
 * the pencil trail, the artboard outline, the zoom marquee.
 *
 * Drawn in screen space so preview stroke weights stay crisp at any zoom, and
 * kept out of the document entirely — nothing here is committed until the tool
 * says so, which is why an accidental click leaves no empty undo entry.
 */

import { memo } from 'react'
import { docToScreen } from './Viewport'
import {
  ellipsePath,
  polygonStarPath,
  rectPath,
} from '../geometry/ShapeGeometry'
import { transformPath } from '../geometry/PathUtils'
import { subpathToPath } from '../geometry/PathPoints'
import {
  POLYGON_DEFAULT_SIDES, POLYGON_DEFAULT_STAR_RATIO,
} from '../document/NodeFactory'
import { getDrawPreview } from '../tools/ShapeTools'
import { getPenPreview } from '../tools/PenTool'
import { getInsertPreview } from '../tools/PathEditing'
import { getPencilPreview } from '../tools/PencilTool'
import { getArtboardPreview } from '../tools/ArtboardTool'
import { getTextDragPreview } from '../tools/TextTool'
import { getZoomMarquee } from '../tools/ViewTools'
import { useEditorStore } from '../state/hooks'
import type { Bounds } from '../geometry/Bounds'
import type { Viewport } from '../state/EditorStore'

export const ToolOverlay = memo(function ToolOverlay() {
  const viewport = useEditorStore((s) => s.viewport)
  const tool = useEditorStore((s) => s.tool)
  // Tools bump overlayTick to request a repaint without touching the document.
  useEditorStore((s) => s.overlayTick)

  const toScreenBox = (b: Bounds): Bounds => {
    const tl = docToScreen(viewport, { x: b.x, y: b.y })
    return { x: tl.x, y: tl.y, width: b.width * viewport.zoom, height: b.height * viewport.zoom }
  }

  const shape = getDrawPreview()
  const pen = getPenPreview()
  const insertAt = getInsertPreview()
  const pencil = getPencilPreview()
  const artboard = getArtboardPreview()
  const textBox = getTextDragPreview()
  const zoomBox = getZoomMarquee()

  return (
    <g className="tool-overlay" pointerEvents="none">
      {shape && (
        <ShapePreview
          bounds={toScreenBox(shape.bounds)}
          kind={shape.kind}
          segment={{
            a: docToScreen(viewport, shape.segment.a),
            b: docToScreen(viewport, shape.segment.b),
          }}
        />
      )}

      {pen && (
        <g className="pen-preview">
          <path d={screenPath(subpathToPath(pen.sub), viewport)} className="pen-path" />
          {pen.rubber && (
            // What the path would BE if the pointer clicked here, not a straight
            // line to it — in curvature mode that is the whole curve, because
            // placing an anchor re-fairs the one before it.
            <path className="pen-rubber" d={screenPath(subpathToPath(pen.rubber), viewport)} />
          )}
          {pen.sub.points.map((p, i) => {
            const s = docToScreen(viewport, p)
            // Handle arms while drawing, so a curve can be judged before the
            // mouse comes up.
            const hIn = p.inX !== null && p.inY !== null ? docToScreen(viewport, { x: p.inX, y: p.inY }) : null
            const hOut = p.outX !== null && p.outY !== null ? docToScreen(viewport, { x: p.outX, y: p.outY }) : null
            return (
              <g key={i}>
                {hIn && <line className="handle-arm" x1={s.x} y1={s.y} x2={hIn.x} y2={hIn.y} />}
                {hOut && <line className="handle-arm" x1={s.x} y1={s.y} x2={hOut.x} y2={hOut.y} />}
                {hIn && <circle className="bezier-handle" cx={hIn.x} cy={hIn.y} r={3.5} />}
                {hOut && <circle className="bezier-handle" cx={hOut.x} cy={hOut.y} r={3.5} />}
                <rect
                  className={i === 0 ? 'anchor-point first' : 'anchor-point'}
                  x={s.x - 3.5}
                  y={s.y - 3.5}
                  width={7}
                  height={7}
                />
              </g>
            )
          })}
        </g>
      )}

      {/* Where the pen would drop an anchor if it were clicked here. Drawn as a
          ring rather than a filled dot so it reads as a place rather than as a
          point that already exists. */}
      {insertAt && (() => {
        const s = docToScreen(viewport, insertAt)
        return <circle className="insert-preview" cx={s.x} cy={s.y} r={4} />
      })()}

      {pencil && (
        <polyline
          className="pencil-preview"
          points={pencil.map((p) => {
            const s = docToScreen(viewport, p)
            return `${s.x},${s.y}`
          }).join(' ')}
        />
      )}

      {artboard && <PreviewRect className="artboard-preview" bounds={toScreenBox(artboard)} />}
      {textBox && <PreviewRect className="text-preview" bounds={toScreenBox(textBox)} />}
      {zoomBox && <PreviewRect className="zoom-preview" bounds={toScreenBox(zoomBox)} />}
      {tool === 'artboard' && !artboard && null}
    </g>
  )
})

function screenPath(d: string, v: Viewport): string {
  return transformPath(d, [v.zoom, 0, 0, v.zoom, v.x, v.y])
}

function PreviewRect({ bounds, className }: { bounds: Bounds; className: string }) {
  return (
    <rect
      className={className}
      x={bounds.x}
      y={bounds.y}
      width={Math.max(0, bounds.width)}
      height={Math.max(0, bounds.height)}
    />
  )
}

function ShapePreview({
  bounds,
  kind,
  segment,
}: {
  bounds: Bounds
  kind: string
  segment: { a: { x: number; y: number }; b: { x: number; y: number } }
}) {
  // A line is drawn from its own endpoints, not from a box: a box says how big
  // the drag was but not which way round it runs, and reconstructing direction
  // from a signed width/height is what used to send the preview a full drag
  // delta away from the pointer.
  if (kind === 'line') {
    return (
      <path
        className="shape-preview"
        d={`M${segment.a.x} ${segment.a.y} L${segment.b.x} ${segment.b.y}`}
      />
    )
  }

  const w = Math.abs(bounds.width)
  const h = Math.abs(bounds.height)
  let d: string
  switch (kind) {
    case 'ellipse': d = ellipsePath(w, h); break
    // The preview must draw what the tool will actually create, so it takes the
    // same defaults createPolygon does rather than its own hard-coded pair.
    case 'polygon': d = polygonStarPath(w, h, POLYGON_DEFAULT_SIDES, POLYGON_DEFAULT_STAR_RATIO); break
    default: d = rectPath(w, h, 0)
  }
  return (
    <g transform={`translate(${bounds.x} ${bounds.y})`}>
      <path className="shape-preview" d={d} />
    </g>
  )
}
