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
 * SVG export.
 *
 * Serialized from the DOCUMENT MODEL, not by scraping the live SVG DOM. That
 * matters for three reasons: the output contains only defs that are actually
 * referenced, none of the editor's overlay chrome can leak in, and export works
 * identically whether or not the node is currently on screen.
 *
 * Vector stays vector. Shapes are emitted as real <rect>/<ellipse>/<path>,
 * gradients as real gradient elements, groups as real groups. Nothing is
 * rasterized — the only bitmaps in the output are the ones that were bitmaps to
 * begin with.
 */

import { toSvgMatrix, multiply, type Mat2D } from '../geometry/Matrix'
import type { Bounds } from '../geometry/Bounds'
import { polygonStarPath, rectPath } from '../geometry/ShapeGeometry'
import { localMatrix, maskOutlines, nodePathData, worldMatrix } from '../document/SceneGraph'
import { toHex } from '../document/color'
import { ANGULAR_TILE, angularWedges, gradientId, isGradient, sortedStops } from '../canvas/paint'
import { layoutText, lineOffsetX } from '../text/TextLayout'
import { fontStack } from '../text/FontRegistry'
import { canEmbed, embedFontCss } from '../text/FontEmbedder'
import { hasStyle, isMaskGroup, repeatGridOffsets, repeatGridSize } from '../document/types'
import {
  activeBlur,
  backgroundFillOpacity,
  blurStdDeviation,
  effectFilter,
} from '../canvas/effects'
import type {
  DesignDocument,
  DesignNode,
  NodeId,
  Paint,
  RGBA,
  Style,
} from '../document/types'

export type ImageHandling = 'embed' | 'link'
export type TextHandling = 'embed-font' | 'reference'

export interface SvgExportOptions {
  /** World-space crop rectangle. Output is translated so this becomes (0,0). */
  bounds: Bounds
  imageHandling?: ImageHandling
  /**
   * How text is written out.
   * 'embed-font' — real <text> plus a base64 @font-face. Renders identically
   *                anywhere, including inside the <img> sandbox used for raster
   *                export, and stays selectable. Default.
   * 'reference'  — real <text> naming the family. Smallest file; substitutes on
   *                a machine without the font.
   */
  textHandling?: TextHandling
  background?: RGBA | null
  precision?: number
  /** Multiplies the emitted width/height; the viewBox stays in document units. */
  scale?: number
  padding?: number
}

export interface SvgExportResult {
  svg: string
  /** Assets referenced rather than embedded, when imageHandling is 'link'. */
  linkedAssets: Array<{ fileName: string; dataUrl: string }>
  warnings: string[]
}

interface EmitContext {
  doc: DesignDocument
  options: Required<Omit<SvgExportOptions, 'background'>> & { background: RGBA | null }
  defs: string[]
  fontCss: string[]
  linkedAssets: Array<{ fileName: string; dataUrl: string }>
  warnings: Set<string>
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function exportNodesToSvg(
  doc: DesignDocument,
  nodeIds: readonly NodeId[],
  options: SvgExportOptions,
): Promise<SvgExportResult> {
  const opts = {
    bounds: options.bounds,
    imageHandling: options.imageHandling ?? 'embed',
    textHandling: options.textHandling ?? 'embed-font',
    precision: options.precision ?? 3,
    scale: options.scale ?? 1,
    padding: options.padding ?? 0,
    background: options.background ?? null,
  }

  const ctx: EmitContext = {
    doc,
    options: opts,
    defs: [],
    fontCss: [],
    linkedAssets: [],
    warnings: new Set(),
  }

  // Font embedding is async (the bytes must be fetched and base64-encoded), so
  // it is resolved up front and the synchronous emit pass just reads the result.
  await prepareText(ctx, nodeIds)

  const body = nodeIds
    .map((id) => emitNode(ctx, id, true))
    .filter(Boolean)
    .join('\n')

  const b = opts.bounds
  const pad = opts.padding
  const width = Math.max(1, b.width + pad * 2)
  const height = Math.max(1, b.height + pad * 2)
  const outW = Math.max(1, Math.round(width * opts.scale))
  const outH = Math.max(1, Math.round(height * opts.scale))

  // Paint servers carried in from an import. Only the ones actually referenced
  // are emitted, so an export of one artboard does not drag in the whole
  // document's imported defs.
  const imported = referencedImportedDefs(doc, body + ctx.defs.join(''))

  const defsBlock =
    ctx.defs.length || ctx.fontCss.length || imported
      ? `<defs>${ctx.fontCss.length ? `<style>${ctx.fontCss.join('')}</style>` : ''}` +
        `${imported}${ctx.defs.join('')}</defs>`
      : ''

  const bg =
    opts.background && opts.background.a > 0
      ? `<rect width="${width}" height="${height}" fill="${toHex(opts.background)}"${
          opts.background.a < 1 ? ` fill-opacity="${round(opts.background.a, 3)}"` : ''
        }/>`
      : ''

  // Explicit width/height are required: Firefox renders a viewBox-only SVG as
  // 0x0 when it is loaded through an <img>, which is exactly what the raster
  // exporter does.
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${outW}" height="${outH}" viewBox="0 0 ${round(width, 3)} ${round(height, 3)}">` +
    defsBlock +
    bg +
    `<g transform="translate(${round(pad - b.x, 3)} ${round(pad - b.y, 3)})">${body}</g>` +
    `</svg>`

  return { svg, linkedAssets: ctx.linkedAssets, warnings: [...ctx.warnings] }
}

// ---------------------------------------------------------------------------
// Text preparation
// ---------------------------------------------------------------------------

async function prepareText(ctx: EmitContext, roots: readonly NodeId[]): Promise<void> {
  const textNodes: DesignNode[] = []
  const visit = (id: NodeId) => {
    const node = ctx.doc.nodes[id]
    if (!node || !node.visible) return
    if (node.type === 'text') textNodes.push(node)
    if ('children' in node) for (const c of node.children) visit(c)
  }
  for (const id of roots) visit(id)
  if (textNodes.length === 0) return

  if (ctx.options.textHandling === 'embed-font') {
    const seen = new Set<string>()
    for (const node of textNodes) {
      if (node.type !== 'text') continue
      const ts = node.textStyle
      const key = `${ts.fontFamily}|${ts.fontWeight}|${ts.fontStyle}`
      if (seen.has(key)) continue
      seen.add(key)
      const css = await embedFontCss(ts.fontFamily, ts.fontWeight, ts.fontStyle === 'italic')
      if (css) ctx.fontCss.push(css)
      else if (!canEmbed(ts.fontFamily)) {
        // A system font's bytes are not readable by the page, so it can only be
        // named. Say so rather than letting it substitute silently.
        ctx.warnings.add(
          `"${ts.fontFamily}" is a system font, so it is referenced by name and ` +
            `may substitute on a machine without it.`,
        )
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Node emission
// ---------------------------------------------------------------------------

function emitNode(ctx: EmitContext, id: NodeId, isRoot: boolean): string {
  const node = ctx.doc.nodes[id]
  if (!node || !node.visible) return ''

  // Roots carry their full world matrix; descendants carry only their local one,
  // since their ancestors' groups are emitted around them.
  const matrix: Mat2D = isRoot ? worldMatrix(ctx.doc, id) : localMatrix(node.transform)
  const transform = ` transform="${toSvgMatrix(matrix)}"`
  const styled = hasStyle(node) ? node.style : null
  const opacity = styled && styled.opacity < 1 ? ` opacity="${round(styled.opacity, 3)}"` : ''
  const blend =
    styled && styled.blendMode !== 'normal' ? ` style="mix-blend-mode:${styled.blendMode}"` : ''
  const name = ` id="${escapeAttr(safeId(node.id))}" data-name="${escapeAttr(node.name)}"`

  // Shadows and object blur are the same filter the canvas builds, from the
  // same code — see effects.ts.
  const fx = styled ? effectFilter(safeId(node.id), styled, node.transform) : null
  let filter = ''
  if (fx) {
    ctx.defs.push(
      `<filter id="${fx.id}" filterUnits="userSpaceOnUse" x="${round(fx.x, 3)}" y="${round(fx.y, 3)}"` +
        ` width="${round(fx.width, 3)}" height="${round(fx.height, 3)}">${fx.primitives}</filter>`,
    )
    filter = ` filter="url(#${fx.id})"`
  }

  const body = emitBody(ctx, node)
  if (!body) return ''
  return `<g${name}${transform}${opacity}${blend}${filter}>${body}</g>`
}

/**
 * Children in paint order, with background blur resolved.
 *
 * Background blur is the one effect with no SVG filter behind it: the
 * `BackgroundImage` input that would have read what is underneath was dropped
 * from the spec and shipped in no browser. So the backdrop is re-drawn instead
 * — the markup painted so far is put in <defs> and referenced twice, once as
 * itself and once blurred and clipped to the shape. It is real vector, it
 * rasterises, and it does not need the browser to support anything unusual.
 *
 * `prefix` is markup painted before the children that is part of the backdrop
 * too, which is how an artboard's own background ends up inside the blur.
 */
function emitChildren(ctx: EmitContext, children: readonly NodeId[], prefix = ''): string {
  let out = prefix
  for (const id of children) {
    const child = ctx.doc.nodes[id]
    const blur = child && child.visible && hasStyle(child) ? activeBlur(child.style, 'background') : null
    // Nothing painted yet means nothing to blur, and a <use> of an empty group
    // would be dead markup.
    if (blur && child && out.trim()) out = emitBackdropBlur(ctx, out, child, blur)
    out += emitNode(ctx, id, false)
  }
  return out
}

function emitBackdropBlur(
  ctx: EmitContext,
  backdrop: string,
  child: DesignNode,
  blur: { amount: number; brightness: number },
): string {
  const key = safeId(child.id)
  const groupId = `bd-${key}`
  const clipId = `bdclip-${key}`
  const filterId = `bdblur-${key}`
  const d = nodePathData(child) ?? rectPath(child.transform.width, child.transform.height, 0)

  const primitives = [`<feGaussianBlur stdDeviation="${round(blurStdDeviation(blur.amount), 3)}"/>`]
  if (blur.brightness !== 0) {
    // The same -50..50 -> 0..2 multiplier the canvas gets from CSS brightness().
    const slope = round(1 + blur.brightness / 50, 3)
    const func = `type="linear" slope="${slope}"`
    primitives.push(
      `<feComponentTransfer><feFuncR ${func}/><feFuncG ${func}/><feFuncB ${func}/></feComponentTransfer>`,
    )
  }

  ctx.defs.push(`<g id="${groupId}">${backdrop}</g>`)
  ctx.defs.push(
    `<clipPath id="${clipId}" clipPathUnits="userSpaceOnUse">` +
      `<path d="${d}" transform="${toSvgMatrix(localMatrix(child.transform))}"/></clipPath>`,
  )
  ctx.defs.push(
    `<filter id="${filterId}" x="-20%" y="-20%" width="140%" height="140%">${primitives.join('')}</filter>`,
  )

  // Both href forms: SVG 2 reads the first, older renderers the second.
  const use = `<use href="#${groupId}" xlink:href="#${groupId}"`
  return `${use}/><g clip-path="url(#${clipId})">${use} filter="url(#${filterId})"/></g>`
}

function emitBody(ctx: EmitContext, node: DesignNode): string {
  switch (node.type) {
    case 'document':
      return emitChildren(ctx, node.children)

    case 'artboard': {
      const { width, height } = node.transform
      const clipId = `clip-${safeId(node.id)}`
      const bg = emitArtboardBackground(ctx, node.background, node.id, width, height)
      // Emitted exactly once: emitChildren is not pure — it pushes gradients,
      // filters and clip paths into ctx.defs — so calling it twice and throwing
      // one result away duplicated every one of those ids in the output.
      if (node.clipContent) {
        ctx.defs.push(
          `<clipPath id="${clipId}"><rect width="${round(width, 3)}" height="${round(height, 3)}"/></clipPath>`,
        )
        return `${bg}<g clip-path="url(#${clipId})">${emitChildren(ctx, node.children, bg)}</g>`
      }
      // The background is part of the backdrop a blurred child sees.
      return emitChildren(ctx, node.children, bg)
    }

    case 'group': {
      if (!isMaskGroup(node) || !ctx.doc.nodes[node.maskId]) {
        return emitChildren(ctx, node.children)
      }
      // Adobe's mask: the topmost child clips the rest and is not itself drawn.
      const clipId = `maskclip-${safeId(node.id)}`
      const kids = emitChildren(ctx, node.children.filter((c) => c !== node.maskId))

      // An imported <mask> modulates by luminance or alpha; it is not an
      // outline clip, and flattening it to one would change the artwork.
      if (node.maskMode === 'luminance' || node.maskMode === 'alpha') {
        const type = node.maskMode === 'alpha' ? ' style="mask-type:alpha"' : ''
        ctx.defs.push(
          `<mask id="${clipId}" maskUnits="userSpaceOnUse"${type}>` +
            `${emitNode(ctx, node.maskId, false)}</mask>`,
        )
        return `<g mask="url(#${clipId})">${kids}</g>`
      }

      // Every outline inside the mask, not its bounding box: an imported
      // <clipPath> may hold several shapes and clips as their union.
      const outlines = maskOutlines(ctx.doc, node.maskId)
        .map((o) => `<path d="${o.d}" transform="${toSvgMatrix(o.m)}"/>`)
        .join('')
      ctx.defs.push(
        `<clipPath id="${clipId}" clipPathUnits="userSpaceOnUse">${outlines}</clipPath>`,
      )
      return `<g clip-path="url(#${clipId})">${kids}</g>`
    }

    case 'repeat-grid': {
      // Emitted as real repeated vector, one <g> per cell. The source markup is
      // built once and reused, so a 10x10 grid does not serialise its contents
      // a hundred times over.
      const cellMarkup = emitChildren(ctx, node.children)
      if (!cellMarkup) return ''
      const size = repeatGridSize(node)
      const clipId = `rgclip-${safeId(node.id)}`
      ctx.defs.push(
        `<clipPath id="${clipId}"><rect width="${round(size.width, 3)}" height="${round(size.height, 3)}"/></clipPath>`,
      )
      const cells = repeatGridOffsets(node)
        .map(
          (o) =>
            `<g transform="translate(${round(o.x, 3)} ${round(o.y, 3)})">${cellMarkup}</g>`,
        )
        .join('')
      return `<g clip-path="url(#${clipId})">${cells}</g>`
    }

    case 'image':
      return emitImage(ctx, node)

    case 'text':
      return emitText(ctx, node)

    case 'svg':
      // A preserved subtree is written back exactly as it came in, still vector.
      return emitPreservedSvg(ctx, node)

    default:
      return emitShape(ctx, node)
  }
}

function emitArtboardBackground(
  ctx: EmitContext,
  paint: Paint,
  nodeId: NodeId,
  width: number,
  height: number,
): string {
  if (paint.type === 'none') return ''
  const attrs = paintAttrs(ctx, paint, nodeId, 'fill')
  return `<rect width="${round(width, 3)}" height="${round(height, 3)}" fill="${attrs.value}"${
    attrs.opacity < 1 ? ` fill-opacity="${round(attrs.opacity, 3)}"` : ''
  }/>`
}

/**
 * Shapes are emitted as semantic elements where one fits exactly, and as <path>
 * otherwise. That keeps the output readable and small — a rounded rect stays a
 * <rect rx>, not a twelve-command path.
 */
function emitShape(ctx: EmitContext, node: DesignNode): string {
  if (!hasStyle(node)) return ''
  const style = node.style
  const { width, height } = node.transform
  const p = ctx.options.precision

  let element: string
  switch (node.type) {
    case 'rect': {
      const [tl, tr, br, bl] = node.cornerRadius
      const uniform = tl === tr && tr === br && br === bl
      element = uniform
        ? `<rect width="${round(width, p)}" height="${round(height, p)}"${tl > 0 ? ` rx="${round(tl, p)}"` : ''}`
        : `<path d="${rectPath(width, height, node.cornerRadius)}"`
      break
    }
    case 'ellipse':
      element = `<ellipse cx="${round(width / 2, p)}" cy="${round(height / 2, p)}" rx="${round(width / 2, p)}" ry="${round(height / 2, p)}"`
      break
    case 'line':
      element = `<line x1="${round(node.x1, p)}" y1="${round(node.y1, p)}" x2="${round(node.x2, p)}" y2="${round(node.y2, p)}"`
      break
    case 'polygon':
      element = `<path d="${polygonStarPath(width, height, node.sides, node.starRatio, node.cornerRadius)}"`
      break
    case 'path':
      element = `<path d="${node.d}"`
      break
    default:
      element = `<path d="${rectPath(width, height, 0)}"`
  }

  return `${element}${styleAttrs(ctx, style, node.id)}/>`
}

function emitImage(ctx: EmitContext, node: Extract<DesignNode, { type: 'image' }>): string {
  const asset = ctx.doc.assets[node.assetId]
  if (!asset) {
    ctx.warnings.add(`An image was skipped because its data is missing.`)
    return ''
  }
  const { width, height } = node.transform
  const p = ctx.options.precision

  let href = asset.dataUrl
  if (ctx.options.imageHandling === 'link') {
    const ext = mimeToExtension(asset.mimeType)
    const fileName = `${sanitizeFileName(asset.name || 'image')}-${asset.id}.${ext}`
    ctx.linkedAssets.push({ fileName, dataUrl: asset.dataUrl })
    href = `./${fileName}`
  }

  const preserve =
    node.fit === 'fill' ? 'none' : node.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet'
  const hasRadius = node.cornerRadius.some((r) => r > 0)
  const clipId = `imgclip-${safeId(node.id)}`
  if (hasRadius) {
    ctx.defs.push(
      `<clipPath id="${clipId}"><path d="${rectPath(width, height, node.cornerRadius)}"/></clipPath>`,
    )
  }

  return (
    `<image href="${escapeAttr(href)}" xlink:href="${escapeAttr(href)}" ` +
    `width="${round(width, p)}" height="${round(height, p)}" ` +
    `preserveAspectRatio="${preserve}"` +
    (hasRadius ? ` clip-path="url(#${clipId})"` : '') +
    `/>`
  )
}

function emitText(ctx: EmitContext, node: Extract<DesignNode, { type: 'text' }>): string {
  const ts = node.textStyle
  const p = ctx.options.precision
  // Both modes that own their width wrap to it; Auto Width never does. Getting
  // this wrong here and right on the canvas would export a paragraph as one
  // very long line.
  const boxWidth = ts.sizing === 'auto-width' ? undefined : node.transform.width
  const layout = layoutText(node.text, ts, boxWidth)
  const width = boxWidth ?? layout.width

  // Adobe's Fixed Size crops what does not fit, so the export has to crop it
  // too — otherwise the file shows text the canvas deliberately hid.
  const clipped = ts.sizing === 'fixed'
  const clipId = `textclip-${safeId(node.id)}`
  if (clipped) {
    ctx.defs.push(
      `<clipPath id="${clipId}"><rect width="${round(node.transform.width, 3)}" ` +
        `height="${round(node.transform.height, 3)}"/></clipPath>`,
    )
  }

  const tspans = layout.lines
    .map(
      (line) =>
        `<tspan x="${round(lineOffsetX(line.width, width, ts.align), p)}" y="${round(line.baseline, p)}">` +
        `${escapeText(line.text)}</tspan>`,
    )
    .join('')

  const decoration = [ts.underline ? 'underline' : '', ts.strikethrough ? 'line-through' : '']
    .filter(Boolean)
    .join(' ')

  return (
    `<text font-family="${escapeAttr(fontStack(ts.fontFamily))}" font-size="${round(ts.fontSize, p)}" ` +
    `font-weight="${ts.fontWeight}"` +
    (ts.fontStyle === 'italic' ? ` font-style="italic"` : '') +
    (ts.letterSpacing ? ` letter-spacing="${round(ts.letterSpacing * ts.fontSize, p)}"` : '') +
    (decoration ? ` text-decoration="${decoration}"` : '') +
    (clipped ? ` clip-path="url(#${clipId})"` : '') +
    ` xml:space="preserve"${styleAttrs(ctx, node.style, node.id, true)}>${tspans}</text>`
  )
}

/**
 * The imported <defs> entries this output actually points at.
 *
 * A shape whose fill is `url(#p)` exports that reference verbatim, so without
 * the definition the file opens with a dangling paint. Scanning the emitted
 * markup rather than emitting all of them keeps an artboard export from
 * carrying every definition in the document, and follows one level of nesting
 * so a gradient referenced by a pattern comes along too.
 */
function referencedImportedDefs(doc: DesignDocument, markup: string): string {
  const defs = doc.svgDefs
  if (!defs) return ''

  const wanted = new Set<string>()
  const scan = (text: string, depth: number) => {
    if (depth > 4) return
    for (const m of text.matchAll(/url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)/g)) {
      const id = m[1]!
      if (wanted.has(id) || !defs[id]) continue
      wanted.add(id)
      scan(defs[id]!, depth + 1)
    }
  }
  scan(markup, 0)

  return [...wanted].map((id) => defs[id]!).join('')
}

function emitPreservedSvg(ctx: EmitContext, node: Extract<DesignNode, { type: 'svg' }>): string {
  const { width, height } = node.transform
  const vb = node.viewBox
  const sx = vb.width > 0 ? width / vb.width : 1
  const sy = vb.height > 0 ? height / vb.height : 1
  // The defs this subtree needs travel with it, so it renders standalone.
  if (node.defs) ctx.defs.push(node.defs)
  return `<g transform="scale(${round(sx, 4)} ${round(sy, 4)}) translate(${round(-vb.x, 3)} ${round(-vb.y, 3)})">${node.markup}</g>`
}

// ---------------------------------------------------------------------------
// Style serialization
// ---------------------------------------------------------------------------

function styleAttrs(
  ctx: EmitContext,
  style: Style,
  nodeId: NodeId,
  isText = false,
): string {
  const parts: string[] = []
  const p = ctx.options.precision

  const fill = paintAttrs(ctx, style.fill, nodeId, 'fill')
  parts.push(` fill="${fill.value}"`)
  // A background blur draws the shape "with its fill modulated by fillOpacity",
  // which is what lets the blurred backdrop show through it.
  const fo = fill.opacity * style.fillOpacity * backgroundFillOpacity(style)
  if (fo < 1) parts.push(` fill-opacity="${round(fo, 3)}"`)
  if (style.fillRule !== 'nonzero' && !isText) parts.push(` fill-rule="${style.fillRule}"`)

  const stroke = style.stroke
  if (stroke.paint.type !== 'none' && stroke.width > 0) {
    const sp = paintAttrs(ctx, stroke.paint, nodeId, 'stroke')
    parts.push(` stroke="${sp.value}"`)
    const so = sp.opacity * style.strokeOpacity
    if (so < 1) parts.push(` stroke-opacity="${round(so, 3)}"`)
    parts.push(` stroke-width="${round(stroke.width, p)}"`)
    if (stroke.cap !== 'butt') parts.push(` stroke-linecap="${stroke.cap}"`)
    if (stroke.join !== 'miter') parts.push(` stroke-linejoin="${stroke.join}"`)
    if (stroke.join === 'miter' && stroke.miterLimit !== 4) {
      parts.push(` stroke-miterlimit="${round(stroke.miterLimit, p)}"`)
    }
    if (stroke.dashArray.length) parts.push(` stroke-dasharray="${stroke.dashArray.join(' ')}"`)
    if (stroke.dashOffset) parts.push(` stroke-dashoffset="${round(stroke.dashOffset, p)}"`)
  }
  return parts.join('')
}

function paintAttrs(
  ctx: EmitContext,
  paint: Paint,
  nodeId: NodeId,
  target: 'fill' | 'stroke',
): { value: string; opacity: number } {
  switch (paint.type) {
    case 'none':
      return { value: 'none', opacity: 1 }
    case 'solid':
      return { value: toHex(paint.color), opacity: paint.color.a }
    case 'ref':
      return { value: paint.ref, opacity: 1 }
    case 'linear':
    case 'radial':
    case 'angular': {
      const id = gradientId(safeId(nodeId), target)
      ctx.defs.push(emitGradient(paint, id))
      return { value: `url(#${id})`, opacity: 1 }
    }
    default:
      return { value: 'none', opacity: 1 }
  }
}

function emitGradient(paint: Paint, id: string): string {
  if (!isGradient(paint)) return ''
  const stops = sortedStops(paint.stops)
    .map(
      (s) =>
        `<stop offset="${round(s.offset, 4)}" stop-color="${toHex(s.color)}"` +
        (s.color.a < 1 ? ` stop-opacity="${round(s.color.a, 3)}"` : '') +
        `/>`,
    )
    .join('')

  if (paint.type === 'angular') {
    // SVG has no conic paint server. A <pattern> is one, so the sweep is drawn
    // as a fan of wedges inside it. The DOCUMENT keeps the gradient parametric;
    // only this rendering is generated, and it is shared with the live renderer
    // so the two cannot drift.
    const paths = angularWedges(paint.cx, paint.cy, paint.rotation, paint.stops)
      .map(
        (w) =>
          `<path d="${w.d}" fill="${toHex(w.color)}"` +
          (w.color.a < 1 ? ` fill-opacity="${round(w.color.a, 3)}"` : '') +
          `/>`,
      )
      .join('')
    return (
      `<pattern id="${id}" patternUnits="objectBoundingBox" ` +
      `patternContentUnits="objectBoundingBox" x="${ANGULAR_TILE.x}" y="${ANGULAR_TILE.y}" ` +
      `width="${ANGULAR_TILE.width}" height="${ANGULAR_TILE.height}">${paths}</pattern>`
    )
  }

  // objectBoundingBox is SVG's default unit, and is what the model stores — so
  // the gradient rescales with the shape in any renderer that opens the file.
  if (paint.type === 'linear') {
    return (
      `<linearGradient id="${id}" x1="${round(paint.x1, 4)}" y1="${round(paint.y1, 4)}" ` +
      `x2="${round(paint.x2, 4)}" y2="${round(paint.y2, 4)}">${stops}</linearGradient>`
    )
  }
  return (
    `<radialGradient id="${id}" cx="${round(paint.cx, 4)}" cy="${round(paint.cy, 4)}" r="${round(paint.r, 4)}"` +
    (paint.fx !== undefined ? ` fx="${round(paint.fx, 4)}"` : '') +
    (paint.fy !== undefined ? ` fy="${round(paint.fy, 4)}"` : '') +
    `>${stops}</radialGradient>`
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round(n: number, digits = 3): number {
  if (!Number.isFinite(n)) return 0
  const f = 10 ** digits
  const r = Math.round(n * f) / f
  return Object.is(r, -0) ? 0 : r
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function safeId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '_')
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'asset'
}

function mimeToExtension(mime: string): string {
  const map: Record<string, string> = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif',
    'image/webp': 'webp', 'image/bmp': 'bmp', 'image/svg+xml': 'svg', 'image/tiff': 'tiff',
  }
  return map[mime.toLowerCase()] ?? 'png'
}

export { multiply }
