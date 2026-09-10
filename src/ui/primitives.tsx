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
 * Shared inspector controls.
 *
 * The numeric field is the one that matters: it commits on blur and Enter,
 * supports arrow-key stepping, and scrubs when you drag its label — the
 * interaction designers expect from a properties panel, and the reason the
 * inspector feels like a tool rather than a form.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { MenuHost, useMenuState } from './Menu'
import { ChevronDownIcon } from './icons'

// ------------------------------------------------------------------ tooltip

let tooltipTimer: ReturnType<typeof setTimeout> | null = null

/** Gap between the anchor and the tooltip, and the margin kept from the edges. */
const TIP_GAP = 8
const TIP_MARGIN = 6
/** Rough tooltip size, used to decide which side to open on before it renders. */
const TIP_ESTIMATE = { width: 150, height: 24 }

type TipPlacement = 'right' | 'left' | 'below'

interface TipPosition {
  x: number
  y: number
  placement: TipPlacement
}

export function Tooltip({
  label,
  shortcut,
  side = 'auto',
  children,
}: {
  label: string
  shortcut?: string
  /** 'auto' opens to the right, flipping left or below when there is no room. */
  side?: 'auto' | 'right' | 'below'
  children: ReactNode
}) {
  const [pos, setPos] = useState<TipPosition | null>(null)
  const ref = useRef<HTMLSpanElement>(null)

  const show = useCallback(() => {
    if (tooltipTimer) clearTimeout(tooltipTimer)
    tooltipTimer = setTimeout(() => {
      // The wrapper is `display: contents`, which generates NO layout box — its
      // getBoundingClientRect() is all zeros, which would park every tooltip in
      // the top-left corner of the window. Measure the real child instead.
      const anchor = ref.current?.firstElementChild ?? ref.current
      const rect = anchor?.getBoundingClientRect()
      if (!rect || (rect.width === 0 && rect.height === 0)) return

      const width = Math.max(TIP_ESTIMATE.width, label.length * 6.5 + (shortcut ? 28 : 0))
      const fitsRight = rect.right + TIP_GAP + width < window.innerWidth - TIP_MARGIN
      const fitsLeft = rect.left - TIP_GAP - width > TIP_MARGIN

      let placement: TipPlacement
      if (side === 'below') placement = 'below'
      else if (fitsRight) placement = 'right'
      else if (fitsLeft) placement = 'left'
      else placement = 'below'

      if (placement === 'below') {
        setPos({
          x: clamp(rect.left + rect.width / 2, TIP_MARGIN + width / 2, window.innerWidth - TIP_MARGIN - width / 2),
          y: Math.min(rect.bottom + TIP_GAP, window.innerHeight - TIP_MARGIN - TIP_ESTIMATE.height),
          placement,
        })
        return
      }

      setPos({
        x: placement === 'right' ? rect.right + TIP_GAP : rect.left - TIP_GAP,
        y: clamp(
          rect.top + rect.height / 2,
          TIP_MARGIN + TIP_ESTIMATE.height / 2,
          window.innerHeight - TIP_MARGIN - TIP_ESTIMATE.height / 2,
        ),
        placement,
      })
    }, 450)
  }, [label, shortcut, side])

  const hide = useCallback(() => {
    if (tooltipTimer) clearTimeout(tooltipTimer)
    setPos(null)
  }, [])

  useEffect(() => () => { if (tooltipTimer) clearTimeout(tooltipTimer) }, [])

  const transform =
    pos?.placement === 'right'
      ? 'translateY(-50%)'
      : pos?.placement === 'left'
        ? 'translate(-100%, -50%)'
        : 'translateX(-50%)'

  return (
    <span
      ref={ref}
      onPointerEnter={show}
      onPointerLeave={hide}
      onPointerDown={hide}
      style={{ display: 'contents' }}
    >
      {children}
      {pos && (
        <span
          className="tooltip"
          role="tooltip"
          style={{ left: pos.x, top: pos.y, transform }}
        >
          {label}
          {shortcut && <span className="tooltip-shortcut">{shortcut}</span>}
        </span>
      )}
    </span>
  )
}

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value
}

// ------------------------------------------------------------- number field

export interface NumberFieldProps {
  /** A node, not just a string, so a field can be labelled with an icon. */
  label?: ReactNode
  value: number | null
  onChange: (value: number, committing: boolean) => void
  min?: number
  max?: number
  step?: number
  /** Units moved per pixel when scrubbing the label. */
  scrubStep?: number
  precision?: number
  suffix?: string
  disabled?: boolean
  title?: string
  /** Extra class on the field wrapper, so a grid parent can place it. */
  className?: string
}

export function NumberField({
  label,
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  scrubStep,
  precision = 2,
  suffix,
  disabled,
  title,
  className,
}: NumberFieldProps) {
  // `null` means a mixed multi-selection; show a dash rather than a lie.
  const [draft, setDraft] = useState<string | null>(null)
  const scrubRef = useRef<{ startX: number; startValue: number } | null>(null)

  const display =
    draft !== null
      ? draft
      : value === null
        ? ''
        : String(Number(value.toFixed(precision)))

  const clamp = (n: number) => Math.min(max, Math.max(min, n))

  const commit = (raw: string) => {
    setDraft(null)
    if (raw.trim() === '') return
    // Accept simple arithmetic so "120*2" or "80+16" work, as in real tools.
    const parsed = evaluateNumeric(raw)
    if (parsed === null) return
    onChange(clamp(parsed), true)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation()
    if (e.key === 'Enter') {
      commit((e.target as HTMLInputElement).value)
      ;(e.target as HTMLInputElement).blur()
    } else if (e.key === 'Escape') {
      setDraft(null)
      ;(e.target as HTMLInputElement).blur()
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const base = value ?? 0
      const delta = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)
      onChange(clamp(base + delta), true)
    }
  }

  // Dragging the label scrubs the value — pointer capture keeps it tracking
  // even when the cursor leaves the tiny label hitbox.
  const onLabelPointerDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (disabled || value === null) return
    e.preventDefault()
    scrubRef.current = { startX: e.clientX, startValue: value }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onLabelPointerMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    const scrub = scrubRef.current
    if (!scrub) return
    const per = scrubStep ?? step
    const delta = (e.clientX - scrub.startX) * per * (e.shiftKey ? 10 : 1)
    onChange(clamp(scrub.startValue + delta), false)
  }

  const onLabelPointerUp = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!scrubRef.current) return
    scrubRef.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* already released */ }
    if (value !== null) onChange(value, true)
  }

  return (
    <div className={`field${disabled ? ' disabled' : ''}${className ? ` ${className}` : ''}`} title={title}>
      {label && (
        <span
          className="field-label"
          onPointerDown={onLabelPointerDown}
          onPointerMove={onLabelPointerMove}
          onPointerUp={onLabelPointerUp}
        >
          {label}
        </span>
      )}
      <input
        type="text"
        inputMode="decimal"
        value={display}
        placeholder={value === null ? 'Mixed' : undefined}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {suffix && <span className="field-label">{suffix}</span>}
    </div>
  )
}

/** Parses a number, or a simple `a+b` / `a*b` expression typed into a field. */
export function evaluateNumeric(raw: string): number | null {
  const text = raw.trim().replace(/[^0-9+\-*/.() ]/g, '')
  if (!text) return null
  const direct = Number.parseFloat(text)
  if (/^-?\d*\.?\d+$/.test(text)) return Number.isFinite(direct) ? direct : null
  try {
    // Only digits and operators survived the filter above, so this cannot
    // evaluate anything but arithmetic.
    const result = Function(`"use strict";return (${text})`)() as unknown
    return typeof result === 'number' && Number.isFinite(result) ? result : null
  } catch {
    return Number.isFinite(direct) ? direct : null
  }
}

// ----------------------------------------------------------------- others

export function TextField({
  value,
  onChange,
  placeholder,
  disabled,
  label,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  disabled?: boolean
  label?: string
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <div className={`field${disabled ? ' disabled' : ''}`}>
      {label && <span className="field-label">{label}</span>}
      <input
        type="text"
        value={draft ?? value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') {
            onChange(draft ?? value)
            setDraft(null)
            ;(e.target as HTMLInputElement).blur()
          }
          if (e.key === 'Escape') {
            setDraft(null)
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        onBlur={() => {
          if (draft !== null) onChange(draft)
          setDraft(null)
        }}
      />
    </div>
  )
}

export function Select<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
  title,
}: {
  value: T
  options: Array<
    | { value: T; label: string; disabled?: boolean }
    | { group: string; options: Array<{ value: T; label: string }> }
  >
  onChange: (v: T) => void
  disabled?: boolean
  title?: string
}) {
  return (
    <select
      className="select-field"
      value={value}
      disabled={disabled}
      title={title}
      onChange={(e) => {
        const raw = e.target.value
        const numeric = Number(raw)
        onChange((typeof value === 'number' && Number.isFinite(numeric) ? numeric : raw) as T)
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {options.map((opt, i) =>
        'group' in opt ? (
          <optgroup key={`${opt.group}-${i}`} label={opt.group}>
            {opt.options.map((o) => (
              <option key={String(o.value)} value={o.value}>{o.label}</option>
            ))}
          </optgroup>
        ) : (
          <option key={String(opt.value)} value={opt.value} disabled={opt.disabled}>{opt.label}</option>
        ),
      )}
    </select>
  )
}

/**
 * A dropdown whose every option carries an icon.
 *
 * A native <select> cannot draw anything but text in its options, so this is a
 * button plus the same menu the application and context menus use — which is
 * why dismissal, click-outside and edge-flipping need no code here.
 *
 * The closed control shows the icon alone. Three of these share one inspector
 * row, which leaves about thirty pixels for a word: "Center" came out as "Ce…"
 * and "Projecting" had no chance. The icons draw their own setting, the tooltip
 * names both the control and its current value, and the menu spells every
 * option out in full. `data-value` carries the setting for tests.
 */
export function IconSelect<T extends string>({
  value,
  options,
  onChange,
  title,
}: {
  value: T
  options: Array<{ value: T; label: string; icon: ReactNode }>
  onChange: (value: T) => void
  title?: string
}) {
  const menu = useMenuState()
  const ref = useRef<HTMLButtonElement>(null)
  const current = options.find((o) => o.value === value) ?? options[0]

  return (
    <>
      <button
        ref={ref}
        type="button"
        className="icon-select"
        title={current ? `${title}: ${current.label}` : title}
        aria-label={current ? `${title}: ${current.label}` : title}
        aria-haspopup="menu"
        data-value={value}
        onClick={() => {
          const rect = ref.current?.getBoundingClientRect()
          menu.open(
            rect?.left ?? 0,
            (rect?.bottom ?? 0) + 4,
            options.map((o) => ({
              label: o.label,
              icon: o.icon,
              checked: o.value === value,
              onSelect: () => onChange(o.value),
            })),
          )
        }}
      >
        <span className="icon-select-icon">{current?.icon}</span>
        <ChevronDownIcon size={10} className="icon-select-arrow" />
      </button>
      <MenuHost menu={menu.menu} onClose={menu.close} />
    </>
  )
}

export function IconButton({
  icon,
  label,
  shortcut,
  active,
  disabled,
  onClick,
}: {
  icon: ReactNode
  label: string
  shortcut?: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <Tooltip label={label} shortcut={shortcut}>
      <button
        type="button"
        className={`icon-button${active ? ' active' : ''}`}
        disabled={disabled}
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
      >
        {icon}
      </button>
    </Tooltip>
  )
}

export function Section({
  title,
  actions,
  children,
}: {
  title?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="section">
      {title && (
        <h3 className="section-title">
          {title}
          {actions}
        </h3>
      )}
      {children}
    </div>
  )
}

/** Common value across a selection, or null when they differ. */
export function common<T, V>(items: readonly T[], get: (t: T) => V): V | null {
  if (items.length === 0) return null
  const first = get(items[0]!)
  for (let i = 1; i < items.length; i++) {
    const v = get(items[i]!)
    if (v !== first) return null
  }
  return first
}
