/**
 * The document model.
 *
 * Two rules govern this file and are worth stating up front, because the rest of
 * the editor depends on them:
 *
 * 1. Geometry is authored in LOCAL space, spanning (0,0)..(width,height). Where a
 *    node sits, how it is rotated, scaled or flipped lives entirely in its
 *    `transform`. Rotating a star never rewrites the star — its `points` and
 *    `innerRatio` stay editable. This is what makes "rotate a group, ungroup,
 *    everything still correct" true rather than aspirational.
 *
 * 2. The graph is NORMALIZED: `nodes` is a flat id -> node map and z-order is the
 *    parent's `children` array. Nothing holds a direct object reference to
 *    another node, so a node can be updated without touching its ancestors.
 *
 * DOM-free by design (enforced by eslint.config.js) so the whole model is
 * testable in plain node.
 */

import type { CornerRadii } from '../geometry/ShapeGeometry'
import type { FillRule, LineCap, LineJoin } from '../geometry/PathUtils'

export type NodeId = string
export type AssetId = string

export type NodeType =
  | 'document'
  | 'artboard'
  | 'group'
  | 'rect'
  | 'ellipse'
  | 'triangle'
  | 'polygon'
  | 'star'
  | 'line'
  | 'path'
  | 'text'
  | 'image'
  | 'svg'
  | 'repeat-grid'

/** Types that hold children. */
export const CONTAINER_TYPES = ['document', 'artboard', 'group', 'repeat-grid'] as const
export type ContainerType = (typeof CONTAINER_TYPES)[number]

// ---------------------------------------------------------------------------
// Transform
// ---------------------------------------------------------------------------

export interface Transform {
  /** Position of the node's local origin in parent space. */
  x: number
  y: number
  /** Intrinsic size in local units. Never negative — flips live in scaleX/scaleY. */
  width: number
  height: number
  /** Degrees, clockwise. */
  rotation: number
  /** Negative values flip. */
  scaleX: number
  scaleY: number
  /** Degrees. */
  skewX: number
  skewY: number
  /** Transform center as a 0..1 fraction of the local box. */
  originX: number
  originY: number
}

export const DEFAULT_TRANSFORM: Transform = {
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  skewX: 0,
  skewY: 0,
  originX: 0.5,
  originY: 0.5,
}

// ---------------------------------------------------------------------------
// Paint
// ---------------------------------------------------------------------------

export interface RGBA {
  /** 0..255 */
  r: number
  g: number
  b: number
  /** 0..1 */
  a: number
}

export interface GradientStop {
  id: string
  /** 0..1 along the gradient axis. */
  offset: number
  color: RGBA
}

export interface NoPaint {
  type: 'none'
}

export interface SolidPaint {
  type: 'solid'
  color: RGBA
}

/**
 * Gradient coordinates are in objectBoundingBox units (0..1 of the node's local
 * box), so a gradient rescales with its shape automatically and survives resize
 * with no recomputation.
 */
export interface LinearGradientPaint {
  type: 'linear'
  x1: number
  y1: number
  x2: number
  y2: number
  stops: GradientStop[]
}

export interface RadialGradientPaint {
  type: 'radial'
  cx: number
  cy: number
  r: number
  /** Focal point; defaults to the center when absent. */
  fx?: number
  fy?: number
  stops: GradientStop[]
}

/**
 * A reference to a paint server that lives inside a preserved SVG subtree
 * (a pattern, a gradient we chose not to model, a marker). Carries the raw
 * `url(#…)` so imported artwork keeps rendering exactly as authored even when
 * the editor has no first-class UI for it.
 */
export interface RefPaint {
  type: 'ref'
  ref: string
}

export type Paint =
  | NoPaint
  | SolidPaint
  | LinearGradientPaint
  | RadialGradientPaint
  | RefPaint

export type GradientPaint = LinearGradientPaint | RadialGradientPaint

export const NO_PAINT: NoPaint = { type: 'none' }

export function solid(r: number, g: number, b: number, a = 1): SolidPaint {
  return { type: 'solid', color: { r, g, b, a } }
}

// ---------------------------------------------------------------------------
// Style
// ---------------------------------------------------------------------------

export type StrokeAlign = 'center' | 'inner' | 'outer'

export interface Stroke {
  paint: Paint
  width: number
  cap: LineCap
  join: LineJoin
  miterLimit: number
  dashArray: number[]
  dashOffset: number
  align: StrokeAlign
}

export const DEFAULT_STROKE: Stroke = {
  paint: NO_PAINT,
  width: 1,
  cap: 'butt',
  join: 'miter',
  miterLimit: 4,
  dashArray: [],
  dashOffset: 0,
  align: 'center',
}

export type BlendMode =
  | 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten'
  | 'color-dodge' | 'color-burn' | 'hard-light' | 'soft-light'
  | 'difference' | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity'

export interface Style {
  fill: Paint
  fillOpacity: number
  fillRule: FillRule
  stroke: Stroke
  strokeOpacity: number
  /** Node-level alpha, multiplied with fill/stroke opacity. */
  opacity: number
  blendMode: BlendMode
}

export const DEFAULT_STYLE: Style = {
  fill: { type: 'solid', color: { r: 217, g: 217, b: 217, a: 1 } },
  fillOpacity: 1,
  fillRule: 'nonzero',
  stroke: DEFAULT_STROKE,
  strokeOpacity: 1,
  opacity: 1,
  blendMode: 'normal',
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export type TextAlign = 'left' | 'center' | 'right'
export type FontStyle = 'normal' | 'italic'

export interface TextStyle {
  fontFamily: string
  fontSize: number
  fontWeight: number
  fontStyle: FontStyle
  /** Multiplier of font size. */
  lineHeight: number
  /** In em units, matching how designers think about tracking. */
  letterSpacing: number
  align: TextAlign
  underline: boolean
  strikethrough: boolean
  /** 'auto' grows the box with the text; 'fixed' wraps inside width. */
  sizing: 'auto' | 'fixed'
}

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: 'Inter',
  fontSize: 24,
  fontWeight: 400,
  fontStyle: 'normal',
  lineHeight: 1.4,
  letterSpacing: 0,
  align: 'left',
  underline: false,
  strikethrough: false,
  sizing: 'auto',
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

export interface BaseNode {
  id: NodeId
  type: NodeType
  name: string
  parentId: NodeId | null
  visible: boolean
  locked: boolean
  transform: Transform
  /** Shown with an export badge in the Layers panel; drives "export marked layers". */
  markedForExport: boolean
  /** Free-form; also where unmapped SVG attributes are parked on import. */
  metadata?: Record<string, unknown>
}

export interface StyledNode extends BaseNode {
  style: Style
}

export interface DocumentRootNode extends BaseNode {
  type: 'document'
  children: NodeId[]
}

export interface ArtboardNode extends BaseNode {
  type: 'artboard'
  children: NodeId[]
  background: Paint
  /** When true, content is clipped to the artboard on canvas and on export. */
  clipContent: boolean
}

export interface GroupNode extends StyledNode {
  type: 'group'
  children: NodeId[]
}

/**
 * A repeating grid of one source cell.
 *
 * The node holds ONE set of children — the source cell — and the renderer draws
 * it `rows` x `columns` times, offset by the cell size plus the gutter. That is
 * what gives the feature its defining behaviour for free: editing the source
 * updates every repeat, because there is only ever one copy of the content.
 *
 * `cellWidth`/`cellHeight` are the size of one cell, so the node's overall
 * transform.width/height are derived, never authored directly.
 */
export interface RepeatGridNode extends StyledNode {
  type: 'repeat-grid'
  children: NodeId[]
  rows: number
  columns: number
  /** Space BETWEEN cells, not around them. */
  gutterX: number
  gutterY: number
  cellWidth: number
  cellHeight: number
}

export interface RectNode extends StyledNode {
  type: 'rect'
  cornerRadius: CornerRadii
}

export interface EllipseNode extends StyledNode {
  type: 'ellipse'
}

export interface TriangleNode extends StyledNode {
  type: 'triangle'
}

export interface PolygonNode extends StyledNode {
  type: 'polygon'
  sides: number
}

export interface StarNode extends StyledNode {
  type: 'star'
  points: number
  /** Inner radius as a fraction of outer, 0..1. */
  innerRatio: number
}

/** Endpoints are in local space so the transform can still rotate/scale the line. */
export interface LineNode extends StyledNode {
  type: 'line'
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface PathNode extends StyledNode {
  type: 'path'
  /** Real SVG path data. M L H V C S Q T A Z all survive round-trips. */
  d: string
  closed: boolean
  /** Set when this path came from a boolean op, so the op stays re-runnable. */
  booleanOp?: BooleanOp
  booleanSources?: string[]
}

export type BooleanOp = 'union' | 'subtract' | 'intersect' | 'exclude'

export interface TextNode extends StyledNode {
  type: 'text'
  text: string
  textStyle: TextStyle
}

export type ImageFit = 'fill' | 'contain' | 'cover'

export interface ImageNode extends StyledNode {
  type: 'image'
  assetId: AssetId
  fit: ImageFit
  cornerRadius: CornerRadii
}

/**
 * Preserved SVG subtree.
 *
 * When an import contains something the editor has no first-class model for
 * (`<use>`, `<pattern>`, `<mask>`, `<filter>`, `<marker>`, a `<symbol>` instance),
 * the sanitized markup is kept verbatim and rendered as-is rather than being
 * dropped or flattened to a bitmap. It still transforms, scales, rotates and
 * exports as vector like any other node.
 */
export interface SvgNode extends StyledNode {
  type: 'svg'
  /** Sanitized inner markup, already ID-namespaced. */
  markup: string
  /** Sanitized <defs> content this subtree references. */
  defs: string
  /** Intrinsic viewBox, so the subtree scales into the local box correctly. */
  viewBox: { x: number; y: number; width: number; height: number }
  preserveAspectRatio: string
}

export type DesignNode =
  | DocumentRootNode
  | ArtboardNode
  | GroupNode
  | RepeatGridNode
  | RectNode
  | EllipseNode
  | TriangleNode
  | PolygonNode
  | StarNode
  | LineNode
  | PathNode
  | TextNode
  | ImageNode
  | SvgNode

export type ContainerNode = DocumentRootNode | ArtboardNode | GroupNode | RepeatGridNode
/** Every union member that actually carries a `style` field. */
export type StyledDesignNode = Exclude<DesignNode, DocumentRootNode | ArtboardNode>
export type ShapeNode =
  | RectNode | EllipseNode | TriangleNode | PolygonNode | StarNode | LineNode | PathNode

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export interface ImageAsset {
  id: AssetId
  name: string
  mimeType: string
  width: number
  height: number
  byteSize: number
  /**
   * The image bytes as a data URL. Always self-contained — never a blob: or
   * file: URL — so a saved document still opens after the original file is
   * deleted, or on a different machine.
   */
  dataUrl: string
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export interface Guide {
  id: string
  axis: 'x' | 'y'
  position: number
}

export interface DocumentSettings {
  gridSize: number
  gridVisible: boolean
  snapToGrid: boolean
  snapToObjects: boolean
  guidesVisible: boolean
  rulersVisible: boolean
}

export const DEFAULT_SETTINGS: DocumentSettings = {
  gridSize: 8,
  gridVisible: false,
  snapToGrid: false,
  snapToObjects: true,
  guidesVisible: true,
  rulersVisible: false,
}

export interface DesignDocument {
  id: string
  name: string
  /** Flat id -> node map. Z-order lives in each container's `children`. */
  nodes: Record<NodeId, DesignNode>
  rootId: NodeId
  assets: Record<AssetId, ImageAsset>
  guides: Guide[]
  settings: DocumentSettings
  createdAt: number
  modifiedAt: number
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isContainer(node: DesignNode | undefined | null): node is ContainerNode {
  return (
    !!node &&
    (node.type === 'document' ||
      node.type === 'artboard' ||
      node.type === 'group' ||
      node.type === 'repeat-grid')
  )
}

/**
 * Containers whose bounds come from their OWN box rather than from the union of
 * their children. An artboard is a frame that clips; a repeat grid tiles its
 * source, so its extent is rows/columns/gutters, not one cell's children.
 */
export function usesOwnBox(node: DesignNode | undefined | null): boolean {
  return !!node && (node.type === 'artboard' || node.type === 'repeat-grid')
}

/** Overall size implied by a repeat grid's rows, columns, cell size and gutters. */
export function repeatGridSize(node: RepeatGridNode): { width: number; height: number } {
  const cols = Math.max(1, Math.round(node.columns))
  const rows = Math.max(1, Math.round(node.rows))
  return {
    width: cols * node.cellWidth + (cols - 1) * node.gutterX,
    height: rows * node.cellHeight + (rows - 1) * node.gutterY,
  }
}

/** Top-left offset of each cell, in the grid's local space. */
export function repeatGridOffsets(node: RepeatGridNode): Array<{ x: number; y: number }> {
  const cols = Math.max(1, Math.round(node.columns))
  const rows = Math.max(1, Math.round(node.rows))
  const out: Array<{ x: number; y: number }> = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({
        x: c * (node.cellWidth + node.gutterX),
        y: r * (node.cellHeight + node.gutterY),
      })
    }
  }
  return out
}

export function hasStyle(node: DesignNode | undefined | null): node is StyledDesignNode {
  return !!node && node.type !== 'document' && node.type !== 'artboard'
}

export function isShape(node: DesignNode | undefined | null): node is ShapeNode {
  if (!node) return false
  switch (node.type) {
    case 'rect':
    case 'ellipse':
    case 'triangle':
    case 'polygon':
    case 'star':
    case 'line':
    case 'path':
      return true
    default:
      return false
  }
}

/** Types that boolean operations accept. */
export function isBooleanCapable(node: DesignNode | undefined | null): boolean {
  return isShape(node)
}

export function hasCornerRadius(node: DesignNode): node is RectNode | ImageNode {
  return node.type === 'rect' || node.type === 'image'
}
