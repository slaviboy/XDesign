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
 * The right-hand property inspector.
 *
 * Every control here writes through to the document immediately — nothing is
 * decorative, and nothing needs an "apply" step. Multi-selection shows a shared
 * value where the objects agree and "Mixed" where they do not, and editing a
 * mixed field applies to all of them.
 *
 * Sizes are reported as EFFECTIVE size (width x |scaleX|). A single-node resize
 * changes width/height directly, while a multi-node resize scales the matrix, so
 * only the effective value is meaningful across both.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  alignSelection,
  distributeSelection,
  flipSelection,
  setCornerRadius,
  moveGuide,
  refitAutoHeight,
  removeGuide,
  setArtboardGrid,
  setBlur,
  setFill,
  setShadow,
  type ArtboardGridPatch,
  setMarkedForExport,
  setNodeTransform,
  setOpacity,
  setShapeParam,
  setStroke,
  setStyleProperty,
  setTextStyle,
  updateSettings,
  renameDocument,
  matchSize,
  setCornerRadiusAt,
} from '../history/Commands'
import { setRepeatGridParams } from '../history/RepeatGridCommands'
import { importTextIntoSelection } from '../app/textImport'
import {
  artboardOf, geometryBounds, localBox, localGeometryBounds, nodeLocalMatrix, worldMatrix,
} from '../document/SceneGraph'
import { applyToPoint, decompose, invert, multiply, type Mat2D, type Vec2 } from '../geometry/Matrix'
import { transformBounds, unionAll, type Bounds } from '../geometry/Bounds'
import { MAX_SIDES, MIN_SIDES } from '../geometry/ShapeGeometry'
import { getLiveMatrix, getLiveSize, usesIntrinsicSize } from '../tools/DragSession'
import { isGradient as isGradientPaint } from '../canvas/paint'
import { getLiveRadius } from '../tools/RadiusSession'
import { getLiveStarRatio } from '../tools/StarRatioSession'
import { toCss, toHex } from '../document/color'
import { fontsByCategory, isBundledFont, nearestWeight, preloadFamily } from '../text/FontRegistry'
import {
  clearGuideSelection,
  openDialog,
  saveDefaultGrid,
  setCornerRadiusMode,
  setEditor,
} from '../state/EditorStore'
import { liveGuide } from '../tools/GuideDrag'
import { t, type MessageKey } from '../i18n'
import { useLanguage } from '../state/hooks-i18n'
import { useDocument, useEditorStore, useLiveTransformTick, useSelectedNodes } from '../state/hooks'
import { IconSelect, NumberField, Section, Select, TextField, common, IconButton } from './primitives'
import { PaintPopover, PAINT_POPOVER_WIDTH } from './ColorPicker'
import { useEyedropper } from './eyedropper'
import {
  AlignBottomIcon, AlignCenterHIcon, AlignCenterVIcon, AlignLeftIcon, AlignRightIcon,
  AlignTopIcon, DistributeHIcon, DistributeVIcon, FlipHIcon, FlipVIcon,
  AutoHeightIcon, AutoWidthIcon, CornersIndependentIcon, CornersUniformIcon,
  EyedropperIcon, FixedSizeIcon, ImportIcon,
  LinkBracket, MatchHeightIcon, MatchSizeIcon, MatchWidthIcon,
  RotateIcon, TextAlignCenterIcon, TextAlignLeftIcon, TextAlignRightIcon,
  CapButtIcon, CapRoundIcon, CapSquareIcon,
  JoinBevelIcon, JoinMiterIcon, JoinRoundIcon,
  StrokeCenterIcon, StrokeInnerIcon, StrokeOuterIcon,
} from './icons'
import {
  BLUR_AMOUNT_MAX,
  BLUR_BRIGHTNESS_MAX,
  CORNER_ORDER,
  DEFAULT_BLUR,
  DEFAULT_LAYOUT_GRID,
  DEFAULT_SHADOW,
  DEFAULT_SQUARE_GRID,
  gutterForColumnWidth,
  layoutColumns,
  cornerRadiusOf,
  hasStyle,
  isContainer,
  isUniformCornerRadius,
  supportsCornerRadius,
  usesOwnBox,
  type ArtboardNode,
  type BlurEffect,
  type DesignDocument,
  type DesignNode,
  type Paint,
  type RGBA,
  type ShadowEffect,
  type Style,
  type TextSizing,
  type TextTransform,
} from '../document/types'

export function PropertyInspector() {
  const selected = useSelectedNodes()
  // The whole panel is text; one subscription at the top re-renders all of it.
  void useLanguage()
  const guide = useEditorStore((s) => s.selectedGuide)
  return (
    <div className="inspector-scroll">
      {guide ? (
        <GuideSection selected={guide} />
      ) : selected.length === 0 ? (
        <DocumentSection />
      ) : (
        <SelectionSections nodes={selected} />
      )}
    </div>
  )
}

/**
 * The selected guide's position, editable.
 *
 * One field, labelled for the axis the guide actually constrains — a vertical
 * guide has an X and no Y. The label scrubs like every other numeric field in
 * the panel, so a guide can be nudged without going back to the canvas.
 */
function GuideSection({ selected }: { selected: { artboardId: string; guideId: string } }) {
  const doc = useDocument()
  // A drag writes nothing until release, so the readout would sit frozen
  // through the gesture without this.
  useEditorStore((s) => s.overlayTick)
  const board = doc.nodes[selected.artboardId]
  const guide =
    board?.type === 'artboard' ? board.guides?.find((g) => g.id === selected.guideId) : undefined

  useEffect(() => {
    // The guide can be removed from the canvas while its section is open.
    if (!guide) clearGuideSelection()
  }, [guide])
  if (!board || board.type !== 'artboard' || !guide) return null

  const live = liveGuide()
  const position =
    live && live.guideId === guide.id && live.artboardId === board.id
      ? live.position
      : guide.position
  const extent = guide.axis === 'x' ? board.transform.width : board.transform.height

  return (
    <Section title={t('section.guide')}>
      <div className="multi-note">{guide.axis === 'x' ? t('label.vertical') : t('label.horizontal')} · {board.name}</div>
      <div className="field-row cols-3">
        <NumberField
          label={guide.axis.toUpperCase()}
          title={`Position on the ${guide.axis.toUpperCase()} axis, within the artboard`}
          value={round2(position)}
          min={0}
          max={extent}
          disabled={board.guidesLocked}
          onChange={(v, committing) =>
            moveGuide(
              board.id,
              guide.id,
              Math.min(extent, Math.max(0, v)),
              committing ? undefined : `guide:${guide.id}`,
            )
          }
        />
      </div>
      <div className="field-row" style={{ gridTemplateColumns: '1fr' }}>
        <button
          type="button"
          className="button"
          disabled={board.guidesLocked}
          onClick={() => removeGuide(board.id, guide.id)}
        >
          {t('label.deleteGuide')}
        </button>
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Nothing selected
// ---------------------------------------------------------------------------

function DocumentSection() {
  const doc = useDocument()
  const snapEnabled = useEditorStore((s) => s.snapEnabled)

  return (
    <>
      <Section title={t('section.document')}>
        <div className="field-row" style={{ gridTemplateColumns: '1fr' }}>
          <TextField label={t('label.name')} value={doc.name} onChange={renameDocument} />
        </div>
        <div className="multi-note">
          {t('document.counts', {
            objects: Object.keys(doc.nodes).length - 1,
            images: Object.keys(doc.assets).length,
          })}
        </div>
      </Section>

      {/* Named to distinguish it from an artboard's own grid, which is a
          different feature with different settings. */}
      <Section title={t('section.canvasGrid')}>
        <div className="multi-note">{t('note.canvasGrid')}</div>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={doc.settings.gridVisible}
            onChange={(e) => updateSettings({ gridVisible: e.target.checked })}
          />
          {t('label.showGrid')}
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={doc.settings.snapToGrid}
            onChange={(e) => updateSettings({ snapToGrid: e.target.checked })}
          />
          {t('label.snapToGrid')}
        </label>
        <div className="field-row">
          <NumberField
            label={t('label.size')}
            value={doc.settings.gridSize}
            min={1}
            max={500}
            precision={0}
            onChange={(v, committing) =>
              updateSettings({ gridSize: Math.round(v) }, committing ? undefined : 'grid-size')
            }
          />
        </div>
      </Section>

      <Section title={t('section.guidesSnapping')}>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={doc.settings.guidesVisible}
            onChange={(e) => updateSettings({ guidesVisible: e.target.checked })}
          />
          {t('label.showGuides')}
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={doc.settings.snapToObjects}
            onChange={(e) => updateSettings({ snapToObjects: e.target.checked })}
          />
          {t('label.snapToObjects')}
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={snapEnabled}
            onChange={(e) => setEditor({ snapEnabled: e.target.checked })}
          />
          {t('label.snappingEnabled')}
        </label>
      </Section>

      <div className="empty-state">
        Select an object to edit its properties.
        <br />
        Hold <span className="kbd">Space</span> to pan · <span className="kbd">⌘</span>+scroll to zoom
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

function SelectionSections({ nodes }: { nodes: DesignNode[] }) {
  const doc = useDocument()
  const multiple = nodes.length > 1
  // Drags never write to the store, so the readouts would sit frozen at the
  // pre-drag values without this: it re-renders on each LiveTransform flush and
  // the helpers below prefer the in-flight matrices when a gesture is running.
  const liveTick = useLiveTransformTick()
  const [aspectLocked, setAspectLocked] = useState(false)
  const aspectRatioRef = useRef<number | null>(null)
  const styled = nodes.filter(hasStyle)

  // World-space geometry, so the readout matches what is on screen even for a
  // node nested inside a transformed group. During a gesture the live matrix
  // wins, which is what makes the fields track a drag in real time.
  const bounds = useMemo(
    () => (nodes.length ? liveBounds(doc, nodes[0]!) : null),
    // liveTick participates: mid-drag the document has not changed, and the
    // tick is the only signal that the live values moved.
    [doc, nodes, liveTick],
  )

  const rotation = useMemo(
    () =>
      common(nodes, (n) =>
        round2(decompose(getLiveMatrix(n.id) ?? worldMatrix(doc, n.id)).rotation),
      ),
    [doc, nodes, liveTick],
  )

  const effectiveW = common(nodes, (n) => round2(liveEffectiveSize(doc, n).width))
  const effectiveH = common(nodes, (n) => round2(liveEffectiveSize(doc, n).height))
  // X and Y are measured from the artboard the object sits on, not from the
  // canvas origin. An object 100 from its artboard's left edge reads 100
  // wherever that artboard is moved to, which is what makes the number mean
  // anything: tied to the global canvas it changed every time the artboard did,
  // while the object had not moved at all.
  const frameOrigin = useMemo(
    () => (multiple ? { x: 0, y: 0 } : artboardOrigin(doc, nodes[0])),
    [doc, nodes, multiple, liveTick],
  )
  const x = multiple ? null : round2((bounds?.x ?? 0) - frameOrigin.x)
  const y = multiple ? null : round2((bounds?.y ?? 0) - frameOrigin.y)

  // The edit is a delta, so it does not care which frame the number was in as
  // long as the reference matches what was displayed.
  const applyX = (value: number) => {
    const node = nodes[0]
    if (!node || !bounds) return
    const shown = bounds.x - frameOrigin.x
    setNodeTransform(node.id, { x: node.transform.x + (value - shown) }, `x:${node.id}`)
  }
  const applyY = (value: number) => {
    const node = nodes[0]
    if (!node || !bounds) return
    const shown = bounds.y - frameOrigin.y
    setNodeTransform(node.id, { y: node.transform.y + (value - shown) }, `y:${node.id}`)
  }
  const applySize = (key: 'width' | 'height', value: number) => {
    for (const node of nodes) {
      const scale = Math.abs(key === 'width' ? node.transform.scaleX : node.transform.scaleY) || 1
      setNodeTransform(node.id, { [key]: Math.max(0.5, value / scale) }, `${key}:${node.id}`)
    }
    // A narrower Auto Height box wraps differently and is therefore taller.
    if (key === 'width') refitAutoHeight(nodes.map((n) => n.id))
  }

  // The ratio is captured at the MOMENT the lock is engaged (or the selection
  // changes) and then held. Recomputing it from the live W/H on every render
  // would feed each rounded result into the next ratio, so proportions visibly
  // drift as you type. Latest sizes are kept in a ref so the capture can read
  // them without making them dependencies.
  const selectionKey = nodes.map((n) => n.id).join(',')
  const liveSizeRef = useRef({ w: effectiveW, h: effectiveH })
  liveSizeRef.current = { w: effectiveW, h: effectiveH }

  useEffect(() => {
    const { w, h } = liveSizeRef.current
    aspectRatioRef.current = aspectLocked && w && h ? w / h : null
  }, [aspectLocked, selectionKey])

  const applyWidth = (value: number) => {
    applySize('width', value)
    const ratio = aspectRatioRef.current
    if (ratio) applySize('height', Math.max(0.5, value / ratio))
  }
  const applyHeight = (value: number) => {
    applySize('height', value)
    const ratio = aspectRatioRef.current
    if (ratio) applySize('width', Math.max(0.5, value * ratio))
  }

  return (
    <>
      <div className="selection-name" title={multiple ? undefined : nodes[0]!.name}>
        <span className="truncate">{multiple ? `${nodes.length} objects selected` : nodes[0]!.name}</span>
      </div>

      <Section title={t('section.transform')}>
        <div className="transform-grid">
          <NumberField className="tf-w" label="W" value={effectiveW} min={0.5} onChange={(v) => applyWidth(v)} scrubStep={0.5} />
          <button
            type="button"
            className={`aspect-lock${aspectLocked ? ' locked' : ''}`}
            aria-label={aspectLocked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
            aria-pressed={aspectLocked}
            data-testid="aspect-lock"
            title={aspectLocked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
            onClick={() => setAspectLocked((v) => !v)}
          >
            <LinkBracket locked={aspectLocked} />
          </button>
          <NumberField className="tf-x" label="X" value={x} onChange={applyX} scrubStep={0.5} />
          <NumberField
            className="tf-rot"
            label={<RotateIcon size={13} />}
            title="Rotation"
            value={rotation}
            suffix="°"
            scrubStep={0.5}
            onChange={(v, committing) => {
              for (const node of nodes) {
                setNodeTransform(node.id, { rotation: v }, committing ? undefined : `rot:${node.id}`)
              }
            }}
          />

          <NumberField className="tf-h" label="H" value={effectiveH} min={0.5} onChange={(v) => applyHeight(v)} scrubStep={0.5} />
          <NumberField className="tf-y" label="Y" value={y} onChange={applyY} scrubStep={0.5} />
        </div>

        <div className="transform-actions">
          <IconButton icon={<FlipHIcon />} label="Flip horizontal" onClick={() => flipSelection('h')} />
          <IconButton icon={<FlipVIcon />} label="Flip vertical" onClick={() => flipSelection('v')} />
          <span className="transform-actions-gap" />
          <IconButton
            icon={<MatchWidthIcon />}
            label="Match width"
            disabled={!multiple}
            onClick={() => matchSize('width')}
          />
          <IconButton
            icon={<MatchHeightIcon />}
            label="Match height"
            disabled={!multiple}
            onClick={() => matchSize('height')}
          />
          <IconButton
            icon={<MatchSizeIcon />}
            label="Match size"
            disabled={!multiple}
            onClick={() => matchSize('both')}
          />
        </div>
      </Section>

      <Section title={t('section.align')}>
        <div className="icon-row">
          <IconButton icon={<AlignLeftIcon />} label="Align left" onClick={() => alignSelection('left')} />
          <IconButton icon={<AlignCenterHIcon />} label="Align center" onClick={() => alignSelection('center-h')} />
          <IconButton icon={<AlignRightIcon />} label="Align right" onClick={() => alignSelection('right')} />
          <IconButton icon={<AlignTopIcon />} label="Align top" onClick={() => alignSelection('top')} />
          <IconButton icon={<AlignCenterVIcon />} label="Align middle" onClick={() => alignSelection('center-v')} />
          <IconButton icon={<AlignBottomIcon />} label="Align bottom" onClick={() => alignSelection('bottom')} />
          <IconButton
            icon={<DistributeHIcon />}
            label="Distribute horizontally"
            disabled={nodes.length < 3}
            onClick={() => distributeSelection('horizontal')}
          />
          <IconButton
            icon={<DistributeVIcon />}
            label="Distribute vertically"
            disabled={nodes.length < 3}
            onClick={() => distributeSelection('vertical')}
          />
        </div>
      </Section>

      {styled.length > 0 && <AppearanceSection nodes={styled} />}
      <ArtboardSection nodes={nodes} />
      <RepeatGridSection nodes={nodes} />
      <ShapeSection nodes={nodes} />
      <TextSection nodes={nodes} />
      <ExportSection nodes={nodes} />
    </>
  )
}

/**
 * geometryBounds with the node's world matrix injected.
 *
 * This is a deliberate mirror of SceneGraph.geometryBounds, recursion included,
 * differing only in where the matrix comes from — which is the whole point: an
 * in-flight gesture has a world matrix the document does not know about yet.
 *
 * The container branch is not an optimization. A group's bounds are its
 * children's, not its own nominal box, which `groupNodes` writes once and never
 * refits. Reading that box mid-drag while the committed value came from the
 * children made X/Y jump the moment a group was touched and jump back on
 * release. Unioning in world space rather than in the group's own space matters
 * too, because AABB(M . union) is not union(AABB(M . box)) once anything is
 * rotated.
 */
function boundsWithWorld(doc: DesignDocument, node: DesignNode, world: Mat2D): Bounds {
  if (isContainer(node) && !usesOwnBox(node)) {
    const kids: Bounds[] = []
    for (const id of node.children) {
      const child = doc.nodes[id]
      if (!child) continue
      const b = boundsWithWorld(doc, child, multiply(world, nodeLocalMatrix(child)))
      if (b.width > 0 || b.height > 0) kids.push(b)
    }
    return kids.length ? unionAll(kids) : transformBounds(localBox(node), world)
  }
  return transformBounds(localGeometryBounds(node), world)
}

/**
 * The node's live matrix re-expressed in its PARENT's space.
 *
 * DragSession publishes world matrices, but everything the inspector shows is
 * local — it is what commitDrag writes back and what the fields edit — so the
 * ancestor chain has to be divided out. Decomposing the world matrix instead
 * made W/H jump by the enclosing group's scale the moment a drag began.
 */
function liveLocalMatrix(doc: DesignDocument, node: DesignNode): Mat2D | null {
  const live = getLiveMatrix(node.id)
  if (!live) return null
  if (!node.parentId) return live
  // An ancestor can be in the same gesture (select a group and a node inside
  // it); its live matrix is then the truthful parent, not the stored one.
  const parentWorld = getLiveMatrix(node.parentId) ?? worldMatrix(doc, node.parentId)
  return multiply(invert(parentWorld), live)
}

/**
 * How much an in-flight resize has scaled the node's local geometry.
 *
 * `null` when nothing is being resized, and also when the node's drawn geometry
 * does not follow its intrinsic box — a group keeps its children at their own
 * sizes during a resize, so scaling its readout would report a size that is not
 * on the canvas.
 */
function liveGeometryScale(node: DesignNode): { kx: number; ky: number } | null {
  const size = getLiveSize(node.id)
  if (!size || !usesIntrinsicSize(node.type)) return null
  return {
    kx: node.transform.width > 0 ? size.width / node.transform.width : 1,
    ky: node.transform.height > 0 ? size.height / node.transform.height : 1,
  }
}

/**
 * The world position of the top-left corner of the artboard a node sits on.
 *
 * Zero for a node on the bare pasteboard, and zero for an artboard itself —
 * an artboard is positioned on the canvas, so its own X and Y are canvas
 * coordinates and reading them relative to itself would always say 0,0.
 *
 * The corner is the local origin put through the artboard's matrix rather than
 * the corner of its bounding box, so a rotated artboard still measures from the
 * corner its contents are laid out from.
 */
function artboardOrigin(doc: DesignDocument, node: DesignNode | undefined): Vec2 {
  if (!node) return { x: 0, y: 0 }
  const board = artboardOf(doc, node.id)
  if (!board || board === node.id) return { x: 0, y: 0 }
  const live = getLiveMatrix(board)
  return applyToPoint(live ?? worldMatrix(doc, board), { x: 0, y: 0 })
}

/**
 * Bounds that follow an in-flight drag.
 *
 * Falls back to the document whenever no gesture is running, so this is the
 * single readout path rather than a special case bolted on beside one.
 */
function liveBounds(doc: DesignDocument, node: DesignNode): Bounds {
  const live = getLiveMatrix(node.id)
  if (!live) return geometryBounds(doc, node.id)

  const k = liveGeometryScale(node)
  if (!k) return boundsWithWorld(doc, node, live)

  // A resize scales the local geometry about the local ORIGIN, not about the
  // geometry's own bbox corner — which is exactly what livePathData draws — so
  // the offset scales with it. Assuming the bbox started at (0,0) put X/Y adrift
  // for any path whose data had drifted off the origin. Only nodes whose drawn
  // geometry follows the intrinsic box reach here, so this is never a container.
  const base = localGeometryBounds(node)
  return transformBounds(
    { x: base.x * k.kx, y: base.y * k.ky, width: base.width * k.kx, height: base.height * k.ky },
    live,
  )
}

/**
 * Effective size (intrinsic x |scale|), preferring live values.
 *
 * The three cases differ: a single-node resize writes a new INTRINSIC size and
 * leaves the scale untouched, a multi-node resize instead scales the matrix,
 * and a move or rotate changes neither — so the scale has to come from the live
 * matrix when there is one. Returning the intrinsic size raw understated W/H by
 * the node's own scale for the whole of every single-node resize.
 */
function liveEffectiveSize(
  doc: DesignDocument,
  node: DesignNode,
): { width: number; height: number } {
  const scaleX = Math.abs(node.transform.scaleX)
  const scaleY = Math.abs(node.transform.scaleY)

  const size = getLiveSize(node.id)
  if (size) return { width: size.width * scaleX, height: size.height * scaleY }

  const local = liveLocalMatrix(doc, node)
  if (local) {
    const d = decompose(local)
    return {
      width: node.transform.width * Math.abs(d.scaleX),
      height: node.transform.height * Math.abs(d.scaleY),
    }
  }
  return { width: node.transform.width * scaleX, height: node.transform.height * scaleY }
}

// ---------------------------------------------------------------------------
// Appearance
// ---------------------------------------------------------------------------

/**
 * The three stroke dropdowns, each option carrying the icon that draws it.
 *
 * Adobe's names, not SVG's: XD calls a square cap "Projecting" and centre
 * alignment "Center", and those are what the panel says. The stored values stay
 * the SVG ones, so nothing downstream has to translate.
 */
const CAP_OPTIONS: Array<{ value: Style['stroke']['cap']; label: string; icon: ReactNode }> = [
  { value: 'butt', label: 'Butt', icon: <CapButtIcon /> },
  { value: 'round', label: 'Round', icon: <CapRoundIcon /> },
  { value: 'square', label: 'Projecting', icon: <CapSquareIcon /> },
]

const JOIN_OPTIONS: Array<{ value: Style['stroke']['join']; label: string; icon: ReactNode }> = [
  { value: 'miter', label: 'Miter', icon: <JoinMiterIcon /> },
  { value: 'round', label: 'Round', icon: <JoinRoundIcon /> },
  { value: 'bevel', label: 'Bevel', icon: <JoinBevelIcon /> },
]

const ALIGN_OPTIONS: Array<{ value: Style['stroke']['align']; label: string; icon: ReactNode }> = [
  { value: 'inner', label: 'Inside', icon: <StrokeInnerIcon /> },
  { value: 'outer', label: 'Outside', icon: <StrokeOuterIcon /> },
  { value: 'center', label: 'Center', icon: <StrokeCenterIcon /> },
]

function AppearanceSection({ nodes }: { nodes: Array<DesignNode & { style: Style }> }) {
  const [popover, setPopover] = useState<{
    target: 'fill' | 'stroke' | 'shadow'
    x: number
    y: number
  } | null>(null)

  const fill = common(nodes, (n) => paintKey(n.style.fill))
  const strokePaint = common(nodes, (n) => paintKey(n.style.stroke.paint))
  const opacity = common(nodes, (n) => Math.round(n.style.opacity * 100))
  const strokeWidth = common(nodes, (n) => n.style.stroke.width)
  const cap = common(nodes, (n) => n.style.stroke.cap)
  const join = common(nodes, (n) => n.style.stroke.join)
  const align = common(nodes, (n) => n.style.stroke.align)
  const blend = common(nodes, (n) => n.style.blendMode)
  const dash = common(nodes, (n) => n.style.stroke.dashArray.join(' '))

  const first = nodes[0]!
  const shadow = first.style.shadow
  const blur = first.style.blur
  const currentPaint: Paint =
    popover?.target === 'stroke'
      ? first.style.stroke.paint
      : popover?.target === 'shadow'
        ? { type: 'solid', color: shadow?.color ?? DEFAULT_SHADOW.color }
        : first.style.fill

  // The on-canvas gradient handles are part of the picker, as Adobe lists them:
  // they appear when it opens and go when it closes, and this is also what tells
  // the overlay whether it is editing the fill's gradient or the stroke's.
  const gradientNodeId = popover && isGradientPaint(currentPaint) ? first.id : null
  // A shadow's colour is never a gradient, so the widget only ever edits the
  // fill's or the stroke's.
  const gradientTarget = popover?.target === 'stroke' ? 'stroke' : 'fill'
  useEffect(() => {
    setEditor({
      gradientEditing: gradientNodeId ? { nodeId: gradientNodeId, target: gradientTarget } : null,
      // Cleared alongside, or a stale id would outlive the widget and Delete
      // would go looking for a stop that is no longer on screen.
      activeGradientStop: null,
    })
    return () => setEditor({ gradientEditing: null, activeGradientStop: null })
  }, [gradientNodeId, gradientTarget])

  // Unchecking a paint sets it to `none`, which is what "no fill" means in the
  // model — but `none` carries no colour, so the last real paint is remembered
  // here and put back when it is checked again. A ref, not state: it must not
  // cause a render, and it is a convenience rather than document data.
  const lastPaint = useRef<{ fill: Paint | null; stroke: Paint | null }>({ fill: null, stroke: null })
  const fillOn = first.style.fill.type !== 'none'
  const strokeOn = first.style.stroke.paint.type !== 'none'
  if (fillOn) lastPaint.current.fill = first.style.fill
  if (strokeOn) lastPaint.current.stroke = first.style.stroke.paint

  const togglePaint = useCallback((target: 'fill' | 'stroke', on: boolean) => {
    const restored: Paint = on
      ? (lastPaint.current[target] ?? {
          type: 'solid',
          color: target === 'fill' ? { r: 217, g: 217, b: 217, a: 1 } : { r: 0, g: 0, b: 0, a: 1 },
        })
      : { type: 'none' }
    if (target === 'fill') setFill(restored)
    else setStroke({ paint: restored })
  }, [])

  const fillDropper = useEyedropper(
    useCallback((color: RGBA, committing: boolean) => {
      setFill({ type: 'solid', color }, committing ? undefined : 'paint:fill')
    }, []),
  )
  const strokeDropper = useEyedropper(
    useCallback((color: RGBA, committing: boolean) => {
      setStroke({ paint: { type: 'solid', color } }, committing ? undefined : 'paint:stroke')
    }, []),
  )

  const openPicker = useCallback((target: 'fill' | 'stroke' | 'shadow', e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    // Flip left of the swatch; the width comes from the popover itself so the
    // two cannot drift apart.
    setPopover({ target, x: rect.left - (PAINT_POPOVER_WIDTH + 10), y: rect.top })
  }, [])

  return (
    <>
      <Section title={t('section.fill')}>
        <div className="paint-row">
          <PaintToggle
            on={fillOn}
            label="Fill"
            onChange={(on) => togglePaint('fill', on)}
          />
          <Swatch paint={fill === null ? null : first.style.fill} onClick={(e) => openPicker('fill', e)} />
          <div className="field">
            <span className="field-label">%</span>
            <input
              type="text"
              value={opacity === null ? '' : String(opacity)}
              placeholder={opacity === null ? 'Mixed' : undefined}
              onKeyDown={(e) => e.stopPropagation()}
              onChange={(e) => {
                const v = Number.parseFloat(e.target.value)
                if (Number.isFinite(v)) setOpacity(v / 100)
              }}
            />
          </div>
          <DropperButton control={fillDropper} label="Pick a fill color from the canvas" />
        </div>
        {/* Hidden while the fill is off: none of it applies to a shape with no
            fill, and leaving it there invites edits that do nothing. */}
        {fillOn && (
          <div className="field-row" style={{ gridTemplateColumns: '1fr' }}>
            <Select
              value={blend ?? 'normal'}
              options={BLEND_MODES.map((m) => ({ value: m, label: titleCase(m) }))}
              onChange={(v) => setStyleProperty('blendMode', v as Style['blendMode'])}
              title="Blend mode"
            />
          </div>
        )}
      </Section>

      <Section title={t('section.stroke')}>
        <div className="paint-row">
          <PaintToggle
            on={strokeOn}
            label="Stroke"
            onChange={(on) => togglePaint('stroke', on)}
          />
          <Swatch
            paint={strokePaint === null ? null : first.style.stroke.paint}
            onClick={(e) => openPicker('stroke', e)}
          />
          <NumberField
            label="W"
            value={strokeWidth}
            min={0}
            step={0.5}
            onChange={(v, committing) => setStroke({ width: v }, committing ? undefined : 'stroke-w')}
          />
          <DropperButton control={strokeDropper} label="Pick a stroke color from the canvas" />
        </div>
        {strokeOn && (
        <><div className="field-row cols-3">
          <IconSelect
            value={cap ?? 'butt'}
            options={CAP_OPTIONS}
            onChange={(v) => setStroke({ cap: v })}
            title="Line cap"
          />
          <IconSelect
            value={join ?? 'miter'}
            options={JOIN_OPTIONS}
            onChange={(v) => setStroke({ join: v })}
            title="Line join"
          />
          <IconSelect
            value={align ?? 'center'}
            options={ALIGN_OPTIONS}
            onChange={(v) => setStroke({ align: v })}
            title="Stroke alignment"
          />
        </div>
        <div className="field-row">
          <TextField
            label="Dash"
            value={dash ?? ''}
            placeholder="e.g. 4 2"
            onChange={(v) =>
              setStroke({
                dashArray: v.split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n) && n >= 0),
              })
            }
          />
          <NumberField
            label="Off"
            value={common(nodes, (n) => n.style.stroke.dashOffset)}
            onChange={(v, committing) => setStroke({ dashOffset: v }, committing ? undefined : 'dash-off')}
          />
        </div></>
        )}
      </Section>


      {/* Adobe: "click Drop Shadow or Inner Shadow in the Property Inspector",
          and the checkbox next to it turns the effect off without losing it. */}
      <Section title={t('section.shadow')}>
        <div className="paint-row">
          <PaintToggle
            on={!!shadow?.visible}
            label="Shadow"
            onChange={(on) =>
              shadow ? setShadow({ visible: on }) : setShadow({ ...DEFAULT_SHADOW, visible: on })
            }
          />
          <Select
            value={shadow?.kind ?? 'drop'}
            options={[
              { value: 'drop', label: 'Drop Shadow' },
              { value: 'inner', label: 'Inner Shadow' },
            ]}
            onChange={(v) => setShadow({ kind: v as ShadowEffect['kind'], visible: true })}
            title="Shadow type"
          />
          <Swatch
            paint={{ type: 'solid', color: shadow?.color ?? DEFAULT_SHADOW.color }}
            onClick={(e) => openPicker('shadow', e)}
          />
        </div>
        {shadow?.visible && (
          <div className="field-row cols-3">
            <NumberField
              label="X"
              value={common(nodes, (n) => n.style.shadow?.x ?? 0)}
              onChange={(v, committing) => setShadow({ x: v }, committing ? undefined : 'shadow-x')}
            />
            <NumberField
              label="Y"
              value={common(nodes, (n) => n.style.shadow?.y ?? 0)}
              onChange={(v, committing) => setShadow({ y: v }, committing ? undefined : 'shadow-y')}
            />
            <NumberField
              label="B"
              title="Blur"
              min={0}
              value={common(nodes, (n) => n.style.shadow?.blur ?? 0)}
              onChange={(v, committing) => setShadow({ blur: v }, committing ? undefined : 'shadow-b')}
            />
          </div>
        )}
      </Section>

      {/* Adobe's two blurs share one section, as they share one dropdown in XD:
          an object blur blurs the shape, a background blur blurs what is behind
          it. Brightness and Opacity belong to the background one alone — Adobe:
          "Ignored for object blur effects." */}
      <Section title={t('section.blur')}>
        <div className="paint-row">
          <PaintToggle
            on={!!blur?.visible}
            label="Blur"
            onChange={(on) =>
              blur ? setBlur({ visible: on }) : setBlur({ ...DEFAULT_BLUR, visible: on })
            }
          />
          <Select
            value={blur?.kind ?? DEFAULT_BLUR.kind}
            options={[
              { value: 'background', label: 'Background Blur' },
              { value: 'object', label: 'Object Blur' },
            ]}
            onChange={(v) => setBlur({ kind: v as BlurEffect['kind'], visible: true })}
            title="Blur type"
          />
        </div>
        {blur?.visible && (
          <>
            <SliderRow
              label="Amount"
              value={common(nodes, (n) => n.style.blur?.amount ?? 0)}
              min={0}
              max={BLUR_AMOUNT_MAX}
              onChange={(v, committing) => setBlur({ amount: v }, committing ? undefined : 'blur-a')}
            />
            {blur.kind === 'background' && (
              <>
                <SliderRow
                  label="Brightness"
                  value={common(nodes, (n) => n.style.blur?.brightness ?? 0)}
                  min={-BLUR_BRIGHTNESS_MAX}
                  max={BLUR_BRIGHTNESS_MAX}
                  onChange={(v, committing) =>
                    setBlur({ brightness: v }, committing ? undefined : 'blur-br')
                  }
                />
                <SliderRow
                  label="Opacity"
                  value={common(nodes, (n) => Math.round((n.style.blur?.fillOpacity ?? 1) * 100))}
                  min={0}
                  max={100}
                  onChange={(v, committing) =>
                    setBlur({ fillOpacity: v / 100 }, committing ? undefined : 'blur-o')
                  }
                />
              </>
            )}
          </>
        )}
      </Section>

      {popover && (
        <PaintPopover
          paint={currentPaint}
          anchor={{ x: popover.x, y: popover.y }}
          // A shadow has a colour, not a paint: Adobe's Shadow takes a Color,
          // and a gradient shadow is not a thing in XD or in SVG's feDropShadow.
          allowGradient={popover.target !== 'shadow'}
          onChange={(paint, committing) => {
            const key = committing ? undefined : `paint:${popover.target}`
            if (popover.target === 'fill') setFill(paint, key)
            else if (popover.target === 'stroke') setStroke({ paint }, key)
            else if (paint.type === 'solid') setShadow({ color: paint.color }, key)
          }}
          onClose={() => setPopover(null)}
        />
      )}
    </>
  )
}

/**
 * A named slider with its value beside it — the shape Adobe's blur controls
 * take. The number field is not decoration: a slider alone cannot be set
 * exactly, and every other value in this panel can be typed.
 */
function SliderRow({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number | null
  min: number
  max: number
  onChange: (value: number, committing: boolean) => void
}) {
  return (
    <div className="slider-row">
      <span className="slider-row-label">{label}</span>
      <input
        type="range"
        className="effect-slider"
        aria-label={label}
        min={min}
        max={max}
        step={1}
        value={value ?? min}
        onKeyDown={(e) => e.stopPropagation()}
        // Dragging streams under one coalesce key and commits on release, so a
        // whole drag is one undo entry rather than one per pixel.
        onChange={(e) => onChange(Number(e.target.value), false)}
        onPointerUp={(e) => onChange(Number((e.target as HTMLInputElement).value), true)}
      />
      <NumberField value={value} min={min} max={max} onChange={onChange} title={label} />
    </div>
  )
}

/**
 * The on/off box in front of a paint.
 *
 * Off IS `none` in the model — there is no separate enabled flag — so this is a
 * view onto the paint's type rather than state of its own.
 */
function PaintToggle({
  on,
  label,
  onChange,
}: {
  on: boolean
  label: string
  onChange: (on: boolean) => void
}) {
  return (
    <input
      type="checkbox"
      className="paint-toggle"
      checked={on}
      aria-label={`${label} enabled`}
      title={on ? `Turn ${label.toLowerCase()} off` : `Turn ${label.toLowerCase()} on`}
      onChange={(e) => onChange(e.target.checked)}
    />
  )
}

/** Arms the canvas eyedropper for one paint target. */
function DropperButton({
  control,
  label,
}: {
  control: ReturnType<typeof useEyedropper>
  label: string
}) {
  return (
    <button
      type="button"
      className={`icon-button${control.armed ? ' active' : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={control.armed}
      disabled={control.arming}
      onClick={control.toggle}
    >
      <EyedropperIcon />
    </button>
  )
}

function Swatch({ paint, onClick }: { paint: Paint | null; onClick: (e: React.MouseEvent) => void }) {
  const background = !paint
    ? 'repeating-linear-gradient(45deg, var(--checker) 0 4px, var(--checker-bg) 4px 8px)'
    : paint.type === 'solid'
      ? toCss(paint.color)
      : paint.type === 'linear'
        ? `linear-gradient(to right, ${paint.stops.map((s) => toCss(s.color)).join(', ')})`
        : paint.type === 'radial'
          ? `radial-gradient(circle, ${paint.stops.map((s) => toCss(s.color)).join(', ')})`
          : paint.type === 'angular'
            // CSS has a conic gradient even though SVG does not, so the chip can
            // show the real thing. CSS starts at 12 o'clock, SVG angles at 3.
            ? `conic-gradient(from ${paint.rotation + 90}deg, ${paint.stops.map((s) => toCss(s.color)).join(', ')})`
          : paint.type === 'ref'
            ? 'repeating-linear-gradient(45deg, var(--checker) 0 3px, var(--checker-bg) 3px 6px)'
            : 'transparent'

  const title = !paint ? 'Mixed' : paint.type === 'solid' ? toHex(paint.color) : titleCase(paint.type)

  return (
    <button
      type="button"
      className="swatch"
      onClick={onClick}
      title={title}
      aria-label={`Edit ${title}`}
    >
      <span className="swatch-fill" style={{ background }} />
      {paint?.type === 'none' && (
        <svg viewBox="0 0 20 20" style={{ position: 'absolute', inset: 0 }}>
          <line x1="2" y1="18" x2="18" y2="2" style={{ stroke: 'var(--error)' }} strokeWidth="1.5" />
        </svg>
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Shape-specific
// ---------------------------------------------------------------------------

/**
 * Corner radius, with the two-mode control from Adobe XD.
 *
 * The first button edits all four corners together and shows one field; the
 * second unlocks them and shows four. The mode is explicit but DEFAULTS to
 * whatever the data implies — a box whose corners already differ opens in
 * independent mode rather than silently flattening them on the first edit.
 *
 * Only boxes have addressable corners. Triangles, polygons and stars carry a
 * single scalar, so they never show the toggle.
 */
function CornerRadiusRow({ nodes }: { nodes: DesignNode[] }) {
  const boxes = nodes.filter((n) => n.type === 'rect' || n.type === 'image')
  const modeOverride = useEditorStore((s) => s.cornerRadiusMode)

  const dataIsUniform = boxes.every(
    (n) => n.type !== 'rect' && n.type !== 'image' ? true : isUniformCornerRadius(n.cornerRadius),
  )
  const canSplit = boxes.length > 0 && boxes.length === nodes.length
  const independent = canSplit && (modeOverride ?? (dataIsUniform ? 'uniform' : 'independent')) === 'independent'

  const uniformValue = common(nodes, (n) =>
    round2(getLiveRadius(n.id) ?? cornerRadiusOf(n)),
  )

  return (
    <div className="corner-radius-row">
      {canSplit && (
        <div className="corner-mode-toggle" role="group" aria-label="Corner radius mode">
          <button
            type="button"
            className={`icon-button${independent ? '' : ' active'}`}
            aria-label="Edit all corners together"
            aria-pressed={!independent}
            data-testid="corners-uniform"
            title="Edit all corners together"
            onClick={() => setCornerRadiusMode('uniform')}
          >
            <CornersUniformIcon size={14} />
          </button>
          <button
            type="button"
            className={`icon-button${independent ? ' active' : ''}`}
            aria-label="Edit corners independently"
            aria-pressed={independent}
            data-testid="corners-independent"
            title="Edit corners independently"
            onClick={() => setCornerRadiusMode('independent')}
          >
            <CornersIndependentIcon size={14} />
          </button>
        </div>
      )}

      {independent ? (
        <div className="corner-fields">
          {CORNER_ORDER.map((corner) => (
            <NumberField
              key={corner}
              className={`tf-corner tf-corner-${corner}`}
              // Labelled so each corner gets a scrub handle of its own; which
              // corner it is lives in the title, and in where it sits.
              label="R"
              title={CORNER_LABELS[corner]}
              value={common(boxes, (n) =>
                round2(getLiveRadius(n.id, corner) ?? cornerRadiusOf(n, corner)),
              )}
              min={0}
              onChange={(v, committing) =>
                setCornerRadiusAt(corner, v, committing ? undefined : `radius:${corner}`)
              }
            />
          ))}
        </div>
      ) : (
        <NumberField
          className="tf-corner-all"
          // A label, not the bare field it used to be: dragging the label is how
          // every other numeric field in the inspector is scrubbed, and without
          // one the radius was the only value you had to type.
          label="R"
          title="Corner radius"
          value={uniformValue}
          min={0}
          onChange={(v, committing) => setCornerRadius(v, committing ? undefined : 'radius')}
        />
      )}
    </div>
  )
}

const CORNER_LABELS: Record<(typeof CORNER_ORDER)[number], string> = {
  nw: 'Top left corner radius',
  ne: 'Top right corner radius',
  se: 'Bottom right corner radius',
  sw: 'Bottom left corner radius',
}

/**
 * The Grid section for a selected artboard — Adobe: "select one or more
 * artboards. Navigate to the Grid section in the Property Inspector and choose
 * either Layout or Square."
 *
 * Column width is shown but not editable, because it is not stored: it falls
 * out of the artboard's width, the column count, the gutter and the margins.
 * That is exactly how Adobe keeps the grid "within the bounds of artboard" —
 * there is no width to author that could fail to fit.
 */
function ArtboardSection({ nodes }: { nodes: DesignNode[] }) {
  const [picking, setPicking] = useState<{ x: number; y: number } | null>(null)
  const boards = nodes.filter((n): n is ArtboardNode => n.type === 'artboard')
  if (boards.length === 0) return null

  const ids = boards.map((b) => b.id)
  const first = boards[0]!
  const grid = first.grid
  const kind = grid?.type ?? 'square'
  const on = !!grid?.visible
  const color = grid?.color ?? (kind === 'square' ? DEFAULT_SQUARE_GRID.color : DEFAULT_LAYOUT_GRID.color)
  const width = first.transform.width
  const columns = grid?.type === 'layout' ? layoutColumns(width, grid) : []

  const set = (patch: ArtboardGridPatch, key?: string) => setArtboardGrid(ids, patch, key)

  return (
    <>
      <Section title={t('section.grid')}>
        <div className="paint-row">
          <PaintToggle
            on={on}
            label="Grid"
            onChange={(next) =>
              set(grid ? { visible: next } : { ...defaultGridOf(kind), visible: next })
            }
          />
          {/* A plain Select, not the icon dropdown: that one shows the icon
              alone, and there is no 16px glyph that distinguishes "Square" from
              "Layout" the way a cap or a join draws itself. */}
          <Select
            value={kind}
            options={[
              { value: 'square', label: t('label.square') },
              { value: 'layout', label: t('label.layout') },
            ]}
            onChange={(v) => set({ type: v as 'square' | 'layout', visible: true })}
            title={t('label.gridType')}
          />
          <Swatch
            paint={{ type: 'solid', color }}
            onClick={(e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setPicking({ x: rect.left - (PAINT_POPOVER_WIDTH + 10), y: rect.top })
            }}
          />
        </div>

        {on && kind === 'square' && (
          <div className="field-row cols-3">
            <NumberField
              label="Size"
              title="Square Size"
              min={1}
              value={common(boards, (b) => (b.grid?.type === 'square' ? b.grid.size : 0))}
              onChange={(v, committing) =>
                set({ type: 'square', size: v }, committing ? undefined : 'grid-size')
              }
            />
          </div>
        )}

        {on && kind === 'layout' && (
          <>
            <div className="field-row cols-3">
              <NumberField
                label="Cols"
                title="Number of columns"
                min={1}
                value={common(boards, (b) => (b.grid?.type === 'layout' ? b.grid.columns : 0))}
                onChange={(v, committing) =>
                  set({ type: 'layout', columns: v }, committing ? undefined : 'grid-cols')
                }
              />
              <NumberField
                label="Gut"
                title="Gutter width"
                min={0}
                value={common(boards, (b) => (b.grid?.type === 'layout' ? b.grid.gutter : 0))}
                onChange={(v, committing) =>
                  set({ type: 'layout', gutter: v }, committing ? undefined : 'grid-gutter')
                }
              />
              <NumberField
                label="W"
                title="Column width — adjusting it moves the gutter, since the artboard's width is fixed"
                min={1}
                disabled={(grid?.type === 'layout' ? grid.columns : 1) < 2}
                value={columns.length ? round2(columns[0]!.width) : null}
                onChange={(v, committing) => {
                  if (grid?.type !== 'layout') return
                  const gutter = gutterForColumnWidth(width, grid, v)
                  if (gutter === null) return
                  set({ type: 'layout', gutter }, committing ? undefined : 'grid-colw')
                }}
              />
            </div>
            <div className="field-row cols-3">
              <NumberField
                label="L"
                title="Left margin"
                min={0}
                value={common(boards, (b) => (b.grid?.type === 'layout' ? b.grid.marginLeft : 0))}
                onChange={(v, committing) =>
                  set({ type: 'layout', marginLeft: v }, committing ? undefined : 'grid-ml')
                }
              />
              <NumberField
                label="R"
                title="Right margin"
                min={0}
                value={common(boards, (b) => (b.grid?.type === 'layout' ? b.grid.marginRight : 0))}
                onChange={(v, committing) =>
                  set({ type: 'layout', marginRight: v }, committing ? undefined : 'grid-mr')
                }
              />
            </div>
            {on && columns.length === 0 && (
              <div className="multi-note">
                The margins and gutters leave no room for {first.grid?.type === 'layout'
                  ? first.grid.columns
                  : 0}{' '}
                columns on a {round2(width)}-wide artboard.
              </div>
            )}
          </>
        )}

        <div className="field-row" style={{ gridTemplateColumns: '1fr' }}>
          <button
            type="button"
            className="button"
            title="Use this grid for new artboards, in this and future documents"
            onClick={() => saveDefaultGrid(first.grid ?? defaultGridOf(kind))}
          >
            {t('label.makeDefault')}
          </button>
        </div>
      </Section>

      {picking && (
        <PaintPopover
          paint={{ type: 'solid', color }}
          anchor={picking}
          // A grid line has a colour, not a paint: a gradient grid is not a
          // thing in XD, and the alpha is the point (Adobe's example is 20%).
          allowGradient={false}
          onChange={(paint, committing) => {
            if (paint.type === 'solid') {
              set({ color: paint.color }, committing ? undefined : 'grid-color')
            }
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </>
  )
}

function defaultGridOf(kind: 'square' | 'layout') {
  return kind === 'square' ? { ...DEFAULT_SQUARE_GRID } : { ...DEFAULT_LAYOUT_GRID }
}

function RepeatGridSection({ nodes }: { nodes: DesignNode[] }) {
  const grids = nodes.filter((n) => n.type === 'repeat-grid')
  if (grids.length === 0) return null

  const rows = common(grids, (n) => (n.type === 'repeat-grid' ? n.rows : 1))
  const columns = common(grids, (n) => (n.type === 'repeat-grid' ? n.columns : 1))
  const gutterX = common(grids, (n) => (n.type === 'repeat-grid' ? n.gutterX : 0))
  const gutterY = common(grids, (n) => (n.type === 'repeat-grid' ? n.gutterY : 0))

  const apply = (patch: Parameters<typeof setRepeatGridParams>[1], committing: boolean) => {
    for (const grid of grids) {
      setRepeatGridParams(grid.id, patch, committing ? undefined : `grid:${grid.id}`)
    }
  }

  return (
    <Section title={t('section.repeatGrid')}>
      <div className="field-row">
        <NumberField
          label="Cols"
          value={columns}
          min={1}
          max={200}
          precision={0}
          onChange={(v, committing) => apply({ columns: v }, committing)}
        />
        <NumberField
          label="Rows"
          value={rows}
          min={1}
          max={200}
          precision={0}
          onChange={(v, committing) => apply({ rows: v }, committing)}
        />
      </div>
      <div className="field-row">
        <NumberField
          label="Gap X"
          value={gutterX}
          scrubStep={0.5}
          onChange={(v, committing) => apply({ gutterX: v }, committing)}
        />
        <NumberField
          label="Gap Y"
          value={gutterY}
          scrubStep={0.5}
          onChange={(v, committing) => apply({ gutterY: v }, committing)}
        />
      </div>
      <div className="multi-note">
        Every cell shows the same content — edit it once and all repeats follow.
        Use Expand Grid to make them independent.
      </div>
    </Section>
  )
}

function ShapeSection({ nodes }: { nodes: DesignNode[] }) {
  // Subscribes to the LiveTransform channel so the Star and Radius readouts
  // follow their on-canvas handles mid-drag, when the document has not changed.
  void useLiveTransformTick()
  const roundable = nodes.filter(supportsCornerRadius)
  const polygons = nodes.filter((n) => n.type === 'polygon')
  if (roundable.length === 0 && polygons.length === 0) return null

  return (
    <Section title={t('section.shape')}>
      {polygons.length > 0 && (
        <div className="field-row">
          <NumberField
            label="Corners"
            title="Corner count"
            value={common(polygons, (n) => (n.type === 'polygon' ? n.sides : 0))}
            min={MIN_SIDES}
            max={MAX_SIDES}
            precision={0}
            onChange={(v, committing) =>
              setShapeParam({ sides: v }, committing ? undefined : 'sides')
            }
          />
          <NumberField
            label="Star"
            title="Star ratio"
            // Shown as a percentage, as XD does; 100% is a plain polygon.
            value={common(polygons, (n) =>
              n.type === 'polygon'
                ? Math.round((getLiveStarRatio(n.id) ?? n.starRatio) * 100)
                : 0,
            )}
            min={1}
            max={100}
            suffix="%"
            precision={0}
            onChange={(v, committing) =>
              setShapeParam({ starRatio: v / 100 }, committing ? undefined : 'star')
            }
          />
        </div>
      )}
      {roundable.length > 0 && <CornerRadiusRow nodes={roundable} />}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** Adobe's three, in the order the Property Inspector shows them. */
const TEXT_SIZING_OPTIONS: Array<{
  value: TextSizing
  key: MessageKey
  icon: ReactNode
}> = [
  { value: 'auto-width', key: 'label.autoWidth', icon: <AutoWidthIcon /> },
  { value: 'auto-height', key: 'label.autoHeight', icon: <AutoHeightIcon /> },
  { value: 'fixed', key: 'label.fixedSize', icon: <FixedSizeIcon /> },
]

/**
 * Load every face of the selected family while the panel is open.
 *
 * The controls beside this offer Bold, Italic and five weights; a face the
 * browser has never fetched arrives a beat after the click, and until it does
 * the text is measured against the fallback. Asking for them all up front — a
 * few milliseconds for a whole family, from local files — makes the toggles
 * immediate. Renders nothing.
 */
function FamilyPreload({ family }: { family: string | null }) {
  useEffect(() => {
    if (family) void preloadFamily(family)
  }, [family])
  return null
}

function TextSection({ nodes }: { nodes: DesignNode[] }) {
  const texts = nodes.filter((n) => n.type === 'text')
  if (texts.length === 0) return null

  const family = common(texts, (n) => (n.type === 'text' ? n.textStyle.fontFamily : ''))
  const size = common(texts, (n) => (n.type === 'text' ? n.textStyle.fontSize : 0))
  const weight = common(texts, (n) => (n.type === 'text' ? n.textStyle.fontWeight : 400))
  const align = common(texts, (n) => (n.type === 'text' ? n.textStyle.align : 'left'))
  const lineHeight = common(texts, (n) => (n.type === 'text' ? n.textStyle.lineHeight : 1.4))
  const tracking = common(texts, (n) => (n.type === 'text' ? n.textStyle.letterSpacing : 0))
  const italic = common(texts, (n) => (n.type === 'text' ? n.textStyle.fontStyle === 'italic' : false))
  const sizing = common(texts, (n) => (n.type === 'text' ? n.textStyle.sizing : 'auto-width'))
  const paragraphSpacing = common(texts, (n) => (n.type === 'text' ? n.textStyle.paragraphSpacing : 0))
  const transform = common(texts, (n) => (n.type === 'text' ? n.textStyle.transform : 'none'))

  const groups = fontsByCategory()

  return (
    <Section title={t('section.text')}>
      <FamilyPreload family={family} />
      <div className="field-row" style={{ gridTemplateColumns: '1fr' }}>
        <Select
          value={family ?? ''}
          options={groups.map((g) => ({
            group: g.label,
            options: g.fonts.map((f) => ({ value: f.family, label: f.family })),
          }))}
          onChange={(v) => setTextStyle({ fontFamily: v })}
        />
      </div>
      {family && !isBundledFont(family) && (
        <div className="multi-note">
          System font — exported SVG references it by name and will substitute where it is not
          installed.
        </div>
      )}
      <div className="field-row cols-3">
        <NumberField
          label="Size"
          value={size}
          min={1}
          max={999}
          onChange={(v, committing) => setTextStyle({ fontSize: v }, committing ? undefined : 'fsize')}
        />
        <Select
          value={weight ?? 400}
          options={[300, 400, 500, 600, 700].map((w) => ({
            value: w,
            label: WEIGHT_LABELS[w] ?? String(w),
          }))}
          onChange={(v) => setTextStyle({ fontWeight: nearestWeight(family ?? 'Inter', Number(v)) })}
        />
        <button
          type="button"
          className={`icon-button${italic ? ' active' : ''}`}
          style={{ fontStyle: 'italic', fontFamily: 'Georgia, serif' }}
          title="Italic"
          onClick={() => setTextStyle({ fontStyle: italic ? 'normal' : 'italic' })}
        >
          I
        </button>
      </div>
      <div className="field-row">
        <NumberField
          label="LH"
          title="Line height"
          value={lineHeight}
          min={0.5}
          max={4}
          step={0.1}
          scrubStep={0.01}
          onChange={(v, committing) => setTextStyle({ lineHeight: v }, committing ? undefined : 'lh')}
        />
        <NumberField
          label="LS"
          title="Letter spacing (em)"
          value={tracking}
          step={0.01}
          scrubStep={0.002}
          onChange={(v, committing) => setTextStyle({ letterSpacing: v }, committing ? undefined : 'ls')}
        />
      </div>
      <div className="field-row">
        <div className="icon-row">
          <IconButton icon={<TextAlignLeftIcon />} label="Align left" active={align === 'left'} onClick={() => setTextStyle({ align: 'left' })} />
          <IconButton icon={<TextAlignCenterIcon />} label="Align center" active={align === 'center'} onClick={() => setTextStyle({ align: 'center' })} />
          <IconButton icon={<TextAlignRightIcon />} label="Align right" active={align === 'right'} onClick={() => setTextStyle({ align: 'right' })} />
        </div>
      </div>

      {/* Adobe's three resize options, as a segmented control: they are three
          states of one setting, and a dropdown hides two of them behind a click
          when all three fit. */}
      <div className="field-row" style={{ gridTemplateColumns: '1fr' }}>
        <div className="corner-mode-toggle" role="group" aria-label={t('label.textResize')}>
          {TEXT_SIZING_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`icon-button${sizing === option.value ? ' active' : ''}`}
              aria-label={t(option.key)}
              aria-pressed={sizing === option.value}
              data-testid={`sizing-${option.value}`}
              title={t(option.key)}
              onClick={() => setTextStyle({ sizing: option.value })}
            >
              {option.icon}
            </button>
          ))}
        </div>
      </div>

      <div className="field-row cols-3">
        <NumberField
          label="¶"
          title={t('label.paragraphSpacing')}
          value={paragraphSpacing}
          min={0}
          onChange={(v, committing) =>
            setTextStyle({ paragraphSpacing: v }, committing ? undefined : 'para')
          }
        />
        <Select
          value={transform ?? 'none'}
          options={[
            { value: 'none', label: t('label.transformNone') },
            { value: 'uppercase', label: 'AB' },
            { value: 'lowercase', label: 'ab' },
            { value: 'titlecase', label: 'Ab' },
          ]}
          onChange={(v) => setTextStyle({ transform: v as TextTransform })}
          title={t('label.textTransform')}
        />
        <button
          type="button"
          className="icon-button"
          title={t('label.importText')}
          aria-label={t('label.importText')}
          onClick={() => void importTextIntoSelection()}
        >
          <ImportIcon />
        </button>
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function ExportSection({ nodes }: { nodes: DesignNode[] }) {
  const marked = common(nodes, (n) => n.markedForExport)
  return (
    <Section title={t('section.export')}>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={marked === true}
          ref={(el) => { if (el) el.indeterminate = marked === null }}
          onChange={(e) => setMarkedForExport(nodes.map((n) => n.id), e.target.checked)}
        />
        Mark for Export
      </label>
      <button
        type="button"
        className="button"
        style={{ width: '100%', marginTop: 4 }}
        onClick={() => openDialog('export')}
      >
        Export Selection…
      </button>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BLEND_MODES: Array<Style['blendMode']> = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light',
  'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
]

const WEIGHT_LABELS: Record<number, string> = {
  300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold',
}

/** Identity key for a paint, so `common()` can compare paints structurally. */
function paintKey(paint: Paint): string {
  switch (paint.type) {
    case 'solid': return `solid:${toHex(paint.color, true)}`
    case 'none': return 'none'
    case 'ref': return `ref:${paint.ref}`
    default: return `${paint.type}:${paint.stops.map((s) => `${s.offset}${toHex(s.color, true)}`).join(',')}`
  }
}

function titleCase(s: string): string {
  return s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
