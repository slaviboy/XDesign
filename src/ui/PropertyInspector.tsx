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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  alignSelection,
  distributeSelection,
  flipSelection,
  setCornerRadius,
  setFill,
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
} from '../history/Commands'
import { setRepeatGridParams } from '../history/RepeatGridCommands'
import { geometryBounds, localGeometryBounds, worldMatrix } from '../document/SceneGraph'
import { decompose } from '../geometry/Matrix'
import { transformBounds } from '../geometry/Bounds'
import { getLiveMatrix, getLiveSize } from '../tools/DragSession'
import { getLiveRadius } from '../tools/RadiusSession'
import { toCss, toHex } from '../document/color'
import { fontsByCategory, isBundledFont, nearestWeight } from '../text/FontRegistry'
import { openDialog, setEditor } from '../state/EditorStore'
import { useDocument, useEditorStore, useLiveTransformTick, useSelectedNodes } from '../state/hooks'
import { NumberField, Section, Select, TextField, common, IconButton } from './primitives'
import { PaintPopover } from './ColorPicker'
import {
  AlignBottomIcon, AlignCenterHIcon, AlignCenterVIcon, AlignLeftIcon, AlignRightIcon,
  AlignTopIcon, DistributeHIcon, DistributeVIcon, FlipHIcon, FlipVIcon,
  LinkBracket, MatchHeightIcon, MatchSizeIcon, MatchWidthIcon, RadiusIcon,
  RotateIcon, TextAlignCenterIcon, TextAlignLeftIcon, TextAlignRightIcon,
} from './icons'
import {
  cornerRadiusOf,
  hasStyle,
  supportsCornerRadius,
  type DesignNode,
  type Paint,
  type Style,
} from '../document/types'

export function PropertyInspector() {
  const selected = useSelectedNodes()
  return (
    <div className="inspector-scroll">
      {selected.length === 0 ? <DocumentSection /> : <SelectionSections nodes={selected} />}
    </div>
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
      <Section title="Document">
        <div className="field-row" style={{ gridTemplateColumns: '1fr' }}>
          <TextField label="Name" value={doc.name} onChange={renameDocument} />
        </div>
        <div className="multi-note">
          {Object.keys(doc.nodes).length - 1} objects · {Object.keys(doc.assets).length} images
        </div>
      </Section>

      <Section title="Grid">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={doc.settings.gridVisible}
            onChange={(e) => updateSettings({ gridVisible: e.target.checked })}
          />
          Show grid
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={doc.settings.snapToGrid}
            onChange={(e) => updateSettings({ snapToGrid: e.target.checked })}
          />
          Snap to grid
        </label>
        <div className="field-row">
          <NumberField
            label="Size"
            value={doc.settings.gridSize}
            min={1}
            max={500}
            onChange={(v) => updateSettings({ gridSize: Math.round(v) })}
          />
        </div>
      </Section>

      <Section title="Guides & Snapping">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={doc.settings.guidesVisible}
            onChange={(e) => updateSettings({ guidesVisible: e.target.checked })}
          />
          Show guides
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={doc.settings.snapToObjects}
            onChange={(e) => updateSettings({ snapToObjects: e.target.checked })}
          />
          Snap to objects
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={snapEnabled}
            onChange={(e) => setEditor({ snapEnabled: e.target.checked })}
          />
          Snapping enabled
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
  const x = multiple ? null : round2(bounds?.x ?? 0)
  const y = multiple ? null : round2(bounds?.y ?? 0)

  const applyX = (value: number) => {
    const node = nodes[0]
    if (!node || !bounds) return
    setNodeTransform(node.id, { x: node.transform.x + (value - bounds.x) }, `x:${node.id}`)
  }
  const applyY = (value: number) => {
    const node = nodes[0]
    if (!node || !bounds) return
    setNodeTransform(node.id, { y: node.transform.y + (value - bounds.y) }, `y:${node.id}`)
  }
  const applySize = (key: 'width' | 'height', value: number) => {
    for (const node of nodes) {
      const scale = Math.abs(key === 'width' ? node.transform.scaleX : node.transform.scaleY) || 1
      setNodeTransform(node.id, { [key]: Math.max(0.5, value / scale) }, `${key}:${node.id}`)
    }
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

      <Section title="Transform">
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

      <Section title="Align">
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
      <RepeatGridSection nodes={nodes} />
      <ShapeSection nodes={nodes} />
      <TextSection nodes={nodes} />
      <ExportSection nodes={nodes} />
    </>
  )
}

/**
 * Bounds that follow an in-flight drag.
 *
 * Falls back to the document whenever no gesture is running, so this is the
 * single readout path rather than a special case bolted on beside one.
 */
function liveBounds(doc: ReturnType<typeof useDocument>, node: DesignNode) {
  const live = getLiveMatrix(node.id)
  if (!live) return geometryBounds(doc, node.id)
  const size = getLiveSize(node.id)
  const local = size
    ? { x: 0, y: 0, width: size.width, height: size.height }
    : localGeometryBounds(node)
  return transformBounds(local, live)
}

/**
 * Effective size (intrinsic x |scale|), preferring live values.
 *
 * The three cases differ: a single-node resize writes the new intrinsic size,
 * a multi-node resize instead scales the matrix, and a move or rotate changes
 * neither — so the scale has to come from the live matrix when there is one.
 */
function liveEffectiveSize(
  doc: ReturnType<typeof useDocument>,
  node: DesignNode,
): { width: number; height: number } {
  void doc
  const size = getLiveSize(node.id)
  if (size) return size

  const live = getLiveMatrix(node.id)
  if (live) {
    const d = decompose(live)
    return {
      width: node.transform.width * Math.abs(d.scaleX),
      height: node.transform.height * Math.abs(d.scaleY),
    }
  }
  return {
    width: node.transform.width * Math.abs(node.transform.scaleX),
    height: node.transform.height * Math.abs(node.transform.scaleY),
  }
}

// ---------------------------------------------------------------------------
// Appearance
// ---------------------------------------------------------------------------

function AppearanceSection({ nodes }: { nodes: Array<DesignNode & { style: Style }> }) {
  const [popover, setPopover] = useState<{ target: 'fill' | 'stroke'; x: number; y: number } | null>(null)

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
  const currentPaint: Paint = popover?.target === 'stroke' ? first.style.stroke.paint : first.style.fill

  const openPicker = useCallback((target: 'fill' | 'stroke', e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setPopover({ target, x: rect.left - 258, y: rect.top })
  }, [])

  return (
    <>
      <Section title="Fill">
        <div className="paint-row">
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
        </div>
        <div className="field-row" style={{ gridTemplateColumns: '1fr' }}>
          <Select
            value={blend ?? 'normal'}
            options={BLEND_MODES.map((m) => ({ value: m, label: titleCase(m) }))}
            onChange={(v) => setStyleProperty('blendMode', v as Style['blendMode'])}
            title="Blend mode"
          />
        </div>
      </Section>

      <Section title="Stroke">
        <div className="paint-row">
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
        </div>
        <div className="field-row cols-3">
          <Select
            value={cap ?? 'butt'}
            options={[
              { value: 'butt', label: 'Butt' },
              { value: 'round', label: 'Round' },
              { value: 'square', label: 'Square' },
            ]}
            onChange={(v) => setStroke({ cap: v as Style['stroke']['cap'] })}
            title="Line cap"
          />
          <Select
            value={join ?? 'miter'}
            options={[
              { value: 'miter', label: 'Miter' },
              { value: 'round', label: 'Round' },
              { value: 'bevel', label: 'Bevel' },
            ]}
            onChange={(v) => setStroke({ join: v as Style['stroke']['join'] })}
            title="Line join"
          />
          <Select
            value={align ?? 'center'}
            options={[
              { value: 'center', label: 'Center' },
              { value: 'inner', label: 'Inside' },
              { value: 'outer', label: 'Outside' },
            ]}
            onChange={(v) => setStroke({ align: v as Style['stroke']['align'] })}
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
        </div>
      </Section>

      {popover && (
        <PaintPopover
          paint={currentPaint}
          anchor={{ x: popover.x, y: popover.y }}
          onChange={(paint, committing) => {
            const key = committing ? undefined : `paint:${popover.target}`
            if (popover.target === 'fill') setFill(paint, key)
            else setStroke({ paint }, key)
          }}
          onClose={() => setPopover(null)}
        />
      )}
    </>
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
    <Section title="Repeat Grid">
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
  const liveTick = useLiveTransformTick()
  void liveTick
  const roundable = nodes.filter(supportsCornerRadius)
  const polygons = nodes.filter((n) => n.type === 'polygon')
  const stars = nodes.filter((n) => n.type === 'star')
  if (roundable.length === 0 && polygons.length === 0 && stars.length === 0) return null

  return (
    <Section title="Shape">
      {roundable.length > 0 && (
        <div className="field-row">
          <NumberField
            label={<RadiusIcon size={13} />}
            title="Corner radius"
            value={common(roundable, (n) => round2(getLiveRadius(n.id) ?? cornerRadiusOf(n)))}
            min={0}
            onChange={(v, committing) => setCornerRadius(v, committing ? undefined : 'radius')}
          />
        </div>
      )}
      {polygons.length > 0 && (
        <div className="field-row">
          <NumberField
            label="Sides"
            value={common(polygons, (n) => (n.type === 'polygon' ? n.sides : 0))}
            min={3}
            max={64}
            precision={0}
            onChange={(v, committing) => setShapeParam({ sides: v }, committing ? undefined : 'sides')}
          />
        </div>
      )}
      {stars.length > 0 && (
        <div className="field-row">
          <NumberField
            label="Pts"
            value={common(stars, (n) => (n.type === 'star' ? n.points : 0))}
            min={3}
            max={64}
            precision={0}
            onChange={(v, committing) => setShapeParam({ points: v }, committing ? undefined : 'points')}
          />
          <NumberField
            label="Inner"
            value={common(stars, (n) => (n.type === 'star' ? Math.round(n.innerRatio * 100) : 0))}
            min={1}
            max={100}
            suffix="%"
            precision={0}
            onChange={(v, committing) =>
              setShapeParam({ innerRatio: v / 100 }, committing ? undefined : 'inner')
            }
          />
        </div>
      )}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

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
  const sizing = common(texts, (n) => (n.type === 'text' ? n.textStyle.sizing : 'auto'))

  const groups = fontsByCategory()

  return (
    <Section title="Text">
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
        <Select
          value={sizing ?? 'auto'}
          options={[
            { value: 'auto', label: 'Auto width' },
            { value: 'fixed', label: 'Fixed width' },
          ]}
          onChange={(v) => setTextStyle({ sizing: v as 'auto' | 'fixed' })}
        />
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
    <Section title="Export">
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
