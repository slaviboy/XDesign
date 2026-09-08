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

export function useLanguage(): number {
  const [tick, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => subscribeLanguage(bump), [])
  return tick
}
