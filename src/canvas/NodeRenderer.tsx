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
import { toSvgMatrix } from '../geometry/Matrix'
import {
  ellipsePath,
  linePath,
  polygonStarPath,
  rectPath,
} from '../geometry/ShapeGeometry'
import { localMatrix } from '../document/SceneGraph'
import { useDocumentStore, useNode } from '../state/hooks'
import { liveTransform } from './LiveTransform'
import {
  dashArrayValue,
  gradientId,
  isGradient,
  paintToAttrs,
  sortedStops,
} from './paint'
import { toHex } from '../document/color'
import { hasStyle, repeatGridOffsets, repeatGridSize } from '../document/types'
import type {
  ArtboardNode,
  RepeatGridNode,
  DesignNode,
  GroupNode,
  ImageNode,
  NodeId,
  Paint,
  Style,
  SvgNode,
  TextNode,
} from '../document/types'
import { layoutText, lineOffsetX, cssFont } from '../text/TextLayout'
import { fontStack } from '../text/FontRegistry'

/** LiveTransform key for a node's geometry element (as opposed to its group). */
export const geomKey = (id: NodeId): string => `${id}::geom`

/**
 * Ref that registers an element under a LiveTransform key.
 *
 * Returns a cleanup (React 19 ref-cleanup form) so unmounting ONE element
 * detaches only that element — a bare `register(key, null)` would drop every
 * sibling sharing the key, which matters now that a shape's outline can be
 * drawn by a fill path, a stroke path and a clip or mask at once.
 */
function liveRef(key: string, enabled: boolean) {
  return (el: SVGElement | null) => {
    if (!enabled || !el) return undefined
    liveTransform.register(key, el)
    return () => liveTransform.unregister(key, el)
  }
}
/** LiveTransform key for an artboard's clip rect. */
export const clipKey = (id: NodeId): string => `${id}::clip`

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
  return paint.type === 'linear' ? (
    <linearGradient id={id} x1={paint.x1} y1={paint.y1} x2={paint.x2} y2={paint.y2}>
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
          fillOpacity={fill.opacity * style.fillOpacity}
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
        fillOpacity={fill.opacity * style.fillOpacity}
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
  const fill = paintToAttrs(node.style.fill, node.id, 'fill')
  const stroke = paintToAttrs(node.style.stroke.paint, node.id, 'stroke')
  const hasStroke = node.style.stroke.paint.type !== 'none' && node.style.stroke.width > 0

  const layout = useMemo(
    () =>
      layoutText(
        node.text,
        node.textStyle,
        node.textStyle.sizing === 'fixed' ? node.transform.width : undefined,
      ),
    [node.text, node.textStyle, node.transform.width],
  )

  const boxWidth = node.textStyle.sizing === 'fixed' ? node.transform.width : layout.width
  const decoration = [
    node.textStyle.underline ? 'underline' : '',
    node.textStyle.strikethrough ? 'line-through' : '',
  ].filter(Boolean).join(' ')

  return (
    <>
      <defs>
        <GradientDef paint={node.style.fill} id={gradientId(node.id, 'fill')} />
        <GradientDef paint={node.style.stroke.paint} id={gradientId(node.id, 'stroke')} />
      </defs>
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
        strokeWidth={hasStroke ? node.style.stroke.width : undefined}
        style={{ whiteSpace: 'pre' } as CSSProperties}
      >
        {layout.lines.map((line, i) => (
          <tspan
            key={i}
            x={lineOffsetX(line.width, boxWidth, node.textStyle.align)}
            y={line.baseline}
          >
            {line.text === '' ? ' ' : line.text}
          </tspan>
        ))}
      </text>
    </>
  )
}

function ImageBody({
  node,
  geomRef,
}: {
  node: ImageNode
  geomRef: (el: SVGElement | null) => (() => void) | undefined
}): ReactNode {
  const dataUrl = useDocumentStore((s) => s.doc.assets[node.assetId]?.dataUrl)
  const { width, height } = node.transform
  const clipId = `img-clip-${node.id}`

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
function RepeatGridBody({ node }: { node: RepeatGridNode }): ReactNode {
  const offsets = repeatGridOffsets(node)
  const size = repeatGridSize(node)
  const clipId = `rg-clip-${node.id}`

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
            {node.children.map((childId) => (
              // Cell 0 owns the live element refs; later cells are pure
              // repeats, so they must not re-register the same node id with
              // LiveTransform or a drag would write to whichever mounted last.
              <NodeRenderer key={childId} id={childId} repeat={i > 0} />
            ))}
          </g>
        ))}
      </g>
    </>
  )
}

function GroupBody({ node }: { node: GroupNode }): ReactNode {
  return (
    <>
      {node.children.map((childId) => (
        <NodeRenderer key={childId} id={childId} />
      ))}
    </>
  )
}

function ArtboardBody({ node }: { node: ArtboardNode }): ReactNode {
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
      <g clipPath={node.clipContent ? `url(#${clipId})` : undefined}>
        {node.children.map((childId) => (
          <NodeRenderer key={childId} id={childId} />
        ))}
      </g>
    </>
  )
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export const NodeRenderer = memo(function NodeRenderer({
  id,
  repeat = false,
}: {
  id: NodeId
  /** True for the 2nd..Nth copy inside a repeat grid — see RepeatGridBody. */
  repeat?: boolean
}): ReactNode {
  const node = useNode(id)

  const groupRef = useCallback(liveRef(id, !repeat), [id, repeat])
  const geomRef = useCallback(liveRef(geomKey(id), !repeat), [id, repeat])

  if (!node) return null
  // Hidden nodes are not rendered at all, which also makes them unclickable.
  if (!node.visible) return null

  const transform = toSvgMatrix(localMatrix(node.transform))
  const styled = hasStyle(node) ? node.style : null
  const opacity = styled?.opacity ?? 1
  const blend =
    styled && styled.blendMode !== 'normal'
      ? ({ mixBlendMode: styled.blendMode } as CSSProperties)
      : undefined

  let body: ReactNode
  switch (node.type) {
    case 'artboard':
      body = <ArtboardBody node={node} />
      break
    case 'group':
      body = <GroupBody node={node} />
      break
    case 'repeat-grid':
      body = <RepeatGridBody node={node} />
      break
    case 'text':
      body = <TextBody node={node} />
      break
    case 'image':
      body = <ImageBody node={node} geomRef={geomRef} />
      break
    case 'svg':
      body = <SvgBody node={node} />
      break
    case 'document':
      body = (
        <>
          {node.children.map((c) => (
            <NodeRenderer key={c} id={c} />
          ))}
        </>
      )
      break
    default:
      body = (
        <PaintedPath
          nodeId={id}
          style={node.style}
          d={shapePathData(node)}
          width={node.transform.width}
          height={node.transform.height}
          geomRef={geomRef}
        />
      )
  }

  return (
    <g
      ref={groupRef}
      transform={transform}
      opacity={opacity === 1 ? undefined : opacity}
      style={blend}
      data-node-id={repeat ? undefined : id}
      data-node-type={repeat ? undefined : node.type}
      // Locked nodes stay visible but must not swallow pointer events on canvas.
      pointerEvents={node.locked ? 'none' : undefined}
    >
      {body}
    </g>
  )
})

/** Renders the whole document. Mounted once by Canvas. */
export const DocumentLayer = memo(function DocumentLayer(): ReactNode {
  const rootChildren = useDocumentStore((s) => {
    const root = s.doc.nodes[s.doc.rootId]
    return root && 'children' in root ? root.children : undefined
  })
  if (!rootChildren) return null
  return (
    <g className="document-layer">
      {rootChildren.map((id) => (
        <NodeRenderer key={id} id={id} />
      ))}
    </g>
  )
})

export { cssFont }
