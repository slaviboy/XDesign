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
 * The document model.
 *
 * Two rules govern this file and are worth stating up front, because the rest of
 * the editor depends on them:
 *
 * 1. Geometry is authored in LOCAL space, spanning (0,0)..(width,height). Where a
 *    node sits, how it is rotated, scaled or flipped lives entirely in its
 *    `transform`. Rotating a star never rewrites the star — its `sides` and
 *    `starRatio` stay editable. This is what makes "rotate a group, ungroup,
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
export type { CornerRadii }
import type { FillRule, LineCap, LineJoin } from '../geometry/PathUtils'

export type NodeId = string
export type AssetId = string

export type NodeType =
  | 'document'
  | 'artboard'
  | 'group'
  | 'rect'
  | 'ellipse'
  | 'polygon'
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

/**
 * XD's 3D Transforms: a tilt about the object's own horizontal and vertical
 * axes, and a depth toward or away from the viewer.
 *
 * The third rotation is the one every object already has — `transform.rotation`
 * — so nothing here duplicates it. The tilt turns about the same pivot the 2D
 * rotation does (originX/originY of the box), and the object is seen through a
 * camera looking straight at that pivot: see Scene3D for the whole model.
 *
 * Kept beside `transform` rather than inside it on purpose. Move, rotate,
 * group, ungroup, align, paste and every drag rebuild `transform` from a 2D
 * matrix, which cannot hold a tilt; living next to it, the tilt survives all of
 * them without a single one of those paths having to know it exists.
 */
export interface Transform3D {
  /** Degrees about the horizontal axis. Positive tips the top edge away. */
  rotateX: number
  /** Degrees about the vertical axis. Positive turns the right edge away. */
  rotateY: number
  /** Depth in document units. Positive comes toward the viewer. */
  z: number
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
  /**
   * Which space x1/y1/x2/y2 are in. Absent means objectBoundingBox — 0..1 of the
   * node's own box, which is what everything drawn in the editor uses and what
   * makes a gradient rescale with its shape for free.
   *
   * An imported gradient may instead be authored in user units. Converting it to
   * objectBoundingBox is not a rescale — under a non-square box the two are not
   * the same gradient — so the space is recorded and SVG is left to do the maths.
   */
  units?: 'userSpaceOnUse'
  /** SVG gradientTransform, in the same 6-tuple order as Mat2D. */
  transform?: readonly [number, number, number, number, number, number]
  /** SVG spreadMethod. Absent means 'pad'. */
  spread?: 'reflect' | 'repeat'
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
  /** See LinearGradientPaint.units. */
  units?: 'userSpaceOnUse'
  /** SVG gradientTransform, in the same 6-tuple order as Mat2D. */
  transform?: readonly [number, number, number, number, number, number]
  /** SVG spreadMethod. Absent means 'pad'. */
  spread?: 'reflect' | 'repeat'
  /** SVG 2 focal radius. */
  fr?: number
}

/**
 * A sweep around a centre, XD's third gradient type.
 *
 * Stored parametrically like the other two, in the same unit space — only the
 * RENDERING is an approximation, because SVG has no conic paint server. See
 * angularWedges in canvas/paint.ts for how it is drawn and what that costs.
 */
export interface AngularGradientPaint {
  type: 'angular'
  cx: number
  cy: number
  /** Where the sweep starts, in degrees clockwise from the +x axis. */
  rotation: number
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
  | AngularGradientPaint
  | RefPaint

export type GradientPaint = LinearGradientPaint | RadialGradientPaint | AngularGradientPaint

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

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

/**
 * A shadow cast by an object, in the shape of XD's own
 * `Shadow(x, y, blur, color, visible)`.
 *
 * Offsets are in the node's LOCAL units and may be negative; blur may not be.
 * `visible` is the checkbox in the Properties panel: it turns the effect off
 * without discarding the settings, exactly as Adobe describes.
 *
 * Which kind of shadow it is is not stored on it: that is decided by the field
 * of the Style it is kept in (SHADOW_FIELD).
 */
export interface ShadowEffect {
  x: number
  y: number
  blur: number
  color: RGBA
  visible: boolean
}

/** Drop shadow (cast outside the shape) or inner shadow (inside its edge). */
export type ShadowKind = 'drop' | 'inner'

/**
 * Where each kind of shadow lives on a Style.
 *
 * Two fields rather than one shadow with a kind, because Adobe lists Drop
 * Shadow and Inner Shadow as two separate effects and an object can carry both
 * at once — a pressed, neumorphic button is exactly that.
 */
export const SHADOW_FIELD = {
  drop: 'shadow',
  inner: 'innerShadow',
} as const satisfies Record<ShadowKind, keyof Style>

/** What either kind of shadow starts from the first time it is ticked. */
export const DEFAULT_SHADOW: ShadowEffect = {
  x: 0,
  y: 4,
  blur: 8,
  color: { r: 0, g: 0, b: 0, a: 0.25 },
  visible: true,
}

/**
 * Blur, in the shape of XD's
 * `Blur(blurAmount, brightnessAmount, fillOpacity, visible, isBackgroundEffect)`
 * — including its ranges, which Adobe states outright.
 *
 * Object blur blurs the shape and leaves what is behind it alone. Background
 * blur is the reverse: everything beneath the shape is blurred and modulated by
 * `brightness`, while the shape itself stays crisp with its fill scaled by
 * `fillOpacity`. `brightness` and `fillOpacity` are ignored for an object blur,
 * as Adobe's own reference says.
 */
export interface BlurEffect {
  kind: 'object' | 'background'
  /** 0..50. */
  amount: number
  /** -50..50. Background blur only. */
  brightness: number
  /** 0..1, a multiplier on the shape's own fill. Background blur only. */
  fillOpacity: number
  visible: boolean
}

export const DEFAULT_BLUR: BlurEffect = {
  kind: 'background',
  amount: 10,
  brightness: 0,
  fillOpacity: 0.5,
  visible: true,
}

/** Adobe's stated ranges, shared by the inspector and the clamps in Commands. */
export const BLUR_AMOUNT_MAX = 50
export const BLUR_BRIGHTNESS_MAX = 50

export interface Style {
  fill: Paint
  fillOpacity: number
  fillRule: FillRule
  stroke: Stroke
  strokeOpacity: number
  /** Node-level alpha, multiplied with fill/stroke opacity. */
  opacity: number
  blendMode: BlendMode
  /**
   * The drop shadow. Absent means none.
   *
   * Optional rather than always-present so a document saved before effects
   * existed still loads unchanged, and so a shape with no shadow costs nothing
   * in the file.
   */
  shadow?: ShadowEffect
  /** The inner shadow, independent of the drop shadow. Absent means none. */
  innerShadow?: ShadowEffect
  /** One blur, object or background. Absent means none. */
  blur?: BlurEffect
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

/**
 * Adobe's three text resize options.
 *
 * 'auto-width'   the box grows sideways to fit the text on one line. Adobe's
 *                Auto Width, and what you get by clicking rather than dragging.
 * 'auto-height'  the width is yours, the height follows the wrapped text.
 * 'fixed'        both are yours; text that does not fit is clipped, and the
 *                bottom handle turns red to say so.
 */
export type TextSizing = 'auto-width' | 'auto-height' | 'fixed'

/**
 * Adobe's text transformations. Applied when drawing, never to the stored
 * text — so switching back to None gives you what you typed, capitals and all.
 */
export type TextTransform = 'none' | 'uppercase' | 'lowercase' | 'titlecase'

export interface TextStyle {
  fontFamily: string
  fontSize: number
  fontWeight: number
  fontStyle: FontStyle
  /** Multiplier of font size. */
  lineHeight: number
  /** In em units, matching how designers think about tracking. */
  letterSpacing: number
  /** Extra space after each paragraph, in pixels. */
  paragraphSpacing: number
  align: TextAlign
  underline: boolean
  strikethrough: boolean
  transform: TextTransform
  sizing: TextSizing
}

/**
 * The resize option a text box takes on after a resize handle changes its box.
 *
 * A resize handle is the one edit that argues with the mode, and this is the
 * answer both the in-flight preview and the commit use — so what you see while
 * dragging is what you get when you let go.
 *
 * Giving a width to Auto Width text makes it Auto Height: you have said how
 * wide, which is exactly what that mode means. Giving a height to anything
 * makes it Fixed Size, the name for owning both dimensions. Enforcing the mode
 * instead would spring the box back to the width of its own text, so the handle
 * would look broken.
 */
export function sizingAfterResize(
  current: TextSizing,
  changed: { width: boolean; height: boolean },
): TextSizing {
  if (changed.height) return 'fixed'
  if (changed.width && current === 'auto-width') return 'auto-height'
  return current
}

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: 'Inter',
  fontSize: 24,
  fontWeight: 400,
  fontStyle: 'normal',
  lineHeight: 1.4,
  letterSpacing: 0,
  paragraphSpacing: 0,
  align: 'left',
  underline: false,
  strikethrough: false,
  transform: 'none',
  sizing: 'auto-width',
}

/**
 * Apply a text transformation for display.
 *
 * Title case only capitalises after whitespace, deliberately: knowing that
 * "of" and "the" stay lowercase in a real title is a matter of language and
 * style guide, and guessing it wrong on someone's headline is worse than not
 * guessing.
 */
export function applyTextTransform(text: string, transform: TextTransform): string {
  switch (transform) {
    case 'uppercase':
      return text.toLocaleUpperCase()
    case 'lowercase':
      return text.toLocaleLowerCase()
    case 'titlecase':
      return text.replace(/\p{L}[\p{L}\p{M}']*/gu, (word) =>
        word.charAt(0).toLocaleUpperCase() + word.slice(1).toLocaleLowerCase(),
      )
    default:
      return text
  }
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
  /**
   * The 3D tilt and depth. Absent means flat, and so does all-zero: the field
   * is removed rather than zeroed when a transform is reset, so a document
   * with no 3D in it carries no trace of the feature. Never set on an artboard
   * or the document root — 3D applies to an artboard's content, not to it.
   */
  transform3d?: Transform3D
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
  /**
   * Ruler guides belonging to this artboard, in ITS local space.
   *
   * Per artboard rather than per document because that is what makes Adobe's
   * "copy and paste guides across artboards" mean anything, and because a guide
   * dragged out of an artboard's edge is a statement about that artboard.
   *
   * Optional, like the two fields below: a node loaded from an older file is
   * never backfilled with new keys, so every reader has to tolerate `undefined`.
   */
  guides?: Guide[]
  /** Adobe's "Lock All Guides": the guides stay visible but cannot be moved. */
  guidesLocked?: boolean
  /** The square or layout grid drawn over this artboard. Absent means none. */
  grid?: ArtboardGrid
}

export interface GroupNode extends StyledNode {
  type: 'group'
  children: NodeId[]
  /**
   * The child that masks the rest, making this a MASK GROUP.
   *
   * Adobe: "the object on top of the stack acts as a mask", so this is always
   * the last entry in `children` — the topmost in paint order. Modelled as a
   * flag on a plain group rather than a node type of its own, so everything
   * that already understands groups (bounds, transforms, ungroup, the layer
   * tree) keeps working on a mask group without a single new branch.
   */
  maskId?: NodeId
  /**
   * How `maskId` masks. Absent means 'clip' — a hard-edged outline clip, which
   * is XD's mask and what every mask group created in the editor is.
   *
   * SVG's <mask> is a different operation: the mask's own luminance or alpha
   * modulates what shows through, so a 50% grey mask half-hides its content.
   * An imported <mask> keeps that meaning rather than being flattened to a
   * hard clip, which is why this exists.
   */
  maskMode?: 'clip' | 'luminance' | 'alpha'
}

/** A group whose topmost child clips the rest. */
export function isMaskGroup(
  node: DesignNode | undefined | null,
): node is GroupNode & { maskId: NodeId } {
  return !!node && node.type === 'group' && typeof node.maskId === 'string'
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

/**
 * The one parametric polygon: triangle, n-gon and star are all this node.
 *
 * Adobe XD has no separate Triangle or Star tool, and neither do we. Three
 * corners is a triangle, a star ratio below 1 is a star, and every one of them
 * stays reversible — turning a star back into a triangle is two field edits, not
 * a different object.
 *
 * `cornerRadius` is a single scalar, unlike a rect's four-corner CornerRadii: a
 * polygon's corners are generated from its side count rather than being
 * individually addressable, so per-corner values would have nothing stable to
 * attach to.
 */
export interface PolygonNode extends StyledNode {
  type: 'polygon'
  /** Corner count, 3..100. XD calls this Corner Count. */
  sides: number
  /**
   * Inner radius as a fraction of the APOTHEM, 0.01..1. XD calls this Star
   * Ratio and shows it as a percentage. 1 puts the inner vertices exactly on the
   * edge midpoints, which is why 100% is a plain polygon rather than a special
   * case — see polygonStarPoints.
   */
  starRatio: number
  cornerRadius: number
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

/**
 * A stretch of characters styled differently from the rest of its text object.
 *
 * SVG's `<tspan>` lets one `<text>` mix sizes, weights and colours, and so does
 * every design tool. Runs are stored as ranges over the node's single `text`
 * string rather than as a tree of spans, for two reasons: the whole string
 * stays the thing the user edits — the canvas text editor is a plain textarea
 * and needs no knowledge of this — and `runs` being absent is exactly what
 * every document saved before rich text existed already contains.
 *
 * Ranges are half-open, non-overlapping and sorted. `style` overrides only the
 * keys it names; anything absent falls through to the node's own textStyle.
 */
export interface TextRun {
  /** Inclusive character index into TextNode.text. */
  start: number
  /** Exclusive character index into TextNode.text. */
  end: number
  /** Overrides on top of the node's textStyle. */
  style?: Partial<TextStyle>
  /** Overrides the node's fill for these characters. */
  fill?: Paint
}

export interface TextNode extends StyledNode {
  type: 'text'
  text: string
  textStyle: TextStyle
  /** Absent means the whole string uses `textStyle`, which is the common case. */
  runs?: TextRun[]
}

/**
 * Tidy a run list: drop empties, clamp to the text, sort, and merge neighbours
 * that say the same thing. Editing text moves ranges around, so this is what
 * keeps the list from accumulating slivers.
 */
export function normalizeRuns(
  runs: readonly TextRun[] | undefined,
  textLength: number,
): TextRun[] | undefined {
  if (!runs?.length) return undefined
  const clamped = runs
    .map((r) => ({
      ...r,
      start: Math.max(0, Math.min(textLength, Math.floor(r.start))),
      end: Math.max(0, Math.min(textLength, Math.floor(r.end))),
    }))
    .filter((r) => r.end > r.start && (r.style !== undefined || r.fill !== undefined))
    .sort((a, b) => a.start - b.start)

  const out: TextRun[] = []
  for (const run of clamped) {
    const last = out[out.length - 1]
    if (last && last.end === run.start && sameRunStyle(last, run)) last.end = run.end
    else out.push(run)
  }
  return out.length ? out : undefined
}

function sameRunStyle(a: TextRun, b: TextRun): boolean {
  return JSON.stringify(a.style ?? null) === JSON.stringify(b.style ?? null) &&
    JSON.stringify(a.fill ?? null) === JSON.stringify(b.fill ?? null)
}

/**
 * Shift run ranges to follow an edit that replaced [from, to) with `inserted`
 * characters, so styling stays attached to the words it was applied to.
 */
export function shiftRuns(
  runs: readonly TextRun[] | undefined,
  from: number,
  to: number,
  inserted: number,
  newLength: number,
): TextRun[] | undefined {
  if (!runs?.length) return undefined
  const delta = inserted - (to - from)
  // Each endpoint moves by where it sits relative to the edited span: entirely
  // before it stays put, entirely after it shifts, and inside it collapses to
  // the edit's start. Testing `<= from` before `>= to` matters at a caret-sized
  // edit, where from === to: text typed at a run's end belongs to what comes
  // after the run, not to the run.
  const move = (index: number) =>
    index <= from ? index : index >= to ? index + delta : from
  const moved = runs.map((r) => ({ ...r, start: move(r.start), end: move(r.end) }))
  return normalizeRuns(moved, newLength)
}

/**
 * One stretch of characters that all look the same, with its style resolved
 * against the node's own.
 *
 * What the inspector reads when a range is selected: it asks for the segments
 * the selection covers and shows a value only where they agree, which is the
 * same "common or nothing" rule a multiple selection uses.
 */
export interface ResolvedRun {
  start: number
  end: number
  style: TextStyle
  fill?: Paint
}

/**
 * The run covering a character, or undefined.
 *
 * The LAST one, and that is the rule the layout engine follows: a later run
 * replaces an earlier one outright rather than merging into it, so a run that
 * says nothing about weight leaves the weight at the node's, not at whatever an
 * overlapping run said. Anything written here has to agree with that, or the
 * inspector would describe text the canvas does not draw.
 */
function runCovering(runs: readonly TextRun[], index: number): TextRun | undefined {
  let found: TextRun | undefined
  for (const run of runs) {
    if (index >= run.start && index < run.end) found = run
  }
  return found
}

/** Every boundary where the styling can change, in order. */
function runBoundaries(runs: readonly TextRun[], textLength: number, extra: number[]): number[] {
  const points = new Set<number>([0, textLength, ...extra])
  for (const run of runs) {
    points.add(Math.max(0, Math.min(textLength, run.start)))
    points.add(Math.max(0, Math.min(textLength, run.end)))
  }
  return [...points].filter((p) => p >= 0 && p <= textLength).sort((a, b) => a - b)
}

/**
 * The distinct styles a character range is made of.
 *
 * An empty range still answers, with the single segment the caret sits in, so
 * the inspector can show what typing at the caret would produce.
 */
export function runsIn(node: TextNode, from: number, to: number): ResolvedRun[] {
  const length = node.text.length
  const lo = Math.max(0, Math.min(length, Math.min(from, to)))
  const hi = Math.max(0, Math.min(length, Math.max(from, to)))
  const runs = node.runs ?? []

  if (hi === lo) {
    // A caret inherits from the character BEFORE it, which is what makes
    // typing continue the word you are in rather than starting a new style.
    const at = Math.max(0, lo - 1)
    const run = runCovering(runs, at)
    return [{ start: lo, end: lo, style: { ...node.textStyle, ...run?.style }, ...(run?.fill ? { fill: run.fill } : {}) }]
  }

  const out: ResolvedRun[] = []
  const points = runBoundaries(runs, length, [lo, hi]).filter((p) => p >= lo && p <= hi)
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i]!
    const end = points[i + 1]!
    if (end <= start) continue
    const run = runCovering(runs, start)
    out.push({
      start,
      end,
      style: { ...node.textStyle, ...run?.style },
      ...(run?.fill ? { fill: run.fill } : {}),
    })
  }
  return out
}

/** What a range should be styled with. `fill: null` removes a fill override. */
export interface RunPatch {
  style?: Partial<TextStyle>
  fill?: Paint | null
}

/**
 * Style one character range, leaving the rest alone.
 *
 * Existing runs are cut at the range's edges and the patch is merged into the
 * pieces inside it, so styling a word in the middle of an already-styled
 * sentence keeps both. The output never overlaps, which is worth more than it
 * sounds: overlapping runs are legal for the layout engine but make every later
 * question ("what is this character's weight?") depend on list order.
 */
export function applyRunStyle(
  runs: readonly TextRun[] | undefined,
  textLength: number,
  from: number,
  to: number,
  patch: RunPatch,
): TextRun[] | undefined {
  const lo = Math.max(0, Math.min(textLength, Math.min(from, to)))
  const hi = Math.max(0, Math.min(textLength, Math.max(from, to)))
  const existing = runs ?? []
  if (hi <= lo) return normalizeRuns(existing, textLength)

  const out: TextRun[] = []
  const points = runBoundaries(existing, textLength, [lo, hi])
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i]!
    const end = points[i + 1]!
    if (end <= start) continue

    const covering = runCovering(existing, start)
    const inside = start >= lo && end <= hi
    const style = inside ? { ...covering?.style, ...patch.style } : covering?.style
    const fill = inside
      ? patch.fill === null
        ? undefined
        : (patch.fill ?? covering?.fill)
      : covering?.fill

    const hasStyle = style && Object.keys(style).length > 0
    if (!hasStyle && !fill) continue
    out.push({ start, end, ...(hasStyle ? { style } : {}), ...(fill ? { fill } : {}) })
  }

  return normalizeRuns(out, textLength)
}

export type ImageFit = 'fill' | 'contain' | 'cover'

/**
 * The part of an image's picture that is kept, as fractions of the whole —
 * 0..1 on each axis, so it means the same whatever size the picture is drawn
 * at and whether or not its true pixel size is known (an image imported from
 * SVG only knows the size it was drawn).
 */
export interface ImageCrop {
  x: number
  y: number
  width: number
  height: number
}

export interface ImageNode extends StyledNode {
  type: 'image'
  assetId: AssetId
  fit: ImageFit
  cornerRadius: CornerRadii
  /**
   * Cropped away non-destructively: the asset keeps every pixel, and the node's
   * box is the kept part. Because the box IS the kept part, bounds, hit
   * testing, snapping, masks, export and Image Trace all see the crop as the
   * image without knowing it exists. Absent means the whole picture.
   */
  crop?: ImageCrop
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
  | PolygonNode
  | LineNode
  | PathNode
  | TextNode
  | ImageNode
  | SvgNode

export type ContainerNode = DocumentRootNode | ArtboardNode | GroupNode | RepeatGridNode
/** Every union member that actually carries a `style` field. */
export type StyledDesignNode = Exclude<DesignNode, DocumentRootNode | ArtboardNode>
export type ShapeNode =
  | RectNode | EllipseNode | PolygonNode | LineNode | PathNode

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

/**
 * A ruler guide. `axis: 'x'` is a VERTICAL line at that x.
 *
 * `position` is in the owning artboard's local space — see ArtboardNode.guides.
 */
export interface Guide {
  id: string
  axis: 'x' | 'y'
  position: number
}

/**
 * A colour the user saved, with its opacity.
 *
 * Document data, deliberately — like guides, and like XD's Assets panel. The
 * palette travels with the artwork rather than being stuck in one browser.
 */
export interface Swatch {
  id: string
  color: RGBA
}

// ---------------------------------------------------------------------------
// Artboard grids
// ---------------------------------------------------------------------------

/**
 * Adobe's two grid kinds, chosen per artboard in the Grid section of the
 * Property Inspector.
 *
 * A SQUARE grid is a drawing aid — "horizontal and vertical lines for precise
 * sizing and aligning objects". A LAYOUT grid is a column grid, "useful when
 * aligning design objects or designing for different screen sizes".
 *
 * The colour is document data rather than a theme token, unlike the canvas
 * grid: Adobe lets you set it (and its alpha) per artboard, so it travels with
 * the artwork the way a fill does.
 */
export type ArtboardGrid = SquareGrid | LayoutGrid

export interface SquareGrid {
  type: 'square'
  visible: boolean
  /** Adobe's "Square Size". */
  size: number
  color: RGBA
}

export interface LayoutGrid {
  type: 'layout'
  visible: boolean
  columns: number
  /** Space BETWEEN columns, not around them. */
  gutter: number
  /** Distance from the artboard edge to the first and last column. */
  marginLeft: number
  marginRight: number
  color: RGBA
}

/** Adobe's worked example: square size 8, drawn at 20% alpha. */
export const DEFAULT_SQUARE_GRID: SquareGrid = {
  type: 'square',
  visible: true,
  size: 8,
  color: { r: 0, g: 0, b: 0, a: 0.2 },
}

export const DEFAULT_LAYOUT_GRID: LayoutGrid = {
  type: 'layout',
  visible: true,
  columns: 12,
  gutter: 20,
  marginLeft: 16,
  marginRight: 16,
  color: { r: 255, g: 45, b: 85, a: 0.1 },
}

/**
 * The gutter that would produce a requested column width.
 *
 * Adobe's inspector lets you adjust the column width even though it is derived:
 * the artboard's width is fixed, so something else has to give, and the gutter
 * is the one parameter with no other job. Null when there are fewer than two
 * columns — with one column there is no gutter to solve for.
 */
export function gutterForColumnWidth(
  artboardWidth: number,
  grid: LayoutGrid,
  columnWidth: number,
): number | null {
  const columns = Math.max(1, Math.round(grid.columns))
  if (columns < 2) return null
  const gutter =
    (artboardWidth - grid.marginLeft - grid.marginRight - columns * columnWidth) / (columns - 1)
  return Number.isFinite(gutter) ? Math.max(0, gutter) : null
}

/**
 * The columns a layout grid paints, in artboard-local units.
 *
 * Column width is DERIVED and never stored, which is the whole of Adobe's
 * "layout grid parameters are calculated based on artboard width and number of
 * columns so that the grid is kept within the bounds of artboard": there is no
 * way to author a width that does not fit, because the width is not authored.
 *
 * Returns nothing at all when the margins and gutters have eaten the artboard,
 * so an over-constrained grid draws nothing rather than spilling past the edge.
 */
export function layoutColumns(
  artboardWidth: number,
  grid: LayoutGrid,
): Array<{ x: number; width: number }> {
  const columns = Math.max(1, Math.round(grid.columns))
  const gutter = Math.max(0, grid.gutter)
  const usable = artboardWidth - grid.marginLeft - grid.marginRight - (columns - 1) * gutter
  const width = usable / columns
  if (!Number.isFinite(width) || width < 1) return []

  const out: Array<{ x: number; width: number }> = []
  for (let i = 0; i < columns; i++) {
    out.push({ x: grid.marginLeft + i * (width + gutter), width })
  }
  return out
}

/**
 * Where a guide can be picked up.
 *
 * 'line'   anywhere along it, plus its handle — quickest, but the line lies
 *          across the artwork and can be caught by accident.
 * 'handle' only the handle at the artboard's edge, which puts the whole of the
 *          artboard back within reach of the tools.
 */
export type GuideDragMode = 'line' | 'handle'

export interface DocumentSettings {
  gridSize: number
  gridVisible: boolean
  snapToGrid: boolean
  snapToObjects: boolean
  guidesVisible: boolean
  /** Guides are chrome, but their colour is the user's — see the README. */
  guideColor: RGBA
  guideDragMode: GuideDragMode
}

export const DEFAULT_SETTINGS: DocumentSettings = {
  gridSize: 8,
  gridVisible: false,
  snapToGrid: false,
  snapToObjects: true,
  guidesVisible: true,
  guideColor: { r: 216, g: 55, b: 144, a: 1 },
  guideDragMode: 'line',
}

export interface DesignDocument {
  id: string
  name: string
  /** Flat id -> node map. Z-order lives in each container's `children`. */
  nodes: Record<NodeId, DesignNode>
  rootId: NodeId
  assets: Record<AssetId, ImageAsset>
  swatches: Swatch[]
  settings: DocumentSettings
  /**
   * Paint servers and other <defs> entries carried in from imported SVG, keyed
   * by their (already namespaced) id, emitted once for the whole document.
   *
   * Document-level rather than per-node because a reference is not owned by the
   * shape that uses it: several shapes share one gradient or pattern, and a
   * shape carrying a RefPaint of `url(#p)` has nowhere of its own to put the
   * definition. Absent on every document saved before this existed.
   */
  svgDefs?: Record<string, string>
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
    case 'polygon':
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

/** Types whose vertices round by a single scalar radius. */
export function hasScalarCornerRadius(
  node: DesignNode | undefined | null,
): node is PolygonNode {
  return !!node && node.type === 'polygon'
}

/** Any node that supports corner rounding at all. */
export function supportsCornerRadius(node: DesignNode | undefined | null): boolean {
  return !!node && (hasCornerRadius(node) || hasScalarCornerRadius(node))
}

/**
 * Whether a node can carry a 3D transform at all.
 *
 * Adobe: "3D Transforms cannot be applied to artboards, only to their
 * content." The document root is not content either.
 */
export function supports3d(node: DesignNode | undefined | null): boolean {
  return !!node && node.type !== 'document' && node.type !== 'artboard'
}

/** True when the tilt or depth would change anything at all. */
export function is3dTransform(t: Transform3D | undefined | null): t is Transform3D {
  return !!t && (t.rotateX !== 0 || t.rotateY !== 0 || t.z !== 0)
}

/**
 * The 3D transform a node actually renders with, or undefined when it is flat.
 *
 * The one reader everything goes through, so an artboard that somehow carries
 * the field — a hand-edited file, a paste from a future version — is still
 * drawn flat, as Adobe says it must be.
 */
export function transform3dOf(node: DesignNode | undefined | null): Transform3D | undefined {
  if (!node || !supports3d(node)) return undefined
  return is3dTransform(node.transform3d) ? node.transform3d : undefined
}

/** The four corners of a box, in CornerRadii order. */
export const CORNER_ORDER = ['nw', 'ne', 'se', 'sw'] as const
export type BoxCorner = (typeof CORNER_ORDER)[number]

export function cornerIndex(corner: BoxCorner): number {
  return CORNER_ORDER.indexOf(corner)
}

/**
 * Current radius of a rounding-capable node, as a single number.
 *
 * `?? 0` is load-bearing: documents saved before triangle/polygon/star gained a
 * radius have no such field, and without the fallback the inspector renders NaN
 * into the corner-radius input for every legacy shape.
 */
export function cornerRadiusOf(node: DesignNode, corner?: BoxCorner): number {
  if (node.type === 'rect' || node.type === 'image') {
    const radii = node.cornerRadius ?? [0, 0, 0, 0]
    return (corner ? radii[cornerIndex(corner)] : radii[0]) ?? 0
  }
  if (hasScalarCornerRadius(node)) return node.cornerRadius ?? 0
  return 0
}

/** True when all four corners of a box carry the same radius. */
export function isUniformCornerRadius(radii: CornerRadii | undefined): boolean {
  if (!radii) return true
  return radii[0] === radii[1] && radii[1] === radii[2] && radii[2] === radii[3]
}
