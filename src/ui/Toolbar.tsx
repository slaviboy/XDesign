/**
 * The left tool rail.
 *
 * Reads its contents from the tool registry, so a tool cannot appear here
 * without an implementation behind it — the toolbar and the behaviour can never
 * drift apart.
 */

import { memo, type ReactNode } from 'react'
import { TOOLBAR_LAYOUT, getTool } from '../tools/ToolRegistry'
import { setTool, type ToolId } from '../state/EditorStore'
import { useEditorStore } from '../state/hooks'
import { Tooltip } from './primitives'
import {
  ArtboardIcon,
  CursorIcon,
  EllipseIcon,
  HandIcon,
  LineIcon,
  PenIcon,
  PencilIcon,
  PolygonIcon,
  RectIcon,
  StarIcon,
  TextIcon,
  TriangleIcon,
  ZoomIcon,
} from './icons'

const TOOL_ICONS: Record<ToolId, ReactNode> = {
  select: <CursorIcon />,
  rect: <RectIcon />,
  ellipse: <EllipseIcon />,
  triangle: <TriangleIcon />,
  polygon: <PolygonIcon />,
  star: <StarIcon />,
  line: <LineIcon />,
  pen: <PenIcon />,
  pencil: <PencilIcon />,
  text: <TextIcon />,
  artboard: <ArtboardIcon />,
  zoom: <ZoomIcon />,
  hand: <HandIcon />,
}

export const Toolbar = memo(function Toolbar() {
  const active = useEditorStore((s) => s.tool)

  return (
    <div className="toolbar" role="toolbar" aria-label="Tools">
      {TOOLBAR_LAYOUT.map((entry, i) => {
        if (entry === 'separator') return <div key={`sep${i}`} className="tool-separator" />
        const tool = getTool(entry)
        return (
          <Tooltip key={entry} label={tool.label} shortcut={tool.shortcut}>
            <button
              type="button"
              className={`tool-button${active === entry ? ' active' : ''}`}
              onClick={() => setTool(entry)}
              aria-label={tool.label}
              aria-pressed={active === entry}
              data-tool={entry}
            >
              {TOOL_ICONS[entry]}
            </button>
          </Tooltip>
        )
      })}
    </div>
  )
})
