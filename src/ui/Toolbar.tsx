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
 * The left tool rail.
 *
 * Reads its contents from the tool registry, so a tool cannot appear here
 * without an implementation behind it — the toolbar and the behaviour can never
 * drift apart.
 */

import { memo, type ReactNode } from 'react'
import { TOOLBAR_LAYOUT, getTool } from '../tools/ToolRegistry'
import { setTool, type ToolId } from '../state/EditorStore'
import { shortcutLabel } from '../shortcuts/keymap'
import { useKeymap } from '../shortcuts/useKeymap'
import { useEditorStore } from '../state/hooks'
import { Tooltip } from './primitives'
import { t, type MessageKey } from '../i18n'
import { useLanguage } from '../state/hooks-i18n'
import {
  ArtboardIcon,
  CursorIcon,
  DirectCursorIcon,
  EllipseIcon,
  HandIcon,
  LineIcon,
  PenIcon,
  PencilIcon,
  RectIcon,
  TextIcon,
  TriangleIcon,
  ZoomIcon,
} from './icons'

/** Rail glyph size. Larger than the 16px inspector icons, matching the reference. */
const TOOL_ICON_SIZE = 20

const TOOL_ICONS: Record<ToolId, ReactNode> = {
  select: <CursorIcon size={TOOL_ICON_SIZE} />,
  'direct-select': <DirectCursorIcon size={TOOL_ICON_SIZE} />,
  rect: <RectIcon size={TOOL_ICON_SIZE} />,
  ellipse: <EllipseIcon size={TOOL_ICON_SIZE} />,
  // A triangle, because that is what the tool draws before you change anything —
  // the same glyph XD uses for its Polygon tool.
  polygon: <TriangleIcon size={TOOL_ICON_SIZE} />,
  line: <LineIcon size={TOOL_ICON_SIZE} />,
  pen: <PenIcon size={TOOL_ICON_SIZE} />,
  pencil: <PencilIcon size={TOOL_ICON_SIZE} />,
  text: <TextIcon size={TOOL_ICON_SIZE} />,
  artboard: <ArtboardIcon size={TOOL_ICON_SIZE} />,
  zoom: <ZoomIcon size={TOOL_ICON_SIZE} />,
  hand: <HandIcon size={TOOL_ICON_SIZE} />,
}

/** Registry id -> resource id. The registry keeps English for the shortcut layer. */
const TOOL_KEYS: Record<ToolId, MessageKey> = {
  select: 'tool.select',
  'direct-select': 'tool.directSelect',
  rect: 'tool.rect',
  ellipse: 'tool.ellipse',
  polygon: 'tool.polygon',
  line: 'tool.line',
  pen: 'tool.pen',
  pencil: 'tool.pencil',
  text: 'tool.text',
  artboard: 'tool.artboard',
  zoom: 'tool.zoom',
  hand: 'tool.hand',
}

export const Toolbar = memo(function Toolbar() {
  const active = useEditorStore((s) => s.tool)
  const highlight = useEditorStore((s) => s.toolHighlight)
  void useLanguage()
  void useKeymap()

  return (
    <div className={`toolbar highlight-${highlight}`} role="toolbar" aria-label="Tools">
      {TOOLBAR_LAYOUT.map((entry, i) => {
        if (entry === 'separator') return <div key={`sep${i}`} className="tool-separator" />
        const tool = getTool(entry)
        const label = t(TOOL_KEYS[entry])
        return (
          <Tooltip key={entry} label={label} shortcut={shortcutLabel(`tool.${entry}`) || tool.shortcut}>
            <button
              type="button"
              className={`tool-button${active === entry ? ' active' : ''}`}
              onClick={() => setTool(entry)}
              aria-label={label}
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
