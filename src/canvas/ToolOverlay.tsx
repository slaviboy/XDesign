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
  polygonPath,
  rectPath,
  starPath,
  trianglePath,
} from '../geometry/ShapeGeometry'
import { transformPath } from '../geometry/PathUtils'
import { subpathToPath } from '../geometry/PathPoints'
import { getDrawPreview } from '../tools/ShapeTools'
import { getPenPreview } from '../tools/PenTool'
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
  const pencil = getPencilPreview()
  const artboard = getArtboardPreview()
  const textBox = getTextDragPreview()
  const zoomBox = getZoomMarquee()

  return (
    <g className="tool-overlay" pointerEvents="none">
      {shape && <ShapePreview bounds={toScreenBox(shape.bounds)} kind={shape.kind} />}

      {pen && (
        <g className="pen-preview">
          <path d={screenPath(subpathToPath(pen.sub), viewport)} className="pen-path" />
          {pen.hover && pen.sub.points.length > 0 && (
            <line
              className="pen-rubber"
              {...rubberBand(pen.sub.points[pen.sub.points.length - 1]!, pen.hover, viewport)}
            />
          )}
          {pen.sub.points.map((p, i) => {
            const s = docToScreen(viewport, p)
            return (
              <rect
                key={i}
                className={i === 0 ? 'anchor-point first' : 'anchor-point'}
                x={s.x - 3.5}
                y={s.y - 3.5}
                width={7}
                height={7}
              />
            )
          })}
        </g>
      )}

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

function rubberBand(from: { x: number; y: number }, to: { x: number; y: number }, v: Viewport) {
  const a = docToScreen(v, from)
  const b = docToScreen(v, to)
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y }
}

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

function ShapePreview({ bounds, kind }: { bounds: Bounds; kind: string }) {
  const w = Math.abs(bounds.width)
  const h = Math.abs(bounds.height)
  let d: string
  switch (kind) {
    case 'ellipse': d = ellipsePath(w, h); break
    case 'triangle': d = trianglePath(w, h); break
    case 'polygon': d = polygonPath(w, h, 6); break
    case 'star': d = starPath(w, h, 5, 0.5); break
    case 'line': d = `M0 0 L${bounds.width} ${bounds.height}`; break
    default: d = rectPath(w, h, 0)
  }
  return (
    <g transform={`translate(${bounds.x} ${bounds.y})`}>
      <path className="shape-preview" d={d} />
    </g>
  )
}
