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
 * Dropdown and context menus.
 *
 * One implementation drives the application menu, the right-click menu and the
 * submenus inside them, so keyboard dismissal, click-outside and edge-flipping
 * behave identically everywhere.
 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { ChevronRightIcon } from './icons'

export interface MenuItemSpec {
  kind?: 'item' | 'separator' | 'submenu'
  label?: string
  /** Drawn before the label. Used by the icon dropdowns in the inspector. */
  icon?: ReactNode
  shortcut?: string
  disabled?: boolean
  checked?: boolean
  onSelect?: () => void
  items?: MenuItemSpec[]
  /**
   * A stable handle for tests. Menu labels are translated, and the position of
   * an item changes whenever a neighbour is added, so neither is something a
   * test can hold on to.
   */
  testId?: string
}

export function Menu({
  x,
  y,
  items,
  onClose,
}: {
  x: number
  y: number
  items: MenuItemSpec[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  const [openSub, setOpenSub] = useState<number | null>(null)

  // Flip the menu back inside the viewport instead of letting it clip.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    let nx = x
    let ny = y
    if (rect.width + x > window.innerWidth - 8) nx = Math.max(8, window.innerWidth - rect.width - 8)
    if (rect.height + y > window.innerHeight - 8) ny = Math.max(8, window.innerHeight - rect.height - 8)
    if (nx !== pos.x || ny !== pos.y) setPos({ x: nx, y: ny })
  }, [x, y, pos.x, pos.y])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    // Capture phase so the menu closes before the canvas sees the click.
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  return (
    <div ref={ref} className="menu" style={{ left: pos.x, top: pos.y }} role="menu">
      {items.map((item, i) => {
        if (item.kind === 'separator') return <div key={i} className="menu-separator" />
        if (item.kind === 'submenu' && item.items) {
          return (
            <div
              key={i}
              style={{ position: 'relative' }}
              onPointerEnter={() => setOpenSub(i)}
              onPointerLeave={() => setOpenSub((cur) => (cur === i ? null : cur))}
            >
              <button
                type="button"
                className="menu-item"
                data-testid={item.testId}
                disabled={item.disabled}
                role="menuitem"
              >
                <span>{item.label}</span>
                <ChevronRightIcon className="menu-submenu-arrow" />
              </button>
              {openSub === i && (
                <SubMenu items={item.items} onClose={onClose} />
              )}
            </div>
          )
        }
        return (
          <button
            key={i}
            type="button"
            className="menu-item"
            data-testid={item.testId}
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              item.onSelect?.()
              onClose()
            }}
          >
            <span className="menu-item-label">
              {item.icon ? (
                <span className="menu-item-icon">{item.icon}</span>
              ) : item.checked ? (
                '✓ '
              ) : null}
              {item.label}
            </span>
            {item.icon && item.checked && <span className="menu-item-check">✓</span>}
            {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
          </button>
        )
      })}
    </div>
  )
}

function SubMenu({ items, onClose }: { items: MenuItemSpec[]; onClose: () => void }) {
  return (
    <div className="menu" style={{ position: 'absolute', left: '100%', top: -4, marginLeft: 2 }}>
      {items.map((item, i) =>
        item.kind === 'separator' ? (
          <div key={i} className="menu-separator" />
        ) : (
          <button
            key={i}
            type="button"
            className="menu-item"
            data-testid={item.testId}
            disabled={item.disabled}
            onClick={() => {
              item.onSelect?.()
              onClose()
            }}
          >
            <span className="menu-item-label">
              {item.icon ? (
                <span className="menu-item-icon">{item.icon}</span>
              ) : item.checked ? (
                '✓ '
              ) : null}
              {item.label}
            </span>
            {item.icon && item.checked && <span className="menu-item-check">✓</span>}
            {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
          </button>
        ),
      )}
    </div>
  )
}

export function useMenuState() {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItemSpec[] } | null>(null)
  return {
    menu,
    open: (x: number, y: number, items: MenuItemSpec[]) => setMenu({ x, y, items }),
    close: () => setMenu(null),
  }
}

export function MenuHost({
  menu,
  onClose,
}: {
  menu: { x: number; y: number; items: MenuItemSpec[] } | null
  onClose: () => void
}): ReactNode {
  if (!menu) return null
  return <Menu x={menu.x} y={menu.y} items={menu.items} onClose={onClose} />
}
