/**
 * SVG import.
 *
 * Imported SVG becomes real, editable scene-graph nodes — never a bitmap, and
 * never a single opaque blob. Shapes become shapes, gradients become gradient
 * paints, groups become groups, transforms are decomposed into the same
 * Transform every other node uses.
 *
 * The important design decision is what happens to constructs the editor has no
 * first-class model for: <use>, <symbol>, <pattern>, <mask>, <filter>, <marker>.
 * They are NOT dropped and NOT flattened. Their sanitized markup is preserved
 * verbatim in an `svg` node together with the <defs> it needs, so the artwork
 * still renders exactly as authored, still scales and rotates as vector, and
 * still exports as vector. Fidelity is preserved even where editability cannot be.
 *
 * Measurement uses the browser's own getBBox on a temporarily mounted copy.
 * That is legitimate here — this module only ever runs in a browser during an
 * import, unlike the geometry layer, which stays DOM-free so it can be tested.
 */

import {
  compose,
  multiply,
  parseSvgTransform,
  translation,
  type Mat2D,
} from '../geometry/Matrix'
import { pathBounds, transformPath } from '../geometry/PathUtils'
import { transformFromMatrix } from '../document/DocumentModel'
import { createAssetId, createStopId } from '../document/ids'
import {
  cloneStyle,
  createEllipse,
  createGroup,
  createImage,
  createPath,
  createRect,
  createSvgNode,
  createText,
} from '../document/NodeFactory'
import { parseCssColor } from '../document/color'
import { sanitizeSvg } from './SvgSanitizer'
import { namespaceRawSvg } from './IdNamespacer'
import { DEFAULT_STROKE, DEFAULT_TEXT_STYLE } from '../document/types'
import type {
  DesignNode,
  GradientStop,
  ImageAsset,
  NodeId,
  Paint,
  Style,
  TextAlign,
} from '../document/types'
import type { LineCap, LineJoin, FillRule } from '../geometry/PathUtils'

export interface SvgImportResult {
  /** Flat map of every node created, keyed by id. */
  nodes: Record<NodeId, DesignNode>
  /** Top-level node to insert (a group when the file had multiple children). */
  rootId: NodeId | null
  assets: ImageAsset[]
  warnings: string[]
  /** Intrinsic size from width/height or viewBox. */
  size: { width: number; height: number }
}

/** Elements we map to first-class nodes. Everything else is preserved verbatim. */
const NATIVE_TAGS = new Set([
  'g', 'rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline', 'path', 'text', 'image', 'svg',
])

/** Elements that only define resources and must not be walked as content. */
const DEFINITION_TAGS = new Set([
  'defs', 'lineargradient', 'radialgradient', 'clippath', 'mask', 'pattern',
  'filter', 'marker', 'symbol', 'style', 'title', 'desc', 'metadata', 'stop',
])

interface InheritedStyle {
  fill: string | null
  stroke: string | null
  fillOpacity: number
  strokeOpacity: number
  strokeWidth: number
  opacity: number
  fillRule: FillRule
  lineCap: LineCap
  lineJoin: LineJoin
  miterLimit: number
  dashArray: number[]
  dashOffset: number
  fontFamily: string
  fontSize: number
  fontWeight: number
  fontStyle: 'normal' | 'italic'
  textAnchor: TextAlign
  letterSpacing: number
}

const ROOT_INHERITED: InheritedStyle = {
  fill: '#000000',
  stroke: null,
  fillOpacity: 1,
  strokeOpacity: 1,
  strokeWidth: 1,
  opacity: 1,
  fillRule: 'nonzero',
  lineCap: 'butt',
  lineJoin: 'miter',
  miterLimit: 4,
  dashArray: [],
  dashOffset: 0,
  fontFamily: DEFAULT_TEXT_STYLE.fontFamily,
  fontSize: 16,
  fontWeight: 400,
  fontStyle: 'normal',
  textAnchor: 'left',
  letterSpacing: 0,
}

interface ImportContext {
  nodes: Record<NodeId, DesignNode>
  assets: ImageAsset[]
  warnings: Set<string>
  gradients: Map<string, Paint>
  /** Serialized <defs> content needed by preservation nodes. */
  defsMarkup: string
  measure: (el: Element) => { x: number; y: number; width: number; height: number } | null
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function importSvg(source: string, name = 'SVG'): SvgImportResult {
  const empty: SvgImportResult = {
    nodes: {},
    rootId: null,
    assets: [],
    warnings: [],
    size: { width: 0, height: 0 },
  }

  // Namespacing runs BEFORE sanitization: DOMPurify deletes ids that collide
  // with property names on `document` (title, body, location, ...), which would
  // orphan every url(#...) gradient, clip and mask pointing at them. Renaming
  // first also guarantees two imported files can never collide.
  const { root, removed } = sanitizeSvg(namespaceRawSvg(source))
  if (!root) {
    return { ...empty, warnings: ['This SVG could not be parsed and was not imported.'] }
  }

  const warnings = new Set<string>()
  if (removed.length) {
    warnings.add(`Removed for safety: ${removed.join(', ')}.`)
  }

  return withMountedSvg(root, (measure) => {
    const ctx: ImportContext = {
      nodes: {},
      assets: [],
      warnings,
      gradients: collectGradients(root),
      defsMarkup: collectDefsMarkup(root),
      measure,
    }

    const viewBox = parseViewBox(root)
    const size = intrinsicSize(root, viewBox)

    // The viewBox maps the source coordinate system onto the placed size.
    const rootMatrix: Mat2D = viewBox
      ? compose(
          translation(-viewBox.x, -viewBox.y),
          [size.width / (viewBox.width || 1), 0, 0, size.height / (viewBox.height || 1), 0, 0],
        )
      : [1, 0, 0, 1, 0, 0]

    const children: NodeId[] = []
    for (const child of Array.from(root.children)) {
      const id = walkElement(child, ctx, ROOT_INHERITED, rootMatrix)
      if (id) children.push(id)
    }

    if (children.length === 0) {
      warnings.add('This SVG contained no drawable content.')
      return { ...empty, warnings: [...warnings], size }
    }

    // A single child is inserted directly; several are wrapped so the import
    // behaves as one object the user can move.
    let rootId: NodeId
    if (children.length === 1) {
      rootId = children[0]!
      ctx.nodes[rootId]!.name = name
    } else {
      const group = createGroup(children, { x: 0, y: 0, width: size.width, height: size.height })
      group.name = name
      for (const c of children) ctx.nodes[c]!.parentId = group.id
      ctx.nodes[group.id] = group
      rootId = group.id
    }

    return {
      nodes: ctx.nodes,
      rootId,
      assets: ctx.assets,
      warnings: [...warnings],
      size,
    }
  })
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

/**
 * Mount a copy of the SVG off-screen so the browser can measure arbitrary
 * content for us, then tear it down. Used for text and for preservation nodes,
 * where computing bounds analytically is not possible.
 */
function withMountedSvg<T>(
  root: SVGSVGElement,
  fn: (measure: (el: Element) => { x: number; y: number; width: number; height: number } | null) => T,
): T {
  if (typeof document === 'undefined') {
    return fn(() => null)
  }
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText =
    'position:absolute;left:-99999px;top:-99999px;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none'
  host.appendChild(root)
  document.body.appendChild(host)

  try {
    return fn((el) => {
      try {
        const graphics = el as SVGGraphicsElement
        if (typeof graphics.getBBox !== 'function') return null
        const b = graphics.getBBox()
        if (!Number.isFinite(b.width) || !Number.isFinite(b.height)) return null
        return { x: b.x, y: b.y, width: b.width, height: b.height }
      } catch {
        return null
      }
    })
  } finally {
    host.remove()
  }
}

// ---------------------------------------------------------------------------
// Tree walking
// ---------------------------------------------------------------------------

function walkElement(
  el: Element,
  ctx: ImportContext,
  inherited: InheritedStyle,
  parentMatrix: Mat2D,
): NodeId | null {
  const tag = el.tagName.toLowerCase()
  if (DEFINITION_TAGS.has(tag)) return null
  if (el.getAttribute('display') === 'none') return null

  const style = resolveStyle(el, inherited)
  const own = parseSvgTransform(el.getAttribute('transform'))
  const matrix = multiply(parentMatrix, own)

  // Anything we cannot model natively is preserved verbatim rather than dropped.
  if (!NATIVE_TAGS.has(tag)) {
    return createPreservationNode(el, ctx, matrix, tag)
  }

  switch (tag) {
    case 'g':
    case 'svg':
      return importGroup(el, ctx, style, matrix)
    case 'rect':
      return importRect(el, ctx, style, matrix)
    case 'circle':
    case 'ellipse':
      return importEllipse(el, ctx, style, matrix, tag === 'circle')
    case 'line':
      return importLine(el, ctx, style, matrix)
    case 'polygon':
    case 'polyline':
      return importPolyish(el, ctx, style, matrix, tag === 'polygon')
    case 'path':
      return importPath(el, ctx, style, matrix)
    case 'text':
      return importText(el, ctx, style, matrix)
    case 'image':
      return importImage(el, ctx, style, matrix)
    default:
      return null
  }
}

function importGroup(
  el: Element,
  ctx: ImportContext,
  style: InheritedStyle,
  matrix: Mat2D,
): NodeId | null {
  // A group referencing a clip or mask cannot be represented natively without
  // losing the clip, so the whole subtree is preserved instead.
  if (el.getAttribute('clip-path') || el.getAttribute('mask') || el.getAttribute('filter')) {
    ctx.warnings.add(
      'Some SVG features could not be fully edited, but the original vector content was preserved.',
    )
    return createPreservationNode(el, ctx, matrix, el.tagName.toLowerCase())
  }

  const children: NodeId[] = []
  for (const child of Array.from(el.children)) {
    const id = walkElement(child, ctx, style, [1, 0, 0, 1, 0, 0])
    if (id) children.push(id)
  }
  if (children.length === 0) return null

  const group = createGroup(children, { x: 0, y: 0, width: 1, height: 1 })
  group.name = el.getAttribute('id')?.replace(/^svg[a-z0-9]+-/, '') || 'Group'
  group.transform = transformFromMatrix(matrix, 1, 1, 0, 0)
  group.style.opacity = style.opacity

  for (const c of children) ctx.nodes[c]!.parentId = group.id
  ctx.nodes[group.id] = group

  // Size the group to its content so the selection frame is meaningful.
  sizeGroupToChildren(group.id, ctx)
  return group.id
}

function sizeGroupToChildren(groupId: NodeId, ctx: ImportContext): void {
  const group = ctx.nodes[groupId]
  if (!group || group.type !== 'group') return
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const childId of group.children) {
    const child = ctx.nodes[childId]
    if (!child) continue
    const t = child.transform
    minX = Math.min(minX, t.x)
    minY = Math.min(minY, t.y)
    maxX = Math.max(maxX, t.x + t.width)
    maxY = Math.max(maxY, t.y + t.height)
  }
  if (!Number.isFinite(minX)) return
  group.transform = { ...group.transform, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) }
}

function importRect(el: Element, ctx: ImportContext, style: InheritedStyle, matrix: Mat2D): NodeId {
  const x = num(el, 'x', 0)
  const y = num(el, 'y', 0)
  const w = Math.max(0, num(el, 'width', 0))
  const h = Math.max(0, num(el, 'height', 0))
  const rx = num(el, 'rx', 0)
  const ry = num(el, 'ry', rx)
  const r = Math.max(rx, ry)

  const node = createRect(
    transformFromMatrix(multiply(matrix, translation(x, y)), w, h, 0, 0),
    toStyle(style, ctx, el),
    [r, r, r, r],
  )
  node.name = elementName(el, 'Rectangle')
  ctx.nodes[node.id] = node
  return node.id
}

function importEllipse(
  el: Element,
  ctx: ImportContext,
  style: InheritedStyle,
  matrix: Mat2D,
  isCircle: boolean,
): NodeId {
  const cx = num(el, 'cx', 0)
  const cy = num(el, 'cy', 0)
  const rx = isCircle ? num(el, 'r', 0) : num(el, 'rx', 0)
  const ry = isCircle ? num(el, 'r', 0) : num(el, 'ry', 0)

  const node = createEllipse(
    transformFromMatrix(multiply(matrix, translation(cx - rx, cy - ry)), rx * 2, ry * 2, 0, 0),
    toStyle(style, ctx, el),
  )
  node.name = elementName(el, isCircle ? 'Circle' : 'Ellipse')
  ctx.nodes[node.id] = node
  return node.id
}

function importLine(el: Element, ctx: ImportContext, style: InheritedStyle, matrix: Mat2D): NodeId {
  const x1 = num(el, 'x1', 0)
  const y1 = num(el, 'y1', 0)
  const x2 = num(el, 'x2', 0)
  const y2 = num(el, 'y2', 0)
  // A line is stored as a path so its geometry survives every transform intact.
  return addPathNode(`M${x1} ${y1} L${x2} ${y2}`, el, ctx, style, matrix, 'Line', false)
}

function importPolyish(
  el: Element,
  ctx: ImportContext,
  style: InheritedStyle,
  matrix: Mat2D,
  closed: boolean,
): NodeId | null {
  const raw = el.getAttribute('points') ?? ''
  const nums = raw.split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n))
  if (nums.length < 4) return null
  const parts: string[] = [`M${nums[0]} ${nums[1]}`]
  for (let i = 2; i + 1 < nums.length; i += 2) parts.push(`L${nums[i]} ${nums[i + 1]}`)
  if (closed) parts.push('Z')
  return addPathNode(parts.join(' '), el, ctx, style, matrix, closed ? 'Polygon' : 'Polyline', closed)
}

function importPath(el: Element, ctx: ImportContext, style: InheritedStyle, matrix: Mat2D): NodeId | null {
  const d = el.getAttribute('d')
  if (!d || !d.trim()) return null
  return addPathNode(d, el, ctx, style, matrix, 'Path', /z\s*$/i.test(d.trim()))
}

/**
 * Rebase path data so the node's local space starts at its own bounding box.
 * Keeps every node's local origin at (0,0), which is what makes transforms,
 * resize handles and the inspector's X/Y consistent across node types.
 */
function addPathNode(
  d: string,
  el: Element,
  ctx: ImportContext,
  style: InheritedStyle,
  matrix: Mat2D,
  fallbackName: string,
  closed: boolean,
): NodeId {
  const b = pathBounds(d)
  const localD = transformPath(d, translation(-b.x, -b.y))
  const node = createPath(
    localD,
    transformFromMatrix(
      multiply(matrix, translation(b.x, b.y)),
      Math.max(0.5, b.width),
      Math.max(0.5, b.height),
      0,
      0,
    ),
    toStyle(style, ctx, el),
    closed,
  )
  node.name = elementName(el, fallbackName)
  ctx.nodes[node.id] = node
  return node.id
}

function importText(el: Element, ctx: ImportContext, style: InheritedStyle, matrix: Mat2D): NodeId | null {
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return null

  const measured = ctx.measure(el)
  const x = num(el, 'x', 0)
  const y = num(el, 'y', 0)
  const width = measured?.width ?? text.length * style.fontSize * 0.5
  const height = measured?.height ?? style.fontSize * 1.2

  // SVG positions text on its baseline; our text box is measured from its top.
  const topY = measured ? measured.y : y - style.fontSize * 0.8
  const leftX = measured ? measured.x : x

  const node = createText(
    text,
    transformFromMatrix(multiply(matrix, translation(leftX, topY)), width, height, 0, 0),
    toStyle(style, ctx, el),
    {
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      fontStyle: style.fontStyle,
      align: style.textAnchor,
      letterSpacing: style.fontSize > 0 ? style.letterSpacing / style.fontSize : 0,
      sizing: 'auto',
    },
  )
  node.name = elementName(el, text.slice(0, 30) || 'Text')
  ctx.nodes[node.id] = node
  return node.id
}

function importImage(el: Element, ctx: ImportContext, style: InheritedStyle, matrix: Mat2D): NodeId | null {
  const href = el.getAttribute('href') ?? el.getAttribute('xlink:href')
  if (!href) return null
  // The sanitizer only permits data: image URLs, so anything else is already gone.
  if (!href.startsWith('data:image/')) {
    ctx.warnings.add('An embedded image referenced an external file and was skipped.')
    return null
  }

  const x = num(el, 'x', 0)
  const y = num(el, 'y', 0)
  const w = Math.max(1, num(el, 'width', 0))
  const h = Math.max(1, num(el, 'height', 0))

  const asset: ImageAsset = {
    id: createAssetId(),
    name: elementName(el, 'Image'),
    mimeType: /^data:([^;]+)/.exec(href)?.[1] ?? 'image/png',
    width: w,
    height: h,
    byteSize: Math.round((href.length * 3) / 4),
    dataUrl: href,
  }
  ctx.assets.push(asset)

  const node = createImage(
    asset.id,
    asset.name,
    transformFromMatrix(multiply(matrix, translation(x, y)), w, h, 0, 0),
  )
  node.style.opacity = style.opacity
  ctx.nodes[node.id] = node
  return node.id
}

/**
 * Preservation node: keep the sanitized markup verbatim.
 *
 * This is what makes <use>, <pattern>, <mask>, <filter> and <marker> survive an
 * import as real vector rather than being discarded or rasterized. The defs the
 * subtree references travel with it, so it renders standalone.
 */
function createPreservationNode(
  el: Element,
  ctx: ImportContext,
  matrix: Mat2D,
  tag: string,
): NodeId | null {
  const box = ctx.measure(el)
  if (!box || box.width <= 0 || box.height <= 0) return null

  ctx.warnings.add(
    'Some SVG features could not be fully edited, but the original vector content was preserved.',
  )

  const markup = el.outerHTML || ''
  if (!markup) return null

  const node = createSvgNode(
    markup,
    ctx.defsMarkup,
    { x: box.x, y: box.y, width: box.width, height: box.height },
    transformFromMatrix(multiply(matrix, translation(box.x, box.y)), box.width, box.height, 0, 0),
    elementName(el, tag),
  )
  ctx.nodes[node.id] = node
  return node.id
}

// ---------------------------------------------------------------------------
// Style resolution
// ---------------------------------------------------------------------------

/** Presentation attribute, falling back to inline style, then to inheritance. */
function attr(el: Element, name: string): string | null {
  const inline = inlineStyleValue(el, name)
  if (inline !== null) return inline
  return el.getAttribute(name)
}

function inlineStyleValue(el: Element, prop: string): string | null {
  const style = el.getAttribute('style')
  if (!style) return null
  const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i')
  const m = re.exec(style)
  return m ? m[1]!.trim() : null
}

function resolveStyle(el: Element, parent: InheritedStyle): InheritedStyle {
  const next: InheritedStyle = { ...parent }

  const fill = attr(el, 'fill')
  if (fill !== null) next.fill = fill.trim()
  const stroke = attr(el, 'stroke')
  if (stroke !== null) next.stroke = stroke.trim()

  const fo = numAttr(attr(el, 'fill-opacity'))
  if (fo !== null) next.fillOpacity = clamp01(fo)
  const so = numAttr(attr(el, 'stroke-opacity'))
  if (so !== null) next.strokeOpacity = clamp01(so)
  const op = numAttr(attr(el, 'opacity'))
  next.opacity = op !== null ? clamp01(op) : 1 // opacity is NOT inherited in SVG

  const sw = numAttr(attr(el, 'stroke-width'))
  if (sw !== null) next.strokeWidth = Math.max(0, sw)

  const fr = attr(el, 'fill-rule') ?? attr(el, 'clip-rule')
  if (fr === 'evenodd' || fr === 'nonzero') next.fillRule = fr

  const cap = attr(el, 'stroke-linecap')
  if (cap === 'butt' || cap === 'round' || cap === 'square') next.lineCap = cap
  const join = attr(el, 'stroke-linejoin')
  if (join === 'miter' || join === 'round' || join === 'bevel') next.lineJoin = join
  const ml = numAttr(attr(el, 'stroke-miterlimit'))
  if (ml !== null) next.miterLimit = ml

  const dash = attr(el, 'stroke-dasharray')
  if (dash !== null) {
    next.dashArray =
      dash === 'none'
        ? []
        : dash.split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n) && n >= 0)
  }
  const dashOff = numAttr(attr(el, 'stroke-dashoffset'))
  if (dashOff !== null) next.dashOffset = dashOff

  const family = attr(el, 'font-family')
  if (family) next.fontFamily = family.split(',')[0]!.trim().replace(/["']/g, '')
  const size = numAttr(attr(el, 'font-size'))
  if (size !== null) next.fontSize = size
  const weight = attr(el, 'font-weight')
  if (weight) {
    const n = Number(weight)
    next.fontWeight = Number.isFinite(n) ? n : weight === 'bold' ? 700 : 400
  }
  const fontStyle = attr(el, 'font-style')
  if (fontStyle === 'italic' || fontStyle === 'oblique') next.fontStyle = 'italic'
  else if (fontStyle === 'normal') next.fontStyle = 'normal'

  const anchor = attr(el, 'text-anchor')
  if (anchor === 'middle') next.textAnchor = 'center'
  else if (anchor === 'end') next.textAnchor = 'right'
  else if (anchor === 'start') next.textAnchor = 'left'

  const ls = numAttr(attr(el, 'letter-spacing'))
  if (ls !== null) next.letterSpacing = ls

  return next
}

function toStyle(inherited: InheritedStyle, ctx: ImportContext, el: Element): Partial<Style> {
  const hasStroke = inherited.stroke !== null && inherited.stroke !== 'none'
  return {
    fill: paintFrom(inherited.fill, ctx, el),
    fillOpacity: inherited.fillOpacity,
    fillRule: inherited.fillRule,
    strokeOpacity: inherited.strokeOpacity,
    opacity: inherited.opacity,
    stroke: {
      ...DEFAULT_STROKE,
      paint: hasStroke ? paintFrom(inherited.stroke, ctx, el) : { type: 'none' },
      width: inherited.strokeWidth,
      cap: inherited.lineCap,
      join: inherited.lineJoin,
      miterLimit: inherited.miterLimit,
      dashArray: [...inherited.dashArray],
      dashOffset: inherited.dashOffset,
      align: 'center',
    },
  }
}

function paintFrom(value: string | null, ctx: ImportContext, el: Element): Paint {
  if (!value || value === 'none' || value === 'transparent') return { type: 'none' }

  const urlMatch = /^url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)/.exec(value)
  if (urlMatch) {
    const id = urlMatch[1]!
    const gradient = ctx.gradients.get(id)
    if (gradient) return structuredClone(gradient)
    // A paint server we do not model (a pattern). Keep the reference alive so
    // it still renders, rather than replacing it with a flat colour.
    ctx.warnings.add('A pattern or unsupported paint was preserved but cannot be edited.')
    return { type: 'ref', ref: value }
  }

  if (value === 'currentColor') {
    const cc = el.getAttribute('color')
    const parsed = cc ? parseCssColor(cc) : null
    return parsed ? { type: 'solid', color: parsed } : { type: 'solid', color: { r: 0, g: 0, b: 0, a: 1 } }
  }

  const color = parseCssColor(value)
  return color ? { type: 'solid', color } : { type: 'none' }
}

// ---------------------------------------------------------------------------
// Gradients
// ---------------------------------------------------------------------------

function collectGradients(root: Element): Map<string, Paint> {
  const out = new Map<string, Paint>()
  const elements = Array.from(root.querySelectorAll('linearGradient, radialGradient'))

  // Two passes so a gradient that inherits stops via href resolves regardless
  // of document order.
  const byId = new Map<string, Element>()
  for (const el of elements) {
    const id = el.getAttribute('id')
    if (id) byId.set(id, el)
  }

  for (const el of elements) {
    const id = el.getAttribute('id')
    if (!id) continue
    const paint = parseGradient(el, byId, 0)
    if (paint) out.set(id, paint)
  }
  return out
}

function parseGradient(
  el: Element,
  byId: Map<string, Element>,
  depth: number,
): Paint | null {
  if (depth > 4) return null
  const stops = collectStops(el, byId, depth)
  if (stops.length === 0) return null

  const isLinear = el.tagName.toLowerCase() === 'lineargradient'
  const userSpace = el.getAttribute('gradientUnits') === 'userSpaceOnUse'
  const gt = parseSvgTransform(el.getAttribute('gradientTransform'))

  if (isLinear) {
    // Coordinates are stored in objectBoundingBox units. A gradientTransform is
    // affine and these are points, so applying it to the endpoints is exact.
    let x1 = numOr(el.getAttribute('x1'), 0)
    let y1 = numOr(el.getAttribute('y1'), 0)
    let x2 = numOr(el.getAttribute('x2'), 1)
    let y2 = numOr(el.getAttribute('y2'), 0)
    if (userSpace) {
      // Without the element's bbox we cannot convert exactly; a horizontal
      // sweep is a far better fallback than dropping the gradient.
      const dx = x2 - x1
      const dy = y2 - y1
      const len = Math.hypot(dx, dy) || 1
      x1 = 0; y1 = 0
      x2 = Math.abs(dx) / len
      y2 = Math.abs(dy) / len
      if (x2 === 0 && y2 === 0) { x2 = 1; y2 = 0 }
    }
    const p1 = { x: gt[0] * x1 + gt[2] * y1 + gt[4], y: gt[1] * x1 + gt[3] * y1 + gt[5] }
    const p2 = { x: gt[0] * x2 + gt[2] * y2 + gt[4], y: gt[1] * x2 + gt[3] * y2 + gt[5] }
    return { type: 'linear', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, stops }
  }

  const cx = numOr(el.getAttribute('cx'), 0.5)
  const cy = numOr(el.getAttribute('cy'), 0.5)
  const r = numOr(el.getAttribute('r'), 0.5)
  const fx = el.getAttribute('fx') !== null ? numOr(el.getAttribute('fx'), cx) : undefined
  const fy = el.getAttribute('fy') !== null ? numOr(el.getAttribute('fy'), cy) : undefined
  return {
    type: 'radial',
    cx: userSpace ? 0.5 : cx,
    cy: userSpace ? 0.5 : cy,
    r: userSpace ? 0.5 : r,
    ...(fx !== undefined ? { fx: userSpace ? 0.5 : fx } : {}),
    ...(fy !== undefined ? { fy: userSpace ? 0.5 : fy } : {}),
    stops,
  }
}

function collectStops(el: Element, byId: Map<string, Element>, depth: number): GradientStop[] {
  const direct = Array.from(el.querySelectorAll('stop'))
  if (direct.length === 0) {
    // Inherit stops from a referenced gradient, which is common in exported SVG.
    const href = el.getAttribute('href') ?? el.getAttribute('xlink:href')
    if (href?.startsWith('#') && depth < 4) {
      const target = byId.get(href.slice(1))
      if (target) return collectStops(target, byId, depth + 1)
    }
    return []
  }

  return direct.map((stop, i) => {
    const offsetRaw = stop.getAttribute('offset') ?? String(i / Math.max(1, direct.length - 1))
    const offset = offsetRaw.trim().endsWith('%')
      ? Number.parseFloat(offsetRaw) / 100
      : Number.parseFloat(offsetRaw)

    const colorRaw = inlineStyleValue(stop, 'stop-color') ?? stop.getAttribute('stop-color') ?? '#000000'
    const opacityRaw = inlineStyleValue(stop, 'stop-opacity') ?? stop.getAttribute('stop-opacity')
    const color = parseCssColor(colorRaw) ?? { r: 0, g: 0, b: 0, a: 1 }
    const alpha = opacityRaw !== null ? clamp01(Number.parseFloat(opacityRaw)) : 1

    return {
      id: createStopId(),
      offset: clamp01(Number.isFinite(offset) ? offset : 0),
      color: { ...color, a: color.a * alpha },
    }
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectDefsMarkup(root: Element): string {
  return Array.from(root.querySelectorAll('defs'))
    .map((d) => d.innerHTML)
    .join('')
}

function parseViewBox(root: Element): { x: number; y: number; width: number; height: number } | null {
  const vb = root.getAttribute('viewBox')
  if (!vb) return null
  const parts = vb.split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n))
  if (parts.length < 4) return null
  return { x: parts[0]!, y: parts[1]!, width: parts[2]!, height: parts[3]! }
}

function intrinsicSize(
  root: Element,
  viewBox: { width: number; height: number } | null,
): { width: number; height: number } {
  const w = parseLength(root.getAttribute('width'))
  const h = parseLength(root.getAttribute('height'))
  if (w && h) return { width: w, height: h }
  if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
    return { width: viewBox.width, height: viewBox.height }
  }
  return { width: w || 300, height: h || 150 }
}

/** Absolute CSS lengths only; percentages have no meaning without a container. */
function parseLength(value: string | null): number | null {
  if (!value) return null
  const m = /^(-?[\d.]+)\s*(px|pt|pc|mm|cm|in)?$/i.exec(value.trim())
  if (!m) return null
  const n = Number.parseFloat(m[1]!)
  if (!Number.isFinite(n)) return null
  switch ((m[2] ?? 'px').toLowerCase()) {
    case 'pt': return n * (96 / 72)
    case 'pc': return n * 16
    case 'mm': return n * (96 / 25.4)
    case 'cm': return n * (96 / 2.54)
    case 'in': return n * 96
    default: return n
  }
}

function num(el: Element, name: string, fallback: number): number {
  const v = Number.parseFloat(el.getAttribute(name) ?? '')
  return Number.isFinite(v) ? v : fallback
}

function numOr(value: string | null, fallback: number): number {
  if (value === null) return fallback
  const pct = value.trim().endsWith('%')
  const v = Number.parseFloat(value)
  if (!Number.isFinite(v)) return fallback
  return pct ? v / 100 : v
}

function numAttr(value: string | null): number | null {
  if (value === null) return null
  const v = Number.parseFloat(value)
  return Number.isFinite(v) ? v : null
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1
}

function elementName(el: Element, fallback: string): string {
  const id = el.getAttribute('id')
  if (id) return id.replace(/^svg[a-z0-9]{6,}-/, '')
  const label = el.getAttribute('aria-label') ?? el.getAttribute('data-name')
  return label || fallback
}

export function cloneStyleForImport(style: Partial<Style>): Style {
  return cloneStyle(style)
}
