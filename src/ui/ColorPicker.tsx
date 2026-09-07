/**
 * Colour picker and gradient editor.
 *
 * Edits stream through with `committing: false` while a slider is dragged, so
 * the canvas updates live but the whole drag collapses into one undo entry via
 * the store's coalesce key.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  hslToHsv,
  hsvToHsl,
  hsvToRgb,
  parseHex,
  rgbToHsv,
  toCss,
  toHex,
  type HSV,
} from '../document/color'
import { createStop } from '../document/NodeFactory'
import { addSwatch, removeSwatch } from '../history/Commands'
import { editorStore } from '../state/EditorStore'
import { useDocument } from '../state/hooks'
import { NumberField, Select } from './primitives'
import { CloseIcon, EyedropperIcon, PlusIcon, TrashIcon } from './icons'
import { armEyedropper, type EyedropperSampler } from './eyedropper'
import type { GradientStop, Paint, RGBA } from '../document/types'


// ---------------------------------------------------------------------------
// Solid colour
// ---------------------------------------------------------------------------

/** Numeric modes offered by the value row, matching XD (which calls HSV "HSB"). */
type ColorModel = 'hex' | 'rgb' | 'hsl' | 'hsv'

const MODEL_OPTIONS: Array<{ value: ColorModel; label: string }> = [
  { value: 'hex', label: 'Hex' },
  { value: 'rgb', label: 'RGB' },
  { value: 'hsl', label: 'HSL' },
  { value: 'hsv', label: 'HSV' },
]

/**
 * Module-level so the choice survives closing and reopening the popover. It is
 * a UI preference, not document data — a file must not carry how someone likes
 * to type colours.
 */
let sharedModel: ColorModel = 'hex'

export function ColorPicker({
  color,
  onChange,
}: {
  color: RGBA
  onChange: (color: RGBA, committing: boolean) => void
}) {
  // HSV is kept locally because it is not recoverable from RGB at the extremes:
  // pure black has no hue, so a round trip through RGB would reset the hue
  // slider to red the moment value hits zero. Every field below is a projection
  // of this plus the alpha, and every edit writes back into it.
  const [hsv, setHsv] = useState<HSV>(() => rgbToHsv(color))
  const [model, setModel] = useState<ColorModel>(sharedModel)
  const lastEmitted = useRef<string>(toHex(color, true))

  useEffect(() => {
    const hex = toHex(color, true)
    if (hex !== lastEmitted.current) {
      setHsv(rgbToHsv(color))
      lastEmitted.current = hex
    }
  }, [color])

  const emit = useCallback(
    (next: HSV, alpha: number, committing: boolean) => {
      setHsv(next)
      const rgba = hsvToRgb(next.h, next.s, next.v, alpha)
      lastEmitted.current = toHex(rgba, true)
      onChange(rgba, committing)
    },
    [onChange],
  )

  /** Adopt a colour that came from outside — a swatch, or the eyedropper. */
  const adopt = useCallback(
    (next: RGBA, committing: boolean) => {
      setHsv(rgbToHsv(next))
      lastEmitted.current = toHex(next, true)
      onChange(next, committing)
    },
    [onChange],
  )

  const hueColor = useMemo(() => toCss(hsvToRgb(hsv.h, 1, 1)), [hsv.h])

  return (
    <div className="color-picker">
      <div className="sv-row">
        <SaturationValueSquare
          hsv={hsv}
          hueColor={hueColor}
          onChange={(sat, val, committing) => emit({ ...hsv, s: sat, v: val }, color.a, committing)}
        />
        <Slider
          className="hue-track"
          vertical
          value={hsv.h / 360}
          onChange={(t, committing) => emit({ ...hsv, h: t * 360 }, color.a, committing)}
        />
        {/* Inverted: the ramp runs opaque at the TOP down to transparent, and
            the slider measures from the top, so the two must be mirrored or the
            thumb sits at the transparent end while reporting full opacity. */}
        <Slider
          className="alpha-track"
          vertical
          value={1 - color.a}
          overlay={`linear-gradient(to bottom, ${toCss({ ...color, a: 1 })}, transparent)`}
          onChange={(t, committing) => emit(hsv, 1 - t, committing)}
        />
      </div>

      <div className="value-row">
        <Select
          value={model}
          options={MODEL_OPTIONS}
          title="Color model"
          onChange={(m) => { sharedModel = m; setModel(m) }}
        />
        <ValueFields model={model} color={color} hsv={hsv} emit={emit} adopt={adopt} />
        <NumberField
          value={Math.round(color.a * 100)}
          min={0}
          max={100}
          precision={0}
          suffix="%"
          title="Opacity"
          className="alpha-field"
          onChange={(v, committing) => emit(hsv, v / 100, committing)}
        />
      </div>

      <SwatchRow color={color} onPick={adopt} />
    </div>
  )
}

/**
 * The numeric fields for the chosen model.
 *
 * HSL and HSV are derived from the local HSV, never from the RGB, so dragging
 * lightness to zero does not collapse the hue under the cursor.
 */
function ValueFields({
  model,
  color,
  hsv,
  emit,
  adopt,
}: {
  model: ColorModel
  color: RGBA
  hsv: HSV
  emit: (next: HSV, alpha: number, committing: boolean) => void
  adopt: (color: RGBA, committing: boolean) => void
}) {
  if (model === 'hex') {
    return <HexField color={color} onChange={(c) => adopt(c, true)} />
  }
  if (model === 'rgb') {
    return (
      <>
        <NumberField label="R" value={color.r} min={0} max={255} precision={0}
          onChange={(v, c) => adopt({ ...color, r: Math.round(v) }, c)} />
        <NumberField label="G" value={color.g} min={0} max={255} precision={0}
          onChange={(v, c) => adopt({ ...color, g: Math.round(v) }, c)} />
        <NumberField label="B" value={color.b} min={0} max={255} precision={0}
          onChange={(v, c) => adopt({ ...color, b: Math.round(v) }, c)} />
      </>
    )
  }
  if (model === 'hsl') {
    const hsl = hsvToHsl(hsv.h, hsv.s, hsv.v)
    const back = (next: { h?: number; s?: number; l?: number }, committing: boolean) => {
      const merged = { ...hsl, ...next }
      emit({ ...hslToHsv(merged.h, merged.s, merged.l), h: merged.h }, color.a, committing)
    }
    return (
      <>
        <NumberField label="H" value={Math.round(hsl.h)} min={0} max={360} precision={0}
          onChange={(v, c) => back({ h: v }, c)} />
        <NumberField label="S" value={Math.round(hsl.s * 100)} min={0} max={100} precision={0}
          onChange={(v, c) => back({ s: v / 100 }, c)} />
        <NumberField label="L" value={Math.round(hsl.l * 100)} min={0} max={100} precision={0}
          onChange={(v, c) => back({ l: v / 100 }, c)} />
      </>
    )
  }
  return (
    <>
      <NumberField label="H" value={Math.round(hsv.h)} min={0} max={360} precision={0}
        onChange={(v, c) => emit({ ...hsv, h: v }, color.a, c)} />
      <NumberField label="S" value={Math.round(hsv.s * 100)} min={0} max={100} precision={0}
        onChange={(v, c) => emit({ ...hsv, s: v / 100 }, color.a, c)} />
      <NumberField label="V" value={Math.round(hsv.v * 100)} min={0} max={100} precision={0}
        onChange={(v, c) => emit({ ...hsv, v: v / 100 }, color.a, c)} />
    </>
  )
}

/**
 * The document's palette.
 *
 * Empty until the user saves something — a fixed set of presets is somebody
 * else's taste, and XD ships none either. (+) keeps the colour AND its opacity.
 */
function SwatchRow({
  color,
  onPick,
}: {
  color: RGBA
  onPick: (color: RGBA, committing: boolean) => void
}) {
  const swatches = useDocument().swatches

  return (
    <div className="swatch-row">
      <button
        type="button"
        className="icon-button add-swatch"
        title="Add this color to the document"
        aria-label="Add swatch"
        onClick={() => addSwatch(color)}
      >
        <PlusIcon />
      </button>
      {swatches.map((sw) => (
        <span key={sw.id} className="preset-swatch-slot">
          <button
            type="button"
            className="preset-swatch"
            style={{ background: toCss(sw.color) }}
            title={toHex(sw.color, true)}
            onClick={() => onPick({ ...sw.color }, true)}
          />
          <button
            type="button"
            className="remove-swatch"
            title="Remove swatch"
            aria-label="Remove swatch"
            onClick={() => removeSwatch(sw.id)}
          >
            <CloseIcon size={8} />
          </button>
        </span>
      ))}
    </div>
  )
}

function HexField({ color, onChange }: { color: RGBA; onChange: (c: RGBA) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <div className="field">
      <span className="field-label">#</span>
      <input
        type="text"
        spellCheck={false}
        value={draft ?? toHex(color).slice(1)}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') { setDraft(null); (e.target as HTMLInputElement).blur() }
        }}
        onBlur={() => {
          if (draft !== null) {
            const parsed = parseHex(draft)
            if (parsed) onChange({ ...parsed, a: draft.length === 8 ? parsed.a : color.a })
          }
          setDraft(null)
        }}
      />
    </div>
  )
}

function SaturationValueSquare({
  hsv,
  hueColor,
  onChange,
}: {
  hsv: HSV
  hueColor: string
  onChange: (s: number, v: number, committing: boolean) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const update = (clientX: number, clientY: number, committing: boolean) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    const s = clamp01((clientX - rect.left) / rect.width)
    const v = 1 - clamp01((clientY - rect.top) / rect.height)
    onChange(s, v, committing)
  }

  return (
    <div
      ref={ref}
      className="sv-square"
      style={{
        background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueColor})`,
      }}
      onPointerDown={(e) => {
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        update(e.clientX, e.clientY, false)
      }}
      onPointerMove={(e) => {
        if (dragging.current) update(e.clientX, e.clientY, false)
      }}
      onPointerUp={(e) => {
        if (!dragging.current) return
        dragging.current = false
        try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* released */ }
        update(e.clientX, e.clientY, true)
      }}
    >
      <div className="sv-cursor" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
    </div>
  )
}

function Slider({
  value,
  onChange,
  className,
  overlay,
  vertical = false,
}: {
  value: number
  onChange: (t: number, committing: boolean) => void
  className: string
  overlay?: string
  /** Vertical, beside the square, as XD lays them out. */
  vertical?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const update = (clientX: number, clientY: number, committing: boolean) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    const t = vertical
      ? (clientY - rect.top) / rect.height
      : (clientX - rect.left) / rect.width
    onChange(clamp01(t), committing)
  }

  return (
    <div
      ref={ref}
      className={`slider-track ${className}${vertical ? ' vertical' : ''}`}
      onPointerDown={(e) => {
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        update(e.clientX, e.clientY, false)
      }}
      onPointerMove={(e) => { if (dragging.current) update(e.clientX, e.clientY, false) }}
      onPointerUp={(e) => {
        if (!dragging.current) return
        dragging.current = false
        try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* released */ }
        update(e.clientX, e.clientY, true)
      }}
    >
      {overlay && <div className="alpha-overlay" style={{ background: overlay }} />}
      <div
        className="slider-thumb"
        style={vertical ? { top: `${value * 100}%` } : { left: `${value * 100}%` }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Gradient
// ---------------------------------------------------------------------------

export function GradientEditor({
  paint,
  onChange,
}: {
  paint: Extract<Paint, { stops: GradientStop[] }>
  onChange: (paint: Paint, committing: boolean) => void
}) {
  const [activeId, setActiveId] = useState<string>(paint.stops[0]?.id ?? '')
  const barRef = useRef<HTMLDivElement>(null)
  const draggingStop = useRef<string | null>(null)

  const sorted = useMemo(() => [...paint.stops].sort((a, b) => a.offset - b.offset), [paint.stops])
  const active = paint.stops.find((s) => s.id === activeId) ?? sorted[0]

  const gradientCss = useMemo(
    () =>
      `linear-gradient(to right, ${sorted
        .map((s) => `${toCss(s.color)} ${(s.offset * 100).toFixed(1)}%`)
        .join(', ')})`,
    [sorted],
  )

  const updateStops = (stops: GradientStop[], committing: boolean) => {
    onChange({ ...paint, stops }, committing)
  }

  const offsetFromEvent = (clientX: number): number => {
    const rect = barRef.current?.getBoundingClientRect()
    if (!rect) return 0
    return clamp01((clientX - rect.left) / rect.width)
  }

  return (
    <div className="vstack" style={{ gap: 8 }}>
      <div
        ref={barRef}
        className="gradient-bar"
        style={{ background: gradientCss }}
        onPointerDown={(e) => {
          // Clicking empty track adds a stop sampling the gradient there.
          if ((e.target as HTMLElement).classList.contains('gradient-stop')) return
          const offset = offsetFromEvent(e.clientX)
          const nearest = sorted.reduce((best, s) =>
            Math.abs(s.offset - offset) < Math.abs(best.offset - offset) ? s : best,
          )
          const stop = createStop(offset, { ...nearest.color })
          setActiveId(stop.id)
          updateStops([...paint.stops, stop], true)
        }}
      >
        {sorted.map((stop) => (
          <div
            key={stop.id}
            className={`gradient-stop${stop.id === active?.id ? ' active' : ''}`}
            style={{ left: `${stop.offset * 100}%`, background: toCss(stop.color) }}
            onPointerDown={(e) => {
              e.stopPropagation()
              setActiveId(stop.id)
              draggingStop.current = stop.id
              ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
            }}
            onPointerMove={(e) => {
              if (draggingStop.current !== stop.id) return
              const offset = offsetFromEvent(e.clientX)
              updateStops(
                paint.stops.map((s) => (s.id === stop.id ? { ...s, offset } : s)),
                false,
              )
            }}
            onPointerUp={(e) => {
              if (draggingStop.current !== stop.id) return
              draggingStop.current = null
              try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* released */ }
              updateStops(paint.stops, true)
            }}
          />
        ))}
      </div>

      <div className="hstack">
        <NumberField
          label="Pos"
          value={active ? Math.round(active.offset * 100) : null}
          min={0}
          max={100}
          suffix="%"
          precision={0}
          onChange={(v, committing) => {
            if (!active) return
            updateStops(
              paint.stops.map((s) => (s.id === active.id ? { ...s, offset: v / 100 } : s)),
              committing,
            )
          }}
        />
        <button
          type="button"
          className="icon-button"
          title="Add stop"
          onClick={() => {
            const stop = createStop(0.5, active ? { ...active.color } : { r: 128, g: 128, b: 128, a: 1 })
            setActiveId(stop.id)
            updateStops([...paint.stops, stop], true)
          }}
        >
          <PlusIcon />
        </button>
        <button
          type="button"
          className="icon-button"
          title="Remove stop"
          disabled={paint.stops.length <= 2 || !active}
          onClick={() => {
            if (!active || paint.stops.length <= 2) return
            const next = paint.stops.filter((s) => s.id !== active.id)
            setActiveId(next[0]?.id ?? '')
            updateStops(next, true)
          }}
        >
          <TrashIcon />
        </button>
      </div>

      {active && (
        <ColorPicker
          color={active.color}
          onChange={(color, committing) =>
            updateStops(
              paint.stops.map((s) => (s.id === active.id ? { ...s, color } : s)),
              committing,
            )
          }
        />
      )}

      <div className="field-row">
        {paint.type === 'linear' ? (
          <>
            <NumberField label="X1" value={paint.x1} step={0.05} scrubStep={0.005} onChange={(v, c) => onChange({ ...paint, x1: v }, c)} />
            <NumberField label="Y1" value={paint.y1} step={0.05} scrubStep={0.005} onChange={(v, c) => onChange({ ...paint, y1: v }, c)} />
            <NumberField label="X2" value={paint.x2} step={0.05} scrubStep={0.005} onChange={(v, c) => onChange({ ...paint, x2: v }, c)} />
            <NumberField label="Y2" value={paint.y2} step={0.05} scrubStep={0.005} onChange={(v, c) => onChange({ ...paint, y2: v }, c)} />
          </>
        ) : (
          <>
            <NumberField label="X" value={paint.cx} step={0.05} scrubStep={0.005} onChange={(v, c) => onChange({ ...paint, cx: v }, c)} />
            <NumberField label="Y" value={paint.cy} step={0.05} scrubStep={0.005} onChange={(v, c) => onChange({ ...paint, cy: v }, c)} />
            <NumberField label="R" value={paint.r} step={0.05} scrubStep={0.005} onChange={(v, c) => onChange({ ...paint, r: v }, c)} />
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Popover host
// ---------------------------------------------------------------------------

/** Paint types, as a dropdown — the reference puts this at the top of the panel. */
const PAINT_OPTIONS: Array<{ value: Paint['type']; label: string }> = [
  { value: 'solid', label: 'Solid Color' },
  { value: 'linear', label: 'Linear Gradient' },
  { value: 'radial', label: 'Radial Gradient' },
  { value: 'none', label: 'None' },
]

export function PaintPopover({
  paint,
  anchor,
  onChange,
  onClose,
  allowGradient = true,
}: {
  paint: Paint
  anchor: { x: number; y: number }
  onChange: (paint: Paint, committing: boolean) => void
  onClose: () => void
  allowGradient?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState(anchor)
  const [sampler, setSampler] = useState<EyedropperSampler | null>(null)
  const [arming, setArming] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = Math.min(anchor.x, window.innerWidth - rect.width - 10)
    const y = Math.min(anchor.y, window.innerHeight - rect.height - 10)
    if (x !== pos.x || y !== pos.y) setPos({ x: Math.max(8, x), y: Math.max(8, y) })
  }, [anchor, pos.x, pos.y])

  // Remembered so None -> Solid comes back to the colour that was on screen.
  // Without it, switching away from a paint that carries no colour and back
  // again silently resets it to black.
  const lastColor = useRef<RGBA>({ r: 0, g: 0, b: 0, a: 1 })
  const solidColor: RGBA =
    paint.type === 'solid'
      ? paint.color
      : paint.type === 'linear' || paint.type === 'radial'
        ? (paint.stops[0]?.color ?? lastColor.current)
        : lastColor.current
  lastColor.current = solidColor

  // ---- eyedropper --------------------------------------------------------
  const disarm = useCallback(() => setSampler(null), [])

  const toggleEyedropper = useCallback(() => {
    if (sampler) return disarm()
    setArming(true)
    void armEyedropper()
      .then((s) => setSampler(s))
      .catch(() => setSampler(null))
      .finally(() => setArming(false))
  }, [sampler, disarm])

  useEffect(() => {
    if (!sampler) return
    const pick = (e: PointerEvent, committing: boolean) => {
      const rgba = sampler.sample(e.clientX, e.clientY)
      if (rgba) onChange({ type: 'solid', color: rgba }, committing)
    }
    const onMove = (e: PointerEvent) => pick(e, false)
    const onDown = (e: PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      pick(e, true)
      disarm()
    }
    document.body.classList.add('eyedropping')
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerdown', onDown, true)
    // The raster is a snapshot of the current view, so a pan or zoom would make
    // it silently lie about what is under the pointer.
    const unsubscribe = editorStore.subscribe((s, prev) => {
      if (s.viewport !== prev.viewport) disarm()
    })
    return () => {
      document.body.classList.remove('eyedropping')
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerdown', onDown, true)
      unsubscribe()
    }
  }, [sampler, onChange, disarm])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (sampler) return
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        if (sampler) disarm()
        else onClose()
      }
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [onClose, sampler, disarm])

  const options = allowGradient
    ? PAINT_OPTIONS
    : PAINT_OPTIONS.filter((o) => o.value === 'solid' || o.value === 'none')

  return (
    <div ref={ref} className="popover" style={{ left: pos.x, top: pos.y, width: PAINT_POPOVER_WIDTH }}>
      <div className="hstack popover-header">
        <Select
          value={paint.type}
          title="Paint type"
          options={
            // An imported paint server has no editor; naming it keeps the
            // dropdown honest instead of rendering blank.
            paint.type === 'ref'
              ? [{ value: 'ref' as Paint['type'], label: 'Imported paint' }, ...options]
              : options
          }
          onChange={(type) => onChange(paintOfType(type, paint, solidColor), true)}
        />
        <div className="spacer" />
        <button
          type="button"
          className={`icon-button${sampler ? ' active' : ''}`}
          title="Pick a color from the canvas"
          aria-label="Eyedropper"
          aria-pressed={!!sampler}
          disabled={arming}
          onClick={toggleEyedropper}
        >
          <EyedropperIcon />
        </button>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
          <CloseIcon />
        </button>
      </div>

      {paint.type === 'linear' || paint.type === 'radial' ? (
        <GradientEditor paint={paint} onChange={onChange} />
      ) : paint.type === 'ref' ? (
        <div className="empty-state">
          This shape uses a pattern from an imported file. It is preserved exactly, but cannot be
          edited here.
        </div>
      ) : (
        <ColorPicker
          color={solidColor}
          onChange={(color, committing) => onChange({ type: 'solid', color }, committing)}
        />
      )}
    </div>
  )
}

/** The popover's width, shared so the inspector's left-flip cannot drift from it. */
export const PAINT_POPOVER_WIDTH = 296

/**
 * Convert between paint types, carrying the colour across.
 *
 * Switching gradient -> solid used to discard the stop and jump to grey 200,
 * which threw away the colour the user had just chosen.
 */
function paintOfType(type: Paint['type'], current: Paint, base: RGBA): Paint {
  if (type === current.type) return current
  switch (type) {
    case 'solid':
      return { type: 'solid', color: { ...base } }
    case 'none':
      return { type: 'none' }
    case 'linear':
      return isGradient(current)
        ? { type: 'linear', x1: 0, y1: 0, x2: 1, y2: 0, stops: current.stops }
        : { type: 'linear', x1: 0, y1: 0, x2: 1, y2: 0, stops: rampFrom(base) }
    case 'radial':
      return isGradient(current)
        ? { type: 'radial', cx: 0.5, cy: 0.5, r: 0.5, stops: current.stops }
        : { type: 'radial', cx: 0.5, cy: 0.5, r: 0.5, stops: rampFrom(base) }
    default:
      return current
  }
}

function isGradient(p: Paint): p is Extract<Paint, { stops: GradientStop[] }> {
  return p.type === 'linear' || p.type === 'radial'
}

function rampFrom(base: RGBA): GradientStop[] {
  return [createStop(0, { ...base }), createStop(1, { ...base, a: 0 })]
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t
}
