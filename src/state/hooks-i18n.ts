/**
 * Re-render on a language change.
 *
 * The catalogue is a module-level value rather than store state, so components
 * that show text subscribe here instead. One counter, like the LiveTransform
 * tick: the language changes once in a blue moon, and paying for a context
 * provider around the whole tree to model that is the wrong trade.
 */

import { useEffect, useReducer } from 'react'
import { subscribeLanguage } from '../i18n'
import { subscribeSpellCheck } from '../text/spellcheck'
import { subscribeFonts } from '../text/FontRegistry'

export function useLanguage(): number {
  const [tick, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => subscribeLanguage(bump), [])
  return tick
}

/**
 * Re-render when a dictionary arrives or spell check is switched.
 *
 * Same shape as useLanguage, and separate from it because the two change at
 * different moments: a dictionary lands asynchronously long after the language
 * that asked for it was chosen.
 */
export function useSpellCheckTick(): number {
  const [tick, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => subscribeSpellCheck(bump), [])
  return tick
}

/**
 * Re-render when a font face finishes loading.
 *
 * Layout measured against a face the browser had not fetched yet is layout
 * against the fallback, and the difference shows as text overflowing the box it
 * was fitted to. This is how a component learns to measure again.
 */
export function useFonts(): number {
  const [tick, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => subscribeFonts(bump), [])
  return tick
}
