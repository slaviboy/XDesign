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
  setCornerRadiusAt,
} from '../history/Commands'
import { setRepeatGridParams } from '../history/RepeatGridCommands'
import {
  geometryBounds, localBox, localGeometryBounds, nodeLocalMatrix, worldMatrix,
} from '../document/SceneGraph'
import { decompose, invert, multiply, type Mat2D } from '../geometry/Matrix'
import { transformBounds, unionAll, type Bounds } from '../geometry/Bounds'
import { MAX_SIDES, MIN_SIDES } from '../geometry/ShapeGeometry'
import { getLiveMatrix, getLiveSize, usesIntrinsicSize } from '../tools/DragSession'
import { isGradient as isGradientPaint } from '../canvas/paint'
import { getLiveRadius } from '../tools/RadiusSession'
import { getLiveStarRatio } from '../tools/StarRatioSession'
import { toCss, toHex } from '../document/color'
import { fontsByCategory, isBundledFont, nearestWeight } from '../text/FontRegistry'
import { openDialog, setCornerRadiusMode, setEditor } from '../state/EditorStore'
import { useDocument, useEditorStore, useLiveTransformTick, useSelectedNodes } from '../state/hooks'
import { NumberField, Section, Select, TextField, common, IconButton } from './primitives'
import { PaintPopover, PAINT_POPOVER_WIDTH } from './ColorPicker'
import { useEyedropper } from './eyedropper'
import {
  AlignBottomIcon, AlignCenterHIcon, AlignCenterVIcon, AlignLeftIcon, AlignRightIcon,
  AlignTopIcon, DistributeHIcon, DistributeVIcon, FlipHIcon, FlipVIcon,
  CornersIndependentIcon, CornersUniformIcon, EyedropperIcon,
  LinkBracket, MatchHeightIcon, MatchSizeIcon, MatchWidthIcon,
  RotateIcon, TextAlignCenterIcon, TextAlignLeftIcon, TextAlignRightIcon,
} from './icons'
import {
  CORNER_ORDER,
  cornerRadiusOf,
  hasStyle,
  isContainer,
  isUniformCornerRadius,
  supportsCornerRadius,
  usesOwnBox,
  type DesignDocument,
  type DesignNode,
  type Paint,
  type RGBA,
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

  // The on-canvas gradient handles are part of the picker, as Adobe lists them:
  // they appear when it opens and go when it closes, and this is also what tells
  // the overlay whether it is editing the fill's gradient or the stroke's.
  const gradientNodeId = popover && isGradientPaint(currentPaint) ? first.id : null
  const gradientTarget = popover?.target ?? 'fill'
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

  const openPicker = useCallback((target: 'fill' | 'stroke', e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    // Flip left of the swatch; the width comes from the popover itself so the
    // two cannot drift apart.
    setPopover({ target, x: rect.left - (PAINT_POPOVER_WIDTH + 10), y: rect.top })
  }, [])

  return (
    <>
      <Section title="Fill">
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

      <Section title="Stroke">
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
        </div></>
        )}
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
  // Subscribes to the LiveTransform channel so the Star and Radius readouts
  // follow their on-canvas handles mid-drag, when the document has not changed.
  void useLiveTransformTick()
  const roundable = nodes.filter(supportsCornerRadius)
  const polygons = nodes.filter((n) => n.type === 'polygon')
  if (roundable.length === 0 && polygons.length === 0) return null

  return (
    <Section title="Shape">
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
