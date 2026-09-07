/**
 * Colour picker and gradient editor.
 *
 * Edits stream through with `committing: false` while a slider is dragged, so
 * the canvas updates live but the whole drag collapses into one undo entry via
 * the store's coalesce key.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  hsvToRgb,
  parseHex,
  rgbToHsv,
  toCss,
  toHex,
  type HSV,
} from '../document/color'
import { createStop } from '../document/NodeFactory'
import { NumberField } from './primitives'
import { CloseIcon, PlusIcon, TrashIcon } from './icons'
import type { GradientStop, Paint, RGBA } from '../document/types'

const PRESETS = [
  '#000000', '#404040', '#757575', '#a8a8a8', '#d4d4d4', '#ffffff',
  '#d7373f', '#e68619', '#e2c541', '#268e6c', '#1473e6', '#6767ec',
  '#d83790', '#7b3fb5', '#0d66d0', '#0f797d', '#4b8b3b', '#8f5f00',
  '#5e2b2b', '#2b3a5e',
]

// ---------------------------------------------------------------------------
// Solid colour
// ---------------------------------------------------------------------------

export function ColorPicker({
  color,
  onChange,
}: {
  color: RGBA
  onChange: (color: RGBA, committing: boolean) => void
}) {
  // HSV is kept locally because it is not recoverable from RGB at the extremes:
  // pure black has no hue, so a round trip through RGB would reset the hue
  // slider to red the moment value hits zero.
  const [hsv, setHsv] = useState<HSV>(() => rgbToHsv(color))
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

  const hueColor = useMemo(() => toCss(hsvToRgb(hsv.h, 1, 1)), [hsv.h])

  return (
    <div className="color-picker">
      <SaturationValueSquare
        hsv={hsv}
        hueColor={hueColor}
        onChange={(s, v, committing) => emit({ ...hsv, s, v }, color.a, committing)}
      />

      <Slider
        className="hue-track"
        value={hsv.h / 360}
        onChange={(t, committing) => emit({ ...hsv, h: t * 360 }, color.a, committing)}
      />

      <Slider
        className="alpha-track"
        value={color.a}
        overlay={`linear-gradient(to right, transparent, ${toCss({ ...color, a: 1 })})`}
        onChange={(t, committing) => emit(hsv, t, committing)}
      />

      <div className="field-row cols-4" style={{ gridTemplateColumns: '1.6fr 1fr 1fr 1fr' }}>
        <HexField color={color} onChange={(c) => onChange(c, true)} />
        <NumberField label="R" value={color.r} min={0} max={255} onChange={(v, c) => onChange({ ...color, r: Math.round(v) }, c)} precision={0} />
        <NumberField label="G" value={color.g} min={0} max={255} onChange={(v, c) => onChange({ ...color, g: Math.round(v) }, c)} precision={0} />
        <NumberField label="B" value={color.b} min={0} max={255} onChange={(v, c) => onChange({ ...color, b: Math.round(v) }, c)} precision={0} />
      </div>

      <div className="preset-swatches">
        {PRESETS.map((hex) => (
          <button
            key={hex}
            type="button"
            className="preset-swatch"
            style={{ background: hex }}
            title={hex}
            onClick={() => {
              const parsed = parseHex(hex)
              if (parsed) {
                const next = { ...parsed, a: color.a }
                setHsv(rgbToHsv(next))
                lastEmitted.current = toHex(next, true)
                onChange(next, true)
              }
            }}
          />
        ))}
      </div>
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
}: {
  value: number
  onChange: (t: number, committing: boolean) => void
  className: string
  overlay?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const update = (clientX: number, committing: boolean) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    onChange(clamp01((clientX - rect.left) / rect.width), committing)
  }

  return (
    <div
      ref={ref}
      className={`slider-track ${className}`}
      onPointerDown={(e) => {
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        update(e.clientX, false)
      }}
      onPointerMove={(e) => { if (dragging.current) update(e.clientX, false) }}
      onPointerUp={(e) => {
        if (!dragging.current) return
        dragging.current = false
        try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* released */ }
        update(e.clientX, true)
      }}
    >
      {overlay && <div className="alpha-overlay" style={{ background: overlay }} />}
      <div className="slider-thumb" style={{ left: `${value * 100}%` }} />
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

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = Math.min(anchor.x, window.innerWidth - rect.width - 10)
    const y = Math.min(anchor.y, window.innerHeight - rect.height - 10)
    if (x !== pos.x || y !== pos.y) setPos({ x: Math.max(8, x), y: Math.max(8, y) })
  }, [anchor, pos.x, pos.y])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  const solidColor: RGBA =
    paint.type === 'solid'
      ? paint.color
      : paint.type === 'linear' || paint.type === 'radial'
        ? (paint.stops[0]?.color ?? { r: 0, g: 0, b: 0, a: 1 })
        : { r: 0, g: 0, b: 0, a: 1 }

  return (
    <div ref={ref} className="popover" style={{ left: pos.x, top: pos.y, width: 248 }}>
      <div className="hstack" style={{ marginBottom: 8 }}>
        <TypeTabs paint={paint} onChange={onChange} allowGradient={allowGradient} />
        <div className="spacer" />
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

function TypeTabs({
  paint,
  onChange,
  allowGradient,
}: {
  paint: Paint
  onChange: (p: Paint, committing: boolean) => void
  allowGradient: boolean
}) {
  const current = paint.type
  const base = paint.type === 'solid' ? paint.color : { r: 200, g: 200, b: 200, a: 1 }

  return (
    <div className="icon-row">
      <button
        type="button"
        className={`icon-button${current === 'solid' ? ' active' : ''}`}
        style={{ width: 40, fontSize: 10 }}
        onClick={() => onChange({ type: 'solid', color: base }, true)}
      >
        Solid
      </button>
      {allowGradient && (
        <>
          <button
            type="button"
            className={`icon-button${current === 'linear' ? ' active' : ''}`}
            style={{ width: 46, fontSize: 10 }}
            onClick={() =>
              onChange(
                {
                  type: 'linear',
                  x1: 0, y1: 0, x2: 1, y2: 0,
                  stops: [createStop(0, { ...base }), createStop(1, { r: 255, g: 255, b: 255, a: 1 })],
                },
                true,
              )
            }
          >
            Linear
          </button>
          <button
            type="button"
            className={`icon-button${current === 'radial' ? ' active' : ''}`}
            style={{ width: 46, fontSize: 10 }}
            onClick={() =>
              onChange(
                {
                  type: 'radial',
                  cx: 0.5, cy: 0.5, r: 0.5,
                  stops: [createStop(0, { ...base }), createStop(1, { r: 255, g: 255, b: 255, a: 1 })],
                },
                true,
              )
            }
          >
            Radial
          </button>
        </>
      )}
      <button
        type="button"
        className={`icon-button${current === 'none' ? ' active' : ''}`}
        style={{ width: 40, fontSize: 10 }}
        onClick={() => onChange({ type: 'none' }, true)}
      >
        None
      </button>
    </div>
  )
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n
}
