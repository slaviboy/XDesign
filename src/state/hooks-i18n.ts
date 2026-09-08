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
