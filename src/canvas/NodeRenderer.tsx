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
 * Scene graph -> SVG.
 *
 * One memoized component per node, each subscribing to its own node slice only,
 * so editing one rectangle re-renders one element rather than the whole canvas.
 *
 * Elements register themselves with the LiveTransform channel on mount. During a
 * drag the interaction engine writes transforms and geometry straight onto these
 * DOM nodes at 60fps without a single store write; React only re-renders once,
 * on commit. That contract is why this file hands out refs rather than deriving
 * everything from props on every frame.
 *
 * Selection handles are deliberately NOT rendered here — they live in
 * SelectionOverlay, outside the document group, so they never become part of the
 * document or of an export.
 */

import { memo, useCallback, useMemo, type CSSProperties, type ReactNode } from 'react'
import { meanScale, toSvgMatrix, type Mat2D } from '../geometry/Matrix'
import type { Bounds } from '../geometry/Bounds'
import { mat3ToMat2D, projectPathData } from '../geometry/Perspective'
import {
  ellipsePath,
  linePath,
  polygonStarPath,
  rectPath,
} from '../geometry/ShapeGeometry'
import { localMatrix, maskOutlines, worldMatrix } from '../document/SceneGraph'
import { depthSorted, isPreserve3d, planeHomography } from '../document/Scene3D'
import {
  useDocument,
  useDocumentStore,
  useEditorStore,
  useLive3dTick,
  useLiveTransform3d,
  useLiveTransformTick,
  useNode,
} from '../state/hooks'
import { useTraceHidesSource } from './TracePreview'
import { liveTransform } from './LiveTransform'
import { gridStepForZoom } from './gridMath'
import { clipKey, fxKey, geomKey } from './liveKeys'
import { getLiveBox, getLiveSize, getLiveSizing } from '../tools/DragSession'
import { liveDocument } from '../tools/liveDocument'
import {
  CANVAS_MESH,
  meshZoomBucket,
  planeContentId,
  planeDomain,
  planeMaskId,
  planeMesh,
  projectedRegion,
  trianglePath,
  triangleRegion,
} from './perspectiveMarkup'
import {
  ANGULAR_TILE,
  angularWedges,
  dashArrayValue,
  gradientId,
  isGradient,
  paintToAttrs,
  sortedStops,
} from './paint'
import { toHex } from '../document/color'
import {
  hasStyle,
  is3dTransform,
  isContainer,
  isMaskGroup,
  layoutColumns,
  repeatGridOffsets,
  repeatGridSize,
  supports3d,
  transform3dOf,
} from '../document/types'
import {
  activeBlur,
  backdropClipId,
  backdropFilterId,
  backgroundBlurPrimitives,
  backgroundFillOpacity,
  effectFilter,
  effectFilterId,
} from './effects'
import type {
  ArtboardNode,
  BlurEffect,
  RepeatGridNode,
  DesignDocument,
  DesignNode,
  GroupNode,
  ImageNode,
  NodeId,
  Paint,
  Style,
  SvgNode,
  TextNode,
} from '../document/types'
import { layoutText, lineOffsetX, misspelledRuns, cssFont } from '../text/TextLayout'
import { isMisspelled, isReady, isSpellCheckEnabled } from '../text/spellcheck'
import { useFonts, useSpellCheckTick } from '../state/hooks-i18n'
import { fontStack } from '../text/FontRegistry'

/**
 * Ref that registers an element under a LiveTransform key.
 *
 * Returns a cleanup (React 19 ref-cleanup form) so unmounting ONE element
 * detaches only that element — a bare `register(key, null)` would drop every
 * sibling sharing the key, which matters now that a shape's outline can be
 * drawn by a fill path, a stroke path and a clip or mask at once.
 */
function liveRef(key: string, enabled: boolean) {
  return liveRefs([key], enabled)
}

/**
 * The same, for an element that has to answer to SEVERAL keys.
 *
 * A background blur's clip is drawn in the PARENT's space, so it does not move
 * inside the shape's own group and needs both keys: the node's own, which
 * carries the matrix, and its geometry key, which carries `d`. Without the
 * first the region stays where the shape started and the blur looks nailed to
 * the canvas; without the second it keeps the shape's old size through a resize.
 */
function liveRefs(keys: readonly string[], enabled: boolean) {
  return (el: SVGElement | null) => {
    if (!enabled || !el) return undefined
    for (const key of keys) liveTransform.register(key, el)
    return () => {
      for (const key of keys) liveTransform.unregister(key, el)
    }
  }
}
/**
 * What a rendered node IS.
 *
 * 'primary'  the node itself: carries its identity attributes, and owns its
 *            LiveTransform registration.
 * 'mirror'   a duplicate that must still follow a live gesture — the blurred
 *            copy of a backdrop. It registers (LiveTransform writes to every
 *            element under a key, and a mirror sits exactly where the original
 *            does) but carries no identity, so it is invisible to hit testing
 *            and to anything counting nodes in the DOM.
 * 'repeat'   a duplicate that must NOT register: a repeat grid's 2nd..Nth cell
 *            is the same node drawn at a different offset, and only one copy
 *            may own the live element.
 *
 * It propagates down a subtree, because a copy of a group is a copy of
 * everything in it.
 */
export type CopyMode = 'primary' | 'mirror' | 'repeat'

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function GradientDef({ paint, id }: { paint: Paint; id: string }): ReactNode {
  if (!isGradient(paint)) return null
  const stops = sortedStops(paint.stops).map((s) => (
    <stop
      key={s.id}
      offset={s.offset}
      stopColor={toHex(s.color)}
      stopOpacity={s.color.a}
    />
  ))
  // Coordinates are objectBoundingBox units, SVG's default — so the gradient
  // rescales with the shape automatically.
  if (paint.type === 'angular') {
    // SVG has no conic paint server, so the sweep is a <pattern> of wedges —
    // which IS a paint server, so nothing downstream has to know the difference.
    const wedges = angularWedges(paint.cx, paint.cy, paint.rotation, paint.stops)
    return (
      <pattern
        id={id}
        patternUnits="objectBoundingBox"
        patternContentUnits="objectBoundingBox"
        x={ANGULAR_TILE.x}
        y={ANGULAR_TILE.y}
        width={ANGULAR_TILE.width}
        height={ANGULAR_TILE.height}
      >
        {wedges.map((w, i) => (
          <path key={i} d={w.d} fill={toHex(w.color)} fillOpacity={w.color.a} />
        ))}
      </pattern>
    )
  }

  // Units, gradientTransform and spreadMethod are passed through rather than
  // approximated: an imported gradient authored in user space under a transform
  // is not the same gradient once flattened into bounding-box coordinates.
  const shared = {
    ...(paint.units ? { gradientUnits: paint.units } : {}),
    ...(paint.transform ? { gradientTransform: toSvgMatrix(paint.transform as Mat2D) } : {}),
    ...(paint.spread ? { spreadMethod: paint.spread } : {}),
  }

  return paint.type === 'linear' ? (
    <linearGradient id={id} x1={paint.x1} y1={paint.y1} x2={paint.x2} y2={paint.y2} {...shared}>
      {stops}
    </linearGradient>
  ) : (
    <radialGradient
      id={id}
      cx={paint.cx}
      cy={paint.cy}
      r={paint.r}
      fx={paint.fx ?? paint.cx}
      fy={paint.fy ?? paint.cy}
      {...(paint.fr !== undefined ? { fr: paint.fr } : {})}
      {...shared}
    >
      {stops}
    </radialGradient>
  )
}

interface PaintedProps {
  nodeId: NodeId
  style: Style
  d: string
  /** Local box, needed to build the outer-stroke mask. */
  width: number
  height: number
  geomRef: (el: SVGElement | null) => void
}

/**
 * A filled and stroked shape.
 *
 * SVG only draws centered strokes. Inner and outer alignment are emulated the
 * way design tools do it: draw the stroke at double width, then clip it to the
 * shape (inner) or mask the shape out of it (outer). The common centered case
 * takes the cheap single-element path.
 */
function PaintedPath({ nodeId, style, d, width, height, geomRef }: PaintedProps): ReactNode {
  const fill = paintToAttrs(style.fill, nodeId, 'fill')
  // Adobe: a background blur draws the shape "with its fill modulated by
  // fillOpacity" — the blurred backdrop is meant to show through it.
  const fillAlpha = fill.opacity * style.fillOpacity * backgroundFillOpacity(style)
  const stroke = paintToAttrs(style.stroke.paint, nodeId, 'stroke')
  const hasStroke = style.stroke.paint.type !== 'none' && style.stroke.width > 0
  const aligned = hasStroke && style.stroke.align !== 'center'
  const clipId = `sa-clip-${nodeId}`
  const maskId = `sa-mask-${nodeId}`
  const dash = dashArrayValue(style.stroke.dashArray)

  const strokeProps = {
    stroke: stroke.value,
    strokeOpacity: stroke.opacity * style.strokeOpacity,
    strokeWidth: aligned ? style.stroke.width * 2 : style.stroke.width,
    strokeLinecap: style.stroke.cap,
    strokeLinejoin: style.stroke.join,
    strokeMiterlimit: style.stroke.miterLimit,
    strokeDasharray: dash,
    strokeDashoffset: style.stroke.dashOffset || undefined,
  } as const

  const defs = (
    <defs>
      <GradientDef paint={style.fill} id={gradientId(nodeId, 'fill')} />
      <GradientDef paint={style.stroke.paint} id={gradientId(nodeId, 'stroke')} />
      {aligned && style.stroke.align === 'inner' && (
        <clipPath id={clipId}>
          <path ref={geomRef} d={d} />
        </clipPath>
      )}
      {aligned && style.stroke.align === 'outer' && (
        <mask id={maskId} maskUnits="userSpaceOnUse">
          <rect
            x={-style.stroke.width}
            y={-style.stroke.width}
            width={width + style.stroke.width * 2}
            height={height + style.stroke.width * 2}
            fill="white"
          />
          <path ref={geomRef} d={d} fill="black" />
        </mask>
      )}
    </defs>
  )

  if (!aligned) {
    return (
      <>
        {defs}
        <path
          ref={geomRef}
          d={d}
          fill={fill.value}
          fillOpacity={fillAlpha}
          fillRule={style.fillRule}
          {...(hasStroke ? strokeProps : { stroke: 'none' })}
        />
      </>
    )
  }

  return (
    <>
      {defs}
      <path
        ref={geomRef}
        d={d}
        fill={fill.value}
        fillOpacity={fillAlpha}
        fillRule={style.fillRule}
        stroke="none"
      />
      <path
        ref={geomRef}
        d={d}
        fill="none"
        clipPath={style.stroke.align === 'inner' ? `url(#${clipId})` : undefined}
        mask={style.stroke.align === 'outer' ? `url(#${maskId})` : undefined}
        {...strokeProps}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// Per-type bodies
// ---------------------------------------------------------------------------

function shapePathData(node: DesignNode): string {
  const { width, height } = node.transform
  switch (node.type) {
    case 'rect': return rectPath(width, height, node.cornerRadius)
    case 'ellipse': return ellipsePath(width, height)
    case 'polygon':
      return polygonStarPath(width, height, node.sides, node.starRatio, node.cornerRadius)
    case 'line': return linePath(node.x1, node.y1, node.x2, node.y2)
    case 'path': return node.d
    default: return rectPath(width, height, 0)
  }
}

function TextBody({ node }: { node: TextNode }): ReactNode {
  // While this node is being TYPED IN the <textarea> is the rendering. Drawing
  // both would show two sets of glyphs at once — they cannot line up, because a
  // textarea centres its text in a CSS line box and SVG sits it on a baseline —
  // and any mismatch between the two, a wrap or a transformation, doubles the
  // text visibly instead of subtly.
  //
  // The moment focus leaves for the inspector, though, the textarea is no
  // longer what is being looked at, and it cannot show mixed styling anyway. So
  // it hides and this takes over, which is what makes formatting a selection
  // visible while you are formatting it.
  // Rich text is never hidden: a textarea has one font and cannot show it, so
  // this is the only rendering of it there is, focused or not.
  const rich = !!node.runs?.length
  const editing = useEditorStore(
    (s) => !rich && s.editingTextId === node.id && s.textEditingFocused,
  )
  const fill = paintToAttrs(node.style.fill, node.id, 'fill')
  const stroke = paintToAttrs(node.style.stroke.paint, node.id, 'stroke')
  const hasStroke = node.style.stroke.paint.type !== 'none' && node.style.stroke.width > 0

  // Text is the one body whose geometry is not an attribute: re-wrapping means
  // rebuilding the lines, which LiveTransform cannot push. So this component
  // re-renders itself on each live frame instead, reading the in-flight width.
  // Only this node re-renders — the document store is still never written
  // during a gesture, which is the rule that matters.
  // Measuring against a face that has not arrived measures the fallback, so the
  // whole layout is redone the moment the real one lands.
  const fontsTick = useFonts()
  const liveTick = useLiveTransformTick()
  const live = useMemo(() => getLiveSize(node.id), [node.id, liveTick])
  const width = live?.width ?? node.transform.width
  const height = live?.height ?? node.transform.height

  // A resize hands the box a dimension it did not own, so the mode can change
  // mid-gesture — and the wrap has to follow it while the pointer is still
  // down rather than snapping when it comes up.
  const sizing = useMemo(
    () => getLiveSizing(node.id) ?? node.textStyle.sizing,
    [node.id, node.textStyle.sizing, liveTick],
  )
  const style = useMemo(
    () => (sizing === node.textStyle.sizing ? node.textStyle : { ...node.textStyle, sizing }),
    [node.textStyle, sizing],
  )

  // Both modes that own their width wrap to it; Auto Width never does.
  const layout = useMemo(
    () => layoutText(node.text, style, sizing === 'auto-width' ? undefined : width, node.runs),
    [node.text, style, sizing, width, node.runs, fontsTick],
  )

  const boxWidth = sizing === 'auto-width' ? layout.width : width
  const decoration = [
    node.textStyle.underline ? 'underline' : '',
    node.textStyle.strikethrough ? 'line-through' : '',
  ].filter(Boolean).join(' ')

  // Adobe: Fixed Size "lets you wrap the text to fit inside the text box and
  // crop automatically when it exceeds the height".
  const clipped = sizing === 'fixed'
  const clipId = `text-clip-${node.id}`

  if (editing) return null

  return (
    <>
      <defs>
        <GradientDef paint={node.style.fill} id={gradientId(node.id, 'fill')} />
        <GradientDef paint={node.style.stroke.paint} id={gradientId(node.id, 'stroke')} />
        {clipped && (
          <clipPath id={clipId}>
            <rect width={Math.max(0, width)} height={Math.max(0, height)} />
          </clipPath>
        )}
      </defs>
      {/* Both inside one clip: a squiggle marks a word, so it has to disappear
          with the word. Clipping only the glyphs left red waves floating below
          a Fixed Size box, under text the box had already cropped away. */}
      <g clipPath={clipped ? `url(#${clipId})` : undefined}>
        {/* Under the glyphs, so a squiggle never sits on top of the letters it
            is marking. */}
        <SpellUnderlines node={node} layout={layout} boxWidth={boxWidth} />
        <text
          fontFamily={fontStack(node.textStyle.fontFamily)}
          fontSize={node.textStyle.fontSize}
          fontWeight={node.textStyle.fontWeight}
          fontStyle={node.textStyle.fontStyle}
          letterSpacing={node.textStyle.letterSpacing * node.textStyle.fontSize}
          textDecoration={decoration || undefined}
          fill={fill.value}
          fillOpacity={fill.opacity * node.style.fillOpacity}
          stroke={hasStroke ? stroke.value : 'none'}
          strokeOpacity={hasStroke ? stroke.opacity * node.style.strokeOpacity : undefined}
          strokeWidth={hasStroke ? textStrokeWidth(node.style.stroke) : undefined}
          strokeLinejoin={hasStroke ? node.style.stroke.join : undefined}
          // The stroke goes UNDER the glyphs. Painted over them, as SVG does by
          // default, half of it eats into the letterforms: on a stem no thicker
          // than the stroke the fill disappears entirely, counters close up, and
          // adjacent letters grow into each other. Behind the fill, the same
          // stroke shows only the half that is outside the glyph, which is what
          // an outlined letter is supposed to look like — and what Adobe does,
          // where Stroke sits below Fill in a type object's appearance.
          paintOrder={hasStroke ? 'stroke' : undefined}
          style={{ whiteSpace: 'pre' } as CSSProperties}
        >
          {layout.lines.map((line, i) => {
            const originX = lineOffsetX(line.width, boxWidth, style.align)
            // A line of uniform text stays exactly one <tspan>, so ordinary
            // text renders byte-for-byte as it did before rich text existed.
            if (!line.segments) {
              return (
                <tspan key={i} x={originX} y={line.baseline}>
                  {line.text === '' ? ' ' : line.text}
                </tspan>
              )
            }
            return line.segments.map((seg, j) => (
              <tspan
                key={`${i}-${j}`}
                x={originX + seg.x}
                y={line.baseline}
                fontFamily={fontStack(seg.style.fontFamily)}
                fontSize={seg.style.fontSize}
                fontWeight={seg.style.fontWeight}
                fontStyle={seg.style.fontStyle}
                letterSpacing={seg.style.letterSpacing * seg.style.fontSize}
                {...(seg.fill ? paintToTspanFill(seg.fill, node.id, j) : {})}
              >
                {seg.text === '' ? ' ' : seg.text}
              </tspan>
            ))
          })}
        </text>
      </g>
    </>
  )
}

/**
 * The stroke width to draw text with, given where the stroke is meant to sit.
 *
 * Drawn behind the fill, a stroke of width W shows W/2 outside the glyph — so a
 * centred stroke needs no adjustment, and an outer one is asked for at double
 * width to put the full W outside. Inner is the one SVG cannot do to text
 * without clipping every glyph, and drawing it as centred would be a lie about
 * a stroke's position; it is drawn at its own width, which is the closest
 * honest answer.
 */
function textStrokeWidth(stroke: Style['stroke']): number {
  return stroke.align === 'outer' ? stroke.width * 2 : stroke.width
}

/**
 * A run's own fill, as tspan attributes.
 *
 * Only solid paint is resolved here. A gradient on a single run would need a
 * paint server keyed to that run, and no design tool offers one — so a run
 * carrying a gradient keeps the text object's own fill rather than silently
 * painting itself a flat colour picked from the middle of the ramp.
 */
function paintToTspanFill(paint: Paint, _nodeId: NodeId, _index: number): { fill?: string; fillOpacity?: number } {
  if (paint.type !== 'solid') return {}
  return { fill: toHex(paint.color), fillOpacity: paint.color.a }
}

/**
 * Red waves under whatever the dictionaries do not recognise.
 *
 * Drawn rather than delegated to the browser: a <textarea>'s native check uses
 * the browser's own languages, and the whole point here is to check against
 * English plus the interface language, from dictionaries that ship with the app
 * and work offline.
 */
function SpellUnderlines({
  node,
  layout,
  boxWidth,
}: {
  node: TextNode
  layout: ReturnType<typeof layoutText>
  boxWidth: number
}): ReactNode {
  // Re-renders when a dictionary finishes loading, which is the only moment the
  // answer changes without the text changing.
  useSpellCheckTick()
  const enabled = isSpellCheckEnabled() && isReady()

  const runs = useMemo(() => {
    if (!enabled) return []
    return layout.lines.flatMap((line) => {
      const x0 = lineOffsetX(line.width, boxWidth, node.textStyle.align)
      return misspelledRuns(line.text, node.textStyle, isMisspelled).map((run) => ({
        x: x0 + run.x,
        width: run.width,
        // Just below the baseline, clear of the descenders.
        y: line.baseline + node.textStyle.fontSize * 0.16,
      }))
    })
  }, [enabled, layout, boxWidth, node.textStyle])

  if (runs.length === 0) return null
  return (
    <g className="spell-underlines" pointerEvents="none">
      {runs.map((run, i) => (
        <path key={i} className="spell-underline" d={wavePath(run.x, run.y, run.width)} />
      ))}
    </g>
  )
}

/** A zig-zag rather than a dashed line: it is the shape everyone reads as "wrong". */
function wavePath(x: number, y: number, width: number): string {
  const step = 2
  let d = `M${round2(x)} ${round2(y)}`
  for (let i = 0; i < Math.floor(width / step); i++) {
    d += `l${step} ${i % 2 === 0 ? 2 : -2}`
  }
  return d
}

const round2 = (n: number) => Math.round(n * 100) / 100

function ImageBody({
  node,
  geomRef,
}: {
  node: ImageNode
  geomRef: (el: SVGElement | null) => (() => void) | undefined
}): ReactNode {
  const dataUrl = useDocumentStore((s) => s.doc.assets[node.assetId]?.dataUrl)
  // While Image Trace previews a result in place of the picture, the picture
  // has to go — a trace with Ignore White on is transparent where the source
  // was white, and anything drawn on top would show it through.
  const traced = useTraceHidesSource(node.id)
  const { width, height } = node.transform
  const clipId = `img-clip-${node.id}`

  if (traced) return null

  if (!dataUrl) {
    // The asset is missing (a corrupt file, or a node pasted from a document
    // whose assets did not come along). Show a placeholder rather than an
    // invisible hole, so the user can see there is something to fix.
    return (
      <>
        <rect width={width} height={height} fill="#f0f0f0" stroke="#d0d0d0" strokeDasharray="4 3" />
        <text x={width / 2} y={height / 2} textAnchor="middle" fontSize={11} fill="#999">
          Missing image
        </text>
      </>
    )
  }

  const preserve = node.fit === 'fill' ? 'none' : node.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet'

  return (
    <>
      {/* Always emitted, even at radius 0: a corner-radius drag overrides this
          path's `d`, and there would be nothing to override otherwise. */}
      <defs>
        <clipPath id={clipId}>
          <path ref={geomRef} d={rectPath(width, height, node.cornerRadius)} />
        </clipPath>
      </defs>
      <image
        // Registered alongside the clip so the picture is resized by the same
        // frame that resizes the region it is drawn through.
        ref={geomRef}
        href={dataUrl}
        width={width}
        height={height}
        preserveAspectRatio={preserve}
        clipPath={`url(#${clipId})`}
        style={{ imageRendering: 'auto' }}
      />
    </>
  )
}

/**
 * A preserved SVG subtree from an import.
 *
 * The markup was sanitized and ID-namespaced at import time; it is inserted
 * verbatim so that constructs the editor has no first-class model for (<use>,
 * <pattern>, <mask>, <filter>, <marker>) keep rendering exactly as authored,
 * as real vector, instead of being dropped or flattened to a bitmap.
 */
function SvgBody({ node }: { node: SvgNode }): ReactNode {
  const { width, height } = node.transform
  const vb = node.viewBox
  // Map the source viewBox onto the node's local box.
  const sx = vb.width > 0 ? width / vb.width : 1
  const sy = vb.height > 0 ? height / vb.height : 1
  const inner = `scale(${sx} ${sy}) translate(${-vb.x} ${-vb.y})`

  return (
    <>
      {node.defs && <defs dangerouslySetInnerHTML={{ __html: node.defs }} />}
      <g transform={inner} dangerouslySetInnerHTML={{ __html: node.markup }} />
    </>
  )
}

/**
 * A repeat grid draws its ONE set of source children once per cell, translated.
 *
 * This is what makes editing propagate: there is only ever a single copy of the
 * content in the document, so a change to it is a change to every cell. The
 * alternative — materialising N copies — would need change-propagation logic
 * and would bloat the file by the repeat count.
 */
function RepeatGridBody({ node, copy }: { node: RepeatGridNode; copy: CopyMode }): ReactNode {
  const doc = useDocumentStore((s) => s.doc)
  const offsets = repeatGridOffsets(node)
  const size = repeatGridSize(node)
  const clipId = `rg-clip-${node.id}`
  const ordered = depthSorted(doc, node.id, node.children)

  return (
    <>
      <defs>
        <clipPath id={clipId}>
          <rect width={Math.max(0, size.width)} height={Math.max(0, size.height)} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        {offsets.map((offset, i) => (
          <g key={i} transform={`translate(${offset.x} ${offset.y})`}>
            {ordered.map((childId) => (
              // Cell 0 owns the live element refs; later cells are pure
              // repeats, so they must not re-register the same node id with
              // LiveTransform or a drag would write to whichever mounted last.
              <NodeRenderer key={childId} id={childId} copy={i > 0 ? 'repeat' : copy} />
            ))}
          </g>
        ))}
      </g>
    </>
  )
}

/**
 * Children in paint order, with background blur resolved.
 *
 * Under any child that asks for one, the artwork already painted in this
 * container is drawn a SECOND time — blurred and clipped to that child's
 * outline. That is the whole trick, and it is the only one available: no SVG
 * filter can read the backdrop, and CSS backdrop-filter is silently ignored on
 * SVG elements. The exporter builds the identical thing out of a <use>, so the
 * file matches the canvas.
 *
 * The copies mount with `repeat`, which is the same flag repeat grids use to
 * keep duplicate artwork from registering itself with LiveTransform — only the
 * real child may own a node's live element.
 */
function Children({
  ids,
  parentId,
  copy = 'primary',
}: {
  ids: readonly NodeId[]
  /** The container, so a child's Z depth can put it in front of its siblings. */
  parentId?: NodeId
  copy?: CopyMode
}): ReactNode {
  const doc = useDocumentStore((s) => s.doc)
  const out: ReactNode[] = []
  const ordered = parentId ? depthSorted(doc, parentId, ids) : ids

  ordered.forEach((id, i) => {
    const node = doc.nodes[id]
    const blur = node && node.visible && hasStyle(node) ? activeBlur(node.style, 'background') : null
    // Nothing painted yet is nothing to blur. And a backdrop inside a backdrop
    // is not drawn at all: one blurred panel does not blur through another.
    if (blur && node && i > 0 && copy === 'primary') {
      out.push(<Backdrop key={`bd-${id}`} node={node} doc={doc} before={ordered.slice(0, i)} blur={blur} />)
    }
    out.push(<NodeRenderer key={id} id={id} copy={copy} />)
  })

  return <>{out}</>
}

function Backdrop({
  node,
  doc,
  before,
  blur,
}: {
  node: DesignNode
  doc: DesignDocument
  before: readonly NodeId[]
  blur: BlurEffect
}): ReactNode {
  const clipId = backdropClipId(node.id)
  const filterId = backdropFilterId(node.id)
  // A panel in perspective blurs what is behind the panel as it is SEEN, so
  // the clip is its outline projected — still under the panel's own matrix.
  const h = transform3dOf(node) ? planeHomography(doc, node.id) : null
  // The clip is drawn in the PARENT's space, so it does not travel inside the
  // panel's group and has to be moved and resized itself. Both keys: the
  // node's own carries the matrix, its geometry key carries `d` — except for a
  // projected outline, which a flat `d` written mid-resize would un-project.
  const keys = h ? [node.id] : [node.id, geomKey(node.id)]
  const clipRef = useCallback(liveRefs(keys, true), [node.id, !!h])
  const outline = h ? projectPathData(shapePathData(node), h) : shapePathData(node)

  return (
    <>
      <defs>
        <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
          <path ref={clipRef} d={outline} transform={toSvgMatrix(localMatrix(node.transform))} />
        </clipPath>
        <filter
          id={filterId}
          x="-20%"
          y="-20%"
          width="140%"
          height="140%"
          dangerouslySetInnerHTML={{ __html: backgroundBlurPrimitives(blur) }}
        />
      </defs>
      <g clipPath={`url(#${clipId})`} filter={`url(#${filterId})`} pointerEvents="none">
        {/* Mirrors, not repeats: the copy sits exactly where the original does,
            so it must follow a drag or a resize frame by frame — a frozen one
            leaves a blurred ghost of the artwork at its old position. */}
        {before.map((id) => (
          <NodeRenderer key={id} id={id} copy="mirror" />
        ))}
      </g>
    </>
  )
}

/**
 * A group, and — when it carries a `maskId` — a mask group.
 *
 * Adobe: "the object on top of the stack acts as a mask". The mask child is not
 * painted itself; its outline becomes a clip path over everything below it, so
 * the masked content is hidden rather than deleted and can be brought back by
 * releasing the mask.
 *
 * A <clipPath> rather than a <mask>: XD's masks have hard edges, and a
 * luminance mask would make a shape's own fill and opacity leak into the
 * result, so a mask filled with 50% grey would half-hide what it masks.
 */
function GroupBody({ node, copy }: { node: GroupNode; copy: CopyMode }): ReactNode {
  const mask = useNode(node.maskId ?? '')
  const doc = useDocumentStore((s) => s.doc)
  const clipId = `mask-clip-${node.id}`
  const masked = isMaskGroup(node) && !!mask

  const content = (
    <Children
      copy={copy}
      parentId={node.id}
      ids={node.children.filter((childId) => !masked || childId !== node.maskId)}
    />
  )

  if (!masked) return content

  // An imported <mask> modulates by luminance or alpha rather than clipping to
  // an outline, so it is emitted as a real <mask> with the mask node drawn into
  // it. XD's own masks — everything made in the editor — stay hard clips.
  if (node.maskMode === 'luminance' || node.maskMode === 'alpha') {
    return (
      <>
        <defs>
          <mask id={clipId} maskUnits="userSpaceOnUse" {...maskTypeAttr(node.maskMode)}>
            <NodeRenderer id={node.maskId!} copy="mirror" />
          </mask>
        </defs>
        <g mask={`url(#${clipId})`}>{content}</g>
      </>
    )
  }

  return (
    <>
      <defs>
        <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
          {/* Transformed by the mask's own matrix, because the clip lives in
              the GROUP's space while the outline is authored in the mask's.
              A mask that is a GROUP contributes every outline inside it — an
              imported <clipPath> may hold several shapes, and clipping to their
              bounding box instead would quietly be the wrong shape. */}
          {maskOutlines(doc, node.maskId!).map((o, i) => (
            <path key={i} d={o.d} transform={toSvgMatrix(o.m)} />
          ))}
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>{content}</g>
    </>
  )
}

/** SVG 2 mask-type; luminance is the default so it is only stated for alpha. */
function maskTypeAttr(mode: 'luminance' | 'alpha'): { style?: CSSProperties } {
  return mode === 'alpha'
    ? { style: { maskType: 'alpha' } as CSSProperties }
    : {}
}

/**
 * The grid drawn over one artboard.
 *
 * Adobe's two kinds. A SQUARE grid is emitted as an SVG <pattern> rather than a
 * few hundred <line> elements: the artboard bounds it, but an 8px grid on a
 * tall artboard is still thousands of nodes, and the browser tiles a pattern
 * for free.
 *
 * Drawn between the artboard's background and its children — over the fill,
 * under the artwork — which is where XD puts it and the only place that can be
 * reached from inside the artboard's own body.
 *
 * It lives inside the document layer but is NOT exportable: the exporter has
 * its own emitBody for artboards and never emits this. A test pins that.
 */
function ArtboardGrid({ node }: { node: ArtboardNode }): ReactNode {
  // Read before the early return: hooks cannot be conditional.
  const zoom = useEditorStore((s) => s.viewport.zoom)
  const grid = node.grid
  const { width, height } = node.transform
  if (!grid || !grid.visible || width <= 0 || height <= 0) return null

  const color = toHex(grid.color)
  const opacity = grid.color.a

  if (grid.type === 'square') {
    // Stepped up as you zoom out, exactly as the canvas grid is: an 8px grid at
    // 5% is a solid block of ink otherwise.
    const size = gridStepForZoom(Math.max(1, grid.size), zoom)
    const patternId = `abgrid-${node.id}`
    return (
      <>
        <defs>
          <pattern id={patternId} width={size} height={size} patternUnits="userSpaceOnUse">
            {/* One cell's top and left edge; tiling draws the rest. */}
            <path
              d={`M${size} 0H0V${size}`}
              fill="none"
              stroke={color}
              strokeOpacity={opacity}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          </pattern>
        </defs>
        <rect
          className="artboard-grid"
          data-grid="square"
          width={width}
          height={height}
          fill={`url(#${patternId})`}
          pointerEvents="none"
        />
      </>
    )
  }

  const columns = layoutColumns(width, grid)
  if (columns.length === 0) return null
  return (
    <g className="artboard-grid" data-grid="layout" pointerEvents="none">
      {columns.map((c, i) => (
        <rect
          key={i}
          className="layout-column"
          x={c.x}
          y={0}
          width={c.width}
          height={height}
          fill={color}
          fillOpacity={opacity}
        />
      ))}
    </g>
  )
}

function ArtboardBody({ node, copy }: { node: ArtboardNode; copy: CopyMode }): ReactNode {
  const { width, height } = node.transform
  const bg = paintToAttrs(node.background, node.id, 'fill')
  const clipId = `ab-clip-${node.id}`

  return (
    <>
      <defs>
        <GradientDef paint={node.background} id={gradientId(node.id, 'fill')} />
        {node.clipContent && (
          <clipPath id={clipId}>
            <rect width={width} height={height} />
          </clipPath>
        )}
      </defs>
      {node.background.type !== 'none' && (
        <rect width={width} height={height} fill={bg.value} fillOpacity={bg.opacity} />
      )}
      {/* Over the fill, under the artwork. */}
      <ArtboardGrid node={node} />
      <g clipPath={node.clipContent ? `url(#${clipId})` : undefined}>
        <Children ids={node.children} parentId={node.id} copy={copy} />
      </g>
    </>
  )
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * What a node draws in its own local space, without its wrapper.
 *
 * Separate from NodeRenderer because a node in perspective draws the very
 * same body — once, flat, into <defs> — and the mesh does the rest; the
 * wrapper is the only part that differs.
 */
function NodeBody({
  node,
  copy,
  geomRef,
}: {
  node: DesignNode
  copy: CopyMode
  geomRef: (el: SVGElement | null) => (() => void) | undefined
}): ReactNode {
  switch (node.type) {
    case 'artboard':
      return <ArtboardBody node={node} copy={copy} />
    case 'group':
      return <GroupBody node={node} copy={copy} />
    case 'repeat-grid':
      return <RepeatGridBody node={node} copy={copy} />
    case 'text':
      return <TextBody node={node} />
    case 'image':
      return <ImageBody node={node} geomRef={geomRef} />
    case 'svg':
      return <SvgBody node={node} />
    case 'document':
      return <Children ids={node.children} parentId={node.id} copy={copy} />
    default:
      return (
        <PaintedPath
          nodeId={node.id}
          style={node.style}
          d={shapePathData(node)}
          width={node.transform.width}
          height={node.transform.height}
          geomRef={geomRef}
        />
      )
  }
}

/** Opacity and blend mode, which belong on whatever group stands for the node. */
function wrapperLook(node: DesignNode): { opacity?: number; style?: CSSProperties } {
  const styled = hasStyle(node) ? node.style : null
  const opacity = styled?.opacity ?? 1
  return {
    opacity: opacity === 1 ? undefined : opacity,
    style:
      styled && styled.blendMode !== 'normal'
        ? ({ mixBlendMode: styled.blendMode } as CSSProperties)
        : undefined,
  }
}

export const NodeRenderer = memo(function NodeRenderer({
  id,
  copy = 'primary',
}: {
  id: NodeId
  /** What this rendering is — see CopyMode. */
  copy?: CopyMode
}): ReactNode {
  const node = useNode(id)
  // Per node: only an object the gizmo is actually turning re-renders here.
  const live3d = useLiveTransform3d(id)

  const live = copy !== 'repeat'
  const groupRef = useCallback(liveRef(id, live), [id, live])
  const geomRef = useCallback(liveRef(geomKey(id), live), [id, live])
  const filterRef = useCallback(liveRef(fxKey(id), live), [id, live])

  if (!node) return null
  // Hidden nodes are not rendered at all, which also makes them unclickable.
  if (!node.visible) return null

  // The gizmo's value wins while it holds the node, zero included — which is
  // how a turned card goes back to flat the moment it is dragged back square.
  const tilted = live3d !== undefined ? is3dTransform(live3d) : !!transform3dOf(node)
  if (tilted && supports3d(node)) {
    return <Object3D id={id} copy={copy} groupRef={groupRef} geomRef={geomRef} />
  }

  const transform = toSvgMatrix(localMatrix(node.transform))
  const styled = hasStyle(node) ? node.style : null
  const filter = styled ? effectFilter(id, styled, node.transform) : null

  return (
    <g
      ref={groupRef}
      transform={transform}
      {...wrapperLook(node)}
      filter={filter ? `url(#${effectFilterId(id)})` : undefined}
      data-node-id={copy === 'primary' ? id : undefined}
      data-node-type={copy === 'primary' ? node.type : undefined}
      // Locked nodes stay visible but must not swallow pointer events on canvas.
      pointerEvents={node.locked ? 'none' : undefined}
    >
      {filter && (
        <defs>
          <filter
            ref={filterRef}
            id={filter.id}
            filterUnits="userSpaceOnUse"
            x={filter.x}
            y={filter.y}
            width={filter.width}
            height={filter.height}
            dangerouslySetInnerHTML={{ __html: filter.primitives }}
          />
        </defs>
      )}
      <NodeBody node={node} copy={copy} geomRef={geomRef} />
    </g>
  )
})

// ---------------------------------------------------------------------------
// Perspective
// ---------------------------------------------------------------------------

type LiveRef = (el: SVGElement | null) => (() => void) | undefined

/**
 * A 3D object: see Scene3D for the model, perspectiveMarkup for the markup.
 *
 * Its wrapper is an ordinary <g transform> carrying the node's 2D matrix, and
 * registered with LiveTransform exactly as a flat node's is — so moving or
 * rotating a tilted card is still one attribute write per frame. Everything
 * projected is drawn INSIDE that group, in the node's own space.
 *
 * Unlike a flat node, this re-renders during a gesture: a resize moves the
 * pivot the camera looks at, and the gizmo changes the projection itself,
 * neither of which is an attribute. It reads the document as the gesture
 * would leave it (liveDocument), and writes nothing.
 */
function Object3D({
  id,
  copy,
  groupRef,
  geomRef,
}: {
  id: NodeId
  copy: CopyMode
  groupRef: LiveRef
  geomRef: LiveRef
}): ReactNode {
  const stored = useDocument()
  const liveTick = useLiveTransformTick()
  const live3dTick = useLive3dTick()
  const zoom = useEditorStore((s) => meshZoomBucket(s.viewport.zoom))
  // The ticks are the dependency: mid-gesture the store has not changed, and
  // they are the only signal that the live values have.
  const doc = useMemo(() => liveDocument(stored), [stored, liveTick, live3dTick])

  // The wrapper takes the COMMITTED matrix: during a drag LiveTransform owns
  // that attribute, and rendering the live one here as well would fight it.
  const committed = stored.nodes[id]
  const node = doc.nodes[id]
  if (!committed || !node) return null
  // Screen pixels per unit inside the wrapper, which is what the mesh's
  // tolerance is measured in.
  const pxPerUnit = zoom * meanScale(worldMatrix(doc, id))

  return (
    <g
      ref={groupRef}
      transform={toSvgMatrix(localMatrix(committed.transform))}
      {...wrapperLook(node)}
      data-node-id={copy === 'primary' ? id : undefined}
      data-node-type={copy === 'primary' ? node.type : undefined}
      data-3d=""
      pointerEvents={node.locked ? 'none' : undefined}
    >
      {isPreserve3d(doc, id) ? (
        <SpaceChildren doc={doc} containerId={id} copy={copy} pxPerUnit={pxPerUnit} />
      ) : (
        <Plane doc={doc} node={node} copy={copy} geomRef={geomRef} pxPerUnit={pxPerUnit} />
      )}
    </g>
  )
}

/**
 * The children of a group that shares its 3D space, back to front by depth.
 *
 * None of them gets a transform of its own here: each one's place in the
 * space is folded into its plane's projection, which lands in the space
 * root's coordinates. Their groups carry identity, opacity and blend only.
 */
function SpaceChildren({
  doc,
  containerId,
  copy,
  pxPerUnit,
}: {
  doc: DesignDocument
  containerId: NodeId
  copy: CopyMode
  pxPerUnit: number
}): ReactNode {
  const container = doc.nodes[containerId]
  if (!container || !isContainer(container)) return null
  return (
    <>
      {depthSorted(doc, containerId, container.children).map((childId) => (
        <SpaceChild key={childId} doc={doc} id={childId} copy={copy} pxPerUnit={pxPerUnit} />
      ))}
    </>
  )
}

function SpaceChild({
  doc,
  id,
  copy,
  pxPerUnit,
}: {
  doc: DesignDocument
  id: NodeId
  copy: CopyMode
  pxPerUnit: number
}): ReactNode {
  const live = copy !== 'repeat'
  // Geometry only: this group has no matrix for LiveTransform to write — a
  // drag of this node re-renders the projection instead.
  const geomRef = useCallback(liveRef(geomKey(id), live), [id, live])
  const node = doc.nodes[id]
  if (!node || !node.visible) return null
  return (
    <g
      {...wrapperLook(node)}
      data-node-id={copy === 'primary' ? id : undefined}
      data-node-type={copy === 'primary' ? node.type : undefined}
      data-3d=""
      pointerEvents={node.locked ? 'none' : undefined}
    >
      {isPreserve3d(doc, id) ? (
        <SpaceChildren doc={doc} containerId={id} copy={copy} pxPerUnit={pxPerUnit} />
      ) : (
        <Plane doc={doc} node={node} copy={copy} geomRef={geomRef} pxPerUnit={pxPerUnit} />
      )}
    </g>
  )
}

/**
 * One flat picture, projected.
 *
 * The body is drawn once, flat, into <defs>; the mesh draws it again per
 * triangle. When the projection is affine — depth with no tilt — there is no
 * mesh: one transform is exact, and the body is drawn in place.
 *
 * The node's own shadow and blur are applied to the projected result rather
 * than inside the body, so they run once instead of once per triangle.
 */
function Plane({
  doc,
  node,
  copy,
  geomRef,
  pxPerUnit,
}: {
  doc: DesignDocument
  node: DesignNode
  copy: CopyMode
  geomRef: LiveRef
  pxPerUnit: number
}): ReactNode {
  const h = planeHomography(doc, node.id)
  const domain = planeDomain(doc, node, getLiveBox(node.id))
  // Keyed by VALUE: during any gesture this re-renders every frame with fresh
  // objects, and re-cutting a mesh that has not changed would be all waste.
  const key = `${h ? h.join(' ') : ''}|${domain.x} ${domain.y} ${domain.width} ${domain.height}|${pxPerUnit}`
  const mesh = useMemo(
    () => (h ? planeMesh(h, domain, pxPerUnit, CANVAS_MESH) : null),
    [key],
  )
  if (!h) return null

  const styled = hasStyle(node) ? node.style : null
  const fx = styled ? effectFilter(node.id, styled, node.transform) : null
  const body = <NodeBody node={node} copy={copy} geomRef={geomRef} />
  const fxDef = (region: Bounds) =>
    fx && (
      <filter
        id={fx.id}
        filterUnits="userSpaceOnUse"
        x={region.x}
        y={region.y}
        width={region.width}
        height={region.height}
        dangerouslySetInnerHTML={{ __html: fx.primitives }}
      />
    )

  if (!mesh) {
    // Depth alone scales about the pivot: exact, and the effect stays in the
    // node's own units exactly as it would for a flat node.
    return (
      <g transform={toSvgMatrix(mat3ToMat2D(h))}>
        {fx && <defs>{fxDef(fx)}</defs>}
        <g filter={fx ? `url(#${fx.id})` : undefined}>{body}</g>
      </g>
    )
  }

  const contentId = planeContentId(node.id)
  const pad = 2 / (pxPerUnit || 1)
  return (
    <>
      <defs>
        <g id={contentId}>{body}</g>
        {mesh.map((t, i) => {
          const r = triangleRegion(t, pad)
          return (
            <mask key={i} id={planeMaskId(node.id, i)} maskUnits="userSpaceOnUse" x={r.x} y={r.y} width={r.width} height={r.height}>
              <path d={trianglePath(t)} fill="#fff" shapeRendering="crispEdges" />
            </mask>
          )
        })}
        {fx && fxDef(projectedRegion(h, fx))}
      </defs>
      <g filter={fx ? `url(#${fx.id})` : undefined}>
        {mesh.map((t, i) => (
          <g key={i} mask={`url(#${planeMaskId(node.id, i)})`}>
            <use href={`#${contentId}`} transform={toSvgMatrix(t.matrix)} />
          </g>
        ))}
      </g>
    </>
  )
}

/** Renders the whole document. Mounted once by Canvas. */
export const DocumentLayer = memo(function DocumentLayer(): ReactNode {
  const rootChildren = useDocumentStore((s) => {
    const root = s.doc.nodes[s.doc.rootId]
    return root && 'children' in root ? root.children : undefined
  })
  const rootId = useDocumentStore((s) => s.doc.rootId)
  const svgDefs = useDocumentStore((s) => s.doc.svgDefs)
  if (!rootChildren) return null
  return (
    <g className="document-layer">
      <ImportedDefs defs={svgDefs} />
      <Children ids={rootChildren} parentId={rootId} />
    </g>
  )
})

/**
 * Paint servers carried in from imported SVG, emitted once for the document.
 *
 * A shape whose fill is `url(#p)` has nowhere of its own to keep the definition
 * it points at — and several shapes usually share one. Emitting them per node
 * would duplicate every id; emitting them here is what makes an imported
 * pattern or marker resolve on a perfectly ordinary rect node.
 *
 * The markup was sanitized on import and is re-sanitized on file load, so what
 * reaches innerHTML has been through the same gate either way.
 */
function ImportedDefs({ defs }: { defs: Record<string, string> | undefined }): ReactNode {
  const markup = useMemo(() => (defs ? Object.values(defs).join('') : ''), [defs])
  if (!markup) return null
  return <defs dangerouslySetInnerHTML={{ __html: markup }} />
}

export { cssFont }
export { clipKey, fxKey, geomKey }
