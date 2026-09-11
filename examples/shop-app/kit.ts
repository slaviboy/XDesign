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
 * A small drawing kit for building example documents in code.
 *
 * It uses the editor's own node factories, so what it makes is exactly what
 * drawing by hand would make: rectangles with corner radii, ellipses, stars,
 * real text objects measured with the real fonts, image layers on embedded
 * assets, and icons as editable paths. A Screen is one artboard; everything
 * is placed in the artboard's own coordinates, top-left at 0, 0.
 */

import {
  createArtboard, createEllipse, createImage, createPath, createPolygon, createRect, createText,
} from '@/document/NodeFactory'
import { addNode, groupNodes } from '@/document/DocumentModel'
import { createAssetId } from '@/document/ids'
import {
  DEFAULT_STROKE, DEFAULT_TEXT_STYLE,
  type CornerRadii, type DesignDocument, type DesignNode, type ImageAsset, type NodeId, type Paint,
  type RGBA, type ShadowEffect, type Style, type TextAlign, type TextStyle,
} from '@/document/types'
import { intrinsicTextSize } from '@/text/TextLayout'
import { pathBounds, transformPath } from '@/geometry/PathUtils'
import { scaling, translation } from '@/geometry/Matrix'

export function rgba(hex: string, a = 1): RGBA {
  const n = Number.parseInt(hex.replace('#', ''), 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a }
}

export function solid(hex: string, a = 1): Paint {
  return { type: 'solid', color: rgba(hex, a) }
}

export function shadow(y: number, blur: number, alpha: number, x = 0, hex = '#1C1B2E'): ShadowEffect {
  return { x, y, blur, color: rgba(hex, alpha), visible: true }
}

export interface ShapeOptions {
  fill?: Paint | string
  radius?: number | CornerRadii
  stroke?: { color: string; width: number; dash?: number[]; alpha?: number }
  shadow?: ShadowEffect
  opacity?: number
}

export interface TextOptions {
  size: number
  weight?: number
  color?: string
  family?: 'Poppins' | 'Inter'
  /** Wraps to this width (Auto Height); without it the box fits the text (Auto Width). */
  width?: number
  align?: TextAlign
  lineHeight?: number
  letterSpacing?: number
  opacity?: number
  /** What x means: the box's left edge, its centre, or its right edge. */
  anchor?: 'left' | 'center' | 'right'
}

/**
 * Rasterise SVG markup to a data URL, in the browser. PNG keeps transparency,
 * for products that sit on whatever is behind them; JPEG is for full-bleed
 * pictures with nothing to see through, at a fraction of the size.
 */
export async function rasterize(
  svg: string,
  width: number,
  height: number,
  type: 'image/png' | 'image/jpeg' = 'image/png',
): Promise<string> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, width, height)
    return canvas.toDataURL(type, 0.9)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Put a picture into the document as an asset image layers can show. */
export function addAsset(
  doc: DesignDocument,
  name: string,
  dataUrl: string,
  width: number,
  height: number,
): ImageAsset {
  const asset: ImageAsset = {
    id: createAssetId(),
    name,
    mimeType: dataUrl.slice(5, dataUrl.indexOf(';')),
    width,
    height,
    byteSize: Math.round(((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4),
    dataUrl,
  }
  doc.assets[asset.id] = asset
  return asset
}

function paintOf(fill: Paint | string | undefined, fallback: Paint): Paint {
  if (fill === undefined) return fallback
  return typeof fill === 'string' ? solid(fill) : fill
}

function styleOf(o: ShapeOptions, fallbackFill: Paint): Partial<Style> {
  const style: Partial<Style> = { fill: paintOf(o.fill, fallbackFill) }
  if (o.stroke) {
    style.stroke = {
      ...DEFAULT_STROKE,
      paint: solid(o.stroke.color, o.stroke.alpha ?? 1),
      width: o.stroke.width,
      dashArray: o.stroke.dash ?? [],
      align: 'inner',
    }
  }
  if (o.shadow) style.shadow = o.shadow
  if (o.opacity !== undefined) style.opacity = o.opacity
  return style
}

export class Screen {
  readonly id: NodeId

  constructor(
    private readonly doc: DesignDocument,
    name: string,
    x: number,
    readonly width: number,
    readonly height: number,
    background: string,
  ) {
    const board = createArtboard(name, { x, y: 0, width, height }, solid(background))
    addNode(doc, board, doc.rootId)
    this.id = board.id
  }

  private add<T extends DesignNode>(node: T, name: string): NodeId {
    node.name = name
    addNode(this.doc, node, this.id)
    return node.id
  }

  rect(name: string, x: number, y: number, w: number, h: number, o: ShapeOptions = {}): NodeId {
    const r = o.radius ?? 0
    const radii: CornerRadii = typeof r === 'number' ? [r, r, r, r] : r
    return this.add(createRect({ x, y, width: w, height: h }, styleOf(o, solid('#FFFFFF')), radii), name)
  }

  circle(name: string, cx: number, cy: number, r: number, o: ShapeOptions = {}): NodeId {
    return this.add(
      createEllipse({ x: cx - r, y: cy - r, width: r * 2, height: r * 2 }, styleOf(o, solid('#FFFFFF'))),
      name,
    )
  }

  star(name: string, x: number, y: number, size: number, color: string): NodeId {
    return this.add(createPolygon({ x, y, width: size, height: size }, { fill: solid(color) }, 5, 0.52), name)
  }

  /** The size `content` would take, so a caller can place it before drawing it. */
  measure(content: string, o: TextOptions): { width: number; height: number } {
    return intrinsicTextSize(content, this.textStyle(o), o.width)
  }

  private textStyle(o: TextOptions): TextStyle {
    return {
      ...DEFAULT_TEXT_STYLE,
      fontFamily: o.family ?? 'Inter',
      fontSize: o.size,
      fontWeight: o.weight ?? 400,
      lineHeight: o.lineHeight ?? 1.3,
      letterSpacing: o.letterSpacing ?? 0,
      align: o.align ?? 'left',
      sizing: o.width ? 'auto-height' : 'auto-width',
    }
  }

  text(name: string, content: string, x: number, y: number, o: TextOptions): NodeId {
    const style = this.textStyle(o)
    const size = intrinsicTextSize(content, style, o.width)
    const width = o.width ?? size.width
    const left = o.anchor === 'center' ? x - width / 2 : o.anchor === 'right' ? x - width : x
    const node = createText(
      content,
      { x: left, y, width, height: size.height },
      { fill: solid(o.color ?? '#1C1B2E'), ...(o.opacity !== undefined ? { opacity: o.opacity } : {}) },
      style,
    )
    return this.add(node, name)
  }

  /** Text centred in a box, both ways. */
  centeredText(name: string, content: string, box: { x: number; y: number; w: number; h: number }, o: TextOptions): NodeId {
    const size = this.measure(content, o)
    return this.text(name, content, box.x + box.w / 2, box.y + (box.h - size.height) / 2, { ...o, anchor: 'center' })
  }

  image(name: string, asset: ImageAsset, x: number, y: number, w: number, h: number, radius: number | CornerRadii = 0): NodeId {
    const node = createImage(asset.id, name, { x, y, width: w, height: h })
    node.cornerRadius = typeof radius === 'number' ? [radius, radius, radius, radius] : radius
    return this.add(node, name)
  }

  /**
   * An icon drawn on a 24-unit grid, scaled to `size` and placed with that
   * grid's top-left at x, y. Baked into the path rather than scaled by the
   * transform, so its stroke stays the width it says.
   */
  icon(
    name: string,
    d: string,
    x: number,
    y: number,
    size: number,
    color: string,
    o: { width?: number; fill?: string } = {},
  ): NodeId {
    const scaled = transformPath(d, scaling(size / 24))
    const b = pathBounds(scaled)
    const node = createPath(
      transformPath(scaled, translation(-b.x, -b.y)),
      { x: x + b.x, y: y + b.y, width: Math.max(b.width, 0.01), height: Math.max(b.height, 0.01) },
      {
        fill: o.fill ? solid(o.fill) : { type: 'none' },
        stroke: {
          ...DEFAULT_STROKE,
          paint: solid(color),
          width: o.width ?? 2 * (size / 24),
          cap: 'round',
          join: 'round',
        },
      },
    )
    return this.add(node, name)
  }

  group(name: string, ids: readonly NodeId[]): NodeId {
    const id = groupNodes(this.doc, ids)!
    this.doc.nodes[id]!.name = name
    return id
  }
}
