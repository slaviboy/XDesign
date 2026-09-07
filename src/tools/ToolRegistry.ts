/**
 * Tool registry — the single place that maps a ToolId to its implementation,
 * its cursor, and its keyboard shortcut. The toolbar, the shortcut layer and the
 * canvas all read from here so they cannot drift apart.
 */

import { selectionTool } from './SelectionTool'
import { directSelectionTool } from './DirectSelectionTool'
import {
  ellipseTool,
  lineTool,
  polygonTool,
  rectangleTool,
} from './ShapeTools'
import { penTool } from './PenTool'
import { pencilTool } from './PencilTool'
import { textTool } from './TextTool'
import { artboardTool } from './ArtboardTool'
import { handTool, zoomTool } from './ViewTools'
import type { ToolId } from '../state/EditorStore'
import type { Tool } from './types'

export const TOOLS: Record<ToolId, Tool> = {
  select: selectionTool,
  'direct-select': directSelectionTool,
  rect: rectangleTool,
  ellipse: ellipseTool,
  polygon: polygonTool,
  line: lineTool,
  pen: penTool,
  pencil: pencilTool,
  text: textTool,
  artboard: artboardTool,
  zoom: zoomTool,
  hand: handTool,
}

export function getTool(id: ToolId): Tool {
  return TOOLS[id] ?? selectionTool
}

/** Order of the left tool rail, with separators between groups. */
export const TOOLBAR_LAYOUT: Array<ToolId | 'separator'> = [
  'select',
  'direct-select',
  'separator',
  'rect',
  'ellipse',
  'polygon',
  'line',
  'separator',
  'pen',
  'pencil',
  'separator',
  'text',
  'artboard',
  'separator',
  'zoom',
  'hand',
]

/** Single-key shortcuts. Modifier combinations live in shortcuts/bindings.ts. */
export const TOOL_SHORTCUTS: Record<string, ToolId> = {
  v: 'select',
  d: 'direct-select',
  r: 'rect',
  e: 'ellipse',
  y: 'polygon',
  l: 'line',
  p: 'pen',
  n: 'pencil',
  t: 'text',
  a: 'artboard',
  z: 'zoom',
  h: 'hand',
}
