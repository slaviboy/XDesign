/**
 * Light / dark theme.
 *
 * The choice is a small preference, so it lives in localStorage rather than the
 * IndexedDB document store — and specifically because localStorage is
 * SYNCHRONOUS. The theme has to be applied before the first paint or the app
 * flashes light before switching, and an async read cannot do that. The
 * matching inline script in index.html reads the same key.
 *
 * Three states, not two: an explicit 'light' or 'dark' choice, or 'system',
 * which follows prefers-color-scheme and keeps following it if the OS setting
 * changes mid-session.
 */

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'xdesign.theme'

type Listener = (resolved: ResolvedTheme, preference: ThemePreference) => void

const listeners = new Set<Listener>()
let preference: ThemePreference = readStoredPreference()
let mediaQuery: MediaQueryList | null = null

function readStoredPreference(): ThemePreference {
  let stored: string | null = null
  try {
    stored = localStorage.getItem(THEME_STORAGE_KEY)
  } catch {
    // Private mode, or storage blocked. Falling through to 'system' still lets
    // the OS preference apply — which is the case 'system' exists to cover.
  }
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  return 'system'
}

function systemTheme(): ResolvedTheme {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function resolveTheme(pref: ThemePreference = preference): ResolvedTheme {
  return pref === 'system' ? systemTheme() : pref
}

export function getThemePreference(): ThemePreference {
  return preference
}

export function getResolvedTheme(): ResolvedTheme {
  return resolveTheme(preference)
}

function apply(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = resolved
  // Lets the browser paint native widgets (scrollbars, form controls, the
  // canvas backdrop) to match, which is what stops white flashes at the edges.
  document.documentElement.style.colorScheme = resolved
}

export function setThemePreference(next: ThemePreference): void {
  preference = next
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next)
  } catch {
    // Preference simply will not persist; the session still honours it.
  }
  const resolved = resolveTheme(next)
  apply(resolved)
  for (const fn of listeners) fn(resolved, next)
}

/**
 * The top-bar button: always flips to the opposite of what is currently on
 * screen.
 *
 * Deliberately NOT a three-way light -> dark -> system cycle. Starting from
 * 'system' on a light desktop, the next entry in such a cycle is 'light',
 * so the first click changes nothing visible and the button reads as broken.
 * "Follow system" is still reachable, from the Theme submenu in the app menu.
 */
export function toggleTheme(): ThemePreference {
  const next: ThemePreference = resolveTheme(preference) === 'dark' ? 'light' : 'dark'
  setThemePreference(next)
  return next
}

export function subscribeTheme(fn: Listener): () => void {
  listeners.add(fn)
  // Returns void, not Set.delete's boolean, so it is a clean effect cleanup.
  return () => {
    listeners.delete(fn)
  }
}

/**
 * Apply the stored preference and start following the OS setting.
 * Safe to call more than once.
 */
export function initTheme(): void {
  apply(resolveTheme(preference))
  if (mediaQuery || typeof window === 'undefined') return
  try {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    mediaQuery.addEventListener('change', () => {
      // Only relevant while following the system; an explicit choice wins.
      if (preference !== 'system') return
      const resolved = resolveTheme('system')
      apply(resolved)
      for (const fn of listeners) fn(resolved, 'system')
    })
  } catch {
    mediaQuery = null
  }
}
