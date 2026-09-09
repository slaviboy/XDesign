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
 * Re-render when the keymap changes.
 *
 * Menus, tooltips and the shortcuts dialog all print chords, and a rebinding
 * has to reach every one of them at once — a File menu still advertising ⌘S
 * after Save was moved is worse than one showing no shortcut at all.
 */

import { useEffect, useReducer } from 'react'
import { subscribeKeymap } from './keymap'

export function useKeymap(): number {
  const [tick, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => subscribeKeymap(bump), [])
  return tick
}
