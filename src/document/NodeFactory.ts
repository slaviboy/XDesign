/**
 * Node constructors.
 *
 * Every node is created fully populated — no partial nodes ever enter the graph,
 * so consumers never have to defend against a missing style or transform.
 */

import { MAX_SIDES, MIN_SIDES, type CornerRadii } from '../geometry/ShapeGeometry'
import { createNodeId, createStopId } from './ids'
import {
  DEFAULT_SETTINGS,
  DEFAULT_STROKE,
  DEFAULT_STYLE,
  DEFAULT_TEXT_STYLE,
  DEFAULT_TRANSFORM,
  type ArtboardNode,
  type DesignDocument,
  type DesignNode,
  type DocumentRootNode,
  type EllipseNode,
  type GradientStop,
  type GroupNode,
  type ImageNode,
  type LineNode,
  type LinearGradientPaint,
  type NodeId,
  type Paint,
  type PathNode,
  type PolygonNode,
  type RepeatGridNode,
  type RadialGradientPaint,
  type RectNode,
  type RGBA,
  type Style,
  type SvgNode,
  type TextNode,
  type Transform,
} from './types'

export function cloneTransform(t: Partial<Transform> = {}): Transform {
  return { ...DEFAULT_TRANSFORM, ...t }
}

export function cloneStyle(s: Partial<Style> = {}): Style {
  return {
    ...DEFAULT_STYLE,
    ...s,
    stroke: { ...DEFAULT_STROKE, ...(s.stroke ?? {}), dashArray: [...(s.stroke?.dashArray ?? [])] },
    fill: s.fill ? clonePaint(s.fill) : { ...DEFAULT_STYLE.fill },
  }
}

export function clonePaint(p: Paint): Paint {
  switch (p.type) {
    case 'solid':
      return { type: 'solid', color: { ...p.color } }
    case 'linear':
      return { ...p, stops: p.stops.map((s) => ({ ...s, color: { ...s.color } })) }
    case 'radial':
    case 'angular':
      // Every gradient must deep-copy its stops. Falling through to the shallow
      // default aliased the array, so duplicating a shape and editing one copy's
      // gradient silently edited the other's.
      return { ...p, stops: p.stops.map((s) => ({ ...s, color: { ...s.color } })) }
    default:
      return { ...p }
  }
}

function base(
  type: DesignNode['type'],
  name: string,
  transform: Partial<Transform>,
): Omit<DesignNode, 'type'> & { type: DesignNode['type'] } {
  return {
    id: createNodeId(),
    type,
    name,
    parentId: null,
    visible: true,
    locked: false,
    transform: cloneTransform(transform),
    markedForExport: false,
  } as Omit<DesignNode, 'type'> & { type: DesignNode['type'] }
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export function createRect(
  transform: Partial<Transform> = {},
  style: Partial<Style> = {},
  cornerRadius: CornerRadii = [0, 0, 0, 0],
): RectNode {
  return { ...base('rect', 'Rectangle', transform), type: 'rect', style: cloneStyle(style), cornerRadius }
}

export function createEllipse(
  transform: Partial<Transform> = {},
  style: Partial<Style> = {},
): EllipseNode {
  return { ...base('ellipse', 'Ellipse', transform), type: 'ellipse', style: cloneStyle(style) }
}

/**
 * The one parametric polygon.
 *
 * Named for its corner count, exactly as XD does: 3 corners is a triangle, and a
 * star ratio below 1 makes it a star. `sides = 3` is the default because that is
 * what the tool draws before you touch anything.
 */
export const POLYGON_DEFAULT_SIDES = 3
export const POLYGON_DEFAULT_STAR_RATIO = 1

export function createPolygon(
  transform: Partial<Transform> = {},
  style: Partial<Style> = {},
  sides = POLYGON_DEFAULT_SIDES,
  starRatio = POLYGON_DEFAULT_STAR_RATIO,
): PolygonNode {
  return {
    ...base('polygon', polygonName(sides, starRatio), transform),
    type: 'polygon',
    style: cloneStyle(style),
    sides: Math.min(MAX_SIDES, Math.max(MIN_SIDES, Math.round(sides))),
    starRatio: Math.min(1, Math.max(0.01, starRatio)),
    cornerRadius: 0,
  }
}

/** Layer name at creation. Never revised afterwards — that is the user's to set. */
function polygonName(sides: number, starRatio: number): string {
  if (starRatio < 1) return 'Star'
  return Math.round(sides) === 3 ? 'Triangle' : 'Polygon'
}

export function createLine(
  transform: Partial<Transform> = {},
  style: Partial<Style> = {},
  coords: { x1: number; y1: number; x2: number; y2: number } = { x1: 0, y1: 0, x2: 100, y2: 0 },
): LineNode {
  return {
    ...base('line', 'Line', transform),
    type: 'line',
    style: cloneStyle({
      fill: { type: 'none' },
      stroke: { ...DEFAULT_STROKE, paint: { type: 'solid', color: { r: 0, g: 0, b: 0, a: 1 } }, width: 1 },
      ...style,
    }),
    ...coords,
  }
}

export function createPath(
  d: string,
  transform: Partial<Transform> = {},
  style: Partial<Style> = {},
  closed = false,
): PathNode {
  return {
    ...base('path', 'Path', transform),
    type: 'path',
    style: cloneStyle(style),
    d,
    closed,
  }
}

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

export function createGroup(
  children: NodeId[] = [],
  transform: Partial<Transform> = {},
): GroupNode {
  return {
    ...base('group', 'Group', transform),
    type: 'group',
    children,
    style: cloneStyle({ fill: { type: 'none' } }),
  }
}

export function createRepeatGrid(
  children: NodeId[],
  cell: { width: number; height: number },
  transform: Partial<Transform> = {},
): RepeatGridNode {
  return {
    ...base('repeat-grid', 'Repeat Grid', transform),
    type: 'repeat-grid',
    children,
    rows: 1,
    columns: 1,
    gutterX: 16,
    gutterY: 16,
    cellWidth: Math.max(1, cell.width),
    cellHeight: Math.max(1, cell.height),
    style: cloneStyle({ fill: { type: 'none' } }),
  }
}

export function createArtboard(
  name: string,
  transform: Partial<Transform> = {},
  background: Paint = { type: 'solid', color: { r: 255, g: 255, b: 255, a: 1 } },
): ArtboardNode {
  return {
    ...base('artboard', name, transform),
    type: 'artboard',
    children: [],
    background,
    clipContent: true,
  }
}

export function createDocumentRoot(): DocumentRootNode {
  return {
    id: 'root',
    type: 'document',
    name: 'Document',
    parentId: null,
    visible: true,
    locked: false,
    transform: cloneTransform({ width: 0, height: 0 }),
    markedForExport: false,
    children: [],
  }
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

export function createText(
  text = 'Text',
  transform: Partial<Transform> = {},
  style: Partial<Style> = {},
  textStyle: Partial<TextNode['textStyle']> = {},
): TextNode {
  return {
    ...base('text', text.slice(0, 40) || 'Text', transform),
    type: 'text',
    style: cloneStyle({
      fill: { type: 'solid', color: { r: 0, g: 0, b: 0, a: 1 } },
      ...style,
    }),
    text,
    textStyle: { ...DEFAULT_TEXT_STYLE, ...textStyle },
  }
}

export function createImage(
  assetId: string,
  name: string,
  transform: Partial<Transform> = {},
): ImageNode {
  return {
    ...base('image', name, transform),
    type: 'image',
    style: cloneStyle({ fill: { type: 'none' } }),
    assetId,
    fit: 'fill',
    cornerRadius: [0, 0, 0, 0],
  }
}

export function createSvgNode(
  markup: string,
  defs: string,
  viewBox: SvgNode['viewBox'],
  transform: Partial<Transform> = {},
  name = 'SVG',
): SvgNode {
  return {
    ...base('svg', name, transform),
    type: 'svg',
    style: cloneStyle({ fill: { type: 'none' } }),
    markup,
    defs,
    viewBox,
    preserveAspectRatio: 'xMidYMid meet',
  }
}

// ---------------------------------------------------------------------------
// Paints
// ---------------------------------------------------------------------------

export function createStop(offset: number, color: RGBA): GradientStop {
  return { id: createStopId(), offset, color }
}

export function createLinearGradient(
  stops?: GradientStop[],
): LinearGradientPaint {
  return {
    type: 'linear',
    // Across the middle, not along the top edge: the on-canvas segment is the
    // handle you grab, and on the top edge it lands under the resize handles.
    x1: 0,
    y1: 0.5,
    x2: 1,
    y2: 0.5,
    stops: stops ?? [
      createStop(0, { r: 255, g: 255, b: 255, a: 1 }),
      createStop(1, { r: 0, g: 0, b: 0, a: 1 }),
    ],
  }
}

export function createRadialGradient(stops?: GradientStop[]): RadialGradientPaint {
  return {
    type: 'radial',
    cx: 0.5,
    cy: 0.5,
    r: 0.5,
    stops: stops ?? [
      createStop(0, { r: 255, g: 255, b: 255, a: 1 }),
      createStop(1, { r: 0, g: 0, b: 0, a: 1 }),
    ],
  }
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export interface ArtboardPreset {
  label: string
  group: string
  width: number
  height: number
}

export const ARTBOARD_PRESETS: ArtboardPreset[] = [
  { label: 'iPhone 15 Pro', group: 'Phone', width: 393, height: 852 },
  { label: 'iPhone SE', group: 'Phone', width: 375, height: 667 },
  { label: 'Android Large', group: 'Phone', width: 412, height: 915 },
  { label: 'iPad Pro 11"', group: 'Tablet', width: 834, height: 1194 },
  { label: 'iPad Mini', group: 'Tablet', width: 768, height: 1024 },
  { label: 'Web 1280', group: 'Web', width: 1280, height: 800 },
  { label: 'Web 1440', group: 'Web', width: 1440, height: 900 },
  { label: 'Web 1920', group: 'Web', width: 1920, height: 1080 },
  { label: 'Desktop MacBook Pro 16"', group: 'Desktop', width: 1728, height: 1117 },
  { label: 'Instagram Post', group: 'Social', width: 1080, height: 1080 },
  { label: 'Instagram Story', group: 'Social', width: 1080, height: 1920 },
  { label: 'A4 (96dpi)', group: 'Print', width: 794, height: 1123 },
  { label: 'Letter (96dpi)', group: 'Print', width: 816, height: 1056 },
]

export function createDocument(name = 'Untitled', withArtboard = true): DesignDocument {
  const root = createDocumentRoot()
  const nodes: Record<NodeId, DesignNode> = { [root.id]: root }

  if (withArtboard) {
    const artboard = createArtboard('Artboard 1', { x: 0, y: 0, width: 1280, height: 800 })
    artboard.parentId = root.id
    root.children.push(artboard.id)
    nodes[artboard.id] = artboard
  }

  const now = Date.now()
  return {
    id: `doc${now.toString(36)}`,
    name,
    nodes,
    rootId: root.id,
    assets: {},
    swatches: [],
    settings: { ...DEFAULT_SETTINGS },
    createdAt: now,
    modifiedAt: now,
  }
}
