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
  IDENTITY,
  multiply,
  parseSvgTransform,
  translation,
  type Mat2D,
} from '../geometry/Matrix'
import { pathBounds, transformPath } from '../geometry/PathUtils'
import { parsePreserveAspectRatio, viewBoxMatrix } from '../geometry/ViewBox'
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
import { createCssLookup, parseStyleSheets, type CssLookup } from './SvgCss'
import { namespaceRawSvg } from './IdNamespacer'
import { DEFAULT_STROKE, DEFAULT_TEXT_STYLE, normalizeRuns } from '../document/types'
import type {
  DesignNode,
  GradientStop,
  ImageAsset,
  NodeId,
  Paint,
  Style,
  TextAlign,
  TextRun,
  TextStyle,
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
  /**
   * Paint servers the imported nodes reference by `url(#id)`, keyed by id, for
   * the document to hold and emit once. A shape carrying a RefPaint has nowhere
   * of its own to put the definition it points at.
   */
  svgDefs: Record<string, string>
}

/** Elements we map to first-class nodes. Everything else is preserved verbatim. */
const NATIVE_TAGS = new Set([
  'g', 'rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline', 'path', 'text', 'image', 'svg',
  // <a> is a plain grouping element as far as artwork is concerned; treating it
  // as unknown turned every hyperlinked shape into an uneditable blob.
  'a',
  // <use> is instantiated (see importUse) rather than preserved as markup.
  'use',
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
  /** Every element carrying an id, so <use> can resolve its target. */
  byId: Map<string, Element>
  /** Every identified <defs> entry, by id — the lookup, not the output. */
  defsById: Map<string, string>
  /** Only the entries something still references raw; the document emits these. */
  svgDefs: Record<string, string>
  /** Declarations from the file's <style> blocks. */
  css: CssLookup
  /** <clipPath> and <mask> elements by id, so a reference can be materialized. */
  clipDefs: Map<string, { el: Element; mode: 'clip' | 'luminance' }>
  /** Ids currently being materialized, so a self-referencing clip cannot loop. */
  resolving: Set<string>
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
    svgDefs: {},
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
      css: createCssLookup(parseStyleSheets(root)),
      byId: collectById(root),
      defsById: collectSvgDefs(root),
      svgDefs: {},
      clipDefs: collectClipDefs(root),
      resolving: new Set<string>(),
      measure,
    }

    const viewBox = parseViewBox(root)
    const size = intrinsicSize(root, viewBox)

    // The viewBox maps the source coordinate system onto the placed size,
    // honouring preserveAspectRatio. Scaling the axes independently — which is
    // what this used to do — is only correct for align="none"; every other
    // value, including the default, keeps one scale and letterboxes.
    const rootMatrix: Mat2D = viewBox
      ? viewBoxMatrix(
          viewBox,
          size.width,
          size.height,
          parsePreserveAspectRatio(root.getAttribute('preserveAspectRatio')),
        )
      : IDENTITY

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
      // Only name it after the file when the artwork did not name itself; the
      // file's own layer name is the more useful of the two.
      const own = ctx.nodes[rootId]!.name
      if (!own || own === 'Group' || own === 'SVG') ctx.nodes[rootId]!.name = name
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
      svgDefs: ctx.svgDefs,
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

  const style = resolveStyle(el, inherited, ctx)

  // Hidden, not discarded. Dropping display:none content loses artwork the file
  // still contains and the user can never get back; importing it hidden keeps
  // it in the Layers panel with its eye closed, which is both what Illustrator
  // does and reversible.
  const hidden =
    attr(el, 'display', ctx) === 'none' || attr(el, 'visibility', ctx) === 'hidden'

  // Read through the cascade too: a stylesheet may set the transform.
  const own = parseSvgTransform(attr(el, 'transform', ctx))
  const matrix = multiply(parentMatrix, own)

  // Anything we cannot model natively is preserved verbatim rather than dropped.
  if (!NATIVE_TAGS.has(tag)) {
    return createPreservationNode(el, ctx, matrix, tag)
  }

  const clip = clipSpecOf(el, ctx)

  // A group carries its own matrix and its children are already in its local
  // space, so a clip can simply join them. A shape has no children, so it gets
  // a wrapper group to share a space with the clip outline — which means the
  // shape itself must be built at identity rather than at `matrix`.
  const isGroup = tag === 'g' || tag === 'svg'
  const contentMatrix = clip && !isGroup ? IDENTITY : matrix
  const id = importByTag(tag, el, ctx, style, contentMatrix)
  if (!id) return null
  if (hidden) ctx.nodes[id]!.visible = false
  if (!clip) return id
  const wrapped = applyClip(id, clip, ctx, isGroup ? null : matrix)
  if (hidden) ctx.nodes[wrapped]!.visible = false
  return wrapped
}

function importByTag(
  tag: string,
  el: Element,
  ctx: ImportContext,
  style: InheritedStyle,
  matrix: Mat2D,
): NodeId | null {
  switch (tag) {
    case 'g':
    case 'a':
    case 'svg':
      return importGroup(el, ctx, style, matrix)
    case 'use':
      return importUse(el, ctx, style, matrix)
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
  // A nested <svg> is a viewport, not a plain group: it positions itself with
  // x/y, maps its own viewBox into width/height, and clips to that box. Treating
  // it as a <g> dropped all three, so its content landed unscaled and unclipped.
  if (el.tagName.toLowerCase() === 'svg') {
    const nested = nestedViewportMatrix(el)
    if (nested) matrix = multiply(matrix, nested)
  }

  // A filter has no first-class model, so a filtered subtree is still preserved
  // verbatim — as vector, and now saying so specifically. Clips and masks are
  // materialized instead (see applyClip), because collapsing a whole subtree for
  // one clip-path is what turned an entire artboard into a single opaque object.
  if (el.getAttribute('filter')) {
    ctx.warnings.add(
      'An SVG filter has no editable equivalent, so that group was kept as preserved vector artwork.',
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
  group.name = elementName(el, 'Group')
  group.transform = transformFromMatrix(matrix, 1, 1, 0, 0)
  group.style.opacity = style.opacity

  for (const c of children) ctx.nodes[c]!.parentId = group.id
  ctx.nodes[group.id] = group

  // Size the group to its content so the selection frame is meaningful.
  sizeGroupToChildren(group.id, ctx)
  return group.id
}

/**
 * `<use>`: instantiate the referenced subtree as real nodes.
 *
 * A `<use>` is a copy, not a shared object — SVG defines it as deep-cloning the
 * referenced element into the tree — so the honest import is a group of real,
 * editable nodes rather than an opaque blob that cannot be selected into. The
 * editor has no component model to point the copy back at its source, and
 * inventing one to avoid duplicating a handful of shapes would be the tail
 * wagging the dog.
 *
 * `x`/`y` translate the instance. A `<use>` of a `<symbol>` or `<svg>` also
 * takes `width`/`height`, which scale the referenced viewBox into that box.
 */
function importUse(
  el: Element,
  ctx: ImportContext,
  style: InheritedStyle,
  matrix: Mat2D,
): NodeId | null {
  const href = el.getAttribute('href') ?? el.getAttribute('xlink:href') ?? ''
  const id = href.startsWith('#') ? href.slice(1) : ''
  const target = id ? ctx.byId.get(id) : undefined
  if (!target) {
    ctx.warnings.add(`A <use> element referenced "${id || href}", which the file does not define.`)
    return null
  }
  // Circular by construction: using an element that contains you would clone
  // your own ancestor, and SVG treats that as an error rather than a deep copy.
  // The resolving set catches the indirect case (A uses B, B uses A); this
  // catches the direct one, which would otherwise duplicate the subtree once
  // before the set noticed.
  if (ctx.resolving.has(id) || target === el || target.contains(el)) {
    ctx.warnings.add('A <use> element referenced itself and was skipped to avoid a loop.')
    return null
  }

  const x = num(el, 'x', 0)
  const y = num(el, 'y', 0)
  let local: Mat2D = multiply(matrix, translation(x, y))

  // A <symbol>/<svg> target maps its viewBox into the width/height given here.
  const tag = target.tagName.toLowerCase()
  if (tag === 'symbol' || tag === 'svg') {
    const vb = parseViewBox(target)
    const w = num(el, 'width', vb?.width ?? 0)
    const h = num(el, 'height', vb?.height ?? 0)
    if (vb && vb.width > 0 && vb.height > 0 && w > 0 && h > 0) {
      local = multiply(
        local,
        compose(translation(-vb.x, -vb.y), [w / vb.width, 0, 0, h / vb.height, 0, 0]),
      )
    }
  }

  ctx.resolving.add(id)
  try {
    // A <symbol> is a container of content; any other target is one element.
    const sources = tag === 'symbol' || tag === 'svg' ? Array.from(target.children) : [target]
    const parts: NodeId[] = []
    for (const src of sources) {
      const childId = walkElement(src, ctx, style, IDENTITY)
      if (childId) parts.push(childId)
    }
    if (parts.length === 0) return null

    const group = createGroup(parts, { x: 0, y: 0, width: 1, height: 1 })
    group.name = elementName(el, target.getAttribute('data-name') ?? id ?? 'Instance')
    group.transform = transformFromMatrix(local, 1, 1, 0, 0)
    group.style.opacity = style.opacity
    for (const c of parts) ctx.nodes[c]!.parentId = group.id
    ctx.nodes[group.id] = group
    sizeGroupToChildren(group.id, ctx)
    return group.id
  } finally {
    ctx.resolving.delete(id)
  }
}

// ---------------------------------------------------------------------------
// Clipping and masking
// ---------------------------------------------------------------------------

interface ClipSpec {
  el: Element
  mode: 'clip' | 'luminance'
  id: string
}

/** The <clipPath> or <mask> an element references, if any. */
function clipSpecOf(el: Element, ctx: ImportContext): ClipSpec | null {
  for (const attr of ['clip-path', 'mask'] as const) {
    const raw = el.getAttribute(attr)
    if (!raw) continue
    const id = /url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)/.exec(raw)?.[1]
    if (!id) continue
    const def = ctx.clipDefs.get(id)
    if (!def) {
      ctx.warnings.add(`A clip or mask referenced "${id}", which the file does not define.`)
      continue
    }
    if (ctx.resolving.has(id)) {
      ctx.warnings.add('A clip path referenced itself and was skipped to avoid a loop.')
      continue
    }
    return { el: def.el, mode: def.mode, id }
  }
  return null
}

/**
 * Attach a materialized clip to an already-imported node.
 *
 * The clip outline becomes real nodes in the same local space as the content it
 * clips, held as the group's `maskId` child — the model already means exactly
 * this, and gets correct bounds, hit-testing and an Ungroup Mask command for
 * free. SVG puts a clipPath's contents in the referencing element's own user
 * space, which is why the content is built at identity and `wrapMatrix` (for a
 * shape, which needs a wrapper group) carries the element's matrix.
 *
 * @param wrapMatrix matrix for a new wrapper group, or null when `id` is
 *                   already a group that can host the clip itself.
 */
function applyClip(
  id: NodeId,
  clip: ClipSpec,
  ctx: ImportContext,
  wrapMatrix: Mat2D | null,
): NodeId {
  const clipId = materializeClip(clip, ctx)
  // A clip that resolves to nothing clips everything away in SVG, but silently
  // erasing the artwork is the worse failure — keep it and say so.
  if (!clipId) {
    ctx.warnings.add('A clip path had no shapes in it and was ignored.')
    return id
  }

  let host = ctx.nodes[id]
  let hostId = id
  if (wrapMatrix || !host || host.type !== 'group') {
    const wrapper = createGroup([id], { x: 0, y: 0, width: 1, height: 1 })
    wrapper.name = host?.name ?? 'Group'
    wrapper.transform = transformFromMatrix(wrapMatrix ?? IDENTITY, 1, 1, 0, 0)
    if (host) host.parentId = wrapper.id
    ctx.nodes[wrapper.id] = wrapper
    host = wrapper
    hostId = wrapper.id
  }
  if (host.type !== 'group') return id

  host.children.push(clipId)
  ctx.nodes[clipId]!.parentId = hostId
  host.maskId = clipId
  if (clip.mode !== 'clip') host.maskMode = clip.mode
  sizeGroupToChildren(hostId, ctx)
  return hostId
}

/** Turn a <clipPath>/<mask> definition into real nodes; returns the outline node. */
function materializeClip(clip: ClipSpec, ctx: ImportContext): NodeId | null {
  ctx.resolving.add(clip.id)
  try {
    const parts: NodeId[] = []
    for (const child of Array.from(clip.el.children)) {
      const childId = walkElement(child, ctx, ROOT_INHERITED, IDENTITY)
      if (childId) parts.push(childId)
    }
    if (parts.length === 0) return null
    if (parts.length === 1) return parts[0]!

    // Several shapes clip as their union, so they are grouped and the renderer
    // emits every descendant outline into the one clipPath.
    const group = createGroup(parts, { x: 0, y: 0, width: 1, height: 1 })
    group.name = 'Clip'
    for (const c of parts) ctx.nodes[c]!.parentId = group.id
    ctx.nodes[group.id] = group
    sizeGroupToChildren(group.id, ctx)
    return group.id
  } finally {
    ctx.resolving.delete(clip.id)
  }
}

/** Every <clipPath> and <mask> in the file, by id. */
function collectClipDefs(root: Element): Map<string, { el: Element; mode: 'clip' | 'luminance' }> {
  const out = new Map<string, { el: Element; mode: 'clip' | 'luminance' }>()
  for (const el of Array.from(root.querySelectorAll('clipPath, mask'))) {
    const id = el.getAttribute('id')
    if (!id) continue
    const isMask = el.tagName.toLowerCase() === 'mask'
    // mask-type / style:mask-type picks alpha over the luminance default.
    const alpha =
      isMask &&
      (el.getAttribute('mask-type') === 'alpha' ||
        /mask-type\s*:\s*alpha/i.test(el.getAttribute('style') ?? ''))
    out.set(id, { el, mode: isMask && !alpha ? 'luminance' : 'clip' })
  }
  return out
}

/** Every element with an id, for <use> to resolve against. */
function collectById(root: Element): Map<string, Element> {
  const out = new Map<string, Element>()
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    const id = el.getAttribute('id')
    if (id && !out.has(id)) out.set(id, el)
  }
  return out
}

/** Every identified <defs> entry, by id. The lookup for requireDef. */
function collectSvgDefs(root: Element): Map<string, string> {
  const out = new Map<string, string>()
  for (const defs of Array.from(root.querySelectorAll('defs'))) {
    for (const child of Array.from(defs.children)) {
      const id = child.getAttribute('id')
      if (id) out.set(id, child.outerHTML)
    }
  }
  return out
}

/**
 * Keep a <defs> entry because something still points at it raw.
 *
 * Only definitions the model could NOT absorb end up here. A gradient that
 * became a first-class gradient paint is deliberately left behind: the node
 * emits its own, and carrying the source copy too would put two definitions of
 * the same artwork in every document and every export.
 *
 * Whatever the entry itself references comes along, so a pattern that paints
 * with a gradient does not arrive half-defined.
 */
function requireDef(id: string, ctx: ImportContext, depth = 0): void {
  if (depth > 4 || ctx.svgDefs[id]) return
  const markup = ctx.defsById.get(id)
  if (!markup) return
  ctx.svgDefs[id] = markup
  for (const m of markup.matchAll(/url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)/g)) {
    requireDef(m[1]!, ctx, depth + 1)
  }
}

/**
 * The extra matrix a nested `<svg>` establishes: its x/y offset, then its own
 * viewBox mapped into its width/height.
 */
function nestedViewportMatrix(el: Element): Mat2D | null {
  const x = num(el, 'x', 0)
  const y = num(el, 'y', 0)
  const vb = parseViewBox(el)
  const w = num(el, 'width', vb?.width ?? 0)
  const h = num(el, 'height', vb?.height ?? 0)

  const offset = x !== 0 || y !== 0 ? translation(x, y) : null
  if (!vb || vb.width <= 0 || vb.height <= 0 || w <= 0 || h <= 0) return offset
  const map = viewBoxMatrix(vb, w, h, parsePreserveAspectRatio(el.getAttribute('preserveAspectRatio')))
  return offset ? multiply(offset, map) : map
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
  rebaseUserSpacePaints(node, x, y)
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
  rebaseUserSpacePaints(node, cx - rx, cy - ry)
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
  // Sign-packed coordinates ("30-5" is two numbers) and a leading separator both
  // used to corrupt this list quietly — the whole polygon was dropped.
  const nums = scanNumbers(el.getAttribute('points'))
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
  rebaseUserSpacePaints(node, b.x, b.y)
  ctx.nodes[node.id] = node
  return node.id
}

/**
 * `<text>`, including its `<tspan>` structure.
 *
 * Two different things wear the same tag. A tspan that only restyles part of
 * the string is a STYLE RUN — the text still flows as one paragraph, so it
 * stays one text object with runs over it. A tspan that carries its own x or y
 * is POSITIONING: it is placed independently, does not flow with what came
 * before, and is therefore its own text object. Collapsing either into
 * `textContent`, as this used to, threw away both the styling and the line
 * structure and left one space-joined line.
 */
function importText(el: Element, ctx: ImportContext, style: InheritedStyle, matrix: Mat2D): NodeId | null {
  const positioned = positionedSpans(el)
  if (positioned.length > 1) {
    const parts: NodeId[] = []
    for (const span of positioned) {
      const id = importTextPiece(span.el, ctx, style, matrix, span.x, span.y)
      if (id) parts.push(id)
    }
    if (parts.length === 0) return null
    if (parts.length === 1) return parts[0]!

    const group = createGroup(parts, { x: 0, y: 0, width: 1, height: 1 })
    group.name = elementName(el, 'Text')
    for (const c of parts) ctx.nodes[c]!.parentId = group.id
    ctx.nodes[group.id] = group
    sizeGroupToChildren(group.id, ctx)
    return group.id
  }
  return importTextPiece(el, ctx, style, matrix, null, null)
}

/**
 * The independently-positioned pieces of a `<text>`.
 *
 * Returns one entry when nothing inside sets its own x/y, which is the ordinary
 * case and keeps the text a single editable object.
 */
function positionedSpans(el: Element): Array<{ el: Element; x: number | null; y: number | null }> {
  const spans = Array.from(el.children).filter((c) => c.tagName.toLowerCase() === 'tspan')
  const anyPositioned = spans.some(
    (c) => c.getAttribute('x') !== null || c.getAttribute('y') !== null,
  )
  if (!anyPositioned || spans.length === 0) return [{ el, x: null, y: null }]
  return spans.map((c) => ({
    el: c,
    x: c.getAttribute('x') !== null ? num(c, 'x', 0) : null,
    y: c.getAttribute('y') !== null ? num(c, 'y', 0) : null,
  }))
}

function importTextPiece(
  el: Element,
  ctx: ImportContext,
  style: InheritedStyle,
  matrix: Mat2D,
  spanX: number | null,
  spanY: number | null,
): NodeId | null {
  const { text, runs } = collectTextRuns(el, style, ctx)
  if (!text) return null

  const measured = ctx.measure(el)
  const x = spanX ?? num(el, 'x', 0)
  const y = spanY ?? num(el, 'y', 0)
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
      sizing: 'auto-width',
    },
  )
  if (runs) node.runs = runs
  node.name = elementName(el, text.slice(0, 30) || 'Text')
  ctx.nodes[node.id] = node
  return node.id
}

/**
 * Flatten a `<text>` or `<tspan>` into one string plus the style runs over it.
 *
 * Walks the children in order, tracking where each one's characters land so a
 * nested tspan's overrides become a range. Whitespace is collapsed the way SVG
 * collapses it, and the offsets are taken from the collapsed string so the
 * ranges line up with what is actually drawn.
 */
function collectTextRuns(
  el: Element,
  base: InheritedStyle,
  ctx: ImportContext,
): { text: string; runs: TextRun[] | undefined } {
  const runs: TextRun[] = []
  let text = ''

  const walk = (node: Node, inherited: InheritedStyle) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        text += (child.textContent ?? '').replace(/\s+/g, ' ')
        continue
      }
      if (child.nodeType !== 1) continue
      const childEl = child as Element
      if (childEl.tagName.toLowerCase() !== 'tspan') continue

      const style = resolveStyle(childEl, inherited, ctx)
      const start = text.length
      walk(childEl, style)
      const end = text.length
      if (end > start) {
        const override = runOverride(style, base, ctx, childEl)
        if (override) runs.push({ start, end, ...override })
      }
    }
  }
  walk(el, base)

  // Collapsed as it was built, so only the outer trim can move the offsets —
  // and it only ever removes from the front, by exactly this much.
  const lead = /^\s*/.exec(text)![0].length
  text = text.trim()
  const shifted = runs.map((r) => ({ ...r, start: r.start - lead, end: r.end - lead }))
  return { text, runs: normalizeRuns(shifted, text.length) }
}

/** What a tspan's style says that its parent's did not. */
function runOverride(
  style: InheritedStyle,
  base: InheritedStyle,
  ctx: ImportContext,
  el: Element,
): { style?: Partial<TextStyle>; fill?: Paint } | null {
  const over: Partial<TextStyle> = {}
  if (style.fontFamily !== base.fontFamily) over.fontFamily = style.fontFamily
  if (style.fontSize !== base.fontSize) over.fontSize = style.fontSize
  if (style.fontWeight !== base.fontWeight) over.fontWeight = style.fontWeight
  if (style.fontStyle !== base.fontStyle) over.fontStyle = style.fontStyle
  if (style.letterSpacing !== base.letterSpacing) {
    over.letterSpacing = style.fontSize > 0 ? style.letterSpacing / style.fontSize : 0
  }

  const fill = style.fill !== base.fill ? paintFrom(style.fill, ctx, el) : null
  if (Object.keys(over).length === 0 && !fill) return null
  return { ...(Object.keys(over).length ? { style: over } : {}), ...(fill ? { fill } : {}) }
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
  if (!box || box.width <= 0 || box.height <= 0) {
    // Nothing can be built from an unmeasurable element, but it must not simply
    // disappear: silence here is exactly the "content was lost and nobody said
    // so" failure this whole effort exists to remove.
    ctx.warnings.add(`A <${tag}> element could not be measured and was skipped.`)
    return null
  }

  ctx.warnings.add(
    `<${tag}> has no editable equivalent, so it was kept as preserved vector artwork.`,
  )

  const markup = el.outerHTML || ''
  if (!markup) {
    ctx.warnings.add(`A <${tag}> element was empty and was skipped.`)
    return null
  }

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

/**
 * One styling property for one element, in CSS cascade order.
 *
 * Presentation attributes sit at the very bottom of the cascade — below any
 * stylesheet rule — which is the whole reason `.cls-1 { fill: red }` beats
 * `fill="black"` written on the same element. An inline `style` beats a normal
 * rule but loses to an `!important` one.
 */
function attr(el: Element, name: string, ctx?: ImportContext): string | null {
  const css = ctx && !ctx.css.empty ? ctx.css.value(el, name) : null
  if (css !== null && ctx!.css.isImportant(el, name)) return css

  const inline = inlineStyleValue(el, name)
  if (inline !== null) return inline
  if (css !== null) return css
  return el.getAttribute(name)
}

function inlineStyleValue(el: Element, prop: string): string | null {
  const style = el.getAttribute('style')
  if (!style) return null
  const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i')
  const m = re.exec(style)
  return m ? m[1]!.trim() : null
}

function resolveStyle(el: Element, parent: InheritedStyle, ctx: ImportContext): InheritedStyle {
  const next: InheritedStyle = { ...parent }

  const fill = attr(el, 'fill', ctx)
  if (fill !== null) next.fill = fill.trim()
  const stroke = attr(el, 'stroke', ctx)
  if (stroke !== null) next.stroke = stroke.trim()

  const fo = numAttr(attr(el, 'fill-opacity', ctx))
  if (fo !== null) next.fillOpacity = clamp01(fo)
  const so = numAttr(attr(el, 'stroke-opacity', ctx))
  if (so !== null) next.strokeOpacity = clamp01(so)
  const op = numAttr(attr(el, 'opacity', ctx))
  next.opacity = op !== null ? clamp01(op) : 1 // opacity is NOT inherited in SVG

  const sw = numAttr(attr(el, 'stroke-width', ctx))
  if (sw !== null) next.strokeWidth = Math.max(0, sw)

  const fr = attr(el, 'fill-rule', ctx) ?? attr(el, 'clip-rule', ctx)
  if (fr === 'evenodd' || fr === 'nonzero') next.fillRule = fr

  const cap = attr(el, 'stroke-linecap', ctx)
  if (cap === 'butt' || cap === 'round' || cap === 'square') next.lineCap = cap
  const join = attr(el, 'stroke-linejoin', ctx)
  if (join === 'miter' || join === 'round' || join === 'bevel') next.lineJoin = join
  const ml = numAttr(attr(el, 'stroke-miterlimit', ctx))
  if (ml !== null) next.miterLimit = ml

  const dash = attr(el, 'stroke-dasharray', ctx)
  if (dash !== null) {
    next.dashArray =
      dash === 'none'
        ? []
        : dash.split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n) && n >= 0)
  }
  const dashOff = numAttr(attr(el, 'stroke-dashoffset', ctx))
  if (dashOff !== null) next.dashOffset = dashOff

  const family = attr(el, 'font-family', ctx)
  if (family) next.fontFamily = family.split(',')[0]!.trim().replace(/["']/g, '')
  const size = numAttr(attr(el, 'font-size', ctx))
  if (size !== null) next.fontSize = size
  const weight = attr(el, 'font-weight', ctx)
  if (weight) {
    const n = Number(weight)
    next.fontWeight = Number.isFinite(n) ? n : weight === 'bold' ? 700 : 400
  }
  const fontStyle = attr(el, 'font-style', ctx)
  if (fontStyle === 'italic' || fontStyle === 'oblique') next.fontStyle = 'italic'
  else if (fontStyle === 'normal') next.fontStyle = 'normal'

  const anchor = attr(el, 'text-anchor', ctx)
  if (anchor === 'middle') next.textAnchor = 'center'
  else if (anchor === 'end') next.textAnchor = 'right'
  else if (anchor === 'start') next.textAnchor = 'left'

  const ls = numAttr(attr(el, 'letter-spacing', ctx))
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
    // it still renders, rather than replacing it with a flat colour — and keep
    // the definition it points at, or the reference would dangle.
    requireDef(id, ctx)
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

  // The coordinates are kept exactly as authored, and the space they were
  // authored in travels with them. The old code normalized userSpaceOnUse into
  // a unit vector using Math.abs, which threw away the direction — a gradient
  // running right-to-left came out left-to-right — and reset every userSpace
  // radial to a centred 0.5/0.5/0.5, which is a different gradient entirely.
  const units = el.getAttribute('gradientUnits') === 'userSpaceOnUse'
    ? ({ units: 'userSpaceOnUse' } as const)
    : {}

  const gtAttr = el.getAttribute('gradientTransform')
  const gt = gtAttr ? parseSvgTransform(gtAttr) : null
  // Identity carries no information and only bloats the document.
  const transform = gt && !isIdentity(gt) ? { transform: [...gt] as const } : {}

  const spreadAttr = el.getAttribute('spreadMethod')
  const spread =
    spreadAttr === 'reflect' || spreadAttr === 'repeat' ? ({ spread: spreadAttr } as const) : {}

  if (isLinear) {
    return {
      type: 'linear',
      x1: numOr(el.getAttribute('x1'), 0),
      y1: numOr(el.getAttribute('y1'), 0),
      x2: numOr(el.getAttribute('x2'), 1),
      y2: numOr(el.getAttribute('y2'), 0),
      stops,
      ...units,
      ...transform,
      ...spread,
    }
  }

  const cx = numOr(el.getAttribute('cx'), 0.5)
  const cy = numOr(el.getAttribute('cy'), 0.5)
  const fr = el.getAttribute('fr')
  return {
    type: 'radial',
    cx,
    cy,
    r: numOr(el.getAttribute('r'), 0.5),
    ...(el.getAttribute('fx') !== null ? { fx: numOr(el.getAttribute('fx'), cx) } : {}),
    ...(el.getAttribute('fy') !== null ? { fy: numOr(el.getAttribute('fy'), cy) } : {}),
    ...(fr !== null ? { fr: numOr(fr, 0) } : {}),
    stops,
    ...units,
    ...transform,
    ...spread,
  }
}

function isIdentity(m: Mat2D): boolean {
  return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0
}

/**
 * Shift a node's userSpaceOnUse gradients by the amount its geometry was moved.
 *
 * Every shape is rebased so its local space starts at (0,0), but a
 * userSpaceOnUse gradient's coordinates are in the space the file was authored
 * in. Without this the paint stays where the artwork used to be.
 */
function rebaseUserSpacePaints(node: DesignNode, dx: number, dy: number): void {
  if ((dx === 0 && dy === 0) || !('style' in node)) return
  const shift = (paint: Paint): Paint => {
    if (paint.type !== 'linear' && paint.type !== 'radial') return paint
    if (paint.units !== 'userSpaceOnUse') return paint
    const t = paint.transform ?? [1, 0, 0, 1, 0, 0]
    // translate(-dx,-dy) composed before the authored gradientTransform.
    return { ...paint, transform: [t[0], t[1], t[2], t[3], t[4] - dx, t[5] - dy] }
  }
  node.style.fill = shift(node.style.fill)
  node.style.stroke = { ...node.style.stroke, paint: shift(node.style.stroke.paint) }
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

/**
 * Every number in an SVG number list.
 *
 * Splitting on /[\s,]+/ is wrong twice over, and silently. A leading space
 * yields an empty first field, and `Number('') === 0` is finite, so
 * viewBox=" 0 0 1870 1112" parsed as width 0 and the root matrix scaled the
 * artwork by a factor of its own width. And SVG allows the minus sign as its
 * own separator, so "30-5" is two numbers, not the NaN that a split produces.
 */
function scanNumbers(text: string | null): number[] {
  if (!text) return []
  const out: number[] = []
  for (const m of text.matchAll(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g)) {
    const n = Number.parseFloat(m[0])
    if (Number.isFinite(n)) out.push(n)
  }
  return out
}

function parseViewBox(root: Element): { x: number; y: number; width: number; height: number } | null {
  const parts = scanNumbers(root.getAttribute('viewBox'))
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

/**
 * The name to show in the Layers panel.
 *
 * `data-name` first: Illustrator, XD and Figma all put the layer name the user
 * actually chose there, and put a mangled unique token in `id` ("Rectangle 30"
 * vs "Rectangle_30"). This app's own exporter writes both the same way round,
 * so a document survives its own export.
 */
function elementName(el: Element, fallback: string): string {
  const label = el.getAttribute('data-name') ?? el.getAttribute('aria-label')
  if (label?.trim()) return label.trim()
  const id = el.getAttribute('id')
  if (id) return id.replace(/^svg[a-z0-9]{6,}-/, '')
  return fallback
}

export function cloneStyleForImport(style: Partial<Style>): Style {
  return cloneStyle(style)
}
